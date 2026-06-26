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
            cooldown_duration: Duration::from_secs(5),
            suspend_duration: Duration::from_secs(300),
        }
    }
}

struct Session {
    cooldown_until: Option<Instant>,
    suspended_until: Option<Instant>,
    /// SAPISID-based auth cookie string for this session.
    cookie: String,
    /// Whether the session is currently checking a channel.
    busy: bool,
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
    clients: Mutex<Vec<crate::innertube_client::InnertubeClient>>,
    active_clients_count: std::sync::Arc<AtomicUsize>,
}

impl InnertubeClientPool {
    /// Initialise the pool with `config.size` slots.
    /// Call `set_cookies` to load cookies before polling.
    pub fn initialize(config: PoolConfig) -> Result<Self> {
        let sessions = (0..config.size)
            .map(|_| Session {
                cooldown_until: None,
                suspended_until: None,
                cookie: String::new(),
                busy: false,
            })
            .collect();
        Ok(Self {
            sessions: Mutex::new(sessions),
            round_robin_idx: AtomicUsize::new(0),
            config,
            clients: Mutex::new(Vec::new()),
            active_clients_count: std::sync::Arc::new(AtomicUsize::new(0)),
        })
    }

    /// Load cookies for every session. Each slot gets the full cookie string
    /// (sessions share the same Chrome profile for now).
    pub fn set_cookies(&self, cookie_string: String) {
        let mut sessions = self.sessions.lock().unwrap();
        for s in sessions.iter_mut() {
            s.cookie = cookie_string.clone();
        }
        let mut clients = self.clients.lock().unwrap();
        clients.clear();
    }

    /// Load distinct cookies for a specific session index.
    pub fn set_session_cookie(&self, idx: usize, cookie_string: String) {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.get_mut(idx) {
            s.cookie = cookie_string;
        }
        let mut clients = self.clients.lock().unwrap();
        clients.clear();
    }

    /// Check if a session cookie contains valid YouTube credentials.
    pub fn is_session_logged_in(&self, idx: usize) -> bool {
        let sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.get(idx) {
            s.cookie.contains("SAPISID") || s.cookie.contains("__Secure-3PAPISID")
        } else {
            false
        }
    }

    /// Get the cookie string for a specific session index.
    pub fn get_session_cookie_string(&self, idx: usize) -> String {
        let sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.get(idx) {
            s.cookie.clone()
        } else {
            String::new()
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
            s.busy = false;
        }
    }

    pub fn mark_success(&self, session_idx: usize) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(session_idx) {
            s.cooldown_until = None;
            s.suspended_until = None;
            s.busy = false;
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
        let len = self.size(); // get size BEFORE locking to avoid deadlock with next_session() -> size()
        let mut sessions = self.sessions.lock().unwrap();
        for _ in 0..len {
            let idx = self.next_session_unlocked(&sessions);
            if let Some(s) = sessions.get_mut(idx) {
                if !s.busy
                     && s.cooldown_until.map_or(true, |t| now >= t)
                     && s.suspended_until.map_or(true, |t| now >= t)
                {
                    s.busy = true;
                    return Some(idx);
                }
            }
        }
        None
    }

    fn next_session_unlocked(&self, _sessions: &std::sync::MutexGuard<Vec<Session>>) -> usize {
        self.round_robin_idx.fetch_add(1, Ordering::SeqCst) % _sessions.len()
    }

    /// Return the index of a ready session.  Alias for get_ready_session for clarity.
    pub fn acquire_session(&self) -> Option<usize> {
        self.get_ready_session()
    }

    /// Atomically lease a client and cookie for the given session index.
    /// If no client is available in the pool and count is under 4, a new one is spawned.
    /// Returns None if limit is reached or spawning failed.
    pub fn take_client_for_session(&self, session_idx: usize) -> Option<SessionClient> {
        let cookie = {
            let mut sessions = self.sessions.lock().unwrap();
            let s = sessions.get_mut(session_idx)?;
            s.cookie.clone()
        };

        let mut client_opt = {
            let mut clients_guard = self.clients.lock().unwrap();
            clients_guard.pop()
        };

        if client_opt.is_none() {
            let active = self.active_clients_count.load(Ordering::SeqCst);
            if active < 4 {
                self.active_clients_count.fetch_add(1, Ordering::SeqCst);
                let cfg = crate::innertube_client::ClientConfig {
                    timeout_sec: 15,
                    ..Default::default()
                };
                match crate::innertube_client::InnertubeClient::new(cfg) {
                    Ok(mut c) => {
                        c.drop_counter = Some(self.active_clients_count.clone());
                        client_opt = Some(c);
                    }
                    Err(_) => {
                        self.active_clients_count.fetch_sub(1, Ordering::SeqCst);
                    }
                }
            }
        }

        let mut client = client_opt?;

        if let Err(e) = client.update_cookie(&cookie) {
            tracing::warn!("[InnertubeClientPool] Failed to update leased client cookie: {:?}", e);
            return None;
        }

        Some(SessionClient { client, cookie })
    }

    /// Return a client back to the pool so it can be reused.
    pub fn return_client(&self, session_idx: usize, client: crate::innertube_client::InnertubeClient) {
        {
            let mut clients_guard = self.clients.lock().unwrap();
            clients_guard.push(client);
        }
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.get_mut(session_idx) {
            s.busy = false;
        }
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
