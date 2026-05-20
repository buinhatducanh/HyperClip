// Operation Log Service — in-memory circular buffer for MMO Control Center
// Streams real-time events to the renderer via WebContents

import { BrowserWindow } from 'electron'

export type OpLogLevel = 'info' | 'warn' | 'error' | 'success'
export type OpLogCategory = 'channel' | 'download' | 'scan' | 'filter' | 'render' | 'system'

export interface OpLogEntry {
  id: string
  timestamp: number
  level: OpLogLevel
  category: OpLogCategory
  message: string
  detail?: string
}

const MAX_ENTRIES = 500
const _buffer: OpLogEntry[] = []

function emitToRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('operation:logs-event', _buffer.slice(-50))
  }
}

let mainWindow: BrowserWindow | null = null

export function setOpLogWindow(win: BrowserWindow | null) {
  mainWindow = win
}

let _idCounter = 0

export function addOpLog(
  level: OpLogLevel,
  category: OpLogCategory,
  message: string,
  detail?: string
): OpLogEntry {
  const entry: OpLogEntry = {
    id: `op-${Date.now()}-${_idCounter++}`,
    timestamp: Date.now(),
    level,
    category,
    message,
    detail,
  }
  _buffer.push(entry)
  if (_buffer.length > MAX_ENTRIES) {
    _buffer.splice(0, _buffer.length - MAX_ENTRIES)
  }
  emitToRenderer()
  return entry
}

export function getOpLogs(): OpLogEntry[] {
  return _buffer.slice(-MAX_ENTRIES)
}

export function clearOpLogs(): void {
  _buffer.length = 0
  emitToRenderer()
}

// Convenience helpers
export const opLog = {
  info: (category: OpLogCategory, message: string, detail?: string) =>
    addOpLog('info', category, message, detail),
  warn: (category: OpLogCategory, message: string, detail?: string) =>
    addOpLog('warn', category, message, detail),
  error: (category: OpLogCategory, message: string, detail?: string) =>
    addOpLog('error', category, message, detail),
  success: (category: OpLogCategory, message: string, detail?: string) =>
    addOpLog('success', category, message, detail),
}
