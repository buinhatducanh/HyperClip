use hyperclip_ipc::BackendCommand;

pub fn handle_command(cmd: BackendCommand) -> String {
    match cmd {
        BackendCommand::WorkspaceList => {
            serde_json::to_string(&serde_json::json!({
                "ok": true, "result": { "workspaces": [] }
            })).unwrap()
        }
        BackendCommand::SystemStats => {
            let stats = serde_json::json!({
                "ram_used": 0, "ram_total": 0, "gpu_usage": 0,
                "gpu_temp": 0, "gpu_name": "Unknown", "gpu_tier": "software",
                "max_workers": 2, "active_workers": 0, "network_ip": "127.0.0.1",
                "is_online": true
            });
            serde_json::to_string(&serde_json::json!({
                "ok": true, "result": stats
            })).unwrap()
        }
        _ => {
            serde_json::to_string(&serde_json::json!({
                "ok": true, "result": serde_json::Value::Null
            })).unwrap()
        }
    }
}
