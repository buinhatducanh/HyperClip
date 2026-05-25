"use strict";
/**
 * Session + Logs IPC handlers.
 * Channels: SESSION_LIST, SESSION_REFRESH_ALL, SESSION_OPEN_LOGIN, SESSION_CLONE_ONE,
 *   logs:read, logs:export
 */
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
exports.registerSessionHandlers = registerSessionHandlers;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const channels_js_1 = require("../channels.js");
const chrome_cookies_js_1 = require("../../services/chrome_cookies.js");
const diagnostics_js_1 = require("../../services/diagnostics.js");
const ramdisk_js_1 = require("../../services/ramdisk.js");
const unified_log_js_1 = require("../../services/unified_log.js");
function registerSessionHandlers(ipcMain, getMainWindow) {
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SESSION_LIST, async () => {
        const sm = (0, chrome_cookies_js_1.getSessionManager)();
        // Return current state immediately — do NOT await ensureInit() which blocks
        // for 15+ seconds while loading 30 Chrome profile cookies via DPAPI.
        // The frontend handles missing data gracefully with its own 8s timeout.
        return sm.getStatus();
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SESSION_REFRESH_ALL, async () => {
        const sm = (0, chrome_cookies_js_1.getSessionManager)();
        const count = await sm.refreshAll();
        return { success: true, refreshedCount: count };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SESSION_OPEN_LOGIN, async (_, profileId) => {
        const sm = (0, chrome_cookies_js_1.getSessionManager)();
        const cookiesExtracted = await sm.openLoginWindow(profileId);
        return { success: true, cookiesExtracted };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SESSION_CLONE_ONE, async () => {
        const sm = (0, chrome_cookies_js_1.getSessionManager)();
        return sm.cloneSessionOne();
    });
    // ─── Log Export ─────────────────────────────────────────────────────────────
    ipcMain.handle('logs:read', async () => {
        return (0, unified_log_js_1.readFileLogs)();
    });
    ipcMain.handle('logs:disk-usage', async () => {
        return (0, unified_log_js_1.getLogDiskUsage)();
    });
    ipcMain.handle('logs:cleanup', async () => {
        return (0, unified_log_js_1.cleanupOldLogs)();
    });
    ipcMain.handle('logs:export', async () => {
        const logDir = (0, unified_log_js_1.getLogDir)();
        const tmpDir = path_1.default.join(os_1.default.tmpdir(), 'hyperclip-logs-' + Date.now());
        fs_1.default.mkdirSync(tmpDir, { recursive: true });
        // System snapshot
        fs_1.default.writeFileSync(path_1.default.join(tmpDir, 'system_info.txt'), (0, unified_log_js_1.getSystemSnapshot)());
        // Log files
        try {
            for (const fname of fs_1.default.readdirSync(logDir)) {
                if (!fname.startsWith('hyperclip'))
                    continue;
                fs_1.default.copyFileSync(path_1.default.join(logDir, fname), path_1.default.join(tmpDir, fname));
            }
        }
        catch { }
        // Crash dumps
        const { app: electronApp } = await Promise.resolve().then(() => __importStar(require('electron')));
        const crashDir = path_1.default.join(electronApp.getPath('crashDumps'));
        if (fs_1.default.existsSync(crashDir)) {
            try {
                fs_1.default.mkdirSync(path_1.default.join(tmpDir, 'crash_dumps'), { recursive: true });
                for (const fname of fs_1.default.readdirSync(crashDir)) {
                    if (fname.endsWith('.dmp') || fname.endsWith('.mdmp')) {
                        fs_1.default.copyFileSync(path_1.default.join(crashDir, fname), path_1.default.join(tmpDir, 'crash_dumps', fname));
                    }
                }
            }
            catch { }
        }
        // Diagnostics
        try {
            const diag = await (0, diagnostics_js_1.runDiagnostics)();
            fs_1.default.writeFileSync(path_1.default.join(tmpDir, 'diagnostics.json'), JSON.stringify(diag, null, 2));
        }
        catch { }
        // Settings
        try {
            const settings = (0, ramdisk_js_1.loadSettings)();
            fs_1.default.writeFileSync(path_1.default.join(tmpDir, 'settings.json'), JSON.stringify(settings, null, 2));
        }
        catch { }
        // Save as zip
        const zipPath = path_1.default.join(os_1.default.tmpdir(), `hyperclip-logs-${new Date().toISOString().slice(0, 10)}.zip`);
        const mainWindow = getMainWindow();
        const saveResult = await electron_1.dialog.showSaveDialog(mainWindow, {
            title: 'Lưu file log',
            defaultPath: zipPath,
            filters: [{ name: 'ZIP', extensions: ['zip'] }],
        });
        if (saveResult.canceled || !saveResult.filePath)
            return { success: false };
        try {
            (0, child_process_1.execSync)(`powershell -Command "Compress-Archive -Path '${tmpDir}\\*' -DestinationPath '${saveResult.filePath}' -Force"`, { stdio: 'ignore' });
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
            electron_1.shell.showItemInFolder(saveResult.filePath);
            return { success: true, path: saveResult.filePath };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    });
}
