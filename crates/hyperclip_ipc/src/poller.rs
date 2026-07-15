use crate::detection::{HealthAlert, HealthContext, HealthMonitor};
use crate::error::Result;
use crate::innertube_pool::InnertubeClientPool;
use crate::store::{SeenVideos, UploadsCache};
use crate::token_manager::OAuthFallbackDetector;
use crate::types::Channel;
use rand::Rng;
use serde::Serialize;
use std::sync::atomic::{AtomicI32, AtomicI64, AtomicU32, AtomicU64, AtomicUsize, Ordering};
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
    max_duration_sec: AtomicU32,
    process_fn: Arc<dyn Fn(NewVideoEvent) + Send + Sync>,
    /// When >0, defer polling to avoid GPU contention with active FFmpeg renders.
    active_renders: Arc<AtomicI32>,
    /// Poll concurrency ceiling while a render is active. Tier-aware: weak GPUs
    /// (Mid/Low) need 2 to protect NVENC FPS; High-tier machines keep full speed.
    render_poll_cap: AtomicUsize,
    /// How many channels (from the top of the channel list) get the fast
    /// playlist-HTML probe per poll — the surface that lists brand-new uploads
    /// minutes before the API index (Instant Playlist HTML Resolver, see
    /// docs/_archived/AUTO_INGESTION_TECH_OVERVIEW.md). ~0.5MB/channel/cycle,
    /// so it is reserved for priority channels.
    fast_probe_limit: AtomicUsize,
    /// Premieres already announced to the UI (video_id) — announce once per app
    /// session; the history entry persists on the Python side across restarts.
    announced_premieres: Arc<Mutex<std::collections::HashSet<String>>>,
    /// Channels with a get_latest_videos request currently in flight (id → started).
    /// Poll cycles fire on a fixed cadence and skip these — one channel stalling
    /// ~10s (observed sporadic Innertube slowness) must not delay detection for
    /// the other 26. Entries older than 60s are treated as stale and purged, so a
    /// panicked task can never permanently stop a channel from being polled.
    in_flight: Arc<Mutex<std::collections::HashMap<String, std::time::Instant>>>,
}

