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

// Suppress noisy youtubei.js logs (e.g. "[YOUTUBEJS][Text] Unable to find matching run")
const _origLog = console.log
const _origWarn = console.warn
const _origErr = console.error
console.log = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : ''
  if (msg.includes('[YOUTUBEJS]')) return
  _origLog(...args)
}
console.warn = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : ''
  if (msg.includes('[YOUTUBEJS]')) return
  _origWarn(...args)
}
console.error = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : ''
  if (msg.includes('[YOUTUBEJS]')) return
  _origErr(...args)
}

import Innertube from 'youtubei.js'
import { getSessionManager } from './chrome_cookies.js'
import type { YouTubeCookies } from './chrome_cookies.js'
import { getPoTokenForProfile, refreshPoToken } from './po_token.js'
import { devLog } from './unified_log.js'

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

// ─── Thumbnail helper ─────────────────────────────────────────────────────────
// YouTube thumbnails array is ordered smallest → largest.
// Return the highest-resolution URL (last item) or undefined.
function getHighResThumbnail(thumbnails?: Array<{ url?: string; width?: number; height?: number }>): string | undefined {
  if (!thumbnails || thumbnails.length === 0) return undefined
  // Try last item first (highest res), then prefer maxresdefault.jpg
  const last = thumbnails[thumbnails.length - 1]
  if (last?.url) return last.url
  // Fallback: prefer maxresdefault over others
  return thumbnails.find(t => t.url?.includes('maxresdefault'))?.url
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

  // "X second(s) ago" → subtract seconds (check first, before minutes)
  const secMatch = str.match(/(\d+)\s*second/)
  if (secMatch) return now - parseInt(secMatch[1]) * 1000

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

// ─── LockupView video metadata extraction ────────────────────────────────────

/**
 * Deep string scan: recursively search an object for any string matching
 * a relative-time pattern like "5 minutes ago", "3 hours ago", etc.
 * This catches LockupView formats where YouTube moves published_time_text
 * to an unexpected path.
 */
function deepFindRelativeTime(obj: any, depth = 0, maxDepth = 5): string {
  if (!obj || typeof obj !== 'object' || depth > maxDepth) return ''
  let firstMatch = ''
  for (const key of Object.keys(obj)) {
    const val = obj[key]
    if (typeof val === 'string' && /\d+\s*(second|minute|hour|day|week)/i.test(val)) {
      // "ago" = real publish time, skip "47 seconds" (duration)
      if (val.includes('ago')) return val
      if (!firstMatch) firstMatch = val
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = deepFindRelativeTime(item, depth + 1, maxDepth)
        if (found.includes('ago')) return found
        if (found && !firstMatch) firstMatch = found
      }
    }
    if (typeof val === 'object') {
      const found = deepFindRelativeTime(val, depth + 1, maxDepth)
      if (found.includes('ago')) return found
      if (found && !firstMatch) firstMatch = found
    }
  }
  return firstMatch
}

/**
 * Extract video metadata from a LockupView item.
 * YouTubei.js returns DIFFERENT structures for different channels:
 *
 * Structure A (common): metadata in lockupMetadata sub-object
 *   { type: "LockupView", lockupMetadata: { content_id, content_title, published_time_text } }
 *
 * Structure B (e.g. Zilk Kay): metadata in metadata.metadata sub-object
 *   { type: "LockupView", content_id: "vid", metadata: { metadata: { published_time_text, title } } }
 *
 * Fallback: deep string scan for time-like text (catches ANY format).
 */
