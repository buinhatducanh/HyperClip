import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { getFfmpegPath } from './ffmpeg-paths.js'

// ─── Worker Pool ────────────────────────────────────────────────────────────────
// Manages concurrent FFmpeg processes with queue, cancel, and resource limits.
// This isolates FFmpeg process management from the main Electron process logic.

interface PoolJob {
  jobId: string
  fn: () => Promise<PoolResult>
  resolve: (r: PoolResult) => void
}

interface PoolResult {
  success: boolean
  outputFile?: string
  fileSize?: number
  error?: string
}

export interface PoolStatus {
  active: number
  queued: number
}

export class WorkerPool {
  private active: Map<string, ChildProcess> = new Map()
  private queue: PoolJob[] = []
  private maxWorkers: number

  constructor(maxWorkers = 2) {
    this.maxWorkers = maxWorkers
  }

  get status(): PoolStatus {
    return { active: this.active.size, queued: this.queue.length }
  }

  enqueue(
    jobId: string,
    fn: () => Promise<PoolResult>,
  ): Promise<PoolResult> {
    if (this.active.size < this.maxWorkers) {
      return this._run(jobId, fn)
    }
    return new Promise((resolve) => {
      this.queue.push({ jobId, fn, resolve })
    })
  }

  cancel(jobId: string): boolean {
    const proc = this.active.get(jobId)
    if (proc) {
      proc.kill()
      this.active.delete(jobId)
      this._drain()
      return true
    }
    const idx = this.queue.findIndex(j => j.jobId === jobId)
    if (idx !== -1) {
      const [job] = this.queue.splice(idx, 1)
      job.resolve({ success: false, error: 'Cancelled from queue' })
      return true
    }
    return false
  }

  cancelAll(): void {
    for (const proc of this.active.values()) proc.kill()
    this.active.clear()
    for (const job of this.queue) job.resolve({ success: false, error: 'Pool shutdown' })
    this.queue = []
  }

  private async _run(jobId: string, fn: () => Promise<PoolResult>): Promise<PoolResult> {
    try {
      const result = await fn()
      this.active.delete(jobId)
      this._drain()
      return result
    } catch (err) {
      this.active.delete(jobId)
      this._drain()
      return { success: false, error: String(err) }
    }
  }

  private _drain(): void {
    while (this.queue.length > 0 && this.active.size < this.maxWorkers) {
      const job = this.queue.shift()!
      this._run(job.jobId, job.fn).then(job.resolve)
    }
  }

  // Acquire a slot — returns true if slot available, false if queued
  acquire(jobId: string): boolean {
    if (this.active.size < this.maxWorkers) {
      return true // caller responsible for releasing
    }
    return false
  }

  track(jobId: string, proc: ChildProcess): void {
    this.active.set(jobId, proc)
    proc.on('close', () => {
      this.active.delete(jobId)
      this._drain()
    })
  }

  release(jobId: string): void {
    this.active.delete(jobId)
    this._drain()
  }
}

export const renderPool = new WorkerPool(2)

// ─── Run FFmpeg with full callback support ─────────────────────────────────────

export interface FfmpegRunOptions {
  jobId: string
  args: string[]
  outputFile: string
  onProgress?: (pct: number) => void
  onFps?: (fps: number, speed: string) => void
  timeoutMs?: number
}

export async function runFfmpeg(opts: FfmpegRunOptions): Promise<PoolResult> {
  const { jobId, args, outputFile, onProgress, onFps, timeoutMs = 2 * 60 * 60 * 1000 } = opts

  return new Promise((resolve) => {
    const ffmpeg = getFfmpegPath()
    const proc = spawn(ffmpeg, args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })

    // Register with pool for cancellation support
    renderPool.track(jobId, proc)

    let stderr = ''
    const startTime = Date.now()

    // Extract total duration from args for progress calculation
    const ssIdx = args.indexOf('-ss')
    const tIdx = args.indexOf('-t')
    const totalSec = (tIdx !== -1 ? parseFloat(args[tIdx + 1]) || 300 : 300)

    const timeout = setTimeout(() => {
      if (!proc.killed) proc.kill()
      renderPool.release(jobId)
      resolve({ success: false, error: 'Timeout' })
    }, timeoutMs)

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()

      const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/)
      const fpsMatch = stderr.match(/fps=\s*(\d+)/)
      const speedMatch = stderr.match(/speed=\s*([\d.]+)x/)

      if (timeMatch) {
        const h = parseInt(timeMatch[1])
        const m = parseInt(timeMatch[2])
        const s = parseFloat(timeMatch[3])
        const elapsed = h * 3600 + m * 60 + s
        const pct = Math.min(99, (elapsed / totalSec) * 100)
        onProgress?.(Math.round(pct * 10) / 10)
      }

      if (fpsMatch && onFps) {
        onFps(parseInt(fpsMatch[1]), speedMatch ? `${speedMatch[1]}x` : '1x')
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      renderPool.release(jobId)
      resolve({ success: false, error: err.message })
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)
      renderPool.release(jobId)

      const cleanPath = outputFile.replace(/"/g, '')
      if (code === 0 && fs.existsSync(cleanPath)) {
        let size = 0
        try { size = fs.statSync(cleanPath).size } catch {}
        resolve({ success: true, outputFile, fileSize: size })
      } else {
        resolve({ success: false, error: stderr || `FFmpeg exited ${code}` })
      }
    })
  })
}

export function cancelFfmpeg(jobId: string): boolean {
  return renderPool.cancel(jobId)
}

export function cancelAllFfmpeg(): void {
  renderPool.cancelAll()
}

export function getPoolStatus(): PoolStatus {
  return renderPool.status
}
