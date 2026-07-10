use serde_json::{json, Value};
use super::*;
use hyperclip_ipc::{SettingsStore, get_settings_path};

pub fn handle(cmd: &str, params: &Value) -> CommandResult {
    let result = match cmd {
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

            let state = AppState::get_or_init();

            // Reload active daemon limit dynamically (default to 8)
            let daemon_limit = store.settings.get("daemonLimit").and_then(|v| v.as_u64()).unwrap_or(8) as usize;
            state.pool.max_active_clients.store(daemon_limit, std::sync::atomic::Ordering::SeqCst);
            tracing::info!("[Settings] Updated active daemon limit to {}", daemon_limit);

            // Handle pollingEnabled change
            let new_polling = store.settings.get("pollingEnabled").and_then(|v| v.as_bool()).unwrap_or(false);
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

        _ => Err(format!("unknown settings command: {}", cmd)),
    };

    match result {
        Ok(val) => CommandResult::Ok(val),
        Err(err) => CommandResult::Err(err),
    }
}
