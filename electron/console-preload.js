/**
 * Console Window Preload
 * Bridges IPC log:stream events → postMessage → console-window.html
 *
 * The console window HTML listens for window.postMessage with type 'log:entries'.
 * Window controls are exposed via contextBridge.
 */

/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { contextBridge, ipcRenderer } = require('electron')

// Listen for log:stream from unified_log.ts
ipcRenderer.on('log:stream', (_event, entries) => {
  window.postMessage({ type: 'log:entries', entries }, '*')
})

// Expose window controls for frameless window via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('console:minimize'),
  close: () => ipcRenderer.send('console:close'),
})
