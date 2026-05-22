"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderPool = exports.WorkerPool = void 0;
exports.getChunkPoolStatus = getChunkPoolStatus;
exports.runFfmpeg = runFfmpeg;
exports.cancelFfmpeg = cancelFfmpeg;
exports.cancelAllFfmpeg = cancelAllFfmpeg;
exports.getPoolStatus = getPoolStatus;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const ffmpeg_paths_js_1 = require("./ffmpeg-paths.js");
const system_js_1 = require("./system.js");
const unified_log_js_1 = require("./unified_log.js");
// Cache validation result — check once at startup
let _ffmpegValidated = false;
class WorkerPool {
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
        const killPromises = [];
        for (const proc of this.active.values()) {
            // On Windows, kill() is asynchronous — wait for exit to ensure FFmpeg is really dead.
            killPromises.push(new Promise(resolve => {
                proc.once('close', resolve);
                proc.kill();
                // Safety fallback: resolve after 500ms even if close event missed.
                setTimeout(resolve, 500);
            }));
        }
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
            void this._run(job.jobId, job.fn).then(job.resolve);
        }
    }
    // Acquire a slot — returns true if slot available, false if queued
    acquire(_jobId) {
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
exports.WorkerPool = WorkerPool;
// Render pool — GPU-aware single-pass worker count.
// Lazy init to avoid circular dependency (renderPool → ffmpeg-paths → system → ramdisk → renderPool)
let _renderPool = null;
let _renderPoolWorkers = 0;
function getRenderPool() {
    if (!_renderPool) {
        const caps = (0, system_js_1.getGPUCapabilities)();
        // Env override: explicit control
        const envMax = parseInt(process.env.HYPERCLIP_MAX_WORKERS || '', 10);
        const maxWorkers = !isNaN(envMax) && envMax > 0 ? envMax : 2;
        _renderPool = new WorkerPool(maxWorkers);
        _renderPoolWorkers = maxWorkers;
        (0, unified_log_js_1.devLog)(`[WorkerPool] Render pool initialized: ${maxWorkers} workers (GPU: ${caps.gpuName}, encoder: ${caps.encoder})`);
    }
    return _renderPool;
}
exports.renderPool = {
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
        const caps = (0, system_js_1.getGPUCapabilities)();
        // Env override: explicit control
        const envMax = parseInt(process.env.HYPERCLIP_MAX_CHUNK_WORKERS || '', 10);
        const envOverride = !isNaN(envMax) && envMax > 0;
        const effective = envOverride ? envMax : Math.min((0, system_js_1.getEffectiveWorkers)(), 4); // cap at 4 max
        _chunkPool = new WorkerPool(effective);
        (0, unified_log_js_1.devLog)(`[WorkerPool] Chunk pool initialized: ${effective} workers (GPU: ${caps.gpuName}, encoder: ${caps.encoder}, base=${caps.maxChunkWorkers})`);
    }
    return _chunkPool;
}
function getChunkPoolStatus() {
    return getChunkPool().status;
}
// Normalize paths to forward slashes for cross-platform FFmpeg compatibility.
function normalizePath(p) {
    return p.replace(/\\/g, '/');
}
async function runFfmpeg(opts) {
    const { jobId, args, outputFile, onProgress, onFps, timeoutMs = 2 * 60 * 60 * 1000 } = opts;
    // Debug: log all args with input indices marked
    const filterIdx = args.indexOf('-filter_complex');
    const filterVal = filterIdx !== -1 ? args[filterIdx + 1] : '(none)';
    const inputs = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-i')
            inputs.push(`  [${inputs.length}]: ${args[i + 1]}`);
    }
    (0, unified_log_js_1.devLog)(`[runFfmpeg] job=${jobId} inputs: ${inputs.join(' | ')}`);
    (0, unified_log_js_1.devLog)(`[runFfmpeg] filter_complex="${filterVal}"`);
    (0, unified_log_js_1.devLog)(`[runFfmpeg] output=${args[args.length - 1]}`);
    return new Promise((resolve) => {
        const t0 = Date.now();
        const ffmpeg = normalizePath((0, ffmpeg_paths_js_1.getFfmpegPath)());
        const normalizedArgs = args.map(a => {
            if (a.startsWith('"'))
                return normalizePath(a.slice(1, a.length - 1));
            return a;
        });
        const proc = (0, child_process_1.spawn)(ffmpeg, normalizedArgs, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        // Register with pool for cancellation support
        exports.renderPool.track(jobId, proc);
        // Startup validation: check FFmpeg actually works (first render only)
        if (!_ffmpegValidated) {
            _ffmpegValidated = true;
            (0, ffmpeg_paths_js_1.validateFfmpeg)(ffmpeg).catch(e => console.warn('[FFmpeg] Validation warning:', e));
        }
        const LINE_BUF_SIZE = 200;
        const lineBuf = [];
        let closed = false; // prevent progress after close
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
            closed = true;
            if (!proc.killed)
                proc.kill();
            exports.renderPool.release(jobId);
            resolve({ success: false, error: 'Timeout' });
        }, timeoutMs);
        proc.stderr?.on('data', (data) => {
            if (closed)
                return;
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
            const timeMatch = recent.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
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
            closed = true;
            clearTimeout(timeout);
            exports.renderPool.release(jobId);
            resolve({ success: false, error: err.message });
        });
        proc.on('close', (code) => {
            if (closed)
                return;
            closed = true;
            clearTimeout(timeout);
            exports.renderPool.release(jobId);
            // Force 100% on close (FFmpeg may not emit final time= line)
            onProgress?.(100, Date.now() - t0);
            const cleanPath = outputFile.replace(/"/g, '');
            if (code === 0 && fs_1.default.existsSync(cleanPath)) {
                let size = 0;
                try {
                    size = fs_1.default.statSync(cleanPath).size;
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
function cancelFfmpeg(jobId) {
    return exports.renderPool.cancel(jobId);
}
function cancelAllFfmpeg() {
    exports.renderPool.cancelAll();
}
function getPoolStatus() {
    return exports.renderPool.status;
}
