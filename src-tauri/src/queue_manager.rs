//! Queue execution engine and scheduler.
//!
//! - Dispatches queued downloads up to each queue's `max_concurrent` limit.
//! - Re-checks queue slots whenever a download progress/state change occurs or periodically.
//! - Scheduler: triggers queue start/stop at configured times and days.
//! - Enforces "download only on Wi-Fi" and "download only at night" options.
//! - Executes completion actions: shutdown, sleep, hibernate, exit app, or run a program.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{Datelike, Local, Timelike};
use flowget_engine::{AdapterKind, DownloadState, Engine};
use tauri::{AppHandle, Emitter};

use crate::db::{Db, QueueInfo};

pub struct QueueManager {
    engine: Engine,
    db: Db,
    app_handle: Option<AppHandle>,
    /// Keep track of queues where completion action has already fired, to avoid repeated triggers.
    action_fired_queues: Mutex<HashSet<String>>,
    /// Simulated or testing sleep action hook, to allow unit/acceptance tests without forcing OS sleep.
    test_action_recorder: Option<Arc<Mutex<Vec<String>>>>,
    is_shutting_down: AtomicBool,
}

impl QueueManager {
    pub fn new(engine: Engine, db: Db, app_handle: AppHandle) -> Self {
        Self {
            engine,
            db,
            app_handle: Some(app_handle),
            action_fired_queues: Mutex::new(HashSet::new()),
            test_action_recorder: None,
            is_shutting_down: AtomicBool::new(false),
        }
    }

    pub fn new_test(
        engine: Engine,
        db: Db,
        recorder: Arc<Mutex<Vec<String>>>,
    ) -> Self {
        Self {
            engine,
            db,
            app_handle: None,
            action_fired_queues: Mutex::new(HashSet::new()),
            test_action_recorder: Some(recorder),
            is_shutting_down: AtomicBool::new(false),
        }
    }

    /// Background loop running every second to evaluate schedules and queue progress.
    pub async fn run_scheduler_loop(self: Arc<Self>) {
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        while !self.is_shutting_down.load(Ordering::SeqCst) {
            interval.tick().await;
            self.tick().await;
        }
    }

    /// Single evaluation tick (can also be invoked directly in tests).
    pub async fn tick(&self) {
        let queues = match self.db.load_queues().await {
            Ok(q) => q,
            Err(e) => {
                eprintln!("[queue_manager] error loading queues: {e}");
                return;
            }
        };

        let now = Local::now();
        let current_time_str = format!("{:02}:{:02}:{:02}", now.hour(), now.minute(), now.second());
        let current_hm_str = format!("{:02}:{:02}", now.hour(), now.minute());
        let current_weekday = now.weekday().num_days_from_sunday() as u8; // 0 = Sun .. 6 = Sat

        for mut q in queues {
            // Check scheduler if present
            if let Some(ref sched) = q.schedule {
                if sched.enabled {
                    let day_matches = sched.days_of_week.is_empty()
                        || sched.days_of_week.contains(&current_weekday);

                    if day_matches {
                        // Check start time
                        if let Some(ref st) = sched.start_time {
                            if matches_time(st, &current_time_str, &current_hm_str) {
                                if !q.is_running {
                                    q.is_running = true;
                                    let _ = self.db.set_queue_running(&q.id, true).await;
                                    if let Some(ref h) = self.app_handle {
                                        let _ = h.emit("queue-updated", &q);
                                    }
                                }
                            }
                        }

                        // Check stop time
                        if let Some(ref st) = sched.stop_time {
                            if matches_time(st, &current_time_str, &current_hm_str) {
                                if q.is_running {
                                    q.is_running = false;
                                    let _ = self.db.set_queue_running(&q.id, false).await;
                                    if let Some(ref h) = self.app_handle {
                                        let _ = h.emit("queue-updated", &q);
                                    }
                                    // Pause running downloads in this queue
                                    self.pause_running_in_queue(&q.id).await;
                                }
                            }
                        }
                    }
                }
            }

            // If queue is running, manage downloads
            if q.is_running {
                self.process_queue_downloads(&q, &now).await;
            }
        }
    }

    async fn pause_running_in_queue(&self, queue_id: &str) {
        let all = self.engine.list();
        for d in all {
            let q_id = d.queue_id.as_deref().unwrap_or("main");
            if q_id == queue_id && d.state.is_active() {
                let _ = self.engine.pause(&d.id).await;
            }
        }
    }

