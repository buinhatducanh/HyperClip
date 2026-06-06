mod commands;

pub use commands::PubBackendCommand as BackendCommand;
use hyperclip_ipc::BackendCommand as HyperclipCommand;

use std::io::{self, BufRead, Write};

fn main() {
    // Init tracing with stderr writer (stdout reserved for JSON-RPC)
    tracing_subscriber::fmt()
        .with_writer(io::stderr)
        .init();
    tracing::info!("hyperclip backend started");

    // Emit initial system:stats as a server-initiated event
    let _ = writeln!(
        io::stdout(),
        "{}",
        serde_json::to_string(&serde_json::json!({
            "method": "system:stats",
            "params": commands::handle_command(commands::PubBackendCommand::SystemStats)
                .into_json()
        })).unwrap()
    );
    let _ = io::stdout().flush();

    // Emit channel:synced on startup so renderer knows it can fetch
    let _ = writeln!(
        io::stdout(),
        "{}",
        serde_json::to_string(&serde_json::json!({
            "method": "channel:synced"
        })).unwrap()
    );
    let _ = io::stdout().flush();

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    while let Some(Ok(line)) = lines.next() {
        // Parse envelope — extract id separately, then cmd
        let envelope: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let _ = writeln!(
                    io::stdout(),
                    "{}",
                    serde_json::to_string(&serde_json::json!({
                        "ok": false, "error": e.to_string()
                    })).unwrap()
                );
                let _ = io::stdout().flush();
                continue;
            }
        };

        let id = envelope.get("id").cloned().unwrap_or(serde_json::Value::Null);
        let cmd_value = envelope.get("cmd").cloned().unwrap_or(serde_json::Value::Null);

        let cmd: hyperclip_ipc::BackendCommand = match serde_json::from_value(cmd_value) {
            Ok(c) => c,
            Err(e) => {
                let _ = writeln!(
                    io::stdout(),
                    "{}",
                    serde_json::to_string(&serde_json::json!({
                        "id": id, "ok": false, "error": e.to_string()
                    })).unwrap()
                );
                let _ = io::stdout().flush();
                continue;
            }
        };

        let result = commands::handle_command(cmd);
        let response = match result {
            commands::CommandResult::Ok(v) => serde_json::json!({
                "id": id, "ok": true, "result": v
            }),
            commands::CommandResult::Err(e) => serde_json::json!({
                "id": id, "ok": false, "error": e
            }),
        };
        let _ = writeln!(io::stdout(), "{}", serde_json::to_string(&response).unwrap());
        let _ = io::stdout().flush();
    }
}
