"use strict";
/**
 * HyperClip Unified Log Service
 *
 * Single entry point for ALL logging in the app — replaces dev_log.ts, operation_log.ts, logger.ts.
 *
 * Architecture:
 *   unifiedLog.info/warn/error/success(category, message, detail?)
 *        │
 *        ├──► File (electron-log, rotation 2MB × 3 files)
 *        ├──► In-memory buffer (max 200 entries, FIFO eviction)
 *        └──► Renderer streaming (last 50 entries via webContents.send)
 *
 * Performance:
 *   - File writes are async (non-blocking)
 *   - Streaming uses debounce: max 1 emit per 500ms per window
 *   - Level filter prevents log spam in UI
 *
 * Backward compat:
 *   - export const log = { info, warn, error, crash }  ← replaces logger.ts
 *   - export const devLog = (...)                     ← replaces dev_log.ts
 *   - export const opLog = { info, warn, error, success }  ← replaces operation_log.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.opLog = exports.devLog = exports.log = exports.unifiedLog = void 0;
exports.cleanupOldLogs = cleanupOldLogs;
exports.getLogDiskUsage = getLogDiskUsage;
exports.setLogWindow = setLogWindow;
exports.getLogEntries = getLogEntries;
exports.clearLogEntries = clearLogEntries;
exports.getLogDir = getLogDir;
exports.readFileLogs = readFileLogs;
exports.getSystemSnapshot = getSystemSnapshot;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const electron_1 = require("electron");
// electron-log is CommonJS — use standard require in CJS context
const el = require('electron-log');
const _fileLog = el.default ?? el;
// ─── Path setup ─────────────────────────────────────────────────────────────────
function getLogBaseDir() {
    // Determine log dir: D:\HyperClip-Data\logs
    const HYPERCLIP_BASE = (() => {
        const envBase = process.env.HYPERCLIP_DATA_DIR;
        if (envBase)
            return envBase;
        // Try known locations
        for (const drive of ['D', 'E', 'F', 'C']) {
            const base = `${drive}:\\HyperClip-Data`;
            if (fs_1.default.existsSync(path_1.default.join(base, 'app')))
                return base;
        }
        // Fallback: AppData
        const APPDATA = process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming');
        return path_1.default.join(APPDATA, 'HyperClip');
    })();
    return path_1.default.join(HYPERCLIP_BASE, 'logs');
}
const LOG_DIR = getLogBaseDir();
if (!fs_1.default.existsSync(LOG_DIR))
    fs_1.default.mkdirSync(LOG_DIR, { recursive: true });
// ─── Auto-cleanup: delete logs older than N days ────────────────────────────────
const LOG_RETENTION_DAYS = 7;
function cleanupOldLogs() {
    let deletedCount = 0;
    let freedBytes = 0;
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    try {
        if (!fs_1.default.existsSync(LOG_DIR))
            return { deletedCount, freedBytes };
        for (const fname of fs_1.default.readdirSync(LOG_DIR)) {
            if (!fname.startsWith('hyperclip'))
                continue;
            const fp = path_1.default.join(LOG_DIR, fname);
            const stat = fs_1.default.statSync(fp);
            if (stat.mtimeMs < cutoff) {
                freedBytes += stat.size;
                fs_1.default.unlinkSync(fp);
                deletedCount++;
            }
        }
    }
    catch { }
    return { deletedCount, freedBytes };
}
function getLogDiskUsage() {
    let totalBytes = 0;
    let fileCount = 0;
    let oldestMtime = Date.now();
    try {
        if (!fs_1.default.existsSync(LOG_DIR))
            return { totalBytes: 0, fileCount: 0, oldestAge: 0 };
        for (const fname of fs_1.default.readdirSync(LOG_DIR)) {
            if (!fname.startsWith('hyperclip'))
                continue;
            const fp = path_1.default.join(LOG_DIR, fname);
            const stat = fs_1.default.statSync(fp);
            totalBytes += stat.size;
            fileCount++;
            if (stat.mtimeMs < oldestMtime)
                oldestMtime = stat.mtimeMs;
        }
    }
    catch { }
    return {
        totalBytes,
        fileCount,
        oldestAge: fileCount > 0 ? Date.now() - oldestMtime : 0,
    };
}
// ─── File logger setup (electron-log) ───────────────────────────────────────────
_fileLog.transports.file.resolvePathFn = () => path_1.default.join(LOG_DIR, 'hyperclip.log');
_fileLog.transports.file.maxSize = 2 * 1024 * 1024; // 2MB per file
_fileLog.transports.file.archiveLogFn = (n) => `hyperclip.${n}.log`;
// Format: [2026-05-19 10:23:01] [INFO] [scan    ] message
_fileLog.transports.file.format = '[_y-_m-_d _h:_i:_s] [{level}] [{cat}] {text}';
_fileLog.transports.file.level = 'debug';
_fileLog.transports.console.level = false; // use console.log manually
// ─── In-memory buffer ──────────────────────────────────────────────────────────
// Hot buffer: last N entries for streaming to renderer
// At 100 channels × 5s poll = 1 entry/poll → 1000 entries ≈ 83 min coverage
const MAX_BUFFER = 1000;
const _buffer = [];
let _idCounter = 0;
function makeId() {
    return `log-${Date.now()}-${_idCounter++}`;
}
// ─── Renderer streaming ─────────────────────────────────────────────────────────
const _windows = new Set();
let _streamTimer = null;
const STREAM_DEBOUNCE_MS = 500;
function setLogWindow(win) {
    if (win === null) {
        _windows.clear();
    }
    else {
        _windows.add(win);
        // Remove from set when window is closed to prevent memory leak
        win.on('closed', () => {
            _windows.delete(win);
        });
    }
}
function _streamToRenderers(entries) {
    if (_windows.size === 0)
        return;
    if (_streamTimer)
        return; // debounce: already scheduled
    _streamTimer = setTimeout(() => {
        _streamTimer = null;
        const payload = entries.slice(-50);
        for (const win of _windows) {
            if (!win.isDestroyed()) {
                win.webContents.send('log:stream', payload);
            }
        }
    }, STREAM_DEBOUNCE_MS);
}
// ─── Core add function ─────────────────────────────────────────────────────────
function _add(level, category, message, detail) {
    const entry = {
        id: makeId(),
        timestamp: Date.now(),
        level,
        category,
        message,
        detail,
    };
    // 1. File — structured format for parseable output
    const fileLevel = level === 'success' ? 'info' : level;
    const text = detail ? `${message} — ${detail}` : message;
    // Pass metadata with names matching electron-log format: [{level}] [{cat}] {text}
    _fileLog.info(text, { level: fileLevel, cat: category });
    // 2. In-memory buffer
    _buffer.push(entry);
    if (_buffer.length > MAX_BUFFER) {
        _buffer.splice(0, _buffer.length - MAX_BUFFER);
    }
    // 3. Stream to renderers
    _streamToRenderers(_buffer);
    // 4. Console (dev only)
    if (process.env.NODE_ENV === 'development' || process.env.DEV_LOG === '1') {
        const prefix = `[${new Date().toLocaleTimeString('en-US', { hour12: false })}]`;
        const tag = `[${level.toUpperCase()}]`;
        const cat = `[${category}]`;
        if (level === 'error') {
            console.error(`${prefix} ${tag} ${cat} ${text}`);
        }
        else if (level === 'warn') {
            console.warn(`${prefix} ${tag} ${cat} ${text}`);
        }
        else {
            console.log(`${prefix} ${tag} ${cat} ${text}`);
        }
    }
    return entry;
}
// ─── Public API ────────────────────────────────────────────────────────────────
exports.unifiedLog = {
    debug: (category, message, detail) => _add('debug', category, message, detail),
    info: (category, message, detail) => _add('info', category, message, detail),
    warn: (category, message, detail) => _add('warn', category, message, detail),
    error: (category, message, detail) => _add('error', category, message, detail),
    success: (category, message, detail) => _add('success', category, message, detail),
};
// ─── Backward compatibility wrappers ────────────────────────────────────────────
/** Replaces logger.ts — file-based log + console in dev */
exports.log = {
    info: (msg, ...args) => _fileLog.info(msg, ...args),
    warn: (msg, ...args) => _fileLog.warn(msg, ...args),
    error: (msg, ...args) => _fileLog.error(msg, ...args),
    debug: (msg, ...args) => _fileLog.debug(msg, ...args),
    crash: (reason, err) => {
        const msg = `[CRASH] ${reason}`;
        _fileLog.error(msg, err instanceof Error ? `${err.message}\n${err.stack}` : String(err ?? ''));
        if (process.env.NODE_ENV === 'development')
            console.error(msg, err);
    },
};
/** Replaces dev_log.ts — silent unless DEV_LOG=1 */
const _devSilent = process.env.DEV_LOG !== '1';
const devLog = (...a) => {
    if (!_devSilent)
        console.log('[DEV]', ...a);
};
exports.devLog = devLog;
/** Replaces operation_log.ts */
exports.opLog = {
    info: (category, message, detail) => _add('info', category, message, detail),
    warn: (category, message, detail) => _add('warn', category, message, detail),
    error: (category, message, detail) => _add('error', category, message, detail),
    success: (category, message, detail) => _add('success', category, message, detail),
};
/** Get all in-memory entries */
function getLogEntries() {
    return _buffer.slice();
}
/** Clear in-memory buffer */
function clearLogEntries() {
    _buffer.length = 0;
}
/** Get log directory path */
function getLogDir() {
    return LOG_DIR;
}
/** Parse a single log line back into LogEntry format */
function parseLogLine(line, idPrefix) {
    if (!line.trim())
        return null;
    // Format: [Y-M-D H:M:S] [LEVEL] [CAT    ] message
    const match = line.match(/^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\] \[(\w+)\] \[(\w+)\] (.+)$/);
    if (!match)
        return null;
    const [, year, month, day, hour, min, sec, level, cat, rest] = match;
    const detailIdx = rest.indexOf(' — ');
    const message = detailIdx >= 0 ? rest.slice(0, detailIdx) : rest;
    const detail = detailIdx >= 0 ? rest.slice(detailIdx + 3) : undefined;
    return {
        id: `${idPrefix}-${year}${month}${day}${hour}${min}${sec}`,
        timestamp: new Date(+year, +month - 1, +day, +hour, +min, +sec).getTime(),
        level: level.toLowerCase() === 'info' ? 'info' : level.toLowerCase() === 'warn' ? 'warn'
            : level.toLowerCase() === 'error' ? 'error' : level.toLowerCase() === 'debug' ? 'debug' : 'info',
        category: cat.toLowerCase().trim(),
        message,
        detail,
    };
}
/** Read file logs from disk (for logs:read IPC) */
function readFileLogs() {
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    // At 100 channels × 5s × 1 entry/poll ≈ 200 bytes → 2MB holds ~10k entries ≈ 14h
    // Parse last 10000 lines = ~5.5h at 100 channels
    const MAX_LINES = 10000;
    const files = [];
    const allEntries = [];
    try {
        if (fs_1.default.existsSync(LOG_DIR)) {
            // Read files newest-first so we can merge and dedupe
            const entries = [];
            for (const fname of fs_1.default.readdirSync(LOG_DIR).sort().reverse()) {
                if (!fname.startsWith('hyperclip'))
                    continue;
                const fp = path_1.default.join(LOG_DIR, fname);
                const stat = fs_1.default.statSync(fp);
                files.push({ name: fname, size: stat.size, mtime: stat.mtimeMs });
                if (stat.size > MAX_FILE_SIZE)
                    continue;
                const raw = fs_1.default.readFileSync(fp, 'utf-8');
                const lines = raw.split('\n');
                // Prepend to collect newest first
                entries.unshift(...lines);
            }
            // Take last N lines total across all files
            const tail = entries.length > MAX_LINES ? entries.slice(-MAX_LINES) : entries;
            for (const line of tail) {
                const entry = parseLogLine(line, 'fl');
                if (entry)
                    allEntries.push(entry);
            }
        }
    }
    catch { }
    return {
        files,
        logDir: LOG_DIR,
        // Also include in-memory buffer entries (most recent, may be newer than disk)
        entries: allEntries,
    };
}
/** System snapshot for bug reports */
function getSystemSnapshot() {
    return [
        `HyperClip Log Snapshot`,
        `Generated: ${new Date().toISOString()}`,
        `Platform: ${process.platform} ${os_1.default.arch()}`,
        `Node: ${process.version}`,
        `Electron: ${process.versions.electron}`,
        `App: ${electron_1.app.getName()} v${electron_1.app.getVersion()}`,
        `User: ${os_1.default.homedir()}`,
        `CPU: ${os_1.default.cpus()[0]?.model ?? 'unknown'}`,
        `CPU cores: ${os_1.default.cpus().length}`,
        `RAM total: ${Math.round(os_1.default.totalmem() / 1024 / 1024 / 1024)} GB`,
        `Uptime: ${Math.round(process.uptime() / 60)} min`,
        `PID: ${process.pid}`,
        `Log dir: ${LOG_DIR}`,
        `In-memory entries: ${_buffer.length}`,
    ].join('\n');
}
