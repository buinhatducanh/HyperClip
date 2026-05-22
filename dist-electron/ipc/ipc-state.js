"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.setIPCState = setIPCState;
exports.getIPCState = getIPCState;
exports.broadcast = broadcast;
exports.sendNotification = sendNotification;
exports.getActiveWorkspaceId = getActiveWorkspaceId;
exports.setActiveWorkspaceId = setActiveWorkspaceId;
let _state = { mainWindow: null };
function setIPCState(state) {
    _state = { ..._state, ...state };
}
function getIPCState() {
    return _state;
}
function broadcast(channel, data) {
    const win = _state.mainWindow;
    if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
    }
}
function sendNotification(type, message, workspaceId) {
    broadcast('notification', {
        id: `notif-${Date.now()}`,
        type,
        message,
        workspaceId,
        timestamp: new Date().toISOString(),
    });
}
// ─── Active Workspace ID ─────────────────────────────────────────────────────────
// Tracks which workspace is open in DetailEditor — protects from auto-cleanup.
let _activeWorkspaceId = null;
function getActiveWorkspaceId() {
    return _activeWorkspaceId;
}
function setActiveWorkspaceId(id) {
    _activeWorkspaceId = id;
}
