/**
 * Session + Logs IPC handlers.
 * Channels: SESSION_LIST, SESSION_REFRESH_ALL, SESSION_OPEN_LOGIN, SESSION_CLONE_ONE,
 *   logs:read, logs:export
 */
import { shell, dialog } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';
import { IPC_CHANNELS } from '../channels.js';
import { getSessionManager } from '../../services/chrome_cookies.js';
import { runDiagnostics } from '../../services/diagnostics.js';
import { loadSettings } from '../../services/ramdisk.js';
import { getLogDir, getSystemSnapshot, readFileLogs, getLogDiskUsage, cleanupOldLogs } from '../../services/unified_log.js';
export function registerSessionHandlers(ipcMain, getMainWindow) {
    ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
        const sm = getSessionManager();
        await sm.ensureInit();
        return sm.getStatus();
    });
    ipcMain.handle(IPC_CHANNELS.SESSION_REFRESH_ALL, async () => {
        const sm = getSessionManager();
        const count = await sm.refreshAll();
        return { success: true, refreshedCount: count };
    });
    ipcMain.handle(IPC_CHANNELS.SESSION_OPEN_LOGIN, async (_, profileId) => {
        const sm = getSessionManager();
        const cookiesExtracted = await sm.openLoginWindow(profileId);
        return { success: true, cookiesExtracted };
    });
    ipcMain.handle(IPC_CHANNELS.SESSION_CLONE_ONE, async () => {
        const sm = getSessionManager();
        return sm.cloneSessionOne();
    });
    // ─── Log Export ─────────────────────────────────────────────────────────────
    ipcMain.handle('logs:read', async () => {
        return readFileLogs();
    });
    ipcMain.handle('logs:disk-usage', async () => {
        return getLogDiskUsage();
    });
    ipcMain.handle('logs:cleanup', async () => {
        return cleanupOldLogs();
    });
    ipcMain.handle('logs:export', async () => {
        const logDir = getLogDir();
        const tmpDir = path.join(os.tmpdir(), 'hyperclip-logs-' + Date.now());
        fs.mkdirSync(tmpDir, { recursive: true });
        // System snapshot
        fs.writeFileSync(path.join(tmpDir, 'system_info.txt'), getSystemSnapshot());
        // Log files
        try {
            for (const fname of fs.readdirSync(logDir)) {
                if (!fname.startsWith('hyperclip'))
                    continue;
                fs.copyFileSync(path.join(logDir, fname), path.join(tmpDir, fname));
            }
        }
        catch { }
        // Crash dumps
        const { app: electronApp } = await import('electron');
        const crashDir = path.join(electronApp.getPath('crashDumps'));
        if (fs.existsSync(crashDir)) {
            try {
                fs.mkdirSync(path.join(tmpDir, 'crash_dumps'), { recursive: true });
                for (const fname of fs.readdirSync(crashDir)) {
                    if (fname.endsWith('.dmp') || fname.endsWith('.mdmp')) {
                        fs.copyFileSync(path.join(crashDir, fname), path.join(tmpDir, 'crash_dumps', fname));
                    }
                }
            }
            catch { }
        }
        // Diagnostics
        try {
            const diag = await runDiagnostics();
            fs.writeFileSync(path.join(tmpDir, 'diagnostics.json'), JSON.stringify(diag, null, 2));
        }
        catch { }
        // Settings
        try {
            const settings = loadSettings();
            fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify(settings, null, 2));
        }
        catch { }
        // Save as zip
        const zipPath = path.join(os.tmpdir(), `hyperclip-logs-${new Date().toISOString().slice(0, 10)}.zip`);
        const mainWindow = getMainWindow();
        const saveResult = await dialog.showSaveDialog(mainWindow, {
            title: 'Lưu file log',
            defaultPath: zipPath,
            filters: [{ name: 'ZIP', extensions: ['zip'] }],
        });
        if (saveResult.canceled || !saveResult.filePath)
            return { success: false };
        try {
            execSync(`powershell -Command "Compress-Archive -Path '${tmpDir}\\*' -DestinationPath '${saveResult.filePath}' -Force"`, { stdio: 'ignore' });
            fs.rmSync(tmpDir, { recursive: true, force: true });
            shell.showItemInFolder(saveResult.filePath);
            return { success: true, path: saveResult.filePath };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    });
}
