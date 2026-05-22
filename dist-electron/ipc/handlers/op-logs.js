"use strict";
/**
 * Operation Logs IPC handlers.
 * Channels: OPERATION_LOGS_READ, OPERATION_LOGS_CLEAR
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOpLogHandlers = registerOpLogHandlers;
const channels_js_1 = require("../channels.js");
const unified_log_js_1 = require("../../services/unified_log.js");
function registerOpLogHandlers(ipcMain) {
    ipcMain.handle(channels_js_1.IPC_CHANNELS.OPERATION_LOGS_READ, () => {
        return (0, unified_log_js_1.getLogEntries)();
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.OPERATION_LOGS_CLEAR, () => {
        (0, unified_log_js_1.clearLogEntries)();
        return { success: true };
    });
}
