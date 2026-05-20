import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getFfmpegPath, getFfmpegVersion } from './ffmpeg-paths.js';
import { isRamDiskAvailable } from './ramdisk.js';
// ─── System Diagnostics ───────────────────────────────────────────────────────────
// Checks all prerequisites and returns a structured status report.
// Called at startup and on-demand from Settings UI.
// yt-dlp: check resources/bundled (shipped with app) → node_modules/.bin → PATH
function getYtdlpStatus() {
    const candidates = [];
    // Bundled in resources/
    if (app.isReady() && app.getAppPath) {
        candidates.push(path.join(app.getAppPath(), 'resources', 'yt-dlp', 'yt-dlp.exe'));
    }
    // node_modules/.bin (dev + npm package)
    candidates.push(path.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp.exe'));
    candidates.push(path.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp'));
    // PATH
    const pathEnv = process.env.PATH || '';
    for (const dir of pathEnv.split(path.delimiter)) {
        candidates.push(path.join(dir.trim(), 'yt-dlp'));
        candidates.push(path.join(dir.trim(), 'yt-dlp.exe'));
    }
    // Python Scripts (AppData Roaming)
    for (const ver of ['Python314', 'Python313', 'Python312', 'Python311']) {
        candidates.push(path.join(process.env.APPDATA || '', 'Python', ver, 'Scripts', 'yt-dlp.exe'));
        candidates.push(path.join(process.env.APPDATA || '', 'Python', ver, 'Scripts', 'yt-dlp'));
        candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', ver, 'Scripts', 'yt-dlp.exe'));
    }
    for (const p of candidates) {
        if (!p)
            continue;
        try {
            if (fs.existsSync(p))
                return { ok: true, path: p };
        }
        catch { }
    }
    return { ok: false, path: '', error: 'yt-dlp not found. Download từ https://github.com/yt-dlp/yt-dlp/releases hoặc cài Python + pip install yt-dlp.' };
}
// Check yt-dlp can execute (basic version check)
async function getYtdlpVersion(ytdlpPath) {
    try {
        const { execSync } = await import('child_process');
        const out = execSync(`"${ytdlpPath}" --version 2>&1`, { encoding: 'utf-8', timeout: 5000 });
        return out.trim().split('\n')[0];
    }
    catch {
        return 'unknown';
    }
}
// FFmpeg bundled path: resources/ffmpeg/ in the app bundle
function getBundledFfmpegPath(name) {
    const appPath = app.isReady() ? app.getAppPath() : '';
    if (!appPath)
        return '';
    // In dev: process.resourcesPath points to project root
    const base = process.resourcesPath || appPath;
    // FFmpeg is shipped in resources/ffmpeg/bin/ (standard FFmpeg folder structure)
    return path.join(base, 'ffmpeg', 'bin', name + '.exe');
}
export async function runDiagnostics() {
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
    if (bundledPath && fs.existsSync(bundledPath)) {
        ffmpegPath = bundledPath;
        ffmpegBundled = true;
    }
    else {
        // Fall back to system FFmpeg
        try {
            ffmpegPath = getFfmpegPath();
            if (ffmpegPath && fs.existsSync(ffmpegPath)) {
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
            const ver = getFfmpegVersion(ffmpegPath);
            ffmpegVersion = ver.version;
            ffmpegHasNvenc = ver.hasNvenc;
            ffmpegHasNvdec = ver.hasNvdec;
            ffmpegHasCudaFilters = ver.hasCudaFilters;
            ffmpegOk = ver.ok;
            if (!ver.ok)
                ffmpegError = 'FFmpeg version check failed';
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
    let ytdlpPath = '';
    let ytdlpVersion = '';
    let ytdlpError = '';
    const ytdlpStatus = getYtdlpStatus();
    ytdlpPath = ytdlpStatus.path;
    ytdlpError = ytdlpStatus.error || '';
    if (ytdlpStatus.ok) {
        ytdlpVersion = await getYtdlpVersion(ytdlpPath);
        ytdlpOk = true;
    }
    else {
        issues.push('yt-dlp not found — downloads will fail. Run: npm install yt-dlp');
    }
    // ── Storage ────────────────────────────────────────────────────────────────
    const ramDiskAvailable = isRamDiskAvailable();
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
