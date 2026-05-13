/**
 * Subscription Feed — HyperClip
 *
 * Detection: Innertube (youtubei.js) PRIMARY — no quota limit, ~200ms/request.
 * Fallback: OAuth Data API v3 playlistItems per channel (TokenManager, quota-limited).
 *
 * Early termination: stops after N new videos found — saves API calls.
 * Uploads playlist ID cached 24h — saves 1 API call/channel/poll.
 */

import https from 'https'
import path from 'path'
import fs from 'fs'
import { getTokenManager } from './token_manager.js'
import { getChannels } from './store.js'
import { getInnertubePool } from './innertube_client.js'
import { getLatestVideosFromRss } from './youtube.js'
import { getAppStoreDir } from './paths.js'
import { devLog } from './dev_log.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SubscriptionVideo {
  videoId: string
  title: string
  channelId: string
  channelName: string
  thumbnail: string
  publishedAt: number // Unix timestamp (ms)
  publishedText?: string
  duration: string
}

export interface SubFeedResult {
  videos: SubscriptionVideo[]
  error?: string
  allSourcesExhausted?: boolean
  source: 'innertube' | 'oauth' | 'mixed' | 'none'
  /** True when Innertube has returned 0 videos for 3+ consecutive polls */
  degraded?: boolean
}

export interface SubFeedOptions {
  seenVideoIds?: Set<string>
  maxVideos?: number
}

// ─── Config ─────────────────────────────────────────────────────────────────────

const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h uploads playlist cache
const MAX_CONCURRENT = 10  // parallel API calls per poll — faster scan for < 20s detection
const MAX_VIDEOS_PER_POLL = 5

// ─── Module-level state ────────────────────────────────────────────────────────

/** Consecutive polls where Innertube returned 0 videos — for UI degraded-state indicator */
let _consecutiveZeroInnertubePolls = 0

// ─── OAuth API Helper ───────────────────────────────────────────────────────────

function apiGet(
  urlStr: string,
  token: string,
): Promise<{ json: any; isQuotaError: boolean }> {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: 'www.googleapis.com',
      path: urlStr,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      const statusCode = res.statusCode ?? 0
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          const isQuotaError = statusCode === 403 && (
            json?.error?.errors?.some((e: any) =>
              e?.reason === 'RESOURCE_EXHAUSTED' || e?.reason === 'quotaExceeded'
            ) ?? false
          )
          if (statusCode === 403) {
            const reason = json?.error?.errors?.[0]?.reason ?? 'unknown'
            const msg = json?.error?.message ?? ''
            devLog(`[SubFeed] 403 — reason: "${reason}", message: "${msg}"`)
          }
          resolve({ json, isQuotaError })
        } catch {
          resolve({ json: { error: 'Parse error' }, isQuotaError: false })
        }
      })
    })
    req.on('error', (e) => resolve({ json: { error: e.message }, isQuotaError: false }))
    req.setTimeout(15000, () => { req.destroy(); resolve({ json: { error: 'Request timeout' }, isQuotaError: false }) })
  })
}

// ─── Uploads Playlist Cache ────────────────────────────────────────────────────

interface PlaylistCacheEntry {
  uploadsId: string
  fetchedAt: number
}

const UPLOADS_CACHE_FILE = path.join(getAppStoreDir(), 'uploads_cache.json')

const _uploadsCache = new Map<string, PlaylistCacheEntry>()

function _loadCacheFromDisk(): void {
  try {
    if (fs.existsSync(UPLOADS_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(UPLOADS_CACHE_FILE, 'utf-8'))
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (entry.channelId && entry.uploadsId) {
            _uploadsCache.set(entry.channelId, { uploadsId: entry.uploadsId, fetchedAt: entry.fetchedAt })
          }
        }
        devLog(`[SubFeed] Loaded ${_uploadsCache.size} cached uploads playlist IDs`)
      }
    }
  } catch (e) {
    console.warn('[SubFeed] Failed to load uploads cache:', e)
  }
}

