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
import { getTokenManager } from './token_manager.js'
import { getChannels } from './store.js'
import { getInnertubePool } from './innertube_client.js'
import { getLatestVideosFromRss } from './youtube.js'

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
  sinceMs?: number
  maxVideos?: number
}

// ─── Config ─────────────────────────────────────────────────────────────────────

const MAX_VIDEO_AGE_MS = 10 * 60 * 1000 // 10 minutes — consistent age filter for both Innertube and OAuth paths
const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h uploads playlist cache
const MAX_CONCURRENT = 10  // parallel API calls per poll — faster scan for < 20s detection
const MAX_VIDEOS_PER_POLL = 5

// ─── Module-level state ────────────────────────────────────────────────────────

/** Consecutive polls where Innertube returned 0 videos — for OAuth health-check trigger */
let _consecutiveZeroInnertubePolls = 0
const ZERO_POLL_THRESHOLD = 3 // After 3 consecutive zero-result polls → run OAuth health check
const PRIORITY_RESCAN_COUNT = 5 // Immediately re-scan top-5 priority channels when Innertube returns 0 — catches videos with empty published_time_text

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
            console.log(`[SubFeed] 403 — reason: "${reason}", message: "${msg}"`)
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

const _uploadsCache = new Map<string, PlaylistCacheEntry>()

function getCachedUploadsId(channelId: string): string | null {
  const cached = _uploadsCache.get(channelId)
  if (cached && Date.now() - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS) {
    return cached.uploadsId
  }
  return null
}

function setCachedUploadsId(channelId: string, uploadsId: string): void {
  _uploadsCache.set(channelId, { uploadsId, fetchedAt: Date.now() })
}

/**
 * Fetch newest video from a channel via RSS feed (Tier 3 fallback).
 * RSS requires no auth and has no quota — but has ~2 min delay on new uploads.
 * Only works for channels with UC IDs (not handles/shortnames).
 */
