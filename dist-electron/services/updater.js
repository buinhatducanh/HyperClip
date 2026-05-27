"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAutoUpdater = initAutoUpdater;
exports.checkForUpdates = checkForUpdates;
exports.downloadUpdate = downloadUpdate;
exports.installUpdate = installUpdate;
exports.getUpdateStatus = getUpdateStatus;
exports.setUpdateEventHandler = setUpdateEventHandler;
exports.stopAutoUpdater = stopAutoUpdater;
/**
 * HyperClip Auto-Update Service — Electron main process.
 *
 * Uses electron-updater to:
 *  - Check for updates on startup + every 6 hours
 *  - Auto-download in background
 *  - Notify user of available updates
 *  - Apply update on app restart
 *
 * The update server (license-server or separate CDN) serves:
 *   GET /updates/manifest.json   — electron-updater compatible manifest
 *   GET /updates/HyperClip-{version}-full.zip
 *   GET /updates/HyperClip-{from}-to-{to}.zip  (differential)
 *
 * NOTE: electron-updater must be installed: pnpm add electron-updater
 *       (suppress TS errors until installed — module lives in .pnpm/ virtual store)
 */
// @ts-nocheck
const electron_1 = require("electron");
const unified_log_js_1 = require("./unified_log.js");
// electron-updater is a production dependency — install via: pnpm add electron-updater
// Uses dynamic import with type suppression since module lives in .pnpm/ virtual store
// @ts-ignore
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let _autoUpdater = null;
let _updateAvailable = false;
let _latestVersion = null;
let _downloadProgress = 0;
let _checkingTimer = null;
let _initialized = false;
async function getAutoUpdater() {
    if (_autoUpdater)
        return _autoUpdater;
    try {
        const mod = await import('electron-updater');
        _autoUpdater = mod.autoUpdater;
        return _autoUpdater;
    }
    catch {
        unified_log_js_1.log.warn('[AutoUpdater] electron-updater not available — auto-update disabled');
        return null;
    }
}
// ─── Init ──────────────────────────────────────────────────────────────────────
async function initAutoUpdater() {
    const autoUpdater = await getAutoUpdater();
    if (!autoUpdater)
        return;
    // Configure auto-updater
    autoUpdater.autoDownload = false; // User-triggered download
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.disableWebInstaller = false;
    // Events
    autoUpdater.on('checking-for-update', () => {
        unified_log_js_1.log.info('[AutoUpdater] Checking for updates...');
    });
    autoUpdater.on('update-available', (info) => {
        _updateAvailable = true;
        _latestVersion = info.version;
        unified_log_js_1.log.info(`[AutoUpdater] Update available: v${info.version}`);
        sendUpdateEvent('available', { version: info.version, releaseNotes: info.releaseNotes });
    });
    autoUpdater.on('update-not-available', (info) => {
        unified_log_js_1.log.info(`[AutoUpdater] No update available (current: ${electron_1.app.getVersion()})`);
    });
    autoUpdater.on('download-progress', (progress) => {
        _downloadProgress = Math.round(progress.percent);
        sendUpdateEvent('progress', {
            percent: _downloadProgress,
            transferred: progress.transferred,
            total: progress.total,
        });
    });
    autoUpdater.on('update-downloaded', (info) => {
        unified_log_js_1.log.info(`[AutoUpdater] Update downloaded: v${info.version}`);
        _downloadProgress = 100;
        sendUpdateEvent('downloaded', { version: info.version });
    });
    autoUpdater.on('error', (err) => {
        unified_log_js_1.log.warn(`[AutoUpdater] Error: ${err?.message}`);
    });
    // Periodic check every 6 hours
    _checkingTimer = setInterval(async () => {
        await checkForUpdates();
    }, UPDATE_CHECK_INTERVAL_MS);
    _initialized = true;
    unified_log_js_1.log.info('[AutoUpdater] Initialized');
}
// ─── Check & download ─────────────────────────────────────────────────────────
async function checkForUpdates() {
    const autoUpdater = await getAutoUpdater();
    if (!autoUpdater)
        return { available: false };
    try {
        const result = await autoUpdater.checkForUpdates();
        if (result?.updateInfo) {
            return { available: true, version: result.updateInfo.version };
        }
        return { available: false };
    }
    catch (err) {
        unified_log_js_1.log.warn(`[AutoUpdater] Check failed: ${err?.message}`);
        return { available: false };
    }
}
async function downloadUpdate() {
    const autoUpdater = await getAutoUpdater();
    if (!autoUpdater)
        return false;
    try {
        await autoUpdater.downloadUpdate();
        return true;
    }
    catch (err) {
        unified_log_js_1.log.warn(`[AutoUpdater] Download failed: ${err?.message}`);
        return false;
    }
}
function installUpdate() {
    if (_autoUpdater) {
        _autoUpdater.quitAndInstall(false, true); // installNow=false, forceRunAfter=true
    }
}
// ─── Status ───────────────────────────────────────────────────────────────────
function getUpdateStatus() {
    return { available: _updateAvailable, version: _latestVersion ?? undefined, progress: _downloadProgress };
}
let _updateEventHandler = null;
function setUpdateEventHandler(handler) {
    _updateEventHandler = handler;
}
function sendUpdateEvent(type, data) {
    if (_updateEventHandler) {
        _updateEventHandler(type, data);
    }
}
function stopAutoUpdater() {
    if (_checkingTimer) {
        clearInterval(_checkingTimer);
        _checkingTimer = null;
    }
}
