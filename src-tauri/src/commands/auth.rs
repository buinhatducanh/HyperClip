use serde_json::{json, Value};
use super::*;
use hyperclip_ipc::{
    ProjectStore, ProjectEntry,
    get_projects_path, get_cookies_path,
    get_chrome_user_data_dir, extract_chrome_cookies
};

pub fn handle(cmd: &str, params: &Value) -> CommandResult {
    let result = match cmd {
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

            tracing::info!("[AuthStatus] Status checked. is_ready={}, cookie_len={}, cookie_count={}, has_sapisid={}",
                is_ready, cookie_str.len(), cookie_count, cookie_str.contains("SAPISID") || cookie_str.contains("__Secure-3PAPISID"));

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
            let cookies_path = hyperclip_ipc::get_cookies_path();
            let netscape_path = hyperclip_ipc::get_cookies_netscape_path();
            
            if cookies_path.exists() { std::fs::remove_file(&cookies_path).ok(); }
            if netscape_path.exists() { std::fs::remove_file(&netscape_path).ok(); }
            
            let pool = &AppState::get_or_init().pool;
            for i in 0..30 {
                pool.set_session_cookie(i, String::new());
            }
            
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
            let mut source_profile = None;
            let pool = &AppState::get_or_init().pool;
            for i in 1..=30 {
                if pool.is_session_logged_in(i - 1) {
                    source_profile = Some(format!("HyperClip-Profile-{}", i));
                    break;
                }
            }
            if source_profile.is_none() && pool.is_session_logged_in(0) {
                let default_json = resolve_profile_dir("Default").join("_hyperclip_cookies.json");
                if default_json.exists() {
                    source_profile = Some("Default".to_string());
                }
            }

            if let Some(src_id) = source_profile {
                let src_dir = resolve_profile_dir(&src_id);
                let src_json = src_dir.join("_hyperclip_cookies.json");
                if src_json.exists() {
                    if let Ok(content) = std::fs::read_to_string(&src_json) {
                        let mut cloned_count = 0;
                        for i in 1..=30 {
                            let target_id = format!("HyperClip-Profile-{}", i);
                            if target_id == src_id {
                                continue;
                            }
                            let target_dir = resolve_profile_dir(&target_id);
                            if !target_dir.exists() {
                                std::fs::create_dir_all(&target_dir).ok();
                            }
                            let target_json = target_dir.join("_hyperclip_cookies.json");
                            if std::fs::write(&target_json, &content).is_ok() {
                                if extract_profile_cookies_and_feed(&target_id).is_ok() {
                                    cloned_count += 1;
                                }
                            }
                        }

                        if src_id != "Default" {
                            let target_dir = resolve_profile_dir("Default");
                            if !target_dir.exists() {
                                std::fs::create_dir_all(&target_dir).ok();
                            }
                            let target_json = target_dir.join("_hyperclip_cookies.json");
                            if std::fs::write(&target_json, &content).is_ok() {
                                let _ = extract_profile_cookies_and_feed("Default");
                            }
                        }

                        tracing::info!("[Cookies] Cloned cookies from {} to {} profiles", src_id, cloned_count);
                        crate::emit(hyperclip_ipc::IpcResponse::event("channel:synced", serde_json::json!({})));
                        Ok(json!({"success": true, "clonedCount": cloned_count}))
                    } else {
                        Err("Không thể đọc file cookies gốc.".to_string())
                    }
                } else {
                    Err("Không tìm thấy file cookies gốc.".to_string())
                }
            } else {
                Err("Không tìm thấy profile nào đã đăng nhập để làm nguồn sao chép. Vui lòng đăng nhập vào Profile 1 (hoặc bất kỳ profile nào) trước.".to_string())
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

        _ => Err(format!("unknown auth command: {}", cmd)),
    };

    match result {
        Ok(val) => CommandResult::Ok(val),
        Err(err) => CommandResult::Err(err),
    }
}
