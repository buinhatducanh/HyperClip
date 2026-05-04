/**
 * Subscription Feed — HyperClip
 *
 * Detection: OAuth Data API v3 playlistItems per channel.
 * TokenManager handles per-project quota (10k units/day) and smart rotation.
 * Token batching: 1 token per batch of 5 channels (reduces overhead ~90%).
 * Early termination: stops after 5 new videos found — saves quota.
 * Uploads playlist ID cached 24h — saves 1 API call/channel/poll.
 */

import https from 'https'
import { getTokenManager } from './token_manager.js'
import { getChannels } from './store.js'

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
  source: 'oauth'
}

export interface SubFeedOptions {
  seenVideoIds?: Set<string>
  sinceMs?: number
  maxVideos?: number
  /** Stops fetching after this many new videos — saves quota. */
  stopAfterCount?: number
}

// ─── Config ─────────────────────────────────────────────────────────────────────

const MAX_VIDEO_AGE_MS = 10 * 60 * 1000 // 10 minutes
const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h uploads playlist cache
const MAX_CONCURRENT = 5   // parallel API calls per poll
const MAX_VIDEOS_PER_POLL = 5

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

async function fetchChannelWithToken(
  ch: { id: string; channelId?: string; name: string },
  token: string,
  projectId: string,
  seenVideoIds: Set<string> | undefined,
  sinceMs: number,
): Promise<{ videos: SubscriptionVideo[]; quotaError: boolean }> {
  const channelId = ch.channelId || ch.id
  if (!channelId) return { videos: [], quotaError: false }

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
      return { videos: [], quotaError }
    }
    uploadsId = json.items[0].contentDetails?.relatedPlaylists?.uploads || null
    if (uploadsId) setCachedUploadsId(channelId, uploadsId)
  }

  if (!uploadsId) return { videos: [], quotaError: false }

  // Step 2: get newest video from uploads playlist
  const { json, isQuotaError } = await apiGet(
    `/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=1`,
    token,
  )

  if (json.error) {
    if (isQuotaError) quotaError = true
    _uploadsCache.delete(channelId) // invalidate cache on error
    return { videos: [], quotaError }
  }

  if (!json.items?.length) return { videos: [], quotaError: false }

  const snippet = json.items[0].snippet || {}
  const videoId = snippet.resourceId?.videoId
  if (!videoId) return { videos: [], quotaError: false }

  const title = snippet.title || '(no title)'
  if (title.includes('[deleted]') || title.includes('[private]')) return { videos: [], quotaError: false }
  if (seenVideoIds?.has(videoId)) return { videos: [], quotaError: false }

  const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : 0
  if (publishedAt > 0 && publishedAt < sinceMs) return { videos: [], quotaError: false }
  if (publishedAt === 0) return { videos: [], quotaError: false }

  return {
    videos: [{
      videoId,
      title,
      channelId,
      channelName: ch.name || snippet.channelTitle || 'Unknown',
      thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
      publishedAt,
      duration: '',
    }],
    quotaError: false,
  }
}

// ─── Channel Cache ─────────────────────────────────────────────────────────────

export function refreshChannelCache(): void {
  // Channels read directly from store each poll — no separate cache to refresh
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function fetchSubscriptionFeed(
  options: SubFeedOptions = {},
): Promise<SubFeedResult> {
  const { seenVideoIds, sinceMs, stopAfterCount } = options
  const cutoff = sinceMs ?? (Date.now() - MAX_VIDEO_AGE_MS)
  const targetStop = stopAfterCount ?? options.maxVideos ?? MAX_VIDEOS_PER_POLL

  const channels = getChannels()
  if (channels.length === 0) return { videos: [], source: 'oauth' }

  const tm = getTokenManager()
  const statuses = tm.getAllStatuses()
  const hasAvailable = statuses.some(ts => ts.hasToken && ts.status !== 'exhausted')

  if (!hasAvailable) {
    return { videos: [], allSourcesExhausted: true, source: 'oauth' }
  }

  const results: SubscriptionVideo[] = []
  let allExhausted = false

  // Token batching: 1 token for a batch of MAX_CONCURRENT channels.
  // getBestAvailable() skips tokens with errors >= 5 (exhausted), so we get a fresh
  // token per batch automatically — no need to manually track/rotate.
  for (let i = 0; i < channels.length; i += MAX_CONCURRENT) {
    const batch = channels.slice(i, i + MAX_CONCURRENT)
    const best = await tm.getBestAvailable()
    if (!best) { allExhausted = true; break }

    const batchResults = await Promise.all(
      batch.map(ch => fetchChannelWithToken(ch, best.token, best.projectId, seenVideoIds, cutoff))
    )

    let tokenExhausted = false
    for (const { videos, quotaError } of batchResults) {
      if (quotaError) {
        tm.trackError(best.projectId)
        tokenExhausted = true
      } else {
        tm.track(best.projectId)
      }
      results.push(...videos)

      // Early termination: stop as soon as we have enough new videos
      if (results.length >= targetStop) {
        console.log(`[SubFeed] Early exit: ${results.length} videos found`)
        return { videos: results, source: 'oauth' }
      }
    }

    if (tokenExhausted) {
      console.log(`[SubFeed] Token ${best.projectId} exhausted — switching`)
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  const unique: SubscriptionVideo[] = []
  for (const v of results) {
    if (!seen.has(v.videoId)) { seen.add(v.videoId); unique.push(v) }
  }

  if (unique.length > 0) {
    const newest = unique[0]
    const ageMin = (Date.now() - newest.publishedAt) / 60000
    const ageLabel = ageMin < 1 ? 'vua xong' : Math.floor(ageMin) + 'm ago'
    console.log(`[SubFeed] ${unique.length} video(s) found — newest: "${newest.title.slice(0, 40)}" from ${newest.channelName} (${ageLabel})`)
  } else if (allExhausted) {
    console.log('[SubFeed] No tokens available — all exhausted')
    return { videos: [], allSourcesExhausted: true, source: 'oauth' }
  }

  return { videos: unique, source: 'oauth' }
}
