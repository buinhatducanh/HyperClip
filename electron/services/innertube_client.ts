/**
 * Innertube Client Pool — HyperClip
 *
 * Manages youtubei.js Innertube client instances sourced from 30 Chrome sessions.
 * Each client uses cookies from a specific Chrome profile for authentication.
 * Round-robin across clients to distribute load.
 *
 * Primary detection path — NO quota limit, ~200ms/request.
 * Fallback: OAuth Data API v3 (TokenManager, quota-limited).
 */

import Innertube from 'youtubei.js'
import { getSessionManager } from './chrome_cookies.js'
import type { YouTubeCookies } from './chrome_cookies.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface InnertubePoolStatus {
  totalSessions: number
  readyCount: number
  ready: boolean
  sessions: Array<{
    profileId: string
    profileName: string
    ready: boolean
    error?: string
  }>
}

export interface LatestVideo {
  videoId: string
  title: string
  channelId: string
  channelName: string
  thumbnail: string
  publishedAt: number // Unix timestamp ms
  publishedText?: string
}

// ─── Relative date parsing ──────────────────────────────────────────────────────

/**
 * Parse youtubei.js relative date strings like "1 minute ago", "2 weeks ago".
 * Returns Unix timestamp ms, or 0 if unparseable.
 */
function parseRelativeDate(relativeStr: string): number {
  if (!relativeStr) return 0
  const str = relativeStr.toLowerCase()
  const now = Date.now()

  // "X minute(s) ago" → subtract minutes
  const minMatch = str.match(/(\d+)\s*minute/)
  if (minMatch) return now - parseInt(minMatch[1]) * 60_000

  // "X hour(s) ago" → subtract hours
  const hrMatch = str.match(/(\d+)\s*hour/)
  if (hrMatch) return now - parseInt(hrMatch[1]) * 3_600_000

  // "X day(s) ago" → subtract days
  const dayMatch = str.match(/(\d+)\s*day/)
  if (dayMatch) return now - parseInt(dayMatch[1]) * 86_400_000

  // "X week(s) ago" → subtract weeks (accept both "weeks" and "week")
  const wkMatch = str.match(/(\d+)\s*week/)
  if (wkMatch) return now - parseInt(wkMatch[1]) * 604_800_000

  // "X month(s) ago" → subtract months (approx 30 days) (accept "month" and "months")
  const moMatch = str.match(/(\d+)\s*month/)
  if (moMatch) return now - parseInt(moMatch[1]) * 2_592_000_000

  // "X year(s) ago" → subtract years (approx 365 days)
  const yrMatch = str.match(/(\d+)\s*year/)
  if (yrMatch) return now - parseInt(yrMatch[1]) * 31_536_000_000

  // Try ISO parse as fallback
  const iso = new Date(relativeStr).getTime()
  return isNaN(iso) ? 0 : iso
}

// ─── Video extraction from YouTube response ─────────────────────────────────

/**
 * Extract video items from the YouTube channel tab response.
 * Supports: RichGrid, SectionList, and Feed.memo (GridVideo/ReelItem/CompactVideo).
 * Returns array of video-like objects.
 */
function extractVideosFromTab(videosTab: any): any[] {
  const memo = videosTab?.memo

  // Strategy 1: memo.get('Video') — PRIMARY, works in v17
  const videos = memo?.get('Video')
  if (videos?.length > 0) return [...videos]

  // Strategy 2: memo.get('GridVideo') — grid view in channel tabs
  const gridVideos = memo?.get('GridVideo')
  if (gridVideos?.length > 0) return [...gridVideos]

  // Strategy 3: memo.get('ReelItem') — short videos
  const reels = memo?.get('ReelItem')
  if (reels?.length > 0) return [...reels]

  // Strategy 4: memo.get('CompactVideo') — compact video items
  const compact = memo?.get('CompactVideo')
  if (compact?.length > 0) return [...compact]

  // Strategy 5: .videos getter (Feed property)
  const fromGetter = videosTab?.videos
  if (fromGetter?.length > 0) return [...fromGetter]

  // Strategy 6: walk with STRICT type checking (only GridVideo/ReelItem/CompactVideo)
  const tabContent = videosTab?.current_tab?.content
  if (tabContent) {
    const videos = walkForVideosStrict(tabContent)
    if (videos.length > 0) return videos
  }

  // Strategy 7: walk entire tab object
  const allItems = walkForVideosStrict(videosTab)
  if (allItems.length > 0) return allItems

  return []
}

