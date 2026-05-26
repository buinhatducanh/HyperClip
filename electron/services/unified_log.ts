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

import path from 'path'
import fs from 'fs'
import os from 'os'
import { app, BrowserWindow } from 'electron'

// electron-log is CommonJS — use standard require in CJS context
const el: any = require('electron-log')
const _fileLog = el.default ?? el

// ─── Path setup ─────────────────────────────────────────────────────────────────

function getLogBaseDir(): string {
  // Determine log dir: D:\HyperClip-Data\logs
  const HYPERCLIP_BASE = (() => {
    const envBase = process.env.HYPERCLIP_DATA_DIR
    if (envBase) return envBase

    // Try known locations
    for (const drive of ['D', 'E', 'F', 'C']) {
      const base = `${drive}:\\HyperClip-Data`
      if (fs.existsSync(path.join(base, 'app'))) return base
    }

    // Fallback: AppData
    const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(APPDATA, 'HyperClip')
  })()
  return path.join(HYPERCLIP_BASE, 'logs')
}

const LOG_DIR = getLogBaseDir()
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

// ─── Auto-cleanup: delete logs older than N days ────────────────────────────────
const LOG_RETENTION_DAYS = 7

export function cleanupOldLogs(): { deletedCount: number; freedBytes: number } {
  let deletedCount = 0
  let freedBytes = 0
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
  try {
    if (!fs.existsSync(LOG_DIR)) return { deletedCount, freedBytes }
    for (const fname of fs.readdirSync(LOG_DIR)) {
      if (!fname.startsWith('hyperclip')) continue
      const fp = path.join(LOG_DIR, fname)
      const stat = fs.statSync(fp)
      if (stat.mtimeMs < cutoff) {
        freedBytes += stat.size
        fs.unlinkSync(fp)
        deletedCount++
      }
    }
  } catch {}
  return { deletedCount, freedBytes }
}

export function getLogDiskUsage(): { totalBytes: number; fileCount: number; oldestAge: number } {
  let totalBytes = 0
  let fileCount = 0
  let oldestMtime = Date.now()
  try {
    if (!fs.existsSync(LOG_DIR)) return { totalBytes: 0, fileCount: 0, oldestAge: 0 }
    for (const fname of fs.readdirSync(LOG_DIR)) {
      if (!fname.startsWith('hyperclip')) continue
      const fp = path.join(LOG_DIR, fname)
      const stat = fs.statSync(fp)
      totalBytes += stat.size
      fileCount++
      if (stat.mtimeMs < oldestMtime) oldestMtime = stat.mtimeMs
    }
  } catch {}
  return {
    totalBytes,
    fileCount,
    oldestAge: fileCount > 0 ? Date.now() - oldestMtime : 0,
  }
}

// ─── File logger setup (electron-log) ───────────────────────────────────────────

_fileLog.transports.file.resolvePathFn = () => path.join(LOG_DIR, 'hyperclip.log')
_fileLog.transports.file.maxSize = 2 * 1024 * 1024   // 2MB per file
_fileLog.transports.file.archiveLogFn = (n: number) => `hyperclip.${n}.log`
// Format: [2026-05-19 10:23:01] [INFO] [scan    ] message
_fileLog.transports.file.format = '[_y-_m-_d _h:_i:_s] [{level}] [{cat}] {text}'
_fileLog.transports.file.level = 'debug'
_fileLog.transports.console.level = false  // use console.log manually

// ─── Types ──────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'
export type LogCategory = 'scan' | 'download' | 'render' | 'channel' | 'system' | 'auth' | 'general'

export interface LogEntry {
  id: string
  timestamp: number   // Date.now()
  level: LogLevel
  category: LogCategory
  message: string
  detail?: string
}

// ─── In-memory buffer ──────────────────────────────────────────────────────────
// Hot buffer: last N entries for streaming to renderer
// At 100 channels × 5s poll = 1 entry/poll → 1000 entries ≈ 83 min coverage
const MAX_BUFFER = 1000
const _buffer: LogEntry[] = []
let _idCounter = 0

function makeId(): string {
  return `log-${Date.now()}-${_idCounter++}`
}

// ─── Renderer streaming ─────────────────────────────────────────────────────────

const _windows = new Set<BrowserWindow>()
let _streamTimer: ReturnType<typeof setTimeout> | null = null
const STREAM_DEBOUNCE_MS = 500

