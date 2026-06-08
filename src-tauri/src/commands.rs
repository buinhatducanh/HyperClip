use hyperclip_ipc::{get_system_stats, ChannelStore, WorkspaceStore, get_workspaces_path, get_channels_path};

use hyperclip_ipc::cookies::{extract_chrome_cookies, get_chrome_user_data_dir};

use hyperclip_ipc::innertube_pool::{InnertubeClientPool, PoolConfig};

use hyperclip_ipc::poller::Poller;

use hyperclip_ipc::ffmpeg::{spawn_render_async, RenderOptions, FilterChain};

use hyperclip_ipc::youtube::{download_video, download_video_streaming, emit_download_progress};


use hyperclip_ipc::worker_pool::WorkerPool;

use hyperclip_ipc::system::get_gpu_config;

use hyperclip_ipc::Channel;

use serde_json::{json, Value};

use std::sync::Arc;

use std::sync::{Mutex, OnceLock};

use std::collections::HashMap;

use std::path::PathBuf;

use std::io::{self, Write};

use tokio::sync::RwLock;

use tokio_util::sync::CancellationToken;



struct AppState {

    poller: Arc<Poller>,

    poller_cancel: CancellationToken,

    _channels: Arc<RwLock<Vec<Channel>>>,

    pool: Arc<InnertubeClientPool>,

}



impl AppState {

    fn get_or_init() -> &'static AppState {

        static INSTANCE: OnceLock<AppState> = OnceLock::new();

        let _ = INSTANCE.get_or_init(|| {

            let pool_config = PoolConfig::default();

            let pool = Arc::new(InnertubeClientPool::initialize(pool_config).unwrap());

            let channels = Arc::new(RwLock::new(Vec::new()));

            let poller = Arc::new(Poller::new(

                pool.clone(),

                channels.clone(),

                5000,

            ));

            AppState {

                poller,

                poller_cancel: CancellationToken::new(),

                _channels: channels,

                pool,

            }

        });

        INSTANCE.get().unwrap()

    }



    fn start_poller(&self) {

        if self.poller_cancel.is_cancelled() {

            // Cannot reassign, so just start new if not cancelled (or handle differently)

        }

        let poller = self.poller.clone();

        let cancel = self.poller_cancel.clone();

        tokio::spawn(async move {

            poller.run(cancel).await;

        });

    }



    fn stop_poller(&self) {

        self.poller_cancel.cancel();

    }



    fn poller_active(&self) -> bool {

        !self.poller_cancel.is_cancelled()

    }



    fn pool_ready_count(&self) -> usize {

        self.pool.ready_count()

    }



    fn pool_suspended_count(&self) -> usize {

        self.pool.suspended_count()

    }



    fn channels_total(&self) -> usize {

        0 // TODO: implement from channels RwLock

    }

}



static CANCEL_TOKEN_MAP: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();

static WORKER_POOL: OnceLock<WorkerPool> = OnceLock::new();

static RENDER_RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();



#[allow(unused_imports)]
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



fn emit_workspace_event(id: &str, status: &str, error: Option<String>) {

    let mut payload = json!({

        "id": id,

        "status": status,

    });

    if let Some(e) = error {

        payload["error"] = json!(e);

    }

    let event = json!({

        "method": "workspace:update",

        "params": payload,

    });

    let s = serde_json::to_string(&event).unwrap();

    let _ = writeln!(io::stdout(), "{}", s);

    let _ = io::stdout().flush();

}



fn get_video_storage_path() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into()))
        .join("HyperClip/downloads")
}

#[allow(dead_code)]
fn get_output_path() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into()))
        .join("HyperClip/output")
}

fn get_cookies_path() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into()))
        .join("HyperClip/cookies.txt")
}

fn p(req: &Value, key: &str) -> Option<String> {

    req.get(key).and_then(|v| v.as_str()).map(String::from)

}

