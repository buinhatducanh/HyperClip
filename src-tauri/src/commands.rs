use hyperclip_ipc::{BackendCommand, get_system_stats, ChannelStore, WorkspaceStore, get_workspaces_path, get_channels_path};

pub use hyperclip_ipc::BackendCommand as PubBackendCommand;

pub enum CommandResult {
    Ok(serde_json::Value),
    Err(String),
}

impl CommandResult {
    pub fn into_json(self) -> serde_json::Value {
        match self {
            CommandResult::Ok(v) => v,
            CommandResult::Err(e) => serde_json::json!({ "error": e }),
        }
    }
}

pub fn handle_command(cmd: BackendCommand) -> CommandResult {
    match cmd {
        BackendCommand::SystemStats => {
            let stats = get_system_stats();
            CommandResult::Ok(serde_json::json!({
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
            }))
        }
        BackendCommand::WorkspaceList => {
            let store = WorkspaceStore::load(&get_workspaces_path());
            let workspaces: Vec<&hyperclip_ipc::Workspace> = store.workspaces.iter().collect();
            CommandResult::Ok(serde_json::json!({ "workspaces": workspaces }))
        }
        BackendCommand::ChannelList => {
            let store = ChannelStore::load(&get_channels_path());
            let channels: Vec<&hyperclip_ipc::Channel> = store.channels.iter().collect();
            CommandResult::Ok(serde_json::json!({ "channels": channels }))
        }
        BackendCommand::WorkspaceAdd { url } => {
            tracing::info!("workspace:add url={}", url);
            CommandResult::Ok(serde_json::json!({ "ok": true, "url": url }))
        }
        BackendCommand::WorkspaceUpdate { id } => {
            tracing::info!("workspace:update id={}", id);
            CommandResult::Ok(serde_json::json!({ "ok": true, "id": id }))
        }
        BackendCommand::WorkspaceDelete { id } => {
            tracing::info!("workspace:delete id={}", id);
            CommandResult::Ok(serde_json::json!({ "ok": true, "id": id }))
        }
        BackendCommand::WorkspaceRetry { id } => {
            tracing::info!("workspace:retry id={}", id);
            CommandResult::Ok(serde_json::json!({ "ok": true, "id": id }))
        }
        BackendCommand::RenderStart { id } => {
            tracing::info!("render:start id={}", id);
            CommandResult::Ok(serde_json::json!({ "ok": true, "id": id }))
        }
        BackendCommand::RenderCancel { id } => {
            tracing::info!("render:cancel id={}", id);
            CommandResult::Ok(serde_json::json!({ "ok": true, "id": id }))
        }
        BackendCommand::ChannelAdd { url } => {
            tracing::info!("channel:add url={}", url);
            CommandResult::Ok(serde_json::json!({ "ok": true, "url": url }))
        }
        BackendCommand::ChannelRemove { id } => {
            tracing::info!("channel:remove id={}", id);
            CommandResult::Ok(serde_json::json!({ "ok": true, "id": id }))
        }
    }
}
