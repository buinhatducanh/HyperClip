// crates/hyperclip_ipc/src/chrome_watcher.rs
//
// Chrome DevTools Protocol (CDP) tab watcher.
// Polls Chrome's remote debugging endpoint to detect YouTube videos
// opened in the browser — provides near-instant detection (< 2s).

use crate::innertube_client::{InnertubeClient, ClientConfig};
use crate::poller::NewVideoEvent;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

const DEFAULT_CDP_PORT: u16 = 9222;
const DEFAULT_POLL_MS: u64 = 500;

struct CheckingGuard(Arc<std::sync::atomic::AtomicBool>);

impl Drop for CheckingGuard {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Represents a Chrome tab from the CDP /json endpoint
#[derive(serde::Deserialize, Debug)]
struct ChromeTab {
    url: Option<String>,
    title: Option<String>,
    #[serde(rename = "type")]
    tab_type: Option<String>,
}

pub struct ChromeTabWatcher {
    port: u16,
    poll_interval_ms: std::sync::atomic::AtomicU64,
    seen_videos: Arc<tokio::sync::RwLock<crate::store::SeenVideos>>,
    process_fn: Arc<dyn Fn(NewVideoEvent) + Send + Sync>,
    /// Dedicated InnertubeClient for CDP — not shared with the Poller pool
    dedicated_client: Arc<Mutex<Option<InnertubeClient>>>,
    http_client: reqwest::Client,
    was_connected: std::sync::atomic::AtomicBool,
    last_channel_check: Mutex<std::time::Instant>,
    is_checking: Arc<std::sync::atomic::AtomicBool>,
    /// Cached channel handle → channel_id mappings from open Chrome channel tabs.
    /// Populated when channel tabs are first detected, used to fill channel_id
    /// for watch-tab videos without waiting for Innertube lease (saves ~5s).
    cached_channel_ids: Arc<std::sync::Mutex<HashMap<String, String>>>,
}

/// Extract YouTube channel_id or handle from a tab URL.
/// Supports: youtube.com/@handle, youtube.com/@handle/videos,
///           youtube.com/channel/UCxxx, youtube.com/channel/UCxxx/videos
/// Returns: (channel_id_or_handle, "handle" | "channel_id")
fn extract_channel_from_tab_url(url: &str) -> Option<(String, &'static str)> {
    if url.contains("youtube.com/@") {
        let after_at = url.split("youtube.com/@").nth(1)?;
        let handle = after_at.split('/').next()?;
        if !handle.is_empty() {
            return Some((handle.to_string(), "handle"));
        }
    } else if url.contains("youtube.com/channel/") {
        let after_channel = url.split("youtube.com/channel/").nth(1)?;
        let channel_id = after_channel.split('/').next()?;
        if !channel_id.is_empty() {
            return Some((channel_id.to_string(), "channel_id"));
        }
    }
    None
}

impl ChromeTabWatcher {
    pub fn new(
        port: Option<u16>,
        poll_interval_ms: Option<u64>,
        seen_videos: Arc<tokio::sync::RwLock<crate::store::SeenVideos>>,
        process_fn: Arc<dyn Fn(NewVideoEvent) + Send + Sync>,
    ) -> Self {
        let http_client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_millis(1500))
            .build()
            .unwrap_or_default();

        let past_instant = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_secs(3600))
            .unwrap_or_else(std::time::Instant::now);

