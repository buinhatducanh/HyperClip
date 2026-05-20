import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { shell } from 'electron';
import { getAppStoreDir, getRamDiskPath, getDownloadsDir, getBlurDir, getOutputDir, getArchivedDir } from './paths.js';
export { getAppStoreDir };
import { devLog } from './unified_log.js';
// RAM Disk Manager
// Manages the virtual RAM disk for fast video temp storage
// ─── User-configurable storage paths ─────────────────────────────────────────────
const STORE_DIR = getAppStoreDir();
const SETTINGS_FILE = path.join(STORE_DIR, 'settings.json');
let _settings = null;
export function loadSettings() {
    if (_settings !== null)
        return _settings;
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            _settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        }
    }
    catch { }
    _settings = _settings || {};
    // Default values for new settings
    if (_settings.autoRenderResolution === undefined)
        _settings.autoRenderResolution = '480x480';
    if (_settings.autoRenderFPS === undefined)
        _settings.autoRenderFPS = 30;
    if (_settings.downloadsCleanupDays === undefined)
        _settings.downloadsCleanupDays = 7;
    if (_settings.defaultQuality === undefined)
        _settings.defaultQuality = 1080;
    if (_settings.autoDownloadEnabled === undefined)
        _settings.autoDownloadEnabled = true;
    if (_settings.pollIntervalMs === undefined)
        _settings.pollIntervalMs = 5000;
    if (_settings.maxConcurrentRenders === undefined)
        _settings.maxConcurrentRenders = 2;
    if (_settings.autoDownloadQuality === undefined)
        _settings.autoDownloadQuality = '720';
    if (_settings.maxConcurrentDownloads === undefined)
        _settings.maxConcurrentDownloads = 3;
    if (_settings.videoMinDurationSec === undefined)
        _settings.videoMinDurationSec = 0;
    if (_settings.videoMaxDurationSec === undefined)
        _settings.videoMaxDurationSec = 0;
    if (_settings.quitOnClose === undefined)
        _settings.quitOnClose = true;
    return _settings;
}
export function saveSettings(settings) {
    _settings = settings;
    if (!fs.existsSync(STORE_DIR))
        fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}
