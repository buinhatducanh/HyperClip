/**
 * Console Window Preload
 * Bridges IPC log:stream events → postMessage → console-window.html
 *
 * The console window HTML listens for window.postMessage with type 'log:entries'.
 */

/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { ipcRenderer } = require('electron') // require is fine in preload context

// Listen for log:stream from unified_log.ts
ipcRenderer.on('log:stream', (_event, entries) => {
  // Forward to the window that loaded this preload
  window.postMessage({ type: 'log:entries', entries }, '*') // window is the preload's BrowserWindow
})

// Signal ready to the service that created this window
window.postMessage({ type: 'console:ready' }, '*') // window is the preload's BrowserWindow
