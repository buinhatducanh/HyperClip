"use strict";
/**
 * Settings IPC handlers.
 * Channels: SETTINGS_GET, SETTINGS_UPDATE
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSettingsHandlers = registerSettingsHandlers;
const channels_js_1 = require("../channels.js");
const ramdisk_js_1 = require("../../services/ramdisk.js");
const youtube_poller_js_1 = require("../../services/youtube_poller.js");
function registerSettingsHandlers(ipcMain, onSettingsChanged) {
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SETTINGS_GET, () => {
        const settings = (0, ramdisk_js_1.loadSettings)();
        // SECURITY: strip sensitive fields
        const { proxyPassword, ...publicSettings } = settings;
        return publicSettings;
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.SETTINGS_UPDATE, (_, patch) => {
        const settings = (0, ramdisk_js_1.loadSettings)();
        const patchToSave = { ...patch };
        // Clear hardwareProfile when set to null
        if (patch.hardwareProfile === null) {
            delete settings.hardwareProfile;
        }
        (0, ramdisk_js_1.saveSettings)({ ...settings, ...patchToSave });
        // Apply poller interval change immediately if poller is running
        if (patch.pollIntervalMs !== undefined) {
            const poller = (0, youtube_poller_js_1.getYouTubePoller)();
            if (poller)
                poller.restart(patch.pollIntervalMs);
        }
        // Notify main thread of settings change (poller lifecycle, etc.)
        onSettingsChanged?.();
        return (0, ramdisk_js_1.loadSettings)();
    });
}
