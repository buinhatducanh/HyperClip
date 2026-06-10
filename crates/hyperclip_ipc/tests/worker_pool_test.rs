use hyperclip_ipc::worker_pool::WorkerPool;

#[test]
fn test_pool_creation() {
    let pool = WorkerPool::new(2);
    assert_eq!(pool.max_workers(), 2);
    assert_eq!(pool.active_count(), 0);
}

#[test]
fn test_pool_acquire_release() {
    let pool = WorkerPool::new(1);
    let permit = pool.try_acquire();
    assert!(permit.is_some());
    assert_eq!(pool.active_count(), 1);

    let permit2 = pool.try_acquire();
    assert!(permit2.is_none(), "Should be exhausted at 1/1");

    drop(permit);
    assert_eq!(pool.active_count(), 0);

    let permit3 = pool.try_acquire();
    assert!(permit3.is_some());
    assert_eq!(pool.active_count(), 1);
}

#[test]
fn test_pool_max_workers_config() {
    let pool = WorkerPool::new(4);
    let p1 = pool.try_acquire().unwrap();
    let p2 = pool.try_acquire().unwrap();
    let p3 = pool.try_acquire().unwrap();
    let p4 = pool.try_acquire().unwrap();
    assert!(pool.try_acquire().is_none());
    assert_eq!(pool.active_count(), 4);
    drop(p1);
    drop(p2);
    drop(p3);
    drop(p4);
    assert_eq!(pool.active_count(), 0);
}