        Self {
            port: port.unwrap_or(DEFAULT_CDP_PORT),
            poll_interval_ms: std::sync::atomic::AtomicU64::new(poll_interval_ms.unwrap_or(DEFAULT_POLL_MS)),
            seen_videos,
            process_fn,
            dedicated_client: Arc::new(Mutex::new(None)),
            http_client,
            was_connected: std::sync::atomic::AtomicBool::new(false),
            last_channel_check: Mutex::new(past_instant),
            is_checking: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cached_channel_ids: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn reload_config(&self, poll_interval_ms: u64) {
        self.poll_interval_ms.store(poll_interval_ms, std::sync::atomic::Ordering::Relaxed);
        tracing::info!("[ChromeWatcher] Config reloaded: interval={poll_interval_ms}ms");
    }

    /// Run the watcher loop until cancelled.
    pub async fn run(&self, cancel: CancellationToken) {
        tracing::info!(
            "[ChromeWatcher] Started — polling 127.0.0.1:{} every 500ms (channel check throttled to {}ms)",
            self.port,
            std::cmp::min(1500, self.poll_interval_ms.load(std::sync::atomic::Ordering::Relaxed))
        );

        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("[ChromeWatcher] Cancelled");
                    break;
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {
                    self.check_tabs().await;
                }
            }
        }
    }

    /// Fetch open tabs from Chrome CDP and detect YouTube video pages.
    async fn check_tabs(&self) {
        let url = format!("http://127.0.0.1:{}/json", self.port);
        let tabs = match self.http_client.get(&url).send().await {
            Ok(resp) => match resp.json::<Vec<ChromeTab>>().await {
                Ok(tabs) => {
                    if !self.was_connected.swap(true, std::sync::atomic::Ordering::Relaxed) {
                        tracing::info!("[ChromeWatcher] Successfully connected to Chrome CDP at {}", url);
                    }
                    tabs
                }
                Err(e) => {
                    tracing::trace!("[ChromeWatcher] Failed to parse tabs: {e}");
                    return;
                }
            },
            Err(e) => {
                if self.was_connected.swap(false, std::sync::atomic::Ordering::Relaxed) {
                    tracing::warn!("[ChromeWatcher] Connection failed to {url}: {}", e);
                }
                return;
            }
        };

        // Refresh channel_id cache from open channel tabs (handles + channel_ids).
        // This lets watch-tab videos inherit the correct channel without waiting
        // for Innertube lease (saves ~5s on detection → download start).
        {
            let ch_path = crate::store::get_channels_path();
            let ch_store = crate::store::ChannelStore::load(&ch_path);
            let mut cache = self.cached_channel_ids.lock().unwrap();
            cache.clear();
            for tab in &tabs {
                let url = match tab.url.as_deref() {
                    Some(u) => u,
                    None => continue,
                };
                if tab.tab_type.as_deref() != Some("page") {
                    continue;
                }
                if let Some((value, kind)) = extract_channel_from_tab_url(url) {
                    // For handles, find internal channel_id (ch-...) from channel store
                    // For raw channel_id (UCxxx), use it directly
                    if kind == "channel_id" {
                        cache.insert(format!("channel_id:{}", value), value.clone());
                    } else {
                        // Look up by handle in channel store to get internal id
                        if let Some(ch) = ch_store.channels.iter().find(|c| c.handle == value) {
                            cache.insert(format!("handle:{}", value), ch.id.clone());
                        }
                    }
                }
            }
        }

        for tab in &tabs {
            if tab.tab_type.as_deref() != Some("page") {
                continue;
            }
            let url_str = match &tab.url {
                Some(u) => u.as_str(),
                None => continue,
            };

            if let Some(video_id) = extract_youtube_video_id(url_str) {
                let seen_guard = self.seen_videos.read().await;
                let is_seen = seen_guard.is_any_seen(&video_id);
                drop(seen_guard);
                if is_seen {
                    continue;
                }
                let mut seen_guard = self.seen_videos.write().await;
                seen_guard.mark_seen("", &video_id);
                drop(seen_guard);

                let title = tab.title.clone().unwrap_or_default();
                let now_ms = chrono::Utc::now().timestamp_millis();

                // Try to fill channel_id from cached channel tabs.
                // Heuristic: if any channel tab is currently active, assign its channel.
                // (Better than empty channel_id which forces ~5s Innertube lease.)
                let cached_channel_id = {
                    let cache = self.cached_channel_ids.lock().unwrap();
                    cache.values().next().cloned().unwrap_or_default()
                };

                if !cached_channel_id.is_empty() {
                    tracing::info!(
                        "[ChromeWatcher] NEW VIDEO detected from Chrome tab: {} \"{}\" — using cached channel_id {}",
                        video_id,
                        title,
                        cached_channel_id
                    );
                } else {
                    tracing::info!(
                        "[ChromeWatcher] NEW VIDEO detected from Chrome tab: {} \"{}\"",
                        video_id,
                        title
                    );
                }

                let event = NewVideoEvent {
                    channel_id: cached_channel_id,
                    channel_name: String::new(),
                    video_id: video_id.clone(),
                    title,
                    thumbnail_url: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id),
                    // 0 = unknown. The old value (detection time) made the UI latency
                    // badge always show ~0s regardless of the real publish time —
                    // process_fn backfills the real timestamp via Innertube when it
                    // resolves the video, and the UI shows "—" instead of a fake number.
                    published_at: 0,
                    duration_sec: 0.0,     // Unknown from URL alone
                    detected_at: now_ms,
                };

                (self.process_fn)(event);
            }
        }

        // Query dedicated Node daemon to inspect the content of channel tabs
        let has_channel_tabs = tabs.iter().any(|tab| {
            if tab.tab_type.as_deref() != Some("page") {
                return false;
            }
            let url = tab.url.as_deref().unwrap_or("");
            url.contains("youtube.com/@") || url.contains("youtube.com/channel/")
        });

        if has_channel_tabs {
            let poll_interval = std::cmp::min(1500, self.poll_interval_ms.load(std::sync::atomic::Ordering::Relaxed));
            let should_check = {
                let mut last = self.last_channel_check.lock().unwrap();
                if last.elapsed() >= std::time::Duration::from_millis(poll_interval) {
                    if !self.is_checking.load(std::sync::atomic::Ordering::Relaxed) {
                        *last = std::time::Instant::now();
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            };

            if should_check {
                self.is_checking.store(true, std::sync::atomic::Ordering::Relaxed);
                let seen_videos = self.seen_videos.clone();
                let process_fn = self.process_fn.clone();
                let dedicated_client = self.dedicated_client.clone();
                let is_checking = self.is_checking.clone();

                tokio::spawn(async move {
                    let _guard = CheckingGuard(is_checking);
                    // Take client out of Mutex to avoid holding lock across await
                    let mut client = {
                        let mut guard = dedicated_client.lock().unwrap();
                        guard.take()
                    };

                    // Lazily create dedicated client if needed
                    if client.is_none() {
                        let cfg = ClientConfig {
                            timeout_sec: 10,
                            ..Default::default()
                        };
                        match InnertubeClient::new(cfg) {
                            Ok(c) => {
                                tracing::info!("[ChromeWatcher] Created dedicated InnertubeClient for CDP");
                                client = Some(c);
                            }
                            Err(e) => {
                                tracing::warn!("[ChromeWatcher] Failed to create dedicated client: {e}");
                            }
                        }
                    }

                    if let Some(ref mut c) = client {
                        let ch_path = crate::store::get_channels_path();
                        let ch_store = crate::store::ChannelStore::load(&ch_path);
                        let channel_mappings: Vec<serde_json::Value> = ch_store.channels.iter().map(|ch| {
                            serde_json::json!({
                                "handle": ch.handle.clone(),
                                "channelId": ch.channel_id.clone().unwrap_or_default(),
                            })
                        }).collect();

                        match c.check_chrome_tabs(poll_interval, &channel_mappings).await {
                            Ok(videos) => {
                                let s_path = crate::store::get_settings_path();
                                let s_store = crate::store::SettingsStore::load(&s_path);
                                let max_age_minutes_raw = s_store.settings
                                    .get("autoDownloadMaxAgeMinutes")
                                    .and_then(|val| val.as_u64())
                                    .unwrap_or(1440);
                                let max_age_minutes = if max_age_minutes_raw < 10 { 1440 } else { max_age_minutes_raw } as i64;
                                let max_age_ms = max_age_minutes * 60 * 1000;
                                let now_ms = chrono::Utc::now().timestamp_millis();

                                let mut channel_seen_exists_map = std::collections::HashMap::new();
                                {
                                    let seen_guard = seen_videos.read().await;
                                    for v in &videos {
                                        let channel_id_val = v.channel_id.as_deref().unwrap_or("");
                                        let resolved_id = ch_store.channels.iter().find(|c| {
                                            c.channel_id.as_deref() == Some(channel_id_val) || c.id == channel_id_val
                                        }).map(|c| c.id.as_str()).unwrap_or(channel_id_val).to_string();

                                        if !channel_seen_exists_map.contains_key(&resolved_id) {
                                            let exists = seen_guard.channels.get(&resolved_id)
                                                .map(|entry| !entry.ids.is_empty())
                                                .unwrap_or(false);
                                            channel_seen_exists_map.insert(resolved_id, exists);
                                        }
                                    }
                                }

                                 let mut channel_video_indices = std::collections::HashMap::new();
                                 for (index, v) in videos.into_iter().enumerate() {
                                    let seen_guard = seen_videos.read().await;
                                    let is_seen = seen_guard.is_any_seen(&v.video_id);
                                    drop(seen_guard);
                                    if is_seen {
                                        continue;
                                    }

                                    let channel_id_val = v.channel_id.as_deref().unwrap_or("");
                                    let resolved_id = ch_store.channels.iter().find(|c| {
                                        c.channel_id.as_deref() == Some(channel_id_val) || c.id == channel_id_val
                                    }).map(|c| c.id.as_str()).unwrap_or(channel_id_val);

                                    let index_for_channel = *channel_video_indices.entry(resolved_id.to_string()).or_insert(0usize);
                                    channel_video_indices.insert(resolved_id.to_string(), index_for_channel + 1);

                                    let channel_seen_exists = *channel_seen_exists_map.get(resolved_id).unwrap_or(&false);

                                    let bypass_age_limit = index_for_channel == 0 && !channel_seen_exists;

                                    if v.published_at <= 1 {
                                        if !bypass_age_limit {
                                            tracing::info!(
                                                "[ChromeWatcher] Skipping video {} because published date is unknown/unparseable (index: {}, channel_seen: {})",
                                                v.video_id,
                                                index,
                                                channel_seen_exists
                                            );
                                            continue;
                                        }
                                    }

                                    if v.published_at > 1 {
                                        if !bypass_age_limit {
                                            let age_ms = now_ms - v.published_at;
                                            let limit = max_age_ms;
                                            if age_ms < -300_000 || age_ms > limit {
                                                tracing::info!(
                                                    "[ChromeWatcher] Skipping video {} because it is outside age limit (age: {}s, limit: {}s)",
                                                    v.video_id,
                                                    age_ms / 1000,
                                                    limit / 1000
                                                );
                                                // Mark as seen to prevent repeated scanning and logging flood
                                                let mut seen_guard = seen_videos.write().await;
                                                seen_guard.mark_seen(resolved_id, &v.video_id);
                                                drop(seen_guard);
                                                continue;
                                            }
                                        }
                                    }

                                    let mut seen_guard = seen_videos.write().await;
                                    seen_guard.mark_seen(resolved_id, &v.video_id);
                                    drop(seen_guard);

                                    tracing::info!(
                                        "[ChromeWatcher] NEW VIDEO detected from Chrome channel tab: {} \"{}\"",
                                        v.video_id,
                                        v.title
                                    );

                                    let event = NewVideoEvent {
                                        channel_id: v.channel_id.clone().unwrap_or_default(),
                                        channel_name: v.channel_name.clone().unwrap_or_default(),
                                        video_id: v.video_id.clone(),
                                        title: v.title.clone(),
                                        thumbnail_url: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", v.video_id),
                                        // Keep 0 when the tab DOM had no parseable publish time —
                                        // substituting detection time made every latency badge on
                                        // tab-detected videos show ~0s regardless of reality.
                                        published_at: if v.published_at <= 1 { 0 } else { v.published_at },
                                        duration_sec: 0.0,
                                        detected_at: now_ms,
                                    };

                                    (process_fn)(event);
                                }
                            }
                            Err(e) => {
                                tracing::debug!("[ChromeWatcher] check_chrome_tabs failed: {e}");
                            }
                        }
                    }

                    // Put client back for reuse
                    {
                        let mut guard = dedicated_client.lock().unwrap();
                        *guard = client;
                    }
                });
            }
        }
    }
}

