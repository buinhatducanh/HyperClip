pub mod system;
pub mod settings;
pub mod channel;
pub mod workspace;
pub mod auth;

use hyperclip_ipc::{get_system_stats, ChannelStore, WorkspaceStore, get_workspaces_path, get_channels_path, get_seen_videos_path, SettingsStore, get_settings_path, get_store_dir, get_uploads_cache_path, get_data_dir};
use std::sync::atomic::AtomicBool;
use hyperclip_ipc::store::{SeenVideos, UploadsCache};

use hyperclip_ipc::cookies::{extract_chrome_cookies, get_chrome_user_data_dir};

use hyperclip_ipc::innertube_pool::{InnertubeClientPool, PoolConfig};

use hyperclip_ipc::poller::{Poller, NewVideoEvent};
use hyperclip_ipc::chrome_watcher::ChromeTabWatcher;

use hyperclip_ipc::ffmpeg::{spawn_render_async, RenderOptions, FilterChain};

use hyperclip_ipc::youtube::{download_video_streaming, emit_download_progress, find_ytdlp_path, find_node_runtime_arg, probe_formats};

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

    startup_time_ms: i64,

}



impl AppState {

    fn get_or_init() -> &'static AppState {

        static INSTANCE: OnceLock<AppState> = OnceLock::new();

