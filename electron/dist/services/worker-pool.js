import { spawn } from 'child_process';
import fs from 'fs';
import { getFfmpegPath, validateFfmpeg } from './ffmpeg-paths.js';
import { getGPUCapabilities, getEffectiveWorkers } from './system.js';
import { devLog } from './dev_log.js';
// Cache validation result — check once at startup
let _ffmpegValidated = false;
export class WorkerPool {
    active = new Map();
    queue = [];
    _maxWorkers;
    constructor(maxWorkers = 2) {
        this._maxWorkers = maxWorkers;
    }
    get maxWorkers() {
        return this._maxWorkers;
    }
    get status() {
        return { active: this.active.size, queued: this.queue.length };
    }
    enqueue(jobId, fn) {
        if (this.active.size < this._maxWorkers) {
            return this._run(jobId, fn);
        }
        return new Promise((resolve) => {
            this.queue.push({ jobId, fn, resolve });
        });
    }
    cancel(jobId) {
        const proc = this.active.get(jobId);
        if (proc) {
            proc.kill();
            this.active.delete(jobId);
            this._drain();
            return true;
        }
        const idx = this.queue.findIndex(j => j.jobId === jobId);
        if (idx !== -1) {
            const [job] = this.queue.splice(idx, 1);
            job.resolve({ success: false, error: 'Cancelled from queue' });
            return true;
        }
        return false;
    }
    cancelAll() {
        for (const proc of this.active.values())
            proc.kill();
        this.active.clear();
        for (const job of this.queue)
            job.resolve({ success: false, error: 'Pool shutdown' });
        this.queue = [];
    }
    async _run(jobId, fn) {
        try {
            const result = await fn();
            this.active.delete(jobId);
            this._drain();
            return result;
        }
        catch (err) {
            this.active.delete(jobId);
            this._drain();
            return { success: false, error: String(err) };
        }
    }
    _drain() {
        while (this.queue.length > 0 && this.active.size < this._maxWorkers) {
            const job = this.queue.shift();
            this._run(job.jobId, job.fn).then(job.resolve);
        }
    }
    // Acquire a slot — returns true if slot available, false if queued
    acquire(jobId) {
        if (this.active.size < this._maxWorkers) {
            return true; // caller responsible for releasing
        }
        return false;
    }
    track(jobId, proc) {
        this.active.set(jobId, proc);
        proc.on('close', () => {
            this.active.delete(jobId);
            this._drain();
        });
    }
    release(jobId) {
        this.active.delete(jobId);
        this._drain();
    }
}
// Render pool — GPU-aware single-pass worker count.
// Lazy init to avoid circular dependency (renderPool → ffmpeg-paths → system → ramdisk → renderPool)
let _renderPool = null;
let _renderPoolWorkers = 0;
function getRenderPool() {
    if (!_renderPool) {
        const caps = getGPUCapabilities();
        // Single-pass: ~50% of chunked workers since each process is heavier
        // (full filter chain vs per-chunk filter chain)
        // RTX 5080: 16 → 8 single-pass, RTX 4090: 16 → 8
        // RTX 4080: 14 → 7, RTX 3090: 14 → 7
        // Low-tier: 2 → 2
        const singleWorkers = Math.max(2, Math.ceil(caps.maxChunkWorkers * 0.5));
        _renderPool = new WorkerPool(singleWorkers);
        _renderPoolWorkers = singleWorkers;
        devLog(`[WorkerPool] Render pool initialized: ${singleWorkers} workers (GPU: ${caps.gpuName}, encoder: ${caps.encoder})`);
    }
    return _renderPool;
}
export const renderPool = {
    get pool() { return getRenderPool(); },
    get status() { return getRenderPool().status; },
    get maxWorkers() { return _renderPoolWorkers; },
    enqueue: (jobId, fn) => getRenderPool().enqueue(jobId, fn),
    cancel: (jobId) => getRenderPool().cancel(jobId),
    cancelAll: () => getRenderPool().cancelAll(),
    acquire: (jobId) => getRenderPool().acquire(jobId),
    track: (jobId, proc) => getRenderPool().track(jobId, proc),
    release: (jobId) => getRenderPool().release(jobId),
};
// ─── Dedicated Chunk Worker Pool ───────────────────────────────────────────────
// GPU-tier-sized pool for parallel chunk encoding.
// Uses VRAM-aware effective worker count.
let _chunkPool = null;
function getChunkPool() {
    if (!_chunkPool) {
        const caps = getGPUCapabilities();
        // Use VRAM-aware effective workers
        const effective = getEffectiveWorkers();
        _chunkPool = new WorkerPool(effective);
        devLog(`[WorkerPool] Chunk pool initialized: ${effective} workers (GPU: ${caps.gpuName}, encoder: ${caps.encoder}, base=${caps.maxChunkWorkers})`);
    }
    return _chunkPool;
}
export function getChunkPoolStatus() {
    return getChunkPool().status;
}
// Normalize paths to forward slashes for cross-platform FFmpeg compatibility.
function normalizePath(p) {
    return p.replace(/\\/g, '/');
}
export async function runFfmpeg(opts) {
    const { jobId, args, outputFile, onProgress, onFps, timeoutMs = 2 * 60 * 60 * 1000 } = opts;
    // Debug: log first 3 and last 3 args to trace corruption
    const firstFew = args.slice(0, 3).join(' | ');
    const lastFew = args.slice(-3).join(' | ');
    const filterIdx = args.indexOf('-filter_complex');
    const filterVal = filterIdx !== -1 ? args[filterIdx + 1] : '(none)';
    devLog(`[runFfmpeg] job=${jobId} args[0..2]="${firstFew}" filter_complex="${filterVal}" last="${lastFew}"`);
    devLog(`[runFfmpeg] total args=${args.length}`);
    return new Promise((resolve) => {
        const t0 = Date.now();
        const ffmpeg = normalizePath(getFfmpegPath());
        const normalizedArgs = args.map(a => {
            if (a.startsWith('"'))
                return normalizePath(a.slice(1, a.length - 1));
            return a;
        });
        const proc = spawn(ffmpeg, normalizedArgs, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        // Register with pool for cancellation support
        renderPool.track(jobId, proc);
        // Startup validation: check FFmpeg actually works (first render only)
        if (!_ffmpegValidated) {
            _ffmpegValidated = true;
            validateFfmpeg(ffmpeg).catch(e => console.warn('[FFmpeg] Validation warning:', e));
        }
        const LINE_BUF_SIZE = 200;
        const lineBuf = [];
        // Extract total duration from args for progress calculation.
        let totalSec = 300;
        const tIdx = args.indexOf('-t');
        if (tIdx !== -1 && tIdx + 1 < args.length) {
            const raw = args[tIdx + 1];
            const parts = raw.split(':');
            if (parts.length === 3) {
                totalSec = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
            }
            else {
                totalSec = parseFloat(raw) || 300;
            }
        }
        const timeout = setTimeout(() => {
            if (!proc.killed)
                proc.kill();
            renderPool.release(jobId);
            resolve({ success: false, error: 'Timeout' });
        }, timeoutMs);
        proc.stderr?.on('data', (data) => {
            const chunk = data.toString();
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    lineBuf.push(line);
                    if (lineBuf.length > LINE_BUF_SIZE)
                        lineBuf.shift();
                }
            }
            const recent = lineBuf.slice(-30).join('\n');
            const timeMatch = recent.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
            const fpsMatch = recent.match(/fps=\s*(\d+)/);
            const speedMatch = recent.match(/speed=\s*([\d.]+)x/);
            if (timeMatch) {
                const h = parseInt(timeMatch[1]);
                const m = parseInt(timeMatch[2]);
                const s = parseFloat(timeMatch[3]);
                const elapsed = h * 3600 + m * 60 + s;
                const pct = Math.min(99, (elapsed / totalSec) * 100);
                const elapsedMs = Date.now() - t0;
                onProgress?.(Math.round(pct * 10) / 10, elapsedMs);
            }
            if (fpsMatch && onFps) {
                onFps(parseInt(fpsMatch[1]), speedMatch ? `${speedMatch[1]}x` : '1x');
            }
        });
        proc.on('error', (err) => {
            clearTimeout(timeout);
            renderPool.release(jobId);
            resolve({ success: false, error: err.message });
        });
        proc.on('close', (code) => {
            clearTimeout(timeout);
            renderPool.release(jobId);
            const cleanPath = outputFile.replace(/"/g, '');
            if (code === 0 && fs.existsSync(cleanPath)) {
                let size = 0;
                try {
                    size = fs.statSync(cleanPath).size;
                }
                catch { }
                resolve({ success: true, outputFile, fileSize: size });
            }
            else {
                const recent = lineBuf.slice(-20).join(' | ');
                resolve({ success: false, error: recent || `FFmpeg exited ${code}` });
            }
        });
    });
}
export function cancelFfmpeg(jobId) {
    return renderPool.cancel(jobId);
}
export function cancelAllFfmpeg() {
    renderPool.cancelAll();
}
export function getPoolStatus() {
    return renderPool.status;
}