function _saveCacheToDisk(): void {
  try {
    const entries = Array.from(_uploadsCache.entries()).map(([channelId, entry]) => ({
      channelId,
      uploadsId: entry.uploadsId,
      fetchedAt: entry.fetchedAt,
    }))
    fs.writeFileSync(UPLOADS_CACHE_FILE, JSON.stringify(entries, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[SubFeed] Failed to persist uploads cache:', e)
  }
}

// Load cache from disk at module startup
_loadCacheFromDisk()

function getCachedUploadsId(channelId: string): string | null {
  const cached = _uploadsCache.get(channelId)
  if (cached && Date.now() - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS) {
    return cached.uploadsId
  }
  return null
}

function setCachedUploadsId(channelId: string, uploadsId: string): void {
  _uploadsCache.set(channelId, { uploadsId, fetchedAt: Date.now() })
  _saveCacheToDisk()
}

/**
 * Fetch newest video from a channel via RSS feed (Tier 3 fallback).
 * RSS requires no auth and has no quota — but has ~2 min delay on new uploads.
 * Only works for channels with UC IDs (not handles/shortnames).
 */
async function fetchChannelWithRss(
  ch: { id: string; channelId?: string; name: string },
  seenVideoIds: Set<string> | undefined,
): Promise<SubscriptionVideo | null> {
  const channelId = ch.channelId || ch.id
  if (!channelId || !channelId.startsWith('UC')) return null

  const rssVideos = await getLatestVideosFromRss(channelId, 3)
  for (const rv of rssVideos) {
    if (seenVideoIds?.has(rv.videoId)) continue
    if (rv.title.includes('[deleted]') || rv.title.includes('[private]')) continue

    const publishedAt = rv.published ? new Date(rv.published).getTime() : 0
    // Age filter: skip videos older than 10 min. Accept publishedAt=0 (unparseable) — likely new upload.
    const MAX_VIDEO_AGE_MS = 10 * 60 * 1000
    if (publishedAt > 0 && Date.now() - publishedAt > MAX_VIDEO_AGE_MS) continue

    return {
      videoId: rv.videoId,
      title: rv.title,
      channelId,
      channelName: ch.name || 'Unknown',
      thumbnail: `https://img.youtube.com/vi/${rv.videoId}/mqdefault.jpg`,
      publishedAt,
      publishedText: rv.published,
      duration: '',
    }
  }
  return null
}

// ─── Per-Channel Fetch ─────────────────────────────────────────────────────────

/**
 * Fetch newest video from a channel via OAuth Data API v3.
 * Returns null if no new video found or error occurred.
 */
async function fetchChannelWithOAuth(
  ch: { id: string; channelId?: string; name: string },
  token: string,
  projectId: string,
  seenVideoIds: Set<string> | undefined,
): Promise<{ video: SubscriptionVideo | null; quotaError: boolean }> {
  const channelId = ch.channelId || ch.id
  if (!channelId) return { video: null, quotaError: false }

  // Step 1: get uploads playlist ID (check 24h cache first)
  let uploadsId = getCachedUploadsId(channelId)
  let quotaError = false

  if (!uploadsId) {
    const { json, isQuotaError } = await apiGet(
      `/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`,
      token,
    )
    if (json.error || !json.items?.[0]) {
      if (isQuotaError) quotaError = true
      return { video: null, quotaError }
    }
    uploadsId = json.items[0].contentDetails?.relatedPlaylists?.uploads || null
    if (uploadsId) setCachedUploadsId(channelId, uploadsId)
  }

  if (!uploadsId) return { video: null, quotaError: false }

  // Step 2: get newest video from uploads playlist
  const { json, isQuotaError } = await apiGet(
    `/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=1`,
    token,
  )

  if (json.error) {
    if (isQuotaError) quotaError = true
    _uploadsCache.delete(channelId)
    _saveCacheToDisk()
    return { video: null, quotaError }
  }

  if (!json.items?.length) return { video: null, quotaError: false }

  const snippet = json.items[0].snippet || {}
  const videoId = snippet.resourceId?.videoId
  if (!videoId) return { video: null, quotaError: false }

  const title = snippet.title || '(no title)'
  if (title.includes('[deleted]') || title.includes('[private]')) return { video: null, quotaError: false }
  if (seenVideoIds?.has(videoId)) return { video: null, quotaError: false }

  // Age filter: skip videos older than 10 min. Accept publishedAt=0 (unparseable) — likely new upload.
  const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : 0
  const MAX_VIDEO_AGE_MS = 10 * 60 * 1000
  if (publishedAt > 0 && Date.now() - publishedAt > MAX_VIDEO_AGE_MS) return { video: null, quotaError: false }

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
  }
}

/**
 * Verify a video's actual publishedAt via OAuth Data API v3.
 * OAuth returns the real upload timestamp (not cached text) — reliable even when
 * Innertube's published_time_text is empty due to YouTube cache lag.
 * Returns null on error or if video is too old (> 10 min).
 */
async function verifyVideoAgeByOAuth(videoId: string): Promise<{ publishedAt: number; title: string; channelTitle: string } | null> {
  try {
    const tm = getTokenManager()
    const best = await tm.getBestAvailable()
    if (!best) return null

    const { json, isQuotaError } = await apiGet(
      `/youtube/v3/videos?id=${encodeURIComponent(videoId)}&part=snippet`,
      best.token,
    )
    if (json.error || !json.items?.length) {
      if (isQuotaError) tm.trackError(best.projectId)
      return null
    }
    tm.track(best.projectId)

    const snippet = json.items[0].snippet || {}
    const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : 0
    const MAX_VIDEO_AGE_MS = 10 * 60 * 1000
    if (publishedAt === 0 || Date.now() - publishedAt > MAX_VIDEO_AGE_MS) return null

    return {
      publishedAt,
      title: snippet.title || '(no title)',
      channelTitle: snippet.channelTitle || 'Unknown',
    }
  } catch {
    return null
  }
}

/**
 * Fetch the newest video from a channel via Innertube (youtubei.js).
 * Returns null if no new video found or error occurred.
 *
 * Strategy: Trust YouTube tab order (sorted newest-first).
 * publishedTimeText from Innertube is UNRELIABLE for new uploads (cache lag).
 * When Innertube returns publishedAt=0, fall back to OAuth to verify real age.
 */
async function fetchChannelWithInnertube(
  ch: { id: string; channelId?: string; name: string },
  seenVideoIds: Set<string> | undefined,
): Promise<SubscriptionVideo | null> {
  const channelId = ch.channelId || ch.id
  if (!channelId) return null

  const latest = await getInnertubePool().then(p => p.getLatestVideo(channelId, seenVideoIds))
  if (!latest) return null

  // Innertube published_time_text is empty for new uploads (YouTube cache lag < 1 min).
  // When empty, verify via OAuth (returns real upload timestamp) to avoid missing
  // genuinely new videos. OAuth is accurate but costs 1 unit/call — only triggered
  // when Innertube itself returns empty timestamp.
  if (latest.publishedAt === 0) {
    devLog(`[SubFeed] Innertube publishedAt=0 for ${channelId}:${latest.videoId} — verifying via OAuth...`)
    const oauth = await verifyVideoAgeByOAuth(latest.videoId)
    if (oauth) {
      return {
        videoId: latest.videoId,
        title: oauth.title,
        channelId,
        channelName: (ch.name && ch.name !== 'N/A') ? ch.name : (oauth.channelTitle !== 'Unknown' ? oauth.channelTitle : latest.channelName),
        thumbnail: latest.thumbnail,
        publishedAt: oauth.publishedAt,
        duration: '',
      }
    }
    // OAuth says old or error → skip
    return null
  }

  return {
    videoId: latest.videoId,
    title: latest.title,
    channelId,
    channelName: (ch.name && ch.name !== 'N/A') ? ch.name : latest.channelName,
    thumbnail: latest.thumbnail,
    publishedAt: latest.publishedAt,
    duration: '',
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function fetchSubscriptionFeed(
  options: SubFeedOptions = {},
): Promise<SubFeedResult> {
  const { seenVideoIds } = options
  const targetStop = MAX_VIDEOS_PER_POLL

  const channels = getChannels()
  if (channels.length === 0) return { videos: [], source: 'none' }

  const results: SubscriptionVideo[] = []

  // ── Step 1: Try Innertube (PRIMARY — no quota limit) ─────────────────────────
  // Only fall back to OAuth when Innertube genuinely can't serve (no sessions, error).
  // Empty results (0 videos) = normal channel state, NOT a failure — don't waste OAuth quota.
  let innertubeAvailable = false
  try {
    const pool = await getInnertubePool()
    const readyCount = pool.getReadyCount()
    const totalSessions = pool.getStatus().totalSessions

    if (pool.isReady() && readyCount > 0) {
      innertubeAvailable = true

      for (let i = 0; i < channels.length; i += MAX_CONCURRENT) {
        const batch = channels.slice(i, i + MAX_CONCURRENT)
        const batchResults = await Promise.all(
          batch.map(ch => fetchChannelWithInnertube(ch, seenVideoIds))
        )

        let batchNewCount = 0
        for (const video of batchResults) {
          if (video) {
            results.push(video)
            seenVideoIds?.add(video.videoId)
            batchNewCount++
            if (results.length >= targetStop) {
              devLog(`[SubFeed] Innertube: ${results.length} videos found — returning`)
              return { videos: results, source: 'innertube' }
            }
          }
        }
      }

      // Scanned all channels — got 0 new videos. This is NORMAL.
      // Return now WITHOUT touching OAuth quota.
      devLog(`[SubFeed] Innertube: 0 videos across ${channels.length} channels (no new content)`)

      // Track zero-result polls for degraded state reporting
      if (results.length === 0) {
        _consecutiveZeroInnertubePolls++
      } else {
        _consecutiveZeroInnertubePolls = 0
      }

      return {
        videos: results,
        source: 'innertube',
        degraded: _consecutiveZeroInnertubePolls >= 3,
      }
    } else {
      // No Innertube sessions ready — must use OAuth
      devLog(`[SubFeed] Innertube: 0/${totalSessions} sessions ready — OAuth fallback`)
      innertubeAvailable = false
    }
  } catch (e) {
    devLog(`[SubFeed] Innertube error: ${e} — OAuth fallback`)
    innertubeAvailable = false
  }

  // ── Step 2: OAuth Fallback ───────────────────────────────────────────────────
  // Only reached if Innertube genuinely unavailable (no sessions or exception).
  if (results.length === 0 && !innertubeAvailable) {
    const tm = getTokenManager()
    const statuses = tm.getAllStatuses()
    const hasAvailable = statuses.some(ts => ts.hasToken && ts.status !== 'exhausted')

    if (!hasAvailable) {
      return {
        videos: [],
        allSourcesExhausted: true,
        source: 'oauth',
      }
    }

    for (let i = 0; i < channels.length; i += MAX_CONCURRENT) {
      const batch = channels.slice(i, i + MAX_CONCURRENT)
      const best = await tm.getBestAvailable()
      if (!best) break

      const batchResults = await Promise.all(
        batch.map(ch => fetchChannelWithOAuth(ch, best.token, best.projectId, seenVideoIds))
      )

      let tokenExhausted = false
      for (const { video, quotaError } of batchResults) {
        if (quotaError) {
          tm.trackError(best.projectId)
          tokenExhausted = true
        } else {
          tm.track(best.projectId)
        }
        if (video && !results.some(r => r.videoId === video.videoId)) {
          results.push(video)
          seenVideoIds?.add(video.videoId)
          if (results.length >= targetStop) {
            devLog(`[SubFeed] OAuth: early exit at ${results.length} videos`)
            return { videos: results, source: 'oauth' }
          }
        }
      }

      if (tokenExhausted) {
        devLog(`[SubFeed] OAuth token ${best.projectId} exhausted — switching`)
        // Retry remaining channels with fresh token
        const retryBest = await tm.getBestAvailable()
        if (retryBest && retryBest.projectId !== best.projectId) {
          const retryChannels = channels.slice(i, i + MAX_CONCURRENT)
          const retryResults = await Promise.all(
            retryChannels.map(ch => fetchChannelWithOAuth(ch, retryBest.token, retryBest.projectId, seenVideoIds))
          )
          for (const { video, quotaError } of retryResults) {
            if (quotaError) {
              tm.trackError(retryBest.projectId)
            } else {
              tm.track(retryBest.projectId)
            }
            if (video && !results.some(r => r.videoId === video.videoId)) {
              results.push(video)
              seenVideoIds?.add(video.videoId)
              if (results.length >= targetStop) {
                return { videos: results, source: 'oauth' }
              }
            }
          }
        }
      }
    }
  }

  // ── Step 3: RSS Fallback (Tier 3) ────────────────────────────────────────────
  // Only triggers when both Innertube and OAuth returned 0 videos.
  // RSS requires no auth, no quota — but has ~2 min delay on new uploads.
  // Limit to top-10 priority channels to avoid spam (RSS is slow: ~1s/channel).
  if (results.length === 0) {
    const priorityChannels = channels.slice(0, 10)
    const RSS_CONCURRENT = 3 // max parallel RSS requests — RSS is slow
    devLog(`[SubFeed] ⚠️ Both Innertube + OAuth exhausted — trying RSS for ${priorityChannels.length} priority channels...`)

    for (let i = 0; i < priorityChannels.length; i += RSS_CONCURRENT) {
      const batch = priorityChannels.slice(i, i + RSS_CONCURRENT)
      const rssResults = await Promise.all(
        batch.map(ch => fetchChannelWithRss(ch, seenVideoIds))
      )
      for (const video of rssResults) {
        if (video && !results.some(r => r.videoId === video.videoId)) {
          results.push(video)
          seenVideoIds?.add(video.videoId)
          if (results.length >= targetStop) {
            devLog(`[SubFeed] RSS fallback: early exit at ${results.length} videos`)
            break
          }
        }
      }
      if (results.length >= targetStop) break
    }
    if (results.length > 0) {
      devLog(`[SubFeed] RSS fallback: found ${results.length} video(s)`)
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  const unique: SubscriptionVideo[] = []
  for (const v of results) {
    if (!seen.has(v.videoId)) { seen.add(v.videoId); unique.push(v) }
  }

  // Determine source: innertube (has duration), oauth/rss (no duration field)
  const innertubeCount = results.filter(r => r.duration && r.duration !== '').length
  const source = innertubeCount > 0 ? 'innertube' : 'oauth'

  if (unique.length > 0) {
    const newest = unique[0]
    const ageMin = (Date.now() - newest.publishedAt) / 60000
    const ageLabel = ageMin < 1 ? 'vua xong' : Math.floor(ageMin) + 'm ago'
    devLog(`[SubFeed] ${unique.length} video(s) found (${source}): "${newest.title.slice(0, 40)}" from ${newest.channelName} (${ageLabel})`)
  }

  return { videos: unique, source: unique.length > 0 ? source : 'oauth' }
}

// ─── Channel Cache ─────────────────────────────────────────────────────────────

export function refreshChannelCache(): void {
  // Channels are read directly from the store — no in-memory cache to refresh
  // This function is kept for API compatibility but is now a no-op
}