/**
 * Subscription Feed — HyperClip
 *
 * Full scan: checks ALL subscribed channels every poll via playlistItems.
 * Each channel call uses the best-available key with remaining quota.
 *
 * Quota math (full scan, 20s interval, 100 channels):
 *   100 channels × 2 units = 200 units/poll
 *   4,320 polls/day × 200 = 864,000 units/day
 *   1 project = 10,000 units → needs 87 projects
 *
 * With 30 projects = 300,000 units → poll ~58s
 *
 * activities?home=true is DEPRECATED (Google removed it).
 * No replacement in Data API v3. Only playlistItems per channel works.
 */

import https from 'https'
import { getKeyManager } from './key_manager.js'
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
  source: 'playlist'
}

export interface SubFeedOptions {
  seenVideoIds?: Set<string>
  sinceMs?: number
  maxVideos?: number
}

// ─── Config ─────────────────────────────────────────────────────────────────────

const MAX_VIDEO_AGE_MS = 60 * 1000 // 1 minute — only auto-download videos posted < 1 min ago
const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h uploads playlist cache
const MAX_CONCURRENT = 20 // max parallel API calls per poll

// ─── API Helper ────────────────────────────────────────────────────────────────

function apiGet(
  urlStr: string, apiKey: string, token: string,
): Promise<any> {
  return new Promise((resolve) => {
    const url = new URL(urlStr)
    url.searchParams.set('key', apiKey)

    const req = https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve({ error: 'Parse error', data: data.slice(0, 200) })
        }
      })
    })

    req.on('error', (e) => resolve({ error: e.message }))
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'Request timeout' }) })
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
): Promise<R[]> {
  const results: R[][] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
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

  const km = getKeyManager()
  const tm = getTokenManager()

  // Get best available key+token for this call
  const best = await tm.getBestAvailable()
  if (!best) return []

  const key = km.getKeyForProject(best.projectId)
  if (!key) return []

  // Check quota for this key
  const used = km.getUsedToday(key.key)
  if (used >= 9500) {
    // Key exhausted — skip this channel
    return []
  }

  // Step 1: get uploads playlist ID (use cache if available)
  let uploadsId = getCachedUploadsId(channelId)
  if (!uploadsId) {
    const channelJson = await apiGet(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${key.key}`,
      key.key, best.token,
    )
    km.track(key.key, 1)
    if (channelJson.error || !channelJson.items?.[0]) return []
    uploadsId = channelJson.items[0].contentDetails?.relatedPlaylists?.uploads || null
    if (uploadsId) setCachedUploadsId(channelId, uploadsId)
  }

  if (!uploadsId) return []

  // Step 2: get recent playlist items
  const playlistJson = await apiGet(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=5&key=${key.key}`,
    key.key, best.token,
  )
  km.track(key.key, 1)

  if (playlistJson.error) return []

  const videos: SubscriptionVideo[] = []
  for (const item of playlistJson.items || []) {
    const snippet = item.snippet || {}
    const videoId = snippet.resourceId?.videoId
    if (!videoId) continue

    const title = snippet.title || ''
    if (!title || title.includes('[deleted]') || title.includes('[private]')) continue
    if (seenVideoIds?.has(videoId)) continue

    const publishedAt = snippet.publishedAt
      ? new Date(snippet.publishedAt).getTime()
      : 0

    // Filter by age
    if (publishedAt > 0 && publishedAt < sinceMs) continue

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
  const { seenVideoIds, sinceMs } = options
  const cutoff = sinceMs ?? (Date.now() - MAX_VIDEO_AGE_MS)

  const channels = getChannels()
  if (channels.length === 0) {
    return { videos: [], source: 'playlist' }
  }

  console.log(`[SubFeed] Scanning ${channels.length} channels (max ${MAX_CONCURRENT} concurrent)...`)

  const allVideos = await parallel(
    channels,
    MAX_CONCURRENT,
    (ch) => fetchChannelVideos(ch, seenVideoIds, cutoff),
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
    console.log(`[SubFeed] No new videos (scanned ${channels.length} channels)`)
  }

  return { videos: unique, source: 'playlist' }
}
