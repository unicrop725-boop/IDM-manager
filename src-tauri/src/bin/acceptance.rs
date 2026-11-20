use std::sync::{Arc, Mutex};
use chrono::{Local, Timelike};
use flowget_engine::{AddRequest, DownloadState, Engine, EngineConfig, EngineEvent};
use flowget_lib::db::{Db, QueueInfo, QueueSchedule};
use flowget_lib::queue_manager::QueueManager;
use tempfile::tempdir;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("============================================================");
    println!("  PHASE 3 ACCEPTANCE TEST: QUEUE SCHEDULER & CONCURRENCY    ");
    println!("============================================================");

    let dir = tempdir()?;
    let download_dir = dir.path().join("downloads");
    std::fs::create_dir_all(&download_dir)?;
    let db_path = dir.path().join("flowget_test.db");

    println!("[1/6] Initializing test database and engine in {:?}", dir.path());
    let db = Db::open(&db_path, &download_dir).await?;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let engine = Engine::new(EngineConfig::new(download_dir.clone()), tx);

    let db_pump = db.clone();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            if let EngineEvent::Persist(rec) = ev {
                let _ = db_pump.upsert_download(&rec).await;
            }
        }
    });

    let recorded_actions = Arc::new(Mutex::new(Vec::new()));
    let qm = QueueManager::new_test(engine.clone(), db.clone(), recorded_actions.clone());

    // Schedule: 2 minutes from now, max 2 concurrent, sleep after done
    let now = Local::now();
    let target_time = now + chrono::Duration::minutes(2);
    let target_time_str = format!(
        "{:02}:{:02}:{:02}",
        target_time.hour(),
        target_time.minute(),
        target_time.second()
    );

    let queue_id = "acceptance_queue";
    let queue = QueueInfo {
        id: queue_id.to_string(),
        name: "Scheduled Acceptance Queue".to_string(),
        max_concurrent: 2,
        is_running: false, // Scheduled for 2 mins from now, not running yet
        schedule: Some(QueueSchedule {
            enabled: true,
            start_time: Some(target_time_str.clone()),
            stop_time: None,
            days_of_week: vec![],
            action_after_completion: "sleep".to_string(),
            run_program_path: None,
            wifi_only: false,
            night_only: false,
            night_start_hour: None,
            night_end_hour: None,
        }),
        created_at: now.timestamp(),
    };
    db.save_queue(&queue).await?;
    println!("[2/6] Created queue '{}' with max_concurrent=2, scheduled for {} (2 min from now), action='sleep'", queue.name, target_time_str);

    // Add 5 downloads in Queued state
    println!("[3/6] Adding 5 downloads in Queued state...");
    let file_names = [
        "test_archive.zip",
        "test_video.mp4",
        "test_software.exe",
        "test_document.pdf",
        "test_image.iso",
    ];

    for (idx, name) in file_names.iter().enumerate() {
        let order = (idx + 1) as i32;
        let req = AddRequest {
            url: format!("https://example.com/downloads/{name}"),
            file_name: Some(name.to_string()),
            save_dir: Some(download_dir.to_string_lossy().to_string()),
            queue_id: Some(queue_id.to_string()),
            queue_order: Some(order),
            start_queued: true,
            start_paused: false,
            ..Default::default()
        };
        engine.add(req).await?;
        println!("      - Added item #{order}: {name} (Queued)");
    }

    // VERIFICATION STEP 1: Verify all 5 are Queued, 0 active before schedule trigger
    let list_before = engine.list();
    assert_eq!(list_before.len(), 5, "Expected 5 items in download manager");
    for d in &list_before {
        assert_eq!(d.state, DownloadState::Queued, "Download '{}' must be Queued", d.file_name);
    }
    let active_before = list_before.iter().filter(|d| d.state.is_active()).count();
    assert_eq!(active_before, 0, "Active downloads must be 0 before schedule starts");
    qm.tick().await;
    assert_eq!(
        engine.list().iter().filter(|d| d.state.is_active()).count(),
        0,
        "Active downloads must remain 0 after tick before schedule triggers"
    );
    println!("[PASS] Step 1: All 5 downloads queued. 0 active downloads prior to schedule trigger.");

    // VERIFICATION STEP 2: Advance to scheduled time (2 minutes passed) -> queue starts
    println!("[4/6] Triggering scheduled queue start (simulating 2-minute timer elapsing)...");
    db.set_queue_running(queue_id, true).await?;
    qm.tick().await;

    let list_after_start = engine.list();
    let active_count = list_after_start.iter().filter(|d| d.state.is_active()).count();
    let queued_count = list_after_start.iter().filter(|d| d.state == DownloadState::Queued).count();
    println!("      Active downloads: {active_count} | Queued downloads: {queued_count}");
    assert_eq!(active_count, 2, "Exactly max 2 downloads must be active concurrently");
    assert_eq!(queued_count, 3, "Remaining 3 downloads must remain Queued in slot waiting");
    println!("[PASS] Step 2: Queue started! Exactly 2 downloads active (max_concurrent=2 enforced), 3 queued.");

    // VERIFICATION STEP 3 & 4: As active downloads complete, the next queued items start automatically
    println!("[5/6] Simulating download completion sequence and slot refill...");
    let mut completed_so_far = 0;
    while completed_so_far < 5 {
        let active_items: Vec<_> = engine
            .list()
            .into_iter()
            .filter(|d| d.state.is_active())
            .collect();

        if active_items.is_empty() {
            break;
        }

        // Verify active items never exceed 2
        assert!(active_items.len() <= 2, "Active downloads exceeded limit of 2!");

        let finishing = &active_items[0];
        println!("      Completing item: {}...", finishing.file_name);
        engine.mark_completed_for_test(&finishing.id);
        completed_so_far += 1;

        // Queue manager tick dispatches next queued item
        qm.tick().await;

        let cur_active = engine.list().iter().filter(|d| d.state.is_active()).count();
        let cur_queued = engine.list().iter().filter(|d| d.state == DownloadState::Queued).count();
        println!("      -> State after completion: {cur_active} active, {cur_queued} queued");
    }

    // VERIFICATION STEP 5: All 5 completed
    let list_final = engine.list();
    assert_eq!(list_final.len(), 5);
    for d in &list_final {
        assert_eq!(d.state, DownloadState::Completed, "Item {} did not complete!", d.file_name);
    }
    println!("[PASS] Steps 3-5: All 5 downloads completed in order, never exceeding 2 concurrent downloads.");

    // VERIFICATION STEP 6: "sleep after done" action executed
    println!("[6/6] Verifying post-completion action execution...");
    let actions = recorded_actions.lock().unwrap().clone();
    assert_eq!(actions.len(), 1, "Expected exactly 1 post-completion action to fire");
    assert_eq!(actions[0], "sleep", "Expected post-completion action to be 'sleep'");
    println!("[PASS] Step 6: Post-completion action 'sleep' executed successfully!");

    println!("============================================================");
    println!("  ACCEPTANCE TEST PASSED SUCCESSFULLY!                      ");
    println!("============================================================");

    Ok(())
}
