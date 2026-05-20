/**
 * Storage IPC handlers.
 * Channels: STORAGE_GET_SIZE, STORAGE_CLEAR_DOWNLOADS, STORAGE_CLEAR_BLUR,
 *           STORAGE_PICK_FOLDER, DIAGNOSTICS_RUN, DATA_EXPORT, DATA_IMPORT
 */
import { BrowserWindow, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS } from '../channels.js';
import { getVideoStoragePath, getOutputPath, getFreeDiskSpace } from '../../services/ramdisk.js';
import { runDiagnostics } from '../../services/diagnostics.js';
import { devLog } from '../../services/unified_log.js';
export function registerStorageHandlers(ipcMain, sendNotification) {
    ipcMain.handle(IPC_CHANNELS.STORAGE_GET_SIZE, async () => {
        try {
            const storagePath = getVideoStoragePath();
            const outputDir = getOutputPath();
            let downloadSize = 0;
            let blurSize = 0;
            try {
                const entries = fs.readdirSync(storagePath);
                for (const entry of entries) {
                    const fullPath = path.join(storagePath, entry);
                    try {
                        const stat = fs.statSync(fullPath);
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
                freeBytes: getFreeDiskSpace(storagePath),
            };
        }
        catch {
            return { downloads: 0, blur: 0, total: 0, downloadPath: '', outputPath: '', freeBytes: 0 };
        }
    });
    ipcMain.handle(IPC_CHANNELS.STORAGE_CLEAR_DOWNLOADS, async () => {
        try {
            const storagePath = getVideoStoragePath();
            let freedBytes = 0;
            const entries = fs.readdirSync(storagePath);
            for (const entry of entries) {
                if (entry.startsWith('blur_'))
                    continue;
                const ext = path.extname(entry).toLowerCase();
                if (!['.mp4', '.mkv', '.webm', '.avi', '.mov'].includes(ext))
                    continue;
                const fullPath = path.join(storagePath, entry);
                try {
                    const stat = fs.statSync(fullPath);
                    fs.unlinkSync(fullPath);
                    freedBytes += stat.size;
                    devLog(`[Storage] Deleted: ${entry} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
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
    ipcMain.handle(IPC_CHANNELS.STORAGE_CLEAR_BLUR, async () => {
        try {
            const storagePath = getVideoStoragePath();
            let freedBytes = 0;
            const entries = fs.readdirSync(storagePath);
            for (const entry of entries) {
                if (!entry.startsWith('blur_'))
                    continue;
                const fullPath = path.join(storagePath, entry);
                try {
                    const stat = fs.statSync(fullPath);
                    fs.unlinkSync(fullPath);
                    freedBytes += stat.size;
                    devLog(`[Storage] Deleted: ${entry} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
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
    ipcMain.handle(IPC_CHANNELS.STORAGE_PICK_FOLDER, async (_, currentPath) => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win)
            return null;
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: currentPath || undefined,
            title: 'Chọn thư mục',
        });
        if (result.canceled || !result.filePaths?.[0])
            return null;
        return { path: result.filePaths[0] };
    });
    ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_RUN, async () => {
        return runDiagnostics();
    });
}
