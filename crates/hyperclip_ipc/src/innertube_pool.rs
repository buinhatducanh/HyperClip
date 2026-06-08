// crates/hyperclip_ipc/src/innertube_pool.rs

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use crate::error::Result;

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
}

pub struct InnertubeClientPool {
    sessions: Mutex<Vec<Session>>,
    round_robin_idx: AtomicUsize,
    config: PoolConfig,
}

impl InnertubeClientPool {
    pub fn initialize(config: PoolConfig) -> Result<Self> {
        let sessions = (0..config.size)
            .map(|_| Session {
                cooldown_until: None,
                suspended_until: None,
            })
            .collect();
        Ok(Self {
            sessions: Mutex::new(sessions),
            round_robin_idx: AtomicUsize::new(0),
            config,
        })
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
}
