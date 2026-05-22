// Type definitions for Electron built-in globals.
// The `electron` npm package is CJS-only. `import { app } from 'electron'` fails
// in Node.js 24 because CJS modules don't expose named exports in ESM context.
// Electron provides these as built-in globals at runtime.
namespace Electron {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  type CrossProcessExports = typeof import('electron')
}

declare const app: Electron.CrossProcessExports['app']
declare const BrowserWindow: Electron.CrossProcessExports['BrowserWindow']
declare const ipcMain: Electron.CrossProcessExports['ipcMain']
declare const Tray: Electron.CrossProcessExports['Tray']
declare const Menu: Electron.CrossProcessExports['Menu']
declare const nativeImage: Electron.CrossProcessExports['nativeImage']
declare const shell: Electron.CrossProcessExports['shell']
declare const protocol: Electron.CrossProcessExports['protocol']
declare const dialog: Electron.CrossProcessExports['dialog']
declare const crashReporter: Electron.CrossProcessExports['crashReporter']
declare const session: Electron.CrossProcessExports['session']
