"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDiagnostics = runDiagnostics;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const ffmpeg_paths_js_1 = require("./ffmpeg-paths.js");
const ramdisk_js_1 = require("./ramdisk.js");
const youtube_js_1 = require("./youtube.js");
// ─── System Diagnostics ───────────────────────────────────────────────────────────
// Checks all prerequisites and returns a structured status report.
// Called at startup and on-demand from Settings UI.
// Check yt-dlp can execute (basic version check)
async function getYtdlpVersion(ytdlpPath) {
    try {
        const out = (0, child_process_1.execSync)(`"${ytdlpPath}" --version 2>&1`, { encoding: 'utf-8', timeout: 5000 });
        return out.trim().split('\n')[0];
    }
    catch {
        return 'unknown';
    }
}
// FFmpeg bundled path: resources/ffmpeg/ in the app bundle
function getBundledFfmpegPath(name) {
    const appPath = electron_1.app.isReady() ? electron_1.app.getAppPath() : '';
    if (!appPath)
        return '';
    // In dev: process.resourcesPath points to project root
    const base = process.resourcesPath || appPath;
    // FFmpeg is shipped in resources/ffmpeg/bin/ (standard FFmpeg folder structure)
    return path_1.default.join(base, 'ffmpeg', 'bin', name + '.exe');
}
async function runDiagnostics() {
    const issues = [];
    const timestamp = new Date().toISOString();
    // ── FFmpeg ──────────────────────────────────────────────────────────────────
    let ffmpegOk = false;
    let ffmpegPath = '';
    let ffmpegVersion = '';
    let ffmpegHasNvenc = false;
    let ffmpegHasNvdec = false;
    let ffmpegHasCudaFilters = false;
    let ffmpegBundled = false;
    let ffmpegError = '';
    // Check bundled first
    const bundledPath = getBundledFfmpegPath('ffmpeg');
    if (bundledPath && fs_1.default.existsSync(bundledPath)) {
        ffmpegPath = bundledPath;
        ffmpegBundled = true;
    }
    else {
        // Fall back to system FFmpeg
        try {
            ffmpegPath = (0, ffmpeg_paths_js_1.getFfmpegPath)();
            if (ffmpegPath && fs_1.default.existsSync(ffmpegPath)) {
                ffmpegBundled = false;
            }
            else {
                ffmpegPath = '';
            }
        }
        catch (e) {
            ffmpegError = String(e);
        }
    }
    if (ffmpegPath) {
        try {
            // Use getFfmpegVersion which does comprehensive hardware capability detection:
            // - NVDEC (hardware video decode): h264_nvdec/hevc_nvdec in decoders list
            // - CUDA filters (GPU scale/crop/overlay): scale_cuda/overlay_cuda in filters list
            // - NVENC (hardware video encode): h264_nvenc/hevc_nvenc in encoders list
            const ver = (0, ffmpeg_paths_js_1.getFfmpegVersion)(ffmpegPath);
            ffmpegVersion = ver.version;
            ffmpegHasNvenc = ver.hasNvenc;
            ffmpegHasNvdec = ver.hasNvdec;
            ffmpegHasCudaFilters = ver.hasCudaFilters;
            ffmpegOk = ver.version !== 'unknown' && ver.version !== '';
        }
        catch (e) {
            ffmpegError = String(e);
            issues.push('FFmpeg not executable');
        }
    }
    else {
        issues.push('FFmpeg not found — renders will fail. Download: https://ffmpeg.org/download.html');
    }
    // ── yt-dlp ────────────────────────────────────────────────────────────────
    let ytdlpOk = false;
    let ytdlpVersion = '';
    let ytdlpPath = '';
    let ytdlpError = '';
    try {
        ytdlpPath = (0, youtube_js_1.getYtdlpPath)();
        if (ytdlpPath && ytdlpPath !== 'yt-dlp') {
            // getYtdlpPath returned a real path — verify it exists
            if (fs_1.default.existsSync(ytdlpPath)) {
                ytdlpOk = true;
            }
        }
        else {
            // Fallback: check if 'yt-dlp' resolves via PATH
            try {
                (0, child_process_1.execSync)('yt-dlp --version', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
                ytdlpOk = true;
            }
            catch {
                ytdlpError = 'yt-dlp not found. Chạy: npm run setup:ytdlp';
            }
        }
        if (ytdlpOk) {
            ytdlpVersion = await getYtdlpVersion(ytdlpPath);
        }
        else {
            issues.push('yt-dlp not found — downloads will fail. Run: npm run setup:ytdlp');
        }
    }
    catch (e) {
        ytdlpError = String(e);
        issues.push('yt-dlp not found — downloads will fail. Run: npm run setup:ytdlp');
    }
    // ── Storage ────────────────────────────────────────────────────────────────
    const ramDiskAvailable = (0, ramdisk_js_1.isRamDiskAvailable)();
    const { getAppStoreDir } = await import('./paths.js');
    const storeDir = getAppStoreDir();
    // ── Overall ────────────────────────────────────────────────────────────────
    const ready = ffmpegOk && ytdlpOk;
    return {
        timestamp,
        ffmpeg: { ok: ffmpegOk, path: ffmpegPath, version: ffmpegVersion, hasNvenc: ffmpegHasNvenc, hasNvdec: ffmpegHasNvdec, hasCudaFilters: ffmpegHasCudaFilters, bundled: ffmpegBundled, error: ffmpegError },
        ytDlp: { ok: ytdlpOk, path: ytdlpPath, version: ytdlpVersion, error: ytdlpError },
        storage: { ramDiskAvailable, storeDir },
        overall: { ready, issues },
    };
}
