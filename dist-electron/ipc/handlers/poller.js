"use strict";
/**
 * Poller IPC handlers.
 * Channels: POLLER_STATUS, POLLER_RESUME, POLLER_PAUSE
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPollerHandlers = registerPollerHandlers;
const channels_js_1 = require("../channels.js");
const youtube_poller_js_1 = require("../../services/youtube_poller.js");
const unified_log_js_1 = require("../../services/unified_log.js");
function registerPollerHandlers(ipcMain) {
    // Poller status: return current YouTubePoller state
    ipcMain.handle(channels_js_1.IPC_CHANNELS.POLLER_STATUS, () => {
        const poller = (0, youtube_poller_js_1.getYouTubePoller)();
        return poller ? poller.getStatus() : null;
    });
    // Resume polling immediately — clears exhaustion backoff
    ipcMain.handle(channels_js_1.IPC_CHANNELS.POLLER_RESUME, () => {
        const poller = (0, youtube_poller_js_1.getYouTubePoller)();
        if (poller) {
            poller.resume();
            unified_log_js_1.opLog.info('system', 'Đã bắt đầu quét kênh');
            return { success: true };
        }
        return { success: false };
    });
    // Pause / stop polling
    ipcMain.handle(channels_js_1.IPC_CHANNELS.POLLER_PAUSE, () => {
        const poller = (0, youtube_poller_js_1.getYouTubePoller)();
        if (poller) {
            poller.pause();
            unified_log_js_1.opLog.info('system', 'Đã tạm dừng quét kênh');
            return { success: true };
        }
        return { success: false };
    });
}
