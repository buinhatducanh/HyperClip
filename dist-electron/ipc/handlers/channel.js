"use strict";
/**
 * Channel IPC handlers.
 * Channels: CHANNEL_INFO, CHANNEL_LIST, CHANNEL_SYNC, CHANNEL_ADD,
 *           CHANNEL_UPDATE, CHANNEL_REMOVE, CHANNEL_UNSUBSCRIBE, CHANNEL_BULK_ADD
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChannelHandlers = registerChannelHandlers;
const channels_js_1 = require("../channels.js");
const store_js_1 = require("../../services/store.js");
const youtube_js_1 = require("../../services/youtube.js");
const cookie_manager_js_1 = require("../../services/cookie_manager.js");
const subscription_feed_js_1 = require("../../services/subscription_feed.js");
const youtube_auth_js_1 = require("../../services/youtube_auth.js");
const token_manager_js_1 = require("../../services/token_manager.js");
const unified_log_js_1 = require("../../services/unified_log.js");
const CHANNEL_COLORS = ['#00B4FF', '#7C3AED', '#00FF88', '#FF6B35', '#FF0080', '#FFB800'];
function registerChannelHandlers(ipcMain) {
    ipcMain.handle(channels_js_1.IPC_CHANNELS.CHANNEL_INFO, async (_, url) => {
        return (0, youtube_js_1.getChannelInfo)(url);
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.CHANNEL_LIST, async () => {
        return (0, store_js_1.getChannels)();
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.CHANNEL_SYNC, async () => {
        const cm = (0, cookie_manager_js_1.getCookieManager)();
        const result = await cm.syncSubscriptionList();
        (0, subscription_feed_js_1.refreshChannelCache)();
        return result;
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.CHANNEL_ADD, async (_, url) => {
        const urlTrimmed = url.trim();
        if (!urlTrimmed)
            return null;
        // ── Extract channel ID / handle from URL ─────────────────────────────────────
        let channelId;
        let handle;
        try {
            const normalized = urlTrimmed.startsWith('http') ? urlTrimmed : 'https://www.youtube.com/' + urlTrimmed;
            const u = new URL(normalized);
            const pathname = u.pathname;
            const m = pathname.match(/^\/(channel\/|@|c\/|user\/)?([\w.-]+)/);
            if (m) {
                if (pathname.startsWith('/channel/'))
                    channelId = m[2];
                else if (pathname.startsWith('/@'))
                    handle = '@' + m[2];
                else if (pathname.startsWith('/c/') || pathname.startsWith('/user/'))
                    handle = m[2];
                else
                    handle = '@' + m[2];
            }
        }
        catch { /* ignore URL parse errors */ }
        // ── Duplicate check ───────────────────────────────────────────────────────────
        const existing = (0, store_js_1.getChannels)();
        const isDupe = existing.some((ch) => {
            if (channelId && ch.channelId === channelId)
                return true;
            if (handle && ch.handle?.toLowerCase() === handle.toLowerCase())
                return true;
            return false;
        });
        if (isDupe) {
            console.warn(`[CHANNEL_ADD] Duplicate channel: ${channelId || handle || urlTrimmed}`);
            return null;
        }
        // ── Fetch channel metadata ───────────────────────────────────────────────────
        let name;
        let avatarUrl;
        try {
            const info = await (0, youtube_js_1.getChannelInfo)(urlTrimmed);
            if (info && info.channelName) {
                name = info.channelName;
                channelId = info.channelId || channelId;
                handle = info.handle || handle;
                avatarUrl = info.avatarUrl;
            }
            else {
                throw new Error('no channel info');
            }
        }
        catch {
            const raw = urlTrimmed
                .replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/|@|c\/|user\/)?/, '')
                .split(/[/?]/)[0]
                .replace(/^@/, '') || 'Kênh Mới';
            name = raw.charAt(0).toUpperCase() + raw.slice(1);
            if (!handle)
                handle = '@' + raw.toLowerCase().replace(/\s+/g, '');
        }
        // ── Save ─────────────────────────────────────────────────────────────────────
        const newCh = {
            id: `ch${Date.now()}`,
            name,
            handle: handle || `@${channelId || name}`,
            avatarColor: CHANNEL_COLORS[existing.length % CHANNEL_COLORS.length],
            channelId,
            avatarUrl,
            createdAt: new Date().toISOString(),
        };
        const saved = (0, store_js_1.addChannel)(newCh);
        (0, subscription_feed_js_1.refreshChannelCache)();
        return saved;
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.CHANNEL_UPDATE, async (_, id, patch) => {
        return (0, store_js_1.updateChannel)(id, patch);
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.CHANNEL_REMOVE, async (_, id) => {
        return (0, store_js_1.removeChannel)(id);
    });
    // ── Unsubscribe from YouTube ─────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.CHANNEL_UNSUBSCRIBE, async (_, id) => {
        const channels = (0, store_js_1.getChannels)();
        const ch = channels.find(c => c.id === id);
        if (!ch)
            return { success: false, error: 'Channel not found' };
        if (!ch.channelId)
            return { success: false, error: 'No YouTube channel ID' };
        const tokenData = await (0, token_manager_js_1.getTokenManager)().getBestAvailable(ch.channelId);
        if (!tokenData)
            return { success: false, error: 'No OAuth token available — please configure OAuth credentials in Settings' };
        (0, unified_log_js_1.devLog)(`[CHANNEL_UNSUBSCRIBE] Unsubscribing from ${ch.name} (${ch.channelId})`);
        const result = await (0, youtube_auth_js_1.unsubscribeChannel)(tokenData.token, ch.channelId);
        if (result.success) {
            // Also remove from local tracking
            (0, store_js_1.removeChannel)(id);
            (0, subscription_feed_js_1.refreshChannelCache)();
            (0, unified_log_js_1.devLog)(`[CHANNEL_UNSUBSCRIBE] Success — ${ch.name} unsubscribed and removed from tracking`);
        }
        return result;
    });
    // ── Bulk add ─────────────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.CHANNEL_BULK_ADD, async (_, urls) => {
        const results = [];
        for (const url of urls) {
            const trimmed = url.trim();
            if (!trimmed)
                continue;
            try {
                let name;
                let handle;
                let channelId;
                let avatarUrl;
                try {
                    const info = await (0, youtube_js_1.getChannelInfo)(trimmed);
                    if (info) {
                        name = info.channelName;
                        handle = info.handle || `@${info.channelId}`;
                        channelId = info.channelId;
                        avatarUrl = info.avatarUrl;
                    }
                    else {
                        throw new Error('no info');
                    }
                }
                catch {
                    const raw = trimmed.replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/)?/, '').split(/[/?]/)[0] || 'Kênh Mới';
                    name = raw.charAt(0).toUpperCase() + raw.slice(1);
                    handle = `@${raw.toLowerCase()}`;
                }
                const channels = (0, store_js_1.getChannels)();
                const newCh = {
                    id: `ch${Date.now()}`,
                    name,
                    handle,
                    avatarColor: CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length],
                    channelId,
                    avatarUrl,
                    createdAt: new Date().toISOString(),
                };
                (0, store_js_1.addChannel)(newCh);
                results.push({ url: trimmed, success: true });
            }
            catch (err) {
                results.push({ url: trimmed, success: false, error: err.message });
            }
        }
        (0, subscription_feed_js_1.refreshChannelCache)();
        return results;
    });
}
