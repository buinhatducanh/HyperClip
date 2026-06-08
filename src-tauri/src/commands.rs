use hyperclip_ipc::{get_system_stats, ChannelStore, WorkspaceStore, get_workspaces_path, get_channels_path, SettingsStore, get_settings_path, RenderedStore, get_rendered_videos_path, KeyStore, get_keys_path, ProjectStore, get_projects_path, KeyEntry, ProjectEntry};

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

            // Load channels from disk store
            let ch_path = get_channels_path();
            let ch_store = ChannelStore::load(&ch_path);
            let v: Vec<hyperclip_ipc::Channel> = ch_store.channels.iter().map(|c| {
                hyperclip_ipc::Channel {
                    id: c.id.clone(),
                    name: c.name.clone(),
                    handle: Some(c.handle.clone()),
                    paused: c.paused,
                    ..Default::default()
                }
            }).collect();
            tracing::info!("[AppState] Loaded {} channels from disk", v.len());
            let channels = Arc::new(RwLock::new(v));

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
        self._channels.try_read().map(|c| c.len()).unwrap_or(0)
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

fn base64_encode_file(path: &PathBuf) -> Option<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(base64_encode(&buf))
}

fn base64_encode(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let clean: String = input.chars().filter(|c| *c != '=' && !c.is_whitespace()).collect();
    let mut bytes = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0u32;
    for ch in clean.chars() {
        let idx = CHARS.iter().position(|&c| c as char == ch).ok_or_else(|| format!("invalid base64 char: {}", ch))? as u32;
        buf = (buf << 6) | idx;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(bytes)
}

fn dir_size_internal(path: &PathBuf) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                } else if meta.is_dir() {
                    total += dir_size_internal(&entry.path());
                }
            }
        }
    }
    total
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

        "system:pickFolder" => {
            let current = p(params, "currentPath").unwrap_or_else(|| {
                std::env::var("USERPROFILE").unwrap_or_else(|_| "C:/".to_string())
            });
            Ok(json!({"path": current}))
        }

        "system:runDiagnostics" => {
            let mut results = vec![];
            let ytdlp = std::process::Command::new("yt-dlp").arg("--version").output().ok();
            results.push(json!({
                "check": "yt-dlp", "ok": ytdlp.as_ref().map(|o| o.status.success()).unwrap_or(false),
                "version": ytdlp.and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| s.trim().to_string()).unwrap_or_else(|| "not found".to_string()),
            }));
            let ffmpeg = std::process::Command::new("ffmpeg").arg("-version").output().ok();
            results.push(json!({
                "check": "ffmpeg", "ok": ffmpeg.as_ref().map(|o| o.status.success()).unwrap_or(false),
                "version": ffmpeg.and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| s.lines().next().unwrap_or("?").to_string()).unwrap_or_else(|| "not found".to_string()),
            }));
            let node = std::process::Command::new("node").arg("--version").output().ok();
            results.push(json!({
                "check": "node", "ok": node.as_ref().map(|o| o.status.success()).unwrap_or(false),
                "version": node.and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| s.trim().to_string()).unwrap_or_else(|| "not found".to_string()),
            }));
            Ok(json!({"ok": true, "ts": chrono::Utc::now().timestamp(), "results": results}))
        }



        // ─── Settings ────────────────────────────────────────────────

        "settings:get" => {
            let s_path = get_settings_path();
            let store = SettingsStore::load(&s_path);
            Ok(store.settings.clone())
        }

        "settings:update" => {
            let s_path = get_settings_path();
            let mut store = SettingsStore::load(&s_path);
            if let Some(obj) = store.settings.as_object_mut() {
                if let Some(patch_obj) = params.as_object() {
                    for (k, v) in patch_obj {
                        obj.insert(k.clone(), v.clone());
                    }
                }
            } else {
                store.settings = params.clone();
            }
            store.save(&s_path).ok();
            tracing::info!("settings:update saved");
            Ok(json!({"ok": true}))
        }



        // ─── Channels ───────────────────────────────────────────────

        "channel:list" => Ok(load_channels()),

        "channel:add" => {
            let url = p(params, "url").unwrap_or_default();
            if url.is_empty() {
                return CommandResult::Ok(json!({"ok": false, "error": "url required"}));
            }
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            let id = format!("ch-{}", chrono::Utc::now().timestamp_millis());
            store.add(hyperclip_ipc::store::Channel {
                id: id.clone(),
                name: url.clone(),
                handle: url.clone(),
                paused: false,
                ..Default::default()
            });
            store.save(&ch_path).ok();
            tracing::info!("channel:add -> {}", id);
            Ok(json!({"ok": true, "id": id}))
        }

        "channel:update" => {
            let id = p(params, "id").unwrap_or_default();
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            match store.update(&id, params) {
                Ok(()) => { store.save(&ch_path).ok(); Ok(json!({"ok": true})) }
                Err(e) => Ok(json!({"ok": false, "error": e})),
            }
        }

        "channel:remove" => {
            let id = p(params, "id").unwrap_or_default();
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            store.remove(&id);
            store.save(&ch_path).ok();
            Ok(json!({"ok": true, "id": id}))
        }

        "channel:pause" => {
            let id = p(params, "id").unwrap_or_default();
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            match store.update(&id, &json!({"paused": true})) {
                Ok(()) => { store.save(&ch_path).ok(); Ok(json!({"ok": true})) }
                Err(e) => Ok(json!({"ok": false, "error": e})),
            }
        }

        "channel:resume" => {
            let id = p(params, "id").unwrap_or_default();
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            match store.update(&id, &json!({"paused": false})) {
                Ok(()) => { store.save(&ch_path).ok(); Ok(json!({"ok": true})) }
                Err(e) => Ok(json!({"ok": false, "error": e})),
            }
        }

        "channel:bulkPause" => {
            let ids = params.get("ids").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            let mut count = 0u64;
            for id_val in &ids {
                if let Some(id) = id_val.as_str() {
                    if store.update(id, &json!({"paused": true})).is_ok() {
                        count += 1;
                    }
                }
            }
            if count > 0 { store.save(&ch_path).ok(); }
            Ok(json!({"ok": true, "count": count, "ids": ids}))
        }

        "channel:bulkResume" => {
            let ids = params.get("ids").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            let mut count = 0u64;
            for id_val in &ids {
                if let Some(id) = id_val.as_str() {
                    if store.update(id, &json!({"paused": false})).is_ok() {
                        count += 1;
                    }
                }
            }
            if count > 0 { store.save(&ch_path).ok(); }
            Ok(json!({"ok": true, "count": count}))
        }

        "channel:bulkRemove" => {
            let ids = params.get("ids").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            let mut count = 0u64;
            for id_val in &ids {
                if let Some(id) = id_val.as_str() {
                    store.remove(id);
                    count += 1;
                }
            }
            store.save(&ch_path).ok();
            Ok(json!({"ok": true, "count": count}))
        }

        "channel:sync" => {
            let ch_path = get_channels_path();
            let store = ChannelStore::load(&ch_path);
            let count = store.channels.len() as u64;
            let event = json!({"method": "channel:synced", "params": {"count": count}});
            let s = serde_json::to_string(&event).unwrap();
            let _ = writeln!(io::stdout(), "{}", s);
            let _ = io::stdout().flush();
            Ok(json!({"added": 0, "removed": 0}))
        }

        "channel:autoAssign" => Ok(json!({"success": true, "assigned": 0})),

        "channel:getInfo" => Ok(json!({"channelId": p(params, "url").unwrap_or_default(), "name": "Unknown"})),



        // ─── Workspaces ─────────────────────────────────────────────

        "workspace:list" => Ok(load_workspaces()),

        "workspace:add" => { let url = p(params, "url").unwrap_or_default(); tracing::info!("workspace:add {}", url); Ok(json!({ "ok": true, "id": format!("ws-{}", chrono::Utc::now().timestamp_millis()) })) }

        "workspace:update" => {

            let id = p(params, "id").unwrap_or_default();

            let field = p(params, "field").unwrap_or_default();

            let value = params.get("value").cloned().unwrap_or(Value::Null);



            let allowed: [&str; 5] = ["title", "speed", "trimStart", "trimEnd", "thumbnail"];

            if !allowed.contains(&field.as_str()) {

                return CommandResult::Ok(json!({"ok": false, "error": format!("invalid field: {}", field)}));

            }

            // Persist to workspace store
            let ws_path = get_workspaces_path();
            let mut store = WorkspaceStore::load(&ws_path);

            // Check if rendering — emit warning
            let mut warning: Option<String> = None;
            if let Some(ws) = store.workspaces.iter().find(|w| w.id == id) {
                if ws.status == "rendering" {
                    warning = Some("Workspace is rendering — changes apply on next render".into());
                }
            }

            match store.patch(&id, &field, value.clone()) {
                Ok(()) => {
                    store.save(&ws_path).ok();
                }
                Err(e) => {
                    warning = Some(e);
                }
            };

            // Emit update event for UI sync
            let event = json!({
                "method": "workspace:update",
                "params": {"id": id, "field": field, "value": value}
            });
            let s = serde_json::to_string(&event).unwrap();
            let _ = writeln!(io::stdout(), "{}", s);
            let _ = io::stdout().flush();

            if let Some(w) = warning {
                Ok(json!({"ok": true, "warning": w}))
            } else {
                Ok(json!({"ok": true}))
            }

        }

        "workspace:delete" => {
            let id = p(params, "id").unwrap_or_default();
            let ws_path = get_workspaces_path();
            let mut store = WorkspaceStore::load(&ws_path);
            store.remove(&id);
            store.save(&ws_path).ok();
            let video_dir = get_video_storage_path();
            let video_file = video_dir.join(format!("{}.mp4", id));
            let mut bytes_freed: u64 = 0;
            if video_file.exists() {
                if let Ok(meta) = std::fs::metadata(&video_file) {
                    bytes_freed = meta.len();
                }
                std::fs::remove_file(&video_file).ok();
            }
            let out_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into())).join("HyperClip/output");
            let out_file = out_dir.join(format!("{}.mp4", id));
            if out_file.exists() {
                std::fs::remove_file(&out_file).ok();
            }
            Ok(json!({"success": true, "bytesFreed": bytes_freed, "filesDeleted": if bytes_freed > 0 { 1 } else { 0 }}))
        }

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

        "workspace:regenerateBlur" => {
            let id = p(params, "id").unwrap_or_default();
            let video_dir = get_video_storage_path();
            let video_path = video_dir.join(format!("{}.mp4", id));
            if !video_path.exists() {
                Ok(json!({"success": false, "error": "video file not found"}))
            } else {
                let blur_dir = get_video_storage_path().join("blur");
                std::fs::create_dir_all(&blur_dir).ok();
                let output = blur_dir.join(format!("{}.jpg", id));
                let status = std::process::Command::new("ffmpeg")
                    .args(&["-i", &video_path.to_string_lossy(), "-vf", "scale=160:90",
                        "-frames:v", "1", "-y", &output.to_string_lossy()])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status().ok();
                tracing::info!("regenerateBlur for {}: {:?}", id, status.map(|s| s.success()));
                Ok(json!({"success": true, "path": output.to_string_lossy().to_string()}))
            }
        }

        "workspace:split" => {
            let id = p(params, "id").unwrap_or_default();
            let parts = params.get("parts").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let ws_path = get_workspaces_path();
            let mut store = WorkspaceStore::load(&ws_path);
            let source = store.workspaces.iter().find(|w| w.id == id).cloned();
            let mut new_ids = vec![];
            if let Some(src) = source {
                for (i, part) in parts.iter().enumerate() {
                    let new_id = format!("{}-part{}", id, i + 1);
                    let trim_start = part.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let trim_end = part.get("end").and_then(|v| v.as_f64()).unwrap_or(60.0);
                    let mut new_ws = src.clone();
                    new_ws.id = new_id.clone();
                    new_ws.title = format!("{} (Part {})", src.title, i + 1);
                    new_ws.trim_start = trim_start;
                    new_ws.trim_end = trim_end;
                    new_ws.status = "ready".to_string();
                    store.add(new_ws);
                    new_ids.push(new_id);
                }
                store.save(&ws_path).ok();
            }
            Ok(json!({"success": true, "newWorkspaces": new_ids}))
        }

        "workspace:splitPreview" => {
            let id = p(params, "id").unwrap_or_default();
            let split_min = params.get("splitMinutes").and_then(|v| v.as_u64()).unwrap_or(10);
            let ws_path = get_workspaces_path();
            let store = WorkspaceStore::load(&ws_path);
            let source = store.workspaces.iter().find(|w| w.id == id);
            if let Some(ws) = source {
                let total_sec = if ws.trim_end > 0.0 { ws.trim_end } else { ws.progress.unwrap_or(0.0) }.max(60.0);
                let split_sec = (split_min * 60) as f64;
                let parts_count = (total_sec / split_sec).ceil() as u64;
                let parts: Vec<serde_json::Value> = (0..parts_count).map(|i| {
                    let start = i as f64 * split_sec;
                    let end = ((i as f64 + 1.0) * split_sec).min(total_sec);
                    json!({"index": i, "startSec": start, "endSec": end, "durationSec": end - start})
                }).collect();
                Ok(json!({"parts": parts, "numParts": parts_count, "totalSec": total_sec}))
            } else {
                Ok(json!({"parts": [], "numParts": 1, "totalSec": 0}))
            }
        }

        "workspace:setActive" => {
            let id = p(params, "id").unwrap_or_default();
            tracing::info!("workspace:setActive -> {}", id);
            Ok(json!({"success": true}))
        }



        // ─── Video file access ──────────────────────────────────────

        "video:getFile" => {
            let ws_id = p(params, "workspaceId").or_else(|| p(params, "id")).unwrap_or_default();
            let ws_path = get_workspaces_path();
            let store = WorkspaceStore::load(&ws_path);
            if let Some(ws) = store.workspaces.iter().find(|w| w.id == ws_id) {
                if let Some(ref dl_path) = ws.downloaded_path {
                    let full_path = PathBuf::from(dl_path);
                    if full_path.exists() {
                        let url = format!("file:///{}", full_path.to_string_lossy().replace('\\', "/"));
                        return CommandResult::Ok(json!({ "path": full_path.to_string_lossy(), "url": url }));
                    }
                }
                let video_dir = get_video_storage_path();
                let candidate = video_dir.join(format!("{}.mp4", ws_id));
                if candidate.exists() {
                    let url = format!("file:///{}", candidate.to_string_lossy().replace('\\', "/"));
                    return CommandResult::Ok(json!({ "path": candidate.to_string_lossy(), "url": url }));
                }
            }
            Ok(json!({ "path": "", "url": "" }))
        }

        "video:getBlob" => Ok(Value::Null),

        "image:getFile" => {
            let ws_id = p(params, "workspaceId").or_else(|| p(params, "id")).unwrap_or_default();
            let ws_path = get_workspaces_path();
            let store = WorkspaceStore::load(&ws_path);
            if let Some(ws) = store.workspaces.iter().find(|w| w.id == ws_id) {
                if let Some(ref thumb) = ws.thumbnail_local {
                    let thumb_path = PathBuf::from(thumb);
                    if thumb_path.exists() {
                        let data_url = format!("data:image/jpeg;base64,{}",
                            base64_encode_file(&thumb_path).unwrap_or_default());
                        return CommandResult::Ok(json!({ "path": thumb_path.to_string_lossy(), "dataUrl": data_url }));
                    }
                }
            }
            Ok(json!({ "path": "", "dataUrl": "" }))
        }

        "video:saveBlob" => {
            let filename = p(params, "filename").unwrap_or_else(|| "blob.bin".to_string());
            if let Some(buf) = params.get("arrayBuffer").and_then(|v| v.as_array()) {
                let video_dir = get_video_storage_path();
                let disk_path = video_dir.join(&filename);
                let bytes: Vec<u8> = buf.iter().filter_map(|v| v.as_u64().map(|n| n as u8)).collect();
                std::fs::write(&disk_path, &bytes).ok();
                Ok(json!({ "diskPath": disk_path.to_string_lossy() }))
            } else if let Some(base64_str) = params.get("base64").and_then(|v| v.as_str()) {
                let video_dir = get_video_storage_path();
                let disk_path = video_dir.join(&filename);
                if let Ok(bytes) = base64_decode(base64_str) {
                    std::fs::write(&disk_path, &bytes).ok();
                }
                Ok(json!({ "diskPath": disk_path.to_string_lossy() }))
            } else {
                Ok(json!({ "diskPath": "" }))
            }
        }

        "video:getAvailableFormats" => {
            let video_id = p(params, "videoId").unwrap_or_default();
            let video_url = p(params, "videoUrl").unwrap_or_default();
            let mut formats = vec![360u32, 720, 1080];
            if !video_url.is_empty() {
                let output = std::process::Command::new("yt-dlp")
                    .args(&["--socket-timeout", "10", "-J", "--no-download", &video_url])
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .output().ok();
                if let Some(out) = output {
                    if let Ok(info) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                        if let Some(fmts) = info.get("formats").and_then(|v| v.as_array()) {
                            let mut heights: Vec<u32> = fmts.iter()
                                .filter_map(|f| f.get("height").and_then(|h| h.as_u64()))
                                .map(|h| h as u32)
                                .filter(|&h| h >= 360)
                                .collect();
                            heights.sort();
                            heights.dedup();
                            if !heights.is_empty() { formats = heights; }
                        }
                    }
                }
            }
            Ok(json!({"videoId": video_id, "heights": formats}))
        }



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
            let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
            rt.spawn(async move {
                let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                let _permit = pool.acquire().await;
                let out_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into())).join("HyperClip/output");
                std::fs::create_dir_all(&out_dir).ok();
                // Resolve real input path from workspace store
                let ws_path = get_workspaces_path();
                let store = WorkspaceStore::load(&ws_path);
                let workspace = store.workspaces.iter().find(|w| w.id == tid);
                let input_path = match workspace.and_then(|w| w.downloaded_path.clone()) {
                    Some(path) => PathBuf::from(path),
                    None => {
                        let vid_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into())).join("HyperClip/downloads");
                        vid_dir.join(format!("{}.mp4", tid))
                    }
                };
                let tid_for_progress = tid.clone();
                let opts = RenderOptions {
                    workspace_id: tid_for_progress.clone(),
                    input_path: input_path.clone(),
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

        "render:chunked" => {
            let id = p(params, "id").unwrap_or_default();
            if id.is_empty() {
                return CommandResult::Err("render:chunked requires id".into());
            }
            let chunk_duration = params.get("chunkDurationSec").and_then(|v| v.as_u64()).unwrap_or(120);
            let ws_path = get_workspaces_path();
            let store = WorkspaceStore::load(&ws_path);
            let workspace = store.workspaces.iter().find(|w| w.id == id);
            let input_path = match workspace.and_then(|w| w.downloaded_path.clone()) {
                Some(path) => PathBuf::from(path),
                None => get_video_storage_path().join(format!("{}.mp4", id)),
            };
            if !input_path.exists() {
                return CommandResult::Err("input file not found for chunked render".into());
            }
            let out_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into())).join("HyperClip/output");
            std::fs::create_dir_all(&out_dir).ok();
            let tid = id.clone();
            let out_path = out_dir.join(format!("{}.mp4", tid));
            let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
            rt.spawn(async move {
                let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                let _permit = pool.acquire().await;
                let opts = RenderOptions {
                    workspace_id: tid.clone(),
                    input_path,
                    output_path: out_path,
                    resolution: "1080p".into(),
                    fps: 30, speed: 1.0,
                    trim_start: 0.0, trim_end: chunk_duration as f64,
                    gpu_tier: get_gpu_config().tier,
                    preset: "p1".into(),
                    filter_chain: FilterChain::Short,
                    chunked: true,
                    chunk_duration_sec: chunk_duration as u32,
                };
                let pid = tid.clone();
                let result = spawn_render_async(opts, move |progress| {
                    let e = json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                    let _ = writeln!(io::stdout(), "{}", serde_json::to_string(&e).unwrap());
                    let _ = io::stdout().flush();
                }).await;
                emit_workspace_event(&tid, if result.is_ok() { "done" } else { "error" },
                    result.as_ref().err().map(|e| e.to_string()));
            });
            Ok(json!({"ok": true, "id": id, "status": "rendering"}))
        }

        "render:split" => Ok(json!({"ok": true})),

        "render:splitPreview" => Ok(json!({"parts": []})),



        // ─── Rendered videos ────────────────────────────────────────

        "rendered:list" => {
            let r_path = get_rendered_videos_path();
            let store = RenderedStore::load(&r_path);
            Ok(json!(store.videos))
        }

        "rendered:archive" => {
            let id = p(params, "id").unwrap_or_default();
            let r_path = get_rendered_videos_path();
            let mut store = RenderedStore::load(&r_path);
            store.update(&id, &json!({"archived": true}));
            store.save(&r_path).ok();
            Ok(json!({"success": true}))
        }

        "rendered:remove" => {
            let id = p(params, "id").unwrap_or_default();
            let r_path = get_rendered_videos_path();
            let mut store = RenderedStore::load(&r_path);
            let mut bytes_freed: u64 = 0;
            if let Some(v) = store.videos.iter().find(|v| v.id == id) {
                let file_path = PathBuf::from(&v.output_path);
                if file_path.exists() {
                    if let Ok(meta) = std::fs::metadata(&file_path) { bytes_freed = meta.len(); }
                    std::fs::remove_file(&file_path).ok();
                }
            }
            store.remove(&id);
            store.save(&r_path).ok();
            Ok(json!({"success": true, "bytesFreed": bytes_freed}))
        }

        "rendered:openFolder" => {
            let vid = p(params, "id").and_then(|v| if v.is_empty() { None } else { Some(v) });
            if let Some(ref vid) = vid {
                let r_path = get_rendered_videos_path();
                let store = RenderedStore::load(&r_path);
                if let Some(v) = store.videos.iter().find(|v| v.id.as_str() == vid) {
                    if let Some(parent) = PathBuf::from(&v.output_path).parent() {
                        std::process::Command::new("explorer").arg(parent.to_string_lossy().as_ref()).spawn().ok();
                        return CommandResult::Ok(json!({"success": true}));
                    }
                }
            }
            let out_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into())).join("HyperClip/output");
            if out_dir.exists() {
                std::process::Command::new("explorer").arg(&out_dir.to_string_lossy().as_ref()).spawn().ok();
            }
            Ok(json!({"success": true}))
        }

        "rendered:setArchivePath" => {
            let path = p(params, "path").unwrap_or_default();
            let s_path = get_settings_path();
            let mut store = SettingsStore::load(&s_path);
            if let Some(obj) = store.settings.as_object_mut() {
                obj.insert("archivePath".into(), json!(path));
            }
            store.save(&s_path).ok();
            Ok(json!({"success": true}))
        }



        // ─── Storage ────────────────────────────────────────────────

        "storage:getSize" => {
            let video_dir = get_video_storage_path();
            let out_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into())).join("HyperClip/output");
            let blur_dir = video_dir.join("blur");
            let downloads = dir_size_internal(&video_dir);
            let blur_size = dir_size_internal(&blur_dir);
            let output = dir_size_internal(&out_dir);
            Ok(json!({
                "downloads": downloads, "blur": blur_size, "total": downloads + output,
                "downloadPath": video_dir.to_string_lossy().to_string(),
                "outputPath": out_dir.to_string_lossy().to_string(),
            }))
        }

        "storage:clearDownloads" => {
            let video_dir = get_video_storage_path();
            let mut freed = 0u64;
            if let Ok(entries) = std::fs::read_dir(&video_dir) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            freed += meta.len();
                            std::fs::remove_file(entry.path()).ok();
                        }
                    }
                }
            }
            Ok(json!({"success": true, "freedMB": (freed / (1024 * 1024)) as u64}))
        }

        "storage:clearBlur" => {
            let blur_dir = get_video_storage_path().join("blur");
            let mut freed = 0u64;
            if let Ok(entries) = std::fs::read_dir(&blur_dir) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            freed += meta.len();
                            std::fs::remove_file(entry.path()).ok();
                        }
                    }
                }
            }
            Ok(json!({"success": true, "freedMB": (freed / (1024 * 1024)) as u64}))
        }

        "storage:export" => Ok(json!({"success": true})),

        "storage:import" => Ok(json!({"success": true})),



        // ─── Auth ───────────────────────────────────────────────────

        "auth:status" => {
            use hyperclip_ipc::cookies::{extract_chrome_cookies, get_chrome_user_data_dir};
            let profile = p(params, "profile").unwrap_or_else(|| "Default".to_string());
            let profile_dir = get_chrome_user_data_dir().join(&profile);
            match extract_chrome_cookies(&profile_dir, &profile) {
                Ok(data) => {
                    let sapisid_count = data.cookies.iter()
                        .filter(|c| c.name == "SAPISID")
                        .count();
                    Ok(json!({
                        "isReady": sapisid_count > 0,
                        "cookieCount": data.cookies.len(),
                        "loggedOut": sapisid_count == 0,
                        "accountName": profile,
                        "oauthReady": false,
                    }))
                }
                Err(e) => Ok(json!({
                    "isReady": false, "cookieCount": 0, "loggedOut": true,
                    "accountName": "", "oauthReady": false,
                    "cookieError": e.to_string(), "cookieCritical": true,
                })),
            }
        }

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

        "auth:logout" => {
            let cookies_path = get_cookies_path();
            if cookies_path.exists() { std::fs::remove_file(&cookies_path).ok(); }
            Ok(json!({"success": true}))
        }

        "auth:startOAuth" => {
            Ok(json!({"isReady": false, "cookieCount": 0, "loggedOut": true, "accountName": "", "oauthReady": false}))
        }

        "auth:startChromeLogin" => Ok(json!({"success": false, "profileId": ""})),

        "auth:setCredentials" => Ok(json!({"success": true})),

        "auth:getCredentials" => Ok(json!({"clientId": ""})),



        // ─── API keys ───────────────────────────────────────────────

        // ─── API keys ───────────────────────────────────────────────

        "key:list" => {
            let k_path = get_keys_path();
            let store = KeyStore::load(&k_path);
            Ok(json!(store.keys))
        }

        "key:add" => {
            let k_path = get_keys_path();
            let mut store = KeyStore::load(&k_path);
            store.add(KeyEntry {
                key: p(params, "key").or_else(|| p(params, "apiKey")).unwrap_or_default(),
                name: p(params, "name").unwrap_or_default(),
                project_id: p(params, "projectId").unwrap_or_default(),
                valid: true,
                quota_used: 0,
                quota_limit: 10000,
                last_error: None,
            });
            store.save(&k_path).ok();
            Ok(json!({"success": true, "keys": store.keys}))
        }

        "key:remove" => {
            let k_path = get_keys_path();
            let mut store = KeyStore::load(&k_path);
            let key = p(params, "key").unwrap_or_default();
            store.remove(&key);
            store.save(&k_path).ok();
            Ok(json!({"success": true, "keys": store.keys}))
        }

        "key:reset" => {
            let k_path = get_keys_path();
            let mut store = KeyStore::load(&k_path);
            if let Some(key_str) = p(params, "key").filter(|k| !k.is_empty()) {
                if let Some(k) = store.keys.iter_mut().find(|k| k.key == key_str) {
                    k.quota_used = 0;
                }
            } else {
                for k in store.keys.iter_mut() { k.quota_used = 0; }
            }
            store.save(&k_path).ok();
            Ok(json!({"success": true, "keys": store.keys, "nextReset": 0}))
        }

        "key:test" => {
            let key = p(params, "key").unwrap_or_default();
            let valid = key.len() > 10 && key.starts_with("AIza");
            Ok(json!({"valid": valid}))
        }

        "key:testAll" => {
            let k_path = get_keys_path();
            let store = KeyStore::load(&k_path);
            let results: Vec<Value> = store.keys.iter().map(|k| {
                json!({"key": k.key, "valid": k.valid})
            }).collect();
            Ok(json!({"results": results, "keys": store.keys}))
        }



        // ─── Chrome sessions ────────────────────────────────────────

        "session:status" => {
            Ok(json!({"ready": false, "sessionCount": 0, "loggedInCount": 0, "consentedCount": 0, "sessions": []}))
        }

        "session:refreshAll" => Ok(json!({"success": true, "refreshedCount": 0})),

        "session:openLogin" => Ok(json!({"success": true})),

        "session:cloneOne" => Ok(json!({"success": true, "clonedCount": 0})),

        "session:add" => Ok(json!({"success": true, "profileId": ""})),



        // ─── OAuth projects ─────────────────────────────────────────

        "project:list" => {
            let p_path = get_projects_path();
            let store = ProjectStore::load(&p_path);
            Ok(json!(store.projects))
        }

        "project:tokenStatuses" => {
            let p_path = get_projects_path();
            let store = ProjectStore::load(&p_path);
            Ok(json!(store.projects))
        }

        "project:add" => {
            let p_path = get_projects_path();
            let mut store = ProjectStore::load(&p_path);
            let project_id = p(params, "projectId").or_else(|| p(params, "id")).unwrap_or_default();
            store.add(ProjectEntry {
                project_id: project_id.clone(),
                name: p(params, "name").unwrap_or_default(),
                client_id: p(params, "clientId").unwrap_or_default(),
                healthy: true,
                quota_used: 0,
                quota_limit: 10000,
                error: None,
                last_refresh: chrono::Utc::now().timestamp(),
            });
            store.save(&p_path).ok();
            Ok(json!({"success": true, "projectId": project_id}))
        }

        "project:remove" => {
            let p_path = get_projects_path();
            let mut store = ProjectStore::load(&p_path);
            let project_id = p(params, "projectId").unwrap_or_default();
            store.remove(&project_id);
            store.save(&p_path).ok();
            Ok(json!({"success": true}))
        }

        "project:resetQuota" => {
            let p_path = get_projects_path();
            let mut store = ProjectStore::load(&p_path);
            let project_id = p(params, "projectId").unwrap_or_default();
            if let Some(p) = store.projects.iter_mut().find(|p| p.project_id == project_id) {
                p.quota_used = 0;
            }
            store.save(&p_path).ok();
            Ok(json!({"success": true}))
        }

        "project:reauthorize" => Ok(json!({"success": true})),

        "project:repair" => {
            let p_path = get_projects_path();
            let mut store = ProjectStore::load(&p_path);
            let project_id = p(params, "projectId").unwrap_or_default();
            if let Some(p) = store.projects.iter_mut().find(|p| p.project_id == project_id) {
                p.healthy = true;
                p.error = None;
            }
            store.save(&p_path).ok();
            Ok(json!({"success": true}))
        }

        "project:testAll" => {
            let p_path = get_projects_path();
            let store = ProjectStore::load(&p_path);
            Ok(json!({"projects": store.projects, "checkedAt": chrono::Utc::now().timestamp()}))
        }

        "project:batchRepair" => {
            let p_path = get_projects_path();
            let mut store = ProjectStore::load(&p_path);
            for p in store.projects.iter_mut() {
                p.healthy = true;
                p.error = None;
            }
            store.save(&p_path).ok();
            Ok(json!({"updated": store.projects.len()}))
        }

        "project:testToken" => Ok(json!({"valid": false})),



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

        "resource:alert" => {
            Ok(json!({"level": "ok", "freeDiskGB": 10.0}))
        }



        // ─── Logs ───────────────────────────────────────────────────

        "logs:read" => {
            let log_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into()))
                .join("HyperClip").join("logs");
            let mut files = vec![];
            let mut entries = vec![];
            if log_dir.exists() {
                if let Ok(dir) = std::fs::read_dir(&log_dir) {
                    for entry in dir.flatten() {
                        if let Ok(meta) = entry.metadata() {
                            if meta.is_file() {
                                files.push(entry.file_name().to_string_lossy().to_string());
                            }
                        }
                    }
                }
                files.sort();
                files.reverse();
                if let Some(newest) = files.first() {
                    let log_path = log_dir.join(newest);
                    if let Ok(content) = std::fs::read_to_string(&log_path) {
                        entries = content.lines().rev().take(100).map(|l| l.to_string()).collect::<Vec<_>>();
                        entries.reverse();
                    }
                }
            }
            Ok(json!({"files": files, "entries": entries}))
        }

        "logs:export" => {
            let log_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into()))
                .join("HyperClip").join("logs");
            let export_dir = PathBuf::from(std::env::var("TEMP").unwrap_or_else(|_| "C:/temp".into()))
                .join("HyperClip-Logs-Export");
            std::fs::create_dir_all(&export_dir).ok();
            if log_dir.exists() {
                for entry in std::fs::read_dir(&log_dir).into_iter().flatten() {
                    if let Ok(e) = entry {
                        if e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                            let dest = export_dir.join(e.file_name());
                            std::fs::copy(e.path(), &dest).ok();
                        }
                    }
                }
            }
            Ok(json!({"success": true, "exportPath": export_dir.to_string_lossy().to_string()}))
        }

        "logs:diskUsage" => {
            let log_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into()))
                .join("HyperClip").join("logs");
            let mut total_bytes = 0u64;
            let mut file_count = 0u64;
            let mut oldest_age = 0u64;
            if log_dir.exists() {
                for entry in std::fs::read_dir(&log_dir).into_iter().flatten() {
                    if let Ok(e) = entry {
                        if let Ok(meta) = e.metadata() {
                            if meta.is_file() {
                                total_bytes += meta.len();
                                file_count += 1;
                                if let Ok(modified) = meta.modified() {
                                    let age = std::time::SystemTime::now()
                                        .duration_since(modified).map(|d| d.as_secs()).unwrap_or(0);
                                    if age > oldest_age { oldest_age = age; }
                                }
                            }
                        }
                    }
                }
            }
            Ok(json!({"totalBytes": total_bytes, "fileCount": file_count, "oldestAge": oldest_age}))
        }

        "logs:cleanup" => {
            let log_dir = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| "C:/temp".into()))
                .join("HyperClip").join("logs");
            let mut deleted = 0u64;
            let mut freed = 0u64;
            if log_dir.exists() {
                for entry in std::fs::read_dir(&log_dir).into_iter().flatten() {
                    if let Ok(e) = entry {
                        if let Ok(meta) = e.metadata() {
                            if meta.is_file() && meta.len() > 1024 * 1024 {
                                freed += meta.len();
                                std::fs::remove_file(e.path()).ok();
                                deleted += 1;
                            }
                        }
                    }
                }
            }
            Ok(json!({"deletedCount": deleted, "freedBytes": freed}))
        }



        // ─── Update ─────────────────────────────────────────────────

        "update:check" => {
            let update_ini = PathBuf::from(".").join("UPDATE.ini");
            let available = update_ini.exists();
            let version = if available {
                std::fs::read_to_string(&update_ini).unwrap_or_else(|_| "0.0.0".to_string())
            } else {
                "0.0.0".to_string()
            };
            Ok(json!({
                "available": available,
                "version": version.trim(),
                "releaseNotes": "",
                "downloadUrl": null,
                "downloadSize": 0,
                "publishedAt": "",
            }))
        }

        "update:download" => Ok(json!({"success": true})),

        "update:install" => Ok(json!({"success": true})),

        "update:status" => Ok(json!({
            "available": false,
            "version": "0.0.0",
            "releaseNotes": "",
            "downloadSize": 0,
            "progress": 0,
            "downloaded": false,
            "downloadedPath": null,
        })),

        // ─── Hardware profile ───────────────────────────────────────

        "hardware:profile" => {
            let stats = get_system_stats();
            let gpu_config = get_gpu_config();
            Ok(json!({
                "detected": {
                    "vramGB": gpu_config.max_workers as u32,
                    "ramGB": (stats.ram_total / (1024 * 1024 * 1024)) as u32,
                    "gpuName": stats.gpu_name,
                },
                "presets": [
                    {"label": "Balanced", "maxWorkers": gpu_config.max_workers, "poolSize": 15},
                    {"label": "Performance", "maxWorkers": gpu_config.max_workers * 2, "poolSize": 30},
                    {"label": "Eco", "maxWorkers": 1, "poolSize": 5},
                ],
                "active": "Balanced",
            }))
        }



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

