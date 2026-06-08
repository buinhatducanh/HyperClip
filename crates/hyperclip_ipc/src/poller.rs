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

    async fn poll_once(&self) -> Result<()> {
        let channels = self.channels.read().await.clone();
        let now_ms = chrono::Utc::now().timestamp_millis();
        for channel in channels.iter().filter(|c| !c.paused).take(50) {
            if self.pool.get_ready_session().is_none() {
                break;
            }
            // TODO(ws2.4): real innertube detection via Node subprocess
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
