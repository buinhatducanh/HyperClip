/**
 * Cookie Manager — HyperClip
 *
 * Pure OAuth approach: YouTube Data API v3 doesn't need browser cookies.
 * - OAuth tokens handle API authentication
 * - activities?home=true works with OAuth Bearer token
 * - yt-dlp uses OAuth tokens for downloads (via --no-playlist)
 *
 * The only "cookies" we need are the Netscape-format cookie file
 * which yt-dlp can generate from OAuth session.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';
import { getChannels, addChannel } from './store.js';
import { devLog } from './unified_log.js';
import { getAppStoreDir } from './paths.js';
// ─── Auth Event Bus ─────────────────────────────────────────────────────────────
export const authEvents = new EventEmitter();
export const channelEvents = new EventEmitter();
// ─── Cookie Manager Implementation ─────────────────────────────────────────────
class ElectronCookieManager {
    _cookieFile = '';
    _cookies = [];
    _lastRefresh = 0;
    _refreshTimer = null;
    _subSyncTimer = null;
    _initPromise = null;
    _cookieCriticalCount = 0;
    _cookieErrorMsg = '';
    _accountName = '';
    _oauthReady = false;
    _quotaExceeded = false;
    _quotaError = '';
    constructor() {
        const tmpDir = path.join(os.tmpdir(), 'hyperclip-cookies');
        if (!fs.existsSync(tmpDir))
            fs.mkdirSync(tmpDir, { recursive: true });
        this._cookieFile = path.join(tmpDir, 'youtube_cookies.txt');
        this._initPromise = this._init();
    }
    async _init() {
        // With OAuth-only mode, cookies are generated from OAuth tokens
        // Check if we have valid tokens
        const tokenOk = await this._checkOAuthTokens();
        if (tokenOk) {
            this._oauthReady = true;
            devLog('[CookieManager] OAuth tokens verified — ready');
            // Write placeholder cookie file (yt-dlp will use OAuth auth instead)
            this._writePlaceholderCookieFile();
        }
    }
    async _checkOAuthTokens() {
        try {
            const { getTokenManager } = await import('./token_manager.js');
            const tm = getTokenManager();
            const best = await tm.getBestAvailable();
            return !!best;
        }
        catch {
            return false;
        }
    }
    _writePlaceholderCookieFile() {
        // Write a minimal cookie file with just the header
        // yt-dlp will use OAuth token for authentication instead of cookies
        try {
            fs.writeFileSync(this._cookieFile, '# Netscape HTTP Cookie File\n# HyperClip: Using OAuth for authentication\n', 'utf-8');
        }
        catch { }
    }
    async ensureInit() {
        if (this._initPromise)
            await this._initPromise;
    }
    getCookieFile() { return this._cookieFile; }
    getCookies() { return this._cookies; }
    getSessionHeader() { return ''; }
    isReady() {
        return this._oauthReady;
    }
    async refresh() {
        this._lastRefresh = Date.now();
        const tokenOk = await this._checkOAuthTokens();
        if (tokenOk) {
            this._oauthReady = true;
            this._cookieCriticalCount = 0;
            this._writePlaceholderCookieFile();
            return {
                success: true,
                cookieFile: this._cookieFile,
                cookies: [],
                browser: 'electron',
            };
        }
        return {
            success: false,
            cookieFile: this._cookieFile,
            cookies: [],
            browser: 'electron',
            error: 'No valid OAuth tokens found',
        };
    }
    async _doRefresh(onRefresh) {
        devLog('[CookieManager] Checking OAuth tokens...');
        const result = await this.refresh();
        if (result.success) {
            devLog('[CookieManager] OAuth tokens valid');
        }
        else {
            console.warn(`[CookieManager] OAuth check failed: ${result.error}`);
            this._cookieCriticalCount++;
            this._cookieErrorMsg = result.error || 'OAuth tokens invalid';
            if (this._cookieCriticalCount >= 3) {
                console.error('[CookieManager] OAuth critical failure — redirecting to login');
                authEvents.emit('cookieCritical', this._cookieErrorMsg);
                authEvents.emit('authUpdated', this.getAuthStatus());
            }
        }
        onRefresh?.(result);
    }
    startAutoRefresh(onRefresh) {
        if (this._refreshTimer)
            return;
        void this._doRefresh(onRefresh);
        // Check OAuth tokens every 5 minutes
        this._refreshTimer = setInterval(() => { void this._doRefresh(onRefresh); }, 5 * 60 * 1000);
        // NOTE: Subscription sync is MANUAL ONLY (Settings → "Refresh kênh").
        // Auto-sync would overwrite user-added channels and import channels from whatever
        // account the OAuth token belongs to — which is NOT the intended behavior.
        // The poller uses the LOCAL channel list (store.ts), not YouTube API subscriptions.
    }
    async _syncSubscriptions() {
        // Sync is now manual-only. Auto-sync removed — see startAutoRefresh().
        return;
    }
    stopAutoRefresh() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._subSyncTimer) {
            clearInterval(this._subSyncTimer);
            this._subSyncTimer = null;
        }
    }
    /**
     * Sync YouTube subscriptions from OAuth token — ADD NEW channels only.
     * NEVER removes existing channels. Existing channels are preserved.
     * Called manually from Settings → "Refresh kênh" button.
     */
    async syncSubscriptionList() {
        try {
            const { getTokenManager } = await import('./token_manager.js');
            const { fetchMySubscriptions } = await import('./youtube_auth.js');
            const best = await getTokenManager().getBestAvailable();
            if (!best)
                return { added: 0, removed: 0 };
            const remoteSubs = await fetchMySubscriptions(best.token);
            const localChannels = getChannels();
            const localChannelIds = new Set(localChannels.map(c => c.channelId));
            let added = 0;
            for (const sub of remoteSubs) {
                if (!localChannelIds.has(sub.channelId)) {
                    const CHANNEL_COLORS = ['#00B4FF', '#7C3AED', '#00FF88', '#FF6B35', '#FF0080', '#FFB800'];
                    addChannel({
                        id: `ch${Date.now()}_${sub.channelId.slice(-8)}`,
                        name: sub.channelName,
                        handle: '',
                        avatarColor: CHANNEL_COLORS[added % CHANNEL_COLORS.length],
                        channelId: sub.channelId,
                        avatarUrl: sub.avatarUrl || undefined,
                        createdAt: new Date().toISOString(),
                    });
                    added++;
                    devLog(`[SubSync] + ${sub.channelName}`);
                }
            }
            // NOTE: We NEVER remove channels here. The local channel list is the source of truth.
            // Only ADD new channels that aren't already tracked.
            if (added > 0) {
                channelEvents.emit('channelsSynced');
                const { refreshChannelCache } = await import('./subscription_feed.js');
                refreshChannelCache();
                devLog(`[SubSync] Done: +${added} (existing channels preserved)`);
            }
            return { added, removed: 0 };
        }
        catch (e) {
            console.warn('[SubSync] Failed:', e);
            return { added: 0, removed: 0 };
        }
    }
    async validateCookies() {
        return this._oauthReady && await this._checkOAuthTokens();
    }
    getAuthStatus() {
        let oauthReadyLive = this._oauthReady;
        if (!oauthReadyLive) {
            try {
                // Check %APPDATA% first (primary), then %TEMP% (legacy)
                const dirs = [
                    path.join(getAppStoreDir(), 'oauth_tokens.json'),
                    path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_tokens.json'),
                ];
                for (const tokenFile of dirs) {
                    if (fs.existsSync(tokenFile)) {
                        const data = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
                        if (Array.isArray(data)) {
                            oauthReadyLive = data.some((t) => t.expires_at && t.expires_at - 60_000 > Date.now());
                        }
                        if (oauthReadyLive)
                            break;
                    }
                }
            }
            catch { }
        }
        return {
            isReady: oauthReadyLive,
            cookieCount: this._cookies.length,
            loggedOut: !oauthReadyLive,
            accountName: this._accountName,
            oauthReady: oauthReadyLive,
            quotaExceeded: this._quotaExceeded,
            quotaError: this._quotaError,
            cookieCritical: this._cookieCriticalCount >= 3,
            cookieError: this._cookieCriticalCount >= 3 ? this._cookieErrorMsg : undefined,
        };
    }
    setQuotaExceeded(error) {
        this._quotaExceeded = true;
        this._quotaError = error;
        authEvents.emit('authUpdated', this.getAuthStatus());
    }
    async logout() {
        this._oauthReady = false;
        this._accountName = '';
        this._quotaExceeded = false;
        this._quotaError = '';
        this._cookieCriticalCount = 0;
        this._cookieErrorMsg = '';
        this._cookies = [];
        this._initPromise = Promise.resolve();
        try {
            const { clearTokens } = await import('./youtube_auth.js');
            clearTokens();
        }
        catch { }
        authEvents.emit('authUpdated', this.getAuthStatus());
    }
    getLastRefreshTime() { return this._lastRefresh; }
    async startOAuthFlow() {
        const { startOAuthFlow, fetchAccountInfo, getOAuthClientId } = await import('./youtube_auth.js');
        const clientId = getOAuthClientId();
        if (!clientId) {
            console.warn('[CookieManager] No OAuth client ID');
            return;
        }
        const result = await startOAuthFlow(clientId);
        if (result.success && result.tokens) {
            devLog('[CookieManager] OAuth login succeeded');
            this._oauthReady = true;
            try {
                this._accountName = await fetchAccountInfo(result.tokens.access_token) || '';
                if (this._accountName)
                    devLog('[CookieManager] Account:', this._accountName);
            }
            catch { }
            authEvents.emit('authUpdated', this.getAuthStatus());
        }
        else {
            console.warn('[CookieManager] OAuth failed:', result.error);
        }
    }
}
// Singleton
let _manager = null;
export function getCookieManager() {
    if (!_manager)
        _manager = new ElectronCookieManager();
    return _manager;
}
export async function initCookieManager() {
    const mgr = getCookieManager();
    await mgr.ensureInit();
    return {
        success: mgr.isReady(),
        cookieFile: mgr.getCookieFile(),
        cookies: mgr.getCookies(),
        browser: 'electron',
    };
}
export function stopCookieManager() {
    _manager?.stopAutoRefresh();
}
