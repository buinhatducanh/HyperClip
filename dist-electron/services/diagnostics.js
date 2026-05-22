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
exports.runDiagnostics = runDiagnostics;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const ffmpeg_paths_js_1 = require("./ffmpeg-paths.js");
const ramdisk_js_1 = require("./ramdisk.js");
// ─── System Diagnostics ───────────────────────────────────────────────────────────
// Checks all prerequisites and returns a structured status report.
// Called at startup and on-demand from Settings UI.
// yt-dlp: check resources/bundled (shipped with app) → node_modules/.bin → PATH
function getYtdlpStatus() {
    const candidates = [];
    // Bundled in resources/
    if (electron_1.app.isReady() && electron_1.app.getAppPath) {
        candidates.push(path_1.default.join(electron_1.app.getAppPath(), 'resources', 'yt-dlp', 'yt-dlp.exe'));
    }
    // node_modules/.bin (dev + npm package)
    candidates.push(path_1.default.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp.exe'));
    candidates.push(path_1.default.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp'));
    // PATH
    const pathEnv = process.env.PATH || '';
    for (const dir of pathEnv.split(path_1.default.delimiter)) {
        candidates.push(path_1.default.join(dir.trim(), 'yt-dlp'));
        candidates.push(path_1.default.join(dir.trim(), 'yt-dlp.exe'));
    }
    // Python Scripts (AppData Roaming)
    for (const ver of ['Python314', 'Python313', 'Python312', 'Python311']) {
        candidates.push(path_1.default.join(process.env.APPDATA || '', 'Python', ver, 'Scripts', 'yt-dlp.exe'));
        candidates.push(path_1.default.join(process.env.APPDATA || '', 'Python', ver, 'Scripts', 'yt-dlp'));
        candidates.push(path_1.default.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', ver, 'Scripts', 'yt-dlp.exe'));
    }
    for (const p of candidates) {
        if (!p)
            continue;
        try {
            if (fs_1.default.existsSync(p))
                return { ok: true, path: p };
        }
        catch { }
    }
    return { ok: false, path: '', error: 'yt-dlp not found. Download từ https://github.com/yt-dlp/yt-dlp/releases hoặc cài Python + pip install yt-dlp.' };
}
// Check yt-dlp can execute (basic version check)
async function getYtdlpVersion(ytdlpPath) {
    try {
        const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const out = execSync(`"${ytdlpPath}" --version 2>&1`, { encoding: 'utf-8', timeout: 5000 });
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
    const ytdlpStatus = getYtdlpStatus();
    const ytdlpPath = ytdlpStatus.path;
    const ytdlpError = ytdlpStatus.error || '';
    if (ytdlpStatus.ok) {
        ytdlpVersion = await getYtdlpVersion(ytdlpPath);
        ytdlpOk = true;
    }
    else {
        issues.push('yt-dlp not found — downloads will fail. Run: npm install yt-dlp');
    }
    // ── Storage ────────────────────────────────────────────────────────────────
    const ramDiskAvailable = (0, ramdisk_js_1.isRamDiskAvailable)();
    const { getAppStoreDir } = await Promise.resolve().then(() => __importStar(require('./paths.js')));
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
