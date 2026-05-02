import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, protocol } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import http from 'http'
import zlib from 'zlib'
import { URL } from 'url'
import { IPC_CHANNELS } from './ipc/channels.js'
import { collectSystemStats, getGPUCapabilities, type SystemStats } from './services/system.js'
import {
  getWorkspaces, getWorkspace, addWorkspace, updateWorkspace, deleteWorkspace,
  getSubscription,
  getChannels, getChannel, addChannel, updateChannel, removeChannel, markVideoSeen, loadSeenVideos, type StoredChannel,
  type WorkspaceData,
  getRenderedVideos, addRenderedVideo, removeRenderedVideo, type RenderedVideoRecord,
} from './services/store.js'
import { downloadVideo, getVideoInfo, getChannelInfo, getChannelId, type YtdlpVideoInfo, type YtdlpChannelInfo } from './services/youtube.js'
import { renderVideo, renderChunked, generateBlurBackground, extractVideoThumbnail, cancelChunked, cancelAllChunked, probeVideoAspect, trimVideo, type RenderMetadata, type RenderProgress, type ChunkConfig } from './services/ffmpeg.js'
import { cancelFfmpeg, cancelAllFfmpeg, getPoolStatus } from './services/worker-pool.js'
import { getFfmpegPath, validateFfmpeg } from './services/ffmpeg-paths.js'
import { getVideoStoragePath, getOutputPath, generateWorkspacePaths, cleanupWorkspace, ensureStorageDirs, loadSettings, saveSettings, archiveRenderedFile, getArchivePath, openArchiveFolder, showInFolder } from './services/ramdisk.js'
import { createYouTubePoller, stopYouTubePoller, getYouTubePoller } from './services/youtube_poller.js'
import { refreshChannelCache } from './services/subscription_feed.js'
import { initCookieManager, getCookieManager, authEvents, channelEvents } from './services/cookie_manager.js'
import { getKeyManager } from './services/key_manager.js'
import { getTokenManager } from './services/token_manager.js'
import { getSessionManager } from './services/chrome_cookies.js'
import type { SessionStatus } from './services/chrome_cookies.js'