/** Strict walk — only match confirmed video types, never node.id alone */
function walkForVideosStrict(node: any): any[] {
  if (!node) return []
  const results: any[] = []

  if (Array.isArray(node)) {
    for (const item of node) results.push(...walkForVideosStrict(item))
    return results
  }

  if (typeof node !== 'object') return []

  // Only match explicit video type — do NOT use node.id alone (RichText nodes have id)
  if (node.type === 'GridVideo' || node.type === 'ReelItem' || node.type === 'CompactVideo' ||
      node.type === 'Video') {
    results.push(node)
  }

  // Recurse into common container properties
  const containerProps = ['contents', 'items', 'videos', 'horizontal_list']
  for (const prop of containerProps) {
    if (node[prop]) results.push(...walkForVideosStrict(node[prop]))
  }

  return results
}

/** Legacy walk — kept for backward compatibility (uses node.id, less strict) */
function walkForVideos(node: any): any[] {
  if (!node) return []
  const results: any[] = []

  if (Array.isArray(node)) {
    for (const item of node) results.push(...walkForVideos(item))
    return results
  }

  if (typeof node !== 'object') return []

  if (node.video_id || node.id || node.type === 'GridVideo' ||
      node.type === 'ReelItem' || node.type === 'CompactVideo') {
    results.push(node)
  }

  const containerProps = ['contents', 'items', 'videos', 'horizontal_list']
  for (const prop of containerProps) {
    if (node[prop]) results.push(...walkForVideos(node[prop]))
  }

  return results
}

// ─── Cookie → youtubei.js format ─────────────────────────────────────────────

/**
 * Convert extracted Chrome cookies to youtubei.js cookie string format.
 * youtubei.js expects: "name=value; name=value; ..."
 */
function buildCookieString(cookies: YouTubeCookies): string {
  const parts: string[] = []
  if (cookies.SAPISID) parts.push(`SAPISID=${cookies.SAPISID}`)
  if (cookies.PSID) parts.push(`__Secure-1PSID=${cookies.PSID}`)
  if (cookies.PSIDTS) parts.push(`__Secure-1PSIDTS=${cookies.PSIDTS}`)
  if (cookies.PSIDCC) parts.push(`__Secure-1PSIDCC=${cookies.PSIDCC}`)
  // Only include SOCS if it's a meaningful value (not the literal string "null")
  if (cookies.socs && cookies.socs !== 'null' && cookies.socs.trim() !== '') {
    parts.push(`SOCS=${cookies.socs}`)
  }
  return parts.join('; ')
}

// ─── InnertubeClientPool ──────────────────────────────────────────────────────

interface PoolEntry {
  profileId: string
  profileName: string
  client: Innertube | null
  cookies: YouTubeCookies | null
  error?: string
  lastErrorAt: number
  usedToday: number
  lastUsed: number
}

class InnertubeClientPool {
  private _sessions: PoolEntry[] = []
  private _index = 0
  private _initialized = false
  private _initPromise: Promise<void> | null = null

  async init(): Promise<void> {
    if (this._initialized) return
    if (this._initPromise) return this._initPromise

    this._initPromise = this._doInit()
    await this._initPromise
    this._initialized = true
  }

