"use strict";
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
exports.channelEvents = exports.authEvents = void 0;
exports.getCookieManager = getCookieManager;
exports.initCookieManager = initCookieManager;
exports.stopCookieManager = stopCookieManager;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const events_1 = require("events");
const store_js_1 = require("./store.js");
const unified_log_js_1 = require("./unified_log.js");
const paths_js_1 = require("./paths.js");
// ─── Auth Event Bus ─────────────────────────────────────────────────────────────
exports.authEvents = new events_1.EventEmitter();
exports.channelEvents = new events_1.EventEmitter();
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
        const tmpDir = path_1.default.join(os_1.default.tmpdir(), 'hyperclip-cookies');
        if (!fs_1.default.existsSync(tmpDir))
            fs_1.default.mkdirSync(tmpDir, { recursive: true });
        this._cookieFile = path_1.default.join(tmpDir, 'youtube_cookies.txt');
        this._initPromise = this._init();
    }
    async _init() {
        // With OAuth-only mode, cookies are generated from OAuth tokens
        // Check if we have valid tokens
        const tokenOk = await this._checkOAuthTokens();
        if (tokenOk) {
            this._oauthReady = true;
            (0, unified_log_js_1.devLog)('[CookieManager] OAuth tokens verified — ready');
            // Write placeholder cookie file (yt-dlp will use OAuth auth instead)
            this._writePlaceholderCookieFile();
        }
    }
    async _checkOAuthTokens() {
        try {
            const { getTokenManager } = await Promise.resolve().then(() => __importStar(require('./token_manager.js')));
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
            fs_1.default.writeFileSync(this._cookieFile, '# Netscape HTTP Cookie File\n# HyperClip: Using OAuth for authentication\n', 'utf-8');
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
        (0, unified_log_js_1.devLog)('[CookieManager] Checking OAuth tokens...');
        const result = await this.refresh();
        if (result.success) {
            (0, unified_log_js_1.devLog)('[CookieManager] OAuth tokens valid');
        }
        else {
            console.warn(`[CookieManager] OAuth check failed: ${result.error}`);
            this._cookieCriticalCount++;
            this._cookieErrorMsg = result.error || 'OAuth tokens invalid';
            if (this._cookieCriticalCount >= 3) {
                console.error('[CookieManager] OAuth critical failure — redirecting to login');
                exports.authEvents.emit('cookieCritical', this._cookieErrorMsg);
                exports.authEvents.emit('authUpdated', this.getAuthStatus());
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
            const { getTokenManager } = await Promise.resolve().then(() => __importStar(require('./token_manager.js')));
            const { fetchMySubscriptions } = await Promise.resolve().then(() => __importStar(require('./youtube_auth.js')));
            const best = await getTokenManager().getBestAvailable();
            if (!best)
                return { added: 0, removed: 0 };
            const remoteSubs = await fetchMySubscriptions(best.token);
            const localChannels = (0, store_js_1.getChannels)();
            const localChannelIds = new Set(localChannels.map(c => c.channelId));
            let added = 0;
            for (const sub of remoteSubs) {
                if (!localChannelIds.has(sub.channelId)) {
                    const CHANNEL_COLORS = ['#00B4FF', '#7C3AED', '#00FF88', '#FF6B35', '#FF0080', '#FFB800'];
                    (0, store_js_1.addChannel)({
                        id: `ch${Date.now()}_${sub.channelId.slice(-8)}`,
                        name: sub.channelName,
                        handle: '',
                        avatarColor: CHANNEL_COLORS[added % CHANNEL_COLORS.length],
                        channelId: sub.channelId,
                        avatarUrl: sub.avatarUrl || undefined,
                        createdAt: new Date().toISOString(),
                    });
                    added++;
                    (0, unified_log_js_1.devLog)(`[SubSync] + ${sub.channelName}`);
                }
            }
            // NOTE: We NEVER remove channels here. The local channel list is the source of truth.
            // Only ADD new channels that aren't already tracked.
            if (added > 0) {
                exports.channelEvents.emit('channelsSynced');
                const { refreshChannelCache } = await Promise.resolve().then(() => __importStar(require('./subscription_feed.js')));
                refreshChannelCache();
                (0, unified_log_js_1.devLog)(`[SubSync] Done: +${added} (existing channels preserved)`);
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
    _hasStoredTokens() {
        const dirs = [
            path_1.default.join((0, paths_js_1.getAppStoreDir)(), 'oauth_tokens.json'),
            path_1.default.join(os_1.default.tmpdir(), 'hyperclip-cookies', 'oauth_tokens.json'),
        ];
        for (const tokenFile of dirs) {
            if (fs_1.default.existsSync(tokenFile)) {
                try {
                    const data = JSON.parse(fs_1.default.readFileSync(tokenFile, 'utf-8'));
                    if (Array.isArray(data) && data.some((t) => t.expires_at && t.expires_at - 60_000 > Date.now()))
                        return true;
                }
                catch { }
            }
        }
        return false;
    }
    getAuthStatus() {
        let oauthReadyLive = this._oauthReady;
        if (!oauthReadyLive) {
            try {
                // Check %APPDATA% first (primary), then %TEMP% (legacy)
                const dirs = [
                    path_1.default.join((0, paths_js_1.getAppStoreDir)(), 'oauth_tokens.json'),
                    path_1.default.join(os_1.default.tmpdir(), 'hyperclip-cookies', 'oauth_tokens.json'),
                ];
                for (const tokenFile of dirs) {
                    if (fs_1.default.existsSync(tokenFile)) {
                        const data = JSON.parse(fs_1.default.readFileSync(tokenFile, 'utf-8'));
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
        // Also check SessionManager for Chrome cookies (primary auth path)
        let chromeSessionCount = 0;
        let chromeHasLogin = false;
        try {
            const { getSessionManager } = require('./chrome_cookies.js');
            const sm = getSessionManager();
            const sessions = sm.getSessions();
            chromeSessionCount = sessions.length;
            chromeHasLogin = sessions.some((s) => s.isLoggedIn && s.isConsented);
        }
        catch { }
        return {
            // Ready if OAuth tokens valid OR Chrome sessions have logged-in consented sessions.
            isReady: oauthReadyLive || chromeHasLogin,
            cookieCount: chromeSessionCount,
            loggedOut: !oauthReadyLive && !chromeHasLogin,
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
        exports.authEvents.emit('authUpdated', this.getAuthStatus());
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
            const { clearTokens } = await Promise.resolve().then(() => __importStar(require('./youtube_auth.js')));
            clearTokens();
        }
        catch { }
        exports.authEvents.emit('authUpdated', this.getAuthStatus());
    }
    getLastRefreshTime() { return this._lastRefresh; }
    async startOAuthFlow() {
        const { startOAuthFlow, fetchAccountInfo, getOAuthClientId } = await Promise.resolve().then(() => __importStar(require('./youtube_auth.js')));
        const clientId = getOAuthClientId();
        if (!clientId) {
            console.warn('[CookieManager] No OAuth client ID');
            return;
        }
        const result = await startOAuthFlow(clientId);
        if (result.success && result.tokens) {
            (0, unified_log_js_1.devLog)('[CookieManager] OAuth login succeeded');
            this._oauthReady = true;
            try {
                this._accountName = await fetchAccountInfo(result.tokens.access_token) || '';
                if (this._accountName)
                    (0, unified_log_js_1.devLog)('[CookieManager] Account:', this._accountName);
            }
            catch { }
            exports.authEvents.emit('authUpdated', this.getAuthStatus());
        }
        else {
            console.warn('[CookieManager] OAuth failed:', result.error);
        }
    }
}
// Singleton
let _manager = null;
function getCookieManager() {
    if (!_manager)
        _manager = new ElectronCookieManager();
    return _manager;
}
async function initCookieManager() {
    const mgr = getCookieManager();
    await mgr.ensureInit();
    return {
        success: mgr.isReady(),
        cookieFile: mgr.getCookieFile(),
        cookies: mgr.getCookies(),
        browser: 'electron',
    };
}
function stopCookieManager() {
    _manager?.stopAutoRefresh();
}
