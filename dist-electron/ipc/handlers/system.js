/**
 * System IPC handlers.
 * Channels: SYSTEM_STATS, SYSTEM_OPEN_FOLDER, SYSTEM_OPEN_URL
 */
import { shell } from 'electron';
import { IPC_CHANNELS } from '../channels.js';
import { collectSystemStats } from '../../services/system.js';
export function registerSystemHandlers(ipcMain) {
    ipcMain.handle(IPC_CHANNELS.SYSTEM_STATS, async () => {
        return collectSystemStats();
    });
    ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_FOLDER, async (_, folderPath) => {
        await shell.openPath(folderPath);
        return { success: true };
    });
    ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_URL, async (_, url) => {
        void shell.openExternal(url);
        return { success: true };
    });
}
