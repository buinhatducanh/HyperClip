"use strict";
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
exports.startYouTubePoller = startYouTubePoller;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const http_1 = __importDefault(require("http"));
const zlib_1 = __importDefault(require("zlib"));
const channels_js_1 = require("./ipc/channels.js");
const system_js_1 = require("./services/system.js");
const diagnostics_js_1 = require("./services/diagnostics.js");
function formatBytes(bytes) {
    if (!bytes || bytes <= 0)
        return '—';
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function extractQualityFromResolution(res) {
    const parts = (res || '1080x1920').split('x').map(Number);
    const w = parts[0] || 1080;
    const h = parts[1] || 1920;
    return h >= w ? w : h;
}
const store_js_1 = require("./services/store.js");
const youtube_js_1 = require("./services/youtube.js");
const ffmpeg_js_1 = require("./services/ffmpeg.js");
const worker_pool_js_1 = require("./services/worker-pool.js");
const ffmpeg_paths_js_1 = require("./services/ffmpeg-paths.js");
const paths_js_1 = require("./services/paths.js");
const ramdisk_js_1 = require("./services/ramdisk.js");
const youtube_poller_js_1 = require("./services/youtube_poller.js");
const subscription_feed_js_1 = require("./services/subscription_feed.js");
const cookie_manager_js_1 = require("./services/cookie_manager.js");
const token_manager_js_1 = require("./services/token_manager.js");
const cdp_js_1 = require("./services/cdp.js");
const unified_log_js_1 = require("./services/unified_log.js");
const console_window_js_1 = require("./services/console-window.js");
const health_alerts_js_1 = require("./services/health_alerts.js");
const github_updater_js_1 = require("./services/github-updater.js");
const system_js_2 = require("./services/system.js");
const ipc_state_js_1 = require("./ipc/ipc-state.js");
const index_js_1 = require("./ipc/handlers/index.js");
// Fix UTF-8 console output on Windows — set code page to 65001 (UTF-8)
if (process.platform === 'win32') {
    Promise.resolve().then(() => __importStar(require('child_process'))).then(({ execSync }) => {
        try {
            execSync('chcp 65001', { stdio: 'ignore' });
        }
        catch { }
    }).catch(() => { });
}
const isDev = process.env.NODE_ENV !== 'production';
const NEXT_PORT = parseInt(process.env.HYPERCLIP_PORT || '3000', 10);
// Single terminal: Electron auto-boots Next.js if not already running
let mainWindow = null;
let tray = null;
let _isQuitting = false;
let nextServer = null;
let nextServerOwned = false; // did WE spawn the Next.js server?
// ─── Render Queue (Tier 2+3.2: Multi-worker via worker pool) ──────────────────
// Concurrency controlled by worker-pool (max 2 concurrent FFmpeg processes).
// The render queue here is for job ordering and user-level queue management.
// ─── In-flight auto-download retries ──────────────────────────────────────────
// Prevents multiple concurrent retry attempts for the same workspace
const inProgressAutoRetries = new Set();
// ─── Background Download Queue ─────────────────────────────────────────────────
// Non-blocking pre-download: poller detects video → immediately spawns download
// in background without blocking the next poll. Multiple videos from same poll
// download in parallel instead of sequentially.
// Concurrency is RAM-adaptive: spawns new downloads only when enough free memory.
// - 4050 / 24GB RAM: max 2 concurrent (6-8 GB needed per download)
// - 5080 / 64GB RAM: max 3 concurrent (headroom for FFmpeg workers too)
const bgDownloadQueue = [];
let activeBgDownloads = 0;
/** Get safe concurrent download count.
 *  User's setting (maxConcurrentDownloads) takes priority if set (non-zero).
 *  Falls back to RAM-adaptive logic otherwise.
 *  Each download needs ~2-4 GB (buffers + yt-dlp heap + OS network buffers).
 *  FFmpeg workers also need RAM, so leave headroom.
 */
function getMaxConcurrentDownloads() {
    const settings = (0, ramdisk_js_1.loadSettings)();
    if (settings.maxConcurrentDownloads && settings.maxConcurrentDownloads > 0) {
        return settings.maxConcurrentDownloads;
    }
    const freeGB = os_1.default.freemem() / (1024 ** 3);
    const totalGB = os_1.default.totalmem() / (1024 ** 3);
    if (totalGB >= 48)
        return 3; // RTX 5080 64GB: 3 concurrent
    if (freeGB >= 8)
        return 2; // 4050 24GB: 2 concurrent (8GB+ free after OS)
    if (freeGB >= 4)
        return 1; // Low RAM: 1 at a time
    return 0; // Too low: pause queue
}
/** Enqueue a video for non-blocking background download.
 *  PHASE 1 (immediate): create workspace with status='waiting' → UI shows video right away.
 *  PHASE 2 (background): download runs in bg queue, updates workspace to 'downloading'→'ready'.
 *
 *  Quality is determined by user's setting (autoDownloadQuality in Settings).
 */
function enqueueBgDownload(video) {
    // Respect user's auto-download toggle
    const settings = (0, ramdisk_js_1.loadSettings)();
    if (settings.autoDownloadEnabled === false) {
        (0, unified_log_js_1.devLog)(`[BgDownload] Auto-download disabled — skipping ${video.videoId}`);
        return;
    }
    // Deduplicate: don't queue if already pending or active
    if (bgDownloadQueue.some(v => v.videoId === video.videoId)) {
        (0, unified_log_js_1.devLog)(`[BgDownload] already queued: ${video.videoId}`);
        return;
    }
    const existingWorkspaces = (0, store_js_1.getWorkspaces)();
    const alreadyHasWorkspace = existingWorkspaces.some(ws => ws.videoId === video.videoId && ['waiting', 'downloading', 'ready', 'editing', 'rendering', 'done'].includes(ws.status));
    if (alreadyHasWorkspace) {
        (0, unified_log_js_1.devLog)(`[BgDownload] workspace already exists for ${video.videoId}`);
        return;
    }
    // PHASE 1: Create workspace IMMEDIATELY — user sees video in UI within seconds of detection
    const nowIso = new Date().toISOString();
    const channel = (0, store_js_1.getChannel)(video.channelId);
    const resolvedChannelName = video.channelName || channel?.name || 'Unknown Channel';
    const settings2 = (0, ramdisk_js_1.loadSettings)();
    const trimLimit = settings2.defaultTrimLimit ?? 10;
    const ws = (0, store_js_1.addWorkspace)({
        channelId: video.channelId,
        channelName: resolvedChannelName,
        channelColor: '#00B4FF',
        videoId: video.videoId,
        videoTitle: video.title,
        videoUrl: 'https://www.youtube.com/watch?v=' + video.videoId,
        thumbnail: `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`,
        duration: 0,
        trimLimit,
        status: 'waiting',
        renderProgress: 0,
        downloadedAt: nowIso,
        downloadedPath: '',
        blurBackgroundPath: '',
        outputPath: '',
        metadataPath: '',
        fileSize: 0,
        renderMetadata: null,
        publishedAt: video.publishedAt ? new Date(video.publishedAt).toISOString() : undefined,
        detectedAt: video.detectedAt ? new Date(video.detectedAt).toISOString() : nowIso,
        downloadQuality: settings2.autoDownloadQuality ?? '720',
    });
    (0, unified_log_js_1.devLog)(`[BgDownload] enqueue: ${video.videoId} (${video.title}) → workspace=${ws.id}, queue=${bgDownloadQueue.length + 1}`);
    // Broadcast immediately so UI shows the video right away
    broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, ws);
    showWindowsToast('📥 Video mới!', `${resolvedChannelName}: ${video.title}`);
    broadcast(channels_js_1.IPC_CHANNELS.ACTIVITY_EVENT, {
        id: ws.id,
        timestamp: Date.now(),
        type: 'detected',
        title: `Phát hiện: ${video.title.length > 45 ? video.title.slice(0, 45) + '…' : video.title}`,
        subtitle: `${resolvedChannelName} • đang tải...`,
        workspaceId: ws.id,
    });
    bgDownloadQueue.push({
        videoId: video.videoId,
        channelId: video.channelId,
        channelName: resolvedChannelName,
        title: video.title,
        publishedAt: video.publishedAt ? new Date(video.publishedAt).toISOString() : undefined,
        detectedAt: video.detectedAt ? new Date(video.detectedAt).toISOString() : nowIso,
        workspaceId: ws.id,
    });
    processBgDownloadQueue();
}
/** Process next item in queue if under concurrency limit.
 *  Limit is RAM-adaptive (2 on 24GB, 3 on 64GB).
 */
