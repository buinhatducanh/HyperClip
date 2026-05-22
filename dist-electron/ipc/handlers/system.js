"use strict";
/**
 * System IPC handlers.
 * Channels: SYSTEM_STATS, SYSTEM_OPEN_FOLDER, SYSTEM_OPEN_URL
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSystemHandlers = registerSystemHandlers;
const electron_1 = require("electron");
const channels_js_1 = require("../channels.js");
const system_js_1 = require("../../services/system.js");
function registerSystemHandlers(ipcMain) {
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SYSTEM_STATS, async () => {
        return (0, system_js_1.collectSystemStats)();
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SYSTEM_RESOURCE_ALERT, async () => {
        const alert = (0, system_js_1.checkResourceAlert)();
        return (0, system_js_1.getLastResourceAlert)();
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SYSTEM_OPEN_FOLDER, async (_, folderPath) => {
        await electron_1.shell.openPath(folderPath);
        return { success: true };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SYSTEM_OPEN_URL, async (_, url) => {
        void electron_1.shell.openExternal(url);
        return { success: true };
    });
}
