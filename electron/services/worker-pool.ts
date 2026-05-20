import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { getFfmpegPath, validateFfmpeg } from './ffmpeg-paths.js'
import { getGPUCapabilities, getEffectiveWorkers } from './system.js'
import { devLog } from './unified_log.js'

// Cache validation result — check once at startup
let _ffmpegValidated = false

// ─── Worker Pool ────────────────────────────────────────────────────────────────
// Manages concurrent FFmpeg processes with queue, cancel, and resource limits.
// GPU-aware: worker count scales with hardware tier and available VRAM.
// RTX 5080 → up to 16 workers (VRAM-dependent), RTX 4080 → 14, RTX 3090 → 14.

interface PoolJob {
  jobId: string
  fn: () => Promise<PoolResult>
  resolve: (r: PoolResult) => void
}

export interface PoolResult {
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
  private _maxWorkers: number

  constructor(maxWorkers = 2) {
    this._maxWorkers = maxWorkers
  }

  get maxWorkers(): number {
    return this._maxWorkers
  }

  get status(): PoolStatus {
    return { active: this.active.size, queued: this.queue.length }
  }

  enqueue(
    jobId: string,
    fn: () => Promise<PoolResult>,
  ): Promise<PoolResult> {
    if (this.active.size < this._maxWorkers) {
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
    const killPromises: Promise<void>[] = []
    for (const proc of this.active.values()) {
      // On Windows, kill() is asynchronous — wait for exit to ensure FFmpeg is really dead.
      killPromises.push(new Promise(resolve => {
        proc.once('close', resolve)
        proc.kill()
        // Safety fallback: resolve after 500ms even if close event missed.
        setTimeout(resolve, 500)
      }))
    }
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
    while (this.queue.length > 0 && this.active.size < this._maxWorkers) {
      const job = this.queue.shift()!
      void this._run(job.jobId, job.fn).then(job.resolve)
    }
  }

  // Acquire a slot — returns true if slot available, false if queued
  acquire(_jobId: string): boolean {
    if (this.active.size < this._maxWorkers) {
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

// Render pool — GPU-aware single-pass worker count.
// Lazy init to avoid circular dependency (renderPool → ffmpeg-paths → system → ramdisk → renderPool)
let _renderPool: WorkerPool | null = null
let _renderPoolWorkers = 0

function getRenderPool(): WorkerPool {
  if (!_renderPool) {
    const caps = getGPUCapabilities()
    // Single-pass: ~50% of chunked workers since each process is heavier
    // (full filter chain vs per-chunk filter chain)
    // RTX 5080: 16 → 8 single-pass, RTX 4090: 16 → 8
    // RTX 4080: 14 → 7, RTX 3090: 14 → 7
    // Low-tier: 2 → 2
    const singleWorkers = Math.max(2, Math.ceil(caps.maxChunkWorkers * 0.5))
    _renderPool = new WorkerPool(singleWorkers)
    _renderPoolWorkers = singleWorkers
    devLog(`[WorkerPool] Render pool initialized: ${singleWorkers} workers (GPU: ${caps.gpuName}, encoder: ${caps.encoder})`)
  }
  return _renderPool
}

export const renderPool = {
  get pool() { return getRenderPool() },
  get status(): PoolStatus { return getRenderPool().status },
  get maxWorkers(): number { return _renderPoolWorkers },
  enqueue: (jobId: string, fn: () => Promise<PoolResult>) => getRenderPool().enqueue(jobId, fn),
  cancel: (jobId: string) => getRenderPool().cancel(jobId),
  cancelAll: () => getRenderPool().cancelAll(),
  acquire: (jobId: string) => getRenderPool().acquire(jobId),
  track: (jobId: string, proc: ChildProcess) => getRenderPool().track(jobId, proc),
  release: (jobId: string) => getRenderPool().release(jobId),
}

// ─── Dedicated Chunk Worker Pool ───────────────────────────────────────────────
// GPU-tier-sized pool for parallel chunk encoding.
// Uses VRAM-aware effective worker count.

let _chunkPool: WorkerPool | null = null

function getChunkPool(): WorkerPool {
  if (!_chunkPool) {
    const caps = getGPUCapabilities()
    // Use VRAM-aware effective workers
    const effective = getEffectiveWorkers()
    _chunkPool = new WorkerPool(effective)
    devLog(`[WorkerPool] Chunk pool initialized: ${effective} workers (GPU: ${caps.gpuName}, encoder: ${caps.encoder}, base=${caps.maxChunkWorkers})`)
  }
  return _chunkPool
}

export function getChunkPoolStatus(): PoolStatus {
  return getChunkPool().status
}

// ─── Run FFmpeg with full callback support ─────────────────────────────────────

export interface FfmpegRunOptions {
  jobId: string
  args: string[]
  outputFile: string
  /** Called with { pct, elapsedMs, fps, speed } during encoding. pct 0-99 (100 = done). elapsedMs = wall-clock ms since render start. */
  onProgress?: (pct: number, elapsedMs: number) => void
  onFps?: (fps: number, speed: string) => void
  timeoutMs?: number
}

// Normalize paths to forward slashes for cross-platform FFmpeg compatibility.
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

export async function runFfmpeg(opts: FfmpegRunOptions): Promise<PoolResult> {
  const { jobId, args, outputFile, onProgress, onFps, timeoutMs = 2 * 60 * 60 * 1000 } = opts

  // Debug: log all args with input indices marked
  const filterIdx = args.indexOf('-filter_complex')
  const filterVal = filterIdx !== -1 ? args[filterIdx + 1] : '(none)'
  const inputs: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i') inputs.push(`  [${inputs.length}]: ${args[i + 1]}`)
  }
  devLog(`[runFfmpeg] job=${jobId} inputs: ${inputs.join(' | ')}`)
  devLog(`[runFfmpeg] filter_complex="${filterVal}"`)
  devLog(`[runFfmpeg] output=${args[args.length - 1]}`)

  return new Promise((resolve) => {
    const t0 = Date.now()
    const ffmpeg = normalizePath(getFfmpegPath())
    const normalizedArgs = args.map(a => {
      if (a.startsWith('"')) return normalizePath(a.slice(1, a.length - 1))
      return a
    })
    const proc = spawn(ffmpeg, normalizedArgs, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })

    // Register with pool for cancellation support
    renderPool.track(jobId, proc)

    // Startup validation: check FFmpeg actually works (first render only)
    if (!_ffmpegValidated) {
      _ffmpegValidated = true
      validateFfmpeg(ffmpeg).catch(e => console.warn('[FFmpeg] Validation warning:', e))
    }

    const LINE_BUF_SIZE = 200
    const lineBuf: string[] = []
    let closed = false  // prevent progress after close

    // Extract total duration from args for progress calculation.
    let totalSec = 300
    const tIdx = args.indexOf('-t')
    if (tIdx !== -1 && tIdx + 1 < args.length) {
      const raw = args[tIdx + 1]
      const parts = raw.split(':')
      if (parts.length === 3) {
        totalSec = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])
      } else {
        totalSec = parseFloat(raw) || 300
      }
    }

    const timeout = setTimeout(() => {
      closed = true
      if (!proc.killed) proc.kill()
      renderPool.release(jobId)
      resolve({ success: false, error: 'Timeout' })
    }, timeoutMs)

    proc.stderr?.on('data', (data: Buffer) => {
      if (closed) return
      const chunk = data.toString()
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (line.trim()) {
          lineBuf.push(line)
          if (lineBuf.length > LINE_BUF_SIZE) lineBuf.shift()
        }
      }

      const recent = lineBuf.slice(-30).join('\n')
      const timeMatch = recent.match(/time=(\d+):(\d+):(\d+\.?\d*)/)
      const fpsMatch = recent.match(/fps=\s*(\d+)/)
      const speedMatch = recent.match(/speed=\s*([\d.]+)x/)

      if (timeMatch) {
        const h = parseInt(timeMatch[1])
        const m = parseInt(timeMatch[2])
        const s = parseFloat(timeMatch[3])
        const elapsed = h * 3600 + m * 60 + s
        const pct = Math.min(99, (elapsed / totalSec) * 100)
        const elapsedMs = Date.now() - t0
        onProgress?.(Math.round(pct * 10) / 10, elapsedMs)
      }

      if (fpsMatch && onFps) {
        onFps(parseInt(fpsMatch[1]), speedMatch ? `${speedMatch[1]}x` : '1x')
      }
    })

    proc.on('error', (err) => {
      closed = true
      clearTimeout(timeout)
      renderPool.release(jobId)
      resolve({ success: false, error: err.message })
    })

    proc.on('close', (code) => {
      if (closed) return
      closed = true
      clearTimeout(timeout)
      renderPool.release(jobId)

      // Force 100% on close (FFmpeg may not emit final time= line)
      onProgress?.(100, Date.now() - t0)

      const cleanPath = outputFile.replace(/"/g, '')
      if (code === 0 && fs.existsSync(cleanPath)) {
        let size = 0
        try { size = fs.statSync(cleanPath).size } catch {}
        resolve({ success: true, outputFile, fileSize: size })
      } else {
        const recent = lineBuf.slice(-20).join(' | ')
        resolve({ success: false, error: recent || `FFmpeg exited ${code}` })
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