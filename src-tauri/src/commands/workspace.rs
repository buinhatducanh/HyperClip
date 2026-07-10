use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::collections::HashMap;
use tokio_util::sync::CancellationToken;
use super::*;
use hyperclip_ipc::{
    WorkspaceStore, RenderedStore, SettingsStore, get_workspaces_path, get_rendered_videos_path,
    get_settings_path, get_cookies_netscape_path
};
use hyperclip_ipc::youtube::{download_video, download_video_streaming, probe_formats};
use hyperclip_ipc::thumbnail::download_youtube_thumbnail_to;
use hyperclip_ipc::ffmpeg::{spawn_render_async, RenderOptions, FilterChain};

pub fn handle(cmd: &str, params: &Value) -> CommandResult {
    let result = match cmd {
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

        "workspace:add" => {
            let url = p(params, "url").unwrap_or_default();
            tracing::info!("workspace:add {}", url);
            Ok(json!({ "ok": true, "id": format!("ws-{}", chrono::Utc::now().timestamp_millis()) }))
        }

        "workspace:update" => {
            let id = p(params, "id").unwrap_or_default();
            let field = p(params, "field").unwrap_or_default();
            let value = params.get("value").cloned().unwrap_or(Value::Null);

            let allowed: [&str; 6] = ["title", "speed", "trimStart", "trimEnd", "thumbnail", "bottomBarColor"];
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
            hyperclip_ipc::emit_raw(&s);

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

        "workspace:clear" => {
            let ws_path = get_workspaces_path();
            let mut store = WorkspaceStore::load(&ws_path);
            let mut bytes_freed: u64 = 0;
            let mut files_deleted: u32 = 0;

            for ws in &store.workspaces {
                let id = &ws.id;
                let (cid, cname, _) = lookup_channel_ids(id);

                if let Some(ref dl_path) = ws.downloaded_path {
                    let p = PathBuf::from(dl_path);
                    if p.exists() {
                        if let Ok(meta) = std::fs::metadata(&p) { bytes_freed += meta.len(); files_deleted += 1; }
                        std::fs::remove_file(&p).ok();
                    }
                }
                let legacy_file = get_video_storage_path().join(format!("{}.mp4", id));
                if legacy_file.exists() {
                    if let Ok(meta) = std::fs::metadata(&legacy_file) { bytes_freed += meta.len(); files_deleted += 1; }
                    std::fs::remove_file(&legacy_file).ok();
                }
                if !cid.is_empty() {
                    let render_path = build_render_path(&cid, &cname, id);
                    if render_path.exists() {
                        if let Ok(meta) = std::fs::metadata(&render_path) {
                            bytes_freed += meta.len();
                            files_deleted += 1;
                        }
                    }
                    let render_dir = render_output_dir(&cid, &cname, id);
                    if render_dir.exists() {
                        std::fs::remove_dir_all(&render_dir).ok();
                    }
                }
                let legacy_out = get_output_path().join(format!("{}.mp4", id));
                if legacy_out.exists() {
                    if let Ok(meta) = std::fs::metadata(&legacy_out) { bytes_freed += meta.len(); files_deleted += 1; }
                    std::fs::remove_file(&legacy_out).ok();
                }
            }

            store.workspaces.clear();
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

            let quality = parse_quality(params.get("quality"))
                .or_else(|| parse_quality(s_store.settings.get("autoDownloadQuality")))
                .or_else(|| parse_quality(s_store.settings.get("defaultQuality")))
                .unwrap_or(1080);

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

            let now_ms = chrono::Utc::now().timestamp_millis() - 2000;
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
            let actual_duration = ws_store.workspaces.iter().find(|w| w.id == id).and_then(|w| w.duration_sec);

            std::thread::spawn(move || {
                let pool = super::get_download_worker_pool();
                let download_res = tokio::runtime::Runtime::new()
                    .map(|rt| rt.block_on(async {
                        let _permit = pool.acquire().await;
                        let hw_cfg = super::get_resolved_hardware_config();
                        download_video(&url2, &out_str, &cookies_str, trim_minutes, actual_duration, quality, hw_cfg.concurrent_fragments)
                    }))
                    .unwrap_or_else(|e| Err(format!("Runtime creation failed: {}", e)));

                match download_res {
                    Ok(result) => {
                        // Download thumbnail
                        let thumb_path = get_thumbnail_path(&cid2, &cname2, &vid2);
                        let thumb_str = download_youtube_thumbnail_to(&vid2, &thumb_path);

                        // Persist thumbnail, status, downloadedPath and downloadedAt to store
                        let ws_path = get_workspaces_path();
                        let mut ws_store = WorkspaceStore::load(&ws_path);
                        let now_ms = chrono::Utc::now().timestamp_millis() - 2000;
                        let is_short_val = ws_store.workspaces.iter().find(|w| w.id == tid).map(|w| w.is_short).unwrap_or(true) || result.width < result.height || result.duration <= 60.0;
                        let quality_val = result.height;
                        let duration_sec_val = result.duration.round() as u64;
                        let file_size_val = result.file_size;

                        let original_duration_sec = ws_store.workspaces.iter()
                            .find(|w| w.id == tid)
                            .and_then(|w| w.original_duration_sec)
                            .unwrap_or_else(|| {
                                if trim_minutes == 0 {
                                    result.duration.round() as u64
                                } else {
                                    actual_duration.unwrap_or(result.duration.round() as u64)
                                }
                            });

                        ws_store.update(&tid, serde_json::json!({
                            "thumbnailLocal": thumb_str,
                            "status": "ready",
                            "downloadedPath": result.path,
                            "downloadedAt": now_ms,
                            "isShort": is_short_val,
                            "quality": quality_val,
                            "fileSize": file_size_val,
                            "durationSec": duration_sec_val,
                            "originalQuality": quality_val,
                            "originalDurationSec": original_duration_sec,
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
                            "originalQuality": quality_val,
                            "originalDurationSec": original_duration_sec,
                        })));

                        // Spawn background thread to find original quality without blocking the ready status
                        let url_clone = url2.clone();
                        let cookies_str_clone = cookies_str.clone();
                        let tid_clone = tid.clone();
                        std::thread::spawn(move || {
                            match probe_formats(&url_clone, &cookies_str_clone) {
                                Ok(formats) => {
                                    if let Some(original_quality) = formats.last().cloned() {
                                        let ws_path = get_workspaces_path();
                                        let mut ws_store = WorkspaceStore::load(&ws_path);
                                        ws_store.update(&tid_clone, serde_json::json!({
                                            "originalQuality": original_quality,
                                        })).ok();
                                        let _ = ws_store.save(&ws_path);

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
                    }
                    Err(e) => {
                        tracing::error!("workspace::retry download failed for {}: {}", tid, e);
                        
                        let ws_path = get_workspaces_path();
                        let mut ws_store = WorkspaceStore::load(&ws_path);
                        ws_store.update(&tid, serde_json::json!({
                            "status": "error",
                            "error": e.clone(),
                        })).ok();
                        ws_store.save(&ws_path).ok();

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
            let now_ms = chrono::Utc::now().timestamp_millis() - 2000;
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
            let dl_quality = parse_quality(params.get("quality"))
                .or_else(|| parse_quality(s_store.settings.get("autoDownloadQuality")))
                .or_else(|| parse_quality(s_store.settings.get("defaultQuality")))
                .unwrap_or(1080);
            let out_str = output_str.clone();
            let cid2 = cid.clone();
            let cname2 = cname.clone();
            let actual_duration = ws_store.workspaces.iter().find(|w| w.id == id).and_then(|w| w.duration_sec);
            std::thread::spawn(move || {
                let pool = super::get_download_worker_pool();
                let download_res = tokio::runtime::Runtime::new()
                    .map(|rt| rt.block_on(async {
                        let _permit = pool.acquire().await;
                        let hw_cfg = super::get_resolved_hardware_config();
                        download_video_streaming(&url, &out_str, &cookies_str, trim_minutes, actual_duration, dl_quality, hw_cfg.concurrent_fragments, |progress| {
                            emit_download_progress(&tid, &progress);
                        })
                    }))
                    .unwrap_or_else(|e| Err(format!("Runtime creation failed: {}", e)));

                download_res.map(|result| {
                    tracing::info!("workspace:autoDownload complete: {} -> {} ({} bytes)",
                        tid, result.path, result.file_size);

                    // Download thumbnail to per-channel dir
                    let video_id = url.rsplit('=').next().unwrap_or(&tid).to_string();
                    let thumb_path = get_thumbnail_path(&cid2, &cname2, &video_id);
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

                    let original_duration_sec = ws_store.workspaces.iter()
                        .find(|w| w.id == tid)
                        .and_then(|w| w.original_duration_sec)
                        .unwrap_or_else(|| {
                            if trim_minutes == 0 {
                                result.duration.round() as u64
                            } else {
                                actual_duration.unwrap_or(result.duration.round() as u64)
                            }
                        });

                    ws_store.update(&tid, serde_json::json!({
                        "status": "ready",
                        "downloadedPath": result.path,
                        "thumbnailLocal": thumb_str,
                        "downloadedAt": now_ms,
                        "isShort": is_short_val,
                        "quality": quality_val,
                        "fileSize": file_size_val,
                        "durationSec": duration_sec_val,
                        "originalQuality": quality_val,
                        "originalDurationSec": original_duration_sec,
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
                            "originalQuality": quality_val,
                            "originalDurationSec": original_duration_sec,
                        }
                    });
                    let s = serde_json::to_string(&event).unwrap();
                    hyperclip_ipc::emit_raw(&s);

                    // Spawn background thread to find original quality without blocking the ready/render status
                    let url_clone = url.clone();
                    let cookies_str_clone = cookies_str.clone();
                    let tid_clone = tid.clone();
                    std::thread::spawn(move || {
                        match probe_formats(&url_clone, &cookies_str_clone) {
                            Ok(formats) => {
                                if let Some(original_quality) = formats.last().cloned() {
                                    let ws_path = get_workspaces_path();
                                    let mut ws_store = WorkspaceStore::load(&ws_path);
                                    ws_store.update(&tid_clone, serde_json::json!({
                                        "originalQuality": original_quality,
                                    })).ok();
                                    let _ = ws_store.save(&ws_path);

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

                    // Auto-render after successful download
                    let s_path2 = get_settings_path();
                    let s_store2 = SettingsStore::load(&s_path2);

                    // Check if auto-split is enabled
                    let auto_split_parts = s_store2.settings.get("autoSplitParts")
                        .or_else(|| s_store2.settings.get("auto_split_parts"))
                        .and_then(|v| {
                            v.as_u64()
                                .or_else(|| v.as_f64().map(|f| f as u64))
                                .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok().map(|f| f as u64)))
                        })
                        .unwrap_or(1);
                    
                    let auto_split_minutes = s_store2.settings.get("autoSplitMinutes")
                        .or_else(|| s_store2.settings.get("auto_split_minutes"))
                        .and_then(|v| {
                            v.as_u64()
                                .or_else(|| v.as_f64().map(|f| f as u64))
                                .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok().map(|f| f as u64)))
                        })
                        .unwrap_or(0);
                    let duration_sec = result.duration;

                    let is_split = auto_split_parts > 1 || (auto_split_minutes > 0 && duration_sec > (auto_split_minutes * 60) as f64);

                    let rid = tid.clone();
                    if is_split {
                        tracing::info!("[AppState] Skipping auto-render of parent video {} since it is configured to auto-split", rid);
                    } else {
                        let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
                        let in_path = out_str.clone();
                        let auto_speed2 = s_store2.settings.get("autoRenderSpeed").or_else(|| s_store2.settings.get("auto_render_speed")).and_then(|v| v.as_f64()).unwrap_or(1.0);
                        let auto_res2 = s_store2.settings.get("autoRenderResolution").or_else(|| s_store2.settings.get("auto_render_resolution")).and_then(|v| v.as_str()).unwrap_or("1080p").to_string();
                        let auto_fps2 = s_store2.settings.get("autoRenderFPS").or_else(|| s_store2.settings.get("auto_render_fps")).and_then(|v| v.as_u64()).unwrap_or(30) as u32;
                        let out_path = build_render_path(&cid2, &cname2, &rid);
                        rt.spawn(async move {
                            // Update database status to rendering
                            let ws_path = get_workspaces_path();
                            let mut ws_store = WorkspaceStore::load(&ws_path);
                            let auto_trim_end = result.duration;
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

                            let hw_cfg = super::get_resolved_hardware_config();
                            let pool = super::get_render_worker_pool();
                            let _permit = pool.acquire().await;
                            let bottom_bar_color = ws_store.workspaces.iter()
                                .find(|w| w.id == rid)
                                .and_then(|w| w.bottom_bar_color.clone());
                            let auto_preset2 = s_store2.settings
                                .get("autoRenderPreset")
                                .or_else(|| s_store2.settings.get("auto_render_preset"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or(hw_cfg.nvenc_preset.clone());
                            let opts = RenderOptions {
                                workspace_id: rid.clone(),
                                input_path: PathBuf::from(&in_path),
                                output_path: out_path.clone(),
                                resolution: auto_res2,
                                fps: auto_fps2,
                                speed: auto_speed2,
                                trim_start: 0.0, trim_end: auto_trim_end,
                                gpu_tier: hw_cfg.gpu_tier,
                                preset: auto_preset2,
                                filter_chain,
                                chunked: false, chunk_duration_sec: 120,
                                bottom_bar_color,
                            };
                            let pid = rid.clone();
                            let start_time = std::time::Instant::now();
                            let result = spawn_render_async(opts, move |progress| {
                                let e = json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                                hyperclip_ipc::emit_raw(&serde_json::to_string(&e).unwrap());
                            }).await;
                            let duration_secs = start_time.elapsed().as_secs_f64();
                            if let Err(ref e) = result {
                                tracing::error!("[AppState] Auto-render after download failed for workspace {}: {:?}", rid, e);
                            }
                            handle_render_completion(&rid, result, duration_secs);
                        });
                    }
                })
                .unwrap_or_else(|e| {
                    tracing::error!("workspace:autoDownload failed for {}: {}", tid, e);
                    
                    let ws_path = get_workspaces_path();
                    let mut ws_store = WorkspaceStore::load(&ws_path);
                    ws_store.update(&tid, serde_json::json!({
                        "status": "error",
                        "error": e.clone(),
                    })).ok();
                    ws_store.save(&ws_path).ok();

                    emit_workspace_event(&tid, "error", Some(e));
                });
            });
            Ok(json!({"ok": true, "id": id, "status": "downloading", "outputPath": output_str}))
        }

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
            let now_ms = chrono::Utc::now().timestamp_millis() - 2000;
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
            let actual_duration = ws_store.workspaces.iter().find(|w| w.id == id).and_then(|w| w.duration_sec);
            std::thread::spawn(move || {
                let pool = super::get_download_worker_pool();
                let download_res = tokio::runtime::Runtime::new()
                    .map(|rt| rt.block_on(async {
                        let _permit = pool.acquire().await;
                        let hw_cfg = super::get_resolved_hardware_config();
                        download_video_streaming(&url, &out_str, &cookies_str, trim_minutes, actual_duration, 1080, hw_cfg.concurrent_fragments, |progress| {
                            emit_download_progress(&tid, &progress);
                        })
                    }))
                    .unwrap_or_else(|e| Err(format!("Runtime creation failed: {}", e)));

                download_res.map(|result| {
                    // Download thumbnail
                    let video_id = url.rsplit('=').next().unwrap_or(&tid).to_string();
                    let thumb_path = get_thumbnail_path(&cid2, &cname2, &video_id);
                    let _ = download_youtube_thumbnail_to(&video_id, &thumb_path);

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

                    let rid = tid.clone();
                    if is_split {
                        tracing::info!("[AppState] Skipping auto-render of parent video {} after redownload since it is configured to auto-split", rid);
                    } else {
                        let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
                        let in_path = out_str.clone();
                        let out_path = build_render_path(&cid2, &cname2, &rid);
                        rt.spawn(async move {
                            let hw_cfg = super::get_resolved_hardware_config();
                            let pool = super::get_render_worker_pool();
                            let _permit = pool.acquire().await;
                            let auto_trim_end = result.duration;
                            let filter_chain = if is_short_val { FilterChain::Short } else { FilterChain::Landscape };
                            let ws_path = get_workspaces_path();
                            let ws_store = WorkspaceStore::load(&ws_path);
                            let bottom_bar_color = ws_store.workspaces.iter()
                                .find(|w| w.id == rid)
                                .and_then(|w| w.bottom_bar_color.clone());
                            let opts = RenderOptions {
                                workspace_id: rid.clone(),
                                input_path: PathBuf::from(&in_path),
                                output_path: out_path.clone(),
                                resolution: "1080p".into(),
                                fps: 30, speed: 1.0,
                                trim_start: 0.0, trim_end: auto_trim_end,
                                gpu_tier: hw_cfg.gpu_tier,
                                preset: hw_cfg.nvenc_preset,
                                filter_chain,
                                chunked: false, chunk_duration_sec: 120,
                                bottom_bar_color,
                            };
                            let pid = rid.clone();
                            let start_time = std::time::Instant::now();
                            let result = spawn_render_async(opts, move |progress| {
                                let e = json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                                hyperclip_ipc::emit_raw(&serde_json::to_string(&e).unwrap());
                            }).await;
                            let duration_secs = start_time.elapsed().as_secs_f64();
                            handle_render_completion(&rid, result, duration_secs);
                        });
                    }
                })
                .unwrap_or_else(|e| {
                    let ws_path = get_workspaces_path();
                    let mut ws_store = WorkspaceStore::load(&ws_path);
                    ws_store.update(&tid, serde_json::json!({
                        "status": "error",
                        "error": e.clone(),
                    })).ok();
                    ws_store.save(&ws_path).ok();

                    emit_workspace_event(&tid, "error", Some(e));
                });
            });
            Ok(json!({ "success": true, "id": id, "status": "downloading" }))
        }

        "workspace:regenerateBlur" => {
            let id = p(params, "id").unwrap_or_default();
            let ws_path = get_workspaces_path();
            let store = WorkspaceStore::load(&ws_path);
            let ws = store.workspaces.iter().find(|w| w.id == id);
            let video_path = if let Some(w) = ws {
                if let Some(ref path) = w.downloaded_path {
                    PathBuf::from(path)
                } else {
                    get_video_storage_path().join(format!("{}.mp4", id))
                }
            } else {
                get_video_storage_path().join(format!("{}.mp4", id))
            };
            if !video_path.exists() {
                Ok(json!({"success": false, "error": "video file not found"}))
            } else {
                let blur_dir = get_video_storage_path().join("blur");
                std::fs::create_dir_all(&blur_dir).ok();
                let output = blur_dir.join(format!("{}.jpg", id));
                let mut cmd = std::process::Command::new("ffmpeg");
                cmd.args(&["-i", &video_path.to_string_lossy(), "-vf", "scale=160:90",
                    "-frames:v", "1", "-y", &output.to_string_lossy()])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000);
                }
                let status = cmd.status().ok();
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

                let mut parts_to_render = vec![];

                for (i, part) in parts.iter().enumerate() {
                    let new_id = format!("{}-part{}", id, i + 1);
                    let trim_start = part.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let trim_end = part.get("end").and_then(|v| v.as_f64()).unwrap_or(60.0);
                    let custom_title = part.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    let mut new_ws = src.clone();
                    new_ws.id = new_id.clone();
                    new_ws.title = if !custom_title.is_empty() {
                        custom_title.to_string()
                    } else {
                        format!("{} (Part {})", src.title, i + 1)
                    };
                    new_ws.trim_start = trim_start;
                    new_ws.trim_end = trim_end;
                    new_ws.status = if auto_render { "rendering" } else { "ready" }.to_string();
                    new_ws.auto_render = auto_render;
                    new_ws.fps_target = render_fps;
                    new_ws.export_resolution = render_res.clone();
                    new_ws.video_speed = render_speed;
                    new_ws.is_short = (trim_end - trim_start) <= 60.0 || src.is_short;
                    new_ws.rendered_path = None;
                    new_ws.progress = None;
                    new_ws.error = None;
                    new_ws.render_fps = None;
                    new_ws.render_workers = None;
                    new_ws.render_preset = None;
                    new_ws.render_codec = None;
                    new_ws.render_duration_sec = None;
                    store.add(new_ws);

                    if auto_render {
                        parts_to_render.push((new_id.clone(), trim_start, trim_end));
                    }
                    new_ids.push(new_id);
                }

                // Save to disk first so that build_render_path can resolve the correct file names from workspaces.json!
                store.save(&ws_path).ok();

                // Emit workspace event for each new workspace to notify the frontend
                for nid in &new_ids {
                    let status = if auto_render { "rendering" } else { "ready" };
                    super::emit_workspace_event(nid, status, None);
                }

                // Trigger render for each part after saving
                for (rid, trim_start, trim_end) in parts_to_render {
                    let in_path = if let Some(ref path) = src.downloaded_path {
                        PathBuf::from(path)
                    } else {
                        get_video_storage_path().join(format!("{}.mp4", id))
                    };
                    let (cid_split, cname_split, _) = lookup_channel_ids(&id);
                    let out_path = if !cid_split.is_empty() || !cname_split.is_empty() {
                        build_render_path(&cid_split, &cname_split, &rid)
                    } else {
                        let legacy_out = get_legacy_output_dir();
                        std::fs::create_dir_all(&legacy_out).ok();
                        legacy_out.join(format!("{}.mp4", rid))
                    };

                    tracing::info!("[AppState] Starting split render for part: {}, input: {}, output: {}", rid, in_path.display(), out_path.display());

                    let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
                    let res = render_res.clone();
                    let fps = render_fps;
                    let speed = render_speed;
                    let part_is_short = (trim_end - trim_start) <= 60.0 || src.is_short;
                    let bottom_bar_color = src.bottom_bar_color.clone();
                    rt.spawn(async move {
                        let hw_cfg = super::get_resolved_hardware_config();
                        let pool = super::get_render_worker_pool();
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
                            hyperclip_ipc::emit_raw(&serde_json::to_string(&e).unwrap());
                        }).await;
                        let duration_secs = start_time.elapsed().as_secs_f64();
                        handle_render_completion(&rid, result, duration_secs);
                    });
                }
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
                let cookies_path = get_cookies_netscape_path();
                let cookies_str = cookies_path.to_string_lossy().to_string();
                if let Ok(heights) = probe_formats(&video_url, &cookies_str) {
                    let mut filtered: Vec<u32> = heights.into_iter().filter(|&h| h >= 360).collect();
                    filtered.sort();
                    filtered.dedup();
                    if !filtered.is_empty() { formats = filtered; }
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
            let token_clone = token.clone();
            rt.spawn(async move {
                let hw_cfg = super::get_resolved_hardware_config();
                let pool = super::get_render_worker_pool();
                let token_clone1 = token_clone.clone();
                let _permit = tokio::select! {
                    p = pool.acquire() => p,
                    _ = token_clone1.cancelled() => {
                        tracing::info!("[AppState] Render cancelled while waiting for worker pool permit for workspace {}", tid);
                        if let Some(map) = CANCEL_TOKEN_MAP.get() {
                            let mut map = map.lock().unwrap();
                            map.remove(&tid);
                        }
                        // Update status to failed/cancelled
                        let ws_path = get_workspaces_path();
                        let mut store = WorkspaceStore::load(&ws_path);
                        store.update(&tid, serde_json::json!({
                            "status": "failed",
                            "error": "Render cancelled by user"
                        })).ok();
                        let _ = store.save(&ws_path);
                        emit_workspace_event(&tid, "failed", Some("Render cancelled by user".to_string()));
                        return;
                    }
                };
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
                let ws_is_short = store.workspaces.iter().find(|w| w.id == tid).map(|w| w.is_short).unwrap_or(true);

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
                let ws_bottom_bar_color = workspace.and_then(|w| w.bottom_bar_color.clone());
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
                    gpu_tier: hw_cfg.gpu_tier,
                    preset: hw_cfg.nvenc_preset,
                    filter_chain: if ws_is_short { FilterChain::Short } else { FilterChain::Landscape },
                    chunked: false,
                    chunk_duration_sec: 120,
                    bottom_bar_color: ws_bottom_bar_color,
                };
                let tid_for_progress = tid.clone();
                let start_time = std::time::Instant::now();
                let token_clone2 = token_clone.clone();
                let result = tokio::select! {
                    res = spawn_render_async(opts, move |progress| {
                        let event = json!({"method": "render:progress", "params": {"id": tid_for_progress, "progress": progress}});
                        let s = serde_json::to_string(&event).unwrap();
                        hyperclip_ipc::emit_raw(&s);
                    }) => res,
                    _ = token_clone2.cancelled() => {
                        tracing::info!("[AppState] Render cancelled during execution for workspace {}", tid);
                        Err(hyperclip_ipc::HyperclipError::BackendCrashed("Render cancelled by user".into()))
                    }
                };
                let duration_secs = start_time.elapsed().as_secs_f64();
                if let Err(ref e) = result {
                    tracing::error!("[AppState] Manual render failed for workspace {}: {:?}", tid, e);
                }
                handle_render_completion(&tid, result, duration_secs);
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
            let ws_is_short = store.workspaces.iter().find(|w| w.id == id).map(|w| w.is_short).unwrap_or(true);

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
            let ws_bottom_bar_color = workspace.and_then(|w| w.bottom_bar_color.clone());
            let tid = id.clone();
            let rt = RENDER_RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
            rt.spawn(async move {
                let hw_cfg = super::get_resolved_hardware_config();
                let pool = super::get_render_worker_pool();
                let _permit = pool.acquire().await;
                let opts = RenderOptions {
                    workspace_id: tid.clone(),
                    input_path,
                    output_path: out_path,
                    resolution: ws_resolution,
                    fps: ws_fps, speed: ws_speed,
                    trim_start: ws_trim_start, trim_end: ws_trim_end,
                    gpu_tier: hw_cfg.gpu_tier,
                    preset: hw_cfg.nvenc_preset,
                    filter_chain: if ws_is_short { FilterChain::Short } else { FilterChain::Landscape },
                    chunked: true,
                    chunk_duration_sec: chunk_duration as u32,
                    bottom_bar_color: ws_bottom_bar_color,
                };
                let pid = tid.clone();
                let start_time = std::time::Instant::now();
                let result = spawn_render_async(opts, move |progress| {
                    let e = json!({"method": "render:progress", "params": {"id": pid, "progress": progress}});
                    hyperclip_ipc::emit_raw(&serde_json::to_string(&e).unwrap());
                }).await;
                let duration_secs = start_time.elapsed().as_secs_f64();
                handle_render_completion(&tid, result, duration_secs);
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
                    let cleaned_path = super::system::clean_path(&v.output_path);
                    let p = std::path::Path::new(&cleaned_path);
                    let folder_to_open = if p.is_file() || p.extension().is_some() {
                        p.parent().map(|p| p.to_path_buf())
                    } else {
                        Some(p.to_path_buf())
                    };
                    if let Some(fdir) = folder_to_open {
                        let _ = std::fs::create_dir_all(&fdir);
                        std::process::Command::new("explorer").arg(fdir.as_os_str()).spawn().ok();
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
            let mut media_downloads = if media_dir.exists() {
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

            // Shared new flat downloads directory
            let shared_downloads_dir = hyperclip_ipc::store::channel_downloads_dir("", "");
            if shared_downloads_dir.exists() && shared_downloads_dir != base_dir {
                media_downloads += dir_size_internal(&shared_downloads_dir);
            }

            let blur_size = dir_size_internal(&blur_dir);
            let mut output = if media_dir.exists() {
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

            // Shared new flat renders directory
            let shared_renders_dir = hyperclip_ipc::store::channel_renders_dir("", "");
            if shared_renders_dir.exists() && shared_renders_dir != out_dir {
                output += dir_size_internal(&shared_renders_dir);
            }

            Ok(json!({
                "downloads": downloads + media_downloads,
                "blur": blur_size,
                "total": downloads + media_downloads + output,
                "downloadPath": shared_downloads_dir.to_string_lossy().to_string(),
                "outputPath": shared_renders_dir.to_string_lossy().to_string(),
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
            // Delete files in new shared downloads directory
            let shared_downloads_dir = hyperclip_ipc::store::channel_downloads_dir("", "");
            if shared_downloads_dir.exists() {
                let is_hc_file = |name: &str| -> bool {
                    let clean_name = name.trim_end_matches(".part").trim_end_matches(".ytdl").trim_end_matches(".temp");
                    if !clean_name.ends_with(".mp4") {
                        return false;
                    }
                    let base = clean_name.trim_end_matches(".mp4");
                    if base.len() < 16 {
                        return false;
                    }
                    let parts: Vec<&str> = base.split('_').collect();
                    if parts.len() < 3 {
                        return false;
                    }
                    let last = parts[parts.len() - 1];
                    let prev = parts[parts.len() - 2];
                    last.len() == 6 && last.chars().all(|c| c.is_ascii_digit()) &&
                    prev.len() == 8 && prev.chars().all(|c| c.is_ascii_digit())
                };

                if let Ok(entries) = std::fs::read_dir(&shared_downloads_dir) {
                    for entry in entries.flatten() {
                        if let Ok(meta) = entry.metadata() {
                            if meta.is_file() {
                                let filename = entry.file_name().to_string_lossy().to_string();
                                if is_hc_file(&filename) {
                                    freed += meta.len();
                                    std::fs::remove_file(entry.path()).ok();
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

        // ─── Resource alerts ────────────────────────────────────────
        "resource:alert" => {
            Ok(json!({"level": "ok", "freeDiskGB": 10.0}))
        }

        _ => Err(format!("unknown workspace command: {}", cmd)),
    };

    match result {
        Ok(val) => CommandResult::Ok(val),
        Err(err) => CommandResult::Err(err),
    }
}