export function setLogWindow(win: BrowserWindow | null): void {
  if (win === null) {
    _windows.clear()
  } else {
    _windows.add(win)
    // Remove from set when window is closed to prevent memory leak
    win.on('closed', () => {
      _windows.delete(win)
    })
  }
}

function _streamToRenderers(entries: LogEntry[]): void {
  if (_windows.size === 0) return
  if (_streamTimer) return  // debounce: already scheduled

  _streamTimer = setTimeout(() => {
    _streamTimer = null
    const payload = entries.slice(-50)
    for (const win of _windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('log:stream', payload)
      }
    }
  }, STREAM_DEBOUNCE_MS)
}

// ─── Core add function ─────────────────────────────────────────────────────────

function _add(
  level: LogLevel,
  category: LogCategory,
  message: string,
  detail?: string
): LogEntry {
  const entry: LogEntry = {
    id: makeId(),
    timestamp: Date.now(),
    level,
    category,
    message,
    detail,
  }

  // 1. File — structured format for parseable output
  const fileLevel = level === 'success' ? 'info' : level
  const text = detail ? `${message} — ${detail}` : message
  // Pass metadata with names matching electron-log format: [{level}] [{cat}] {text}
  _fileLog.info(text, { level: fileLevel, cat: category })

  // 2. In-memory buffer
  _buffer.push(entry)
  if (_buffer.length > MAX_BUFFER) {
    _buffer.splice(0, _buffer.length - MAX_BUFFER)
  }

  // 3. Stream to renderers
  _streamToRenderers(_buffer)

  // 4. Console (dev only)
  if (process.env.NODE_ENV === 'development' || process.env.DEV_LOG === '1') {
    const prefix = `[${new Date().toLocaleTimeString('en-US', { hour12: false })}]`
    const tag = `[${level.toUpperCase()}]`
    const cat = `[${category}]`
    if (level === 'error') {
      console.error(`${prefix} ${tag} ${cat} ${text}`)
    } else if (level === 'warn') {
      console.warn(`${prefix} ${tag} ${cat} ${text}`)
    } else {
      console.log(`${prefix} ${tag} ${cat} ${text}`)
    }
  }

  return entry
}

// ─── Public API ────────────────────────────────────────────────────────────────

export const unifiedLog = {
  debug: (category: LogCategory, message: string, detail?: string) =>
    _add('debug', category, message, detail),
  info: (category: LogCategory, message: string, detail?: string) =>
    _add('info', category, message, detail),
  warn: (category: LogCategory, message: string, detail?: string) =>
    _add('warn', category, message, detail),
  error: (category: LogCategory, message: string, detail?: string) =>
    _add('error', category, message, detail),
  success: (category: LogCategory, message: string, detail?: string) =>
    _add('success', category, message, detail),
}

// ─── Backward compatibility wrappers ────────────────────────────────────────────

/** Replaces logger.ts — file-based log + console in dev */
export const log = {
  info: (msg: string, ...args: unknown[]) =>
    _fileLog.info(msg, ...args),
  warn: (msg: string, ...args: unknown[]) =>
    _fileLog.warn(msg, ...args),
  error: (msg: string, ...args: unknown[]) =>
    _fileLog.error(msg, ...args),
  debug: (msg: string, ...args: unknown[]) =>
    _fileLog.debug(msg, ...args),
  crash: (reason: string, err?: unknown) => {
    const msg = `[CRASH] ${reason}`
    _fileLog.error(msg, err instanceof Error ? `${err.message}\n${err.stack}` : String(err ?? ''))
    if (process.env.NODE_ENV === 'development') console.error(msg, err)
  },
}

/** Replaces dev_log.ts — silent unless DEV_LOG=1. Writes to both console and persistent log. */
const _devSilent = process.env.DEV_LOG !== '1'
export const devLog = (...a: unknown[]) => {
  if (!_devSilent) {
    const msg = '[DEV] ' + a.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')
    console.log(msg)
    _fileLog.info(msg)
  }
}

/** Replaces operation_log.ts */
export const opLog = {
  info:    (category: string, message: string, detail?: string) =>
    _add('info', category as LogCategory, message, detail),
  warn:    (category: string, message: string, detail?: string) =>
    _add('warn', category as LogCategory, message, detail),
  error:   (category: string, message: string, detail?: string) =>
    _add('error', category as LogCategory, message, detail),
  success: (category: string, message: string, detail?: string) =>
    _add('success', category as LogCategory, message, detail),
}

