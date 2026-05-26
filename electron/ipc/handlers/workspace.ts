/**
 * Workspace IPC handlers.
 * Channels: WORKSPACE_LIST, WORKSPACE_SET_ACTIVE, WORKSPACE_UPDATE,
 *           FORMATS_GET, WORKSPACE_DELETE, WORKSPACE_RETRY, WORKSPACE_REGENERATE_BLUR
 */

import type { IpcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC_CHANNELS } from '../channels.js'
import {
  broadcast,
  sendNotification,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from '../ipc-state.js'
import {
  getWorkspaces,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../../services/store.js'
import {
  cleanupWorkspace,
  getVideoStoragePath,
  ensureStorageDirs,
  loadSettings,
  generateWorkspacePaths,
} from '../../services/ramdisk.js'
import { generateBlurBackground } from '../../services/ffmpeg.js'
import {
  downloadVideo,
  getVideoInfo,
  probeActualDuration,
  probeAvailableFormats,
} from '../../services/youtube.js'
import { devLog } from '../../services/unified_log.js'

export function registerWorkspaceHandlers(ipcMain: IpcMain): void {
  // ── List all workspaces ──────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST, async (): Promise<ReturnType<typeof getWorkspaces>> => {
    return getWorkspaces()
  })

  // ── Track active workspace ───────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, async (_, workspaceId: string | null) => {
    setActiveWorkspaceId(workspaceId)
    return { success: true }
  })

  // ── Update workspace ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_UPDATE, async (_, id: string, patch: Record<string, unknown>) => {
    const updated = updateWorkspace(id, patch as Parameters<typeof updateWorkspace>[1])
    if (updated) broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, updated)
    return updated || { success: false }
  })

  // ── Available formats probe ─────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.FORMATS_GET, async (_, videoId: string, videoUrl: string) => {
    const { getYtCookiesFile } = await import('../../services/po_token.js')
    const ytCookiesFile = await getYtCookiesFile()
    const result = await probeAvailableFormats(videoUrl, ytCookiesFile)
    if (result) {
      devLog(`[Formats] ${videoId}: available heights = [${result.heights.join(', ')}]`)
    }
    return result
  })

  // ── Delete workspace ────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_DELETE, async (_, id: string) => {
    const ws = getWorkspace(id)
    const { bytesFreed, filesDeleted } = cleanupWorkspace(id, ws?.downloadedPath)
    deleteWorkspace(id)
    const freedMB = (bytesFreed / 1024 / 1024).toFixed(1)
    sendNotification('success', `Deleted (${filesDeleted} files, ${freedMB} MB freed)`, id)
    return { success: true, bytesFreed, filesDeleted }
  })

  // ── Retry download ──────────────────────────────────────────────────────────
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

    const settings = loadSettings()
    const retryQuality = settings.autoDownloadQuality ?? '720'
    const retryTrimLimit = ws.trimLimit || 10
    devLog(`[WORKSPACE_RETRY] quality=${retryQuality}p trimLimit=${retryTrimLimit}m (user config: quality=${settings.autoDownloadQuality}p)`)

    const { getYtCookiesFile } = await import('../../services/po_token.js')
    const ytCookiesFile = await getYtCookiesFile()

    try {
      const result = await downloadVideo({
        workspaceId: id,
        videoUrl,
        outputDir: storagePath,
        trimLimit: retryTrimLimit,
        quality: retryQuality,
        ytCookiesFile,
        onProgress: (progress) => {
          updateWorkspace(id, {
            downloadProgress: progress.percent,
            downloadSpeed: progress.speed && progress.speed !== '...' ? progress.speed : undefined,
            downloadEta: progress.eta && progress.eta !== 0 ? String(progress.eta) : undefined,
          })
          broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))
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
        const actualDuration = await probeActualDuration(result.filePath)
        updateWorkspace(id, {
          status: 'ready',
          downloadedAt: new Date().toISOString(),
          downloadedPath: result.filePath,
          fileSize: result.fileSize || 0,
          thumbnail: videoInfo?.thumbnail || ws.thumbnail || '',
          videoTitle: videoInfo?.title || ws.videoTitle || '',
          duration: actualDuration || videoInfo?.duration || 0,
          downloadQuality: retryQuality,
        })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))

        const { blurPath } = generateWorkspacePaths(id)
        const blurResult = await generateBlurBackground(result.filePath, blurPath)
        updateWorkspace(id, { blurBackgroundPath: blurResult.success ? blurPath : '' })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))
        return { success: true }
      } else {
        const errorMsg = result.error || ''
        const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('video unavailable') || errorMsg.includes('not found')
        const isPrivate = errorMsg.includes('private video')
        if (isPrivate) {
          updateWorkspace(id, { status: 'error' })
        } else {
          updateWorkspace(id, { status: isNotAvailable ? 'error' : 'waiting' })
        }
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))
        return { success: false, error: result.error }
      }
    } catch (err) {
      updateWorkspace(id, { status: 'waiting' })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))
      return { success: false, error: (err as Error).message }
    }
  })

  // ── Regenerate blur background ──────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_REGENERATE_BLUR, async (_, id: string) => {
    const ws = getWorkspace(id)
    if (!ws) return { success: false, error: 'Workspace not found' }
    if (!ws.downloadedPath || !fs.existsSync(ws.downloadedPath)) {
      return { success: false, error: 'Video file not found' }
    }
    try {
      const { blurPath } = generateWorkspacePaths(id)
      const result = await generateBlurBackground(ws.downloadedPath, blurPath)
      if (result.success) {
        updateWorkspace(id, { blurBackgroundPath: blurPath })
        broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(id))
      }
      return { success: result.success, error: result.error }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
