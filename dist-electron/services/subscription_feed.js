"use strict";
/**
 * Subscription Feed — HyperClip (hybrid pipeline, 2026-05-14)
 *
 * Detection: Innertube (youtubei.js) PRIMARY — 0 quota, ~200ms/request.
 * OAuth DISTRIBUTED: 200 GCP projects scan assigned channels continuously.
 *
 * Pipeline:
 * 1. Innertube PRIMARY: scan ALL channels (5s, 0 quota)
 * 2. OAuth DISTRIBUTED: scan 1-2 random channels (per-project, ~69k units/day total)
 * 3. OAuth FULL COVERAGE: when Innertube dead — ALL 200 projects scan ALL channels
 *
 * Early termination: stops after N new videos found.
 * Uploads playlist ID cached 24h.
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
exports.fetchSubscriptionFeed = fetchSubscriptionFeed;
exports.refreshChannelCache = refreshChannelCache;
const https_1 = __importDefault(require("https"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const token_manager_js_1 = require("./token_manager.js");
const project_manager_js_1 = require("./project_manager.js");
const store_js_1 = require("./store.js");
const innertube_client_js_1 = require("./innertube_client.js");
const youtube_js_1 = require("./youtube.js");
const paths_js_1 = require("./paths.js");
const unified_log_js_1 = require("./unified_log.js");
const ramdisk_js_1 = require("./ramdisk.js");
// NOTE: opLog uses dynamic import inside functions to avoid circular dependency
// (operation_log.ts imports BrowserWindow from Electron, which isn't available at module load)
/** Parse ISO 8601 duration (e.g. "PT5M30S" or "PT1H2M3S") to seconds. */
function parseISO8601Duration(iso) {
    if (!iso)
        return 0;
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match)
        return 0;
    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');
    return hours * 3600 + minutes * 60 + seconds;
}
// ─── Config ─────────────────────────────────────────────────────────────────────
const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 30; // matches InnertubePool session count — fully saturate the pool
const MAX_VIDEOS_PER_POLL = 5;
// ─── Module-level state ────────────────────────────────────────────────────────
let _consecutiveZeroInnertubePolls = 0;
// Smart logging: track what we've already logged to avoid spam.
let _lastLoggedChannelCount = -1; // -1 = never logged
let _lastZeroWarningAt = 0; // 0 = no warning yet
let _lastSessionCount = -1; // -1 = never logged
const _ZERO_WARNING_COOLDOWN_MS = 5 * 60 * 1000; // 5 min between "no new" warnings
// ─── OAuth API Helper ───────────────────────────────────────────────────────────
function apiGet(urlStr, token) {
    return new Promise((resolve) => {
        const req = https_1.default.get({
            hostname: 'www.googleapis.com',
            path: urlStr,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        }, (res) => {
            const statusCode = res.statusCode ?? 0;
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const isQuotaError = statusCode === 403 && (json?.error?.errors?.some((e) => e?.reason === 'RESOURCE_EXHAUSTED' || e?.reason === 'quotaExceeded') ?? false);
                    resolve({ json, isQuotaError });
                }
                catch {
                    resolve({ json: { error: 'Parse error' }, isQuotaError: false });
                }
            });
        });
        req.on('error', (e) => resolve({ json: { error: e.message }, isQuotaError: false }));
        req.setTimeout(15000, () => { req.destroy(); resolve({ json: { error: 'Request timeout' }, isQuotaError: false }); });
    });
}
const UPLOADS_CACHE_FILE = path_1.default.join((0, paths_js_1.getChannelsDir)(), 'uploads-cache.json');
const _uploadsCache = new Map();
let _cacheSaveTimer = null;
const _CACHE_WRITE_DELAY_MS = 5_000; // 5s — batch playlist ID resolutions
function _loadCacheFromDisk() {
    try {
        if (fs_1.default.existsSync(UPLOADS_CACHE_FILE)) {
            const raw = JSON.parse(fs_1.default.readFileSync(UPLOADS_CACHE_FILE, 'utf-8'));
            if (Array.isArray(raw)) {
                for (const entry of raw) {
                    if (entry.channelId && entry.uploadsId) {
                        _uploadsCache.set(entry.channelId, { uploadsId: entry.uploadsId, fetchedAt: entry.fetchedAt });
                    }
                }
                (0, unified_log_js_1.devLog)(`[SubFeed] Loaded ${_uploadsCache.size} cached uploads playlist IDs`);
            }
        }
    }
    catch (e) {
        console.warn('[SubFeed] Failed to load uploads cache:', e);
    }
}
/**
 * Persist uploads cache to disk.
 * Debounced: writes are delayed by _CACHE_WRITE_DELAY_MS (30s) to batch changes.
 * Uses fs.promises to avoid blocking the main thread.
 */