/// Extract YouTube video ID from a URL.
/// Supports:
/// - https://www.youtube.com/watch?v=VIDEO_ID
/// - https://youtube.com/watch?v=VIDEO_ID
/// - https://youtu.be/VIDEO_ID
/// - https://www.youtube.com/shorts/VIDEO_ID
fn extract_youtube_video_id(url: &str) -> Option<String> {
    // youtube.com/watch?v=ID
    if url.contains("youtube.com/watch") {
        if let Some(pos) = url.find("v=") {
            let rest = &url[pos + 2..];
            let id: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
            if id.len() >= 11 {
                return Some(id);
            }
        }
    }
    // youtu.be/ID
    if url.contains("youtu.be/") {
        if let Some(pos) = url.find("youtu.be/") {
            let rest = &url[pos + 9..];
            let id: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
            if id.len() >= 11 {
                return Some(id);
            }
        }
    }
    // youtube.com/shorts/ID
    if url.contains("youtube.com/shorts/") {
        if let Some(pos) = url.find("/shorts/") {
            let rest = &url[pos + 8..];
            let id: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
            if id.len() >= 11 {
                return Some(id);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_watch() {
        assert_eq!(
            extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".into())
        );
    }

    #[test]
    fn test_extract_watch_with_params() {
        assert_eq!(
            extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30"),
            Some("dQw4w9WgXcQ".into())
        );
    }

    #[test]
    fn test_extract_short_url() {
        assert_eq!(
            extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".into())
        );
    }

    #[test]
    fn test_extract_shorts() {
        assert_eq!(
            extract_youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".into())
        );
    }

    #[test]
    fn test_non_youtube() {
        assert_eq!(extract_youtube_video_id("https://google.com"), None);
    }

    #[test]
    fn test_youtube_homepage() {
        assert_eq!(extract_youtube_video_id("https://www.youtube.com"), None);
    }
}
