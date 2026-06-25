// crates/hyperclip_ipc/src/chrome_watcher.rs
//
// Chrome DevTools Protocol (CDP) tab watcher.
// Polls Chrome's remote debugging endpoint to detect YouTube videos
// opened in the browser — provides near-instant detection (< 2s).

use crate::innertube_client::{InnertubeClient, ClientConfig};
use crate::poller::NewVideoEvent;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

const DEFAULT_CDP_PORT: u16 = 9222;
const DEFAULT_POLL_MS: u64 = 500;

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

        let past_instant = std::time::Instant::now() - std::time::Duration::from_secs(3600);

        Self {
            port: port.unwrap_or(DEFAULT_CDP_PORT),
            poll_interval_ms: std::sync::atomic::AtomicU64::new(poll_interval_ms.unwrap_or(DEFAULT_POLL_MS)),
            seen_videos,
            process_fn,
            dedicated_client: Arc::new(Mutex::new(None)),
            http_client,
            was_connected: std::sync::atomic::AtomicBool::new(false),
            last_channel_check: Mutex::new(past_instant),
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
            std::cmp::min(3000, self.poll_interval_ms.load(std::sync::atomic::Ordering::Relaxed))
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

                tracing::info!(
                    "[ChromeWatcher] NEW VIDEO detected from Chrome tab: {} \"{}\"",
                    video_id,
                    title
                );

                let event = NewVideoEvent {
                    channel_id: String::new(), // Unknown from URL alone
                    channel_name: String::new(),
                    video_id: video_id.clone(),
                    title,
                    thumbnail_url: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id),
                    published_at: now_ms, // Use detection time as published_at
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
            let poll_interval = std::cmp::min(3000, self.poll_interval_ms.load(std::sync::atomic::Ordering::Relaxed));
            let should_check = {
                let mut last = self.last_channel_check.lock().unwrap();
                if last.elapsed() >= std::time::Duration::from_millis(poll_interval) {
                    *last = std::time::Instant::now();
                    true
                } else {
                    false
                }
            };

            if should_check {
                let seen_videos = self.seen_videos.clone();
                let process_fn = self.process_fn.clone();
                let dedicated_client = self.dedicated_client.clone();

                tokio::spawn(async move {
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
                        match c.check_chrome_tabs(poll_interval).await {
                            Ok(videos) => {
                                let s_path = crate::store::get_settings_path();
                                let s_store = crate::store::SettingsStore::load(&s_path);
                                let max_age_minutes = s_store.settings
                                    .get("autoDownloadMaxAgeMinutes")
                                    .and_then(|val| val.as_u64())
                                    .unwrap_or(1440) as i64;
                                let max_age_ms = max_age_minutes * 60 * 1000;
                                let now_ms = chrono::Utc::now().timestamp_millis();

                                for v in videos {
                                    let seen_guard = seen_videos.read().await;
                                    let is_seen = seen_guard.is_any_seen(&v.video_id);
                                    drop(seen_guard);
                                    if is_seen {
                                        continue;
                                    }

                                    if v.published_at == 0 {
                                        tracing::info!(
                                            "[ChromeWatcher] Skipping video {} because published date is unknown (cannot parse from channel page)",
                                            v.video_id
                                        );
                                        continue;
                                    }

                                    let age_ms = now_ms - v.published_at;
                                    if age_ms < -300_000 || age_ms > max_age_ms {
                                        tracing::info!(
                                            "[ChromeWatcher] Skipping video {} because it is outside age limit (age: {}s, limit: {}s)",
                                            v.video_id,
                                            age_ms / 1000,
                                            max_age_ms / 1000
                                        );
                                        // Mark as seen to prevent repeated scanning and logging flood
                                        let mut seen_guard = seen_videos.write().await;
                                        seen_guard.mark_seen("", &v.video_id);
                                        drop(seen_guard);
                                        continue;
                                    }

                                    let mut seen_guard = seen_videos.write().await;
                                    seen_guard.mark_seen("", &v.video_id);
                                    drop(seen_guard);

                                    tracing::info!(
                                        "[ChromeWatcher] NEW VIDEO detected from Chrome channel tab: {} \"{}\"",
                                        v.video_id,
                                        v.title
                                    );

                                    let event = NewVideoEvent {
                                        channel_id: String::new(),
                                        channel_name: String::new(),
                                        video_id: v.video_id.clone(),
                                        title: v.title.clone(),
                                        thumbnail_url: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", v.video_id),
                                        published_at: v.published_at,
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
