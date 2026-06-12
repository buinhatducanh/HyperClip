mod commands;

use std::io::{self, BufRead, Write};
use hyperclip_ipc::store::get_logs_dir;

fn emit(resp: hyperclip_ipc::IpcResponse) {
    let s = serde_json::to_string(&resp).unwrap();
    let _ = writeln!(io::stdout(), "{}", s);
    let _ = io::stdout().flush();
}

fn setup_logging() {
    let logs_dir = get_logs_dir();
    std::fs::create_dir_all(&logs_dir).ok();

    // File appender (rotated daily, keep 14 days)
    let file_appender = tracing_appender::rolling::daily(&logs_dir, "hyperclip.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Filter: RUST_LOG env var, default "info"
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(non_blocking)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .with_ansi(false)
        .init();

    tracing::info!("Logging initialized — dir: {}", logs_dir.display());
}

fn main() {
    setup_logging();
    tracing::info!("hyperclip backend started");

    // Eagerly init POLLER_RT and AppState (triggers migration + cookies)
    commands::init_poller_runtime();
    commands::init_appstate();
    tracing::info!("[AppState] AppState initialized at startup");

    // Create a Tokio runtime for async operations (pool, innertube, etc.)
    let _rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");

    // Initialize WorkerPool from GPU config
    let gpu_config = hyperclip_ipc::system::get_gpu_config();
    tracing::info!(
        "[GPU] {} — max_workers={} tier={:?}",
        gpu_config.label, gpu_config.max_workers, gpu_config.tier
    );

    // Emit initial system:stats + channel:synced events
    let stats = commands::handle_command(hyperclip_ipc::IpcRequest {
        id: 0, command: "system:stats".into(), params: serde_json::json!({}),
    }).into_json();
    emit(hyperclip_ipc::IpcResponse::event("system:stats", stats));
    emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    while let Some(Ok(line)) = lines.next() {
        let req: hyperclip_ipc::IpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                emit(hyperclip_ipc::IpcResponse::err(serde_json::Value::Null, e.to_string()));
                continue;
            }
        };

        let id = serde_json::Value::from(req.id);
        match commands::handle_command(req) {
            commands::CommandResult::Ok(v) => emit(hyperclip_ipc::IpcResponse::ok(id, v)),
            commands::CommandResult::Err(e) => emit(hyperclip_ipc::IpcResponse::err(id, e)),
        }
    }

    // stdin EOF — keep alive if poller is active
    tracing::info!("[main] stdin EOF — keeping alive for background tasks");
    loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        if !commands::is_poller_active() {
            break;
        }
    }
    tracing::info!("[main] poller inactive — shutting down");
}
