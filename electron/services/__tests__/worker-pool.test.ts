/**
 * Tests for WorkerPool queue mechanics.
 * The pool's core logic (enqueue, drain, cancel, acquire/release) is fully testable
 * without spawning real FFmpeg processes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkerPool } from '../worker-pool.js'

// Minimal mock for ChildProcess (only what WorkerPool uses)
const makeMockProc = () => {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  const proc = {
    kill: vi.fn(),
    on: (event: string, fn: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(fn)
      return proc
    },
    once: (event: string, fn: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(fn)
      return proc
    },
    emit: (event: string, ...args: unknown[]) => {
      handlers[event]?.forEach(fn => fn(...args))
    },
  } as unknown as import('child_process').ChildProcess & {
    kill: ReturnType<typeof vi.fn>
    on: (e: string, fn: (...a: unknown[]) => void) => typeof proc
    emit: (e: string, ...a: unknown[]) => void
  }
  return { proc, handlers }
}

const OK = (): Promise<import('../worker-pool.js').PoolResult> =>
  Promise.resolve({ success: true, outputFile: 'out.mp4', fileSize: 1000 })

const ERR = (): Promise<import('../worker-pool.js').PoolResult> =>
  Promise.resolve({ success: false, error: 'test error' })

const slow = (ms: number, result: import('../worker-pool.js').PoolResult = { success: true }) =>
  (): Promise<import('../worker-pool.js').PoolResult> =>
    new Promise(resolve => setTimeout(() => resolve(result), ms))

// Deferred — lets us control when a promise resolves externally
function defer(): {
  promise: Promise<import('../worker-pool.js').PoolResult>
  resolve: (r: import('../worker-pool.js').PoolResult) => void
} {
  let resolve!: (r: import('../worker-pool.js').PoolResult) => void
  const promise = new Promise<import('../worker-pool.js').PoolResult>(r => { resolve = r })
  return { promise, resolve }
}

describe('WorkerPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('defaults to maxWorkers=2', () => {
      const pool = new WorkerPool()
      expect(pool.maxWorkers).toBe(2)
    })

    it('respects custom maxWorkers', () => {
      const pool = new WorkerPool(5)
      expect(pool.maxWorkers).toBe(5)
    })

    it('starts with zero active and queued', () => {
      const pool = new WorkerPool()
      expect(pool.status).toEqual({ active: 0, queued: 0 })
    })
  })

  describe('enqueue', () => {
    it('runs immediately when under maxWorkers', async () => {
      const pool = new WorkerPool(2)
      const result = await pool.enqueue('job1', OK)
      expect(result).toEqual({ success: true, outputFile: 'out.mp4', fileSize: 1000 })
    })

    it('resolves with error result on failure', async () => {
      const pool = new WorkerPool()
      const result = await pool.enqueue('fail', ERR)
      expect(result).toEqual({ success: false, error: 'test error' })
    })

    it('returns error result on thrown promise', async () => {
      const pool = new WorkerPool()
      const thrower = (): Promise<import('../worker-pool.js').PoolResult> =>
        new Promise((_, reject) => reject(new Error('boom')))
      const result = await pool.enqueue('throw', thrower)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/boom/) // String(Error) = "Error: boom"
    })

    it('jobs are independent — run concurrently via enqueue without tracking', async () => {
      // enqueue() doesn't add to active map; jobs run as plain Promises when capacity allows.
      // This tests that enqueue still works correctly for fire-and-forget style jobs.
      const pool = new WorkerPool(2)
      const [r1, r2] = await Promise.all([
        pool.enqueue('e1', slow(30)),
        pool.enqueue('e2', slow(30)),
      ])
      expect(r1.success).toBe(true)
      expect(r2.success).toBe(true)
    })
  })

  describe('cancel', () => {
    it('returns false for unknown jobId', () => {
      const pool = new WorkerPool()
      expect(pool.cancel('unknown')).toBe(false)
    })

    it('cancels tracked process via proc.kill()', () => {
      const pool = new WorkerPool(1)
      const { proc } = makeMockProc()
      pool.track('activeJob', proc)
      expect(pool.cancel('activeJob')).toBe(true)
      expect(proc.kill).toHaveBeenCalledOnce()
    })

    it('cancels queued job — resolves with cancelled error', async () => {
      const pool = new WorkerPool(1)
      // Fill the pool via track so enqueue() can fill the queue
      const { proc: p1 } = makeMockProc()
      pool.track('job1', p1)

      // Enqueue job2 — it goes into the queue since pool is full
      const { promise: p2 } = defer()
      const enqueued2 = pool.enqueue('job2', () => p2)
      expect(pool.status).toEqual({ active: 1, queued: 1 })

      expect(pool.cancel('job2')).toBe(true)
      expect(pool.cancel('job2')).toBe(false) // already cancelled

      const result = await enqueued2
      expect(result).toEqual({ success: false, error: 'Cancelled from queue' })
    })
  })

  describe('cancelAll', () => {
    it('kills all tracked processes and clears queue', async () => {
      const pool = new WorkerPool(2)
      const { proc: proc1 } = makeMockProc()
      const { proc: proc2 } = makeMockProc()
      pool.track('job1', proc1)
      pool.track('job2', proc2)

      // Fill queue with a deferred job
      const { promise: pQ } = defer()
      void pool.enqueue('queued', () => pQ)

      pool.cancelAll()
      expect(proc1.kill).toHaveBeenCalledOnce()
      expect(proc2.kill).toHaveBeenCalledOnce()
      expect(pool.status).toEqual({ active: 0, queued: 0 })
    })
  })

  describe('acquire / release', () => {
    it('acquire returns true when under maxWorkers', () => {
      const pool = new WorkerPool(2)
      expect(pool.acquire('slot1')).toBe(true)
      expect(pool.acquire('slot2')).toBe(true)
    })

    it('acquire returns false when at maxWorkers', () => {
      const pool = new WorkerPool(2)
      const { proc: p1 } = makeMockProc()
      const { proc: p2 } = makeMockProc()
      pool.track('proc1', p1)
      pool.track('proc2', p2)
      expect(pool.acquire('c')).toBe(false) // pool is full
    })

    it('release removes tracked job and enables subsequent acquire', () => {
      const pool = new WorkerPool(2)
      const { proc: p1 } = makeMockProc()
      const { proc: p2 } = makeMockProc()
      pool.track('proc1', p1)
      pool.track('proc2', p2)
      expect(pool.acquire('c')).toBe(false) // full

      pool.release('proc1')
      expect(pool.acquire('c')).toBe(true) // now has capacity
    })

    it('release triggers queue drain', async () => {
      const pool = new WorkerPool(1)
      const { proc: p1 } = makeMockProc()
      pool.track('longJob', p1)
      expect(pool.status).toEqual({ active: 1, queued: 0 })

      const { promise: p2, resolve: r2 } = defer()
      const enqueued2 = pool.enqueue('queuedJob', () => p2)
      expect(pool.status).toEqual({ active: 1, queued: 1 })

      // Release longJob — triggers drain
      pool.release('longJob')
      r2({ success: true })

      const result = await enqueued2
      expect(result.success).toBe(true)
    })
  })

  describe('track / release (process lifecycle)', () => {
    it('tracks active process and releases on close event', () => {
      const pool = new WorkerPool(2)
      const { proc } = makeMockProc()

      pool.track('proc1', proc)
      expect(pool.status).toEqual({ active: 1, queued: 0 })

      // Simulate process closing
      proc.emit('close', 0)
      expect(pool.status).toEqual({ active: 0, queued: 0 })
    })

    it('process close triggers drain — queued job runs', async () => {
      const pool = new WorkerPool(1)
      const { proc: p1 } = makeMockProc()
      pool.track('longJob', p1)
      expect(pool.status).toEqual({ active: 1, queued: 0 })

      // Queue a job (needs deferred so it stays queued for the assertion)
      const { promise: pQ, resolve: rQ } = defer()
      const enqueued = pool.enqueue('shortJob', () => pQ)
      expect(pool.status).toEqual({ active: 1, queued: 1 })

      // Close the long-running process
      p1.emit('close', 0)

      rQ({ success: true })
      const result = await enqueued
      expect(result.success).toBe(true)
    })
  })

  describe('drain ordering (FIFO)', () => {
    it('processes queued jobs in FIFO order', async () => {
      const pool = new WorkerPool(1)
      // Fill pool so subsequent enqueues go to queue
      const { proc: p1 } = makeMockProc()
      pool.track('filler', p1)

      const order: string[] = []
      const d1 = defer(); pool.enqueue('a', () => new Promise(r => setTimeout(() => { order.push('a'); r({ success: true }); d1.resolve({ success: true }) }, 30)))
      const d2 = defer(); pool.enqueue('b', () => new Promise(r => setTimeout(() => { order.push('b'); r({ success: true }); d2.resolve({ success: true }) }, 30)))
      const d3 = defer(); pool.enqueue('c', () => new Promise(r => setTimeout(() => { order.push('c'); r({ success: true }); d3.resolve({ success: true }) }, 30)))

      // Drain the filler to let queue process
      p1.emit('close', 0)
      await Promise.all([d1.promise, d2.promise, d3.promise])
      expect(order).toEqual(['a', 'b', 'c'])
    })
  })
})