async function _saveCacheToDisk() {
    if (_cacheSaveTimer)
        return; // already scheduled
    _cacheSaveTimer = setTimeout(async () => {
        _cacheSaveTimer = null;
        try {
            const entries = Array.from(_uploadsCache.entries()).map(([channelId, entry]) => ({
                channelId,
                uploadsId: entry.uploadsId,
                fetchedAt: entry.fetchedAt,
            }));
            await fs_1.default.promises.writeFile(UPLOADS_CACHE_FILE, JSON.stringify(entries, null, 2), 'utf-8');
        }
        catch (e) {
            console.warn('[SubFeed] Failed to persist uploads cache:', e);
        }
    }, _CACHE_WRITE_DELAY_MS);
}
_loadCacheFromDisk();
function getCachedUploadsId(channelId) {
    const cached = _uploadsCache.get(channelId);
    if (cached && Date.now() - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS) {
        return cached.uploadsId;
    }
    return null;
}
async function setCachedUploadsId(channelId, uploadsId) {
    _uploadsCache.set(channelId, { uploadsId, fetchedAt: Date.now() });
    await _saveCacheToDisk();
}
// ─── Per-Channel Fetch ─────────────────────────────────────────────────────────
async function fetchChannelWithRss(ch, seenVideoIds) {
    const channelId = ch.channelId || ch.id;
    if (!channelId || !channelId.startsWith('UC'))
        return null;
    const rssVideos = await (0, youtube_js_1.getLatestVideosFromRss)(channelId, 3);
    for (const rv of rssVideos) {
        if (seenVideoIds?.has(rv.videoId))
            continue;
        if (rv.title.includes('[deleted]') || rv.title.includes('[private]'))
            continue;
        const publishedAt = rv.published ? new Date(rv.published).getTime() : 0;
        const MAX_VIDEO_AGE_MS = 10 * 60 * 1000;
        if (publishedAt > 0 && Date.now() - publishedAt > MAX_VIDEO_AGE_MS)
            continue;
        return {
            videoId: rv.videoId,
            title: rv.title,
            channelId,
            channelName: ch.name || 'Unknown',
            thumbnail: `https://img.youtube.com/vi/${rv.videoId}/mqdefault.jpg`,
            publishedAt,
            publishedText: rv.published,
            duration: '',
        };
    }
    return null;
}
async function fetchChannelWithOAuth(ch, token, projectId, seenVideoIds) {
    const channelId = ch.channelId || ch.id;
    if (!channelId)
        return { video: null, quotaError: false };
    let uploadsId = getCachedUploadsId(channelId);
    let quotaError = false;
    if (!uploadsId) {
        const { json, isQuotaError } = await apiGet(`/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`, token);
        if (json.error || !json.items?.[0]) {
            if (isQuotaError)
                quotaError = true;
            return { video: null, quotaError };
        }
        uploadsId = json.items[0].contentDetails?.relatedPlaylists?.uploads || null;
        if (uploadsId)
            await setCachedUploadsId(channelId, uploadsId);
    }
    if (!uploadsId)
        return { video: null, quotaError: false };
    const { json, isQuotaError } = await apiGet(`/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=1`, token);
    if (json.error) {
        if (isQuotaError)
            quotaError = true;
        _uploadsCache.delete(channelId);
        void _saveCacheToDisk(); // fire-and-forget: stale entry removal doesn't need to block
        return { video: null, quotaError };
    }
    if (!json.items?.length)
        return { video: null, quotaError: false };
    const snippet = json.items[0].snippet || {};
    const videoId = snippet.resourceId?.videoId;
    if (!videoId)
        return { video: null, quotaError: false };
    const title = snippet.title || '(no title)';
    if (title.includes('[deleted]') || title.includes('[private]'))
        return { video: null, quotaError: false };
    if (seenVideoIds?.has(videoId))
        return { video: null, quotaError: false };
    const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : 0;
    const MAX_VIDEO_AGE_MS = 10 * 60 * 1000;
    if (publishedAt > 0 && Date.now() - publishedAt > MAX_VIDEO_AGE_MS)
        return { video: null, quotaError: false };
    return {
        video: {
            videoId,
            title,
            channelId,
            channelName: (ch.name && ch.name !== 'N/A') ? ch.name : (snippet.channelTitle && snippet.channelTitle !== 'N/A') ? snippet.channelTitle : 'Unknown',
            thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
            publishedAt,
            duration: '',
        },
        quotaError: false,
    };
}
async function verifyVideoAgeByOAuth(videoId) {
    try {
        const tm = (0, token_manager_js_1.getTokenManager)();
        const best = await tm.getBestAvailable();
        if (!best)
            return null;
        const { json, isQuotaError } = await apiGet(`/youtube/v3/videos?id=${encodeURIComponent(videoId)}&part=snippet,contentDetails`, best.token);
        if (json.error || !json.items?.length) {
            if (isQuotaError)
                tm.trackError(best.projectId);
            return null;
        }
        tm.track(best.projectId);
        const snippet = json.items[0].snippet || {};
        const contentDetails = json.items[0].contentDetails || {};
        const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : 0;
        const MAX_VIDEO_AGE_MS = 10 * 60 * 1000;
        if (publishedAt === 0 || Date.now() - publishedAt > MAX_VIDEO_AGE_MS)
            return null;
        // Duration filter from settings
        const settings = (0, ramdisk_js_1.loadSettings)();
        const minSec = settings.videoMinDurationSec ?? 0;
        const maxSec = settings.videoMaxDurationSec ?? 0;
        if (minSec > 0 || maxSec > 0) {
            const durationSec = parseISO8601Duration(contentDetails.duration);
            if (durationSec > 0) {
                if (minSec > 0 && durationSec < minSec)
                    return null;
                if (maxSec > 0 && durationSec > maxSec)
                    return null;
            }
        }
        return {
            publishedAt,
            title: snippet.title || '(no title)',
            channelTitle: snippet.channelTitle || 'Unknown',
        };
    }
    catch {
        return null;
    }
}
async function fetchChannelWithInnertube(ch, seenVideoIds) {
    const channelId = ch.channelId || ch.id;
    if (!channelId)
        return null;
    // Use getLatestVideos (plural) for full control over filtering logic.
    // getLatestVideo (singular) has internal skip logic that can silently reject
    // valid videos due to inconsistent session responses between concurrent calls.
    const pool = await (0, innertube_client_js_1.getInnertubePool)();
    const allVideos = await pool.getLatestVideos(channelId, 5);
    if (allVideos.length === 0) {
        (0, unified_log_js_1.devLog)(`[SubFeed] getLatestVideos(${channelId}): 0 videos extracted`);
        return null;
    }
    (0, unified_log_js_1.devLog)(`[SubFeed] getLatestVideos(${channelId}): ${allVideos.length} videos, top=${allVideos[0].videoId} (${allVideos[0].publishedAt > 0 ? Math.round((Date.now() - allVideos[0].publishedAt) / 1000) + 's ago' : 'ZERO'})`);
    // Take the first (newest) video that passes age + dedup checks
    for (const v of allVideos) {
        // Skip deleted/private
        if (v.title.includes('[deleted]') || v.title.includes('[private]'))
            continue;
        // Skip already-seen (handled by getLatestVideos already, but double-check)
        if (seenVideoIds?.has(v.videoId)) {
            (0, unified_log_js_1.devLog)(`[SubFeed] Innertube: ${v.videoId} already seen - skipping`);
            continue;
        }
        if (v.publishedAt === 0) {
            (0, unified_log_js_1.devLog)(`[SubFeed] Innertube: ${v.videoId} publishedAt=0 - trying RSS...`);
            const rss = await fetchChannelWithRss(ch, seenVideoIds);
            if (rss) {
                (0, unified_log_js_1.devLog)(`[SubFeed] RSS [OK]: ${rss.videoId} - using RSS`);
                return rss;
            }
            (0, unified_log_js_1.devLog)(`[SubFeed] RSS empty/old - trying OAuth...`);
            const oauth = await verifyVideoAgeByOAuth(v.videoId);
            if (oauth) {
                (0, unified_log_js_1.devLog)(`[SubFeed] OAuth [OK]: ${v.videoId} - verified ${Math.round((Date.now() - oauth.publishedAt) / 1000)}s ago`);
                return {
                    videoId: v.videoId,
                    title: oauth.title,
                    channelId,
                    channelName: (ch.name && ch.name !== 'N/A') ? ch.name : (oauth.channelTitle !== 'Unknown' ? oauth.channelTitle : v.channelName),
                    thumbnail: v.thumbnail,
                    publishedAt: oauth.publishedAt,
                    duration: '',
                };
            }
            // publishedAt=0 and all fallbacks failed — skip to next video
            continue;
        }
        const ageMin = (Date.now() - v.publishedAt) / 60000;
        if (ageMin > 10) {
            (0, unified_log_js_1.devLog)(`[SubFeed] Innertube: ${v.videoId} is ${ageMin.toFixed(1)}m old (>10m) - skipping`);
            continue;
        }
        (0, unified_log_js_1.devLog)(`[SubFeed] Innertube [OK]: ${v.videoId} (${Math.round(ageMin * 60)}s ago) - accepting`);
        return {
            videoId: v.videoId,
            title: v.title,
            channelId,
            channelName: (ch.name && ch.name !== 'N/A') ? ch.name : v.channelName,
            thumbnail: v.thumbnail,
            publishedAt: v.publishedAt,
            duration: '',
        };
    }
    (0, unified_log_js_1.devLog)(`[SubFeed] Innertube: all videos for ${channelId} filtered out (too old / seen / unpublished)`);
    return null;
}
// ─── Main Export ─────────────────────────────────────────────────────────────
async function fetchSubscriptionFeed(options = {}) {
    const { seenVideoIds } = options;
    const targetStop = MAX_VIDEOS_PER_POLL;
    const channels = (0, store_js_1.getChannels)().filter(c => !c.paused);
    if (channels.length === 0)
        return { videos: [], source: 'none' };
    const results = [];
    // eslint-disable-next-line no-useless-assignment -- used for observability logging
    let innertubeAvailable = false;
    // Lazy load opLog to avoid circular import at module initialization
    const { opLog } = await Promise.resolve().then(() => __importStar(require('./unified_log.js')));
    // Step 1: Innertube PRIMARY (0 quota, ~200ms/call)
    try {
        const pool = await (0, innertube_client_js_1.getInnertubePool)();
        const readyCount = pool.getReadyCount();
        const totalSessions = pool.getStatus().totalSessions;
        if (pool.isReady() && readyCount > 0) {
            innertubeAvailable = true;
            // Smart log: only emit "Quét X kênh" when something meaningful changed.
            // Changes: channel count, session count, or first poll ever.
            const channelCountChanged = _lastLoggedChannelCount !== channels.length;
            const sessionCountChanged = _lastSessionCount !== readyCount;
            if (channelCountChanged || sessionCountChanged || _lastLoggedChannelCount === -1) {
                opLog.info('scan', `Quét ${channels.length} kênh (${readyCount}/${totalSessions} sessions)`);
                _lastLoggedChannelCount = channels.length;
                _lastSessionCount = readyCount;
            }
            const scanStartMs = Date.now();
            let batchCount = 0;
            for (let i = 0; i < channels.length; i += MAX_CONCURRENT) {
                const batch = channels.slice(i, i + MAX_CONCURRENT);
                const batchResults = await Promise.all(batch.map(ch => fetchChannelWithInnertube(ch, seenVideoIds)));
                for (const video of batchResults) {
                    if (video) {
                        results.push(video);
                        seenVideoIds?.add(video.videoId);
                        if (results.length >= targetStop) {
                            const scanMs = Date.now() - scanStartMs;
                            (0, unified_log_js_1.devLog)(`[SubFeed] Innertube: ${results.length} videos found - returning (scan took ${scanMs}ms across ${batchCount + 1} batches)`);
                            opLog.success('scan', `Tìm thấy ${results.length} video mới - dừng sớm`);
                            return { videos: results, source: 'innertube' };
                        }
                    }
                }
                batchCount++;
                // Yield between batches so the renderer can receive IPC messages
                // (system stats, workspace updates, render progress) while scanning.
                await new Promise(resolve => setImmediate(resolve));
            }
            const totalScanMs = Date.now() - scanStartMs;
            // Log scan duration when no videos found — helps diagnose "slow detection" reports
            if (results.length === 0) {
                (0, unified_log_js_1.devLog)(`[SubFeed] Innertube: full scan of ${channels.length} channels took ${totalScanMs}ms (${batchCount} batches × ${MAX_CONCURRENT} concurrent)`);
            }
            if (results.length === 0) {
                _consecutiveZeroInnertubePolls++;
                // Warn once at N=3, then again only after 5-minute cooldown.
                const now = Date.now();
                if (_consecutiveZeroInnertubePolls === 3 || (now - _lastZeroWarningAt) > _ZERO_WARNING_COOLDOWN_MS) {
                    opLog.warn('scan', `Không có video mới sau ${_consecutiveZeroInnertubePolls} lần quét liên tiếp`);
                    _lastZeroWarningAt = now;
                }
            }
            else {
                _consecutiveZeroInnertubePolls = 0;
                _lastZeroWarningAt = 0;
                opLog.success('scan', `Tìm thấy ${results.length} video mới từ ${results.filter((v) => v.channelName).length} kênh`);
            }
            // Step 2: OAuth DISTRIBUTED (continuous coverage)
            await _fetchOAuthDistributed(channels, results, seenVideoIds, targetStop);
            if (results.length >= targetStop) {
                return { videos: results.slice(0, targetStop), source: 'innertube' };
            }
            return {
                videos: results,
                source: 'innertube',
                degraded: _consecutiveZeroInnertubePolls >= 3,
            };
        }
        else {
            (0, unified_log_js_1.devLog)(`[SubFeed] Innertube: 0/${totalSessions} sessions ready`);
            innertubeAvailable = false;
        }
    }
    catch (e) {
        (0, unified_log_js_1.devLog)(`[SubFeed] Innertube error: ${e}`);
        innertubeAvailable = false;
    }
    // Step 2b: OAuth FULL COVERAGE (Innertube dead)
    if (results.length === 0 && !innertubeAvailable) {
        (0, unified_log_js_1.devLog)(`[SubFeed] Innertube DOWN - OAuth FULL COVERAGE mode`);
        await _fetchOAuthFullCoverage(channels, results, seenVideoIds, targetStop);
        if (results.length >= targetStop) {
            return { videos: results.slice(0, targetStop), source: 'oauth' };
        }
    }
    // Step 3: RSS Fallback
    if (results.length === 0) {
        const priorityChannels = channels.slice(0, 10);
        const RSS_CONCURRENT = 3;
        (0, unified_log_js_1.devLog)(`[SubFeed] All sources exhausted - RSS fallback for ${priorityChannels.length} channels`);
        for (let i = 0; i < priorityChannels.length; i += RSS_CONCURRENT) {
            const batch = priorityChannels.slice(i, i + RSS_CONCURRENT);
            const rssResults = await Promise.all(batch.map(ch => fetchChannelWithRss(ch, seenVideoIds)));
            for (const video of rssResults) {
                if (video && !results.some(r => r.videoId === video.videoId)) {
                    results.push(video);
                    seenVideoIds?.add(video.videoId);
                    if (results.length >= targetStop)
                        break;
                }
            }
            if (results.length >= targetStop)
                break;
        }
    }
    // Deduplicate
    const seen = new Set();
    const unique = [];
    for (const v of results) {
        if (!seen.has(v.videoId)) {
            seen.add(v.videoId);
            unique.push(v);
        }
    }
    const innertubeCount = results.filter(r => r.duration && r.duration !== '').length;
    const source = innertubeCount > 0 ? 'innertube' : 'oauth';
    if (unique.length > 0) {
        const newest = unique[0];
        const ageMin = (Date.now() - newest.publishedAt) / 60000;
        const ageLabel = ageMin < 1 ? 'vua xong' : Math.floor(ageMin) + 'm ago';
        (0, unified_log_js_1.devLog)(`[SubFeed] ${unique.length} video(s) found (${source}): "${newest.title.slice(0, 40)}" from ${newest.channelName} (${ageLabel})`);
    }
    return { videos: unique, source: unique.length > 0 ? source : 'oauth' };
}
// ─── OAuth Distributed Scan ───────────────────────────────────────────────────
/**
 * OAuth DISTRIBUTED: scan 1-2 random channels per poll via assigned projects.
 * Total cost: ~69k units/day (3.5% of 2M total quota).
 */