impl Poller {
    pub fn new(
        pool: Arc<InnertubeClientPool>,
        channels: Arc<RwLock<Vec<Channel>>>,
        seen_videos: Arc<tokio::sync::RwLock<SeenVideos>>,
        poll_interval_ms: u64,
        max_age_minutes: u64,
        min_duration_sec: u32,
        max_duration_sec: u32,
        process_fn: impl Fn(NewVideoEvent) + Send + Sync + 'static,
        active_renders: Arc<AtomicI32>,
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
            poll_interval_ms: AtomicU64::new(Self::clamp_interval(poll_interval_ms)),
            _max_videos_per_poll: 5,
            max_age_ms: AtomicI64::new((max_age_minutes as i64) * 60 * 1000),
            min_duration_sec: AtomicU32::new(min_duration_sec),
            max_duration_sec: AtomicU32::new(max_duration_sec),
            process_fn: Arc::new(process_fn),
            active_renders,
            render_poll_cap: AtomicUsize::new(2),
            fast_probe_limit: AtomicUsize::new(3),
            announced_premieres: Arc::new(Mutex::new(std::collections::HashSet::new())),
            in_flight: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    /// Floor the poll interval at 1s — protects against accidental tiny values
    /// hammering Innertube (30 sessions × 27+ channels).
    fn clamp_interval(poll_interval_ms: u64) -> u64 {
        poll_interval_ms.max(1000)
    }

    /// Set the poll concurrency ceiling used while renders are active.
    pub fn set_render_poll_cap(&self, cap: usize) {
        self.render_poll_cap.store(cap.max(1), Ordering::Relaxed);
    }

    /// Set how many channels (from the top of the channel list) get the
    /// fast playlist-HTML probe on every poll. The probe sees brand-new
    /// uploads minutes before the API index but costs ~0.5MB per channel
    /// per cycle — keep this small (priority/test channels first in the list).
    pub fn set_fast_probe_limit(&self, limit: usize) {
        self.fast_probe_limit.store(limit, Ordering::Relaxed);
    }

    pub fn set_oauth_detector(&self, detector: Arc<OAuthFallbackDetector>) {
        let mut guard = self.oauth_detector.lock().unwrap();
        *guard = Some(detector);
    }

    pub fn reload_config(&self, poll_interval_ms: u64, max_age_minutes: u64, min_duration_sec: u32, max_duration_sec: u32) {
        let poll_interval_ms = Self::clamp_interval(poll_interval_ms);
        self.poll_interval_ms.store(poll_interval_ms, Ordering::Relaxed);
        self.max_age_ms.store((max_age_minutes as i64) * 60 * 1000, Ordering::Relaxed);
        self.min_duration_sec.store(min_duration_sec, Ordering::Relaxed);
        self.max_duration_sec.store(max_duration_sec, Ordering::Relaxed);
        tracing::info!("[Poller] Config reloaded: interval={poll_interval_ms}ms, max_age={max_age_minutes}min, min_dur={min_duration_sec}s, max_dur={max_duration_sec}s");
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
        // Symmetric ±10% jitter: keeps the average cadence at base_ms (the old
        // +0..20% formula only ever ADDED delay, inflating average latency by 10%)
        // while still breaking the fixed request pattern.
        let jitter = (base_ms as f64 * 0.1) as u64;
        let lo = base_ms.saturating_sub(jitter);
        let hi = base_ms + jitter;
        rand::thread_rng().gen_range(lo..=hi)
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

    pub async fn prewarm(&self) {
        let pool = self.pool.clone();
        let limit = pool.max_active_clients.load(Ordering::Relaxed).min(8);
        tracing::info!("[Poller] Prewarming {} Innertube clients in parallel...", limit);
        // Spawn concurrently with a 100ms stagger (vs the old serial 500ms gaps,
        // which alone added 3.5s before the first poll could fire). Node daemons
        // initialize independently, so overlapping their startup is safe.
        let mut handles = Vec::new();
        for i in 0..limit {
            let pool = pool.clone();
            handles.push(tokio::task::spawn_blocking(move || {
                pool.prewarm_single_client()
            }));
            if i + 1 < limit {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
        for (i, handle) in handles.into_iter().enumerate() {
            match handle.await {
                Ok(Ok(true)) => tracing::info!("[Poller] Prewarmed client {}/{}", i + 1, limit),
                Ok(Ok(false)) => tracing::info!("[Poller] Client limit reached during prewarm"),
                Ok(Err(e)) => tracing::warn!("[Poller] Failed to prewarm client: {}", e),
                Err(e) => tracing::error!("[Poller] Join error during prewarm: {}", e),
            }
        }
    }

    pub async fn run(self: Arc<Self>, cancel: tokio_util::sync::CancellationToken) {
        // Poll immediately on startup (no initial sleep)
        tracing::info!("[Poller] Firing initial poll immediately");
        self.clone().spawn_poll();

        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("Poller cancelled");
                    break;
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(
                    Self::next_poll_delay_ms(self.poll_interval_ms.load(Ordering::Relaxed)),
                )) => {
                    self.clone().spawn_poll();
                }
            }
        }
    }

    /// Fire a poll cycle without blocking the cadence loop. Cycles used to run
    /// sequentially (sleep → await poll_once → sleep), so one channel answering
    /// in ~10s stretched the whole cycle to 12s+ and delayed detection for every
    /// other channel. Now the ticker keeps a fixed cadence and the in_flight set
    /// prevents overlapping cycles from double-polling a slow channel.
    fn spawn_poll(self: Arc<Self>) {
        tokio::spawn(async move {
            if let Err(e) = self.poll_once().await {
                tracing::error!("Poll error: {}", e);
            }
        });
    }

    /// Watch a scheduled premiere by video id and fire the ingestion pipeline
    /// the moment it stops being "upcoming". Checks the player endpoint every
    /// 45s (1 request per pending premiere — negligible), gives up after 24h.
    /// This path is deliberately filter-free: process_fn applies its own
    /// duration cap, and age/Short filters do not make sense for premieres.
    async fn watch_premiere(
        poller: Arc<Self>,
        video_id: String,
        channel_id: String,
        channel_name: String,
        title: String,
        thumbnail_url: String,
    ) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(24 * 3600);
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(45)).await;
            if std::time::Instant::now() >= deadline {
                tracing::warn!("[Poller] Premiere watcher for {} gave up after 24h", video_id);
                return;
            }

