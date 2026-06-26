// crates/hyperclip_ipc/src/store/paths.rs

use std::path::{Path, PathBuf};
use chrono::TimeZone;
use super::{SettingsStore, WorkspaceStore};

/// Resolve resources directory path dynamically.
/// Checks relative to the current executable directory, then relative to the current working directory.
pub fn get_resources_dir() -> PathBuf {
    // 1. Check relative to current executable directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let res_dir = exe_dir.join("resources");
            if res_dir.exists() {
                return res_dir;
            }
            // Traverse up parents to support target/debug or target/release dev builds
            let mut parent = exe_dir.parent();
            while let Some(p) = parent {
                let res_dir = p.join("resources");
                if res_dir.exists() {
                    return res_dir;
                }
                parent = p.parent();
            }
        }
    }
    // 2. Check relative to current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let res_dir = cwd.join("resources");
        if res_dir.exists() {
            return res_dir;
        }
    }
    // 3. Fallback to "./resources" relative to CWD
    PathBuf::from("resources")
}

/// Determine data directory (env HYPERCLIP_DATA_DIR, or ./data/ relative to cwd).
/// Central single point — all data (media, settings, logs) lives under here.
pub fn get_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("HYPERCLIP_DATA_DIR") {
        return PathBuf::from(dir);
    }
    let local_data = PathBuf::from("data");
    if local_data.exists() && local_data.is_dir() {
        return local_data;
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        return PathBuf::from(app_data).join("HyperClip");
    }
    local_data
}

/// Store directory (internal JSON state, not user-visible media).
pub fn get_store_dir() -> PathBuf {
    get_data_dir().join(".hyperclip")
}

pub fn get_workspaces_path() -> PathBuf {
    get_store_dir().join("workspaces.json")
}

pub fn get_channels_path() -> PathBuf {
    get_store_dir().join("channels").join("channels.json")
}

pub fn get_seen_videos_path() -> PathBuf {
    get_store_dir().join("channels").join("seen.json")
}

pub fn get_uploads_cache_path() -> PathBuf {
    get_store_dir().join("channels").join("uploads-cache.json")
}

pub fn get_settings_path() -> PathBuf {
    get_store_dir().join("settings.json")
}

pub fn get_rendered_videos_path() -> PathBuf {
    get_store_dir().join("rendered-videos.json")
}

pub fn get_keys_path() -> PathBuf {
    get_store_dir().join("keys.json")
}

pub fn get_projects_path() -> PathBuf {
    get_store_dir().join("projects.json")
}

/// Media root — all channel assets organized by channel_id.
pub fn get_media_dir() -> PathBuf {
    get_data_dir().join("media")
}

/// Per-channel media root, e.g. data/media/{channel_id}/
pub fn channel_media_dir(channel_id: &str, channel_name: &str) -> PathBuf {
    get_media_dir().join(channel_folder_name(channel_id, channel_name))
}

/// data/media/{channel_id}/downloads/
pub fn channel_downloads_dir(_channel_id: &str, _channel_name: &str) -> PathBuf {
    let s_path = get_settings_path();
    let s_store = SettingsStore::load(&s_path);
    if let Some(path_str) = s_store.settings.get("videoStoragePath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty()) {
        let dir = PathBuf::from(path_str);
        std::fs::create_dir_all(&dir).ok();
        dir
    } else {
        let dir = get_data_dir().join("downloads");
        std::fs::create_dir_all(&dir).ok();
        dir
    }
}

