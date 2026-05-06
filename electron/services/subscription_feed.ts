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
}

export interface SubFeedOptions {
  seenVideoIds?: Set<string>
  sinceMs?: number
  maxVideos?: number
  /** On first poll: use relaxed age filter (24h) to capture all recent uploads */
  firstPoll?: boolean
}

// ─── Config ─────────────────────────────────────────────────────────────────────

const MAX_VIDEO_AGE_MS = 30 * 60 * 1000 // 30 minutes — auto-download window (for yt-dlp trim), not for detection filter
const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h uploads playlist cache
const MAX_CONCURRENT = 5   // parallel API calls per poll
const MAX_VIDEOS_PER_POLL = 5

// ─── Module-level state ────────────────────────────────────────────────────────

/** Consecutive polls where Innertube returned 0 videos — for OAuth health-check trigger */
let _consecutiveZeroInnertubePolls = 0
const ZERO_POLL_THRESHOLD = 3 // After 3 consecutive zero-result polls → force OAuth health check

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
      channelName: ch.name || snippet.channelTitle || 'Unknown',
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
  firstPoll?: boolean,
): Promise<SubscriptionVideo | null> {
  const channelId = ch.channelId || ch.id
  if (!channelId) return null

  const latest = await getInnertubePool().then(p => p.getLatestVideo(channelId, seenVideoIds, firstPoll))
  if (!latest) return null

  return {
    videoId: latest.videoId,
    title: latest.title,
    channelId,
    channelName: latest.channelName,
    thumbnail: latest.thumbnail,
    publishedAt: latest.publishedAt,
    duration: '',
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function fetchSubscriptionFeed(
  options: SubFeedOptions = {},
): Promise<SubFeedResult> {
  const { seenVideoIds, sinceMs, firstPoll } = options
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
          batch.map(ch => fetchChannelWithInnertube(ch, seenVideoIds, firstPoll))
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
        console.log(`[SubFeed] batch ${i / MAX_CONCURRENT + 1}: ${batchNewCount} new, ${batchResults.length - batchNewCount} seen`)
      }

      // Scanned all channels — got 0 new videos. This is NORMAL.
      // Return now WITHOUT touching OAuth quota.
      console.log(`[SubFeed] Innertube: 0 videos across ${channels.length} channels (no new content)`)

      // Track zero-result polls for silent-death detection (Phase 3 of reliability_plan)
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
          _consecutiveZeroInnertubePolls = 0 // Reset after health check
        }
      } else {
        _consecutiveZeroInnertubePolls = 0 // Got videos → reset counter
      }

      return { videos: results, source: 'innertube' }
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

  // Deduplicate
  const seen = new Set<string>()
  const unique: SubscriptionVideo[] = []
  for (const v of results) {
    if (!seen.has(v.videoId)) { seen.add(v.videoId); unique.push(v) }
  }

  if (unique.length > 0) {
    const source = results.some(r => !r.duration) ? 'oauth' : 'innertube'
    const newest = unique[0]
    const ageMin = (Date.now() - newest.publishedAt) / 60000
    const ageLabel = ageMin < 1 ? 'vua xong' : Math.floor(ageMin) + 'm ago'
    console.log(`[SubFeed] ${unique.length} video(s) found (${source}): "${newest.title.slice(0, 40)}" from ${newest.channelName} (${ageLabel})`)
  }

  return { videos: unique, source: unique.length > 0 ? 'innertube' : 'oauth' }
}

// ─── Channel Cache ─────────────────────────────────────────────────────────────

export function refreshChannelCache(): void {
  // Channels are read directly from the store — no in-memory cache to refresh
  // This function is kept for API compatibility but is now a no-op
}