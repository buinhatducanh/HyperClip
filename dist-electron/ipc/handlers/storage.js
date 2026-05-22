"use strict";
/**
 * Storage IPC handlers.
 * Channels: STORAGE_GET_SIZE, STORAGE_CLEAR_DOWNLOADS, STORAGE_CLEAR_BLUR,
 *           STORAGE_PICK_FOLDER, DIAGNOSTICS_RUN, DATA_EXPORT, DATA_IMPORT
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerStorageHandlers = registerStorageHandlers;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const channels_js_1 = require("../channels.js");
const ramdisk_js_1 = require("../../services/ramdisk.js");
const diagnostics_js_1 = require("../../services/diagnostics.js");
const unified_log_js_1 = require("../../services/unified_log.js");
function registerStorageHandlers(ipcMain, sendNotification) {
    ipcMain.handle(channels_js_1.IPC_CHANNELS.STORAGE_GET_SIZE, async () => {
        try {
            const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
            const outputDir = (0, ramdisk_js_1.getOutputPath)();
            let downloadSize = 0;
            let blurSize = 0;
            try {
                const entries = fs_1.default.readdirSync(storagePath);
                for (const entry of entries) {
                    const fullPath = path_1.default.join(storagePath, entry);
                    try {
                        const stat = fs_1.default.statSync(fullPath);
                        if (entry.startsWith('blur_')) {
                            blurSize += stat.size;
                        }
                        else if (entry.endsWith('.mp4') || entry.endsWith('.mkv') || entry.endsWith('.webm')) {
                            downloadSize += stat.size;
                        }
                    }
                    catch { }
                }
            }
            catch { }
            return {
                downloads: parseFloat((downloadSize / (1024 ** 2)).toFixed(1)),
                blur: parseFloat((blurSize / (1024 ** 2)).toFixed(1)),
                total: parseFloat(((downloadSize + blurSize) / (1024 ** 2)).toFixed(1)),
                downloadPath: storagePath,
                outputPath: outputDir,
                freeBytes: (0, ramdisk_js_1.getFreeDiskSpace)(storagePath),
            };
        }
        catch {
            return { downloads: 0, blur: 0, total: 0, downloadPath: '', outputPath: '', freeBytes: 0 };
        }
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.STORAGE_CLEAR_DOWNLOADS, async () => {
        try {
            const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
            let freedBytes = 0;
            const entries = fs_1.default.readdirSync(storagePath);
            for (const entry of entries) {
                if (entry.startsWith('blur_'))
                    continue;
                const ext = path_1.default.extname(entry).toLowerCase();
                if (!['.mp4', '.mkv', '.webm', '.avi', '.mov'].includes(ext))
                    continue;
                const fullPath = path_1.default.join(storagePath, entry);
                try {
                    const stat = fs_1.default.statSync(fullPath);
                    fs_1.default.unlinkSync(fullPath);
                    freedBytes += stat.size;
                    (0, unified_log_js_1.devLog)(`[Storage] Deleted: ${entry} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
                }
                catch { }
            }
            sendNotification('info', `Cleared ${(freedBytes / 1024 / 1024).toFixed(0)} MB of downloads`);
            return { success: true, freedMB: parseFloat((freedBytes / (1024 ** 2)).toFixed(1)) };
        }
        catch (err) {
            sendNotification('error', `Clear failed: ${err.message}`);
            return { success: false, freedMB: 0 };
        }
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.STORAGE_CLEAR_BLUR, async () => {
        try {
            const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
            let freedBytes = 0;
            const entries = fs_1.default.readdirSync(storagePath);
            for (const entry of entries) {
                if (!entry.startsWith('blur_'))
                    continue;
                const fullPath = path_1.default.join(storagePath, entry);
                try {
                    const stat = fs_1.default.statSync(fullPath);
                    fs_1.default.unlinkSync(fullPath);
                    freedBytes += stat.size;
                    (0, unified_log_js_1.devLog)(`[Storage] Deleted: ${entry} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
                }
                catch { }
            }
            sendNotification('info', `Cleared ${(freedBytes / 1024 / 1024).toFixed(0)} MB of blur images`);
            return { success: true, freedMB: parseFloat((freedBytes / (1024 ** 2)).toFixed(1)) };
        }
        catch (err) {
            sendNotification('error', `Clear failed: ${err.message}`);
            return { success: false, freedMB: 0 };
        }
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.STORAGE_PICK_FOLDER, async (_, currentPath) => {
        const win = electron_1.BrowserWindow.getFocusedWindow();
        if (!win)
            return null;
        const result = await electron_1.dialog.showOpenDialog(win, {
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: currentPath || undefined,
            title: 'Chọn thư mục',
        });
        if (result.canceled || !result.filePaths?.[0])
            return null;
        return { path: result.filePaths[0] };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.DIAGNOSTICS_RUN, async () => {
        return (0, diagnostics_js_1.runDiagnostics)();
    });
}
