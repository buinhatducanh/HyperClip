/**
 * Subscription Feed — HyperClip
 *
 * Full scan: checks ALL subscribed channels every poll via playlistItems.
 * Uses OAuth-only (no API key) — avoids "API Key and authentication credential
 * from different projects" errors when key and token belong to different GCP projects.
 *
 * Quota: OAuth tokens track per-project quota (10k units/day per project).
 *
 * activities?home=true is DEPRECATED (Google removed it).
 * No replacement in Data API v3. Only playlistItems per channel works.
 */

import https from 'https'
import { getTokenManager } from './token_manager.js'
import { getChannels } from './store.js'
import { getSessionManager, computeSAPISIDHASH, type ChromeSession } from './chrome_cookies.js'

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
  /** True when Innertube returned 0 videos AND all OAuth tokens are exhausted */
  allTokensExhausted?: boolean
  source: 'playlist'
}

export interface SubFeedOptions {
  seenVideoIds?: Set<string>
  sinceMs?: number
  maxVideos?: number
  /** When true, stops fetching more channels once we have this many new videos.
   * Early termination — saves latency when we already found enough. */
  stopAfterCount?: number
}

// ─── Config ─────────────────────────────────────────────────────────────────────

const MAX_VIDEO_AGE_MS = 10 * 60 * 1000 // 10 minutes — auto-download videos posted < 10 min ago (accounts for YouTube processing delay)
const MIN_VIDEO_DURATION_MS = 60 * 1000 // Skip auto-download for videos < 60s (YouTube Shorts)
const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h uploads playlist cache
const MAX_CONCURRENT = 20 // max parallel API calls per poll
const MAX_VIDEOS_PER_POLL = 5

// ─── API Helper ────────────────────────────────────────────────────────────────

function apiGetOAuth(
  urlStr: string, token: string,
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
          // Debug: log first item's age in playlistItems — shows if newest video is within 10min window
          if (urlStr.includes('playlistItems') && json.items?.length > 0) {
            const now = Date.now()
            const first = json.items[0].snippet
            const ms = first?.publishedAt ? new Date(first.publishedAt).getTime() : 0
            const age = ms > 0 ? Math.round((now - ms) / 60000) : -1
            console.log(`[apiGet] newest="${first?.title?.slice(0,35)}" age=${age}m (cutoff=10m)`)
          }
          resolve(json)
        } catch {
          resolve({ error: 'Parse error', data: data.slice(0, 200) })
        }
      })
    })

    req.on('error', (e) => resolve({ error: e.message }))
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'Request timeout' }) })
  })
}

// ─── Innertube API (cookie-based, no quota limit) ─────────────────────────────

const INNERTUBE_CLIENT = {
  clientName: 'WEB',
  clientVersion: '2.20240718',
}

function apiGetInnertube(
  browseId: string,
  session: ChromeSession,
): Promise<any> {
  return new Promise((resolve) => {
    if (!session.cookies) {
      resolve({ error: 'No cookies in session' })
      return
    }

    const { SAPISID, PSID, PSIDCC, PSIDTS } = session.cookies
    const ts = Math.floor(Date.now() / 1000)
    const hash = computeSAPISIDHASH(SAPISID, ts)

    const body = JSON.stringify({
      context: {
        client: {
          clientName: INNERTUBE_CLIENT.clientName,
          clientVersion: INNERTUBE_CLIENT.clientVersion,
        },
      },
      browseId,
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      'X-YouTube-Client-Name': '2',
      'X-YouTube-Client-Version': INNERTUBE_CLIENT.clientVersion,
    }

    // Build Cookie header
    const cookieParts: string[] = [`SAPISID=${SAPISID}`, `__Secure-1PSID=${PSID}`]
    if (PSIDCC) cookieParts.push(`__Secure-1PSIDCC=${PSIDCC}`)
    if (PSIDTS) cookieParts.push(`__Secure-1PSIDTS=${PSIDTS}`)
    // SOCS consent cookie — CAI = accepted, CAA = not logged in
    if (session.cookies.socs) cookieParts.push(`SOCS=${session.cookies.socs}`)

    headers['Authorization'] = `SAPISIDHASH ${hash}`
    headers['Cookie'] = cookieParts.join('; ')
    // SAPISID cookie also needed on some endpoints
    headers['Cookie'] += `; SAPISID=${SAPISID}`

    const req = https.request({
      hostname: 'www.youtube.com',
      path: '/youtubei/v1/browse',
      method: 'POST',
      headers,
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve(json)
        } catch {
          resolve({ error: 'Parse error', data: data.slice(0, 200) })
        }
      })
    })

    req.on('error', (e) => resolve({ error: e.message }))
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'Request timeout' }) })
    req.write(body)
    req.end()
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

