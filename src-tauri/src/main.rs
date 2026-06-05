mod commands;

use std::io::{self, BufRead};

fn main() {
    tracing_subscriber::fmt().init();
    tracing::info!("hyperclip backend started");

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    while let Some(Ok(line)) = lines.next() {
        let cmd: hyperclip_ipc::BackendCommand = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("{}", serde_json::to_string(&serde_json::json!({
                    "ok": false, "error": e.to_string()
                })).unwrap());
                continue;
            }
        };
        let resp = commands::handle_command(cmd);
        println!("{}", resp);
    }
}