function extractLockupVideoField(item: any, field: 'videoId' | 'title' | 'published'): string {
  if (!item) return ''

  // Published time extraction (most critical for detection)
  if (field === 'published') {
    // Structure A: lockupMetadata
    const lmPt = item.lockupMetadata?.published_time_text
    if (lmPt) {
      if (typeof lmPt === 'string') return lmPt
      if (typeof lmPt?.text === 'string') return lmPt.text
    }
    // Structure B: metadata.metadata.published_time_text
    const mPt = item.metadata?.metadata?.published_time_text
    if (mPt) {
      if (typeof mPt === 'string') return mPt
      if (typeof mPt?.text === 'string') return mPt.text
    }
    // Structure C: metadata.metadata.metadata_rows[0].metadata_parts[i].text.text (Zilk Kay pattern)
    // IMPORTANT: metadata_parts can contain duration ("47 seconds"), view count ("1.2M views"),
    // and publish time ("16 hours ago"). Code MUST prefer text containing "ago" to avoid
    // matching duration as publish time.
    const parts = item.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts
    if (parts && Array.isArray(parts)) {
      let firstMatch = ''
      for (const part of parts) {
        const text = part?.text?.text || part?.text
        if (text && typeof text === 'string' && /\d+\s*(second|minute|hour|day|week)/i.test(text)) {
          // "ago" = real publish time, not duration
          if (text.includes('ago')) return text
          if (!firstMatch) firstMatch = text
        }
        const runs = part?.text?.runs
        if (runs && Array.isArray(runs)) {
          for (const run of runs) {
            const runText = typeof run === 'string' ? run : run?.text
            if (runText && /\d+\s*(second|minute|hour|day|week)/i.test(String(runText))) {
              const str = String(runText)
              if (str.includes('ago')) return str
              if (!firstMatch) firstMatch = str
            }
          }
        }
      }
      if (firstMatch) return firstMatch
    }
    // Fallback: deep scan entire item for time-like strings.
    // This catches LockupView formats not covered by A/B/C above.
    const deepFound = deepFindRelativeTime(item)
    if (deepFound) return deepFound
    return ''
  }

  // Video ID extraction
  if (field === 'videoId') {
    // Structure A: lockupMetadata.content_id
    const lmId = item.lockupMetadata?.content_id
    if (lmId) return String(lmId)
    // Structure B: top-level content_id
    const topId = item.content_id
    if (topId) return String(topId)
    // Legacy fallback: top-level id
    const id = item.id || item.videoId || item.video_id
    if (id) return String(id)
    return ''
  }

  // Title extraction
  if (field === 'title') {
    // Structure A: lockupMetadata.content_title
    const lmTitle = item.lockupMetadata?.content_title
    if (lmTitle) {
      if (typeof lmTitle === 'string') return lmTitle
      if (typeof lmTitle?.text === 'string') return lmTitle.text
      return lmTitle?.toString?.() ?? ''
    }
    // Structure B: metadata.title (e.g. Zilk Kay — not metadata.metadata.title!)
    const mTitle = item.metadata?.title
    if (mTitle) {
      if (typeof mTitle === 'string') return mTitle
      if (typeof mTitle?.text === 'string') return mTitle.text
      return mTitle?.toString?.() ?? ''
    }
    // Structure B alt: metadata.metadata.title
    const mMetaTitle = item.metadata?.metadata?.title
    if (mMetaTitle) {
      if (typeof mMetaTitle === 'string') return mMetaTitle
      if (typeof mMetaTitle?.text === 'string') return mMetaTitle.text
      return mMetaTitle?.toString?.() ?? ''
    }
    // Fallback: top-level title
    if (item.title) {
      if (typeof item.title === 'string') return item.title
      if (typeof item.title?.text === 'string') return item.title.text
      return item.title?.toString?.() ?? ''
    }
    return ''
  }

  return ''
}

// ─── Video extraction from YouTube response ─────────────────────────────────

/**
 * Extract video items from the YouTube channel tab response.
 *
 * Strategy priority:
 * 1. Channel's page memo (contents_memo, on_response_received_*_memo) — most reliable
 * 2. videosTab.memo (Feed.memo getter)
 * 3. videosTab.videos (Feed.videos getter)
 * 4. current_tab content walk
 * 5. page.contents → tabs → selected tab walk
 * 6. Relaxed tree walk
 */
function extractVideosFromTab(videosTab: any): any[] {
  // Helper to unwrap nested content wrappers and extract video fields
  const unwrapVideo = (item: any): any => {
    let node = item?.content || item
    while (node && typeof node === 'object') {
      const n = node.content || node
      if (n === node) break
      node = n
    }
    return node
  }

  const hasVideoFields = (v: any) => v && (v.videoId || v.video_id || v.id || v.title || v.type)

  // ── Strategy 1: Channel's page memo — most reliable source for tab pages.
  // When getVideos() returns a Channel, its page contains:
  // - page.contents_memo: items from TwoColumnBrowseResults parsing
  // - page.on_response_received_*_memo: items from continuation/action sections
  const pageMemo = videosTab?.page?.contents_memo
    || videosTab?.page?.on_response_received_endpoints_memo
    || videosTab?.page?.on_response_received_actions_memo
    || videosTab?.page?.on_response_received_commands_memo
  if (pageMemo) {
    for (const type of ['RichItem', 'Video', 'GridVideo', 'ReelItem', 'CompactVideo', 'LockupView']) {
      const items = pageMemo.get(type)
      if (items?.length > 0) {
        const videos = items.map(unwrapVideo).filter(hasVideoFields)
        if (videos.length > 0) return videos
      }
    }
  }

  // ── Strategy 2: videosTab.memo (Feed.memo getter)
  const feedMemo = videosTab?.memo
  if (feedMemo) {
    for (const type of ['RichItem', 'Video', 'GridVideo', 'ReelItem', 'CompactVideo', 'LockupView']) {
      const items = feedMemo.get(type)
      if (items?.length > 0) {
        const videos = items.map(unwrapVideo).filter(hasVideoFields)
        if (videos.length > 0) return videos
      }
    }
  }

  // ── Strategy 3: Feed.videos getter
  const fromGetter = videosTab?.videos
  if (fromGetter?.length > 0) return [...fromGetter]

  // ── Strategy 4: Walk current_tab content (TwoColumnBrowseResults → tab → content)
  const currentTab = videosTab?.current_tab
  if (currentTab) {
    if (currentTab.content) {
      const videos = walkForVideosStrict(currentTab.content)
      if (videos.length > 0) return videos
    }
    // Try RichGrid.contents (modern channel tab format)
    if (currentTab.content?.type === 'RichGrid' && Array.isArray(currentTab.content.contents)) {
      const richItems = currentTab.content.contents.map(unwrapVideo).filter(hasVideoFields)
      if (richItems.length > 0) return richItems
    }
    // Try SectionList.contents
    if (currentTab.content?.type === 'SectionList' && Array.isArray(currentTab.content.contents)) {
      const allVideos: any[] = []
      for (const section of currentTab.content.contents) {
        if (section.content) {
          allVideos.push(...walkForVideosStrict(section.content))
        }
      }
      if (allVideos.length > 0) return allVideos
    }
  }

  // ── Strategy 5: Walk page.contents (TwoColumnBrowseResults → tabs → selected tab)
  const pageContents = videosTab?.page?.contents
  if (pageContents) {
    const tabNode = pageContents?.item?.()
    const tabs = tabNode?.tabs
    if (Array.isArray(tabs)) {
      const selectedTab = tabs.find((t: any) => t.selected)
      if (selectedTab) {
        if (selectedTab.content) {
          const videos = walkForVideosStrict(selectedTab.content)
          if (videos.length > 0) return videos
        }
        if (selectedTab.content?.type === 'RichGrid' && Array.isArray(selectedTab.content.contents)) {
          const richItems = selectedTab.content.contents.map(unwrapVideo).filter(hasVideoFields)
          if (richItems.length > 0) return richItems
        }
      }
    }
  }

  // ── Strategy 6: Relaxed tree walk (catches unusual structures)
  const allItems = walkForVideosRelaxed(videosTab)
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
      node.type === 'Video' || node.type === 'VideoRenderer' || node.type === 'GridVideoRenderer' ||
      node.type === 'RichItem') {
    results.push(node)
  }

  // Recurse into common container properties
  const containerProps = ['contents', 'items', 'videos', 'horizontal_list']
  for (const prop of containerProps) {
    if (node[prop]) results.push(...walkForVideosStrict(node[prop]))
  }

  return results
}

