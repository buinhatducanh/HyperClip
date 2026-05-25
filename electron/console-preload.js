/**
 * Console Window Preload
 * Bridges IPC log:stream events → postMessage → console-window.html
 *
 * The console window HTML listens for window.postMessage with type 'log:entries'.
 */

/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { ipcRenderer } = require('electron')

// Listen for log:stream from unified_log.ts
ipcRenderer.on('log:stream', (_event, entries) => {
  window.postMessage({ type: 'log:entries', entries }, '*')
})

// Signal ready to the service that created this window
window.postMessage({ type: 'console:ready' }, '*')

// Expose window controls for frameless window
window.electronAPI = {
  minimize: () => ipcRenderer.send('console:minimize'),
  close: () => ipcRenderer.send('console:close'),
}
