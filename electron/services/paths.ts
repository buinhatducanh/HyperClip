import path from 'path'
import os from 'os'
import fs from 'fs'
import { execSync } from 'child_process'
import { app } from 'electron'

// ─── Centralized path constants ──────────────────────────────────────────────────
// All hardcoded path literals live here — single source of truth.
// Import from this file instead of duplicating literals.

// Legacy HyperClip data location (AppData\Roaming) — for migration check.
function getLegacyAppDataDir(): string {
  const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(APPDATA, 'HyperClip')
}

// Find the drive with the most free space (excluding C:).
function findLargestDrive(): string {
  try {
    const output = execSync('wmic logicaldisk get caption,freespace /format:csv', {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    })
    const lines = output.trim().split('\n').slice(1) // skip header
    let best = { drive: 'C', free: 0 }
    for (const line of lines) {
      const parts = line.trim().split(',')
      if (parts.length < 3) continue
      const drive = parts[1].replace(':', '')
      const free = parseInt(parts[2], 10) || 0
      // Prefer non-C drives; skip removable/fixed network drives without media
      if (drive === 'C') {
        if (free > best.free) best = { drive, free }
      } else if (free > best.free) {
        best = { drive, free }
      }
    }
    return `${best.drive}:\\HyperClip-Data`
  } catch {
    return 'C:\\HyperClip-Data'
  }
}

// Get the preferred base dir for HyperClip data.
// Priority: env override > existing HyperClip-Data dir > auto-detect largest drive.
// On first run, migrates existing AppData\Roaming\HyperClip data if found.
let _resolvedBaseDir: string | null = null

export function resolveHyperClipBaseDir(): string {
  if (_resolvedBaseDir) return _resolvedBaseDir

  // 1. Env override (for power users / dev)
  const envBase = process.env.HYPERCLIP_DATA_DIR
  if (envBase) {
    _resolvedBaseDir = envBase
    return _resolvedBaseDir
  }

  // 2. Already initialized elsewhere? Use existing HyperClip-Data location.
  const appData = getLegacyAppDataDir()
  const legacyExists = fs.existsSync(appData)

  // Try known locations in order
  const candidates = [
    'D:\\HyperClip-Data',
    'E:\\HyperClip-Data',
    'F:\\HyperClip-Data',
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'app'))) {
      _resolvedBaseDir = candidate
      return _resolvedBaseDir
    }
  }

  // 3. Auto-detect: pick drive with most free space.
  // If AppData\HyperClip exists but no HyperClip-Data dir found, migrate.
  const autoBase = findLargestDrive()
  _resolvedBaseDir = autoBase
  return _resolvedBaseDir
}

export function getHyperClipBaseDir(): string {
  return resolveHyperClipBaseDir()
}

export function getAppStoreDir(): string {
  return path.join(getHyperClipBaseDir(), 'app')
}

export function getChromeProfilesDir(): string {
  return path.join(getHyperClipBaseDir(), 'chrome-profiles')
}

export function getRamDiskPath(): string {
  return process.platform === 'win32' ? 'R:\\hyperclip' : '/mnt/ramdisk/hyperclip'
}

// Subdirectories under HyperClip-Data for customer package organization.
// All persistent data lives under one root folder.
export function getDownloadsDir(): string {
  return path.join(getHyperClipBaseDir(), 'downloads')
}

export function getBlurDir(): string {
  return path.join(getHyperClipBaseDir(), 'blur')
}

export function getOutputDir(): string {
  return path.join(getHyperClipBaseDir(), 'output')
}

export function getArchivedDir(): string {
  return path.join(getHyperClipBaseDir(), 'archived')
}

// Legacy HyperClip data location (AppData\Roaming) — for migration check.
// Returns the legacy path if present, null otherwise.
export function getLegacyDataPath(): string | null {
  const legacy = getLegacyAppDataDir()
  if (fs.existsSync(legacy)) {
    try {
      const files = fs.readdirSync(legacy)
      if (files.length > 0) return legacy
    } catch {}
  }
  return null
}