            // Skip the check entirely if the video already got ingested some
            // other way (e.g. detected post-air by the channel poll).
            if poller.seen_videos.read().await.is_any_seen(&video_id) {
                tracing::info!("[Poller] Premiere {} already ingested — watcher done", video_id);
                return;
            }

            let leased = match poller.pool.acquire_session() {
                Some(idx) => poller.pool.take_client_for_session(idx).await.map(|cc| (idx, cc)),
                None => None,
            };
            let (session_idx, mut cc) = match leased {
                Some(v) => v,
                None => continue,
            };

            let info_res = cc.client.get_video_info(&video_id, &cc.cookie).await;
            poller.pool.return_client(session_idx, cc.client);

            match info_res {
                Ok(info) if !info.is_upcoming => {
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    tracing::info!(
                        "[Poller] Premiere {} is now {} — firing ingestion (duration={:.0}s)",
                        video_id,
                        if info.is_live { "LIVE" } else { "published" },
                        info.duration_sec
                    );
                    let event = NewVideoEvent {
                        channel_id: channel_id.clone(),
                        channel_name: channel_name.clone(),
                        video_id: video_id.clone(),
                        title: if info.title.is_empty() { title.clone() } else { info.title.clone() },
                        thumbnail_url: thumbnail_url.clone(),
                        published_at: if info.published_at_ms > 0 { info.published_at_ms } else { now_ms },
                        duration_sec: info.duration_sec,
                        detected_at: now_ms,
                    };
                    poller.record_detection();
                    (poller.process_fn)(event);
                    return;
                }
                Ok(_) => {} // still upcoming — keep waiting
                Err(e) => {
                    tracing::debug!("[Poller] Premiere watcher getInfo failed for {}: {}", video_id, e);
                }
            }
        }
    }

    async fn poll_once(self: Arc<Self>) -> Result<()> {
        // Spawning 27 parallel Innertube HTTP calls while NVENC renders competes for
        // CPU/IO and dropped encode FPS by 40% (1341 → 791) during observed run.
        // Instead of deferring the whole poll (which delayed detection of the NEXT
        // video by up to 3s), keep polling but throttle concurrency to 2 while a
        // render is active — renders finish in 3-5s so the slower sweep still
        // completes within one poll interval.
        let render_active = self.active_renders.load(Ordering::Relaxed) > 0;

        let now_ms = chrono::Utc::now().timestamp_millis();
        let max_age_ms = self.max_age_ms.load(Ordering::Relaxed);
        let min_duration_sec = self.min_duration_sec.load(Ordering::Relaxed);
        let max_duration_sec = self.max_duration_sec.load(Ordering::Relaxed);
        let channels = self.channels.read().await.clone();
        let total_channels = channels.len();
        // Skip channels whose previous request is still in flight (slow Innertube
        // response) — they are excluded up front so the OAuth fallback below does
        // not treat them as failed either.
        let skipped_in_flight;
        let active_channels: Vec<Channel> = {
            let mut in_flight = self.in_flight.lock().unwrap();
            in_flight.retain(|_, started| started.elapsed() < std::time::Duration::from_secs(60));
            let unpaused: Vec<Channel> = channels.into_iter().filter(|c| !c.paused).collect();
            let before = unpaused.len();
            let filtered: Vec<Channel> = unpaused.into_iter()
                .filter(|c| !in_flight.contains_key(&c.id))
                .collect();
            skipped_in_flight = before - filtered.len();
            filtered
        };

        if skipped_in_flight > 0 {
            tracing::info!("[Poller] Skipping {} channel(s) with a poll still in flight", skipped_in_flight);
        }
        if active_channels.is_empty() { return Ok(()); }

        tracing::info!(
            "[Poller] Polling {} active channels ({} total)",
            active_channels.len(), total_channels
        );

        let ready = self.pool.ready_count();
        let ready_with_cookie = self.pool.ready_with_cookie_count();
        let total = self.pool.size();
        tracing::info!("[Poller] Pool ready={ready}/{total}, with_cookie={ready_with_cookie}");

        // Phase 1: Try Innertube (primary bulk polling)
        let mut oauth_channels = active_channels.clone();

        // Concurrency is capped at the number of ready sessions.
        // Public channel polling does not require logged-in sessions (cookies).
        if ready > 0 {
            let polled_successfully = Arc::new(Mutex::new(std::collections::HashSet::new()));
            // Full-parallel dispatch: concurrency is bounded only by available
            // daemons and ready sessions. The old hard cap of 8 serialized 27+
            // channels into 4 waves and stretched the sweep from ~0.4s to ~1.4s,
            // pushing worst-case detection latency past 3s (see
            // docs/DETECTION_LATENCY.md — the RTX 5080 build without a cap
            // detected reliably faster).
            let mut max_concurrency = self.pool.max_active_clients.load(Ordering::SeqCst)
                .min(ready)
                .max(1);
            if render_active {
                let render_cap = self.render_poll_cap.load(Ordering::Relaxed);
                if max_concurrency > render_cap {
                    max_concurrency = render_cap;
                    tracing::info!("[Poller] Render active — throttling poll concurrency to {}", max_concurrency);
                }
            }
            tracing::info!("[Poller] Spawning {} parallel poll tasks (cap={max_concurrency}, channels={})",
                active_channels.len().min(max_concurrency), active_channels.len());
            let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
            let mut handles = Vec::new();
            let fast_probe_limit = self.fast_probe_limit.load(Ordering::Relaxed);
            for (channel_index, channel) in active_channels.into_iter().enumerate() {
                let polled_successfully = Arc::clone(&polled_successfully);
                let poller = self.clone();
                let sem = Arc::clone(&semaphore);
                // Priority channels (top of the channel list) get the playlist-HTML
                // fast probe — put test/priority channels first in the list.
                let fast_probe = channel_index < fast_probe_limit;
                let flight_id = channel.id.clone();
                self.in_flight.lock().unwrap().insert(flight_id.clone(), std::time::Instant::now());

                let handle = tokio::spawn(async move {
                    let poller_for_flight = poller.clone();
                    // Inner block so every early `return` still clears the
                    // in_flight entry below.
                    let task = async move {
                    let _permit = sem.acquire().await.unwrap();
                    tracing::info!("[Poller] Acquiring session for {}", channel.id);
                    let mut leased = None;
                    let mut session_idx_opt = None;
                    let start_time = std::time::Instant::now();
                    loop {
                        if let Some(idx) = poller.pool.acquire_session() {
                            if let Some(cc) = poller.pool.take_client_for_session(idx).await {
                                leased = Some(cc);
                                session_idx_opt = Some(idx);
                                break;
                            } else {
                                poller.pool.release_session_busy(idx);
                            }
                        }
                        if start_time.elapsed() > std::time::Duration::from_secs(15) {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }

                    let (session_idx, mut cc) = match (session_idx_opt, leased) {
                        (Some(idx), Some(cc)) => (idx, cc),
                        _ => {
                            tracing::warn!("[Poller] Failed to acquire session or lease client for channel {} (timed out after 15s)", channel.id);
                            return;
                        }
                    };

                    let lookup_id = if !channel.channel_id.is_empty() {
                        channel.channel_id.clone()
                    } else { channel.id.clone() };
                    let cid = channel.id.clone();

                    tracing::info!("[Poller] Calling get_latest_videos for {cid}...");
                    // HTML probe fetches use the CDP-fresh profile-1 cookie
                    // (owner view — lists uploads the moment they go public);
                    // the leased session cookie may be a stale clone that only
                    // gets the lagging anonymous index.
                    let probe_cookie = if fast_probe { poller.pool.session_cookie(0) } else { None };
                    let mut videos_res = cc.client.get_latest_videos(&lookup_id, &cc.cookie, fast_probe, probe_cookie.as_deref()).await;

                    // If failed, check if it's an Auth/Cookie error and attempt to refresh
                    if let Err(ref e) = videos_res {
                        let err_str = e.to_string().to_lowercase();
                        let is_auth_error = err_str.contains("sign in") || 
                                            err_str.contains("login") || 
                                            err_str.contains("cookie") || 
                                            err_str.contains("auth") || 
                                            err_str.contains("unauthorized") || 
                                            err_str.contains("credential");
                        if is_auth_error {
                            tracing::warn!("[Poller] Auth error detected for {cid} (session {session_idx}): {e}. Attempting to refresh cookies...");
                            match poller.pool.refresh_session_cookie(session_idx) {
                                Ok(new_cookie) => {
                                    tracing::info!("[Poller] Successfully refreshed cookies for session {session_idx}. Retrying request...");
                                    // Update cookie in the active client
                                    if let Err(err) = cc.client.update_cookie(&new_cookie) {
                                        tracing::error!("[Poller] Failed to update client with new cookie: {:?}", err);
                                    }
                                    // Retry the request
                                    videos_res = cc.client.get_latest_videos(&lookup_id, &new_cookie, fast_probe, probe_cookie.as_deref()).await;
                                }
                                Err(ref refresh_err) => {
                                    tracing::error!("[Poller] Failed to refresh cookies for session {session_idx}: {}", refresh_err);
                                }
                            }
                        }
                    }

                    match videos_res {
                        Ok(videos) => {
                            let total = videos.len();
                            // An EMPTY playlist response is a throttle symptom, not data:
                            // when YouTube rate-limits the IP it serves empty results with
                            // 200-OK (observed 2026-07-14 18-10-56: 14% of responses empty
                            // in waves, tracked channels all have videos). Treat it as
                            // neutral — return the client but do NOT mark the poll
                            // successful, so the OAuth fallback may cover the channel and
                            // the session gets no false success credit.
                            if total == 0 {
                                tracing::info!("[Poller] get_latest_videos returned 0 videos for {cid} — treating as throttled/empty response");
                                poller.pool.return_client(session_idx, cc.client);
                                return;
                            }
                            // Cap to newest 30 — Innertube often returns 100 videos but only
                            // the top few matter for "new uploads". This drastically reduces
                            // filtering CPU when the age limit is short (e.g. 10 min).
                            let cap = 30usize;
                            let capped: Vec<_> = videos.into_iter().take(cap).collect();
                            tracing::info!("[Poller] get_latest_videos returned {} videos for {cid} (processing {})",
                                total, capped.len());
                            poller.pool.return_client(session_idx, cc.client);
                            poller.pool.mark_success(session_idx);

                            polled_successfully.lock().unwrap().insert(cid.clone());

                            let channel_seen_exists = {
                                let seen_videos = poller.seen_videos.read().await;
                                seen_videos.channels.get(&cid)
                                    .map(|entry| !entry.ids.is_empty())
                                    .unwrap_or(false)
                            };

                            let mut stats = (0usize, 0usize, 0usize, 0usize, 0usize); // checked, seen, duration, age, ratio
                            for (index, video) in capped.iter().enumerate() {
                                stats.0 += 1;
                                let seen_videos = poller.seen_videos.read().await;
                                let is_seen = seen_videos.is_any_seen(&video.video_id);
                                drop(seen_videos);

                                if is_seen { stats.1 += 1; continue; }

                                // Scheduled premieres are announced to the UI as
                                // "Chờ chiếu" instead of being silently skipped —
                                // otherwise the customer sees the video appear
                                // minutes later with a big red latency badge and
                                // assumes the app failed. NOT marked seen: the
                                // video must still be detected when it airs.
                                if video.upcoming {
                                    let first_time = poller.announced_premieres.lock().unwrap().insert(video.video_id.clone());
                                    if first_time {
                                        tracing::info!("[Poller] Premiere scheduled on {cid}: {} \"{}\" ({})",
                                            video.video_id, video.title, video.schedule_text);
                                        let ev = serde_json::json!({
                                            "method": "premiere:scheduled",
                                            "params": {
                                                "videoId": video.video_id,
                                                "title": video.title,
                                                "channelId": cid,
                                                "channelName": channel.name,
                                                "scheduleText": video.schedule_text,
                                                "detectedAt": chrono::Utc::now().timestamp_millis(),
                                            }
                                        });
                                        crate::emit_raw(&serde_json::to_string(&ev).unwrap_or_default());

                                        // Active watcher: poll THIS video's player info until it
                                        // stops being "upcoming", then fire the pipeline directly.
                                        // The passive path (channel list re-detection) is unreliable
                                        // for premieres: while live the duration reads 0 (dropped by
                                        // the Short filter) and after a long premiere the age filter
                                        // drops it — observed as "premiere never downloads".
                                        tokio::spawn(Self::watch_premiere(
                                            poller.clone(),
                                            video.video_id.clone(),
                                            cid.clone(),
                                            channel.name.clone(),
                                            video.title.clone(),
                                            video.thumbnail_url.clone(),
                                        ));
                                    }
                                    continue;
                                }

                                if video.duration_sec < min_duration_sec as f64 {
                                    stats.2 += 1; continue;
                                }
                                if max_duration_sec > 0 && video.duration_sec > max_duration_sec as f64 {
                                    stats.2 += 1; continue;
                                }

                                let bypass_age_limit = index == 0 && !channel_seen_exists;
                                let limit = max_age_ms;
                                if !bypass_age_limit && !Self::is_within_age_limit(video.published_at, now_ms, limit) {
                                    stats.3 += 1; continue;
                                }
                                if video.width > 0 && video.height > 0 {
                                    let ratio = video.width as f64 / video.height as f64;
                                    if ratio < 0.6 { stats.4 += 1; continue; }
                                }

                                let mut seen_videos = poller.seen_videos.write().await;
                                seen_videos.mark_seen(&cid, &video.video_id);
                                drop(seen_videos);

                                let event = NewVideoEvent {
                                    channel_id: cid.clone(), channel_name: channel.name.clone(),
                                    video_id: video.video_id.clone(), title: video.title.clone(),
                                    thumbnail_url: video.thumbnail_url.clone(),
                                    published_at: if video.published_at == 0 { now_ms } else { video.published_at }, duration_sec: video.duration_sec,
                                    detected_at: chrono::Utc::now().timestamp_millis(),
                                };
                                poller.record_detection();
                                (poller.process_fn)(event);
                            }
                            tracing::debug!("[Poller] {cid} stats: checked={} seen={} duration={} age={} ratio={}",
                                stats.0, stats.1, stats.2, stats.3, stats.4);
                        }
                        Err(e) => {
                            tracing::warn!("[Poller] Innertube error for {cid} (session {session_idx}): {e}");
                            poller.pool.return_client(session_idx, cc.client);
                            poller.pool.mark_failed(session_idx);
                        }
                    }
                    };
                    task.await;
                    poller_for_flight.in_flight.lock().unwrap().remove(&flight_id);
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
                let min_duration_sec = self.min_duration_sec.load(Ordering::Relaxed);
                let max_duration_sec = self.max_duration_sec.load(Ordering::Relaxed);

                match detector.detect_new_videos(&channel_ids, &seen_videos, max_age_minutes as u64).await {
                    Ok(videos) => {
                        for video in videos {
                             if video.duration_sec < min_duration_sec as f64 {
                                 continue;
                             }
                             if max_duration_sec > 0 && video.duration_sec > max_duration_sec as f64 {
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
    fn test_jitter() { for _ in 0..100 { let d = Poller::next_poll_delay_ms(5000); assert!(d>=4500&&d<=5500); } }
    #[test]
    fn test_interval_floor() {
        assert_eq!(Poller::clamp_interval(100), 1000);
        assert_eq!(Poller::clamp_interval(2000), 2000);
    }
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
