/**
 * Subscription Feed — HyperClip
 *
 * Polls YouTube subscription feed via YouTube Data API v3.
 * Uses multiple OAuth tokens (each from a separate Google Cloud project)
 * with round-robin rotation for quota management.
 *
 * Each project: 1 OAuth client + 1 API key = 10,000 units/day.
 * With 4 projects: 4 × 10,000 = 40,000 units/day.
 *
 * Strategy for <5s detection:
 * 1. activities?home=true (1 unit/poll, ~200ms) — personalized feed via OAuth
 * 2. Fallback: playlistItems per channel (only when step 1 returns 0)
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
  source: 'activities' | 'playlist' | 'none'
}

export interface SubFeedOptions {
  seenVideoIds?: Set<string>
  sinceMs?: number
  maxVideos?: number
}

// ─── API Helper ────────────────────────────────────────────────────────────────

function apiGet(
  urlStr: string, apiKey: string, token: string,
  extraHeaders?: Record<string, string>,
): Promise<any> {
  return new Promise((resolve) => {
    const url = new URL(urlStr)
    url.searchParams.set('key', apiKey)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    }

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers,
    }

    const req = https.request(options, (res) => {
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
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Request timeout' }) })
    req.setTimeout(10000)
    req.end()
  })
}

// ─── Fast Path: activities?home=true ─────────────────────────────────────────────

/**
 * Fetch via activities?home=true.
 * Returns personalized home feed including subscription uploads.
 *
 * Uses MULTI-LAYER authentication:
 * 1. OAuth Bearer token — authenticates user to YouTube API
 * 2. Browser session cookies — provides personalization context
 * 3. Browser-like headers — prevents YouTube from blocking as bot
 *
 * YouTube's server receives both OAuth identity + cookie session.
 * Even if OAuth is valid, without cookies the feed may show
 * non-subscription content. With both, it returns real-time
 * subscription uploads.
 *
 * Cost: 1 unit/poll.
 */
async function fetchViaActivitiesHome(
  apiKey: string, token: string,
): Promise<SubFeedResult> {
  // YouTube Data API v3: OAuth token authenticates the user.
  // activities?home=true returns personalized home feed via API (no browser cookies needed).
  const extraHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-YouTube-Client-Name': '1',
    'X-YouTube-Client-Version': '2.20240411.00.00',
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/activities')
  url.searchParams.set('part', 'snippet,contentDetails')
  url.searchParams.set('home', 'true')
  url.searchParams.set('maxResults', '20')

  const json = await apiGet(url.toString(), apiKey, token, extraHeaders)

  if (json.error) {
    console.warn(`[SubFeed] activities?home=true API error: ${json.error.message || json.error} (code: ${json.error.code || 'N/A'})`)
    return { videos: [], error: json.error.message || json.error, source: 'none' }
  }

  const rawItems = json.items || []
  // Log raw count so we know if API returned items at all
  console.log(`[SubFeed] activities?home=true raw: ${rawItems.length} items`)
  if (rawItems.length > 0 && rawItems.length <= 3) {
    // Log first few items for debugging when count is suspiciously low
    for (const item of rawItems) {
      const snippet = item.snippet || {}
      const content = item.contentDetails || {}
      const videoId = content.upload?.videoId || content.playlistItem?.videoId || '(no videoId)'
      const title = snippet.title || '(no title)'
      console.log(`  → [${snippet.type || '?'}] "${title}" | videoId=${videoId} | channelId=${snippet.channelId || '?'} | publishedAt=${snippet.publishedAt || '?'}`)
    }
  }

  const videos: SubscriptionVideo[] = []

  for (const item of rawItems) {
    const snippet = item.snippet || {}
    const content = item.contentDetails || {}

    // videoId from upload or playlistItem
    const videoId = content.upload?.videoId ||
      content.playlistItem?.videoId || ''

    if (!videoId) continue

    const title = snippet.title || ''
    if (!title) continue

    const titleLower = title.toLowerCase()
    if (titleLower.includes('[deleted]') || titleLower.includes('[private]')) continue

    videos.push({
      videoId,
      title,
      channelId: snippet.channelId || '',
      channelName: snippet.channelTitle || '',
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : 0,
      duration: '',
    })
  }

  if (videos.length > 0) {
    console.log(`[SubFeed] activities?home=true: ${videos.length} videos`)
  }

  return { videos, source: 'activities' }
}

// ─── Fallback: playlistItems per channel ─────────────────────────────────────