  private async _doInit(): Promise<void> {
    const sm = getSessionManager()
    await sm.ensureInit()
    const sessions = sm.getSessions()

    console.log(`[InnertubePool] Building client pool from ${sessions.length} Chrome sessions...`)

    // Build pool entries — no clients yet, just cookies
    this._sessions = sessions.map(s => ({
      profileId: s.profileId,
      profileName: s.profileName,
      client: null,
      cookies: s.cookies,
      error: s.error,
      lastErrorAt: 0,
      usedToday: 0,
      lastUsed: 0,
    }))

    // Pre-warm clients for sessions that have valid cookies
    // SAPISID + PSID are the minimum required for Innertube auth.
    // SOCS is optional — youtubei.js handles consent internally.
    // Process in batches to avoid hammering YouTube at startup
    const BATCH = 5
    let readyCount = 0
    for (let i = 0; i < this._sessions.length; i += BATCH) {
      const batch = this._sessions.slice(i, i + BATCH)
      await Promise.all(batch.map(async (entry) => {
        if (entry.cookies && entry.cookies.SAPISID && entry.cookies.PSID) {
          try {
            const cookieStr = buildCookieString(entry.cookies)
            console.log(`[InnertubePool] Session ${entry.profileId}: creating client (PSID=${entry.cookies.PSID.slice(0,4)}..., SAPISID=${entry.cookies.SAPISID.slice(0,6)}..., SOCS=${entry.cookies.socs ?? 'none'})`)
            entry.client = await Innertube.create({
              cookie: cookieStr,
              retrieve_player: false,   // we only need metadata, not streaming
              enable_session_cache: false, // each session is distinct
            })
            // Health check: validate auth with a lightweight non-channel API call.
            // Use getTrending() — doesn't need a valid channel ID, just valid cookies.
            // Auth errors (401/403) → mark session as invalid.
            try {
              await entry.client.getHomeFeed()
              readyCount++
              console.log(`[InnertubePool] Session ${entry.profileId}: ✓ client created and health-checked`)
            } catch (healthErr: unknown) {
              const errStr = String(healthErr)
              const isAuthError = /401|403|not_signed_in|consent|verification|auth|500|Internal Server/i.test(errStr)
              if (isAuthError) {
                entry.client = null
                entry.error = `auth check failed: ${errStr.slice(0, 80)}`
                entry.lastErrorAt = Date.now()
                console.log(`[InnertubePool] Session ${entry.profileId}: ✗ auth check failed — ${entry.error}`)
              } else {
                console.log(`[InnertubePool] Session ${entry.profileId}: health check transient error — not marked ready: ${errStr.slice(0, 80)}`)
              }
            }
          } catch (e: unknown) {
            entry.error = String(e).slice(0, 120)
            entry.lastErrorAt = Date.now()
            entry.client = null
            console.log(`[InnertubePool] Session ${entry.profileId}: ✗ error — ${entry.error}`)
          }
        } else {
          // Diagnose why this session is unusable
          const reasons: string[] = []
          if (!entry.cookies) reasons.push('no cookies extracted')
          if (!entry.cookies?.SAPISID) reasons.push('no SAPISID')
          if (!entry.cookies?.PSID) reasons.push('no __Secure-1PSID')
          if (entry.cookies?.PSID && entry.cookies?.SAPISID && !entry.cookies?.PSIDCC) reasons.push('no PSIDCC (may be ok)')
          entry.error = reasons.join('; ')
          console.log(`[InnertubePool] Session ${entry.profileId}: skipped — ${entry.error}`)
        }
      }))
    }

    const ready = this._sessions.filter(e => e.client !== null).length
    const skipped = this._sessions.filter(e => !e.client)
    console.log(`[InnertubePool] ${ready}/${this._sessions.length} sessions ready`)
    if (skipped.length > 0) {
      console.log(`[InnertubePool] Skipped sessions (${skipped.length}): ${skipped.map(e => `${e.profileId}(${e.error})`).join(', ')}`)
    }

    if (ready === 0) {
      console.warn('[InnertubePool] ⚠️ No sessions ready — Innertube detection will fail. Use OAuth fallback.')
      console.warn('[InnertubePool] Hint: Close Chrome, then restart HyperClip. Or open Chrome profiles and log into YouTube.')
    }
  }

