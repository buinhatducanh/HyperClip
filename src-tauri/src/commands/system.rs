use serde_json::{json, Value};
use std::path::PathBuf;
use super::*;
use hyperclip_ipc::{get_system_stats, SettingsStore, get_settings_path};
use hyperclip_ipc::store::get_logs_dir;

pub fn handle(cmd: &str, params: &Value) -> CommandResult {
    let result = match cmd {
        "system:stats" => Ok(json!(get_system_stats())),

        "system:openFolder" => {
            let raw_path = p(params, "path").unwrap_or_default();
            let path = clean_path(&raw_path);
            tracing::info!("openFolder (raw: {}, clean: {})", raw_path, path);
            #[cfg(windows)]
            {
                let mut path_buf = std::path::PathBuf::from(&path);
                if path_buf.is_relative() {
                    if let Ok(cwd) = std::env::current_dir() {
                        path_buf = cwd.join(path_buf);
                    }
                }
                let p = path_buf.as_path();
                // Pre-create the directory/parent directory if they do not exist
                if !p.exists() {
                    if p.extension().is_some() {
                        if let Some(parent) = p.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                    } else {
                        let _ = std::fs::create_dir_all(p);
                    }
                }

                if p.exists() {
                    let target_path = if let Ok(can) = std::fs::canonicalize(p) {
                        let can_str = can.to_string_lossy();
                        let cleaned = clean_path(&can_str);
                        PathBuf::from(cleaned)
                    } else {
                        p.to_path_buf()
                    };

                    if target_path.is_file() {
                        use std::os::windows::process::CommandExt;
                        let _ = std::process::Command::new("explorer")
                            .raw_arg(format!(r#"/select,"{}""#, target_path.to_string_lossy()))
                            .spawn();
                    } else {
                        let _ = std::process::Command::new("explorer").arg(target_path.as_os_str()).spawn();
                    }
                } else {
                    // Fallback to parent
                    if let Some(parent) = p.parent() {
                        let parent_path = if let Ok(can) = std::fs::canonicalize(parent) {
                            let can_str = can.to_string_lossy();
                            let cleaned = clean_path(&can_str);
                            Some(PathBuf::from(cleaned))
                        } else if parent.exists() {
                            Some(parent.to_path_buf())
                        } else {
                            None
                        };

                        if let Some(pp) = parent_path {
                            let _ = std::process::Command::new("explorer").arg(pp.as_os_str()).spawn();
                        }
                    }
                }
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

        "hardware:profile" => {
            let stats = get_system_stats();
            let s_path = get_settings_path();
            let s_store = SettingsStore::load(&s_path);
            
            // Auto-detect matching preset ID based on detected VRAM
            let auto_active = match stats.vram_total_gb {
                v if v >= 16 => "ultra",
                v if v >= 12 => "high",
                v if v >= 8 => "medium",
                v if v >= 6 => "low",
                _ => "minimal",
            };

            let active = s_store.settings.get("hardwareProfile")
                .and_then(|v| v.get("vramGB"))
                .and_then(|v| v.as_u64())
                .map(|v| match v {
                    16 => "ultra",
                    12 => "high",
                    8 => "medium",
                    6 => "low",
                    4 => "minimal",
                    _ => auto_active,
                })
                .unwrap_or(auto_active);

            // If the active preset requires more VRAM than physically detected, fall back to auto_active
            let active_vram = match active {
                "ultra" => 16,
                "high" => 12,
                "medium" => 8,
                "low" => 6,
                "minimal" => 4,
                _ => 0,
            };
            let active = if stats.vram_total_gb > 0 && active_vram > stats.vram_total_gb as u64 {
                auto_active
            } else {
                active
            };

            Ok(json!({
                "detected": {
                    "vramGB": stats.vram_total_gb,
                    "ramGB": (stats.ram_total / (1024 * 1024 * 1024)) as u32,
                    "gpuName": stats.gpu_name,
                },
                "active": active,
            }))
        }

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

        _ => Err(format!("unknown system command: {}", cmd)),
    };

    match result {
        Ok(val) => CommandResult::Ok(val),
        Err(err) => CommandResult::Err(err),
    }
}

pub fn clean_path(path: &str) -> String {
    let mut cleaned = path.trim().to_string();
    
    // Decode percent encoding first
    if let Ok(decoded) = urlencoding::decode(&cleaned) {
        cleaned = decoded.into_owned();
    }
    
    // Check if it's a file URI
    if cleaned.starts_with("file:///") {
        cleaned = cleaned.chars().skip(8).collect();
    } else if cleaned.starts_with("file://") {
        cleaned = cleaned.chars().skip(7).collect();
    }

    // Strip Windows canonical UNC/local prefix (\\?\UNC\ or \\?\)
    if cleaned.starts_with("\\\\?\\UNC\\") {
        cleaned = format!("\\\\{}", &cleaned[8..]);
    } else if cleaned.starts_with("\\\\?\\") {
        cleaned = cleaned[4..].to_string();
    }
    
    #[cfg(windows)]
    {
        cleaned = cleaned.replace('/', "\\");
        // Remove leading backslash if it precedes a drive letter (e.g. \C:\)
        if cleaned.starts_with('\\') && cleaned.len() >= 3 && cleaned.chars().nth(2).map(|c| c == ':').unwrap_or(false) {
            cleaned = cleaned.split_off(1);
        }
    }
    cleaned
}