interface PlaylistCacheEntry {
  uploadsId: string
  fetchedAt: number
}

const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const _uploadsPlaylistCache = new Map<string, PlaylistCacheEntry>()
let _fallbackOffset = 0

async function getUploadsPlaylistIdCached(
  apiKey: string, token: string, channelId: string,
): Promise<string | null> {
  const cached = _uploadsPlaylistCache.get(channelId)
  if (cached && Date.now() - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS) {
    return cached.uploadsId
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/channels')
  url.searchParams.set('part', 'contentDetails')
  url.searchParams.set('id', channelId)

  const json = await apiGet(url.toString(), apiKey, token)
  if (json.error) return null
  const uploadsId = json.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null
  if (uploadsId) {
    _uploadsPlaylistCache.set(channelId, { uploadsId, fetchedAt: Date.now() })
  }
  return uploadsId
}

async function fetchPlaylistItems(
  apiKey: string, token: string, playlistId: string, maxResults = 5,
): Promise<SubscriptionVideo[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('playlistId', playlistId)
  url.searchParams.set('maxResults', String(maxResults))

  const json = await apiGet(url.toString(), apiKey, token)
  if (json.error) return []

  return (json.items || []).map((item: any) => {
    const snippet = item.snippet || {}
    return {
      videoId: snippet.resourceId?.videoId || '',
      title: snippet.title || '',
      channelId: snippet.channelId || '',
      channelName: snippet.channelTitle || '',
      thumbnail: snippet.thumbnails?.medium?.url ||
        snippet.thumbnails?.default?.url || '',
      publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : 0,
      duration: '',
    }
  }).filter((v: SubscriptionVideo) => v.videoId)
}

// ─── Fallback Quota Guard ────────────────────────────────────────────────────

/** Tracks how many consecutive polls returned 0 videos from activities. */
let _emptyPollStreak = 0
/** Run fallback after 1 empty poll (~6s) — primary (activities?home=true) always returns 0 without browser cookies */
const FALLBACK_DEBOUNCE_POLLS = 1
/**
 * Check 50 channels per fallback run (50 × 2 = 100 units).
 * 100 channels covered in 2 scans (scan 1: channels 1-50, scan 2: 51-100).
 * Worst case: video on channel 100 → detected in ~60s after debounce.
 * Quota: 100 units × 12 scans/hour × 16h = 19,200 units/day (within 40k budget).
 */
const FALLBACK_BATCH_SIZE = 50
/** Throttle fallback: 6s between scans — allows fallback to run ~5x per min instead of getting blocked for 5min */
const FALLBACK_THROTTLE_MS = 6 * 1000
/** Timestamp of last fallback run (for throttle) */
let _lastFallbackAt = 0

// ─── Main Export ─────────────────────────────────────────────────────────────

const MAX_VIDEO_AGE_MS = 60 * 1000 // 1 minute — only auto-download videos posted < 1 min ago

// ─── Channel Cache ─────────────────────────────────────────────────────────────

const _channelCache: Array<{ id: string; channelId?: string; name: string }> = []

export function refreshChannelCache(): void {
  const channels = getChannels()
  _channelCache.length = 0
  for (const c of channels) {
    _channelCache.push({ id: c.id, channelId: c.channelId, name: c.name })
  }
}

/**
 * Fetch latest videos from subscribed channels.
 * Primary: activities?home=true with cookies (1 unit, ~200ms)
 * Fallback: playlistItems per all channels (only when primary returns 0)
 */
export async function fetchSubscriptionFeed(
  options: SubFeedOptions = {},
): Promise<SubFeedResult> {
  const { seenVideoIds, sinceMs } = options

  const km = getKeyManager()
  const tm = getTokenManager()

  const channels = getChannels()
  if (channels.length === 0) {
    console.log('[SubFeed] No channels in store — skipping poll')
    return { videos: [], error: 'No channels in store', source: 'none' }
  }

  // ── Fast path: activities?home=true + cookies ────────────────────────────────
  let fastError: string | null = null
  try {
    const best = await tm.getBestAvailable()
    if (!best) {
      console.warn('[SubFeed] No token — skipping poll')
      return { videos: [], error: 'No token', source: 'none' }
    }
    const key = km.getKeyForProject(best.projectId)
    if (!key) {
      console.error(`[SubFeed] FATAL: Token is for project "${best.projectId}" but no API key found for that projectId! Add API key with projectId="${best.projectId}" in Settings.`)
      return { videos: [], error: `No API key for project ${best.projectId}`, source: 'none' }
    }
    console.log(`[SubFeed] fast path: project="${best.projectId}" key="${key.name}" (${key.key.slice(0, 12)}...)`)
    const fastResult = await fetchViaActivitiesHome(key.key, best.token)
    tm.track(best.projectId) // activities?home=true = 1 unit
    km.track(key.key, 1) // track key quota

    // Activities returned videos — filter and return
    if (fastResult.videos.length > 0) {
      _emptyPollStreak = 0  // reset streak on any videos returned
      const filtered = filterVideos(fastResult.videos, seenVideoIds, sinceMs)
      if (filtered.videos.length > 0) {
        console.log(`[SubFeed] ✓ activities?home=true: ${fastResult.videos.length} raw → ${filtered.videos.length} fresh (<10m, unseen)`)
        return filtered
      }
      // Activities returned videos but all were too old or already seen
      console.log(`[SubFeed] activities?home=true: ${fastResult.videos.length} videos returned but all filtered (age/seen)`)
      _emptyPollStreak++
    } else {
      // No videos from activities — increment streak
      _emptyPollStreak++
      if (_emptyPollStreak === FALLBACK_DEBOUNCE_POLLS) {
        console.log(`[SubFeed] activities?home=true: 0 videos — debounce MET, running fallback NOW`)
      }
    }

    // Run fallback when activities fails OR when streak >= debounce
    if (fastError || _emptyPollStreak >= FALLBACK_DEBOUNCE_POLLS) {
      // Throttle: skip if fallback ran recently
      if (_lastFallbackAt > 0 && Date.now() - _lastFallbackAt < FALLBACK_THROTTLE_MS) {
        return { videos: [], source: 'activities' }
      }
      const usage = km.getUsedToday(key.key)
      if (usage < 8000) {
        _lastFallbackAt = Date.now()
        const fbResult = await runPlaylistFallback(seenVideoIds, sinceMs, channels)
        if (fbResult.videos.length > 0) {
          _emptyPollStreak = 0
          _lastFallbackAt = 0 // reset throttle — found videos, next fallback should run immediately
          return fbResult
        }
        // Fallback returned 0 — let debounce rebuild before next fallback
        _emptyPollStreak = 0
      } else {
        console.log(`[SubFeed] Skipping fallback — quota low (${usage}/9500 used today)`)
      }
    }

    return { videos: [], source: 'activities' }
  } catch (e) {
    fastError = (e as Error).message
    console.warn('[SubFeed] activities?home=true error:', fastError)
    _emptyPollStreak++

    // HTTP error: run fallback immediately (respect throttle)
    if (_emptyPollStreak >= 1) {
      if (_lastFallbackAt > 0 && Date.now() - _lastFallbackAt < FALLBACK_THROTTLE_MS) {
        return { videos: [], source: 'none' }
      }
      _lastFallbackAt = Date.now()
      const fbResult = await runPlaylistFallback(seenVideoIds, sinceMs, channels)
      if (fbResult.videos.length > 0) {
        _emptyPollStreak = 0
        return fbResult
      }
    }

    return { videos: [], source: 'none' }
  }
}

// ─── Playlist Fallback ─────────────────────────────────────────────────────────

/**
 * Fallback: check a batch of subscribed channels via their uploads playlist.
 * Triggered when:
 * 1. activities?home=true returns HTTP error (immediate, no debounce)
 * 2. activities?home=true returns 0 videos for FALLBACK_DEBOUNCE_POLLS consecutive polls
 *
 * Quota: FALLBACK_BATCH_SIZE channels × 2 units/channel = FALLBACK_QUOTA_PER_POLL per poll.
 * With quota guard: only runs if best key has >2k units remaining.
 */
async function runPlaylistFallback(
  seenVideoIds: Set<string> | undefined,
  sinceMs: number | undefined,
  channels: Array<{ id: string; channelId?: string; name: string; handle?: string }>,
): Promise<SubFeedResult> {
  const km = getKeyManager()
  const tm = getTokenManager()

  console.log(`[SubFeed] Running playlistItems fallback (emptyPollStreak=${_emptyPollStreak})`)

  // Rotate through all channels in batches
  const startIdx = _fallbackOffset % channels.length
  const endIdx = Math.min(startIdx + FALLBACK_BATCH_SIZE, channels.length)
  const batch = channels.slice(startIdx, endIdx)
  _fallbackOffset = (_fallbackOffset + FALLBACK_BATCH_SIZE) % channels.length

  const fbVideos: SubscriptionVideo[] = []

  const fbBest = await tm.getBestAvailable()
  if (!fbBest) {
    console.warn('[SubFeed] Fallback: no token available')
    return filterVideos([], seenVideoIds, sinceMs)
  }
  const fbKey = km.getKeyForProject(fbBest.projectId)
  if (!fbKey) {
    console.error(`[SubFeed] Fallback FATAL: Token for project "${fbBest.projectId}" but no API key for that project! Add API key with projectId="${fbBest.projectId}" in Settings.`)
    return filterVideos([], seenVideoIds, sinceMs)
  }
  console.log(`[SubFeed] Fallback: using project="${fbBest.projectId}" key=${fbKey.name} (${fbKey.key.slice(0, 12)}...)`)

  let skippedNoChannelId = 0
  let skippedNoUploadsId = 0

  for (const ch of batch) {
    const channelId = ch.channelId || ch.id
    if (!channelId) {
      skippedNoChannelId++
      continue
    }

    // Log first few channels for debugging
    const isFirstFew = batch.indexOf(ch) < 3
    if (isFirstFew) console.log(`[SubFeed] Fallback ch[${batch.indexOf(ch)}]: id=${ch.id} channelId=${ch.channelId || '(none)'} name=${ch.name}`)

    try {
      const uploadsId = await getUploadsPlaylistIdCached(fbKey.key, fbBest.token, channelId)
      if (!uploadsId) {
        skippedNoUploadsId++
        if (isFirstFew) console.log(`[SubFeed] Fallback: no uploadsId for channelId=${channelId}`)
        continue
      }

      const videos = await fetchPlaylistItems(fbKey.key, fbBest.token, uploadsId, 5)
      // Each channel: 1 channels API + 1 playlistItems = 2 units
      km.track(fbKey.key, 2)

      if (isFirstFew) console.log(`[SubFeed] Fallback: ${videos.length} videos from uploadsId=${uploadsId}`)

      for (const v of videos) {
        v.channelName = ch.name || v.channelName || ch.handle || 'Unknown'
        fbVideos.push(v)
      }
    } catch {
      // skip individual channel errors
    }
  }

  if (skippedNoChannelId > 0) console.warn(`[SubFeed] Fallback: ${skippedNoChannelId} channels skipped — no channelId`)
  if (skippedNoUploadsId > 0) console.warn(`[SubFeed] Fallback: ${skippedNoUploadsId} channels skipped — no uploadsId found (invalid channelId or not a channel)`)

  tm.track(fbBest.projectId)

  if (fbVideos.length > 0) {
    console.log(`[SubFeed] playlistItems: ${fbVideos.length} videos from ${batch.length} channels (offset=${startIdx})`)
  } else {
    console.log(`[SubFeed] playlistItems: 0 videos from ${batch.length} channels (offset=${startIdx})`)
  }

  return filterVideos(fbVideos, seenVideoIds, sinceMs)
}

function filterVideos(
  videos: SubscriptionVideo[],
  seenVideoIds?: Set<string>,
  sinceMs?: number,
): SubFeedResult {
  const cutoff = sinceMs ?? (Date.now() - MAX_VIDEO_AGE_MS)
  const result: SubscriptionVideo[] = []

  for (const v of videos) {
    if (seenVideoIds?.has(v.videoId)) continue
    if (!v.videoId) continue

    const title = v.title.toLowerCase()
    if (title.includes('[deleted]') || title.includes('[private]')) continue

    // If publishedAt is 0 or missing, assume it's recent (don't filter out)
    if (v.publishedAt > 0 && v.publishedAt < cutoff) {
      const ageMin = (Date.now() - v.publishedAt) / 60000
      console.log(`[SubFeed] SKIP (too old): "${v.title}" (${v.videoId}) age=${ageMin.toFixed(1)}min`)
      continue
    }

    const ageMin = v.publishedAt > 0 ? (Date.now() - v.publishedAt) / 60000 : 0
    const ageLabel = ageMin >= 60
      ? Math.floor(ageMin / 60) + 'h ago'
      : ageMin < 1 ? 'just now'
      : Math.floor(ageMin) + 'm ago'
    console.log(`[SubFeed] KEEP: "${v.title}" (${v.videoId}) from ${v.channelName} age=${ageLabel}`)
    result.push(v)
  }

  return { videos: result, source: result.length > 0 ? 'playlist' : 'none' }
}
