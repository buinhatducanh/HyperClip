/**
 * Session + Logs IPC handlers.
 * Channels: SESSION_LIST, SESSION_REFRESH_ALL, SESSION_OPEN_LOGIN, SESSION_CLONE_ONE,
 *   logs:read, logs:export
 */

import type { IpcMain, BrowserWindow } from 'electron'
import { shell, dialog } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execSync } from 'child_process'
import { IPC_CHANNELS } from '../channels.js'
import { getSessionManager } from '../../services/chrome_cookies.js'
import { authEvents } from '../../services/cookie_manager.js'
import { runDiagnostics } from '../../services/diagnostics.js'
import { loadSettings } from '../../services/ramdisk.js'
import { getLogDir, getSystemSnapshot, getLogEntries, readFileLogs, getLogDiskUsage, cleanupOldLogs } from '../../services/unified_log.js'

export function registerSessionHandlers(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
    const sm = getSessionManager()
    // Return current state immediately — do NOT await ensureInit() which blocks
    // for 15+ seconds while loading 30 Chrome profile cookies via DPAPI.
    // The frontend handles missing data gracefully with its own 8s timeout.
    return sm.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_REFRESH_ALL, async () => {
    const sm = getSessionManager()
    const count = await sm.refreshAll()
    return { success: true, refreshedCount: count }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_OPEN_LOGIN, async (_, profileId: string) => {
    try {
      const sm = getSessionManager()
      const cookiesExtracted = await sm.openLoginWindow(profileId)
      return { success: true, cookiesExtracted }
    } catch (e) {
      console.error('[SessionHandler] SESSION_OPEN_LOGIN failed:', e)
      return { success: false, cookiesExtracted: false, error: String(e) }
    }
  })

  // ── Chrome Login (replaces OAuth flow on LoginScreen) ─────────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_CHROME_START, async () => {
    try {
      const sm = getSessionManager()
      const { getCookieManager } = await import('../../services/cookie_manager.js')
      const sessions = sm.getSessions()
      const targetId = sessions.length > 0
        ? sessions[0].profileId
        : 'Profile 1'
      const cookiesExtracted = await sm.openLoginWindow(targetId)
      const status = getCookieManager().getAuthStatus()
      authEvents.emit('authUpdated', status)
      return { success: cookiesExtracted, profileId: targetId }
    } catch (e) {
      console.error('[SessionHandler] AUTH_CHROME_START failed:', e)
      return { success: false, profileId: '', error: String(e) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_CLONE_ONE, async () => {
    const sm = getSessionManager()
    return sm.cloneSessionOne()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_ADD, async () => {
    const sm = getSessionManager()
    return sm.addSession()
  })

  // ─── Log Export ─────────────────────────────────────────────────────────────

  ipcMain.handle('logs:read', async () => {
    return readFileLogs()
  })

  ipcMain.handle('logs:disk-usage', async () => {
    return getLogDiskUsage()
  })

  ipcMain.handle('logs:cleanup', async () => {
    return cleanupOldLogs()
  })

  ipcMain.handle('logs:export', async () => {
    const logDir = getLogDir()
    const tmpDir = path.join(os.tmpdir(), 'hyperclip-logs-' + Date.now())
    fs.mkdirSync(tmpDir, { recursive: true })

    // System snapshot
    fs.writeFileSync(path.join(tmpDir, 'system_info.txt'), getSystemSnapshot())

    // Log files
    try {
      for (const fname of fs.readdirSync(logDir)) {
        if (!fname.startsWith('hyperclip')) continue
        fs.copyFileSync(path.join(logDir, fname), path.join(tmpDir, fname))
      }
    } catch {}

    // Crash dumps
    const { app: electronApp } = await import('electron')
    const crashDir = path.join(electronApp.getPath('crashDumps'))
    if (fs.existsSync(crashDir)) {
      try {
        fs.mkdirSync(path.join(tmpDir, 'crash_dumps'), { recursive: true })
        for (const fname of fs.readdirSync(crashDir)) {
          if (fname.endsWith('.dmp') || fname.endsWith('.mdmp')) {
            fs.copyFileSync(path.join(crashDir, fname), path.join(tmpDir, 'crash_dumps', fname))
          }
        }
      } catch {}
    }

    // Diagnostics
    try {
      const diag = await runDiagnostics()
      fs.writeFileSync(path.join(tmpDir, 'diagnostics.json'), JSON.stringify(diag, null, 2))
    } catch {}

    // Settings
    try {
      const settings = loadSettings()
      fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify(settings, null, 2))
    } catch {}

    // Save as zip
    const zipPath = path.join(os.tmpdir(), `hyperclip-logs-${new Date().toISOString().slice(0, 10)}.zip`)
    const mainWindow = getMainWindow()
    const saveResult = await dialog.showSaveDialog(mainWindow!, {
      title: 'Lưu file log',
      defaultPath: zipPath,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    })
    if (saveResult.canceled || !saveResult.filePath) return { success: false }

    try {
      execSync(`powershell -Command "Compress-Archive -Path '${tmpDir}\\*' -DestinationPath '${saveResult.filePath}' -Force"`, { stdio: 'ignore' })
      fs.rmSync(tmpDir, { recursive: true, force: true })
      shell.showItemInFolder(saveResult.filePath)
      return { success: true, path: saveResult.filePath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}
