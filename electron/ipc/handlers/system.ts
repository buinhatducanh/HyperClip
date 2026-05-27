/**
 * System IPC handlers.
 * Channels: SYSTEM_STATS, SYSTEM_OPEN_FOLDER, SYSTEM_OPEN_URL
 */

import type { IpcMain } from 'electron'
import { shell } from 'electron'
import { IPC_CHANNELS } from '../channels.js'
import { collectSystemStats, checkResourceAlert, getLastResourceAlert, getHardwareProfileInfo, type SystemStats, type ResourceAlert } from '../../services/system.js'

export function registerSystemHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.SYSTEM_STATS, async (): Promise<SystemStats> => {
    return collectSystemStats()
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_RESOURCE_ALERT, async (): Promise<ResourceAlert> => {
    const alert = checkResourceAlert()
    return getLastResourceAlert()
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_HARDWARE_PROFILE, async () => {
    return getHardwareProfileInfo()
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_FOLDER, async (_, folderPath: string) => {
    await shell.openPath(folderPath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_URL, async (_, url: string) => {
    void shell.openExternal(url)
    return { success: true }
  })
}