// Fix UTF-8 console output on Windows — set code page to 65001 (UTF-8)
if (process.platform === 'win32') {
  import('child_process').then(({ execSync }) => {
    try { execSync('chcp 65001', { stdio: 'ignore' }) } catch {}
  }).catch(() => {})
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV !== 'production'
const NEXT_PORT = 3000

// Single terminal: Electron auto-boots Next.js if not already running
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let nextServer: ReturnType<typeof spawn> | null = null
let nextServerOwned = false // did WE spawn the Next.js server?

// ─── Render Queue (Tier 2+3.2: Multi-worker via worker pool) ──────────────────
// Concurrency controlled by worker-pool (max 2 concurrent FFmpeg processes).
// The render queue here is for job ordering and user-level queue management.

// ─── In-flight auto-download retries ──────────────────────────────────────────
// Prevents multiple concurrent retry attempts for the same workspace
const inProgressAutoRetries: Set<string> = new Set()

const renderQueue: Array<{
  workspaceId: string
  metadata: RenderMetadata
  resolve: (r: { success: boolean; outputPath?: string; error?: string }) => void
}> = []

function startNextQueuedRender(): void {
  if (getPoolStatus().active >= 2) return
  if (renderQueue.length === 0) return

  const job = renderQueue.shift()!
  executeRenderJob(job)
}

function executeRenderJob(job: typeof renderQueue[0]): void {
  const { workspaceId, metadata, resolve } = job
  const workspace = getWorkspace(workspaceId)
  if (!workspace) { resolve({ success: false, error: 'Workspace not found' }); startNextQueuedRender(); return }

  // Resolve video path: disk store only saves filename, scan storage dirs to find actual file
  const videoPath = findDownloadedFileAbs(workspaceId) || metadata.source_video
  if (!fs.existsSync(videoPath)) {
    console.error(`[RENDER] Source video not found: ${videoPath}`)
    resolve({ success: false, error: `Source video not found: ${path.basename(videoPath)}` })
    startNextQueuedRender()
    return
  }

  const renderStartMs = Date.now()
  const renderQuality = parseInt((metadata.export_resolution || '1080x1920').split('x')[1]) || 1080
  const renderSpeed = metadata.video_speed ?? 1.0
  const trimStart = metadata.trim?.start ?? 0
  const trimEnd = metadata.trim?.end ?? 0
  const trimDuration = trimEnd - trimStart
  console.log(`[TIMER] ═══════════════════════════════════════════════`)
  console.log(`[TIMER] RENDER START: "${workspace.videoTitle}"`)
  console.log(`[TIMER]   Quality: ${renderQuality}p | Speed: ${renderSpeed}x | Trim: ${trimDuration}s (${trimStart}s–${trimEnd}s)`)
  console.log(`[TIMER]   Codec: ${metadata.codec ?? 'hevc'} | Source: ${path.basename(videoPath)}`)
  console.log(`[TIMER]   ═══════════════════════════════════════════════`)

  updateWorkspace(workspaceId, { status: 'rendering', renderProgress: 0 })
  sendNotification('info', `Rendering: ${workspace.videoTitle}`, workspaceId)

  const outputDir = getOutputPath()
  ensureStorageDirs()

  // Build resolved metadata with absolute video path for FFmpeg
  const resolvedMetadata = { ...metadata, source_video: videoPath }

  const gpuTier = getGPUCapabilities().tier
  renderVideo(resolvedMetadata, outputDir, (progress: RenderProgress) => {
    updateWorkspace(workspaceId, { renderProgress: progress.percent })
    broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, progress)
  }, gpuTier).then((result) => {
    const renderElapsed = ((Date.now() - renderStartMs) / 1000).toFixed(1)
    if (result.success) {
      updateWorkspace(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' })
      sendNotification('success', `Done: ${workspace.videoTitle}`, workspaceId)
      // Auto-archive to D:\HyperClip\Rendered
      ;(async () => {
        try {
          const quality = parseInt((metadata.export_resolution || '1080x1920').split('x')[1])
          const codec = (metadata.codec as string) || 'hevc'

          // Capture thumbnail as base64 data URI before workspace is deleted
          const thumbPath = path.join(getVideoStoragePath(), `thumb_${workspace.id}.jpg`)
          const thumbData = fs.existsSync(thumbPath)
            ? 'data:image/jpeg;base64,' + fs.readFileSync(thumbPath).toString('base64')
            : undefined

          const archiveResult = await archiveRenderedFile(
            result.outputPath!,
            workspace.channelName,
            workspace.videoTitle,
            quality || 1080,
            codec,
            workspace.fileSize || 0,
            workspace.duration || 0,
          )
          if (archiveResult.success && archiveResult.archivedPath) {
            const record: RenderedVideoRecord = {
              id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              workspaceId: workspace.id,
              channelId: workspace.channelId,
              channelName: workspace.channelName,
              videoTitle: workspace.videoTitle,
              archivedPath: archiveResult.archivedPath,
              outputPath: result.outputPath!,
              quality: quality || 1080,
              codec,
              fileSize: workspace.fileSize || 0,
              duration: workspace.duration || 0,
              thumbnail: workspace.thumbnail,
              thumbnailData: thumbData,
              renderedAt: new Date().toISOString(),
            }
            addRenderedVideo(record)
            cleanupWorkspace(workspace.id, workspace.downloadedPath)
            deleteWorkspace(workspace.id)
            broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, null)
            const _fileSizeMB = ((workspace.fileSize || 0) / 1024 / 1024).toFixed(1)
            const totalElapsed = ((Date.now() - renderStartMs) / 1000).toFixed(1)
            console.log(`[TIMER] ARCHIVE DONE: ${archiveResult.archivedPath}`)
            console.log(`[TIMER]   Archive file size: ${_fileSizeMB} MB | Total elapsed: ${totalElapsed}s`)
            console.log(`[TIMER] ═══════════════════════════════════════════════`)
          } else {
            // Archive failed but render succeeded — notify user, keep workspace
            sendNotification('warning', `Render done, archive failed: ${archiveResult.error || 'unknown'}`, workspaceId)
            console.warn(`[AutoArchive] failed: ${archiveResult.error} — workspace ${workspace.id} NOT deleted`)
            updateWorkspace(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' })
          }
        } catch (e) {
          sendNotification('error', `Archive error: ${e}`, workspaceId)
          console.warn('[AutoArchive] failed:', e)
        }
      })()
    } else {
      updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
      sendNotification('error', `Render failed: ${result.error}`, workspaceId)
    }
    if (result.success) {
      console.log(`[TIMER] RENDER DONE: "${workspace.videoTitle}" — ${renderElapsed}s (${renderQuality}p @ ${renderSpeed}x speed)`)
    } else {
      console.log(`[TIMER] RENDER FAILED: "${workspace.videoTitle}" — ${renderElapsed}s — ${result.error}`)
    }
    resolve({ success: result.success, outputPath: result.outputPath })
    startNextQueuedRender()
  }).catch((err) => {
    updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
    resolve({ success: false, error: String(err) })
    startNextQueuedRender()
  })
}

// ─── YouTube Poller ──────────────────────────────────────────────────────────────
// Cookie-based subscription feed polling — no tunnel, no proxy needed.
// 1 request every `intervalMs` captures all 100 channels from the subscriptions feed.
// Cookie refreshes every 15 minutes to stay valid.

/**
 * Start the YouTube subscription feed poller.
 * @param intervalMs Polling interval in milliseconds (default: 3000 = 3 seconds)
 * @param onVideos Callback fired with new videos detected since last poll
 */
export function startYouTubePoller(
  intervalMs: number,
  onVideos: (videos: Array<{ videoId: string; channelId: string; channelName: string; title: string; publishedAt?: number; detectedAt?: number }>) => void
): void {
  const poller = createYouTubePoller({
    pollIntervalMs: intervalMs,
    onNewVideos: (detectedVideos) => {
      onVideos(detectedVideos.map(v => ({
        videoId: v.videoId,
        channelId: v.channelId,
        channelName: v.channelName,
        title: v.title,
        publishedAt: v.publishedAt,
        detectedAt: v.detectedAt,
      })))
    },
  })
  poller.start()
}

// ─── Auto-download from new video detected by poller ────────────────────────────
async function autoDownloadFromWebSub(videoId: string, channelId: string, channelName: string, title: string, publishedAt?: string, detectedAt?: string) {
  try {
    const storagePath = getVideoStoragePath()
    ensureStorageDirs()

    // Respect user's configured trim limit from settings (default: 10 minutes)
    const settings = loadSettings()
    const autoTrimLimit: number | 'full' = settings.defaultTrimLimit ?? 10

    // Check if workspace already exists for this video
    const existingWorkspaces = getWorkspaces()
    const existing = existingWorkspaces.find(ws => ws.videoId === videoId)

    if (existing) {
      // Retry 'waiting' or 'error' workspaces — they failed to download before
      if ((existing.status === 'waiting' || existing.status === 'error') && !inProgressAutoRetries.has(existing.id)) {
        // Backoff: don't retry 'waiting' workspaces until retryableAt has passed
        if (existing.status === 'waiting' && existing.retryableAt && Date.now() < new Date(existing.retryableAt).getTime()) {
          const remainingMin = Math.ceil((new Date(existing.retryableAt).getTime() - Date.now()) / 60000)
          console.log(`[Poll] Skipping retry for ${title} — retryableAt not reached (${remainingMin}m remaining)`)
          return
        }
        console.log(`[Poll] Retrying existing workspace ${existing.id} (${existing.status}): ${title}`)
        await retryAutoDownload(existing)
        return
      }
      // 'downloading', 'rendering', 'done' — or already in progress — skip
      console.log(`[Poll] Workspace ${existing.id} already ${existing.status} — skipping`)
      return
    }

    const finalChannelName = channelName || getSubscription(channelId)?.channelName || 'Unknown Channel'
    const detectedAt = new Date().toISOString()
    console.log(`[Poll] Auto-downloading: ${title} (${videoId}) from ${finalChannelName}`)

    const workspace = addWorkspace({
      channelId,
      channelName: finalChannelName,
      channelColor: '#00B4FF',
      videoId,
      videoTitle: title,
      videoUrl: 'https://www.youtube.com/watch?v=' + videoId,
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      duration: 0,
      trimLimit: autoTrimLimit,
      status: 'downloading',
      renderProgress: 0,
      downloadedAt: detectedAt || new Date().toISOString(),
      downloadedPath: '',
      blurBackgroundPath: '',
      outputPath: '',
      metadataPath: '',
      fileSize: 0,
      renderMetadata: null,
      publishedAt,
      detectedAt: detectedAt || new Date().toISOString(),
    })

    broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, workspace)
    sendNotification('info', `Auto: ${finalChannelName} — ${title}`, workspace.id)
    console.log(`[TIMER] DETECT: "${title}" from ${finalChannelName} at ${new Date().toISOString()}`)
    console.log(`[TIMER] DOWNLOAD START: "${title}" (trimLimit: ${autoTrimLimit} min)`)

    const downloadStartMs = Date.now()
    const result = await downloadVideo({
      workspaceId: workspace.id,
      videoUrl: 'https://www.youtube.com/watch?v=' + videoId,
      outputDir: storagePath,
      trimLimit: autoTrimLimit,
      onProgress: (progress) => {
        broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
          workspaceId: workspace.id,
          percent: progress.percent,
          speed: progress.speed,
          eta: progress.eta,
        })
      },
    })

    if (result.success && result.filePath) {
      const downloadElapsed = ((Date.now() - downloadStartMs) / 1000).toFixed(1)
      const fileSizeMB = result.fileSize ? (result.fileSize / 1024 / 1024).toFixed(1) : '?'
      console.log(`[TIMER] DOWNLOAD DONE: "${title}"`)
      console.log(`[TIMER]   Download time: ${downloadElapsed}s | File size: ${fileSizeMB} MB | Duration: ${result.duration}s`)
      console.log(`[TIMER]   Trim limit: ${autoTrimLimit} min | Trimmed to: ${result.duration}s`)
      playSuccessBeep()

      // Extract local thumbnail from downloaded video (YouTube thumbnail may 404 for fresh uploads)
      const thumbnailPath = path.join(storagePath, `thumb_${workspace.id}.jpg`)
      const thumbResult = await extractVideoThumbnail(result.filePath, thumbnailPath)
      console.log(`[Auto] Thumbnail: ${thumbResult.success ? 'extracted' : 'failed — ' + thumbResult.error}`)

      // Fetch real metadata from yt-dlp
      const videoInfo = await getVideoInfo('https://www.youtube.com/watch?v=' + videoId)
      const realTitle = videoInfo?.title || title
      const realDuration = result.duration || videoInfo?.duration || 0
      const localThumbnail = thumbResult.success
        ? 'local-video:///' + thumbnailPath.replace(/\\/g, '/')
        : (videoInfo?.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`)

      // Probe video dimensions to detect if it's a short (vertical) or landscape
      const aspect = await probeVideoAspect(result.filePath)

      // Post-download FFmpeg trim: if video is longer than trim limit, cut it with stream-copy.
      // This is much faster than section-download for long videos because yt-dlp downloads
      // the full content anyway. Stream-copy (-c copy) re-muxes without re-encoding.
      let finalFilePath = result.filePath
      let finalFileSize = result.fileSize || 0
      const trimLimitSec = typeof autoTrimLimit === 'number' ? autoTrimLimit * 60 : 0
      let finalDuration = realDuration

      // Short video check: if downloaded video < 60s, mark as error (YouTube Shorts)
      if (realDuration > 0 && realDuration < 60) {
        console.log(`[Auto] Video too short (${realDuration}s < 60s) — skipping (YouTube Short)`)
        try { fs.unlinkSync(result.filePath) } catch {}
        updateWorkspace(workspace.id, { status: 'error' })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(workspace.id))
        sendNotification('error', `Too short: ${title}`, workspace.id)
        markVideoSeen(channelId, videoId)
        return
      }

      if (trimLimitSec > 0 && realDuration > trimLimitSec) {
        const trimmedPath = result.filePath.replace(/(\.\w+)$/, `_trimmed$1`)
        console.log(`[Auto] Video ${realDuration}s > trim limit ${trimLimitSec}s — trimming with FFmpeg...`)
        const trimResult = await trimVideo(result.filePath, trimmedPath, 0, trimLimitSec)
        if (trimResult.success) {
          const trimmedSize = fs.statSync(trimmedPath).size
          console.log(`[Auto] FFmpeg trim OK: ${trimmedPath} (${(trimmedSize / 1024 / 1024).toFixed(1)} MB)`)
          finalFilePath = trimmedPath
          finalFileSize = trimmedSize
          finalDuration = trimLimitSec
          // Clean up original full file to save disk space
          try { fs.unlinkSync(result.filePath) } catch {}
        } else {
          console.warn(`[Auto] FFmpeg trim failed (${trimResult.error}) — using full video`)
          finalDuration = realDuration
        }
      }

      updateWorkspace(workspace.id, {
        status: 'ready',
        downloadedAt: new Date().toISOString(),
        downloadedPath: finalFilePath,
        fileSize: finalFileSize,
        thumbnail: localThumbnail,
        videoTitle: realTitle,
        duration: realDuration,
        isShort: aspect?.isShort ?? true,
        videoResolution: aspect ? `${aspect.width}x${aspect.height}` : undefined,
      })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(workspace.id))

      const { blurPath } = generateWorkspacePaths(workspace.id)
      const blurResult = await generateBlurBackground(finalFilePath, blurPath)

      updateWorkspace(workspace.id, {
        status: 'ready',
        blurBackgroundPath: blurResult.success ? blurPath : '',
      })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(workspace.id))
      sendNotification('success', `Auto-ready: ${realTitle}`, workspace.id)
      broadcast(IPC_CHANNELS.AUTO_DOWNLOAD_EVENT, { videoId, title: realTitle, channelName: finalChannelName, detectedAt })
      showWindowsToast('✅ Download xong!', `${realTitle}`)
      // Only mark as seen AFTER successful download — so YouTube processing delay doesn't block retry
      markVideoSeen(channelId, videoId)
    } else {
      // Permanent failure → error, retryable failure → waiting
      const errorMsg = result.error || ''
      const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('Video unavailable')
      if (isNotAvailable) {
        updateWorkspace(workspace.id, { status: 'error' })
        console.log(`[Auto] Video permanently unavailable: ${title} (${videoId})`)
      } else {
        updateWorkspace(workspace.id, { status: 'waiting', retryableAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
        console.log(`[Auto] Download failed (retryable): ${result.error} — status → waiting (retryableAt: +5min)`)
        console.log(`[Auto] Video will auto-retry at ~${new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString()}`)
        sendNotification('error', `Auto-download failed: ${result.error}`, workspace.id)
      }
    }
  } catch (err) {
    console.error('[Poll] Auto-download error:', err)
  }
}

/**
 * Retry downloading an existing workspace that is 'waiting' or 'error'.
 * Used when the poller detects a video we already have a workspace for.
 */
async function retryAutoDownload(ws: WorkspaceData): Promise<void> {
  if (!['waiting', 'error'].includes(ws.status)) return
  if (inProgressAutoRetries.has(ws.id)) return

  inProgressAutoRetries.add(ws.id)
  try {
    await doRetryAutoDownload(ws)
  } finally {
    inProgressAutoRetries.delete(ws.id)
  }
}

async function doRetryAutoDownload(ws: WorkspaceData): Promise<void> {
  const storagePath = getVideoStoragePath()
  const videoUrl = ws.videoUrl || (ws.videoId ? `https://www.youtube.com/watch?v=${ws.videoId}` : null)
  if (!videoUrl) {
    console.warn(`[Retry] No URL for workspace ${ws.id}`)
    return
  }

  updateWorkspace(ws.id, { status: 'downloading', downloadProgress: 0 })
  broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))

  const result = await downloadVideo({
    workspaceId: ws.id,
    videoUrl,
    outputDir: storagePath,
    trimLimit: ws.trimLimit || 10,
    onProgress: (progress) => {
      broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
        workspaceId: ws.id,
        percent: progress.percent,
        speed: progress.speed,
        eta: progress.eta,
      })
    },
  })

  if (result.success && result.filePath) {
    const thumbPath = path.join(storagePath, `thumb_${ws.id}.jpg`)
    const thumbResult = await extractVideoThumbnail(result.filePath, thumbPath)
    const videoInfo = await getVideoInfo(videoUrl)
    const realDuration = result.duration || videoInfo?.duration || 0
    const localThumbnail = thumbResult.success
      ? 'local-video:///' + thumbPath.replace(/\\/g, '/')
      : (videoInfo?.thumbnail || `https://img.youtube.com/vi/${ws.videoId}/mqdefault.jpg`)

    const aspect = await probeVideoAspect(result.filePath)

    // Short video check
    if (realDuration > 0 && realDuration < 60) {
      console.log(`[Retry] Video too short (${realDuration}s < 60s) — skipping (YouTube Short)`)
      try { fs.unlinkSync(result.filePath) } catch {}
      updateWorkspace(ws.id, { status: 'error' })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
      sendNotification('error', `Too short: ${ws.videoTitle}`, ws.id)
      markVideoSeen(ws.channelId, ws.videoId)
      return
    }

    // FFmpeg trim if video is longer than trim limit
    let finalFilePath = result.filePath
    let finalFileSize = result.fileSize || 0
    let finalDuration = realDuration
    const trimLimitSec = typeof ws.trimLimit === 'number' ? ws.trimLimit * 60 : 0
    if (trimLimitSec > 0 && realDuration > trimLimitSec) {
      const trimmedPath = result.filePath.replace(/(\.\w+)$/, `_trimmed$1`)
      const trimResult = await trimVideo(result.filePath, trimmedPath, 0, trimLimitSec)
      if (trimResult.success) {
        finalFilePath = trimmedPath
        finalFileSize = fs.statSync(trimmedPath).size
        finalDuration = trimLimitSec
        try { fs.unlinkSync(result.filePath) } catch {}
      }
    }

    updateWorkspace(ws.id, {
      status: 'ready',
      downloadedAt: new Date().toISOString(),
      downloadedPath: finalFilePath,
      fileSize: finalFileSize,
      thumbnail: localThumbnail,
      videoTitle: videoInfo?.title || ws.videoTitle,
      duration: finalDuration,
      isShort: aspect?.isShort ?? true,
    })
    broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))

    const { blurPath } = generateWorkspacePaths(ws.id)
    const blurResult = await generateBlurBackground(finalFilePath, blurPath)
    updateWorkspace(ws.id, { status: 'ready', blurBackgroundPath: blurResult.success ? blurPath : '' })
    broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
    sendNotification('success', `Auto-ready (retry): ${ws.videoTitle}`, ws.id)
    showWindowsToast('✅ Retry xong!', `${ws.videoTitle}`)
    markVideoSeen(ws.channelId, ws.videoId)
  } else {
    const errorMsg = result.error || ''
    const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('Video unavailable')
    if (isNotAvailable) {
      updateWorkspace(ws.id, { status: 'error' })
    } else {
      // Still retryable — stay in waiting with next retryableAt
      updateWorkspace(ws.id, { status: 'waiting', retryableAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
    }
    broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
  }
}

// ─── Scan existing downloaded files on startup ────────────────────────────────────
// Finds any video files in the storage directory that were downloaded previously
// (either by HyperClip or manually placed there) and registers them as "seen"
// so the poll won't re-download them.
function scanExistingDownloadedFiles(): void {
  // Scan both new persistent path AND legacy temp path (for backwards compat)
  const pathsToScan = [
    getVideoStoragePath(),
    path.join(os.tmpdir(), 'hyperclip-video'), // legacy path
  ]

  const seen = new Set<string>()
  let totalRegistered = 0

  for (const storagePath of pathsToScan) {
    try {
      if (!fs.existsSync(storagePath)) continue
      const files = fs.readdirSync(storagePath).filter(f => f.endsWith('.mp4'))
      if (files.length === 0) continue
      console.log(`[HyperClip] Scanning ${files.length} file(s) in ${storagePath}`)

      for (const file of files) {
        // Pattern: ws-{timestamp}-{random}_{videoId}.mp4
        const match = file.match(/^ws-\d+-[a-z0-9]+_(.+)\.mp4$/)
        if (match && !seen.has(match[1])) {
          const videoId = match[1]
          seen.add(videoId)
          const channels = getChannels()
          for (const ch of channels) {
            if (ch.channelId) markVideoSeen(ch.channelId, videoId)
          }
          totalRegistered++
        }
      }
    } catch (e) {
      console.warn(`[HyperClip] scanExistingDownloadedFiles failed for ${storagePath}:`, e)
    }
  }

  if (totalRegistered > 0) {
    console.log(`[HyperClip] Registered ${totalRegistered} existing file(s) as "seen"`)
  }
}

// ─── Channel ID Resolution ─────────────────────────────────────────────────────────
// Resolves YouTube handle (@channel) to channelId (UC...) for subscription feed fallback.
// Called at startup for ALL channels — even those with existing channelIds.
// ChannelIds can be corrupted (malformed UC IDs) so we always re-validate.
async function resolveChannelIdsForPoll(): Promise<void> {
  const channels = getChannels()
  let resolved = 0
  let skipped = 0

  for (const ch of channels) {
    // Build a reliable channel URL to resolve
    let resolveUrl = ''
    let strategy = ''

    // Determine the best URL for this channel
    if (ch.handle && ch.handle.startsWith('@')) {
      // If the handle looks like a raw channelId (@UC...), use /channel/ URL instead
      const handlePart = ch.handle.slice(1) // strip leading '@'
      if (/^UC[a-zA-Z0-9_-]{22}$/.test(handlePart)) {
        // Corrupted handle: @UCxxx is actually a channelId
        resolveUrl = `https://www.youtube.com/channel/${handlePart}`
        strategy = 'handle→channelId'
      } else {
        // Real handle like @MrBeast
        resolveUrl = `https://www.youtube.com${ch.handle}`
        strategy = 'handle'
      }
    } else if (ch.channelId && isValidChannelId(ch.channelId)) {
      // Use the existing channelId if it looks valid
      resolveUrl = `https://www.youtube.com/channel/${ch.channelId}`
      strategy = 'channelId'
    }

    if (!resolveUrl) {
      console.warn(`[Channel] "${ch.name}": no resolvable URL (handle=${ch.handle || 'none'}, channelId=${ch.channelId || 'none'}, id=${ch.id})`)
      skipped++
      continue
    }

    try {
      const info = await getChannelInfo(resolveUrl)
      if (info && info.channelId && info.channelId.startsWith('UC') && info.channelId.length >= 24) {
        const needsUpdate = !ch.channelId || ch.channelId !== info.channelId || !isValidChannelId(ch.channelId)
        if (needsUpdate) {
          console.log(`[Channel] Re-resolved "${ch.name}" [${strategy}]: ${ch.channelId || '(none)'} → ${info.channelId}`)
          updateChannel(ch.id, { channelId: info.channelId, name: info.channelName || ch.name })
          resolved++
        } else {
          console.log(`[Channel] Verified "${ch.name}": ${info.channelId} [${strategy}]`)
        }
      } else if (info && !info.channelId) {
        console.warn(`[Channel] Could not resolve "${ch.name}" via ${strategy} — no channelId from ${resolveUrl}`)
      } else if (!info) {
        console.warn(`[Channel] Failed to fetch "${ch.name}" via ${strategy}: ${resolveUrl}`)
      }
    } catch (e) {
      console.warn(`[Channel] Resolution error for "${ch.name}":`, e)
    }
  }

  console.log(`[Channel] Resolution: ${resolved} updated, ${skipped} skipped, ${channels.length - resolved - skipped} verified`)
  refreshChannelCache()
}

function isValidChannelId(id: string): boolean {
  // Real YouTube channel IDs: UC prefix + 22 base64 chars = 24 chars total
  return /^(UC[a-zA-Z0-9_-]{22})$/.test(id)
}

// ─── Port checker ───────────────────────────────────────────────────────────────
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
  })
}

