"use strict";
/**
 * YouTube Poller — HyperClip
 *
 * Subscription Feed polling via YouTube Data API v3.
 * Primary: activities?home=true + cookies (1 unit/poll, ~200ms)
 * Fallback: playlistItems per channel batch (only when primary returns 0)
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
exports.YouTubePoller = void 0;
exports.createYouTubePoller = createYouTubePoller;
exports.getYouTubePoller = getYouTubePoller;
exports.stopYouTubePoller = stopYouTubePoller;
const subscription_feed_js_1 = require("./subscription_feed.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const unified_log_js_1 = require("./unified_log.js");
const paths_js_1 = require("./paths.js");
// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_POLL_INTERVAL_MS = 2000; // 2 seconds — target < 20s detection latency
const MAX_VIDEOS_PER_POLL = 5;
const SEEN_IDS_CAP = 10000; // cap to prevent unbounded memory growth
const SEEN_IDS_FILE = path_1.default.join((0, paths_js_1.getChannelsDir)(), 'seen-ids.json');
const SEEN_IDS_WRITE_DELAY_MS = 5_000; // 5s — batch writes, avoid disk I/O every poll
// ─── SeenVideoIds persistence ─────────────────────────────────────────────────
/**
 * Load seen video IDs from disk.
 * Prevents re-detecting videos after app restart (no duplicate downloads).
 */
function loadSeenVideoIds() {
    try {
        if (fs_1.default.existsSync(SEEN_IDS_FILE)) {
            const raw = JSON.parse(fs_1.default.readFileSync(SEEN_IDS_FILE, 'utf-8'));
            return new Set(Array.isArray(raw) ? raw : []);
        }
    }
    catch { }
    return new Set();
}
/**
 * Persist seen video IDs to disk.
 * Debounced: writes are delayed by SEEN_IDS_WRITE_DELAY_MS (30s) to batch rapid changes.
 * Uses fs.promises to avoid blocking the main thread.
 */
