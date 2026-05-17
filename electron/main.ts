import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, protocol, dialog, crashReporter } from 'electron'
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
import { collectSystemStats, getGPUCapabilities, detectSystemProfile, type SystemStats } from './services/system.js'
import { runDiagnostics } from './services/diagnostics.js'
import {
  getWorkspaces, getWorkspace, addWorkspace, updateWorkspace, deleteWorkspace,
  getChannels, getChannel, addChannel, updateChannel, removeChannel, markVideoSeen, loadSeenVideos, saveSeenVideos, type StoredChannel,
  type WorkspaceData,
  getRenderedVideos, addRenderedVideo, removeRenderedVideo, type RenderedVideoRecord, type RenderConfigRecord, type SourceInfoRecord,
} from './services/store.js'
import { downloadVideo, getVideoInfo, getChannelInfo, getChannelId, preScaleVideo, type YtdlpVideoInfo, type YtdlpChannelInfo } from './services/youtube.js'
import { renderVideo, renderChunked, generateBlurBackground, extractVideoThumbnail, cancelChunked, cancelAllChunked, probeVideoAspect, trimVideo, type RenderMetadata, type RenderProgress, type ChunkConfig } from './services/ffmpeg.js'
import { cancelFfmpeg, cancelAllFfmpeg, getPoolStatus } from './services/worker-pool.js'
import { getFfmpegPath, validateFfmpeg } from './services/ffmpeg-paths.js'
import { getAppStoreDir, getHyperClipBaseDir, getLegacyDataPath } from './services/paths.js'
import { getVideoStoragePath, getOutputPath, generateWorkspacePaths, cleanupWorkspace, ensureStorageDirs, loadSettings, saveSettings, archiveRenderedFile, getArchivePath, openArchiveFolder, showInFolder, getFreeDiskSpace, getRamDiskInfo } from './services/ramdisk.js'
import { createYouTubePoller, stopYouTubePoller, getYouTubePoller } from './services/youtube_poller.js'
import { refreshChannelCache } from './services/subscription_feed.js'
import { initCookieManager, getCookieManager, authEvents, channelEvents } from './services/cookie_manager.js'
import { getKeyManager } from './services/key_manager.js'
import { getProjectManager } from './services/project_manager.js'
import { getTokenManager } from './services/token_manager.js'
import { killPersistentChrome } from './services/cdp.js'
import { getSessionManager } from './services/chrome_cookies.js'
import { getInnertubePoolSync } from './services/innertube_client.js'
import type { SessionStatus } from './services/chrome_cookies.js'
import { log, getLogDir, getSystemSnapshot } from './services/logger.js'
import { addOpLog, getOpLogs, clearOpLogs, opLog } from './services/operation_log.js'

import { devLog } from './services/dev_log.js'
import { checkHealthAlerts, sendHealthAlerts, recordVideoDetected, recordDownloadFail, recordDownloadSuccess } from './services/health_alerts.js'
import { startE2EServer, stopE2EServer } from './services/e2e_server.js'

// Fix UTF-8 console output on Windows — set code page to 65001 (UTF-8)
if (process.platform === 'win32') {
  import('child_process').then(({ execSync }) => {
    try { execSync('chcp 65001', { stdio: 'ignore' }) } catch {}
  }).catch(() => {})
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV !== 'production'
const NEXT_PORT = parseInt(process.env.HYPERCLIP_PORT || '3000', 10)

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

// ─── Background Download Queue ─────────────────────────────────────────────────
// Non-blocking pre-download: poller detects video → immediately spawns download
// in background without blocking the next poll. Multiple videos from same poll
// download in parallel instead of sequentially.
// Concurrency is RAM-adaptive: spawns new downloads only when enough free memory.
// - 4050 / 24GB RAM: max 2 concurrent (6-8 GB needed per download)
// - 5080 / 64GB RAM: max 3 concurrent (headroom for FFmpeg workers too)
const bgDownloadQueue: Array<{
  videoId: string; channelId: string; channelName: string; title: string
  publishedAt?: string; detectedAt?: string; workspaceId?: string
}> = []
let activeBgDownloads = 0

/** Get safe concurrent download count.
 *  User's setting (maxConcurrentDownloads) takes priority if set (non-zero).
 *  Falls back to RAM-adaptive logic otherwise.
 *  Each download needs ~2-4 GB (buffers + yt-dlp heap + OS network buffers).
 *  FFmpeg workers also need RAM, so leave headroom.
 */
function getMaxConcurrentDownloads(): number {
  const settings = loadSettings()
  if (settings.maxConcurrentDownloads && settings.maxConcurrentDownloads > 0) {
    return settings.maxConcurrentDownloads
  }
  const freeGB = os.freemem() / (1024 ** 3)
  const totalGB = os.totalmem() / (1024 ** 3)
  if (totalGB >= 48) return 3   // RTX 5080 64GB: 3 concurrent
  if (freeGB >= 8) return 2     // 4050 24GB: 2 concurrent (8GB+ free after OS)
  if (freeGB >= 4) return 1     // Low RAM: 1 at a time
  return 0                       // Too low: pause queue
}

/** Enqueue a video for non-blocking background download.
 *  PHASE 1 (immediate): create workspace with status='waiting' → UI shows video right away.
 *  PHASE 2 (background): download runs in bg queue, updates workspace to 'downloading'→'ready'.
 *
 *  Quality is determined by user's setting (autoDownloadQuality in Settings).
 */
function enqueueBgDownload(video: {
  videoId: string; channelId: string; channelName: string; title: string
  publishedAt?: number; detectedAt?: number
}): void {
  // Respect user's auto-download toggle
  const settings = loadSettings()
  if (settings.autoDownloadEnabled === false) {
    devLog(`[BgDownload] Auto-download disabled — skipping ${video.videoId}`)
    return
  }

  // Deduplicate: don't queue if already pending or active
  if (bgDownloadQueue.some(v => v.videoId === video.videoId)) {
    devLog(`[BgDownload] already queued: ${video.videoId}`)
    return
  }

  const existingWorkspaces = getWorkspaces()
  const alreadyHasWorkspace = existingWorkspaces.some(
    ws => ws.videoId === video.videoId && ['waiting', 'downloading', 'ready', 'editing', 'rendering', 'done'].includes(ws.status)
  )
  if (alreadyHasWorkspace) {
    devLog(`[BgDownload] workspace already exists for ${video.videoId}`)
    return
  }

  // PHASE 1: Create workspace IMMEDIATELY — user sees video in UI within seconds of detection
  const nowIso = new Date().toISOString()
  const channel = getChannel(video.channelId)
  const resolvedChannelName = video.channelName || channel?.name || 'Unknown Channel'
  const settings2 = loadSettings()
  const trimLimit = settings2.defaultTrimLimit ?? 10

  const ws = addWorkspace({
    channelId: video.channelId,
    channelName: resolvedChannelName,
    channelColor: '#00B4FF',
    videoId: video.videoId,
    videoTitle: video.title,
    videoUrl: 'https://www.youtube.com/watch?v=' + video.videoId,
    thumbnail: `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`,
    duration: 0,
    trimLimit,
    status: 'waiting',
    renderProgress: 0,
    downloadedAt: nowIso,
    downloadedPath: '',
    blurBackgroundPath: '',
    outputPath: '',
    metadataPath: '',
    fileSize: 0,
    renderMetadata: null,
    publishedAt: video.publishedAt ? new Date(video.publishedAt).toISOString() : undefined,
    detectedAt: video.detectedAt ? new Date(video.detectedAt).toISOString() : nowIso,
    downloadQuality: settings2.autoDownloadQuality ?? '720',
  })

  devLog(`[BgDownload] enqueue: ${video.videoId} (${video.title}) → workspace=${ws.id}, queue=${bgDownloadQueue.length + 1}`)

  // Broadcast immediately so UI shows the video right away
  broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, ws)
  showWindowsToast('📥 Video mới!', `${resolvedChannelName}: ${video.title}`)
  broadcast(IPC_CHANNELS.ACTIVITY_EVENT, {
    id: ws.id,
    timestamp: Date.now(),
    type: 'detected',
    title: `Phát hiện: ${video.title.length > 45 ? video.title.slice(0, 45) + '…' : video.title}`,
    subtitle: `${resolvedChannelName} • đang tải...`,
    workspaceId: ws.id,
  })

  bgDownloadQueue.push({
    videoId: video.videoId,
    channelId: video.channelId,
    channelName: resolvedChannelName,
    title: video.title,
    publishedAt: video.publishedAt ? new Date(video.publishedAt).toISOString() : undefined,
    detectedAt: video.detectedAt ? new Date(video.detectedAt).toISOString() : nowIso,
    workspaceId: ws.id,
  })
  processBgDownloadQueue()
}

/** Process next item in queue if under concurrency limit.
 *  Limit is RAM-adaptive (2 on 24GB, 3 on 64GB).
 */
function processBgDownloadQueue(): void {
  const maxConcurrent = getMaxConcurrentDownloads()
  devLog(`[BgDownload] processQueue: active=${activeBgDownloads}, max=${maxConcurrent}, queue=${bgDownloadQueue.length}`)
  while (activeBgDownloads < maxConcurrent && bgDownloadQueue.length > 0) {
    const item = bgDownloadQueue.shift()!
    devLog(`[BgDownload] starting: ${item.videoId} (${item.title}), active=${activeBgDownloads + 1}`)
    activeBgDownloads++
    // Respect user's download quality setting from Settings
    const settings = loadSettings()
    const bgQuality = settings.autoDownloadQuality ?? '720'
    autoDownloadFromWebSub(
      item.videoId, item.channelId, item.channelName, item.title,
      item.publishedAt, item.detectedAt,
      bgQuality,
      item.workspaceId,
    ).catch((err) => {
      console.error('[BgDownload] Failed:', item.videoId, err)
    }).finally(() => {
      activeBgDownloads--
      processBgDownloadQueue()
    })
  }
}

const renderQueue: Array<{
  workspaceId: string
  metadata: RenderMetadata
  resolve: (r: { success: boolean; outputPath?: string; error?: string }) => void
}> = []

// Track which workspace is currently open in the DetailEditor — used to protect from auto-cleanup
let _activeWorkspaceId: string | null = null

function startNextQueuedRender(): void {
  const max = loadSettings().maxConcurrentRenders ?? 2
  if (getPoolStatus().active >= max) return
  if (renderQueue.length === 0) return

  const job = renderQueue.shift()!
  executeRenderJob(job)
}

function executeRenderJob(job: typeof renderQueue[0]): void {
  const { workspaceId, metadata, resolve } = job
  const workspace = getWorkspace(workspaceId)
  if (!workspace) { resolve({ success: false, error: 'Workspace not found' }); startNextQueuedRender(); return }

  // Use pre-scaled path if available (auto-render pre-scaled the source to output resolution).
  // Falls back to downloadedPath, then findDownloadedFileAbs, then metadata source.
  const videoPath = workspace.preScaledPath || workspace.downloadedPath || findDownloadedFileAbs(workspaceId) || metadata.source_video
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
  devLog(`[TIMER] ═══════════════════════════════════════════════`)
  devLog(`[TIMER] RENDER START: "${workspace.videoTitle}"`)
  devLog(`[TIMER]   Quality: ${renderQuality}p | Speed: ${renderSpeed}x | Trim: ${trimDuration}s (${trimStart}s–${trimEnd}s)`)
  devLog(`[TIMER]   Codec: ${metadata.codec ?? 'hevc'} | Source: ${path.basename(videoPath)}`)
  devLog(`[TIMER]   ═══════════════════════════════════════════════`)

  updateWorkspace(workspaceId, { status: 'rendering', renderProgress: 0 })
  sendNotification('info', `Rendering: ${workspace.videoTitle}`, workspaceId)
  broadcast(IPC_CHANNELS.ACTIVITY_EVENT, {
    id: workspaceId,
    timestamp: Date.now(),
    type: 'rendering',
    title: `Render: ${workspace.videoTitle?.length > 38 ? workspace.videoTitle.slice(0, 38) + '…' : (workspace.videoTitle || 'Video')}`,
    subtitle: `${renderQuality}p • ${metadata.codec ?? 'hevc'} • ${trimDuration}s`,
    workspaceId,
  })

  const outputDir = getOutputPath()
  ensureStorageDirs()

  // Build resolved metadata with workspace state merged in:
  // 1. blur_background: prefer workspace's blurBackgroundPath over metadata's value.
  //    Without this, a 'blur' backgroundType falls back to solid black (no thumbnail canvas bg).
  // 2. source_video: always absolute path from workspace.
  // 3. overlays: keep EXACTLY as metadata specifies (auto-render: [], manual: from editorState).
  // 4. backgroundImage: for landscape 'image' type, fall back to workspace thumbnail if not set.
  const wsBlurBg = workspace?.blurBackgroundPath || ''
  const wsThumbPath = path.join(getVideoStoragePath(), `thumb_${workspaceId}.jpg`)
  const resolvedMetadata = {
    ...metadata,
    source_video: videoPath,
    // Prefer IPC metadata's blur_background (manual render), fallback to workspace state (auto-render/recovery).
    blur_background: metadata.blur_background || wsBlurBg,
    // For landscape with 'image' type but no backgroundImage → use workspace thumbnail.
    // Only apply when blur is not available (landscape videos don't generate blur).
    backgroundImage: !metadata.backgroundImage && !wsBlurBg && fs.existsSync(wsThumbPath) ? wsThumbPath : metadata.backgroundImage,
  }

  const gpuTier = getGPUCapabilities().tier
  renderVideo(resolvedMetadata, outputDir, (progress: RenderProgress) => {
    updateWorkspace(workspaceId, { renderProgress: progress.percent })
    broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, progress)
  }, gpuTier).then((result) => {
    const renderElapsed = ((Date.now() - renderStartMs) / 1000).toFixed(1)
    if (result.success) {
      updateWorkspace(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' })
      sendNotification('success', `Done: ${workspace.videoTitle}`, workspaceId)
      broadcast(IPC_CHANNELS.ACTIVITY_EVENT, {
        id: workspaceId,
        timestamp: Date.now(),
        type: 'done',
        title: `Xong: ${workspace.videoTitle?.length > 40 ? workspace.videoTitle.slice(0, 40) + '…' : (workspace.videoTitle || 'Video')}`,
        subtitle: `${renderElapsed}s`,
        workspaceId,
      })
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
            const renderDurationMs = Date.now() - renderStartMs
            const renderConfigRecord: RenderConfigRecord = {
              exportResolution: metadata.export_resolution || '1080x1920',
              fps: metadata.fps_target || 30,
              speed: metadata.video_speed ?? 1.0,
              codec: (metadata.codec as string) || 'hevc',
              preset: metadata.preset,
              tune: metadata.tune,
              backgroundType: metadata.backgroundType,
              audioCodec: metadata.audioCodec,
              audioBitrate: metadata.audioBitrate,
              trimStart: metadata.trim?.start,
              trimEnd: metadata.trim?.end,
              isShort: metadata.isShort,
              vidHeightPct: metadata.vidHeightPct,
              gpuTier: gpuTier,
            }
            const sourceInfoRecord: SourceInfoRecord = {
              originalResolution: workspace.videoResolution,
              originalDuration: workspace.duration || 0,
              originalFileSize: workspace.fileSize || 0,
              downloadQuality: workspace.downloadQuality,
            }
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
              videoResolution: workspace.videoResolution,
              renderedAt: new Date().toISOString(),
              renderDurationMs,
              renderConfig: renderConfigRecord,
              sourceInfo: sourceInfoRecord,
            }
            addRenderedVideo(record)
            // Cleanup pre-scaled source file after successful render
            if (workspace.preScaledPath) {
              try { fs.unlinkSync(workspace.preScaledPath) } catch {}
            }
            // TODO (debug): keep workspace in pipeline instead of deleting — for testing
            // cleanupWorkspace(workspace.id, workspace.downloadedPath)
            // deleteWorkspace(workspace.id)
            // broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, null)
            const _fileSizeMB = ((workspace.fileSize || 0) / 1024 / 1024).toFixed(1)
            const totalElapsed = ((Date.now() - renderStartMs) / 1000).toFixed(1)
            devLog(`[TIMER] ARCHIVE DONE: ${archiveResult.archivedPath}`)
            devLog(`[TIMER]   Archive file size: ${_fileSizeMB} MB | Total elapsed: ${totalElapsed}s`)
            devLog(`[TIMER] ═══════════════════════════════════════════════`)
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
      devLog(`[TIMER] RENDER DONE: "${workspace.videoTitle}" — ${renderElapsed}s (${renderQuality}p @ ${renderSpeed}x speed)`)
    } else {
      devLog(`[TIMER] RENDER FAILED: "${workspace.videoTitle}" — ${renderElapsed}s — ${result.error}`)
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
  onVideos: (videos: Array<{ videoId: string; channelId: string; channelName: string; title: string; publishedAt?: number; detectedAt?: number }>) => void,
  onDegraded?: () => void
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
    onDegraded,
  })
  poller.start()
}