// ─── Next.js server ────────────────────────────────────────────────────────────
function startNextServer(): Promise<void> {
  const nextDir = path.join(__dirname, '..')
  const nextBin = path.join(nextDir, 'node_modules', 'next', 'dist', 'bin', 'next')

  let startupResolve: (() => void) | null = null
  return new Promise<void>((resolve) => {
    startupResolve = resolve

    nextServer = spawn('node', [nextBin, '-p', String(NEXT_PORT)], {
      cwd: nextDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PORT: String(NEXT_PORT) },
    })

    nextServerOwned = true
    console.log(`[HyperClip] Booting Next.js on port ${NEXT_PORT}...`)

    nextServer.stdout?.on('data', (data) => {
      const text = data.toString()
      process.stdout.write('[Next.js] ' + text)
      if (text.includes('Ready') || text.includes('started server')) {
        console.log(`[HyperClip] Next.js ready → http://localhost:${NEXT_PORT}`)
        if (startupResolve) { startupResolve(); startupResolve = null }
      }
    })
    nextServer.stderr?.on('data', (data) => {
      const text = data.toString()
      process.stderr.write('[Next.js] ' + text)
      if (text.includes('Local:')) {
        console.log(`[HyperClip] Next.js ready → http://localhost:${NEXT_PORT}`)
        if (startupResolve) { startupResolve(); startupResolve = null }
      }
    })
    // 20s safety timeout
    setTimeout(() => {
      if (startupResolve) {
        console.warn('[HyperClip] Next.js startup timeout — proceeding anyway')
        startupResolve(); startupResolve = null
      }
    }, 20000)
  })
}

// ─── Window ────────────────────────────────────────────────────────────────────
function getPreloadPath() {
  return path.join(__dirname, 'preload.js')
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#121212',
    title: 'HyperClip',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    frame: true,
  })

  mainWindow.loadURL(`http://localhost:${NEXT_PORT}`)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) {
      mainWindow?.webContents.openDevTools()
    }
  })

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

// ─── Tray icon helper ─────────────────────────────────────────────────────────
// Creates a 16x16 tray icon: dark rounded square with blue play triangle
// Matches the sidebar logo design
function createBlueIcon(): Electron.NativeImage {
  const W = 16, H = 16
  const rowLen = 1 + W * 4

  // RGBA pixel buffer (filter byte + pixels per row)
  const raw = Buffer.alloc(H * rowLen)
  for (let i = 0; i < raw.length; i++) raw[i] = 0

  const bgR = 13, bgG = 13, bgB = 13   // #0D0D0D dark
  const fgR = 0,   fgG = 180, fgB = 255 // #00B4FF blue

  function setPixel(x: number, y: number, r: number, g: number, b: number, a: number) {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = y * rowLen + 1 + x * 4
    raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = a
  }

  // Fill background (all opaque)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Skip rounded corners (3px radius)
      const dx = Math.min(x, W - 1 - x)
      const dy = Math.min(y, H - 1 - y)
      if (dx < 3 && dy < 3 && dx + dy < 3) continue
      setPixel(x, y, bgR, bgG, bgB, 255)
    }
  }

  // Play triangle (▶) — filled blue
  // y=3..13 centered at y=8, tip right, base left
  // Each entry: [rowY, xLeft, xRight]
  const rows: [number, number, number][] = [
    [3,5,7], [4,4,9], [5,4,10], [6,4,11],
    [7,3,12], [8,3,13], [9,4,12],
    [10,4,11], [11,4,10], [12,4,9], [13,5,7],
  ]
  for (const [y, x1, x2] of rows) {
    for (let x = x1; x <= x2; x++) setPixel(x, y, fgR, fgG, fgB, 255)
  }

  // Build PNG
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0)
    return Buffer.concat([len, Buffer.from(type, 'ascii'), data, crcB])
  }

  const crcTbl: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTbl[n] = c
  }
  function crc32(buf: Buffer): number {
    let crc = 0xffffffff
    for (let i = 0; i < buf.length; i++) crc = crcTbl[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
    return crc ^ 0xffffffff
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const compressed = zlib.deflateSync(raw)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])

  return nativeImage.createFromBuffer(png)
}

