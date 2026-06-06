use hyperclip_ipc::{BackendCommand, get_system_stats};

pub fn handle_command(cmd: BackendCommand) -> String {
    match cmd {
        BackendCommand::WorkspaceList => {
            serde_json::to_string(&serde_json::json!({
                "ok": true, "result": { "workspaces": [] }
            })).unwrap()
        }
        BackendCommand::SystemStats => {
            let stats = get_system_stats();
            serde_json::to_string(&serde_json::json!({
                "ok": true,
                "result": {
                    "ram_used": stats.ram_used,
                    "ram_total": stats.ram_total,
                    "gpu_usage": stats.gpu_usage,
                    "gpu_temp": stats.gpu_temp,
                    "gpu_name": stats.gpu_name,
                    "gpu_tier": stats.gpu_tier,
                    "max_workers": stats.max_workers,
                    "active_workers": stats.active_workers,
                    "network_ip": stats.network_ip,
                    "is_online": stats.is_online,
                }
            })).unwrap()
        }
        _ => {
            serde_json::to_string(&serde_json::json!({
                "ok": true, "result": serde_json::Value::Null
            })).unwrap()
        }
    }
}
