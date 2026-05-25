"use strict";
/**
 * Video file serving IPC handlers.
 * Channels: VIDEO_FILE, VIDEO_BLOB, IMAGE_FILE, BLOB_SAVE
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerVideoHandlers = registerVideoHandlers;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const channels_js_1 = require("../channels.js");
const store_js_1 = require("../../services/store.js");
const ramdisk_js_1 = require("../../services/ramdisk.js");
const paths_js_1 = require("../../services/paths.js");
const ipc_state_js_1 = require("../ipc-state.js");
const unified_log_js_1 = require("../../services/unified_log.js");
// Scan known storage directories for a downloaded video file by workspaceId.
function findDownloadedFileAbs(workspaceId) {
    const dirs = [
        (0, ramdisk_js_1.getVideoStoragePath)(),
        path_1.default.join((0, paths_js_1.getAppStoreDir)(), 'downloads'),
        path_1.default.join((0, paths_js_1.getAppStoreDir)(), 'videos'),
        'D:\\HyperClip-Data\\downloads',
    ];
    for (const dir of dirs) {
        try {
            const entries = fs_1.default.readdirSync(dir);
            const found = entries.find((f) => {
                const base = path_1.default.basename(f, path_1.default.extname(f));
                return base === workspaceId || base.startsWith(workspaceId + '_') || base.startsWith(workspaceId + '.');
            });
            if (found) {
                const abs = path_1.default.normalize(path_1.default.join(dir, found));
                if (fs_1.default.existsSync(abs))
                    return abs;
            }
        }
        catch { /* skip inaccessible dirs */ }
    }
    return null;
}
function registerVideoHandlers(ipcMain) {
    // Serve video file path for HTML5 preview player
    ipcMain.handle(channels_js_1.IPC_CHANNELS.VIDEO_FILE, async (_, workspaceId) => {
        const ws = (0, store_js_1.getWorkspace)(workspaceId);
        (0, unified_log_js_1.devLog)(`[VIDEO_FILE] workspace=${workspaceId} downloadedPath="${ws?.downloadedPath}" status=${ws?.status}`);
        if (!ws || !ws.downloadedPath)
            return null;
        const stored = ws.downloadedPath;
        const abs = (stored.startsWith('/') || stored.match(/^[A-Z]:/i))
            ? path_1.default.normalize(stored)
            : path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), stored);
        (0, unified_log_js_1.devLog)(`[VIDEO_FILE] resolved path="${abs}" exists=${fs_1.default.existsSync(abs)}`);
        let absPath = abs;
        if (!fs_1.default.existsSync(absPath)) {
            const found = findDownloadedFileAbs(workspaceId);
            (0, unified_log_js_1.devLog)(`[VIDEO_FILE] findDownloadedFileAbs found="${found}"`);
            if (found) {
                absPath = found;
                (0, unified_log_js_1.devLog)(`[VIDEO_FILE] using found path="${absPath}"`);
            }
            else {
                // File gone (deleted by cleanup or manually) — mark workspace as error so UI shows retry
                console.warn(`[VIDEO_FILE] file not found: ${ws.downloadedPath}`);
                if (ws.status === 'ready') {
                    (0, store_js_1.updateWorkspace)(workspaceId, { status: 'error' });
                    (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(workspaceId));
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
    ipcMain.handle(channels_js_1.IPC_CHANNELS.VIDEO_BLOB, async (_, workspaceId) => {
        const ws = (0, store_js_1.getWorkspace)(workspaceId);
        (0, unified_log_js_1.devLog)(`[VIDEO_BLOB] workspace=${workspaceId} downloadedPath="${ws?.downloadedPath}"`);
        if (!ws || !ws.downloadedPath)
            return null;
        const stored = ws.downloadedPath;
        const abs = (stored.startsWith('/') || stored.match(/^[A-Z]:/i))
            ? path_1.default.normalize(stored)
            : path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), stored);
        let absPath = abs;
        if (!fs_1.default.existsSync(absPath)) {
            const found = findDownloadedFileAbs(workspaceId);
            (0, unified_log_js_1.devLog)(`[VIDEO_BLOB] path="${absPath}" not found, findDownloadedFileAbs="${found}"`);
            if (found)
                absPath = found;
            else {
                console.warn(`[VIDEO_BLOB] file not found: ${ws.downloadedPath}`);
                return null;
            }
        }
        try {
            const data = fs_1.default.readFileSync(absPath);
            (0, unified_log_js_1.devLog)(`[VIDEO_BLOB] read ${data.byteLength} bytes from "${absPath}"`);
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }
        catch (err) {
            console.error(`[VIDEO_BLOB] read error: ${err}`);
            return null;
        }
    });
    // Serve image file as base64 data URI
    ipcMain.handle(channels_js_1.IPC_CHANNELS.IMAGE_FILE, async (_, workspaceId) => {
        const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
        const thumbPath = path_1.default.join(storagePath, `thumb_${workspaceId}.jpg`);
        if (!fs_1.default.existsSync(thumbPath))
            return null;
        try {
            const data = fs_1.default.readFileSync(thumbPath);
            return { path: thumbPath, dataUrl: `data:image/jpeg;base64,${data.toString('base64')}` };
        }
        catch {
            return null;
        }
    });
    // Save binary data from renderer to disk (for header/background images)
    ipcMain.handle(channels_js_1.IPC_CHANNELS.BLOB_SAVE, async (_, arrayBuffer, filename) => {
        try {
            const dir = path_1.default.join((0, paths_js_1.getAppStoreDir)(), 'temp_assets');
            if (!fs_1.default.existsSync(dir))
                fs_1.default.mkdirSync(dir, { recursive: true });
            const filePath = path_1.default.join(dir, filename);
            fs_1.default.writeFileSync(filePath, Buffer.from(arrayBuffer));
            return { diskPath: filePath };
        }
        catch (err) {
            console.error('[blob:save] failed:', err);
            return null;
        }
    });
}
