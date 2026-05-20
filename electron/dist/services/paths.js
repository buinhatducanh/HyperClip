import path from 'path';
import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';
// ─── Centralized path constants ──────────────────────────────────────────────────
// All hardcoded path literals live here — single source of truth.
// Import from this file instead of duplicating literals.
// Legacy HyperClip data location (AppData\Roaming) — for migration check.
function getLegacyAppDataDir() {
    const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(APPDATA, 'HyperClip');
}
// Find the drive with the most free space (excluding C:).
function findLargestDrive() {
    try {
        const output = execSync('wmic logicaldisk get caption,freespace /format:csv', {
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
export function resolveHyperClipBaseDir() {
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
    const legacyExists = fs.existsSync(appData);
    // Try known locations in order
    const candidates = [
        'D:\\HyperClip-Data',
        'E:\\HyperClip-Data',
        'F:\\HyperClip-Data',
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'app'))) {
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
export function getHyperClipBaseDir() {
    return resolveHyperClipBaseDir();
}
export function getAppStoreDir() {
    return path.join(getHyperClipBaseDir(), 'app');
}
export function getChromeProfilesDir() {
    return path.join(getHyperClipBaseDir(), 'chrome-profiles');
}
export function getRamDiskPath() {
    return process.platform === 'win32' ? 'R:\\hyperclip' : '/mnt/ramdisk/hyperclip';
}
// ─── Project-based subdirectories ───────────────────────────────────────────────
// NEW (2026-05-14): All project data lives in projects/{id}/ folder.
// Channels, downloads, outputs, and archived renders have their own top-level dirs.
/** Root for all 200 GCP project configs, tokens, and stats */
export function getProjectsDir() {
    return path.join(getHyperClipBaseDir(), 'projects');
}
/** Root for channel data: list, seen-videos, uploads cache */
export function getChannelsDir() {
    return path.join(getHyperClipBaseDir(), 'channels');
}
/** Individual project directory */
export function getProjectDir(projectId) {
    return path.join(getProjectsDir(), projectId);
}
/** Project config file */
export function getProjectConfigPath(projectId) {
    return path.join(getProjectDir(projectId), 'config.json');
}
/** Project OAuth token file */
export function getProjectTokenPath(projectId) {
    return path.join(getProjectDir(projectId), 'token.json');
}
/** Project stats file */
export function getProjectStatsPath(projectId) {
    return path.join(getProjectDir(projectId), 'stats.json');
}
/** Channel list file (moved from app/) */
export function getChannelListPath() {
    return path.join(getChannelsDir(), 'list.json');
}
/** Seen videos file (moved from app/) */
export function getSeenVideosPath() {
    return path.join(getChannelsDir(), 'seen-videos.json');
}
/** Uploads playlist cache (moved from app/) */
export function getUploadsCachePath() {
    return path.join(getChannelsDir(), 'uploads-cache.json');
}
// ─── Video storage subdirectories ───────────────────────────────────────────────
export function getDownloadsDir() {
    return path.join(getHyperClipBaseDir(), 'downloads');
}
export function getBlurDir() {
    return path.join(getHyperClipBaseDir(), 'blur');
}
/** Rendered output (BEFORE archive) */
export function getOutputDir() {
    return path.join(getHyperClipBaseDir(), 'output');
}
/** FINAL output — all rendered videos organized by month */
export function getArchivedDir() {
    return path.join(getHyperClipBaseDir(), 'archived');
}
/** Monthly archive subdirectory */
export function getArchivedMonthDir() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return path.join(getArchivedDir(), month);
}
/** App-wide logs directory */
export function getLogsDir() {
    return path.join(getHyperClipBaseDir(), 'logs');
}
// Legacy HyperClip data location (AppData\Roaming) — for migration check.
// Returns the legacy path if present, null otherwise.
export function getLegacyDataPath() {
    const legacy = getLegacyAppDataDir();
    if (fs.existsSync(legacy)) {
        try {
            const files = fs.readdirSync(legacy);
            if (files.length > 0)
                return legacy;
        }
        catch { }
    }
    return null;
}
