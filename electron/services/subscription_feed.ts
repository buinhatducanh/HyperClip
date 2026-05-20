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

import https from 'https'
import path from 'path'
import fs from 'fs'
import { getTokenManager } from './token_manager.js'
import { getProjectManager } from './project_manager.js'
import { getChannels } from './store.js'
import { getInnertubePool } from './innertube_client.js'
import { getLatestVideosFromRss } from './youtube.js'
import { getChannelsDir } from './paths.js'
import { devLog } from './unified_log.js'
import { loadSettings } from './ramdisk.js'
// NOTE: opLog uses dynamic import inside functions to avoid circular dependency
// (operation_log.ts imports BrowserWindow from Electron, which isn't available at module load)

/** Parse ISO 8601 duration (e.g. "PT5M30S" or "PT1H2M3S") to seconds. */
function parseISO8601Duration(iso: string): number {
  if (!iso) return 0
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const hours = parseInt(match[1] || '0')
  const minutes = parseInt(match[2] || '0')
  const seconds = parseInt(match[3] || '0')
  return hours * 3600 + minutes * 60 + seconds
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SubscriptionVideo {
  videoId: string
  title: string
  channelId: string
  channelName: string
  thumbnail: string
  publishedAt: number
  publishedText?: string
  duration: string
}

export interface SubFeedResult {
  videos: SubscriptionVideo[]
  error?: string
  allSourcesExhausted?: boolean
  source: 'innertube' | 'oauth' | 'mixed' | 'none'
  degraded?: boolean
}

export interface SubFeedOptions {
  seenVideoIds?: Set<string>
  maxVideos?: number
}

// ─── Config ─────────────────────────────────────────────────────────────────────

const PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CONCURRENT = 10
const MAX_VIDEOS_PER_POLL = 5

// ─── Module-level state ────────────────────────────────────────────────────────

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

const UPLOADS_CACHE_FILE = path.join(getChannelsDir(), 'uploads-cache.json')

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

// ─── Per-Channel Fetch ─────────────────────────────────────────────────────────

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

async function fetchChannelWithOAuth(
  ch: { id: string; channelId?: string; name: string },
  token: string,
  projectId: string,
  seenVideoIds: Set<string> | undefined,
): Promise<{ video: SubscriptionVideo | null; quotaError: boolean }> {
  const channelId = ch.channelId || ch.id
  if (!channelId) return { video: null, quotaError: false }

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

async function verifyVideoAgeByOAuth(videoId: string): Promise<{ publishedAt: number; title: string; channelTitle: string } | null> {
  try {
    const tm = getTokenManager()
    const best = await tm.getBestAvailable()
    if (!best) return null

    const { json, isQuotaError } = await apiGet(
      `/youtube/v3/videos?id=${encodeURIComponent(videoId)}&part=snippet,contentDetails`,
      best.token,
    )
    if (json.error || !json.items?.length) {
      if (isQuotaError) tm.trackError(best.projectId)
      return null
    }
    tm.track(best.projectId)

    const snippet = json.items[0].snippet || {}
    const contentDetails = json.items[0].contentDetails || {}
    const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : 0
    const MAX_VIDEO_AGE_MS = 10 * 60 * 1000
    if (publishedAt === 0 || Date.now() - publishedAt > MAX_VIDEO_AGE_MS) return null

    // Duration filter from settings
    const settings = loadSettings()
    const minSec = settings.videoMinDurationSec ?? 0
    const maxSec = settings.videoMaxDurationSec ?? 0
    if (minSec > 0 || maxSec > 0) {
      const durationSec = parseISO8601Duration(contentDetails.duration)
      if (durationSec > 0) {
        if (minSec > 0 && durationSec < minSec) return null
        if (maxSec > 0 && durationSec > maxSec) return null
      }
    }

    return {
      publishedAt,
      title: snippet.title || '(no title)',
      channelTitle: snippet.channelTitle || 'Unknown',
    }
  } catch {
    return null
  }
}

async function fetchChannelWithInnertube(
  ch: { id: string; channelId?: string; name: string },
  seenVideoIds: Set<string> | undefined,
): Promise<SubscriptionVideo | null> {
  const channelId = ch.channelId || ch.id
  if (!channelId) return null

  // Use getLatestVideos (plural) for full control over filtering logic.
  // getLatestVideo (singular) has internal skip logic that can silently reject
  // valid videos due to inconsistent session responses between concurrent calls.
  const pool = await getInnertubePool()
  const allVideos = await pool.getLatestVideos(channelId, 5)

  if (allVideos.length === 0) {
    devLog(`[SubFeed] getLatestVideos(${channelId}): 0 videos extracted`)
    return null
  }

  devLog(`[SubFeed] getLatestVideos(${channelId}): ${allVideos.length} videos, top=${allVideos[0].videoId} (${allVideos[0].publishedAt > 0 ? Math.round((Date.now() - allVideos[0].publishedAt) / 1000) + 's ago' : 'ZERO'})`)

  // Take the first (newest) video that passes age + dedup checks
  for (const v of allVideos) {
    // Skip deleted/private
    if (v.title.includes('[deleted]') || v.title.includes('[private]')) continue

    // Skip already-seen (handled by getLatestVideos already, but double-check)
    if (seenVideoIds?.has(v.videoId)) {
      devLog(`[SubFeed] Innertube: ${v.videoId} already seen — skipping`)
      continue
    }

    if (v.publishedAt === 0) {
      devLog(`[SubFeed] Innertube: ${v.videoId} publishedAt=0 — trying RSS...`)
      const rss = await fetchChannelWithRss(ch, seenVideoIds)
      if (rss) {
        devLog(`[SubFeed] RSS ✓: ${rss.videoId} — using RSS`)
        return rss
      }
      devLog(`[SubFeed] RSS empty/old — trying OAuth...`)
      const oauth = await verifyVideoAgeByOAuth(v.videoId)
      if (oauth) {
        devLog(`[SubFeed] OAuth ✓: ${v.videoId} — verified ${Math.round((Date.now() - oauth.publishedAt) / 1000)}s ago`)
        return {
          videoId: v.videoId,
          title: oauth.title,
          channelId,
          channelName: (ch.name && ch.name !== 'N/A') ? ch.name : (oauth.channelTitle !== 'Unknown' ? oauth.channelTitle : v.channelName),
          thumbnail: v.thumbnail,
          publishedAt: oauth.publishedAt,
          duration: '',
        }
      }
      // publishedAt=0 and all fallbacks failed — skip to next video
      continue
    }

    const ageMin = (Date.now() - v.publishedAt) / 60000
    if (ageMin > 10) {
      devLog(`[SubFeed] Innertube: ${v.videoId} is ${ageMin.toFixed(1)}m old (>10m) — skipping`)
      continue
    }

    devLog(`[SubFeed] Innertube ✓: ${v.videoId} (${Math.round(ageMin * 60)}s ago) — accepting`)
    return {
      videoId: v.videoId,
      title: v.title,
      channelId,
      channelName: (ch.name && ch.name !== 'N/A') ? ch.name : v.channelName,
      thumbnail: v.thumbnail,
      publishedAt: v.publishedAt,
      duration: '',
    }
  }

  devLog(`[SubFeed] Innertube: all videos for ${channelId} filtered out (too old / seen / unpublished)`)
  return null
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
  // eslint-disable-next-line no-useless-assignment -- used for observability logging
  let innertubeAvailable = false

  // Lazy load opLog to avoid circular import at module initialization
  const { opLog } = await import('./unified_log.js')

  // Step 1: Innertube PRIMARY (0 quota, ~200ms/call)
  try {
    const pool = await getInnertubePool()
    const readyCount = pool.getReadyCount()
    const totalSessions = pool.getStatus().totalSessions

    if (pool.isReady() && readyCount > 0) {
      innertubeAvailable = true
      opLog.info('scan', `Quét ${channels.length} kênh (${readyCount}/${totalSessions} sessions)`)

      for (let i = 0; i < channels.length; i += MAX_CONCURRENT) {
        const batch = channels.slice(i, i + MAX_CONCURRENT)
        const batchResults = await Promise.all(
          batch.map(ch => fetchChannelWithInnertube(ch, seenVideoIds))
        )

        for (const video of batchResults) {
          if (video) {
            results.push(video)
            seenVideoIds?.add(video.videoId)
            if (results.length >= targetStop) {
              devLog(`[SubFeed] Innertube: ${results.length} videos found — returning`)
              opLog.success('scan', `Tìm thấy ${results.length} video mới — dừng sớm`)
              return { videos: results, source: 'innertube' }
            }
          }
        }
      }

      // Only devLog when zero videos — every 30th poll (~2.5 min) to reduce spam
      const _pollTick = Math.floor(Date.now() / 5000)
      if (_pollTick % 30 === 0) {
        devLog(`[SubFeed] Innertube: 0 videos across ${channels.length} channels (no new content)`)
      }

      if (results.length === 0) {
        _consecutiveZeroInnertubePolls++
        // Only warn after 3 consecutive empty polls to avoid log spam
        if (_consecutiveZeroInnertubePolls >= 3) {
          opLog.warn('scan', `Không có video mới sau ${_consecutiveZeroInnertubePolls} lần quét liên tiếp`)
        }
      } else {
        _consecutiveZeroInnertubePolls = 0
        opLog.success('scan', `Tìm thấy ${results.length} video mới từ ${results.filter((v: any) => v.channelName).length} kênh`)
      }

      // Step 2: OAuth DISTRIBUTED (continuous coverage)
      await _fetchOAuthDistributed(channels, results, seenVideoIds, targetStop)

      if (results.length >= targetStop) {
        return { videos: results.slice(0, targetStop), source: 'innertube' }
      }

      return {
        videos: results,
        source: 'innertube',
        degraded: _consecutiveZeroInnertubePolls >= 3,
      }
    } else {
      devLog(`[SubFeed] Innertube: 0/${totalSessions} sessions ready`)
      innertubeAvailable = false
    }
  } catch (e) {
    devLog(`[SubFeed] Innertube error: ${e}`)
    innertubeAvailable = false
  }

  // Step 2b: OAuth FULL COVERAGE (Innertube dead)
  if (results.length === 0 && !innertubeAvailable) {
    devLog(`[SubFeed] Innertube DOWN — OAuth FULL COVERAGE mode`)
    await _fetchOAuthFullCoverage(channels, results, seenVideoIds, targetStop)

    if (results.length >= targetStop) {
      return { videos: results.slice(0, targetStop), source: 'oauth' }
    }
  }

  // Step 3: RSS Fallback
  if (results.length === 0) {
    const priorityChannels = channels.slice(0, 10)
    const RSS_CONCURRENT = 3
    devLog(`[SubFeed] All sources exhausted — RSS fallback for ${priorityChannels.length} channels`)

    for (let i = 0; i < priorityChannels.length; i += RSS_CONCURRENT) {
      const batch = priorityChannels.slice(i, i + RSS_CONCURRENT)
      const rssResults = await Promise.all(
        batch.map(ch => fetchChannelWithRss(ch, seenVideoIds))
      )
      for (const video of rssResults) {
        if (video && !results.some(r => r.videoId === video.videoId)) {
          results.push(video)
          seenVideoIds?.add(video.videoId)
          if (results.length >= targetStop) break
        }
      }
      if (results.length >= targetStop) break
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  const unique: SubscriptionVideo[] = []
  for (const v of results) {
    if (!seen.has(v.videoId)) { seen.add(v.videoId); unique.push(v) }
  }

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

// ─── OAuth Distributed Scan ───────────────────────────────────────────────────

/**
 * OAuth DISTRIBUTED: scan 1-2 random channels per poll via assigned projects.
 * Total cost: ~69k units/day (3.5% of 2M total quota).
 */
async function _fetchOAuthDistributed(
  channels: { id: string; channelId?: string; name: string }[],
  results: SubscriptionVideo[],
  seenVideoIds: Set<string> | undefined,
  targetStop: number,
): Promise<void> {
  const pm = getProjectManager()
  const tm = getTokenManager()
  const status = pm.getStatus()
  if (status.total === 0) return

  const scanCount = Math.min(2, channels.length)
  const shuffled = [...channels].sort(() => Math.random() - 0.5)
  const toScan = shuffled.slice(0, scanCount)

  for (const ch of toScan) {
    if (results.length >= targetStop) break
    const project = pm.getProjectForChannel(ch.channelId || ch.id)
    if (!project) continue

    const token = pm.getToken(project.projectId)
    if (!token) continue

    if (token.expires_at - 5 * 60 * 1000 < Date.now()) {
      const refreshed = await tm.refreshToken(project.projectId)
      if (!refreshed) continue
    }

    const tok = pm.getToken(project.projectId)
    if (!tok) continue

    const { video, quotaError } = await fetchChannelWithOAuth(
      ch, tok.access_token, project.projectId, seenVideoIds
    )

    if (quotaError) {
      tm.trackError(project.projectId)
    } else if (video) {
      tm.track(project.projectId)
      if (!results.some(r => r.videoId === video.videoId)) {
        results.push(video)
        seenVideoIds?.add(video.videoId)
        devLog(`[SubFeed] OAuth-DIST: found "${video.title.slice(0, 40)}" via ${project.projectId}`)
      }
    }
  }
}

// ─── OAuth Full Coverage Scan ─────────────────────────────────────────────────

/**
 * OAuth FULL COVERAGE: when Innertube is dead, ALL 200 projects scan ALL channels.
 * ~1.7M units/day — 86% of 2M total. Survives Innertube outage for days.
 */
async function _fetchOAuthFullCoverage(
  channels: { id: string; channelId?: string; name: string }[],
  results: SubscriptionVideo[],
  seenVideoIds: Set<string> | undefined,
  targetStop: number,
): Promise<void> {
  const tm = getTokenManager()
  const statuses = tm.getAllStatuses()
  const hasAvailable = statuses.some(ts => ts.hasToken && ts.status !== 'exhausted')
  if (!hasAvailable) return

  devLog(`[SubFeed] OAuth FULL COVERAGE: scanning ${channels.length} channels`)

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
          devLog(`[SubFeed] OAuth FULL COVERAGE: ${results.length} videos found`)
          return
        }
      }
    }

    if (tokenExhausted) {
      const retryBest = await tm.getBestAvailable()
      if (retryBest && retryBest.projectId !== best.projectId) {
        const retryResults = await Promise.all(
          batch.map(ch => fetchChannelWithOAuth(ch, retryBest.token, retryBest.projectId, seenVideoIds))
        )
        for (const { video, quotaError } of retryResults) {
          if (quotaError) tm.trackError(retryBest.projectId)
          else tm.track(retryBest.projectId)
          if (video && !results.some(r => r.videoId === video.videoId)) {
            results.push(video)
            seenVideoIds?.add(video.videoId)
            if (results.length >= targetStop) return
          }
        }
      }
    }
  }
}

// ─── Channel Cache ─────────────────────────────────────────────────────────────

export function refreshChannelCache(): void {
  // Channels are read directly from the store — no in-memory cache to refresh
}
