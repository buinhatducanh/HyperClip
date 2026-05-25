/**
 * Customer Console Window Service
 *
 * Spawns a small always-on-top terminal window that displays live log entries.
 * This is the window the customer sees when running the .exe — it shows
 * what's happening in real-time so they can report bugs easily.
 *
 * The window:
 *   - Opens at last saved position (or bottom-right on first launch)
 *   - Always on top (never obscured)
 *   - Draggable via title bar + resizable
 *   - Dark terminal theme (no frame)
 *   - Auto-scrolls, caps at 1000 lines
 *   - Logs written to: D:\HyperClip-Data\logs/hyperclip.log (already done by unified_log.ts)
 *   - Position/size persisted to console-window-state.json
 *
 * Communication:
 *   - Preload (console-preload.js) bridges ipcRenderer 'log:stream' → window.postMessage
 *   - console-window.html receives via window.addEventListener('message', ...)
 */

import { BrowserWindow, screen, app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { setLogWindow } from './unified_log.js'

let consoleWindow: BrowserWindow | null = null
let _isQuitting = false

export function setConsoleWindowQuit(v: boolean): void {
  _isQuitting = v
}

function getConsolePreloadPath(): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath!, 'app')
    : path.join(__dirname, '..', '..')
  return path.join(base, 'electron', 'console-preload.js')
}

function getConsoleWindowHTML(): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath!, 'app')
    : path.join(__dirname, '..', '..')
  return path.join(base, 'console-window.html')
}

function getConsoleStatePath(): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath!, 'app')
    : path.join(__dirname, '..', '..')
  return path.join(base, 'electron', 'console-window-state.json')
}

interface WindowState {
  x: number; y: number; width: number; height: number
}

function loadWindowState(): WindowState | null {
  try {
    const file = getConsoleStatePath()
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (data.x != null && data.y != null) return data as WindowState
    }
  } catch {}
  return null
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds()
    const file = getConsoleStatePath()
    fs.writeFileSync(file, JSON.stringify(bounds), 'utf-8')
  } catch {}
}

export function createConsoleWindow(): BrowserWindow | null {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.show()
    return consoleWindow
  }

  const saved = loadWindowState()
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  const WIN_W = saved?.width ?? 520
  const WIN_H = saved?.height ?? 320
  const MARGIN = 16

  // If saved position is off-screen, reset to default
  const savedOnScreen = saved && saved.x >= 0 && saved.y >= 0
    && saved.x < screenWidth && saved.y < screenHeight

  const preloadPath = getConsolePreloadPath()
  const htmlPath = getConsoleWindowHTML()

  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: savedOnScreen ? saved!.x : screenWidth - WIN_W - MARGIN,
    y: savedOnScreen ? saved!.y : screenHeight - WIN_H - MARGIN,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#0a0a0a',
    title: 'HyperClip Console',
    skipTaskbar: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
    },
  })

  if (!fs.existsSync(htmlPath)) {
    console.warn(`[ConsoleWindow] HTML not found: ${htmlPath}`)
    void win.loadURL(`data:text/html,<html><body style="background:%230a0a0a;color:%23555;font-family:monospace;font-size:12px;padding:12px">
      <div style="color:%23FFB800">⚠ Console window HTML not found</div>
      <div style="margin-top:8px;color:%23444">Logs are still written to:</div>
      <div style="color:%23333;margin-top:4px">D:%5CHyperClip-Data%5Clogs%5Chyperclip.log</div>
    </body></html>`)
  } else {
    void win.loadFile(htmlPath)
  }

  win.once('ready-to-show', () => {
    win.show()
  })

  // Persist position/size on move or resize (debounced by saving on close is enough, but also save on events)
  const saveBounds = () => saveWindowState(win)
  win.on('move', saveBounds)
  win.on('resize', saveBounds)

  win.on('close', (e) => {
    if (_isQuitting) return
    e.preventDefault()
    saveWindowState(win)
    win.hide()
  })

  // Register with unified_log so it receives log:stream events
  setLogWindow(win)

  // IPC handlers for frameless window controls
  ipcMain.on('console:minimize', () => { win.minimize() })
  ipcMain.on('console:close', () => {
    saveWindowState(win)
    win.hide()
  })

  consoleWindow = win
  return win
}

export function showConsoleWindow(): void {
  if (!consoleWindow || consoleWindow.isDestroyed()) {
    createConsoleWindow()
  } else {
    consoleWindow.show()
  }
}

export function hideConsoleWindow(): void {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.hide()
  }
}

export function destroyConsoleWindow(): void {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.destroy()
    consoleWindow = null
  }
}

export function getConsoleWindow(): BrowserWindow | null {
  return consoleWindow
}
