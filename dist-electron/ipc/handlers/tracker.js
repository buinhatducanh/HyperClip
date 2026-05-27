"use strict";
/**
 * Tracker IPC handlers.
 * Channels: TRACKER_ADD, TRACKER_LIST, TRACKER_REMOVE
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTrackerHandlers = registerTrackerHandlers;
const path_1 = __importDefault(require("path"));
const channels_js_1 = require("../channels.js");
const ipc_state_js_1 = require("../ipc-state.js");
const store_js_1 = require("../../services/store.js");
const youtube_js_1 = require("../../services/youtube.js");
const ffmpeg_js_1 = require("../../services/ffmpeg.js");
const ramdisk_js_1 = require("../../services/ramdisk.js");
const unified_log_js_1 = require("../../services/unified_log.js");
function registerTrackerHandlers(ipcMain) {
    ipcMain.handle(channels_js_1.IPC_CHANNELS.TRACKER_ADD, async (_, url, trimLimit) => {
        try {
            const info = await (0, youtube_js_1.getVideoInfo)(url);
            if (!info) {
                (0, ipc_state_js_1.sendNotification)('error', 'Failed to fetch video info. Check URL.');
                return null;
            }
            const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
            (0, ramdisk_js_1.ensureStorageDirs)();
            const settings = (0, ramdisk_js_1.loadSettings)();
            const quality = settings.autoDownloadQuality ?? '720';
            (0, unified_log_js_1.devLog)(`[TRACKER_ADD] quality=${quality}p trimLimit=${trimLimit === 'full' ? 'full' : trimLimit + 'm'} (user config)`);
            const workspace = (0, store_js_1.addWorkspace)({
                channelId: info.channelId,
                channelName: info.channelName,
                channelColor: '#00B4FF',
                videoId: info.id,
                videoTitle: info.title,
                videoUrl: url,
                thumbnail: info.thumbnail,
                duration: info.duration,
                trimLimit,
                status: 'downloading',
                renderProgress: 0,
                downloadedAt: '',
                downloadedPath: '',
                blurBackgroundPath: '',
                outputPath: '',
                metadataPath: '',
                fileSize: 0,
                renderMetadata: null,
                downloadQuality: quality,
            });
            (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, workspace);
            (0, ipc_state_js_1.sendNotification)('info', `Downloading: ${info.title}`, workspace.id);
            const { getYtCookiesFile } = await import('../../services/po_token.js');
            const ytCookiesFile = await getYtCookiesFile();
            const result = await (0, youtube_js_1.downloadVideo)({
                workspaceId: workspace.id,
                videoUrl: url,
                outputDir: storagePath,
                trimLimit,
                quality,
                ytCookiesFile,
                onProgress: (progress) => {
                    (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
                        workspaceId: workspace.id,
                        percent: progress.percent,
                        speed: progress.speed,
                        eta: progress.eta,
                    });
                },
            });
            if (result.success && result.filePath) {
                // Extract thumbnail
                void (0, ffmpeg_js_1.extractVideoThumbnail)(result.filePath, path_1.default.join(storagePath, `thumb_${workspace.id}.jpg`))
                    .then((thumbResult) => {
                    if (thumbResult.success) {
                        const update = (0, store_js_1.updateWorkspace)(workspace.id, {
                            thumbnail: 'local-video:///' + path_1.default.join(storagePath, `thumb_${workspace.id}.jpg`).replace(/\\/g, '/'),
                        });
                        if (update)
                            (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, update);
                    }
                })
                    .catch(() => { });
                // Mark ready
                const { blurPath } = (0, ramdisk_js_1.generateWorkspacePaths)(workspace.id);
                const initialUpdate = (0, store_js_1.updateWorkspace)(workspace.id, {
                    status: 'ready',
                    downloadedAt: new Date().toISOString(),
                    downloadedPath: result.filePath,
                    fileSize: result.fileSize || 0,
                    blurBackgroundPath: '',
                    downloadQuality: quality,
                    renderMetadata: {
                        workspace_id: workspace.id,
                        source_video: result.filePath,
                        blur_background: '',
                        export_resolution: '1080x1920',
                        video_speed: 1.0,
                        fps_target: 30,
                        overlays: [],
                        trim: { start: 0, end: result.duration || 300 },
                    },
                });
                if (initialUpdate)
                    (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, initialUpdate);
                (0, ipc_state_js_1.sendNotification)('success', `Ready: ${info.title}`, workspace.id);
                // Generate blur in background
                void (0, ffmpeg_js_1.generateBlurBackground)(result.filePath, blurPath)
                    .then((blurResult) => {
                    const blurUpdate = (0, store_js_1.updateWorkspace)(workspace.id, {
                        blurBackgroundPath: blurResult.success ? blurPath : '',
                        renderMetadata: {
                            workspace_id: workspace.id,
                            source_video: result.filePath,
                            blur_background: blurResult.success ? blurPath : '',
                            export_resolution: '1080x1920',
                            video_speed: 1.0,
                            fps_target: 30,
                            overlays: [],
                            trim: { start: 0, end: result.duration || 300 },
                        },
                    });
                    if (blurUpdate)
                        (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, blurUpdate);
                })
                    .catch((e) => { console.warn('[Blur] Background generation failed:', e); });
            }
            else {
                (0, store_js_1.updateWorkspace)(workspace.id, { status: 'waiting' });
                (0, ipc_state_js_1.sendNotification)('error', `Download failed: ${result.error}`, workspace.id);
            }
            return (0, store_js_1.getWorkspace)(workspace.id);
        }
        catch (err) {
            console.error('[Tracker] Add error:', err);
            (0, ipc_state_js_1.sendNotification)('error', `Error: ${err.message}`);
            return null;
        }
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.TRACKER_LIST, async () => {
        const workspaces = (0, store_js_1.getWorkspaces)();
        const channels = new Map();
        for (const ws of workspaces) {
            if (!channels.has(ws.channelId)) {
                channels.set(ws.channelId, { channelId: ws.channelId, channelName: ws.channelName });
            }
        }
        return Array.from(channels.values());
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.TRACKER_REMOVE, async (_, channelId) => {
        const workspaces = (0, store_js_1.getWorkspaces)();
        let totalBytesFreed = 0;
        let totalFilesDeleted = 0;
        for (const ws of workspaces) {
            if (ws.channelId === channelId) {
                const { bytesFreed, filesDeleted } = (0, ramdisk_js_1.cleanupWorkspace)(ws.id, ws.downloadedPath);
                totalBytesFreed += bytesFreed;
                totalFilesDeleted += filesDeleted;
                (0, store_js_1.deleteWorkspace)(ws.id);
            }
        }
        if (totalBytesFreed > 0) {
            const freedMB = (totalBytesFreed / 1024 / 1024).toFixed(1);
            (0, ipc_state_js_1.sendNotification)('success', `Removed channel (${totalFilesDeleted} files, ${freedMB} MB freed)`);
        }
        return { success: true, bytesFreed: totalBytesFreed, filesDeleted: totalFilesDeleted };
    });
}
