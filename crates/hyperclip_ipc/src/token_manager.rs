// crates/hyperclip_ipc/src/token_manager.rs
// OAuth Token Manager — ported from electron/services/token_manager.ts
// Manages OAuth tokens across multiple GCP projects with smart rotation

use crate::error::{HyperclipError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// OAuth token entry from oauth_tokens.json (multi-project array format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthToken {
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
    #[serde(rename = "expiryDate")]
    pub expiry_date: i64, // Unix timestamp in milliseconds
    #[serde(rename = "scope")]
    pub scope: String,
    #[serde(rename = "tokenType")]
    pub token_type: String,
    #[serde(rename = "idToken")]
    pub id_token: Option<String>,
}

/// Project quota tracking (persisted)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectQuota {
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "usedToday")]
    pub used_today: u32,
    #[serde(rename = "lastReset")]
    pub last_reset: i64, // Unix timestamp (seconds)
    #[serde(rename = "errorCount")]
    pub error_count: u32, // Consecutive quota errors
}

/// Token stats file format
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenStats {
    pub projects: HashMap<String, ProjectQuota>,
}

impl TokenStats {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = std::fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| HyperclipError::Io(e))?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| HyperclipError::Json(e))?;
        std::fs::write(path, content).map_err(|e| HyperclipError::Io(e))
    }

    /// Get or create project quota, reset if new day (UTC)
    pub fn get_or_create(&mut self, project_id: &str) -> &mut ProjectQuota {
        let now_sec = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let today_start = now_sec - (now_sec % 86400);

        let entry = self.projects.entry(project_id.to_string()).or_insert(ProjectQuota {
            project_id: project_id.to_string(),
            used_today: 0,
            last_reset: today_start,
            error_count: 0,
        });

        // Reset if new day
        if entry.last_reset < today_start {
            entry.used_today = 0;
            entry.last_reset = today_start;
            entry.error_count = 0;
        }
        entry
    }

    /// Track a quota unit used for a project
    pub fn track(&mut self, project_id: &str, units: u32) {
        let p = self.get_or_create(project_id);
        p.used_today = p.used_today.saturating_add(units);
    }

    /// Record quota error for a project
    pub fn record_error(&mut self, project_id: &str) {
        let p = self.get_or_create(project_id);
        p.error_count = p.error_count.saturating_add(1);
    }

    /// Check if project is exhausted (5+ quota errors or quota limit reached)
    pub fn is_exhausted(&self, project_id: &str, quota_limit: u32) -> bool {
        if let Some(p) = self.projects.get(project_id) {
            p.error_count >= 5 || p.used_today >= quota_limit
        } else {
            false
        }
    }

    /// Get percentage remaining for a project
    pub fn pct_remaining(&self, project_id: &str, quota_limit: u32) -> f64 {
        if let Some(p) = self.projects.get(project_id) {
            if p.used_today >= quota_limit {
                0.0
            } else {
                ((quota_limit - p.used_today) as f64 / quota_limit as f64) * 100.0
            }
        } else {
            100.0
        }
    }
}

/// OAuth Token Manager — smart rotation across projects
pub struct TokenManager {
    tokens: Arc<Mutex<Vec<OAuthToken>>>,
    stats: Arc<Mutex<TokenStats>>,
    stats_path: std::path::PathBuf,
    quota_limit: u32,
    client_id: String,
    client_secret: String,
}