async function _fetchOAuthDistributed(channels, results, seenVideoIds, targetStop) {
    const pm = (0, project_manager_js_1.getProjectManager)();
    const tm = (0, token_manager_js_1.getTokenManager)();
    const status = pm.getStatus();
    if (status.total === 0)
        return;
    const scanCount = Math.min(2, channels.length);
    const shuffled = [...channels].sort(() => Math.random() - 0.5);
    const toScan = shuffled.slice(0, scanCount);
    for (const ch of toScan) {
        if (results.length >= targetStop)
            break;
        const project = pm.getProjectForChannel(ch.channelId || ch.id);
        if (!project)
            continue;
        const token = pm.getToken(project.projectId);
        if (!token)
            continue;
        if (token.expires_at - 5 * 60 * 1000 < Date.now()) {
            const refreshed = await tm.refreshToken(project.projectId);
            if (!refreshed)
                continue;
        }
        const tok = pm.getToken(project.projectId);
        if (!tok)
            continue;
        const { video, quotaError } = await fetchChannelWithOAuth(ch, tok.access_token, project.projectId, seenVideoIds);
        if (quotaError) {
            tm.trackError(project.projectId);
        }
        else if (video) {
            tm.track(project.projectId);
            if (!results.some(r => r.videoId === video.videoId)) {
                results.push(video);
                seenVideoIds?.add(video.videoId);
                (0, unified_log_js_1.devLog)(`[SubFeed] OAuth-DIST: found "${video.title.slice(0, 40)}" via ${project.projectId}`);
            }
        }
    }
}
// ─── OAuth Full Coverage Scan ─────────────────────────────────────────────────
/**
 * OAuth FULL COVERAGE: when Innertube is dead, ALL 200 projects scan ALL channels.
 * ~1.7M units/day — 86% of 2M total. Survives Innertube outage for days.
 */
