// crates/hyperclip_ipc/src/store.rs
// Workspaces + channels + seen videos JSON persistence

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub handle: String,
    #[serde(rename = "avatarColor")]
    pub avatar_color: String,
    #[serde(rename = "channelId")]
    pub channel_id: Option<String>,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lastChecked")]
    pub last_checked: Option<i64>,
    pub enabled: bool,
    #[serde(rename = "uploadPlaylistId")]
    pub upload_playlist_id: Option<String>,
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

/// Get the store directory (Roaming/HyperClip/.hyperclip on Windows)
pub fn get_store_dir() -> PathBuf {
    if let Some(roaming) = std::env::var_os("APPDATA") {
        return PathBuf::from(roaming).join("HyperClip").join(".hyperclip");
    }
    PathBuf::from(".")
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