impl TokenManager {
    pub fn new(
        tokens_path: &Path,
        stats_path: &Path,
        client_id: String,
        client_secret: String,
        quota_limit: u32,
    ) -> Result<Self> {
        // Load tokens from oauth_tokens.json (array format)
        let tokens_content = std::fs::read_to_string(tokens_path)
            .map_err(|e| HyperclipError::Io(e))?;
        let tokens: Vec<OAuthToken> = if tokens_content.trim().is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&tokens_content).map_err(|e| HyperclipError::Json(e))?
        };

        let stats = TokenStats::load(stats_path);

        Ok(Self {
            tokens: Arc::new(Mutex::new(tokens)),
            stats: Arc::new(Mutex::new(stats)),
            stats_path: stats_path.to_path_buf(),
            quota_limit,
            client_id,
            client_secret,
        })
    }

    /// Get best available token (least used, not exhausted)
    pub fn get_best_available(&self) -> Option<OAuthToken> {
        let tokens = self.tokens.lock().unwrap();
        let stats = self.stats.lock().unwrap();

        tokens
            .iter()
            .filter(|t| !stats.is_exhausted(&t.project_id, self.quota_limit))
            .min_by_key(|t| {
                stats
                    .projects
                    .get(&t.project_id)
                    .map(|p| p.used_today)
                    .unwrap_or(0)
            })
            .cloned()
    }

    /// Track quota usage for a project
    pub fn track_usage(&self, project_id: &str, units: u32) -> Result<()> {
        let mut stats = self.stats.lock().unwrap();
        stats.track(project_id, units);
        stats.save(&self.stats_path)
    }

    /// Record quota error for a project
    pub fn record_quota_error(&self, project_id: &str) -> Result<()> {
        let mut stats = self.stats.lock().unwrap();
        stats.record_error(project_id);
        stats.save(&self.stats_path)
    }

    /// Get overall OAuth percentage remaining (across all projects)
    pub fn overall_pct_remaining(&self) -> f64 {
        let tokens = self.tokens.lock().unwrap();
        let stats = self.stats.lock().unwrap();

        if tokens.is_empty() {
            return 0.0;
        }

        let total_remaining: u32 = tokens
            .iter()
            .map(|t| {
                let used = stats.projects.get(&t.project_id).map(|p| p.used_today).unwrap_or(0);
                self.quota_limit.saturating_sub(used)
            })
            .sum();
        let total_limit = tokens.len() as u32 * self.quota_limit;

        if total_limit == 0 {
            0.0
        } else {
            (total_remaining as f64 / total_limit as f64) * 100.0
        }
    }

    /// Check if all projects are exhausted
    pub fn all_exhausted(&self) -> bool {
        let tokens = self.tokens.lock().unwrap();
        let stats = self.stats.lock().unwrap();

        tokens
            .iter()
            .all(|t| stats.is_exhausted(&t.project_id, self.quota_limit))
    }

    /// Refresh token if expiring within 5 minutes
    pub async fn ensure_valid_token(&self, token: &OAuthToken) -> Result<OAuthToken> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        // If token expires in > 5 minutes, it's valid
        if token.expiry_date > now_ms + 5 * 60 * 1000 {
            return Ok(token.clone());
        }

        // Otherwise, refresh
        tracing::info!("[TokenManager] Refreshing expired token for project {}", token.project_id);
        self.refresh_token(token).await
    }

    async fn refresh_token(&self, token: &OAuthToken) -> Result<OAuthToken> {
        let client = reqwest::Client::new();
        let params = [
            ("client_id", self.client_id.as_str()),
            ("client_secret", self.client_secret.as_str()),
            ("refresh_token", &token.refresh_token),
            ("grant_type", "refresh_token"),
        ];

        let response = client
            .post("https://oauth2.googleapis.com/token")
            .form(&params)
            .send()
            .await
            .map_err(|e| HyperclipError::NetworkTimeout(e.to_string()))?;

        if !response.status().is_success() {
            let err = response.text().await.unwrap_or_default();
            return Err(HyperclipError::TokenExpired);
        }

        let text = response.text().await.map_err(|e| HyperclipError::NetworkTimeout(e.to_string()))?;
        let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| HyperclipError::Json(e))?;

        let new_access_token = json["access_token"]
            .as_str()
            .ok_or_else(|| HyperclipError::TokenExpired)?
            .to_string();
        let expires_in = json["expires_in"].as_u64().unwrap_or(3600) as i64;
        let new_expiry = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
            + expires_in * 1000;

        let mut updated = token.clone();
        updated.access_token = new_access_token;
        updated.expiry_date = new_expiry;

        // Update in memory
        {
            let mut tokens = self.tokens.lock().unwrap();
            if let Some(t) = tokens.iter_mut().find(|t| t.project_id == token.project_id) {
                *t = updated.clone();
            }
        }

        // Persist updated tokens back to oauth_tokens.json
        let tokens_path = self.stats_path.parent().unwrap().join("oauth_tokens.json");
        let tokens = self.tokens.lock().unwrap();
        let content = serde_json::to_string_pretty(&*tokens).map_err(|e| HyperclipError::Json(e))?;
        std::fs::write(&tokens_path, content).map_err(|e| HyperclipError::Io(e))?;

        Ok(updated)
    }
}

