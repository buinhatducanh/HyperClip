use crate::detection::{HealthAlert, HealthContext, HealthMonitor};
use crate::error::Result;
use crate::innertube_pool::InnertubeClientPool;
use crate::store::{SeenVideos, UploadsCache};
use crate::token_manager::OAuthFallbackDetector;
use crate::types::Channel;
use rand::Rng;
use serde::Serialize;
use std::sync::atomic::{AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize)]
pub struct NewVideoEvent {
    pub channel_id: String,
    pub channel_name: String,
    pub video_id: String,
    pub title: String,
    pub thumbnail_url: String,
    pub published_at: i64,
    pub duration_sec: f64,
    pub detected_at: i64,
}

pub struct Poller {
    pool: Arc<InnertubeClientPool>,
    channels: Arc<RwLock<Vec<Channel>>>,
    seen_videos: Arc<tokio::sync::RwLock<SeenVideos>>,
    uploads_cache: Arc<tokio::sync::RwLock<UploadsCache>>,
    oauth_detector: Arc<Mutex<Option<Arc<OAuthFallbackDetector>>>>,
    health_monitor: Arc<Mutex<HealthMonitor>>,
    last_detection_time: Arc<Mutex<Option<i64>>>,
    consecutive_download_failures: Arc<Mutex<u32>>,
    poll_interval_ms: AtomicU64,
    _max_videos_per_poll: usize,
    max_age_ms: AtomicI64,
    min_duration_sec: AtomicU32,
    process_fn: Arc<dyn Fn(NewVideoEvent) + Send + Sync>,
}

impl Poller {
    pub fn new(
        pool: Arc<InnertubeClientPool>,
        channels: Arc<RwLock<Vec<Channel>>>,
        seen_videos: Arc<tokio::sync::RwLock<SeenVideos>>,
        poll_interval_ms: u64,
        max_age_minutes: u64,
        min_duration_sec: u32,
        process_fn: impl Fn(NewVideoEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            pool,
            channels,
            seen_videos,
            uploads_cache: Arc::new(tokio::sync::RwLock::new(UploadsCache::default())),
            oauth_detector: Arc::new(Mutex::new(None)),
            health_monitor: Arc::new(Mutex::new(HealthMonitor::new())),
            last_detection_time: Arc::new(Mutex::new(None)),
            consecutive_download_failures: Arc::new(Mutex::new(0)),
            poll_interval_ms: AtomicU64::new(poll_interval_ms),
            _max_videos_per_poll: 5,
            max_age_ms: AtomicI64::new((max_age_minutes as i64) * 60 * 1000),
            min_duration_sec: AtomicU32::new(min_duration_sec),
            process_fn: Arc::new(process_fn),
        }
    }

    pub fn set_oauth_detector(&self, detector: Arc<OAuthFallbackDetector>) {
        let mut guard = self.oauth_detector.lock().unwrap();
        *guard = Some(detector);
    }

    pub fn reload_config(&self, poll_interval_ms: u64, max_age_minutes: u64, min_duration_sec: u32) {
        self.poll_interval_ms.store(poll_interval_ms, Ordering::Relaxed);
        self.max_age_ms.store((max_age_minutes as i64) * 60 * 1000, Ordering::Relaxed);
        self.min_duration_sec.store(min_duration_sec, Ordering::Relaxed);
        tracing::info!("[Poller] Config reloaded: interval={poll_interval_ms}ms, max_age={max_age_minutes}min, min_dur={min_duration_sec}s");
    }

    /// Record a successful detection (updates last_detection_time)
    pub fn record_detection(&self) {
        let now = crate::detection::current_unix_ts() * 1000; // Convert to milliseconds
        let mut last = self.last_detection_time.lock().unwrap();
        *last = Some(now);
    }

    /// Record a download failure
    pub fn record_download_failure(&self) {
        let mut failures = self.consecutive_download_failures.lock().unwrap();
        *failures += 1;
    }

    /// Record a download success (resets consecutive failures)
    pub fn record_download_success(&self) {
        let mut failures = self.consecutive_download_failures.lock().unwrap();
        *failures = 0;
    }