  /**
   * Get the next available Innertube client (round-robin).
   * Skips sessions that failed recently (10s cooldown).
   * Returns null if no clients are available.
   */
  getNextClient(): { client: Innertube; profileId: string } | null {
    if (!this._initialized || this._sessions.length === 0) return null

    const now = Date.now()
    const RECENT_ERROR_MS = 10_000 // skip sessions that errored in last 10s
    const total = this._sessions.length

    // Try at most total+1 entries to find a working client
    for (let attempt = 0; attempt < total + 1; attempt++) {
      const idx = (this._index + attempt) % total
      const entry = this._sessions[idx]

      if (!entry.client) continue

      // Skip if recently errored
      if (entry.lastErrorAt > 0 && now - entry.lastErrorAt < RECENT_ERROR_MS) continue

      this._index = (idx + 1) % total
      // Track usage for background refresh priority
      entry.usedToday++
      entry.lastUsed = Date.now()
      return { client: entry.client, profileId: entry.profileId }
    }

    return null
  }

  /**
   * Fetch the NEWEST video from a channel using Innertube.
   * Returns null if no unseen video found or fetch fails.
   *
   * Age filter: only accept videos < 10 minutes old.
   * - publishedAt > 0 AND age <= 10 min → accept
   * - publishedAt = 0 (unparseable, treated as new upload) → accept
   * - publishedAt > 0 AND age > 10 min → skip (all older videos are also old → safe to return null)
   *
   * YouTube tab order is sorted newest-first, so if top-1 is old, all videos are old.
   */
  async getLatestVideo(channelId: string, seenVideoIds?: Set<string>): Promise<LatestVideo | null> {
    const entry = this.getNextClient()
    if (!entry) {
      console.log(`[InnertubePool] getLatestVideo(${channelId}): no client available`)
      return null
    }

    try {
      const channel = await entry.client.getChannel(channelId)

      // Some channels have no "Videos" tab (only Home/Shorts/Playlists).
      // Try videos tab first; fall back to home tab if not found.
      let videosTab: any
      let usedFallback = false
      try {
        videosTab = await channel.getVideos()
      } catch {
        videosTab = await channel.getHome()
        usedFallback = true
      }

      const videoItems = extractVideosFromTab(videosTab)

      if (videoItems.length === 0) {
        // Debug: log which extraction strategy was used and why it returned 0
        const memo = videosTab?.memo
        const memoKeys = memo ? Array.from(memo.keys?.() ?? []).slice(0, 10) : []
        const tabTitle = (videosTab as any)?.title ?? (videosTab as any)?.current_tab?.title ?? '?'
        const hasVideos = videosTab?.videos?.length > 0
        const hasVideoMemo = memo?.get('Video')?.length > 0
        const hasGridMemo = memo?.get('GridVideo')?.length > 0
        const hasReelMemo = memo?.get('ReelItem')?.length > 0
        console.log(`[InnertubePool] getLatestVideo(${channelId}): tab="${tabTitle}" (fallback=${usedFallback}), 0 videos — session=${entry.profileId}, strategies: videosGetter=${hasVideos}, memoVideo=${hasVideoMemo}, memoGrid=${hasGridMemo}, memoReel=${hasReelMemo}, memoKeys=[${memoKeys.join(',')}]`)
        return null
      }

      // Try top-1, then top-2 if deleted/private
      for (let i = 0; i < Math.min(2, videoItems.length); i++) {
        const videoItem = videoItems[i]
        const videoId = videoItem.id || videoItem.video_id
        if (!videoId) continue

        const titleRaw = videoItem.title
        const title = typeof titleRaw?.text === 'string'
          ? titleRaw.text
          : titleRaw?.toString?.() ?? '(no title)'

        if (title.includes('[deleted]') || title.includes('[private]')) continue

        // Check dedup FIRST — if seen, all older videos are also seen (tab sorted newest-first)
        if (seenVideoIds?.has(String(videoId))) {
          console.log(`[InnertubePool] getLatestVideo(${channelId}): top-${i+1} id=${videoId} already seen — session=${entry.profileId}`)
          return null
        }

        // NEW: top video is unseen — check age before accepting (0-10 min window)
        const publishedRaw = typeof videoItem.published?.text === 'string'
          ? videoItem.published.text
          : videoItem.published?.toString?.() ?? ''
        const publishedAt = parseRelativeDate(publishedRaw)

        // Age filter: only accept videos < 10 minutes old.
        // This handles the "app restart" edge case — user might restart right when a channel
        // uploads a video, so we accept up to 10 min old.
        // parseRelativeDate is the guard — if it fails, publishedAt = 0 (treated as brand new, OK).
        const MAX_VIDEO_AGE_MS = 10 * 60 * 1000
        if (publishedAt > 0 && Date.now() - publishedAt > MAX_VIDEO_AGE_MS) {
          console.log(`[InnertubePool] getLatestVideo(${channelId}): top-${i+1} id=${videoId} too old (${publishedRaw}) — skipping all — session=${entry.profileId}`)
          return null
        }

        const channelName = videoItem.author?.name?.toString?.()
          ?? (channel.header as any)?.author?.name
          ?? (channel.metadata as any)?.title
          ?? 'Unknown'

        const thumbnail = videoItem.thumbnail?.thumbnails?.[0]?.url ?? ''

        return {
          videoId: String(videoId),
          title: String(title),
          channelId,
          channelName: String(channelName),
          thumbnail: String(thumbnail),
          publishedAt,
          publishedText: publishedRaw || undefined,
        }
      }

      // All top-2 videos are deleted/private
      console.log(`[InnertubePool] getLatestVideo(${channelId}): all top-2 deleted/private — session=${entry.profileId}`)
      return null
    } catch (e: unknown) {
      const errStr = String(e)
      console.log(`[InnertubePool] getLatestVideo(${channelId}) error: ${errStr.slice(0, 200)}`)
      const sessionEntry = this._sessions.find(s => s.profileId === entry.profileId)
      if (sessionEntry) {
        sessionEntry.lastErrorAt = Date.now()
        sessionEntry.error = String(e).slice(0, 120)
        sessionEntry.usedToday++
        sessionEntry.lastUsed = Date.now()
      }
      return null
    }
  }

