/**
 * HyperClip GitHub-Based Auto-Update Service
 *
 * Flow:
 *   1. checkForUpdates() → GET GitHub Releases API → compare version
 *   2. downloadUpdate()  → download portable zip → extract to temp dir
 *   3. installUpdate()   → write batch script → launch it → quit app
 *      Batch script: wait for app exit → swap files → relaunch
 *
 * GitHub Actions release assets:
 *   - HyperClip-portable-{version}.zip  (portable folder zip)
 *
 * Config (env vars / package.json):
 *   UPDATE_REPO: "owner/repo"        (default: from package.json)
 *   GH_TOKEN:    GitHub PAT (optional for public repos)
 *
 * Version comparison: semver (v prefix stripped)
 */

import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import { createWriteStream, promises as fp } from 'fs'
import { pipeline } from 'stream/promises'
import os from 'os'
import { spawn } from 'child_process'
import { devLog, opLog } from './unified_log.js'
import { stopYouTubePoller } from './youtube_poller.js'
import { cancelAllFfmpeg } from './worker-pool.js'
import { cancelAllChunked } from './ffmpeg.js'

// ─── Config ───────────────────────────────────────────────────────────────────────

interface UpdateConfig {
  repo: string        // "owner/repo"
  currentVersion: string
  token: string | null
}

function getConfig(): UpdateConfig {
  // UPDATE_REPO env var overrides default
  const repo = process.env.UPDATE_REPO || 'buinhatducanh/HyperClip'
  const token = process.env.GH_TOKEN || null
  const currentVersion = app.getVersion() || '0.0.0'
  return { repo, currentVersion, token }
}

// ─── Types ───────────────────────────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string
  name: string
  body: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; browser_download_url: string; size: number }[]
  published_at: string
}

interface UpdateInfo {
  available: boolean
  version: string
  releaseNotes: string
  downloadUrl: string | null
  downloadSize: number
  publishedAt: string
}

interface DownloadProgress {
  percent: number
  transferred: number
  total: number
}

type UpdateEventType = 'checking' | 'available' | 'not-available' | 'progress' | 'downloaded' | 'error'

// ─── Version comparison ──────────────────────────────────────────────────────────

function compareVersions(current: string, latest: string): number {
  const norm = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const a = norm(current)
  const b = norm(latest)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const na = a[i] ?? 0
    const nb = b[i] ?? 0
    if (nb > na) return 1
    if (nb < na) return -1
  }
  return 0
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────────

function httpGet(url: string, token: string | null): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https')
    const mod = isHttps ? https : http

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HyperClip-Updater',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const req = mod.get(url, { headers }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => { resolve({ statusCode: res.statusCode ?? 0, body }) })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('HTTP timeout')) })
  })
}

