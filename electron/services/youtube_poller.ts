/**
 * YouTube Poller — HyperClip
 *
 * Subscription Feed polling via YouTube Data API v3.
 * Primary: activities?home=true + cookies (1 unit/poll, ~200ms)
 * Fallback: playlistItems per channel batch (only when primary returns 0)
 */

import { fetchSubscriptionFeed } from './subscription_feed.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DetectedVideo {
  videoId: string
  title: string
  channelId: string
  channelName: string
  thumbnail: string
  duration: string
  publishedTime: string
  detectedAt: number // timestamp
  publishedAt?: number // YouTube publish timestamp (ms)
}

export interface PollerOptions {
  pollIntervalMs?: number // default 4000 (4 seconds)
  maxVideosPerPoll?: number // max new videos to report per poll, default 5
  onNewVideos?: (videos: DetectedVideo[]) => void
  /** Called when Innertube has returned 0 videos for 3+ consecutive polls */
  onDegraded?: () => void
}

export interface PollerStatus {
  active: boolean
  pollIntervalMs: number
  lastPollAt: number | null
  lastNewVideosAt: number | null
  channelCount: number // number of channels being monitored
  videoCount: number // total unique videos seen this session
  newVideoCount: number // total new videos detected this session
  lastError: string | null
  exhaustedUntil: number | null // timestamp when backoff ends (null = not backing off)
  innertubeDegraded: boolean // true when Innertube has returned 0 videos for 3+ consecutive polls
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 5000 // 5 seconds — Innertube primary has no quota limit
const MAX_VIDEOS_PER_POLL = 5
const MAX_VIDEO_AGE_MS = 30 * 60 * 1000 // 30 minutes — for memory management only (seenVideoIds cap), NOT for detection filter — accounts for YouTube processing delay after upload
const SEEN_IDS_CAP = 10000 // cap to prevent unbounded memory growth
const SEEN_IDS_FILE = path.join(os.homedir(), 'AppData', 'Roaming', 'HyperClip', 'seen-ids.json')

// ─── SeenVideoIds persistence ─────────────────────────────────────────────────

/**
 * Load seen video IDs from disk.
 * Prevents re-detecting videos after app restart (no duplicate downloads).
 */
function loadSeenVideoIds(): Set<string> {
  try {
    if (fs.existsSync(SEEN_IDS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SEEN_IDS_FILE, 'utf-8'))
      return new Set<string>(Array.isArray(raw) ? raw : [])
    }
  } catch {}
  return new Set()
}

/**
 * Persist seen video IDs to disk.
 * Called after every new detection to survive restarts.
 */
function saveSeenVideoIds(ids: Set<string>): void {
  try {
    const arr = Array.from(ids)
    fs.writeFileSync(SEEN_IDS_FILE, JSON.stringify(arr), 'utf-8')
  } catch {}
}

// ─── Poller ─────────────────────────────────────────────────────────────────────

class YouTubePoller {
  private _pollTimer: NodeJS.Timeout | null = null
  private _pollIntervalMs: number
  private _maxVideosPerPoll: number
  private _onNewVideos?: (videos: DetectedVideo[]) => void
  private _seenVideoIds: Set<string>
  private _videoCount: number = 0
  private _newVideoCount: number = 0
  private _active: boolean = false
  private _lastPollAt: number | null = null
  private _lastNewVideosAt: number | null = null
  private _lastError: string | null = null
  private _pollsSinceLastLog: number = 0
  private _exhaustedBackoffUntil: number = 0 // timestamp when backoff ends
  private _lastExhaustedWarnAt: number = 0   // avoid spamming notifications
  private _backoffReason: 'oauth' | null = null
  private _exhaustionCount: number = 0        // tracks how many times we've backed off (for exponential backoff)
  private _isFirstPoll: boolean = true         // first poll after startup uses relaxed age filter
  private _innertubeDegraded: boolean = false // true when Innertube returns 0 videos for 3+ polls
  private _notifyDegraded?: () => void

  constructor(options: PollerOptions) {
    this._pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this._maxVideosPerPoll = options.maxVideosPerPoll ?? MAX_VIDEOS_PER_POLL
    this._onNewVideos = options.onNewVideos
    this._notifyDegraded = options.onDegraded
    // Load persisted seen IDs on startup — survives app restarts
    this._seenVideoIds = loadSeenVideoIds()
    console.log(`[YouTubePoller] Loaded ${this._seenVideoIds.size} seen video IDs from disk`)
  }

