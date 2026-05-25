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
    // PowerShell approach (wmic deprecated on Windows 11)
    const output = execSync(
      `powershell -Command "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,FreeSpace | ConvertTo-Csv -NoTypeInformation"`,
      { encoding: 'utf8', windowsHide: true, timeout: 10000 }
    )
    const lines = output.trim().split('\n').slice(1) // skip header
    let best = { drive: 'C', free: 0 }
    for (const line of lines) {
      // CSV format: "DeviceID","FreeSpace"
      const parts = line.replace(/"/g, '').split(',')
      if (parts.length < 2) continue
      const deviceId = parts[0].replace(':', '').trim()
      const free = parseInt(parts[1], 10) || 0
      // Prefer non-C drives; skip removable/fixed network drives without media
      if (deviceId === 'C') {
        if (free > best.free) best = { drive: deviceId, free }
      } else if (free > best.free) {
        best = { drive: deviceId, free }
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

// ─── Project-based subdirectories ───────────────────────────────────────────────
// NEW (2026-05-14): All project data lives in projects/{id}/ folder.
// Channels, downloads, outputs, and archived renders have their own top-level dirs.

/** Root for all 200 GCP project configs, tokens, and stats */
export function getProjectsDir(): string {
  return path.join(getHyperClipBaseDir(), 'projects')
}

/** Root for channel data: list, seen-videos, uploads cache */
export function getChannelsDir(): string {
  return path.join(getHyperClipBaseDir(), 'channels')
}

/** Individual project directory */
export function getProjectDir(projectId: string): string {
  return path.join(getProjectsDir(), projectId)
}

/** Project config file (plain JSON — legacy, auto-migrated to .enc.yaml) */
export function getProjectConfigPath(projectId: string): string {
  return path.join(getProjectDir(projectId), 'config.json')
}

/** Project config file (encrypted YAML — replaces config.json) */
export function getProjectConfigEncPath(projectId: string): string {
  return path.join(getProjectDir(projectId), 'config.enc.yaml')
}

/** Project OAuth token file (plain JSON — legacy, auto-migrated) */
export function getProjectTokenPath(projectId: string): string {
  return path.join(getProjectDir(projectId), 'token.json')
}

/** Project OAuth token file (encrypted YAML) */
export function getProjectTokenEncPath(projectId: string): string {
  return path.join(getProjectDir(projectId), 'token.enc.yaml')
}


/** Project stats file */
export function getProjectStatsPath(projectId: string): string {
  return path.join(getProjectDir(projectId), 'stats.json')
}

/** Channel list file (moved from app/) */
export function getChannelListPath(): string {
  return path.join(getChannelsDir(), 'list.json')
}

/** Seen videos file (moved from app/) */
export function getSeenVideosPath(): string {
  return path.join(getChannelsDir(), 'seen-videos.json')
}

/** Uploads playlist cache (moved from app/) */
export function getUploadsCachePath(): string {
  return path.join(getChannelsDir(), 'uploads-cache.json')
}

// ─── Video storage subdirectories ───────────────────────────────────────────────

export function getDownloadsDir(): string {
  return path.join(getHyperClipBaseDir(), 'downloads')
}

export function getBlurDir(): string {
  return path.join(getHyperClipBaseDir(), 'blur')
}

/** Rendered output (BEFORE archive) */
export function getOutputDir(): string {
  return path.join(getHyperClipBaseDir(), 'output')
}

/** FINAL output — all rendered videos organized by month */
export function getArchivedDir(): string {
  return path.join(getHyperClipBaseDir(), 'archived')
}

/** Monthly archive subdirectory */
export function getArchivedMonthDir(): string {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return path.join(getArchivedDir(), month)
}

/** App-wide logs directory */
export function getLogsDir(): string {
  return path.join(getHyperClipBaseDir(), 'logs')
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
