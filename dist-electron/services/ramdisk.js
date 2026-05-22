"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAppStoreDir = void 0;
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.getConfiguredVideoStoragePath = getConfiguredVideoStoragePath;
exports.getConfiguredOutputPath = getConfiguredOutputPath;
exports.getAutoRamDiskSize = getAutoRamDiskSize;
exports.isRamDiskAvailable = isRamDiskAvailable;
exports.getRamDiskInfo = getRamDiskInfo;
exports.getVideoStoragePath = getVideoStoragePath;
exports.getOutputPath = getOutputPath;
exports.ensureStorageDirs = ensureStorageDirs;
exports.generateWorkspacePaths = generateWorkspacePaths;
exports.getFreeDiskSpace = getFreeDiskSpace;
exports.cleanupWorkspace = cleanupWorkspace;
exports.formatBytes = formatBytes;
exports.getWorkspaceStorageSize = getWorkspaceStorageSize;
exports.getArchivePath = getArchivePath;
exports.getConfiguredArchivePath = getConfiguredArchivePath;
exports.archiveRenderedFile = archiveRenderedFile;
exports.openArchiveFolder = openArchiveFolder;
exports.showInFolder = showInFolder;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const paths_js_1 = require("./paths.js");
Object.defineProperty(exports, "getAppStoreDir", { enumerable: true, get: function () { return paths_js_1.getAppStoreDir; } });
const unified_log_js_1 = require("./unified_log.js");
// RAM Disk Manager
// Manages the virtual RAM disk for fast video temp storage
// ─── User-configurable storage paths ─────────────────────────────────────────────
const STORE_DIR = (0, paths_js_1.getAppStoreDir)();
const SETTINGS_FILE = path_1.default.join(STORE_DIR, 'settings.json');
let _settings = null;
function loadSettings() {
    if (_settings !== null)
        return _settings;
    try {
        if (fs_1.default.existsSync(SETTINGS_FILE)) {
            _settings = JSON.parse(fs_1.default.readFileSync(SETTINGS_FILE, 'utf-8'));
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
function saveSettings(settings) {
    _settings = settings;
    if (!fs_1.default.existsSync(STORE_DIR))
        fs_1.default.mkdirSync(STORE_DIR, { recursive: true });
    fs_1.default.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}
function getConfiguredVideoStoragePath() {
    return loadSettings().videoStoragePath;
}
function getConfiguredOutputPath() {
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
function getAutoRamDiskSize() {
    const totalGB = os_1.default.totalmem() / (1024 ** 3);
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
const RAM_DISK_PATH = (0, paths_js_1.getRamDiskPath)();
const OUTPUT_PATH = path_1.default.join(RAM_DISK_PATH, 'output');
const RAM_DISK_TOTAL = RAM_DISK_SIZE_GB * 1024 * 1024 * 1024; // bytes
// Check if RAM disk is available
function isRamDiskAvailable() {
    try {
        return fs_1.default.existsSync(RAM_DISK_PATH);
    }
    catch {
        return false;
    }
}
// Get RAM disk info
function getRamDiskInfo() {
    const available = isRamDiskAvailable();
    if (!available) {
        // Fallback: use temp directory with disk space info
        const tempDir = os_1.default.tmpdir();
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
function getVideoStoragePath() {
    const configured = getConfiguredVideoStoragePath();
    if (configured && fs_1.default.existsSync(configured))
        return configured;
    if (isRamDiskAvailable())
        return RAM_DISK_PATH;
    // Fallback: persistent folder under HyperClip-Data/downloads/
    return (0, paths_js_1.getDownloadsDir)();
}
// Get output path (user-configured > RAM disk > persistent output/)
function getOutputPath() {
    const configured = getConfiguredOutputPath();
    if (configured && fs_1.default.existsSync(configured))
        return configured;
    if (isRamDiskAvailable())
        return OUTPUT_PATH;
    // Fallback: persistent folder under HyperClip-Data/output/
    return (0, paths_js_1.getOutputDir)();
}
// Ensure directories exist
function ensureStorageDirs() {
    const storagePath = getVideoStoragePath();
    const outputPath = getOutputPath();
    const blurDir = (0, paths_js_1.getBlurDir)();
    const archiveDir = getArchivePath();
    if (!fs_1.default.existsSync(storagePath)) {
        fs_1.default.mkdirSync(storagePath, { recursive: true });
    }
    if (!fs_1.default.existsSync(outputPath)) {
        fs_1.default.mkdirSync(outputPath, { recursive: true });
    }
    if (!fs_1.default.existsSync(blurDir)) {
        fs_1.default.mkdirSync(blurDir, { recursive: true });
    }
    if (!fs_1.default.existsSync(archiveDir)) {
        fs_1.default.mkdirSync(archiveDir, { recursive: true });
    }
}
// Generate workspace file paths
// yt-dlp outputs: {workspaceId}_{videoId}.mp4 — pass videoId to match the actual file
function generateWorkspacePaths(workspaceId, videoId) {
    const storagePath = getVideoStoragePath();
    const outputDir = getOutputPath();
    return {
        // yt-dlp output template: {workspaceId}_%(id)s.mp4 — videoId required to match
        videoPath: videoId
            ? path_1.default.join(storagePath, `${workspaceId}_${videoId}.mp4`)
            : path_1.default.join(storagePath, `${workspaceId}.mp4`),
        blurPath: path_1.default.join(storagePath, `blur_${workspaceId}.jpg`),
        metadataPath: path_1.default.join(storagePath, `meta_${workspaceId}.json`),
        outputPath: path_1.default.join(outputDir, `${workspaceId}_output.mp4`),
    };
}
// Calculate directory size recursively
function calculateDirSize(dirPath) {
    let size = 0;
    try {
        const entries = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path_1.default.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                size += calculateDirSize(fullPath);
            }
            else {
                const stat = fs_1.default.statSync(fullPath);
                size += stat.size;
            }
        }
    }
    catch { }
    return size;
}
// Get free disk space for a path (cross-platform)
function getFreeDiskSpace(dirPath) {
    // On Windows, use wmic command
    if (process.platform === 'win32') {
        try {
            const drive = path_1.default.parse(dirPath).root || 'C:';
            const out = (0, child_process_1.execSync)(`wmic logicaldisk where "DeviceID='${drive.replace('\\', '')}'" get FreeSpace /format:value`, {
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
        const out = (0, child_process_1.execSync)(`df -k "${dirPath}"`, { encoding: 'utf-8', timeout: 5000 });
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
function cleanupWorkspace(workspaceId, downloadedPath) {
    const storagePath = getVideoStoragePath();
    let bytesFreed = 0;
    let filesDeleted = 0;
    // Resolve a potentially-relative path to absolute (downloadedPath is stored as relative)
    const resolvePath = (p) => {
        if (!p)
            return '';
        if (p.startsWith('/') || /^[A-Z]:/i.test(p))
            return p;
        return path_1.default.join(storagePath, p);
    };
    // Also scan for any leftover files matching {workspaceId}_*.{ext} pattern
    let patternFiles = [];
    try {
        const entries = fs_1.default.readdirSync(storagePath);
        patternFiles = entries
            .filter(f => f.startsWith(`${workspaceId}_`))
            .map(f => path_1.default.join(storagePath, f));
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
        if (fs_1.default.existsSync(outputPath)) {
            filesToClean.add(outputPath);
        }
    }
    catch { }
    // Add any additional files found by pattern scan
    for (const f of patternFiles)
        filesToClean.add(f);
    for (const filePath of filesToClean) {
        try {
            if (filePath && fs_1.default.existsSync(filePath)) {
                const stat = fs_1.default.statSync(filePath);
                bytesFreed += stat.size;
                fs_1.default.unlinkSync(filePath);
                filesDeleted++;
                (0, unified_log_js_1.devLog)(`[RAMDisk] Cleaned (${formatBytes(stat.size)}): ${filePath}`);
            }
        }
        catch (err) {
            // Ignore errors for files that don't exist
        }
    }
    return { bytesFreed, filesDeleted };
}
// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
// Get storage stats for a workspace
function getWorkspaceStorageSize(workspaceId) {
    const storagePath = getVideoStoragePath();
    let videoSize = 0;
    let blurSize = 0;
    // yt-dlp outputs: workspaceId_{videoId}.mp4 — scan for matching files
    try {
        const files = fs_1.default.readdirSync(storagePath).filter(f => f.startsWith(workspaceId + '_') && f.endsWith('.mp4'));
        for (const f of files) {
            videoSize += fs_1.default.statSync(path_1.default.join(storagePath, f)).size;
        }
    }
    catch { }
    try {
        const blurPath = path_1.default.join(storagePath, `blur_${workspaceId}.jpg`);
        if (fs_1.default.existsSync(blurPath)) {
            blurSize = fs_1.default.statSync(blurPath).size;
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
function getArchivePath() {
    const settings = loadSettings();
    if (settings.renderedOutputPath)
        return settings.renderedOutputPath;
    // Default: HyperClip-Data/archived/ — keeps everything under one root folder
    return (0, paths_js_1.getArchivedDir)();
}
function getConfiguredArchivePath() {
    return loadSettings().renderedOutputPath;
}
// Sanitize filename: remove characters invalid on Windows filenames
function sanitizeFilename(name) {
    // eslint-disable-next-line no-control-regex -- intentional: strip ASCII control chars
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120);
}
// Copy rendered output file to archive directory with descriptive filename.
// Returns the archived absolute path, or null if copy failed.
async function archiveRenderedFile(sourcePath, channelName, videoTitle, quality, codec, fileSize, duration) {
    const archiveDir = getArchivePath();
    // Ensure archive directory exists
    try {
        if (!fs_1.default.existsSync(archiveDir)) {
            fs_1.default.mkdirSync(archiveDir, { recursive: true });
        }
    }
    catch (e) {
        return { success: false, error: `Cannot create archive directory: ${e}` };
    }
    // Check source exists
    if (!fs_1.default.existsSync(sourcePath)) {
        return { success: false, error: `Source file not found: ${sourcePath}` };
    }
    // Get source file size for integrity check
    const sourceSize = fs_1.default.statSync(sourcePath).size;
    // Build descriptive filename: {channel}_{title}_{quality}p_{codec}_{timestamp}.mp4
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = path_1.default.extname(sourcePath) || '.mp4';
    const safeChannel = sanitizeFilename(channelName) || 'Unknown';
    const safeTitle = sanitizeFilename(videoTitle) || 'Video';
    const baseName = `${safeChannel}_${safeTitle}_${quality}p_${codec}_${timestamp}${ext}`;
    const destPath = path_1.default.join(archiveDir, baseName);
    // Copy file (async via execSync cp)
    try {
        // Use Windows copy command for reliability
        (0, child_process_1.execSync)(`copy /Y "${sourcePath}" "${destPath}"`, { stdio: 'ignore' });
    }
    catch {
        return { success: false, error: 'Failed to copy file to archive' };
    }
    // Verify copy succeeded: check file exists AND size matches
    if (!fs_1.default.existsSync(destPath)) {
        return { success: false, error: 'Copy verification failed: destination not found' };
    }
    const destStat = fs_1.default.statSync(destPath);
    if (destStat.size !== sourceSize) {
        // Cleanup failed copy and return error
        try {
            fs_1.default.unlinkSync(destPath);
        }
        catch { }
        return { success: false, error: `Copy verification failed: size mismatch (expected ${sourceSize}, got ${destStat.size})` };
    }
    // Delete original after successful copy
    try {
        if (sourcePath !== destPath)
            fs_1.default.unlinkSync(sourcePath);
    }
    catch { }
    return { success: true, archivedPath: destPath };
}
// Open archive folder in file explorer
function openArchiveFolder() {
    void electron_1.shell.openPath(getArchivePath());
}
// Open a specific rendered file's containing folder
function showInFolder(filePath) {
    electron_1.shell.showItemInFolder(filePath);
}