export function getConfiguredVideoStoragePath() {
    return loadSettings().videoStoragePath;
}
export function getConfiguredOutputPath() {
    return loadSettings().outputPath;
}
// On Windows: Use ImDisk or similar to create RAM disk
// On Linux: Use tmpfs mount
// Fallback: Use a folder on fast storage with RAM-like management
// Auto-detect RAM disk size based on actual peak usage needs.
// Peak breakdown (worst case, 14 workers RTX 5080):
//   - Download queue (10 × 720p × 60MB): 600MB
//   - FFmpeg decode buffers (14 workers × 50MB): 700MB
//   - Pre-scale (1 × 60MB): 60MB
//   - Output files (14 chunks + 1 merged × 50MB): 750MB
//   - Blur thumbnails: 5MB
//   ───────────────────────────────────────────
//   Total peak: ~2.1GB → cap at 4GB (64GB machine) = 2× headroom
// For 32GB machine (7 workers): ~1.2GB peak → 3GB cap
// For 16GB machine (4 workers): ~700MB peak → 2GB cap
export function getAutoRamDiskSize() {
    const totalGB = os.totalmem() / (1024 ** 3);
    if (totalGB >= 48)
        return 4; // 64GB: 2× peak headroom
    if (totalGB >= 32)
        return 3; // 48GB: 2.5× peak headroom
    if (totalGB >= 16)
        return 2; // 32GB: 2.5× peak headroom
    if (totalGB >= 8)
        return 1; // 16GB: ~1.5× peak headroom
    return 0; // <8GB: disable RAMDISK — too risky
}
const RAM_DISK_SIZE_GB = getAutoRamDiskSize();
const RAM_DISK_PATH = getRamDiskPath();
const OUTPUT_PATH = path.join(RAM_DISK_PATH, 'output');
const RAM_DISK_TOTAL = RAM_DISK_SIZE_GB * 1024 * 1024 * 1024; // bytes
// Check if RAM disk is available
export function isRamDiskAvailable() {
    try {
        return fs.existsSync(RAM_DISK_PATH);
    }
    catch {
        return false;
    }
}
// Get RAM disk info
export function getRamDiskInfo() {
    const available = isRamDiskAvailable();
    if (!available) {
        // Fallback: use temp directory with disk space info
        const tempDir = os.tmpdir();
        try {
            // Estimate based on free temp space
            const freeSpace = getFreeDiskSpace(tempDir);
            return {
                total: RAM_DISK_SIZE_GB,
                used: 0,
                available: Math.min(freeSpace / (1024 ** 3), RAM_DISK_SIZE_GB),
                path: RAM_DISK_PATH,
                isAvailable: false,
                warningPct: 0.8,
            };
        }
        catch {
            return {
                total: RAM_DISK_SIZE_GB,
                used: 0,
                available: RAM_DISK_SIZE_GB,
                path: RAM_DISK_PATH,
                isAvailable: false,
                warningPct: 0.8,
            };
        }
    }
    // Calculate usage
    let usedBytes = 0;
    try {
        usedBytes = calculateDirSize(RAM_DISK_PATH);
    }
    catch { }
    return {
        total: RAM_DISK_SIZE_GB,
        used: parseFloat((usedBytes / (1024 ** 3)).toFixed(2)),
        available: parseFloat((RAM_DISK_SIZE_GB - usedBytes / (1024 ** 3)).toFixed(2)),
        path: RAM_DISK_PATH,
        isAvailable: true,
        warningPct: 0.8,
    };
}
// Get video storage path (user-configured > RAM disk > persistent downloads/)
export function getVideoStoragePath() {
    const configured = getConfiguredVideoStoragePath();
    if (configured && fs.existsSync(configured))
        return configured;
    if (isRamDiskAvailable())
        return RAM_DISK_PATH;
    // Fallback: persistent folder under HyperClip-Data/downloads/
    return getDownloadsDir();
}
// Get output path (user-configured > RAM disk > persistent output/)
export function getOutputPath() {
    const configured = getConfiguredOutputPath();
    if (configured && fs.existsSync(configured))
        return configured;
    if (isRamDiskAvailable())
        return OUTPUT_PATH;
    // Fallback: persistent folder under HyperClip-Data/output/
    return getOutputDir();
}
// Ensure directories exist
export function ensureStorageDirs() {
    const storagePath = getVideoStoragePath();
    const outputPath = getOutputPath();
    const blurDir = getBlurDir();
    const archiveDir = getArchivePath();
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }
    if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
    }
    if (!fs.existsSync(blurDir)) {
        fs.mkdirSync(blurDir, { recursive: true });
    }
    if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
    }
}
// Generate workspace file paths
// yt-dlp outputs: {workspaceId}_{videoId}.mp4 — pass videoId to match the actual file
export function generateWorkspacePaths(workspaceId, videoId) {
    const storagePath = getVideoStoragePath();
    const outputDir = getOutputPath();
    return {
        // yt-dlp output template: {workspaceId}_%(id)s.mp4 — videoId required to match
        videoPath: videoId
            ? path.join(storagePath, `${workspaceId}_${videoId}.mp4`)
            : path.join(storagePath, `${workspaceId}.mp4`),
        blurPath: path.join(storagePath, `blur_${workspaceId}.jpg`),
        metadataPath: path.join(storagePath, `meta_${workspaceId}.json`),
        outputPath: path.join(outputDir, `${workspaceId}_output.mp4`),
    };
}
// Calculate directory size recursively
function calculateDirSize(dirPath) {
    let size = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                size += calculateDirSize(fullPath);
            }
            else {
                const stat = fs.statSync(fullPath);
                size += stat.size;
            }
        }
    }
    catch { }
    return size;
}
// Get free disk space for a path (cross-platform)
export function getFreeDiskSpace(dirPath) {
    // On Windows, use wmic command
    if (process.platform === 'win32') {
        try {
            const drive = path.parse(dirPath).root || 'C:';
            const out = execSync(`wmic logicaldisk where "DeviceID='${drive.replace('\\', '')}'" get FreeSpace /format:value`, {
                encoding: 'utf-8',
                timeout: 5000,
            });
            const match = out.match(/FreeSpace=(\d+)/);
            return match ? parseInt(match[1]) : 0;
        }
        catch {
            return 0;
        }
    }
    // On Linux/macOS, use df
    try {
        const out = execSync(`df -k "${dirPath}"`, { encoding: 'utf-8', timeout: 5000 });
        const lines = out.trim().split('\n');
        const dataLine = lines[lines.length - 1];
        const parts = dataLine.trim().split(/\s+/);
        const freeKb = parseInt(parts[3]) || 0;
        return freeKb * 1024;
    }
    catch {
        return 0;
    }
}
// Clean up old workspace files
// Returns bytes freed and files deleted count
export function cleanupWorkspace(workspaceId, downloadedPath) {
    const storagePath = getVideoStoragePath();
    let bytesFreed = 0;
    let filesDeleted = 0;
    // Resolve a potentially-relative path to absolute (downloadedPath is stored as relative)
    const resolvePath = (p) => {
        if (!p)
            return '';
        if (p.startsWith('/') || /^[A-Z]:/i.test(p))
            return p;
        return path.join(storagePath, p);
    };
    // Also scan for any leftover files matching {workspaceId}_*.{ext} pattern
    let patternFiles = [];
    try {
        const entries = fs.readdirSync(storagePath);
        patternFiles = entries
            .filter(f => f.startsWith(`${workspaceId}_`))
            .map(f => path.join(storagePath, f));
    }
    catch { }
    const { videoPath, blurPath, metadataPath, outputPath } = generateWorkspacePaths(workspaceId);
    const filesToClean = new Set();
    if (downloadedPath)
        filesToClean.add(resolvePath(downloadedPath));
    filesToClean.add(resolvePath(videoPath)); // generic workspaceId.mp4 (old format)
    filesToClean.add(resolvePath(blurPath));
    filesToClean.add(resolvePath(metadataPath));
    // output file
    try {
        if (fs.existsSync(outputPath)) {
            filesToClean.add(outputPath);
        }
    }
    catch { }
    // Add any additional files found by pattern scan
    for (const f of patternFiles)
        filesToClean.add(f);
    for (const filePath of filesToClean) {
        try {
            if (filePath && fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                bytesFreed += stat.size;
                fs.unlinkSync(filePath);
                filesDeleted++;
                devLog(`[RAMDisk] Cleaned (${formatBytes(stat.size)}): ${filePath}`);
            }
        }
        catch (err) {
            // Ignore errors for files that don't exist
        }
    }
    return { bytesFreed, filesDeleted };
}
// Format bytes to human readable
export function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
// Get storage stats for a workspace
export function getWorkspaceStorageSize(workspaceId) {
    const storagePath = getVideoStoragePath();
    let videoSize = 0;
    let blurSize = 0;
    // yt-dlp outputs: workspaceId_{videoId}.mp4 — scan for matching files
    try {
        const files = fs.readdirSync(storagePath).filter(f => f.startsWith(workspaceId + '_') && f.endsWith('.mp4'));
        for (const f of files) {
            videoSize += fs.statSync(path.join(storagePath, f)).size;
        }
    }
    catch { }
    try {
        const blurPath = path.join(storagePath, `blur_${workspaceId}.jpg`);
        if (fs.existsSync(blurPath)) {
            blurSize = fs.statSync(blurPath).size;
        }
    }
    catch { }
    return {
        video: parseFloat((videoSize / (1024 ** 2)).toFixed(1)), // MB
        blur: parseFloat((blurSize / (1024 ** 2)).toFixed(1)),
        total: parseFloat(((videoSize + blurSize) / (1024 ** 2)).toFixed(1)),
    };
}
// ─── Archive / Rendered files ──────────────────────────────────────────────────────
export function getArchivePath() {
    const settings = loadSettings();
    if (settings.renderedOutputPath)
        return settings.renderedOutputPath;
    // Default: HyperClip-Data/archived/ — keeps everything under one root folder
    return getArchivedDir();
}
export function getConfiguredArchivePath() {
    return loadSettings().renderedOutputPath;
}
// Sanitize filename: remove characters invalid on Windows filenames
function sanitizeFilename(name) {
    // eslint-disable-next-line no-control-regex -- intentional: strip ASCII control chars
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120);
}
// Copy rendered output file to archive directory with descriptive filename.
// Returns the archived absolute path, or null if copy failed.
export async function archiveRenderedFile(sourcePath, channelName, videoTitle, quality, codec, fileSize, duration) {
    const archiveDir = getArchivePath();
    // Ensure archive directory exists
    try {
        if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true });
        }
    }
    catch (e) {
        return { success: false, error: `Cannot create archive directory: ${e}` };
    }
    // Check source exists
    if (!fs.existsSync(sourcePath)) {
        return { success: false, error: `Source file not found: ${sourcePath}` };
    }
    // Get source file size for integrity check
    const sourceSize = fs.statSync(sourcePath).size;
    // Build descriptive filename: {channel}_{title}_{quality}p_{codec}_{timestamp}.mp4
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = path.extname(sourcePath) || '.mp4';
    const safeChannel = sanitizeFilename(channelName) || 'Unknown';
    const safeTitle = sanitizeFilename(videoTitle) || 'Video';
    const baseName = `${safeChannel}_${safeTitle}_${quality}p_${codec}_${timestamp}${ext}`;
    const destPath = path.join(archiveDir, baseName);
    // Copy file (async via execSync cp)
    try {
        // Use Windows copy command for reliability
        execSync(`copy /Y "${sourcePath}" "${destPath}"`, { stdio: 'ignore' });
    }
    catch {
        return { success: false, error: 'Failed to copy file to archive' };
    }
    // Verify copy succeeded: check file exists AND size matches
    if (!fs.existsSync(destPath)) {
        return { success: false, error: 'Copy verification failed: destination not found' };
    }
    const destStat = fs.statSync(destPath);
    if (destStat.size !== sourceSize) {
        // Cleanup failed copy and return error
        try {
            fs.unlinkSync(destPath);
        }
        catch { }
        return { success: false, error: `Copy verification failed: size mismatch (expected ${sourceSize}, got ${destStat.size})` };
    }
    // Delete original after successful copy
    try {
        if (sourcePath !== destPath)
            fs.unlinkSync(sourcePath);
    }
    catch { }
    return { success: true, archivedPath: destPath };
}
// Open archive folder in file explorer
export function openArchiveFolder() {
    void shell.openPath(getArchivePath());
}
// Open a specific rendered file's containing folder
export function showInFolder(filePath) {
    shell.showItemInFolder(filePath);
}
