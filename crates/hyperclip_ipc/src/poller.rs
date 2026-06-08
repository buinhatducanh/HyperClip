// crates/hyperclip_ipc/src/poller.rs

use crate::error::Result;
use crate::innertube_pool::InnertubeClientPool;
use crate::types::Channel;
use rand::Rng;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct Poller {
    pool: Arc<InnertubeClientPool>,
    channels: Arc<RwLock<Vec<Channel>>>,
    seen_ids: Arc<RwLock<HashSet<String>>>,
    poll_interval_ms: u64,
    max_videos_per_poll: usize,
}

impl Poller {
    pub fn new(
        pool: Arc<InnertubeClientPool>,
        channels: Arc<RwLock<Vec<Channel>>>,
        poll_interval_ms: u64,
    ) -> Self {
        Self {
            pool,
            channels,
            seen_ids: Arc::new(RwLock::new(HashSet::new())),
            poll_interval_ms,
            max_videos_per_poll: 5,
        }
    }

    pub fn next_poll_delay_ms(base_ms: u64) -> u64 {
        let jitter = (base_ms as f64 * 0.2) as u64;
        base_ms + rand::thread_rng().gen_range(0..=jitter)
    }

    pub fn is_within_age_limit(published_at: i64, now_ms: i64) -> bool {
        if published_at == 0 {
            return false;
        }
        let age_ms = now_ms - published_at;
        age_ms >= 0 && age_ms <= 10 * 60 * 1000
    }

    pub async fn run(self: Arc<Self>, cancel: tokio_util::sync::CancellationToken) {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("Poller cancelled");
                    break;
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(Self::next_poll_delay_ms(
                    self.poll_interval_ms,
                ))) => {
                    if let Err(e) = self.poll_once().await {
                        tracing::error!("Poll error: {}", e);
                    }
                }
            }
        }
    }

    /// Poll all non-paused channels and check for new videos.
    /// For each channel: acquire a session from the pool, call
    /// InnertubeClient::get_latest_videos(), filter by age and seen-IDs,
    /// then log the qualifying videos.
    async fn poll_once(&self) -> Result<()> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let channels = self.channels.read().await.clone();
        let active_channels: Vec<_> = channels.iter().filter(|c| !c.paused).collect();

        for channel in active_channels.iter().take(50) {
            // Get a ready session from the pool
            let session_idx = match self.pool.acquire_session() {
                Some(idx) => idx,
                None => {
                    tracing::warn!(
                        "No ready Innertube session for channel {} - pool exhausted",
                        channel.id
                    );
                    break;
                }
            };

            // Get client + cookie (both owned so we can hold them across await points)
            let client_and_cookie = match self.pool.take_client_for_session(session_idx) {
                Some(v) => v,
                None => {
                    tracing::warn!(
                        "No client available for session {} on channel {}",
                        session_idx,
                        channel.id
                    );
                    continue;
                }
            };

            // Call Innertube API
            match client_and_cookie
                .client
                .get_latest_videos(&channel.id, &client_and_cookie.cookie)
                .await
            {
                Ok(videos) => {
                    let seen_ids = self.seen_ids.read().await;
                    for video in videos.iter().take(self.max_videos_per_poll) {
                        // Skip if already seen
                        if seen_ids.contains(&video.video_id) {
                            tracing::trace!(
                                "Skipping already-seen video {} on channel {}",
                                video.video_id,
                                channel.id
                            );
                            continue;
                        }

                        // Age filter: must be published within the last 10 minutes
                        if !Self::is_within_age_limit(video.published_at, now_ms) {
                            tracing::trace!(
                                "Skipping old video {} (published {} vs now {})",
                                video.video_id,
                                video.published_at,
                                now_ms
                            );
                            continue;
                        }

                        // Mark as seen
                        let mut seen_ids_mut = self.seen_ids.write().await;
                        seen_ids_mut.insert(video.video_id.clone());
                        drop(seen_ids_mut);

                        tracing::info!(
                            "NEW VIDEO [channel={}] [id={}] [title=\"{}\"] [publishedAt={}] [duration={:.0}s]",
                            channel.id,
                            video.video_id,
                            video.title,
                            video.published_at,
                            video.duration_sec,
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "InnertubeClient error for channel {} (session {}): {}",
                        channel.id,
                        session_idx,
                        e
                    );
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
    fn test_poll_jitter_in_range() {
        for _ in 0..100 {
            let delay = Poller::next_poll_delay_ms(5000);
            assert!(
                delay >= 4000 && delay <= 6000,
                "delay {} out of range",
                delay
            );
        }
    }

    #[test]
    fn test_age_filter_under_10_min_accepted() {
        let now = 1_700_000_000_000_i64;
        assert!(Poller::is_within_age_limit(now - 5 * 60 * 1000, now));
    }

    #[test]
    fn test_age_filter_over_10_min_rejected() {
        let now = 1_700_000_000_000_i64;
        assert!(!Poller::is_within_age_limit(now - 15 * 60 * 1000, now));
    }

    #[test]
    fn test_age_filter_zero_published_rejected() {
        let now = 1_700_000_000_000_i64;
        assert!(!Poller::is_within_age_limit(0, now));
    }
}
