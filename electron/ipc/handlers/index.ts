/**
 * IPC Handlers index — registers domain-specific handler groups.
 *
 * Each handler file exports a `register*` function.
 * main.ts imports this module and calls registerAllHandlers().
 */

import type { IpcMain, BrowserWindow } from 'electron'
import { devLog } from '../../services/unified_log.js'
import { sendNotification } from '../ipc-state.js'
import { registerSystemHandlers } from './system.js'
import { registerAuthHandlers } from './auth.js'
import { registerSessionHandlers } from './session.js'
import { registerWorkspaceHandlers } from './workspace.js'
import { registerWorkspaceSplitHandler } from './workspace-split.js'
import { registerChannelHandlers } from './channel.js'
import { registerTrackerHandlers } from './tracker.js'
import { registerVideoHandlers } from './video.js'
import { registerRenderHandlers } from './render.js'
import { registerStorageHandlers } from './storage.js'
import { registerSettingsHandlers } from './settings.js'
import { registerPollerHandlers } from './poller.js'
import { registerOpLogHandlers } from './op-logs.js'
import { registerProjectHandlers } from './project.js'
import { registerGitHubUpdaterHandlers } from './github-updater.js'

export interface SettingsChangeCallbacks {
  /** Called when poller state needs to be re-synced (pollingEnabled or hardwareProfile changed) */
  onPollerStateChanged?: () => void
  /** Called when user enables autoRender — triggers render for any 'ready' workspaces */
  onAutoRenderEnabled?: () => void
}

export function registerAllHandlers(
  ipcMain: IpcMain,
  _getMainWindow: () => BrowserWindow | null,
  callbacks?: SettingsChangeCallbacks
): void {
  devLog('[IPC] Registering handlers...')

  registerSystemHandlers(ipcMain)
  registerAuthHandlers(ipcMain)
  registerProjectHandlers(ipcMain)
  registerSessionHandlers(ipcMain, _getMainWindow)
  registerWorkspaceHandlers(ipcMain)
  registerWorkspaceSplitHandler(ipcMain)
  registerChannelHandlers(ipcMain)
  registerTrackerHandlers(ipcMain)
  registerVideoHandlers(ipcMain)
  registerRenderHandlers(ipcMain)
  registerStorageHandlers(ipcMain, sendNotification)
  registerSettingsHandlers(ipcMain, {
    onPollerStateChanged: callbacks?.onPollerStateChanged,
    onAutoRenderEnabled: callbacks?.onAutoRenderEnabled,
  })
  registerPollerHandlers(ipcMain)
  registerOpLogHandlers(ipcMain)
  registerGitHubUpdaterHandlers(ipcMain)

  devLog('[IPC] All handlers registered')
}