/** Get all in-memory entries */
export function getLogEntries(): LogEntry[] {
  return _buffer.slice()
}

/** Clear in-memory buffer */
export function clearLogEntries(): void {
  _buffer.length = 0
}

/** Get log directory path */
export function getLogDir(): string {
  return LOG_DIR
}

/** Parse a single log line back into LogEntry format */
function parseLogLine(line: string, idPrefix: string): LogEntry | null {
  if (!line.trim()) return null
  // Format: [Y-M-D H:M:S] [LEVEL] [CAT    ] message
  const match = line.match(/^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\] \[(\w+)\] \[(\w+)\] (.+)$/)
  if (!match) return null
  const [, year, month, day, hour, min, sec, level, cat, rest] = match
  const detailIdx = rest.indexOf(' — ')
  const message = detailIdx >= 0 ? rest.slice(0, detailIdx) : rest
  const detail = detailIdx >= 0 ? rest.slice(detailIdx + 3) : undefined
  return {
    id: `${idPrefix}-${year}${month}${day}${hour}${min}${sec}`,
    timestamp: new Date(+year, +month - 1, +day, +hour, +min, +sec).getTime(),
    level: level.toLowerCase() === 'info' ? 'info' : level.toLowerCase() === 'warn' ? 'warn'
      : level.toLowerCase() === 'error' ? 'error' : level.toLowerCase() === 'debug' ? 'debug' : 'info',
    category: cat.toLowerCase().trim() as LogCategory,
    message,
    detail,
  }
}

/** Read file logs from disk (for logs:read IPC) */
export function readFileLogs(): {
  files: { name: string; size: number; mtime: number; content?: string }[]
  logDir: string
  entries: LogEntry[]
} {
  const MAX_FILE_SIZE = 5 * 1024 * 1024
  // At 100 channels × 5s × 1 entry/poll ≈ 200 bytes → 2MB holds ~10k entries ≈ 14h
  // Parse last 10000 lines = ~5.5h at 100 channels
  const MAX_LINES = 10000
  const files: { name: string; size: number; mtime: number; content?: string }[] = []
  const allEntries: LogEntry[] = []

  try {
    if (fs.existsSync(LOG_DIR)) {
      // Read files newest-first so we can merge and dedupe
      const entries: string[] = []
      for (const fname of fs.readdirSync(LOG_DIR).sort().reverse()) {
        if (!fname.startsWith('hyperclip')) continue
        const fp = path.join(LOG_DIR, fname)
        const stat = fs.statSync(fp)
        files.push({ name: fname, size: stat.size, mtime: stat.mtimeMs })
        if (stat.size > MAX_FILE_SIZE) continue
        const raw = fs.readFileSync(fp, 'utf-8')
        const lines = raw.split('\n')
        // Prepend to collect newest first
        entries.unshift(...lines)
      }
      // Take last N lines total across all files
      const tail = entries.length > MAX_LINES ? entries.slice(-MAX_LINES) : entries
      for (const line of tail) {
        const entry = parseLogLine(line, 'fl')
        if (entry) allEntries.push(entry)
      }
    }
  } catch {}

  return {
    files,
    logDir: LOG_DIR,
    // Also include in-memory buffer entries (most recent, may be newer than disk)
    entries: allEntries,
  }
}

/** System snapshot for bug reports */
export function getSystemSnapshot(): string {
  return [
    `HyperClip Log Snapshot`,
    `Generated: ${new Date().toISOString()}`,
    `Platform: ${process.platform} ${os.arch()}`,
    `Node: ${process.version}`,
    `Electron: ${process.versions.electron}`,
    `App: ${app.getName()} v${app.getVersion()}`,
    `User: ${os.homedir()}`,
    `CPU: ${os.cpus()[0]?.model ?? 'unknown'}`,
    `CPU cores: ${os.cpus().length}`,
    `RAM total: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
    `Uptime: ${Math.round(process.uptime() / 60)} min`,
    `PID: ${process.pid}`,
    `Log dir: ${LOG_DIR}`,
    `In-memory entries: ${_buffer.length}`,
  ].join('\n')
}