    /// Get health alerts by checking all conditions
    pub fn check_health(&self, innertube_alive: u32, oauth_pct: f64, disk_free_gb: f64) -> Vec<HealthAlert> {
        let last_detection_age_hours = {
            let last = self.last_detection_time.lock().unwrap();
            if let Some(last_ms) = *last {
                let now_ms = crate::detection::current_unix_ts() * 1000;
                let age_hours = (now_ms - last_ms) / (1000 * 60 * 60);
                age_hours as u32
            } else {
                0
            }
        };

        let consecutive_failures = *self.consecutive_download_failures.lock().unwrap();

        let ctx = HealthContext {
            innertube_alive_sessions: innertube_alive,
            oauth_pct_remaining: oauth_pct,
            disk_free_gb,
            consecutive_download_failures: consecutive_failures,
            last_detection_age_hours,
        };

        let mut monitor = self.health_monitor.lock().unwrap();
        monitor.check(&ctx)
    }

    pub fn next_poll_delay_ms(base_ms: u64) -> u64 {
        let jitter = (base_ms as f64 * 0.2) as u64;
        base_ms + rand::thread_rng().gen_range(0..=jitter)
    }

    pub fn is_within_age_limit(published_at: i64, now_ms: i64, max_age_ms: i64) -> bool {
        if published_at == 0 { return false; }
        let age_ms = now_ms - published_at;
        age_ms >= -300_000 && age_ms <= max_age_ms
    }

    pub async fn load_seen_ids(&self, store: SeenVideos) {
        let mut seen = self.seen_videos.write().await;
        *seen = store;
        let total: usize = seen.channels.values().map(|v| v.ids.len()).sum();
        tracing::info!("[Poller] Loaded {} seen IDs from disk (per-channel)", total);
    }

    pub async fn seen_ids_snapshot(&self) -> SeenVideos {
        self.seen_videos.read().await.clone()
    }

    pub async fn save_uploads_cache(&self) {
        let cache = self.uploads_cache.read().await.clone();
        let path = crate::store::get_uploads_cache_path();
        let _ = cache.save(&path);
    }

    pub async fn set_uploads_cache(&self, cache: UploadsCache) {
        let mut c = self.uploads_cache.write().await;
        *c = cache;
    }

    pub async fn update_channels(&self, channels: Vec<Channel>) {
        let mut ch = self.channels.write().await;
        *ch = channels;
        tracing::debug!("[Poller] Channel list updated — {} channels", ch.len());
    }