  /**
   * Fetch the newest N videos from a channel using Innertube.
   * Returns multiple videos so callers can skip already-seen ones at position >1.
   * Returns empty array if fetch fails.
   */
  async getLatestVideos(channelId: string, count = 5): Promise<LatestVideo[]> {
    const entry = this.getNextClient()
    if (!entry) {
      console.log(`[InnertubePool] getLatestVideos(${channelId}): no client available`)
      return []
    }

    try {
      const channel = await entry.client.getChannel(channelId)

      let videosTab: any
      let usedFallback = false
      try {
        videosTab = await channel.getVideos()
      } catch {
        videosTab = await channel.getHome()
        usedFallback = true
      }

      const videoItems = extractVideosFromTab(videosTab)

      if (videoItems.length === 0) {
        console.log(`[InnertubePool] getLatestVideos(${channelId}): tab="${(videosTab as any).title ?? (videosTab as any).current_tab?.title ?? '?'}" (fallback=${usedFallback}), 0 videos — session=${entry.profileId}`)
        return []
      }

      const results: LatestVideo[] = []
      const limit = Math.min(videoItems.length, count)

      for (let i = 0; i < limit; i++) {
        const videoItem = videoItems[i]
        const videoId = videoItem.id || videoItem.video_id
        if (!videoId) continue

        const titleRaw = videoItem.title
        const title = typeof titleRaw?.text === 'string'
          ? titleRaw.text
          : titleRaw?.toString?.() ?? '(no title)'

        if (title.includes('[deleted]') || title.includes('[private]')) continue

        // GridVideo.published is a Text object wrapping data.publishedTimeText
        // Access .text property to get the actual string like "1 minute ago"
        const publishedRaw = typeof videoItem.published?.text === 'string'
          ? videoItem.published.text
          : videoItem.published?.toString?.() ?? ''
        const publishedAt = parseRelativeDate(publishedRaw)
        const publishedText = publishedRaw || undefined

        const channelName = videoItem.author?.name?.toString?.()
          ?? (channel.header as any)?.author?.name
          ?? (channel.metadata as any)?.title
          ?? 'Unknown'

        const thumbnail = videoItem.thumbnail?.thumbnails?.[0]?.url ?? ''

        results.push({
          videoId: String(videoId),
          title: String(title),
          channelId,
          channelName: String(channelName),
          thumbnail: String(thumbnail),
          publishedAt,
          publishedText,
        })
      }

      if (results.length === 0) {
        console.log(`[InnertubePool] getLatestVideos(${channelId}): all top-${limit} videos deleted/private — session=${entry.profileId}`)
      } else {
        console.log(`[InnertubePool] getLatestVideos(${channelId}): got ${results.length} videos (session=${entry.profileId})`)
      }

      return results
    } catch (e: unknown) {
      const errStr = String(e)
      console.log(`[InnertubePool] getLatestVideos(${channelId}) error: ${errStr.slice(0, 200)}`)
      const sessionEntry = this._sessions.find(s => s.profileId === entry.profileId)
      if (sessionEntry) {
        sessionEntry.lastErrorAt = Date.now()
        sessionEntry.error = String(e).slice(0, 120)
        sessionEntry.usedToday++
        sessionEntry.lastUsed = Date.now()
      }
      return []
    }
  }

