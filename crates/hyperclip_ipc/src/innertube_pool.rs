// crates/hyperclip_ipc/src/innertube_pool.rs

use crate::error::Result;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// PoolConfig controls session pool size and failure recovery timing.
#[derive(Debug, Clone)]
pub struct PoolConfig {
    pub size: u32,
    pub cooldown_duration: Duration,
    pub suspend_duration: Duration,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            size: 30,
            cooldown_duration: Duration::from_secs(10),
            suspend_duration: Duration::from_secs(300),
        }
    }
}

struct Session {
    cooldown_until: Option<Instant>,
    suspended_until: Option<Instant>,
    /// InnertubeClient instance, lazily created on first use.
    client: Option<crate::innertube_client::InnertubeClient>,
    /// SAPISID-based auth cookie string for this session.
    cookie: String,
}

/// A checked-out client + cookie pair.  The pool's internal state is not
/// locked while this value exists (the slot is considered "busy").
#[derive(Debug)]
pub struct SessionClient {
    /// The client handle to use for API calls.
    pub client: crate::innertube_client::InnertubeClient,
    /// The full cookie string for this session.
    pub cookie: String,
}

pub struct InnertubeClientPool {
    sessions: Mutex<Vec<Session>>,
    round_robin_idx: AtomicUsize,
    config: PoolConfig,
}

impl InnertubeClientPool {
    /// Initialise the pool with `config.size` slots.
    /// Call `set_cookies` to load cookies before polling.
    pub fn initialize(config: PoolConfig) -> Result<Self> {
        let sessions = (0..config.size)
            .map(|_| Session {
                cooldown_until: None,
                suspended_until: None,
                client: None,
                cookie: String::new(),
            })
            .collect();
        Ok(Self {
            sessions: Mutex::new(sessions),
            round_robin_idx: AtomicUsize::new(0),
            config,
        })
    }

    /// Load cookies for every session. Each slot gets the full cookie string
    /// (sessions share the same Chrome profile for now).
    pub fn set_cookies(&self, cookie_string: String) {
        let mut sessions = self.sessions.lock().unwrap();
        for s in sessions.iter_mut() {
            s.cookie = cookie_string.clone();
            s.client = None; // drop old client so next call re-creates it with fresh config
        }
    }

    pub fn size(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }

    pub fn next_session(&self) -> usize {
        self.round_robin_idx.fetch_add(1, Ordering::SeqCst) % self.size()
    }

    pub fn mark_failed(&self, session_idx: usize) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(session_idx) {
            s.cooldown_until = Some(Instant::now() + self.config.cooldown_duration);
            s.client = None; // invalidate client so a fresh one is created next time
        }
    }

    pub fn suspend(&self, session_idx: usize, duration: Duration) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(session_idx) {
            s.suspended_until = Some(Instant::now() + duration);
        }
    }

    pub fn ready_count(&self) -> usize {
        let now = Instant::now();
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|s| {
                s.cooldown_until.map_or(true, |t| now >= t)
                    && s.suspended_until.map_or(true, |t| now >= t)
            })
            .count()
    }

    pub fn suspended_count(&self) -> usize {
        let now = Instant::now();
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|s| s.suspended_until.map_or(false, |t| now < t))
            .count()
    }

    pub fn is_ready(&self) -> bool {
        self.ready_count() > 0
    }

    /// Return the index of a session that is ready (not in cooldown or suspended).
    /// Returns None if no session is ready.
    pub fn get_ready_session(&self) -> Option<usize> {
        let now = Instant::now();
        let sessions = self.sessions.lock().unwrap();
        for _ in 0..sessions.len() {
            let idx = self.next_session();
            if let Some(s) = sessions.get(idx) {
                if s.cooldown_until.map_or(true, |t| now >= t)
                    && s.suspended_until.map_or(true, |t| now < t)
                {
                    return Some(idx);
                }
            }
        }
        None
    }

    /// Return the index of a ready session.  Alias for get_ready_session for clarity.
    pub fn acquire_session(&self) -> Option<usize> {
        self.get_ready_session()
    }

    /// Atomically take ownership of the client and cookie for the given session
    /// index.  Returns None if the session index is out of range or the client
    /// could not be created.
    pub fn take_client_for_session(&self, session_idx: usize) -> Option<SessionClient> {
        let mut sessions = self.sessions.lock().unwrap();
        let s = sessions.get_mut(session_idx)?;

        if s.client.is_none() {
            let cfg = crate::innertube_client::ClientConfig::default();
            if let Ok(c) = crate::innertube_client::InnertubeClient::new(cfg) {
                s.client = Some(c);
            } else {
                return None;
            }
        }

        // Take ownership of both client and cookie so they can be held across await points
        let client = s.client.take()?;
        let cookie = s.cookie.clone();
        Some(SessionClient { client, cookie })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_pool_size() {
        let pool = InnertubeClientPool::initialize(PoolConfig {
            size: 30,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(pool.size(), 30);
        assert!(pool.is_ready());
    }

    #[test]
    fn test_pool_round_robin() {
        let pool = InnertubeClientPool::initialize(PoolConfig {
            size: 3,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(pool.next_session(), 0);
        assert_eq!(pool.next_session(), 1);
        assert_eq!(pool.next_session(), 2);
        assert_eq!(pool.next_session(), 0);
    }

    #[test]
    fn test_pool_mark_failed() {
        let pool = InnertubeClientPool::initialize(PoolConfig {
            size: 3,
            ..Default::default()
        })
        .unwrap();
        pool.mark_failed(0);
        assert_eq!(pool.ready_count(), 2);
    }

    #[test]
    fn test_pool_suspend() {
        let pool = InnertubeClientPool::initialize(PoolConfig {
            size: 3,
            ..Default::default()
        })
        .unwrap();
        pool.suspend(0, Duration::from_secs(300));
        assert_eq!(pool.suspended_count(), 1);
        assert_eq!(pool.ready_count(), 2);
    }

    #[test]
    fn test_set_cookies() {
        let pool = InnertubeClientPool::initialize(PoolConfig {
            size: 2,
            ..Default::default()
        })
        .unwrap();
        pool.set_cookies("SID=abc123; SOCS=CAI".to_string());
        assert_eq!(pool.ready_count(), 2);
    }
}
