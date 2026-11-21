//! Hard-kill ("power cut") test across real processes.
//!
//!   killtest run    <work-dir> <url>   download, persisting records to <work-dir>/record.json
//!   killtest resume <work-dir>         fresh process: restore ONLY that record + the file on disk,
//!                                      resume, and print the final size and SHA-256
//!
//! A harness starts `run`, waits until it prints `PROGRESS` past the wanted percentage, kills the
//! process with `taskkill /F` (no shutdown code runs), then starts `resume`. Unlike the in-process
//! crash test, nothing of the first process survives except what it had already written to disk.

#[path = "../tests/common/mod.rs"]
mod common;

use std::path::{Path, PathBuf};

use flowget_engine::model::DownloadRecord;
use flowget_engine::{AddRequest, DownloadState, Engine, EngineConfig, EngineEvent};

fn save_record(dir: &Path, rec: &DownloadRecord) {
    // Same idea as the app's database: the latest record replaces the previous one.
    let tmp = dir.join("record.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(rec).unwrap()).unwrap();
    std::fs::rename(&tmp, dir.join("record.json")).unwrap();
}

fn make_engine(work: &Path) -> Engine {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let w = work.to_path_buf();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                EngineEvent::Persist(r) => save_record(&w, &r),
                EngineEvent::Progress(p) => {
                    if let Some(total) = p.total {
                        println!("PROGRESS {} {}", p.downloaded, total);
                    }
                }
                EngineEvent::Flush(tx) => {
                    let _ = tx.send(());
                }
                _ => {}
            }
        }
    });
    Engine::new(EngineConfig::new(work.join("dl")), tx)
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("");
    let work = PathBuf::from(args.get(2).expect("work dir"));
    std::fs::create_dir_all(work.join("dl")).unwrap();

    match mode {
        "run" => {
            let url = args.get(3).expect("url").clone();
            let engine = make_engine(&work);
            let info = engine
                .add(AddRequest { url, connections: Some(8), ..Default::default() })
                .await
                .unwrap();
            println!("STARTED {}", info.id);
            std::future::pending::<()>().await;
        }
        "resume" => {
            let rec: DownloadRecord =
                serde_json::from_slice(&std::fs::read(work.join("record.json")).expect("record.json")).unwrap();
            println!("RESTORED downloaded={} of {:?} state={:?}", rec.downloaded, rec.total_size, rec.state);
            let id = rec.id.clone();
            let engine = make_engine(&work);
            engine.restore(vec![rec]);
            engine.resume(&id).await.unwrap();
            let info = loop {
                let i = engine.info(&id).unwrap();
                if i.state == DownloadState::Completed || i.state == DownloadState::Failed {
                    break i;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            };
            println!("FINAL state={:?} error={:?}", info.state, info.error.as_ref().map(|e| e.message.clone()));
            let path = PathBuf::from(&info.file_path);
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            println!("SIZE {size}");
            let p2 = path.clone();
            let sha = tokio::task::spawn_blocking(move || common::sha256_file(&p2)).await.unwrap();
            println!("SHA256 {sha}");
        }
        _ => {
            eprintln!("usage: killtest run <dir> <url> | killtest resume <dir>");
            std::process::exit(2);
        }
    }
}
