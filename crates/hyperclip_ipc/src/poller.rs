use crate::detection::{HealthAlert, HealthAlertLevel, HealthContext, HealthMonitor};
use crate::error::Result;
use crate::innertube_pool::InnertubeClientPool;
use crate::store::{SeenVideos, UploadsCache};
use crate::token_manager::OAuthFallbackDetector;
use crate::types::Channel;
use rand::Rng;
use serde::Serialize;
use std::io::Write;
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
    max_videos_per_poll: usize,
    max_age_ms: AtomicI64,
    min_duration_sec: AtomicU32,
    process_fn: Arc<dyn Fn(NewVideoEvent) + Send + Sync>,
}

impl Poller {
    pub fn new(
        pool: Arc<InnertubeClientPool>,
        channels: Arc<RwLock<Vec<Channel>>>,
        poll_interval_ms: u64,
        max_age_minutes: u64,
        min_duration_sec: u32,
        process_fn: impl Fn(NewVideoEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            pool,
            channels,
            seen_videos: Arc::new(tokio::sync::RwLock::new(SeenVideos::default())),
            uploads_cache: Arc::new(tokio::sync::RwLock::new(UploadsCache::default())),
            oauth_detector: Arc::new(Mutex::new(None)),
            health_monitor: Arc::new(Mutex::new(HealthMonitor::new())),
            last_detection_time: Arc::new(Mutex::new(None)),
            consecutive_download_failures: Arc::new(Mutex::new(0)),
            poll_interval_ms: AtomicU64::new(poll_interval_ms),
            max_videos_per_poll: 5,
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
        age_ms >= 0 && age_ms <= max_age_ms
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
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("Poller cancelled");
                    break;
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(
                    Self::next_poll_delay_ms(self.poll_interval_ms.load(Ordering::Relaxed)),
                )) => {
                    if let Err(e) = self.poll_once().await {
                        tracing::error!("Poll error: {}", e);
                    }
                }
            }
        }
    }

    async fn poll_once(&self) -> Result<()> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let max_age_ms = self.max_age_ms.load(Ordering::Relaxed);
        let min_duration_sec = self.min_duration_sec.load(Ordering::Relaxed);
        let channels = self.channels.read().await.clone();
        let active_channels: Vec<_> = channels.iter().filter(|c| !c.paused).collect();

        if active_channels.is_empty() { return Ok(()); }

        tracing::info!(
            "[Poller] Polling {} active channels ({} total)",
            active_channels.len(), channels.len()
        );

        let ready = self.pool.ready_count();
        let total = self.pool.size();
        tracing::info!("[Poller] Pool ready={ready}/{total}");

        // Phase 1: Try Innertube (primary, no quota)
        let mut innertube_channels = Vec::new();
        let mut oauth_channels = Vec::new();

        if ready > 0 {
            innertube_channels = active_channels;
        } else {
            // Innertube pool exhausted — fallback to OAuth
            tracing::warn!("[Poller] Innertube pool exhausted — 0/{total} sessions ready, falling back to OAuth");
            oauth_channels = active_channels;
        }

        // Process Innertube channels
        for channel in innertube_channels.iter() {
            tracing::info!("[Poller] Acquiring session for {}", channel.id);
            let session_idx = match self.pool.acquire_session() {
                Some(i) => i,
                None => { tracing::info!("[Poller] No ready session for {}", channel.id); continue; }
            };

            tracing::info!("[Poller] Got session {session_idx} for {}, taking client...", channel.id);
            let cc = match self.pool.take_client_for_session(session_idx) {
                Some(v) => v,
                None => { tracing::warn!("[Poller] take_client_for_session failed for session {session_idx} (channel {})", channel.id); self.pool.mark_failed(session_idx); continue; }
            };

            let lookup_id = if !channel.channel_id.is_empty() {
                channel.channel_id.clone()
            } else { channel.id.clone() };
            let cid = channel.id.clone();

            tracing::info!("[Poller] Calling get_latest_videos for {cid}...");
            match cc.client.get_latest_videos(&lookup_id, &cc.cookie).await {
                Ok(videos) => {
                    tracing::info!("[Poller] get_latest_videos returned {} videos for {cid}", videos.len());
                    self.pool.return_client(session_idx, cc.client);
                    self.pool.mark_success(session_idx);

                    if videos.is_empty() {
                        tracing::debug!("[Poller] Channel {cid} — 0 videos");
                    }
                    for video in videos.iter() {
                        let seen_videos = self.seen_videos.read().await;
                        let is_seen = seen_videos.is_seen(&cid, &video.video_id);
                        drop(seen_videos);

                        if is_seen {
                            tracing::info!("[Poller] SKIP {cid} video {} (seen)", video.video_id);
                            continue;
                        }
                        if !Self::is_within_age_limit(video.published_at, now_ms, max_age_ms) {
                            let age_s = (now_ms - video.published_at) / 1000;
                            tracing::info!("[Poller] SKIP {cid} video {} (age={age_s}s > {}min, published_at={})", video.video_id, max_age_ms / 60000, video.published_at);
                            continue;
                        }
                        if min_duration_sec > 0 && video.duration_sec > 0.0 && video.duration_sec < min_duration_sec as f64 {
                            tracing::info!("[Poller] SKIP {cid} video {} (short {:.0}s < {}s)", video.video_id, video.duration_sec, min_duration_sec);
                            continue;
                        }
                        if video.width > 0 && video.height > 0 {
                            let ratio = video.width as f64 / video.height as f64;
                            if ratio < 0.6 {
                                tracing::info!("[Poller] SKIP {cid} video {} (vertical ratio={:.2})", video.video_id, ratio);
                                continue;
                            }
                        }

                        // Mark as seen
                        let mut seen_videos = self.seen_videos.write().await;
                        seen_videos.mark_seen(&cid, &video.video_id);
                        drop(seen_videos);

                        let event = NewVideoEvent {
                            channel_id: cid.clone(), channel_name: channel.name.clone(),
                            video_id: video.video_id.clone(), title: video.title.clone(),
                            thumbnail_url: video.thumbnail_url.clone(),
                            published_at: video.published_at, duration_sec: video.duration_sec,
                            detected_at: chrono::Utc::now().timestamp_millis(),
                        };
                        tracing::info!("[Poller] NEW VIDEO [{cid}] [{id}] \"{title}\" ({dur:.0}s)",
                            id = video.video_id, title = video.title, dur = video.duration_sec);
                        // Record detection time for health monitoring
                        self.record_detection();
                        (self.process_fn)(event);
                    }
                }
                Err(e) => {
                    tracing::warn!("[Poller] Innertube error for {cid} (session {session_idx}): {e}");
                    self.pool.mark_failed(session_idx);
                }
            }
        }

        // Check health after Innertube phase
        let innertube_alive = self.pool.ready_count() as u32;
        let oauth_pct = 100.0; // Will be updated properly when we have TokenManager integration
        let disk_free_gb = 100.0; // Will be updated properly when we have system stats
        let alerts = self.check_health(innertube_alive, oauth_pct, disk_free_gb);
        for alert in alerts {
            tracing::warn!("[Health] {}: {}", alert.code, alert.message);
            // Emit health alert event to stdout for Python to pick up
            let alert_event = serde_json::json!({
                "method": "health:alert",
                "params": {
                    "level": format!("{:?}", alert.level),
                    "message": alert.message,
                    "code": alert.code
                }
            });
            let _ = writeln!(std::io::stdout(), "{}", serde_json::to_string(&alert_event).unwrap_or_default());
            let _ = std::io::stdout().flush();
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
}