let _seenIdsSaveTimer = null;
async function saveSeenVideoIds(ids) {
    if (_seenIdsSaveTimer)
        return; // already scheduled
    _seenIdsSaveTimer = setTimeout(async () => {
        _seenIdsSaveTimer = null;
        try {
            const arr = Array.from(ids);
            await fs_1.default.promises.writeFile(SEEN_IDS_FILE, JSON.stringify(arr), 'utf-8');
        }
        catch { }
    }, SEEN_IDS_WRITE_DELAY_MS);
}
// ─── Poller ─────────────────────────────────────────────────────────────────────
class YouTubePoller {
    _pollTimer = null;
    _pollIntervalMs;
    _maxVideosPerPoll;
    _onNewVideos;
    _seenVideoIds;
    _videoCount = 0;
    _newVideoCount = 0;
    _active = false;
    _lastPollAt = null;
    _lastNewVideosAt = null;
    _lastError = null;
    _pollsSinceLastLog = 0;
    _exhaustedBackoffUntil = 0; // timestamp when backoff ends
    _lastExhaustedWarnAt = 0; // avoid spamming notifications
    _backoffReason = null;
    _exhaustionCount = 0; // tracks how many times we've backed off (for exponential backoff)
    _innertubeDegraded = false; // true when Innertube returns 0 videos for 3+ polls
    _degradedNotified = false; // prevents duplicate degraded notifications per episode
    _notifyDegraded;
    constructor(options) {
        this._pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this._maxVideosPerPoll = options.maxVideosPerPoll ?? MAX_VIDEOS_PER_POLL;
        this._onNewVideos = options.onNewVideos;
        this._notifyDegraded = options.onDegraded;
        // Load persisted seen IDs on startup — survives app restarts
        this._seenVideoIds = loadSeenVideoIds();
        (0, unified_log_js_1.devLog)(`[YouTubePoller] Loaded ${this._seenVideoIds.size} seen video IDs from disk`);
    }
    getStatus() {
        return {
            active: this._active,
            pollIntervalMs: this._pollIntervalMs,
            lastPollAt: this._lastPollAt,
            lastNewVideosAt: this._lastNewVideosAt,
            channelCount: 0, // filled by caller
            videoCount: this._videoCount,
            newVideoCount: this._newVideoCount,
            lastError: this._lastError,
            exhaustedUntil: this._exhaustedBackoffUntil > Date.now() ? this._exhaustedBackoffUntil : null,
            innertubeDegraded: this._innertubeDegraded,
        };
    }
    /** Resume polling immediately — clears exhaustion backoff */
    resume() {
        if (this._exhaustedBackoffUntil > Date.now()) {
            this._exhaustedBackoffUntil = 0;
            this._backoffReason = null;
            this._lastExhaustedWarnAt = 0;
            this._exhaustionCount = 0;
            (0, unified_log_js_1.devLog)('[YouTubePoller] Backoff cleared — resuming polling');
        }
    }
    /** Pause polling — clears timer and stops the poll loop */
    pause() {
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
        this._active = false;
        (0, unified_log_js_1.devLog)('[YouTubePoller] Polling paused by user');
        void (async () => {
            const { opLog } = await Promise.resolve().then(() => __importStar(require('./unified_log.js')));
            opLog.info('system', 'Đã tạm dừng quét kênh');
        })();
    }
    /** Restart polling with a new interval (ms) — replaces existing restart() */
    restart(intervalMs) {
        this._pollIntervalMs = intervalMs;
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
        this._scheduleNextPoll();
        (0, unified_log_js_1.devLog)(`[YouTubePoller] Restarted with ${intervalMs}ms interval`);
    }
    /**
     * Quick non-consuming check of resource availability.
     * Used during backoff to detect if user added tokens mid-session.
     */
    async _checkResources() {
        try {
            const { getTokenManager } = await Promise.resolve().then(() => __importStar(require('./token_manager.js')));
            const tm = getTokenManager();
            const statuses = tm.getAllStatuses();
            const hasOAuth = statuses.some(ts => ts.hasToken && ts.status !== 'exhausted');
            return { hasOAuth };
        }
        catch {
            return { hasOAuth: false };
        }
    }
    isActive() {
        return this._active;
    }
    /** Manually add a video ID to the seen set (e.g., from existing workspaces) */
    async markSeen(videoId) {
        this._seenVideoIds.add(videoId);
        await saveSeenVideoIds(this._seenVideoIds);
    }
    async _capSeenIds() {
        // Cap at SEEN_IDS_CAP to prevent unbounded memory growth
        if (this._seenVideoIds.size > SEEN_IDS_CAP) {
            const arr = Array.from(this._seenVideoIds);
            this._seenVideoIds = new Set(arr.slice(-SEEN_IDS_CAP));
            await saveSeenVideoIds(this._seenVideoIds);
        }
    }
    async _pollOnce() {
        this._lastError = null;
        this._lastPollAt = Date.now();
        const now = Date.now();
        // Backoff: if in exhausted backoff period, check if resources recovered
        if (now < this._exhaustedBackoffUntil) {
            if (this._pollsSinceLastLog === 0) {
                const { hasOAuth } = await this._checkResources();
                // Also check Innertube pool — it may recover if cookies were refreshed
                let poolReady = false;
                try {
                    const { getInnertubePoolSync } = await Promise.resolve().then(() => __importStar(require('./innertube_client.js')));
                    const pool = getInnertubePoolSync();
                    poolReady = pool?.isReady() ?? false;
                }
                catch { /* pool not initialized yet */ }
                const remaining = Math.ceil((this._exhaustedBackoffUntil - now) / 1000);
                if (hasOAuth || poolReady) {
                    this._exhaustedBackoffUntil = 0;
                    this._backoffReason = null;
                    const reason = poolReady ? 'Innertube pool' : 'OAuth';
                    (0, unified_log_js_1.devLog)(`[YouTubePoller] ${reason} recovered [OK] - resuming polling`);
                }
                else {
                    (0, unified_log_js_1.devLog)(`[YouTubePoller] Backoff (${remaining}s remaining) — checking...`);
                }
            }
            return;
        }
        // Log every poll start — confirms poller is alive and making API calls
        if (this._pollsSinceLastLog === 0) {
            (0, unified_log_js_1.devLog)(`[YouTubePoller] Scanning...`);
        }
        const subResult = await (0, subscription_feed_js_1.fetchSubscriptionFeed)({
            // Request enough to fill maxVideosPerPoll + buffer — early exit kicks in at channel level
            maxVideos: this._maxVideosPerPoll + 5,
            seenVideoIds: this._seenVideoIds,
        });
        // Emit degraded event to UI when Innertube has returned 0 videos for 3+ consecutive polls
        // Only notify ONCE per degraded episode — prevents spam every 5s
        if (subResult.degraded) {
            this._innertubeDegraded = true;
            if (!this._degradedNotified) {
                this._degradedNotified = true;
                this._notifyDegraded?.();
            }
        }
        else if (subResult.videos.length > 0) {
            this._innertubeDegraded = false;
            this._degradedNotified = false; // reset for next degraded episode
        }
        if (subResult.videos.length === 0) {
            if (subResult.error) {
                this._lastError = subResult.error.slice(0, 80);
                if (subResult.error.includes('OAuth') || subResult.error.includes('token')) {
                    console.warn(`[YouTubePoller] API error: ${subResult.error}`);
                }
            }
            // All detection sources exhausted — enter backoff mode, notify user once
            if (subResult.allSourcesExhausted) {
                const reason = 'All detection sources exhausted (Innertube: no Chrome sessions, OAuth: all tokens quota-exhausted)';
                this._backoffReason = 'oauth';
                this._lastError = reason;
                console.warn(`[YouTubePoller] ${reason}`);
                // All detection sources exhausted — back off incrementally
                // Start with 60s, double each time (60s → 120s → 240s → ...), cap at 5 min
                const baseBackoff = 60_000;
                const maxBackoff = 300_000; // 5 minutes max
                const backoffMs = Math.min(baseBackoff * Math.pow(2, this._exhaustionCount), maxBackoff);
                this._exhaustionCount = (this._exhaustionCount ?? 0) + 1;
                this._exhaustedBackoffUntil = now + backoffMs;
                if (now - this._lastExhaustedWarnAt > backoffMs) {
                    this._lastExhaustedWarnAt = now;
                    console.warn(`[YouTubePoller] Backoff ${Math.round(backoffMs / 1000)}s (attempt #${this._exhaustionCount}). Add more GCP projects or check token validity.`);
                }
            }
            return;
        }
        const newVideos = [];
        for (const vid of subResult.videos) {
            this._seenVideoIds.add(vid.videoId);
            this._videoCount++;
            this._newVideoCount++;
            const ageMs = vid.publishedAt > 0 ? Date.now() - vid.publishedAt : 0;
            const ageMin = ageMs / 60000;
            const ageStr = ageMin >= 60
                ? Math.floor(ageMin / 60) + 'h truoc'
                : ageMin < 1 ? 'Vua xong'
                    : Math.floor(ageMin) + 'm truoc';
            newVideos.push({
                videoId: vid.videoId,
                title: vid.title,
                channelId: vid.channelId,
                channelName: vid.channelName,
                thumbnail: vid.thumbnail,
                duration: vid.duration || ageStr,
                publishedTime: ageStr,
                detectedAt: Date.now(),
                publishedAt: vid.publishedAt,
            });
            if (newVideos.length >= this._maxVideosPerPoll)
                break;
        }
        // Persist seen IDs after every detection — survives restarts (debounced, async)
        await saveSeenVideoIds(this._seenVideoIds);
        await this._capSeenIds();
        // Log alive status every 60 polls (~2 min at 2s/poll)
        this._pollsSinceLastLog++;
        if (this._pollsSinceLastLog >= 60) {
            const elapsed = this._lastPollAt
                ? Math.round((Date.now() - this._lastPollAt) / 1000)
                : 0;
            (0, unified_log_js_1.devLog)(`[YouTubePoller] alive · ${this._videoCount} polled · ${this._newVideoCount} new · last ${elapsed}s ago`);
            this._pollsSinceLastLog = 0;
        }
        if (newVideos.length > 0) {
            this._lastNewVideosAt = Date.now();
            (0, unified_log_js_1.devLog)(`[YouTubePoller] ${newVideos.length} video moi (${subResult.source}): ${newVideos.map(v => v.title.slice(0, 40) + ' (' + v.channelName + ')').join(', ')}`);
            this._onNewVideos?.(newVideos);
        }
    }
    _scheduleNextPoll() {
        if (!this._active)
            return;
        // ±20% jitter around poll interval — proportional to interval size.
        // 2s interval: ~1.6–2.4s; 5s interval: ~4–6s.
        const jitterFraction = (Math.random() * 0.4 - 0.2); // -20% to +20%
        const delay = Math.round(this._pollIntervalMs * (1 + jitterFraction));
        this._pollTimer = setTimeout(async () => {
            await this._pollOnce();
            this._scheduleNextPoll();
        }, delay);
    }
    start() {
        if (this._active)
            return;
        this._active = true;
        (0, unified_log_js_1.devLog)(`[YouTubePoller] Starting (interval: ${this._pollIntervalMs / 1000}s ± 20%% jitter, seen IDs: ${this._seenVideoIds.size})`);
        void this._pollOnce();
        this._scheduleNextPoll();
    }
    stop() {
        this._active = false;
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
        (0, unified_log_js_1.devLog)('[YouTubePoller] Stopped');
    }
}
exports.YouTubePoller = YouTubePoller;
// ─── Singleton ────────────────────────────────────────────────────────────────
let _poller = null;
function createYouTubePoller(options) {
    if (_poller)
        _poller.stop();
    _poller = new YouTubePoller(options);
    return _poller;
}
function getYouTubePoller() {
    return _poller;
}
function stopYouTubePoller() {
    if (_poller) {
        _poller.stop();
        _poller = null;
    }
}