function processBgDownloadQueue() {
    const maxConcurrent = getMaxConcurrentDownloads();
    (0, unified_log_js_1.devLog)(`[BgDownload] processQueue: active=${activeBgDownloads}, max=${maxConcurrent}, queue=${bgDownloadQueue.length}`);
    while (activeBgDownloads < maxConcurrent && bgDownloadQueue.length > 0) {
        const item = bgDownloadQueue.shift();
        (0, unified_log_js_1.devLog)(`[BgDownload] starting: ${item.videoId} (${item.title}), active=${activeBgDownloads + 1}`);
        activeBgDownloads++;
        // Respect user's download quality setting from Settings
        const settings = (0, ramdisk_js_1.loadSettings)();
        const bgQuality = settings.autoDownloadQuality ?? '720';
        autoDownloadFromWebSub(item.videoId, item.channelId, item.channelName, item.title, item.publishedAt, item.detectedAt, bgQuality, item.workspaceId).catch((err) => {
            console.error('[BgDownload] Failed:', item.videoId, err);
        }).finally(() => {
            activeBgDownloads--;
            processBgDownloadQueue();
        });
    }
}
const renderQueue = [];
// Track which workspace is currently open in the DetailEditor — used to protect from auto-cleanup
function startNextQueuedRender() {
    const max = (0, ramdisk_js_1.loadSettings)().maxConcurrentRenders ?? 2;
    if ((0, worker_pool_js_1.getPoolStatus)().active >= max)
        return;
    if (renderQueue.length === 0)
        return;
    const job = renderQueue.shift();
    executeRenderJob(job);
}
// Scan known storage directories for a downloaded video file by workspaceId.
function findDownloadedFileAbs(workspaceId) {
    const dirs = [
        (0, ramdisk_js_1.getVideoStoragePath)(),
        path_1.default.join(os_1.default.tmpdir(), 'hyperclip-video'),
    ];
    for (const dir of dirs) {
        try {
            if (!fs_1.default.existsSync(dir))
                continue;
            const files = fs_1.default.readdirSync(dir).filter(f => (f.startsWith(workspaceId + '_') || f.startsWith(workspaceId + '.')) && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f));
            if (files.length > 0) {
                return path_1.default.join(dir, files[0]);
            }
        }
        catch { }
    }
    return null;
}
function executeRenderJob(job) {
    const { workspaceId, metadata, resolve } = job;
    const workspace = (0, store_js_1.getWorkspace)(workspaceId);
    if (!workspace) {
        resolve({ success: false, error: 'Workspace not found' });
        startNextQueuedRender();
        return;
    }
    // Use pre-scaled path if available (auto-render pre-scaled the source to output resolution).
    // Falls back to downloadedPath, then findDownloadedFileAbs, then metadata source.
    const videoPath = workspace.preScaledPath || workspace.downloadedPath || findDownloadedFileAbs(workspaceId) || metadata.source_video;
    if (!fs_1.default.existsSync(videoPath)) {
        console.error(`[RENDER] Source video not found: ${videoPath}`);
        resolve({ success: false, error: `Source video not found: ${path_1.default.basename(videoPath)}` });
        startNextQueuedRender();
        return;
    }
    const renderStartMs = Date.now();
    const renderQuality = parseInt((metadata.export_resolution || '1080x1920').split('x')[1]) || 1080;
    const renderSpeed = metadata.video_speed ?? 1.0;
    const trimStart = metadata.trim?.start ?? 0;
    const trimEnd = metadata.trim?.end ?? 0;
    const trimDuration = trimEnd - trimStart;
    (0, unified_log_js_1.devLog)(`[TIMER] ═══════════════════════════════════════════════`);
    (0, unified_log_js_1.devLog)(`[TIMER] RENDER START: "${workspace.videoTitle}"`);
    (0, unified_log_js_1.devLog)(`[TIMER]   Quality: ${renderQuality}p | Speed: ${renderSpeed}x | Trim: ${trimDuration}s (${trimStart}s–${trimEnd}s)`);
    (0, unified_log_js_1.devLog)(`[TIMER]   Codec: ${metadata.codec ?? 'hevc'} | Source: ${path_1.default.basename(videoPath)}`);
    (0, unified_log_js_1.devLog)(`[TIMER]   ═══════════════════════════════════════════════`);
    (0, store_js_1.updateWorkspace)(workspaceId, { status: 'rendering', renderProgress: 0 });
    sendNotification('info', `Rendering: ${workspace.videoTitle}`, workspaceId);
    broadcast(channels_js_1.IPC_CHANNELS.ACTIVITY_EVENT, {
        id: workspaceId,
        timestamp: Date.now(),
        type: 'rendering',
        title: `Render: ${workspace.videoTitle?.length > 38 ? workspace.videoTitle.slice(0, 38) + '…' : (workspace.videoTitle || 'Video')}`,
        subtitle: `${renderQuality}p • ${metadata.codec ?? 'hevc'} • ${trimDuration}s`,
        workspaceId,
    });
    const outputDir = (0, ramdisk_js_1.getOutputPath)();
    (0, ramdisk_js_1.ensureStorageDirs)();
    // Build resolved metadata with workspace state merged in:
    // 1. blur_background: prefer workspace's blurBackgroundPath over metadata's value.
    //    Without this, a 'blur' backgroundType falls back to solid black (no thumbnail canvas bg).
    // 2. source_video: always absolute path from workspace.
    // 3. overlays: keep EXACTLY as metadata specifies (auto-render: [], manual: from editorState).
    // 4. backgroundImage: for landscape 'image' type, fall back to workspace thumbnail if not set.
    const wsBlurBg = workspace?.blurBackgroundPath || '';
    const wsThumbPath = path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), `thumb_${workspaceId}.jpg`);
    // Header overlay fallback: use thumbnail when blurBackgroundPath is not available.
    // Ensures header always shows content even if blur generation failed.
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
        // Prefer IPC metadata's blur_background (manual render), fallback to workspace state (auto-render/recovery).
        blur_background: metadata.blur_background || wsBlurBg,
        // For landscape with 'image' type but no backgroundImage → use workspace thumbnail.
        // Only apply when blur is not available (landscape videos don't generate blur).
        backgroundImage: !metadata.backgroundImage && !wsBlurBg && fs_1.default.existsSync(wsThumbPath) ? wsThumbPath : metadata.backgroundImage,
    };
    const gpuTier = (0, system_js_1.getGPUCapabilities)().tier;
    let _lastBroadcastMs = 0;
    let _lastBroadcastPercent = -1;
    (0, ffmpeg_js_1.renderVideo)(resolvedMetadata, outputDir, (progress) => {
        (0, store_js_1.updateWorkspace)(workspaceId, { renderProgress: progress.percent });
        // Throttle: only broadcast every 500ms OR when percent changes by ≥2
        const now = Date.now();
        const pctDelta = Math.abs(progress.percent - _lastBroadcastPercent);
        if (now - _lastBroadcastMs >= 500 || pctDelta >= 2) {
            _lastBroadcastMs = now;
            _lastBroadcastPercent = progress.percent;
            broadcast(channels_js_1.IPC_CHANNELS.RENDER_PROGRESS_EVENT, progress);
        }
    }, gpuTier).then((result) => {
        const renderElapsed = ((Date.now() - renderStartMs) / 1000).toFixed(1);
        if (result.success) {
            (0, store_js_1.updateWorkspace)(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' });
            sendNotification('success', `Done: ${workspace.videoTitle}`, workspaceId);
            broadcast(channels_js_1.IPC_CHANNELS.ACTIVITY_EVENT, {
                id: workspaceId,
                timestamp: Date.now(),
                type: 'done',
                title: `Xong: ${workspace.videoTitle?.length > 40 ? workspace.videoTitle.slice(0, 40) + '…' : (workspace.videoTitle || 'Video')}`,
                subtitle: `${renderElapsed}s`,
                workspaceId,
            });
            // Auto-archive to D:\HyperClip\Rendered
            void (async () => {
                try {
                    const exportRes = metadata.export_resolution || '1080x1920';
                    const quality = extractQualityFromResolution(exportRes);
                    const codec = metadata.codec || 'hevc';
                    // Capture thumbnail as base64 data URI before workspace is deleted
                    const thumbPath = path_1.default.join((0, ramdisk_js_1.getVideoStoragePath)(), `thumb_${workspace.id}.jpg`);
                    const thumbData = fs_1.default.existsSync(thumbPath)
                        ? 'data:image/jpeg;base64,' + fs_1.default.readFileSync(thumbPath).toString('base64')
                        : undefined;
                    const archiveResult = await (0, ramdisk_js_1.archiveRenderedFile)(result.outputPath, workspace.channelName, workspace.videoTitle, quality, codec, workspace.fileSize || 0, workspace.duration || 0);
                    if (archiveResult.success && archiveResult.archivedPath) {
                        const renderDurationMs = Date.now() - renderStartMs;
                        const renderConfigRecord = {
                            exportResolution: metadata.export_resolution || '1080x1920',
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
                            isShort: metadata.isShort,
                            vidHeightPct: metadata.vidHeightPct,
                            gpuTier: gpuTier,
                        };
                        const sourceInfoRecord = {
                            originalResolution: workspace.videoResolution,
                            originalDuration: workspace.duration || 0,
                            originalFileSize: workspace.fileSize || 0,
                            downloadQuality: workspace.downloadQuality,
                        };
                        const actualBytes = fs_1.default.existsSync(result.outputPath) ? fs_1.default.statSync(result.outputPath).size : 0;
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
                            fileSize: formatBytes(actualBytes),
                            fileSizeBytes: actualBytes,
                            duration: workspace.duration || 0,
                            thumbnail: workspace.thumbnail,
                            thumbnailData: thumbData,
                            videoResolution: workspace.videoResolution,
                            renderedAt: new Date().toISOString(),
                            renderDurationMs,
                            renderConfig: renderConfigRecord,
                            sourceInfo: sourceInfoRecord,
                        };
                        (0, store_js_1.addRenderedVideo)(record);
                        broadcast(channels_js_1.IPC_CHANNELS.RENDERED_ADD, record);
                        // [TEST-MODE] Cleanup DISABLED — keep downloaded files for render testing
                        // Cleanup pre-scaled source file after successful render
                        // if (workspace.preScaledPath) { try { fs.unlinkSync(workspace.preScaledPath) } catch {} }
                        // Cleanup downloaded video + blur after successful archive (storage optimization)
                        // const { bytesFreed } = cleanupWorkspace(workspace.id, workspace.downloadedPath)
                        // if (bytesFreed > 0) { const freedMB = (bytesFreed / 1024 / 1024).toFixed(1); devLog(`[AutoArchive] Cleaned ${freedMB} MB of downloaded files after archive`) }
                        const _fileSizeMB = (actualBytes / 1024 / 1024).toFixed(1);
                        const totalElapsed = ((Date.now() - renderStartMs) / 1000).toFixed(1);
                        (0, unified_log_js_1.devLog)(`[TIMER] ARCHIVE DONE: ${archiveResult.archivedPath}`);
                        (0, unified_log_js_1.devLog)(`[TIMER]   Archive file size: ${_fileSizeMB} MB | Total elapsed: ${totalElapsed}s`);
                        (0, unified_log_js_1.devLog)(`[TIMER] ═══════════════════════════════════════════════`);
                    }
                    else {
                        // Archive failed but render succeeded — notify user, keep workspace
                        sendNotification('warning', `Render done, archive failed: ${archiveResult.error || 'unknown'}`, workspaceId);
                        console.warn(`[AutoArchive] failed: ${archiveResult.error} — workspace ${workspace.id} NOT deleted`);
                        (0, store_js_1.updateWorkspace)(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' });
                    }
                }
                catch (e) {
                    sendNotification('error', `Archive error: ${e}`, workspaceId);
                    console.warn('[AutoArchive] failed:', e);
                }
            })();
        }
        else {
            (0, store_js_1.updateWorkspace)(workspaceId, { status: 'ready', renderProgress: 0 });
            sendNotification('error', `Render failed: ${result.error}`, workspaceId);
        }
        if (result.success) {
            (0, unified_log_js_1.devLog)(`[TIMER] RENDER DONE: "${workspace.videoTitle}" — ${renderElapsed}s (${renderQuality}p @ ${renderSpeed}x speed)`);
        }
        else {
            (0, unified_log_js_1.devLog)(`[TIMER] RENDER FAILED: "${workspace.videoTitle}" — ${renderElapsed}s — ${result.error}`);
        }
        resolve({ success: result.success, outputPath: result.outputPath });
        startNextQueuedRender();
    }).catch((err) => {
        (0, store_js_1.updateWorkspace)(workspaceId, { status: 'ready', renderProgress: 0 });
        resolve({ success: false, error: String(err) });
        startNextQueuedRender();
    });
}
// ─── YouTube Poller ──────────────────────────────────────────────────────────────
// Cookie-based subscription feed polling — no tunnel, no proxy needed.
// 1 request every `intervalMs` captures all 100 channels from the subscriptions feed.
// Cookie refreshes every 15 minutes to stay valid.
/**
 * Start the YouTube subscription feed poller.
 * @param intervalMs Polling interval in milliseconds (default: 3000 = 3 seconds)
 * @param onVideos Callback fired with new videos detected since last poll
 */
function startYouTubePoller(intervalMs, onVideos, onDegraded) {
    const poller = (0, youtube_poller_js_1.createYouTubePoller)({
        pollIntervalMs: intervalMs,
        onNewVideos: (detectedVideos) => {
            onVideos(detectedVideos.map(v => ({
                videoId: v.videoId,
                channelId: v.channelId,
                channelName: v.channelName,
                title: v.title,
                publishedAt: v.publishedAt,
                detectedAt: v.detectedAt,
            })));
        },
        onDegraded,
    });
    poller.start();
}
// ─── Auto-download from new video detected by poller ────────────────────────────
/**
 * Auto-download a video detected by the poller.
 * Phase 1 (enqueueBgDownload): workspace with status='waiting' created immediately — UI sees video right away.
 * Phase 2 (this function): background download updates workspace to 'downloading'→'ready'.
 *
 * @param workspaceId If provided, use this pre-created 'waiting' workspace instead of creating a new one.
 */
