// crates/hyperclip_ipc/src/store.rs
// Workspaces + channels + seen videos JSON persistence

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Workspace {
    pub id: String,
    pub status: String,  // pending|downloading|ready|rendering|done|error
    pub video_id: String,
    pub channel_id: String,
    pub title: String,
    #[serde(rename = "downloadedPath")]
    pub downloaded_path: Option<String>,
    #[serde(rename = "downloadedAt")]
    pub downloaded_at: Option<i64>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "publishedAt")]
    pub published_at: i64,
    #[serde(rename = "trimStart")]
    pub trim_start: f64,
    #[serde(rename = "trimEnd")]
    pub trim_end: f64,
    #[serde(rename = "videoSpeed")]
    pub video_speed: f64,
    #[serde(rename = "fpsTarget")]
    pub fps_target: u32,
    #[serde(rename = "exportResolution")]
    pub export_resolution: String,
    #[serde(rename = "isShort")]
    pub is_short: bool,
    #[serde(rename = "autoRender")]
    pub auto_render: bool,
    pub progress: Option<f64>,
    pub error: Option<String>,
    #[serde(rename = "availableFormats")]
    pub available_formats: Option<Vec<u32>>,
    #[serde(rename = "channelName")]
    pub channel_name: Option<String>,
    #[serde(rename = "renderedPath")]
    pub rendered_path: Option<String>,
    #[serde(rename = "thumbnailLocal")]
    pub thumbnail_local: Option<String>,
    #[serde(rename = "fileSize", default)]
    pub file_size: Option<u64>,
    #[serde(rename = "downloadSpeed", default)]
    pub download_speed: Option<String>,
    #[serde(rename = "downloadTime", default)]
    pub download_time: Option<String>,
    #[serde(rename = "durationSec", default)]
    pub duration_sec: Option<u64>,
    #[serde(rename = "quality", default)]
    pub quality: Option<u32>,
    #[serde(rename = "renderFps", default)]
    pub render_fps: Option<f64>,
    #[serde(rename = "renderWorkers", default)]
    pub render_workers: Option<u32>,
    #[serde(rename = "renderPreset", default)]
    pub render_preset: Option<String>,
    #[serde(rename = "renderCodec", default)]
    pub render_codec: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspaceStore {
    pub workspaces: Vec<Workspace>,
}

impl WorkspaceStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    pub fn add(&mut self, ws: Workspace) {
        self.workspaces.retain(|w| w.id != ws.id);
        self.workspaces.insert(0, ws);
    }

    pub fn patch(&mut self, id: &str, field: &str, value: serde_json::Value) -> Result<(), String> {
        if let Some(ws) = self.workspaces.iter_mut().find(|w| w.id == id) {
            match field {
                "title" => ws.title = value.as_str().unwrap_or("").to_string(),
                "speed" => ws.video_speed = value.as_f64().unwrap_or(1.0),
                "trimStart" => ws.trim_start = value.as_f64().unwrap_or(0.0),
                "trimEnd" => ws.trim_end = value.as_f64().unwrap_or(0.0),
                "thumbnail" => ws.thumbnail_local = value.as_str().map(String::from),
                _ => return Err(format!("invalid field: {}", field)),
            }
            Ok(())
        } else {
            Err(format!("workspace not found: {}", id))
        }
    }

    pub fn update(&mut self, id: &str, data: serde_json::Value) -> Result<(), String> {
        if let Some(ws) = self.workspaces.iter_mut().find(|w| w.id == id) {
            // Merge fields from JSON
            if let Some(status) = data.get("status").and_then(|v| v.as_str()) {
                ws.status = status.to_string();
            }
            if let Some(progress) = data.get("progress").and_then(|v| v.as_f64()) {
                ws.progress = Some(progress);
            }
            if let Some(path) = data.get("downloadedPath").and_then(|v| v.as_str()) {
                ws.downloaded_path = Some(path.to_string());
            }
            if let Some(path) = data.get("renderedPath").and_then(|v| v.as_str()) {
                ws.rendered_path = Some(path.to_string());
            }
            if let Some(path) = data.get("thumbnailLocal").and_then(|v| v.as_str()) {
                ws.thumbnail_local = Some(path.to_string());
            }
            if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
                ws.error = Some(err.to_string());
            }
            Ok(())
        } else {
            Err(format!("workspace not found: {}", id))
        }
    }

    pub fn remove(&mut self, id: &str) {
        self.workspaces.retain(|w| w.id != id);
    }

    pub fn get(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub handle: String,
    #[serde(rename = "avatarColor", default)]
    pub avatar_color: String,
    #[serde(rename = "channelId")]
    pub channel_id: Option<String>,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    #[serde(rename = "createdAt", default)]
    pub created_at: String,
    #[serde(rename = "lastChecked")]
    pub last_checked: Option<i64>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(rename = "uploadPlaylistId")]
    pub upload_playlist_id: Option<String>,
    #[serde(default)]
    pub paused: bool,
    #[serde(rename = "newCount", default)]
    pub new_video_count: u32,
    #[serde(rename = "totalVideosDownloaded", default)]
    pub total_videos_downloaded: u32,
    #[serde(rename = "errorCount", default)]
    pub error_count: u32,
    #[serde(rename = "lastVideoId", default)]
    pub last_video_id: Option<String>,
    #[serde(rename = "lastPollAt", default)]
    pub last_poll_at: Option<i64>,
}

