use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Semaphore;

pub struct WorkerPool {
    semaphore: Semaphore,
    max: usize,
    active: AtomicUsize,
}

pub struct WorkerPermit<'a> {
    _permit: tokio::sync::SemaphorePermit<'a>,
    active: &'a AtomicUsize,
}

impl<'a> Drop for WorkerPermit<'a> {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::SeqCst);
    }
}

impl WorkerPool {
    pub fn new(max: usize) -> Self {
        Self {
            semaphore: Semaphore::new(max),
            max,
            active: AtomicUsize::new(0),
        }
    }

    pub fn max_workers(&self) -> usize {
        self.max
    }

    pub fn active_count(&self) -> usize {
        self.active.load(Ordering::SeqCst)
    }

    pub async fn acquire(&self) -> WorkerPermit<'_> {
        let permit = self.semaphore.acquire().await.unwrap();
        self.active.fetch_add(1, Ordering::SeqCst);
        WorkerPermit { _permit: permit, active: &self.active }
    }

    pub fn try_acquire(&self) -> Option<WorkerPermit<'_>> {
        let permit = self.semaphore.try_acquire().ok()?;
        self.active.fetch_add(1, Ordering::SeqCst);
        Some(WorkerPermit { _permit: permit, active: &self.active })
    }
}
