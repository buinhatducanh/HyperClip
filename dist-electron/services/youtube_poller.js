/**
 * YouTube Poller — HyperClip
 *
 * Subscription Feed polling via YouTube Data API v3.
 * Primary: activities?home=true + cookies (1 unit/poll, ~200ms)
 * Fallback: playlistItems per channel batch (only when primary returns 0)
 */
import { fetchSubscriptionFeed } from './subscription_feed.js';
import fs from 'fs';
import path from 'path';
import { devLog } from './unified_log.js';
import { getChannelsDir } from './paths.js';
// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_POLL_INTERVAL_MS = 2000; // 2 seconds — target < 20s detection latency
const MAX_VIDEOS_PER_POLL = 5;
const SEEN_IDS_CAP = 10000; // cap to prevent unbounded memory growth
const SEEN_IDS_FILE = path.join(getChannelsDir(), 'seen-ids.json');
// ─── SeenVideoIds persistence ─────────────────────────────────────────────────
/**
 * Load seen video IDs from disk.
 * Prevents re-detecting videos after app restart (no duplicate downloads).
 */
function loadSeenVideoIds() {
    try {
        if (fs.existsSync(SEEN_IDS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(SEEN_IDS_FILE, 'utf-8'));
            return new Set(Array.isArray(raw) ? raw : []);
        }
    }
    catch { }
    return new Set();
}
/**
 * Persist seen video IDs to disk.
 * Called after every new detection to survive restarts.
 */
function saveSeenVideoIds(ids) {
    try {
        const arr = Array.from(ids);
        fs.writeFileSync(SEEN_IDS_FILE, JSON.stringify(arr), 'utf-8');
    }
    catch { }
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
        devLog(`[YouTubePoller] Loaded ${this._seenVideoIds.size} seen video IDs from disk`);
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
            devLog('[YouTubePoller] Backoff cleared — resuming polling');
        }
    }
    /** Pause polling — clears timer and stops the poll loop */
    pause() {
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
        this._active = false;
        devLog('[YouTubePoller] Polling paused by user');
        void (async () => {
            const { opLog } = await import('./unified_log.js');
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
        devLog(`[YouTubePoller] Restarted with ${intervalMs}ms interval`);
    }
    /**
     * Quick non-consuming check of resource availability.
     * Used during backoff to detect if user added tokens mid-session.
     */
    async _checkResources() {
        try {
            const { getTokenManager } = await import('./token_manager.js');
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
    markSeen(videoId) {
        this._seenVideoIds.add(videoId);
        saveSeenVideoIds(this._seenVideoIds);
    }
    _capSeenIds() {
        // Cap at SEEN_IDS_CAP to prevent unbounded memory growth
        if (this._seenVideoIds.size > SEEN_IDS_CAP) {
            const arr = Array.from(this._seenVideoIds);
            this._seenVideoIds = new Set(arr.slice(-SEEN_IDS_CAP));
            saveSeenVideoIds(this._seenVideoIds);
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
                    const { getInnertubePoolSync } = await import('./innertube_client.js');
                    const pool = getInnertubePoolSync();
                    poolReady = pool?.isReady() ?? false;
                }
                catch { /* pool not initialized yet */ }
                const remaining = Math.ceil((this._exhaustedBackoffUntil - now) / 1000);
                if (hasOAuth || poolReady) {
                    this._exhaustedBackoffUntil = 0;
                    this._backoffReason = null;
                    const reason = poolReady ? 'Innertube pool' : 'OAuth';
                    devLog(`[YouTubePoller] ${reason} recovered ✓ — resuming polling`);
                }
                else {
                    devLog(`[YouTubePoller] Backoff (${remaining}s remaining) — checking...`);
                }
            }
            return;
        }
        // Log every poll start — confirms poller is alive and making API calls
        if (this._pollsSinceLastLog === 0) {
            devLog(`[YouTubePoller] Scanning...`);
        }
        const subResult = await fetchSubscriptionFeed({
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
        // Persist seen IDs after every detection — survives restarts
        saveSeenVideoIds(this._seenVideoIds);
        this._capSeenIds();
        // Log alive status every 60 polls (~2 min at 2s/poll)
        this._pollsSinceLastLog++;
        if (this._pollsSinceLastLog >= 60) {
            const elapsed = this._lastPollAt
                ? Math.round((Date.now() - this._lastPollAt) / 1000)
                : 0;
            devLog(`[YouTubePoller] alive · ${this._videoCount} polled · ${this._newVideoCount} new · last ${elapsed}s ago`);
            this._pollsSinceLastLog = 0;
        }
        if (newVideos.length > 0) {
            this._lastNewVideosAt = Date.now();
            devLog(`[YouTubePoller] ${newVideos.length} video moi (${subResult.source}): ${newVideos.map(v => v.title.slice(0, 40) + ' (' + v.channelName + ')').join(', ')}`);
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
        devLog(`[YouTubePoller] Starting (interval: ${this._pollIntervalMs / 1000}s ± 20%% jitter, seen IDs: ${this._seenVideoIds.size})`);
        void this._pollOnce();
        this._scheduleNextPoll();
    }
    stop() {
        this._active = false;
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
        devLog('[YouTubePoller] Stopped');
    }
}
// ─── Singleton ────────────────────────────────────────────────────────────────
let _poller = null;
export function createYouTubePoller(options) {
    if (_poller)
        _poller.stop();
    _poller = new YouTubePoller(options);
    return _poller;
}
export function getYouTubePoller() {
    return _poller;
}
export function stopYouTubePoller() {
    if (_poller) {
        _poller.stop();
        _poller = null;
    }
}
export { YouTubePoller };