async function downloadFile(
  url: string,
  destPath: string,
  token: string | null,
  onProgress: (p: DownloadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https')
    const mod = isHttps ? https : http

    const headers: Record<string, string> = {
      'Accept': 'application/octet-stream',
      'User-Agent': 'HyperClip-Updater',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const req = mod.get(url, { headers }, async (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        const redirectUrl = res.headers.location
        if (redirectUrl) {
          await downloadFile(redirectUrl, destPath, token, onProgress)
          resolve()
          return
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`))
        return
      }

      const contentLength = parseInt(res.headers['content-length'] || '0', 10)
      let transferred = 0

      const file = createWriteStream(destPath)
      res.on('data', (chunk: Buffer) => {
        transferred += chunk.length
        if (contentLength > 0) {
          onProgress({ percent: Math.round((transferred / contentLength) * 100), transferred, total: contentLength })
        }
      })
      res.on('error', reject)
      res.on('end', () => { file.close(); resolve() })

      try {
        await pipeline(res, file)
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Download timeout')) })
  })
}

// ─── State ───────────────────────────────────────────────────────────────────────

let _updateInfo: UpdateInfo | null = null
let _downloadedPath: string | null = null
let _eventHandler: ((type: UpdateEventType, data?: unknown) => void) | null = null
let _checkTimer: ReturnType<typeof setInterval> | null = null

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000  // 6 hours

function emit(type: UpdateEventType, data?: unknown): void {
  if (_eventHandler) _eventHandler(type, data)
}

// ─── Core update functions ───────────────────────────────────────────────────────

export async function checkForUpdates(): Promise<UpdateInfo> {
  const cfg = getConfig()
  devLog(`[GitHubUpdater] Checking for updates: repo=${cfg.repo}, current=${cfg.currentVersion}`)

  emit('checking')

  try {
    const url = `https://api.github.com/repos/${cfg.repo}/releases/latest`
    const { statusCode, body } = await httpGet(url, cfg.token)

    if (statusCode === 404) {
      devLog('[GitHubUpdater] No releases found')
      emit('not-available')
      return { available: false, version: '', releaseNotes: '', downloadUrl: null, downloadSize: 0, publishedAt: '' }
    }

    if (statusCode !== 200) {
      throw new Error(`GitHub API returned ${statusCode}`)
    }

    const release: GitHubRelease = JSON.parse(body)
    const latestVersion = release.tag_name.replace(/^v/, '')
    const isNewer = compareVersions(cfg.currentVersion, latestVersion) < 0

    devLog(`[GitHubUpdater] Latest release: ${release.tag_name}, newer: ${isNewer}`)

    if (!isNewer) {
      emit('not-available')
      return { available: false, version: latestVersion, releaseNotes: '', downloadUrl: null, downloadSize: 0, publishedAt: '' }
    }

    // Find portable zip asset
    const portableAsset = release.assets.find(a => a.name.endsWith('.zip'))
    if (!portableAsset) {
      devLog('[GitHubUpdater] No portable zip asset found in release')
      emit('error', { message: 'No portable zip in release' })
      return { available: false, version: latestVersion, releaseNotes: release.body || '', downloadUrl: null, downloadSize: 0, publishedAt: '' }
    }

    const info: UpdateInfo = {
      available: true,
      version: latestVersion,
      releaseNotes: release.body || '',
      downloadUrl: portableAsset.browser_download_url,
      downloadSize: portableAsset.size,
      publishedAt: release.published_at,
    }

    _updateInfo = info
    emit('available', { version: latestVersion, releaseNotes: release.body, downloadSize: portableAsset.size, publishedAt: release.published_at })
    return info
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    devLog(`[GitHubUpdater] Check failed: ${msg}`)
    emit('error', { message: msg })
    return { available: false, version: '', releaseNotes: '', downloadUrl: null, downloadSize: 0, publishedAt: '' }
  }
}

export async function downloadUpdate(onProgress?: (p: DownloadProgress) => void): Promise<boolean> {
  if (!_updateInfo?.available || !_updateInfo.downloadUrl) {
    devLog('[GitHubUpdater] No update available to download')
    return false
  }

  const cfg = getConfig()
  const tmpDir = path.join(os.tmpdir(), `hyperclip-update-${Date.now()}`)
  const zipPath = path.join(tmpDir, 'update.zip')

  try {
    devLog(`[GitHubUpdater] Downloading ${_updateInfo.downloadUrl} (${Math.round(_updateInfo.downloadSize / 1024 / 1024)} MB)`)
    await fp.mkdir(tmpDir, { recursive: true })

    await downloadFile(_updateInfo.downloadUrl, zipPath, cfg.token, (p) => {
      emit('progress', p)
      onProgress?.(p)
    })

    _downloadedPath = tmpDir
    devLog(`[GitHubUpdater] Downloaded to ${zipPath}`)
    emit('downloaded', { path: tmpDir })
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    devLog(`[GitHubUpdater] Download failed: ${msg}`)
    emit('error', { message: msg })
    return false
  }
}

export function installUpdate(): boolean {
  if (!_downloadedPath) {
    devLog('[GitHubUpdater] No downloaded update to install')
    return false
  }

  // STOP ALL ACTIVE PROCESSES IMMEDIATELY — don't wait for app quit
  devLog('[GitHubUpdater] Stopping poller, renders, FFmpeg before update...')
  stopYouTubePoller()
  cancelAllChunked()
  cancelAllFfmpeg()

  const tmpDir = _downloadedPath
  const zipPath = path.join(tmpDir, 'update.zip')
  const batchPath = path.join(tmpDir, 'update.bat')
  const appPath = app.getAppPath()
  const exePath = process.execPath
  const appArgs = process.argv.slice(1)

  // Determine the extracted folder name
  // The zip contains "HyperClip-win32-x64/" or similar
  const zipName = _updateInfo?.downloadUrl?.split('/').pop()?.replace('.zip', '') || 'HyperClip'
  const extractedDir = path.join(tmpDir, zipName)

  // Write batch script that:
  // 1. Waits for the app to exit
  // 2. Extracts the zip
  // 3. Copies new files over old ones
  // 4. Relaunches the app
  const batchContent = [
    '@echo off',
    'setlocal enabledelayedexpansion',
    '',
    'echo [HyperClip] Dang cap nhat...',
    '',
    `set "TMPDIR=${tmpDir.replace(/\\/g, '\\\\')}"`,
    `set "ZIP=${zipPath.replace(/\\/g, '\\\\')}"`,
    `set "APPDIR=${appPath.replace(/\\/g, '\\\\')}"`,
    `set "EXE=${exePath.replace(/\\/g, '\\\\')}"`,
    '',
    'echo [HyperClip] Dang doi ung dung hien tai tat...',
    ':WAIT',
    // Use /i for case-insensitive match (handles "hyperclip.exe" vs "HyperClip.exe")
    `tasklist /nh | findstr /i "HyperClip.exe" >nul`,
    'if %errorlevel%==0 (',
    '    timeout /t 2 /nobreak >nul',
    '    goto WAIT',
    ')',
    '',
    'echo [HyperClip] Dang giai nen...',
    `powershell -Command "Expand-Archive -Path \\"%ZIP%\\" -DestinationPath \\"%TMPDIR%\\" -Force"`,
    '',
    'echo [HyperClip] Dang copy file moi...',
    `set "EXTRACTED=${extractedDir.replace(/\\/g, '\\\\')}"`,
    '',
    'if not exist "%EXTRACTED%" (',
    '    echo [HyperClip] Loi: Khong tim thay thu muc giai nen',
    '    powershell -Command "Get-ChildItem \\"%TMPDIR%\\" | Format-Table Name, Mode, Length"',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'REM Copy all files from extracted dir to app dir, overwriting existing',
    'xcopy /E /Y /Q "%EXTRACTED%\\*" "%APPDIR%\\" >nul 2>&1',
    '',
    'echo [HyperClip] Cap nhat xong! Dang khoi dong...',
    `start "" "%EXE%" ${appArgs.map(a => `"${a}"`).join(' ')}`,
    '',
    'REM Cleanup temp dir after a delay',
    `powershell -Command "Start-Sleep -Seconds 30; Remove-Item -Path \\"%TMPDIR%\\" -Recurse -Force -ErrorAction SilentlyContinue"`,
    '',
    'exit /b 0',
  ].join('\r\n')

  try {
    fs.writeFileSync(batchPath, batchContent, 'utf8')
    devLog(`[GitHubUpdater] Batch script written to ${batchPath}`)
    opLog.success('system', `Update ready — launching installer`, `v${_updateInfo?.version} → v${getConfig().currentVersion}`)
  } catch (err) {
    devLog(`[GitHubUpdater] Failed to write batch script: ${err}`)
    return false
  }

  // Launch the batch script and quit the app
  devLog('[GitHubUpdater] Launching update batch and quitting app')
  try {
    spawn('cmd.exe', ['/c', 'start', '/min', batchPath], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    }).unref()
  } catch (err) {
    devLog(`[GitHubUpdater] Failed to launch batch: ${err}`)
    return false
  }

  // Quit the app — the batch script will handle the rest
  app.quit()
  return true
}

export function getUpdateStatus(): {
  available: boolean
  version: string
  releaseNotes: string
  downloadSize: number
  progress: number
  downloaded: boolean
  downloadedPath: string | null
} {
  return {
    available: _updateInfo?.available ?? false,
    version: _updateInfo?.version ?? '',
    releaseNotes: _updateInfo?.releaseNotes ?? '',
    downloadSize: _updateInfo?.downloadSize ?? 0,
    progress: _downloadProgress,
    downloaded: _downloadedPath !== null,
    downloadedPath: _downloadedPath,
  }
}

let _downloadProgress = 0

export function setUpdateEventHandler(handler: (type: UpdateEventType, data?: unknown) => void): void {
  _eventHandler = handler
}

export function startAutoCheck(): void {
  if (_checkTimer) return
  devLog('[GitHubUpdater] Starting auto-check interval (6h)')
  _checkTimer = setInterval(() => {
    void checkForUpdates()
  }, CHECK_INTERVAL_MS)
}

export function stopAutoCheck(): void {
  if (_checkTimer) {
    clearInterval(_checkTimer)
    _checkTimer = null
  }
}

export function openReleasePage(): void {
  const cfg = getConfig()
  void shell.openExternal(`https://github.com/${cfg.repo}/releases/latest`)
}