async function fetchChannelWithRss(
  ch: { id: string; channelId?: string; name: string },
  seenVideoIds: Set<string> | undefined,
  sinceMs: number,
): Promise<SubscriptionVideo | null> {
  const channelId = ch.channelId || ch.id
  if (!channelId || !channelId.startsWith('UC')) return null

  const rssVideos = await getLatestVideosFromRss(channelId, 3)
  for (const rv of rssVideos) {
    if (seenVideoIds?.has(rv.videoId)) continue
    if (rv.title.includes('[deleted]') || rv.title.includes('[private]')) continue

    const publishedAt = rv.published ? new Date(rv.published).getTime() : 0
    if (publishedAt > 0 && publishedAt < sinceMs) continue

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
  sinceMs: number,
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
    return { video: null, quotaError }
  }

  if (!json.items?.length) return { video: null, quotaError: false }

  const snippet = json.items[0].snippet || {}
  const videoId = snippet.resourceId?.videoId
  if (!videoId) return { video: null, quotaError: false }

  const title = snippet.title || '(no title)'
  if (title.includes('[deleted]') || title.includes('[private]')) return { video: null, quotaError: false }
  if (seenVideoIds?.has(videoId)) return { video: null, quotaError: false }

  const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : 0
  if (publishedAt > 0 && publishedAt < sinceMs) return { video: null, quotaError: false }
  if (publishedAt === 0) return { video: null, quotaError: false }

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
 * Fetch the newest video from a channel via Innertube (youtubei.js).
 * Returns null if no new video found or error occurred.
 *
 * Strategy: Trust YouTube tab order (sorted newest-first).
 * publishedTimeText is UNRELIABLE for new uploads (caches old timestamps).
 * Instead, pass seenVideoIds to getLatestVideo() which checks top-1 dedup internally.
 * If top-1 is already seen → return null immediately (all older videos are also seen).
 */
async function fetchChannelWithInnertube(
  ch: { id: string; channelId?: string; name: string },
  seenVideoIds: Set<string> | undefined,
): Promise<SubscriptionVideo | null> {
  const channelId = ch.channelId || ch.id
  if (!channelId) return null

  const latest = await getInnertubePool().then(p => p.getLatestVideo(channelId, seenVideoIds))
  if (!latest) return null

  return {
    videoId: latest.videoId,
    title: latest.title,
    channelId,
    // Use ch.name (database) first — it always has the correct channel name.
    // latest.channelName comes from video metadata extraction which can fail for LockupView items.
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
  const { seenVideoIds, sinceMs } = options
  // sinceMs is always provided by the poller (Date.now() - MAX_VIDEO_AGE_MS).
  // No fallback needed — avoids double-subtraction bug.
  const cutoff = sinceMs ?? Date.now()
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
              console.log(`[SubFeed] Innertube: ${results.length} videos found — returning`)
              return { videos: results, source: 'innertube' }
            }
          }
        }
      }

      // Scanned all channels — got 0 new videos. This is NORMAL.
      // Return now WITHOUT touching OAuth quota.
      console.log(`[SubFeed] Innertube: 0 videos across ${channels.length} channels (no new content)`)

      // ⚡ IMMEDIATE PRIORITY RE-SCAN: When Innertube returns 0 videos, it often means
      // the top-1 video has published="" (YouTube hasn't cached the timestamp yet).
      // YouTube usually caches the timestamp within 1-2 poll cycles (~5-10s).
      // Instead of waiting for the next poll, re-scan top-5 priority channels NOW.
      // Accept videos with unparseable age in this re-scan — they're likely the missing videos.
      if (results.length === 0) {
        console.log(`[SubFeed] ⚡ Priority re-scan: checking top ${PRIORITY_RESCAN_COUNT} channels for unparseable-age videos...`)
        const priorityChannels = channels.slice(0, PRIORITY_RESCAN_COUNT)
        const rescanResults = await Promise.all(
          priorityChannels.map(async (ch) => {
            try {
              const latest = await getInnertubePool().then(p => p.getLatestVideoPriority(ch.channelId || ch.id, seenVideoIds))
              if (!latest) return null
              return {
                videoId: latest.videoId,
                title: latest.title,
                channelId: ch.channelId || ch.id,
                channelName: (ch.name && ch.name !== 'N/A') ? ch.name : latest.channelName,
                thumbnail: latest.thumbnail,
                publishedAt: latest.publishedAt,
                duration: '',
              }
            } catch {
              return null
            }
          })
        )
        for (const video of rescanResults) {
          if (video && !results.some(r => r.videoId === video.videoId)) {
            results.push(video)
            seenVideoIds?.add(video.videoId)
            console.log(`[SubFeed] ⚡ Priority re-scan found: "${video.title.slice(0, 40)}" from ${video.channelName}`)
            if (results.length >= targetStop) break
          }
        }
      }

      // Track zero-result polls for silent-death detection (Phase 3 of reliability_plan)
      let degraded = false
      if (results.length === 0) {
        _consecutiveZeroInnertubePolls++
        if (_consecutiveZeroInnertubePolls >= ZERO_POLL_THRESHOLD) {
          // Force a minimal OAuth health check to verify OAuth still works
          // This catches silent death where Innertube seems healthy but returns no content
          console.warn(`[SubFeed] ⚠️ ${_consecutiveZeroInnertubePolls} consecutive Innertube zero-result polls — running OAuth health check`)
          try {
            const tm = getTokenManager()
            const best = await tm.getBestAvailable()
            if (best && channels.length > 0) {
              const testChannel = channels[0]
              const oauthResult = await fetchChannelWithOAuth(
                testChannel, best.token, best.projectId, seenVideoIds, cutoff
              )
              if (oauthResult.video) {
                console.warn('[SubFeed] OAuth health check found a video — Innertube may be returning stale data')
              } else {
                console.log('[SubFeed] OAuth health check: no new videos either — all sources truly empty')
              }
            }
          } catch (e) {
            console.log(`[SubFeed] OAuth health check failed: ${e}`)
          }
          degraded = true // Signal degraded state to UI
          _consecutiveZeroInnertubePolls = 0 // Reset after health check
        }
      } else {
        _consecutiveZeroInnertubePolls = 0 // Got videos → reset counter
      }

      return {
        videos: results,
        source: 'innertube',
        degraded,
      }
    } else {
      // No Innertube sessions ready — must use OAuth
      console.log(`[SubFeed] Innertube: 0/${totalSessions} sessions ready — OAuth fallback`)
      innertubeAvailable = false
    }
  } catch (e) {
    console.log(`[SubFeed] Innertube error: ${e} — OAuth fallback`)
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
        batch.map(ch => fetchChannelWithOAuth(ch, best.token, best.projectId, seenVideoIds, cutoff))
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
            console.log(`[SubFeed] OAuth: early exit at ${results.length} videos`)
            return { videos: results, source: 'oauth' }
          }
        }
      }

      if (tokenExhausted) {
        console.log(`[SubFeed] OAuth token ${best.projectId} exhausted — switching`)
        // Retry remaining channels with fresh token
        const retryBest = await tm.getBestAvailable()
        if (retryBest && retryBest.projectId !== best.projectId) {
          const retryChannels = channels.slice(i, i + MAX_CONCURRENT)
          const retryResults = await Promise.all(
            retryChannels.map(ch => fetchChannelWithOAuth(ch, retryBest.token, retryBest.projectId, seenVideoIds, cutoff))
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
    console.log(`[SubFeed] ⚠️ Both Innertube + OAuth exhausted — trying RSS for ${priorityChannels.length} priority channels...`)

    for (let i = 0; i < priorityChannels.length; i += RSS_CONCURRENT) {
      const batch = priorityChannels.slice(i, i + RSS_CONCURRENT)
      const rssResults = await Promise.all(
        batch.map(ch => fetchChannelWithRss(ch, seenVideoIds, cutoff))
      )
      for (const video of rssResults) {
        if (video && !results.some(r => r.videoId === video.videoId)) {
          results.push(video)
          seenVideoIds?.add(video.videoId)
          if (results.length >= targetStop) {
            console.log(`[SubFeed] RSS fallback: early exit at ${results.length} videos`)
            break
          }
        }
      }
      if (results.length >= targetStop) break
    }
    if (results.length > 0) {
      console.log(`[SubFeed] RSS fallback: found ${results.length} video(s)`)
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
    console.log(`[SubFeed] ${unique.length} video(s) found (${source}): "${newest.title.slice(0, 40)}" from ${newest.channelName} (${ageLabel})`)
  }

  return { videos: unique, source: unique.length > 0 ? source : 'oauth' }
}

// ─── Channel Cache ─────────────────────────────────────────────────────────────

export function refreshChannelCache(): void {
  // Channels are read directly from the store — no in-memory cache to refresh
  // This function is kept for API compatibility but is now a no-op
}