async function _fetchOAuthFullCoverage(channels, results, seenVideoIds, targetStop) {
    const tm = (0, token_manager_js_1.getTokenManager)();
    const statuses = tm.getAllStatuses();
    const hasAvailable = statuses.some(ts => ts.hasToken && ts.status !== 'exhausted');
    if (!hasAvailable)
        return;
    (0, unified_log_js_1.devLog)(`[SubFeed] OAuth FULL COVERAGE: scanning ${channels.length} channels`);
    for (let i = 0; i < channels.length; i += MAX_CONCURRENT) {
        const batch = channels.slice(i, i + MAX_CONCURRENT);
        const best = await tm.getBestAvailable();
        if (!best)
            break;
        const batchResults = await Promise.all(batch.map(ch => fetchChannelWithOAuth(ch, best.token, best.projectId, seenVideoIds)));
        let tokenExhausted = false;
        for (const { video, quotaError } of batchResults) {
            if (quotaError) {
                tm.trackError(best.projectId);
                tokenExhausted = true;
            }
            else {
                tm.track(best.projectId);
            }
            if (video && !results.some(r => r.videoId === video.videoId)) {
                results.push(video);
                seenVideoIds?.add(video.videoId);
                if (results.length >= targetStop) {
                    (0, unified_log_js_1.devLog)(`[SubFeed] OAuth FULL COVERAGE: ${results.length} videos found`);
                    return;
                }
            }
        }
        if (tokenExhausted) {
            const retryBest = await tm.getBestAvailable();
            if (retryBest && retryBest.projectId !== best.projectId) {
                const retryResults = await Promise.all(batch.map(ch => fetchChannelWithOAuth(ch, retryBest.token, retryBest.projectId, seenVideoIds)));
                for (const { video, quotaError } of retryResults) {
                    if (quotaError)
                        tm.trackError(retryBest.projectId);
                    else
                        tm.track(retryBest.projectId);
                    if (video && !results.some(r => r.videoId === video.videoId)) {
                        results.push(video);
                        seenVideoIds?.add(video.videoId);
                        if (results.length >= targetStop)
                            return;
                    }
                }
            }
        }
    }
}
// ─── Channel Cache ─────────────────────────────────────────────────────────────
function refreshChannelCache() {
    // Channels are read directly from the store — no in-memory cache to refresh
}