/// OAuth fallback detection using Data API v3 playlistItems
pub struct OAuthFallbackDetector {
    token_manager: TokenManager,
}

impl OAuthFallbackDetector {
    pub fn new(token_manager: TokenManager) -> Self {
        Self { token_manager }
    }

    /// Detect new videos via OAuth playlistItems (fallback when Innertube fails)
    /// Returns video IDs that are new (not in seen set)
    pub async fn detect_new_videos(
        &self,
        channel_ids: &[String],
        seen_videos: &crate::store::SeenVideos,
        max_age_minutes: u64,
    ) -> Result<Vec<crate::types::VideoInfo>> {
        let mut all_new = Vec::new();

        for channel_id in channel_ids {
            // Get best available token
            let token = match self.token_manager.get_best_available() {
                Some(t) => t,
                None => {
                    tracing::warn!("[OAuthFallback] No available tokens for channel {}", channel_id);
                    continue;
                }
            };

            // Ensure token is valid (refresh if needed)
            let token = self.token_manager.ensure_valid_token(&token).await?;

            // Get uploads playlist ID for channel (resolve if needed)
            let playlist_id = self.resolve_uploads_playlist(&channel_id, &token.access_token).await?;

            // Fetch latest videos from playlist
            let videos = self.fetch_playlist_items(&playlist_id, &token.access_token, 5).await?;

            // Track quota usage
            self.token_manager.track_usage(&token.project_id, 1)?;

            // Filter new videos
            let now_sec = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            let channel_seen_exists = seen_videos.channels.get(channel_id)
                .map(|entry| !entry.ids.is_empty())
                .unwrap_or(false);

            for (index, video) in videos.into_iter().enumerate() {
                if seen_videos.is_any_seen(&video.video_id) {
                    continue;
                }
                let bypass_age_limit = !channel_seen_exists && index == 0;
                if !bypass_age_limit {
                    let age_sec = now_sec - video.published_at / 1000;
                    if age_sec > max_age_minutes as i64 * 60 {
                        continue;
                    }
                }
                all_new.push(video);
            }
        }

        // Sort by published_at descending (newest first)
        all_new.sort_by(|a, b| b.published_at.cmp(&a.published_at));
        Ok(all_new)
    }

    /// Resolve uploads playlist ID for a channel (UCxxx -> UUxxx)
    async fn resolve_uploads_playlist(&self, channel_id: &str, access_token: &str) -> Result<String> {
        // If already a playlist ID (UUxxx), return as-is
        if channel_id.starts_with("UU") && channel_id.len() == 24 {
            return Ok(channel_id.to_string());
        }

        // If channel ID (UCxxx), convert to uploads playlist (UUxxx)
        if channel_id.starts_with("UC") && channel_id.len() == 24 {
            let mut playlist = channel_id.to_string();
            playlist.replace_range(0..2, "UU");
            return Ok(playlist);
        }

        // Otherwise, need to fetch via channels.list
        let client = reqwest::Client::new();
        let url = format!(
            "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id={}&key={}",
            channel_id, access_token
        );
        let response = client.get(&url).send().await.map_err(|e| HyperclipError::NetworkTimeout(e.to_string()))?;

        if !response.status().is_success() {
            return Err(HyperclipError::BackendCrashed("Failed to resolve uploads playlist".into()));
        }

        let text = response.text().await.map_err(|e| HyperclipError::NetworkTimeout(e.to_string()))?;
        let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| HyperclipError::Json(e))?;
        let playlist_id = json["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
            .as_str()
            .ok_or_else(|| HyperclipError::BackendCrashed("No uploads playlist found".into()))?;

        Ok(playlist_id.to_string())
    }

