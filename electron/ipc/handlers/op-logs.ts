/**
 * Operation Logs IPC handlers.
 * Channels: OPERATION_LOGS_READ, OPERATION_LOGS_CLEAR
 */

import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../channels.js'
import { getLogEntries, clearLogEntries } from '../../services/unified_log.js'

export function registerOpLogHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.OPERATION_LOGS_READ, () => {
    return getLogEntries()
  })

  ipcMain.handle(IPC_CHANNELS.OPERATION_LOGS_CLEAR, () => {
    clearLogEntries()
    return { success: true }
  })
}
