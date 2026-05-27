import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { app } from 'electron'
import { getFfmpegPath, getFfmpegVersion } from './ffmpeg-paths.js'
import { isRamDiskAvailable } from './ramdisk.js'
import { getYtdlpPath } from './youtube.js'

// ─── System Diagnostics ───────────────────────────────────────────────────────────
// Checks all prerequisites and returns a structured status report.
// Called at startup and on-demand from Settings UI.

// Check yt-dlp can execute (basic version check)
async function getYtdlpVersion(ytdlpPath: string): Promise<string> {
  try {
    const out = execSync(`"${ytdlpPath}" --version 2>&1`, { encoding: 'utf-8', timeout: 5000 })
    return out.trim().split('\n')[0]
  } catch {
    return 'unknown'
  }
}

// FFmpeg bundled path: resources/ffmpeg/ in the app bundle
function getBundledFfmpegPath(name: string): string {
  const appPath = app.isReady() ? app.getAppPath() : ''
  if (!appPath) return ''
  // In dev: process.resourcesPath points to project root
  const base = process.resourcesPath || appPath
  // FFmpeg is shipped in resources/ffmpeg/bin/ (standard FFmpeg folder structure)
  return path.join(base, 'ffmpeg', 'bin', name + '.exe')
}

export interface DiagnosticResult {
  timestamp: string
  ffmpeg: {
    ok: boolean
    path: string
    version: string
    hasNvenc: boolean
    hasNvdec: boolean   // hardware video decode — required for fast GPU pipeline
    hasCudaFilters: boolean  // CUDA filter pipeline — required for GPU scale/crop/overlay
    bundled: boolean
    error?: string
  }
  ytDlp: {
    ok: boolean
    path: string
    version: string
    error?: string
  }
  storage: {
    ramDiskAvailable: boolean
    storeDir: string
  }
  overall: {
    ready: boolean
    issues: string[]
  }
}

export async function runDiagnostics(): Promise<DiagnosticResult> {
  const issues: string[] = []
  const timestamp = new Date().toISOString()

  // ── FFmpeg ──────────────────────────────────────────────────────────────────
  let ffmpegOk = false
  let ffmpegPath = ''
  let ffmpegVersion = ''
  let ffmpegHasNvenc = false
  let ffmpegHasNvdec = false
  let ffmpegHasCudaFilters = false
  let ffmpegBundled = false
  let ffmpegError = ''

  // Check bundled first
  const bundledPath = getBundledFfmpegPath('ffmpeg')
  if (bundledPath && fs.existsSync(bundledPath)) {
    ffmpegPath = bundledPath
    ffmpegBundled = true
  } else {
    // Fall back to system FFmpeg
    try {
      ffmpegPath = getFfmpegPath()
      if (ffmpegPath && fs.existsSync(ffmpegPath)) {
        ffmpegBundled = false
      } else {
        ffmpegPath = ''
      }
    } catch (e) {
      ffmpegError = String(e)
    }
  }

  if (ffmpegPath) {
    try {
      // Use getFfmpegVersion which does comprehensive hardware capability detection:
      // - NVDEC (hardware video decode): h264_nvdec/hevc_nvdec in decoders list
      // - CUDA filters (GPU scale/crop/overlay): scale_cuda/overlay_cuda in filters list
      // - NVENC (hardware video encode): h264_nvenc/hevc_nvenc in encoders list
      const ver = getFfmpegVersion(ffmpegPath)
      ffmpegVersion = ver.version
      ffmpegHasNvenc = ver.hasNvenc
      ffmpegHasNvdec = ver.hasNvdec
      ffmpegHasCudaFilters = ver.hasCudaFilters
      ffmpegOk = ver.version !== 'unknown' && ver.version !== '';
    } catch (e) {
      ffmpegError = String(e)
      issues.push('FFmpeg not executable')
    }
  } else {
    issues.push('FFmpeg not found — renders will fail. Download: https://ffmpeg.org/download.html')
  }

  // ── yt-dlp ────────────────────────────────────────────────────────────────
  let ytdlpOk = false
  let ytdlpVersion = ''
  let ytdlpPath = ''
  let ytdlpError = ''

  try {
    ytdlpPath = getYtdlpPath()
    if (ytdlpPath && ytdlpPath !== 'yt-dlp') {
      // getYtdlpPath returned a real path — verify it exists
      if (fs.existsSync(ytdlpPath)) {
        ytdlpOk = true
      }
    } else {
      // Fallback: check if 'yt-dlp' resolves via PATH
      try {
        execSync('yt-dlp --version', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
        ytdlpOk = true
      } catch {
        ytdlpError = 'yt-dlp not found. Chạy: npm run setup:ytdlp'
      }
    }
    if (ytdlpOk) {
      ytdlpVersion = await getYtdlpVersion(ytdlpPath)
    } else {
      issues.push('yt-dlp not found — downloads will fail. Run: npm run setup:ytdlp')
    }
  } catch (e) {
    ytdlpError = String(e)
    issues.push('yt-dlp not found — downloads will fail. Run: npm run setup:ytdlp')
  }

  // ── Storage ────────────────────────────────────────────────────────────────
  const ramDiskAvailable = isRamDiskAvailable()
  const { getAppStoreDir } = await import('./paths.js')
  const storeDir = getAppStoreDir()

  // ── Overall ────────────────────────────────────────────────────────────────
  const ready = ffmpegOk && ytdlpOk

  return {
    timestamp,
    ffmpeg: { ok: ffmpegOk, path: ffmpegPath, version: ffmpegVersion, hasNvenc: ffmpegHasNvenc, hasNvdec: ffmpegHasNvdec, hasCudaFilters: ffmpegHasCudaFilters, bundled: ffmpegBundled, error: ffmpegError },
    ytDlp: { ok: ytdlpOk, path: ytdlpPath, version: ytdlpVersion, error: ytdlpError },
    storage: { ramDiskAvailable, storeDir },
    overall: { ready, issues },
  }
}
