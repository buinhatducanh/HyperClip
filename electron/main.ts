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

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function extractQualityFromResolution(res: string): number {
  const parts = (res || '1080x1920').split('x').map(Number)
  const w = parts[0] || 1080
  const h = parts[1] || 1920
  return h >= w ? w : h
}

import {
  getWorkspaces, getWorkspace, addWorkspace, updateWorkspace, deleteWorkspace,
  getChannels, getChannel, addChannel, updateChannel, removeChannel, markVideoSeen, loadSeenVideos, saveSeenVideos, type StoredChannel,
  type WorkspaceData,
  getRenderedVideos, addRenderedVideo, removeRenderedVideo, type RenderedVideoRecord, type RenderConfigRecord, type SourceInfoRecord,
} from './services/store.js'
import { downloadVideo, downloadVideoStrategy, probeVideoAvailability, probeActualDuration, getVideoInfo, getChannelInfo, getChannelId, type YtdlpVideoInfo, type YtdlpChannelInfo } from './services/youtube.js'
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
import { initLicense } from './services/license.js'
import { killPersistentChrome } from './services/cdp.js'
import { getSessionManager } from './services/chrome_cookies.js'
import { getInnertubePoolSync } from './services/innertube_client.js'
import type { SessionStatus } from './services/chrome_cookies.js'
import { log, devLog, opLog, setLogWindow, cleanupOldLogs } from './services/unified_log.js'
import { getLogDir, getSystemSnapshot } from './services/unified_log.js'
import { checkHealthAlerts, sendHealthAlerts, recordVideoDetected, recordDownloadFail, recordDownloadSuccess } from './services/health_alerts.js'
import { checkResourceAlert, getLastResourceAlert } from './services/system.js'
import { startE2EServer, stopE2EServer } from './services/e2e_server.js'
import { registerSettingsHandlers } from './ipc/handlers/settings.js'
import { registerStorageHandlers } from './ipc/handlers/storage.js'
import { setIPCState, broadcast as _broadcast, sendNotification as _sendNotification, getActiveWorkspaceId } from './ipc/ipc-state.js'
import { registerAllHandlers } from './ipc/handlers/index.js'

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
function startNextQueuedRender(): void {
  const max = loadSettings().maxConcurrentRenders ?? 2
  if (getPoolStatus().active >= max) return
  if (renderQueue.length === 0) return

  const job = renderQueue.shift()!
  executeRenderJob(job)
}

