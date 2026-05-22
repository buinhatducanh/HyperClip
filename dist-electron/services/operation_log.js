"use strict";
// Operation Log Service — in-memory circular buffer for MMO Control Center
// Streams real-time events to the renderer via WebContents
Object.defineProperty(exports, "__esModule", { value: true });
exports.opLog = void 0;
exports.setOpLogWindow = setOpLogWindow;
exports.addOpLog = addOpLog;
exports.getOpLogs = getOpLogs;
exports.clearOpLogs = clearOpLogs;
const MAX_ENTRIES = 500;
const _buffer = [];
function emitToRenderer() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('operation:logs-event', _buffer.slice(-50));
    }
}
let mainWindow = null;
function setOpLogWindow(win) {
    mainWindow = win;
}
let _idCounter = 0;
function addOpLog(level, category, message, detail) {
    const entry = {
        id: `op-${Date.now()}-${_idCounter++}`,
        timestamp: Date.now(),
        level,
        category,
        message,
        detail,
    };
    _buffer.push(entry);
    if (_buffer.length > MAX_ENTRIES) {
        _buffer.splice(0, _buffer.length - MAX_ENTRIES);
    }
    emitToRenderer();
    return entry;
}
function getOpLogs() {
    return _buffer.slice(-MAX_ENTRIES);
}
function clearOpLogs() {
    _buffer.length = 0;
    emitToRenderer();
}
// Convenience helpers
exports.opLog = {
    info: (category, message, detail) => addOpLog('info', category, message, detail),
    warn: (category, message, detail) => addOpLog('warn', category, message, detail),
    error: (category, message, detail) => addOpLog('error', category, message, detail),
    success: (category, message, detail) => addOpLog('success', category, message, detail),
};
