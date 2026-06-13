use hyperclip_ipc::{get_system_stats, ChannelStore, WorkspaceStore, get_workspaces_path, get_channels_path, get_seen_videos_path, SettingsStore, get_settings_path, RenderedStore, get_rendered_videos_path, KeyStore, get_keys_path, ProjectStore, get_projects_path, KeyEntry, ProjectEntry, get_store_dir, get_uploads_cache_path, get_data_dir};
use std::sync::atomic::AtomicBool;
use hyperclip_ipc::store::{SeenVideos, UploadsCache};

use hyperclip_ipc::cookies::{extract_chrome_cookies, get_chrome_user_data_dir};

use hyperclip_ipc::innertube_pool::{InnertubeClientPool, PoolConfig};

use hyperclip_ipc::poller::{Poller, NewVideoEvent};
use hyperclip_ipc::chrome_watcher::ChromeTabWatcher;

use hyperclip_ipc::ffmpeg::{spawn_render_async, RenderOptions, FilterChain};

use hyperclip_ipc::youtube::{download_video, download_video_streaming, emit_download_progress};

use hyperclip_ipc::thumbnail::download_youtube_thumbnail_to;


use hyperclip_ipc::worker_pool::WorkerPool;

use hyperclip_ipc::system::get_gpu_config;

use hyperclip_ipc::Channel;

use hyperclip_ipc::token_manager::{TokenManager, OAuthFallbackDetector};

use serde::{Serialize};
use serde_json::{json, Value};

use std::sync::Arc;

use std::sync::{Mutex, OnceLock};

use std::collections::{HashMap, VecDeque};

use std::path::PathBuf;

use std::io::{self, Write};

#[derive(Debug, Clone, Serialize)]
struct DetectionEvent {
    ws_id: String,
    video_id: String,
    channel_name: String,
    title: String,
    published_at: i64,
    detected_at: i64,
    latency_ms: i64,
    duration_sec: f64,
    status: String,
}

use tokio::sync::RwLock;

use tokio_util::sync::CancellationToken;



struct AppState {

    poller: Arc<Poller>,

    chrome_watcher: Arc<ChromeTabWatcher>,

    poller_cancel: Mutex<CancellationToken>,

    /// Tracks whether the poller thread has actually been started.
    /// Without this, `poller_active()` would return true even before start_poller() is called,
    /// because a fresh CancellationToken is not cancelled.
    poller_started: AtomicBool,

    _channels: Arc<RwLock<Vec<Channel>>>,

    pool: Arc<InnertubeClientPool>,

    // Holds NewVideoEvent callback so it lives for the program lifetime
    _process_handle: Arc<dyn Fn(NewVideoEvent) + Send + Sync>,

}



impl AppState {

    fn get_or_init() -> &'static AppState {

        static INSTANCE: OnceLock<AppState> = OnceLock::new();

