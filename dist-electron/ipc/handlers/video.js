/**
 * Video file serving IPC handlers.
 * Channels: VIDEO_FILE, VIDEO_BLOB, IMAGE_FILE, BLOB_SAVE
 */
import fs from 'fs';
import path from 'path';
import { IPC_CHANNELS } from '../channels.js';
import { getWorkspace, updateWorkspace } from '../../services/store.js';
import { getVideoStoragePath } from '../../services/ramdisk.js';
import { getAppStoreDir } from '../../services/paths.js';
import { broadcast } from '../ipc-state.js';
// Scan known storage directories for a downloaded video file by workspaceId.
function findDownloadedFileAbs(workspaceId) {
    const dirs = [
        getVideoStoragePath(),
        path.join(getAppStoreDir(), 'downloads'),
        path.join(getAppStoreDir(), 'videos'),
    ];
    for (const dir of dirs) {
        try {
            const entries = fs.readdirSync(dir);
            const found = entries.find((f) => {
                const base = path.basename(f, path.extname(f));
                return base === workspaceId || base.startsWith(workspaceId + '_') || base.startsWith(workspaceId + '.');
            });
            if (found) {
                const abs = path.join(dir, found);
                if (fs.existsSync(abs))
                    return abs;
            }
        }
        catch { /* skip inaccessible dirs */ }
    }
    return null;
}
export function registerVideoHandlers(ipcMain) {
    // Serve video file path for HTML5 preview player
    ipcMain.handle(IPC_CHANNELS.VIDEO_FILE, async (_, workspaceId) => {
        const ws = getWorkspace(workspaceId);
        if (!ws || !ws.downloadedPath)
            return null;
        const stored = ws.downloadedPath;
        const abs = stored.startsWith('/') || stored.match(/^[A-Z]:/i)
            ? stored
            : path.join(getVideoStoragePath(), stored);
        let absPath = abs;
        if (!fs.existsSync(absPath)) {
            const found = findDownloadedFileAbs(workspaceId);
            if (found) {
                absPath = found;
            }
            else {
                // File gone (deleted by cleanup or manually) — mark workspace as error so UI shows retry
                console.warn(`[VIDEO_FILE] file not found: ${ws.downloadedPath}`);
                if (ws.status === 'ready') {
                    updateWorkspace(workspaceId, { status: 'error' });
                    broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(workspaceId));
                }
                return null;
            }
        }
        // Protocol needs forward slashes; THREE slashes for valid Windows path in URL
        const protocolPath = absPath.replace(/\\/g, '/');
        const videoUrl = 'local-video:///' + protocolPath;
        return { path: absPath, url: videoUrl };
    });
    // Serve full video file as ArrayBuffer (for blob URL playback)
    ipcMain.handle(IPC_CHANNELS.VIDEO_BLOB, async (_, workspaceId) => {
        const ws = getWorkspace(workspaceId);
        if (!ws || !ws.downloadedPath)
            return null;
        const stored = ws.downloadedPath;
        const abs = stored.startsWith('/') || stored.match(/^[A-Z]:/i)
            ? stored
            : path.join(getVideoStoragePath(), stored);
        let absPath = abs;
        if (!fs.existsSync(absPath)) {
            const found = findDownloadedFileAbs(workspaceId);
            if (found)
                absPath = found;
            else {
                console.warn(`[VIDEO_BLOB] file not found: ${ws.downloadedPath}`);
                return null;
            }
        }
        try {
            const data = fs.readFileSync(absPath);
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }
        catch (err) {
            console.error(`[VIDEO_BLOB] read error: ${err}`);
            return null;
        }
    });
    // Serve image file as base64 data URI
    ipcMain.handle(IPC_CHANNELS.IMAGE_FILE, async (_, workspaceId) => {
        const storagePath = getVideoStoragePath();
        const thumbPath = path.join(storagePath, `thumb_${workspaceId}.jpg`);
        if (!fs.existsSync(thumbPath))
            return null;
        try {
            const data = fs.readFileSync(thumbPath);
            return { path: thumbPath, dataUrl: `data:image/jpeg;base64,${data.toString('base64')}` };
        }
        catch {
            return null;
        }
    });
    // Save binary data from renderer to disk (for header/background images)
    ipcMain.handle(IPC_CHANNELS.BLOB_SAVE, async (_, arrayBuffer, filename) => {
        try {
            const dir = path.join(getAppStoreDir(), 'temp_assets');
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            const filePath = path.join(dir, filename);
            fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
            return { diskPath: filePath };
        }
        catch (err) {
            console.error('[blob:save] failed:', err);
            return null;
        }
    });
}