    pub async fn run(self: Arc<Self>, cancel: tokio_util::sync::CancellationToken) {
        // Poll immediately on startup (no initial sleep)
        tracing::info!("[Poller] Firing initial poll immediately");
        if let Err(e) = self.clone().poll_once().await {
            tracing::error!("Initial poll error: {}", e);
        }

        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("Poller cancelled");
                    break;
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(
                    Self::next_poll_delay_ms(self.poll_interval_ms.load(Ordering::Relaxed)),
                )) => {
                    if let Err(e) = self.clone().poll_once().await {
                        tracing::error!("Poll error: {}", e);
                    }
                }
            }
        }
    }

    async fn poll_once(self: Arc<Self>) -> Result<()> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let max_age_ms = self.max_age_ms.load(Ordering::Relaxed);
        let min_duration_sec = self.min_duration_sec.load(Ordering::Relaxed);
        let channels = self.channels.read().await.clone();
        let active_channels: Vec<Channel> = channels.into_iter().filter(|c| !c.paused).collect();

        if active_channels.is_empty() { return Ok(()); }

        tracing::info!(
            "[Poller] Polling {} active channels ({} total)",
            active_channels.len(), self.channels.read().await.len()
        );

        let ready = self.pool.ready_count();
        let total = self.pool.size();
        tracing::info!("[Poller] Pool ready={ready}/{total}");

        // Phase 1: Try Innertube (primary bulk polling)
        let mut oauth_channels = active_channels.clone();

        if ready > 0 {
            let polled_successfully = Arc::new(Mutex::new(std::collections::HashSet::new()));
            let mut handles = Vec::new();
            for channel in active_channels {
                let polled_successfully = Arc::clone(&polled_successfully);
                let poller = self.clone();

                let handle = tokio::spawn(async move {
                    tracing::info!("[Poller] Acquiring session for {}", channel.id);
                    let mut leased = None;
                    let mut session_idx_opt = None;
                    let start_time = std::time::Instant::now();
                    loop {
                        if let Some(idx) = poller.pool.acquire_session() {
                            if let Some(cc) = poller.pool.take_client_for_session(idx) {
                                leased = Some(cc);
                                session_idx_opt = Some(idx);
                                break;
                            } else {
                                poller.pool.release_session_busy(idx);
                            }
                        }
                        if start_time.elapsed() > std::time::Duration::from_secs(5) {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }

                    let (session_idx, mut cc) = match (session_idx_opt, leased) {
                        (Some(idx), Some(cc)) => (idx, cc),
                        _ => {
                            tracing::warn!("[Poller] Failed to acquire session or lease client for channel {} (timed out after 5s)", channel.id);
                            return;
                        }
                    };

                    let lookup_id = if !channel.channel_id.is_empty() {
                        channel.channel_id.clone()
                    } else { channel.id.clone() };
                    let cid = channel.id.clone();

                    tracing::info!("[Poller] Calling get_latest_videos for {cid}...");
                    match cc.client.get_latest_videos(&lookup_id, &cc.cookie).await {
                        Ok(videos) => {
                            tracing::info!("[Poller] get_latest_videos returned {} videos for {cid}", videos.len());
                            poller.pool.return_client(session_idx, cc.client);
                            poller.pool.mark_success(session_idx);

                            polled_successfully.lock().unwrap().insert(cid.clone());

                            for (index, video) in videos.iter().enumerate() {
                                let seen_videos = poller.seen_videos.read().await;
                                let is_seen = seen_videos.is_any_seen(&video.video_id);
                                let channel_seen_exists = seen_videos.channels.get(&cid)
                                    .map(|entry| !entry.ids.is_empty())
                                    .unwrap_or(false);
                                drop(seen_videos);

                                if is_seen { continue; }

                                if video.duration_sec < min_duration_sec as f64 {
                                    continue;
                                }
                                
                                let bypass_age_limit = !channel_seen_exists && index == 0;
                                if !bypass_age_limit && !Self::is_within_age_limit(video.published_at, now_ms, max_age_ms) {
                                    continue;
                                }
                                if video.width > 0 && video.height > 0 {
                                    let ratio = video.width as f64 / video.height as f64;
                                    if ratio < 0.6 { continue; }
                                }

                                let mut seen_videos = poller.seen_videos.write().await;
                                seen_videos.mark_seen(&cid, &video.video_id);
                                drop(seen_videos);

                                let event = NewVideoEvent {
                                    channel_id: cid.clone(), channel_name: channel.name.clone(),
                                    video_id: video.video_id.clone(), title: video.title.clone(),
                                    thumbnail_url: video.thumbnail_url.clone(),
                                    published_at: video.published_at, duration_sec: video.duration_sec,
                                    detected_at: chrono::Utc::now().timestamp_millis(),
                                };
                                poller.record_detection();
                                (poller.process_fn)(event);
                            }
                        }
                        Err(e) => {
                            tracing::warn!("[Poller] Innertube error for {cid} (session {session_idx}): {e}");
                            poller.pool.mark_failed(session_idx);
                        }
                    }
                });
                handles.push(handle);
            }
            futures::future::join_all(handles).await;
            let polled_set = polled_successfully.lock().unwrap();
            oauth_channels.retain(|c| !polled_set.contains(&c.id));
        } else {
            tracing::warn!("[Poller] Innertube pool exhausted — 0/{total} sessions ready, relying entirely on OAuth");
        }

        // Check health after Innertube phase
        let innertube_alive = self.pool.ready_count() as u32;
        let oauth_pct = 100.0; // Will be updated properly when we have TokenManager integration
        let disk_free_gb = 100.0; // Will be updated properly when we have system stats
        let alerts = self.check_health(innertube_alive, oauth_pct, disk_free_gb);
        for alert in alerts {
            tracing::warn!("[Health] {}: {}", alert.code, alert.message);
            // Emit health alert event via central emit_raw
            let alert_event = serde_json::json!({
                "method": "health:alert",
                "params": {
                    "level": format!("{:?}", alert.level),
                    "message": alert.message,
                    "code": alert.code
                }
            });
            crate::emit_raw(&serde_json::to_string(&alert_event).unwrap_or_default());
        }

        // Phase 2: OAuth fallback (only if we have detector and channels to check)
        if !oauth_channels.is_empty() {
            let detector = {
                let guard = self.oauth_detector.lock().unwrap();
                guard.clone()
            };

            if let Some(detector) = detector {
                let channel_ids: Vec<String> = oauth_channels.iter()
                    .filter_map(|c| {
                        if !c.channel_id.is_empty() {
                            Some(c.channel_id.clone())
                        } else {
                            Some(c.id.clone())
                        }
                    })
                    .collect();

                let max_age_minutes = self.max_age_ms.load(Ordering::Relaxed) / 60000;
                let seen_videos = self.seen_videos.read().await.clone();

                match detector.detect_new_videos(&channel_ids, &seen_videos, max_age_minutes as u64).await {
                    Ok(videos) => {
                        for video in videos {
                            if video.duration_sec < min_duration_sec as f64 {
                                continue;
                            }
                            // Mark as seen
                            let mut seen_videos = self.seen_videos.write().await;
                            let cid = oauth_channels.iter()
                                .find(|c| {
                                    if c.id == video.video_id {
                                        return true;
                                    }
                                    if !c.channel_id.is_empty() && c.channel_id == video.video_id {
                                        return true;
                                    }
                                    false
                                })
                                .map(|c| c.id.clone())
                                .unwrap_or_else(|| oauth_channels[0].id.clone());
                            seen_videos.mark_seen(&cid, &video.video_id);
                            drop(seen_videos);

                            let event = NewVideoEvent {
                                channel_id: cid.clone(),
                                channel_name: oauth_channels[0].name.clone(),
                                video_id: video.video_id.clone(),
                                title: video.title.clone(),
                                thumbnail_url: video.thumbnail_url.clone(),
                                published_at: video.published_at,
                                duration_sec: video.duration_sec,
                                detected_at: chrono::Utc::now().timestamp_millis(),
                            };
                            tracing::info!("[Poller] NEW VIDEO (OAuth) [{cid}] [{id}] \"{title}\"",
                                id = video.video_id, title = video.title);
                            (self.process_fn)(event);
                        }
                    }
                    Err(e) => {
                        tracing::warn!("[Poller] OAuth fallback error: {e}");
                    }
                }
            } else {
                tracing::warn!("[Poller] No OAuth detector configured — skipping OAuth fallback");
            }
        }

        self.save_uploads_cache().await;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_jitter() { for _ in 0..100 { let d = Poller::next_poll_delay_ms(5000); assert!(d>=4000&&d<=6000); } }
    #[test]
    fn test_age_under() { assert!(Poller::is_within_age_limit(1700000000000-5*60*1000, 1700000000000, 10*60*1000)); }
    #[test]
    fn test_age_over() { assert!(!Poller::is_within_age_limit(1700000000000-15*60*1000, 1700000000000, 10*60*1000)); }
    #[test]
    fn test_age_zero() { assert!(!Poller::is_within_age_limit(0, 1700000000000, 10*60*1000)); }
    #[test]
    fn test_age_custom_limit() { assert!(Poller::is_within_age_limit(1700000000000-30*60*1000, 1700000000000, 60*60*1000)); }
    #[test]
    fn test_age_custom_limit_over() { assert!(!Poller::is_within_age_limit(1700000000000-30*60*1000, 1700000000000, 10*60*1000)); }
    #[test]
    fn test_age_drift() {
        assert!(Poller::is_within_age_limit(1700000000000+2*60*1000, 1700000000000, 10*60*1000)); // Future published_at (clock drift)
        assert!(!Poller::is_within_age_limit(1700000000000+6*60*1000, 1700000000000, 10*60*1000)); // Too far in the future
    }
}
