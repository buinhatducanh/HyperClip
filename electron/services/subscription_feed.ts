/**
 * Subscription Feed — HyperClip
 *
 * Full scan: checks ALL subscribed channels every poll via playlistItems.
 * OAuth-only — no Innertube (cookies), no API key. TokenManager handles
 * per-project quota (10k units/day) and smart rotation across N projects.
 *
 * Quota math (49 channels):
 *   - With early termination (stopAfter=5): most polls use 5 calls per channel batch
 *   - Worst case (no new videos, all 49 scanned): 49 calls/poll
 *   - Poll every 5s: 4,320 polls/day → ~282k calls worst case
 *   - But since early termination kicks in at channel level (stopAfter=5),
 *     actual avg ~5-10 calls/poll → ~21k-43k units/day
 *   - With 1 GCP project: 9,500/day → sufficient if early termination works well
 *   - With 2+ GCP projects: 19,000+/day → comfortable
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
  /** True when ALL detection sources are unavailable (no OAuth tokens) */
  allSourcesExhausted?: boolean
  source: 'oauth'
}

export interface SubFeedOptions {
  seenVideoIds?: Set<string>
  sinceMs?: number
  maxVideos?: number
  /** When true, stops fetching more channels once we have this many new videos.
   * Early termination — saves quota when we already found enough. */
  stopAfterCount?: number
}

// ─── Config ─────────────────────────────────────────────────────────────────────

const MAX_VIDEO_AGE_MS = 10 * 60 * 1000 // 10 minutes — auto-download videos posted < 10 min ago
const MIN_VIDEO_DURATION_MS = 60 * 1000 // Skip auto-download for videos < 60s (YouTube Shorts)
const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h uploads playlist cache
const MAX_CONCURRENT = 20 // max parallel API calls per poll
const MAX_VIDEOS_PER_POLL = 5

// ─── API Helper ────────────────────────────────────────────────────────────────

interface TokenInfo {
  projectId: string
  token: string
}

/** Get a fresh token for each channel fetch (round-robin across available tokens). */
async function getChannelToken(): Promise<TokenInfo | null> {
  const tm = getTokenManager()
  const best = await tm.getBestAvailable()
  if (!best) return null
  return { projectId: best.projectId, token: best.token }
}

function apiGet(
  urlStr: string,
  token: string,
): Promise<any> {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: 'www.googleapis.com',
      path: urlStr,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          // Debug: log newest video's age in playlistItems — shows if within 10min window
          if (urlStr.includes('playlistItems') && json.items?.length > 0) {
            const now = Date.now()
            const first = json.items[0].snippet
            const ms = first?.publishedAt ? new Date(first.publishedAt).getTime() : 0
            const age = ms > 0 ? Math.round((now - ms) / 60000) : -1
            console.log(`[apiGet] newest="${first?.title?.slice(0, 35)}" age=${age}m (cutoff=10m)`)
          }
          resolve(json)
        } catch {
          resolve({ error: 'Parse error', data: data.slice(0, 200) })
        }
      })
    })

    req.on('error', (e) => resolve({ error: e.message }))
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'Request timeout' }) })
  })
}

// ─── Channel Cache ─────────────────────────────────────────────────────────────

const _channelCache: Array<{ id: string; channelId?: string; name: string }> = []

export function refreshChannelCache(): void {
  const channels = getChannels()
  _channelCache.length = 0
  for (const c of channels) {
    _channelCache.push({ id: c.id, channelId: c.channelId, name: c.name })
  }
}

// ─── Uploads Playlist Cache ────────────────────────────────────────────────────

interface PlaylistCacheEntry {
  uploadsId: string
  fetchedAt: number
}

const _uploadsPlaylistCache = new Map<string, PlaylistCacheEntry>()

function getCachedUploadsId(channelId: string): string | null {
  const cached = _uploadsPlaylistCache.get(channelId)
  if (cached && Date.now() - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS) {
    return cached.uploadsId
  }
  return null
}

function setCachedUploadsId(channelId: string, uploadsId: string): void {
  _uploadsPlaylistCache.set(channelId, { uploadsId, fetchedAt: Date.now() })
}

// ─── Concurrency Limiter ───────────────────────────────────────────────────────

async function parallel<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R[]>,
  stopAfterCount?: number,
): Promise<R[]> {
  const results: R[][] = []

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(fn))
    for (const br of batchResults) {
      results.push(br)
      if (stopAfterCount !== undefined && results.flat().length >= stopAfterCount) {
        return results.flat()
      }
    }
  }

  return results.flat()
}

// ─── Per-Channel Fetch ─────────────────────────────────────────────────────────

