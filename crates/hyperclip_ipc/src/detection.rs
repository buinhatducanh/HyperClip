// crates/hyperclip_ipc/src/detection.rs
// Detection pipeline: Innertube + subscription + poller + health

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Video detected from a channel's RSS feed or Innertube
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedVideo {
    pub id: String,
    pub title: String,
    pub channel_id: String,
    #[serde(rename = "publishedAt")]
    pub published_at: i64,  // unix timestamp
    #[serde(rename = "publishedText")]
    pub published_text: String,
    #[serde(rename = "durationSeconds")]
    pub duration_seconds: u32,
    pub thumbnail: String,
}

/// Age filter: ≤ 10 minutes (EXACT from HYPERCLIP_RULES.md)
pub fn is_within_age_limit(published_at: i64, now: i64) -> bool {
    if published_at <= 0 {
        return false;
    }
    let age_seconds = now - published_at;
    age_seconds <= 600  // 10 minutes
}

/// Duration filter: skip Shorts (< 60 seconds)
pub fn is_short_duration(duration_seconds: u32) -> bool {
    duration_seconds > 0 && duration_seconds < 60
}

/// Check if video is vertical (9:16)
pub fn is_vertical_aspect(width: u32, height: u32) -> bool {
    if width == 0 || height == 0 {
        return false;
    }
    // 9:16 = 0.5625 ratio. Vertical means height > width.
    let ratio = width as f64 / height as f64;
    ratio < 0.6
}

pub fn current_unix_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ─── Innertube client (calls back to TypeScript subprocess) ────────────────────

#[derive(Debug, Clone, Default)]
pub struct InnertubeConfig {
    pub cookies_path: String,
    pub sessions: u32,  // 30 max
}

impl InnertubeConfig {
    pub fn for_profile(_is_laptop: bool, _ram_gb: u32) -> Self {
        Self {
            cookies_path: String::new(),
            sessions: 30,
        }
    }
}

// ─── Poller state (5s ± 20% jitter) ─────────────────────────────────────────────

#[derive(Debug)]
pub struct Poller {
    last_poll_ms: AtomicU64,
    last_errors: u32,
    channel_count: usize,
    is_running: bool,
    pub seen_ids: HashSet<String>,
}

impl Poller {
    pub fn new() -> Self {
        Self {
            last_poll_ms: AtomicU64::new(0),
            last_errors: 0,
            channel_count: 0,
            is_running: false,
            seen_ids: HashSet::new(),
        }
    }

    /// Calculate next poll delay: 5s ± 20% jitter (4-6s)
    pub fn next_poll_delay_ms(&self) -> u64 {
        // Use simple modulo-based jitter (deterministic — no extra dep on rand)
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let jitter = (now_ms % 2000) as u64;
        4000 + jitter
    }

    pub fn mark_polled(&self) {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.last_poll_ms.store(now_ms, Ordering::Relaxed);
    }

    pub fn set_channel_count(&mut self, count: usize) {
        self.channel_count = count;
    }

    pub fn increment_errors(&mut self) {
        self.last_errors += 1;
    }

    pub fn reset_errors(&mut self) {
        self.last_errors = 0;
    }

    pub fn is_seen(&self, id: &str) -> bool {
        self.seen_ids.contains(id)
    }

    pub fn mark_seen(&mut self, id: String) {
        self.seen_ids.insert(id);
    }

    pub fn status(&self) -> PollerStatus {
        PollerStatus {
            active: self.is_running,
            channel_count: self.channel_count,
            errors: vec![],
        }
    }

    pub fn start(&mut self) {
        self.is_running = true;
    }

    pub fn stop(&mut self) {
        self.is_running = false;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollerStatus {
    pub active: bool,
    pub channel_count: usize,
    pub errors: Vec<String>,
}

// ─── Health monitor (6 conditions from electron/services/health_alerts.ts) ─────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HealthAlertLevel {
    Critical,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthAlert {
    pub level: HealthAlertLevel,
    pub message: String,
    pub code: String,
}

pub struct HealthMonitor {
    last_alert_ms: std::collections::HashMap<String, u64>,
    cooldown_ms: u64,
}

impl HealthMonitor {
    pub fn new() -> Self {
        Self {
            last_alert_ms: std::collections::HashMap::new(),
            cooldown_ms: 5 * 60 * 1000,  // 5-minute cooldown per alert
        }
    }

    fn should_alert(&mut self, code: &str) -> bool {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        if let Some(last) = self.last_alert_ms.get(code) {
            if now_ms - last < self.cooldown_ms {
                return false;
            }
        }
        self.last_alert_ms.insert(code.to_string(), now_ms);
        true
    }

    /// Check 6 health conditions (EXACT from health_alerts.ts)
    pub fn check(&mut self, ctx: &HealthContext) -> Vec<HealthAlert> {
        let mut alerts = vec![];

        // 1. Innertube dead → Critical (0/30 sessions)
        if ctx.innertube_alive_sessions == 0 && ctx.last_detection_age_hours < 24 {
            if self.should_alert("innertube_dead") {
                alerts.push(HealthAlert {
                    level: HealthAlertLevel::Critical,
                    message: "Innertube API dead — 0/30 sessions alive".to_string(),
                    code: "innertube_dead".to_string(),
                });
            }
        }

        // 2. OAuth low → Warning (<10% remaining)
        if ctx.oauth_pct_remaining < 10.0 {
            if self.should_alert("oauth_low") {
                alerts.push(HealthAlert {
                    level: HealthAlertLevel::Warning,
                    message: format!("OAuth quota low — {:.1}% remaining", ctx.oauth_pct_remaining),
                    code: "oauth_low".to_string(),
                });
            }
        }

        // 3. OAuth exhausted → Critical
        if ctx.oauth_pct_remaining < 1.0 {
            if self.should_alert("oauth_exhausted") {
                alerts.push(HealthAlert {
                    level: HealthAlertLevel::Critical,
                    message: "OAuth quota exhausted — Innertube fallback active".to_string(),
                    code: "oauth_exhausted".to_string(),
                });
            }
        }

        // 4. Disk low → Critical (freeGB < 5)
        if ctx.disk_free_gb < 5.0 {
            if self.should_alert("disk_low") {
                alerts.push(HealthAlert {
                    level: HealthAlertLevel::Critical,
                    message: format!("Disk space critical — {:.1}GB free", ctx.disk_free_gb),
                    code: "disk_low".to_string(),
                });
            }
        }

        // 5. Download failures → Warning (3+ consecutive)
        if ctx.consecutive_download_failures >= 3 {
            if self.should_alert("download_failures") {
                alerts.push(HealthAlert {
                    level: HealthAlertLevel::Warning,
                    message: format!("{} consecutive download failures", ctx.consecutive_download_failures),
                    code: "download_failures".to_string(),
                });
            }
        }

        // 6. No new videos 24h → Warning
        if ctx.last_detection_age_hours > 24 {
            if self.should_alert("no_new_videos") {
                alerts.push(HealthAlert {
                    level: HealthAlertLevel::Warning,
                    message: format!("No new videos in {}h", ctx.last_detection_age_hours),
                    code: "no_new_videos".to_string(),
                });
            }
        }

        alerts
    }
}

#[derive(Debug, Clone, Default)]
pub struct HealthContext {
    pub innertube_alive_sessions: u32,
    pub oauth_pct_remaining: f64,
    pub disk_free_gb: f64,
    pub consecutive_download_failures: u32,
    pub last_detection_age_hours: u32,
}