    async fn process_queue_downloads(&self, q: &QueueInfo, now: &chrono::DateTime<Local>) {
        // Enforce Wi-Fi only condition if scheduled
        if let Some(ref sched) = q.schedule {
            if sched.wifi_only {
                let adapters = self.engine.adapters();
                let has_wifi = adapters.iter().any(|a| matches!(a.kind, AdapterKind::Wifi));
                if !has_wifi {
                    return;
                }
            }

            // Enforce Night only condition
            if sched.night_only {
                let start_h = sched.night_start_hour.unwrap_or(0);
                let end_h = sched.night_end_hour.unwrap_or(6);
                let cur_h = now.hour() as u8;
                let is_night = if start_h <= end_h {
                    cur_h >= start_h && cur_h < end_h
                } else {
                    cur_h >= start_h || cur_h < end_h
                };
                if !is_night {
                    return;
                }
            }
        }

        let all = self.engine.list();
        let queue_downloads: Vec<_> = all
            .into_iter()
            .filter(|d| d.queue_id.as_deref().unwrap_or("main") == q.id)
            .collect();

        if queue_downloads.is_empty() {
            return;
        }

        let active_count = queue_downloads.iter().filter(|d| d.state.is_active()).count() as u32;

        let has_queued = queue_downloads.iter().any(|d| d.state == DownloadState::Queued);
        let has_active = active_count > 0;
        let all_terminal = queue_downloads.iter().all(|d| {
            matches!(
                d.state,
                DownloadState::Completed | DownloadState::Failed | DownloadState::Cancelled
            )
        });

        if all_terminal && !has_queued && !has_active {
            // Queue has completed all tasks
            let should_fire = {
                let mut fired = self.action_fired_queues.lock().unwrap();
                fired.insert(q.id.clone())
            };

            if should_fire {
                if let Some(ref sched) = q.schedule {
                    if !sched.action_after_completion.is_empty()
                        && sched.action_after_completion != "none"
                    {
                        self.execute_completion_action(
                            &sched.action_after_completion,
                            sched.run_program_path.as_deref(),
                        )
                        .await;
                    }
                }
            }
            return;
        }

        // Reset the fired flag when there are queued or active items
        {
            let mut fired = self.action_fired_queues.lock().unwrap();
            fired.remove(&q.id);
        }

        // If there are free slots, dispatch the next queued downloads
        if active_count < q.max_concurrent {
            let free_slots = (q.max_concurrent - active_count) as usize;
            let mut queued_items: Vec<_> = queue_downloads
                .into_iter()
                .filter(|d| d.state == DownloadState::Queued)
                .collect();

            // Order by queue_order asc, then created_at asc
            queued_items.sort_by(|a, b| {
                let ord_a = a.queue_order.unwrap_or(0);
                let ord_b = b.queue_order.unwrap_or(0);
                ord_a.cmp(&ord_b).then_with(|| a.created_at.cmp(&b.created_at))
            });

            for item in queued_items.into_iter().take(free_slots) {
                if let Err(e) = self.engine.resume(&item.id).await {
                    eprintln!("[queue_manager] could not start queued download {}: {e}", item.id);
                }
            }
        }
    }

    /// Execute the scheduled post-completion action.
    pub async fn execute_completion_action(&self, action: &str, run_program_path: Option<&str>) {
        if let Some(ref rec) = self.test_action_recorder {
            rec.lock().unwrap().push(action.to_string());
            println!("[queue_manager] TEST MODE: Recorded action: {action}");
            return;
        }

        println!("[queue_manager] Executing action after queue completion: {action}");
        if let Some(ref h) = self.app_handle {
            let _ = h.emit("queue-action-executed", action);
        }

        match action {
            "shutdown" => {
                #[cfg(target_os = "windows")]
                {
                    let _ = crate::tools::hide_window(&mut std::process::Command::new("shutdown.exe"))
                        .args(["/s", "/t", "30", "/c", "FlowGet scheduled download completed."])
                        .spawn();
                }
            }
            "sleep" => {
                #[cfg(target_os = "windows")]
                {
                    // Sleep via rundll32 powrprof
                    let _ = std::process::Command::new("rundll32.exe")
                        .args(["powrprof.dll,SetSuspendState", "0,1,0"])
                        .spawn();
                }
            }
            "hibernate" => {
                #[cfg(target_os = "windows")]
                {
                    let _ = crate::tools::hide_window(&mut std::process::Command::new("shutdown.exe"))
                        .args(["/h"])
                        .spawn();
                }
            }
            "exitApp" => {
                if let Some(ref h) = self.app_handle {
                    h.exit(0);
                }
            }
            "runProgram" => {
                if let Some(path) = run_program_path {
                    let _ = std::process::Command::new(path).spawn();
                }
            }
            _ => {}
        }
    }
}