async function fetchChannelVideos(
  ch: { id: string; channelId?: string; name: string },
  seenVideoIds: Set<string> | undefined,
  sinceMs: number,
): Promise<SubscriptionVideo[]> {
  const channelId = ch.channelId || ch.id
  if (!channelId) return []

  const tokenInfo = await getChannelToken()
  if (!tokenInfo) {
    // No tokens available
    return []
  }
  const { token } = tokenInfo

  // Step 1: get uploads playlist ID (check cache first)
  let uploadsId = getCachedUploadsId(channelId)
  if (!uploadsId) {
    const channelJson = await apiGet(
      `/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`,
      token,
    )
    if (channelJson.error || !channelJson.items?.[0]) {
      // Track quota even on error so exhausted tokens get filtered out
      if (channelJson.error) {
        const tm = getTokenManager()
        tm.trackError(tokenInfo.projectId)
      }
      return []
    }
    uploadsId = channelJson.items[0].contentDetails?.relatedPlaylists?.uploads || null
    if (uploadsId) setCachedUploadsId(channelId, uploadsId)
  }

  if (!uploadsId) return []

  // Step 2: get recent playlist items (maxResults=1 — only need the newest)
  const playlistJson = await apiGet(
    `/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=1`,
    token,
  )

  if (playlistJson.error) {
    console.warn(`[SubFeed] OAuth error for ${ch.name}: ${playlistJson.error}`)
    // Track quota on error — pushes token toward exhaustion so getBestAvailable skips it
    const tm = getTokenManager()
    tm.trackError(tokenInfo.projectId)
    // Invalidate cache so next poll can retry with potentially fresh token
    _uploadsPlaylistCache.delete(channelId)
    return []
  }

  // Track token quota on successful API call (even if 0 items)
  const tm = getTokenManager()
  tm.track(tokenInfo.projectId)

  if (!playlistJson.items || playlistJson.items.length === 0) {
    return []
  }

  const videos: SubscriptionVideo[] = []

  for (const item of playlistJson.items || []) {
    const snippet = item.snippet || {}
    const videoId = snippet.resourceId?.videoId
    if (!videoId) continue

    const title = snippet.title || '(no title)'
    if (title.includes('[deleted]') || title.includes('[private]')) continue
    if (seenVideoIds?.has(videoId)) continue

    const publishedAt = snippet.publishedAt
      ? new Date(snippet.publishedAt).getTime()
      : 0

    if (publishedAt > 0 && publishedAt < sinceMs) continue

    // Skip if we can't determine age
    if (publishedAt === 0) {
      console.log(`[SubFeed] OAuth: no valid timestamp for "${title}" from ${ch.name} — skipping`)
      continue
    }

    videos.push({
      videoId,
      title,
      channelId,
      channelName: ch.name || snippet.channelTitle || 'Unknown',
      thumbnail: snippet.thumbnails?.medium?.url ||
        snippet.thumbnails?.default?.url || '',
      publishedAt,
      duration: '',
    })
  }

  if (videos.length > 0) {
    const ageLabel = videos[0].publishedAt > 0
      ? ((Date.now() - videos[0].publishedAt) / 60000 < 1 ? 'vua xong' : Math.floor((Date.now() - videos[0].publishedAt) / 60000) + 'm ago')
      : '?'
    console.log(`[SubFeed] ✓ "${videos[0].title.slice(0, 40)}" from ${ch.name} (${ageLabel})`)
  }

  return videos
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function fetchSubscriptionFeed(
  options: SubFeedOptions = {},
): Promise<SubFeedResult> {
  const { seenVideoIds, sinceMs, maxVideos, stopAfterCount } = options
  const cutoff = sinceMs ?? (Date.now() - MAX_VIDEO_AGE_MS)

  const channels = getChannels()
  if (channels.length === 0) {
    return { videos: [], source: 'oauth' }
  }

  // Check: is any OAuth token available?
  const tm = getTokenManager()
  const tmStatuses = tm.getAllStatuses()
  const hasOAuth = tmStatuses.some(ts => ts.hasToken && ts.status !== 'exhausted')

  const allSourcesExhausted = !hasOAuth

  const targetStop = stopAfterCount ?? maxVideos ?? MAX_VIDEOS_PER_POLL
  console.log(`[SubFeed] Scanning ${channels.length} channels (max ${MAX_CONCURRENT} concurrent, stop after ${targetStop})...`)

  const allVideos = await parallel(
    channels,
    MAX_CONCURRENT,
    (ch) => fetchChannelVideos(ch, seenVideoIds, cutoff),
    targetStop,
  )

  // Deduplicate (same video from different channels)
  const seen = new Set<string>()
  const unique: SubscriptionVideo[] = []
  for (const v of allVideos) {
    if (!seen.has(v.videoId)) {
      seen.add(v.videoId)
      unique.push(v)
    }
  }

  if (unique.length > 0) {
    console.log(`[SubFeed] Total: ${unique.length} new videos from ${channels.length} channels`)
  } else {
    if (allSourcesExhausted) {
      console.warn(`[SubFeed] Exhausted: all OAuth tokens exhausted. Add more GCP projects in Settings.`)
    } else {
      console.log(`[SubFeed] No new videos — scanned ${channels.length} channels. OAuth: available`)
    }
  }

  return {
    videos: unique,
    allSourcesExhausted,
    source: 'oauth',
  }
}