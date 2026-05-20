/**
 * Workspace Split IPC handler.
 * Channel: WORKSPACE_SPLIT — splits a long video into multiple workspaces by trim limit.
 */

import type { IpcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { IPC_CHANNELS } from '../channels.js'
import { getWorkspace, addWorkspace, updateWorkspace } from '../../services/store.js'
import {
  trimVideo,
  extractVideoThumbnail,
  generateBlurBackground,
} from '../../services/ffmpeg.js'
import { getVideoStoragePath, generateWorkspacePaths } from '../../services/ramdisk.js'
import { broadcast, sendNotification } from '../ipc-state.js'
import { devLog } from '../../services/unified_log.js'

export function registerWorkspaceSplitHandler(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_SPLIT,
    async (_, id: string, partMinutes = 10): Promise<{ success: boolean; newWorkspaces?: ReturnType<typeof addWorkspace>[]; error?: string }> => {
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

        const newWorkspaces: ReturnType<typeof addWorkspace>[] = []

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
              } catch { /* ignore cleanup errors */ }
            }
            return { success: false, error: `Part ${i + 1} FFmpeg failed: ${trimResult.error}` }
          }

          const partSize = fs.statSync(partFilePath).size

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

          // Generate blur for this part
          const { blurPath: partBlurPath } = generateWorkspacePaths(newWs.id)
          const partBlurResult = await generateBlurBackground(partFilePath, partBlurPath)

          updateWorkspace(newWs.id, {
            thumbnail: partThumbResult.success ? 'local-video:///' + partThumbPath.replace(/\\/g, '/') : ws.thumbnail,
            blurBackgroundPath: partBlurResult.success ? partBlurPath : '',
          })

          newWorkspaces.push(newWs)
          broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, newWs)
          devLog(`[Split] Created workspace ${newWs.id} (${newWs.videoTitle})`)
        }

        sendNotification('success', `Split "${ws.videoTitle}" into ${numParts} parts`, ws.id)
        return { success: true, newWorkspaces }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )
}