  getStatus(): PollerStatus {
    return {
      active: this._active,
      pollIntervalMs: this._pollIntervalMs,
      lastPollAt: this._lastPollAt,
      lastNewVideosAt: this._lastNewVideosAt,
      channelCount: 0, // filled by caller
      videoCount: this._videoCount,
      newVideoCount: this._newVideoCount,
      lastError: this._lastError,
      exhaustedUntil: this._exhaustedBackoffUntil > Date.now() ? this._exhaustedBackoffUntil : null,
      innertubeDegraded: this._innertubeDegraded,
    }
  }

  /** Resume polling immediately — clears exhaustion backoff */
  resume(): void {
    if (this._exhaustedBackoffUntil > Date.now()) {
      this._exhaustedBackoffUntil = 0
      this._backoffReason = null
      this._lastExhaustedWarnAt = 0
      this._exhaustionCount = 0
      console.log('[YouTubePoller] Backoff cleared — resuming polling')
    }
  }

  /**
   * Quick non-consuming check of resource availability.
   * Used during backoff to detect if user added tokens mid-session.
   */
  private async _checkResources(): Promise<{ hasOAuth: boolean }> {
    try {
      const { getTokenManager } = await import('./token_manager.js')
      const tm = getTokenManager()
      const statuses = tm.getAllStatuses()
      const hasOAuth = statuses.some(ts => ts.hasToken && ts.status !== 'exhausted')
      return { hasOAuth }
    } catch {
      return { hasOAuth: false }
    }
  }

  isActive(): boolean {
    return this._active
  }

  /** Manually add a video ID to the seen set (e.g., from existing workspaces) */
  markSeen(videoId: string): void {
    this._seenVideoIds.add(videoId)
    saveSeenVideoIds(this._seenVideoIds)
  }

  private _capSeenIds(): void {
    // Cap at SEEN_IDS_CAP to prevent unbounded memory growth
    if (this._seenVideoIds.size > SEEN_IDS_CAP) {
      const arr = Array.from(this._seenVideoIds)
      this._seenVideoIds = new Set(arr.slice(-SEEN_IDS_CAP))
      saveSeenVideoIds(this._seenVideoIds)
    }
  }

