// Operation Log Service — in-memory circular buffer for MMO Control Center
// Streams real-time events to the renderer via WebContents
const MAX_ENTRIES = 500;
const _buffer = [];
function emitToRenderer() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('operation:logs-event', _buffer.slice(-50));
    }
}
let mainWindow = null;
export function setOpLogWindow(win) {
    mainWindow = win;
}
let _idCounter = 0;
export function addOpLog(level, category, message, detail) {
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
export function getOpLogs() {
    return _buffer.slice(-MAX_ENTRIES);
}
export function clearOpLogs() {
    _buffer.length = 0;
    emitToRenderer();
}
// Convenience helpers
export const opLog = {
    info: (category, message, detail) => addOpLog('info', category, message, detail),
    warn: (category, message, detail) => addOpLog('warn', category, message, detail),
    error: (category, message, detail) => addOpLog('error', category, message, detail),
    success: (category, message, detail) => addOpLog('success', category, message, detail),
};
