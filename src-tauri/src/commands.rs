use hyperclip_ipc::{get_system_stats, ChannelStore, WorkspaceStore, get_workspaces_path, get_channels_path};
use serde_json::{json, Value};

pub use hyperclip_ipc::IpcRequest as PubBackendCommand;

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

fn p(req: &Value, key: &str) -> Option<String> {
    req.get(key).and_then(|v| v.as_str()).map(String::from)
}
fn p_u64(req: &Value, key: &str) -> Option<u64> {
    req.get(key).and_then(|v| v.as_u64())
}

pub fn handle_command(req: hyperclip_ipc::IpcRequest) -> CommandResult {
    let cmd = req.command.as_str();
    let params = &req.params;

    // Match by command name. Returns CommandResult for direct calls,
    // or can be used to dispatch to background tasks / event emitters.
    let result: Result<Value, String> = match cmd {
        // ─── System ─────────────────────────────────────────────────
        "system:stats" => Ok(json!(get_system_stats())),
        "system:openFolder" => { let path = p(params, "path").unwrap_or_default(); tracing::info!("openFolder: {}", path); Ok(json!({ "ok": true })) }
        "system:openUrl" => { let url = p(params, "url").unwrap_or_default(); tracing::info!("openUrl: {}", url); Ok(json!({ "ok": true })) }
        "system:pickFolder" => Ok(json!({ "path": p(params, "currentPath").unwrap_or_default() })),
        "system:runDiagnostics" => Ok(json!({ "ok": true, "ts": chrono::Utc::now().timestamp() })),

        // ─── Settings ────────────────────────────────────────────────
        "settings:get" => Ok(json!({})),
        "settings:update" => { tracing::info!("settings:update"); Ok(json!({ "ok": true })) }

        // ─── Channels ───────────────────────────────────────────────
        "channel:list" => Ok(load_channels()),
        "channel:add" => { let url = p(params, "url").unwrap_or_default(); tracing::info!("channel:add {}", url); Ok(json!({ "ok": true, "url": url })) }
        "channel:update" => { let id = p(params, "id").unwrap_or_default(); tracing::info!("channel:update {}", id); Ok(json!({ "ok": true })) }
        "channel:remove" => { let id = p(params, "id").unwrap_or_default(); tracing::info!("channel:remove {}", id); Ok(json!({ "ok": true, "id": id })) }
        "channel:pause" => { let id = p(params, "id").unwrap_or_default(); tracing::info!("channel:pause {}", id); Ok(json!({ "ok": true })) }
        "channel:resume" => { let id = p(params, "id").unwrap_or_default(); tracing::info!("channel:resume {}", id); Ok(json!({ "ok": true })) }
        "channel:bulkPause" => { let ids = params.get("ids").cloned().unwrap_or(json!([])); tracing::info!("bulkPause"); Ok(json!({ "ok": true, "count": 0, "ids": ids })) }
        "channel:bulkResume" => Ok(json!({ "ok": true, "count": 0 })),
        "channel:bulkRemove" => Ok(json!({ "ok": true, "count": 0 })),
        "channel:sync" => Ok(json!({ "added": 0, "removed": 0 })),
        "channel:autoAssign" => Ok(json!({ "success": true, "assigned": 0 })),
        "channel:getInfo" => Ok(json!({ "channelId": p(params, "url").unwrap_or_default(), "name": "Unknown" })),

        // ─── Workspaces ─────────────────────────────────────────────
        "workspace:list" => Ok(load_workspaces()),
        "workspace:add" => { let url = p(params, "url").unwrap_or_default(); tracing::info!("workspace:add {}", url); Ok(json!({ "ok": true, "id": format!("ws-{}", chrono::Utc::now().timestamp_millis()) })) }
        "workspace:update" => Ok(json!({ "ok": true })),
        "workspace:delete" => { let id = p(params, "id").unwrap_or_default(); tracing::info!("workspace:delete {}", id); Ok(json!({ "success": true, "bytesFreed": 0, "filesDeleted": 0 })) }
        "workspace:retry" => Ok(json!({ "ok": true })),
        "workspace:redownloadHd" => Ok(json!({ "success": true })),
        "workspace:regenerateBlur" => Ok(json!({ "success": true })),
        "workspace:split" => Ok(json!({ "success": true, "newWorkspaces": [] })),
        "workspace:splitPreview" => Ok(json!({ "parts": [], "numParts": 1, "totalSec": 0 })),
        "workspace:setActive" => Ok(json!({ "success": true })),

        // ─── Video file access ──────────────────────────────────────
        "video:getFile" => Ok(json!({ "path": "", "url": "" })),
        "video:getBlob" => Ok(Value::Null),
        "image:getFile" => Ok(json!({ "path": "", "dataUrl": "" })),
        "video:saveBlob" => Ok(json!({ "diskPath": "" })),
        "video:getAvailableFormats" => Ok(json!({ "videoId": p(params, "videoId").unwrap_or_default(), "heights": [360, 720, 1080] })),

        // ─── Render ─────────────────────────────────────────────────
        "render:start" => Ok(json!({ "ok": true })),
        "render:cancel" => Ok(json!({ "ok": true })),
        "render:chunked" => Ok(json!({ "ok": true })),
        "render:split" => Ok(json!({ "ok": true })),
        "render:splitPreview" => Ok(json!({ "parts": [] })),

        // ─── Rendered videos ────────────────────────────────────────
        "rendered:list" => Ok(json!([])),
        "rendered:archive" => Ok(json!({ "success": true })),
        "rendered:remove" => Ok(json!({ "success": true, "bytesFreed": 0 })),
        "rendered:openFolder" => Ok(json!({ "success": true })),
        "rendered:setArchivePath" => Ok(json!({ "success": true })),

        // ─── Storage ────────────────────────────────────────────────
        "storage:getSize" => Ok(json!({ "downloads": 0, "blur": 0, "total": 0, "downloadPath": "", "outputPath": "" })),
        "storage:clearDownloads" => Ok(json!({ "success": true, "freedMB": 0 })),
        "storage:clearBlur" => Ok(json!({ "success": true, "freedMB": 0 })),
        "storage:export" => Ok(json!({ "success": true })),
        "storage:import" => Ok(json!({ "success": true })),

        // ─── Auth ───────────────────────────────────────────────────
        "auth:status" => Ok(json!({ "isReady": false, "cookieCount": 0, "loggedOut": true, "accountName": "", "oauthReady": false })),
        "auth:logout" => Ok(json!({ "success": true })),
        "auth:startOAuth" => Ok(json!({ "isReady": false, "cookieCount": 0, "loggedOut": true, "accountName": "", "oauthReady": false })),
        "auth:startChromeLogin" => Ok(json!({ "success": false, "profileId": "" })),
        "auth:setCredentials" => Ok(json!({ "success": true })),
        "auth:getCredentials" => Ok(json!({ "clientId": "" })),

        // ─── API keys ───────────────────────────────────────────────
        "key:list" => Ok(json!([])),
        "key:add" => Ok(json!({ "success": true, "keys": [] })),
        "key:remove" => Ok(json!({ "success": true, "keys": [] })),
        "key:reset" => Ok(json!({ "success": true, "keys": [], "nextReset": 0 })),
        "key:test" => Ok(json!({ "valid": false })),
        "key:testAll" => Ok(json!({ "results": [], "keys": [] })),

        // ─── Chrome sessions ────────────────────────────────────────
        "session:status" => Ok(json!({ "ready": false, "sessionCount": 0, "loggedInCount": 0, "consentedCount": 0, "sessions": [] })),
        "session:refreshAll" => Ok(json!({ "success": true, "refreshedCount": 0 })),
        "session:openLogin" => Ok(json!({ "success": true })),
        "session:cloneOne" => Ok(json!({ "success": true, "clonedCount": 0 })),
        "session:add" => Ok(json!({ "success": true, "profileId": "" })),

        // ─── OAuth projects ─────────────────────────────────────────
        "project:list" => Ok(json!([])),
        "project:tokenStatuses" => Ok(json!([])),
        "project:add" => Ok(json!({ "success": true, "projectId": "" })),
        "project:remove" => Ok(json!({ "success": true })),
        "project:resetQuota" => Ok(json!({ "success": true })),
        "project:reauthorize" => Ok(json!({ "success": true })),
        "project:repair" => Ok(json!({ "success": true })),
        "project:testAll" => Ok(json!({ "projects": [], "checkedAt": 0 })),
        "project:batchRepair" => Ok(json!({})),
        "project:testToken" => Ok(json!({ "valid": false })),

        // ─── Poller ─────────────────────────────────────────────────
        "poller:status" => Ok(json!({ "active": false, "pollIntervalMs": 5000, "lastPollAt": null, "newVideoCount": 0, "lastError": null, "exhaustedUntil": null })),
        "poller:resume" => Ok(json!({ "success": true })),

        // ─── Resource alerts ────────────────────────────────────────
        "resource:alert" => Ok(json!({ "level": "ok" })),

        // ─── Logs ───────────────────────────────────────────────────
        "logs:read" => Ok(json!({ "files": [], "entries": [] })),
        "logs:export" => Ok(json!({ "success": true })),
        "logs:diskUsage" => Ok(json!({ "totalBytes": 0, "fileCount": 0, "oldestAge": 0 })),
        "logs:cleanup" => Ok(json!({ "deletedCount": 0, "freedBytes": 0 })),

        // ─── Update ─────────────────────────────────────────────────
        "update:check" => Ok(json!({ "available": false, "version": "0.0.0", "releaseNotes": "", "downloadUrl": null, "downloadSize": 0, "publishedAt": "" })),
        "update:download" => Ok(json!({ "success": true })),
        "update:install" => Ok(json!({ "success": true })),
        "update:status" => Ok(json!({ "available": false, "version": "0.0.0", "releaseNotes": "", "downloadSize": 0, "progress": 0, "downloaded": false, "downloadedPath": null })),

        // ─── Hardware profile ───────────────────────────────────────
        "hardware:profile" => Ok(json!({
            "detected": { "vramGB": 6, "ramGB": 16, "gpuName": get_system_stats().gpu_name },
            "presets": [],
            "active": null,
        })),

        // ─── Unknown command ────────────────────────────────────────
        other => {
            tracing::warn!("unknown command: {}", other);
            Err(format!("unknown command: {}", other))
        }
    };

    match result {
        Ok(v) => CommandResult::Ok(v),
        Err(e) => CommandResult::Err(e),
    }
}

fn load_workspaces() -> Value {
    let store = WorkspaceStore::load(&get_workspaces_path());
    let workspaces: Vec<&hyperclip_ipc::Workspace> = store.workspaces.iter().collect();
    json!({ "workspaces": workspaces })
}

fn load_channels() -> Value {
    let store = ChannelStore::load(&get_channels_path());
    let channels: Vec<&hyperclip_ipc::Channel> = store.channels.iter().collect();
    json!({ "channels": channels })
}
