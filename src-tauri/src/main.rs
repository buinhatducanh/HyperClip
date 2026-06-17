mod commands;

use std::io::{self, BufRead, Write};
use std::net::TcpStream;
use std::sync::{Mutex, OnceLock};
use hyperclip_ipc::store::get_logs_dir;

static TCP_WRITER: OnceLock<Mutex<TcpStream>> = OnceLock::new();

pub(crate) fn emit(resp: hyperclip_ipc::IpcResponse) {
    let s = serde_json::to_string(&resp).unwrap();
    if let Some(writer_mutex) = TCP_WRITER.get() {
        let mut writer = writer_mutex.lock().unwrap();
        let _ = writeln!(writer, "{}", s);
        let _ = writer.flush();
    } else {
        let _ = writeln!(io::stdout(), "{}", s);
        let _ = io::stdout().flush();
    }
}

fn handle_ipc_line(line: &str) {
    let req: hyperclip_ipc::IpcRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            emit(hyperclip_ipc::IpcResponse::err(serde_json::Value::Null, e.to_string()));
            return;
        }
    };

    let id = serde_json::Value::from(req.id);
    match commands::handle_command(req) {
        commands::CommandResult::Ok(v) => emit(hyperclip_ipc::IpcResponse::ok(id, v)),
        commands::CommandResult::Err(e) => emit(hyperclip_ipc::IpcResponse::err(id, e)),
    }
}

fn cleanup_old_logs(logs_dir: &std::path::Path) {
    if !logs_dir.exists() {
        return;
    }
    
    let mut log_files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(logs_dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("hyperclip.log.") {
                        let modified = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                        let size = meta.len();
                        log_files.push((entry.path(), modified, size));
                    }
                }
            }
        }
    }

    log_files.sort_by_key(|x| x.1);

    let max_count = 20;
    let max_size: u64 = 100 * 1024 * 1024; // 100 MB

    let mut total_count = log_files.len();
    let mut total_size: u64 = log_files.iter().map(|x| x.2).sum();

    for (path, _, size) in log_files {
        if total_count > max_count || total_size > max_size {
            if std::fs::remove_file(&path).is_ok() {
                total_count = total_count.saturating_sub(1);
                total_size = total_size.saturating_sub(size);
            }
        } else {
            break;
        }
    }
}

fn setup_logging() -> tracing_appender::non_blocking::WorkerGuard {
    let logs_dir = get_logs_dir();
    std::fs::create_dir_all(&logs_dir).ok();

    cleanup_old_logs(&logs_dir);

    let now = chrono::Local::now();
    let filename = format!("hyperclip.log.{}", now.format("%Y-%m-%d_%H-%M-%S"));

    let file_appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::NEVER)
        .filename_prefix(filename)
        .build(&logs_dir)
        .expect("Failed to create file appender");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

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
    guard
}

fn main() {
    // IMPORTANT: _log_guard MUST live until main() exits, otherwise tracing output is lost
    let _log_guard = setup_logging();
    tracing::info!("hyperclip backend started");

    // Set global emit hook for hyperclip_ipc library
    hyperclip_ipc::set_emit_hook(|s| {
        if let Some(writer_mutex) = TCP_WRITER.get() {
            let mut writer = writer_mutex.lock().unwrap();
            let _ = writeln!(writer, "{}", s);
            let _ = writer.flush();
        } else {
            use std::io::Write;
            let _ = writeln!(std::io::stdout(), "{}", s);
            let _ = std::io::stdout().flush();
        }
    });

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

    // Parse port from command line arguments
    let mut port: Option<u16> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--port" {
            if let Some(val) = args.next() {
                if let Ok(p) = val.parse::<u16>() {
                    port = Some(p);
                }
            }
        } else if arg.starts_with("--port=") {
            if let Ok(p) = arg.trim_start_matches("--port=").parse::<u16>() {
                port = Some(p);
            }
        }
    }

    let is_tcp = port.is_some();

    if let Some(p) = port {
        tracing::info!("Connecting to TCP port: {}", p);
        let stream = match TcpStream::connect(format!("127.0.0.1:{}", p)) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Failed to connect to port {}: {}", p, e);
                panic!("Failed to connect to TCP port: {}", e);
            }
        };
        let write_stream = stream.try_clone().expect("Failed to clone TCP stream");
        if TCP_WRITER.set(Mutex::new(write_stream)).is_err() {
            tracing::error!("Failed to set TCP_WRITER OnceLock");
        }

        // Emit initial system:stats + channel:synced events
        let stats = commands::handle_command(hyperclip_ipc::IpcRequest {
            id: 0,
            command: "system:stats".into(),
            params: serde_json::json!({}),
        })
        .into_json();
        emit(hyperclip_ipc::IpcResponse::event("system:stats", stats));
        emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));

        let reader = io::BufReader::new(stream);
        let mut lines = reader.lines();
        while let Some(Ok(line)) = lines.next() {
            handle_ipc_line(&line);
        }
    } else {
        tracing::info!("No port specified, using stdin/stdout for IPC");

        // Emit initial system:stats + channel:synced events
        let stats = commands::handle_command(hyperclip_ipc::IpcRequest {
            id: 0,
            command: "system:stats".into(),
            params: serde_json::json!({}),
        })
        .into_json();
        emit(hyperclip_ipc::IpcResponse::event("system:stats", stats));
        emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));

        let stdin = io::stdin();
        let mut lines = stdin.lock().lines();
        while let Some(Ok(line)) = lines.next() {
            handle_ipc_line(&line);
        }
    }

    // EOF — keep alive if poller is active
    if is_tcp {
        tracing::info!("[main] TCP EOF — keeping alive for background tasks");
    } else {
        tracing::info!("[main] stdin EOF — keeping alive for background tasks");
    }
    loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        if !commands::is_poller_active() {
            break;
        }
    }
    tracing::info!("[main] poller inactive — shutting down");
}
