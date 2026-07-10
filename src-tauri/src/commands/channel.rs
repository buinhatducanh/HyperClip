use serde_json::{json, Value};
use super::*;
use hyperclip_ipc::{
    ChannelStore, KeyStore, KeyEntry, get_channels_path, get_keys_path, get_settings_path, SettingsStore
};

pub fn handle(cmd: &str, params: &Value) -> CommandResult {
    let result = match cmd {
        // ─── Channels ───────────────────────────────────────────────
        "channel:list" => Ok(load_channels()),

        "channel:add" => {
            let raw = p(params, "url")
                .or_else(|| p(params, "handle"))
                .unwrap_or_default();
            if raw.is_empty() {
                return CommandResult::Ok(json!({"ok": false, "error": "url or handle required"}));
            }
            let raw = urlencoding::decode(&raw)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| raw.clone());
            let ch_path = get_channels_path();
            let mut store = ChannelStore::load(&ch_path);

            // 1. Normalize URL
            let mut normalized = if raw.starts_with("http") {
                raw.clone()
            } else if raw.starts_with('@') {
                if raw.starts_with("@UC") && raw.len() == 25 {
                    format!("https://www.youtube.com/channel/{}", &raw[1..])
                } else {
                    format!("https://www.youtube.com/{}", raw)
                }
            } else if raw.starts_with("UC") && raw.len() == 24 {
                format!("https://www.youtube.com/channel/{}", raw)
            } else {
                format!("https://www.youtube.com/@{}", raw.trim_start_matches('@'))
            };

            // If it's a URL like https://www.youtube.com/@UCys3v7DpF_4P6JERJOOCtug...
            // normalize it to https://www.youtube.com/channel/UCys3v7DpF_4P6JERJOOCtug...
            if let Some(pos) = normalized.find("youtube.com/@UC") {
                let start_idx = pos + "youtube.com/@".len();
                if normalized.len() >= start_idx + 24 {
                    let maybe_id = &normalized[start_idx..start_idx + 24];
                    if maybe_id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
                        let rest = &normalized[start_idx + 24..];
                        normalized = format!("https://www.youtube.com/channel/{}{}", maybe_id, rest);
                    }
                }
            }

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

            let channel_id_str = parsed_id.as_deref().unwrap_or(&raw);
            let existing_idx = store.channels.iter().position(|c| {
                let dec_channel_id = urlencoding::decode(channel_id_str).map(|s| s.into_owned()).unwrap_or_else(|_| channel_id_str.to_string());
                let dec_ch_handle = urlencoding::decode(c.handle.as_str()).map(|s| s.into_owned()).unwrap_or_else(|_| c.handle.clone());
                let dec_c_id = c.channel_id.as_deref().map(|id| urlencoding::decode(id).map(|s| s.into_owned()).unwrap_or_else(|_| id.to_string()));

                let clean_eq = |s1: &str, s2: &str| -> bool {
                    s1.trim_start_matches('@').trim().to_lowercase() == s2.trim_start_matches('@').trim().to_lowercase()
                };

                dec_c_id == Some(dec_channel_id.clone())
                    || clean_eq(&dec_ch_handle, &dec_channel_id)
            });

            if let Some(idx) = existing_idx {
                let (resolved_name, resolved_id, resolved_avatar) = resolve_channel_metadata(&normalized);
                let mut changed = false;
                let ch = &mut store.channels[idx];
                if let Some(name) = resolved_name {
                    if ch.name != name {
                        ch.name = name;
                        changed = true;
                    }
                }
                if let Some(avatar) = resolved_avatar {
                    if ch.avatar_url.as_ref() != Some(&avatar) {
                        ch.avatar_url = Some(avatar);
                        changed = true;
                    }
                }
                if let Some(chan_id) = resolved_id {
                    if ch.channel_id.as_ref() != Some(&chan_id) {
                        ch.channel_id = Some(chan_id);
                        changed = true;
                    }
                }
                if changed {
                    store.save(&ch_path).ok();
                    poller_sync_channels();
                }
                return CommandResult::Ok(json!({"ok": true, "id": store.channels[idx].id, "updated": true}));
            }

            // 4. Try to resolve metadata via yt-dlp
            let (resolved_name, resolved_id, resolved_avatar) = resolve_channel_metadata(&normalized);

            let id = format!("ch-{}", chrono::Utc::now().timestamp_millis());
            let final_name = resolved_name.unwrap_or_else(|| {
                channel_id_str.trim_start_matches('@').to_string()
            });
            let final_channel_id = resolved_id.unwrap_or(channel_id_str.to_string());
            if final_channel_id.contains("youtube.com") 
               || final_channel_id.contains("youtu.be") 
               || final_channel_id.contains("watch?") 
               || final_channel_id.contains("/shorts/") 
            {
                return CommandResult::Ok(json!({"ok": false, "error": "Invalid channel URL. Please provide a valid YouTube channel page or handle."}));
            }
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

            // Spawn background thread to update all channels' avatars and names from YouTube
            let ch_path_clone = ch_path.clone();
            std::thread::spawn(move || {
                let mut store = ChannelStore::load(&ch_path_clone);
                let mut changed = false;
                for ch in &mut store.channels {
                    let handle_or_id = ch.channel_id.clone()
                        .or_else(|| Some(ch.handle.clone()))
                        .unwrap_or_default();
                    if handle_or_id.is_empty() { continue; }
                    let url = if handle_or_id.starts_with("UC") {
                        format!("https://www.youtube.com/channel/{}", handle_or_id)
                    } else if handle_or_id.starts_with('@') {
                        format!("https://www.youtube.com/{}", handle_or_id)
                    } else {
                        format!("https://www.youtube.com/@{}", handle_or_id)
                    };
                    let (resolved_name, resolved_id, resolved_avatar) = resolve_channel_metadata(&url);
                    if let Some(avatar) = resolved_avatar {
                        if ch.avatar_url.as_ref() != Some(&avatar) {
                            ch.avatar_url = Some(avatar);
                            changed = true;
                        }
                    }
                    if let Some(name) = resolved_name {
                        if ch.name != name {
                            ch.name = name;
                            changed = true;
                        }
                    }
                    if let Some(chan_id) = resolved_id {
                        if ch.channel_id.as_ref() != Some(&chan_id) {
                            ch.channel_id = Some(chan_id);
                            changed = true;
                        }
                    }
                }
                if changed {
                    store.save(&ch_path_clone).ok();
                    poller_sync_channels();
                }
            });

            let event = json!({"method": "channel:synced", "params": {"count": count}});
            let s = serde_json::to_string(&event).unwrap();
            hyperclip_ipc::emit_raw(&s);
            Ok(json!({"added": 0, "removed": 0}))
        }

        "channel:autoAssign" => Ok(json!({"success": true, "assigned": 0})),

        "channel:getInfo" => Ok(json!({"channelId": p(params, "url").unwrap_or_default(), "name": "Unknown"})),

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

        // ─── Poller ──────────────────────────────────────────────────
        "poller:prewarm" => {
            let count = params.get("count").and_then(|v| v.as_u64()).unwrap_or(8) as usize;
            let delay_ms = params.get("delayMs").and_then(|v| v.as_u64()).unwrap_or(200) as u64;

            std::thread::spawn(move || {
                let state = AppState::get_or_init();
                let pool = &state.pool;
                for i in 0..count {
                    match pool.prewarm_single_client() {
                        Ok(true) => {
                            tracing::info!("[prewarm] Pre-warmed client {}/{}", i + 1, count);
                        }
                        Ok(false) => {
                            tracing::info!("[prewarm] Client limit reached at {}/{}", i + 1, count);
                            crate::emit(hyperclip_ipc::IpcResponse::event(
                                "poller:prewarm_progress",
                                serde_json::json!({ "current": count, "total": count, "done": true })
                            ));
                            break;
                        }
                        Err(e) => {
                            tracing::error!("[prewarm] Pre-warming client {} failed: {:?}", i + 1, e);
                        }
                    }
                    crate::emit(hyperclip_ipc::IpcResponse::event(
                        "poller:prewarm_progress",
                        serde_json::json!({
                            "current": i + 1,
                            "total": count,
                            "done": i + 1 == count
                        })
                    ));
                    if i + 1 < count && delay_ms > 0 {
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                    }
                }
            });

            Ok(json!({ "ok": true }))
        }

        "poller:start" => {
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
            let poll_int = s_store.settings.get("pollIntervalMs").and_then(|v| v.as_u64()).unwrap_or(3000);
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

        "detection:clear" => {
            let _state = AppState::get_or_init();
            if let Ok(mut store) = crate::commands::detection_events_store().lock() {
                store.clear();
            }
            Ok(json!({ "success": true }))
        }

        "poller:resume" => {
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

        _ => Err(format!("unknown channel command: {}", cmd)),
    };

    match result {
        Ok(val) => CommandResult::Ok(val),
        Err(err) => CommandResult::Err(err),
    }
}
