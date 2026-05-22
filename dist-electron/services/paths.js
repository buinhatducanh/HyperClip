"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveHyperClipBaseDir = resolveHyperClipBaseDir;
exports.getHyperClipBaseDir = getHyperClipBaseDir;
exports.getAppStoreDir = getAppStoreDir;
exports.getChromeProfilesDir = getChromeProfilesDir;
exports.getRamDiskPath = getRamDiskPath;
exports.getProjectsDir = getProjectsDir;
exports.getChannelsDir = getChannelsDir;
exports.getProjectDir = getProjectDir;
exports.getProjectConfigPath = getProjectConfigPath;
exports.getProjectConfigEncPath = getProjectConfigEncPath;
exports.getProjectTokenPath = getProjectTokenPath;
exports.getProjectTokenEncPath = getProjectTokenEncPath;
exports.getProjectStatsPath = getProjectStatsPath;
exports.getChannelListPath = getChannelListPath;
exports.getSeenVideosPath = getSeenVideosPath;
exports.getUploadsCachePath = getUploadsCachePath;
exports.getDownloadsDir = getDownloadsDir;
exports.getBlurDir = getBlurDir;
exports.getOutputDir = getOutputDir;
exports.getArchivedDir = getArchivedDir;
exports.getArchivedMonthDir = getArchivedMonthDir;
exports.getLogsDir = getLogsDir;
exports.getLegacyDataPath = getLegacyDataPath;
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
// ─── Centralized path constants ──────────────────────────────────────────────────
// All hardcoded path literals live here — single source of truth.
// Import from this file instead of duplicating literals.
// Legacy HyperClip data location (AppData\Roaming) — for migration check.
function getLegacyAppDataDir() {
    const APPDATA = process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming');
    return path_1.default.join(APPDATA, 'HyperClip');
}
// Find the drive with the most free space (excluding C:).
function findLargestDrive() {
    try {
        const output = (0, child_process_1.execSync)('wmic logicaldisk get caption,freespace /format:csv', {
            encoding: 'utf8', windowsHide: true, timeout: 10000,
        });
        const lines = output.trim().split('\n').slice(1); // skip header
        let best = { drive: 'C', free: 0 };
        for (const line of lines) {
            const parts = line.trim().split(',');
            if (parts.length < 3)
                continue;
            const drive = parts[1].replace(':', '');
            const free = parseInt(parts[2], 10) || 0;
            // Prefer non-C drives; skip removable/fixed network drives without media
            if (drive === 'C') {
                if (free > best.free)
                    best = { drive, free };
            }
            else if (free > best.free) {
                best = { drive, free };
            }
        }
        return `${best.drive}:\\HyperClip-Data`;
    }
    catch {
        return 'C:\\HyperClip-Data';
    }
}
// Get the preferred base dir for HyperClip data.
// Priority: env override > existing HyperClip-Data dir > auto-detect largest drive.
// On first run, migrates existing AppData\Roaming\HyperClip data if found.
let _resolvedBaseDir = null;
function resolveHyperClipBaseDir() {
    if (_resolvedBaseDir)
        return _resolvedBaseDir;
    // 1. Env override (for power users / dev)
    const envBase = process.env.HYPERCLIP_DATA_DIR;
    if (envBase) {
        _resolvedBaseDir = envBase;
        return _resolvedBaseDir;
    }
    // 2. Already initialized elsewhere? Use existing HyperClip-Data location.
    const appData = getLegacyAppDataDir();
    const legacyExists = fs_1.default.existsSync(appData);
    // Try known locations in order
    const candidates = [
        'D:\\HyperClip-Data',
        'E:\\HyperClip-Data',
        'F:\\HyperClip-Data',
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(path_1.default.join(candidate, 'app'))) {
            _resolvedBaseDir = candidate;
            return _resolvedBaseDir;
        }
    }
    // 3. Auto-detect: pick drive with most free space.
    // If AppData\HyperClip exists but no HyperClip-Data dir found, migrate.
    const autoBase = findLargestDrive();
    _resolvedBaseDir = autoBase;
    return _resolvedBaseDir;
}
function getHyperClipBaseDir() {
    return resolveHyperClipBaseDir();
}
function getAppStoreDir() {
    return path_1.default.join(getHyperClipBaseDir(), 'app');
}
function getChromeProfilesDir() {
    return path_1.default.join(getHyperClipBaseDir(), 'chrome-profiles');
}
function getRamDiskPath() {
    return process.platform === 'win32' ? 'R:\\hyperclip' : '/mnt/ramdisk/hyperclip';
}
// ─── Project-based subdirectories ───────────────────────────────────────────────
// NEW (2026-05-14): All project data lives in projects/{id}/ folder.
// Channels, downloads, outputs, and archived renders have their own top-level dirs.
/** Root for all 200 GCP project configs, tokens, and stats */
function getProjectsDir() {
    return path_1.default.join(getHyperClipBaseDir(), 'projects');
}
/** Root for channel data: list, seen-videos, uploads cache */
function getChannelsDir() {
    return path_1.default.join(getHyperClipBaseDir(), 'channels');
}
/** Individual project directory */
function getProjectDir(projectId) {
    return path_1.default.join(getProjectsDir(), projectId);
}
/** Project config file (plain JSON — legacy, auto-migrated to .enc.yaml) */
function getProjectConfigPath(projectId) {
    return path_1.default.join(getProjectDir(projectId), 'config.json');
}
/** Project config file (encrypted YAML — replaces config.json) */
function getProjectConfigEncPath(projectId) {
    return path_1.default.join(getProjectDir(projectId), 'config.enc.yaml');
}
/** Project OAuth token file (plain JSON — legacy, auto-migrated) */
function getProjectTokenPath(projectId) {
    return path_1.default.join(getProjectDir(projectId), 'token.json');
}
/** Project OAuth token file (encrypted YAML) */
function getProjectTokenEncPath(projectId) {
    return path_1.default.join(getProjectDir(projectId), 'token.enc.yaml');
}
/** Project stats file */
function getProjectStatsPath(projectId) {
    return path_1.default.join(getProjectDir(projectId), 'stats.json');
}
/** Channel list file (moved from app/) */
function getChannelListPath() {
    return path_1.default.join(getChannelsDir(), 'list.json');
}
/** Seen videos file (moved from app/) */
function getSeenVideosPath() {
    return path_1.default.join(getChannelsDir(), 'seen-videos.json');
}
/** Uploads playlist cache (moved from app/) */
function getUploadsCachePath() {
    return path_1.default.join(getChannelsDir(), 'uploads-cache.json');
}
// ─── Video storage subdirectories ───────────────────────────────────────────────
function getDownloadsDir() {
    return path_1.default.join(getHyperClipBaseDir(), 'downloads');
}
function getBlurDir() {
    return path_1.default.join(getHyperClipBaseDir(), 'blur');
}
/** Rendered output (BEFORE archive) */
function getOutputDir() {
    return path_1.default.join(getHyperClipBaseDir(), 'output');
}
/** FINAL output — all rendered videos organized by month */
function getArchivedDir() {
    return path_1.default.join(getHyperClipBaseDir(), 'archived');
}
/** Monthly archive subdirectory */
function getArchivedMonthDir() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return path_1.default.join(getArchivedDir(), month);
}
/** App-wide logs directory */
function getLogsDir() {
    return path_1.default.join(getHyperClipBaseDir(), 'logs');
}
// Legacy HyperClip data location (AppData\Roaming) — for migration check.
// Returns the legacy path if present, null otherwise.
function getLegacyDataPath() {
    const legacy = getLegacyAppDataDir();
    if (fs_1.default.existsSync(legacy)) {
        try {
            const files = fs_1.default.readdirSync(legacy);
            if (files.length > 0)
                return legacy;
        }
        catch { }
    }
    return null;
}
