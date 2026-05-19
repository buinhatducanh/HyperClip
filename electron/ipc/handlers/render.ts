/**
 * Render IPC handlers.
 * Channels: RENDER_START, RENDER_CANCEL, RENDER_CHUNKED,
 *           RENDERED_LIST, RENDERED_ARCHIVE, RENDERED_REMOVE,
 *           RENDERED_OPEN_FOLDER, RENDERED_SET_ARCHIVE_PATH
 */

import type { IpcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { IPC_CHANNELS } from '../channels.js'
import { broadcast, sendNotification } from '../ipc-state.js'
import { getWorkspace, updateWorkspace, getRenderedVideos, addRenderedVideo, removeRenderedVideo, type RenderedVideoRecord, type RenderConfigRecord, type SourceInfoRecord } from '../../services/store.js'
import { loadSettings, saveSettings, getVideoStoragePath, getOutputPath, archiveRenderedFile, openArchiveFolder, showInFolder, getAppStoreDir } from '../../services/ramdisk.js'
import { renderVideo, renderChunked, cancelChunked, type RenderMetadata, type RenderProgress, type ChunkConfig } from '../../services/ffmpeg.js'
import { cancelFfmpeg, getPoolStatus } from '../../services/worker-pool.js'
import { getGPUCapabilities } from '../../services/system.js'
import { devLog } from '../../services/unified_log.js'

// ─── Render Queue ─────────────────────────────────────────────────────────────────
type RenderJob = {
  workspaceId: string
  metadata: RenderMetadata
  resolve: (val: { success: boolean; outputPath?: string; error?: string }) => void
}

export const renderQueue: RenderJob[] = []

export function startNextQueuedRender(): void {
  const max = loadSettings().maxConcurrentRenders ?? 2
  if (getPoolStatus().active >= max) return
  if (renderQueue.length === 0) return

  const job = renderQueue.shift()!
  executeRenderJob(job)
}

function executeRenderJob(job: RenderJob): void {
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
  devLog(`[TIMER] RENDER START: "${workspace.videoTitle}"`)
  devLog(`[TIMER]   Quality: ${renderQuality}p | Speed: ${renderSpeed}x | Trim: ${trimDuration}s (${trimStart}s–${trimEnd}s)`)
  devLog(`[TIMER]   Codec: ${metadata.codec ?? 'hevc'} | Source: ${path.basename(videoPath)}`)

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

  // Build resolved metadata with workspace state merged in
  const wsBlurBg = workspace?.blurBackgroundPath || ''
  const wsThumbPath = path.join(getVideoStoragePath(), `thumb_${workspaceId}.jpg`)
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
    blur_background: metadata.blur_background || wsBlurBg,
    backgroundImage: !metadata.backgroundImage && !wsBlurBg && fs.existsSync(wsThumbPath) ? wsThumbPath : metadata.backgroundImage,
  }

  const gpuTier = getGPUCapabilities().tier

  void renderVideo(resolvedMetadata, outputDir, (progress: RenderProgress) => {
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
      // Auto-archive
      void (async () => {
        try {
          const quality = parseInt((metadata.export_resolution || '1080x1920').split('x')[1])
          const codec = (metadata.codec as string) || 'hevc'
          const thumbPath = path.join(getVideoStoragePath(), `thumb_${workspace.id}.jpg`)
          const thumbData = fs.existsSync(thumbPath)
            ? 'data:image/jpeg;base64,' + fs.readFileSync(thumbPath).toString('base64')
            : undefined
          const archiveResult = await archiveRenderedFile(result.outputPath!, workspace.channelName, workspace.videoTitle, quality || 1080, codec, workspace.fileSize || 0, workspace.duration || 0)
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
              gpuTier,
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
            broadcast(IPC_CHANNELS.RENDERED_ADD, record)
            devLog(`[Render] Archived: ${archiveResult.archivedPath}`)
            devLog(`[TIMER] ARCHIVE DONE: ${archiveResult.archivedPath}`)
            devLog(`[TIMER] ═══════════════════════════════════════════════`)
          } else {
            sendNotification('warning', `Render done, archive failed: ${archiveResult.error || 'unknown'}`, workspaceId)
            updateWorkspace(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' })
          }
        } catch (e) {
          sendNotification('error', `Archive error: ${e}`, workspaceId)
          console.warn('[Archive] failed:', e)
        }
      })()
    } else {
      updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
      sendNotification('error', `Render failed: ${result.error}`, workspaceId)
    }
    startNextQueuedRender()
  })
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────────

function findDownloadedFileAbs(workspaceId: string): string | null {
  const dirs = [
    getVideoStoragePath(),
    path.join(getAppStoreDir(), 'downloads'),
    path.join(getAppStoreDir(), 'videos'),
  ]
  for (const dir of dirs) {
    try {
      const entries = fs.readdirSync(dir)
      const found = entries.find((f: string) => {
        const base = path.basename(f, path.extname(f))
        return base === workspaceId || base.startsWith(workspaceId + '_') || base.startsWith(workspaceId + '.')
      })
      if (found) {
        const abs = path.join(dir, found)
        if (fs.existsSync(abs)) return abs
      }
    } catch { /* skip */ }
  }
  return null
}

