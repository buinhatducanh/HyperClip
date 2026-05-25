/**
 * GitHub Auto-Update IPC handlers.
 * Channels: UPDATE_CHECK, UPDATE_DOWNLOAD, UPDATE_INSTALL, UPDATE_STATUS, UPDATE_EVENT
 */

import type { IpcMain } from 'electron'
import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../channels.js'
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateStatus,
  setUpdateEventHandler,
  openReleasePage,
} from '../../services/github-updater.js'

export function registerGitHubUpdaterHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    return await checkForUpdates()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => {
    const success = await downloadUpdate()
    return { success }
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, () => {
    return { success: installUpdate() }
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_STATUS, () => {
    return getUpdateStatus()
  })

  ipcMain.handle('update:open-release', () => {
    openReleasePage()
    return { success: true }
  })

  // Forward update events to renderer
  setUpdateEventHandler((type, data) => {
    // The events are forwarded to all windows via the IPC event system
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('update:event', { type, ...(data as object) })
      }
    }
  })
}