/**
 * Parallel execution with optional early termination.
 * When stopAfterCount is set, returns as soon as we have enough results.
 */
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

  // ── Try Innertube API (cookie-based, no quota limit) ──
  const sm = getSessionManager()
  await sm.ensureInit()

  const session = sm.getNextSession()
  if (session?.cookies) {
    // Step 1: get uploads playlist ID via Innertube browse
    let uploadsId = getCachedUploadsId(channelId)
    if (!uploadsId) {
      const browseJson = await apiGetInnertube(channelId, session)
      if (!browseJson.error) {
        // Parse uploads playlist from Innertube browse response
        // Response: { metadata: { channelMetadataRenderer: { uploadsId } } }
        const uploads = browseJson.metadata?.channelMetadataRenderer?.uploadId
          || browseJson.metadata?.microformat?.channelMicrophoneFallbackRenderer?.channelId
        if (uploads) {
          uploadsId = uploads
          setCachedUploadsId(channelId, uploads)
        }
      }
    }

    if (uploadsId) {
      // Step 2: get recent playlist items via Innertube
      const playlistJson = await apiGetInnertube(uploadsId, session)
      if (!playlistJson.error) {
        const videos = parseInnertubePlaylistVideos(playlistJson, channelId, ch.name, seenVideoIds, sinceMs)
        if (videos.length > 0) {
          const ageLabel = videos[0].publishedAt > 0
            ? ((Date.now() - videos[0].publishedAt) / 60000 < 1 ? 'vua xong' : Math.floor((Date.now() - videos[0].publishedAt) / 60000) + 'm ago')
            : '?'
          console.log(`[SubFeed] ✓ "${videos[0].title.slice(0, 40)}" from ${ch.name} (${ageLabel})`)
          return videos
        }
      }
    }

    // Innertube worked but returned 0 videos — try OAuth fallback for this channel
    console.log(`[SubFeed] Innertube 0 videos for ${ch.name} — trying OAuth fallback`)
  }

  // ── OAuth fallback (Data API v3, has quota) ──
  const tm = getTokenManager()
  const best = await tm.getBestAvailable()
  if (!best) {
    // All tokens exhausted — signal to poller
    return []
  }

  const token = best.token

  // Step 1: get uploads playlist ID
  let uploadsId = getCachedUploadsId(channelId)
  if (!uploadsId) {
    const channelJson = await apiGetOAuth(
      `/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`,
      token,
    )
    if (channelJson.error || !channelJson.items?.[0]) {
      // Track quota even on error so exhausted tokens get filtered out
      if (channelJson.error) tm.trackError(best.projectId)
      return []
    }
    uploadsId = channelJson.items[0].contentDetails?.relatedPlaylists?.uploads || null
    if (uploadsId) setCachedUploadsId(channelId, uploadsId)
  }

  if (!uploadsId) return []

  // Step 2: get recent playlist items (maxResults=1 — only need the newest)
  const playlistJson = await apiGetOAuth(
    `/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=1`,
    token,
  )
  if (playlistJson.error) {
    console.warn(`[SubFeed] OAuth error for ${ch.name}: ${playlistJson.error}`)
    // Track quota on error — pushes token toward exhaustion so getBestAvailable skips it
    tm.trackError(best.projectId)
    // Invalidate cache so next poll can retry with potentially fresh token
    _uploadsPlaylistCache.delete(channelId)
    return []
  }

  // Track token quota on successful API call (even if 0 items)
  tm.track(best.projectId)

  if (!playlistJson.items || playlistJson.items.length === 0) {
    console.log(`[SubFeed] OAuth: no items in uploads playlist for ${ch.name}`)
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

function parseInnertubePlaylistVideos(
  json: any,
  channelId: string,
  channelName: string,
  seenVideoIds: Set<string> | undefined,
  sinceMs: number,
): SubscriptionVideo[] {
  const videos: SubscriptionVideo[] = []

  // Innertube playlist response structure:
  // { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [...] } } } }] }
  const tabs = json.tabs || json.contents?.tabs
  if (!tabs) return []

  const tabContent = tabs[0]?.tabRenderer?.content
  const sections = tabContent?.sectionListRenderer?.contents || []

  for (const section of sections) {
    const items = section.itemSectionRenderer?.contents || []
    for (const item of items) {
      const vr = item.playlistVideoRenderer
      if (!vr) continue

      const videoId = vr.videoId
      if (!videoId || seenVideoIds?.has(videoId)) continue

      const title = vr.title?.runs?.[0]?.text || '(no title)'
      if (title.includes('[deleted]') || title.includes('[private]')) continue

      // Extract published time from text runs (e.g. "2 minutes ago", "1 hour ago")
      const publishedText = vr.publishedTimeText?.simpleText || vr.publishedTimeText?.runs?.[0]?.text || ''
      const publishedAt = parseInnertubeRelativeTime(publishedText, sinceMs)

      // Skip if we can't determine age — could be very old video with no timestamp
      if (publishedAt === 0) continue
      if (publishedAt > 0 && publishedAt < sinceMs) continue

      // Skip live streams — yt-dlp can't use --download-sections on live content
      const badges: Array<{ metadataBadgeRenderer?: { label?: { simpleText?: string } } }> = vr.badges || []
      const isLive = badges.some(b => b.metadataBadgeRenderer?.label?.simpleText?.toLowerCase().includes('live'))
      if (isLive) {
        console.log(`[SubFeed] Skipping live stream: "${title}" from ${channelName}`)
        continue
      }

      // Skip upcoming streams (not yet started)
      if (vr.upcomingDateText) {
        continue
      }

      const thumbnail = vr.thumbnail?.thumbnails?.[0]?.url || ''

      videos.push({
        videoId,
        title,
        channelId,
        channelName,
        thumbnail,
        publishedAt,
        publishedText,
        duration: vr.lengthText?.simpleText || '',
      })
    }
  }

  return videos
}

function parseInnertubeRelativeTime(text: string, sinceMs: number): number {
  if (!text) return 0

  // Patterns: "2 minutes ago", "1 hour ago", "2 days ago", "Streamed 2 hours ago"
  const cleaned = text.replace(/^Streamed\s*/i, '').trim()
  const match = cleaned.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago$/i)
  if (!match) return 0

  const value = parseInt(match[1])
  const unit = match[2].toLowerCase()

  const now = Date.now()
  const multipliers: Record<string, number> = {
    second: 1000,
    minute: 60000,
    hour: 3600000,
    day: 86400000,
    week: 604800000,
    month: 2592000000,
    year: 31536000000,
  }

  const ageMs = (multipliers[unit] || 60000) * value
  return now - ageMs
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function fetchSubscriptionFeed(
  options: SubFeedOptions = {},
): Promise<SubFeedResult> {
  const { seenVideoIds, sinceMs, maxVideos, stopAfterCount } = options
  const cutoff = sinceMs ?? (Date.now() - MAX_VIDEO_AGE_MS)

  const channels = getChannels()
  if (channels.length === 0) {
    return { videos: [], source: 'playlist' }
  }

  // Non-consuming check: is any OAuth token available?
  // If not, signal poller so it can notify user and back off
  const tm = getTokenManager()
  const tmStatuses = tm.getAllStatuses()
  const hasAnyToken = tmStatuses.some(ts => ts.hasToken && ts.status !== 'exhausted')
  const allTokensExhausted = !hasAnyToken

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
    if (allTokensExhausted) {
      console.warn(`[SubFeed] No new videos — ALL OAuth tokens exhausted. Will retry at midnight PT.`)
    } else {
      console.log(`[SubFeed] No new videos (scanned ${channels.length} channels)`)
    }
  }

  return {
    videos: unique,
    allTokensExhausted,
    source: 'playlist',
  }
}
