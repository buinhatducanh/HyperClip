/**
 * Shared IPC state — provides access to main window, broadcast helpers, and
 * cross-handler state (active workspace ID).
 *
 * This module is the single source of truth for IPC broadcast state.
 * Import it in all extracted handler modules to avoid circular deps with main.ts.
 *
 * main.ts calls `setIPCState({ mainWindow })` during app initialization
 * before any IPC handlers are registered.
 */

import type { BrowserWindow } from 'electron'

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

interface IPCState {
  mainWindow: BrowserWindow | null
}

let _state: IPCState = { mainWindow: null }

export function setIPCState(state: Partial<IPCState>): void {
  _state = { ..._state, ...state }
}

export function getIPCState(): IPCState {
  return _state
}

export function broadcast(channel: string, data: unknown): void {
  const win = _state.mainWindow
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

export function sendNotification(type: NotificationType, message: string, workspaceId?: string): void {
  broadcast('notification', {
    id: `notif-${Date.now()}`,
    type,
    message,
    workspaceId,
    timestamp: new Date().toISOString(),
  })
}

// ─── Active Workspace ID ─────────────────────────────────────────────────────────
// Tracks which workspace is open in DetailEditor — protects from auto-cleanup.
let _activeWorkspaceId: string | null = null

export function getActiveWorkspaceId(): string | null {
  return _activeWorkspaceId
}

export function setActiveWorkspaceId(id: string | null): void {
  _activeWorkspaceId = id
}
