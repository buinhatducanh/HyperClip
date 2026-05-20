/**
 * Tracker IPC handlers.
 * Channels: TRACKER_ADD, TRACKER_LIST, TRACKER_REMOVE
 */

import type { IpcMain } from 'electron'
import path from 'path'
import { IPC_CHANNELS } from '../channels.js'
import { broadcast, sendNotification } from '../ipc-state.js'
import {
  getWorkspaces,
  getWorkspace,
  addWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../../services/store.js'
import {
  downloadVideo,
  getVideoInfo,
} from '../../services/youtube.js'
import {
  extractVideoThumbnail,
  generateBlurBackground,
} from '../../services/ffmpeg.js'
import { getVideoStoragePath, ensureStorageDirs, loadSettings, cleanupWorkspace, generateWorkspacePaths } from '../../services/ramdisk.js'
import { devLog } from '../../services/unified_log.js'

export function registerTrackerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.TRACKER_ADD,
    async (_, url: string, trimLimit: number | 'full'): Promise<ReturnType<typeof getWorkspace>> => {
      try {
        const info = await getVideoInfo(url)
        if (!info) {
          sendNotification('error', 'Failed to fetch video info. Check URL.')
          return null
        }

        const storagePath = getVideoStoragePath()
        ensureStorageDirs()

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

        const { getYtCookiesFile } = await import('../../services/po_token.js')
        const ytCookiesFile = await getYtCookiesFile()

        const result = await downloadVideo({
          workspaceId: workspace.id,
          videoUrl: url,
          outputDir: storagePath,
          trimLimit,
          quality,
          ytCookiesFile,
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
          // Extract thumbnail
          void extractVideoThumbnail(result.filePath, path.join(storagePath, `thumb_${workspace.id}.jpg`))
            .then((thumbResult) => {
              if (thumbResult.success) {
                const update = updateWorkspace(workspace.id, {
                  thumbnail: 'local-video:///' + path.join(storagePath, `thumb_${workspace.id}.jpg`).replace(/\\/g, '/'),
                })
                if (update) broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, update)
              }
            })
            .catch(() => {})

          // Mark ready
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

          // Generate blur in background
          void generateBlurBackground(result.filePath, blurPath)
            .then((blurResult) => {
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
            })
            .catch((e) => { console.warn('[Blur] Background generation failed:', e) })
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
    }
  )

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

  ipcMain.handle(IPC_CHANNELS.TRACKER_REMOVE, async (_, channelId: string) => {
    const workspaces = getWorkspaces()
    let totalBytesFreed = 0
    let totalFilesDeleted = 0
    for (const ws of workspaces) {
      if (ws.channelId === channelId) {
        const { bytesFreed, filesDeleted } = cleanupWorkspace(ws.id, ws.downloadedPath)
        totalBytesFreed += bytesFreed
        totalFilesDeleted += filesDeleted
        deleteWorkspace(ws.id)
      }
    }
    if (totalBytesFreed > 0) {
      const freedMB = (totalBytesFreed / 1024 / 1024).toFixed(1)
      sendNotification('success', `Removed channel (${totalFilesDeleted} files, ${freedMB} MB freed)`)
    }
    return { success: true, bytesFreed: totalBytesFreed, filesDeleted: totalFilesDeleted }
  })
}