async function autoDownloadFromWebSub(videoId, channelId, channelName, title, publishedAt, detectedAt, qualityOverride, workspaceId) {
    try {
        const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
        (0, ramdisk_js_1.ensureStorageDirs)();
        const settings = (0, ramdisk_js_1.loadSettings)();
        const autoTrimLimit = settings.defaultTrimLimit ?? 10;
        const autoQuality = qualityOverride ?? settings.autoDownloadQuality ?? '720';
        // Find the 'waiting' workspace created by enqueueBgDownload
        let ws;
        if (workspaceId) {
            ws = (0, store_js_1.getWorkspace)(workspaceId);
        }
        if (!ws) {
            // Fallback: find by videoId (e.g., retry path without workspaceId)
            const existingWorkspaces = (0, store_js_1.getWorkspaces)();
            ws = existingWorkspaces.find(ws2 => ws2.videoId === videoId && ['waiting', 'error'].includes(ws2.status));
        }
        if (!ws) {
            (0, unified_log_js_1.devLog)(`[Auto] No 'waiting' workspace for ${videoId} — skipping (already handled or duplicate)`);
            return;
        }
        // Retry backoff: skip if retryableAt not reached
        if (ws.status === 'waiting' && ws.retryableAt && Date.now() < new Date(ws.retryableAt).getTime()) {
            const remainingMin = Math.ceil((new Date(ws.retryableAt).getTime() - Date.now()) / 60000);
            (0, unified_log_js_1.devLog)(`[Auto] Skipping ${title} — retryableAt not reached (${remainingMin}m remaining)`);
            return;
        }
        // Update to 'downloading' so UI reflects actual progress
        (0, store_js_1.updateWorkspace)(ws.id, { status: 'downloading', downloadProgress: 0 });
        broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
        broadcast(channels_js_1.IPC_CHANNELS.ACTIVITY_EVENT, {
            id: ws.id,
            timestamp: Date.now(),
            type: 'downloading',
            title: `Đang tải: ${title.length > 40 ? title.slice(0, 40) + '…' : title}`,
            subtitle: `${channelName} • ${autoQuality}p`,
            workspaceId: ws.id,
        });
        const channel = (0, store_js_1.getChannel)(channelId);
        const finalChannelName = channelName || channel?.name || 'Unknown Channel';
        const detectedAtNow = new Date().toISOString();
        const videoUrl = 'https://www.youtube.com/watch?v=' + videoId;
        (0, unified_log_js_1.devLog)(`[Auto] Downloading: ${title} (${videoId}) from ${finalChannelName}, workspace=${ws.id}`);
        // Export Chrome cookies (cached 5 min) for yt-dlp authentication
        const { getYtCookiesFile } = await Promise.resolve().then(() => __importStar(require('./services/po_token.js')));
        const ytCookiesFile = await getYtCookiesFile();
        // ── PHASE 0: Pre-check — detect private/short/unavailable BEFORE wasting time downloading ──
        // This saves 1-5 minutes per private/short/deleted video.
        (0, unified_log_js_1.devLog)(`[Auto] Pre-check: probing video availability...`);
        const preCheck = await (0, youtube_js_1.probeVideoAvailability)(videoUrl, ytCookiesFile);
        if (preCheck) {
            if (preCheck.isPrivate) {
                (0, unified_log_js_1.devLog)(`[Auto] Pre-check: video is PRIVATE — skipping download, marking as error`);
                unified_log_js_1.opLog.error('download', `Private video skipped: ${title}`);
                (0, store_js_1.markVideoSeen)(channelId, videoId);
                (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
                broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
                sendNotification('error', `Private: ${title}`, ws.id);
                return;
            }
            if (preCheck.isNotFound) {
                (0, unified_log_js_1.devLog)(`[Auto] Pre-check: video not found/deleted — skipping download, marking as error`);
                unified_log_js_1.opLog.error('download', `Video unavailable: ${title}`);
                (0, store_js_1.markVideoSeen)(channelId, videoId);
                (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
                broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
                sendNotification('error', `Unavailable: ${title}`, ws.id);
                return;
            }
            if (preCheck.isRateLimited) {
                (0, unified_log_js_1.devLog)(`[Auto] Pre-check: rate-limited — waiting 30s before attempting download`);
                await new Promise(r => setTimeout(r, 30000));
            }
            if (preCheck.available && preCheck.duration > 0 && preCheck.duration < 60) {
                (0, unified_log_js_1.devLog)(`[Auto] Pre-check: video is ${preCheck.duration}s — too short (Shorts), skipping`);
                (0, store_js_1.markVideoSeen)(channelId, videoId);
                (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
                broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
                return;
            }
            if (preCheck.available) {
                (0, unified_log_js_1.devLog)(`[Auto] Pre-check: available, duration=${preCheck.duration}s`);
            }
        }
        else {
            (0, unified_log_js_1.devLog)(`[Auto] Pre-check: could not determine availability — proceeding with download`);
        }
        (0, unified_log_js_1.devLog)(`[Auto] DOWNLOAD START: "${title}" quality=${autoQuality}p trimLimit=${autoTrimLimit === 'full' ? 'full' : autoTrimLimit + 'm'}`);
        const downloadStartMs = Date.now();
        let _dlLastBroadcastMs = 0;
        let _dlLastPercent = -1;
        // downloadVideoStrategy handles the full client chain (web → tv_embedded → ios)
        // with proper error classification, rate-limit backoff, and processing retry.
        let result = await (0, youtube_js_1.downloadVideo)({
            workspaceId: ws.id,
            videoUrl,
            outputDir: storagePath,
            trimLimit: autoTrimLimit,
            quality: autoQuality,
            ytCookiesFile,
            onProgress: (progress) => {
                // Throttle: broadcast every 500ms OR when percent changes
                const now = Date.now();
                const pctDelta = Math.abs(progress.percent - _dlLastPercent);
                if (now - _dlLastBroadcastMs >= 500 || pctDelta >= 2 || progress.speed === 'processing') {
                    _dlLastBroadcastMs = now;
                    _dlLastPercent = progress.percent;
                    // Update workspace store directly (main process) — ensures downloadProgress
                    // is always persisted even if renderer status check has a race condition.
                    // Speed/ETA sent via RENDER_PROGRESS_EVENT, handled by frontend.
                    (0, store_js_1.updateWorkspace)(ws.id, { downloadProgress: progress.percent });
                    broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
                    broadcast(channels_js_1.IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
                        workspaceId: ws.id,
                        percent: progress.percent,
                        speed: progress.speed,
                        eta: progress.eta,
                    });
                }
            },
        });
        if (!result.success || !result.filePath) {
            (0, health_alerts_js_1.recordDownloadFail)();
            const errorMsg = result.error || '';
            const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('video unavailable') || errorMsg.includes('not found');
            const isPrivate = errorMsg.includes('private video');
            if (isNotAvailable) {
                (0, unified_log_js_1.devLog)(`[Auto] Video permanently unavailable: ${title} (${videoId})`);
                (0, store_js_1.markVideoSeen)(channelId, videoId);
                (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
            }
            else if (isPrivate) {
                // All clients (web + tv_embedded + ios) returned Private — genuinely inaccessible
                (0, unified_log_js_1.devLog)(`[Auto] All clients returned Private: ${title} (${videoId}) — marking as permanently unavailable`);
                (0, store_js_1.markVideoSeen)(channelId, videoId);
                (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
            }
            else {
                // Network/rate-limit/timeout — set retryableAt for backoff
                (0, unified_log_js_1.devLog)(`[Auto] Download failed (retryable): ${errorMsg}`);
                const retryableAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
                (0, store_js_1.updateWorkspace)(ws.id, { status: 'error', retryableAt });
            }
            broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
            return;
        }
        // Download succeeded — probe aspect ratio to determine if this is a 9:16 vertical video
        const aspect = await (0, ffmpeg_js_1.probeVideoAspect)(result.filePath);
        const fileSizeMB = result.fileSize ? (result.fileSize / 1024 / 1024).toFixed(1) : '?';
        (0, unified_log_js_1.devLog)(`[Auto] DOWNLOADED: "${title}" → ${result.filePath} (${fileSizeMB}MB) ASPECT=${aspect ? aspect.width + 'x' + aspect.height : 'unknown'} ${aspect?.isShort ? '(VERTICAL)' : '(LANDSCAPE)'}`);
        // Skip 9:16 vertical videos — user only wants landscape 16:9 content
        if (aspect?.isShort) {
            (0, unified_log_js_1.devLog)(`[Auto] Skipping 9:16 vertical video: ${title}`);
            try {
                fs_1.default.unlinkSync(result.filePath);
            }
            catch { }
            (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
            broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
            (0, store_js_1.markVideoSeen)(channelId, videoId);
            return;
        }
        const downloadElapsed = ((Date.now() - downloadStartMs) / 1000).toFixed(1);
        (0, unified_log_js_1.devLog)(`[Auto] DOWNLOAD DONE: "${title}" (${downloadElapsed}s, ${fileSizeMB} MB)`);
        playSuccessBeep();
        // Probe actual duration from file (not yt-dlp metadata, which can be stale/wrong).
        // ffprobe reads container metadata in ~100ms — worth the extra call to ensure correct duration.
        const actualDuration = await (0, youtube_js_1.probeActualDuration)(result.filePath);
        const realDuration = actualDuration || result.duration || 0;
        // Phase 1+2: Parallel — thumbnail, video info, trim, and blur ALL run simultaneously.
        // Saves ~15-20s vs sequential execution.
        const thumbnailPath = path_1.default.join(storagePath, `thumb_${ws.id}.jpg`);
        const trimLimitSec = typeof autoTrimLimit === 'number' ? autoTrimLimit * 60 : 0;
        const doTrim = trimLimitSec > 0 && realDuration > trimLimitSec;
        const isLandscape = !aspect?.isShort;
        const { blurPath } = (0, ramdisk_js_1.generateWorkspacePaths)(ws.id);
        // Run ALL post-processing tasks in parallel: thumbnail, info, trim (if needed), blur (if vertical).
        // Landscape videos skip blur (they use thumbnail as background) — saves ~10-15s.
        // Destructured as [thumbResult, videoInfo, trimData, blurResult]
        // CRITICAL: do NOT delete original file here — thumbnail/info read from it in parallel.
        // Delete it AFTER all parallel tasks complete (after Promise.all resolves).
        const [thumbResult, videoInfo, trimData, blurResult] = await Promise.all([
            (0, ffmpeg_js_1.extractVideoThumbnail)(result.filePath, thumbnailPath),
            (0, youtube_js_1.getVideoInfo)('https://www.youtube.com/watch?v=' + videoId),
            // Trim: stream-copy is fast (~1-3s), run in parallel.
            (async () => {
                if (!doTrim)
                    return null;
                const trimmedPath = result.filePath.replace(/(\.\w+)$/, '_trimmed$1');
                const r = await (0, ffmpeg_js_1.trimVideo)(result.filePath, trimmedPath, 0, trimLimitSec);
                if (r.success) {
                    const trimmedSize = fs_1.default.statSync(trimmedPath).size;
                    (0, unified_log_js_1.devLog)(`[Auto] Trim OK (${trimLimitSec}s stream-copy, ${(trimmedSize / 1024 / 1024).toFixed(1)} MB)`);
                    return { path: trimmedPath, size: trimmedSize, duration: trimLimitSec };
                }
                console.warn(`[Auto] Trim failed — using full video`);
                return null;
            })(),
            // Blur: only for vertical videos. Landscape uses thumbnail bg — skip to save ~10-15s.
            (isLandscape ? Promise.resolve({ success: true }) : (0, ffmpeg_js_1.generateBlurBackground)(result.filePath, blurPath, 1080, 1920, realDuration || undefined)),
        ]);
        const realTitle = videoInfo?.title || title;
        const localThumbnail = thumbResult.success
            ? 'local-video:///' + thumbnailPath.replace(/\\/g, '/')
            : (videoInfo?.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`);
        // Short video check: if downloaded video < 60s, mark as error (YouTube Shorts)
        if (realDuration > 0 && realDuration < 60) {
            (0, unified_log_js_1.devLog)(`[Auto] Video too short (${realDuration}s < 60s) — skipping (YouTube Short)`);
            unified_log_js_1.opLog.error('download', `Video too short (${realDuration}s < 60s): ${title}`);
            try {
                fs_1.default.unlinkSync(result.filePath);
            }
            catch { }
            (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
            broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
            sendNotification('error', `Too short: ${title}`, ws.id);
            (0, store_js_1.markVideoSeen)(channelId, videoId);
            return;
        }
        // Determine final file path and size after parallel tasks resolved.
        // If trim succeeded: switch to trimmed file and clean up original.
        let finalFilePath = result.filePath;
        let finalFileSize = result.fileSize || 0;
        let finalDuration = realDuration;
        if (trimData) {
            finalFilePath = trimData.path;
            finalFileSize = trimData.size;
            finalDuration = trimData.duration;
            try {
                fs_1.default.unlinkSync(result.filePath);
            }
            catch { } // clean up original
        }
        // blurBackgroundPath: vertical videos only (landscape uses thumbnail bg)
        const blurBgPath = blurResult.success && !isLandscape ? blurPath : '';
        // ── Pre-scale disabled ────────────────────────────────────────────────────────
        // preScaleVideo() is intentionally NOT called here. GPU scale (scale_cuda) in the
        // render pipeline is fast enough for all sources (<3s). Pre-scaling portrait sources
        // to canvas dimensions corrupts the render (pre-scaled 480x480 gets upscaled to
        // 960x960 then cropped — quality loss). Pre-scaling landscape to portrait dims
        // also corrupts aspect ratio. Let the render pipeline handle all scaling.
        let preScaledPath = '';
        // ── Persist workspace state ──────────────────────────────────────────────────
        // updateWorkspace saves to disk synchronously (makeStorableDownloadedPath strips to basename).
        // getWorkspace reads back with resolveWorkspacePaths → absolute path reconstructed.
        // Return value has resolved preScaledPath + downloadedPath — use these for the render trigger.
        const updatedWs = (0, store_js_1.updateWorkspace)(ws.id, {
            status: 'ready',
            downloadedAt: new Date().toISOString(),
            downloadedPath: finalFilePath,
            fileSize: finalFileSize,
            thumbnail: localThumbnail,
            videoTitle: realTitle,
            duration: finalDuration,
            isShort: aspect?.isShort ?? false,
            videoResolution: aspect ? `${aspect.width}x${aspect.height}` : undefined,
            blurBackgroundPath: blurBgPath,
            preScaledPath,
            downloadQuality: autoQuality,
        });
        broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, updatedWs);
        sendNotification('success', `Auto-ready: ${realTitle}`, ws.id);
        broadcast(channels_js_1.IPC_CHANNELS.AUTO_DOWNLOAD_EVENT, { videoId, title: realTitle, channelName: finalChannelName, detectedAt: detectedAtNow });
        showWindowsToast('✅ Download xong!', `${realTitle}`);
        (0, health_alerts_js_1.recordDownloadSuccess)();
        (0, health_alerts_js_1.recordVideoDetected)();
        broadcast(channels_js_1.IPC_CHANNELS.ACTIVITY_EVENT, {
            id: ws.id,
            timestamp: Date.now(),
            type: 'downloaded',
            title: `Đã tải: ${realTitle.length > 40 ? realTitle.slice(0, 40) + '…' : realTitle}`,
            subtitle: `${finalChannelName} • ${fileSizeMB} MB • ${downloadElapsed}s`,
            workspaceId: ws.id,
        });
        // Auto-render is DISABLED — removed per user request (2026-05-26)
        // if (autoRenderEnabled && !ws.autoRenderAttempted) { ... }
        (0, unified_log_js_1.devLog)(`[Auto] Downloaded — ready (autoRender DISABLED)`);
        // Only mark as seen AFTER successful download — so YouTube processing delay doesn't block retry
        (0, store_js_1.markVideoSeen)(channelId, videoId);
    }
    catch (err) {
        console.error('[Poll] Auto-download error:', err);
    }
}
/**
 * Retry downloading an existing workspace that is 'waiting' or 'error'.
 * Used when the poller detects a video we already have a workspace for.
 */
async function retryAutoDownload(ws) {
    if (!['waiting', 'error'].includes(ws.status))
        return;
    if (inProgressAutoRetries.has(ws.id))
        return;
    inProgressAutoRetries.add(ws.id);
    try {
        await doRetryAutoDownload(ws);
    }
    finally {
        inProgressAutoRetries.delete(ws.id);
    }
}
async function doRetryAutoDownload(ws) {
    const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
    const videoUrl = ws.videoUrl || (ws.videoId ? `https://www.youtube.com/watch?v=${ws.videoId}` : null);
    if (!videoUrl) {
        console.warn(`[Retry] No URL for workspace ${ws.id}`);
        return;
    }
    const settings = (0, ramdisk_js_1.loadSettings)();
    const retryQuality = settings.autoDownloadQuality ?? '720';
    // Export Chrome cookies for yt-dlp authentication (bypasses EJS challenge → enables 1080p VP9)
    const { getYtCookiesFile } = await Promise.resolve().then(() => __importStar(require('./services/po_token.js')));
    const ytCookiesFile = await getYtCookiesFile();
    (0, store_js_1.updateWorkspace)(ws.id, { status: 'downloading', downloadProgress: 0 });
    broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
    let _retryDlLastMs = 0;
    let _retryDlLastPct = -1;
    // downloadVideo delegates to downloadVideoStrategy (web → tv_embedded → ios)
    const result = await (0, youtube_js_1.downloadVideo)({
        workspaceId: ws.id,
        videoUrl,
        outputDir: storagePath,
        trimLimit: ws.trimLimit || 10,
        quality: retryQuality,
        ytCookiesFile,
        onProgress: (progress) => {
            const now = Date.now();
            const pctDelta = Math.abs(progress.percent - _retryDlLastPct);
            if (now - _retryDlLastMs >= 500 || pctDelta >= 2) {
                _retryDlLastMs = now;
                _retryDlLastPct = progress.percent;
                (0, store_js_1.updateWorkspace)(ws.id, { downloadProgress: progress.percent });
                broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
                broadcast(channels_js_1.IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
                    workspaceId: ws.id,
                    percent: progress.percent,
                    speed: progress.speed,
                    eta: progress.eta,
                });
            }
        },
    });
    if (result.success && result.filePath) {
        // Probe actual duration from downloaded file (not yt-dlp metadata, which can be stale)
        const actualDuration = await (0, youtube_js_1.probeActualDuration)(result.filePath);
        // Parallel: thumbnail + video info run simultaneously
        const thumbPath = path_1.default.join(storagePath, `thumb_${ws.id}.jpg`);
        const [thumbResult, videoInfo] = await Promise.all([
            (0, ffmpeg_js_1.extractVideoThumbnail)(result.filePath, thumbPath),
            (0, youtube_js_1.getVideoInfo)(videoUrl),
        ]);
        const realDuration = actualDuration || videoInfo?.duration || 0;
        const localThumbnail = thumbResult.success
            ? 'local-video:///' + thumbPath.replace(/\\/g, '/')
            : (videoInfo?.thumbnail || `https://img.youtube.com/vi/${ws.videoId}/mqdefault.jpg`);
        const aspect = await (0, ffmpeg_js_1.probeVideoAspect)(result.filePath);
        // Skip 9:16 vertical videos — user only wants landscape 16:9 content
        if (aspect?.isShort) {
            (0, unified_log_js_1.devLog)(`[Retry] Skipping 9:16 vertical video: ${ws.videoTitle}`);
            unified_log_js_1.opLog.error('download', `9:16 vertical video skipped: ${ws.videoTitle}`);
            try {
                fs_1.default.unlinkSync(result.filePath);
            }
            catch { }
            (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
            broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
            sendNotification('error', `9:16 vertical: ${ws.videoTitle}`, ws.id);
            (0, store_js_1.markVideoSeen)(ws.channelId, ws.videoId);
            return;
        }
        // Short video check
        if (realDuration > 0 && realDuration < 60) {
            (0, unified_log_js_1.devLog)(`[Retry] Video too short (${realDuration}s < 60s) — skipping (YouTube Short)`);
            unified_log_js_1.opLog.error('download', `Video too short (${realDuration}s < 60s): ${ws.videoTitle}`);
            try {
                fs_1.default.unlinkSync(result.filePath);
            }
            catch { }
            (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
            broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
            sendNotification('error', `Too short: ${ws.videoTitle}`, ws.id);
            (0, store_js_1.markVideoSeen)(ws.channelId, ws.videoId);
            return;
        }
        // Parallel: trim + blur (if vertical). Landscape skips blur.
        const isLandscape = !aspect?.isShort;
        const { blurPath } = (0, ramdisk_js_1.generateWorkspacePaths)(ws.id);
        const trimLimitSec = typeof ws.trimLimit === 'number' ? ws.trimLimit * 60 : 0;
        const doTrim = trimLimitSec > 0 && realDuration > trimLimitSec;
        const [trimResult, blurResult] = await Promise.all([
            (async () => {
                if (!doTrim)
                    return null;
                const trimmedPath = result.filePath.replace(/(\.\w+)$/, '_trimmed$1');
                const r = await (0, ffmpeg_js_1.trimVideo)(result.filePath, trimmedPath, 0, trimLimitSec);
                if (r.success) {
                    const trimmedSize = fs_1.default.statSync(trimmedPath).size;
                    (0, unified_log_js_1.devLog)(`[Retry] Trim OK (${trimLimitSec}s, ${(trimmedSize / 1024 / 1024).toFixed(1)} MB)`);
                    return { path: trimmedPath, size: trimmedSize, duration: trimLimitSec };
                }
                return null;
            })(),
            // Blur: only for vertical videos. Landscape uses thumbnail bg — skip.
            (isLandscape ? Promise.resolve({ success: true }) : (0, ffmpeg_js_1.generateBlurBackground)(result.filePath, blurPath, 1080, 1920, realDuration || undefined)),
        ]);
        let finalFilePath = result.filePath;
        let finalFileSize = result.fileSize || 0;
        let finalDuration = realDuration;
        if (trimResult) {
            finalFilePath = trimResult.path;
            finalFileSize = trimResult.size;
            finalDuration = trimResult.duration;
            try {
                fs_1.default.unlinkSync(result.filePath);
            }
            catch { }
        }
        // blurBackgroundPath: vertical videos only (landscape uses thumbnail bg)
        const blurBgPath = blurResult.success && !isLandscape ? blurPath : '';
        (0, store_js_1.updateWorkspace)(ws.id, {
            status: 'ready',
            downloadedAt: new Date().toISOString(),
            downloadedPath: finalFilePath,
            fileSize: finalFileSize,
            thumbnail: localThumbnail,
            videoTitle: videoInfo?.title || ws.videoTitle,
            duration: finalDuration,
            isShort: aspect?.isShort ?? false,
            blurBackgroundPath: blurBgPath,
            downloadQuality: retryQuality,
        });
        broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
        sendNotification('success', `Auto-ready (retry): ${ws.videoTitle}`, ws.id);
        showWindowsToast('✅ Retry xong!', `${ws.videoTitle}`);
        (0, store_js_1.markVideoSeen)(ws.channelId, ws.videoId);
    }
    else {
        const errorMsg = result.error || '';
        const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('video unavailable') || errorMsg.includes('not found');
        const isPrivate = errorMsg.includes('private video');
        if (isPrivate) {
            // All clients failed with private → genuinely inaccessible
            (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
        }
        else if (isNotAvailable) {
            (0, store_js_1.updateWorkspace)(ws.id, { status: 'error' });
        }
        else {
            // Still retryable — stay in waiting with next retryableAt
            (0, store_js_1.updateWorkspace)(ws.id, { status: 'waiting', retryableAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
        }
        broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(ws.id));
    }
}
// ─── Auto-render catch-up on startup ────────────────────────────────────────────
// Finds 'ready' workspaces where auto-render was never triggered (e.g., autoRender
// was disabled at download time, or workspace was created before the feature existed).
// Triggers auto-render for each one — so nothing slips through the cracks.
function triggerAutoRenderForReadyWorkspaces() {
    // Auto-render is DISABLED — removed per user request (2026-05-26)
}
// ─── Scan existing downloaded files on startup ────────────────────────────────────
// Finds any video files in the storage directory that were downloaded previously
// (either by HyperClip or manually placed there) and registers them as "seen"
// so the poll won't re-download them.
function scanExistingDownloadedFiles() {
    // Scan both new persistent path AND legacy temp path (for backwards compat)
    const pathsToScan = [
        (0, ramdisk_js_1.getVideoStoragePath)(),
        path_1.default.join(os_1.default.tmpdir(), 'hyperclip-video'), // legacy path
    ];
    const seen = new Set();
    let totalRegistered = 0;
    for (const storagePath of pathsToScan) {
        try {
            if (!fs_1.default.existsSync(storagePath))
                continue;
            const files = fs_1.default.readdirSync(storagePath).filter(f => f.endsWith('.mp4'));
            if (files.length === 0)
                continue;
            (0, unified_log_js_1.devLog)(`[HyperClip] Scanning ${files.length} file(s) in ${storagePath}`);
            for (const file of files) {
                // Pattern: ws-{timestamp}-{random}_{videoId}.mp4
                const match = file.match(/^ws-\d+-[a-z0-9]+_(.+)\.mp4$/);
                if (match && !seen.has(match[1])) {
                    const videoId = match[1];
                    seen.add(videoId);
                    const channels = (0, store_js_1.getChannels)();
                    for (const ch of channels) {
                        if (ch.channelId)
                            (0, store_js_1.markVideoSeen)(ch.channelId, videoId);
                    }
                    totalRegistered++;
                }
            }
        }
        catch (e) {
            console.warn(`[HyperClip] scanExistingDownloadedFiles failed for ${storagePath}:`, e);
        }
    }
    if (totalRegistered > 0) {
        (0, unified_log_js_1.devLog)(`[HyperClip] Registered ${totalRegistered} existing file(s) as "seen"`);
    }
}
// ─── Channel ID Resolution ─────────────────────────────────────────────────────────
// Resolves YouTube handle (@channel) to channelId (UC...) for subscription feed fallback.
// Called at startup ONLY for channels that NEED resolution (missing/invalid channelId).
// Channels with already-valid channelIds are skipped entirely — no HTTP calls needed.
async function resolveChannelIdsForPoll() {
    const channels = (0, store_js_1.getChannels)();
    let resolved = 0;
    let skipped = 0;
    for (const ch of channels) {
        // Skip if already has a valid channelId — no verification needed
        if (ch.channelId && isValidChannelId(ch.channelId)) {
            skipped++;
            continue;
        }
        // Build URL to resolve missing/invalid channelId
        let resolveUrl = '';
        let strategy = '';
        if (ch.handle && ch.handle.startsWith('@')) {
            const handlePart = ch.handle.slice(1);
            if (/^UC[a-zA-Z0-9_-]{22}$/.test(handlePart)) {
                // Corrupted handle: @UCxxx is actually a channelId (not valid UC format)
                resolveUrl = `https://www.youtube.com/channel/${handlePart}`;
                strategy = 'handle→channelId';
            }
            else {
                resolveUrl = `https://www.youtube.com${ch.handle}`;
                strategy = 'handle';
            }
        }
        if (!resolveUrl) {
            console.warn(`[Channel] "${ch.name}": no resolvable URL (handle=${ch.handle || 'none'}, channelId=${ch.channelId || 'none'}, id=${ch.id})`);
            skipped++;
            continue;
        }
        try {
            const info = await (0, youtube_js_1.getChannelInfo)(resolveUrl);
            if (info && info.channelId && info.channelId.startsWith('UC') && info.channelId.length >= 24) {
                (0, unified_log_js_1.devLog)(`[Channel] Resolved "${ch.name}" [${strategy}]: ${info.channelId}`);
                (0, store_js_1.updateChannel)(ch.id, { channelId: info.channelId, name: info.channelName || ch.name });
                resolved++;
            }
            else if (info && !info.channelId) {
                console.warn(`[Channel] Could not resolve "${ch.name}" via ${strategy} — no channelId from ${resolveUrl}`);
                skipped++;
            }
            else if (!info) {
                console.warn(`[Channel] Failed to fetch "${ch.name}" via ${strategy}: ${resolveUrl}`);
                skipped++;
            }
        }
        catch (e) {
            console.warn(`[Channel] Resolution error for "${ch.name}":`, e);
            skipped++;
        }
    }
    (0, unified_log_js_1.devLog)(`[Channel] Resolution: ${resolved} resolved, ${skipped} skipped (${channels.length - resolved - skipped} verified)`);
    (0, subscription_feed_js_1.refreshChannelCache)();
}
function isValidChannelId(id) {
    // Real YouTube channel IDs: UC prefix + 22 base64 chars = 24 chars total
    return /^(UC[a-zA-Z0-9_-]{22})$/.test(id);
}
// ─── Port checker ───────────────────────────────────────────────────────────────
function isPortOpen(port) {
    return new Promise((resolve) => {
        const req = http_1.default.get(`http://localhost:${port}`, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}
// ─── Next.js server ────────────────────────────────────────────────────────────
function startNextServer() {
    // In packaged app:
    //   - app is unpacked (asar: false), all files in resources/app/
    //   - Next.js bin: resources/app/node_modules/next/dist/bin/next
    //   - cwd must be resources/app/ so Next.js finds .next/ in current dir
    const appUnpacked = electron_1.app.isPackaged
        ? path_1.default.join(process.resourcesPath, 'app')
        : path_1.default.join(__dirname, '..');
    const nextBin = path_1.default.join(appUnpacked, 'node_modules', 'next', 'dist', 'bin', 'next');
    (0, unified_log_js_1.devLog)(`[HyperClip] Next.js bin: ${nextBin}`);
    (0, unified_log_js_1.devLog)(`[HyperClip] Next.js exists: ${fs_1.default.existsSync(nextBin)}`);
    (0, unified_log_js_1.devLog)(`[HyperClip] cwd: ${appUnpacked}`);
    let startupResolve = null;
    return new Promise((resolve) => {
        startupResolve = resolve;
        // Find node executable — priority: bundled > system PATH
        // Bundled: resources/node/node.exe (shipped in installer)
        // System: fallback to whatever "node" resolves to in PATH
        let nodeExe = 'node';
        const bundledNode = electron_1.app.isPackaged && process.resourcesPath
            ? path_1.default.join(process.resourcesPath, 'node', 'node.exe')
            : '';
        if (bundledNode && fs_1.default.existsSync(bundledNode)) {
            nodeExe = bundledNode;
        }
        else {
            try {
                const { execSync } = require('child_process');
                const result = execSync('where node', { timeout: 5000, encoding: 'utf-8' });
                const firstPath = result.trim().split('\n')[0];
                if (firstPath && fs_1.default.existsSync(firstPath))
                    nodeExe = firstPath;
            }
            catch { }
        }
        (0, unified_log_js_1.devLog)(`[HyperClip] node executable: ${nodeExe}`);
        nextServer = (0, child_process_1.spawn)(nodeExe, [nextBin, '-p', String(NEXT_PORT)], {
            cwd: appUnpacked,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PATH: (process.env.PATH || '') + path_1.default.delimiter + path_1.default.dirname(process.execPath), PORT: String(NEXT_PORT) },
        });
        nextServerOwned = true;
        (0, unified_log_js_1.devLog)(`[HyperClip] Booting Next.js on port ${NEXT_PORT}...`);
        nextServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`[HyperClip] Port ${NEXT_PORT} is already in use. Set HYPERCLIP_PORT env var to use a different port.`);
                console.error('[HyperClip] Example: HYPERCLIP_PORT=3001 npm run electron:dev');
                process.exit(1);
            }
            console.error('[HyperClip] Next.js server error:', err.message);
        });
        nextServer.on('exit', (code, signal) => {
            console.error(`[HyperClip] Next.js process exited: code=${code} signal=${signal}`);
            if (startupResolve) {
                startupResolve = null;
            }
        });
        // Production Next.js outputs "✓ Ready" on stdout and "▲ Next.js" on stderr.
        // Also catch "compiled" as a late signal the app is serving.
        const readyPatternsStdout = ['Ready', 'ready', 'started server', 'Server running', 'compiled'];
        const readyPatternsStderr = ['Local:', 'Ready on', '▲ Next.js', 'compiled', 'starting server'];
        nextServer.stdout?.on('data', (data) => {
            const text = data.toString();
            process.stdout.write('[Next.js] ' + text);
            if (readyPatternsStdout.some(p => text.includes(p))) {
                (0, unified_log_js_1.devLog)(`[HyperClip] Next.js stdout signal → http://localhost:${NEXT_PORT}`);
                if (startupResolve) {
                    startupResolve();
                    startupResolve = null;
                }
            }
        });
        nextServer.stderr?.on('data', (data) => {
            const text = data.toString();
            process.stderr.write('[Next.js] ' + text);
            if (readyPatternsStderr.some(p => text.includes(p))) {
                (0, unified_log_js_1.devLog)(`[HyperClip] Next.js stderr signal → http://localhost:${NEXT_PORT}`);
                if (startupResolve) {
                    startupResolve();
                    startupResolve = null;
                }
            }
        });
        // 30s safety timeout — proceed after timeout if server is still starting
        setTimeout(() => {
            if (startupResolve) {
                console.warn('[HyperClip] Next.js startup timeout — proceeding anyway');
                startupResolve();
                startupResolve = null;
            }
        }, 30000);
    });
}
// ─── Window ────────────────────────────────────────────────────────────────────
function getPreloadPath() {
    return path_1.default.join(__dirname, 'preload.js');
}
async function createWindow() {
    // Icon path: packaged → resources/build/icon.ico, dev → build/icon.ico
    const iconBase = electron_1.app.isPackaged
        ? process.resourcesPath
        : path_1.default.join(__dirname, '..');
    const iconPath = path_1.default.join(iconBase, 'build', 'icon.ico');
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        backgroundColor: '#121212',
        title: 'HyperClip',
        icon: iconPath,
        webPreferences: {
            preload: getPreloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
        },
        show: false,
        frame: true,
    });
    // Wire unified log to renderer for live streaming
    (0, unified_log_js_1.setLogWindow)(mainWindow);
    // Show customer-facing console window (always-on-top, bottom-right)
    (0, console_window_js_1.createConsoleWindow)();
    void mainWindow.loadURL(`http://localhost:${NEXT_PORT}`);
    // Retry load if initial attempt fails (server might still be warming up)
    let loadRetries = 0;
    const maxRetries = 5;
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        loadRetries++;
        console.warn(`[HyperClip] Load failed (attempt ${loadRetries}): ${errorDescription} (${errorCode})`);
        if (loadRetries <= maxRetries) {
            setTimeout(() => {
                (0, unified_log_js_1.devLog)(`[HyperClip] Retrying load (attempt ${loadRetries + 1}/${maxRetries + 1})...`);
                void mainWindow?.webContents.loadURL(`http://localhost:${NEXT_PORT}`);
            }, 2000);
        }
    });
    mainWindow.webContents.on('did-finish-load', () => {
        (0, unified_log_js_1.devLog)(`[HyperClip] Window loaded successfully`);
    });
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    mainWindow.on('close', (e) => {
        if (_isQuitting)
            return;
        if ((0, ramdisk_js_1.loadSettings)().quitOnClose !== false) {
            // quitOnClose=true (default): actually quit
            e.preventDefault();
            _isQuitting = true;
            void quitAll();
        }
        else {
            // Legacy: minimize to tray instead of quitting
            e.preventDefault();
            mainWindow?.hide();
        }
    });
}
// ─── Tray icon helper ─────────────────────────────────────────────────────────
// Creates a 16x16 tray icon: dark rounded square with blue play triangle
// Matches the sidebar logo design
function createBlueIcon() {
    const W = 16, H = 16;
    const rowLen = 1 + W * 4;
    // RGBA pixel buffer (filter byte + pixels per row)
    const raw = Buffer.alloc(H * rowLen);
    for (let i = 0; i < raw.length; i++)
        raw[i] = 0;
    const bgR = 13, bgG = 13, bgB = 13; // #0D0D0D dark
    const fgR = 0, fgG = 180, fgB = 255; // #00B4FF blue
    function setPixel(x, y, r, g, b, a) {
        if (x < 0 || x >= W || y < 0 || y >= H)
            return;
        const i = y * rowLen + 1 + x * 4;
        raw[i] = r;
        raw[i + 1] = g;
        raw[i + 2] = b;
        raw[i + 3] = a;
    }
    // Fill background (all opaque)
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            // Skip rounded corners (3px radius)
            const dx = Math.min(x, W - 1 - x);
            const dy = Math.min(y, H - 1 - y);
            if (dx < 3 && dy < 3 && dx + dy < 3)
                continue;
            setPixel(x, y, bgR, bgG, bgB, 255);
        }
    }
    // Play triangle (▶) — filled blue
    // y=3..13 centered at y=8, tip right, base left
    // Each entry: [rowY, xLeft, xRight]
    const rows = [
        [3, 5, 7], [4, 4, 9], [5, 4, 10], [6, 4, 11],
        [7, 3, 12], [8, 3, 13], [9, 4, 12],
        [10, 4, 11], [11, 4, 10], [12, 4, 9], [13, 5, 7],
    ];
    for (const [y, x1, x2] of rows) {
        for (let x = x1; x <= x2; x++)
            setPixel(x, y, fgR, fgG, fgB, 255);
    }
    // Build PNG
    function chunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const crcB = Buffer.alloc(4);
        crcB.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0);
        return Buffer.concat([len, Buffer.from(type, 'ascii'), data, crcB]);
    }
    const crcTbl = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTbl[n] = c;
    }
    function crc32(buf) {
        let crc = 0xffffffff;
        for (let i = 0; i < buf.length; i++)
            crc = crcTbl[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
        return crc ^ 0xffffffff;
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const compressed = zlib_1.default.deflateSync(raw);
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', compressed),
        chunk('IEND', Buffer.alloc(0)),
    ]);
    return electron_1.nativeImage.createFromBuffer(png);
}
// ─── System tray ──────────────────────────────────────────────────────────────
function createTray() {
    const iconPath = path_1.default.join(process.resourcesPath || __dirname, 'resources', 'icon.png');
    let trayIcon;
    try {
        trayIcon = electron_1.nativeImage.createFromPath(iconPath);
        if (trayIcon.isEmpty()) {
            // Fallback: create a 16x16 blue icon programmatically
            trayIcon = createBlueIcon();
        }
    }
    catch {
        trayIcon = createBlueIcon();
    }
    tray = new electron_1.Tray(trayIcon);
    const contextMenu = electron_1.Menu.buildFromTemplate([
        { label: 'Show HyperClip', click: () => mainWindow?.show() },
        { type: 'separator' },
        { label: 'Quick Add Tracker', click: () => mainWindow?.webContents.send('quick-add') },
        { type: 'separator' },
        { label: 'Quit', click: () => { void quitAll(); } },
    ]);
    tray.setToolTip('HyperClip — Auto-Render');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow?.show());
}
// ─── Broadcast helpers ─────────────────────────────────────────────────────────
// Delegates to the shared state module so extracted handlers stay in sync.
function broadcast(channel, data) { void (0, ipc_state_js_1.broadcast)(channel, data); }
function sendNotification(type, message, workspaceId) { void (0, ipc_state_js_1.sendNotification)(type, message, workspaceId); }
// ─── Audio notification ────────────────────────────────────────────────────────────
function playSuccessBeep() {
    // Distinct double-chime on download complete — loud enough to cut through background noise
    if (process.platform === 'win32') {
        Promise.resolve().then(() => __importStar(require('child_process'))).then(({ spawn }) => {
            // Exclamation is louder than Asterisk; play twice for emphasis
            spawn('powershell', [
                '-c',
                'Add-Type -AssemblyName System.Media; 1..2 | ForEach-Object { [System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 350 }'
            ], { stdio: 'ignore' });
        }).catch(() => { });
    }
}
// ─── Windows Toast Notification ──────────────────────────────────────────────────
// Shows a native Windows 10/11 Action Center notification.
// Works even when app is in background/tray — independent of renderer window.
function showWindowsToast(title, body) {
    if (process.platform !== 'win32')
        return;
    Promise.resolve().then(() => __importStar(require('child_process'))).then(({ spawn }) => {
        const escapedTitle = title.replace(/"/g, '`"');
        const escapedBody = body.replace(/`/g, '``').replace(/"/g, '`"');
        const script = [
            `try {`,
            `  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null`,
            `  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null`,
            `  $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()`,
            `  $xml.LoadXml('<toast launch="hyperclip"><visual><binding template="ToastGeneric"><text>${escapedTitle}</text><text>${escapedBody}</text></binding></visual></toast>')`,
            `  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)`,
            `  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("HyperClip").Show($toast)`,
            `} catch { }`,
        ].join('; ');
        spawn('powershell', ['-c', script], { stdio: 'ignore' });
    }).catch(() => { });
}
// ─── Auto-cleanup runs on startup ─────────────────────────────────────────────────
;
(() => {
    const cleanupDays = (0, ramdisk_js_1.loadSettings)().downloadsCleanupDays ?? 7;
    if (cleanupDays <= 0)
        return;
    try {
        const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
        const cutoff = Date.now() - cleanupDays * 24 * 60 * 60 * 1000;
        const workspaces = (0, store_js_1.getWorkspaces)();
        const activeIds = new Set(workspaces.map(w => w.id));
        const activeWsId = (0, ipc_state_js_1.getActiveWorkspaceId)();
        if (activeWsId)
            activeIds.add(activeWsId);
        let cleaned = 0;
        for (const entry of fs_1.default.readdirSync(storagePath)) {
            if (entry.startsWith('blur_'))
                continue;
            const ext = path_1.default.extname(entry).toLowerCase();
            if (!['.mp4', '.mkv', '.webm', '.avi', '.mov'].includes(ext))
                continue;
            const entryBase = entry.replace(/\.\w+$/, '');
            const isActive = Array.from(activeIds).some(id => entryBase.startsWith(id + '_') || entryBase === id);
            if (isActive)
                continue;
            const fullPath = path_1.default.join(storagePath, entry);
            try {
                const stat = fs_1.default.statSync(fullPath);
                if (stat.mtimeMs < cutoff) {
                    fs_1.default.unlinkSync(fullPath);
                    cleaned++;
                }
            }
            catch { }
        }
        if (cleaned > 0)
            (0, unified_log_js_1.devLog)(`[AutoCleanup] Removed ${cleaned} old video files`);
    }
    catch { }
})();
// Relay auth status changes to renderer (registered at module load — catches early OAuth events)
cookie_manager_js_1.authEvents.on('authUpdated', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channels_js_1.IPC_CHANNELS.AUTH_UPDATE_EVENT, status);
    }
});
// Cookie critical failure → redirect renderer to login screen
cookie_manager_js_1.authEvents.on('cookieCritical', (errorMsg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        (0, unified_log_js_1.devLog)(`[HyperClip] Cookie critical failure: ${errorMsg} — redirecting to login`);
        mainWindow.webContents.send(channels_js_1.IPC_CHANNELS.AUTH_COOKIE_CRITICAL, errorMsg);
        // Navigate to settings/login page
        mainWindow.webContents.send('navigate', '/settings');
    }
});
// Relay channel sync events so frontend re-fetches channel list
cookie_manager_js_1.channelEvents.on('channelsSynced', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channels_js_1.IPC_CHANNELS.CHANNEL_SYNCED_EVENT, null);
    }
});
// ─── System monitor ────────────────────────────────────────────────────────────
function startSystemMonitor() {
    // 5s interval: GPU/RAM stats don't need sub-second resolution.
    // 24/7 app: this saves ~30k calls/day vs 2s interval.
    setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        const stats = (0, system_js_1.collectSystemStats)();
        mainWindow.webContents.send(channels_js_1.IPC_CHANNELS.SYSTEM_STATS_EVENT, stats);
        // Resource watchdog: notify on high RAM/GPU
        const alert = (0, system_js_2.checkResourceAlert)();
        if (alert.level !== 'normal') {
            const notifType = alert.level === 'critical' ? 'error' : 'warning';
            sendNotification(notifType, `[Resource] ${alert.reason}`);
        }
    }, 5000);
}
// ─── Shutdown ─────────────────────────────────────────────────────────────────
async function quitAll() {
    (0, console_window_js_1.setConsoleWindowQuit)(true);
    await (0, youtube_poller_js_1.stopYouTubePoller)();
    (0, worker_pool_js_1.cancelAllFfmpeg)();
    (0, ffmpeg_js_1.cancelAllChunked)();
    (0, cdp_js_1.killPersistentChrome)();
    renderQueue.forEach(job => job.resolve({ success: false, error: 'App shutting down' }));
    renderQueue.length = 0;
    if (nextServerOwned && nextServer)
        nextServer.kill();
    (0, token_manager_js_1.getTokenManager)().dispose();
    // Destroy tray icon FIRST — Windows keeps tray icon alive until explicitly destroyed.
    // If we call app.quit() before tray.destroy(), the icon stays in the system tray.
    if (tray) {
        tray.destroy();
        tray = null;
    }
    mainWindow?.destroy();
    (0, console_window_js_1.destroyConsoleWindow)();
    electron_1.app.quit();
}
// ─── Bootstrap ────────────────────────────────────────────────────────────────
(0, ramdisk_js_1.ensureStorageDirs)();
// Auto-cleanup old logs (>7 days) on startup
const cleanup = (0, unified_log_js_1.cleanupOldLogs)();
if (cleanup.deletedCount > 0) {
    const freedMB = (cleanup.freedBytes / 1024 / 1024).toFixed(1);
    (0, unified_log_js_1.devLog)(`[LogCleanup] Removed ${cleanup.deletedCount} old log file(s), freed ${freedMB} MB`);
}
void electron_1.app.whenReady().then(async () => {
    (0, unified_log_js_1.devLog)('[HyperClip] Starting...');
    // Auto-migrate: if legacy AppData\Roaming\HyperClip exists, move it to the new base dir.
    {
        const legacy = (0, paths_js_1.getLegacyDataPath)();
        const legacyMarker = path_1.default.join((0, paths_js_1.getHyperClipBaseDir)(), '.legacy-migrated');
        if (legacy && !fs_1.default.existsSync(legacyMarker)) {
            (0, unified_log_js_1.devLog)(`[Migration] Found legacy data at ${legacy}, migrating to ${(0, paths_js_1.getHyperClipBaseDir)()}...`);
            try {
                const dest = (0, paths_js_1.getAppStoreDir)();
                if (!fs_1.default.existsSync(dest))
                    fs_1.default.mkdirSync(dest, { recursive: true });
                const files = fs_1.default.readdirSync(legacy);
                for (const file of files) {
                    const src = path_1.default.join(legacy, file);
                    const dst = path_1.default.join(dest, file);
                    if (!fs_1.default.existsSync(dst)) {
                        fs_1.default.renameSync(src, dst);
                    }
                }
                fs_1.default.writeFileSync(legacyMarker, JSON.stringify({ migratedAt: Date.now(), legacyPath: legacy }), 'utf-8');
                (0, unified_log_js_1.devLog)(`[Migration] App data migrated to ${dest}`);
                // Also migrate Chrome profiles: AppData\Local\HyperClip-Chrome-Profile-* → chrome-profiles\profile-*
                const LOCALAPPDATA = process.env.LOCALAPPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Local');
                const chromeProfilesDest = path_1.default.join((0, paths_js_1.getHyperClipBaseDir)(), 'chrome-profiles');
                let migratedProfiles = 0;
                for (let i = 1; i <= 30; i++) {
                    const srcProfile = path_1.default.join(LOCALAPPDATA, `HyperClip-Chrome-Profile-${i}`);
                    const dstProfile = path_1.default.join(chromeProfilesDest, `profile-${i}`, 'Default');
                    if (fs_1.default.existsSync(srcProfile) && !fs_1.default.existsSync(dstProfile)) {
                        try {
                            fs_1.default.mkdirSync(path_1.default.dirname(dstProfile), { recursive: true });
                            const items = fs_1.default.readdirSync(srcProfile);
                            for (const item of items) {
                                fs_1.default.renameSync(path_1.default.join(srcProfile, item), path_1.default.join(dstProfile, item));
                            }
                            migratedProfiles++;
                        }
                        catch (e) {
                            console.warn(`[Migration] Chrome profile ${i} migration failed:`, e);
                        }
                    }
                }
                if (migratedProfiles > 0) {
                    (0, unified_log_js_1.devLog)(`[Migration] Migrated ${migratedProfiles} Chrome profiles to ${chromeProfilesDest}`);
                }
                sendNotification('info', `HyperClip đã chuyển dữ liệu sang ổ D để giảm tải ổ C.`);
            }
            catch (e) {
                console.warn('[Migration] Failed:', e);
            }
        }
    }
    // P0: Run system diagnostics — check all prerequisites and alert user to issues
    const diag = await (0, diagnostics_js_1.runDiagnostics)();
    if (!diag.overall.ready) {
        console.warn('[HyperClip] Diagnostics issues:');
        for (const issue of diag.overall.issues) {
            console.warn('  -', issue);
        }
        sendNotification('warning', `Có vấn đề: ${diag.overall.issues[0]}. Xem Settings → Diagnostics để biết thêm.`);
    }
    else {
        (0, unified_log_js_1.devLog)('[HyperClip] Diagnostics: All prerequisites OK');
    }
    // P0: Hardware-aware performance profile log
    const caps = (0, system_js_1.getGPUCapabilities)();
    const profile = (0, system_js_1.detectSystemProfile)();
    (0, unified_log_js_1.devLog)(`[HyperClip] Performance profile: GPU=${caps.gpuName} [${caps.encoder}] tier=${caps.tier} workers=${caps.maxChunkWorkers} sessions=${profile.sessionCount} RAM=${profile.isLaptop ? 'laptop' : 'desktop'}`);
    // Validate FFmpeg hardware encoder (separate from existence check)
    const ffmpegPath = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    if (diag.ffmpeg.ok && !diag.ffmpeg.hasNvenc) {
        console.warn('[HyperClip] FFmpeg found but no NVENC hardware encoder — rendering will use CPU (slow).');
        sendNotification('info', 'FFmpeg không có NVENC — render sẽ chậm. Khuyến nghị FFmpeg build có hỗ trợ NVIDIA NVENC.');
    }
    // NVDEC + CUDA filter pipeline status: required for fast GPU-accelerated rendering.
    // NVDEC = hardware video decode (GPU, not CPU). CUDA filters = scale/crop/overlay on GPU.
    // Without these: software decode + CPU filter pipeline = 10-20x slower renders.
    const nvDecStatus = diag.ffmpeg.hasNvdec
        ? `✓ NVDEC (GPU decode) — ${caps.gpuName}`
        : '✗ Không có NVDEC (software decode)';
    const cudaFilterStatus = diag.ffmpeg.hasCudaFilters
        ? '✓ CUDA filters (GPU scale/crop/overlay)'
        : '✗ Không có CUDA filters (CPU filter pipeline)';
    (0, unified_log_js_1.devLog)(`[HyperClip] FFmpeg pipeline: ${nvDecStatus}`);
    (0, unified_log_js_1.devLog)(`[HyperClip] FFmpeg pipeline: ${cudaFilterStatus}`);
    if (diag.ffmpeg.ok && (!diag.ffmpeg.hasNvdec || !diag.ffmpeg.hasCudaFilters)) {
        console.warn('[HyperClip] RENDER: CPU decode + CPU filter + NVENC GPU encode (không có NVDEC/CUDA filters)');
        sendNotification('info', `Render: CPU decode + CPU filter + NVENC GPU encode. CÀI FFmpeg build có NVDEC để render nhanh hơn.`);
    }
    // P2: RAM disk not available
    if (!diag.storage.ramDiskAvailable) {
        (0, unified_log_js_1.devLog)('[HyperClip] RAM disk not available — videos will be stored on disk (slower I/O).');
        sendNotification('info', 'RAM disk chưa bật — video sẽ lưu ổ C (chậm hơn RAM disk). Có thể bỏ qua nếu không cần tốc độ cao.');
    }
    // Setup: copy Arial font to resources/fonts/ for FFmpeg drawtext (lavfi requires no `:` in fontfile paths).
    // FFmpeg gyan.dev lavfi parser splits option values at COLON characters (drive letter `D:`).
    // Using a relative path `resources/fonts/arial.ttf` avoids this issue entirely.
    // Additionally, create fontconfig config so FFmpeg can find the font via fontfile=arial.ttf.
    {
        const fontsDir = path_1.default.join(__dirname, '..', 'resources', 'fonts');
        const fontPath = path_1.default.join(fontsDir, 'arial.ttf');
        // Also create fontconfig at D:\fonts\fonts.conf for FONTCONFIG_FILE env var
        const fcDir = 'D:\\fonts';
        const fcPath = path_1.default.join(fcDir, 'fonts.conf');
        const fcXml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontsDir.replace(/\\/g, '\\\\')}</dir>
  <dir>${fcDir.replace(/\\/g, '\\\\')}</dir>
</fontconfig>
`;
        if (!fs_1.default.existsSync(fontPath)) {
            try {
                fs_1.default.mkdirSync(fontsDir, { recursive: true });
                const systemFont = 'C:\\Windows\\Fonts\\arial.ttf';
                if (fs_1.default.existsSync(systemFont)) {
                    fs_1.default.copyFileSync(systemFont, fontPath);
                    (0, unified_log_js_1.devLog)(`[Setup] Copied Arial font to ${fontPath}`);
                }
                else {
                    (0, unified_log_js_1.devLog)(`[Setup] System Arial font not found at ${systemFont} — text overlays may fail`);
                }
            }
            catch (e) {
                (0, unified_log_js_1.devLog)(`[Setup] Font copy failed: ${e}`);
            }
        }
        else {
            (0, unified_log_js_1.devLog)(`[Setup] Arial font already present at ${fontPath}`);
        }
    }
    // Auto-boot Next.js if not already running on port 3000
    const nextRunning = await isPortOpen(NEXT_PORT);
    if (nextRunning) {
        (0, unified_log_js_1.devLog)(`[HyperClip] Next.js already running on port ${NEXT_PORT}`);
    }
    else {
        await startNextServer();
    }
    // Poll HTTP until server responds (handles cases where port is open but
    // Next.js hasn't finished compiling yet, especially in production).
    (0, unified_log_js_1.devLog)(`[HyperClip] Waiting for Next.js HTTP server on port ${NEXT_PORT}...`);
    const http = await Promise.resolve().then(() => __importStar(require('http')));
    await new Promise((resolve) => {
        let attempts = 0;
        const timeout = setTimeout(() => {
            console.warn(`[HyperClip] HTTP check timeout after ${attempts} attempts — proceeding anyway`);
            resolve();
        }, 30000);
        const check = () => {
            attempts++;
            const req = http.get(`http://localhost:${NEXT_PORT}`, (res) => {
                clearTimeout(timeout);
                (0, unified_log_js_1.devLog)(`[HyperClip] Next.js HTTP server confirmed (status ${res.statusCode}) after ${attempts} attempt(s)`);
                res.resume();
                resolve();
            });
            req.on('error', (err) => {
                if (attempts % 10 === 0) {
                    (0, unified_log_js_1.devLog)(`[HyperClip] HTTP check attempt ${attempts}: ${err.message}`);
                }
                setTimeout(check, 1000);
            });
            req.setTimeout(5000, () => {
                req.destroy();
                if (attempts % 10 === 0) {
                    (0, unified_log_js_1.devLog)(`[HyperClip] HTTP check attempt ${attempts}: timeout, retrying...`);
                }
            });
        };
        check();
    });
    // Register local-video:// protocol to serve downloaded video files to renderer.
    // Chromium blocks file:// URLs in <video src> — this bypasses that restriction.
    // URL format: local-video:///C:/path/to/file.mp4 (THREE slashes, forward slashes).
    // Uses registerFileProtocol: passes the file path to Chromium, which reads the file directly.
    electron_1.protocol.registerFileProtocol('local-video', (request, callback) => {
        let filePath = request.url.replace(/^local-video:\/\/?\/?/, '');
        if (filePath.startsWith('/'))
            filePath = filePath.slice(1);
        filePath = decodeURIComponent(filePath);
        const isAbsolute = /^[A-Z]:\\/i.test(filePath) || filePath.startsWith('\\');
        const absPath = isAbsolute ? path_1.default.normalize(filePath) : path_1.default.resolve(filePath);
        (0, unified_log_js_1.devLog)(`[Protocol] local-video url="${request.url}" resolved="${absPath}" exists=${fs_1.default.existsSync(absPath)}`);
        if (!fs_1.default.existsSync(absPath)) {
            (0, unified_log_js_1.devLog)(`[Protocol] local-video: file not found: ${absPath}`);
            callback({ error: -6 });
            return;
        }
        callback({ path: absPath });
    });
    void createWindow();
    (0, ipc_state_js_1.setIPCState)({ mainWindow });
    void createTray();
    (0, index_js_1.registerAllHandlers)(electron_1.ipcMain, () => mainWindow);
    // ─── Bundled License Server ─────────────────────────────────────────────────
    // Auto-starts the license server bundled inside the packaged app.
    // Falls back gracefully if server already running or files missing.
    const LICENSE_SERVER_PORT = 3001;
    const bundledServerDir = electron_1.app.isPackaged
        ? path_1.default.join(process.resourcesPath, 'app', 'servers', 'license-server')
        : path_1.default.join(__dirname, '..', 'servers', 'license-server');
    const bundledIndex = path_1.default.join(bundledServerDir, 'index.js');
    const bundledNodeModules = path_1.default.join(bundledServerDir, 'node_modules');
    async function isPortInUse(port) {
        return new Promise((resolve) => {
            const s = http.createServer();
            s.once('error', () => { resolve(true); });
            s.once('listening', () => { s.close(); resolve(false); });
            s.listen(port, '127.0.0.1');
        });
    }
    async function waitForServer(port, timeoutMs = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const res = await fetch(`http://localhost:${port}/health`);
                if (res.ok)
                    return true;
            }
            catch { }
            await new Promise(r => setTimeout(r, 200));
        }
        return false;
    }
    let licenseServerStarted = false;
    if (electron_1.app.isPackaged && fs_1.default.existsSync(bundledIndex) && fs_1.default.existsSync(bundledNodeModules)) {
        const portInUse = await isPortInUse(LICENSE_SERVER_PORT);
        if (!portInUse) {
            (0, unified_log_js_1.devLog)(`[LicenseServer] Starting bundled server from ${bundledServerDir}`);
            const nodeExe = path_1.default.join(process.resourcesPath, 'node', 'node.exe');
            const nodeBin = fs_1.default.existsSync(nodeExe) ? nodeExe : 'node';
            const server = (0, child_process_1.spawn)(nodeBin, [bundledIndex], {
                cwd: bundledServerDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: true,
                env: { ...process.env, PORT: String(LICENSE_SERVER_PORT) },
            });
            server.unref();
            const ready = await waitForServer(LICENSE_SERVER_PORT);
            if (ready) {
                (0, unified_log_js_1.devLog)(`[LicenseServer] Bundled server ready on port ${LICENSE_SERVER_PORT}`);
                process.env.LICENSE_SERVER_URL = `http://localhost:${LICENSE_SERVER_PORT}`;
                licenseServerStarted = true;
            }
            else {
                (0, unified_log_js_1.devLog)(`[LicenseServer] Bundled server failed to start within 5s`);
            }
        }
        else {
            (0, unified_log_js_1.devLog)(`[LicenseServer] Port ${LICENSE_SERVER_PORT} already in use — assuming server running`);
            process.env.LICENSE_SERVER_URL = `http://localhost:${LICENSE_SERVER_PORT}`;
            licenseServerStarted = true;
        }
    }
    else if (!electron_1.app.isPackaged) {
        // Dev: point to localhost if server is running, else warn
        const portInUse = await isPortInUse(LICENSE_SERVER_PORT);
        if (portInUse) {
            process.env.LICENSE_SERVER_URL = `http://localhost:${LICENSE_SERVER_PORT}`;
        }
        else {
            (0, unified_log_js_1.devLog)(`[LicenseServer] No server on port ${LICENSE_SERVER_PORT} — start with: node servers/license-server/index.js`);
        }
    }
    // ─── Health Alert Checker (every 60s) ───────────────────────────────────────
    // Runs periodic health checks and sends notifications to the renderer.
    setInterval(async () => {
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        try {
            const alerts = await (0, health_alerts_js_1.checkHealthAlerts)();
            (0, health_alerts_js_1.sendHealthAlerts)(alerts, mainWindow);
        }
        catch (e) {
            (0, unified_log_js_1.devLog)(`[HealthCheck] Error: ${e.message}`);
        }
    }, 60_000);
    // Initial health check after 30 seconds (let things settle)
    setTimeout(async () => {
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        try {
            const alerts = await (0, health_alerts_js_1.checkHealthAlerts)();
            (0, health_alerts_js_1.sendHealthAlerts)(alerts, mainWindow);
        }
        catch { }
    }, 30_000);
    // ─── GitHub Auto-Update (check every 6h + initial check after 10s) ─────────────
    (0, github_updater_js_1.startAutoCheck)();
    setTimeout(async () => {
        try {
            const { checkForUpdates } = await Promise.resolve().then(() => __importStar(require('./services/github-updater.js')));
            const result = await checkForUpdates();
            if (result.available) {
                (0, unified_log_js_1.devLog)(`[GitHubUpdater] New version available: v${result.version}`);
            }
        }
        catch { }
    }, 10_000);
    // Resolve missing channelIds for demo channels at startup
    void resolveChannelIdsForPoll();
    // ─── Startup recovery: reset stale 'rendering' workspaces ───────────────────
    // If app was killed mid-render, workspaces are stuck at 'rendering' with 0% progress.
    // - Source video exists → reset to 'ready' (user can re-render)
    // - Source video missing → reset to 'error' (user can re-download)
    {
        const ws = (0, store_js_1.getWorkspaces)();
        let recovered = 0;
        for (const w of ws) {
            if (w.status === 'rendering') {
                const sourcePath = findDownloadedFileAbs(w.id) || w.downloadedPath;
                const sourceExists = sourcePath && fs_1.default.existsSync(sourcePath);
                if (sourceExists) {
                    (0, unified_log_js_1.devLog)(`[StartupRecovery] "${w.videoTitle}" → 'ready' (source video found: ${path_1.default.basename(sourcePath)})`);
                    (0, store_js_1.updateWorkspace)(w.id, { status: 'ready', renderProgress: 0 });
                }
                else {
                    (0, unified_log_js_1.devLog)(`[StartupRecovery] "${w.videoTitle}" → 'error' (source video not found)`);
                    (0, store_js_1.updateWorkspace)(w.id, { status: 'error', renderProgress: 0 });
                }
                broadcast(channels_js_1.IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, (0, store_js_1.getWorkspace)(w.id));
                recovered++;
            }
        }
        if (recovered > 0)
            (0, unified_log_js_1.devLog)(`[StartupRecovery] Recovered ${recovered} stale rendering workspace(s)`);
    }
    // Scan storage directory for existing downloaded files — register them as "seen"
    // so poll won't re-download files already on disk
    scanExistingDownloadedFiles();
    // Catch up: auto-render any 'ready' workspaces that didn't get rendered yet.
    // This handles workspaces created before auto-render was enabled, or where
    // the trigger was skipped due to a prior crash / missing autoRenderAttempted field.
    triggerAutoRenderForReadyWorkspaces();
    // Init cookie manager (auto-refresh every 15m + sub sync every 2m)
    const cookieResult = await (0, cookie_manager_js_1.initCookieManager)();
    if (cookieResult.success) {
        (0, unified_log_js_1.devLog)(`[HyperClip] Cookies ready (${cookieResult.browser}, ${cookieResult.cookies.length} cookies)`);
    }
    else {
        console.warn(`[HyperClip] Cookie init failed: ${cookieResult.error} — polling will retry`);
    }
    // Start auto-refresh timer (cookies + subscription sync)
    (0, cookie_manager_js_1.getCookieManager)().startAutoRefresh();
    // Start polling ONLY after the renderer page has fully loaded AND Innertube pool is initialized.
    // This guarantees the window + frontend IPC listeners are ready before
    // any broadcast() call, so workspaces are always created and shown in real-time.
    // Also guarantees Innertube pool is ready before first poll — prevents OAuth quota waste.
    if (mainWindow) {
        // did-finish-load fires immediately if the page is already loaded
        mainWindow.webContents.once('did-finish-load', async () => {
            // Pre-warm the Innertube pool before polling starts.
            // Without this, the first poll races with pool initialization → OAuth fallback waste.
            // The pool init runs concurrently with SessionManager init (~12s), so start it early.
            (0, unified_log_js_1.devLog)('[HyperClip] Pre-warming Innertube pool...');
            const { getInnertubePool } = await Promise.resolve().then(() => __importStar(require('./services/innertube_client.js')));
            const pool = await getInnertubePool();
            const poolStatus = pool.getStatus();
            (0, unified_log_js_1.devLog)(`[HyperClip] Innertube pool: ${poolStatus.readyCount}/${poolStatus.totalSessions} sessions ready`);
            startYouTubePoller(5_000, (videos) => {
                // Deduplicate within the same poll: OAuth can return the same videoId from
                // multiple channels (same video appears in multiple channel feeds).
                // Dedupe by videoId — keep first occurrence.
                const seen = new Set();
                const uniqueVideos = videos.filter(v => {
                    if (seen.has(v.videoId)) {
                        (0, unified_log_js_1.devLog)(`[AutoIngest] dedup: skipping duplicate ${v.videoId} from channel ${v.channelName} (already processed in this poll)`);
                        return false;
                    }
                    seen.add(v.videoId);
                    return true;
                });
                // Non-blocking: enqueue all detected videos for background download.
                // Each enqueueBgDownload() immediately creates a 'waiting' workspace → UI shows video right away.
                // Downloads run in parallel (max 2-3 concurrent) without blocking the poller.
                if (uniqueVideos.length > 0) {
                    unified_log_js_1.opLog.success('scan', `${uniqueVideos.length} video mới sẵn sàng tải về`, uniqueVideos.map(v => v.title).join(', '));
                }
                for (const v of uniqueVideos) {
                    (0, unified_log_js_1.devLog)(`[AutoIngest] new video detected: ${v.title} (${v.channelName}), enqueueing...`);
                    unified_log_js_1.opLog.info('download', `Đang tải: ${v.title}`, v.channelName);
                    // Check for existing 'error' workspace with expired backoff — retry it directly
                    const existingWorkspaces = (0, store_js_1.getWorkspaces)();
                    const errorWs = existingWorkspaces.find(ws => ws.videoId === v.videoId &&
                        ws.status === 'error' &&
                        (!ws.retryableAt || Date.now() >= new Date(ws.retryableAt).getTime()));
                    if (errorWs && !inProgressAutoRetries.has(errorWs.id)) {
                        (0, unified_log_js_1.devLog)(`[AutoIngest] retrying errored workspace ${errorWs.id}: ${v.title}`);
                        void retryAutoDownload(errorWs);
                        continue;
                    }
                    enqueueBgDownload(v);
                }
            }, () => {
                // Innertube degraded — notify UI
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(channels_js_1.IPC_CHANNELS.INNERTUBE_DEGRADED_EVENT, { degraded: true });
                    mainWindow.webContents.send(channels_js_1.IPC_CHANNELS.NOTIFICATION_EVENT, {
                        type: 'warning',
                        message: '⚠️ Innertube đang degraded — đang kiểm tra OAuth...',
                    });
                }
            });
            (0, unified_log_js_1.devLog)('[HyperClip] Auto-ingestion active (5s interval)');
            (0, unified_log_js_1.devLog)(`[HyperClip] Ready → http://localhost:${NEXT_PORT}`);
            startSystemMonitor();
            // ─── Periodic storage cleanup (every 1 hour) ─────────────────────────────────
            setInterval(() => {
                const cleanupDays = (0, ramdisk_js_1.loadSettings)().downloadsCleanupDays ?? 7;
                if (cleanupDays <= 0)
                    return;
                try {
                    const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
                    const cutoff = Date.now() - cleanupDays * 24 * 60 * 60 * 1000;
                    const workspaces = (0, store_js_1.getWorkspaces)();
                    const activeIds = new Set(workspaces.map(w => w.id));
                    const activeWsId = (0, ipc_state_js_1.getActiveWorkspaceId)();
                    if (activeWsId)
                        activeIds.add(activeWsId);
                    let cleaned = 0;
                    for (const entry of fs_1.default.readdirSync(storagePath)) {
                        if (entry.startsWith('blur_'))
                            continue;
                        const ext = path_1.default.extname(entry).toLowerCase();
                        if (!['.mp4', '.mkv', '.webm', '.avi', '.mov'].includes(ext))
                            continue;
                        // Skip if this file belongs to an active workspace
                        const entryBase = entry.replace(/\.\w+$/, '');
                        const isActive = Array.from(activeIds).some(id => entryBase.startsWith(id + '_') || entryBase === id);
                        if (isActive)
                            continue;
                        const fullPath = path_1.default.join(storagePath, entry);
                        try {
                            const stat = fs_1.default.statSync(fullPath);
                            if (stat.mtimeMs < cutoff) {
                                fs_1.default.unlinkSync(fullPath);
                                cleaned++;
                            }
                        }
                        catch { }
                    }
                    if (cleaned > 0)
                        (0, unified_log_js_1.devLog)(`[PeriodicCleanup] Removed ${cleaned} old video files`);
                }
                catch { }
            }, 60 * 60 * 1000);
            // ─── Disk space monitoring (every 30 minutes) ──────────────────────────────
            setInterval(() => {
                try {
                    const storagePath = (0, ramdisk_js_1.getVideoStoragePath)();
                    const ramDiskInfo = (0, ramdisk_js_1.getRamDiskInfo)();
                    // RAMDISK-aware: warn when 80% full (not hardcoded 20GB)
                    const FREE_WARNING_BYTES = ramDiskInfo.isAvailable
                        ? Math.floor(ramDiskInfo.total * (1 - ramDiskInfo.warningPct) * 1024 * 1024 * 1024)
                        : 20 * 1024 * 1024 * 1024; // Fallback: 20GB for non-RAMDISK paths
                    const freeBytes = (0, ramdisk_js_1.getFreeDiskSpace)(storagePath);
                    if (freeBytes > 0 && freeBytes < FREE_WARNING_BYTES) {
                        const freeGB = (freeBytes / (1024 ** 3)).toFixed(1);
                        mainWindow?.webContents.send(channels_js_1.IPC_CHANNELS.NOTIFICATION_EVENT, { type: 'warning', message: `Low disk space: only ${freeGB} GB free` });
                    }
                }
                catch { }
            }, 30 * 60 * 1000);
        });
    }
});
// ─── Graceful shutdown — triggered by NSIS installer, system shutdown, or user quit ──
// before-quit fires before the app actually exits — ensures quitAll() runs first.
// ─── Single instance lock ─────────────────────────────────────────────────────
// Only allow one instance. Second-instance launches focus the existing window.
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
}
electron_1.app.on('before-quit', (e) => {
    if (_isQuitting)
        return;
    e.preventDefault();
    _isQuitting = true;
    void quitAll();
});
electron_1.app.on('window-all-closed', () => {
    if (_isQuitting)
        return;
    _isQuitting = true;
    void quitAll();
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        void createWindow();
});
process.on('uncaughtException', (err) => {
    unified_log_js_1.log.crash('Uncaught exception', err);
    sendNotification('error', `Uncaught error: ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
    unified_log_js_1.log.crash('Unhandled promise rejection', reason);
});
// ─── Crash Reporter (Electron built-in) ───────────────────────────────────────
// Stores minidumps locally. User can export via Settings > Logs.
electron_1.crashReporter.start({
    productName: 'HyperClip',
    companyName: 'LoopCompany',
    submitURL: '', // No server yet — minidumps saved locally only
    uploadToServer: false,
});
// Log startup banner
unified_log_js_1.log.info(`HyperClip starting — v${electron_1.app.getVersion()} | Electron ${process.versions.electron} | Node ${process.version}`);
