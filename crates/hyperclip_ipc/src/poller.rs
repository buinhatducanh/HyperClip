use crate::error::Result;
use crate::innertube_pool::InnertubeClientPool;
use crate::types::Channel;
use rand::Rng;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
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
    seen_ids: Arc<RwLock<HashSet<String>>>,
    poll_interval_ms: u64,
    max_videos_per_poll: usize,
    max_age_ms: i64,
    process_fn: Arc<dyn Fn(NewVideoEvent) + Send + Sync>,
}

impl Poller {
    pub fn new(
        pool: Arc<InnertubeClientPool>,
        channels: Arc<RwLock<Vec<Channel>>>,
        poll_interval_ms: u64,
        max_age_minutes: u64,
        process_fn: impl Fn(NewVideoEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            pool,
            channels,
            seen_ids: Arc::new(RwLock::new(HashSet::new())),
            poll_interval_ms,
            max_videos_per_poll: 5,
            max_age_ms: (max_age_minutes as i64) * 60 * 1000,
            process_fn: Arc::new(process_fn),
        }
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

    pub async fn load_seen_ids(&self, ids: HashSet<String>) {
        let mut seen = self.seen_ids.write().await;
        *seen = ids;
        tracing::info!("[Poller] Loaded {} seen IDs from disk", seen.len());
    }

    pub async fn seen_ids_snapshot(&self) -> HashSet<String> {
        self.seen_ids.read().await.clone()
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
                    Self::next_poll_delay_ms(self.poll_interval_ms),
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
        if ready == 0 {
            tracing::warn!("[Poller] Pool exhausted — 0/{total} sessions ready");
            return Ok(());
        }

        for channel in active_channels.iter() {
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
                    // Return client to pool and mark success
                    self.pool.return_client(session_idx, cc.client);
                    self.pool.mark_success(session_idx);

                    if videos.is_empty() {
                        tracing::debug!("[Poller] Channel {cid} — 0 videos");
                    }
                    for video in videos.iter() {
                        if self.seen_ids.read().await.contains(&video.video_id) {
                            tracing::info!("[Poller] SKIP {cid} video {} (seen)", video.video_id);
                            continue;
                        }
                        if !Self::is_within_age_limit(video.published_at, now_ms, self.max_age_ms) {
                            let age_s = (now_ms - video.published_at) / 1000;
                            tracing::info!("[Poller] SKIP {cid} video {} (age={age_s}s > 600s, published_at={})", video.video_id, video.published_at);
                            continue;
                        }
                        if video.duration_sec > 0.0 && video.duration_sec < 60.0 {
                            tracing::info!("[Poller] SKIP {cid} video {} (short {:.0}s)", video.video_id, video.duration_sec);
                            continue;
                        }
                        if video.width > 0 && video.height > 0 {
                            let ratio = video.width as f64 / video.height as f64;
                            if ratio < 0.6 {
                                tracing::info!("[Poller] SKIP {cid} video {} (vertical ratio={:.2})", video.video_id, ratio);
                                continue;
                            }
                        }
                        self.seen_ids.write().await.insert(video.video_id.clone());
                        let event = NewVideoEvent {
                            channel_id: cid.clone(), channel_name: channel.name.clone(),
                            video_id: video.video_id.clone(), title: video.title.clone(),
                            thumbnail_url: video.thumbnail_url.clone(),
                            published_at: video.published_at, duration_sec: video.duration_sec,
                            detected_at: chrono::Utc::now().timestamp_millis(),
                        };
                        tracing::info!("[Poller] NEW VIDEO [{cid}] [{id}] \"{title}\" ({dur:.0}s)",
                            id = video.video_id, title = video.title, dur = video.duration_sec);
                        (self.process_fn)(event);
                    }
                }
                Err(e) => {
                    tracing::warn!("[Poller] Innertube error for {cid} (session {session_idx}): {e}");
                    // Don't return client on error — pool.mark_failed invalidates it
                    self.pool.mark_failed(session_idx);
                }
            }
        }
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