export function registerRenderHandlers(ipcMain: IpcMain): void {
  // ─── Standard render (via worker pool) ────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.RENDER_START, async (_, workspaceId: string, metadata: RenderMetadata) => {
    return new Promise((resolve) => {
      renderQueue.push({ workspaceId, metadata, resolve })
      const max = loadSettings().maxConcurrentRenders ?? 2
      if (getPoolStatus().active < max) {
        startNextQueuedRender()
      }
    })
  })

  // ─── Cancel render ─────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.RENDER_CANCEL, async (_, workspaceId: string) => {
    const queueIdx = renderQueue.findIndex(j => j.workspaceId === workspaceId)
    if (queueIdx !== -1) {
      const job = renderQueue.splice(queueIdx, 1)[0]
      job.resolve({ success: false, error: 'Cancelled before start' })
    }
    cancelFfmpeg(`single:${workspaceId}`)
    cancelChunked(workspaceId)
    updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
    sendNotification('warning', 'Render cancelled', workspaceId)
    return { success: true }
  })

  // ─── Chunked parallel encoding ──────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.RENDER_CHUNKED, async (_, workspaceId: string, metadata: RenderMetadata, config?: ChunkConfig) => {
    const workspace = getWorkspace(workspaceId)
    if (!workspace) return { success: false, workspaceId, error: 'Workspace not found' }
    if (!workspace.downloadedPath) return { success: false, workspaceId, error: 'Video not downloaded' }

    const videoPath = workspace.preScaledPath || workspace.downloadedPath || findDownloadedFileAbs(workspaceId) || metadata.source_video
    if (!fs.existsSync(videoPath)) {
      return { success: false, workspaceId, error: `Source video not found: ${path.basename(videoPath)}` }
    }

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
    devLog(`[TIMER] RENDER START (GPU MAX CHUNKED): "${workspace.videoTitle}"`)
    devLog(`[TIMER]   Quality: ${chunkQuality}p | Speed: ${chunkSpeed}x | Trim: ${chunkTrimDuration}s | Codec: ${metadata.codec ?? 'hevc'} | Workers: ${effectiveConfig.workers}x`)

    const outputDir = getOutputPath()

    const wsBlurBg = workspace?.blurBackgroundPath || ''
    const wsThumbPath = path.join(getVideoStoragePath(), `thumb_${workspaceId}.jpg`)
    const resolvedMetadata = {
      ...metadata,
      source_video: videoPath,
      blur_background: metadata.blur_background || wsBlurBg,
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
      const thumbPath = path.join(getVideoStoragePath(), `thumb_${workspace.id}.jpg`)
      const thumbData = fs.existsSync(thumbPath)
        ? 'data:image/jpeg;base64,' + fs.readFileSync(thumbPath).toString('base64')
        : undefined
      void (async () => {
        try {
          const quality = parseInt((metadata.export_resolution || '1080x1920').split('x')[1])
          const codec = (metadata.codec as string) || 'hevc'
          const archiveResult = await archiveRenderedFile(
            result.outputPath!, workspace.channelName, workspace.videoTitle,
            quality || 1080, codec, workspace.fileSize || 0, workspace.duration || 0,
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
            broadcast(IPC_CHANNELS.RENDERED_ADD, record)
            devLog(`[TIMER] ARCHIVE DONE: ${archiveResult.archivedPath}`)
            devLog(`[TIMER] ═══════════════════════════════════════════════`)
          } else {
            sendNotification('warning', `Render done, archive failed: ${archiveResult.error || 'unknown'}`, workspaceId)
            updateWorkspace(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' })
          }
        } catch (e) {
          sendNotification('error', `Archive error: ${e}`, workspaceId)
        }
      })()
    } else {
      updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
      sendNotification('error', `Chunked render failed: ${result.error}`, workspaceId)
    }

    startNextQueuedRender()
    return result
  })

  // ─── Rendered videos ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.RENDERED_LIST, () => {
    return getRenderedVideos()
  })

  ipcMain.handle(IPC_CHANNELS.RENDERED_ARCHIVE, async (_, workspaceId: string, customArchiveDir?: string) => {
    const ws = getWorkspace(workspaceId)
    if (!ws) return { success: false, error: 'Workspace not found' }
    if (!ws.outputPath) return { success: false, error: 'No output file' }

    let prevArchivePath: string | undefined
    if (customArchiveDir) {
      const settings = loadSettings()
      prevArchivePath = settings.renderedOutputPath
      saveSettings({ ...settings, renderedOutputPath: customArchiveDir })
    }

    const quality = (ws as any).quality || 1080
    const codec = (ws as any).codec || 'hevc'

    const result = await archiveRenderedFile(
      ws.outputPath, ws.channelName, ws.videoTitle,
      quality, codec, ws.fileSize, ws.duration,
    )

    if (customArchiveDir && prevArchivePath !== undefined) {
      const settings = loadSettings()
      saveSettings({ ...settings, renderedOutputPath: prevArchivePath })
    }

    if (result.success && result.archivedPath) {
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
      broadcast(IPC_CHANNELS.RENDERED_ADD, renderedRecord)
    }

    return result
  })

  ipcMain.handle(IPC_CHANNELS.RENDERED_REMOVE, (_, id: string) => {
    const videos = getRenderedVideos()
    const video = videos.find(v => v.id === id)
    let bytesFreed = 0
    if (video?.archivedPath) {
      try {
        if (fs.existsSync(video.archivedPath)) {
          const stat = fs.statSync(video.archivedPath)
          bytesFreed = stat.size
          fs.unlinkSync(video.archivedPath)
          devLog(`[Rendered] Deleted (${(bytesFreed / 1024 / 1024).toFixed(1)} MB): ${video.archivedPath}`)
        }
      } catch {}
    }
    removeRenderedVideo(id)
    return { success: true, bytesFreed }
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
    openArchiveFolder()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.RENDERED_SET_ARCHIVE_PATH, (_, newPath: string) => {
    const settings = loadSettings()
    saveSettings({ ...settings, renderedOutputPath: newPath })
    return { success: true }
  })
}