#[allow(dead_code)]
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

        "workspace:update" => {

            let field = p(params, "field").unwrap_or_default();

            let value = params.get("value").cloned().unwrap_or(Value::Null);



            let allowed: [&str; 5] = ["title", "speed", "trimStart", "trimEnd", "thumbnail"];

            if allowed.contains(&field.as_str()) {

                Ok(json!({"ok": true, "field": field, "value": value}))

            } else {

                Ok(json!({"ok": false, "error": format!("invalid field: {}", field)}))

            }

        }

        "workspace:delete" => { let id = p(params, "id").unwrap_or_default(); tracing::info!("workspace:delete {}", id); Ok(json!({ "success": true, "bytesFreed": 0, "filesDeleted": 0 })) }

        // Task 3: workspace:retry - calls yt-dlp download_video

        "workspace:retry" => {

            let id = p(params, "id").unwrap_or_default();

            let video_url = p(params, "url").or_else(|| p(params, "videoUrl")).unwrap_or_default();



            if id.is_empty() {

                return CommandResult::Ok(json!({ "ok": false, "error": "workspace:retry requires id param" }));

            }

            if video_url.is_empty() {

                return CommandResult::Ok(json!({ "ok": false, "error": "workspace:retry requires url or videoUrl param" }));

            }



            let cookies_path = get_cookies_path();

            let video_dir = get_video_storage_path();

            std::fs::create_dir_all(&video_dir).ok();



            let trim_minutes = params.get("trimMinutes")

                .and_then(|v| v.as_u64())

                .unwrap_or(10) as u32;



            let output_path = video_dir.join(format!("{}.mp4", id));

            let output_str = output_path.to_string_lossy().to_string();



            emit_workspace_event(&id, "downloading", None);



            let tid = id.clone();

            let url = video_url.clone();

            let cookies_str = cookies_path.to_string_lossy().to_string();

            let out_str = output_str.clone();

            std::thread::spawn(move || {

                match download_video(&url, &out_str, &cookies_str, trim_minutes) {

                    Ok(result) => {

                        tracing::info!("workspace:retry download complete: {} -> {} ({} bytes)",

                            tid, result.path, result.file_size);

                        emit_workspace_event(&tid, "ready", None);

                    }

                    Err(e) => {

                        tracing::error!("workspace::retry download failed for {}: {}", tid, e);

                        emit_workspace_event(&tid, "error", Some(e));

                    }

                }

            });



            Ok(json!({

                "ok": true,

                "id": id,

                "status": "downloading",

                "outputPath": output_str,

            }))

        }

        // Task 3 (WS3): workspace:autoDownload - triggered by poller on new video detection
        "workspace:autoDownload" => {
            let id = p(params, "id").unwrap_or_default();
            let video_url = p(params, "url").or_else(|| p(params, "videoUrl")).unwrap_or_default();
            let cookies_path = get_cookies_path();
            let video_dir = get_video_storage_path();
            std::fs::create_dir_all(&video_dir).ok();
            let trim_minutes = params.get("trimMinutes").and_then(|v| v.as_u64()).unwrap_or(10) as u32;
            let output_path = video_dir.join(format!("{}.mp4", id));
            let output_str = output_path.to_string_lossy().to_string();
            emit_workspace_event(&id, "downloading", None);
            let tid = id.clone();
            let url = video_url.clone();
            let cookies_str = cookies_path.to_string_lossy().to_string();
            let out_str = output_str.clone();
            std::thread::spawn(move || {
                download_video_streaming(&url, &out_str, &cookies_str, trim_minutes, |progress| {
                    emit_download_progress(&tid, &progress);
                })
                .map(|result| {
                    tracing::info!("workspace:autoDownload complete: {} -> {} ({} bytes)",
                        tid, result.path, result.file_size);
                    let event = json!({
                        "method": "workspace:update",
                        "params": {
                            "id": tid,
                            "status": "ready",
                            "downloadedPath": result.path,
                            "downloadedSize": result.file_size,
                            "width": result.width,
                            "height": result.height,
                            "codec": result.codec,
                            "fps": result.fps,
                            "duration": result.duration,
                        }
                    });
                    let s = serde_json::to_string(&event).unwrap();
                    let _ = writeln!(io::stdout(), "{}", s);
                    let _ = io::stdout().flush();

                    // Auto-render after successful download
                    let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
                    let rid = tid.clone();
                    let in_path = out_str.clone();
                    let out_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into())).join("HyperClip/output");
                    rt.spawn(async move {
                        let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                        let _permit = pool.acquire().await;
                        std::fs::create_dir_all(&out_dir).ok();
                        let opts = RenderOptions {
                            workspace_id: rid.clone(),
                            input_path: PathBuf::from(&in_path),
                            output_path: out_dir.join(format!("{}.mp4", rid)),
                            resolution: "1080p".into(),
                            fps: 30, speed: 1.0,
                            trim_start: 0.0, trim_end: 60.0,
                            gpu_tier: get_gpu_config().tier,
                            preset: "p1".into(),
                            filter_chain: FilterChain::Short,
                            chunked: false, chunk_duration_sec: 120,
                        };
                        let pid = rid.clone();
                        let result = spawn_render_async(opts, move |progress| {
                            let e = json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                            let _ = writeln!(io::stdout(), "{}", serde_json::to_string(&e).unwrap());
                            let _ = io::stdout().flush();
                        }).await;
                        emit_workspace_event(&rid, if result.is_ok() { "done" } else { "error" },
                            result.as_ref().err().map(|e| e.to_string()));
                    });
                })
                .unwrap_or_else(|e| {
                    tracing::error!("workspace:autoDownload failed for {}: {}", tid, e);
                    emit_workspace_event(&tid, "error", Some(e));
                });
            });
            Ok(json!({"ok": true, "id": id, "status": "downloading", "outputPath": output_str}))
        }
        // WS3: workspace:redownloadHd - re-download with higher quality
        "workspace:redownloadHd" => {
            let id = p(params, "id").unwrap_or_default();
            let video_url = p(params, "url").or_else(|| p(params, "videoUrl")).unwrap_or_default();
            if id.is_empty() || video_url.is_empty() {
                return CommandResult::Ok(json!({ "ok": false, "error": "requires id and url params" }));
            }
            let cookies_path = get_cookies_path();
            let video_dir = get_video_storage_path();
            std::fs::create_dir_all(&video_dir).ok();
            let output_path = video_dir.join(format!("{}.mp4", id));
            let output_str = output_path.to_string_lossy().to_string();
            emit_workspace_event(&id, "downloading", None);
            let tid = id.clone();
            let url = video_url.clone();
            let cookies_str = cookies_path.to_string_lossy().to_string();
            let out_str = output_str.clone();
            std::thread::spawn(move || {
                download_video_streaming(&url, &out_str, &cookies_str, 10, |progress| {
                    emit_download_progress(&tid, &progress);
                })
                .map(|result| {
                    emit_workspace_event(&tid, "ready", None);
                    tracing::info!("redownloadHd complete: {} ({}x{}, {} bytes)",
                        tid, result.width, result.height, result.file_size);
                    // Auto-render after redownload
                    let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
                    let rid = tid.clone();
                    let in_path = out_str.clone();
                    let out_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into())).join("HyperClip/output");
                    rt.spawn(async move {
                        let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                        let _permit = pool.acquire().await;
                        std::fs::create_dir_all(&out_dir).ok();
                        let opts = RenderOptions {
                            workspace_id: rid.clone(),
                            input_path: PathBuf::from(&in_path),
                            output_path: out_dir.join(format!("{}.mp4", rid)),
                            resolution: "1080p".into(),
                            fps: 30, speed: 1.0,
                            trim_start: 0.0, trim_end: 60.0,
                            gpu_tier: get_gpu_config().tier,
                            preset: "p1".into(),
                            filter_chain: FilterChain::Short,
                            chunked: false, chunk_duration_sec: 120,
                        };
                        let pid = rid.clone();
                        let result = spawn_render_async(opts, move |progress| {
                            let e = json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                            let _ = writeln!(io::stdout(), "{}", serde_json::to_string(&e).unwrap());
                            let _ = io::stdout().flush();
                        }).await;
                        emit_workspace_event(&rid, if result.is_ok() { "done" } else { "error" },
                            result.as_ref().err().map(|e| e.to_string()));
                    });
                })
                .unwrap_or_else(|e| {
                    emit_workspace_event(&tid, "error", Some(e));
                });
            });
            Ok(json!({ "success": true, "id": id, "status": "downloading" }))
        }

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

        "render:start" => {
            let id = p(params, "id").unwrap_or_default();
            if id.is_empty() {
                return CommandResult::Err("render:start requires id param".into());
            }
            let cancel_map = CANCEL_TOKEN_MAP.get_or_init(|| Mutex::new(HashMap::new()));
            let token = CancellationToken::new();
            {
                let mut map = cancel_map.lock().unwrap();
                map.insert(id.clone(), token.clone());
            }
            let tid = id.clone();
            let tid_for_progress = tid.clone();
            let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
            rt.spawn(async move {
                let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                let _permit = pool.acquire().await;
                let out_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into())).join("HyperClip/output");
                std::fs::create_dir_all(&out_dir).ok();
                let opts = RenderOptions {
                    workspace_id: tid_for_progress.clone(),
                    input_path: PathBuf::from("C:/input.mp4"),
                    output_path: out_dir.join(format!("{}.mp4", tid_for_progress)),
                    resolution: "1080p".into(),
                    fps: 30,
                    speed: 1.0,
                    trim_start: 0.0,
                    trim_end: 60.0,
                    gpu_tier: get_gpu_config().tier,
                    preset: "p1".into(),
                    filter_chain: FilterChain::Short,
                    chunked: false,
                    chunk_duration_sec: 120,
                };
                let tid_for_progress = tid.clone();
                let result = spawn_render_async(opts, move |progress| {
                    let event = json!({"method": "render:progress", "params": {"id": tid_for_progress, "progress": progress}});
                    let s = serde_json::to_string(&event).unwrap();
                    let _ = writeln!(io::stdout(), "{}", s);
                    let _ = io::stdout().flush();
                }).await;
                let status = if result.is_ok() { "done" } else { "error" };
                emit_workspace_event(&tid, status, result.as_ref().err().map(|e| e.to_string()));
                if let Some(map) = CANCEL_TOKEN_MAP.get() {
                    let mut map = map.lock().unwrap();
                    map.remove(&tid);
                }
            });
            Ok(json!({"ok": true, "id": id, "status": "rendering"}))
        }
        "render:cancel" => {

            let id = p(params, "id").unwrap_or_default();

            if let Some(map) = CANCEL_TOKEN_MAP.get() {

                let mut map = map.lock().unwrap();

                if let Some(_token) = map.remove(&id) {

                    Ok(json!({ "ok": true, "id": id, "status": "cancelled" }))

                } else {

                    Ok(json!({ "ok": false, "error": "not rendering" }))

                }

            } else {

                Ok(json!({ "ok": false, "error": "not rendering" }))

            }

        }

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

        "auth:extractCookies" => {

            let profile_name = p(params, "profile_name").unwrap_or_else(|| "Default".to_string());

            let profile_dir = get_chrome_user_data_dir().join(&profile_name);



            match extract_chrome_cookies(&profile_dir, &profile_name) {

                Ok(result) => Ok(json!({

                    "ok": true,

                    "data": {

                        "cookies": result.cookies,

                        "profile_name": result.profile_name,

                        "domain": result.domain,

                        "socs_value": result.socs_value,

                    }

                })),

                Err(e) => Ok(json!({

                    "ok": false,

                    "error_code": format!("{:?}", e).split('(').next().unwrap_or("Unknown"),

                    "error": e.to_string(),

                })),

            }

        }

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

        "poller:start" => {

            AppState::get_or_init().start_poller();

            Ok(json!({ "ok": true, "active": true }))

        }

        "poller:stop" => {

            AppState::get_or_init().stop_poller();

            Ok(json!({ "ok": true, "active": false }))

        }

        "poller:status" => {

            let state = AppState::get_or_init();

            Ok(json!({

                "active": state.poller_active(),

                "pollIntervalMs": 5000,

                "readySessions": state.pool_ready_count(),

                "suspendedSessions": state.pool_suspended_count(),

                "channelsTotal": state.channels_total()

            }))

        }

        "poller:resume" => {

            AppState::get_or_init().start_poller();

            Ok(json!({ "success": true }))

        }



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

    json!({ "workspaces": store.workspaces })

}



fn load_channels() -> Value {

    let store = ChannelStore::load(&get_channels_path());

    json!({ "channels": store.channels })

}

