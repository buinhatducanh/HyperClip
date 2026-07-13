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

pub type CookieRefreshFn = Box<dyn Fn(usize) -> std::result::Result<String, String> + Send + Sync>;

pub struct InnertubeClientPool {
    sessions: Mutex<Vec<Session>>,
    round_robin_idx: AtomicUsize,
    config: PoolConfig,
    clients: Mutex<Vec<crate::innertube_client::InnertubeClient>>,
    active_clients_count: std::sync::Arc<AtomicUsize>,
    pub max_active_clients: std::sync::atomic::AtomicUsize,
    cookie_refresh_fn: Mutex<Option<CookieRefreshFn>>,
    /// Timestamp of the last time a daemon was spawned, to stagger spawns.
    last_spawn_at: Mutex<Instant>,
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
            max_active_clients: std::sync::atomic::AtomicUsize::new(8),
            cookie_refresh_fn: Mutex::new(None),
            last_spawn_at: Mutex::new(Instant::now() - Duration::from_secs(10)),
        })
    }

    /// Register a callback to refresh cookies for a specific session index.
    pub fn set_refresh_callback<F>(&self, callback: F)
    where
        F: Fn(usize) -> std::result::Result<String, String> + Send + Sync + 'static,
    {
        let mut cb = self.cookie_refresh_fn.lock().unwrap();
        *cb = Some(Box::new(callback));
    }

    /// Refresh cookie for a session by executing the registered callback.
    pub fn refresh_session_cookie(&self, idx: usize) -> std::result::Result<String, String> {
        let cb_guard = self.cookie_refresh_fn.lock().unwrap();
        if let Some(ref cb) = *cb_guard {
            match cb(idx) {
                Ok(new_cookie) => {
                    let mut sessions = self.sessions.lock().unwrap();
                    if let Some(s) = sessions.get_mut(idx) {
                        s.cookie = new_cookie.clone();
                    }
                    // Clear idle clients to discard clients holding stale cookies
                    let mut clients = self.clients.lock().unwrap();
                    clients.clear();
                    Ok(new_cookie)
                }
                Err(e) => Err(e),
            }
        } else {
            Err("No cookie refresh callback registered".to_string())
        }
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

    pub fn release_session_busy(&self, session_idx: usize) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(session_idx) {
            s.busy = false;
        }
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

    /// Count sessions that are both ready AND have a valid (non-empty) cookie.
    /// Use this for sizing poll concurrency — tasks with no cookie will always timeout.
    pub fn ready_with_cookie_count(&self) -> usize {
        let now = Instant::now();
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|s| {
                !s.cookie.is_empty()
                    && s.cooldown_until.map_or(true, |t| now >= t)
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

    /// Return the index of a session that is ready (not in cooldown or suspended, has a valid cookie).
    /// Returns None if no session is ready.
    pub fn get_ready_session(&self) -> Option<usize> {
        self.get_ready_session_opt(true)
    }

    fn next_session_unlocked(&self, _sessions: &std::sync::MutexGuard<Vec<Session>>) -> usize {
        self.round_robin_idx.fetch_add(1, Ordering::SeqCst) % _sessions.len()
    }

    pub fn get_ready_session_opt(&self, require_cookie: bool) -> Option<usize> {
        let now = Instant::now();
        let len = self.size();
        let mut sessions = self.sessions.lock().unwrap();
        for _ in 0..len {
            let idx = self.next_session_unlocked(&sessions);
            if let Some(s) = sessions.get_mut(idx) {
                if require_cookie && s.cookie.is_empty() {
                    continue;
                }
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

    /// Return the index of a ready session.  Alias for get_ready_session for clarity.
    pub fn acquire_session(&self) -> Option<usize> {
        self.get_ready_session_opt(false)
    }

    /// Atomically lease a client and cookie for the given session index.
    /// If no client is available in the pool and count is under 4, a new one is spawned.
    /// Returns None if limit is reached or spawning failed.
    pub async fn take_client_for_session(&self, session_idx: usize) -> Option<SessionClient> {
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
            let limit = self.max_active_clients.load(Ordering::SeqCst);
            if active < limit {
                // Staggered spawn: wait at least 500ms since the last spawn.
                // Use tokio::time::sleep instead of std::thread::sleep — this is called from
                // a tokio task and std sleep would block the executor thread.
                let wait_ms = {
                    let mut last_spawn = self.last_spawn_at.lock().unwrap();
                    let elapsed = last_spawn.elapsed();
                    let delay = Duration::from_millis(500);
                    let wait = if elapsed < delay { delay - elapsed } else { Duration::ZERO };
                    *last_spawn = Instant::now();
                    wait
                };
                if !wait_ms.is_zero() {
                    tokio::time::sleep(wait_ms).await;
                }

                self.active_clients_count.fetch_add(1, Ordering::SeqCst);
                let cfg = crate::innertube_client::ClientConfig {
                    // 12s: long enough for a cold daemon's first RPC (~10s observed),
                    // short enough that a stalled Innertube response frees the blocked
                    // thread quickly — the fixed-cadence poller re-polls the channel
                    // on a later cycle anyway.
                    timeout_sec: 12,
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

    pub fn prewarm_single_client(&self) -> Result<bool> {
        let active = self.active_clients_count.load(Ordering::SeqCst);
        let limit = self.max_active_clients.load(Ordering::SeqCst);
        if active < limit {
            self.active_clients_count.fetch_add(1, Ordering::SeqCst);
            let cfg = crate::innertube_client::ClientConfig {
                timeout_sec: 15,
                ..Default::default()
            };
            match crate::innertube_client::InnertubeClient::new(cfg) {
                Ok(mut c) => {
                    c.drop_counter = Some(self.active_clients_count.clone());
                    let mut clients_guard = self.clients.lock().unwrap();
                    clients_guard.push(c);
                    Ok(true)
                }
                Err(e) => {
                    self.active_clients_count.fetch_sub(1, Ordering::SeqCst);
                    Err(e)
                }
            }
        } else {
            Ok(false)
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

    #[test]
    fn test_cookie_refresh() {
        let pool = InnertubeClientPool::initialize(PoolConfig {
            size: 2,
            ..Default::default()
        })
        .unwrap();
        pool.set_cookies("old_cookie".to_string());
        
        pool.set_refresh_callback(|idx| {
            Ok(format!("new_cookie_for_{}", idx))
        });
        
        let res = pool.refresh_session_cookie(0);
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), "new_cookie_for_0");
        assert_eq!(pool.get_session_cookie_string(0), "new_cookie_for_0");
        assert_eq!(pool.get_session_cookie_string(1), "old_cookie");
    }
}