  private async _pollOnce(): Promise<void> {
    this._lastError = null
    this._lastPollAt = Date.now()

    const now = Date.now()

    // Backoff: if in exhausted backoff period, check if resources recovered
    if (now < this._exhaustedBackoffUntil) {
      if (this._pollsSinceLastLog === 0) {
        const { hasOAuth } = await this._checkResources()
        // Also check Innertube pool — it may recover if cookies were refreshed
        let poolReady = false
        try {
          const { getInnertubePoolSync } = await import('./innertube_client.js')
          const pool = getInnertubePoolSync()
          poolReady = pool?.isReady() ?? false
        } catch { /* pool not initialized yet */ }
        const remaining = Math.ceil((this._exhaustedBackoffUntil - now) / 1000)
        if (hasOAuth || poolReady) {
          this._exhaustedBackoffUntil = 0
          this._backoffReason = null
          const reason = poolReady ? 'Innertube pool' : 'OAuth'
          console.log(`[YouTubePoller] ${reason} recovered ✓ — resuming polling`)
        } else {
          console.log(`[YouTubePoller] Backoff (${remaining}s remaining) — checking...`)
        }
      }
      return
    }

    // Log every poll start — confirms poller is alive and making API calls
    if (this._pollsSinceLastLog === 0) {
      console.log(`[YouTubePoller] Scanning...`)
    }

    // First poll: use 24h window to capture all videos seen since last session.
    // This prevents the "all videos are old" blind spot when restarting the app.
    // Subsequent polls: use normal 30-min window.
    const sinceMs = this._isFirstPoll
      ? Date.now() - 24 * 60 * 60 * 1000
      : Date.now() - MAX_VIDEO_AGE_MS
    const subResult = await fetchSubscriptionFeed({
      // Request enough to fill maxVideosPerPoll + buffer — early exit kicks in at channel level
      maxVideos: this._maxVideosPerPoll + 5,
      seenVideoIds: this._seenVideoIds,
      sinceMs,
      firstPoll: this._isFirstPoll,
    })
    this._isFirstPoll = false

    // Emit degraded event to UI when Innertube has returned 0 videos for 3+ consecutive polls
    if (subResult.degraded) {
      this._innertubeDegraded = true
      this._notifyDegraded?.()
    } else if (subResult.videos.length > 0) {
      this._innertubeDegraded = false
    }

    if (subResult.videos.length === 0) {
      if (subResult.error) {
        this._lastError = subResult.error.slice(0, 80)
        if (subResult.error.includes('OAuth') || subResult.error.includes('token')) {
          console.warn(`[YouTubePoller] API error: ${subResult.error}`)
        }
      }

      // All detection sources exhausted — enter backoff mode, notify user once
      if (subResult.allSourcesExhausted) {
        const reason = 'All detection sources exhausted (Innertube: no Chrome sessions, OAuth: all tokens quota-exhausted)'
        this._backoffReason = 'oauth'
        this._lastError = reason
        console.warn(`[YouTubePoller] ${reason}`)

        // All detection sources exhausted — back off incrementally
        // Start with 60s, double each time (60s → 120s → 240s → ...), cap at 5 min
        const baseBackoff = 60_000
        const maxBackoff = 300_000  // 5 minutes max
        const backoffMs = Math.min(baseBackoff * Math.pow(2, this._exhaustionCount), maxBackoff)
        this._exhaustionCount = (this._exhaustionCount ?? 0) + 1
        this._exhaustedBackoffUntil = now + backoffMs
        this._backoffReason = 'oauth'

        if (now - this._lastExhaustedWarnAt > backoffMs) {
          this._lastExhaustedWarnAt = now
          console.warn(`[YouTubePoller] Backoff ${Math.round(backoffMs/1000)}s (attempt #${this._exhaustionCount}). Add more GCP projects or check token validity.`)
        }
      }
      return
    }

    const newVideos: DetectedVideo[] = []

    for (const vid of subResult.videos) {
      this._seenVideoIds.add(vid.videoId)
      this._videoCount++
      this._newVideoCount++

      const ageMs = vid.publishedAt > 0 ? Date.now() - vid.publishedAt : 0
      const ageMin = ageMs / 60000
      const ageStr = ageMin >= 60
        ? Math.floor(ageMin / 60) + 'h truoc'
        : ageMin < 1 ? 'Vua xong'
        : Math.floor(ageMin) + 'm truoc'

      newVideos.push({
        videoId: vid.videoId,
        title: vid.title,
        channelId: vid.channelId,
        channelName: vid.channelName,
        thumbnail: vid.thumbnail,
        duration: vid.duration || ageStr,
        publishedTime: ageStr,
        detectedAt: Date.now(),
        publishedAt: vid.publishedAt,
      })

      if (newVideos.length >= this._maxVideosPerPoll) break
    }

    // Persist seen IDs after every detection — survives restarts
    saveSeenVideoIds(this._seenVideoIds)
    this._capSeenIds()

    // Log alive status every 30 polls (~2 min at 4s/poll)
    this._pollsSinceLastLog++
    if (this._pollsSinceLastLog >= 30) {
      const elapsed = this._lastPollAt
        ? Math.round((Date.now() - this._lastPollAt) / 1000)
        : 0
      console.log(`[YouTubePoller] alive · ${this._videoCount} polled · ${this._newVideoCount} new · last ${elapsed}s ago`)
      this._pollsSinceLastLog = 0
    }

    if (newVideos.length > 0) {
      this._lastNewVideosAt = Date.now()
      console.log(`[YouTubePoller] ${newVideos.length} video moi (${subResult.source}): ${newVideos.map(v => v.title.slice(0, 40) + ' (' + v.channelName + ')').join(', ')}`)
      this._onNewVideos?.(newVideos)
    }
  }

  private _scheduleNextPoll(): void {
    if (!this._active) return
    // ±1s jitter around poll interval (scales with interval — keeps relative noise small)
    const jitter = this._pollIntervalMs + (Math.random() * 2000 - 1000)
    const delay = Math.max(1000, jitter) // minimum 1s between polls
    this._pollTimer = setTimeout(async () => {
      await this._pollOnce()
      this._scheduleNextPoll()
    }, delay)
  }

  start(): void {
    if (this._active) return
    this._active = true
    console.log(`[YouTubePoller] Starting (interval: ${this._pollIntervalMs / 1000}s ± 1s jitter, seen IDs: ${this._seenVideoIds.size})`)
    this._pollOnce()
    this._scheduleNextPoll()
  }

  stop(): void {
    this._active = false
    if (this._pollTimer) {
      clearTimeout(this._pollTimer)
      this._pollTimer = null
    }
    console.log('[YouTubePoller] Stopped')
  }

  restart(intervalMs?: number): void {
    if (intervalMs !== undefined) this._pollIntervalMs = intervalMs
    this.stop()
    this.start()
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _poller: YouTubePoller | null = null

export function createYouTubePoller(options: PollerOptions): YouTubePoller {
  if (_poller) _poller.stop()
  _poller = new YouTubePoller(options)
  return _poller
}

export function getYouTubePoller(): YouTubePoller | null {
  return _poller
}

export function stopYouTubePoller(): void {
  if (_poller) {
    _poller.stop()
    _poller = null
  }
}

export { YouTubePoller }