        let _ = INSTANCE.get_or_init(|| {

            let pool_config = PoolConfig::default();

            let pool = Arc::new(InnertubeClientPool::initialize(pool_config).unwrap());

            // ─── Migrate old data and ensure store dirs ────────────────
            migrate_old_data();

            // NOTE: Cookie pre-population moved to background thread in init_appstate()
            // so the stdin command loop can start immediately.

            // Load channels from disk store (new path, may be freshly migrated)
            let ch_path = get_channels_path();
            let ch_store = ChannelStore::load(&ch_path);
            let v: Vec<hyperclip_ipc::Channel> = ch_store.channels.iter().map(|c| {
                hyperclip_ipc::Channel {
                    id: c.id.clone(),
                    name: c.name.clone(),
                    channel_id: c.channel_id.clone().unwrap_or_default(),
                    handle: Some(c.handle.clone()),
                    avatar_url: c.avatar_url.clone(),
                    paused: c.paused,
                    ..Default::default()
                }
            }).collect();
            tracing::info!("[AppState] Loaded {} channels from disk", v.len());
            let channels = Arc::new(RwLock::new(v));

            // Load seen videos from disk (per-channel with TTL) and wrap in shared RwLock
            let seen_path = get_seen_videos_path();
            let seen_store = hyperclip_ipc::store::SeenVideos::load(&seen_path);
            let seen_videos = Arc::new(tokio::sync::RwLock::new(seen_store));

            // Process function: runs for each new video detected by the poller
            let _channels_clone = channels.clone();
            let seen_videos_clone = seen_videos.clone();
            let process_fn = move |event: NewVideoEvent| {
                let ws_id = format!("ws-ch-{}", event.detected_at);

                // 0. Record detection event for UI history
                {
                    let latency = event.detected_at - event.published_at;
                    let mut store = detection_events_store().lock().unwrap();
                    store.push_front(DetectionEvent {
                        ws_id: ws_id.clone(),
                        video_id: event.video_id.clone(),
                        channel_name: event.channel_name.clone(),
                        title: event.title.clone(),
                        published_at: event.published_at,
                        detected_at: event.detected_at,
                        latency_ms: latency.max(0),
                        duration_sec: event.duration_sec,
                        status: "waiting".to_string(),
                    });
                    if store.len() > 50 {
                        store.truncate(50);
                    }
                }

                // 1. Create workspace entry
                let ws_path = get_workspaces_path();
                let mut ws_store = WorkspaceStore::load(&ws_path);
                let now = chrono::Utc::now().timestamp_millis();
                let s_path = get_settings_path();
                let s_store = SettingsStore::load(&s_path);
                let auto_render = s_store.settings
                    .get("autoRender")
                    .or_else(|| s_store.settings.get("auto_render"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let auto_fps = s_store.settings
                    .get("autoRenderFPS")
                    .or_else(|| s_store.settings.get("auto_render_fps"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(30) as u32;
                let auto_res = s_store.settings
                    .get("autoRenderResolution")
                    .or_else(|| s_store.settings.get("auto_render_resolution"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("1080p")
                    .to_string();
                let auto_speed = s_store.settings
                    .get("autoRenderSpeed")
                    .or_else(|| s_store.settings.get("auto_render_speed"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.0);

                ws_store.add(hyperclip_ipc::store::Workspace {
                    id: ws_id.clone(),
                    status: "waiting".to_string(),
                    video_id: event.video_id.clone(),
                    channel_id: event.channel_id.clone(),
                    channel_name: Some(event.channel_name.clone()),
                    title: event.title.clone(),
                    created_at: now,
                    published_at: event.published_at,
                    auto_render,
                    fps_target: auto_fps,
                    export_resolution: auto_res,
                    video_speed: auto_speed,
                    ..Default::default()
                });
                ws_store.save(&ws_path).ok();

                // Persist seen_id immediately so re-launch won't re-download
                let seen_path = get_seen_videos_path();
                let mut seen_store = hyperclip_ipc::store::SeenVideos::load(&seen_path);
                seen_store.mark_seen(&event.channel_id, &event.video_id);
                seen_store.save(&seen_path).ok();

                // Update shared memory seen list immediately
                if let Ok(handle) = tokio::runtime::Handle::try_current() {
                    let seen_videos_clone = seen_videos_clone.clone();
                    let cid = event.channel_id.clone();
                    let vid = event.video_id.clone();
                    handle.spawn(async move {
                        let mut seen_guard = seen_videos_clone.write().await;
                        seen_guard.mark_seen(&cid, &vid);
                    });
                } else {
                    seen_videos_clone.blocking_write().mark_seen(&event.channel_id, &event.video_id);
                }

                // 2. Emit new_video_detected event to stdout (Python/QML catches this)
                let event_json = serde_json::json!({
                    "method": "new_video_detected",
                    "params": {
                        "id": ws_id,
                        "videoId": event.video_id,
                        "channelId": event.channel_id,
                        "channelName": event.channel_name,
                        "title": event.title,
                        "thumbnailUrl": event.thumbnail_url,
                        "publishedAt": event.published_at,
                        "durationSec": event.duration_sec,
                        "detectedAt": event.detected_at,
                        "status": "waiting",
                    }
                });
                let _ = writeln!(std::io::stdout(), "{}", serde_json::to_string(&event_json).unwrap_or_default());
                let _ = std::io::stdout().flush();

                // 3. Load settings to check auto-download
                let s_path = get_settings_path();
                let s_store = SettingsStore::load(&s_path);
                let auto_download = s_store.settings
                    .get("auto_download_enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                if !auto_download {
                    tracing::debug!("[AppState] Auto-download disabled — workspace {} created but not downloading", ws_id);
                    return;
                }

                // 4. Spawn download thread
                let url = format!("https://youtube.com/watch?v={}", event.video_id);
                let cookies_path = get_cookies_netscape_path();
                let output_path = build_download_path(&event.channel_id, &event.channel_name, &event.video_id, event.detected_at);
                let output_str = output_path.to_string_lossy().to_string();
                let cookies_str = cookies_path.to_string_lossy().to_string();
                let tid = ws_id.clone();

                let trim_minutes = s_store.settings
                    .get("defaultTrimLimit")
                    .and_then(|v| v.as_u64())
                    .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_f64()).map(|f| f as u64))
                    .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()).map(|f| f as u64))
                    .or_else(|| s_store.settings.get("default_trim_limit_minutes").and_then(|v| v.as_u64()))
                    .unwrap_or(10) as u32;

                // Update workspace store with status and downloadStartedAt
                let ws_path = get_workspaces_path();
                let mut ws_store = WorkspaceStore::load(&ws_path);
                let now_ms = chrono::Utc::now().timestamp_millis();
                ws_store.update(&tid, serde_json::json!({
                    "status": "downloading",
                    "downloadStartedAt": now_ms,
                })).ok();
                ws_store.save(&ws_path).ok();

                // Emit downloading status
                let dl_event = serde_json::json!({
                    "method": "workspace:update",
                    "params": {"id": tid, "status": "downloading", "downloadStartedAt": now_ms}
                });
                let _ = writeln!(std::io::stdout(), "{}", serde_json::to_string(&dl_event).unwrap_or_default());
                let _ = std::io::stdout().flush();

                // Read quality from settings
                let auto_dl_quality: u32 = s_store.settings
                    .get("autoDownloadQuality")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<f64>().ok().map(|f| f as u32))
                    .or_else(|| s_store.settings.get("autoDownloadQuality").and_then(|v| v.as_f64()).map(|f| f as u32))
                    .or_else(|| s_store.settings.get("autoDownloadQuality").and_then(|v| v.as_u64()).map(|n| n as u32))
                    .or_else(|| s_store.settings.get("defaultQuality").and_then(|v| v.as_u64()).map(|n| n as u32))
                    .unwrap_or(1080);

                let ch_name = event.channel_name.clone();
                let cid = event.channel_id.clone();
                let video_id = event.video_id.clone();
                std::thread::spawn(move || {
                    match download_video_streaming(&url, &output_str, &cookies_str, trim_minutes, auto_dl_quality, |progress| {
                        emit_download_progress(&tid, &progress);
                    }) {
                        Ok(result) => {
                            tracing::info!("[AppState] Auto-download complete: {} ({:.1} MB)",
                                tid, result.file_size as f64 / 1_048_576.0);

                            // Download thumbnail to per-channel dir
                            let thumb_path = get_thumbnail_path(&cid, &ch_name, &video_id);
                            let _ = download_youtube_thumbnail_to(&video_id, &thumb_path);
                            let thumb_str = if thumb_path.exists() { Some(thumb_path.to_string_lossy().to_string()) } else { None };

                            // Update workspace store
                            let ws_path = get_workspaces_path();
                            let mut ws_store = WorkspaceStore::load(&ws_path);
                            let now_ms = chrono::Utc::now().timestamp_millis();
                            let is_short_val = result.width < result.height || result.duration <= 60.0;
                            let quality_val = result.height;
                            let duration_sec_val = result.duration.round() as u64;
                            let file_size_val = result.file_size;

                            ws_store.update(&tid, serde_json::json!({
                                "status": "ready",
                                "downloadedPath": result.path,
                                "thumbnailLocal": thumb_str,
                                "downloadedAt": now_ms,
                                "isShort": is_short_val,
                                "quality": quality_val,
                                "fileSize": file_size_val,
                                "durationSec": duration_sec_val,
                            })).ok();
                            ws_store.save(&ws_path).ok();
                            
                            crate::emit(hyperclip_ipc::IpcResponse::event("workspace:update", serde_json::json!({
                                "id": tid,
                                "status": "ready",
                                "downloadedPath": result.path,
                                "thumbnailLocal": thumb_str,
                                "downloadedAt": now_ms,
                                "isShort": is_short_val,
                                "quality": quality_val,
                                "fileSize": file_size_val,
                                "durationSec": duration_sec_val,
                            })));

                            // Emit ready event
                            let done_event = serde_json::json!({
                                "method": "workspace:update",
                                "params": {
                                    "id": tid,
                                    "status": "ready",
                                    "downloadedPath": result.path,
                                    "downloadedSize": result.file_size,
                                    "width": result.width,
                                    "height": result.height,
                                    "thumbnailLocal": thumb_str,
                                }
                            });
                            let _ = writeln!(std::io::stdout(), "{}", serde_json::to_string(&done_event).unwrap_or_default());
                            let _ = std::io::stdout().flush();

                            // Auto-render if enabled
                            let s_path = get_settings_path();
                            let s_store = SettingsStore::load(&s_path);
                            let auto_render = s_store.settings
                                .get("autoRender")
                                .or_else(|| s_store.settings.get("auto_render"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            if auto_render {
                                let in_path = result.path.clone();
                                let out_path = build_render_path(&cid, &ch_name, &tid);
                                let auto_render_speed = s_store.settings
                                    .get("autoRenderSpeed")
                                    .or_else(|| s_store.settings.get("auto_render_speed"))
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(1.0);
                                let render_res = s_store.settings.get("autoRenderResolution").or_else(|| s_store.settings.get("auto_render_resolution")).and_then(|v| v.as_str()).unwrap_or("1080p").to_string();
                                let render_fps = s_store.settings.get("autoRenderFPS").or_else(|| s_store.settings.get("auto_render_fps")).and_then(|v| v.as_u64()).unwrap_or(30) as u32;
                                let auto_trim_end = if is_short_val { result.duration.min(60.0) } else { result.duration };
                                let filter_chain = if is_short_val { hyperclip_ipc::ffmpeg::FilterChain::Short } else { hyperclip_ipc::ffmpeg::FilterChain::Landscape };
                                let opts = hyperclip_ipc::ffmpeg::RenderOptions {
                                    workspace_id: tid.clone(),
                                    input_path: std::path::PathBuf::from(&in_path),
                                    output_path: out_path.clone(),
                                    resolution: render_res.clone(),
                                    fps: render_fps,
                                    speed: auto_render_speed,
                                    trim_start: 0.0,
                                    trim_end: auto_trim_end,
                                    gpu_tier: get_gpu_config().tier,
                                    preset: "p1".into(),
                                    filter_chain,
                                    chunked: false,
                                    chunk_duration_sec: 120,
                                };
                                // Update database status to rendering
                                let ws_path = get_workspaces_path();
                                let mut ws_store = WorkspaceStore::load(&ws_path);
                                ws_store.update(&tid, serde_json::json!({
                                    "status": "rendering",
                                    "autoRender": true,
                                    "videoSpeed": auto_render_speed,
                                    "fpsTarget": render_fps,
                                    "exportResolution": render_res,
                                    "trimStart": 0.0,
                                    "trimEnd": auto_trim_end,
                                })).ok();
                                ws_store.save(&ws_path).ok();
                                emit_workspace_event(&tid, "rendering", None);

                                let pid = tid.clone();
                                let render_fut = spawn_render_async(opts, move |progress| {
                                    let e = serde_json::json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                                    let _ = writeln!(std::io::stdout(), "{}", serde_json::to_string(&e).unwrap_or_default());
                                    let _ = std::io::stdout().flush();
                                });

                                let render_res = tokio::runtime::Runtime::new()
                                    .map(|rt| rt.block_on(render_fut))
                                    .unwrap_or_else(|e| Err(hyperclip_ipc::HyperclipError::BackendCrashed(e.to_string())));

                                if let Err(ref e) = render_res {
                                    tracing::error!("[AppState] Auto-render failed for workspace {}: {:?}", tid, e);
                                }

                                 let status = if render_res.is_ok() { "done" } else { "error" };
                                 let mut ws_store = WorkspaceStore::load(&ws_path);
                                 let mut update_data = serde_json::json!({
                                     "status": status,
                                 });
                                 match &render_res {
                                     Ok((ref final_out_path, fps)) => {
                                         update_data["renderedPath"] = serde_json::json!(final_out_path.to_string_lossy().to_string());
                                         update_data["renderFps"] = serde_json::json!(fps);
                                         
                                         let gpu_config = get_gpu_config();
                                         let codec = if gpu_config.tier == hyperclip_ipc::system::GPUTier::High {
                                             "hevc_nvenc"
                                         } else if matches!(gpu_config.tier, hyperclip_ipc::system::GPUTier::Mid | hyperclip_ipc::system::GPUTier::Low) {
                                             "h264_nvenc"
                                         } else {
                                             "libx264"
                                         };
                                         update_data["renderCodec"] = serde_json::json!(codec);
                                         update_data["renderPreset"] = serde_json::json!("p1");
                                         update_data["renderWorkers"] = serde_json::json!(gpu_config.max_workers);
                                         update_data["error"] = serde_json::Value::Null;
                                     }
                                     Err(e) => {
                                         update_data["error"] = serde_json::json!(e.to_string());
                                     }
                                 }
                                 ws_store.update(&tid, update_data).ok();
                                 ws_store.save(&ws_path).ok();

                                emit_workspace_event(&tid, status, render_res.as_ref().err().map(|e| e.to_string()));
                                tracing::info!("[AppState] Auto-render completed for {} with status: {}", tid, status);
                            }
                        }
                        Err(e) => {
                            tracing::error!("[AppState] Auto-download failed for {}: {}", tid, e);
                            let err_event = serde_json::json!({
                                "method": "workspace:update",
                                "params": {"id": tid, "status": "error", "error": e}
                            });
                            let _ = writeln!(std::io::stdout(), "{}", serde_json::to_string(&err_event).unwrap_or_default());
                            let _ = std::io::stdout().flush();
                        }
                    }
                });
            };

            let process_fn_arc: Arc<dyn Fn(NewVideoEvent) + Send + Sync> = Arc::new(process_fn);

            // Load settings for poller config
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            let max_age_minutes = s_store.settings
                .get("autoDownloadMaxAgeMinutes")
                .and_then(|v| v.as_u64())
                .unwrap_or(1440) as u64;
            let poll_interval_ms = s_store.settings
                .get("pollIntervalMs")
                .and_then(|v| v.as_u64())
                .unwrap_or(5000) as u64;
            let min_duration_sec = s_store.settings
                .get("videoMinDurationSec")
                .and_then(|v| v.as_u64())
                .unwrap_or(60) as u32;

            let poller_process_fn = {
                let process_fn_arc = process_fn_arc.clone();
                move |event| process_fn_arc(event)
            };

            let poller = Arc::new(Poller::new(
                pool.clone(),
                channels.clone(),
                seen_videos.clone(),
                poll_interval_ms,
                max_age_minutes,
                min_duration_sec,
                poller_process_fn,
            ));

            let chrome_watcher = Arc::new(ChromeTabWatcher::new(
                None, // default port (9222)
                None, // default poll interval
                seen_videos.clone(),
                process_fn_arc.clone(),
            ));

            // Load uploads cache
            let uploads_cache_path = get_uploads_cache_path();
            let uploads_cache = UploadsCache::load(&uploads_cache_path);
            let poller_clone = poller.clone();
            if let Ok(rt) = tokio::runtime::Handle::try_current() {
                rt.spawn(async move {
                    poller_clone.set_uploads_cache(uploads_cache).await;
                });
            }

            // Initialize OAuth TokenManager and OAuthFallbackDetector
            let tokens_path = get_data_dir().join("oauth_tokens.json");
            let stats_path = get_data_dir().join(".hyperclip").join("token_stats.json");
            let client_id = s_store.settings.get("oauthClientId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let client_secret = s_store.settings.get("oauthClientSecret").and_then(|v| v.as_str()).unwrap_or("").to_string();

            if !client_id.is_empty() && !client_secret.is_empty() && tokens_path.exists() {
                match TokenManager::new(&tokens_path, &stats_path, client_id, client_secret, 9500) {
                    Ok(tm) => {
                        let detector = Arc::new(OAuthFallbackDetector::new(tm));
                        // Set OAuth detector on poller using interior mutability
                        poller.set_oauth_detector(detector);
                        tracing::info!("[AppState] OAuth fallback detector initialized");
                    }
                    Err(e) => {
                        tracing::warn!("[AppState] Failed to init TokenManager: {e}");
                    }
                }
            } else {
                tracing::info!("[AppState] OAuth not configured or tokens missing — skipping OAuth fallback");
            }

            AppState {
                poller,
                chrome_watcher,
                poller_cancel: Mutex::new(CancellationToken::new()),
                poller_started: AtomicBool::new(false),
                _channels: channels,
                pool,
                _process_handle: process_fn_arc,
            }
        });

        INSTANCE.get().unwrap()

    }

    fn start_poller(&self) {
        // Cancel the old poller thread first (if any) to prevent duplicate polling threads
        {
            let old_guard = self.poller_cancel.lock().unwrap();
            old_guard.cancel();
        }

        let poller = self.poller.clone();
        // Create a fresh token for the new poller run
        let cancel = CancellationToken::new();
        {
            let mut guard = self.poller_cancel.lock().unwrap();
            *guard = cancel.clone();
        }
        // Load seen videos from disk (per-channel with TTL)
        let seen_path = get_seen_videos_path();
        let seen_store = hyperclip_ipc::store::SeenVideos::load(&seen_path);

        // Load uploads cache
        let uploads_cache_path = get_uploads_cache_path();
        let uploads_cache = UploadsCache::load(&uploads_cache_path);

        // Startup catch-up: scan existing downloaded files and register them as seen
        // Also trigger auto-render for workspaces that are "ready" but not yet rendered
        let media_dir = get_media_dir();
        let ws_path = get_workspaces_path();
        let mut ws_store = WorkspaceStore::load(&ws_path);
        let s_path = get_settings_path();
        let s_store = SettingsStore::load(&s_path);
        let auto_render = s_store.settings.get("autoRender").or_else(|| s_store.settings.get("auto_render")).and_then(|v| v.as_bool()).unwrap_or(false);

        if media_dir.exists() {
            // Scan per-channel download directories
            if let Ok(entries) = std::fs::read_dir(&media_dir) {
                for entry in entries.flatten() {
                    if let Ok(file_type) = entry.file_type() {
                        if file_type.is_dir() {
                            let channel_dir = entry.path();
                            let downloads_dir = channel_dir.join("downloads");
                            if downloads_dir.exists() {
                                if let Ok(dl_entries) = std::fs::read_dir(&downloads_dir) {
                                    for dl_entry in dl_entries.flatten() {
                                        if let Ok(meta) = dl_entry.metadata() {
                                            if meta.is_file() && dl_entry.file_name().to_string_lossy().ends_with(".mp4") {
                                                let filename = dl_entry.file_name().to_string_lossy().to_string();
                                                // Extract video_id from filename (format: {video_id}_{timestamp}.mp4)
                                                if let Some(video_id) = filename.split('_').next() {
                                                    let channel_id = channel_dir.file_name().unwrap().to_string_lossy().to_string();
                                                    // Mark as seen in poller
                                                    let mut seen = seen_store.clone();
                                                    seen.mark_seen(&channel_id, video_id);
                                                    // Also check if there's a workspace for this video that needs auto-render
                                                    if auto_render {
                                                        for ws in ws_store.workspaces.iter() {
                                                            if ws.video_id == video_id && ws.status == "ready" && ws.rendered_path.is_none() {
                                                                // Trigger auto-render
                                                                tracing::info!("[AppState] Startup catch-up: triggering auto-render for {}", ws.id);
                                                                // Note: actual render triggering would need the poller to be running
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Save seen store with newly registered videos
        let _ = seen_store.save(&seen_path);

        // Also check for existing workspaces that need auto-render
        if auto_render {
            for ws in ws_store.workspaces.iter() {
                if ws.status == "ready" && ws.downloaded_path.is_some() && ws.rendered_path.is_none() {
                    tracing::info!("[AppState] Startup catch-up: workspace {} is ready for auto-render", ws.id);
                    // Auto-render will be triggered when poller starts and processes the event
                }
            }
        }

        let chrome_watcher = self.chrome_watcher.clone();

        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                poller.load_seen_ids(seen_store).await;
                poller.set_uploads_cache(uploads_cache).await;
                
                let poller_cancel = cancel.clone();
                let watcher_cancel = cancel.clone();

                let poller_fut = poller.run(poller_cancel);
                let watcher_fut = chrome_watcher.run(watcher_cancel);

                tokio::join!(poller_fut, watcher_fut);
            });
        });
        self.poller_started.store(true, std::sync::atomic::Ordering::SeqCst);
        tracing::info!("[AppState] Poller started with startup catch-up");
    }

    fn stop_poller(&self) {
        let guard = self.poller_cancel.lock().unwrap();
        guard.cancel();
        self.poller_started.store(false, std::sync::atomic::Ordering::SeqCst);
        tracing::info!("[AppState] Poller stopped");
    }

    fn poller_active(&self) -> bool {
        let started = self.poller_started.load(std::sync::atomic::Ordering::SeqCst);
        let guard = self.poller_cancel.lock().unwrap();
        started && !guard.is_cancelled()
    }

    fn reload_poller_config(&self) {
        let s_path = get_settings_path();
        let s_store = SettingsStore::load(&s_path);
        let poll_interval_ms = s_store.settings
            .get("pollIntervalMs")
            .and_then(|v| v.as_u64())
            .unwrap_or(5000) as u64;
        let max_age_minutes = s_store.settings
            .get("autoDownloadMaxAgeMinutes")
            .and_then(|v| v.as_u64())
            .unwrap_or(1440) as u64;
        let min_duration_sec = s_store.settings
            .get("videoMinDurationSec")
            .and_then(|v| v.as_u64())
            .unwrap_or(60) as u32;
        self.poller.reload_config(poll_interval_ms, max_age_minutes, min_duration_sec);
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

    fn channels_ref(&self) -> Arc<RwLock<Vec<Channel>>> {
        self._channels.clone()
    }

    fn last_detection_latency(&self) -> i64 {
        if let Ok(store) = detection_events_store().lock() {
            store.front().map(|e| e.latency_ms).unwrap_or(0)
        } else {
            0
        }
    }

    fn detections_today(&self) -> usize {
        if let Ok(store) = detection_events_store().lock() {
            let now_sec = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
            let today_start = now_sec - (now_sec % 86400);
            let today_ms = today_start * 1000;
            store.iter().filter(|e| e.detected_at >= today_ms).count()
        } else {
            0
        }
    }

    fn average_latency(&self) -> f64 {
        if let Ok(store) = detection_events_store().lock() {
            let len = store.len();
            if len == 0 { return 0.0; }
            let total: i64 = store.iter().map(|e| e.latency_ms).sum();
            total as f64 / len as f64
        } else {
            0.0
        }
    }

    fn sla_percent(&self) -> f64 {
        if let Ok(store) = detection_events_store().lock() {
            let len = store.len();
            if len == 0 { return 100.0; }
            let under_5s = store.iter().filter(|e| e.latency_ms > 0 && e.latency_ms < 5000).count();
            (under_5s as f64 / len as f64) * 100.0
        } else {
            100.0
        }
    }

    fn detection_events(&self) -> Vec<DetectionEvent> {
        if let Ok(store) = detection_events_store().lock() {
            store.iter().cloned().collect()
        } else {
            vec![]
        }
    }

}

/// Reload channels from disk into the poller's channel list.
/// Called after channel:add / remove / bulkRemove to keep poller in sync.
fn poller_sync_channels() {
    let ch_path = get_channels_path();
    let ch_store = ChannelStore::load(&ch_path);
    let v: Vec<Channel> = ch_store.channels.iter().map(|c| {
        Channel {
            id: c.id.clone(),
            name: c.name.clone(),
            channel_id: c.channel_id.clone().unwrap_or_default(),
            handle: Some(c.handle.clone()),
            avatar_url: c.avatar_url.clone(),
            paused: c.paused,
            ..Default::default()
        }
    }).collect();
    let state = AppState::get_or_init();
    let channels = state.channels_ref();
    if let Some(rt) = POLLER_RT.get() {
        rt.block_on(async {
            let mut ch = channels.write().await;
            *ch = v;
        });
    }
    crate::emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));
}

/// Persist seen IDs to disk (called periodically from main loop)
#[allow(dead_code)]
fn poller_flush_seen_ids() {
    let seen_path = get_seen_videos_path();
    let state = AppState::get_or_init();
    let poller = state.poller.clone();
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(async move {
            let store = poller.seen_ids_snapshot().await;
            let _ = store.save(&seen_path);
        });
    }
}



static CANCEL_TOKEN_MAP: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();

static WORKER_POOL: OnceLock<WorkerPool> = OnceLock::new();

static RENDER_RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

static POLLER_RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

fn detection_events_store() -> &'static Mutex<VecDeque<DetectionEvent>> {
    static STORE: OnceLock<Mutex<VecDeque<DetectionEvent>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(VecDeque::new()))
}

/// Eagerly init POLLER_RT and AppState at startup.
pub fn init_poller_runtime() {
    POLLER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
}

/// Eagerly init AppState at startup — triggers data migration + cookie extraction.
pub fn init_appstate() {
    // Initialize AppState (pool, channels, process_fn) — now returns quickly
    // because cookie pre-population was moved to the background thread below.
    AppState::get_or_init();

    // Spawn a background thread that pre-populates the pool with cookies
    // from all 30 profiles. This runs in parallel with the stdin command loop
    // so Python commands are not blocked.
    std::thread::Builder::new()
        .name("cookie-preload".into())
        .spawn(|| {
            tracing::info!("[cookie-preload] Starting background cookie extraction for 30 profiles");
            let mut valid_sessions = 0;
            for i in 1..=30 {
                let profile_id = format!("HyperClip-Profile-{}", i);
                match extract_profile_cookies_and_feed(&profile_id) {
                    Ok(cookie_str) => {
                        if cookie_str.contains("SAPISID") || cookie_str.contains("__Secure-3PAPISID") {
                            valid_sessions += 1;
                        }
                    }
                    Err(e) => {
                        tracing::debug!("[cookie-preload] Profile {} extraction failed: {}", i, e);
                    }
                }
            }
            // Also try Default profile
            let _ = extract_profile_cookies_and_feed("Default");
            tracing::info!("[cookie-preload] Done: {}/30 profiles have valid sessions", valid_sessions);

            // After all profiles are loaded, check if Profile-1 needs Chrome login
            let profile_1_ok = match extract_profile_cookies("HyperClip-Profile-1") {
                Ok(c) => c.contains("SAPISID") || c.contains("__Secure-3PAPISID"),
                Err(_) => false,
            };
            if !profile_1_ok {
                tracing::warn!("[cookie-preload] Profile 1 has no valid cookies — launching Chrome to prompt login");
            } else {
                tracing::info!("[cookie-preload] Profile 1 has valid cookies — launching Chrome to observe channel tabs");
            }
            launch_chrome_profile_async("HyperClip-Profile-1");
        })
        .expect("Failed to spawn cookie-preload thread");
}

/// Check if poller is still running (for main loop keep-alive).
pub fn is_poller_active() -> bool {
    let state = AppState::get_or_init();
    state.poller_active()
}



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
    let ws_path = get_workspaces_path();
    let store = WorkspaceStore::load(&ws_path);
    let mut payload = if let Some(ws) = store.get(id) {
        serde_json::to_value(ws).unwrap_or_else(|_| json!({
            "id": id,
            "status": status,
        }))
    } else {
        json!({
            "id": id,
            "status": status,
        })
    };

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



// ─── Path helpers — all delegate to centralized store.rs ──────────

fn get_media_dir() -> PathBuf {
    hyperclip_ipc::store::get_media_dir()
}

fn channel_media_dir(channel_id: &str, channel_name: &str) -> PathBuf {
    hyperclip_ipc::store::channel_media_dir(channel_id, channel_name)
}

fn channel_downloads_dir(channel_id: &str, channel_name: &str) -> PathBuf {
    hyperclip_ipc::store::channel_downloads_dir(channel_id, channel_name)
}

fn channel_thumbnails_dir(channel_id: &str, channel_name: &str) -> PathBuf {
    hyperclip_ipc::store::channel_thumbnails_dir(channel_id, channel_name)
}

fn render_output_dir(channel_id: &str, channel_name: &str, ws_id: &str) -> PathBuf {
    hyperclip_ipc::store::render_output_dir(channel_id, channel_name, ws_id)
}

fn build_download_path(channel_id: &str, channel_name: &str, video_id: &str, timestamp_ms: i64) -> PathBuf {
    hyperclip_ipc::store::build_download_path(channel_id, channel_name, video_id, timestamp_ms)
}

fn build_render_path(channel_id: &str, channel_name: &str, ws_id: &str) -> PathBuf {
    hyperclip_ipc::store::build_render_path(channel_id, channel_name, ws_id)
}

fn get_thumbnail_path(channel_id: &str, channel_name: &str, video_id: &str) -> PathBuf {
    hyperclip_ipc::store::get_thumbnail_path(channel_id, channel_name, video_id)
}

fn get_video_storage_path() -> PathBuf {
    hyperclip_ipc::store::get_legacy_downloads_dir()
}

fn ensure_channel_video_dir(channel_name: &str, channel_id: &str) -> PathBuf {
    hyperclip_ipc::store::channel_downloads_dir(channel_id, channel_name)
}

fn get_output_path() -> PathBuf {
    hyperclip_ipc::store::get_legacy_output_dir()
}

fn ensure_channel_output_dir_fn(channel_name: &str) -> PathBuf {
    let cid = if channel_name.is_empty() { "unknown".to_string() } else { channel_name.to_string() };
    hyperclip_ipc::store::channel_renders_dir(&cid, "")
}

fn get_cookies_path() -> PathBuf {
    hyperclip_ipc::store::get_cookies_path()
}

fn get_cookies_netscape_path() -> PathBuf {
    hyperclip_ipc::store::get_cookies_netscape_path()
}

fn get_legacy_output_dir() -> PathBuf {
    hyperclip_ipc::store::get_legacy_output_dir()
}

fn get_legacy_downloads_dir() -> PathBuf {
    hyperclip_ipc::store::get_legacy_downloads_dir()
}

fn get_logs_dir() -> PathBuf {
    hyperclip_ipc::store::get_logs_dir()
}

/// Look up (channel_id, channel_name, video_id) from workspace store.
fn lookup_channel_ids(ws_id: &str) -> (String, String, String) {
    let ws_path = get_workspaces_path();
    let store = WorkspaceStore::load(&ws_path);
    if let Some(ws) = store.workspaces.iter().find(|w| w.id == ws_id) {
        let cid = if ws.channel_id.is_empty() { "unknown".to_string() } else { ws.channel_id.clone() };
        let cname = ws.channel_name.clone().unwrap_or_default();
        let vid = ws.video_id.clone();
        (cid, cname, vid)
    } else {
        ("unknown".to_string(), String::new(), String::new())
    }
}

fn get_chrome_executable_path() -> PathBuf {
    let path_standard = PathBuf::from("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
    if path_standard.exists() {
        return path_standard;
    }
    let path_x86 = PathBuf::from("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
    if path_x86.exists() {
        return path_x86;
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let path_user = PathBuf::from(local_app_data)
            .join("Google")
            .join("Chrome")
            .join("Application")
            .join("chrome.exe");
        if path_user.exists() {
            return path_user;
        }
    }
    PathBuf::from("chrome.exe")
}

fn map_profile_id_to_dir_name(profile_id: &str) -> String {
    if profile_id == "Default" {
        return "Default".to_string();
    }
    if profile_id.starts_with("HyperClip-Profile-") {
        if let Ok(num) = profile_id["HyperClip-Profile-".len()..].parse::<u32>() {
            return format!("Profile.{}", num + 1);
        }
    }
    profile_id.to_string()
}

fn get_chrome_profiles_root() -> PathBuf {
    // 1. Check if the developer's D:\ path exists (for dev convenience)
    let d_path = PathBuf::from("D:\\HyperClip-Data\\chrome-profiles");
    if d_path.exists() {
        return d_path;
    }
    // 2. Primary dynamic data directory path
    let root = get_data_dir().join("chrome-profiles");
    if !root.exists() {
        let _ = std::fs::create_dir_all(&root);
    }
    root
}

fn resolve_profile_dir(profile_id: &str) -> PathBuf {
    if profile_id == "Default" {
        return get_chrome_user_data_dir().join("Default");
    }
    if profile_id.starts_with("HyperClip-Profile-") {
        if let Ok(num) = profile_id["HyperClip-Profile-".len()..].parse::<u32>() {
            let root = get_chrome_profiles_root();
            // D:\HyperClip-Data\chrome-profiles\profile-N\Default\Default
            return root.join(format!("profile-{}", num)).join("Default").join("Default");
        }
    }
    // Fallback
    let dir_name = map_profile_id_to_dir_name(profile_id);
    get_chrome_user_data_dir().join(dir_name)
}

fn get_chrome_launch_args(profile_id: &str) -> (PathBuf, String) {
    if profile_id == "Default" {
        return (get_chrome_user_data_dir(), "Default".to_string());
    }
    if profile_id.starts_with("HyperClip-Profile-") {
        if let Ok(num) = profile_id["HyperClip-Profile-".len()..].parse::<u32>() {
            let root = get_chrome_profiles_root();
            // D:\HyperClip-Data\chrome-profiles\profile-N\Default
            let user_data_dir = root.join(format!("profile-{}", num)).join("Default");
            return (user_data_dir, "Default".to_string());
        }
    }
    // Fallback
    (get_chrome_user_data_dir(), map_profile_id_to_dir_name(profile_id))
}

fn extract_profile_cookies(profile_id: &str) -> Result<String, String> {
    let profile_dir = resolve_profile_dir(profile_id);
    match extract_chrome_cookies(&profile_dir, profile_id) {
        Ok(result) => {
            let cookie_str = result.build_cookie_string();
            Ok(cookie_str)
        }
        Err(e) => Err(e.to_string()),
    }
}

fn extract_profile_cookies_and_feed(profile_id: &str) -> Result<String, String> {
    let profile_dir = resolve_profile_dir(profile_id);
    let result = extract_chrome_cookies(&profile_dir, profile_id)
        .map_err(|e| format!("Cookie extraction failed: {}", e))?;
    let cookie_string = result.build_cookie_string();

    // If it's HyperClip-Profile-N (1..=30), feed it into the pool at index N-1
    if profile_id.starts_with("HyperClip-Profile-") {
        if let Ok(num) = profile_id["HyperClip-Profile-".len()..].parse::<usize>() {
            if num >= 1 && num <= 30 {
                AppState::get_or_init().pool.set_session_cookie(num - 1, cookie_string.clone());
                tracing::info!("[Cookies] Extracted and loaded cookies into pool index {} for {}", num - 1, profile_id);
            }
        }
    } else {
        // Fallback for "Default" or others
        AppState::get_or_init().pool.set_session_cookie(0, cookie_string.clone());
    }

    // Write to the global cookies files if this is Profile 1 or Default (to keep downloads working)
    if profile_id == "Default" || profile_id == "HyperClip-Profile-1" {
        let cookies_path = get_cookies_path();
        if let Some(parent) = cookies_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&cookies_path, &cookie_string).map_err(|e| e.to_string())?;

        let netscape = result.build_netscape_file();
        let netscape_path = cookies_path.parent().unwrap().join("cookies_netscape.txt");
        std::fs::write(&netscape_path, netscape).map_err(|e| e.to_string())?;
        tracing::info!("[Cookies] Updated global cookies.txt and cookies_netscape.txt from {}", profile_id);
    }

    Ok(cookie_string)
}

fn refresh_all_profiles_cookies() -> Result<usize, String> {
    let mut success_count = 0;
    for i in 1..=30 {
        let profile_id = format!("HyperClip-Profile-{}", i);
        match extract_profile_cookies_and_feed(&profile_id) {
            Ok(_) => {
                success_count += 1;
            }
            Err(e) => {
                tracing::warn!("[Cookies] Refresh failed for {}: {}", profile_id, e);
            }
        }
    }
    // Also try Default as fallback/complement
    let _ = extract_profile_cookies_and_feed("Default");
    Ok(success_count)
}

fn launch_chrome_profile_async(profile_id: &str) {
    let (user_data_dir, profile_dir_name) = get_chrome_launch_args(profile_id);
    let chrome_path = get_chrome_executable_path();
    let profile_id_owned = profile_id.to_string();

    std::thread::spawn(move || {
        let mut urls = vec!["https://www.youtube.com".to_string()];
        if profile_id_owned == "HyperClip-Profile-1" {
            let ch_path = get_channels_path();
            let ch_store = ChannelStore::load(&ch_path);
            for ch in ch_store.channels.iter() {
                if ch.enabled && !ch.paused {
                    if !ch.handle.is_empty() {
                        let handle = if ch.handle.starts_with('@') {
                            ch.handle.clone()
                        } else {
                            format!("@{}", ch.handle)
                        };
                        urls.push(format!("https://www.youtube.com/{}/videos", handle));
                    } else if let Some(ref channel_id) = ch.channel_id {
                        if !channel_id.is_empty() {
                            urls.push(format!("https://www.youtube.com/channel/{}/videos", channel_id));
                        }
                    }
                }
            }
        }

        // Try to connect to Chrome debugging port to check if it's already running
        let cdp_url = "http://127.0.0.1:9222/json";
        let agent = ureq::AgentBuilder::new()
            .try_proxy_from_env(false)
            .build();
        
        #[derive(serde::Deserialize, Debug)]
        struct CdpTab {
            url: Option<String>,
            #[serde(rename = "type")]
            tab_type: Option<String>,
        }

        let tabs_result: Result<Vec<CdpTab>, String> = agent.get(cdp_url)
            .timeout(std::time::Duration::from_millis(1500))
            .call()
            .map_err(|e| e.to_string())
            .and_then(|resp| {
                serde_json::from_reader(resp.into_reader()).map_err(|e| e.to_string())
            });

        match tabs_result {
            Ok(open_tabs) => {
                tracing::info!("[Chrome] Chrome is already running with remote debugging port active. Checking open tabs...");
                
                fn extract_youtube_key(url: &str) -> Option<String> {
                    if url.contains("youtube.com/@") {
                        let parts: Vec<&str> = url.split("youtube.com/").collect();
                        if parts.len() > 1 {
                            let rest = parts[1];
                            let handle = rest.split('/').next().unwrap_or("");
                            if handle.starts_with('@') {
                                return Some(handle.to_string());
                            }
                        }
                    } else if url.contains("youtube.com/channel/") {
                        let parts: Vec<&str> = url.split("youtube.com/channel/").collect();
                        if parts.len() > 1 {
                            let rest = parts[1];
                            let chan_id = rest.split('/').next().unwrap_or("");
                            if !chan_id.is_empty() {
                                return Some(chan_id.to_string());
                            }
                        }
                    }
                    None
                }

                // Check each target URL
                for url in &urls {
                    let is_open = if let Some(target_key) = extract_youtube_key(url) {
                        // It's a channel URL. Check if any open tab contains this channel's key
                        open_tabs.iter().any(|tab| {
                            tab.tab_type.as_deref() == Some("page") && 
                            tab.url.as_ref().map(|u| u.contains(&target_key)).unwrap_or(false)
                        })
                    } else {
                        // It's the homepage or other non-channel URL
                        open_tabs.iter().any(|tab| {
                            tab.tab_type.as_deref() == Some("page") && 
                            tab.url.as_ref().map(|u| u == url || u == &format!("{}/", url)).unwrap_or(false)
                        })
                    };

                    if !is_open {
                        tracing::info!("[Chrome] Channel/URL not open in Chrome. Opening new tab: {}", url);
                        let encoded_url = urlencoding::encode(url);
                        let new_tab_url = format!("http://127.0.0.1:9222/json/new?url={}", encoded_url);
                        if let Err(e) = agent.get(&new_tab_url).call() {
                            tracing::warn!("[Chrome] Failed to open new tab via CDP: {}", e);
                        }
                    } else {
                        tracing::info!("[Chrome] Tab already open, skipping: {}", url);
                    }
                }

                // Chrome is already open, so we extract cookies immediately and return
                match extract_profile_cookies_and_feed(&profile_id_owned) {
                    Ok(_) => {
                        tracing::info!("[Chrome] Successfully extracted and updated cookies for existing Chrome profile {}", profile_id_owned);
                        crate::emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));
                    }
                    Err(e) => {
                        tracing::error!("[Chrome] Failed to extract cookies for existing Chrome: {}", e);
                    }
                }
                return;
            }
            Err(e) => {
                tracing::info!("[Chrome] Port check failed (Chrome likely not running on port 9222): {}", e);
            }
        }

        // Chrome is not running or port is closed, spawn it normally
        tracing::info!("[Chrome] Launching new Chrome process for profile: {}", profile_id_owned);
        let mut cmd = std::process::Command::new(chrome_path);
        cmd.arg(format!("--user-data-dir={}", user_data_dir.to_string_lossy()));
        cmd.arg(format!("--profile-directory={}", profile_dir_name));
        cmd.arg("--remote-debugging-port=9222");
        cmd.arg("--disable-background-timer-throttling");
        cmd.arg("--disable-backgrounding-occluded-windows");
        cmd.arg("--disable-renderer-backgrounding");
        for url in urls {
            cmd.arg(url);
        }

        tracing::info!("[Chrome] Running Command: {:?}", cmd);
        
        match cmd.spawn() {
            Ok(mut child) => {
                tracing::info!("[Chrome] Process spawned successfully, PID: {:?}", child.id());
                match child.wait() {
                    Ok(status) => {
                        tracing::info!("[Chrome] Chrome window closed with status: {:?}", status);
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        
                        match extract_profile_cookies_and_feed(&profile_id_owned) {
                            Ok(_) => {
                                tracing::info!("[Chrome] Successfully extracted and updated cookies for profile {}", profile_id_owned);
                                crate::emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));
                            }
                            Err(e) => {
                                tracing::error!("[Chrome] Failed to extract cookies after Chrome closed: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("[Chrome] Error waiting for Chrome process: {}", e);
                    }
                }
            }
            Err(e) => {
                tracing::error!("[Chrome] Failed to spawn Chrome: {}", e);
            }
        }
    });
}



/// Check whether cookies.txt exists and has content.
fn cookies_file_has_content() -> bool {
    let path = get_cookies_path();
    path.exists() && std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false)
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

        "system:openFolder" => {
            let path = p(params, "path").unwrap_or_default();
            tracing::info!("openFolder: {}", path);
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("explorer").arg(&path).spawn();
            }
            Ok(json!({ "ok": true }))
        }

        "system:openUrl" => {
            let url = p(params, "url").unwrap_or_default();
            tracing::info!("openUrl: {}", url);
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn();
            }
            Ok(json!({ "ok": true }))
        }

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
            let old_polling = store.settings.get("pollingEnabled").and_then(|v| v.as_bool()).unwrap_or(false);
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

            // Handle pollingEnabled change
            let new_polling = store.settings.get("pollingEnabled").and_then(|v| v.as_bool()).unwrap_or(false);
            let state = AppState::get_or_init();
            if new_polling != old_polling {
                if new_polling {
                    state.start_poller();
                    tracing::info!("[Settings] pollingEnabled=true -> started poller");
                } else {
                    state.stop_poller();
                    tracing::info!("[Settings] pollingEnabled=false -> stopped poller");
                }
            } else if new_polling && state.poller_active() {
                state.reload_poller_config();
            }
            Ok(json!({"ok": true}))
        }



        // ─── Channels ───────────────────────────────────────────────

        "channel:list" => Ok(load_channels()),

        "channel:add" => {
            let raw = p(params, "url").unwrap_or_default();
            if raw.is_empty() {
                return CommandResult::Ok(json!({"ok": false, "error": "url required"}));
            }
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);

            // 1. Normalize URL
            let normalized = if raw.starts_with("http") {
                raw.clone()
            } else if raw.starts_with('@') {
                format!("https://www.youtube.com/{}", raw)
            } else {
                format!("https://www.youtube.com/@{}", raw.trim_start_matches('@'))
            };

            // 2. Parse channel identifier from URL
            let parsed_id: Option<String> = {
                let path = normalized.trim_start_matches("https://").trim_start_matches("http://")
                    .trim_start_matches("www.youtube.com")
                    .trim_start_matches("m.youtube.com")
                    .trim_start_matches("youtube.com");
                let path = path.trim_start_matches('/');
                if let Some(rest) = path.strip_prefix("channel/") {
                    Some(rest.split('/').next().unwrap_or(rest).to_string())
                } else if let Some(rest) = path.strip_prefix('@') {
                    Some(rest.split('/').next().unwrap_or(rest).to_string())
                } else if let Some(rest) = path.strip_prefix("c/") {
                    Some(rest.split('/').next().unwrap_or(rest).to_string())
                } else if let Some(rest) = path.strip_prefix("user/") {
                    Some(rest.split('/').next().unwrap_or(rest).to_string())
                } else if raw.starts_with("UC") && raw.len() >= 22 {
                    Some(raw.clone())
                } else {
                    None
                }
            };

            // 3. Duplicate check
            let channel_id_str = parsed_id.as_deref().unwrap_or(&raw);
            if store.channels.iter().any(|c| {
                c.channel_id.as_deref() == Some(channel_id_str)
                    || c.handle.as_str().trim_start_matches('@').eq_ignore_ascii_case(channel_id_str)
            }) {
                return CommandResult::Ok(json!({"ok": false, "error": "duplicate channel"}));
            }

            // 4. Try to resolve metadata via yt-dlp
            let (resolved_name, resolved_id, resolved_avatar) = resolve_channel_metadata(&normalized);

            let id = format!("ch-{}", chrono::Utc::now().timestamp_millis());
            let final_name = resolved_name.unwrap_or_else(|| {
                channel_id_str.trim_start_matches('@').to_string()
            });
            let final_channel_id = resolved_id.unwrap_or(channel_id_str.to_string());
            let final_handle = if final_channel_id.starts_with("UC") {
                format!("@{}", channel_id_str.trim_start_matches('@'))
            } else {
                format!("@{}", final_channel_id.trim_start_matches('@'))
            };

            store.add(hyperclip_ipc::store::Channel {
                id: id.clone(),
                name: final_name,
                handle: final_handle.clone(),
                channel_id: Some(final_channel_id),
                avatar_url: resolved_avatar,
                paused: false,
                enabled: true,
                ..Default::default()
            });
            store.save(&ch_path).ok();
            tracing::info!("channel:add -> {} (handle={})", id, final_handle);
            poller_sync_channels();
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
            poller_sync_channels();
            Ok(json!({"ok": true, "id": id}))
        }

        "channel:pause" => {
            let id = p(params, "id").unwrap_or_default();
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            match store.update(&id, &json!({"paused": true})) {
                Ok(()) => { store.save(&ch_path).ok(); poller_sync_channels(); Ok(json!({"ok": true})) }
                Err(e) => Ok(json!({"ok": false, "error": e})),
            }
        }

        "channel:resume" => {
            let id = p(params, "id").unwrap_or_default();
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);
            match store.update(&id, &json!({"paused": false})) {
                Ok(()) => { store.save(&ch_path).ok(); poller_sync_channels(); Ok(json!({"ok": true})) }
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
            poller_sync_channels();
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
            poller_sync_channels();
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
            poller_sync_channels();
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

        "workspace:get" => {
            let id = p(params, "id").unwrap_or_default();
            let store = WorkspaceStore::load(&get_workspaces_path());
            match store.get(&id) {
                Some(ws) => {
                    let mut ws_val = serde_json::to_value(ws).unwrap_or(Value::Null);
                    if let Value::Object(ref mut map) = ws_val {
                        if let Some(t_path) = ws.thumbnail_local.as_ref() {
                            if !std::path::Path::new(t_path).exists() {
                                map.insert("thumbnailLocal".into(), Value::Null);
                            }
                        }
                    }
                    Ok(ws_val)
                }
                None => Ok(json!({"ok": false, "error": "not found", "id": id})),
            }
        }

        "workspace:managementList" => Ok(load_management_workspaces()),

        "workspace:managementGet" => {
            let id = p(params, "id").unwrap_or_default();
            Ok(load_management_workspace(&id))
        }

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
            let mut bytes_freed: u64 = 0;
            let mut files_deleted: u32 = 0;
            // Look up channel info to find new-path files
            let (cid, cname, _) = lookup_channel_ids(&id);
            let maybe_ws = store.workspaces.iter().find(|w| w.id == id).cloned();

            // Delete downloaded file (try stored path first, then legacy, then new)
            if let Some(ref ws) = maybe_ws {
                if let Some(ref dl_path) = ws.downloaded_path {
                    let p = PathBuf::from(dl_path);
                    if p.exists() {
                        if let Ok(meta) = std::fs::metadata(&p) { bytes_freed += meta.len(); files_deleted += 1; }
                        std::fs::remove_file(&p).ok();
                    }
                }
            }
            // Also try legacy flat path
            let legacy_file = get_video_storage_path().join(format!("{}.mp4", id));
            if legacy_file.exists() {
                if let Ok(meta) = std::fs::metadata(&legacy_file) { bytes_freed += meta.len(); files_deleted += 1; }
                std::fs::remove_file(&legacy_file).ok();
            }

            // Delete render directory (new structure)
            if !cid.is_empty() {
                let render_path = build_render_path(&cid, &cname, &id);
                if render_path.exists() {
                    if let Ok(meta) = std::fs::metadata(&render_path) {
                        bytes_freed += meta.len();
                        files_deleted += 1;
                    }
                }
                let render_dir = render_output_dir(&cid, &cname, &id);
                if render_dir.exists() {
                    std::fs::remove_dir_all(&render_dir).ok();
                }
            }
            // Also try legacy flat output path
            let legacy_out = get_output_path().join(format!("{}.mp4", id));
            if legacy_out.exists() {
                if let Ok(meta) = std::fs::metadata(&legacy_out) { bytes_freed += meta.len(); files_deleted += 1; }
                std::fs::remove_file(&legacy_out).ok();
            }

            store.remove(&id);
            store.save(&ws_path).ok();
            Ok(json!({"success": true, "bytesFreed": bytes_freed, "filesDeleted": files_deleted}))
        }

        "workspace:retry" => {
            let id = p(params, "id").unwrap_or_default();
            let mut video_url = p(params, "url").or_else(|| p(params, "videoUrl")).unwrap_or_default();

            if id.is_empty() {
                return CommandResult::Ok(json!({ "ok": false, "error": "workspace:retry requires id param" }));
            }

            if video_url.is_empty() {
                let ws_path = get_workspaces_path();
                let store = WorkspaceStore::load(&ws_path);
                if let Some(ws) = store.get(&id) {
                    video_url = format!("https://youtube.com/watch?v={}", ws.video_id);
                }
            }

            if video_url.is_empty() {
                return CommandResult::Ok(json!({ "ok": false, "error": "workspace:retry requires url or videoUrl param" }));
            }

            // Use new media structure
            let (cid, cname, _) = lookup_channel_ids(&id);

            // Read quality & trim from settings store, allow param overrides
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);

            let quality: u32 = params.get("quality").and_then(|v| v.as_u64())
                .or_else(|| s_store.settings.get("autoDownloadQuality")
                    .and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok().map(|f| f as u64)))
                .or_else(|| s_store.settings.get("autoDownloadQuality").and_then(|v| v.as_f64()).map(|f| f as u64))
                .or_else(|| s_store.settings.get("autoDownloadQuality").and_then(|v| v.as_u64()))
                .or_else(|| s_store.settings.get("defaultQuality").and_then(|v| v.as_u64()))
                .unwrap_or(1080) as u32;

            let trim_minutes = params.get("trimMinutes").and_then(|v| v.as_u64())
                .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_u64()))
                .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_f64()).map(|f| f as u64))
                .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()).map(|f| f as u64))
                .or_else(|| s_store.settings.get("default_trim_limit_minutes").and_then(|v| v.as_u64()))
                .unwrap_or(10) as u32;

            let timestamp = chrono::Utc::now().timestamp_millis();
            let output_path = if !cid.is_empty() || !cname.is_empty() {
                let video_id = video_url.rsplit('=').next().unwrap_or(&id).to_string();
                build_download_path(&cid, &cname, &video_id, timestamp)
            } else {
                get_video_storage_path().join(format!("{}.mp4", id))
            };

            let output_str = output_path.to_string_lossy().to_string();

            let now_ms = chrono::Utc::now().timestamp_millis();
            let ws_path = get_workspaces_path();
            let mut ws_store = WorkspaceStore::load(&ws_path);
            ws_store.update(&id, serde_json::json!({
                "status": "downloading",
                "downloadStartedAt": now_ms,
            })).ok();
            ws_store.save(&ws_path).ok();

            emit_workspace_event(&id, "downloading", None);

            let tid = id.clone();
            let netscape_path = get_cookies_netscape_path();
            let cookies_str = netscape_path.to_string_lossy().to_string();

            let out_str = output_str.clone();
            let cid2 = cid.clone();
            let cname2 = cname.clone();
            let vid2 = video_url.rsplit('=').next().unwrap_or(&id).to_string();
            let url2 = video_url.clone();

            std::thread::spawn(move || {
                match download_video(&url2, &out_str, &cookies_str, trim_minutes, quality) {
                    Ok(result) => {
                        // Download thumbnail
                        let thumb_path = get_thumbnail_path(&cid2, &cname2, &vid2);
                        let thumb_str = download_youtube_thumbnail_to(&vid2, &thumb_path);

                        // Persist thumbnail, status, downloadedPath and downloadedAt to store
                        let ws_path = get_workspaces_path();
                        let mut ws_store = WorkspaceStore::load(&ws_path);
                        let now_ms = chrono::Utc::now().timestamp_millis();
                        let is_short_val = result.width < result.height || result.duration <= 60.0;
                        let quality_val = result.height;
                        let duration_sec_val = result.duration.round() as u64;
                        let file_size_val = result.file_size;

                        ws_store.update(&tid, serde_json::json!({
                            "thumbnailLocal": thumb_str,
                            "status": "ready",
                            "downloadedPath": result.path,
                            "downloadedAt": now_ms,
                            "isShort": is_short_val,
                            "quality": quality_val,
                            "fileSize": file_size_val,
                            "durationSec": duration_sec_val,
                        })).ok();
                        ws_store.save(&ws_path).ok();

                        tracing::info!("workspace:retry download complete: {} -> {} ({} bytes)",
                            tid, result.path, result.file_size);

                        crate::emit(hyperclip_ipc::IpcResponse::event("workspace:update", serde_json::json!({
                            "id": tid,
                            "status": "ready",
                            "downloadedPath": result.path,
                            "thumbnailLocal": thumb_str,
                            "downloadedAt": now_ms,
                            "isShort": is_short_val,
                            "quality": quality_val,
                            "fileSize": file_size_val,
                            "durationSec": duration_sec_val,
                        })));
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

        // Task 3 (WS3): workspace:autoDownload - triggered from frontend
        "workspace:autoDownload" => {
            let id = p(params, "id").unwrap_or_default();
            let video_url = p(params, "url").or_else(|| p(params, "videoUrl")).unwrap_or_default();
            let netscape_path = get_cookies_netscape_path();

            // Read trim & quality from settings store (not params) — frontend doesn't send these
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            let trim_minutes = params.get("trimMinutes").and_then(|v| v.as_u64())
                .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_u64()))
                .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_f64()).map(|f| f as u64))
                .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()).map(|f| f as u64))
                .or_else(|| s_store.settings.get("default_trim_limit_minutes").and_then(|v| v.as_u64()))
                .unwrap_or(10) as u32;

            let (cid, cname, _) = lookup_channel_ids(&id);
            let timestamp = chrono::Utc::now().timestamp_millis();
            let output_path = if !cid.is_empty() || !cname.is_empty() {
                let video_id = video_url.rsplit('=').next().unwrap_or(&id).to_string();
                build_download_path(&cid, &cname, &video_id, timestamp)
            } else {
                get_video_storage_path().join(format!("{}.mp4", id))
            };
            let output_str = output_path.to_string_lossy().to_string();
            let now_ms = chrono::Utc::now().timestamp_millis();
            let ws_path = get_workspaces_path();
            let mut ws_store = WorkspaceStore::load(&ws_path);
            ws_store.update(&id, serde_json::json!({
                "status": "downloading",
                "downloadStartedAt": now_ms,
            })).ok();
            ws_store.save(&ws_path).ok();

            emit_workspace_event(&id, "downloading", None);
            let tid = id.clone();
            let url = video_url.clone();
            let cookies_str = netscape_path.to_string_lossy().to_string();
            let dl_quality: u32 = params.get("quality").and_then(|v| v.as_u64())
                .or_else(|| s_store.settings.get("autoDownloadQuality")
                    .and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok().map(|f| f as u64)))
                .or_else(|| s_store.settings.get("autoDownloadQuality").and_then(|v| v.as_f64()).map(|f| f as u64))
                .or_else(|| s_store.settings.get("autoDownloadQuality").and_then(|v| v.as_u64()))
                .or_else(|| s_store.settings.get("defaultQuality").and_then(|v| v.as_u64()))
                .unwrap_or(1080) as u32;
            let out_str = output_str.clone();
            let cid2 = cid.clone();
            let cname2 = cname.clone();
            std::thread::spawn(move || {
                download_video_streaming(&url, &out_str, &cookies_str, trim_minutes, dl_quality, |progress| {
                    emit_download_progress(&tid, &progress);
                })
                .map(|result| {
                    tracing::info!("workspace:autoDownload complete: {} -> {} ({} bytes)",
                        tid, result.path, result.file_size);

                    // Download thumbnail to per-channel dir
                    let video_id = url.rsplit('=').next().unwrap_or(&tid).to_string();
                    let thumb_path = get_thumbnail_path(&cid2, &cname2, &video_id);
                    let _ = download_youtube_thumbnail_to(&video_id, &thumb_path);
                    let thumb_str = if thumb_path.exists() { Some(thumb_path.to_string_lossy().to_string()) } else { None };

                    let is_short_val = result.width < result.height || result.duration <= 60.0;
                    let quality_val = result.height;
                    let duration_sec_val = result.duration.round() as u64;
                    let file_size_val = result.file_size;

                    // Update workspace store
                    let ws_path = get_workspaces_path();
                    let mut ws_store = WorkspaceStore::load(&ws_path);
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    ws_store.update(&tid, serde_json::json!({
                        "status": "ready",
                        "downloadedPath": result.path,
                        "thumbnailLocal": thumb_str,
                        "downloadedAt": now_ms,
                        "isShort": is_short_val,
                        "quality": quality_val,
                        "fileSize": file_size_val,
                        "durationSec": duration_sec_val,
                    })).ok();
                    ws_store.save(&ws_path).ok();

                    let event = json!({
                        "method": "workspace:update",
                        "params": {
                            "id": tid,
                            "status": "ready",
                            "downloadedPath": result.path,
                            "downloadedSize": result.file_size,
                            "width": result.width,
                            "height": result.height,
                            "thumbnailLocal": thumb_str,
                            "downloadedAt": now_ms,
                            "isShort": is_short_val,
                            "quality": quality_val,
                            "fileSize": file_size_val,
                            "durationSec": duration_sec_val,
                        }
                    });
                    let s = serde_json::to_string(&event).unwrap();
                    let _ = writeln!(io::stdout(), "{}", s);
                    let _ = io::stdout().flush();

                    // Auto-render after successful download
                    let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
                    let rid = tid.clone();
                    let in_path = out_str.clone();
                    let s_path2 = get_settings_path();
                    let s_store2 = SettingsStore::load(&s_path2);
                    let auto_speed2 = s_store2.settings.get("autoRenderSpeed").or_else(|| s_store2.settings.get("auto_render_speed")).and_then(|v| v.as_f64()).unwrap_or(1.0);
                    let auto_res2 = s_store2.settings.get("autoRenderResolution").or_else(|| s_store2.settings.get("auto_render_resolution")).and_then(|v| v.as_str()).unwrap_or("1080p").to_string();
                    let auto_fps2 = s_store2.settings.get("autoRenderFPS").or_else(|| s_store2.settings.get("auto_render_fps")).and_then(|v| v.as_u64()).unwrap_or(30) as u32;
                    let out_path = build_render_path(&cid2, &cname2, &rid);
                    rt.spawn(async move {
                        // Update database status to rendering
                        let ws_path = get_workspaces_path();
                        let mut ws_store = WorkspaceStore::load(&ws_path);
                        let auto_trim_end = if is_short_val { result.duration.min(60.0) } else { result.duration };
                        let filter_chain = if is_short_val { FilterChain::Short } else { FilterChain::Landscape };
                        ws_store.update(&rid, serde_json::json!({
                            "status": "rendering",
                            "autoRender": true,
                            "videoSpeed": auto_speed2,
                            "fpsTarget": auto_fps2,
                            "exportResolution": auto_res2,
                            "trimStart": 0.0,
                            "trimEnd": auto_trim_end,
                        })).ok();
                        ws_store.save(&ws_path).ok();
                        emit_workspace_event(&rid, "rendering", None);

                        let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                        let _permit = pool.acquire().await;
                        let opts = RenderOptions {
                            workspace_id: rid.clone(),
                            input_path: PathBuf::from(&in_path),
                            output_path: out_path.clone(),
                            resolution: auto_res2,
                            fps: auto_fps2,
                            speed: auto_speed2,
                            trim_start: 0.0, trim_end: auto_trim_end,
                            gpu_tier: get_gpu_config().tier,
                            preset: "p1".into(),
                            filter_chain,
                            chunked: false, chunk_duration_sec: 120,
                        };
                        let pid = rid.clone();
                        let result = spawn_render_async(opts, move |progress| {
                            let e = json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                            let _ = writeln!(io::stdout(), "{}", serde_json::to_string(&e).unwrap());
                            let _ = io::stdout().flush();
                        }).await;
                        if let Err(ref e) = result {
                            tracing::error!("[AppState] Auto-render after download failed for workspace {}: {:?}", rid, e);
                        }
                        let status = if result.is_ok() { "done" } else { "error" };

                        let mut ws_store = WorkspaceStore::load(&ws_path);
                        let mut update_data = serde_json::json!({
                            "status": status,
                        });
                        match &result {
                            Ok((ref final_out_path, fps)) => {
                                update_data["renderedPath"] = serde_json::json!(final_out_path.to_string_lossy().to_string());
                                update_data["renderFps"] = serde_json::json!(fps);
                                
                                let gpu_config = get_gpu_config();
                                let codec = if gpu_config.tier == hyperclip_ipc::system::GPUTier::High {
                                    "hevc_nvenc"
                                } else if matches!(gpu_config.tier, hyperclip_ipc::system::GPUTier::Mid | hyperclip_ipc::system::GPUTier::Low) {
                                    "h264_nvenc"
                                } else {
                                    "libx264"
                                };
                                update_data["renderCodec"] = serde_json::json!(codec);
                                update_data["renderPreset"] = serde_json::json!("p1");
                                update_data["renderWorkers"] = serde_json::json!(gpu_config.max_workers);
                                update_data["error"] = serde_json::Value::Null;
                            }
                            Err(e) => {
                                update_data["error"] = serde_json::json!(e.to_string());
                            }
                        }
                        ws_store.update(&rid, update_data).ok();
                        ws_store.save(&ws_path).ok();

                        emit_workspace_event(&rid, status, result.as_ref().err().map(|e| e.to_string()));
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
            let netscape_path = get_cookies_netscape_path();
            let (cid, cname, _) = lookup_channel_ids(&id);
            let timestamp = chrono::Utc::now().timestamp_millis();
            let output_path = if !cid.is_empty() || !cname.is_empty() {
                let video_id = video_url.rsplit('=').next().unwrap_or(&id).to_string();
                build_download_path(&cid, &cname, &video_id, timestamp)
            } else {
                get_video_storage_path().join(format!("{}.mp4", id))
            };
            let output_str = output_path.to_string_lossy().to_string();
            let now_ms = chrono::Utc::now().timestamp_millis();
            let ws_path = get_workspaces_path();
            let mut ws_store = WorkspaceStore::load(&ws_path);
            ws_store.update(&id, serde_json::json!({
                "status": "downloading",
                "downloadStartedAt": now_ms,
            })).ok();
            ws_store.save(&ws_path).ok();

            emit_workspace_event(&id, "downloading", None);
            let tid = id.clone();
            let url = video_url.clone();
            let cookies_str = netscape_path.to_string_lossy().to_string();
            let out_str = output_str.clone();
            let cid2 = cid.clone();
            let cname2 = cname.clone();
            // Read trim from settings
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            let trim_minutes = s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_u64())
                .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_f64()).map(|f| f as u64))
                .or_else(|| s_store.settings.get("defaultTrimLimit").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()).map(|f| f as u64))
                .or_else(|| s_store.settings.get("default_trim_limit_minutes").and_then(|v| v.as_u64()))
                .unwrap_or(10) as u32;
            std::thread::spawn(move || {
                download_video_streaming(&url, &out_str, &cookies_str, trim_minutes, 1080, |progress| {
                    emit_download_progress(&tid, &progress);
                })
                .map(|result| {
                    // Download thumbnail
                    let video_id = url.rsplit('=').next().unwrap_or(&tid).to_string();
                    let thumb_path = get_thumbnail_path(&cid2, &cname2, &video_id);
                    let _ = download_youtube_thumbnail_to(&video_id, &thumb_path);

                    // Update workspace store
                    let ws_path = get_workspaces_path();
                    let mut ws_store = WorkspaceStore::load(&ws_path);
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    let is_short_val = result.width < result.height || result.duration <= 60.0;
                    let quality_val = result.height;
                    let duration_sec_val = result.duration.round() as u64;
                    let file_size_val = result.file_size;

                    ws_store.update(&tid, serde_json::json!({
                        "status": "ready",
                        "downloadedAt": now_ms,
                        "isShort": is_short_val,
                        "quality": quality_val,
                        "fileSize": file_size_val,
                        "durationSec": duration_sec_val,
                    })).ok();
                    ws_store.save(&ws_path).ok();

                    emit_workspace_event(&tid, "ready", None);
                    tracing::info!("redownloadHd complete: {} ({}x{}, {} bytes)",
                        tid, result.width, result.height, result.file_size);
                    // Auto-render after redownload
                    let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
                    let rid = tid.clone();
                    let in_path = out_str.clone();
                    let out_path = build_render_path(&cid2, &cname2, &rid);
                    rt.spawn(async move {
                        let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                        let _permit = pool.acquire().await;
                        let auto_trim_end = if is_short_val { result.duration.min(60.0) } else { result.duration };
                        let filter_chain = if is_short_val { FilterChain::Short } else { FilterChain::Landscape };
                        let opts = RenderOptions {
                            workspace_id: rid.clone(),
                            input_path: PathBuf::from(&in_path),
                            output_path: out_path.clone(),
                            resolution: "1080p".into(),
                            fps: 30, speed: 1.0,
                            trim_start: 0.0, trim_end: auto_trim_end,
                            gpu_tier: get_gpu_config().tier,
                            preset: "p1".into(),
                            filter_chain,
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
                let auto_render = params.get("autoRender").and_then(|v| v.as_bool()).unwrap_or(false);
                let render_res = params.get("renderResolution").and_then(|v| v.as_str()).unwrap_or("1080p").to_string();
                let render_fps = params.get("renderFPS").and_then(|v| v.as_u64()).unwrap_or(30) as u32;
                let render_speed = params.get("renderSpeed").and_then(|v| v.as_f64()).unwrap_or(1.0);

                for (i, part) in parts.iter().enumerate() {
                    let new_id = format!("{}-part{}", id, i + 1);
                    let trim_start = part.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let trim_end = part.get("end").and_then(|v| v.as_f64()).unwrap_or(60.0);
                    let custom_title = part.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    let mut new_ws = src.clone();
                    new_ws.id = new_id.clone();
                    new_ws.title = if !custom_title.is_empty() {
                        format!("{} - {}", src.title, custom_title)
                    } else {
                        format!("{} (Part {})", src.title, i + 1)
                    };
                    new_ws.trim_start = trim_start;
                    new_ws.trim_end = trim_end;
                    new_ws.status = if auto_render { "downloading" } else { "ready" }.to_string();
                    new_ws.auto_render = auto_render;
                    new_ws.fps_target = render_fps;
                    new_ws.export_resolution = render_res.clone();
                    new_ws.video_speed = render_speed;
                    store.add(new_ws);

                    // Trigger auto-render for each part
                    if auto_render {
                        let rid = new_id.clone();
                        let in_path = get_video_storage_path().join(format!("{}.mp4", id));
                        let (cid_split, cname_split, _) = lookup_channel_ids(&id);
                        let out_path = if !cid_split.is_empty() || !cname_split.is_empty() {
                            build_render_path(&cid_split, &cname_split, &rid)
                        } else {
                            let legacy_out = get_legacy_output_dir();
                            std::fs::create_dir_all(&legacy_out).ok();
                            legacy_out.join(format!("{}.mp4", rid))
                        };
                        let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
                        let res = render_res.clone();
                        let fps = render_fps;
                        let speed = render_speed;
                        let src_is_short = src.is_short;
                        rt.spawn(async move {
                            let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                            let _permit = pool.acquire().await;
                            let opts = RenderOptions {
                                workspace_id: rid.clone(),
                                input_path: in_path.clone(),
                                output_path: out_path.clone(),
                                resolution: res,
                                fps,
                                speed,
                                trim_start, trim_end,
                                gpu_tier: get_gpu_config().tier,
                                preset: "p1".into(),
                                filter_chain: if src_is_short { FilterChain::Short } else { FilterChain::Landscape },
                                chunked: false, chunk_duration_sec: 120,
                            };
                            let pid = rid.clone();
                            let result = spawn_render_async(opts, move |progress| {
                                let e = serde_json::json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                                let _ = writeln!(io::stdout(), "{}", serde_json::to_string(&e).unwrap());
                                let _ = io::stdout().flush();
                            }).await;
                            let event_method = if result.is_ok() { "done" } else { "error" };
                            let err_msg = result.as_ref().err().map(|e| e.to_string());
                            emit_workspace_event(&rid, event_method, err_msg);
                        });
                    }

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
            let (cid, cname, _) = lookup_channel_ids(&id);
            let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
            rt.spawn(async move {
                let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                let _permit = pool.acquire().await;
                let out_path = if !cid.is_empty() || !cname.is_empty() {
                    build_render_path(&cid, &cname, &tid)
                } else {
                    let legacy_out = get_legacy_output_dir();
                    std::fs::create_dir_all(&legacy_out).ok();
                    legacy_out.join(format!("{}.mp4", tid))
                };
                // Resolve real input path from workspace store
                let ws_path = get_workspaces_path();
                let mut store = WorkspaceStore::load(&ws_path);

                let ws_speed = store.workspaces.iter().find(|w| w.id == tid).map(|w| w.video_speed).unwrap_or(1.0);
                let ws_trim_start = store.workspaces.iter().find(|w| w.id == tid).map(|w| w.trim_start).unwrap_or(0.0);
                let ws_trim_end = store.workspaces.iter().find(|w| w.id == tid).map(|w| w.trim_end).unwrap_or(60.0);
                let ws_resolution = store.workspaces.iter().find(|w| w.id == tid).and_then(|w| {
                    if w.export_resolution.is_empty() { None } else { Some(w.export_resolution.clone()) }
                }).unwrap_or_else(|| "1080p".to_string());
                let ws_fps = store.workspaces.iter().find(|w| w.id == tid).map(|w| w.fps_target).unwrap_or(30);
                let ws_is_short = store.workspaces.iter().find(|w| w.id == tid).map(|w| w.is_short).unwrap_or(false);

                store.update(&tid, serde_json::json!({
                    "status": "rendering",
                    "videoSpeed": ws_speed,
                    "fpsTarget": ws_fps,
                    "exportResolution": ws_resolution,
                    "trimStart": ws_trim_start,
                    "trimEnd": ws_trim_end,
                })).ok();
                store.save(&ws_path).ok();
                emit_workspace_event(&tid, "rendering", None);

                let workspace = store.workspaces.iter().find(|w| w.id == tid);
                let input_path = match workspace.and_then(|w| w.downloaded_path.clone()) {
                    Some(path) => PathBuf::from(path),
                    None => {
                        let vid_dir = get_video_storage_path();
                        let mut found = vid_dir.join(format!("{}.mp4", tid));
                        if !found.exists() {
                            if let Ok(entries) = std::fs::read_dir(&vid_dir) {
                                for entry in entries.flatten() {
                                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                                        let candidate = entry.path().join(format!("{}.mp4", tid));
                                        if candidate.exists() { found = candidate; break; }
                                    }
                                }
                            }
                        }
                        found
                    }
                };
                let tid_for_progress = tid.clone();
                let opts = RenderOptions {
                    workspace_id: tid_for_progress.clone(),
                    input_path: input_path.clone(),
                    output_path: out_path.clone(),
                    resolution: ws_resolution,
                    fps: ws_fps,
                    speed: ws_speed,
                    trim_start: ws_trim_start,
                    trim_end: ws_trim_end,
                    gpu_tier: get_gpu_config().tier,
                    preset: "p1".into(),
                    filter_chain: if ws_is_short { FilterChain::Short } else { FilterChain::Landscape },
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
                if let Err(ref e) = result {
                    tracing::error!("[AppState] Manual render failed for workspace {}: {:?}", tid, e);
                }
                let status = if result.is_ok() { "done" } else { "error" };
                let mut store = WorkspaceStore::load(&ws_path);
                let mut update_data = serde_json::json!({
                    "status": status,
                });
                match &result {
                    Ok((ref final_out_path, fps)) => {
                        update_data["renderedPath"] = serde_json::json!(final_out_path.to_string_lossy().to_string());
                        update_data["renderFps"] = serde_json::json!(fps);
                        
                        let gpu_config = get_gpu_config();
                        let codec = if gpu_config.tier == hyperclip_ipc::system::GPUTier::High {
                            "hevc_nvenc"
                        } else if matches!(gpu_config.tier, hyperclip_ipc::system::GPUTier::Mid | hyperclip_ipc::system::GPUTier::Low) {
                            "h264_nvenc"
                        } else {
                            "libx264"
                        };
                        update_data["renderCodec"] = serde_json::json!(codec);
                        update_data["renderPreset"] = serde_json::json!("p1");
                        update_data["renderWorkers"] = serde_json::json!(gpu_config.max_workers);
                        update_data["error"] = serde_json::Value::Null;
                    }
                    Err(e) => {
                        update_data["error"] = serde_json::json!(e.to_string());
                    }
                }
                store.update(&tid, update_data).ok();
                store.save(&ws_path).ok();
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
            let mut store = WorkspaceStore::load(&ws_path);
            let ws_speed = store.workspaces.iter().find(|w| w.id == id).map(|w| w.video_speed).unwrap_or(1.0);
            let ws_trim_start = store.workspaces.iter().find(|w| w.id == id).map(|w| w.trim_start).unwrap_or(0.0);
            let ws_trim_end = store.workspaces.iter().find(|w| w.id == id).map(|w| w.trim_end).unwrap_or(chunk_duration as f64);
            let ws_resolution = store.workspaces.iter().find(|w| w.id == id).and_then(|w| {
                if w.export_resolution.is_empty() { None } else { Some(w.export_resolution.clone()) }
            }).unwrap_or_else(|| "1080p".to_string());
            let ws_fps = store.workspaces.iter().find(|w| w.id == id).map(|w| w.fps_target).unwrap_or(30);
            let ws_is_short = store.workspaces.iter().find(|w| w.id == id).map(|w| w.is_short).unwrap_or(false);

            store.update(&id, serde_json::json!({
                "status": "rendering",
                "videoSpeed": ws_speed,
                "fpsTarget": ws_fps,
                "exportResolution": ws_resolution,
                "trimStart": ws_trim_start,
                "trimEnd": ws_trim_end,
            })).ok();
            store.save(&ws_path).ok();
            emit_workspace_event(&id, "rendering", None);

            let workspace = store.workspaces.iter().find(|w| w.id == id);
            let input_path = match workspace.and_then(|w| w.downloaded_path.clone()) {
                Some(path) => PathBuf::from(path),
                None => get_video_storage_path().join(format!("{}.mp4", id)),
            };
            if !input_path.exists() {
                return CommandResult::Err("input file not found for chunked render".into());
            }
            let (cid, cname, _) = lookup_channel_ids(&id);
            let out_path = if !cid.is_empty() || !cname.is_empty() {
                build_render_path(&cid, &cname, &id)
            } else {
                let legacy_out = get_legacy_output_dir();
                std::fs::create_dir_all(&legacy_out).ok();
                legacy_out.join(format!("{}.mp4", id))
            };
            let tid = id.clone();
            let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
            rt.spawn(async move {
                let pool = WORKER_POOL.get_or_init(|| WorkerPool::new(get_gpu_config().max_workers as usize));
                let _permit = pool.acquire().await;
                let opts = RenderOptions {
                    workspace_id: tid.clone(),
                    input_path,
                    output_path: out_path,
                    resolution: ws_resolution,
                    fps: ws_fps, speed: ws_speed,
                    trim_start: ws_trim_start, trim_end: ws_trim_end,
                    gpu_tier: get_gpu_config().tier,
                    preset: "p1".into(),
                    filter_chain: if ws_is_short { FilterChain::Short } else { FilterChain::Landscape },
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

        "rendered:get" => {
            let id = p(params, "id").unwrap_or_default();
            let store = RenderedStore::load(&get_rendered_videos_path());
            match store.get(&id) {
                Some(v) => Ok(json!(v)),
                None => Ok(json!({"ok": false, "error": "not found", "id": id})),
            }
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
            let out_dir = get_legacy_output_dir();
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
            let media_dir = get_media_dir();
            let base_dir = get_video_storage_path();
            let out_dir = get_legacy_output_dir();
            let blur_dir = base_dir.join("blur");
            let mut downloads = dir_size_internal(&base_dir);
            // Also scan per-channel subdirectories (legacy flat structure)
            if let Ok(entries) = std::fs::read_dir(&base_dir) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) && entry.file_name() != "blur" {
                        downloads += dir_size_internal(&entry.path());
                    }
                }
            }
            // New media structure
            let media_downloads = if media_dir.exists() {
                let mut total = 0u64;
                if let Ok(entries) = std::fs::read_dir(&media_dir) {
                    for entry in entries.flatten() {
                        let dl_dir = entry.path().join("downloads");
                        if dl_dir.exists() {
                            total += dir_size_internal(&dl_dir);
                        }
                    }
                }
                total
            } else { 0u64 };
            let blur_size = dir_size_internal(&blur_dir);
            let output = if media_dir.exists() {
                let mut total = dir_size_internal(&out_dir);
                if let Ok(entries) = std::fs::read_dir(&media_dir) {
                    for entry in entries.flatten() {
                        let render_dir = entry.path().join("renders");
                        if render_dir.exists() {
                            total += dir_size_internal(&render_dir);
                        }
                    }
                }
                total
            } else {
                dir_size_internal(&out_dir)
            };
            Ok(json!({
                "downloads": downloads + media_downloads, "blur": blur_size, "total": downloads + media_downloads + output,
                "downloadPath": base_dir.to_string_lossy().to_string(),
                "outputPath": out_dir.to_string_lossy().to_string(),
            }))
        }

        "storage:clearDownloads" => {
            let video_dir = get_video_storage_path();
            let mut freed = 0u64;
            // Delete files in flat dir
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
            // Delete files in per-channel subdirectories
            if let Ok(entries) = std::fs::read_dir(&video_dir) {
                for entry in entries.flatten() {
                    if let Ok(file_type) = entry.file_type() {
                        if file_type.is_dir() {
                            if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
                                for sub in sub_entries.flatten() {
                                    if let Ok(meta) = sub.metadata() {
                                        if meta.is_file() {
                                            freed += meta.len();
                                            std::fs::remove_file(sub.path()).ok();
                                        }
                                    }
                                }
                            }
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
            let pool = &AppState::get_or_init().pool;
            let is_ready = pool.is_session_logged_in(0); // Profile 1 maps to slot 0
            let cookie_str = pool.get_session_cookie_string(0);
            let cookie_count = if cookie_str.is_empty() {
                0
            } else {
                cookie_str.matches(';').count() + 1
            };

            Ok(json!({
                "isReady": is_ready,
                "cookieCount": cookie_count,
                "loggedOut": !is_ready,
                "accountName": "HyperClip-Profile-1",
                "oauthReady": false,
            }))
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
            launch_chrome_profile_async("HyperClip-Profile-1");
            let pool = &AppState::get_or_init().pool;
            let is_ready = pool.is_session_logged_in(0);
            let cookie_str = pool.get_session_cookie_string(0);
            let cookie_count = if cookie_str.is_empty() {
                0
            } else {
                cookie_str.matches(';').count() + 1
            };
            Ok(json!({
                "isReady": is_ready,
                "cookieCount": cookie_count,
                "loggedOut": !is_ready,
                "accountName": "HyperClip-Profile-1",
                "oauthReady": false,
                "cookieCritical": false,
            }))
        }

        "auth:startChromeLogin" => {
            let profile = p(params, "profile").unwrap_or_else(|| "Default".to_string());
            launch_chrome_profile_async(&profile);
            Ok(json!({"success": true, "profileId": profile}))
        }

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
            let pool = &AppState::get_or_init().pool;
            let mut logged_in_count = 0u64;
            let mut consented_count = 0u64;
            let mut sessions = Vec::new();

            for i in 1..=30 {
                let profile_id = format!("HyperClip-Profile-{}", i);
                let profile_sapisid_ok = pool.is_session_logged_in(i - 1);

                if profile_sapisid_ok {
                    logged_in_count += 1;
                    consented_count += 1;
                }

                sessions.push(json!({
                    "profileId": profile_id,
                    "profileName": format!("Profile {}", i),
                    "isLoggedIn": profile_sapisid_ok,
                    "isConsented": profile_sapisid_ok,
                    "usedToday": 0i64,
                    "lastUsed": 0i64,
                    "error": "",
                    "refreshFailCount": 0u64,
                    "hasCookies": profile_sapisid_ok,
                }));
            }

            let ready_ok = AppState::get_or_init().pool.ready_count() > 0 && logged_in_count > 0;
            let health_pct = ((logged_in_count * 100) / 30) as u64;
            let level = if logged_in_count >= 15 {
                "healthy"
            } else if logged_in_count > 0 {
                "degraded"
            } else {
                "critical"
            };

            Ok(json!({
                "ready": ready_ok,
                "sessionCount": 30u64,
                "loggedInCount": logged_in_count,
                "consentedCount": consented_count,
                "sessions": sessions,
                "health": {
                    "healthPct": health_pct,
                    "degradedCount": (30u64 - logged_in_count),
                    "staleCount": 0u64,
                    "oldestCookieAgeHours": 0u64,
                    "level": level,
                },
            }))
        }

        "session:refreshAll" => {
            match refresh_all_profiles_cookies() {
                Ok(count) => Ok(json!({"success": true, "refreshedCount": count})),
                Err(e) => {
                    tracing::error!("[session:refreshAll] {}", e);
                    Ok(json!({"success": false, "refreshedCount": 0, "error": e}))
                }
            }
        }

        "session:openLogin" => {
            let profile = p(params, "profileId").unwrap_or_else(|| "Default".to_string());
            launch_chrome_profile_async(&profile);
            Ok(json!({"success": true, "profileId": profile}))
        }

        "session:cloneOne" => {
            let profile = p(params, "profileId").unwrap_or_else(|| "Default".to_string());
            match extract_profile_cookies_and_feed(&profile) {
                Ok(_) => Ok(json!({"success": true, "clonedCount": 1})),
                Err(e) => Ok(json!({"success": false, "error": e})),
            }
        }

        "session:add" => {
            let profile = p(params, "profileId").unwrap_or_else(|| "Default".to_string());
            match extract_profile_cookies_and_feed(&profile) {
                Ok(_) => Ok(json!({"success": true, "profileId": profile})),
                Err(e) => Ok(json!({"success": false, "error": e})),
            }
        }



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
            // Check polling_enabled setting
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            let polling_enabled = s_store.settings.get("pollingEnabled").and_then(|v| v.as_bool()).unwrap_or(false);

            if polling_enabled {
                AppState::get_or_init().start_poller();
                Ok(json!({ "ok": true, "active": true }))
            } else {
                Ok(json!({ "ok": false, "active": false, "error": "polling_enabled is false in settings" }))
            }
        }

        "poller:stop" => {

            AppState::get_or_init().stop_poller();

            Ok(json!({ "ok": true, "active": false }))

        }

        "poller:status" => {

            let state = AppState::get_or_init();
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            let _max_age = s_store.settings.get("autoDownloadMaxAgeMinutes").and_then(|v| v.as_u64()).unwrap_or(1440);
            let poll_int = s_store.settings.get("pollIntervalMs").and_then(|v| v.as_u64()).unwrap_or(5000);
            let _min_dur = s_store.settings.get("videoMinDurationSec").and_then(|v| v.as_u64()).unwrap_or(60);

            let last_poll_at = chrono::Utc::now().timestamp_millis();

            Ok(json!({

                "active": state.poller_active(),

                "pollIntervalMs": poll_int,

                "lastPollAt": last_poll_at,

                "newVideoCount": state.detections_today() as u64,

                "lastError": "",

                "innertubeDegraded": state.pool_ready_count() == 0,

                "lastDetectionLatencyMs": state.last_detection_latency(),

                "detectionsToday": state.detections_today(),

                "averageLatencyMs": state.average_latency(),

                "slaPercent": state.sla_percent(),

            }))

        }

        "detection:history" => {

            let state = AppState::get_or_init();
            let events = state.detection_events();
            // Transform to camelCase for Python/QML compatibility
            let transformed: Vec<serde_json::Value> = events.into_iter().map(|e| {
                json!({
                    "wsId": e.ws_id,
                    "videoId": e.video_id,
                    "title": e.title,
                    "channelName": e.channel_name,
                    "publishedAt": e.published_at,
                    "detectedAt": e.detected_at,
                    "latencyMs": e.latency_ms,
                    "durationSec": e.duration_sec,
                    "status": e.status,
                })
            }).collect();
            Ok(json!({ "events": transformed }))

        }

        "poller:resume" => {
            // Check polling_enabled setting
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            let polling_enabled = s_store.settings.get("pollingEnabled").and_then(|v| v.as_bool()).unwrap_or(false);

            if polling_enabled {
                AppState::get_or_init().start_poller();
                Ok(json!({ "success": true }))
            } else {
                Ok(json!({ "success": false, "error": "polling_enabled is false in settings" }))
            }
        }



        // ─── Resource alerts ────────────────────────────────────────

        "resource:alert" => {
            Ok(json!({"level": "ok", "freeDiskGB": 10.0}))
        }



        // ─── Logs ───────────────────────────────────────────────────

        "logs:read" => {
            let log_dir = get_logs_dir();
            let file_param = p(params, "file").unwrap_or_default();
            let max_lines = p_u64(params, "max_lines").unwrap_or(500) as usize;

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

                let target_file = if file_param.is_empty() {
                    files.first().cloned()
                } else {
                    Some(file_param)
                };

                if let Some(fname) = target_file {
                    let log_path = log_dir.join(&fname);
                    if let Ok(content) = std::fs::read_to_string(&log_path) {
                        entries = content.lines().rev().take(max_lines).map(|l| l.to_string()).collect::<Vec<_>>();
                        entries.reverse();
                    }
                }
            }
            Ok(json!({"files": files, "entries": entries}))
        }

        "logs:export" => {
            let log_dir = get_logs_dir();
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

        "logs:list" => {
            let log_dir = get_logs_dir();
            let mut files = vec![];
            if log_dir.exists() {
                for entry in std::fs::read_dir(&log_dir).into_iter().flatten() {
                    if let Ok(e) = entry {
                        if let Ok(meta) = e.metadata() {
                            if meta.is_file() {
                                let modified = meta.modified().ok()
                                    .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs())
                                    .unwrap_or(0);
                                files.push(json!({
                                    "name": e.file_name().to_string_lossy().to_string(),
                                    "size": meta.len(),
                                    "modified": modified,
                                }));
                            }
                        }
                    }
                }
            }
            files.sort_by(|a, b| b["modified"].as_u64().unwrap_or(0).cmp(&a["modified"].as_u64().unwrap_or(0)));
            Ok(json!({"files": files}))
        }

        "logs:diskUsage" => {
            let log_dir = get_logs_dir();
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
            let log_dir = get_logs_dir();
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
            // Read saved hardware profile from settings
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            let active = s_store.settings.get("hardwareProfile")
                .and_then(|v| v.get("vramGB"))
                .and_then(|v| v.as_u64())
                .map(|v| match v {
                    16 => "ultra",
                    12 => "high",
                    8 => "medium",
                    6 => "low",
                    4 => "minimal",
                    _ => "low",
                })
                .unwrap_or("low");
            Ok(json!({
                "detected": {
                    "vramGB": stats.vram_total_gb,
                    "ramGB": (stats.ram_total / (1024 * 1024 * 1024)) as u32,
                    "gpuName": stats.gpu_name,
                },
                "active": active,
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



/// Resolve channel metadata via yt-dlp
fn resolve_channel_metadata(url: &str) -> (Option<String>, Option<String>, Option<String>) {
    let ytdlp = find_ytdlp();
    let output = std::process::Command::new(&ytdlp)
        .args([
            "--no-warnings",
            "--skip-download",
            "--dump-json",
            "--extractor-args",
            "youtube:player_client=web",
            url,
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&s) {
                let name = data.get("channel").and_then(|v| v.as_str()).map(String::from);
                let channel_id = data.get("channel_id").and_then(|v| v.as_str()).map(String::from);
                let avatar = data.get("thumbnail").and_then(|v| v.as_str()).map(String::from);
                return (name, channel_id, avatar);
            }
            (None, None, None)
        }
        _ => (None, None, None),
    }
}

fn find_ytdlp() -> String {
    let candidates = [
        "C:/Users/MSI/AppData/Roaming/Python/Python312/Scripts/yt-dlp.exe",
        "C:/Users/MSI/AppData/Roaming/Python/Python313/Scripts/yt-dlp.exe",
        "C:/Users/MSI/AppData/Roaming/Python/Python314/Scripts/yt-dlp.exe",
        "yt-dlp",
    ];
    for p in &candidates {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    "yt-dlp".to_string()
}

fn load_workspaces() -> Value {
    let store = WorkspaceStore::load(&get_workspaces_path());
    let mut workspaces_enriched = Vec::new();
    for ws in &store.workspaces {
        let mut ws_val = serde_json::to_value(ws).unwrap_or(Value::Null);
        if let Value::Object(ref mut map) = ws_val {
            if let Some(t_path) = ws.thumbnail_local.as_ref() {
                if !std::path::Path::new(t_path).exists() {
                    map.insert("thumbnailLocal".into(), Value::Null);
                }
            }
        }
        workspaces_enriched.push(ws_val);
    }
    json!({ "workspaces": workspaces_enriched })
}

/// Stat a file and return its modified time as Unix millis. Returns `None` if
/// the path is missing or unreadable.
fn file_mtime_ms(path: &Option<String>) -> Option<i64> {
    let p = path.as_ref()?;
    let meta = std::fs::metadata(p).ok()?;
    let modified = meta.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

/// Enrich a workspace with computed timing fields for the Management page:
/// - `downloadedMtime` / `renderedMtime`: file mtime in epoch ms (stat the disk path)
/// - `downloadDurationSec`: seconds from `createdAt` to download completion
/// - `renderDurationSec`: seconds from download completion to render completion
fn enrich_workspace_for_management(ws: &hyperclip_ipc::store::Workspace) -> Value {
    let downloaded_mtime = file_mtime_ms(&ws.downloaded_path);
    let rendered_mtime = file_mtime_ms(&ws.rendered_path);

    // Pick the best "download finished" timestamp: file mtime takes priority,
    // fall back to the persisted downloadedAt (set by the download flow).
    let download_finished = downloaded_mtime.or(ws.downloaded_at);
    // Use download_started_at as the start time, fall back to created_at if not set.
    let download_start = ws.download_started_at.unwrap_or(ws.created_at);
    let download_duration_sec = match download_finished {
        Some(t) if download_start > 0 => ((t - download_start).max(0) as f64) / 1000.0,
        _ => 0.0,
    };
    let render_duration_sec = match (download_finished, rendered_mtime) {
        (Some(d), Some(r)) if r > d => ((r - d) as f64) / 1000.0,
        _ => 0.0,
    };
    let detection_duration_sec = ((ws.created_at - ws.published_at).max(0) as f64) / 1000.0;

    // Merge persisted workspace fields + computed enrichments into a single JSON object.
    let base = serde_json::to_value(ws).unwrap_or(Value::Null);
    if let Value::Object(mut map) = base {
        // Verify local thumbnail exists on disk, otherwise nullify to force fallback
        if let Some(t_path) = ws.thumbnail_local.as_ref() {
            if !std::path::Path::new(t_path).exists() {
                map.insert("thumbnailLocal".into(), Value::Null);
            }
        }
        map.insert("downloadedMtime".into(), json!(downloaded_mtime));
        map.insert("renderedMtime".into(), json!(rendered_mtime));
        map.insert("downloadDurationSec".into(), json!(download_duration_sec));
        map.insert("renderDurationSec".into(), json!(render_duration_sec));
        map.insert("detectionDurationSec".into(), json!(detection_duration_sec));
        Value::Object(map)
    } else {
        base
    }
}

/// Management page: list workspaces from the last 24h, sorted newest-first,
/// with computed timing fields attached.
fn load_management_workspaces() -> Value {
    let store = WorkspaceStore::load(&get_workspaces_path());
    let now_ms = chrono::Utc::now().timestamp_millis();
    let cutoff = now_ms - 24 * 60 * 60 * 1000;

    let mut recent: Vec<&hyperclip_ipc::store::Workspace> = store
        .workspaces
        .iter()
        .filter(|w| w.created_at >= cutoff)
        .collect();
    // Newest first.
    recent.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    let enriched: Vec<Value> = recent
        .iter()
        .map(|w| enrich_workspace_for_management(w))
        .collect();

    json!({
        "workspaces": enriched,
        "count": enriched.len(),
        "cutoff_ms": cutoff,
        "now_ms": now_ms,
    })
}

/// Management page: enriched detail for a single workspace id.
fn load_management_workspace(id: &str) -> Value {
    let store = WorkspaceStore::load(&get_workspaces_path());
    match store.workspaces.iter().find(|w| w.id == id) {
        Some(ws) => enrich_workspace_for_management(ws),
        None => json!({"ok": false, "error": "not found", "id": id}),
    }
}



fn load_channels() -> Value {

    let store = ChannelStore::load(&get_channels_path());

    json!({ "channels": store.channels })

}

// Helper: copy directory recursively
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(&entry.path(), &target)?;
        }
    }
    Ok(())
}

// Helper: move file or directory safely (handles cross-device renames)
fn move_file_or_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    // Fallback for cross-device copy/move
    if src.is_dir() {
        copy_dir_all(src, dst)?;
        std::fs::remove_dir_all(src)?;
    } else {
        std::fs::copy(src, dst)?;
        std::fs::remove_file(src)?;
    }
    Ok(())
}

/// Reorganize channel folders in data/media to match sanitized channel names,
/// rename video files to include readable timestamps, and update workspaces.json path references.
fn migrate_media_folders_and_workspaces() {
    use chrono::TimeZone;
    tracing::info!("[Migrate] Starting channel folders and video timestamps migration...");

    let ch_path = get_channels_path();
    let ws_path = get_workspaces_path();
    let media_dir = get_media_dir();

    if !media_dir.exists() {
        tracing::debug!("[Migrate] Media directory {:?} does not exist, skipping migration", media_dir);
        return;
    }

    // 1. Build map of channel_id -> channel_name
    let mut channel_names: HashMap<String, String> = HashMap::new();

    // From channels.json
    if ch_path.exists() {
        let ch_store = ChannelStore::load(&ch_path);
        for ch in &ch_store.channels {
            if !ch.id.is_empty() && !ch.name.is_empty() {
                channel_names.insert(ch.id.clone(), ch.name.clone());
            }
        }
    }

    // From workspaces.json
    let mut ws_store = if ws_path.exists() {
        WorkspaceStore::load(&ws_path)
    } else {
        WorkspaceStore::default()
    };

    for ws in &ws_store.workspaces {
        if !ws.channel_id.is_empty() {
            if let Some(ref name) = ws.channel_name {
                if !name.is_empty() {
                    channel_names.insert(ws.channel_id.clone(), name.clone());
                }
            }
        }
    }

    // 2. Scan media directory and rename/merge channel ID folders to sanitized channel names
    if let Ok(entries) = std::fs::read_dir(&media_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let old_name = entry.file_name().to_string_lossy().to_string();
                if let Some(ch_name) = channel_names.get(&old_name) {
                    let sanitized = hyperclip_ipc::sanitize_dir_name(ch_name);
                    if !sanitized.is_empty() && sanitized != old_name {
                        let old_path = media_dir.join(&old_name);
                        let target_path = media_dir.join(&sanitized);
                        tracing::info!("[Migrate] Found directory matching channel ID: {:?} -> {:?}", old_path, target_path);

                        if !target_path.exists() {
                            if let Err(e) = move_file_or_dir(&old_path, &target_path) {
                                tracing::error!("[Migrate] Failed to rename folder from {:?} to {:?}: {}", old_path, target_path, e);
                            } else {
                                tracing::info!("[Migrate] Successfully renamed folder to {:?}", target_path);
                            }
                        } else {
                            // Merge old folder into target folder
                            tracing::info!("[Migrate] Target folder already exists, merging contents of {:?} into {:?}", old_path, target_path);
                            if let Err(e) = copy_dir_all(&old_path, &target_path) {
                                tracing::error!("[Migrate] Failed to merge folder contents: {}", e);
                            } else {
                                let _ = std::fs::remove_dir_all(&old_path);
                                tracing::info!("[Migrate] Successfully merged and removed {:?}", old_path);
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Update paths and file names for workspaces
    let mut db_updated = false;

    for ws in &mut ws_store.workspaces {
        // Resolve sanitized channel name
        let ch_name = ws.channel_name.clone().unwrap_or_default();
        let sanitized_ch = hyperclip_ipc::sanitize_dir_name(&ch_name);
        let ch_folder = if !sanitized_ch.is_empty() {
            sanitized_ch
        } else if !ws.channel_id.is_empty() {
            ws.channel_id.clone()
        } else {
            "unknown".to_string()
        };

        // 3.1 Update downloadedPath & rename downloaded video file
        if let Some(ref old_path_str) = ws.downloaded_path {
            let old_path = PathBuf::from(old_path_str);
            let filename = old_path.file_name().and_then(|f| f.to_str()).unwrap_or("");
            
            // Check if the filename contains a 13-digit raw timestamp (e.g. video_id_1781352739519.mp4)
            let mut timestamp_ms: Option<i64> = None;
            if filename.ends_with(".mp4") && filename.contains('_') {
                let stem = &filename[..filename.len() - 4]; // remove .mp4
                if let Some(last_underscore_idx) = stem.rfind('_') {
                    let suffix = &stem[last_underscore_idx + 1..];
                    if suffix.len() == 13 {
                        if let Ok(ms) = suffix.parse::<i64>() {
                            timestamp_ms = Some(ms);
                        }
                    }
                }
            }

            // Convert to human readable date-time stamp or fallback to creation time
            let time_str = if let Some(ms) = timestamp_ms.or(ws.downloaded_at).or(Some(ws.created_at)) {
                let datetime = match chrono::Utc.timestamp_millis_opt(ms) {
                    chrono::LocalResult::Single(dt) => dt,
                    _ => chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::UNIX_EPOCH),
                };
                datetime.format("%Y%m%d_%H%M%S").to_string()
            } else {
                "unknown".to_string()
            };

            let new_filename = format!("{}_{}.mp4", ws.video_id, time_str);
            let target_dl_path = media_dir
                .join(&ch_folder)
                .join("downloads")
                .join(&new_filename);

            // Find where the source file actually is, since the channel directory might have been renamed
            let mut source_path_opt: Option<PathBuf> = None;
            if old_path.exists() {
                source_path_opt = Some(old_path.clone());
            } else {
                let alt_path = media_dir
                    .join(&ch_folder)
                    .join("downloads")
                    .join(filename);
                if alt_path.exists() {
                    source_path_opt = Some(alt_path);
                }
            }

            if let Some(source_path) = source_path_opt {
                if source_path != target_dl_path {
                    tracing::info!("[Migrate] Renaming downloaded video: {:?} -> {:?}", source_path, target_dl_path);
                    if let Err(e) = move_file_or_dir(&source_path, &target_dl_path) {
                        tracing::error!("[Migrate] Failed to rename downloaded video: {}", e);
                    }
                }
            }

            // Always update database entry path
            let target_dl_str = target_dl_path.to_string_lossy().to_string();
            if ws.downloaded_path.as_ref() != Some(&target_dl_str) {
                ws.downloaded_path = Some(target_dl_str);
                db_updated = true;
            }
        }

        // 3.2 Update thumbnailLocal & rename thumbnail file
        if let Some(ref old_path_str) = ws.thumbnail_local {
            let old_path = PathBuf::from(old_path_str);
            let filename = old_path.file_name().and_then(|f| f.to_str()).unwrap_or("");
            let target_thumb_path = media_dir
                .join(&ch_folder)
                .join("thumbnails")
                .join(format!("{}.jpg", ws.video_id));

            let mut source_path_opt: Option<PathBuf> = None;
            if old_path.exists() {
                source_path_opt = Some(old_path.clone());
            } else {
                let alt_path = media_dir
                    .join(&ch_folder)
                    .join("thumbnails")
                    .join(filename);
                if alt_path.exists() {
                    source_path_opt = Some(alt_path);
                }
            }

            if let Some(source_path) = source_path_opt {
                if source_path != target_thumb_path {
                    tracing::info!("[Migrate] Renaming thumbnail: {:?} -> {:?}", source_path, target_thumb_path);
                    let _ = move_file_or_dir(&source_path, &target_thumb_path);
                }
            }

            let target_thumb_str = target_thumb_path.to_string_lossy().to_string();
            if ws.thumbnail_local.as_ref() != Some(&target_thumb_str) {
                ws.thumbnail_local = Some(target_thumb_str);
                db_updated = true;
            }
        }

        // 3.3 Update renderedPath & rename render folder/file
        if let Some(ref old_path_str) = ws.rendered_path {
            let old_path = PathBuf::from(old_path_str);
            let target_render_path = build_render_path(
                &ws.channel_id,
                ws.channel_name.as_deref().unwrap_or(""),
                &ws.id,
            );

            let mut source_path_opt: Option<PathBuf> = None;
            if old_path.exists() {
                source_path_opt = Some(old_path.clone());
            } else {
                let alt_path = media_dir
                    .join(&ch_folder)
                    .join("renders")
                    .join(&ws.id)
                    .join("final.mp4");
                if alt_path.exists() {
                    source_path_opt = Some(alt_path);
                } else if target_render_path.exists() {
                    source_path_opt = Some(target_render_path.clone());
                }
            }

            if let Some(source_path) = source_path_opt {
                if source_path != target_render_path {
                    tracing::info!("[Migrate] Renaming rendered file: {:?} -> {:?}", source_path, target_render_path);
                    let _ = move_file_or_dir(&source_path, &target_render_path);
                    
                    // Try to clean up the old renders/ws_id folder if it's left behind and empty
                    if let Some(old_parent) = old_path.parent() {
                        if old_parent.exists() {
                            let _ = std::fs::remove_dir(old_parent);
                        }
                    }
                }
            }

            let target_render_str = target_render_path.to_string_lossy().to_string();
            if ws.rendered_path.as_ref() != Some(&target_render_str) {
                ws.rendered_path = Some(target_render_str);
                db_updated = true;
            }
        }
    }

    if db_updated {
        tracing::info!("[Migrate] Saving updated workspaces.json...");
        if let Err(e) = ws_store.save(&ws_path) {
            tracing::error!("[Migrate] Failed to save workspaces.json: {}", e);
        } else {
            tracing::info!("[Migrate] Successfully saved workspaces.json");
        }
    }
}

// ─── Data migration ──────────────────────────────────────────────

/// Migrate old Electron-era data files into the new `.hyperclip/` store layout.
/// Safe to run multiple times — checks new path first.
fn migrate_old_data() {
    let store_dir = get_store_dir();
    let channels_dir = store_dir.join("channels");

    // Always ensure store directories exist
    let _ = std::fs::create_dir_all(&channels_dir);
    let _ = std::fs::create_dir_all(&store_dir);

    // 1. Migrate channels: old D:/HyperClip-Data/channels/list.json -> new format
    let new_ch_path = get_channels_path();
    if !new_ch_path.exists() {
        let old_ch_path = PathBuf::from("D:/HyperClip-Data/channels/list.json");
        if old_ch_path.exists() {
            tracing::info!("[Migrate] Found old channels at {:?}, migrating...", old_ch_path);
            if let Ok(content) = std::fs::read_to_string(&old_ch_path) {
                // Old format is a bare JSON array
                if let Ok(old_channels) = serde_json::from_str::<Vec<serde_json::Value>>(&content) {
                    let mapped: Vec<hyperclip_ipc::store::Channel> = old_channels.iter().map(|c| {
                        let handle_raw = c.get("handle").and_then(|v| v.as_str()).unwrap_or("");
                        // Extract @handle from full URL if needed
                        let handle = if handle_raw.contains("youtube.com/") {
                            handle_raw.trim_start_matches("https://www.youtube.com/").to_string()
                        } else if handle_raw.starts_with('@') {
                            handle_raw.to_string()
                        } else {
                            format!("@{}", handle_raw)
                        };
                        hyperclip_ipc::store::Channel {
                            id: c.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            name: c.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            handle,
                            avatar_color: c.get("avatarColor").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            channel_id: c.get("channelId").and_then(|v| v.as_str()).map(String::from),
                            avatar_url: c.get("avatarUrl").and_then(|v| v.as_str()).map(String::from),
                            created_at: c.get("createdAt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            paused: c.get("paused").and_then(|v| v.as_bool()).unwrap_or(false),
                            ..Default::default()
                        }
                    }).collect();
                    let store = hyperclip_ipc::store::ChannelStore { channels: mapped };
                    let _ = store.save(&new_ch_path);
                    tracing::info!("[Migrate] Migrated {} channels", store.channels.len());
                } else {
                    tracing::warn!("[Migrate] Failed to parse old channels.json");
                }
            }
        } else {
            tracing::debug!("[Migrate] No old channels file, skipping");
        }
    }

    // 2. Migrate seen IDs: old D:/HyperClip-Data/channels/seen-ids.json -> new format
    let new_seen_path = get_seen_videos_path();
    if !new_seen_path.exists() {
        let old_seen_path = PathBuf::from("D:/HyperClip-Data/channels/seen-ids.json");
        if old_seen_path.exists() {
            tracing::info!("[Migrate] Found old seen-ids at {:?}, migrating...", old_seen_path);
            if let Ok(content) = std::fs::read_to_string(&old_seen_path) {
                if let Ok(ids) = serde_json::from_str::<Vec<String>>(&content) {
                    let mut store = SeenVideos::default();
                    for id in &ids {
                        store.mark_seen("default", id);
                    }
                    let _ = store.save(&new_seen_path);
                    tracing::info!("[Migrate] Migrated {} seen IDs", ids.len());
                }
            }
        }
    }

    // 3. Migrate old seen-videos.json (alternative old path)
    let alt_seen = PathBuf::from("D:/HyperClip-Data/channels/seen-videos.json");
    if !new_seen_path.exists() && alt_seen.exists() {
        if let Ok(content) = std::fs::read_to_string(&alt_seen) {
            if let Ok(ids) = serde_json::from_str::<Vec<String>>(&content) {
                let mut store = SeenVideos::default();
                for id in &ids {
                    store.mark_seen("default", id);
                }
                let _ = store.save(&new_seen_path);
                tracing::info!("[Migrate] Migrated {} seen IDs from seen-videos.json", ids.len());
            }
        }
    }

    // 4. Migrate keys.json, projects.json, settings.json from AppData Roaming (if migrate-projects.mjs wrote there)
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let appdata_store = PathBuf::from(appdata).join("HyperClip").join(".hyperclip");
        if appdata_store.exists() {
            // Migrate keys.json: copy if target doesn't exist, or has no keys
            let target_keys = store_dir.join("keys.json");
            let source_keys = appdata_store.join("keys.json");
            let needs_keys_copy = !target_keys.exists() || {
                let content = std::fs::read_to_string(&target_keys).unwrap_or_default();
                content.trim() == "{\"keys\": []}" || content.trim() == "{\"keys\":[]}" || content.trim().is_empty()
            };
            if source_keys.exists() && needs_keys_copy {
                tracing::info!("[Migrate] Copying keys.json from AppData to {:?}", target_keys);
                if let Err(e) = std::fs::copy(&source_keys, &target_keys) {
                    tracing::error!("[Migrate] Failed to copy keys.json: {}", e);
                }
            }

            // Migrate projects.json: copy if target doesn't exist, or has no projects
            let target_projects = store_dir.join("projects.json");
            let source_projects = appdata_store.join("projects.json");
            let needs_projects_copy = !target_projects.exists() || {
                let content = std::fs::read_to_string(&target_projects).unwrap_or_default();
                content.trim() == "{\"projects\": []}" || content.trim() == "{\"projects\":[]}" || content.trim().is_empty()
            };
            if source_projects.exists() && needs_projects_copy {
                tracing::info!("[Migrate] Copying projects.json from AppData to {:?}", target_projects);
                if let Err(e) = std::fs::copy(&source_projects, &target_projects) {
                    tracing::error!("[Migrate] Failed to copy projects.json: {}", e);
                }
            }

            // Migrate settings.json: copy if target settings file is empty or missing
            let target_settings = store_dir.join("settings.json");
            let source_settings = appdata_store.join("settings.json");
            let needs_settings_copy = !target_settings.exists() || {
                let content = std::fs::read_to_string(&target_settings).unwrap_or_default();
                content.trim().is_empty()
            };
            if source_settings.exists() && needs_settings_copy {
                tracing::info!("[Migrate] Copying settings.json from AppData to {:?}", target_settings);
                if let Err(e) = std::fs::copy(&source_settings, &target_settings) {
                    tracing::error!("[Migrate] Failed to copy settings.json: {}", e);
                }
            }
        }
    }

    // Migrate folder structures and video timestamps in workspaces
    migrate_media_folders_and_workspaces();

    tracing::info!("[Migrate] Store directory at {:?}", store_dir);
}