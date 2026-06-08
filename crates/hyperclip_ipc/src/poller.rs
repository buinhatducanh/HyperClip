// crates/hyperclip_ipc/src/poller.rs

use crate::error::Result;
use crate::innertube_pool::InnertubeClientPool;
use crate::types::Channel;
use rand::Rng;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{RwLock, Semaphore};

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
    concurrency: Arc<Semaphore>,
    process_fn: Arc<dyn Fn(NewVideoEvent) + Send + Sync>,
}

impl Poller {
    pub fn new(
        pool: Arc<InnertubeClientPool>,
        channels: Arc<RwLock<Vec<Channel>>>,
        poll_interval_ms: u64,
        process_fn: impl Fn(NewVideoEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            pool,
            channels,
            seen_ids: Arc::new(RwLock::new(HashSet::new())),
            poll_interval_ms,
            max_videos_per_poll: 5,
            concurrency: Arc::new(Semaphore::new(5)),
            process_fn: Arc::new(process_fn),
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

    /// Load seen IDs from a persisted set (called at startup)
    pub async fn load_seen_ids(&self, ids: HashSet<String>) {
        let mut seen = self.seen_ids.write().await;
        *seen = ids;
        tracing::info!("[Poller] Loaded {} seen IDs from disk", seen.len());
    }

    /// Take a snapshot of seen IDs (for periodic persistence)
    pub async fn seen_ids_snapshot(&self) -> HashSet<String> {
        self.seen_ids.read().await.clone()
    }

    /// Update channel list live (called when channels are added/removed via IPC)
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
        let now_ms = chrono::Utc::now().timestamp_millis();
        let channels = self.channels.read().await.clone();
        let active_channels: Vec<_> = channels.iter().filter(|c| !c.paused).collect();

        if active_channels.is_empty() {
            return Ok(());
        }

        let ready = self.pool.ready_count();
        let total = self.pool.size();
        if ready == 0 {
            tracing::warn!("[Poller] Pool exhausted — 0/{total} sessions ready");
            return Ok(());
        }

        tracing::debug!(
            "[Poller] Poll start — {} active channels, pool {ready}/{total} ready",
            active_channels.len()
        );

        let new_found = Arc::new(AtomicUsize::new(0));
        let max_new = self.max_videos_per_poll;
        let mut handles = Vec::new();

        for channel in active_channels.iter() {
            // Early termination
            if new_found.load(Ordering::Relaxed) >= max_new {
                tracing::info!(
                    "[Poller] Early termination — {} new videos found",
                    new_found.load(Ordering::Relaxed)
                );
                break;
            }

            let permit = self.concurrency.clone().acquire_owned().await;
            let pool = self.pool.clone();
            let seen_ids = self.seen_ids.clone();
            let process_fn = self.process_fn.clone();
            let lookup_id = if !channel.channel_id.is_empty() {
                channel.channel_id.clone()
            } else {
                channel.id.clone()
            };
            let channel_id = channel.id.clone();
            let channel_name = channel.name.clone();
            let new_found_clone = new_found.clone();

            handles.push(tokio::spawn(async move {
                let _permit = permit;

                let session_idx = match pool.acquire_session() {
                    Some(idx) => idx,
                    None => return,
                };

                let client_and_cookie = match pool.take_client_for_session(session_idx) {
                    Some(v) => v,
                    None => {
                        pool.mark_failed(session_idx);
                        return;
                    }
                };

                match client_and_cookie
                    .client
                    .get_latest_videos(&lookup_id, &client_and_cookie.cookie)
                    .await
                {
                    Ok(videos) => {
                        let seen = seen_ids.read().await;
                        for video in videos.iter() {
                            // 1. Seen dedup
                            if seen.contains(&video.video_id) {
                                continue;
                            }

                            // 2. Age filter: max 10 minutes
                            if !Self::is_within_age_limit(video.published_at, now_ms) {
                                continue;
                            }

                            // 3. Duration filter: skip Shorts (< 60s)
                            if video.duration_sec > 0.0 && video.duration_sec < 60.0 {
                                tracing::trace!(
                                    "[Poller] Skip Short {id} ({dur:.0}s) on {ch}",
                                    id = video.video_id,
                                    dur = video.duration_sec,
                                    ch = channel_id
                                );
                                continue;
                            }

                            // 4. Aspect ratio filter: skip vertical (9:16 ≈ ratio < 0.6)
                            if video.width > 0 && video.height > 0 {
                                let ratio = video.width as f64 / video.height as f64;
                                if ratio < 0.6 {
                                    tracing::trace!(
                                        "[Poller] Skip vertical {id} ({w}x{h}) on {ch}",
                                        id = video.video_id,
                                        w = video.width,
                                        h = video.height,
                                        ch = channel_id
                                    );
                                    continue;
                                }
                            }

                            // 5. Check early termination
                            let current = new_found_clone.fetch_add(1, Ordering::Relaxed);
                            if current >= max_new {
                                break;
                            }

                            // Mark as seen
                            let mut seen_mut = seen_ids.write().await;
                            seen_mut.insert(video.video_id.clone());
                            drop(seen_mut);

                            let event = NewVideoEvent {
                                channel_id: channel_id.clone(),
                                channel_name: channel_name.clone(),
                                video_id: video.video_id.clone(),
                                title: video.title.clone(),
                                thumbnail_url: video.thumbnail_url.clone(),
                                published_at: video.published_at,
                                duration_sec: video.duration_sec,
                                detected_at: chrono::Utc::now().timestamp_millis(),
                            };

                            tracing::info!(
                                "[Poller] NEW VIDEO [{ch}] [{id}] \"{title}\" ({dur:.0}s)",
                                ch = channel_id,
                                id = video.video_id,
                                title = video.title,
                                dur = video.duration_sec
                            );

                            process_fn(event);
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            "[Poller] Innertube error for {ch} (session {s}): {e}",
                            ch = channel_id,
                            s = session_idx
                        );
                        pool.mark_failed(session_idx);
                    }
                }
            }));
        }

        for h in handles {
            let _ = h.await;
        }

        tracing::debug!(
            "[Poller] Poll complete — {} new videos this cycle",
            new_found.load(Ordering::Relaxed)
        );

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