/** Relaxed walk — matches known video types + videoId+title combination, NOT id alone */
function walkForVideosRelaxed(node: any): any[] {
  if (!node) return []
  const results: any[] = []

  if (Array.isArray(node)) {
    for (const item of node) results.push(...walkForVideosRelaxed(item))
    return results
  }

  if (typeof node !== 'object') return []

  // Match known video types
  if (node.type === 'GridVideo' || node.type === 'ReelItem' ||
      node.type === 'CompactVideo' || node.type === 'Video' ||
      node.type === 'VideoRenderer' || node.type === 'GridVideoRenderer' ||
      node.type === 'RichItem' || node.type === 'LockupView') {
    results.push(node)
  }

  // Also match nodes that have BOTH videoId and title (strong video signal)
  // This catches YouTubeJS responses where video data is in a generic object
  const hasVideoId = !!(node.videoId || node.video_id || node.id)
  const hasTitle = !!(node.title || node.name)
  if (hasVideoId && hasTitle && !results.includes(node)) {
    results.push(node)
  }

  // Recurse into common container properties
  const containerProps = [
    'contents', 'items', 'videos', 'horizontal_list',
    'item_section_content', 'sectionListRenderer', 'richGridRenderer',
    'richSectionRenderer', 'adSlotRenderer', 'tabRenderer',
    'content', 'richItem',
  ]
  for (const prop of containerProps) {
    if (node[prop]) results.push(...walkForVideosRelaxed(node[prop]))
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

/** Max consecutive empty timestamp results before suspending a session */
const MAX_EMPTY_BEFORE_SUSPEND = 5
/** How long to wait before retrying a suspended session (5 min) */
const SUSPEND_COOLDOWN_MS = 5 * 60 * 1000

interface PoolEntry {
  profileId: string
  profileName: string
  client: Innertube | null
  cookies: YouTubeCookies | null
  /** PO Token extracted from Chrome session (for android client downloads) */
  po_token: string | null
  error?: string
  lastErrorAt: number
  usedToday: number
  lastUsed: number
  /** Consecutive error count for exponential backoff */
  errorCount: number
  /** Consecutive polls where all videos had unparseable timestamps */
  emptyTimestampCount: number
  /** When this session was suspended (0 = not suspended) */
  suspendedAt: number
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

    devLog(`[InnertubePool] Building client pool from ${sessions.length} Chrome sessions...`)

    // Build pool entries — no clients yet, just cookies
    this._sessions = sessions.map(s => ({
      profileId: s.profileId,
      profileName: s.profileName,
      client: null,
      cookies: s.cookies,
      po_token: null,
      error: s.error,
      lastErrorAt: 0,
      usedToday: 0,
      lastUsed: 0,
      errorCount: 0,
      emptyTimestampCount: 0,
      suspendedAt: 0,
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
            devLog(`[InnertubePool] Session ${entry.profileId}: creating client (PSID=${entry.cookies.PSID.slice(0,4)}..., SAPISID=${entry.cookies.SAPISID.slice(0,6)}..., SOCS=${entry.cookies.socs ?? 'none'})`)
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
              devLog(`[InnertubePool] Session ${entry.profileId}: [OK] client created and health-checked`)
            } catch (healthErr: unknown) {
              const errStr = String(healthErr)
              const isAuthError = /401|403|not_signed_in|consent|verification|auth|500|Internal Server/i.test(errStr)
              if (isAuthError) {
                entry.client = null
                entry.error = `auth check failed: ${errStr.slice(0, 80)}`
                entry.lastErrorAt = Date.now()
                devLog(`[InnertubePool] Session ${entry.profileId}: [FAIL] auth check failed - ${entry.error}`)
              } else {
                devLog(`[InnertubePool] Session ${entry.profileId}: health check transient error - not marked ready: ${errStr.slice(0, 80)}`)
              }
            }
          } catch (e: unknown) {
            entry.error = String(e).slice(0, 120)
            entry.lastErrorAt = Date.now()
            entry.client = null
            devLog(`[InnertubePool] Session ${entry.profileId}: [FAIL] error - ${entry.error}`)
          }
        } else {
          // Diagnose why this session is unusable
          const reasons: string[] = []
          if (!entry.cookies) reasons.push('no cookies extracted')
          if (!entry.cookies?.SAPISID) reasons.push('no SAPISID')
          if (!entry.cookies?.PSID) reasons.push('no __Secure-1PSID')
          if (entry.cookies?.PSID && entry.cookies?.SAPISID && !entry.cookies?.PSIDCC) reasons.push('no PSIDCC (may be ok)')
          entry.error = reasons.join('; ')
          devLog(`[InnertubePool] Session ${entry.profileId}: skipped - ${entry.error}`)
        }
      }))
    }

    const ready = this._sessions.filter(e => e.client !== null).length
    const skipped = this._sessions.filter(e => !e.client)
    devLog(`[InnertubePool] ${ready}/${this._sessions.length} sessions ready`)
    if (skipped.length > 0) {
      devLog(`[InnertubePool] Skipped sessions (${skipped.length}): ${skipped.map(e => `${e.profileId}(${e.error})`).join(', ')}`)
    }

    if (ready === 0) {
      console.warn('[InnertubePool] [WARN] No sessions ready - Innertube detection will fail. Use OAuth fallback.')
      console.warn('[InnertubePool] Hint: Close Chrome, then restart HyperClip. Or open Chrome profiles and log into YouTube.')
    }

    // PO Token extraction is no longer used — yt-dlp auto client + Chrome cookies
    // provides sufficient quality (1080p H.264) without PO Token overhead.
  }

  /**
   * Get the next available Innertube client (round-robin).
   * Skips sessions that failed recently (10s cooldown) or are suspended.
   * Auto-recycles suspended sessions after SUSPEND_COOLDOWN_MS.
   * Returns null if no clients are available.
   */
  getNextClient(): { client: Innertube; profileId: string } | null {
    if (!this._initialized || this._sessions.length === 0) return null

    const now = Date.now()
    const total = this._sessions.length

    // Try at most total+1 entries to find a working client
    for (let attempt = 0; attempt < total + 1; attempt++) {
      const idx = (this._index + attempt) % total
      const entry = this._sessions[idx]

      if (!entry.client) {
        // Try recycling a suspended client after cooldown
        if (entry.suspendedAt > 0 && now - entry.suspendedAt > SUSPEND_COOLDOWN_MS) {
          entry.suspendedAt = 0
          entry.emptyTimestampCount = 0
          entry.error = 'recycle: retrying suspended session'
          devLog(`[InnertubePool] Session ${entry.profileId}: recycling after ${SUSPEND_COOLDOWN_MS / 60000}min cooldown`)
        }
        continue
      }

      // Skip suspended sessions entirely (not even error-backoff)
      if (entry.suspendedAt > 0) continue

      // Exponential backoff on errors: 30s, 60s, 120s, 240s, max 5 min
      if (entry.lastErrorAt > 0 && entry.errorCount > 0) {
        const backoffMs = Math.min(300_000, 30_000 * Math.pow(2, entry.errorCount - 1))
        if (now - entry.lastErrorAt < backoffMs) continue
      }

      this._index = (idx + 1) % total
      // Track usage for background refresh priority
      entry.usedToday++
      entry.lastUsed = Date.now()
      return { client: entry.client, profileId: entry.profileId }
    }

    return null
  }

  /**
   * Fetch the videos tab using the Innertube browse action with params for the
   * /videos tab. This bypasses the tab-based approach that fails when a channel
   * has no Videos/Featured tabs (brand-new channels, restricted channels, etc.).
   *
   * Uses the Innertube session's browse action directly, no need for uploadsUrl.
   */
  private async _fetchUploadsTab(client: Innertube, channelId: string, channel: any): Promise<any | null> {
    // Strategy 1: navigate directly to /videos using browse action with parse: true.
    // This is the most reliable way to get the parsed videos tab content directly.
    try {
      devLog(`[InnertubePool] _fetchUploadsTab(${channelId}): navigating directly to browse /videos tab`)
      const response = await client.actions.execute('/browse', {
        browseId: channelId,
        params: 'EgZ2aWRlb3M%3D',
        parse: true,
      })
      if (response) {
        devLog(`[InnertubePool] _fetchUploadsTab(${channelId}): browse /videos tab succeeded`)
        return new (channel.constructor)(client.actions, response, true)
      }
    } catch (e) {
      devLog(`[InnertubePool] _fetchUploadsTab(${channelId}): browse /videos tab failed - ${String(e).slice(0, 80)}`)
    }

    // Strategy 2: Fetch the uploads playlist (UU...) directly.
    // Every channel's uploads playlist ID is the channel ID with 'UC' replaced by 'UU'.
    if (channelId.startsWith('UC') && channelId.length === 24) {
      try {
        const uploadsPlaylistId = 'UU' + channelId.slice(2)
        devLog(`[InnertubePool] _fetchUploadsTab(${channelId}): fetching uploads playlist ${uploadsPlaylistId}`)
        const playlist = await client.getPlaylist(uploadsPlaylistId)
        if (playlist) {
          devLog(`[InnertubePool] _fetchUploadsTab(${channelId}): uploads playlist fetch succeeded`)
          return playlist
        }
      } catch (e) {
        devLog(`[InnertubePool] _fetchUploadsTab(${channelId}): uploads playlist fetch failed - ${String(e).slice(0, 80)}`)
      }
    }

    return null
  }


  /**
   * Fetch the NEWEST video from a channel using Innertube.
   * Returns null if no unseen video found or fetch fails.
   *
   * Age filter: only accept videos < 10 minutes old.
   * - publishedAt > 0 AND age <= 10 min → accept
   * - publishedAt = 0 (unparseable, treated as old video with no cached timestamp) → skip
   * - publishedAt > 0 AND age > 10 min → skip (all older videos are also old → safe to return null)
   *
   * YouTube tab order is sorted newest-first, so if top-1 is old, all videos are old.
   */
  async getLatestVideo(channelId: string, seenVideoIds?: Set<string>): Promise<LatestVideo | null> {
    const entry = this.getNextClient()
    if (!entry) {
      devLog(`[InnertubePool] getLatestVideo(${channelId}): no client available`)
      return null
    }

    // Reset error count on successful client acquisition — start fresh
    const sessionEntry = this._sessions.find(s => s.profileId === entry.profileId)
    if (sessionEntry) sessionEntry.errorCount = 0

    try {
      const channel = await entry.client.getChannel(channelId)

      // Some channels have no "Videos" tab (only Home/Shorts/Playlists).
      // Try videos tab first; fall back to home tab if not found.
      // If both fail (e.g. channel has neither), try to get the uploads playlist directly
      // from channel metadata — every channel has an uploads playlist regardless of tab structure.
      let videosTab: any
      let bothTabsFailed = false
      try {
        videosTab = await channel.getVideos()
      } catch {
        try {
          videosTab = await channel.getHome()
        } catch {
          bothTabsFailed = true
        }
      }

      // When both standard tabs are unavailable, fetch the uploads playlist directly.
      // This handles: brand-new channels, channels with no Videos/Featured tabs,
      // channels that require authentication for tab access.
      if (bothTabsFailed) {
        devLog(`[InnertubePool] getLatestVideo(${channelId}): standard tabs unavailable - trying uploads playlist`)
        const uploadsTab = await this._fetchUploadsTab(entry.client, channelId, channel)
        if (uploadsTab) {
          videosTab = uploadsTab
        } else {
          devLog(`[InnertubePool] getLatestVideo(${channelId}): uploads playlist fetch also failed`)
          return null
        }
      }

      const videoItems = extractVideosFromTab(videosTab)

      if (videoItems.length === 0) {
        // DEBUG: log why extraction returned 0 videos — helps diagnose silent zero-result polls
        const hasMemo = !!(videosTab?.page?.contents_memo || videosTab?.memo || videosTab?.page?.on_response_received_endpoints_memo)
        const hasCurrentTab = !!(videosTab?.current_tab?.content)
        const hasPageContents = !!(videosTab?.page?.contents)
        devLog(`[InnertubePool] getLatestVideo(${channelId}): extractVideosFromTab=0 (hasMemo=${hasMemo} hasCurrentTab=${hasCurrentTab} hasPageContents=${hasPageContents})`)
        return null
      }

      // ── Always log top-5 extraction result for new video detection debugging ──────
      const parseableCount = videoItems.slice(0, 5).filter((vi: any) => extractLockupVideoField(vi, 'published')).length
      const top5 = videoItems.slice(0, Math.min(5, videoItems.length)).map((vi: any) => ({
        id: extractLockupVideoField(vi, 'videoId'),
        title: extractLockupVideoField(vi, 'title').slice(0, 40),
        published: extractLockupVideoField(vi, 'published') || '(empty)',
      }))
      devLog(`[InnertubePool] ${channelId} top-5: parseable=${parseableCount}/5 -> ${JSON.stringify(top5)}`)

      // Try top-1..top-5 — skip deleted/private and seen videos
      const maxCheck = Math.min(5, videoItems.length)
      for (let i = 0; i < maxCheck; i++) {
        const videoItem = videoItems[i]
        const itemType = videoItem?.type
        const isLockup = itemType === 'LockupView' || itemType === 'ShortsLockupView'

        // Extract videoId — supports both LockupView structure A (lockupMetadata) and B (top-level)
        const videoId = isLockup
          ? extractLockupVideoField(videoItem, 'videoId')
          : (videoItem.id || videoItem.videoId || videoItem.video_id ? String(videoItem.id || videoItem.videoId || videoItem.video_id) : '')
        if (!videoId) continue

        // Extract title
        const title = isLockup
          ? extractLockupVideoField(videoItem, 'title')
          : (typeof videoItem.title === 'string' ? videoItem.title : videoItem.title?.text ?? videoItem.title?.toString?.() ?? '(no title)')

        // Skip deleted/private — try next video in list
        if (title.includes('[deleted]') || title.includes('[private]')) {
          continue
        }

        // Check dedup — if seen, all older videos are also seen (tab sorted newest-first)
        if (seenVideoIds?.has(String(videoId))) {
          continue // Video already downloaded — try next (new uploads may have shifted positions)
        }

        // Extract published time — supports both LockupView structures
        let publishedRaw = ''
        if (isLockup) {
          publishedRaw = extractLockupVideoField(videoItem, 'published')
        } else {
          publishedRaw = typeof videoItem.published?.text === 'string'
            ? videoItem.published.text
            : videoItem.published?.toString?.() ?? ''
        }
        const publishedAt = parseRelativeDate(publishedRaw)

        // DEBUG: log raw extraction for Zilk Kay (UC...)
        if (channelId.startsWith('UC')) {
          devLog(`[DEBUG] ${channelId} [${i}] raw="${publishedRaw}" parsed=${publishedAt > 0 ? 'VALID' : 'ZERO'} age=${publishedAt > 0 ? Math.round((Date.now() - publishedAt) / 60000) + 'm' : 'N/A'}`)
        }

        // Age filter: skip videos older than 10 min (if age is parseable).
        // Skip unparseable age (publishedAt=0) — these are OLD videos where YouTube never
        // cached published_time_text, NOT new uploads. New uploads always have parseable age.
        const MAX_VIDEO_AGE_MS = 10 * 60 * 1000
        if (publishedAt > 0 && Date.now() - publishedAt > MAX_VIDEO_AGE_MS) {
          const ageMin = Math.round((Date.now() - publishedAt) / 60000)
          devLog(`[InnertubePool] check[${i}]: id=${videoId} "${title.slice(0, 30)}" SKIP (age): ${ageMin}m old > 10m`)
          continue
        }
        // publishedAt=0 = old video with no cached timestamp — skip.
        if (publishedAt === 0) {
          devLog(`[InnertubePool] check[${i}]: id=${videoId} "${title.slice(0, 30)}" age UNPARSEABLE - skip (old, no cached timestamp)`)
          continue
        }

        // Extract channel name:
        // 1. videoItem.author?.name — exists on GridVideo/VideoRenderer items
        // 2. channel.header?.author?.name — C4TabbedHeader.author is an Author instance with .name as string
        //    (use ?. to safely handle non-C4TabbedHeader header types like CarouselHeader, PageHeader)
        // 3. channel.metadata?.title — fallback to channel-level metadata title
        const extractedChannelName = (() => {
          // Try videoItem.author first
          const authorName = videoItem.author?.name
          if (authorName) {
            const name = typeof authorName === 'string' ? authorName : (authorName as any)?.text || String(authorName)
            if (name && name !== '[object Object]' && name !== 'undefined' && name !== 'null' && name !== 'N/A') return name
          }
          // Fallback: try channel header (C4TabbedHeader only — has Author.name)
          const header = channel.header as any
          if (header?.author?.name) {
            const name = typeof header.author.name === 'string' ? header.author.name : (header.author.name as any)?.text || String(header.author.name)
            if (name && name !== '[object Object]' && name !== 'undefined' && name !== 'null' && name !== 'N/A') return name
          }
          // Fallback: channel metadata title
          if (header?.metadata?.title) {
            const name = typeof header.metadata.title === 'string' ? header.metadata.title : (header.metadata.title as any)?.text || String(header.metadata.title)
            if (name && name !== '[object Object]' && name !== 'undefined' && name !== 'null' && name !== 'N/A') return name
          }
          return null
        })()
        const channelName = extractedChannelName ?? 'Unknown Channel'

        const thumbnail =
          getHighResThumbnail(videoItem.thumbnail?.thumbnails)
          || getHighResThumbnail(videoItem.content_image?.thumbnails)
          || videoItem.metadata?.image?.sources?.[0]?.url
          || ''

        // Log ACCEPT — helps debug why old videos are being downloaded
        const ageMs = Date.now() - publishedAt
        const ageLabel = ageMs < 60000 ? 'just now' : ageMs < 3600000 ? `${Math.round(ageMs / 60000)}m ago` : ageMs < 86400000 ? `${Math.round(ageMs / 3600000)}h ago` : `${Math.round(ageMs / 86400000)}d ago`
        devLog(`[InnertubePool] ACCEPT[${i}]: id=${videoId} "${title.slice(0, 40)}" age=${ageLabel}`)

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

      // All top-5 videos are deleted/private/seen/too-old
      return null
    } catch (e: unknown) {
      const errStr = String(e)
      devLog(`[InnertubePool] getLatestVideo(${channelId}) error: ${errStr.slice(0, 200)}`)
      const sessionEntry = this._sessions.find(s => s.profileId === entry.profileId)
      if (sessionEntry) {
        sessionEntry.lastErrorAt = Date.now()
        sessionEntry.error = String(e).slice(0, 120)
        sessionEntry.errorCount++
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
      devLog(`[InnertubePool] getLatestVideos(${channelId}): no client available`)
      return []
    }

    // Reset error count on successful client acquisition
    const sessionEntry = this._sessions.find(s => s.profileId === entry.profileId)
    if (sessionEntry) sessionEntry.errorCount = 0

    try {
      const channel = await entry.client.getChannel(channelId)

      let videosTab: any
      let bothTabsFailed = false
      try {
        videosTab = await channel.getVideos()
      } catch {
        try {
          videosTab = await channel.getHome()
        } catch {
          bothTabsFailed = true
        }
      }

      // When both standard tabs are unavailable, try the uploads playlist
      if (bothTabsFailed) {
        devLog(`[InnertubePool] getLatestVideos(${channelId}): standard tabs unavailable - trying uploads playlist`)
        videosTab = await this._fetchUploadsTab(entry.client, channelId, channel) ?? undefined
      }

      const videoItems = videosTab ? extractVideosFromTab(videosTab) : []

      if (videoItems.length === 0) {
        devLog(`[InnertubePool] getLatestVideos(${channelId}): 0 videos - session=${entry.profileId}`)
        return []
      }

      const results: LatestVideo[] = []
      const limit = Math.min(videoItems.length, count)

      for (let i = 0; i < limit; i++) {
        const videoItem = videoItems[i]
        const itemType = videoItem?.type
        const isLockup = itemType === 'LockupView' || itemType === 'ShortsLockupView'

        // Extract videoId — supports both LockupView structure A (lockupMetadata) and B (top-level)
        const videoId = isLockup
          ? extractLockupVideoField(videoItem, 'videoId')
          : (videoItem.id || videoItem.videoId || videoItem.video_id ? String(videoItem.id || videoItem.videoId || videoItem.video_id) : '')
        if (!videoId) continue

        // Extract title
        const title = isLockup
          ? extractLockupVideoField(videoItem, 'title')
          : (typeof videoItem.title === 'string' ? videoItem.title : videoItem.title?.text ?? videoItem.title?.toString?.() ?? '(no title)')

        if (title.includes('[deleted]') || title.includes('[private]')) continue

        // Extract published time — supports both LockupView structures
        let pr2 = ''
        if (isLockup) {
          pr2 = extractLockupVideoField(videoItem, 'published')
        } else {
          pr2 = typeof videoItem.published?.text === 'string'
            ? videoItem.published.text
            : videoItem.published?.toString?.() ?? ''
        }
        const publishedAt2 = parseRelativeDate(pr2)
        // Skip videos with unparseable timestamps — can't verify age, safer to exclude
        if (publishedAt2 === 0) {
          devLog(`[InnertubePool] getLatestVideos(${channelId}): top-${i+1} id=${videoId} age unparseable ("${pr2}") - skipping - session=${entry.profileId}`)
          continue
        }
        const publishedText = pr2 || undefined

        // Extract channel name (same logic as getLatestVideo above):
        const extractedChannelNameV2 = (() => {
          const authorName = videoItem.author?.name
          if (authorName) {
            const name = typeof authorName === 'string' ? authorName : (authorName as any)?.text || String(authorName)
            if (name && name !== '[object Object]' && name !== 'undefined' && name !== 'null' && name !== 'N/A') return name
          }
          const header = (channel as any).header
          if (header?.author?.name) {
            const name = typeof header.author.name === 'string' ? header.author.name : (header.author.name as any)?.text || String(header.author.name)
            if (name && name !== '[object Object]' && name !== 'undefined' && name !== 'null' && name !== 'N/A') return name
          }
          if (header?.metadata?.title) {
            const name = typeof header.metadata.title === 'string' ? header.metadata.title : (header.metadata.title as any)?.text || String(header.metadata.title)
            if (name && name !== '[object Object]' && name !== 'undefined' && name !== 'null' && name !== 'N/A') return name
          }
          return null
        })()
        const channelName = extractedChannelNameV2 ?? 'Unknown Channel'

        const thumbnail =
          getHighResThumbnail(videoItem.thumbnail?.thumbnails)
          || getHighResThumbnail(videoItem.content_image?.thumbnails)
          || videoItem.metadata?.image?.sources?.[0]?.url
          || ''

        results.push({
          videoId: String(videoId),
          title: String(title),
          channelId,
          channelName: String(channelName),
          thumbnail: String(thumbnail),
          publishedAt: publishedAt2,
          publishedText,
        })
      }

      if (results.length === 0) {
        devLog(`[InnertubePool] getLatestVideos(${channelId}): 0 valid (unparseable/deleted/seen) - session=${entry.profileId}`)
        // Track empty result for session health — if all videos had unparseable
        // timestamps, this session may have a broken LockupView format.
        if (sessionEntry) {
          sessionEntry.emptyTimestampCount++
          if (sessionEntry.emptyTimestampCount >= MAX_EMPTY_BEFORE_SUSPEND && !sessionEntry.suspendedAt) {
            sessionEntry.suspendedAt = Date.now()
            sessionEntry.error = `suspended: ${sessionEntry.emptyTimestampCount} consecutive empty timestamps`
            devLog(`[InnertubePool] Session ${entry.profileId}: SUSPENDED (${sessionEntry.emptyTimestampCount} empty polls)`)
          }
        }
      } else {
        devLog(`[InnertubePool] getLatestVideos(${channelId}): got ${results.length} videos (session=${entry.profileId})`)
        // Session returned valid results — reset empty counter and unsuspend
        if (sessionEntry) {
          sessionEntry.emptyTimestampCount = 0
          sessionEntry.suspendedAt = 0
        }
      }

      // Yield to event loop — the LockupView parsing above is CPU-bound and
      // can block the renderer from receiving IPC messages.
      await new Promise<void>(resolve => setImmediate(resolve))

      return results
    } catch (e: unknown) {
      const errStr = String(e)
      devLog(`[InnertubePool] getLatestVideos(${channelId}) error: ${errStr.slice(0, 200)}`)
      const sessionEntry = this._sessions.find(s => s.profileId === entry.profileId)
      if (sessionEntry) {
        sessionEntry.lastErrorAt = Date.now()
        sessionEntry.error = String(e).slice(0, 120)
        sessionEntry.errorCount++
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
        entry.errorCount = 0
        devLog(`[InnertubePool] Session ${profileId}: refreshed and health-checked OK`)
        return true
      } catch (healthErr: unknown) {
        const errStr = String(healthErr)
        const isAuthError = /401|403|not_signed_in|consent|verification|auth|500|Internal Server/i.test(errStr)
        if (isAuthError) {
          entry.client = null
          entry.error = `auth check failed: ${errStr.slice(0, 80)}`
          devLog(`[InnertubePool] Session ${profileId}: refresh auth check failed - ${entry.error}`)
          return false
        }
        entry.cookies = session.cookies
        entry.error = undefined
        entry.lastErrorAt = 0
        devLog(`[InnertubePool] Session ${profileId}: refreshed (health check skipped: ${errStr.slice(0, 60)})`)
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

  /**
   * Get PO Token for a specific profile.
   * Returns null if no token is cached — caller should handle fallback to web client.
   */
  async getPoTokenForSession(profileId: string): Promise<string | null> {
    // Check pool cache first
    const entry = this._sessions.find(e => e.profileId === profileId)
    if (entry?.po_token) return entry.po_token

    // Not in pool cache — extract from Chrome via CDP
    const token = await getPoTokenForProfile(profileId)
    if (entry && token) {
      entry.po_token = token
    }
    return token
  }

  /**
   * Get a download session: best available client with PO Token for a specific video.
   * Used by yt-dlp for android client downloads.
   * Navigates Chrome to the video page first to generate PO Token, then extracts it.
   *
   * @param videoId YouTube video ID — needed to navigate Chrome to the right video page
   */
  async getDownloadSession(videoId?: string): Promise<{ profileId: string; po_token: string | null } | null> {
    if (!this._initialized) return null

    // Round-robin filter of sessions that have an active Innertube client
    const sessions = this._sessions.filter(e => e.client !== null)
    if (sessions.length === 0) return null

    // Prefer sessions with PO Token (android-capable). On cache miss, do real-time
    // CDP extraction — this bridges the gap when no token was available at warmup
    // (e.g. no video was playing at startup) but one is now available.
    const withToken = sessions.filter(e => e.po_token)
    if (withToken.length > 0) {
      const entry = withToken[this._index % withToken.length]
      this._index++
      return { profileId: entry.profileId, po_token: entry.po_token }
    }

    // No PO Token available — fall back to web client.
    // PO Token extraction from CDP is unreliable (streamingData is null in page HTML).
    // The reliable path to 720p+ is: export cookies from Chrome + yt-dlp --cookies flag.
    // Cookie export is handled at the download level (not here), so just return null.
    const entry = sessions[this._index % sessions.length]
    this._index++
    return { profileId: entry.profileId, po_token: null }
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
