//! Local test server for manual testing and the acceptance test.
//!
//!   cargo run --release -p flowget-engine --example testserver -- --size-mb 1024 --rate-mb 16
//!
//! Options:
//!   --port N        port to listen on (default 8099)
//!   --size-mb N     size of the generated file in MiB (default 1024)
//!   --rate-mb N     speed limit PER CONNECTION in MiB/s, 0 = unlimited (default 16)
//!   --seed N        content seed (default 1)
//!   --no-ranges     do not support Range requests ("Resume not supported")
//!
//! The file is generated on the fly (no disk space used). The expected SHA-256 is printed so
//! you can compare it with `Get-FileHash <downloaded file> -Algorithm SHA256`.

#[path = "../tests/common/mod.rs"]
mod common;

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port: u16 = arg_value(&args, "--port").and_then(|v| v.parse().ok()).unwrap_or(8099);
    let size_mb: u64 = arg_value(&args, "--size-mb").and_then(|v| v.parse().ok()).unwrap_or(1024);
    let rate_mb: u64 = arg_value(&args, "--rate-mb").and_then(|v| v.parse().ok()).unwrap_or(16);
    let seed: u64 = arg_value(&args, "--seed").and_then(|v| v.parse().ok()).unwrap_or(1);
    let ranges = !args.iter().any(|a| a == "--no-ranges");

    let cfg = common::ServerConfig {
        size: size_mb * 1024 * 1024,
        seed,
        ranges,
        rate_per_conn: rate_mb * 1024 * 1024,
        file_name: Some(format!("test-{size_mb}mb.bin")),
        ..Default::default()
    };
    let size = cfg.size;
    let server = common::spawn(cfg, &format!("127.0.0.1:{port}")).await;

    println!("Test server listening.");
    println!("  URL:      http://{}/file.bin", server.addr);
    println!("  Size:     {size_mb} MiB ({size} bytes)");
    println!("  Ranges:   {}", if ranges { "supported" } else { "NOT supported" });
    println!("  Speed:    {}", if rate_mb == 0 { "unlimited".to_string() } else { format!("{rate_mb} MiB/s per connection") });
    println!("Computing expected SHA-256 ...");
    let sha = tokio::task::spawn_blocking(move || common::sha256_hex_of_generated(seed, size)).await.unwrap();
    println!("  SHA-256:  {sha}");
    println!("Ready. Press Ctrl+C to stop.");

    std::future::pending::<()>().await;
}