// ─── Auto-download from new video detected by poller ────────────────────────────
/**
 * Auto-download a video detected by the poller.
 * Phase 1 (enqueueBgDownload): workspace with status='waiting' created immediately — UI sees video right away.
 * Phase 2 (this function): background download updates workspace to 'downloading'→'ready'.
 *
 * @param workspaceId If provided, use this pre-created 'waiting' workspace instead of creating a new one.
 */
async function autoDownloadFromWebSub(
  videoId: string, channelId: string, channelName: string, title: string,
  publishedAt?: string, detectedAt?: string,
  qualityOverride?: string,
  workspaceId?: string,
) {
  try {
    const storagePath = getVideoStoragePath()
    ensureStorageDirs()

    const settings = loadSettings()
    const autoTrimLimit: number | 'full' = settings.defaultTrimLimit ?? 10
    const autoQuality = qualityOverride ?? settings.autoDownloadQuality ?? '720'
    const autoRenderEnabled = settings.autoRender === true

    // Find the 'waiting' workspace created by enqueueBgDownload
    let ws: ReturnType<typeof addWorkspace> | WorkspaceData | null | undefined
    if (workspaceId) {
      ws = getWorkspace(workspaceId)
    }
    if (!ws) {
      // Fallback: find by videoId (e.g., retry path without workspaceId)
      const existingWorkspaces = getWorkspaces()
      ws = existingWorkspaces.find(ws2 => ws2.videoId === videoId && ['waiting', 'error'].includes(ws2.status))
    }
    if (!ws) {
      devLog(`[Auto] No 'waiting' workspace for ${videoId} — skipping (already handled or duplicate)`)
      return
    }

    // Retry backoff: skip if retryableAt not reached
    if (ws.status === 'waiting' && (ws as any).retryableAt && Date.now() < new Date((ws as any).retryableAt).getTime()) {
      const remainingMin = Math.ceil((new Date((ws as any).retryableAt).getTime() - Date.now()) / 60000)
      devLog(`[Auto] Skipping ${title} — retryableAt not reached (${remainingMin}m remaining)`)
      return
    }

    // Update to 'downloading' so UI reflects actual progress
    updateWorkspace(ws.id, { status: 'downloading', downloadProgress: 0 })
    broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
    broadcast(IPC_CHANNELS.ACTIVITY_EVENT, {
      id: ws.id,
      timestamp: Date.now(),
      type: 'downloading',
      title: `Đang tải: ${title.length > 40 ? title.slice(0, 40) + '…' : title}`,
      subtitle: `${channelName} • ${autoQuality}p`,
      workspaceId: ws.id,
    })

    const channel = getChannel(channelId)
    const finalChannelName = channelName || channel?.name || 'Unknown Channel'
    const detectedAtNow = new Date().toISOString()
    devLog(`[Auto] Downloading: ${title} (${videoId}) from ${finalChannelName}, workspace=${ws.id}`)

    // OPTIMIZATION #1: Pre-probe video duration before download.
    // getVideoInfo --no-download is fast (~1-3s). Running it first lets multi-instance
    // skip its internal probe, saving ~1-3s on the critical path for 1080p videos.
    const videoUrl = 'https://www.youtube.com/watch?v=' + videoId
    let preFetchedDuration: number | undefined
    try {
      const probe = await getVideoInfo(videoUrl)
      if (probe?.duration && probe.duration > 0) {
        preFetchedDuration = probe.duration
        devLog(`[Auto] Pre-probed duration: ${preFetchedDuration}s`)
      }
    } catch {
      // Probe failed — multi-instance will probe internally (acceptable)
    }

    devLog(`[Auto] DOWNLOAD START: "${title}" quality=${autoQuality}p trimLimit=${autoTrimLimit === 'full' ? 'full' : autoTrimLimit + 'm'}`)

    // Get PO Token from Innertube pool — needed for android client to access 1080p+ formats
    // Strategy:
    // PO Token extraction disabled — yt-dlp auto client + Chrome cookies → 1080p H.264 (2026-05-15)
    const po_token: string | null = null

    // Export Chrome cookies (cached 5 min) for yt-dlp authentication (bypasses EJS challenge)
    const { getYtCookiesFile } = await import('./services/po_token.js')
    const ytCookiesFile = await getYtCookiesFile()

    const downloadStartMs = Date.now()
    let result = await downloadVideo({
      workspaceId: ws.id,
      videoUrl,
      outputDir: storagePath,
      trimLimit: autoTrimLimit,
      quality: autoQuality,
      preFetchedDuration, // ← multi-instance uses this instead of re-probing
      po_token,
      ytCookiesFile, // ← Chrome cookies bypass EJS challenge → enables 1080p VP9
      onProgress: (progress) => {
        broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
          workspaceId: ws.id,
          percent: progress.percent,
          speed: progress.speed,
          eta: progress.eta,
        })
      },
    })

    if (!result.success || !result.filePath) {
      // Download failed — mark workspace as 'error' with retry backoff
      const errorMsg = result.error || ''
      const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('Video unavailable')
      const isPrivateError = errorMsg.includes('Private video') || errorMsg.includes('private')
      recordDownloadFail()

      if (isNotAvailable) {
        devLog(`[Auto] Video permanently unavailable: ${title} (${videoId})`)
        updateWorkspace(ws.id, { status: 'error' })
        markVideoSeen(channelId, videoId)
      } else if (isPrivateError) {
        // "Private video" from yt-dlp means YouTube session validation failed for this client.
        // NOT that the video is actually private. Retry with tv_embedded client (more lenient).
        devLog(`[Auto] "Private video" — retrying with tv_embedded client...`)
        const retryResult = await downloadVideo({
          workspaceId: ws.id,
          videoUrl,
          outputDir: storagePath,
          trimLimit: autoTrimLimit,
          quality: autoQuality,
          preFetchedDuration,
          po_token: null,
          ytCookiesFile,
          playerClient: 'tv_embedded',
          onProgress: (progress) => {
            broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
              workspaceId: ws.id,
              percent: progress.percent,
              speed: progress.speed,
              eta: progress.eta,
            })
          },
        })
        if (retryResult.success && retryResult.filePath) {
          result = retryResult
        } else {
          devLog(`[Auto] Retry also failed: ${retryResult.error}`)
          const retryableAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
          updateWorkspace(ws.id, { status: 'error', retryableAt })
          broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
          return
        }
      } else {
        devLog(`[Auto] Download failed (retryable): ${result.error}`)
        // Set retryableAt = 5 minutes from now
        const retryableAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
        updateWorkspace(ws.id, { status: 'error', retryableAt })
      }
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
      return
    }

    // Download succeeded — probe aspect ratio to determine if this is a 9:16 vertical video
    const aspect = await probeVideoAspect(result.filePath)
    devLog(`[Auto] Aspect: ${aspect ? `${aspect.width}x${aspect.height} (${aspect.isShort ? '9:16 VERTICAL — skipping' : '16:9 LANDSCAPE — OK'})` : 'unknown'}`)

    // Skip 9:16 vertical videos — user only wants landscape 16:9 content
    if (aspect?.isShort) {
      devLog(`[Auto] Skipping 9:16 vertical video: ${title}`)
      try { fs.unlinkSync(result.filePath) } catch {}
      updateWorkspace(ws.id, { status: 'error' })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
      markVideoSeen(channelId, videoId)
      return
    }

    const downloadElapsed = ((Date.now() - downloadStartMs) / 1000).toFixed(1)
    const fileSizeMB = result.fileSize ? (result.fileSize / 1024 / 1024).toFixed(1) : '?'
    devLog(`[Auto] DOWNLOAD DONE: "${title}" (${downloadElapsed}s, ${fileSizeMB} MB)`)
    playSuccessBeep()

    // Phase 1+2: Parallel — thumbnail, video info, trim, and blur ALL run simultaneously.
    // Saves ~15-20s vs sequential execution.
    const thumbnailPath = path.join(storagePath, `thumb_${ws.id}.jpg`)
    const trimLimitSec = typeof autoTrimLimit === 'number' ? autoTrimLimit * 60 : 0
    const doTrim = trimLimitSec > 0 && (result.duration || 0) > trimLimitSec
    const isLandscape = !aspect?.isShort
    const { blurPath } = generateWorkspacePaths(ws.id)

    // Run ALL post-processing tasks in parallel: thumbnail, info, trim (if needed), blur (if vertical).
    // Landscape videos skip blur (they use thumbnail as background) — saves ~10-15s.
    // Destructured as [thumbResult, videoInfo, trimData, blurResult]
    // CRITICAL: do NOT delete original file here — thumbnail/info read from it in parallel.
    // Delete it AFTER all parallel tasks complete (after Promise.all resolves).
    const [thumbResult, videoInfo, trimData, blurResult] = await Promise.all([
      extractVideoThumbnail(result.filePath, thumbnailPath),
      getVideoInfo('https://www.youtube.com/watch?v=' + videoId),
      // Trim: stream-copy is fast (~1-3s), run in parallel.
      (async () => {
        if (!doTrim) return null
        const trimmedPath = result.filePath!.replace(/(\.\w+)$/, '_trimmed$1')
        const r = await trimVideo(result.filePath!, trimmedPath, 0, trimLimitSec)
        if (r.success) {
          const trimmedSize = fs.statSync(trimmedPath).size
          devLog(`[Auto] Trim OK (${trimLimitSec}s stream-copy, ${(trimmedSize / 1024 / 1024).toFixed(1)} MB)`)
          return { path: trimmedPath, size: trimmedSize, duration: trimLimitSec }
        }
        console.warn(`[Auto] Trim failed — using full video`)
        return null
      })(),
      // Blur: only for vertical videos. Landscape uses thumbnail bg — skip to save ~10-15s.
      (isLandscape ? Promise.resolve({ success: true }) : generateBlurBackground(result.filePath, blurPath, 1080, 1920, result.duration || undefined)),
    ])

    const realTitle = videoInfo?.title || title
    const realDuration = result.duration || videoInfo?.duration || 0
    const localThumbnail = thumbResult.success
      ? 'local-video:///' + thumbnailPath.replace(/\\/g, '/')
      : (videoInfo?.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`)

    // Short video check: if downloaded video < 60s, mark as error (YouTube Shorts)
    if (realDuration > 0 && realDuration < 60) {
      devLog(`[Auto] Video too short (${realDuration}s < 60s) — skipping (YouTube Short)`)
      try { fs.unlinkSync(result.filePath) } catch {}
      updateWorkspace(ws.id, { status: 'error' })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
      sendNotification('error', `Too short: ${title}`, ws.id)
      markVideoSeen(channelId, videoId)
      return
    }

    // Determine final file path and size after parallel tasks resolved.
    // If trim succeeded: switch to trimmed file and clean up original.
    let finalFilePath = result.filePath
    let finalFileSize = result.fileSize || 0
    let finalDuration = realDuration
    if (trimData) {
      finalFilePath = trimData.path
      finalFileSize = trimData.size
      finalDuration = trimData.duration
      try { fs.unlinkSync(result.filePath) } catch {} // clean up original
    }

    // blurBackgroundPath: vertical videos only (landscape uses thumbnail bg)
    const blurBgPath = (blurResult as any).success && !isLandscape ? blurPath : ''

    // ── Pre-scale disabled ────────────────────────────────────────────────────────
    // preScaleVideo() is intentionally NOT called here. GPU scale (scale_cuda) in the
    // render pipeline is fast enough for all sources (<3s). Pre-scaling portrait sources
    // to canvas dimensions corrupts the render (pre-scaled 480x480 gets upscaled to
    // 960x960 then cropped — quality loss). Pre-scaling landscape to portrait dims
    // also corrupts aspect ratio. Let the render pipeline handle all scaling.
    let preScaledPath = ''

    // ── Persist workspace state ──────────────────────────────────────────────────
    // updateWorkspace saves to disk synchronously (makeStorableDownloadedPath strips to basename).
    // getWorkspace reads back with resolveWorkspacePaths → absolute path reconstructed.
    // Return value has resolved preScaledPath + downloadedPath — use these for the render trigger.
    const updatedWs = updateWorkspace(ws.id, {
      status: 'ready',
      downloadedAt: new Date().toISOString(),
      downloadedPath: finalFilePath,
      fileSize: finalFileSize,
      thumbnail: localThumbnail,
      videoTitle: realTitle,
      duration: finalDuration,
      isShort: aspect?.isShort ?? false,
      videoResolution: aspect ? `${aspect.width}x${aspect.height}` : undefined,
      blurBackgroundPath: blurBgPath,
      preScaledPath,
      downloadQuality: autoQuality,
    })
    broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, updatedWs)
    sendNotification('success', `Auto-ready: ${realTitle}`, ws.id)
    broadcast(IPC_CHANNELS.AUTO_DOWNLOAD_EVENT, { videoId, title: realTitle, channelName: finalChannelName, detectedAt: detectedAtNow })
    showWindowsToast('✅ Download xong!', `${realTitle}`)
    recordDownloadSuccess()
    recordVideoDetected()
    broadcast(IPC_CHANNELS.ACTIVITY_EVENT, {
      id: ws.id,
      timestamp: Date.now(),
      type: 'downloaded',
      title: `Đã tải: ${realTitle.length > 40 ? realTitle.slice(0, 40) + '…' : realTitle}`,
      subtitle: `${finalChannelName} • ${fileSizeMB} MB • ${downloadElapsed}s`,
      workspaceId: ws.id,
    })

    // ── Auto-render trigger ───────────────────────────────────────────────────────
    // Only triggers if: settings.autoRender=true AND no prior attempt on this workspace.
    // autoRenderAttempted flag prevents infinite loops when render fails → retries.
    // Uses updatedWs (resolved paths from store) to avoid "file not found" race condition.
    if (autoRenderEnabled && !ws.autoRenderAttempted) {
      updateWorkspace(ws.id, { autoRenderAttempted: true })
      const autoRes = settings.autoRenderResolution ?? '480x480'
      // source_video: prefer preScaledPath (already validated to exist above), fallback to downloadedPath
      const sourceVideo = updatedWs?.preScaledPath || updatedWs?.downloadedPath || preScaledPath || finalFilePath
      // Only queue if the source file actually exists on disk
      if (!sourceVideo || !fs.existsSync(sourceVideo)) {
        devLog(`[Auto] Render skipped — source file not found: ${sourceVideo}`)
      } else {
        const autoMetadata: RenderMetadata = {
          workspace_id: ws.id,
          source_video: sourceVideo,
          export_resolution: autoRes,
          video_speed: 1.0,
          fps_target: settings.autoRenderFPS ?? 30,
          // Default "PART 1" title overlay — drawtext renders it at bottom of canvas.
          overlays: [{ type: 'title', content: 'PART 1', borderColor: '#00B4FF' }],
          trim: { start: 0, end: finalDuration },
          codec: 'h264',
          preset: 'p1',
          tune: 'ull',
          // Landscape (16:9) videos: use thumbnail as canvas background image.
          // Portrait (9:16) videos: blur_background is generated separately.
          // thumbPath is created at line 812 above — available at this point.
          backgroundType: blurBgPath ? 'blur' : 'image',
          backgroundColor: '#000000',
          backgroundImage: blurBgPath ? undefined : path.join(storagePath, `thumb_${ws.id}.jpg`),
          blur_background: blurBgPath,
          isShort: false,
        }
        devLog(`[Auto] Triggering render: ${realTitle} @ ${autoRes}`)
        // Push to render queue and start — same pattern as RENDER_START IPC handler
        renderQueue.push({ workspaceId: ws.id, metadata: autoMetadata, resolve: () => {} })
        const max = loadSettings().maxConcurrentRenders ?? 2
        if (getPoolStatus().active < max) {
          startNextQueuedRender()
        }
      }
    } else {
      devLog(`[Auto] Downloaded — ready (autoRender=${autoRenderEnabled}, attempted=${!!ws.autoRenderAttempted})`)
    }

    // Only mark as seen AFTER successful download — so YouTube processing delay doesn't block retry
    markVideoSeen(channelId, videoId)
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

  // Respect user's download quality setting
  const settings = loadSettings()
  const retryQuality = settings.autoDownloadQuality ?? '720'

  // Get PO Token from Innertube pool — needed for android client to access 1080p+ formats
  let po_token: string | null = null
  try {
    const pool = getInnertubePoolSync()
    if (pool?.isReady()) {
      const session = await pool.getDownloadSession(ws.videoId)
      po_token = session?.po_token ?? null
    }
  } catch (e) {
    console.warn('[Retry] Could not get PO Token:', e)
  }

  // Export Chrome cookies for yt-dlp authentication (bypasses EJS challenge → enables 1080p VP9)
  const { getYtCookiesFile } = await import('./services/po_token.js')
  const ytCookiesFile = await getYtCookiesFile()

  updateWorkspace(ws.id, { status: 'downloading', downloadProgress: 0 })
  broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))

  const result = await downloadVideo({
    workspaceId: ws.id,
    videoUrl,
    outputDir: storagePath,
    trimLimit: ws.trimLimit || 10,
    quality: retryQuality,
    po_token,
    ytCookiesFile,
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
    // Parallel: thumbnail + video info run simultaneously
    const thumbPath = path.join(storagePath, `thumb_${ws.id}.jpg`)
    const [thumbResult, videoInfo] = await Promise.all([
      extractVideoThumbnail(result.filePath, thumbPath),
      getVideoInfo(videoUrl),
    ])
    const realDuration = result.duration || videoInfo?.duration || 0
    const localThumbnail = thumbResult.success
      ? 'local-video:///' + thumbPath.replace(/\\/g, '/')
      : (videoInfo?.thumbnail || `https://img.youtube.com/vi/${ws.videoId}/mqdefault.jpg`)

    const aspect = await probeVideoAspect(result.filePath)

    // Skip 9:16 vertical videos — user only wants landscape 16:9 content
    if (aspect?.isShort) {
      devLog(`[Retry] Skipping 9:16 vertical video: ${ws.videoTitle}`)
      try { fs.unlinkSync(result.filePath) } catch {}
      updateWorkspace(ws.id, { status: 'error' })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
      sendNotification('error', `9:16 vertical: ${ws.videoTitle}`, ws.id)
      markVideoSeen(ws.channelId, ws.videoId)
      return
    }

    // Short video check
    if (realDuration > 0 && realDuration < 60) {
      devLog(`[Retry] Video too short (${realDuration}s < 60s) — skipping (YouTube Short)`)
      try { fs.unlinkSync(result.filePath) } catch {}
      updateWorkspace(ws.id, { status: 'error' })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
      sendNotification('error', `Too short: ${ws.videoTitle}`, ws.id)
      markVideoSeen(ws.channelId, ws.videoId)
      return
    }

    // Parallel: trim + blur (if vertical). Landscape skips blur.
    const isLandscape = !aspect?.isShort
    const { blurPath } = generateWorkspacePaths(ws.id)
    const trimLimitSec = typeof ws.trimLimit === 'number' ? ws.trimLimit * 60 : 0
    const doTrim = trimLimitSec > 0 && realDuration > trimLimitSec

    const [trimResult, blurResult] = await Promise.all([
      (async () => {
        if (!doTrim) return null
        const trimmedPath = result.filePath!.replace(/(\.\w+)$/, '_trimmed$1')
        const r = await trimVideo(result.filePath!, trimmedPath, 0, trimLimitSec)
        if (r.success) {
          const trimmedSize = fs.statSync(trimmedPath).size
          devLog(`[Retry] Trim OK (${trimLimitSec}s, ${(trimmedSize / 1024 / 1024).toFixed(1)} MB)`)
          return { path: trimmedPath, size: trimmedSize, duration: trimLimitSec }
        }
        return null
      })(),
      // Blur: only for vertical videos. Landscape uses thumbnail bg — skip.
      (isLandscape ? Promise.resolve({ success: true }) : generateBlurBackground(result.filePath, blurPath, 1080, 1920, realDuration || undefined)),
    ])

    let finalFilePath = result.filePath
    let finalFileSize = result.fileSize || 0
    let finalDuration = realDuration
    if (trimResult) {
      finalFilePath = trimResult.path
      finalFileSize = trimResult.size
      finalDuration = trimResult.duration
      try { fs.unlinkSync(result.filePath) } catch {}
    }

    // blurBackgroundPath: vertical videos only (landscape uses thumbnail bg)
    const blurBgPath = (blurResult as any).success && !isLandscape ? blurPath : ''

    updateWorkspace(ws.id, {
      status: 'ready',
      downloadedAt: new Date().toISOString(),
      downloadedPath: finalFilePath,
      fileSize: finalFileSize,
      thumbnail: localThumbnail,
      videoTitle: videoInfo?.title || ws.videoTitle,
      duration: finalDuration,
      isShort: aspect?.isShort ?? false,
      blurBackgroundPath: blurBgPath,
      downloadQuality: retryQuality,
    })
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

// ─── Auto-render catch-up on startup ────────────────────────────────────────────
// Finds 'ready' workspaces where auto-render was never triggered (e.g., autoRender
// was disabled at download time, or workspace was created before the feature existed).
// Triggers auto-render for each one — so nothing slips through the cracks.
function triggerAutoRenderForReadyWorkspaces(): void {
  const settings = loadSettings()
  if (settings.autoRender !== true) return

  const workspaces = getWorkspaces()
  const storagePath = getVideoStoragePath()

  for (const ws of workspaces) {
    // Only process 'ready' workspaces without a prior auto-render attempt
    if (ws.status !== 'ready') continue
    if ((ws as any).autoRenderAttempted === true) continue

    // Resolve the downloaded file — stored as basename, reconstruct absolute path
    const storedName = ws.downloadedPath || ''
    let videoPath = storedName
    if (storedName && !path.isAbsolute(storedName)) {
      const candidates = [storagePath, getVideoStoragePath()]
      for (const dir of candidates) {
        const candidate = path.join(dir, storedName)
        if (fs.existsSync(candidate)) { videoPath = candidate; break }
      }
    }
    if (!videoPath || !fs.existsSync(videoPath)) {
      devLog(`[AutoCatchup] Skipping ${ws.id} — file not found: ${videoPath || storedName}`)
      continue
    }

    // Get blur background if available
    const { blurPath } = generateWorkspacePaths(ws.id)
    const blurBgPath = ws.blurBackgroundPath || (fs.existsSync(blurPath) ? blurPath : '')

    // Resolve thumbnail path: workspace.thumbnail is "local-video:///D:/path/to/thumb_xxx.jpg"
    // Extract the filesystem path from this URI to find the actual thumbnail location.
    // This is more reliable than reconstructing from storagePath (which may differ from
    // the actual download directory on machines with multiple storage paths).
    let thumbnailPath = ''
    if (ws.thumbnail?.startsWith('local-video:///')) {
      thumbnailPath = ws.thumbnail.replace('local-video:///', '').replace(/\//g, '\\')
    } else {
      // Fallback: scan known dirs for thumb_{wsId}.jpg
      const thumbCandidates = [
        path.join(storagePath, `thumb_${ws.id}.jpg`),
        path.join(getVideoStoragePath(), `thumb_${ws.id}.jpg`),
        path.join('D:\\HyperClip-Data\\downloads', `thumb_${ws.id}.jpg`),
      ]
      for (const tc of thumbCandidates) {
        if (fs.existsSync(tc)) { thumbnailPath = tc; break }
      }
    }

    const autoRes = settings.autoRenderResolution ?? '480x480'
    const autoMetadata: RenderMetadata = {
      workspace_id: ws.id,
      source_video: videoPath,
      export_resolution: autoRes,
      video_speed: 1.0,
      fps_target: settings.autoRenderFPS ?? 30,
      overlays: [{ type: 'title', content: 'PART 1', borderColor: '#00B4FF' }],
      trim: { start: 0, end: ws.duration || 0 },
      codec: 'h264',
      preset: 'p1',
      tune: 'ull',
      // Portrait (9:16): use blur bg. Landscape (16:9): use thumbnail.
      backgroundType: blurBgPath ? 'blur' : 'image',
      backgroundColor: '#000000',
      backgroundImage: blurBgPath ? undefined : (thumbnailPath && fs.existsSync(thumbnailPath) ? thumbnailPath : undefined),
      blur_background: blurBgPath,
      isShort: ws.isShort ?? false,
    }

    // Mark as attempted FIRST to avoid double-trigger
    updateWorkspace(ws.id, { autoRenderAttempted: true } as any)

    devLog(`[AutoCatchup] Triggering render for ${ws.id} (${ws.videoTitle?.slice(0, 40)})`)
    renderQueue.push({ workspaceId: ws.id, metadata: autoMetadata, resolve: () => {} })
    const max = loadSettings().maxConcurrentRenders ?? 2
    if (getPoolStatus().active < max) {
      startNextQueuedRender()
    }
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
      devLog(`[HyperClip] Scanning ${files.length} file(s) in ${storagePath}`)

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
    devLog(`[HyperClip] Registered ${totalRegistered} existing file(s) as "seen"`)
  }
}

// ─── Channel ID Resolution ─────────────────────────────────────────────────────────
// Resolves YouTube handle (@channel) to channelId (UC...) for subscription feed fallback.
// Called at startup ONLY for channels that NEED resolution (missing/invalid channelId).
// Channels with already-valid channelIds are skipped entirely — no HTTP calls needed.
async function resolveChannelIdsForPoll(): Promise<void> {
  const channels = getChannels()
  let resolved = 0
  let skipped = 0

  for (const ch of channels) {
    // Skip if already has a valid channelId — no verification needed
    if (ch.channelId && isValidChannelId(ch.channelId)) {
      skipped++
      continue
    }

    // Build URL to resolve missing/invalid channelId
    let resolveUrl = ''
    let strategy = ''

    if (ch.handle && ch.handle.startsWith('@')) {
      const handlePart = ch.handle.slice(1)
      if (/^UC[a-zA-Z0-9_-]{22}$/.test(handlePart)) {
        // Corrupted handle: @UCxxx is actually a channelId (not valid UC format)
        resolveUrl = `https://www.youtube.com/channel/${handlePart}`
        strategy = 'handle→channelId'
      } else {
        resolveUrl = `https://www.youtube.com${ch.handle}`
        strategy = 'handle'
      }
    }

    if (!resolveUrl) {
      console.warn(`[Channel] "${ch.name}": no resolvable URL (handle=${ch.handle || 'none'}, channelId=${ch.channelId || 'none'}, id=${ch.id})`)
      skipped++
      continue
    }

    try {
      const info = await getChannelInfo(resolveUrl)
      if (info && info.channelId && info.channelId.startsWith('UC') && info.channelId.length >= 24) {
        devLog(`[Channel] Resolved "${ch.name}" [${strategy}]: ${info.channelId}`)
        updateChannel(ch.id, { channelId: info.channelId, name: info.channelName || ch.name })
        resolved++
      } else if (info && !info.channelId) {
        console.warn(`[Channel] Could not resolve "${ch.name}" via ${strategy} — no channelId from ${resolveUrl}`)
        skipped++
      } else if (!info) {
        console.warn(`[Channel] Failed to fetch "${ch.name}" via ${strategy}: ${resolveUrl}`)
        skipped++
      }
    } catch (e) {
      console.warn(`[Channel] Resolution error for "${ch.name}":`, e)
      skipped++
    }
  }

  devLog(`[Channel] Resolution: ${resolved} resolved, ${skipped} skipped (${channels.length - resolved - skipped} verified)`)
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
  // In packaged app:
  //   - .next/ and src/ are in app.asar.unpacked/ (extracted to disk for Node.js access)
  //   - node_modules/next is also in app.asar.unpacked/
  //   - cwd = appUnpacked (resources/app.asar.unpacked/) so Next.js finds .next/ and src/ on disk
  const appUnpacked = app.isPackaged
    ? path.join(process.resourcesPath!, 'app.asar.unpacked')
    : path.join(__dirname, '..')
  const nextBin = path.join(appUnpacked, 'node_modules', 'next', 'dist', 'bin', 'next')

  devLog(`[HyperClip] Next.js bin: ${nextBin}`)
  devLog(`[HyperClip] Next.js exists: ${fs.existsSync(nextBin)}`)
  devLog(`[HyperClip] cwd: ${appUnpacked}`)

  let startupResolve: (() => void) | null = null
  return new Promise<void>((resolve) => {
    startupResolve = resolve

    nextServer = spawn('node', [nextBin, '-p', String(NEXT_PORT)], {
      cwd: appUnpacked,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PATH: (process.env.PATH || '') + path.delimiter + path.dirname(process.execPath), PORT: String(NEXT_PORT) },
    })

    nextServerOwned = true
    devLog(`[HyperClip] Booting Next.js on port ${NEXT_PORT}...`)

    nextServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[HyperClip] Port ${NEXT_PORT} is already in use. Set HYPERCLIP_PORT env var to use a different port.`)
        console.error('[HyperClip] Example: HYPERCLIP_PORT=3001 npm run electron:dev')
        process.exit(1)
      }
      console.error('[HyperClip] Next.js server error:', err.message)
    })

    nextServer.on('exit', (code, signal) => {
      console.error(`[HyperClip] Next.js process exited: code=${code} signal=${signal}`)
      if (startupResolve) {
        startupResolve = null
      }
    })

    // Production Next.js outputs "✓ Ready" on stdout and "▲ Next.js" on stderr.
    // Also catch "compiled" as a late signal the app is serving.
    const readyPatternsStdout = ['Ready', 'ready', 'started server', 'Server running', 'compiled']
    const readyPatternsStderr = ['Local:', 'Ready on', '▲ Next.js', 'compiled', 'starting server']
    nextServer.stdout?.on('data', (data) => {
      const text = data.toString()
      process.stdout.write('[Next.js] ' + text)
      if (readyPatternsStdout.some(p => text.includes(p))) {
        devLog(`[HyperClip] Next.js stdout signal → http://localhost:${NEXT_PORT}`)
        if (startupResolve) { startupResolve(); startupResolve = null }
      }
    })
    nextServer.stderr?.on('data', (data) => {
      const text = data.toString()
      process.stderr.write('[Next.js] ' + text)
      if (readyPatternsStderr.some(p => text.includes(p))) {
        devLog(`[HyperClip] Next.js stderr signal → http://localhost:${NEXT_PORT}`)
        if (startupResolve) { startupResolve(); startupResolve = null }
      }
    })
    // 30s safety timeout — proceed after timeout if server is still starting
    setTimeout(() => {
      if (startupResolve) {
        console.warn('[HyperClip] Next.js startup timeout — proceeding anyway')
        startupResolve(); startupResolve = null
      }
    }, 30000)
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

  // Wire operation log to renderer for live streaming
  import('./services/operation_log.js').then(({ setOpLogWindow }) => {
    setOpLogWindow(mainWindow)
  })

  mainWindow.loadURL(`http://localhost:${NEXT_PORT}`)

  // Retry load if initial attempt fails (server might still be warming up)
  let loadRetries = 0
  const maxRetries = 5
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    loadRetries++
    console.warn(`[HyperClip] Load failed (attempt ${loadRetries}): ${errorDescription} (${errorCode})`)
    if (loadRetries <= maxRetries) {
      setTimeout(() => {
        devLog(`[HyperClip] Retrying load (attempt ${loadRetries + 1}/${maxRetries + 1})...`)
        mainWindow?.webContents.loadURL(`http://localhost:${NEXT_PORT}`)
      }, 2000)
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    devLog(`[HyperClip] Window loaded successfully`)
  })

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

  // Track which workspace is currently open in DetailEditor — protects from auto-cleanup
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, async (_, workspaceId: string | null) => {
    _activeWorkspaceId = workspaceId
    return { success: true }
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

    // PO Token extraction disabled — yt-dlp auto client + Chrome cookies → 1080p H.264
    const po_token: string | null = null

    const settings = loadSettings()
    const retryQuality = settings.autoDownloadQuality ?? '720'
    const retryTrimLimit = ws.trimLimit || 10
    devLog(`[WORKSPACE_RETRY] quality=${retryQuality}p trimLimit=${retryTrimLimit}m (user config: quality=${settings.autoDownloadQuality}p)`)

    // Export Chrome cookies for yt-dlp authentication (bypasses EJS challenge)
    const { getYtCookiesFile } = await import('./services/po_token.js')
    const ytCookiesFile = await getYtCookiesFile()

    try {
      const result = await downloadVideo({
        workspaceId: id,
        videoUrl,
        outputDir: storagePath,
        trimLimit: retryTrimLimit,
        quality: retryQuality,
        po_token,
        ytCookiesFile,
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
          downloadQuality: retryQuality,
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

  // ─── Storage management ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.STORAGE_GET_SIZE, async (): Promise<{ downloads: number; blur: number; total: number; downloadPath: string; outputPath: string; freeBytes: number }> => {
    try {
      const storagePath = getVideoStoragePath()
      const outputDir = getOutputPath()
      let downloadSize = 0
      let blurSize = 0

      try {
        const entries = fs.readdirSync(storagePath)
        for (const entry of entries) {
          const fullPath = path.join(storagePath, entry)
          try {
            const stat = fs.statSync(fullPath)
            if (entry.startsWith('blur_')) {
              blurSize += stat.size
            } else if (entry.endsWith('.mp4') || entry.endsWith('.mkv') || entry.endsWith('.webm')) {
              downloadSize += stat.size
            }
          } catch {}
        }
      } catch {}

      return {
        downloads: parseFloat((downloadSize / (1024 ** 2)).toFixed(1)),
        blur: parseFloat((blurSize / (1024 ** 2)).toFixed(1)),
        total: parseFloat(((downloadSize + blurSize) / (1024 ** 2)).toFixed(1)),
        downloadPath: storagePath,
        outputPath: outputDir,
        freeBytes: getFreeDiskSpace(storagePath),
      }
    } catch {
      return { downloads: 0, blur: 0, total: 0, downloadPath: '', outputPath: '', freeBytes: 0 }
    }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_CLEAR_DOWNLOADS, async (): Promise<{ success: boolean; freedMB: number }> => {
    try {
      const storagePath = getVideoStoragePath()
      let freedBytes = 0

      // Only delete video files, not blur images
      const entries = fs.readdirSync(storagePath)
      for (const entry of entries) {
        if (entry.startsWith('blur_')) continue
        const ext = path.extname(entry).toLowerCase()
        if (!['.mp4', '.mkv', '.webm', '.avi', '.mov'].includes(ext)) continue

        const fullPath = path.join(storagePath, entry)
        try {
          const stat = fs.statSync(fullPath)
          fs.unlinkSync(fullPath)
          freedBytes += stat.size
          devLog(`[Storage] Deleted: ${entry} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
        } catch {}
      }

      sendNotification('info', `Cleared ${(freedBytes / 1024 / 1024).toFixed(0)} MB of downloads`, undefined)
      return { success: true, freedMB: parseFloat((freedBytes / (1024 ** 2)).toFixed(1)) }
    } catch (err) {
      sendNotification('error', `Clear failed: ${(err as Error).message}`, undefined)
      return { success: false, freedMB: 0 }
    }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_CLEAR_BLUR, async (): Promise<{ success: boolean; freedMB: number }> => {
    try {
      const storagePath = getVideoStoragePath()
      let freedBytes = 0

      const entries = fs.readdirSync(storagePath)
      for (const entry of entries) {
        if (!entry.startsWith('blur_')) continue
        const fullPath = path.join(storagePath, entry)
        try {
          const stat = fs.statSync(fullPath)
          fs.unlinkSync(fullPath)
          freedBytes += stat.size
          devLog(`[Storage] Deleted: ${entry} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
        } catch {}
      }

      sendNotification('info', `Cleared ${(freedBytes / 1024 / 1024).toFixed(0)} MB of blur images`, undefined)
      return { success: true, freedMB: parseFloat((freedBytes / (1024 ** 2)).toFixed(1)) }
    } catch (err) {
      sendNotification('error', `Clear failed: ${(err as Error).message}`, undefined)
      return { success: false, freedMB: 0 }
    }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_PICK_FOLDER, async (_, currentPath?: string): Promise<{ path: string } | null> => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: currentPath || undefined,
      title: 'Chọn thư mục',
    })
    if (result.canceled || !result.filePaths?.[0]) return null
    return { path: result.filePaths[0] }
  })

  // ─── System diagnostics (P0) ───────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_RUN, async () => {
    return runDiagnostics()
  })

  // ─── Data portability (P1) ─────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DATA_EXPORT, async (): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win!, {
        title: 'Export HyperClip Data',
        defaultPath: `hyperclip-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }

      const channels = getChannels()
      const seen = loadSeenVideos()

      const payload = {
        exportedAt: new Date().toISOString(),
        appVersion: '1.0',
        channels,
        seenVideos: seen,
        // Exclude workspaces (too large + contain absolute paths)
        // Exclude rendered (referenced by workspaceId)
      }
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
      sendNotification('success', `Exported ${channels.length} channels`, undefined)
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATA_IMPORT, async (): Promise<{ success: boolean; channelsImported?: number; seenImported?: number; error?: string }> => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        title: 'Import HyperClip Data',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths?.[0]) return { success: false, error: 'Cancelled' }

      const content = fs.readFileSync(result.filePaths[0], 'utf-8')
      const data = JSON.parse(content) as { channels?: StoredChannel[]; seenVideos?: Record<string, { ids: string[]; expiresAt: number }> }

      let channelsImported = 0
      let seenImported = 0

      if (data.channels?.length) {
        const existing = getChannels()
        const existingIds = new Set(existing.map(c => c.id))
        for (const ch of data.channels) {
          if (!existingIds.has(ch.id)) {
            addChannel(ch)
            channelsImported++
          }
        }
      }

      if (data.seenVideos && typeof data.seenVideos === 'object') {
        const existingSeen = loadSeenVideos()
        for (const [channelId, entry] of Object.entries(data.seenVideos)) {
          if (!existingSeen[channelId]) {
            existingSeen[channelId] = entry
            seenImported++
          }
        }
        saveSeenVideos(existingSeen)
      }

      sendNotification('success', `Imported ${channelsImported} channels, ${seenImported} seen entries`, undefined)
      return { success: true, channelsImported, seenImported }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ─── Auto-cleanup downloads (P3) ─────────────────────────────────────────────
  // Runs on startup: delete video files older than downloadsCleanupDays.
  // Skips files belonging to workspaces currently open in the DetailEditor.
  const cleanupDays = loadSettings().downloadsCleanupDays ?? 7
  if (cleanupDays > 0) {
    try {
      const storagePath = getVideoStoragePath()
      const cutoff = Date.now() - cleanupDays * 24 * 60 * 60 * 1000
      const workspaces = getWorkspaces()
      const activeIds = new Set(workspaces.map(w => w.id))
      if (_activeWorkspaceId) activeIds.add(_activeWorkspaceId)
      let cleaned = 0
      for (const entry of fs.readdirSync(storagePath)) {
        if (entry.startsWith('blur_')) continue
        const ext = path.extname(entry).toLowerCase()
        if (!['.mp4', '.mkv', '.webm', '.avi', '.mov'].includes(ext)) continue
        // Skip if this file belongs to an active workspace
        const entryBase = entry.replace(/\.\w+$/, '')
        const isActive = Array.from(activeIds).some(id => entryBase.startsWith(id + '_') || entryBase === id)
        if (isActive) continue
        const fullPath = path.join(storagePath, entry)
        try {
          const stat = fs.statSync(fullPath)
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(fullPath)
            cleaned++
            devLog(`[AutoCleanup] Removed old download: ${entry}`)
          }
        } catch {}
      }
      if (cleaned > 0) devLog(`[AutoCleanup] Done — removed ${cleaned} old video files`)
    } catch {}
  }

  // ─── Settings ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return loadSettings()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_, patch: { videoStoragePath?: string; outputPath?: string; defaultTrimLimit?: number | 'full'; defaultQuality?: 1080 | 720; autoDownloadQuality?: string; autoDownloadEnabled?: boolean; autoRender?: boolean; autoRenderResolution?: string; autoRenderFPS?: number; downloadsCleanupDays?: number; renderedOutputPath?: string; pollIntervalMs?: number; proxyEnabled?: boolean; proxyHost?: string; proxyPort?: number; proxyUsername?: string; proxyPassword?: string; maxConcurrentDownloads?: number; videoMinDurationSec?: number; videoMaxDurationSec?: number }) => {
    const settings = loadSettings()
    saveSettings({ ...settings, ...patch })

    // Apply poller interval change immediately if poller is running
    if (patch.pollIntervalMs !== undefined) {
      const poller = getYouTubePoller()
      if (poller) poller.restart(patch.pollIntervalMs)
    }

    return loadSettings()
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

      devLog(`[Split] Splitting "${ws.videoTitle}" (${totalSec}s) into ${numParts} parts of ${partMinutes}m each`)
      devLog(`[Split] Original workspace ${ws.id} = Part 1 (0s – ${partSec}s)`)
      devLog(`[Split] Will create ${numParts - 1} new workspaces for remaining parts`)

      const newWorkspaces: WorkspaceData[] = []

      // For each part (0 = original workspace, 1..n-1 = new workspaces)
      for (let i = 1; i < numParts; i++) {
        const startSec = i * partSec
        const endSec = Math.min((i + 1) * partSec, totalSec)
        const partDuration = endSec - startSec
        const partFileName = `${ws.id}_part${i + 1}.${path.extname(ws.downloadedPath).slice(1) || 'mp4'}`
        const partFilePath = path.join(path.dirname(ws.downloadedPath), partFileName)

        devLog(`[Split] Part ${i + 1}/${numParts}: ${startSec}s – ${endSec}s (${partDuration}s)`)

        // FFmpeg stream-copy the part (no re-encode, very fast)
        const trimResult = await trimVideo(ws.downloadedPath, partFilePath, startSec, partDuration)
        if (!trimResult.success) {
          console.error(`[Split] FFmpeg trim failed for part ${i + 1}: ${trimResult.error}`)
          // Clean up already-created parts
          for (const nw of newWorkspaces) {
            try {
              if (nw.downloadedPath) {
                const abs = nw.downloadedPath.startsWith('/') || /^[A-Z]:/i.test(nw.downloadedPath)
                  ? nw.downloadedPath
                  : path.join(getVideoStoragePath(), nw.downloadedPath)
                if (fs.existsSync(abs)) fs.unlinkSync(abs)
              }
            } catch {}
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
          downloadQuality: ws.downloadQuality,
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
        devLog(`[Split] Created workspace ${newWs.id} (${newWs.videoTitle})`)
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

      // Use user's preferred quality setting (default 720p) — declared early to record on workspace
      const settings = loadSettings()
      const quality = settings.autoDownloadQuality ?? '720'
      devLog(`[TRACKER_ADD] quality=${quality}p trimLimit=${trimLimit === 'full' ? 'full' : trimLimit + 'm'} (user config)`)

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
        downloadQuality: quality,
      })

      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, workspace)
      sendNotification('info', `Downloading: ${info.title}`, workspace.id)

      // PO Token extraction disabled — yt-dlp auto client + Chrome cookies → 1080p H.264
      const po_token: string | null = null

      // Export Chrome cookies for yt-dlp authentication (bypasses EJS challenge)
      const { getYtCookiesFile } = await import('./services/po_token.js')
      const ytCookiesFile = await getYtCookiesFile()

      const result = await downloadVideo({
        workspaceId: workspace.id,
        videoUrl: url,
        outputDir: storagePath,
        trimLimit,
        quality,
        po_token,
        ytCookiesFile,
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
          downloadQuality: quality,
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
    // ── Validate URL ────────────────────────────────────────────────────────────────
    const urlTrimmed = url.trim()
    if (!urlTrimmed) return null

    const CHANNEL_COLORS = ['#00B4FF', '#7C3AED', '#00FF88', '#FF6B35', '#FF0080', '#FFB800']

    // ── Extract channel ID / handle from URL ─────────────────────────────────────
    let channelId: string | undefined
    let handle: string | undefined
    try {
      const normalized = urlTrimmed.startsWith('http') ? urlTrimmed : 'https://www.youtube.com/' + urlTrimmed
      const u = new URL(normalized)
      const path = u.pathname
      const m = path.match(/^\/(channel\/|@|c\/|user\/)?([\w.-]+)/)
      if (m) {
        if (path.startsWith('/channel/')) channelId = m[2]
        else if (path.startsWith('/@')) handle = '@' + m[2]
        else if (path.startsWith('/c/') || path.startsWith('/user/')) handle = m[2]
        else handle = '@' + m[2] // bare path → treat as @handle
      }
    } catch {}

    // ── Duplicate check ───────────────────────────────────────────────────────────
    const existing = getChannels()
    const isDupe = existing.some((ch) => {
      if (channelId && ch.channelId === channelId) return true
      if (handle && ch.handle?.toLowerCase() === handle.toLowerCase()) return true
      return false
    })
    if (isDupe) {
      console.warn(`[CHANNEL_ADD] Duplicate channel: ${channelId || handle || urlTrimmed}`)
      return null
    }

    // ── Fetch channel metadata ───────────────────────────────────────────────────
    let name: string, avatarUrl: string | undefined
    try {
      const info = await getChannelInfo(urlTrimmed)
      if (info && info.channelName) {
        name = info.channelName
        channelId = info.channelId || channelId
        handle = info.handle || handle
        avatarUrl = info.avatarUrl
      } else {
        throw new Error('no channel info')
      }
    } catch {
      // Fallback: derive name from URL path
      const raw = urlTrimmed
        .replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/|@|c\/|user\/)?/, '')
        .split(/[/?]/)[0]
        .replace(/^@/, '') || 'Kênh Mới'
      name = raw.charAt(0).toUpperCase() + raw.slice(1)
      if (!handle) handle = '@' + raw.toLowerCase().replace(/\s+/g, '')
    }

    // ── Save ──────────────────────────────────────────────────────────────────────
    const newCh: StoredChannel = {
      id: `ch${Date.now()}`,
      name,
      handle: handle || `@${channelId || name}`,
      avatarColor: CHANNEL_COLORS[existing.length % CHANNEL_COLORS.length],
      channelId,
      avatarUrl,
      createdAt: new Date().toISOString(),
    }
    const saved = addChannel(newCh)
    refreshChannelCache()
    return saved
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
    const stored = ws.downloadedPath
    const abs = stored.startsWith("/") || stored.match(/^[A-Z]:/i) ? stored : path.join(getVideoStoragePath(), stored)
    let absPath = abs
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
    const stored = ws.downloadedPath
    const abs = stored.startsWith("/") || stored.match(/^[A-Z]:/i) ? stored : path.join(getVideoStoragePath(), stored)
    let absPath = abs
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
      const dir = path.join(getAppStoreDir(), 'temp_assets')
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
      const max = loadSettings().maxConcurrentRenders ?? 2
      if (getPoolStatus().active < max) {
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

    // Use pre-scaled path if available (auto-render pre-scaled the source to output resolution).
    const videoPath = workspace.preScaledPath || workspace.downloadedPath || findDownloadedFileAbs(workspaceId) || metadata.source_video
    if (!fs.existsSync(videoPath)) {
      return { success: false, workspaceId, error: `Source video not found: ${path.basename(videoPath)}` }
    }

    // GPU-aware config injection — RTX 5080 tier gets 14 workers / 90s chunks (more parallelism)
    // RTX 4050 Laptop: 4 workers / 120s chunks (fewer workers, longer chunks to reduce overhead)
    const gpuCaps = getGPUCapabilities()
    const effectiveConfig: ChunkConfig = {
      workers: config?.workers ?? gpuCaps.maxChunkWorkers,
      chunkDuration: config?.chunkDuration ?? (gpuCaps.tier === 'high' ? 90 : 120),
      minChunkDuration: config?.minChunkDuration ?? 10,
      gpuTier: gpuCaps.tier,
      fpsTarget: (metadata.fps_target || 30),
    }

    updateWorkspace(workspaceId, { status: 'rendering', renderProgress: 0 })
    sendNotification('info', `GPU MAX (${effectiveConfig.workers}x): ${workspace.videoTitle}`, workspaceId)

    const chunkRenderStartMs = Date.now()
    const chunkQuality = parseInt((metadata.export_resolution || '1080x1920').split('x')[1]) || 1080
    const chunkSpeed = metadata.video_speed ?? 1.0
    const chunkTrimStart = metadata.trim?.start ?? 0
    const chunkTrimEnd = metadata.trim?.end ?? 0
    const chunkTrimDuration = chunkTrimEnd - chunkTrimStart
    devLog(`[TIMER] ═══════════════════════════════════════════════`)
    devLog(`[TIMER] RENDER START (GPU MAX CHUNKED): "${workspace.videoTitle}"`)
    devLog(`[TIMER]   Quality: ${chunkQuality}p | Speed: ${chunkSpeed}x | Trim: ${chunkTrimDuration}s (${chunkTrimStart}s–${chunkTrimEnd}s)`)
    devLog(`[TIMER]   Codec: ${metadata.codec ?? 'hevc'} | Workers: ${effectiveConfig.workers}x | Chunk duration: ${effectiveConfig.chunkDuration}s | Source: ${path.basename(videoPath)}`)
    devLog(`[TIMER]   ═══════════════════════════════════════════════`)

    const outputDir = getOutputPath()
    ensureStorageDirs()

    // Build resolved metadata: merge workspace blur background and thumbnail image.
    // Landscape videos: use thumbnail as backgroundImage. Portrait: use blur_background.
    const wsBlurBg = workspace?.blurBackgroundPath || ''
    const wsThumbPath = path.join(getVideoStoragePath(), `thumb_${workspaceId}.jpg`)
    const resolvedMetadata = {
      ...metadata,
      source_video: videoPath,
      blur_background: metadata.blur_background || wsBlurBg,
      // For landscape with 'image' type but no backgroundImage → use thumbnail
      // Also check: if metadata.backgroundImage is set but the file doesn't exist → fall back to workspace thumbnail.
      backgroundImage: (!metadata.backgroundImage || !fs.existsSync(metadata.backgroundImage)) && !wsBlurBg && fs.existsSync(wsThumbPath) ? wsThumbPath : metadata.backgroundImage,
    }

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
      devLog(`[TIMER] RENDER DONE (GPU MAX CHUNKED): "${workspace.videoTitle}" — ${chunkRenderElapsed}s`)
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
              videoResolution: workspace.videoResolution,
              renderedAt: new Date().toISOString(),
            }
            addRenderedVideo(record)
            // Cleanup pre-scaled source file after successful render
            if (workspace.preScaledPath) {
              try { fs.unlinkSync(workspace.preScaledPath) } catch {}
            }
            // TODO (debug): keep workspace in pipeline instead of deleting — for testing
            // cleanupWorkspace(workspace.id, workspace.downloadedPath)
            // deleteWorkspace(workspace.id)
            // broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, null)
            const _fileSizeMB = ((workspace.fileSize || 0) / 1024 / 1024).toFixed(1)
            devLog(`[TIMER] ARCHIVE DONE: ${archiveResult.archivedPath}`)
            devLog(`[TIMER]   Archive file size: ${_fileSizeMB} MB`)
            devLog(`[TIMER] ═══════════════════════════════════════════════`)
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
        videoResolution: ws.videoResolution,
        renderedAt: new Date().toISOString(),
      }
      addRenderedVideo(renderedRecord)
      // TODO (debug): keep downloaded video instead of cleaning up — for testing
      // cleanupWorkspace(ws.id, ws.downloadedPath)
      // deleteWorkspace(ws.id)
      // broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, null)
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

  // Resume polling immediately — clears exhaustion backoff
  ipcMain.handle(IPC_CHANNELS.POLLER_RESUME, () => {
    const poller = getYouTubePoller()
    if (poller) {
      poller.resume()
      opLog.info('system', 'Poller resumed')
      return { success: true }
    }
    return { success: false }
  })

  // Pause / stop polling
  ipcMain.handle(IPC_CHANNELS.POLLER_PAUSE, () => {
    const poller = getYouTubePoller()
    if (poller) {
      poller.pause()
      opLog.warn('system', 'Poller paused by user')
      return { success: true }
    }
    return { success: false }
  })

  // ─── Operation Logs ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.OPERATION_LOGS_READ, () => {
    return getOpLogs()
  })

  ipcMain.handle(IPC_CHANNELS.OPERATION_LOGS_CLEAR, () => {
    clearOpLogs()
    return { success: true }
  })

  // ─── Channel Bulk Add ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.CHANNEL_BULK_ADD, async (_, urls: string[]) => {
    const results: Array<{ url: string; success: boolean; error?: string }> = []
    const CHANNEL_COLORS = ['#00B4FF', '#7C3AED', '#00FF88', '#FF6B35', '#FF0080', '#FFB800']

    for (const url of urls) {
      const trimmed = url.trim()
      if (!trimmed) continue
      try {
        let name: string, handle: string, channelId: string | undefined, avatarUrl: string | undefined
        try {
          const info = await getChannelInfo(trimmed)
          if (info) {
            name = info.channelName
            handle = info.handle || `@${info.channelId}`
            channelId = info.channelId
            avatarUrl = info.avatarUrl
          } else {
            throw new Error('no info')
          }
        } catch {
          const raw = trimmed.replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/)?/, '').split(/[/?]/)[0] || 'Kênh Mới'
          name = raw.charAt(0).toUpperCase() + raw.slice(1)
          handle = `@${raw.toLowerCase()}`
        }

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
        addChannel(newCh)
        results.push({ url: trimmed, success: true })
        opLog.success('channel', `Channel added: ${name}`)
      } catch (e: any) {
        results.push({ url: trimmed, success: false, error: e.message })
        opLog.error('channel', `Error adding channel: ${trimmed} — ${e.message}`)
      }
    }
    return results
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
    const configFile = path2.join(getAppStoreDir(), 'oauth_config.json')
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
    devLog('[OAuth] Credentials saved to oauth_config.json (per-project format)')

    // Also update credentials in oauth_tokens.json — this file is now the single source of truth
    // for credentials. getOAuthClientId() reads from there first.
    try {
      const fs3 = await import('fs')
      const path3 = await import('path')
      const os3 = await import('os')
      const tokensFile = path3.join(getAppStoreDir(), 'oauth_tokens.json')
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
          devLog(`[OAuth] Updated credentials in oauth_tokens.json for ${updated} token(s)`)
        }
      }
    } catch (e) {
      console.warn('[OAuth] Failed to update oauth_tokens.json:', e)
    }

    // Reload TokenManager so in-memory state reflects new credentials
    try {
      const tokens2 = await import('./services/token_manager.js')
      tokens2.getTokenManager().reload()
      devLog('[OAuth] TokenManager reloaded with new credentials')
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
      devLog(`[OAuth] Token stored in TokenManager for ${result.projectId} — ${result.tokens.access_token.slice(0, 10)}... expires ${new Date(result.tokens.expires_at).toLocaleString()}`)
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

  ipcMain.handle(IPC_CHANNELS.TOKEN_TEST, async (_, projectId: string) => {
    const result = await getTokenManager().testToken(projectId)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.TOKEN_GET_DEFAULT_CREDS, async () => {
    // Return per-project credentials from oauth_config.json
    const fs = await import('fs')
    const path = await import('path')
    const os = await import('os')
    const configFile = path.join(getAppStoreDir(), 'oauth_config.json')
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

  ipcMain.handle(IPC_CHANNELS.KEY_ADD, async (_, key: string, projectId: string, name: string) => {
    // Test the key before adding it — reject invalid keys
    const km = getKeyManager()
    const testResult = await km.testKey(key)

    if (!testResult.valid) {
      const friendlyError: Record<string, string> = {
        unauthorized: 'Key không hợp lệ hoặc đã bị revoke. Vui lòng kiểm tra lại API Key.',
        quota_exhausted: 'Key đã hết quota. Chọn key khác hoặc reset quota trên Google Cloud Console.',
        invalid_key: 'Định dạng key không hợp lệ. Key phải bắt đầu bằng "AIzaSy".',
        network_error: 'Không thể kết nối YouTube API. Kiểm tra kết nối mạng.',
      }
      return {
        success: false,
        keys: km.getAllKeys(),
        error: friendlyError[testResult.errorType || 'invalid_key'] || testResult.error,
        errorType: testResult.errorType,
      }
    }

    // Key is valid — add it
    km.addKey(key, projectId, name)
    devLog(`[KeyManager] Key validated and added: ${name} (${key.slice(0, 12)}...)`)
    return { success: true, keys: km.getAllKeys() }
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

  ipcMain.handle(IPC_CHANNELS.KEY_TEST, async (_, key: string) => {
    const km = getKeyManager()
    const result = await km.testKey(key)
    // If unauthorized, mark the key so it gets excluded from rotation
    if (!result.valid && result.errorType === 'unauthorized') {
      km.markUnauthorized(key)
    } else if (result.valid) {
      km.markAuthorized(key)
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.KEY_TEST_ALL, async () => {
    const km = getKeyManager()
    const keys = km.getAllKeys()
    const results: Array<{ key: string; name: string; valid: boolean; error?: string; errorType?: string }> = []

    for (const k of keys) {
      const result = await km.testKey(k.key)
      if (!result.valid && result.errorType === 'unauthorized') {
        km.markUnauthorized(k.key)
      } else if (result.valid) {
        km.markAuthorized(k.key)
      }
      results.push({ key: k.key, name: k.name, ...result })
    }

    return { results, keys: km.getAllKeys() }
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

    type ProjectTokenStatus = 'healthy' | 'warning' | 'rate_limited' | 'error' | 'exhausted' | 'unauthorized' | 'no_oauth'

    // Build project list from tokens (each token = 1 project)
    const projects: Array<{
      projectId: string; projectName: string; gmailAccount: string
      clientId: string; hasToken: boolean; tokenExpiry: number | null
      usedToday: number; quotaTotal: number; errors: number; status: ProjectTokenStatus
      apiKey: string | null; apiKeyName: string | null; apiKeyUsed: number; apiKeyStatus: string
    }> = tokenStatuses.map(ts => {
      const projectKeys = keys.filter(k => k.projectId === ts.projectId)
      const primaryKey = projectKeys[0] || null
      return {
        projectId: ts.projectId,
        projectName: ts.projectName || ts.projectId,
        gmailAccount: ts.gmailAccount || '',
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
            projectName: k.projectName || k.projectId,
            gmailAccount: k.gmailAccount || '',
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
    const configFile = pathMod.join(getAppStoreDir(), 'oauth_config.json')
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
    devLog(`[Project] Credentials saved for ${projectId}`)

    // 1. Save API key
    const name = apiKeyName?.trim() || `Project ${projectId}`
    km.addKey(apiKey.trim(), projectId, name)

    // 2. Start OAuth flow
    const { startOAuthFlow } = await import('./services/youtube_auth.js')
    const result = await startOAuthFlow(clientId.trim(), clientSecret.trim(), projectId)

    if (result.success && result.tokens && result.projectId) {
      tm.addToken(result.projectId, clientId.trim(), clientSecret.trim(), result.tokens)
      devLog(`[Project] Added ${projectId}: OAuth OK + API key OK`)
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
    devLog(`[Project] Removed ${projectId}: token + ${keys.length} key(s)`)
    return { success: true }
  })

  /**
   * Reset quota for a project (both token and key stats).
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_RESET_QUOTA, (_, projectId: string) => {
    const tm = getTokenManager()
    const km = getKeyManager()
    const keys = km.getAllKeys().filter(k => k.projectId === projectId)
    for (const k of keys) {
      km.resetKey(k.key)
    }
    const tokenResult = tm.resetTokenStats(projectId)
    return { success: true, nextReset: tokenResult.nextReset, wasUnauthorized: tokenResult.wasUnauthorized }
  })

  /**
   * Re-authorize a project: read credentials from oauth_config.json and trigger OAuth flow.
   * Before starting the OAuth browser flow, tries refreshing the existing token first.
   * If refresh succeeds → credentials are still valid (just quota issue). No re-auth needed.
   * If refresh fails with invalid_client → OAuth client deleted/secret regenerated → clear error.
   * If refresh fails with invalid_grant → refresh token revoked → proceed with new OAuth flow.
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_REAUTHORIZE, async (_, projectId: string) => {
    const fs = await import('fs')
    const path = await import('path')
    process.stderr.write(`[DEBUG] PROJECT_REAUTHORIZE called: ${projectId}\n`)

    // Read from %APPDATA% first (primary), fallback to %TEMP% (legacy)
    const appDataConfig = path.join(getAppStoreDir(), 'oauth_config.json')
    const legacyConfig = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')

    process.stderr.write(`[DEBUG] appDataConfig=${appDataConfig}\n`)
    process.stderr.write(`[DEBUG] legacyConfig=${legacyConfig}\n`)

    let clientId = ''
    let clientSecret = ''

    const readFromFile = (configFile: string) => {
      process.stderr.write(`[DEBUG] Checking config: ${configFile}\n`)
      try {
        if (!fs.existsSync(configFile)) {
          process.stderr.write(`[DEBUG] Config not found: ${configFile}\n`)
          return false
        }
        const content = fs.readFileSync(configFile, 'utf-8')
        const config = JSON.parse(content)
        process.stderr.write(`[DEBUG] Config keys: ${Object.keys(config).join('|')}\n`)
        const proj = config[projectId]
        if (proj?.clientId && proj?.clientSecret) {
          clientId = proj.clientId
          clientSecret = proj.clientSecret
          process.stderr.write(`[DEBUG] Found credentials for ${projectId}\n`)
          return true
        } else if (config.client_id && config.client_secret) {
          clientId = config.client_id
          clientSecret = config.client_secret
          process.stderr.write(`[DEBUG] Found legacy credentials for ${projectId}\n`)
          return true
        } else {
          process.stderr.write(`[DEBUG] No credentials for ${projectId} in ${configFile}\n`)
        }
      } catch (e) {
        process.stderr.write(`[DEBUG] Error reading ${configFile}: ${e}\n`)
      }
      return false
    }

    // Primary: %APPDATA%
    if (!readFromFile(appDataConfig)) {
      process.stderr.write(`[DEBUG] Not found in %APPDATA%, trying legacy\n`)
      if (readFromFile(legacyConfig)) {
        process.stderr.write(`[DEBUG] Found in legacy %TEMP%, migrating...\n`)
        try {
          if (!fs.existsSync(path.dirname(appDataConfig))) {
            fs.mkdirSync(path.dirname(appDataConfig), { recursive: true })
          }
          const appDataContent = fs.existsSync(appDataConfig)
            ? JSON.parse(fs.readFileSync(appDataConfig, 'utf-8'))
            : {}
          const legacyContent = JSON.parse(fs.readFileSync(legacyConfig, 'utf-8'))
          const merged = { ...legacyContent, ...appDataContent }
          merged[projectId] = { clientId, clientSecret }
          fs.writeFileSync(appDataConfig, JSON.stringify(merged, null, 2), 'utf-8')
          process.stderr.write(`[DEBUG] Migrated to %APPDATA%\n`)
        } catch (e) {
          process.stderr.write(`[DEBUG] Migration error: ${e}\n`)
        }
      }
    }

    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: `Không tìm thấy OAuth credentials cho "${projectId}" trong config. Vui lòng xóa project này và thêm lại.`,
        errorType: 'credentials_not_found',
      }
    }

    const tm = getTokenManager()

    // Step 1: Try refreshing the existing token first — if it works, credentials are still valid
    const existingToken = tm.getToken(projectId)
    if (existingToken?.refresh_token) {
      devLog(`[Project] Trying token refresh first for ${projectId}...`)
      const refreshed = await tm.refreshToken(projectId)
      if (refreshed) {
        tm.addToken(projectId, clientId, clientSecret, refreshed)
        tm.markAuthorized(projectId)
        tm.resetTokenStats(projectId)
        devLog(`[Project] Token refresh OK for ${projectId} — no re-auth needed, quota reset`)
        return { success: true, refreshed: true }
      }
    }

    // Step 2: Token refresh failed — start new OAuth flow
    devLog(`[Project] Token refresh failed for ${projectId} — starting OAuth flow`)
    const { startOAuthFlow } = await import('./services/youtube_auth.js')
    const result = await startOAuthFlow(clientId.trim(), clientSecret.trim(), projectId)

    if (result.success && result.tokens) {
      tm.addToken(projectId, clientId.trim(), clientSecret.trim(), result.tokens)
      tm.markAuthorized(projectId)
      tm.resetTokenStats(projectId)
      devLog(`[Project] Re-authorized ${projectId}`)
      return { success: true }
    }

    // Step 3: OAuth flow failed — analyze the error for a clear message
    const errMsg = result.error || 'OAuth failed'
    let errorType = 'oauth_failed'
    let userHint = ''

    if (errMsg.toLowerCase().includes('invalid_client') || errMsg.toLowerCase().includes('client secret')) {
      errorType = 'client_deleted_or_secret_regenerated'
      userHint = 'OAuth Client đã bị XÓA hoặc Client Secret đã được REGENERATE trên Google Cloud Console. Để fix: vào Google Cloud Console → APIs & Services → Credentials → tìm OAuth Client cũ (Client ID bắt đầu bằng số trong config) → UPDATE SECRET nếu muốn giữ client cũ, HOẶC xóa HyperClip project này và thêm lại với Client ID + Secret mới.'
    } else if (errMsg.toLowerCase().includes('invalid_grant') || errMsg.toLowerCase().includes('token')) {
      errorType = 'refresh_token_revoked'
      userHint = 'Refresh token đã bị revoke. Cần re-authorize qua trình duyệt.'
    }

    return {
      success: false,
      error: errMsg,
      errorType,
      userHint,
    }
  })

  /**
   * Repair a project: reset quota + error state, then re-authorize via OAuth.
   * Combines reset-quota + reauthorize in one call so the user doesn't have to
   * click two buttons when a project's token or key is broken.
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_REPAIR, async (_, projectId: string) => {
    const tm = getTokenManager()
    const km = getKeyManager()

    // Step 1: Clear all error state — reset quota, clear unauthorized flags
    const keys = km.getAllKeys().filter(k => k.projectId === projectId)
    for (const k of keys) {
      km.resetKey(k.key)
    }
    tm.resetTokenStats(projectId)
    devLog(`[Project] Repair(${projectId}): reset quota + cleared error state`)

    // Step 2: Try re-authorize (refresh token → if fails, OAuth flow)
    const fs = await import('fs')
    const pathMod = await import('path')
    const configFile = pathMod.join(getAppStoreDir(), 'oauth_config.json')

    let clientId = ''
    let clientSecret = ''

    try {
      if (fs.existsSync(configFile)) {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
        const proj = config[projectId]
        if (proj?.clientId && proj?.clientSecret) {
          clientId = proj.clientId
          clientSecret = proj.clientSecret
        } else if (config.client_id && config.client_secret) {
          clientId = config.client_id
          clientSecret = config.client_secret
        }
      }
    } catch {}

    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: `Không tìm thấy OAuth credentials cho "${projectId}" trong config.`,
        needsCredentials: true,
      }
    }

    // Try token refresh first
    const existingToken = tm.getToken(projectId)
    if (existingToken?.refresh_token) {
      const refreshed = await tm.refreshToken(projectId)
      if (refreshed) {
        tm.addToken(projectId, clientId, clientSecret, refreshed)
        tm.markAuthorized(projectId)
        devLog(`[Project] Repair(${projectId}): token refresh OK — project repaired without browser`)
        return { success: true, repaired: true, refreshed: true }
      }
    }

    // Refresh failed or no token — need OAuth flow
    devLog(`[Project] Repair(${projectId}): need OAuth flow to get new token`)
    const { startOAuthFlow } = await import('./services/youtube_auth.js')
    const result = await startOAuthFlow(clientId.trim(), clientSecret.trim(), projectId)

    if (result.success && result.tokens) {
      tm.addToken(projectId, clientId.trim(), clientSecret.trim(), result.tokens)
      tm.markAuthorized(projectId)
      devLog(`[Project] Repair(${projectId}): OAuth flow OK — project repaired`)
      return { success: true, repaired: true }
    }

    return {
      success: false,
      error: result.error || 'Repair failed',
      errorType: 'oauth_failed',
      needsOAuthFlow: true,
    }
  })

  /**
   * Test all projects in parallel — returns status for each projectId.
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_TEST_ALL, async () => {
    const tm = getTokenManager()
    const km = getKeyManager()
    const tokenStatuses = tm.getAllStatuses()
    const keys = km.getAllKeys()

    const projects = tokenStatuses.map(ts => ({
      projectId: ts.projectId,
      clientId: ts.clientId,
      hasToken: ts.hasToken,
      tokenExpiry: ts.tokenExpiry,
      tokenStatus: ts.status,
      tokenErrors: ts.errors,
      tokenUsedToday: ts.usedToday,
      apiKey: keys.find(k => k.projectId === ts.projectId)?.key || null,
      apiKeyName: keys.find(k => k.projectId === ts.projectId)?.name || null,
      apiKeyStatus: keys.find(k => k.projectId === ts.projectId)?.status || 'unauthorized',
      apiKeyUsed: keys.find(k => k.projectId === ts.projectId)?.usedToday || 0,
    }))

    // Also include projects with API keys but no token
    const tokenProjectIds = new Set(tokenStatuses.map(t => t.projectId))
    for (const k of keys) {
      if (!tokenProjectIds.has(k.projectId)) {
        projects.push({
          projectId: k.projectId,
          clientId: '',
          hasToken: false,
          tokenExpiry: null,
          tokenStatus: 'no_oauth' as const,
          tokenErrors: 0,
          tokenUsedToday: 0,
          apiKey: k.key,
          apiKeyName: k.name,
          apiKeyStatus: k.status,
          apiKeyUsed: k.usedToday,
        })
      }
    }

    return { projects, checkedAt: Date.now() }
  })

  /**
   * Batch repair: repair multiple projects in sequence.
   * Returns per-project results for the UI to display.
   */
  ipcMain.handle(IPC_CHANNELS.PROJECT_BATCH_REPAIR, async (_, projectIds: string[]) => {
    const results: Record<string, { success: boolean; error?: string; repaired?: boolean }> = {}
    for (const projectId of projectIds) {
      const repairResult = await (async () => {
        const tm = getTokenManager()
        const km = getKeyManager()

        const keys = km.getAllKeys().filter(k => k.projectId === projectId)
        for (const k of keys) {
          km.resetKey(k.key)
        }
        tm.resetTokenStats(projectId)

        const fs = await import('fs')
        const pathMod = await import('path')
        const configFile = pathMod.join(getAppStoreDir(), 'oauth_config.json')

        let clientId = ''
        let clientSecret = ''

        try {
          if (fs.existsSync(configFile)) {
            const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
            const proj = config[projectId]
            if (proj?.clientId && proj?.clientSecret) {
              clientId = proj.clientId
              clientSecret = proj.clientSecret
            } else if (config.client_id && config.client_secret) {
              clientId = config.client_id
              clientSecret = config.client_secret
            }
          }
        } catch {}

        if (!clientId || !clientSecret) {
          return { success: false, error: 'Thiếu credentials', needsCredentials: true }
        }

        const existingToken = tm.getToken(projectId)
        if (existingToken?.refresh_token) {
          const refreshed = await tm.refreshToken(projectId)
          if (refreshed) {
            tm.addToken(projectId, clientId, clientSecret, refreshed)
            tm.markAuthorized(projectId)
            return { success: true, repaired: true, refreshed: true }
          }
        }

        const { startOAuthFlow } = await import('./services/youtube_auth.js')
        const result = await startOAuthFlow(clientId.trim(), clientSecret.trim(), projectId)
        if (result.success && result.tokens) {
          tm.addToken(projectId, clientId.trim(), clientSecret.trim(), result.tokens)
          tm.markAuthorized(projectId)
          return { success: true, repaired: true }
        }
        return { success: false, error: result.error || 'OAuth failed', needsOAuthFlow: true }
      })()

      results[projectId] = repairResult
    }
    return results
  })

  // ─── Project Auto-Assign ───────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.PROJECT_AUTO_ASSIGN, async () => {
    try {
      const pm = getProjectManager()
      const channels = getChannels()
      const channelIds = channels.map(ch => ch.channelId || ch.id)
      pm.autoAssignChannels(channelIds)
      const status = pm.getStatus()
      return { success: true, assigned: channelIds.length }
    } catch (e: any) {
      console.error('[IPC] PROJECT_AUTO_ASSIGN error:', e)
      return { success: false, assigned: 0, error: e.message }
    }
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
    const cookiesExtracted = await sm.openLoginWindow(profileId)
    return { success: true, cookiesExtracted }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_CLONE_ONE, async () => {
    const sm = getSessionManager()
    return sm.cloneSessionOne()
  })

  // ─── Log Export (P1) ─────────────────────────────────────────────────────────
  ipcMain.handle('logs:read', async () => {
    const logDir = getLogDir()
    const files: { name: string; size: number; mtime: number; content?: string }[] = []
    const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB per file
    const MAX_LINES = 5000 // last 5000 lines
    try {
      for (const fname of fs.readdirSync(logDir)) {
        if (!fname.startsWith('hyperclip')) continue
        const fp = path.join(logDir, fname)
        const stat = fs.statSync(fp)
        // Skip files larger than 5 MB — just show metadata
        if (stat.size > MAX_FILE_SIZE) {
          files.push({ name: fname, size: stat.size, mtime: stat.mtimeMs, content: undefined })
          continue
        }
        // Read last MAX_LINES lines to avoid OOM on large files
        const raw = fs.readFileSync(fp, 'utf-8')
        const allLines = raw.split('\n')
        const tail = allLines.length > MAX_LINES
          ? allLines.slice(-MAX_LINES)
          : allLines
        files.push({ name: fname, size: stat.size, mtime: stat.mtimeMs, content: tail.join('\n') })
      }
    } catch {}
    return { files, logDir }
  })

  ipcMain.handle('logs:export', async () => {
    const logDir = getLogDir()
    const tmpDir = path.join(os.tmpdir(), 'hyperclip-logs-' + Date.now())
    fs.mkdirSync(tmpDir, { recursive: true })

    // 1. System snapshot
    fs.writeFileSync(path.join(tmpDir, 'system_info.txt'), getSystemSnapshot())

    // 2. Log files
    try {
      for (const fname of fs.readdirSync(logDir)) {
        if (!fname.startsWith('hyperclip')) continue
        fs.copyFileSync(path.join(logDir, fname), path.join(tmpDir, fname))
      }
    } catch {}

    // 3. Crash dumps (minidumps)
    const crashDir = path.join(app.getPath('crashDumps'))
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

    // 4. Diagnostic output (current state)
    try {
      const diag = await runDiagnostics()
      fs.writeFileSync(path.join(tmpDir, 'diagnostics.json'), JSON.stringify(diag, null, 2))
    } catch {}

    // 5. Settings
    try {
      const settings = loadSettings()
      fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify(settings, null, 2))
    } catch {}

    // Save as zip
    const { execSync } = await import('child_process')
    const zipPath = path.join(os.tmpdir(), `hyperclip-logs-${new Date().toISOString().slice(0, 10)}.zip`)
    const { dialog } = await import('electron')
    const saveResult = await dialog.showSaveDialog(mainWindow!, {
      title: 'Lưu file log',
      defaultPath: zipPath,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    })
    if (saveResult.canceled || !saveResult.filePath) return { success: false }

    try {
      execSync(`powershell -Command "Compress-Archive -Path '${tmpDir}\\*' -DestinationPath '${saveResult.filePath}' -Force"`, { stdio: 'ignore' })
      // Cleanup tmp
      fs.rmSync(tmpDir, { recursive: true, force: true })
      shell.showItemInFolder(saveResult.filePath)
      return { success: true, path: saveResult.filePath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
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
    devLog(`[HyperClip] Cookie critical failure: ${errorMsg} — redirecting to login`)
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
  killPersistentChrome()
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
  devLog('[HyperClip] Starting...')

  // Auto-migrate: if legacy AppData\Roaming\HyperClip exists, move it to the new base dir.
  {
    const legacy = getLegacyDataPath()
    const legacyMarker = path.join(getHyperClipBaseDir(), '.legacy-migrated')
    if (legacy && !fs.existsSync(legacyMarker)) {
      devLog(`[Migration] Found legacy data at ${legacy}, migrating to ${getHyperClipBaseDir()}...`)
      try {
        const dest = getAppStoreDir()
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
        const files = fs.readdirSync(legacy)
        for (const file of files) {
          const src = path.join(legacy, file)
          const dst = path.join(dest, file)
          if (!fs.existsSync(dst)) {
            fs.renameSync(src, dst)
          }
        }
        fs.writeFileSync(legacyMarker, JSON.stringify({ migratedAt: Date.now(), legacyPath: legacy }), 'utf-8')
        devLog(`[Migration] App data migrated to ${dest}`)

        // Also migrate Chrome profiles: AppData\Local\HyperClip-Chrome-Profile-* → chrome-profiles\profile-*
        const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
        const chromeProfilesDest = path.join(getHyperClipBaseDir(), 'chrome-profiles')
        let migratedProfiles = 0
        for (let i = 1; i <= 30; i++) {
          const srcProfile = path.join(LOCALAPPDATA, `HyperClip-Chrome-Profile-${i}`)
          const dstProfile = path.join(chromeProfilesDest, `profile-${i}`, 'Default')
          if (fs.existsSync(srcProfile) && !fs.existsSync(dstProfile)) {
            try {
              fs.mkdirSync(path.dirname(dstProfile), { recursive: true })
              const items = fs.readdirSync(srcProfile)
              for (const item of items) {
                fs.renameSync(path.join(srcProfile, item), path.join(dstProfile, item))
              }
              migratedProfiles++
            } catch (e) {
              console.warn(`[Migration] Chrome profile ${i} migration failed:`, e)
            }
          }
        }
        if (migratedProfiles > 0) {
          devLog(`[Migration] Migrated ${migratedProfiles} Chrome profiles to ${chromeProfilesDest}`)
        }
        sendNotification('info', `HyperClip đã chuyển dữ liệu sang ổ D để giảm tải ổ C.`)
      } catch (e) {
        console.warn('[Migration] Failed:', e)
      }
    }
  }

  // P0: Run system diagnostics — check all prerequisites and alert user to issues
  const diag = await runDiagnostics()
  if (!diag.overall.ready) {
    console.warn('[HyperClip] Diagnostics issues:')
    for (const issue of diag.overall.issues) {
      console.warn('  -', issue)
    }
    sendNotification('warning', `Có vấn đề: ${diag.overall.issues[0]}. Xem Settings → Diagnostics để biết thêm.`)
  } else {
    devLog('[HyperClip] Diagnostics: All prerequisites OK')
  }

  // P0: Hardware-aware performance profile log
  const caps = getGPUCapabilities()
  const profile = detectSystemProfile()
  devLog(`[HyperClip] Performance profile: GPU=${caps.gpuName} [${caps.encoder}] tier=${caps.tier} workers=${caps.maxChunkWorkers} sessions=${profile.sessionCount} RAM=${profile.isLaptop ? 'laptop' : 'desktop'}`)

  // Validate FFmpeg hardware encoder (separate from existence check)
  const ffmpegPath = getFfmpegPath()
  if (diag.ffmpeg.ok && !diag.ffmpeg.hasNvenc) {
    console.warn('[HyperClip] FFmpeg found but no NVENC hardware encoder — rendering will use CPU (slow).')
    sendNotification('info', 'FFmpeg không có NVENC — render sẽ chậm. Khuyến nghị FFmpeg build có hỗ trợ NVIDIA NVENC.')
  }

  // NVDEC + CUDA filter pipeline status: required for fast GPU-accelerated rendering.
  // NVDEC = hardware video decode (GPU, not CPU). CUDA filters = scale/crop/overlay on GPU.
  // Without these: software decode + CPU filter pipeline = 10-20x slower renders.
  const nvDecStatus = diag.ffmpeg.hasNvdec
    ? `✓ NVDEC (GPU decode) — ${caps.gpuName}`
    : '✗ Không có NVDEC (software decode)'
  const cudaFilterStatus = diag.ffmpeg.hasCudaFilters
    ? '✓ CUDA filters (GPU scale/crop/overlay)'
    : '✗ Không có CUDA filters (CPU filter pipeline)'
  devLog(`[HyperClip] FFmpeg pipeline: ${nvDecStatus}`)
  devLog(`[HyperClip] FFmpeg pipeline: ${cudaFilterStatus}`)

  if (diag.ffmpeg.ok && (!diag.ffmpeg.hasNvdec || !diag.ffmpeg.hasCudaFilters)) {
    console.warn('[HyperClip] RENDER: CPU decode + CPU filter + NVENC GPU encode (không có NVDEC/CUDA filters)')
    sendNotification('info', `Render: CPU decode + CPU filter + NVENC GPU encode. CÀI FFmpeg build có NVDEC để render nhanh hơn.`)
  }

  // P2: RAM disk not available
  if (!diag.storage.ramDiskAvailable) {
    devLog('[HyperClip] RAM disk not available — videos will be stored on disk (slower I/O).')
    sendNotification('info', 'RAM disk chưa bật — video sẽ lưu ổ C (chậm hơn RAM disk). Có thể bỏ qua nếu không cần tốc độ cao.')
  }

  // Setup: copy Arial font to resources/fonts/ for FFmpeg drawtext (lavfi requires no `:` in fontfile paths).
  // FFmpeg gyan.dev lavfi parser splits option values at COLON characters (drive letter `D:`).
  // Using a relative path `resources/fonts/arial.ttf` avoids this issue entirely.
  // Additionally, create fontconfig config so FFmpeg can find the font via fontfile=arial.ttf.
  {
    const fontsDir = path.join(__dirname, '..', 'resources', 'fonts')
    const fontPath = path.join(fontsDir, 'arial.ttf')
    // Also create fontconfig at D:\fonts\fonts.conf for FONTCONFIG_FILE env var
    const fcDir = 'D:\\fonts'
    const fcPath = path.join(fcDir, 'fonts.conf')
    const fcXml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontsDir.replace(/\\/g, '\\\\')}</dir>
  <dir>${fcDir.replace(/\\/g, '\\\\')}</dir>
</fontconfig>
`
    if (!fs.existsSync(fontPath)) {
      try {
        fs.mkdirSync(fontsDir, { recursive: true })
        const systemFont = 'C:\\Windows\\Fonts\\arial.ttf'
        if (fs.existsSync(systemFont)) {
          fs.copyFileSync(systemFont, fontPath)
          devLog(`[Setup] Copied Arial font to ${fontPath}`)
        } else {
          devLog(`[Setup] System Arial font not found at ${systemFont} — text overlays may fail`)
        }
      } catch (e) {
        devLog(`[Setup] Font copy failed: ${e}`)
      }
    } else {
      devLog(`[Setup] Arial font already present at ${fontPath}`)
    }
  }

  // Auto-boot Next.js if not already running on port 3000
  const nextRunning = await isPortOpen(NEXT_PORT)
  if (nextRunning) {
    devLog(`[HyperClip] Next.js already running on port ${NEXT_PORT}`)
  } else {
    await startNextServer()
  }

  // Poll HTTP until server responds (handles cases where port is open but
  // Next.js hasn't finished compiling yet, especially in production).
  devLog(`[HyperClip] Waiting for Next.js HTTP server on port ${NEXT_PORT}...`)
  const http = await import('http')
  await new Promise<void>((resolve) => {
    let attempts = 0
    const timeout = setTimeout(() => {
      console.warn(`[HyperClip] HTTP check timeout after ${attempts} attempts — proceeding anyway`)
      resolve()
    }, 30000)
    const check = () => {
      attempts++
      const req = http.get(`http://localhost:${NEXT_PORT}`, (res) => {
        clearTimeout(timeout)
        devLog(`[HyperClip] Next.js HTTP server confirmed (status ${res.statusCode}) after ${attempts} attempt(s)`)
        res.resume()
        resolve()
      })
      req.on('error', (err) => {
        if (attempts % 10 === 0) {
          devLog(`[HyperClip] HTTP check attempt ${attempts}: ${err.message}`)
        }
        setTimeout(check, 1000)
      })
      req.setTimeout(5000, () => {
        req.destroy()
        if (attempts % 10 === 0) {
          devLog(`[HyperClip] HTTP check attempt ${attempts}: timeout, retrying...`)
        }
      })
    }
    check()
  })

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

  // ─── Health Alert Checker (every 60s) ───────────────────────────────────────
  // Runs periodic health checks and sends notifications to the renderer.
  setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      const alerts = await checkHealthAlerts()
      sendHealthAlerts(alerts, mainWindow)
    } catch (e) {
      devLog(`[HealthCheck] Error: ${(e as Error).message}`)
    }
  }, 60_000)

  // Initial health check after 30 seconds (let things settle)
  setTimeout(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      const alerts = await checkHealthAlerts()
      sendHealthAlerts(alerts, mainWindow)
    } catch {}
  }, 30_000)

  // Resolve missing channelIds for demo channels at startup
  resolveChannelIdsForPoll()

  // ─── Startup recovery: reset stale 'rendering' workspaces ───────────────────
  // If app was killed mid-render, workspaces are stuck at 'rendering' with 0% progress.
  // - Source video exists → reset to 'ready' (user can re-render)
  // - Source video missing → reset to 'error' (user can re-download)
  {
    const ws = getWorkspaces()
    let recovered = 0
    for (const w of ws) {
      if (w.status === 'rendering') {
        const sourcePath = findDownloadedFileAbs(w.id) || w.downloadedPath
        const sourceExists = sourcePath && fs.existsSync(sourcePath)
        if (sourceExists) {
          devLog(`[StartupRecovery] "${w.videoTitle}" → 'ready' (source video found: ${path.basename(sourcePath)})`)
          updateWorkspace(w.id, { status: 'ready', renderProgress: 0 })
        } else {
          devLog(`[StartupRecovery] "${w.videoTitle}" → 'error' (source video not found)`)
          updateWorkspace(w.id, { status: 'error', renderProgress: 0 })
        }
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(w.id))
        recovered++
      }
    }
    if (recovered > 0) devLog(`[StartupRecovery] Recovered ${recovered} stale rendering workspace(s)`)
  }

  // Scan storage directory for existing downloaded files — register them as "seen"
  // so poll won't re-download files already on disk
  scanExistingDownloadedFiles()

  // Catch up: auto-render any 'ready' workspaces that didn't get rendered yet.
  // This handles workspaces created before auto-render was enabled, or where
  // the trigger was skipped due to a prior crash / missing autoRenderAttempted field.
  triggerAutoRenderForReadyWorkspaces()

  // Init cookie manager (auto-refresh every 15m + sub sync every 2m)
  const cookieResult = await initCookieManager()
  if (cookieResult.success) {
    devLog(`[HyperClip] Cookies ready (${cookieResult.browser}, ${cookieResult.cookies.length} cookies)`)
  } else {
    console.warn(`[HyperClip] Cookie init failed: ${cookieResult.error} — polling will retry`)
  }

  // Start auto-refresh timer (cookies + subscription sync)
  getCookieManager().startAutoRefresh()

  // Start polling ONLY after the renderer page has fully loaded AND Innertube pool is initialized.
  // This guarantees the window + frontend IPC listeners are ready before
  // any broadcast() call, so workspaces are always created and shown in real-time.
  // Also guarantees Innertube pool is ready before first poll — prevents OAuth quota waste.
  if (mainWindow) {
    // did-finish-load fires immediately if the page is already loaded
    mainWindow.webContents.once('did-finish-load', async () => {
      // Pre-warm the Innertube pool before polling starts.
      // Without this, the first poll races with pool initialization → OAuth fallback waste.
      // The pool init runs concurrently with SessionManager init (~12s), so start it early.
      devLog('[HyperClip] Pre-warming Innertube pool...')
      const { getInnertubePool } = await import('./services/innertube_client.js')
      const pool = await getInnertubePool()
      const poolStatus = pool.getStatus()
      devLog(`[HyperClip] Innertube pool: ${poolStatus.readyCount}/${poolStatus.totalSessions} sessions ready`)

      startYouTubePoller(5_000, (videos) => {
        // Non-blocking: enqueue all detected videos for background download.
        // Each enqueueBgDownload() immediately creates a 'waiting' workspace → UI shows video right away.
        // Downloads run in parallel (max 2-3 concurrent) without blocking the poller.
        if (videos.length > 0) {
          opLog.success('scan', `Found ${videos.length} new video(s)`, videos.map(v => v.title).join(', '))
        }
        for (const v of videos) {
          devLog(`[AutoIngest] new video detected: ${v.title} (${v.channelName}), enqueueing...`)
          opLog.info('download', `Auto-download triggered: ${v.title}`, v.channelName)

          // Check for existing 'error' workspace with expired backoff — retry it directly
          const existingWorkspaces = getWorkspaces()
          const errorWs = existingWorkspaces.find(ws =>
            ws.videoId === v.videoId &&
            ws.status === 'error' &&
            (!ws.retryableAt || Date.now() >= new Date(ws.retryableAt).getTime())
          )
          if (errorWs && !inProgressAutoRetries.has(errorWs.id)) {
            devLog(`[AutoIngest] retrying errored workspace ${errorWs.id}: ${v.title}`)
            retryAutoDownload(errorWs)
            continue
          }

          enqueueBgDownload(v)
        }
      }, () => {
        // Innertube degraded — notify UI
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.INNERTUBE_DEGRADED_EVENT, { degraded: true })
          mainWindow.webContents.send(IPC_CHANNELS.NOTIFICATION_EVENT, {
            type: 'warning',
            message: '⚠️ Innertube đang degraded — đang kiểm tra OAuth...',
          })
        }
      })
      devLog('[HyperClip] Auto-ingestion active (5s interval)')
      devLog(`[HyperClip] Ready → http://localhost:${NEXT_PORT}`)
      startSystemMonitor()

      // ─── Periodic storage cleanup (every 1 hour) ─────────────────────────────────
      setInterval(() => {
        const cleanupDays = loadSettings().downloadsCleanupDays ?? 7
        if (cleanupDays <= 0) return
        try {
          const storagePath = getVideoStoragePath()
          const cutoff = Date.now() - cleanupDays * 24 * 60 * 60 * 1000
          const workspaces = getWorkspaces()
          const activeIds = new Set(workspaces.map(w => w.id))
          if (_activeWorkspaceId) activeIds.add(_activeWorkspaceId)
          let cleaned = 0
          for (const entry of fs.readdirSync(storagePath)) {
            if (entry.startsWith('blur_')) continue
            const ext = path.extname(entry).toLowerCase()
            if (!['.mp4', '.mkv', '.webm', '.avi', '.mov'].includes(ext)) continue
            // Skip if this file belongs to an active workspace
            const entryBase = entry.replace(/\.\w+$/, '')
            const isActive = Array.from(activeIds).some(id => entryBase.startsWith(id + '_') || entryBase === id)
            if (isActive) continue
            const fullPath = path.join(storagePath, entry)
            try {
              const stat = fs.statSync(fullPath)
              if (stat.mtimeMs < cutoff) { fs.unlinkSync(fullPath); cleaned++ }
            } catch {}
          }
          if (cleaned > 0) devLog(`[PeriodicCleanup] Removed ${cleaned} old video files`)
        } catch {}
      }, 60 * 60 * 1000)

      // ─── Disk space monitoring (every 30 minutes) ──────────────────────────────
      setInterval(() => {
        try {
          const storagePath = getVideoStoragePath()
          const ramDiskInfo = getRamDiskInfo()
          // RAMDISK-aware: warn when 80% full (not hardcoded 20GB)
          const FREE_WARNING_BYTES = ramDiskInfo.isAvailable
            ? Math.floor(ramDiskInfo.total * (1 - ramDiskInfo.warningPct) * 1024 * 1024 * 1024)
            : 20 * 1024 * 1024 * 1024  // Fallback: 20GB for non-RAMDISK paths
          const freeBytes = getFreeDiskSpace(storagePath)
          if (freeBytes > 0 && freeBytes < FREE_WARNING_BYTES) {
            const freeGB = (freeBytes / (1024 ** 3)).toFixed(1)
            mainWindow?.webContents.send(IPC_CHANNELS.NOTIFICATION_EVENT, { type: 'warning', message: `Low disk space: only ${freeGB} GB free` })
          }
        } catch {}
      }, 30 * 60 * 1000)
    })
  }
})

app.on('window-all-closed', quitAll)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

process.on('uncaughtException', (err) => {
  log.crash('Uncaught exception', err)
  sendNotification('error', `Uncaught error: ${err.message}`)
})

process.on('unhandledRejection', (reason: unknown) => {
  log.crash('Unhandled promise rejection', reason)
})

// ─── Crash Reporter (Electron built-in) ───────────────────────────────────────
// Stores minidumps locally. User can export via Settings > Logs.
crashReporter.start({
  productName: 'HyperClip',
  companyName: 'LoopCompany',
  submitURL: '',  // No server yet — minidumps saved locally only
  uploadToServer: false,
})

// Log startup banner
log.info(`HyperClip starting — v${app.getVersion()} | Electron ${process.versions.electron} | Node ${process.version}`)

// ─── E2E Test Server ───────────────────────────────────────────────────────────
// Starts an HTTP server on port 9312 when HYPERCLIP_TEST=1.
// The test client (scripts/test-e2e.mjs) connects to this server to run E2E tests.
if (process.env.HYPERCLIP_TEST === '1') {
  app.whenReady().then(() => {
    startE2EServer()
    app.on('quit', stopE2EServer)
  })
}