/// data/media/{channel_id}/thumbnails/
pub fn channel_thumbnails_dir(channel_id: &str, channel_name: &str) -> PathBuf {
    let dir = channel_media_dir(channel_id, channel_name).join("thumbnails");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// data/media/{channel_id}/renders/
pub fn channel_renders_dir(_channel_id: &str, _channel_name: &str) -> PathBuf {
    let s_path = get_settings_path();
    let s_store = SettingsStore::load(&s_path);
    if let Some(path_str) = s_store.settings.get("outputPath")
        .or_else(|| s_store.settings.get("outputFolder"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty()) {
        let dir = PathBuf::from(path_str);
        std::fs::create_dir_all(&dir).ok();
        dir
    } else {
        let dir = get_data_dir().join("renders");
        std::fs::create_dir_all(&dir).ok();
        dir
    }
}

/// data/media/{channel_id}/renders/{ws_id}/
pub fn render_output_dir(channel_id: &str, channel_name: &str, ws_id: &str) -> PathBuf {
    let dir = channel_renders_dir(channel_id, channel_name).join(ws_id);
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// data/media/{channel_id}/renders/temp/
pub fn render_temp_dir(channel_id: &str, channel_name: &str) -> PathBuf {
    let dir = if !channel_id.is_empty() || !channel_name.is_empty() {
        channel_renders_dir(channel_id, channel_name).join("temp")
    } else {
        get_legacy_output_dir().join("temp")
    };
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Build download path: data/media/{channel_id}/downloads/{video_id}_{timestamp}.mp4
pub fn build_download_path(channel_id: &str, channel_name: &str, video_id: &str, timestamp_ms: i64) -> PathBuf {
    let datetime = match chrono::Utc.timestamp_millis_opt(timestamp_ms) {
        chrono::LocalResult::Single(dt) => dt,
        _ => chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::UNIX_EPOCH),
    };
    let time_str = datetime.format("%Y%m%d_%H%M%S").to_string();
    channel_downloads_dir(channel_id, channel_name).join(format!("{}_{}.mp4", video_id, time_str))
}

/// Build render output path: data/media/{channel_id}/renders/{ws_id}/{filename}.mp4
pub fn build_render_path(channel_id: &str, channel_name: &str, ws_id: &str) -> PathBuf {
    // 1. Load settings to get template
    let s_path = get_settings_path();
    let s_store = SettingsStore::load(&s_path);
    let mut template = s_store.settings.get("autoRenderTitleTemplate")
        .or_else(|| s_store.settings.get("auto_render_title_template"))
        .and_then(|v| v.as_str())
        .unwrap_or("{title}")
        .to_string();
    if template.is_empty() {
        template = "{title}".to_string();
    }

    // 2. Load workspaces to get title and other info
    let ws_path = get_workspaces_path();
    let ws_store = WorkspaceStore::load(&ws_path);
    let workspace = ws_store.workspaces.iter().find(|w| w.id == ws_id);

    let part_val = if let Some(idx) = ws_id.find("-part") {
        ws_id.chars().skip(idx + 5).collect::<String>()
    } else {
        "".to_string()
    };
    let parent_id = if let Some(idx) = ws_id.find("-part") {
        &ws_id[..idx]
    } else {
        ws_id
    };

    let parent_ws = ws_store.workspaces.iter().find(|w| w.id == parent_id);
    let ws_title = workspace.map(|w| w.title.clone()).unwrap_or_default();
    let parent_title = parent_ws.map(|w| w.title.clone()).unwrap_or(ws_title);
    let title_val = if !parent_title.is_empty() { parent_title } else { parent_id.to_string() };

    let total_parts = ws_store.workspaces.iter()
        .filter(|w| w.id == parent_id || w.id.starts_with(&format!("{}-part", parent_id)))
        .count();

    // Priority logic:
    // 1. If template is custom (not default "{title}" and not empty)
    // 2. If number of parts >= 2, we name it "part 1", "part 2", etc.
    // 3. Otherwise, use title_val (original title)
    let filename = if template != "{title}" {
        let channel_name_val = workspace.and_then(|w| w.channel_name.as_deref()).unwrap_or("");
        let has_unique_placeholder = template.contains("{title}") || template.contains("{video_id}");
        let mut resolved = template
            .replace("{title}", &title_val)
            .replace("{channel}", channel_name_val)
            .replace("{video_id}", &workspace.map(|w| w.video_id.clone()).unwrap_or_default())
            .replace("{part}", &part_val);
        if !has_unique_placeholder {
            let video_id_val = workspace.map(|w| w.video_id.as_str()).unwrap_or(ws_id);
            resolved = format!("{}_{}", resolved, video_id_val);
        }
        if !part_val.is_empty() && !template.contains("{part}") {
            resolved = format!("{}_part{}", resolved, part_val);
        }
        sanitize_dir_name(&resolved)
    } else if total_parts >= 2 && !part_val.is_empty() {
        sanitize_dir_name(&format!("{}_part{}", title_val, part_val))
    } else {
        sanitize_dir_name(&title_val)
    };

    let filename = if filename.is_empty() { "final".to_string() } else { filename };

    channel_renders_dir(channel_id, channel_name).join(format!("{}.mp4", filename))
}

/// Thumbnail path: data/media/{channel_id}/thumbnails/{video_id}.jpg
pub fn get_thumbnail_path(channel_id: &str, channel_name: &str, video_id: &str) -> PathBuf {
    channel_thumbnails_dir(channel_id, channel_name).join(format!("{}.jpg", video_id))
}

/// Legacy flat-thumbnails dir (deprecated, keep for backward compat).
pub fn get_legacy_thumbnails_dir() -> PathBuf {
    get_data_dir().join("thumbnails")
}

/// Legacy flat-downloads dir (deprecated, keep for backward compat).
pub fn get_legacy_downloads_dir() -> PathBuf {
    get_data_dir().join("downloads")
}

/// Legacy flat-output dir (deprecated, keep for backward compat).
pub fn get_legacy_output_dir() -> PathBuf {
    get_data_dir().join("output")
}

/// Cookies file for yt-dlp (Netscape format).
pub fn get_cookies_netscape_path() -> PathBuf {
    get_data_dir().join("cookies_netscape.txt")
}

/// Raw cookies file.
pub fn get_cookies_path() -> PathBuf {
    get_data_dir().join("cookies.txt")
}

/// Logs directory.
pub fn get_logs_dir() -> PathBuf {
    let dir = get_data_dir().join("logs");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Sanitize a directory name (remove path-invalid characters).
pub fn sanitize_dir_name(name: &str) -> String {
    name.chars()
        .map(|c| match c { '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_', _ => c })
        .take(100)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Resolve channel folder name: sanitized channel_name first, fall back to channel_id.
pub fn channel_folder_name(channel_id: &str, channel_name: &str) -> String {
    let sanitized = sanitize_dir_name(channel_name);
    if !sanitized.is_empty() {
        sanitized
    } else if !channel_id.is_empty() {
        channel_id.to_string()
    } else {
        "unknown".to_string()
    }
}

pub fn is_relative_path(p: &str) -> bool {
    let path = Path::new(p);
    path.is_relative() && !p.contains(":\\") && !p.contains(":/")
}

pub fn make_path_relative(data_dir: &Path, absolute_path_str: &str) -> Option<String> {
    if absolute_path_str.is_empty() {
        return None;
    }
    let data_dir_str = data_dir.to_string_lossy().to_string().replace('\\', "/").to_lowercase();
    let abs_path_clean = absolute_path_str.replace('\\', "/");
    let abs_path_lower = abs_path_clean.to_lowercase();

    if abs_path_lower.starts_with(&data_dir_str) {
        let mut rel = abs_path_clean[data_dir_str.len()..].to_string();
        if rel.starts_with('/') {
            rel = rel[1..].to_string();
        }
        Some(rel)
    } else {
        None
    }
}

pub fn clean_unc_path(p: &str) -> String {
    if p.starts_with(r"\\?\") {
        p[4..].to_string()
    } else if p.starts_with("//?/") {
        p[4..].to_string()
    } else {
        p.to_string()
    }
}
