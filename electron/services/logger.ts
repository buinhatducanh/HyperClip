/**
 * HyperClip Logger Service
 *
 * File-based logging with rotation (5MB per file, keep 5).
 * Also captures renderer errors via IPC.
 *
 * Usage: import { log } from './services/logger.js'
 *   log.info('message')
 *   log.warn('message')
 *   log.error('message', error)
 *   log.crash('crash reason', error)
 */

import path from 'path'
import fs from 'fs'
import os from 'os'
import { app } from 'electron'
import { createRequire } from 'module'
import { getAppStoreDir } from './paths.js'

// electron-log is CommonJS — use createRequire for ESM compatibility
const require = createRequire(import.meta.url)

// eslint-disable-next-line @typescript-eslint/no-var-requires
const el: any = require('electron-log')
const _log = el.default ?? el

// Configure file transport
const logDir = getLogDir()
_log.transports.file.resolvePathFn = () => path.join(logDir, 'hyperclip.log')
_log.transports.file.maxSize = 2 * 1024 * 1024  // 2MB per file
_log.transports.file.archiveLogFn = (n: number) => `hyperclip.${n}.log`
_log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'
_log.transports.file.level = 'debug'
_log.transports.console.level = false  // we use console.log directly in dev

export function getLogDir(): string {
  const dir = path.join(getAppStoreDir(), 'logs')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Convenience wrappers matching console API
export const log = {
  info: (msg: string, ...args: unknown[]) => {
    _log.info(msg, ...args)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[LOG] ${msg}`, ...args)
    }
  },
  warn: (msg: string, ...args: unknown[]) => {
    _log.warn(msg, ...args)
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[WARN] ${msg}`, ...args)
    }
  },
  error: (msg: string, ...args: unknown[]) => {
    _log.error(msg, ...args)
    if (process.env.NODE_ENV === 'development') {
      console.error(`[ERROR] ${msg}`, ...args)
    }
  },
  debug: (msg: string, ...args: unknown[]) => {
    _log.debug(msg, ...args)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG] ${msg}`, ...args)
    }
  },
  crash: (reason: string, err?: unknown) => {
    const msg = `[CRASH] ${reason}`
    _log.error(msg, err instanceof Error ? `${err.message}\n${err.stack}` : String(err ?? ''))
    if (process.env.NODE_ENV === 'development') {
      console.error(msg, err)
    }
  },
}

// Log system snapshot — useful for bug reports
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
    `Uptime: ${Math.round(os.uptime() / 60)} min`,
    `PID: ${process.pid}`,
    `Log dir: ${getLogDir()}`,
  ].join('\n')
}