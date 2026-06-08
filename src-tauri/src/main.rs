mod commands;

use std::io::{self, BufRead, Write};

fn emit(resp: hyperclip_ipc::IpcResponse) {
    let s = serde_json::to_string(&resp).unwrap();
    let _ = writeln!(io::stdout(), "{}", s);
    let _ = io::stdout().flush();
}

fn main() {
    tracing_subscriber::fmt()
        .with_writer(io::stderr)
        .init();
    tracing::info!("hyperclip backend started");

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
}
