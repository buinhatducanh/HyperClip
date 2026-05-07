import path from 'path'
import os from 'os'
import { app } from 'electron'

// ─── Centralized path constants ──────────────────────────────────────────────────
// All hardcoded path literals live here — single source of truth.
// Import from this file instead of duplicating literals.

export function getAppStoreDir(): string {
  if (app && app.isReady() && app.getPath) {
    return app.getPath('userData')
  }
  const APPDATA = process.env.APPDATA || os.homedir()
  return path.join(APPDATA, 'HyperClip')
}

export function getRamDiskPath(): string {
  return process.platform === 'win32' ? 'R:\\hyperclip' : '/mnt/ramdisk/hyperclip'
}
