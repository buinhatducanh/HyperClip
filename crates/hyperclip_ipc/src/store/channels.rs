// crates/hyperclip_ipc/src/store/channels.rs

use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

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
    #[serde(rename = "playlistCacheExpiry")]
    pub playlist_cache_expiry: Option<i64>,
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
            playlist_cache_expiry: None,
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
    /// Per-channel seen videos with TTL (48h expiry)
    pub channels: std::collections::HashMap<String, ChannelSeenVideos>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelSeenVideos {
    pub ids: Vec<String>,
    /// Unix timestamp in seconds when this entry expires
    #[serde(rename = "expiresAt")]
    pub expires_at: i64,
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

    /// Mark video as seen for a channel, with 48h TTL
    pub fn mark_seen(&mut self, channel_id: &str, video_id: &str) {
        let now = crate::detection::current_unix_ts();
        let expires_at = now + 48 * 3600; // 48 hours
        let entry = self.channels.entry(channel_id.to_string()).or_insert(ChannelSeenVideos {
            ids: Vec::new(),
            expires_at,
        });
        if !entry.ids.contains(&video_id.to_string()) {
            entry.ids.push(video_id.to_string());
        }
        entry.expires_at = expires_at; // Refresh TTL on each mark
    }

    /// Check if video is seen for a channel (respects TTL)
    pub fn is_seen(&self, channel_id: &str, video_id: &str) -> bool {
        if let Some(entry) = self.channels.get(channel_id) {
            let now = crate::detection::current_unix_ts();
            if now > entry.expires_at {
                return false; // Expired
            }
            entry.ids.contains(&video_id.to_string())
        } else {
            false
        }
    }

    /// Check if video is seen in ANY channel (respects TTL)
    pub fn is_any_seen(&self, video_id: &str) -> bool {
        let now = crate::detection::current_unix_ts();
        for entry in self.channels.values() {
            if now <= entry.expires_at && entry.ids.contains(&video_id.to_string()) {
                return true;
            }
        }
        false
    }

    /// Clean up expired entries
    pub fn cleanup_expired(&mut self) {
        let now = crate::detection::current_unix_ts();
        self.channels.retain(|_, v| v.expires_at > now);
    }
}

/// Upload playlist ID cache (24h TTL)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UploadsCache {
    pub entries: std::collections::HashMap<String, CacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    #[serde(rename = "playlistId")]
    pub playlist_id: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: i64,
}

impl UploadsCache {
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

    pub fn get(&self, channel_id: &str) -> Option<String> {
        if let Some(entry) = self.entries.get(channel_id) {
            let now = crate::detection::current_unix_ts();
            if now < entry.expires_at {
                return Some(entry.playlist_id.clone());
            }
        }
        None
    }

    pub fn set(&mut self, channel_id: &str, playlist_id: String) {
        let now = crate::detection::current_unix_ts();
        let expires_at = now + 24 * 3600; // 24 hours
        self.entries.insert(channel_id.to_string(), CacheEntry { playlist_id, expires_at });
    }

    pub fn cleanup_expired(&mut self) {
        let now = crate::detection::current_unix_ts();
        self.entries.retain(|_, v| v.expires_at > now);
    }
}