impl Default for Channel {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            handle: String::new(),
            avatar_color: String::new(),
            channel_id: None,
            avatar_url: None,
            created_at: String::new(),
            last_checked: None,
            enabled: true,
            upload_playlist_id: None,
            paused: false,
            new_video_count: 0,
            total_videos_downloaded: 0,
            error_count: 0,
            last_video_id: None,
            last_poll_at: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChannelStore {
    pub channels: Vec<Channel>,
}

impl ChannelStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    pub fn add(&mut self, ch: Channel) {
        self.channels.retain(|c| c.id != ch.id);
        self.channels.push(ch);
    }

    pub fn remove(&mut self, id: &str) {
        self.channels.retain(|c| c.id != id);
    }

    pub fn update(&mut self, id: &str, patch: &serde_json::Value) -> Result<(), String> {
        if let Some(ch) = self.channels.iter_mut().find(|c| c.id == id) {
            if let Some(name) = patch.get("name").and_then(|v| v.as_str()) {
                ch.name = name.to_string();
            }
            if let Some(handle) = patch.get("handle").and_then(|v| v.as_str()) {
                ch.handle = handle.to_string();
            }
            if let Some(enabled) = patch.get("enabled").and_then(|v| v.as_bool()) {
                ch.enabled = enabled;
            }
            if let Some(paused) = patch.get("paused").and_then(|v| v.as_bool()) {
                ch.paused = paused;
            }
            if let Some(new_count) = patch.get("newCount").and_then(|v| v.as_u64()) {
                ch.new_video_count = new_count as u32;
            }
            if let Some(total) = patch.get("totalVideosDownloaded").and_then(|v| v.as_u64()) {
                ch.total_videos_downloaded = total as u32;
            }
            if let Some(err_count) = patch.get("errorCount").and_then(|v| v.as_u64()) {
                ch.error_count = err_count as u32;
            }
            if let Some(url) = patch.get("avatarUrl").and_then(|v| v.as_str()) {
                ch.avatar_url = Some(url.to_string());
            }
            if let Some(pid) = patch.get("channelId").and_then(|v| v.as_str()) {
                ch.channel_id = Some(pid.to_string());
            }
            Ok(())
        } else {
            Err(format!("channel not found: {}", id))
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SeenVideos {
    pub seen: Vec<String>,
}

impl SeenVideos {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    pub fn mark_seen(&mut self, video_id: &str) {
        if !self.seen.contains(&video_id.to_string()) {
            self.seen.push(video_id.to_string());
        }
    }
}

/// Get the store directory (D:/HyperClip-Data/.hyperclip)
pub fn get_store_dir() -> PathBuf {
    PathBuf::from("D:/HyperClip-Data/.hyperclip")
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

pub fn get_settings_path() -> PathBuf {
    get_store_dir().join("settings.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SettingsStore {
    pub settings: serde_json::Value,
}

impl SettingsStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }
}

// ─── Rendered videos store ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderedVideo {
    pub id: String,
    pub title: String,
    #[serde(rename = "channelName")]
    pub channel_name: Option<String>,
    #[serde(rename = "outputPath")]
    pub output_path: String,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    pub duration: f64,
    #[serde(rename = "renderedAt")]
    pub rendered_at: i64,
    pub quality: String,
    #[serde(default)]
    pub archived: bool,
    pub thumbnail: Option<String>,
    pub resolution: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RenderedStore {
    pub videos: Vec<RenderedVideo>,
}

impl RenderedStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    pub fn add(&mut self, video: RenderedVideo) {
        self.videos.retain(|v| v.id != video.id);
        self.videos.push(video);
    }

    pub fn remove(&mut self, id: &str) {
        self.videos.retain(|v| v.id != id);
    }

    pub fn update(&mut self, id: &str, patch: &serde_json::Value) {
        if let Some(v) = self.videos.iter_mut().find(|v| v.id == id) {
            if let Some(val) = patch.get("archived").and_then(|v| v.as_bool()) {
                v.archived = val;
            }
            if let Some(val) = patch.get("outputPath").and_then(|v| v.as_str()) {
                v.output_path = val.to_string();
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<&RenderedVideo> {
        self.videos.iter().find(|v| v.id == id)
    }
}

pub fn get_rendered_videos_path() -> PathBuf {
    get_store_dir().join("rendered-videos.json")
}

// ─── Keys store ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyEntry {
    pub key: String,
    pub name: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(default = "return_true")]
    pub valid: bool,
    #[serde(rename = "quotaUsed", default)]
    pub quota_used: u32,
    #[serde(rename = "quotaLimit", default = "default_quota_limit")]
    pub quota_limit: u32,
    #[serde(rename = "lastError")]
    pub last_error: Option<String>,
}

fn return_true() -> bool { true }
fn default_quota_limit() -> u32 { 10000 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct KeyStore {
    pub keys: Vec<KeyEntry>,
}

impl KeyStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    pub fn add(&mut self, entry: KeyEntry) {
        self.keys.retain(|k| k.key != entry.key);
        self.keys.push(entry);
    }

    pub fn remove(&mut self, key: &str) {
        self.keys.retain(|k| k.key != key);
    }
}

pub fn get_keys_path() -> PathBuf {
    get_store_dir().join("keys.json")
}

// ─── Projects store ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectEntry {
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub name: String,
    #[serde(rename = "clientId")]
    pub client_id: String,
    #[serde(default = "return_true")]
    pub healthy: bool,
    #[serde(rename = "quotaUsed", default)]
    pub quota_used: u32,
    #[serde(rename = "quotaLimit", default = "default_quota_limit")]
    pub quota_limit: u32,
    pub error: Option<String>,
    #[serde(rename = "lastRefresh")]
    pub last_refresh: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectStore {
    pub projects: Vec<ProjectEntry>,
}

impl ProjectStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    pub fn add(&mut self, entry: ProjectEntry) {
        self.projects.retain(|p| p.project_id != entry.project_id);
        self.projects.push(entry);
    }

    pub fn remove(&mut self, project_id: &str) {
        self.projects.retain(|p| p.project_id != project_id);
    }
}

pub fn get_projects_path() -> PathBuf {
    get_store_dir().join("projects.json")
}
