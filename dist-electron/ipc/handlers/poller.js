/**
 * Poller IPC handlers.
 * Channels: POLLER_STATUS, POLLER_RESUME, POLLER_PAUSE
 */
import { IPC_CHANNELS } from '../channels.js';
import { getYouTubePoller } from '../../services/youtube_poller.js';
import { opLog } from '../../services/unified_log.js';
export function registerPollerHandlers(ipcMain) {
    // Poller status: return current YouTubePoller state
    ipcMain.handle(IPC_CHANNELS.POLLER_STATUS, () => {
        const poller = getYouTubePoller();
        return poller ? poller.getStatus() : null;
    });
    // Resume polling immediately — clears exhaustion backoff
    ipcMain.handle(IPC_CHANNELS.POLLER_RESUME, () => {
        const poller = getYouTubePoller();
        if (poller) {
            poller.resume();
            opLog.info('system', 'Đã bắt đầu quét kênh');
            return { success: true };
        }
        return { success: false };
    });
    // Pause / stop polling
    ipcMain.handle(IPC_CHANNELS.POLLER_PAUSE, () => {
        const poller = getYouTubePoller();
        if (poller) {
            poller.pause();
            opLog.info('system', 'Đã tạm dừng quét kênh');
            return { success: true };
        }
        return { success: false };
    });
}
