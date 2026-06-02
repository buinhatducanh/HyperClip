"use strict";
/**
 * Render IPC handlers.
 * Channels: RENDER_START, RENDER_CANCEL, RENDER_CHUNKED,
 *           RENDERED_LIST, RENDERED_ARCHIVE, RENDERED_REMOVE,
 *           RENDERED_OPEN_FOLDER, RENDERED_SET_ARCHIVE_PATH
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderQueue = void 0;
exports.startNextQueuedRender = startNextQueuedRender;
exports.registerRenderHandlers = registerRenderHandlers;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const channels_js_1 = require("../channels.js");
const ipc_state_js_1 = require("../ipc-state.js");
const store_js_1 = require("../../services/store.js");
const ramdisk_js_1 = require("../../services/ramdisk.js");
const ffmpeg_js_1 = require("../../services/ffmpeg.js");
const worker_pool_js_1 = require("../../services/worker-pool.js");
const system_js_1 = require("../../services/system.js");
const unified_log_js_1 = require("../../services/unified_log.js");
/** Extract quality number (short side) from resolution string.
 * Portrait "1080x1920" → 1080 (width = short side).
 * Landscape "1920x1080" → 1080 (height = short side). */
function extractQualityFromResolution(res) {
    const parts = (res || '1080x1920').split('x').map(Number);
    const w = parts[0] || 1080;
    const h = parts[1] || 1920;
    return h >= w ? w : h;
}
exports.renderQueue = [];
// Track renders currently executing (by workspaceId)
const activeRenders = new Set();
// ── Max concurrent renders based on GPU tier + output resolution ────────────────
// VRAM budget per render session (decode + filter + encode):
//   720p canvas (1920×1920 max): ~500MB
//   1080p canvas (1920×1920):   ~800MB
//   RTX 5080: 16GB → 3×720p or 2×1080p fits easily
//   RTX 4090: 24GB → 3×720p or 2×1080p
//   RTX 3060: 8GB  → 2×720p or 1×1080p
function getMaxConcurrentRenders(outputResolution) {
    const settings = (0, ramdisk_js_1.loadSettings)();
    if (settings.maxConcurrentRenders && settings.maxConcurrentRenders > 0) {
        return settings.maxConcurrentRenders;
    }
    const gpuCaps = (0, system_js_1.getGPUCapabilities)();
    const tier = gpuCaps.tier;
    // Extract output quality (short side of canvas)
    let quality = 720;
    if (outputResolution) {
        const parts = outputResolution.split('x').map(Number);
        quality = Math.max(parts[0] || 720, parts[1] || 720);
    }
    if (tier === 'high') {
        // RTX 5080/4090: 3× 720p, 2× 1080p
        return quality >= 1080 ? 2 : 3;
    }
    if (tier === 'mid') {
        // RTX 3060-3070: 2× 720p, 1× 1080p
        return quality >= 1080 ? 1 : 2;
    }
    // Low / software: 1 at a time
    return 1;
}
function startNextQueuedRender() {
    if (exports.renderQueue.length === 0)
        return;
    // Determine how many slots are available
    const activeCount = activeRenders.size;
    const maxConcurrent = getMaxConcurrentRenders();
    const slots = maxConcurrent - activeCount;
    if (slots <= 0)
        return;
    // Start up to `slots` jobs in parallel
    for (let i = 0; i < slots && exports.renderQueue.length > 0; i++) {
        const job = exports.renderQueue.shift();
        executeRenderJob(job);
    }
}
function executeRenderJob(job) {
    const { workspaceId, metadata, resolve } = job;
    // Track this render as active
    activeRenders.add(workspaceId);
    const workspace = (0, store_js_1.getWorkspace)(workspaceId);
    if (!workspace) {
        activeRenders.delete(workspaceId);
        resolve({ success: false, error: 'Workspace not found' });
        startNextQueuedRender();
        return;
    }
    // Use pre-scaled path if available (auto-render pre-scaled the source to output resolution).
    // Falls back to downloadedPath, then findDownloadedFileAbs, then metadata source.
    const videoPath = workspace.preScaledPath || workspace.downloadedPath || findDownloadedFileAbs(workspaceId) || metadata.source_video;
    if (!fs_1.default.existsSync(videoPath)) {
        console.error(`[RENDER] Source video not found: ${videoPath}`);
        activeRenders.delete(workspaceId);
        resolve({ success: false, error: `Source video not found: ${path_1.default.basename(videoPath)}` });
        startNextQueuedRender();
        return;
    }
    const renderStartMs = Date.now();
    const renderQuality = extractQualityFromResolution(metadata.export_resolution || '1080x1920');
    const renderSpeed = metadata.video_speed ?? 1.0;
    const trimStart = metadata.trim?.start ?? 0;
    const trimEnd = metadata.trim?.end ?? 0;
    const trimDuration = trimEnd - trimStart;
    const maxConcurrent = getMaxConcurrentRenders(metadata.export_resolution);
    (0, unified_log_js_1.devLog)(`[TIMER] RENDER START: "${workspace.videoTitle}" (${activeRenders.size}/${maxConcurrent} active)`);
    (0, unified_log_js_1.devLog)(`[TIMER]   Quality: ${renderQuality}p | Speed: ${renderSpeed}x | Trim: ${trimDuration}s (${trimStart}s–${trimEnd}s)`);
    (0, unified_log_js_1.devLog)(`[TIMER]   Codec: ${metadata.codec ?? 'hevc'} | Source: ${path_1.default.basename(videoPath)}`);
    (0, store_js_1.updateWorkspace)(workspaceId, { status: 'rendering', renderProgress: 0 });
    const renderStartedAtISO = new Date().toISOString();
    (0, ipc_state_js_1.sendNotification)('info', `Rendering: ${workspace.videoTitle}`, workspaceId);
    (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.ACTIVITY_EVENT, {
        id: workspaceId,
        timestamp: Date.now(),
        type: 'rendering',
        title: `Render: ${workspace.videoTitle?.length > 38 ? workspace.videoTitle.slice(0, 38) + '…' : (workspace.videoTitle || 'Video')}`,
        subtitle: `${renderQuality}p • ${metadata.codec ?? 'hevc'} • ${trimDuration}s`,
        workspaceId,
    });
    const outputDir = (0, ramdisk_js_1.getOutputPath)();
    // Build resolved metadata with workspace state merged in
    const wsBlurBg = workspace?.blurBackgroundPath || '';
    const wsThumbPath = path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), `thumb_${workspaceId}.jpg`);
    const resolvedOverlays = (metadata.overlays || []).map((ol) => {
        if (ol.type === 'header' && !ol.src && fs_1.default.existsSync(wsThumbPath)) {
            return { ...ol, src: wsThumbPath };
        }
        return ol;
    });
    const resolvedMetadata = {
        ...metadata,
        source_video: videoPath,
        overlays: resolvedOverlays,
        blur_background: metadata.blur_background || wsBlurBg,
        backgroundImage: !metadata.backgroundImage && !wsBlurBg && fs_1.default.existsSync(wsThumbPath) ? wsThumbPath : metadata.backgroundImage,
        watermarkText: metadata.watermarkText || '',
    };
    const gpuTier = (0, system_js_1.getGPUCapabilities)().tier;
    void (0, ffmpeg_js_1.renderVideo)(resolvedMetadata, outputDir, (progress) => {
        (0, store_js_1.updateWorkspace)(workspaceId, { renderProgress: progress.percent });
        (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.RENDER_PROGRESS_EVENT, progress);
    }, gpuTier).then((result) => {
        const renderElapsed = ((Date.now() - renderStartMs) / 1000).toFixed(1);
        if (result.success) {
            const renderCompletedAtISO = new Date().toISOString();
            const renderMs = Date.now() - renderStartMs;
            const ws = (0, store_js_1.getWorkspace)(workspaceId);
            (0, store_js_1.updateWorkspace)(workspaceId, {
                status: 'done', renderProgress: 100, outputPath: result.outputPath || '',
                metrics: { ...ws?.metrics, renderStartedAt: renderStartedAtISO, renderCompletedAt: renderCompletedAtISO, renderMs },
            });
            (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(workspaceId));
            (0, ipc_state_js_1.sendNotification)('success', `Done: ${workspace.videoTitle}`, workspaceId);
            (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.ACTIVITY_EVENT, {
                id: workspaceId,
                timestamp: Date.now(),
                type: 'done',
                title: `Xong: ${workspace.videoTitle?.length > 40 ? workspace.videoTitle.slice(0, 40) + '…' : (workspace.videoTitle || 'Video')}`,
                subtitle: `${renderElapsed}s`,
                workspaceId,
            });
            // Auto-archive
            void (async () => {
                try {
                    const exportRes = metadata.export_resolution || '1080x1920';
                    const quality = extractQualityFromResolution(exportRes);
                    const codec = metadata.codec || 'hevc';
                    const thumbPath = path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), `thumb_${workspace.id}.jpg`);
                    const thumbData = fs_1.default.existsSync(thumbPath)
                        ? 'data:image/jpeg;base64,' + fs_1.default.readFileSync(thumbPath).toString('base64')
                        : undefined;
                    const archiveResult = await (0, ramdisk_js_1.archiveRenderedFile)(result.outputPath, workspace.channelName, workspace.videoTitle, quality, codec, workspace.fileSize || 0, workspace.duration || 0);
                    if (archiveResult.success && archiveResult.archivedPath) {
                        const renderDurationMs = Date.now() - renderStartMs;
                        // isShort reflects OUTPUT canvas aspect, not source.
                        // Portrait (height >= width) → 9:16 vertical.
                        const [outW, outH] = exportRes.split('x').map(Number);
                        const resolvedIsShort = (outH || 1920) >= (outW || 1080);
                        const renderConfigRecord = {
                            exportResolution: exportRes,
                            fps: metadata.fps_target || 30,
                            speed: metadata.video_speed ?? 1.0,
                            codec: metadata.codec || 'hevc',
                            preset: metadata.preset,
                            tune: metadata.tune,
                            backgroundType: metadata.backgroundType,
                            audioCodec: metadata.audioCodec,
                            audioBitrate: metadata.audioBitrate,
                            trimStart: metadata.trim?.start,
                            trimEnd: metadata.trim?.end,
                            isShort: resolvedIsShort,
                            vidHeightPct: metadata.vidHeightPct,
                            gpuTier,
                        };
                        const sourceInfoRecord = {
                            originalResolution: workspace.videoResolution,
                            originalDuration: workspace.duration || 0,
                            originalFileSize: workspace.fileSize || 0,
                            downloadQuality: workspace.downloadQuality,
                        };
                        // Prefer result.fileSize (from FFmpeg output); fall back to fs.statSync.
                        const actualBytes = result.fileSize || (fs_1.default.existsSync(result.outputPath) ? fs_1.default.statSync(result.outputPath).size : 0);
                        const record = {
                            id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                            workspaceId: workspace.id,
                            channelId: workspace.channelId,
                            channelName: workspace.channelName,
                            videoTitle: workspace.videoTitle,
                            archivedPath: archiveResult.archivedPath,
                            outputPath: result.outputPath,
                            quality,
                            codec,
                            fileSize: (0, ramdisk_js_1.formatBytes)(actualBytes),
                            fileSizeBytes: actualBytes,
                            // Output duration = source trim duration / speed.
                            duration: result.duration || workspace.duration || 0,
                            thumbnail: workspace.thumbnail,
                            thumbnailData: thumbData,
                            videoResolution: workspace.videoResolution,
                            renderedAt: new Date().toISOString(),
                            renderDurationMs,
                            renderConfig: renderConfigRecord,
                            sourceInfo: sourceInfoRecord,
                        };
                        (0, store_js_1.addRenderedVideo)(record);
                        (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.RENDERED_ADD, record);
                        (0, unified_log_js_1.devLog)(`[Render] Archived: ${archiveResult.archivedPath}`);
                        (0, unified_log_js_1.devLog)(`[TIMER] ARCHIVE DONE: ${archiveResult.archivedPath}`);
                        (0, unified_log_js_1.devLog)(`[TIMER] ═══════════════════════════════════════════════`);
                    }
                    else {
                        (0, ipc_state_js_1.sendNotification)('warning', `Render done, archive failed: ${archiveResult.error || 'unknown'}`, workspaceId);
                        (0, store_js_1.updateWorkspace)(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' });
                        (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(workspaceId));
                    }
                }
                catch (e) {
                    (0, ipc_state_js_1.sendNotification)('error', `Archive error: ${e}`, workspaceId);
                    console.warn('[Archive] failed:', e);
                }
            })();
        }
        else {
            (0, store_js_1.updateWorkspace)(workspaceId, { status: 'ready', renderProgress: 0 });
            (0, ipc_state_js_1.sendNotification)('error', `Render failed: ${result.error}`, workspaceId);
        }
        activeRenders.delete(workspaceId);
        startNextQueuedRender();
    });
}
// ─── IPC Handlers ────────────────────────────────────────────────────────────────
function findDownloadedFileAbs(workspaceId) {
    const dirs = [
        (0, ramdisk_js_1.getVideoStoragePath)(),
        path_1.default.join((0, ramdisk_js_1.getAppStoreDir)(), 'downloads'),
        path_1.default.join((0, ramdisk_js_1.getAppStoreDir)(), 'videos'),
    ];
    for (const dir of dirs) {
        try {
            const entries = fs_1.default.readdirSync(dir);
            const found = entries.find((f) => {
                const base = path_1.default.basename(f, path_1.default.extname(f));
                return base === workspaceId || base.startsWith(workspaceId + '_') || base.startsWith(workspaceId + '.');
            });
            if (found) {
                const abs = path_1.default.join(dir, found);
                if (fs_1.default.existsSync(abs))
                    return abs;
            }
        }
        catch { /* skip */ }
    }
    return null;
}
function registerRenderHandlers(ipcMain) {
    // ─── Standard render (via worker pool) ────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.RENDER_START, async (_, workspaceId, metadata) => {
        return new Promise((resolve) => {
            exports.renderQueue.push({ workspaceId, metadata, resolve });
            startNextQueuedRender();
        });
    });
    // ─── Cancel render ─────────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.RENDER_CANCEL, async (_, workspaceId) => {
        const queueIdx = exports.renderQueue.findIndex(j => j.workspaceId === workspaceId);
        if (queueIdx !== -1) {
            const job = exports.renderQueue.splice(queueIdx, 1)[0];
            job.resolve({ success: false, error: 'Cancelled before start' });
        }
        (0, worker_pool_js_1.cancelFfmpeg)(`single:${workspaceId}`);
        (0, ffmpeg_js_1.cancelChunked)(workspaceId);
        (0, store_js_1.updateWorkspace)(workspaceId, { status: 'ready', renderProgress: 0 });
        (0, ipc_state_js_1.sendNotification)('warning', 'Render cancelled', workspaceId);
        return { success: true };
    });
    // ─── Chunked parallel encoding ──────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.RENDER_CHUNKED, async (_, workspaceId, metadata, config) => {
        const workspace = (0, store_js_1.getWorkspace)(workspaceId);
        if (!workspace)
            return { success: false, workspaceId, error: 'Workspace not found' };
        if (!workspace.downloadedPath)
            return { success: false, workspaceId, error: 'Video not downloaded' };
        const videoPath = workspace.preScaledPath || workspace.downloadedPath || findDownloadedFileAbs(workspaceId) || metadata.source_video;
        if (!fs_1.default.existsSync(videoPath)) {
            return { success: false, workspaceId, error: `Source video not found: ${path_1.default.basename(videoPath)}` };
        }
        const gpuCaps = (0, system_js_1.getGPUCapabilities)();
        // metadata.chunkDuration overrides GPU-tier default (used for auto-split workspaces:
        // each section already split by download, so renderChunked must NOT re-split further).
        const effectiveConfig = {
            workers: config?.workers ?? gpuCaps.maxChunkWorkers,
            chunkDuration: metadata.chunkDuration ?? config?.chunkDuration ?? (gpuCaps.tier === 'high' ? 90 : 120),
            minChunkDuration: config?.minChunkDuration ?? 10,
            gpuTier: gpuCaps.tier,
            fpsTarget: (metadata.fps_target || 30),
        };
        (0, store_js_1.updateWorkspace)(workspaceId, { status: 'rendering', renderProgress: 0 });
        (0, ipc_state_js_1.sendNotification)('info', `GPU MAX (${effectiveConfig.workers}x): ${workspace.videoTitle}`, workspaceId);
        const chunkRenderStartMs = Date.now();
        const chunkQuality = parseInt((metadata.export_resolution || '1080x1920').split('x')[1]) || 1080;
        const chunkSpeed = metadata.video_speed ?? 1.0;
        const chunkTrimStart = metadata.trim?.start ?? 0;
        const chunkTrimEnd = metadata.trim?.end ?? 0;
        const chunkTrimDuration = chunkTrimEnd - chunkTrimStart;
        (0, unified_log_js_1.devLog)(`[TIMER] RENDER START (GPU MAX CHUNKED): "${workspace.videoTitle}"`);
        (0, unified_log_js_1.devLog)(`[TIMER]   Quality: ${chunkQuality}p | Speed: ${chunkSpeed}x | Trim: ${chunkTrimDuration}s | Codec: ${metadata.codec ?? 'hevc'} | Workers: ${effectiveConfig.workers}x`);
        const outputDir = (0, ramdisk_js_1.getOutputPath)();
        const wsBlurBg = workspace?.blurBackgroundPath || '';
        const wsThumbPath = path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), `thumb_${workspaceId}.jpg`);
        const resolvedMetadata = {
            ...metadata,
            source_video: videoPath,
            blur_background: metadata.blur_background || wsBlurBg,
            backgroundImage: (!metadata.backgroundImage || !fs_1.default.existsSync(metadata.backgroundImage)) && !wsBlurBg && fs_1.default.existsSync(wsThumbPath) ? wsThumbPath : metadata.backgroundImage,
            watermarkText: metadata.watermarkText || '',
        };
        const result = await (0, ffmpeg_js_1.renderChunked)(resolvedMetadata, outputDir, effectiveConfig, (progress) => {
            (0, store_js_1.updateWorkspace)(workspaceId, { renderProgress: Math.round(progress.percent) });
            (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.RENDER_PROGRESS_EVENT, progress);
        });
        if (result.success) {
            const renderCompletedAtISO = new Date().toISOString();
            const chunkRenderMs = Date.now() - chunkRenderStartMs;
            const ws = (0, store_js_1.getWorkspace)(workspaceId);
            (0, store_js_1.updateWorkspace)(workspaceId, {
                status: 'done', renderProgress: 100, outputPath: result.outputPath || '',
                metrics: {
                    ...ws?.metrics,
                    renderStartedAt: ws?.metrics?.renderStartedAt || new Date(chunkRenderStartMs).toISOString(),
                    renderCompletedAt: renderCompletedAtISO,
                    renderMs: chunkRenderMs,
                    renderWorkers: effectiveConfig.workers,
                    renderPreset: gpuCaps.tier === 'high' ? 'p5' : 'p4',
                    renderCodec: metadata.codec || 'hevc',
                    renderOutputResolution: metadata.export_resolution || '1080x1920',
                    renderChunks: Math.ceil((metadata.trim.end - metadata.trim.start) / (effectiveConfig.chunkDuration ?? 30)),
                },
            });
            (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(workspaceId));
            (0, ipc_state_js_1.sendNotification)('success', `Done (chunked): ${workspace.videoTitle}`, workspaceId);
            const chunkRenderElapsed = ((Date.now() - chunkRenderStartMs) / 1000).toFixed(1);
            (0, unified_log_js_1.devLog)(`[TIMER] RENDER DONE (GPU MAX CHUNKED): "${workspace.videoTitle}" — ${chunkRenderElapsed}s`);
            const thumbPath = path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), `thumb_${workspace.id}.jpg`);
            const thumbData = fs_1.default.existsSync(thumbPath)
                ? 'data:image/jpeg;base64,' + fs_1.default.readFileSync(thumbPath).toString('base64')
                : undefined;
            void (async () => {
                try {
                    const exportRes = metadata.export_resolution || '1080x1920';
                    const quality = extractQualityFromResolution(exportRes);
                    const codec = metadata.codec || 'hevc';
                    const archiveResult = await (0, ramdisk_js_1.archiveRenderedFile)(result.outputPath, workspace.channelName, workspace.videoTitle, quality, codec, workspace.fileSize || 0, workspace.duration || 0);
                    if (archiveResult.success && archiveResult.archivedPath) {
                        // Prefer result.fileSize (from FFmpeg output); fall back to fs.statSync.
                        const actualBytes = result.fileSize || (fs_1.default.existsSync(result.outputPath) ? fs_1.default.statSync(result.outputPath).size : 0);
                        // isShort reflects OUTPUT canvas aspect, not source.
                        const [outW, outH] = exportRes.split('x').map(Number);
                        const resolvedIsShort = (outH || 1920) >= (outW || 1080);
                        const renderConfigRecord = {
                            exportResolution: exportRes,
                            fps: metadata.fps_target || 30,
                            speed: metadata.video_speed ?? 1.0,
                            codec: metadata.codec || 'hevc',
                            preset: metadata.preset,
                            tune: metadata.tune,
                            backgroundType: metadata.backgroundType,
                            audioCodec: metadata.audioCodec,
                            audioBitrate: metadata.audioBitrate,
                            trimStart: metadata.trim?.start,
                            trimEnd: metadata.trim?.end,
                            isShort: resolvedIsShort,
                            vidHeightPct: metadata.vidHeightPct,
                            gpuTier: effectiveConfig.gpuTier ?? 'software',
                        };
                        const sourceInfoRecord = {
                            originalResolution: workspace.videoResolution,
                            originalDuration: workspace.duration || 0,
                            originalFileSize: workspace.fileSize || 0,
                            downloadQuality: workspace.downloadQuality,
                        };
                        const record = {
                            id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                            workspaceId: workspace.id,
                            channelId: workspace.channelId,
                            channelName: workspace.channelName,
                            videoTitle: workspace.videoTitle,
                            archivedPath: archiveResult.archivedPath,
                            outputPath: result.outputPath,
                            quality,
                            codec,
                            fileSize: (0, ramdisk_js_1.formatBytes)(actualBytes),
                            fileSizeBytes: actualBytes,
                            // Output duration = source trim duration / speed.
                            duration: result.duration || workspace.duration || 0,
                            thumbnail: workspace.thumbnail,
                            thumbnailData: thumbData,
                            videoResolution: workspace.videoResolution,
                            renderedAt: new Date().toISOString(),
                            renderConfig: renderConfigRecord,
                            sourceInfo: sourceInfoRecord,
                        };
                        (0, store_js_1.addRenderedVideo)(record);
                        (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.RENDERED_ADD, record);
                        (0, unified_log_js_1.devLog)(`[TIMER] ARCHIVE DONE: ${archiveResult.archivedPath}`);
                        (0, unified_log_js_1.devLog)(`[TIMER] ═══════════════════════════════════════════════`);
                    }
                    else {
                        (0, ipc_state_js_1.sendNotification)('warning', `Render done, archive failed: ${archiveResult.error || 'unknown'}`, workspaceId);
                        (0, store_js_1.updateWorkspace)(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' });
                        (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(workspaceId));
                    }
                }
                catch (e) {
                    (0, ipc_state_js_1.sendNotification)('error', `Archive error: ${e}`, workspaceId);
                }
            })();
        }
        else {
            (0, store_js_1.updateWorkspace)(workspaceId, { status: 'ready', renderProgress: 0 });
            (0, ipc_state_js_1.sendNotification)('error', `Chunked render failed: ${result.error}`, workspaceId);
        }
        startNextQueuedRender();
        return result;
    });
    // ─── Rendered videos ───────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.RENDERED_LIST, () => {
        return (0, store_js_1.getRenderedVideos)();
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.RENDERED_ARCHIVE, async (_, workspaceId, customArchiveDir) => {
        const ws = (0, store_js_1.getWorkspace)(workspaceId);
        if (!ws)
            return { success: false, error: 'Workspace not found' };
        if (!ws.outputPath)
            return { success: false, error: 'No output file' };
        let prevArchivePath;
        if (customArchiveDir) {
            const settings = (0, ramdisk_js_1.loadSettings)();
            prevArchivePath = settings.renderedOutputPath;
            (0, ramdisk_js_1.saveSettings)({ ...settings, renderedOutputPath: customArchiveDir });
        }
        const quality = ws.quality || 1080;
        const codec = ws.codec || 'hevc';
        const result = await (0, ramdisk_js_1.archiveRenderedFile)(ws.outputPath, ws.channelName, ws.videoTitle, quality, codec, ws.fileSize, ws.duration);
        if (customArchiveDir && prevArchivePath !== undefined) {
            const settings = (0, ramdisk_js_1.loadSettings)();
            (0, ramdisk_js_1.saveSettings)({ ...settings, renderedOutputPath: prevArchivePath });
        }
        if (result.success && result.archivedPath) {
            const thumbPath = path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), `thumb_${ws.id}.jpg`);
            const thumbData = fs_1.default.existsSync(thumbPath)
                ? 'data:image/jpeg;base64,' + fs_1.default.readFileSync(thumbPath).toString('base64')
                : undefined;
            const actualBytes = fs_1.default.existsSync(result.archivedPath) ? fs_1.default.statSync(result.archivedPath).size : 0;
            const renderedRecord = {
                id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                workspaceId: ws.id,
                channelId: ws.channelId,
                channelName: ws.channelName,
                videoTitle: ws.videoTitle,
                archivedPath: result.archivedPath,
                outputPath: ws.outputPath,
                quality,
                codec,
                fileSize: (0, ramdisk_js_1.formatBytes)(actualBytes),
                fileSizeBytes: actualBytes,
                duration: ws.duration,
                thumbnail: ws.thumbnail,
                thumbnailData: thumbData,
                videoResolution: ws.videoResolution,
                renderedAt: new Date().toISOString(),
            };
            (0, store_js_1.addRenderedVideo)(renderedRecord);
            (0, ipc_state_js_1.broadcast)(channels_js_1.IPC_CHANNELS.RENDERED_ADD, renderedRecord);
        }
        return result;
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.RENDERED_REMOVE, (_, id) => {
        const videos = (0, store_js_1.getRenderedVideos)();
        const video = videos.find(v => v.id === id);
        let bytesFreed = 0;
        if (video?.archivedPath) {
            try {
                if (fs_1.default.existsSync(video.archivedPath)) {
                    const stat = fs_1.default.statSync(video.archivedPath);
                    bytesFreed = stat.size;
                    fs_1.default.unlinkSync(video.archivedPath);
                    (0, unified_log_js_1.devLog)(`[Rendered] Deleted (${(bytesFreed / 1024 / 1024).toFixed(1)} MB): ${video.archivedPath}`);
                }
            }
            catch { }
        }
        (0, store_js_1.removeRenderedVideo)(id);
        return { success: true, bytesFreed };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.RENDERED_OPEN_FOLDER, (_, id) => {
        if (id) {
            const videos = (0, store_js_1.getRenderedVideos)();
            const video = videos.find(v => v.id === id);
            if (video && fs_1.default.existsSync(video.archivedPath)) {
                (0, ramdisk_js_1.showInFolder)(video.archivedPath);
                return { success: true };
            }
        }
        (0, ramdisk_js_1.openArchiveFolder)();
        return { success: true };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.RENDERED_SET_ARCHIVE_PATH, (_, newPath) => {
        const settings = (0, ramdisk_js_1.loadSettings)();
        (0, ramdisk_js_1.saveSettings)({ ...settings, renderedOutputPath: newPath });
        return { success: true };
    });
}
