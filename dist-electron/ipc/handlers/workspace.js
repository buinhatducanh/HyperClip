"use strict";
/**
 * Workspace IPC handlers.
 * Channels: WORKSPACE_LIST, WORKSPACE_SET_ACTIVE, WORKSPACE_UPDATE,
 *           FORMATS_GET, WORKSPACE_DELETE, WORKSPACE_RETRY, WORKSPACE_REGENERATE_BLUR
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkspaceHandlers = registerWorkspaceHandlers;
const fs_1 = __importDefault(require("fs"));
const channels_js_1 = require("../channels.js");
const ipc_state_js_1 = require("../ipc-state.js");
const store_js_1 = require("../../services/store.js");
const ramdisk_js_1 = require("../../services/ramdisk.js");
const ffmpeg_js_1 = require("../../services/ffmpeg.js");
const youtube_js_1 = require("../../services/youtube.js");
const unified_log_js_1 = require("../../services/unified_log.js");
function registerWorkspaceHandlers(ipcMain) {
    // ── List all workspaces ──────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.WORKSPACE_LIST, async () => {
        return (0, store_js_1.getWorkspaces)();
    });
    // ── Track active workspace ───────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.WORKSPACE_SET_ACTIVE, async (_, workspaceId) => {
        (0, ipc_state_js_1.setActiveWorkspaceId)(workspaceId);
        return { success: true };
    });
    // ── Update workspace ─────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE, async (_, id, patch) => {
        const updated = (0, store_js_1.updateWorkspace)(id, patch);
        if (updated)
            (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, updated);
        return updated || { success: false };
    });
    // ── Available formats probe ─────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.FORMATS_GET, async (_, videoId, videoUrl) => {
        const { getYtCookiesFile } = await Promise.resolve().then(() => __importStar(require('../../services/po_token.js')));
        const ytCookiesFile = await getYtCookiesFile();
        const result = await (0, youtube_js_1.probeAvailableFormats)(videoUrl, ytCookiesFile);
        if (result) {
            (0, unified_log_js_1.devLog)(`[Formats] ${videoId}: available heights = [${result.heights.join(', ')}]`);
        }
        return result;
    });
    // ── Delete workspace ────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.WORKSPACE_DELETE, async (_, id) => {
        const ws = (0, store_js_1.getWorkspace)(id);
        const { bytesFreed, filesDeleted } = (0, ramdisk_js_1.cleanupWorkspace)(id, ws?.downloadedPath);
        (0, store_js_1.deleteWorkspace)(id);
        const freedMB = (bytesFreed / 1024 / 1024).toFixed(1);
        (0, ipc_state_js_1.sendNotification)('success', `Deleted (${filesDeleted} files, ${freedMB} MB freed)`, id);
        return { success: true, bytesFreed, filesDeleted };
    });
    // ── Retry download ──────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.WORKSPACE_RETRY, async (_, id) => {
        const ws = (0, store_js_1.getWorkspace)(id);
        if (!ws)
            return { success: false, error: 'Workspace not found' };
        if (!['waiting', 'error'].includes(ws.status)) {
            return { success: false, error: `Cannot retry status: ${ws.status}` };
        }
        const videoUrl = ws.videoUrl || (ws.videoId ? `https://www.youtube.com/watch?v=${ws.videoId}` : null);
        if (!videoUrl)
            return { success: false, error: 'No video URL stored' };
        (0, store_js_1.updateWorkspace)(id, {
            status: 'downloading',
            downloadProgress: 0,
            metrics: {
                ...(ws.metrics || {}),
                downloadStartedAt: new Date().toISOString(),
            }
        });
        (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(id));
        const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
        (0, ramdisk_js_1.ensureStorageDirs)();
        const settings = (0, ramdisk_js_1.loadSettings)();
        const retryQuality = settings.autoDownloadQuality ?? '720';
        const retryTrimLimit = ws.trimLimit || 10;
        (0, unified_log_js_1.devLog)(`[WORKSPACE_RETRY] quality=${retryQuality}p trimLimit=${retryTrimLimit}m (user config: quality=${settings.autoDownloadQuality}p)`);
        const { getYtCookiesFile } = await Promise.resolve().then(() => __importStar(require('../../services/po_token.js')));
        const ytCookiesFile = await getYtCookiesFile();
        try {
            const result = await (0, youtube_js_1.downloadVideo)({
                workspaceId: id,
                videoUrl,
                outputDir: storagePath,
                trimLimit: retryTrimLimit,
                quality: retryQuality,
                ytCookiesFile,
                onProgress: (progress) => {
                    (0, store_js_1.updateWorkspace)(id, { downloadProgress: progress.percent });
                    (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(id));
                    (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
                        workspaceId: id,
                        percent: progress.percent,
                        speed: progress.speed,
                        eta: progress.eta,
                    });
                },
            });
            if (result.success && result.filePath) {
                const videoInfo = await (0, youtube_js_1.getVideoInfo)(videoUrl);
                const actualDuration = await (0, youtube_js_1.probeActualDuration)(result.filePath);
                (0, store_js_1.updateWorkspace)(id, {
                    status: 'ready',
                    downloadedAt: new Date().toISOString(),
                    downloadedPath: result.filePath,
                    fileSize: result.fileSize || 0,
                    thumbnail: videoInfo?.thumbnail || ws.thumbnail || '',
                    videoTitle: videoInfo?.title || ws.videoTitle || '',
                    duration: actualDuration || videoInfo?.duration || 0,
                    downloadQuality: retryQuality,
                });
                (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(id));
                const { blurPath } = (0, ramdisk_js_1.generateWorkspacePaths)(id);
                const blurResult = await (0, ffmpeg_js_1.generateBlurBackground)(result.filePath, blurPath);
                (0, store_js_1.updateWorkspace)(id, { blurBackgroundPath: blurResult.success ? blurPath : '' });
                (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(id));
                return { success: true };
            }
            else {
                const errorMsg = result.error || '';
                const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('video unavailable') || errorMsg.includes('not found');
                const isPrivate = errorMsg.includes('private video');
                if (isPrivate) {
                    (0, store_js_1.updateWorkspace)(id, { status: 'error' });
                }
                else {
                    (0, store_js_1.updateWorkspace)(id, { status: isNotAvailable ? 'error' : 'waiting' });
                }
                (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(id));
                return { success: false, error: result.error };
            }
        }
        catch (err) {
            (0, store_js_1.updateWorkspace)(id, { status: 'waiting' });
            (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(id));
            return { success: false, error: err.message };
        }
    });
    // ── Regenerate blur background ──────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.WORKSPACE_REGENERATE_BLUR, async (_, id) => {
        const ws = (0, store_js_1.getWorkspace)(id);
        if (!ws)
            return { success: false, error: 'Workspace not found' };
        if (!ws.downloadedPath || !fs_1.default.existsSync(ws.downloadedPath)) {
            return { success: false, error: 'Video file not found' };
        }
        try {
            const { blurPath } = (0, ramdisk_js_1.generateWorkspacePaths)(id);
            const result = await (0, ffmpeg_js_1.generateBlurBackground)(ws.downloadedPath, blurPath);
            if (result.success) {
                (0, store_js_1.updateWorkspace)(id, { blurBackgroundPath: blurPath });
                (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(id));
            }
            return { success: result.success, error: result.error };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
}