  /**
   * Rebuild client for a specific profile (after cookies were refreshed).
   */
  async refreshClient(profileId: string): Promise<boolean> {
    const entry = this._sessions.find(s => s.profileId === profileId)
    if (!entry) return false

    const sm = getSessionManager()
    await sm.refreshSession(profileId)
    const session = sm.getSessions().find(s => s.profileId === profileId)
    if (!session?.cookies) return false

    try {
      const cookieStr = buildCookieString(session.cookies)
      entry.client = await Innertube.create({
        cookie: cookieStr,
        retrieve_player: false,
        enable_session_cache: false,
      })
      // Health check: verify auth works
      try {
        await entry.client.getHomeFeed()
        entry.cookies = session.cookies
        entry.error = undefined
        entry.lastErrorAt = 0
        console.log(`[InnertubePool] Session ${profileId}: refreshed and health-checked OK`)
        return true
      } catch (healthErr: unknown) {
        const errStr = String(healthErr)
        const isAuthError = /401|403|not_signed_in|consent|verification|auth|500|Internal Server/i.test(errStr)
        if (isAuthError) {
          entry.client = null
          entry.error = `auth check failed: ${errStr.slice(0, 80)}`
          console.log(`[InnertubePool] Session ${profileId}: refresh auth check failed — ${entry.error}`)
          return false
        }
        entry.cookies = session.cookies
        entry.error = undefined
        entry.lastErrorAt = 0
        console.log(`[InnertubePool] Session ${profileId}: refreshed (health check skipped: ${errStr.slice(0, 60)})`)
        return true
      }
    } catch (e: unknown) {
      entry.error = String(e).slice(0, 120)
      entry.client = null
      return false
    }
  }

  getStatus(): InnertubePoolStatus {
    return {
      totalSessions: this._sessions.length,
      readyCount: this._sessions.filter(e => e.client !== null).length,
      ready: this._initialized,
      sessions: this._sessions.map(e => ({
        profileId: e.profileId,
        profileName: e.profileName,
        ready: e.client !== null,
        error: e.error,
      })),
    }
  }

  getReadyCount(): number {
    return this._sessions.filter(e => e.client !== null).length
  }

  isReady(): boolean {
    return this._initialized && this._sessions.some(e => e.client !== null)
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _pool: InnertubeClientPool | null = null

export async function getInnertubePool(): Promise<InnertubeClientPool> {
  if (!_pool) {
    _pool = new InnertubeClientPool()
    await _pool.init()
  }
  return _pool
}

export function getInnertubePoolSync(): InnertubeClientPool | null {
  return _pool
}
