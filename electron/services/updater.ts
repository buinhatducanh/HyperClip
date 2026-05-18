/**
 * HyperClip Auto-Update Service — Electron main process.
 *
 * Uses electron-updater to:
 *  - Check for updates on startup + every 6 hours
 *  - Auto-download in background
 *  - Notify user of available updates
 *  - Apply update on app restart
 *
 * The update server (license-server or separate CDN) serves:
 *   GET /updates/manifest.json   — electron-updater compatible manifest
 *   GET /updates/HyperClip-{version}-full.zip
 *   GET /updates/HyperClip-{from}-to-{to}.zip  (differential)
 *
 * NOTE: electron-updater must be installed: pnpm add electron-updater
 *       (suppress TS errors until installed — module lives in .pnpm/ virtual store)
 */
// @ts-nocheck
import { app } from 'electron'
import { log } from './logger.js'

// electron-updater is a production dependency — install via: pnpm add electron-updater
// Uses dynamic import with type suppression since module lives in .pnpm/ virtual store
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// @ts-ignore
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000  // 6 hours
let _autoUpdater: any = null
let _updateAvailable = false
let _latestVersion: string | null = null
let _downloadProgress = 0
let _checkingTimer: ReturnType<typeof setInterval> | null = null
let _initialized = false

async function getAutoUpdater() {
  if (_autoUpdater) return _autoUpdater
  try {
    const mod = await import('electron-updater')
    _autoUpdater = mod.autoUpdater
    return _autoUpdater
  } catch {
    log.warn('[AutoUpdater] electron-updater not available — auto-update disabled')
    return null
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────
export async function initAutoUpdater(): Promise<void> {
  const autoUpdater = await getAutoUpdater()
  if (!autoUpdater) return

  // Configure auto-updater
  autoUpdater.autoDownload = false    // User-triggered download
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableWebInstaller = false

  // Events
  autoUpdater.on('checking-for-update', () => {
    log.info('[AutoUpdater] Checking for updates...')
  })

  autoUpdater.on('update-available', (info: any) => {
    _updateAvailable = true
    _latestVersion = info.version
    log.info(`[AutoUpdater] Update available: v${info.version}`)
    sendUpdateEvent('available', { version: info.version, releaseNotes: info.releaseNotes })
  })

  autoUpdater.on('update-not-available', (info: any) => {
    log.info(`[AutoUpdater] No update available (current: ${app.getVersion()})`)
  })

  autoUpdater.on('download-progress', (progress: any) => {
    _downloadProgress = Math.round(progress.percent)
    sendUpdateEvent('progress', {
      percent: _downloadProgress,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info: any) => {
    log.info(`[AutoUpdater] Update downloaded: v${info.version}`)
    _downloadProgress = 100
    sendUpdateEvent('downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err: any) => {
    log.warn(`[AutoUpdater] Error: ${err?.message}`)
  })

  // Periodic check every 6 hours
  _checkingTimer = setInterval(async () => {
    await checkForUpdates()
  }, UPDATE_CHECK_INTERVAL_MS)

  _initialized = true
  log.info('[AutoUpdater] Initialized')
}

// ─── Check & download ─────────────────────────────────────────────────────────
export async function checkForUpdates(): Promise<{ available: boolean; version?: string }> {
  const autoUpdater = await getAutoUpdater()
  if (!autoUpdater) return { available: false }

  try {
    const result = await autoUpdater.checkForUpdates()
    if (result?.updateInfo) {
      return { available: true, version: result.updateInfo.version }
    }
    return { available: false }
  } catch (err: any) {
    log.warn(`[AutoUpdater] Check failed: ${err?.message}`)
    return { available: false }
  }
}

export async function downloadUpdate(): Promise<boolean> {
  const autoUpdater = await getAutoUpdater()
  if (!autoUpdater) return false

  try {
    await autoUpdater.downloadUpdate()
    return true
  } catch (err: any) {
    log.warn(`[AutoUpdater] Download failed: ${err?.message}`)
    return false
  }
}

export function installUpdate(): void {
  if (_autoUpdater) {
    _autoUpdater.quitAndInstall(false, true)  // installNow=false, forceRunAfter=true
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────
export function getUpdateStatus(): { available: boolean; version?: string; progress: number } {
  return { available: _updateAvailable, version: _latestVersion ?? undefined, progress: _downloadProgress }
}

// ─── IPC bridge (called from main.ts renderer event handler) ──────────────────
export type UpdateEventType = 'available' | 'progress' | 'downloaded'

let _updateEventHandler: ((type: UpdateEventType, data: any) => void) | null = null

export function setUpdateEventHandler(handler: (type: UpdateEventType, data: any) => void): void {
  _updateEventHandler = handler
}

function sendUpdateEvent(type: UpdateEventType, data: any): void {
  if (_updateEventHandler) {
    _updateEventHandler(type, data)
  }
}

export function stopAutoUpdater(): void {
  if (_checkingTimer) {
    clearInterval(_checkingTimer)
    _checkingTimer = null
  }
}