// ─── System tray ──────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(process.resourcesPath || __dirname, 'resources', 'icon.png')
  let trayIcon: Electron.NativeImage

  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.isEmpty()) {
      // Fallback: create a 16x16 blue icon programmatically
      trayIcon = createBlueIcon()
    }
  } catch {
    trayIcon = createBlueIcon()
  }

  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show HyperClip', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quick Add Tracker', click: () => mainWindow?.webContents.send('quick-add') },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitAll() } },
  ])

  tray.setToolTip('HyperClip — Auto-Render')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => mainWindow?.show())
}

// ─── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcast(channel: string, data: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// ─── Audio notification ────────────────────────────────────────────────────────────
function playSuccessBeep() {
  // Distinct double-chime on download complete — loud enough to cut through background noise
  if (process.platform === 'win32') {
    import('child_process').then(({ spawn }) => {
      // Exclamation is louder than Asterisk; play twice for emphasis
      spawn('powershell', [
        '-c',
        'Add-Type -AssemblyName System.Media; 1..2 | ForEach-Object { [System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 350 }'
      ], { stdio: 'ignore' })
    }).catch(() => {})
  }
}

// ─── Windows Toast Notification ──────────────────────────────────────────────────
// Shows a native Windows 10/11 Action Center notification.
// Works even when app is in background/tray — independent of renderer window.
function showWindowsToast(title: string, body: string) {
  if (process.platform !== 'win32') return
  import('child_process').then(({ spawn }) => {
    const escapedTitle = title.replace(/"/g, '`"')
    const escapedBody = body.replace(/`/g, '``').replace(/"/g, '`"')
    const script = [
      `try {`,
      `  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null`,
      `  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null`,
      `  $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()`,
      `  $xml.LoadXml('<toast launch="hyperclip"><visual><binding template="ToastGeneric"><text>${escapedTitle}</text><text>${escapedBody}</text></binding></visual></toast>')`,
      `  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)`,
      `  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("HyperClip").Show($toast)`,
      `} catch { }`,
    ].join('; ')
    spawn('powershell', ['-c', script], { stdio: 'ignore' })
  }).catch(() => {})
}

function sendNotification(type: 'success' | 'error' | 'warning' | 'info', message: string, workspaceId?: string) {
  broadcast(IPC_CHANNELS.NOTIFICATION_EVENT, {
    id: `notif-${Date.now()}`,
    type,
    message,
    workspaceId,
    timestamp: new Date().toISOString(),
  })
}

// ─── Video File Resolution ─────────────────────────────────────────────────────
// Scan known storage directories for a downloaded video file by workspaceId.
function findDownloadedFileAbs(workspaceId: string): string | null {
  const dirs = [
    getVideoStoragePath(),           // primary: APPDATA/HyperClip/downloads or RAM disk
    path.join(os.tmpdir(), 'hyperclip-video'),  // legacy temp path
  ]
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue
      const files = fs.readdirSync(dir).filter(f =>
        (f.startsWith(workspaceId + '_') || f.startsWith(workspaceId + '.')) && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f)
      )
      if (files.length > 0) {
        return path.join(dir, files[0])
      }
    } catch {}
  }
  return null
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
async function registerIPCHandlers() {
  ipcMain.handle(IPC_CHANNELS.SYSTEM_STATS, async (): Promise<SystemStats> => {
    return collectSystemStats()
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_FOLDER, async (_, folderPath: string) => {
    await shell.openPath(folderPath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_URL, async (_, url: string) => {
    shell.openExternal(url)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST, async (): Promise<WorkspaceData[]> => {
    return getWorkspaces()
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_UPDATE, async (_, id: string, patch: Partial<WorkspaceData>) => {
    const updated = updateWorkspace(id, patch)
    if (updated) broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, updated)
    return updated || { success: false }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_DELETE, async (_, id: string) => {
    const ws = getWorkspace(id)
    cleanupWorkspace(id, ws?.downloadedPath)
    deleteWorkspace(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_RETRY, async (_, id: string) => {
    const ws = getWorkspace(id)
    if (!ws) return { success: false, error: 'Workspace not found' }
    if (!['waiting', 'error'].includes(ws.status)) {
      return { success: false, error: `Cannot retry status: ${ws.status}` }
    }

    const videoUrl = ws.videoUrl || (ws.videoId ? `https://www.youtube.com/watch?v=${ws.videoId}` : null)
    if (!videoUrl) return { success: false, error: 'No video URL stored' }

    updateWorkspace(id, { status: 'downloading', downloadProgress: 0 })
    broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))

    const storagePath = getVideoStoragePath()
    ensureStorageDirs()

    try {
      const result = await downloadVideo({
        workspaceId: id,
        videoUrl,
        outputDir: storagePath,
        trimLimit: ws.trimLimit || 10,
        onProgress: (progress) => {
          broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
            workspaceId: id,
            percent: progress.percent,
            speed: progress.speed,
            eta: progress.eta,
          })
        },
      })

      if (result.success && result.filePath) {
        const videoInfo = await getVideoInfo(videoUrl)
        updateWorkspace(id, {
          status: 'ready',
          downloadedAt: new Date().toISOString(),
          downloadedPath: result.filePath,
          fileSize: result.fileSize || 0,
          thumbnail: videoInfo?.thumbnail || ws.thumbnail || '',
          videoTitle: videoInfo?.title || ws.videoTitle || '',
          duration: result.duration || videoInfo?.duration || 0,
        })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))

        // Generate blur background
        const { blurPath } = generateWorkspacePaths(id)
        const blurResult = await generateBlurBackground(result.filePath, blurPath)
        updateWorkspace(id, { blurBackgroundPath: blurResult.success ? blurPath : '' })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))
        return { success: true }
      } else {
        const errorMsg = result.error || ''
        const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('Video unavailable')
        updateWorkspace(id, {
          status: isNotAvailable ? 'error' : 'waiting',
        })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))
        return { success: false, error: result.error }
      }
    } catch (err) {
      updateWorkspace(id, { status: 'waiting' })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_REGENERATE_BLUR, async (_, id: string) => {
    const ws = getWorkspace(id)
    if (!ws) return { success: false, error: 'Workspace not found' }
    if (!ws.downloadedPath || !fs.existsSync(ws.downloadedPath)) {
      return { success: false, error: 'Video file not found' }
    }
    try {
      const { blurPath } = generateWorkspacePaths(id)
      // Overwrite existing blur
      const result = await generateBlurBackground(ws.downloadedPath, blurPath)
      const blurBgPath = result.success ? blurPath : ''
      updateWorkspace(id, { blurBackgroundPath: blurBgPath })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))
      return { success: result.success, blurPath: blurBgPath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ─── Split workspace into multiple workspaces by trim limit ─────────────────────
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SPLIT, async (_, id: string, partMinutes = 10): Promise<{ success: boolean; newWorkspaces?: WorkspaceData[]; error?: string }> => {
    try {
      const ws = getWorkspace(id)
      if (!ws) return { success: false, error: 'Workspace not found' }
      if (ws.status !== 'ready' || !ws.downloadedPath || !fs.existsSync(ws.downloadedPath)) {
        return { success: false, error: 'Video not ready' }
      }

      const totalSec = typeof ws.duration === 'number' ? ws.duration : 0
      if (totalSec === 0) return { success: false, error: 'Unknown video duration' }

      const partSec = partMinutes * 60
      if (totalSec <= partSec) {
        return { success: false, error: `Video is ${Math.floor(totalSec / 60)}m — no split needed (trim limit: ${partMinutes}m)` }
      }

      const numParts = Math.ceil(totalSec / partSec)
      if (numParts < 2) return { success: false, error: 'No split needed' }

      console.log(`[Split] Splitting "${ws.videoTitle}" (${totalSec}s) into ${numParts} parts of ${partMinutes}m each`)
      console.log(`[Split] Original workspace ${ws.id} = Part 1 (0s – ${partSec}s)`)
      console.log(`[Split] Will create ${numParts - 1} new workspaces for remaining parts`)

      const newWorkspaces: WorkspaceData[] = []

      // For each part (0 = original workspace, 1..n-1 = new workspaces)
      for (let i = 1; i < numParts; i++) {
        const startSec = i * partSec
        const endSec = Math.min((i + 1) * partSec, totalSec)
        const partDuration = endSec - startSec
        const partFileName = `${ws.id}_part${i + 1}.${path.extname(ws.downloadedPath).slice(1) || 'mp4'}`
        const partFilePath = path.join(path.dirname(ws.downloadedPath), partFileName)

        console.log(`[Split] Part ${i + 1}/${numParts}: ${startSec}s – ${endSec}s (${partDuration}s)`)

        // FFmpeg stream-copy the part (no re-encode, very fast)
        const trimResult = await trimVideo(ws.downloadedPath, partFilePath, startSec, partDuration)
        if (!trimResult.success) {
          console.error(`[Split] FFmpeg trim failed for part ${i + 1}: ${trimResult.error}`)
          // Clean up already-created parts
          for (const nw of newWorkspaces) {
            try { if (nw.downloadedPath) fs.unlinkSync(nw.downloadedPath) } catch {}
          }
          return { success: false, error: `Part ${i + 1} FFmpeg failed: ${trimResult.error}` }
        }

        const partSize = fs.statSync(partFilePath).size

        // Create workspace with its own ID BEFORE generating paths that reference it
        const newWs = addWorkspace({
          channelId: ws.channelId,
          channelName: ws.channelName,
          channelColor: ws.channelColor || '#00B4FF',
          videoId: ws.videoId,
          videoTitle: ws.videoTitle,
          videoUrl: ws.videoUrl,
          thumbnail: ws.thumbnail,
          duration: partDuration,
          trimLimit: ws.trimLimit,
          status: 'ready',
          renderProgress: 0,
          downloadedAt: new Date().toISOString(),
          downloadedPath: partFilePath,
          blurBackgroundPath: '',
          outputPath: '',
          metadataPath: '',
          fileSize: partSize,
          renderMetadata: null,
          publishedAt: ws.publishedAt,
          detectedAt: ws.detectedAt,
          isShort: ws.isShort,
          videoResolution: ws.videoResolution,
        })

        // Extract thumbnail for this part
        const partThumbPath = path.join(path.dirname(ws.downloadedPath), `thumb_${newWs.id}.jpg`)
        const partThumbResult = await extractVideoThumbnail(partFilePath, partThumbPath)

        // Generate blur for this part — use new workspace's own ID
        const { blurPath: partBlurPath } = generateWorkspacePaths(newWs.id)
        const partBlurResult = await generateBlurBackground(partFilePath, partBlurPath)

        updateWorkspace(newWs.id, {
          thumbnail: partThumbResult.success ? 'local-video:///' + partThumbPath.replace(/\\/g, '/') : ws.thumbnail,
          blurBackgroundPath: partBlurResult.success ? partBlurPath : '',
        });

        newWorkspaces.push(newWs)
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, newWs)
        console.log(`[Split] Created workspace ${newWs.id} (${newWs.videoTitle})`)
      }

      sendNotification('success', `Split "${ws.videoTitle}" into ${numParts} parts`, ws.id)
      return { success: true, newWorkspaces }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.TRACKER_ADD, async (_, url: string, trimLimit: number | 'full'): Promise<WorkspaceData | null> => {
    try {
      const info = await getVideoInfo(url)
      if (!info) {
        sendNotification('error', 'Failed to fetch video info. Check URL.', undefined)
        return null
      }

      const storagePath = getVideoStoragePath()
      ensureStorageDirs()

      const workspace = addWorkspace({
        channelId: info.channelId,
        channelName: info.channelName,
        channelColor: '#00B4FF',
        videoId: info.id,
        videoTitle: info.title,
        videoUrl: url,
        thumbnail: info.thumbnail,
        duration: info.duration,
        trimLimit,
        status: 'downloading',
        renderProgress: 0,
        downloadedAt: '',
        downloadedPath: '',
        blurBackgroundPath: '',
        outputPath: '',
        metadataPath: '',
        fileSize: 0,
        renderMetadata: null,
      })

      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, workspace)
      sendNotification('info', `Downloading: ${info.title}`, workspace.id)

      const result = await downloadVideo({
        workspaceId: workspace.id,
        videoUrl: url,
        outputDir: storagePath,
        trimLimit,
        onProgress: (progress) => {
          broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, { workspaceId: workspace.id, percent: progress.percent, speed: progress.speed, eta: progress.eta })
        },
      })

      if (result.success && result.filePath) {
        // Step 1: Extract local thumbnail from downloaded video
        const storagePath = getVideoStoragePath()
        const thumbnailPath = path.join(storagePath, `thumb_${workspace.id}.jpg`)
        extractVideoThumbnail(result.filePath, thumbnailPath).then((thumbResult) => {
          if (thumbResult.success) {
            const update = updateWorkspace(workspace.id, {
              thumbnail: 'local-video:///' + thumbnailPath.replace(/\\/g, '/'),
            })
            if (update) broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, update)
          }
        }).catch(() => {})

        // Step 1b: Mark ready immediately after download
        const { blurPath } = generateWorkspacePaths(workspace.id)
        const initialUpdate = updateWorkspace(workspace.id, {
          status: 'ready',
          downloadedAt: new Date().toISOString(),
          downloadedPath: result.filePath,
          fileSize: result.fileSize || 0,
          blurBackgroundPath: '',
          renderMetadata: {
            workspace_id: workspace.id,
            source_video: result.filePath,
            blur_background: '',
            export_resolution: '1080x1920',
            video_speed: 1.0,
            fps_target: 30,
            overlays: [],
            trim: { start: 0, end: result.duration || 300 },
          },
        })
        if (initialUpdate) broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, initialUpdate)
        sendNotification('success', `Ready: ${info.title}`, workspace.id)

        // Step 2: Generate blur background in parallel (non-blocking)
        generateBlurBackground(result.filePath, blurPath).then((blurResult) => {
          const blurUpdate = updateWorkspace(workspace.id, {
            blurBackgroundPath: blurResult.success ? blurPath : '',
            renderMetadata: {
              workspace_id: workspace.id,
              source_video: result.filePath,
              blur_background: blurResult.success ? blurPath : '',
              export_resolution: '1080x1920',
              video_speed: 1.0,
              fps_target: 30,
              overlays: [],
              trim: { start: 0, end: result.duration || 300 },
            },
          })
          if (blurUpdate) broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, blurUpdate)
        }).catch((e) => {
          console.warn('[Blur] Background generation failed:', e)
        })
      } else {
        updateWorkspace(workspace.id, { status: 'waiting' })
        sendNotification('error', `Download failed: ${result.error}`, workspace.id)
      }

      return getWorkspace(workspace.id)
    } catch (err) {
      console.error('[Tracker] Add error:', err)
      sendNotification('error', `Error: ${(err as Error).message}`)
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.TRACKER_LIST, async () => {
    const workspaces = getWorkspaces()
    const channels = new Map<string, { channelId: string; channelName: string }>()
    for (const ws of workspaces) {
      if (!channels.has(ws.channelId)) {
        channels.set(ws.channelId, { channelId: ws.channelId, channelName: ws.channelName })
      }
    }
    return Array.from(channels.values())
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_INFO, async (_, url: string): Promise<YtdlpChannelInfo | null> => {
    return await getChannelInfo(url)
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_LIST, async (): Promise<StoredChannel[]> => {
    return getChannels()
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_SYNC, async () => {
    const cm = getCookieManager()
    const result = await cm.syncSubscriptionList()
    // Refresh channel cache so new channels are picked up by poller immediately
    const { refreshChannelCache } = await import('./services/subscription_feed.js')
    refreshChannelCache()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_ADD, async (_, url: string): Promise<StoredChannel | null> => {
    try {
      let name: string, handle: string, channelId: string | undefined, avatarUrl: string | undefined

      try {
        const info = await getChannelInfo(url)
        if (info) {
          name = info.channelName
          handle = info.handle || `@${info.channelId}`
          channelId = info.channelId
          avatarUrl = info.avatarUrl
        } else {
          throw new Error('no info')
        }
      } catch {
        const raw = url.replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/)?/, '').split(/[/?]/)[0] || 'Kênh Mới'
        name = raw.charAt(0).toUpperCase() + raw.slice(1)
        handle = `@${raw.toLowerCase()}`
      }

      const CHANNEL_COLORS = ['#00B4FF', '#7C3AED', '#00FF88', '#FF6B35', '#FF0080', '#FFB800']
      const channels = getChannels()
      const newCh: StoredChannel = {
        id: `ch${Date.now()}`,
        name,
        handle,
        avatarColor: CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length],
        channelId,
        avatarUrl,
        createdAt: new Date().toISOString(),
      }
      const saved = addChannel(newCh)
      // Keep poller's channel cache in sync
      refreshChannelCache()
      return saved
    } catch (e) {
      console.error('[CHANNEL_ADD] failed:', e)
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_UPDATE, async (_, id: string, patch: Partial<StoredChannel>): Promise<StoredChannel | null> => {
    return updateChannel(id, patch)
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_REMOVE, async (_, id: string): Promise<boolean> => {
    return removeChannel(id)
  })

  // Serve video file path for HTML5 preview player
  ipcMain.handle(IPC_CHANNELS.VIDEO_FILE, async (_, workspaceId: string): Promise<{ path: string; url: string } | null> => {
    const ws = getWorkspace(workspaceId)
    if (!ws || !ws.downloadedPath) return null

    // Resolve to absolute path: try stored path first, then scan known storage dirs
    const normalizedStored = ws.downloadedPath.replace(/\\/g, '/')
    let absPath = normalizedStored
    if (!fs.existsSync(absPath)) {
      // Not found at stored path — scan for it
      const found = findDownloadedFileAbs(workspaceId)
      if (found) {
        absPath = found
      } else {
        console.warn(`[VIDEO_FILE] file not found: ${ws.downloadedPath}`)
        return null
      }
    }

    // Protocol needs forward slashes; THREE slashes for valid Windows path in URL
    const protocolPath = absPath.replace(/\\/g, '/')
    // local-video:// protocol: MUST use /// (three slashes) so Chromium correctly
    // passes C:/Users/... to the file handler. Two slashes → C: treated as host → broken.
    const videoUrl = 'local-video:///' + protocolPath
    return { path: absPath, url: videoUrl }
  })

  // Serve full video file as ArrayBuffer (for blob URL playback)
  ipcMain.handle(IPC_CHANNELS.VIDEO_BLOB, async (_, workspaceId: string): Promise<Uint8Array | null> => {
    const ws = getWorkspace(workspaceId)
    if (!ws || !ws.downloadedPath) return null
    const normalizedStored = ws.downloadedPath.replace(/\\/g, '/')
    let absPath = normalizedStored
    if (!fs.existsSync(absPath)) {
      const found = findDownloadedFileAbs(workspaceId)
      if (found) absPath = found
      else {
        console.warn(`[VIDEO_BLOB] file not found: ${ws.downloadedPath}`)
        return null
      }
    }
    try {
      const data = fs.readFileSync(absPath)
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    } catch (err) {
      console.error(`[VIDEO_BLOB] read error: ${err}`)
      return null
    }
  })

  // Serve image file as base64 data URI (for <img> src — local-video:// doesn't work in img tags)
  ipcMain.handle(IPC_CHANNELS.IMAGE_FILE, async (_, workspaceId: string): Promise<{ path: string; dataUrl: string } | null> => {
    const storagePath = getVideoStoragePath()
    const thumbPath = path.join(storagePath, `thumb_${workspaceId}.jpg`)
    if (!fs.existsSync(thumbPath)) {
      return null
    }
    try {
      const data = fs.readFileSync(thumbPath)
      return {
        path: thumbPath,
        dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`,
      }
    } catch {
      return null
    }
  })

  // Save binary data from renderer to disk. Renderer sends Uint8Array (converted from File.arrayBuffer()).
  // This avoids the old approach of passing blob:// URLs which fail in main process context.
  ipcMain.handle(IPC_CHANNELS.BLOB_SAVE, async (_, arrayBuffer: Uint8Array, filename: string): Promise<{ diskPath: string } | null> => {
    try {
      const dir = path.join(app.getPath('userData'), 'temp_assets')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, filename)
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer))
      return { diskPath: filePath }
    } catch (err) {
      console.error('[blob:save] failed:', err)
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.TRACKER_REMOVE, async (_, channelId: string) => {
    const workspaces = getWorkspaces()
    for (const ws of workspaces) {
      if (ws.channelId === channelId) {
        cleanupWorkspace(ws.id, ws.downloadedPath)
        deleteWorkspace(ws.id)
      }
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.RENDER_START, async (_, workspaceId: string, metadata: RenderMetadata): Promise<{ success: boolean; outputPath?: string; error?: string }> => {
    return new Promise((resolve) => {
      renderQueue.push({ workspaceId, metadata, resolve })
      if (getPoolStatus().active < 2) {
        startNextQueuedRender()
      }
    })
  })

  ipcMain.handle(IPC_CHANNELS.RENDER_CANCEL, async (_, workspaceId: string) => {
    // Remove from queue if pending
    const queueIdx = renderQueue.findIndex(j => j.workspaceId === workspaceId)
    if (queueIdx !== -1) {
      const job = renderQueue.splice(queueIdx, 1)[0]
      job.resolve({ success: false, error: 'Cancelled before start' })
    }
    // Cancel standard render (via worker pool) and chunked render (direct processes)
    cancelFfmpeg(`single:${workspaceId}`)
    cancelChunked(workspaceId)
    updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
    sendNotification('warning', 'Render cancelled', workspaceId)
    return { success: true }
  })

  // ─── Chunked Parallel Encoding ──────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.RENDER_CHUNKED, async (_, workspaceId: string, metadata: RenderMetadata, config?: ChunkConfig) => {
    const workspace = getWorkspace(workspaceId)
    if (!workspace) return { success: false, workspaceId, error: 'Workspace not found' }
    if (!workspace.downloadedPath) return { success: false, workspaceId, error: 'Video not downloaded' }

    // Resolve video path: disk store only saves filename, scan storage dirs to find actual file
    const videoPath = findDownloadedFileAbs(workspaceId) || metadata.source_video
    if (!fs.existsSync(videoPath)) {
      return { success: false, workspaceId, error: `Source video not found: ${path.basename(videoPath)}` }
    }

    // GPU-aware config injection — RTX 5080 tier gets 8 workers / 120s chunks
    const gpuCaps = getGPUCapabilities()
    const effectiveConfig: ChunkConfig = {
      workers: config?.workers ?? gpuCaps.maxChunkWorkers,
      chunkDuration: config?.chunkDuration ?? (gpuCaps.tier === 'high' ? 120 : 30),
      minChunkDuration: config?.minChunkDuration ?? (gpuCaps.tier === 'high' ? 10 : 5),
      gpuTier: gpuCaps.tier,
    }

    updateWorkspace(workspaceId, { status: 'rendering', renderProgress: 0 })
    sendNotification('info', `GPU MAX (${effectiveConfig.workers}x): ${workspace.videoTitle}`, workspaceId)

    const chunkRenderStartMs = Date.now()
    const chunkQuality = parseInt((metadata.export_resolution || '1080x1920').split('x')[1]) || 1080
    const chunkSpeed = metadata.video_speed ?? 1.0
    const chunkTrimStart = metadata.trim?.start ?? 0
    const chunkTrimEnd = metadata.trim?.end ?? 0
    const chunkTrimDuration = chunkTrimEnd - chunkTrimStart
    console.log(`[TIMER] ═══════════════════════════════════════════════`)
    console.log(`[TIMER] RENDER START (GPU MAX CHUNKED): "${workspace.videoTitle}"`)
    console.log(`[TIMER]   Quality: ${chunkQuality}p | Speed: ${chunkSpeed}x | Trim: ${chunkTrimDuration}s (${chunkTrimStart}s–${chunkTrimEnd}s)`)
    console.log(`[TIMER]   Codec: ${metadata.codec ?? 'hevc'} | Workers: ${effectiveConfig.workers}x | Chunk duration: ${effectiveConfig.chunkDuration}s | Source: ${path.basename(videoPath)}`)
    console.log(`[TIMER]   ═══════════════════════════════════════════════`)

    const outputDir = getOutputPath()
    ensureStorageDirs()

    // Build resolved metadata with absolute video path for FFmpeg
    const resolvedMetadata = { ...metadata, source_video: videoPath }

    const result = await renderChunked(
      resolvedMetadata,
      outputDir,
      effectiveConfig,
      (progress) => {
        updateWorkspace(workspaceId, { renderProgress: Math.round(progress.percent) })
        broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, progress)
      },
    )

    if (result.success) {
      updateWorkspace(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' })
      sendNotification('success', `Done (chunked): ${workspace.videoTitle}`, workspaceId)
      const chunkRenderElapsed = ((Date.now() - chunkRenderStartMs) / 1000).toFixed(1)
      console.log(`[TIMER] RENDER DONE (GPU MAX CHUNKED): "${workspace.videoTitle}" — ${chunkRenderElapsed}s`)
      // Capture thumbnail as base64 before workspace is deleted
      const thumbPath = path.join(getVideoStoragePath(), `thumb_${workspace.id}.jpg`)
      const thumbData = fs.existsSync(thumbPath)
        ? 'data:image/jpeg;base64,' + fs.readFileSync(thumbPath).toString('base64')
        : undefined
      // Auto-archive to D:\HyperClip\Rendered
      ;(async () => {
        try {
          const quality = parseInt((metadata.export_resolution || '1080x1920').split('x')[1])
          const codec = (metadata.codec as string) || 'hevc'
          const archiveResult = await archiveRenderedFile(
            result.outputPath!,
            workspace.channelName,
            workspace.videoTitle,
            quality || 1080,
            codec,
            workspace.fileSize || 0,
            workspace.duration || 0,
          )
          if (archiveResult.success && archiveResult.archivedPath) {
            const record: RenderedVideoRecord = {
              id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              workspaceId: workspace.id,
              channelId: workspace.channelId,
              channelName: workspace.channelName,
              videoTitle: workspace.videoTitle,
              archivedPath: archiveResult.archivedPath,
              outputPath: result.outputPath!,
              quality: quality || 1080,
              codec,
              fileSize: workspace.fileSize || 0,
              duration: workspace.duration || 0,
              thumbnail: workspace.thumbnail,
              thumbnailData: thumbData,
              renderedAt: new Date().toISOString(),
            }
            addRenderedVideo(record)
            cleanupWorkspace(workspace.id, workspace.downloadedPath)
            deleteWorkspace(workspace.id)
            broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, null)
            const _fileSizeMB = ((workspace.fileSize || 0) / 1024 / 1024).toFixed(1)
            console.log(`[TIMER] ARCHIVE DONE: ${archiveResult.archivedPath}`)
            console.log(`[TIMER]   Archive file size: ${_fileSizeMB} MB`)
            console.log(`[TIMER] ═══════════════════════════════════════════════`)
          } else {
            // Archive failed but render succeeded — notify user, keep workspace
            sendNotification('warning', `Render done, archive failed: ${archiveResult.error || 'unknown'}`, workspaceId)
            console.warn(`[AutoArchive] failed: ${archiveResult.error} — workspace ${workspace.id} NOT deleted`)
            updateWorkspace(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' })
          }
        } catch (e) {
          sendNotification('error', `Archive error: ${e}`, workspaceId)
          console.warn('[AutoArchive] failed:', e)
        }
      })()
    } else {
      updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
      sendNotification('error', `Chunked render failed: ${result.error}`, workspaceId)
    }

    // Advance standard queue after chunked render completes (whether success or fail)
    startNextQueuedRender()

    return result
  })

  // ─── Admin Password ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (): Promise<{ videoStoragePath?: string; outputPath?: string; adminPasswordHash?: string; defaultTrimLimit?: number | 'full' }> => {
    return loadSettings()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_, patch: { videoStoragePath?: string; outputPath?: string; adminPasswordHash?: string; defaultTrimLimit?: number | 'full' }): Promise<void> => {
    const settings = loadSettings()
    if (patch.videoStoragePath !== undefined) settings.videoStoragePath = patch.videoStoragePath
    if (patch.outputPath !== undefined) settings.outputPath = patch.outputPath
    if (patch.adminPasswordHash !== undefined) settings.adminPasswordHash = patch.adminPasswordHash
    if (patch.defaultTrimLimit !== undefined) settings.defaultTrimLimit = patch.defaultTrimLimit
    saveSettings(settings)
  })

  // Hash password with SHA-256
  ipcMain.handle(IPC_CHANNELS.ADMIN_CHECK_PASSWORD, async (_, password: string): Promise<{ ok: boolean }> => {
    const settings = loadSettings()
    if (!settings.adminPasswordHash) return { ok: false }
    const hash = crypto.createHash('sha256').update(password).digest('hex')
    return { ok: hash === settings.adminPasswordHash }
  })

  ipcMain.handle(IPC_CHANNELS.ADMIN_SET_PASSWORD, async (_, password: string): Promise<{ success: boolean }> => {
    const hash = crypto.createHash('sha256').update(password).digest('hex')
    const settings = loadSettings()
    settings.adminPasswordHash = hash
    saveSettings(settings)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.ADMIN_HAS_PASSWORD, async (): Promise<{ has: boolean }> => {
    const settings = loadSettings()
    return { has: !!settings.adminPasswordHash }
  })

  // ─── Rendered videos ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.RENDERED_LIST, () => {
    return getRenderedVideos()
  })

  ipcMain.handle(IPC_CHANNELS.RENDERED_ARCHIVE, async (_, workspaceId: string, customArchiveDir?: string): Promise<{ success: boolean; archivedPath?: string; error?: string }> => {
    const ws = getWorkspace(workspaceId)
    if (!ws) return { success: false, error: 'Workspace not found' }
    if (!ws.outputPath) return { success: false, error: 'No output file' }

    // Override archive path if custom path provided
    let prevArchivePath: string | undefined
    if (customArchiveDir) {
      const settings = loadSettings()
      prevArchivePath = settings.renderedOutputPath
      saveSettings({ ...settings, renderedOutputPath: customArchiveDir })
    }

    const quality = (ws as any).quality || 1080
    const codec = (ws as any).codec || 'hevc'

    const result = await archiveRenderedFile(
      ws.outputPath,
      ws.channelName,
      ws.videoTitle,
      quality,
      codec,
      ws.fileSize,
      ws.duration,
    )

    // Restore archive path
    if (customArchiveDir && prevArchivePath !== undefined) {
      const settings = loadSettings()
      saveSettings({ ...settings, renderedOutputPath: prevArchivePath })
    }

    if (result.success && result.archivedPath) {
      // Capture thumbnail as base64 before workspace is deleted
      const thumbPath = path.join(getVideoStoragePath(), `thumb_${ws.id}.jpg`)
      const thumbData = fs.existsSync(thumbPath)
        ? 'data:image/jpeg;base64,' + fs.readFileSync(thumbPath).toString('base64')
        : undefined
      const renderedRecord: RenderedVideoRecord = {
        id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        workspaceId: ws.id,
        channelId: ws.channelId,
        channelName: ws.channelName,
        videoTitle: ws.videoTitle,
        archivedPath: result.archivedPath,
        outputPath: ws.outputPath,
        quality,
        codec,
        fileSize: ws.fileSize,
        duration: ws.duration,
        thumbnail: ws.thumbnail,
        thumbnailData: thumbData,
        renderedAt: new Date().toISOString(),
      }
      addRenderedVideo(renderedRecord)
      // Clean up workspace (input video, blur, output) but keep the archived file
      cleanupWorkspace(ws.id, ws.downloadedPath)
      // Delete the workspace record
      deleteWorkspace(ws.id)
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, null)
    }

    return result
  })

  ipcMain.handle(IPC_CHANNELS.RENDERED_REMOVE, (_, id: string) => {
    return { success: removeRenderedVideo(id) }
  })

  ipcMain.handle(IPC_CHANNELS.RENDERED_OPEN_FOLDER, (_, id?: string) => {
    if (id) {
      const videos = getRenderedVideos()
      const video = videos.find(v => v.id === id)
      if (video && fs.existsSync(video.archivedPath)) {
        showInFolder(video.archivedPath)
        return { success: true }
      }
    }
    // Open the archive folder itself
    openArchiveFolder()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.RENDERED_SET_ARCHIVE_PATH, (_, newPath: string) => {
    const settings = loadSettings()
    saveSettings({ ...settings, renderedOutputPath: newPath })
    return { success: true }
  })

  // Poller status: return current YouTubePoller state
  ipcMain.handle(IPC_CHANNELS.POLLER_STATUS, () => {
    const poller = getYouTubePoller()
    return poller ? poller.getStatus() : null
  })

  // ─── Auth ────────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async () => {
    const cm = getCookieManager()
    return cm.getAuthStatus()
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    const cm = getCookieManager()
    await cm.logout()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.NOTIFICATION_EVENT, { type: 'info', message: 'Đã đăng xuất YouTube' })
    }
    return { success: true }
  })

  // Triggers OAuth flow from LoginScreen (manual re-login when tokens expired)
  ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_START, async () => {
    const cm = getCookieManager()
    await cm.startOAuthFlow()
    // Reload TokenManager so it picks up the newly saved token (saved by youtube_auth.saveTokens)
    getTokenManager().reload()
    return cm.getAuthStatus()
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_SET_CREDS, async (_, clientId: string, clientSecret: string) => {
    const fs2 = await import('fs')
    const path2 = await import('path')
    const os2 = await import('os')
    const configFile = path2.join(os2.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
    const dir = path2.dirname(configFile)
    if (!fs2.existsSync(dir)) fs2.mkdirSync(dir, { recursive: true })
    // Preserve existing per-project credentials, add/update legacy single-project fields
    let config: Record<string, any> = {}
    try {
      if (fs2.existsSync(configFile)) {
        config = JSON.parse(fs2.readFileSync(configFile, 'utf-8'))
        // If old format (array or single-project object), migrate to per-project
        if (!config['proj-01']) {
          // Keep existing non-project entries (like proj-01, proj-02, etc.)
          // Old format was { client_id, client_secret } — don't destroy per-project data
        }
      }
    } catch {}
    // Save as per-project format
    const projectIds = ['proj-01', 'proj-02', 'proj-03', 'proj-04']
    for (const pid of projectIds) {
      if (!config[pid]) config[pid] = {}
      if (!config[pid].clientId) {
        // If this project has no clientId yet, use the provided one (for single-project migration)
        if (!config[pid].clientId) {
          config[pid] = { clientId, clientSecret }
          break // only apply to first project without credentials
        }
      }
    }
    // Also save legacy fields for backward compat
    config['client_id'] = clientId
    config['client_secret'] = clientSecret
    fs2.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8')
    console.log('[OAuth] Credentials saved to oauth_config.json (per-project format)')

    // Also update credentials in oauth_tokens.json — this file is now the single source of truth
    // for credentials. getOAuthClientId() reads from there first.
    try {
      const fs3 = await import('fs')
      const path3 = await import('path')
      const os3 = await import('os')
      const tokensFile = path3.join(os3.tmpdir(), 'hyperclip-cookies', 'oauth_tokens.json')
      if (fs3.existsSync(tokensFile)) {
        const raw = JSON.parse(fs3.readFileSync(tokensFile, 'utf-8'))
        const tokens = Array.isArray(raw) ? raw : []
        let updated = 0
        for (const t of tokens) {
          // Only update entries that don't have explicit credentials (legacy migrated entries)
          if (!(t as any).clientId && !(t as any).clientSecret) {
            (t as any).clientId = clientId
            ;(t as any).clientSecret = clientSecret
            updated++
          }
        }
        if (updated > 0) {
          fs3.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2), 'utf-8')
          console.log(`[OAuth] Updated credentials in oauth_tokens.json for ${updated} token(s)`)
        }
      }
    } catch (e) {
      console.warn('[OAuth] Failed to update oauth_tokens.json:', e)
    }

    // Reload TokenManager so in-memory state reflects new credentials
    try {
      const tokens2 = await import('./services/token_manager.js')
      tokens2.getTokenManager().reload()
      console.log('[OAuth] TokenManager reloaded with new credentials')
    } catch (e) {
      console.warn('[OAuth] Failed to reload TokenManager:', e)
    }

    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_GET_CREDS, async () => {
    const { getOAuthClientId, getOAuthClientSecret } = await import('./services/youtube_auth.js')
    return { clientId: getOAuthClientId(), clientSecret: getOAuthClientSecret() }
  })

  // ─── Per-project OAuth (multi-token) ─────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_START_PER_PROJECT, async (_, clientId: string, clientSecret: string, projectId: string) => {
    const { startOAuthFlow } = await import('./services/youtube_auth.js')
    const result = await startOAuthFlow(clientId, clientSecret, projectId)
    if (result.success && result.tokens && result.projectId) {
      getTokenManager().addToken(result.projectId, clientId, clientSecret, result.tokens)
      console.log(`[OAuth] Token stored in TokenManager for ${result.projectId} — ${result.tokens.access_token.slice(0, 10)}... expires ${new Date(result.tokens.expires_at).toLocaleString()}`)
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.TOKEN_STATUS_LIST, () => {
    return getTokenManager().getAllStatuses()
  })

  ipcMain.handle(IPC_CHANNELS.TOKEN_REMOVE, (_, projectId: string) => {
    getTokenManager().removeToken(projectId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.TOKEN_GET_DEFAULT_CREDS, async () => {
    // Return per-project credentials from oauth_config.json
    const fs = await import('fs')
    const path = await import('path')
    const os = await import('os')
    const configFile = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
    try {
      if (fs.existsSync(configFile)) {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
        // Support new per-project format: { proj-01: { clientId, clientSecret }, ... }
        if (typeof config === 'object' && !config.client_id) {
          return config
        }
      }
    } catch {}
    return {}
  })

  // ─── Key Management ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.KEY_LIST, () => {
    return getKeyManager().getAllKeys()
  })

  ipcMain.handle(IPC_CHANNELS.KEY_ADD, (_, key: string, projectId: string, name: string) => {
    getKeyManager().addKey(key, projectId, name)
    return { success: true, keys: getKeyManager().getAllKeys() }
  })

  ipcMain.handle(IPC_CHANNELS.KEY_REMOVE, (_, key: string) => {
    getKeyManager().removeKey(key)
    return { success: true, keys: getKeyManager().getAllKeys() }
  })

  ipcMain.handle(IPC_CHANNELS.KEY_RESET, (_, key?: string) => {
    const km = getKeyManager()
    let result: { success: boolean; nextReset: number }
    if (key) {
      result = km.resetKey(key)
    } else {
      result = km.resetAll()
    }
    return { success: result.success, keys: km.getAllKeys(), nextReset: result.nextReset }
  })

  // ─── Dynamic Project Management ─────────────────────────────────────────────

  /**
   * List all configured projects with full status.
   * Each project has OAuth credentials + API key + quota stats.
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_LIST, () => {
    const km = getKeyManager()
    const tm = getTokenManager()
    const tokenStatuses = tm.getAllStatuses()
    const keys = km.getAllKeys()

    type ProjectTokenStatus = 'healthy' | 'warning' | 'error' | 'exhausted' | 'unauthorized' | 'no_oauth'

    // Build project list from tokens (each token = 1 project)
    const projects: Array<{
      projectId: string; clientId: string; hasToken: boolean; tokenExpiry: number | null
      usedToday: number; quotaTotal: number; errors: number; status: ProjectTokenStatus
      apiKey: string | null; apiKeyName: string | null; apiKeyUsed: number; apiKeyStatus: string
    }> = tokenStatuses.map(ts => {
      const projectKeys = keys.filter(k => k.projectId === ts.projectId)
      const primaryKey = projectKeys[0] || null
      return {
        projectId: ts.projectId,
        clientId: ts.clientId,
        hasToken: ts.hasToken,
        tokenExpiry: ts.tokenExpiry,
        usedToday: ts.usedToday,
        quotaTotal: ts.quotaTotal,
        errors: ts.errors,
        status: ts.status,
        apiKey: primaryKey?.key || null,
        apiKeyName: primaryKey?.name || null,
        apiKeyUsed: primaryKey?.usedToday || 0,
        apiKeyStatus: primaryKey?.status || 'unauthorized' as string,
      }
    })

    // Also include projects that have API keys but no token
    const tokenProjectIds = new Set(tokenStatuses.map(t => t.projectId))
    for (const k of keys) {
      if (!tokenProjectIds.has(k.projectId)) {
        const existing = projects.find(p => p.projectId === k.projectId)
        if (!existing) {
          projects.push({
            projectId: k.projectId,
            clientId: '',
            hasToken: false,
            tokenExpiry: null,
            usedToday: 0,
            quotaTotal: 9500,
            errors: 0,
            status: 'no_oauth',
            apiKey: k.key,
            apiKeyName: k.name,
            apiKeyUsed: k.usedToday,
            apiKeyStatus: k.status,
          })
        }
      }
    }

    return projects
  })

  /**
   * Add a project: OAuth credentials + API key.
   * 1. Save OAuth credentials (clientId + clientSecret)
   * 2. Start OAuth browser flow to get token
   * 3. Save API key
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_ADD, async (_, data: {
    projectId: string
    clientId: string
    clientSecret: string
    apiKey: string
    apiKeyName?: string
  }) => {
    const { projectId, clientId, clientSecret, apiKey, apiKeyName } = data
    const tm = getTokenManager()
    const km = getKeyManager()

    // 0. Save credentials to oauth_config.json so re-authorize works later
    const fs = await import('fs')
    const pathMod = await import('path')
    const os = await import('os')
    const configFile = pathMod.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
    let config: Record<string, any> = {}
    try {
      if (fs.existsSync(configFile)) config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    } catch {}
    config[projectId] = { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
    // Also save legacy fields for backward compat
    config['client_id'] = clientId.trim()
    config['client_secret'] = clientSecret.trim()
    if (!fs.existsSync(pathMod.dirname(configFile))) {
      fs.mkdirSync(pathMod.dirname(configFile), { recursive: true })
    }
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8')
    console.log(`[Project] Credentials saved for ${projectId}`)

    // 1. Save API key
    const name = apiKeyName?.trim() || `Project ${projectId}`
    km.addKey(apiKey.trim(), projectId, name)

    // 2. Start OAuth flow
    const { startOAuthFlow } = await import('./services/youtube_auth.js')
    const result = await startOAuthFlow(clientId.trim(), clientSecret.trim(), projectId)

    if (result.success && result.tokens && result.projectId) {
      tm.addToken(result.projectId, clientId.trim(), clientSecret.trim(), result.tokens)
      console.log(`[Project] Added ${projectId}: OAuth OK + API key OK`)
      return { success: true, projectId, oauthResult: result }
    }

    // Key was saved but OAuth failed
    return {
      success: false,
      projectId,
      error: result.error || 'OAuth failed — API key saved but token not authorized',
      oauthResult: result,
    }
  })

  /**
   * Remove a project: delete both token and API key.
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_REMOVE, (_, projectId: string) => {
    const tm = getTokenManager()
    const km = getKeyManager()
    tm.removeToken(projectId)
    // Remove all keys belonging to this project
    const keys = km.getAllKeys().filter(k => k.projectId === projectId)
    for (const k of keys) {
      km.removeKey(k.key)
    }
    console.log(`[Project] Removed ${projectId}: token + ${keys.length} key(s)`)
    return { success: true }
  })

  /**
   * Reset quota for a project (both token and key stats).
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_RESET_QUOTA, (_, projectId: string) => {
    const tm = getTokenManager()
    const km = getKeyManager()
    // Reset token quota by reloading stats
    const keys = km.getAllKeys().filter(k => k.projectId === projectId)
    for (const k of keys) {
      km.resetKey(k.key)
    }
    // For tokens, we clear stats by removing and re-adding
    const token = tm.getToken(projectId)
    if (token) {
      tm.removeToken(projectId)
      tm.addToken(projectId, token.clientId, token.clientSecret, {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at,
        token_type: token.token_type,
      })
    }
    return { success: true }
  })

  /**
   * Re-authorize a project: read credentials from oauth_config.json and trigger OAuth flow.
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_REAUTHORIZE, async (_, projectId: string) => {
    const fs = await import('fs')
    const path = await import('path')
    const os = await import('os')
    const configFile = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')

    let clientId = ''
    let clientSecret = ''

    try {
      if (fs.existsSync(configFile)) {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
        // Try per-project credentials first, then legacy fields
        const proj = config[projectId]
        if (proj?.clientId && proj?.clientSecret) {
          clientId = proj.clientId
          clientSecret = proj.clientSecret
        } else if (config.client_id && config.client_secret) {
          clientId = config.client_id
          clientSecret = config.client_secret
        }
      }
    } catch (e) {
      console.warn(`[Project] Failed to read credentials for ${projectId}:`, e)
    }

    if (!clientId || !clientSecret) {
      return { success: false, error: 'Không tìm thấy OAuth credentials cho project này. Vui lòng xóa và thêm lại project.' }
    }

    const { startOAuthFlow } = await import('./services/youtube_auth.js')
    const result = await startOAuthFlow(clientId, clientSecret, projectId)

    if (result.success && result.tokens) {
      getTokenManager().addToken(projectId, clientId, clientSecret, result.tokens)
      console.log(`[Project] Re-authorized ${projectId}`)
      return { success: true }
    }

    return { success: false, error: result.error || 'OAuth failed' }
  })

  // ─── Chrome Session Management ───────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
    const sm = getSessionManager()
    await sm.ensureInit()
    return sm.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_REFRESH_ALL, async () => {
    const sm = getSessionManager()
    const count = await sm.refreshAll()
    return { success: true, refreshedCount: count }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_OPEN_LOGIN, async (_, profileId: string) => {
    const sm = getSessionManager()
    sm.openLoginWindow(profileId)
    return { success: true }
  })
}

// Relay auth status changes to renderer (registered at module load — catches early OAuth events)
authEvents.on('authUpdated', (status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.AUTH_UPDATE_EVENT, status)
  }
})

// Cookie critical failure → redirect renderer to login screen
authEvents.on('cookieCritical', (errorMsg) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log(`[HyperClip] Cookie critical failure: ${errorMsg} — redirecting to login`)
    mainWindow.webContents.send(IPC_CHANNELS.AUTH_COOKIE_CRITICAL, errorMsg)
    // Navigate to settings/login page
    mainWindow.webContents.send('navigate', '/settings')
  }
})

// Relay channel sync events so frontend re-fetches channel list
channelEvents.on('channelsSynced', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.CHANNEL_SYNCED_EVENT, null)
  }
})

// ─── System monitor ────────────────────────────────────────────────────────────
function startSystemMonitor() {
  // 5s interval: GPU/RAM stats don't need sub-second resolution.
  // 24/7 app: this saves ~30k calls/day vs 2s interval.
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const stats = collectSystemStats()
    mainWindow.webContents.send(IPC_CHANNELS.SYSTEM_STATS_EVENT, stats)
  }, 5000)
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────
async function quitAll() {
  await stopYouTubePoller()
  cancelAllFfmpeg()
  cancelAllChunked()
  renderQueue.forEach(job => job.resolve({ success: false, error: 'App shutting down' }))
  renderQueue.length = 0
  if (nextServerOwned && nextServer) nextServer.kill()
  getTokenManager().dispose()
  mainWindow?.destroy()
  app.quit()
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
ensureStorageDirs()

app.whenReady().then(async () => {
  console.log('[HyperClip] Starting...')

  // Validate FFmpeg before any render can happen
  const ffmpegPath = getFfmpegPath()
  try {
    await validateFfmpeg(ffmpegPath)
  } catch (e) {
    console.error('[HyperClip] FFmpeg validation failed — renders will NOT work:', e)
    sendNotification('error', `FFmpeg not available: ${e}. Renders will fail.`)
  }

  // Auto-boot Next.js if not already running on port 3000
  const nextRunning = await isPortOpen(NEXT_PORT)
  if (nextRunning) {
    console.log(`[HyperClip] Next.js already running on port ${NEXT_PORT}`)
  } else {
    await startNextServer()
  }

  // Register local-video:// protocol to serve downloaded video files to renderer.
  // Chromium blocks file:// URLs in <video src> — this bypasses that restriction.
  // URL format MUST be local-video:///C:/Users/... (THREE slashes after scheme).
  // Two-slash format (local-video://C:/...) causes Chromium to treat C: as the
  // "host", stripping it during PathForRequest → handler gets C/Users/... (broken path).
  // With three slashes, Chromium treats the path as /C:/Users/... and returns it correctly.
  protocol.registerFileProtocol('local-video', (request, callback) => {
    let filePath = request.url.replace(/^local-video:\/\/?\/?/, '')
    // Chromium may include a leading slash in the path for three-slash URLs.
    // Normalize: strip one leading slash so we get C:/Users/... (valid Windows path).
    if (filePath.startsWith('/')) filePath = filePath.slice(1)
    callback({ path: decodeURIComponent(filePath) })
  })

  createWindow()
  createTray()
  await registerIPCHandlers()

  // Resolve missing channelIds for demo channels at startup
  resolveChannelIdsForPoll()

  // Scan storage directory for existing downloaded files — register them as "seen"
  // so poll won't re-download files already on disk
  scanExistingDownloadedFiles()

  // Init cookie manager (auto-refresh every 15m + sub sync every 2m)
  const cookieResult = await initCookieManager()
  if (cookieResult.success) {
    console.log(`[HyperClip] Cookies ready (${cookieResult.browser}, ${cookieResult.cookies.length} cookies)`)
  } else {
    console.warn(`[HyperClip] Cookie init failed: ${cookieResult.error} — polling will retry`)
  }

  // Start auto-refresh timer (cookies + subscription sync)
  getCookieManager().startAutoRefresh()

  // Start polling ONLY after the renderer page has fully loaded.
  // This guarantees the window + frontend IPC listeners are ready before
  // any broadcast() call, so workspaces are always created and shown in real-time.
  if (mainWindow) {
    // did-finish-load fires immediately if the page is already loaded
    mainWindow.webContents.once('did-finish-load', () => {
      startYouTubePoller(20000, (videos) => {
        for (const v of videos) {
          showWindowsToast('📥 Video mới!', `${v.channelName}: ${v.title}`)
          autoDownloadFromWebSub(
            v.videoId, v.channelId, v.channelName, v.title,
            v.publishedAt ? new Date(v.publishedAt).toISOString() : undefined,
            v.detectedAt ? new Date(v.detectedAt).toISOString() : undefined,
          )
        }
      })
      console.log('[HyperClip] Auto-ingestion active (YouTube API — 20s interval, batched channels)')
      console.log(`[HyperClip] Ready → http://localhost:${NEXT_PORT}`)
      startSystemMonitor()
    })
  }
})

app.on('window-all-closed', quitAll)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

process.on('uncaughtException', (err) => {
  console.error('[HyperClip] Uncaught exception:', err)
  sendNotification('error', `Uncaught error: ${err.message}`)
})
