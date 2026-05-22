"use strict";
/**
 * Tests for WorkerPool queue mechanics.
 * The pool's core logic (enqueue, drain, cancel, acquire/release) is fully testable
 * without spawning real FFmpeg processes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const worker_pool_js_1 = require("../worker-pool.js");
// Minimal mock for ChildProcess (only what WorkerPool uses)
const makeMockProc = () => {
    const handlers = {};
    const proc = {
        kill: vitest_1.vi.fn(),
        on: (event, fn) => {
            if (!handlers[event])
                handlers[event] = [];
            handlers[event].push(fn);
            return proc;
        },
        emit: (event, ...args) => {
            handlers[event]?.forEach(fn => fn(...args));
        },
    };
    return { proc, handlers };
};
const OK = () => Promise.resolve({ success: true, outputFile: 'out.mp4', fileSize: 1000 });
const ERR = () => Promise.resolve({ success: false, error: 'test error' });
const slow = (ms, result = { success: true }) => () => new Promise(resolve => setTimeout(() => resolve(result), ms));
// Deferred — lets us control when a promise resolves externally
function defer() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}
(0, vitest_1.describe)('WorkerPool', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.describe)('constructor', () => {
        (0, vitest_1.it)('defaults to maxWorkers=2', () => {
            const pool = new worker_pool_js_1.WorkerPool();
            (0, vitest_1.expect)(pool.maxWorkers).toBe(2);
        });
        (0, vitest_1.it)('respects custom maxWorkers', () => {
            const pool = new worker_pool_js_1.WorkerPool(5);
            (0, vitest_1.expect)(pool.maxWorkers).toBe(5);
        });
        (0, vitest_1.it)('starts with zero active and queued', () => {
            const pool = new worker_pool_js_1.WorkerPool();
            (0, vitest_1.expect)(pool.status).toEqual({ active: 0, queued: 0 });
        });
    });
    (0, vitest_1.describe)('enqueue', () => {
        (0, vitest_1.it)('runs immediately when under maxWorkers', async () => {
            const pool = new worker_pool_js_1.WorkerPool(2);
            const result = await pool.enqueue('job1', OK);
            (0, vitest_1.expect)(result).toEqual({ success: true, outputFile: 'out.mp4', fileSize: 1000 });
        });
        (0, vitest_1.it)('resolves with error result on failure', async () => {
            const pool = new worker_pool_js_1.WorkerPool();
            const result = await pool.enqueue('fail', ERR);
            (0, vitest_1.expect)(result).toEqual({ success: false, error: 'test error' });
        });
        (0, vitest_1.it)('returns error result on thrown promise', async () => {
            const pool = new worker_pool_js_1.WorkerPool();
            const thrower = () => new Promise((_, reject) => reject(new Error('boom')));
            const result = await pool.enqueue('throw', thrower);
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toMatch(/boom/); // String(Error) = "Error: boom"
        });
        (0, vitest_1.it)('jobs are independent — run concurrently via enqueue without tracking', async () => {
            // enqueue() doesn't add to active map; jobs run as plain Promises when capacity allows.
            // This tests that enqueue still works correctly for fire-and-forget style jobs.
            const pool = new worker_pool_js_1.WorkerPool(2);
            const [r1, r2] = await Promise.all([
                pool.enqueue('e1', slow(30)),
                pool.enqueue('e2', slow(30)),
            ]);
            (0, vitest_1.expect)(r1.success).toBe(true);
            (0, vitest_1.expect)(r2.success).toBe(true);
        });
    });
    (0, vitest_1.describe)('cancel', () => {
        (0, vitest_1.it)('returns false for unknown jobId', () => {
            const pool = new worker_pool_js_1.WorkerPool();
            (0, vitest_1.expect)(pool.cancel('unknown')).toBe(false);
        });
        (0, vitest_1.it)('cancels tracked process via proc.kill()', () => {
            const pool = new worker_pool_js_1.WorkerPool(1);
            const { proc } = makeMockProc();
            pool.track('activeJob', proc);
            (0, vitest_1.expect)(pool.cancel('activeJob')).toBe(true);
            (0, vitest_1.expect)(proc.kill).toHaveBeenCalledOnce();
        });
        (0, vitest_1.it)('cancels queued job — resolves with cancelled error', async () => {
            const pool = new worker_pool_js_1.WorkerPool(1);
            // Fill the pool via track so enqueue() can fill the queue
            const { proc: p1 } = makeMockProc();
            pool.track('job1', p1);
            // Enqueue job2 — it goes into the queue since pool is full
            const { promise: p2 } = defer();
            const enqueued2 = pool.enqueue('job2', () => p2);
            (0, vitest_1.expect)(pool.status).toEqual({ active: 1, queued: 1 });
            (0, vitest_1.expect)(pool.cancel('job2')).toBe(true);
            (0, vitest_1.expect)(pool.cancel('job2')).toBe(false); // already cancelled
            const result = await enqueued2;
            (0, vitest_1.expect)(result).toEqual({ success: false, error: 'Cancelled from queue' });
        });
    });
    (0, vitest_1.describe)('cancelAll', () => {
        (0, vitest_1.it)('kills all tracked processes and clears queue', async () => {
            const pool = new worker_pool_js_1.WorkerPool(2);
            const { proc: proc1 } = makeMockProc();
            const { proc: proc2 } = makeMockProc();
            pool.track('job1', proc1);
            pool.track('job2', proc2);
            // Fill queue with a deferred job
            const { promise: pQ } = defer();
            void pool.enqueue('queued', () => pQ);
            pool.cancelAll();
            (0, vitest_1.expect)(proc1.kill).toHaveBeenCalledOnce();
            (0, vitest_1.expect)(proc2.kill).toHaveBeenCalledOnce();
            (0, vitest_1.expect)(pool.status).toEqual({ active: 0, queued: 0 });
        });
    });
    (0, vitest_1.describe)('acquire / release', () => {
        (0, vitest_1.it)('acquire returns true when under maxWorkers', () => {
            const pool = new worker_pool_js_1.WorkerPool(2);
            (0, vitest_1.expect)(pool.acquire('slot1')).toBe(true);
            (0, vitest_1.expect)(pool.acquire('slot2')).toBe(true);
        });
        (0, vitest_1.it)('acquire returns false when at maxWorkers', () => {
            const pool = new worker_pool_js_1.WorkerPool(2);
            const { proc: p1 } = makeMockProc();
            const { proc: p2 } = makeMockProc();
            pool.track('proc1', p1);
            pool.track('proc2', p2);
            (0, vitest_1.expect)(pool.acquire('c')).toBe(false); // pool is full
        });
        (0, vitest_1.it)('release removes tracked job and enables subsequent acquire', () => {
            const pool = new worker_pool_js_1.WorkerPool(2);
            const { proc: p1 } = makeMockProc();
            const { proc: p2 } = makeMockProc();
            pool.track('proc1', p1);
            pool.track('proc2', p2);
            (0, vitest_1.expect)(pool.acquire('c')).toBe(false); // full
            pool.release('proc1');
            (0, vitest_1.expect)(pool.acquire('c')).toBe(true); // now has capacity
        });
        (0, vitest_1.it)('release triggers queue drain', async () => {
            const pool = new worker_pool_js_1.WorkerPool(1);
            const { proc: p1 } = makeMockProc();
            pool.track('longJob', p1);
            (0, vitest_1.expect)(pool.status).toEqual({ active: 1, queued: 0 });
            const { promise: p2, resolve: r2 } = defer();
            const enqueued2 = pool.enqueue('queuedJob', () => p2);
            (0, vitest_1.expect)(pool.status).toEqual({ active: 1, queued: 1 });
            // Release longJob — triggers drain
            pool.release('longJob');
            r2({ success: true });
            const result = await enqueued2;
            (0, vitest_1.expect)(result.success).toBe(true);
        });
    });
    (0, vitest_1.describe)('track / release (process lifecycle)', () => {
        (0, vitest_1.it)('tracks active process and releases on close event', () => {
            const pool = new worker_pool_js_1.WorkerPool(2);
            const { proc } = makeMockProc();
            pool.track('proc1', proc);
            (0, vitest_1.expect)(pool.status).toEqual({ active: 1, queued: 0 });
            // Simulate process closing
            proc.emit('close', 0);
            (0, vitest_1.expect)(pool.status).toEqual({ active: 0, queued: 0 });
        });
        (0, vitest_1.it)('process close triggers drain — queued job runs', async () => {
            const pool = new worker_pool_js_1.WorkerPool(1);
            const { proc: p1 } = makeMockProc();
            pool.track('longJob', p1);
            (0, vitest_1.expect)(pool.status).toEqual({ active: 1, queued: 0 });
            // Queue a job (needs deferred so it stays queued for the assertion)
            const { promise: pQ, resolve: rQ } = defer();
            const enqueued = pool.enqueue('shortJob', () => pQ);
            (0, vitest_1.expect)(pool.status).toEqual({ active: 1, queued: 1 });
            // Close the long-running process
            p1.emit('close', 0);
            rQ({ success: true });
            const result = await enqueued;
            (0, vitest_1.expect)(result.success).toBe(true);
        });
    });
    (0, vitest_1.describe)('drain ordering (FIFO)', () => {
        (0, vitest_1.it)('processes queued jobs in FIFO order', async () => {
            const pool = new worker_pool_js_1.WorkerPool(1);
            // Fill pool so subsequent enqueues go to queue
            const { proc: p1 } = makeMockProc();
            pool.track('filler', p1);
            const order = [];
            const d1 = defer();
            pool.enqueue('a', () => new Promise(r => setTimeout(() => { order.push('a'); r({ success: true }); d1.resolve({ success: true }); }, 30)));
            const d2 = defer();
            pool.enqueue('b', () => new Promise(r => setTimeout(() => { order.push('b'); r({ success: true }); d2.resolve({ success: true }); }, 30)));
            const d3 = defer();
            pool.enqueue('c', () => new Promise(r => setTimeout(() => { order.push('c'); r({ success: true }); d3.resolve({ success: true }); }, 30)));
            // Drain the filler to let queue process
            p1.emit('close', 0);
            await Promise.all([d1.promise, d2.promise, d3.promise]);
            (0, vitest_1.expect)(order).toEqual(['a', 'b', 'c']);
        });
    });
});