fn matches_time(target: &str, cur_hms: &str, cur_hm: &str) -> bool {
    let t = target.trim();
    if t == cur_hms || t == cur_hm {
        return true;
    }
    // Also support ISO format (e.g. 2026-11-20T19:30:00)
    if let Ok(target_dt) = chrono::DateTime::parse_from_rfc3339(t) {
        let now = Local::now();
        return now >= target_dt && now.signed_duration_since(target_dt).num_seconds() < 5;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use flowget_engine::{AddRequest, EngineConfig, EngineEvent};
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_schedule_acceptance_5_downloads_max_2_sleep_after_done() {
        let dir = tempdir().unwrap();
        let download_dir = dir.path().join("downloads");
        std::fs::create_dir_all(&download_dir).unwrap();
        let db_path = dir.path().join("test.db");

        let db = Db::open(&db_path, &download_dir).await.unwrap();

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

        // Target: schedule for 2 minutes from now
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
            name: "Acceptance Test Queue".to_string(),
            max_concurrent: 2,
            is_running: false, // scheduled for 2 minutes from now, initially not running
            schedule: Some(crate::db::QueueSchedule {
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
        db.save_queue(&queue).await.unwrap();

        // Add 5 downloads in Queued state
        for i in 1..=5 {
            let req = AddRequest {
                url: format!("https://example.com/test_file_{i}.bin"),
                file_name: Some(format!("test_file_{i}.bin")),
                save_dir: Some(download_dir.to_string_lossy().to_string()),
                queue_id: Some(queue_id.to_string()),
                queue_order: Some(i),
                start_queued: true,
                start_paused: false,
                ..Default::default()
            };
            engine.add(req).await.unwrap();
        }

        // STEP 1: Verify state before schedule time arrives
        let list_before = engine.list();
        assert_eq!(list_before.len(), 5, "5 downloads added");
        for d in &list_before {
            assert_eq!(d.state, DownloadState::Queued, "All 5 must be in Queued state initially");
        }
        let active_initial = list_before.iter().filter(|d| d.state.is_active()).count();
        assert_eq!(active_initial, 0, "0 downloads running before schedule starts");
        assert!(recorded_actions.lock().unwrap().is_empty(), "No actions fired before schedule starts");

        // Tick at T=0: Queue is not running yet
        qm.tick().await;
        assert_eq!(
            engine.list().iter().filter(|d| d.state.is_active()).count(),
            0,
            "Still 0 active before schedule time"
        );

        // STEP 2: Advance to scheduled time (2 minutes from now)
        db.set_queue_running(queue_id, true).await.unwrap();

        // STEP 3: Tick queue manager - verify max 2 downloads run at a time
        qm.tick().await;
        let list_t2 = engine.list();
        let active_count = list_t2.iter().filter(|d| d.state.is_active()).count();
        let queued_count = list_t2.iter().filter(|d| d.state == DownloadState::Queued).count();
        assert_eq!(active_count, 2, "Exactly max 2 downloads must run simultaneously");
        assert_eq!(queued_count, 3, "The remaining 3 downloads must remain Queued");

        // STEP 4: As downloads complete, verify next queued download automatically starts
        // Complete 1st download
        let active_ids: Vec<_> = engine
            .list()
            .iter()
            .filter(|d| d.state.is_active())
            .map(|d| d.id.clone())
            .collect();
        assert_eq!(active_ids.len(), 2);

        engine.mark_completed_for_test(&active_ids[0]);
        qm.tick().await;

        let active_after_first = engine.list().iter().filter(|d| d.state.is_active()).count();
        assert_eq!(
            active_after_first, 2,
            "As 1 download completes, the next queued item starts, maintaining exactly 2 active"
        );

        // Complete the remaining downloads one by one
        while let Some(active_id) = engine
            .list()
            .iter()
            .find(|d| d.state.is_active())
            .map(|d| d.id.clone())
        {
            engine.mark_completed_for_test(&active_id);
            qm.tick().await;
        }

        // STEP 5: Verify all 5 downloads completed
        let list_final = engine.list();
        assert_eq!(list_final.len(), 5);
        for d in &list_final {
            assert_eq!(d.state, DownloadState::Completed, "Download {} must be completed", d.file_name);
        }

        // STEP 6: Verify "sleep after done" was triggered
        let actions = recorded_actions.lock().unwrap().clone();
        assert_eq!(actions.len(), 1, "Action must be triggered exactly once upon queue completion");
        assert_eq!(actions[0], "sleep", "Action after completion must be 'sleep'");
    }
}