// Scan known storage directories for a downloaded video file by workspaceId.
function findDownloadedFileAbs(workspaceId: string): string | null {
  const dirs = [
    getVideoStoragePath(),
    path.join(os.tmpdir(), 'hyperclip-video'),
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
  // Header overlay fallback: use thumbnail when blurBackgroundPath is not available.
  // Ensures header always shows content even if blur generation failed.
  const resolvedOverlays = (metadata.overlays || []).map((ol: any) => {
    if (ol.type === 'header' && !ol.src && fs.existsSync(wsThumbPath)) {
      return { ...ol, src: wsThumbPath }
    }
    return ol
  })
  const resolvedMetadata = {
    ...metadata,
    source_video: videoPath,
    overlays: resolvedOverlays,
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
      void (async () => {
        try {
          const exportRes = metadata.export_resolution || '1080x1920'
          const quality = extractQualityFromResolution(exportRes)
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
            quality,
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
            const actualBytes = fs.existsSync(result.outputPath!) ? fs.statSync(result.outputPath!).size : 0
            const record: RenderedVideoRecord = {
              id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              workspaceId: workspace.id,
              channelId: workspace.channelId,
              channelName: workspace.channelName,
              videoTitle: workspace.videoTitle,
              archivedPath: archiveResult.archivedPath,
              outputPath: result.outputPath!,
              quality,
              codec,
              fileSize: formatBytes(actualBytes),
              fileSizeBytes: actualBytes,
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
            broadcast(IPC_CHANNELS.RENDERED_ADD, record)
            // [TEST-MODE] Cleanup DISABLED — keep downloaded files for render testing
            // Cleanup pre-scaled source file after successful render
            // if (workspace.preScaledPath) { try { fs.unlinkSync(workspace.preScaledPath) } catch {} }
            // Cleanup downloaded video + blur after successful archive (storage optimization)
            // const { bytesFreed } = cleanupWorkspace(workspace.id, workspace.downloadedPath)
            // if (bytesFreed > 0) { const freedMB = (bytesFreed / 1024 / 1024).toFixed(1); devLog(`[AutoArchive] Cleaned ${freedMB} MB of downloaded files after archive`) }
            const _fileSizeMB = (actualBytes / 1024 / 1024).toFixed(1)
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
    const videoUrl = 'https://www.youtube.com/watch?v=' + videoId
    devLog(`[Auto] Downloading: ${title} (${videoId}) from ${finalChannelName}, workspace=${ws.id}`)

    // Export Chrome cookies (cached 5 min) for yt-dlp authentication
    const { getYtCookiesFile } = await import('./services/po_token.js')
    const ytCookiesFile = await getYtCookiesFile()

    // ── PHASE 0: Pre-check — detect private/short/unavailable BEFORE wasting time downloading ──
    // This saves 1-5 minutes per private/short/deleted video.
    devLog(`[Auto] Pre-check: probing video availability...`)
    const preCheck = await probeVideoAvailability(videoUrl, ytCookiesFile)
    if (preCheck) {
      if (preCheck.isPrivate) {
        devLog(`[Auto] Pre-check: video is PRIVATE — skipping download, marking as error`)
        markVideoSeen(channelId, videoId)
        updateWorkspace(ws.id, { status: 'error' })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
        sendNotification('error', `Private: ${title}`, ws.id)
        return
      }
      if (preCheck.isNotFound) {
        devLog(`[Auto] Pre-check: video not found/deleted — skipping download, marking as error`)
        markVideoSeen(channelId, videoId)
        updateWorkspace(ws.id, { status: 'error' })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
        sendNotification('error', `Unavailable: ${title}`, ws.id)
        return
      }
      if (preCheck.isRateLimited) {
        devLog(`[Auto] Pre-check: rate-limited — waiting 30s before attempting download`)
        await new Promise(r => setTimeout(r, 30000))
      }
      if (preCheck.available && preCheck.duration > 0 && preCheck.duration < 60) {
        devLog(`[Auto] Pre-check: video is ${preCheck.duration}s — too short (Shorts), skipping`)
        markVideoSeen(channelId, videoId)
        updateWorkspace(ws.id, { status: 'error' })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
        return
      }
      if (preCheck.available) {
        devLog(`[Auto] Pre-check: available, duration=${preCheck.duration}s`)
      }
    } else {
      devLog(`[Auto] Pre-check: could not determine availability — proceeding with download`)
    }

    devLog(`[Auto] DOWNLOAD START: "${title}" quality=${autoQuality}p trimLimit=${autoTrimLimit === 'full' ? 'full' : autoTrimLimit + 'm'}`)

    const downloadStartMs = Date.now()
    // downloadVideoStrategy handles the full client chain (web → tv_embedded → ios)
    // with proper error classification, rate-limit backoff, and processing retry.
    let result = await downloadVideo({
      workspaceId: ws.id,
      videoUrl,
      outputDir: storagePath,
      trimLimit: autoTrimLimit,
      quality: autoQuality,
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

    if (!result.success || !result.filePath) {
      recordDownloadFail()
      const errorMsg = result.error || ''
      const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('video unavailable') || errorMsg.includes('not found')
      const isPrivate = errorMsg.includes('private video')

      if (isNotAvailable) {
        devLog(`[Auto] Video permanently unavailable: ${title} (${videoId})`)
        markVideoSeen(channelId, videoId)
        updateWorkspace(ws.id, { status: 'error' })
      } else if (isPrivate) {
        // All clients (web + tv_embedded + ios) returned Private — genuinely inaccessible
        devLog(`[Auto] All clients returned Private: ${title} (${videoId}) — marking as permanently unavailable`)
        markVideoSeen(channelId, videoId)
        updateWorkspace(ws.id, { status: 'error' })
      } else {
        // Network/rate-limit/timeout — set retryableAt for backoff
        devLog(`[Auto] Download failed (retryable): ${errorMsg}`)
        const retryableAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
        updateWorkspace(ws.id, { status: 'error', retryableAt })
      }
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))
      return
    }

    // Download succeeded — probe aspect ratio to determine if this is a 9:16 vertical video
    const aspect = await probeVideoAspect(result.filePath)
    const fileSizeMB = result.fileSize ? (result.fileSize / 1024 / 1024).toFixed(1) : '?'
    devLog(`[Auto] DOWNLOADED: "${title}" → ${result.filePath} (${fileSizeMB}MB) ASPECT=${aspect ? aspect.width + 'x' + aspect.height : 'unknown'} ${aspect?.isShort ? '(VERTICAL)' : '(LANDSCAPE)'}`)

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
    devLog(`[Auto] DOWNLOAD DONE: "${title}" (${downloadElapsed}s, ${fileSizeMB} MB)`)
    playSuccessBeep()

    // Probe actual duration from file (not yt-dlp metadata, which can be stale/wrong).
    // ffprobe reads container metadata in ~100ms — worth the extra call to ensure correct duration.
    const actualDuration = await probeActualDuration(result.filePath)
    const realDuration = actualDuration || result.duration || 0

    // Phase 1+2: Parallel — thumbnail, video info, trim, and blur ALL run simultaneously.
    // Saves ~15-20s vs sequential execution.
    const thumbnailPath = path.join(storagePath, `thumb_${ws.id}.jpg`)
    const trimLimitSec = typeof autoTrimLimit === 'number' ? autoTrimLimit * 60 : 0
    const doTrim = trimLimitSec > 0 && realDuration > trimLimitSec
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
      (isLandscape ? Promise.resolve({ success: true }) : generateBlurBackground(result.filePath, blurPath, 1080, 1920, realDuration || undefined)),
    ])

    const realTitle = videoInfo?.title || title
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

  const settings = loadSettings()
  const retryQuality = settings.autoDownloadQuality ?? '720'

  // Export Chrome cookies for yt-dlp authentication (bypasses EJS challenge → enables 1080p VP9)
  const { getYtCookiesFile } = await import('./services/po_token.js')
  const ytCookiesFile = await getYtCookiesFile()

  updateWorkspace(ws.id, { status: 'downloading', downloadProgress: 0 })
  broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(ws.id))

  // downloadVideo delegates to downloadVideoStrategy (web → tv_embedded → ios)
  const result = await downloadVideo({
    workspaceId: ws.id,
    videoUrl,
    outputDir: storagePath,
    trimLimit: ws.trimLimit || 10,
    quality: retryQuality,
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
    // Probe actual duration from downloaded file (not yt-dlp metadata, which can be stale)
    const actualDuration = await probeActualDuration(result.filePath)
    // Parallel: thumbnail + video info run simultaneously
    const thumbPath = path.join(storagePath, `thumb_${ws.id}.jpg`)
    const [thumbResult, videoInfo] = await Promise.all([
      extractVideoThumbnail(result.filePath, thumbPath),
      getVideoInfo(videoUrl),
    ])
    const realDuration = actualDuration || videoInfo?.duration || 0
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
    const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('video unavailable') || errorMsg.includes('not found')
    const isPrivate = errorMsg.includes('private video')
    if (isPrivate) {
      // All clients failed with private → genuinely inaccessible
      updateWorkspace(ws.id, { status: 'error' })
    } else if (isNotAvailable) {
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
  //   - app is unpacked (asar: false), all files in resources/app/
  //   - Next.js bin: resources/app/node_modules/next/dist/bin/next
  //   - cwd must be resources/app/ so Next.js finds .next/ in current dir
  const appUnpacked = app.isPackaged
    ? path.join(process.resourcesPath!, 'app')
    : path.join(__dirname, '..')
  const nextBin = path.join(appUnpacked, 'node_modules', 'next', 'dist', 'bin', 'next')

  devLog(`[HyperClip] Next.js bin: ${nextBin}`)
  devLog(`[HyperClip] Next.js exists: ${fs.existsSync(nextBin)}`)
  devLog(`[HyperClip] cwd: ${appUnpacked}`)

  let startupResolve: (() => void) | null = null
  return new Promise<void>((resolve) => {
    startupResolve = resolve

    // Find node executable — priority: bundled > system PATH
    // Bundled: resources/node/node.exe (shipped in installer)
    // System: fallback to whatever "node" resolves to in PATH
    let nodeExe = 'node'
    const bundledNode = app.isPackaged && process.resourcesPath
      ? path.join(process.resourcesPath, 'node', 'node.exe')
      : ''
    if (bundledNode && fs.existsSync(bundledNode)) {
      nodeExe = bundledNode
    } else {
      try {
        const { execSync } = require('child_process')
        const result = execSync('where node', { timeout: 5000, encoding: 'utf-8' })
        const firstPath = result.trim().split('\n')[0]
        if (firstPath && fs.existsSync(firstPath)) nodeExe = firstPath
      } catch {}
    }

    devLog(`[HyperClip] node executable: ${nodeExe}`)

    nextServer = spawn(nodeExe, [nextBin, '-p', String(NEXT_PORT)], {
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

  // Wire unified log to renderer for live streaming
  setLogWindow(mainWindow)

  void mainWindow.loadURL(`http://localhost:${NEXT_PORT}`)

  // Retry load if initial attempt fails (server might still be warming up)
  let loadRetries = 0
  const maxRetries = 5
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    loadRetries++
    console.warn(`[HyperClip] Load failed (attempt ${loadRetries}): ${errorDescription} (${errorCode})`)
    if (loadRetries <= maxRetries) {
      setTimeout(() => {
        devLog(`[HyperClip] Retrying load (attempt ${loadRetries + 1}/${maxRetries + 1})...`)
        void mainWindow?.webContents.loadURL(`http://localhost:${NEXT_PORT}`)
      }, 2000)
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    devLog(`[HyperClip] Window loaded successfully`)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (e) => {
    if (loadSettings().quitOnClose !== false) {
      // quitOnClose=true (default): actually quit
      void quitAll()
    } else {
      // Legacy: minimize to tray instead of quitting
      e.preventDefault()
      mainWindow?.hide()
    }
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
    { label: 'Quit', click: () => { void quitAll() } },
  ])

  tray.setToolTip('HyperClip — Auto-Render')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => mainWindow?.show())
}

// ─── Broadcast helpers ─────────────────────────────────────────────────────────
// Delegates to the shared state module so extracted handlers stay in sync.
function broadcast(channel: string, data: unknown) { void _broadcast(channel, data) }
function sendNotification(type: 'success' | 'error' | 'warning' | 'info', message: string, workspaceId?: string) { void _sendNotification(type, message, workspaceId) }

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


// ─── Auto-cleanup runs on startup ─────────────────────────────────────────────────
;(() => {
  const cleanupDays = loadSettings().downloadsCleanupDays ?? 7
  if (cleanupDays <= 0) return
  try {
    const storagePath = getVideoStoragePath()
    const cutoff = Date.now() - cleanupDays * 24 * 60 * 60 * 1000
    const workspaces = getWorkspaces()
    const activeIds = new Set(workspaces.map(w => w.id))
    const activeWsId = getActiveWorkspaceId()
    if (activeWsId) activeIds.add(activeWsId)
    let cleaned = 0
    for (const entry of fs.readdirSync(storagePath)) {
      if (entry.startsWith('blur_')) continue
      const ext = path.extname(entry).toLowerCase()
      if (!['.mp4', '.mkv', '.webm', '.avi', '.mov'].includes(ext)) continue
      const entryBase = entry.replace(/\.\w+$/, '')
      const isActive = Array.from(activeIds).some(id => entryBase.startsWith(id + '_') || entryBase === id)
      if (isActive) continue
      const fullPath = path.join(storagePath, entry)
      try {
        const stat = fs.statSync(fullPath)
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath)
          cleaned++
        }
      } catch {}
    }
    if (cleaned > 0) devLog(`[AutoCleanup] Removed ${cleaned} old video files`)
  } catch {}
})()

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

    // Resource watchdog: notify on high RAM/GPU
    const alert = checkResourceAlert()
    if (alert.level !== 'normal') {
      const notifType = alert.level === 'critical' ? 'error' : 'warning'
      sendNotification(notifType, `[Resource] ${alert.reason}`)
    }
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

  // Wait for child processes to actually terminate before quitting.
  // On Windows, SIGTERM from proc.kill() is asynchronous — app.quit()
  // would exit before FFmpeg/Chrome are fully terminated.
  await new Promise(resolve => setTimeout(resolve, 500))

  app.quit()
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
ensureStorageDirs()

// Auto-cleanup old logs (>7 days) on startup
const cleanup = cleanupOldLogs()
if (cleanup.deletedCount > 0) {
  const freedMB = (cleanup.freedBytes / 1024 / 1024).toFixed(1)
  devLog(`[LogCleanup] Removed ${cleanup.deletedCount} old log file(s), freed ${freedMB} MB`)
}

void app.whenReady().then(async () => {
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

  void createWindow()
  setIPCState({ mainWindow })
  void createTray()
  registerAllHandlers(ipcMain, () => mainWindow)

  // Init license (validates cached license, starts heartbeat if valid)
  void initLicense()

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
  void resolveChannelIdsForPoll()

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
        // Deduplicate within the same poll: OAuth can return the same videoId from
        // multiple channels (same video appears in multiple channel feeds).
        // Dedupe by videoId — keep first occurrence.
        const seen = new Set<string>()
        const uniqueVideos = videos.filter(v => {
          if (seen.has(v.videoId)) {
            devLog(`[AutoIngest] dedup: skipping duplicate ${v.videoId} from channel ${v.channelName} (already processed in this poll)`)
            return false
          }
          seen.add(v.videoId)
          return true
        })

        // Non-blocking: enqueue all detected videos for background download.
        // Each enqueueBgDownload() immediately creates a 'waiting' workspace → UI shows video right away.
        // Downloads run in parallel (max 2-3 concurrent) without blocking the poller.
        if (uniqueVideos.length > 0) {
          opLog.success('scan', `${uniqueVideos.length} video mới sẵn sàng tải về`, uniqueVideos.map(v => v.title).join(', '))
        }
        for (const v of uniqueVideos) {
          devLog(`[AutoIngest] new video detected: ${v.title} (${v.channelName}), enqueueing...`)
          opLog.info('download', `Đang tải: ${v.title}`, v.channelName)

          // Check for existing 'error' workspace with expired backoff — retry it directly
          const existingWorkspaces = getWorkspaces()
          const errorWs = existingWorkspaces.find(ws =>
            ws.videoId === v.videoId &&
            ws.status === 'error' &&
            (!ws.retryableAt || Date.now() >= new Date(ws.retryableAt).getTime())
          )
          if (errorWs && !inProgressAutoRetries.has(errorWs.id)) {
            devLog(`[AutoIngest] retrying errored workspace ${errorWs.id}: ${v.title}`)
            void retryAutoDownload(errorWs)
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
          const activeWsId = getActiveWorkspaceId()
          if (activeWsId) activeIds.add(activeWsId)
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

// ─── Graceful shutdown — triggered by NSIS installer, system shutdown, or user quit ──
// before-quit fires before the app actually exits — ensures quitAll() runs first.
// ─── Single instance lock ─────────────────────────────────────────────────────
// Only allow one instance. Second-instance launches focus the existing window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.on('before-quit', (e) => {
  e.preventDefault()           // Prevent immediate exit
  void quitAll()               // Run full cleanup (cancel FFmpeg, stop poller, etc.)
  // app.quit() called inside quitAll() after cleanup
})

app.on('window-all-closed', quitAll)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
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
  void app.whenReady().then(() => {
    startE2EServer()
    app.on('quit', stopE2EServer)
  })
}
