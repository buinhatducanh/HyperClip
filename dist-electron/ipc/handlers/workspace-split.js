"use strict";
/**
 * Workspace Split IPC handler.
 * Channel: WORKSPACE_SPLIT — splits a long video into multiple workspaces by trim limit.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkspaceSplitHandler = registerWorkspaceSplitHandler;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const channels_js_1 = require("../channels.js");
const store_js_1 = require("../../services/store.js");
const ffmpeg_js_1 = require("../../services/ffmpeg.js");
const ramdisk_js_1 = require("../../services/ramdisk.js");
const ipc_state_js_1 = require("../ipc-state.js");
const unified_log_js_1 = require("../../services/unified_log.js");
function registerWorkspaceSplitHandler(ipcMain) {
    ipcMain.handle(channels_js_1.IPC_CHANNELS.WORKSPACE_SPLIT, async (_, id, partMinutes = 10) => {
        try {
            const ws = (0, store_js_1.getWorkspace)(id);
            if (!ws)
                return { success: false, error: 'Workspace not found' };
            if (ws.status !== 'ready' || !ws.downloadedPath || !fs_1.default.existsSync(ws.downloadedPath)) {
                return { success: false, error: 'Video not ready' };
            }
            const totalSec = typeof ws.duration === 'number' ? ws.duration : 0;
            if (totalSec === 0)
                return { success: false, error: 'Unknown video duration' };
            const partSec = partMinutes * 60;
            if (totalSec <= partSec) {
                return { success: false, error: `Video is ${Math.floor(totalSec / 60)}m — no split needed (trim limit: ${partMinutes}m)` };
            }
            const numParts = Math.ceil(totalSec / partSec);
            if (numParts < 2)
                return { success: false, error: 'No split needed' };
            (0, unified_log_js_1.devLog)(`[Split] Splitting "${ws.videoTitle}" (${totalSec}s) into ${numParts} parts of ${partMinutes}m each`);
            (0, unified_log_js_1.devLog)(`[Split] Original workspace ${ws.id} = Part 1 (0s – ${partSec}s)`);
            (0, unified_log_js_1.devLog)(`[Split] Will create ${numParts - 1} new workspaces for remaining parts`);
            const newWorkspaces = [];
            for (let i = 1; i < numParts; i++) {
                const startSec = i * partSec;
                const endSec = Math.min((i + 1) * partSec, totalSec);
                const partDuration = endSec - startSec;
                const partFileName = `${ws.id}_part${i + 1}.${path_1.default.extname(ws.downloadedPath).slice(1) || 'mp4'}`;
                const partFilePath = path_1.default.join(path_1.default.dirname(ws.downloadedPath), partFileName);
                (0, unified_log_js_1.devLog)(`[Split] Part ${i + 1}/${numParts}: ${startSec}s – ${endSec}s (${partDuration}s)`);
                // FFmpeg stream-copy the part (no re-encode, very fast)
                const trimResult = await (0, ffmpeg_js_1.trimVideo)(ws.downloadedPath, partFilePath, startSec, partDuration);
                if (!trimResult.success) {
                    console.error(`[Split] FFmpeg trim failed for part ${i + 1}: ${trimResult.error}`);
                    // Clean up already-created parts
                    for (const nw of newWorkspaces) {
                        try {
                            if (nw.downloadedPath) {
                                const abs = nw.downloadedPath.startsWith('/') || /^[A-Z]:/i.test(nw.downloadedPath)
                                    ? nw.downloadedPath
                                    : path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), nw.downloadedPath);
                                if (fs_1.default.existsSync(abs))
                                    fs_1.default.unlinkSync(abs);
                            }
                        }
                        catch { /* ignore cleanup errors */ }
                    }
                    return { success: false, error: `Part ${i + 1} FFmpeg failed: ${trimResult.error}` };
                }
                const partSize = fs_1.default.statSync(partFilePath).size;
                const newWs = (0, store_js_1.addWorkspace)({
                    channelId: ws.channelId,
                    channelName: ws.channelName,
                    channelColor: ws.channelColor || '#00B4FF',
                    videoId: ws.videoId,
                    videoTitle: ws.videoTitle,
                    videoUrl: ws.videoUrl,
                    thumbnail: ws.thumbnail,
                    duration: partDuration,
                    trimLimit: ws.trimLimit,
                    status: 'ready',
                    renderProgress: 0,
                    downloadedAt: new Date().toISOString(),
                    downloadedPath: partFilePath,
                    blurBackgroundPath: '',
                    outputPath: '',
                    metadataPath: '',
                    fileSize: partSize,
                    renderMetadata: null,
                    publishedAt: ws.publishedAt,
                    detectedAt: ws.detectedAt,
                    isShort: ws.isShort,
                    videoResolution: ws.videoResolution,
                    downloadQuality: ws.downloadQuality,
                });
                // Extract thumbnail for this part
                const partThumbPath = path_1.default.join(path_1.default.dirname(ws.downloadedPath), `thumb_${newWs.id}.jpg`);
                const partThumbResult = await (0, ffmpeg_js_1.extractVideoThumbnail)(partFilePath, partThumbPath);
                // Generate blur for this part
                const { blurPath: partBlurPath } = (0, ramdisk_js_1.generateWorkspacePaths)(newWs.id);
                const partBlurResult = await (0, ffmpeg_js_1.generateBlurBackground)(partFilePath, partBlurPath);
                (0, store_js_1.updateWorkspace)(newWs.id, {
                    thumbnail: partThumbResult.success ? 'local-video:///' + partThumbPath.replace(/\\/g, '/') : ws.thumbnail,
                    blurBackgroundPath: partBlurResult.success ? partBlurPath : '',
                });
                newWorkspaces.push(newWs);
                (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, newWs);
                (0, unified_log_js_1.devLog)(`[Split] Created workspace ${newWs.id} (${newWs.videoTitle})`);
            }
            (0, ipc_state_js_1.sendNotification)('success', `Split "${ws.videoTitle}" into ${numParts} parts`, ws.id);
            return { success: true, newWorkspaces };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
}
