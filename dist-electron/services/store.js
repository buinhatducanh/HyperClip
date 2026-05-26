"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._invalidateChannelCache = _invalidateChannelCache;
exports.getChannels = getChannels;
exports.getChannel = getChannel;
exports.addChannel = addChannel;
exports.updateChannel = updateChannel;
exports.pauseChannel = pauseChannel;
exports.resumeChannel = resumeChannel;
exports.removeChannel = removeChannel;
exports.getWorkspaces = getWorkspaces;
exports.getWorkspace = getWorkspace;
exports.addWorkspace = addWorkspace;
exports.updateWorkspace = updateWorkspace;
exports.deleteWorkspace = deleteWorkspace;
exports.getWorkspacesByStatus = getWorkspacesByStatus;
exports.getWorkspacesByChannel = getWorkspacesByChannel;
exports.getStatusCounts = getStatusCounts;
exports.clearDoneWorkspaces = clearDoneWorkspaces;
exports.getRenderedVideos = getRenderedVideos;
exports.addRenderedVideo = addRenderedVideo;
exports.removeRenderedVideo = removeRenderedVideo;
exports.getRenderedVideosByChannel = getRenderedVideosByChannel;
exports.loadSeenVideos = loadSeenVideos;
exports.saveSeenVideos = saveSeenVideos;
exports.markVideoSeen = markVideoSeen;
exports.isVideoSeen = isVideoSeen;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const paths_js_1 = require("./paths.js");
const STORE_DIR = (0, paths_js_1.getAppStoreDir)();
const STORE_FILE = path_1.default.join(STORE_DIR, 'workspaces.json');
const FILE_INDEX_TTL_MS = 60_000; // 1 minute — file index cache TTL
// Resolve a stored downloadedPath to an absolute filesystem path.
// Cross-machine compatible: store only filename, resolve using current machine's storage dir.
function resolveDownloadedPath(storedPath) {
    if (!storedPath)
        return '';
    if (path_1.default.isAbsolute(storedPath))
        return storedPath; // legacy: already absolute
    // storedPath is just a filename — scan for it in known storage dirs
    const found = findDownloadedFileByName(storedPath);
    if (found)
        return found;
    // Fallback: construct from primary storage dir
    return path_1.default.join(getVideoStorageDir(), storedPath);
}
// Find a file by filename across known storage directories.
function findDownloadedFileByName(filename) {
    for (const dir of getKnownStorageDirs()) {
        try {
            const fullPath = path_1.default.join(dir, filename);
            if (fs_1.default.existsSync(fullPath))
                return fullPath;
        }
        catch { }
    }
    return null;
}
// All directories that might contain downloaded video files.
function getKnownStorageDirs() {
    const dirs = [];
    // RAM disk (if available) — highest priority
    if (isRamDiskAvailable())
        dirs.push((0, paths_js_1.getRamDiskPath)());
    // Primary storage — same fallback chain as getVideoStoragePath()
    dirs.push((0, paths_js_1.getDownloadsDir)());
    // Legacy store dir (D:\HyperClip-Data\app\downloads) — only add if different from primary
    const legacyDir = path_1.default.join(STORE_DIR, 'downloads');
    if (!dirs.includes(legacyDir))
        dirs.push(legacyDir);
    // Legacy temp path
    dirs.push(path_1.default.join(os_1.default.tmpdir(), 'hyperclip-video'));
    return dirs;
}
// Get the primary video storage directory for this machine.
// NOTE: This is used for the workspaces JSON store location (D:\HyperClip-Data\app\).
// For actual video storage, use getVideoStoragePath() which checks configured/user paths.
function getVideoStorageDir() {
    try {
        if (fs_1.default.existsSync((0, paths_js_1.getRamDiskPath)()))
            return (0, paths_js_1.getRamDiskPath)();
    }
    catch { }
    return (0, paths_js_1.getDownloadsDir)();
}
function isRamDiskAvailable() {
    try {
        return fs_1.default.existsSync((0, paths_js_1.getRamDiskPath)());
    }
    catch {
        return false;
    }
}
// Extract just the filename from a downloadedPath for storage.
// Cross-machine: only ever store the filename, never an absolute path.
function makeStorableDownloadedPath(absPath) {
    if (!absPath)
        return '';
    // Already just a filename
    if (!path_1.default.isAbsolute(absPath))
        return path_1.default.basename(absPath);
    // Absolute → extract basename (filename only)
    return path_1.default.basename(absPath);
}
// ─── Channel store ───────────────────────────────────────────────────────────────
// Channel list stored in channels/ directory (project-based structure)
const CHANNELS_FILE = (0, paths_js_1.getChannelListPath)();
// Seen videos stored in channels/ directory
const SEEN_VIDEOS_FILE = (0, paths_js_1.getSeenVideosPath)();
const RENDERED_FILE = path_1.default.join(STORE_DIR, 'rendered.json');
// Empty default — user adds their own channels via onboarding
const DEFAULT_CHANNELS = [];
// In-memory cache with 60s TTL — avoids disk I/O on every poll (every 5s).
let _channelCache = null;
let _channelCacheAt = 0;
const CHANNEL_CACHE_TTL_MS = 60_000;
function loadChannels() {
    const now = Date.now();
    if (_channelCache && now - _channelCacheAt < CHANNEL_CACHE_TTL_MS) {
        return _channelCache;
    }
    ensureDir();
    if (!fs_1.default.existsSync(CHANNELS_FILE)) {
        fs_1.default.writeFileSync(CHANNELS_FILE, JSON.stringify(DEFAULT_CHANNELS, null, 2), 'utf-8');
        _channelCache = [...DEFAULT_CHANNELS];
        _channelCacheAt = now;
        return _channelCache;
    }
    try {
        _channelCache = JSON.parse(fs_1.default.readFileSync(CHANNELS_FILE, 'utf-8'));
        _channelCacheAt = now;
        return _channelCache;
    }
    catch {
        return [];
    }
}
/** Invalidate the channel cache — call after any add/update/remove. */
function _invalidateChannelCache() {
    _channelCache = null;
    _channelCacheAt = 0;
}
function saveChannels(channels) {
    ensureDir();
    fs_1.default.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2), 'utf-8');
}
function getChannels() {
    return loadChannels();
}
function getChannel(id) {
    return loadChannels().find(c => c.id === id) || null;
}
function addChannel(channel) {
    const channels = loadChannels();
    channels.push(channel);
    saveChannels(channels);
    _invalidateChannelCache();
    return channel;
}
function updateChannel(id, patch) {
    const channels = loadChannels();
    const idx = channels.findIndex(c => c.id === id);
    if (idx === -1)
        return null;
    channels[idx] = { ...channels[idx], ...patch };
    saveChannels(channels);
    _invalidateChannelCache();
    return channels[idx];
}
function pauseChannel(id) {
    const channels = loadChannels();
    const idx = channels.findIndex(c => c.id === id);
    if (idx === -1)
        return false;
    channels[idx].paused = true;
    saveChannels(channels);
    _invalidateChannelCache();
    return true;
}
function resumeChannel(id) {
    const channels = loadChannels();
    const idx = channels.findIndex(c => c.id === id);
    if (idx === -1)
        return false;
    channels[idx].paused = false;
    saveChannels(channels);
    _invalidateChannelCache();
    return true;
}
function removeChannel(id) {
    const channels = loadChannels();
    const before = channels.length;
    const filtered = channels.filter(c => c.id !== id);
    if (filtered.length === before)
        return false;
    saveChannels(filtered);
    _invalidateChannelCache();
    return true;
}
// ─── Subscription store (DEPRECATED — WebSub removed, keeping for compat) ───
function loadSubscriptions() {
    // subscriptions.json was used by WebSub which has been removed.
    // Return empty — channel names now come from channels.json.
    return [];
}
// Ensure store file exists
function ensureDir() {
    if (!fs_1.default.existsSync(STORE_DIR)) {
        fs_1.default.mkdirSync(STORE_DIR, { recursive: true });
    }
    // Ensure new directories exist (project-based structure, 2026-05-14)
    if (!fs_1.default.existsSync((0, paths_js_1.getChannelsDir)())) {
        fs_1.default.mkdirSync((0, paths_js_1.getChannelsDir)(), { recursive: true });
    }
    if (!fs_1.default.existsSync((0, paths_js_1.getProjectsDir)())) {
        fs_1.default.mkdirSync((0, paths_js_1.getProjectsDir)(), { recursive: true });
    }
}
function ensureStore() {
    ensureDir();
    if (!fs_1.default.existsSync(STORE_FILE)) {
        const initial = { workspaces: [], version: 1 };
        fs_1.default.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    }
}
// Load store from disk
function loadStore() {
    ensureStore();
    try {
        const raw = fs_1.default.readFileSync(STORE_FILE, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return { workspaces: [], version: 1 };
    }
}
// Save store to disk
function saveStore(store) {
    ensureStore();
    fs_1.default.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}
// Get all workspaces
function getWorkspaces() {
    return loadStore().workspaces.map(resolveWorkspacePaths);
}
// Get workspace by ID
function getWorkspace(id) {
    const store = loadStore();
    const ws = store.workspaces.find(ws => ws.id === id);
    if (!ws)
        return null;
    return resolveWorkspacePaths(ws);
}
// Resolve relative downloadedPath → absolute, and scan for missing files.
function resolveWorkspacePaths(ws) {
    if (!ws.downloadedPath)
        return ws;
    const absPath = resolveDownloadedPath(ws.downloadedPath);
    if (fs_1.default.existsSync(absPath))
        return { ...ws, downloadedPath: absPath };
    // File not found at stored path — scan storage dirs for a file matching this workspaceId
    const found = findDownloadedFile(ws.id);
    if (found && fs_1.default.existsSync(found))
        return { ...ws, downloadedPath: found };
    // Auto-downloaded files are named {videoId}_{videoId}.mp4 (workspaceId = videoId).
    // findDownloadedFile may miss them due to stale file-index cache.
    // Scan storage dirs directly for a file starting with the videoId.
    if (ws.videoId) {
        for (const dir of getKnownStorageDirs()) {
            try {
                if (!fs_1.default.existsSync(dir))
                    continue;
                const files = fs_1.default.readdirSync(dir).filter(f => f.startsWith(ws.videoId + '_') && /\.(mp4|webm|mkv)$/i.test(f));
                if (files.length > 0) {
                    return { ...ws, downloadedPath: path_1.default.join(dir, files[0]) };
                }
            }
            catch { }
        }
    }
    return {
        ...ws,
        downloadedPath: found || absPath, // use found path, or keep stored path (will be flagged as missing)
    };
}
// Scan known storage directories for a file matching {workspaceId}_*.mp4
// Uses in-memory cache with 60s TTL to avoid O(n) scans on every workspace load.
const _fileIndexCache = new Map();
let _fileIndexLastBuild = 0;
function rebuildFileIndex() {
    _fileIndexCache.clear();
    for (const dir of getKnownStorageDirs()) {
        try {
            if (!fs_1.default.existsSync(dir))
                continue;
            const files = fs_1.default.readdirSync(dir).filter(f => f.endsWith('.mp4'));
            for (const file of files) {
                // Pattern: workspaceId_filename.mp4 or workspaceId.mp4
                const base = file.replace(/\.mp4$/, '');
                const underscoreIdx = base.indexOf('_');
                const workspaceId = underscoreIdx !== -1 ? base.slice(0, underscoreIdx) : base;
                if (workspaceId) {
                    _fileIndexCache.set(workspaceId, { absPath: path_1.default.join(dir, file), cachedAt: Date.now() });
                }
            }
        }
        catch { }
    }
    _fileIndexLastBuild = Date.now();
}
function findDownloadedFile(workspaceId) {
    // Serve from cache if fresh
    const now = Date.now();
    if (now - _fileIndexLastBuild > FILE_INDEX_TTL_MS) {
        rebuildFileIndex();
    }
    const cached = _fileIndexCache.get(workspaceId);
    if (cached)
        return cached.absPath;
    // Not in cache — rebuild and check again (new file)
    rebuildFileIndex();
    return _fileIndexCache.get(workspaceId)?.absPath ?? null;
}
// Add new workspace
function addWorkspace(data) {
    const store = loadStore();
    const now = new Date().toISOString();
    const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const workspace = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
    };
    store.workspaces.push(workspace);
    saveStore(store);
    return workspace;
}
// Update workspace
function updateWorkspace(id, patch) {
    const store = loadStore();
    const idx = store.workspaces.findIndex(ws => ws.id === id);
    if (idx === -1)
        return null;
    // Convert downloadedPath to filename before persisting (cross-machine compatible)
    const normalizedPatch = { ...patch };
    if (normalizedPatch.downloadedPath) {
        normalizedPatch.downloadedPath = makeStorableDownloadedPath(normalizedPatch.downloadedPath);
    }
    store.workspaces[idx] = {
        ...store.workspaces[idx],
        ...normalizedPatch,
        updatedAt: new Date().toISOString(),
    };
    saveStore(store);
    return resolveWorkspacePaths(store.workspaces[idx]);
}
// Delete workspace
function deleteWorkspace(id) {
    const store = loadStore();
    const idx = store.workspaces.findIndex(ws => ws.id === id);
    if (idx === -1)
        return false;
    store.workspaces.splice(idx, 1);
    saveStore(store);
    return true;
}
// Get workspaces by status
function getWorkspacesByStatus(status) {
    return getWorkspaces().filter(ws => ws.status === status);
}
// Get workspaces by channel
function getWorkspacesByChannel(channelId) {
    return getWorkspaces().filter(ws => ws.channelId === channelId);
}
// Count workspaces by status
function getStatusCounts() {
    const workspaces = getWorkspaces();
    return {
        waiting: workspaces.filter(w => w.status === 'waiting').length,
        downloading: workspaces.filter(w => w.status === 'downloading').length,
        ready: workspaces.filter(w => w.status === 'ready').length,
        editing: workspaces.filter(w => w.status === 'editing').length,
        rendering: workspaces.filter(w => w.status === 'rendering').length,
        done: workspaces.filter(w => w.status === 'done').length,
        error: workspaces.filter(w => w.status === 'error').length,
    };
}
// Clear all done workspaces
function clearDoneWorkspaces() {
    const store = loadStore();
    const before = store.workspaces.length;
    store.workspaces = store.workspaces.filter(ws => ws.status !== 'done');
    saveStore(store);
    return before - store.workspaces.length;
}
// ─── Rendered videos store ───────────────────────────────────────────────────────
const MAX_RENDERED_ENTRIES = 500;
const MAX_RENDERED_DAYS = 30;
function loadRendered() {
    ensureDir();
    if (!fs_1.default.existsSync(RENDERED_FILE))
        return [];
    try {
        return JSON.parse(fs_1.default.readFileSync(RENDERED_FILE, 'utf-8'));
    }
    catch {
        return [];
    }
}
function saveRendered(videos) {
    ensureDir();
    fs_1.default.writeFileSync(RENDERED_FILE, JSON.stringify(videos, null, 2), 'utf-8');
}
// Prune oldest entries if over limit or older than MAX_RENDERED_DAYS
function pruneRenderedVideos(videos) {
    const cutoffMs = Date.now() - MAX_RENDERED_DAYS * 24 * 60 * 60 * 1000;
    const pruned = videos
        .filter(v => new Date(v.renderedAt).getTime() > cutoffMs)
        .slice(0, MAX_RENDERED_ENTRIES);
    return pruned;
}
function getRenderedVideos() {
    return loadRendered();
}
function addRenderedVideo(video) {
    const all = loadRendered();
    all.unshift(video); // newest first
    const pruned = pruneRenderedVideos(all);
    saveRendered(pruned);
}
function removeRenderedVideo(id) {
    const all = loadRendered();
    const filtered = all.filter(v => v.id !== id);
    saveRendered(filtered);
    return filtered.length !== all.length;
}
function getRenderedVideosByChannel(channelId) {
    return loadRendered().filter(v => v.channelId === channelId);
}
function loadSeenVideos() {
    try {
        if (fs_1.default.existsSync(SEEN_VIDEOS_FILE)) {
            let text = fs_1.default.readFileSync(SEEN_VIDEOS_FILE, 'utf-8');
            // Strip BOM (byte order mark) that PowerShell or other editors may inject
            if (text.charCodeAt(0) === 0xFEFF)
                text = text.slice(1);
            const raw = JSON.parse(text);
            // Filter out expired entries
            const now = Date.now();
            for (const chId of Object.keys(raw)) {
                if (raw[chId].expiresAt <= now) {
                    delete raw[chId];
                }
            }
            return raw;
        }
    }
    catch (e) {
        console.warn('[store] loadSeenVideos failed:', e);
    }
    return {};
}
function saveSeenVideos(store) {
    try {
        if (!fs_1.default.existsSync(STORE_DIR)) {
            fs_1.default.mkdirSync(STORE_DIR, { recursive: true });
        }
        fs_1.default.writeFileSync(SEEN_VIDEOS_FILE, JSON.stringify(store, null, 2), 'utf-8');
    }
    catch (e) {
        console.warn('[store] saveSeenVideos failed:', e);
    }
}
function markVideoSeen(channelId, videoId) {
    const store = loadSeenVideos();
    if (!store[channelId]) {
        store[channelId] = { ids: [], expiresAt: Date.now() + 48 * 60 * 60 * 1000 };
    }
    store[channelId].ids = [...new Set([...store[channelId].ids, videoId])];
    saveSeenVideos(store);
}
function isVideoSeen(channelId, videoId) {
    const store = loadSeenVideos();
    return store[channelId]?.ids.includes(videoId) ?? false;
}
// Initialize store on module load
ensureStore();
