/**
 * Settings IPC handlers.
 * Channels: SETTINGS_GET, SETTINGS_UPDATE
 */

import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../channels.js'
import { loadSettings, saveSettings } from '../../services/ramdisk.js'
import { getYouTubePoller } from '../../services/youtube_poller.js'

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    const settings = loadSettings()
    // SECURITY: strip sensitive fields
    const { proxyPassword, ...publicSettings } = settings
    return publicSettings
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_, patch: {
    videoStoragePath?: string
    outputPath?: string
    defaultTrimLimit?: number | 'full'
    defaultQuality?: 1080 | 720
    autoDownloadQuality?: string
    autoDownloadEnabled?: boolean
    autoRender?: boolean
    autoRenderResolution?: string
    autoRenderFPS?: number
    downloadsCleanupDays?: number
    renderedOutputPath?: string
    pollIntervalMs?: number
    proxyEnabled?: boolean
    proxyHost?: string
    proxyPort?: number
    proxyUsername?: string
    proxyPassword?: string
    maxConcurrentDownloads?: number
    videoMinDurationSec?: number
    videoMaxDurationSec?: number
    quitOnClose?: boolean
  }) => {
    const settings = loadSettings()
    saveSettings({ ...settings, ...patch })

    // Apply poller interval change immediately if poller is running
    if (patch.pollIntervalMs !== undefined) {
      const poller = getYouTubePoller()
      if (poller) poller.restart(patch.pollIntervalMs)
    }

    return loadSettings()
  })
}