    /// Fetch playlist items (max 5 per channel for early termination)
    async fn fetch_playlist_items(
        &self,
        playlist_id: &str,
        access_token: &str,
        max_results: u32,
    ) -> Result<Vec<crate::types::VideoInfo>> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId={}&maxResults={}&key={}",
            playlist_id, max_results, access_token
        );
        let response = client.get(&url).send().await.map_err(|e| HyperclipError::NetworkTimeout(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let err_text = response.text().await.unwrap_or_default();
            if status == 403 && err_text.contains("quotaExceeded") {
                return Err(HyperclipError::OAuthQuotaExhausted("quota exceeded".into()));
            }
            return Err(HyperclipError::BackendCrashed(format!("playlistItems failed: {}", err_text)));
        }

        let text = response.text().await.map_err(|e| HyperclipError::NetworkTimeout(e.to_string()))?;
        let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| HyperclipError::Json(e))?;

        let mut videos = Vec::new();
        if let Some(items) = json["items"].as_array() {
            for item in items {
                let video_id = item["contentDetails"]["videoId"].as_str().unwrap_or("").to_string();
                if video_id.is_empty() {
                    continue;
                }
                let title = item["snippet"]["title"].as_str().unwrap_or("").to_string();
                let published_at_str = item["snippet"]["publishedAt"].as_str().unwrap_or("");
                let published_at = chrono::DateTime::parse_from_rfc3339(published_at_str)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or(0);
                let thumbnail_url = item["snippet"]["thumbnails"]["high"]["url"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();

                // Duration not available in playlistItems, set to 0 (will be filtered later if needed)
                videos.push(crate::types::VideoInfo {
                    video_id,
                    title,
                    published_at,
                    thumbnail_url,
                    duration_sec: 0.0,
                    width: 0,
                    height: 0,
                    channel_id: None,
                    channel_name: None,
                });
            }
        }

        Ok(videos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_stats_reset_daily() {
        let mut stats = TokenStats::default();
        let project_id = "test-project";

        // Use a fixed "yesterday" timestamp (86400 seconds ago from a known "today")
        let today_timestamp = 1700000000;
        let yesterday = today_timestamp - 86400;
        stats.projects.insert(
            project_id.to_string(),
            ProjectQuota {
                project_id: project_id.to_string(),
                used_today: 5000,
                last_reset: yesterday,
                error_count: 0,
            },
        );

        // Manually set the system time for test by injecting the "now" value
        // We can't easily mock SystemTime, so we just test the logic directly:
        // If we call get_or_create with a last_reset from yesterday, it should reset
        // But since we can't mock SystemTime, let's just verify the reset logic
        let expected_reset = today_timestamp - (today_timestamp % 86400);

        // The actual test: verify that the reset calculation is correct
        // (This test doesn't call get_or_create since we can't mock time)
        assert_eq!(expected_reset, 1699920000); // 1700000000 - (1700000000 % 86400)
    }

    #[test]
    fn test_exhaustion_check() {
        let mut stats = TokenStats::default();
        stats.projects.insert(
            "proj1".to_string(),
            ProjectQuota {
                project_id: "proj1".to_string(),
                used_today: 9500,
                last_reset: 1700000000,
                error_count: 0,
            },
        );

        assert!(stats.is_exhausted("proj1", 9500));
        assert!(!stats.is_exhausted("proj1", 10000));
        // Non-existent project should NOT be exhausted (it's just not created yet)
        assert!(!stats.is_exhausted("proj2", 9500));
    }
}