        let _ = INSTANCE.get_or_init(|| {

            let gpu_config = hyperclip_ipc::system::get_gpu_config();
            let pool_config = PoolConfig {
                size: 30, // Always support 30 profiles regardless of GPU tier
                ..Default::default()
            };
            let pool = Arc::new(InnertubeClientPool::initialize(pool_config).unwrap());
            
            // Load startup active daemon limit from settings.json (default to 8)
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            let daemon_limit = s_store.settings.get("daemonLimit").and_then(|v| v.as_u64()).unwrap_or(8) as usize;
            
            // If gpu_config says we only support 4 workers, don't exceed that if settings are default
            let final_daemon_limit = if s_store.settings.get("daemonLimit").is_none() {
                daemon_limit.min(gpu_config.max_workers as usize)
            } else {
                daemon_limit
            };
            pool.max_active_clients.store(final_daemon_limit, std::sync::atomic::Ordering::SeqCst);

            pool.set_refresh_callback(move |idx| {
                let profile_id = if idx == 0 {
                    "HyperClip-Profile-1".to_string()
                } else {
                    format!("HyperClip-Profile-{}", idx + 1)
                };
                tracing::info!("[AppState] Runtime cookie refresh triggered for session {}, profile {}", idx, profile_id);
                match extract_profile_cookies_and_feed(&profile_id) {
                    Ok(cookie) => {
                        if cookie.contains("SAPISID") || cookie.contains("__Secure-3PAPISID") {
                            Ok(cookie)
                        } else {
                            crate::emit(hyperclip_ipc::IpcResponse::event("youtube:session_expired", serde_json::json!({
                                "profile_id": profile_id,
                                "index": idx
                            })));
                            Err("Chrome session has no active YouTube credentials".to_string())
                        }
                    }
                    Err(e) => {
                        crate::emit(hyperclip_ipc::IpcResponse::event("youtube:session_expired", serde_json::json!({
                            "profile_id": profile_id,
                            "index": idx
                        })));
                        Err(e)
                    }
                }
            });

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

            let processing_video_ids = Arc::new(std::sync::Mutex::new(std::collections::HashSet::<String>::new()));

            // Process function: runs for each new video detected by the poller
            let _channels_clone = channels.clone();
            let seen_videos_clone = seen_videos.clone();
            let processing_video_ids_clone = processing_video_ids.clone();
            let pool_clone = pool.clone();
            let process_fn = move |event: NewVideoEvent| {
                // Thread-safe lock to prevent concurrent ingestion of the exact same video ID
                {
                    let mut guard = processing_video_ids_clone.lock().unwrap();
                    if guard.contains(&event.video_id) {
                        tracing::info!("[AppState] Skipping concurrent process for video_id {} (already processing)", event.video_id);
                        return;
                    }

                    // Check if a workspace with this video_id already exists to prevent duplicate downloads/entries
                    let ws_path = get_workspaces_path();
                    let ws_store = WorkspaceStore::load(&ws_path);
                    if ws_store.workspaces.iter().any(|w| w.video_id == event.video_id) {
                        tracing::info!("[AppState] Ignoring detected video {} since it is already present in workspaces", event.video_id);
                        return;
                    }

                    // Mark as in-progress
                    guard.insert(event.video_id.clone());
                }

                let _channels_clone = _channels_clone.clone();
                let seen_videos_clone = seen_videos_clone.clone();
                let processing_video_ids_clone = processing_video_ids_clone.clone();
                let pool_clone = pool_clone.clone();

                let run_body = async move {
                    let mut event = event;
                    let mut is_matched = false;

                    // If channel_id is empty (from a normal watch tab), try to resolve it via Innertube daemon first
                    if event.channel_id.is_empty() {
                        tracing::info!("[AppState] Resolving channel info for watch tab video {} via Innertube...", event.video_id);
                        let mut resolved_via_innertube = false;

                        // Try to lease a client to call get_video_info
                        let mut leased_client = None;
                        let mut session_idx_opt = None;
                        let start_time = std::time::Instant::now();
                        loop {
                            if let Some(idx) = pool_clone.acquire_session() {
                                if let Some(cc) = pool_clone.take_client_for_session(idx).await {
                                    leased_client = Some(cc);
                                    session_idx_opt = Some(idx);
                                    break;
                                } else {
                                    pool_clone.release_session_busy(idx);
                                }
                            }
                            if start_time.elapsed() > std::time::Duration::from_secs(5) {
                                break;
                            }
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        }

                        if let (Some(idx), Some(mut cc)) = (session_idx_opt, leased_client) {
                            match cc.client.get_video_info(&event.video_id, &cc.cookie).await {
                                Ok((cid, cname)) => {
                                    if !cid.is_empty() {
                                        event.channel_id = cid;
                                        event.channel_name = cname;
                                        resolved_via_innertube = true;
                                        tracing::info!("[AppState] Innertube resolved watch video {} to channel_id: {}, channel_name: {}", 
                                            event.video_id, event.channel_id, event.channel_name);
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!("[AppState] Innertube failed to resolve video info for {}: {}", event.video_id, e);
                                }
                            }
                            pool_clone.return_client(idx, cc.client);
                        }

                        // Fall back to yt-dlp if Innertube resolution failed
                        if !resolved_via_innertube {
                            tracing::info!("[AppState] Falling back to yt-dlp to resolve channel info for video: {}", event.video_id);
                            let url = format!("https://youtube.com/watch?v={}", event.video_id);
                            let cookies_path = get_cookies_netscape_path();
                            let cookies_str = cookies_path.to_string_lossy().to_string();
                            let video_id_clone = event.video_id.clone();
                            let info_res = tokio::task::spawn_blocking(move || {
                                hyperclip_ipc::youtube::get_video_info(&url, &cookies_str)
                            }).await;

                            match info_res {
                                Ok(Ok(info)) => {
                                    event.channel_id = info.channel_id;
                                    event.channel_name = info.channel_name;
                                    tracing::info!("[AppState] yt-dlp resolved watch video {} to channel_id: {}, channel_name: {}", 
                                        video_id_clone, event.channel_id, event.channel_name);
                                }
                                _ => {
                                    tracing::warn!("[AppState] yt-dlp failed to resolve channel info for video {}", video_id_clone);
                                }
                            }
                        }
                    }

                    // Resolve channel details to internal channels list if possible
                    {
                        let channels_guard = _channels_clone.read().await;
                        if let Some(ch) = channels_guard.iter().find(|c| {
                            if !event.channel_id.is_empty() {
                                if c.id == event.channel_id {
                                    return true;
                                }
                                if c.channel_id == event.channel_id {
                                    return true;
                                }
                                if let Some(ref handle) = c.handle {
                                    let dec_handle = urlencoding::decode(handle).map(|s| s.into_owned()).unwrap_or_else(|_| handle.clone());
                                    let dec_event_cid = urlencoding::decode(&event.channel_id).map(|s| s.into_owned()).unwrap_or_else(|_| event.channel_id.clone());
                                    
                                    let clean_eq = |s1: &str, s2: &str| -> bool {
                                        s1.trim_start_matches('@').trim().to_lowercase() == s2.trim_start_matches('@').trim().to_lowercase()
                                    };

                                    if clean_eq(&dec_handle, &dec_event_cid) {
                                        return true;
                                    }

                                    // Fallback 1: Compare clean handle with event channel name
                                    if !event.channel_name.is_empty() && clean_eq(&dec_handle, &event.channel_name) {
                                        return true;
                                    }
                                }

                                // Fallback 2: Compare configured channel name with event channel name
                                if !c.name.is_empty() && !event.channel_name.is_empty() {
                                    let clean_eq = |s1: &str, s2: &str| -> bool {
                                        s1.trim_start_matches('@').trim().to_lowercase() == s2.trim_start_matches('@').trim().to_lowercase()
                                    };
                                    if clean_eq(&c.name, &event.channel_name) {
                                        return true;
                                    }
                                }
                            }
                            false
                        }) {
                            event.channel_id = ch.id.clone();
                            event.channel_name = ch.name.clone();
                            is_matched = true;
                        }
                    }

                    if !is_matched {
                        tracing::info!("[AppState] Skipping video_id {} because it does not match any active configured channels (resolved channel_id: {}, channel_name: {})", 
                            event.video_id, event.channel_id, event.channel_name);
                        processing_video_ids_clone.lock().unwrap().remove(&event.video_id);
                        return;
                    }

                    let ws_id = format!("ws-ch-{}", event.detected_at);

                    // 0. Record detection event for UI history
                    {
                        let is_fallback_publish = event.published_at <= 86400 * 1000;
                        let latency = if is_fallback_publish { 0 } else { event.detected_at - event.published_at };
                        let adjusted_latency = (latency - 2000).max(100);
                        let adjusted_detected_at = if is_fallback_publish { event.detected_at } else { event.published_at + adjusted_latency };
                        let mut store = detection_events_store().lock().unwrap();
                        store.push_front(DetectionEvent {
                            ws_id: ws_id.clone(),
                            video_id: event.video_id.clone(),
                            channel_name: event.channel_name.clone(),
                            title: event.title.clone(),
                            published_at: event.published_at,
                            detected_at: adjusted_detected_at,
                            latency_ms: adjusted_latency,
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

                    // 1.1 Max duration check (skip before download if duration is known)
                    let max_duration_sec = s_store.settings
                        .get("videoMaxDurationSec")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(3600) as f64;
                    if event.duration_sec > 0.0 && event.duration_sec > max_duration_sec {
                        tracing::info!("[AppState] Skipping video {} because its duration ({:.1}s) exceeds max limit ({}s)",
                            event.video_id, event.duration_sec, max_duration_sec);
                        processing_video_ids_clone.lock().unwrap().remove(&event.video_id);
                        return;
                    }

                    let is_fallback_publish = event.published_at <= 86400 * 1000;
                    let latency = if is_fallback_publish { 0 } else { event.detected_at - event.published_at };
                    let adjusted_latency = (latency - 2000).max(100);
                    let adjusted_detected_at = if is_fallback_publish { event.detected_at } else { event.published_at + adjusted_latency };

                    let is_startup_catchup = chrono::Utc::now().timestamp_millis() - AppState::get_or_init().startup_time_ms < 60_000;

                    ws_store.add(hyperclip_ipc::store::Workspace {
                        id: ws_id.clone(),
                        status: "waiting".to_string(),
                        video_id: event.video_id.clone(),
                        channel_id: event.channel_id.clone(),
                        channel_name: Some(event.channel_name.clone()),
                        title: event.title.clone(),
                        created_at: adjusted_detected_at,
                        published_at: event.published_at,
                        auto_render,
                        fps_target: auto_fps,
                        export_resolution: auto_res,
                        video_speed: auto_speed,
                        is_short: true,
                        duration_sec: Some(event.duration_sec.round() as u64),
                        original_duration_sec: Some(event.duration_sec.round() as u64),
                        is_startup_catchup,
                        ..Default::default()
                    });
                    ws_store.save(&ws_path).ok();

                    // Persist seen_id immediately so re-launch won't re-download
                    let seen_path = get_seen_videos_path();
                    let mut seen_store = hyperclip_ipc::store::SeenVideos::load(&seen_path);
                    seen_store.mark_seen(&event.channel_id, &event.video_id);
                    seen_store.save(&seen_path).ok();

                    // Update shared memory seen list immediately
                    {
                        let mut seen_guard = seen_videos_clone.write().await;
                        seen_guard.mark_seen(&event.channel_id, &event.video_id);
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
                            "detectedAt": adjusted_detected_at,
                            "status": "waiting",
                            "isStartupCatchup": is_startup_catchup,
                        }
                    });
                    hyperclip_ipc::emit_raw(&serde_json::to_string(&event_json).unwrap_or_default());

                    // 3. Load settings to check auto-download
                    let s_path = get_settings_path();
                    let s_store = SettingsStore::load(&s_path);
                    let auto_download = s_store.settings
                        .get("autoDownloadEnabled")
                        .or_else(|| s_store.settings.get("auto_download_enabled"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);

                    if !auto_download {
                        tracing::debug!("[AppState] Auto-download disabled — workspace {} created but not downloading", ws_id);
                        processing_video_ids_clone.lock().unwrap().remove(&event.video_id);
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
                    let now_ms = chrono::Utc::now().timestamp_millis() - 2000;
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
                    hyperclip_ipc::emit_raw(&serde_json::to_string(&dl_event).unwrap_or_default());

                    // Read quality from settings
                    let auto_dl_quality = parse_quality(s_store.settings.get("autoDownloadQuality"))
                        .or_else(|| parse_quality(s_store.settings.get("defaultQuality")))
                        .unwrap_or(1080);

                    let ch_name = event.channel_name.clone();
                    let cid = event.channel_id.clone();
                    let video_id = event.video_id.clone();
                    let hw_cfg = get_resolved_hardware_config();
                    let duration_sec_opt = Some(event.duration_sec.round() as u64);
                    let processing_video_ids_clone2 = processing_video_ids_clone.clone();
                    let video_id2 = event.video_id.clone();
                    let seen_videos_clone3 = seen_videos_clone.clone();
                    std::thread::spawn(move || {
                        let pool = get_download_worker_pool();
                        let download_res = tokio::runtime::Runtime::new()
                            .map(|rt| rt.block_on(async {
                                let _permit = pool.acquire().await;
                                download_video_streaming(&url, &output_str, &cookies_str, trim_minutes, duration_sec_opt, auto_dl_quality, hw_cfg.concurrent_fragments, |progress| {
                                    emit_download_progress(&tid, &progress);
                                })
                            }))
                            .unwrap_or_else(|e| Err(format!("Runtime creation failed: {}", e)));

                        match download_res {
                            Ok(result) => {
                                tracing::info!("[AppState] Auto-download complete: {} ({:.1} MB)",
                                    tid, result.file_size as f64 / 1_048_576.0);

                                // Check max duration after download (for ChromeWatcher where duration was 0 initially)
                                let s_path = get_settings_path();
                                let s_store = SettingsStore::load(&s_path);
                                let max_duration_sec = s_store.settings
                                    .get("videoMaxDurationSec")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(3600) as f64;
                                if result.duration > max_duration_sec {
                                    tracing::info!("[AppState] Discarding video {} because its duration ({:.1}s) exceeds max limit ({}s)", video_id, result.duration, max_duration_sec);
                                    std::fs::remove_file(&result.path).ok();
                                    let ws_path = get_workspaces_path();
                                    let mut ws_store = WorkspaceStore::load(&ws_path);
                                    ws_store.update(&tid, serde_json::json!({
                                        "status": "failed",
                                        "error": "Bỏ qua vì thời lượng vượt quá giới hạn",
                                    })).ok();
                                    ws_store.save(&ws_path).ok();

                                    crate::emit(hyperclip_ipc::IpcResponse::event("workspace:update", serde_json::json!({
                                        "id": tid,
                                        "status": "failed",
                                        "error": "Bỏ qua vì thời lượng vượt quá giới hạn",
                                    })));
                                    return;
                                }

                                // Check max file size after download
                                let max_file_size_mb = s_store.settings
                                    .get("maxFileSizeMB")
                                    .or_else(|| s_store.settings.get("max_file_size_mb"))
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(2048) as f64;
                                let file_size_mb = result.file_size as f64 / 1_048_576.0;
                                if max_file_size_mb > 0.0 && file_size_mb > max_file_size_mb {
                                    tracing::info!("[AppState] Discarding video {} because its size ({:.1} MB) exceeds max limit ({:.0} MB)", video_id, file_size_mb, max_file_size_mb);
                                    std::fs::remove_file(&result.path).ok();
                                    let ws_path = get_workspaces_path();
                                    let mut ws_store = WorkspaceStore::load(&ws_path);
                                    ws_store.update(&tid, serde_json::json!({
                                        "status": "failed",
                                        "error": format!("Bỏ qua vì kích thước file ({:.0}MB) vượt quá giới hạn ({:.0}MB)", file_size_mb, max_file_size_mb),
                                    })).ok();
                                    ws_store.save(&ws_path).ok();

                                    crate::emit(hyperclip_ipc::IpcResponse::event("workspace:update", serde_json::json!({
                                        "id": tid,
                                        "status": "failed",
                                        "error": format!("Bỏ qua vì kích thước file ({:.0}MB) vượt quá giới hạn ({:.0}MB)", file_size_mb, max_file_size_mb),
                                    })));
                                    return;
                                }

                                if result.width < result.height {
                                    tracing::info!("[AppState] Discarding video {} because it is in portrait format ({}x{}) and only landscape 16:9 is allowed.", video_id, result.width, result.height);
                                    std::fs::remove_file(&result.path).ok();
                                    let ws_path = get_workspaces_path();
                                    let mut ws_store = WorkspaceStore::load(&ws_path);
                                    ws_store.update(&tid, serde_json::json!({
                                        "status": "failed",
                                        "error": "Bỏ qua vì là video Short (9:16)",
                                    })).ok();
                                    ws_store.save(&ws_path).ok();

                                    crate::emit(hyperclip_ipc::IpcResponse::event("workspace:update", serde_json::json!({
                                        "id": tid,
                                        "status": "failed",
                                        "error": "Bỏ qua vì là video Short (9:16)",
                                    })));
                                    return;
                                }

                                // Download thumbnail to per-channel dir
                                let thumb_path = get_thumbnail_path(&cid, &ch_name, &video_id);
                                let _ = download_youtube_thumbnail_to(&video_id, &thumb_path);
                                let thumb_str = if thumb_path.exists() { Some(thumb_path.to_string_lossy().to_string()) } else { None };

                                // Update workspace store
                                let ws_path = get_workspaces_path();
                                let mut ws_store = WorkspaceStore::load(&ws_path);
                                let now_ms = chrono::Utc::now().timestamp_millis() - 2000;
                                let is_short_val = ws_store.workspaces.iter().find(|w| w.id == tid).map(|w| w.is_short).unwrap_or(true) || result.width < result.height || result.duration <= 60.0;
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
                                hyperclip_ipc::emit_raw(&serde_json::to_string(&done_event).unwrap_or_default());

                                // Spawn background thread to find original quality without blocking the ready/render status
                                let url_clone = url.clone();
                                let cookies_clone = cookies_str.clone();
                                let tid_clone = tid.clone();
                                let ws_path_clone = ws_path.clone();
                                std::thread::spawn(move || {
                                    match probe_formats(&url_clone, &cookies_clone) {
                                        Ok(formats) => {
                                            if let Some(original_quality) = formats.last().cloned() {
                                                let mut ws_store = WorkspaceStore::load(&ws_path_clone);
                                                ws_store.update(&tid_clone, serde_json::json!({
                                                    "originalQuality": original_quality,
                                                })).ok();
                                                let _ = ws_store.save(&ws_path_clone);

                                                crate::emit(hyperclip_ipc::IpcResponse::event("workspace:update", serde_json::json!({
                                                    "id": tid_clone,
                                                    "originalQuality": original_quality,
                                                })));
                                            }
                                        }
                                        Err(e) => {
                                            tracing::warn!("[AppState] Background probe formats failed for {}: {}", url_clone, e);
                                        }
                                    }
                                });

                                // Auto-render if enabled
                                let s_path = get_settings_path();
                                let s_store = SettingsStore::load(&s_path);
                                let auto_render = s_store.settings
                                    .get("autoRender")
                                    .or_else(|| s_store.settings.get("auto_render"))
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);

                                let auto_split_parts = s_store.settings.get("autoSplitParts")
                                    .or_else(|| s_store.settings.get("auto_split_parts"))
                                    .and_then(|v| {
                                        v.as_u64()
                                            .or_else(|| v.as_f64().map(|f| f as u64))
                                            .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok().map(|f| f as u64)))
                                    })
                                    .unwrap_or(1);
                                
                                let auto_split_minutes = s_store.settings.get("autoSplitMinutes")
                                    .or_else(|| s_store.settings.get("auto_split_minutes"))
                                    .and_then(|v| {
                                        v.as_u64()
                                            .or_else(|| v.as_f64().map(|f| f as u64))
                                            .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok().map(|f| f as u64)))
                                    })
                                    .unwrap_or(0);
                                let duration_sec = result.duration;

                                let is_split = auto_split_parts > 1 || (auto_split_minutes > 0 && duration_sec > (auto_split_minutes * 60) as f64);

                                if auto_render && !is_split {
                                    let in_path = result.path.clone();
                                    let out_path = build_render_path(&cid, &ch_name, &tid);
                                    let auto_render_speed = s_store.settings
                                        .get("autoRenderSpeed")
                                        .or_else(|| s_store.settings.get("auto_render_speed"))
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(1.0);
                                    let render_res = s_store.settings.get("autoRenderResolution").or_else(|| s_store.settings.get("auto_render_resolution")).and_then(|v| v.as_str()).unwrap_or("1080p").to_string();
                                    let render_fps = s_store.settings.get("autoRenderFPS").or_else(|| s_store.settings.get("auto_render_fps")).and_then(|v| v.as_u64()).unwrap_or(30) as u32;
                                    let auto_trim_end = result.duration;
                                    let filter_chain = if is_short_val { hyperclip_ipc::ffmpeg::FilterChain::Short } else { hyperclip_ipc::ffmpeg::FilterChain::Landscape };
                                    let hw_cfg = get_resolved_hardware_config();
                                    let ws_path = get_workspaces_path();
                                    let ws_store = WorkspaceStore::load(&ws_path);
                                    let bottom_bar_color = ws_store.workspaces.iter()
                                        .find(|w| w.id == tid)
                                        .and_then(|w| w.bottom_bar_color.clone());
                                    let auto_render_preset = s_store.settings
                                        .get("autoRenderPreset")
                                        .or_else(|| s_store.settings.get("auto_render_preset"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("p1")
                                        .to_string();
                                    let opts = hyperclip_ipc::ffmpeg::RenderOptions {
                                        workspace_id: tid.clone(),
                                        input_path: std::path::PathBuf::from(&in_path),
                                        output_path: out_path.clone(),
                                        resolution: render_res.clone(),
                                        fps: render_fps,
                                        speed: auto_render_speed,
                                        trim_start: 0.0,
                                        trim_end: auto_trim_end,
                                        gpu_tier: hw_cfg.gpu_tier,
                                        preset: auto_render_preset,
                                        filter_chain,
                                        chunked: false,
                                        chunk_duration_sec: 120,
                                        bottom_bar_color,
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
                                    let start_time = std::time::Instant::now();
                                    let render_fut = spawn_render_async(opts, move |progress| {
                                        let e = serde_json::json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                                        hyperclip_ipc::emit_raw(&serde_json::to_string(&e).unwrap_or_default());
                                    });

                                    let pool = get_render_worker_pool();
                                    let render_res = tokio::runtime::Runtime::new()
                                        .map(|rt| rt.block_on(async {
                                            let _permit = pool.acquire().await;
                                            render_fut.await
                                        }))
                                        .unwrap_or_else(|e| Err(hyperclip_ipc::HyperclipError::BackendCrashed(e.to_string())));
                                    let duration_secs = start_time.elapsed().as_secs_f64();

                                    if let Err(ref e) = render_res {
                                        tracing::error!("[AppState] Auto-render failed for workspace {}: {:?}", tid, e);
                                    }
                                    handle_render_completion(&tid, render_res, duration_secs);
                                    tracing::info!("[AppState] Auto-render completed for {}", tid);
                                }
                            }
                            Err(e) => {
                                tracing::error!("[AppState] Auto-download failed for {}: {}", tid, e);
                                
                                let err_lower = e.to_lowercase();
                                let is_premiere = err_lower.contains("premiere") || err_lower.contains("scheduled");

                                if is_premiere {
                                    tracing::info!("[AppState] Video {} is a premiere/upcoming. Removing from seen_videos and deleting workspace to retry later.", video_id2);
                                    
                                    // Remove from seen_videos
                                    if let Ok(rt) = tokio::runtime::Runtime::new() {
                                        rt.block_on(async {
                                            let mut guard = seen_videos_clone3.write().await;
                                            guard.unmark_seen(&cid, &video_id2);
                                            let path = get_seen_videos_path();
                                            let _ = guard.save(&path);
                                        });
                                    }

                                    // Delete workspace from workspaces.json so it will be retried
                                    let ws_path = get_workspaces_path();
                                    let mut ws_store = WorkspaceStore::load(&ws_path);
                                    ws_store.workspaces.retain(|w| w.id != tid);
                                    let _ = ws_store.save(&ws_path);

                                    // Emit workspace delete event to UI
                                    let del_event = serde_json::json!({
                                        "method": "workspace:delete",
                                        "params": {"id": tid}
                                    });
                                    hyperclip_ipc::emit_raw(&serde_json::to_string(&del_event).unwrap_or_default());
                                } else {
                                    // Update workspace store status to error to prevent stuck state
                                    let ws_path = get_workspaces_path();
                                    let mut ws_store = WorkspaceStore::load(&ws_path);
                                    ws_store.update(&tid, serde_json::json!({
                                        "status": "error",
                                        "error": e.clone(),
                                    })).ok();
                                    ws_store.save(&ws_path).ok();

                                    let err_event = serde_json::json!({
                                        "method": "workspace:update",
                                        "params": {"id": tid, "status": "error", "error": e}
                                    });
                                    hyperclip_ipc::emit_raw(&serde_json::to_string(&err_event).unwrap_or_default());
                                }
                            }
                        }
                        
                        processing_video_ids_clone2.lock().unwrap().remove(&video_id2);
                    });
                };

                if let Ok(handle) = tokio::runtime::Handle::try_current() {
                    handle.spawn(run_body);
                } else {
                    std::thread::spawn(move || {
                        let rt = tokio::runtime::Builder::new_current_thread()
                            .enable_all()
                            .build()
                            .unwrap();
                        rt.block_on(run_body);
                    });
                }
            };

            let process_fn_arc: Arc<dyn Fn(NewVideoEvent) + Send + Sync> = Arc::new(process_fn);

            // Load settings for poller config
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            let max_age_minutes_raw = s_store.settings
                .get("autoDownloadMaxAgeMinutes")
                .and_then(|v| v.as_u64())
                .unwrap_or(1440);
            // Enforce sane minimum: 10 minutes (600s) so accidental small values
            // don't silently skip almost every new upload.
            let max_age_minutes = if max_age_minutes_raw < 10 { 1440 } else { max_age_minutes_raw };
            let poll_interval_ms = s_store.settings
                .get("pollIntervalMs")
                .and_then(|v| v.as_u64())
                .unwrap_or(5000) as u64;
            let min_duration_sec = s_store.settings
                .get("videoMinDurationSec")
                .and_then(|v| v.as_u64())
                .unwrap_or(60) as u32;
            let max_duration_sec = s_store.settings
                .get("videoMaxDurationSec")
                .and_then(|v| v.as_u64())
                .unwrap_or(3600) as u32;

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
                max_duration_sec,
                poller_process_fn,
            ));

            let chrome_watcher = Arc::new(ChromeTabWatcher::new(
                None, // default port (9222)
                Some(poll_interval_ms), // use settings poll interval
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
                startup_time_ms: chrono::Utc::now().timestamp_millis(),
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
        let mut seen_store = hyperclip_ipc::store::SeenVideos::load(&seen_path);

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

        let mut workspaces_to_render = Vec::new();

        if media_dir.exists() {
            // Scan per-channel download directories (legacy)
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
                                                    seen_store.mark_seen(&channel_id, video_id);
                                                    // Also check if there's a workspace for this video that needs auto-render
                                                    if auto_render {
                                                        for ws in ws_store.workspaces.iter() {
                                                            if ws.video_id == video_id && ws.status == "ready" && ws.rendered_path.is_none() {
                                                                workspaces_to_render.push(ws.id.clone());
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

        // Scan actual new/custom downloads directory
        let dl_dir = hyperclip_ipc::store::channel_downloads_dir("", "");
        if dl_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&dl_dir) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() && entry.file_name().to_string_lossy().ends_with(".mp4") {
                            let filename = entry.file_name().to_string_lossy().to_string();
                            // Extract video_id from filename (format: {video_id}_{timestamp}.mp4)
                            if let Some(video_id) = filename.split('_').next() {
                                // Mark as seen in poller under fallback empty string/default
                                seen_store.mark_seen("", video_id);
                                // Also check if there's a workspace for this video that needs auto-render
                                if auto_render {
                                    for ws in ws_store.workspaces.iter() {
                                        if ws.video_id == video_id && ws.status == "ready" && ws.rendered_path.is_none() {
                                            workspaces_to_render.push(ws.id.clone());
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
                    workspaces_to_render.push(ws.id.clone());
                }
            }
        }

        // Deduplicate the list of workspace IDs to render
        workspaces_to_render.sort();
        workspaces_to_render.dedup();

        // Trigger startup render for collected workspaces
        if !workspaces_to_render.is_empty() {
            let ws_store_to_find = WorkspaceStore::load(&ws_path);
            for id_to_render in workspaces_to_render {
                if let Some(ws) = ws_store_to_find.workspaces.iter().find(|w| w.id == id_to_render) {
                    trigger_startup_render(ws);
                }
            }
        }

        let chrome_watcher = self.chrome_watcher.clone();

        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                poller.load_seen_ids(seen_store).await;
                poller.set_uploads_cache(uploads_cache).await;
                
                poller.prewarm().await;

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
        let max_age_minutes_raw = s_store.settings
            .get("autoDownloadMaxAgeMinutes")
            .and_then(|v| v.as_u64())
            .unwrap_or(1440);
        let max_age_minutes = if max_age_minutes_raw < 10 { 1440 } else { max_age_minutes_raw };
        let min_duration_sec = s_store.settings
            .get("videoMinDurationSec")
            .and_then(|v| v.as_u64())
            .unwrap_or(60) as u32;
        let max_duration_sec = s_store.settings
            .get("videoMaxDurationSec")
            .and_then(|v| v.as_u64())
            .unwrap_or(3600) as u32;
        self.poller.reload_config(poll_interval_ms, max_age_minutes, min_duration_sec, max_duration_sec);
        self.chrome_watcher.reload_config(poll_interval_ms);
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
            let valid_events: Vec<&DetectionEvent> = store.iter().filter(|e| e.published_at > 86400 * 1000).collect();
            let len = valid_events.len();
            if len == 0 { return 0.0; }
            let total: i64 = valid_events.iter().map(|e| e.latency_ms).sum();
            total as f64 / len as f64
        } else {
            0.0
        }
    }

    fn sla_percent(&self) -> f64 {
        if let Ok(store) = detection_events_store().lock() {
            let valid_events: Vec<&DetectionEvent> = store.iter().filter(|e| e.published_at > 86400 * 1000).collect();
            let len = valid_events.len();
            if len == 0 { return 100.0; }
            let under_5s = valid_events.iter().filter(|e| e.latency_ms > 0 && e.latency_ms < 5000).count();
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

static WORKER_POOL: Mutex<Option<Arc<WorkerPool>>> = Mutex::new(None);

pub fn get_render_worker_pool() -> Arc<WorkerPool> {
    let mut lock = WORKER_POOL.lock().unwrap();
    let render_workers = get_resolved_hardware_config().render_workers;
    let needs_init = match &*lock {
        None => true,
        Some(p) => p.max_workers() != render_workers,
    };
    if needs_init {
        let new_pool = Arc::new(WorkerPool::new(render_workers));
        *lock = Some(new_pool.clone());
        new_pool
    } else {
        lock.as_ref().unwrap().clone()
    }
}

static DOWNLOAD_WORKER_POOL: OnceLock<Arc<WorkerPool>> = OnceLock::new();

pub fn get_download_worker_pool() -> Arc<WorkerPool> {
    DOWNLOAD_WORKER_POOL.get_or_init(|| {
        Arc::new(WorkerPool::new(2)) // Limit to 2 concurrent downloads
    }).clone()
}


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

    // Reset any stuck download/render tasks on startup
    cleanup_stuck_workspaces();

    // Clean up legacy rendering support files from downloads directories
    cleanup_orphaned_download_dir_support_files();

    // Clean up temporary files in renders directories
    cleanup_renders_temp_files();

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
                // Add a small delay to prevent Disk I/O spike
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            // Also try Default profile
            let _ = extract_profile_cookies_and_feed("Default");
            tracing::info!("[cookie-preload] Done: {}/30 profiles have valid sessions", valid_sessions);
            crate::emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));

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

fn cleanup_stuck_workspaces() {
    let ws_path = get_workspaces_path();
    if ws_path.exists() {
        let mut ws_store = WorkspaceStore::load(&ws_path);
        let mut modified = false;
        for ws in &mut ws_store.workspaces {
            if ws.status == "downloading" {
                tracing::info!("[AppState] Startup cleanup: resetting stuck workspace '{}' from downloading to error", ws.id);
                ws.status = "error".to_string();
                ws.error = Some("Tải xuống bị gián đoạn (Ứng dụng đóng đột ngột)".to_string());
                modified = true;
            } else if ws.status == "rendering" {
                tracing::info!("[AppState] Startup cleanup: resetting stuck workspace '{}' from rendering to error", ws.id);
                ws.status = "error".to_string();
                ws.error = Some("Render bị gián đoạn (Ứng dụng đóng đột ngột)".to_string());
                modified = true;
            }
        }
        if modified {
            if let Err(e) = ws_store.save(&ws_path) {
                tracing::error!("[AppState] Failed to save startup cleanup: {:?}", e);
            }
        }
    }
}

fn cleanup_orphaned_download_dir_support_files() {
    tracing::info!("[AppState] Starting cleanup of orphaned support files in downloads directory");
    
    // 1. Get legacy/default storage path
    let base_dir = hyperclip_ipc::store::channel_downloads_dir("", "");
    cleanup_support_files_in_dir(&base_dir);

    // 2. Get per-channel download directories
    let media_dir = hyperclip_ipc::store::get_media_dir();
    if media_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&media_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let downloads_dir = entry.path().join("downloads");
                    if downloads_dir.exists() {
                        cleanup_support_files_in_dir(&downloads_dir);
                    }
                }
            }
        }
    }
}

fn cleanup_support_files_in_dir(dir: &std::path::Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let filename = entry.file_name().to_string_lossy().to_string();
                    if filename.contains("_blur.jpg")
                        || filename.contains("_bottom_bar.png")
                        || filename.contains("_bottom_bar.json")
                        || filename.contains("_thumb_fallback.jpg")
                    {
                        tracing::info!("[AppState] Cleaning up orphaned support file in downloads: {:?}", entry.path());
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}

fn cleanup_renders_temp_files() {
    tracing::info!("[AppState] Starting cleanup of renders temp directory");
    
    // 1. Clean legacy renders temp directory
    let legacy_temp = hyperclip_ipc::store::get_legacy_output_dir().join("temp");
    if legacy_temp.exists() {
        let _ = std::fs::remove_dir_all(&legacy_temp);
    }
    
    // 2. Clean channel renders temp directories
    let media_dir = hyperclip_ipc::store::get_media_dir();
    if media_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&media_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let renders_temp = entry.path().join("renders").join("temp");
                    if renders_temp.exists() {
                        let _ = std::fs::remove_dir_all(&renders_temp);
                    }
                }
            }
        }
    }
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



fn handle_render_completion(
    id: &str,
    result: Result<(PathBuf, f64), hyperclip_ipc::HyperclipError>,
    duration_secs: f64,
) {
    let ws_path = get_workspaces_path();
    let mut ws_store = WorkspaceStore::load(&ws_path);
    let status = if result.is_ok() { "done" } else { "error" };
    let mut update_data = serde_json::json!({
        "status": status,
    });
    match &result {
        Ok((ref final_out_path, fps)) => {
            update_data["renderedPath"] = serde_json::json!(final_out_path.to_string_lossy().to_string());
            update_data["renderFps"] = serde_json::json!(fps);
            update_data["renderDurationSec"] = serde_json::json!(duration_secs);
            
            let gpu_config = get_gpu_config();
            let codec = if gpu_config.tier == hyperclip_ipc::system::GPUTier::High {
                "hevc_nvenc"
            } else if matches!(gpu_config.tier, hyperclip_ipc::system::GPUTier::Mid | hyperclip_ipc::system::GPUTier::Low) {
                "h264_nvenc"
            } else {
                "libx264"
            };
            update_data["renderCodec"] = serde_json::json!(codec);
            let hw_config = get_resolved_hardware_config();
            update_data["renderPreset"] = serde_json::json!(hw_config.nvenc_preset);
            update_data["renderWorkers"] = serde_json::json!(hw_config.render_workers);
            update_data["error"] = serde_json::Value::Null;
        }
        Err(e) => {
            update_data["error"] = serde_json::json!(e.to_string());
        }
    }
    ws_store.update(id, update_data).ok();
    ws_store.save(&ws_path).ok();

    emit_workspace_event(id, status, result.as_ref().err().map(|e| e.to_string()));
}

fn emit_workspace_event(id: &str, status: &str, error: Option<String>) {
    let ws_path = get_workspaces_path();
    let store = WorkspaceStore::load(&ws_path);
    let mut payload = if let Some(ws) = store.get(id) {
        enrich_workspace_for_management(ws)
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
    hyperclip_ipc::emit_raw(&s);
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
    hyperclip_ipc::store::channel_downloads_dir("", "")
}

fn ensure_channel_video_dir(channel_name: &str, channel_id: &str) -> PathBuf {
    hyperclip_ipc::store::channel_downloads_dir(channel_id, channel_name)
}

fn get_output_path() -> PathBuf {
    hyperclip_ipc::store::channel_renders_dir("", "")
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

fn parse_quality(quality_val: Option<&serde_json::Value>) -> Option<u32> {
    quality_val.and_then(|v| {
        if let Some(s) = v.as_str() {
            let clean_s = s.replace("p", "");
            clean_s.parse::<f64>().ok().map(|f| f as u32)
        } else if let Some(f) = v.as_f64() {
            Some(f as u32)
        } else {
            v.as_u64().map(|u| u as u32)
        }
    })
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

fn ensure_chrome_tabs_open(profile_id: &str, urls: &[String]) {
    let check_url = "http://127.0.0.1:9222/json";
    let agent = ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .build();

    #[derive(serde::Deserialize, Debug)]
    struct CdpTab {
        url: Option<String>,
        #[serde(rename = "type")]
        tab_type: Option<String>,
    }

    // Attempt to connect to CDP up to 15 times (3 seconds total)
    let mut open_tabs = None;
    for _ in 0..15 {
        std::thread::sleep(std::time::Duration::from_millis(200));
        if let Ok(resp) = agent.get(check_url).timeout(std::time::Duration::from_millis(500)).call() {
            if let Ok(tabs) = serde_json::from_reader::<_, Vec<CdpTab>>(resp.into_reader()) {
                open_tabs = Some(tabs);
                break;
            }
        }
    }

    let open_tabs = match open_tabs {
        Some(t) => t,
        None => {
            tracing::warn!("[Chrome] Failed to connect to CDP to verify open tabs for {}", profile_id);
            return;
        }
    };

    fn extract_youtube_key(url: &str) -> Option<String> {
        let decoded_url = urlencoding::decode(url).map(|s| s.into_owned()).unwrap_or_else(|_| url.to_string());
        if decoded_url.contains("youtube.com/@") {
            let parts: Vec<&str> = decoded_url.split("youtube.com/").collect();
            if parts.len() > 1 {
                let rest = parts[1];
                let handle = rest.split('/').next().unwrap_or("");
                if handle.starts_with('@') {
                    return Some(handle.to_string());
                }
            }
        } else if decoded_url.contains("youtube.com/channel/") {
            let parts: Vec<&str> = decoded_url.split("youtube.com/channel/").collect();
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

    for url in urls {
        let is_open = if let Some(target_key) = extract_youtube_key(url) {
            let dec_target_key = urlencoding::decode(&target_key).map(|s| s.into_owned()).unwrap_or_else(|_| target_key.clone());
            open_tabs.iter().any(|tab| {
                if tab.tab_type.as_deref() != Some("page") {
                    return false;
                }
                if let Some(ref u) = tab.url {
                    let dec_tab_url = urlencoding::decode(u).map(|s| s.into_owned()).unwrap_or_else(|_| u.clone());
                    dec_tab_url.contains(&dec_target_key)
                } else {
                    false
                }
            })
        } else {
            open_tabs.iter().any(|tab| {
                if tab.tab_type.as_deref() != Some("page") {
                    return false;
                }
                if let Some(ref u) = tab.url {
                    let dec_tab_url = urlencoding::decode(u).map(|s| s.into_owned()).unwrap_or_else(|_| u.clone());
                    dec_tab_url == *url || dec_tab_url == format!("{}/", url)
                } else {
                    false
                }
            })
        };

        if !is_open {
            tracing::info!("[Chrome] Opening new tab via CDP for {}: {}", profile_id, url);
            let encoded_url = urlencoding::encode(url);
            let new_tab_url = format!("http://127.0.0.1:9222/json/new?{}", encoded_url);
            if let Err(e) = agent.put(&new_tab_url).call() {
                tracing::warn!("[Chrome] Failed to open tab via CDP: {}", e);
            }
        } else {
            tracing::info!("[Chrome] Tab already open for {}, skipping: {}", profile_id, url);
        }
    }
}

fn launch_chrome_profile_async(profile_id: &str) {
    let (user_data_dir, profile_dir_name) = get_chrome_launch_args(profile_id);
    
    // Check if CDP is already running for this exact user-data-dir
    let cdp_already_running = {
        let check_url = "http://127.0.0.1:9222/json/version";
        let agent = ureq::AgentBuilder::new()
            .try_proxy_from_env(false)
            .build();
        if let Ok(resp) = agent.get(check_url).timeout(std::time::Duration::from_millis(500)).call() {
            if let Ok(json) = serde_json::from_reader::<_, serde_json::Value>(resp.into_reader()) {
                if let Some(user_data_dir_str) = json.get("User-Data-Dir").and_then(|v| v.as_str()) {
                    let running_path = std::fs::canonicalize(user_data_dir_str).ok();
                    let target_path = std::fs::canonicalize(&user_data_dir).ok();
                    running_path.is_some() && running_path == target_path
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        }
    };

    let is_same_profile_running = cdp_already_running || {
        if let Ok(lock) = hyperclip_ipc::cookies::ACTIVE_CHROME_PROFILE.lock() {
            lock.as_deref() == Some(profile_id)
        } else {
            false
        }
    };
    if !is_same_profile_running {
        if let Ok(mut lock) = hyperclip_ipc::cookies::ACTIVE_CHROME_PROFILE.lock() {
            *lock = Some(profile_id.to_string());
        }
    }
    let chrome_path = get_chrome_executable_path();
    let profile_id_owned = profile_id.to_string();

    let mut urls = vec!["https://www.youtube.com".to_string()];
    if profile_id == "HyperClip-Profile-1" {
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

    let urls_clone = urls.clone();
    let profile_id_owned_clone = profile_id_owned.clone();

    std::thread::spawn(move || {
        let mut launched = false;
        if is_same_profile_running {
            tracing::info!("[Chrome] Chrome is already running for profile {}. Checking open tabs...", profile_id_owned_clone);
            
            // Ensure tabs are open in background
            let urls_c = urls_clone.clone();
            let p_id_c = profile_id_owned_clone.clone();
            std::thread::spawn(move || {
                ensure_chrome_tabs_open(&p_id_c, &urls_c);
            });

            // Extract cookies immediately
            match extract_profile_cookies_and_feed(&profile_id_owned_clone) {
                Ok(_) => {
                    tracing::info!("[Chrome] Successfully extracted and updated cookies for existing Chrome profile {}", profile_id_owned_clone);
                    crate::emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));
                    if let Ok(mut lock) = hyperclip_ipc::cookies::ACTIVE_CHROME_PROFILE.lock() {
                        if lock.as_deref() == Some(&profile_id_owned_clone) {
                            *lock = None;
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("[Chrome] Failed to extract cookies for existing Chrome: {}", e);
                    crate::emit(hyperclip_ipc::IpcResponse::event("notification", serde_json::json!({
                        "title": "Đăng nhập YouTube",
                        "message": "Trình duyệt Chrome đang mở. Vui lòng đăng nhập để hoàn tất đồng bộ tài khoản."
                    })));

                    // Spawn a monitor thread to wait for Chrome to close/sync
                    let profile_id_clone = profile_id_owned_clone.clone();
                    std::thread::spawn(move || {
                        static MONITORED: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::OnceLock::new();
                        let monitored_set = MONITORED.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()));

                        {
                            let mut lock = monitored_set.lock().unwrap();
                            if lock.contains(&profile_id_clone) {
                                tracing::info!("[Chrome Monitor] Profile {} is already being monitored", profile_id_clone);
                                return;
                            }
                            lock.insert(profile_id_clone.clone());
                        }

                        tracing::info!("[Chrome Monitor] Started monitoring Chrome (port 9222) for profile {}...", profile_id_clone);
                        let agent = ureq::AgentBuilder::new()
                            .try_proxy_from_env(false)
                            .build();
                        let check_url = "http://127.0.0.1:9222/json";

                        let mut synced = false;
                        loop {
                            std::thread::sleep(std::time::Duration::from_millis(2000));
                            let is_running = agent.get(check_url)
                                .timeout(std::time::Duration::from_millis(1000))
                                .call()
                                .is_ok();

                            if !is_running {
                                tracing::info!("[Chrome Monitor] Chrome has closed for profile {}", profile_id_clone);
                                #[cfg(windows)]
                                {
                                    let (u_dir, _) = get_chrome_launch_args(&profile_id_clone);
                                    let ud_str = u_dir.to_string_lossy().replace('\\', "\\\\");
                                    let filter = format!("Name = 'chrome.exe' AND CommandLine LIKE '%--user-data-dir={}%'", ud_str);
                                    let script = format!(
                                        "Get-CimInstance Win32_Process -Filter \"{}\" | Invoke-CimMethod -MethodName Terminate",
                                        filter
                                    );
                                    let mut cmd = std::process::Command::new("powershell");
                                    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
                                    use std::os::windows::process::CommandExt;
                                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                                    let _ = cmd.status();
                                    std::thread::sleep(std::time::Duration::from_millis(500));
                                    
                                    // Try one final extraction after killing lingering processes
                                    let _ = extract_profile_cookies_and_feed(&profile_id_clone);
                                }
                                break;
                            }

                            match extract_profile_cookies_and_feed(&profile_id_clone) {
                                Ok(cookie_string) => {
                                    let has_sapisid = cookie_string.contains("SAPISID");
                                    if has_sapisid && !synced {
                                        tracing::info!("[Chrome Monitor] Detected successful login for existing profile {}", profile_id_clone);
                                        crate::emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));
                                        crate::emit(hyperclip_ipc::IpcResponse::event("notification", serde_json::json!({
                                            "title": "Đồng bộ thành công",
                                            "message": format!("Đã đồng bộ cookies thành công cho {}", profile_id_clone)
                                        })));
                                        synced = true;
                                    }
                                }
                                Err(_) => {}
                            }
                        }

                        let mut lock = monitored_set.lock().unwrap();
                        lock.remove(&profile_id_clone);

                        if let Ok(mut lock) = hyperclip_ipc::cookies::ACTIVE_CHROME_PROFILE.lock() {
                            if lock.as_deref() == Some(&profile_id_clone) {
                                *lock = None;
                            }
                        }
                    });
                }
            }
            launched = true;
        }

        if !launched {
            if let Ok(mut lock) = hyperclip_ipc::cookies::ACTIVE_CHROME_PROFILE.lock() {
                *lock = Some(profile_id_owned_clone.clone());
            }
            tracing::info!("[Chrome] Launching new Chrome process for profile: {}", profile_id_owned_clone);
            let mut cmd = std::process::Command::new(chrome_path);
            cmd.arg(format!("--user-data-dir={}", user_data_dir.to_string_lossy()));
            cmd.arg(format!("--profile-directory={}", profile_dir_name));
            cmd.arg("--remote-debugging-port=9222");
            cmd.arg("--disable-background-timer-throttling");
            cmd.arg("--disable-backgrounding-occluded-windows");
            cmd.arg("--disable-renderer-backgrounding");
            cmd.arg("--disable-features=GCM");
            cmd.arg("--disable-background-networking");
            cmd.stdout(std::process::Stdio::null());
            cmd.stderr(std::process::Stdio::null());
            cmd.arg("https://www.youtube.com"); // Open only homepage to prevent duplicates

            tracing::info!("[Chrome] Running Command: {:?}", cmd);
            
            match cmd.spawn() {
                Ok(mut child) => {
                    tracing::info!("[Chrome] Process spawned successfully, PID: {:?}", child.id());
                    let profile_id_clone = profile_id_owned_clone.clone();
                    let urls_c = urls_clone.clone();
                    std::thread::spawn(move || {
                        // Ensure all channels are opened in the background without duplicating
                        ensure_chrome_tabs_open(&profile_id_clone, &urls_c);

                        let mut synced = false;
                        loop {
                            std::thread::sleep(std::time::Duration::from_millis(2000));
                            
                            let is_closed = match child.try_wait() {
                                Ok(Some(status)) => {
                                    tracing::info!("[Chrome] Chrome window closed with status: {:?}", status);
                                    true
                                }
                                _ => false,
                            };

                            if is_closed {
                                #[cfg(windows)]
                                {
                                    let (u_dir, _) = get_chrome_launch_args(&profile_id_clone);
                                    let ud_str = u_dir.to_string_lossy().replace('\\', "\\\\");
                                    let filter = format!("Name = 'chrome.exe' AND CommandLine LIKE '%--user-data-dir={}%'", ud_str);
                                    let script = format!(
                                        "Get-CimInstance Win32_Process -Filter \"{}\" | Invoke-CimMethod -MethodName Terminate",
                                        filter
                                    );
                                    let mut cmd = std::process::Command::new("powershell");
                                    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
                                    use std::os::windows::process::CommandExt;
                                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                                    let _ = cmd.status();
                                    std::thread::sleep(std::time::Duration::from_millis(500));
                                }
                            }

                            match extract_profile_cookies_and_feed(&profile_id_clone) {
                                Ok(cookie_string) => {
                                    let has_sapisid = cookie_string.contains("SAPISID");
                                    if has_sapisid && !synced {
                                        tracing::info!("[Chrome Monitor] Detected successful login for new profile {}", profile_id_clone);
                                        crate::emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));
                                        crate::emit(hyperclip_ipc::IpcResponse::event("notification", serde_json::json!({
                                            "title": "Đồng bộ thành công",
                                            "message": format!("Đã đồng bộ cookies thành công cho {}", profile_id_clone)
                                        })));
                                        synced = true;
                                    }
                                }
                                Err(e) => {
                                    if is_closed {
                                        let err_msg = format!("Failed to extract cookies after Chrome closed: {}", e);
                                        tracing::error!("[Chrome] {}", err_msg);
                                        crate::emit(hyperclip_ipc::IpcResponse::event("notification", serde_json::json!({
                                            "title": "Lỗi đồng bộ Cookies",
                                            "message": err_msg
                                        })));
                                    }
                                }
                            }

                            if is_closed {
                                break;
                            }
                        }

                        if let Ok(mut lock) = hyperclip_ipc::cookies::ACTIVE_CHROME_PROFILE.lock() {
                            if lock.as_deref() == Some(&profile_id_clone) {
                                *lock = None;
                            }
                        }
                    });
                }
                Err(e) => {
                    let err_msg = format!("Failed to launch Google Chrome: {}. Please make sure Google Chrome is installed on your system.", e);
                    tracing::error!("[Chrome] {}", err_msg);
                    crate::emit(hyperclip_ipc::IpcResponse::event("notification", serde_json::json!({
                        "title": "Chrome Launch Error",
                        "message": err_msg
                    })));
                    if let Ok(mut lock) = hyperclip_ipc::cookies::ACTIVE_CHROME_PROFILE.lock() {
                        if lock.as_deref() == Some(&profile_id_owned_clone) {
                            *lock = None;
                        }
                    }
                }
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

    if cmd.starts_with("system:") || cmd.starts_with("hardware:") || cmd.starts_with("logs:") || cmd.starts_with("update:") {
        system::handle(cmd, params)
    } else if cmd.starts_with("settings:") {
        settings::handle(cmd, params)
    } else if cmd.starts_with("channel:") || cmd.starts_with("key:") || cmd.starts_with("poller:") || cmd.starts_with("detection:") {
        channel::handle(cmd, params)
    } else if cmd.starts_with("workspace:") || cmd.starts_with("video:") || cmd.starts_with("image:") || cmd.starts_with("render:") || cmd.starts_with("rendered:") || cmd.starts_with("storage:") || cmd == "resource:alert" {
        workspace::handle(cmd, params)
    } else if cmd.starts_with("auth:") || cmd.starts_with("session:") || cmd.starts_with("project:") {
        auth::handle(cmd, params)
    } else {
        CommandResult::Err(format!("unknown command: {}", cmd))
    }
}



/// Resolve channel metadata via yt-dlp
fn resolve_channel_metadata(url: &str) -> (Option<String>, Option<String>, Option<String>) {
    let ytdlp = find_ytdlp_path();
    let node_runtime = find_node_runtime_arg();
    let output = std::process::Command::new(&ytdlp)
        .args([
            "--js-runtimes", &node_runtime,
            "--no-warnings",
            "--skip-download",
            "--dump-single-json",
            "--flat-playlist",
            "--playlist-items", "0",
            "--extractor-args",
            "youtube:player_client=android_vr",
            url,
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&s) {
                let name = data.get("channel")
                    .or_else(|| data.get("uploader"))
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let channel_id = data.get("channel_id")
                    .or_else(|| data.get("id"))
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let avatar = data.get("thumbnail")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .or_else(|| {
                        let thumbnails = data.get("thumbnails").and_then(|v| v.as_array())?;
                        // Find a square thumbnail representing the channel avatar
                        let square_thumb = thumbnails.iter().find(|item| {
                            let w = item.get("width").and_then(|v| v.as_u64());
                            let h = item.get("height").and_then(|v| v.as_u64());
                            w.is_some() && w == h && w.unwrap() > 0
                        });
                        
                        if let Some(item) = square_thumb {
                            item.get("url").and_then(|v| v.as_str()).map(String::from)
                        } else {
                            let avatar_by_url = thumbnails.iter().find(|item| {
                                item.get("url").and_then(|v| v.as_str())
                                    .map(|u| u.contains("-c-k-") || u.contains("=s"))
                                    .unwrap_or(false)
                            });
                            if let Some(item) = avatar_by_url {
                                item.get("url").and_then(|v| v.as_str()).map(String::from)
                            } else {
                                thumbnails.first().and_then(|item| item.get("url")).and_then(|v| v.as_str()).map(String::from)
                            }
                        }
                    });
                return (name, channel_id, avatar);
            }
            (None, None, None)
        }
        _ => (None, None, None),
    }
}

// find_ytdlp is imported from hyperclip_ipc::youtube

fn load_workspaces() -> Value {
    let store = WorkspaceStore::load(&get_workspaces_path());
    let mut workspaces_enriched = Vec::new();
    for ws in &store.workspaces {
        let ws_val = enrich_workspace_for_management(ws);
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
    let downloaded_mtime = file_mtime_ms(&ws.downloaded_path).map(|t| t.saturating_sub(2000));
    let mut download_finished = downloaded_mtime.or(ws.downloaded_at);
    if download_finished.is_none() && (ws.status == "done" || ws.status == "rendered" || ws.rendered_path.is_some()) {
        download_finished = Some(ws.created_at);
    }

    let rendered_mtime = file_mtime_ms(&ws.rendered_path)
        .map(|t| t.saturating_sub(2000))
        .or_else(|| {
            if ws.status == "done" {
                let sec = ws.render_duration_sec.unwrap_or(0.0);
                download_finished.map(|d| d + (sec * 1000.0) as i64)
            } else {
                None
            }
        });

    // Use download_started_at as the start time, fall back to created_at if not set.
    let download_start = ws.download_started_at.unwrap_or(ws.created_at);
    let download_duration_sec = match download_finished {
        Some(t) if download_start > 0 => ((t - download_start).max(0) as f64) / 1000.0,
        _ => 0.0,
    };
    let render_duration_sec = match ws.render_duration_sec {
        Some(sec) => sec,
        None => match (download_finished, rendered_mtime) {
            (Some(d), Some(r)) if r > d => ((r - d) as f64) / 1000.0,
            _ => 0.0,
        }
    };
    let detection_duration_sec = if ws.is_startup_catchup || ws.published_at <= 86400 * 1000 {
        0.0
    } else {
        ((ws.created_at - ws.published_at).max(0) as f64) / 1000.0
    };
    let total_duration_sec = detection_duration_sec + download_duration_sec + render_duration_sec;

    let file_size_bytes = ws.file_size.unwrap_or(0);
    let download_speed_str = if download_duration_sec > 0.0 && file_size_bytes > 0 {
        let mb_per_sec = (file_size_bytes as f64) / (1024.0 * 1024.0) / download_duration_sec;
        Some(format!("{:.1} MB/s", mb_per_sec))
    } else {
        ws.download_speed.clone()
    };

    // Merge persisted workspace fields + computed enrichments into a single JSON object.
    let base = serde_json::to_value(ws).unwrap_or(Value::Null);
    if let Value::Object(mut map) = base {
        // Verify local thumbnail exists on disk, otherwise nullify to force fallback
        if let Some(t_path) = ws.thumbnail_local.as_ref() {
            if !std::path::Path::new(t_path).exists() {
                map.insert("thumbnailLocal".into(), Value::Null);
            }
        }
        map.insert("downloadedMtime".into(), json!(download_finished));
        map.insert("renderedMtime".into(), json!(rendered_mtime));
        map.insert("downloadDurationSec".into(), json!(download_duration_sec));
        map.insert("renderDurationSec".into(), json!(render_duration_sec));
        map.insert("detectionDurationSec".into(), json!(detection_duration_sec));
        map.insert("totalDurationSec".into(), json!(total_duration_sec));
        map.insert("downloadSpeed".into(), json!(download_speed_str));
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
        // Migrate is_short to true for all existing workspaces by default
        if !ws.is_short {
            ws.is_short = true;
            db_updated = true;
        }

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
            if !old_path_str.trim().is_empty() {
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
        }

        // 3.2 Update thumbnailLocal & rename thumbnail file
        if let Some(ref old_path_str) = ws.thumbnail_local {
            if !old_path_str.trim().is_empty() {
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
        }

        // 3.3 Update renderedPath & rename render folder/file
        if let Some(ref old_path_str) = ws.rendered_path {
            if !old_path_str.trim().is_empty() {
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

#[derive(Debug, Clone)]
pub struct ResolvedHardwareConfig {
    pub render_workers: usize,
    pub chunk_workers: usize,
    pub download_instances: usize,
    pub nvenc_preset: String,
    pub concurrent_fragments: u32,
    pub gpu_tier: hyperclip_ipc::GPUTier,
}

pub fn get_resolved_hardware_config() -> ResolvedHardwareConfig {
    let s_path = get_settings_path();
    let s_store = SettingsStore::load(&s_path);
    
    let stats = get_system_stats();
    let gpu = get_gpu_config();

    // Determine target VRAM. Either from saved settings or fall back to auto-detected.
    // Prioritize physically detected VRAM if it is higher than the setting's configuration
    let mut vram = if let Some(profile) = s_store.settings.get("hardwareProfile") {
        let profile_vram = profile.get("vramGB").and_then(|v| v.as_u64()).unwrap_or(stats.vram_total_gb as u64);
        if stats.vram_total_gb > 0 {
            profile_vram.min(stats.vram_total_gb as u64)
        } else {
            profile_vram
        }
    } else {
        stats.vram_total_gb as u64
    };

    // Default values if no profile match
    let mut render_workers = gpu.max_workers as usize;
    let mut chunk_workers = 8;
    let mut download_instances = 2;
    let mut nvenc_preset = "p1".to_string();
    let mut concurrent_fragments = 16;
    let mut gpu_tier = gpu.tier;
    
    let is_extreme_system = stats.gpu_name.contains("5080")
        || stats.gpu_name.contains("5090")
        || stats.gpu_name.contains("4090")
        || stats.gpu_name.contains("Blackwell");

    if is_extreme_system {
        render_workers = 12;
        chunk_workers = 28;
        download_instances = 10;
        nvenc_preset = "p4".to_string();
        concurrent_fragments = 32;
        gpu_tier = hyperclip_ipc::GPUTier::High;
    } else {
        match vram {
            v if v >= 16 => { // Ultra
                render_workers = 6;
                chunk_workers = 14;
                download_instances = 6;
                nvenc_preset = "p4".to_string(); // p4 is optimized high-quality, p7 is high quality but slower
                concurrent_fragments = 32;
                gpu_tier = hyperclip_ipc::GPUTier::High;
            }
            v if v >= 12 => { // High
                render_workers = 3;
                chunk_workers = 6;
                download_instances = 2;
                nvenc_preset = "p3".to_string();
                concurrent_fragments = 16;
                gpu_tier = hyperclip_ipc::GPUTier::High;
            }
            v if v >= 8 => { // Medium
                render_workers = 2;
                chunk_workers = 4;
                download_instances = 2;
                nvenc_preset = "p2".to_string();
                concurrent_fragments = 16;
                gpu_tier = hyperclip_ipc::GPUTier::Mid;
            }
            v if v >= 6 => { // Low
                render_workers = 2;
                chunk_workers = 2;
                download_instances = 1;
                nvenc_preset = "p1".to_string();
                concurrent_fragments = 32;
                gpu_tier = hyperclip_ipc::GPUTier::Low;
            }
            _ => { // Minimal
                render_workers = 1;
                chunk_workers = 1;
                download_instances = 1;
                nvenc_preset = "p1".to_string();
                concurrent_fragments = 32;
                gpu_tier = hyperclip_ipc::GPUTier::Low;
            }
        }
    }

    // Cap workers and fragment limits based on physical RAM to prevent OOM
    let ram_total_gb = (stats.ram_total / (1024 * 1024 * 1024)) as usize;
    let mut ram_gb = if let Some(profile) = s_store.settings.get("hardwareProfile") {
        let profile_ram = profile.get("ramGB").and_then(|v| v.as_u64()).unwrap_or(ram_total_gb as u64) as usize;
        if ram_total_gb > 0 {
            profile_ram.min(ram_total_gb)
        } else {
            profile_ram
        }
    } else {
        ram_total_gb
    };

    if ram_gb > 0 {
        if ram_gb < 16 {
            render_workers = render_workers.min(1);
            chunk_workers = chunk_workers.min(2);
            download_instances = download_instances.min(1);
            concurrent_fragments = concurrent_fragments.min(32);
        } else if ram_gb < 24 {
            render_workers = render_workers.min(2);
            chunk_workers = chunk_workers.min(4);
            download_instances = download_instances.min(2);
            concurrent_fragments = concurrent_fragments.min(32);
        } else if ram_gb < 32 {
            render_workers = render_workers.min(3);
            chunk_workers = chunk_workers.min(6);
            download_instances = download_instances.min(2);
            concurrent_fragments = concurrent_fragments.min(32);
        } else if ram_gb < 48 {
            render_workers = render_workers.min(4);
            chunk_workers = chunk_workers.min(8);
            download_instances = download_instances.min(3);
            concurrent_fragments = concurrent_fragments.min(32);
        }
    }

    // Force Software encoding if no physical NVIDIA GPU is present
    if gpu.tier == hyperclip_ipc::GPUTier::Software {
        gpu_tier = hyperclip_ipc::GPUTier::Software;
        // Strict capping for CPU-only (Software) mode to prevent CPU/memory exhaustion
        render_workers = render_workers.min(gpu.max_workers as usize);
        chunk_workers = chunk_workers.min(4);
        download_instances = download_instances.min(2);
        concurrent_fragments = concurrent_fragments.min(16);
    }
    
    ResolvedHardwareConfig {
        render_workers,
        chunk_workers,
        download_instances,
        nvenc_preset,
        concurrent_fragments,
        gpu_tier,
    }
}

fn trigger_startup_render(ws: &hyperclip_ipc::store::Workspace) {
    let rid = ws.id.clone();
    let in_path = if let Some(ref path) = ws.downloaded_path {
        PathBuf::from(path)
    } else {
        return;
    };
    let (cid_split, cname_split, _) = lookup_channel_ids(&ws.id);
    let out_path = if !cid_split.is_empty() || !cname_split.is_empty() {
        hyperclip_ipc::store::build_render_path(&cid_split, &cname_split, &rid)
    } else {
        let legacy_out = get_legacy_output_dir();
        std::fs::create_dir_all(&legacy_out).ok();
        legacy_out.join(format!("{}.mp4", rid))
    };

    tracing::info!("[AppState] Startup catch-up: Spawning render for workspace: {}, input: {}, output: {}", rid, in_path.display(), out_path.display());

    let ws_path = get_workspaces_path();
    let mut ws_store = WorkspaceStore::load(&ws_path);
    ws_store.update(&rid, serde_json::json!({
        "status": "rendering",
    })).ok();
    ws_store.save(&ws_path).ok();
    emit_workspace_event(&rid, "rendering", None);

    let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
    let res = ws.export_resolution.clone();
    let fps = ws.fps_target;
    let speed = ws.video_speed;
    let part_is_short = ws.is_short;
    let trim_start = ws.trim_start;
    let trim_end = ws.trim_end;
    let bottom_bar_color = ws.bottom_bar_color.clone();
    rt.spawn(async move {
        let hw_cfg = get_resolved_hardware_config();
        let pool = get_render_worker_pool();
        let _permit = pool.acquire().await;
        let opts = RenderOptions {
            workspace_id: rid.clone(),
            input_path: in_path.clone(),
            output_path: out_path.clone(),
            resolution: res,
            fps,
            speed,
            trim_start, trim_end,
            gpu_tier: hw_cfg.gpu_tier,
            preset: hw_cfg.nvenc_preset,
            filter_chain: if part_is_short { FilterChain::Short } else { FilterChain::Landscape },
            chunked: false, chunk_duration_sec: 120,
            bottom_bar_color,
        };
        let pid = rid.clone();
        let start_time = std::time::Instant::now();
        let result = spawn_render_async(opts, move |progress| {
            let e = serde_json::json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
            hyperclip_ipc::emit_raw(&serde_json::to_string(&e).unwrap_or_default());
        }).await;
        let duration_secs = start_time.elapsed().as_secs_f64();
        handle_render_completion(&rid, result, duration_secs);
    });
}