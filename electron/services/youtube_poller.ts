/**
 * YouTube Poller — HyperClip
 *
 * Subscription Feed polling via YouTube Data API v3.
 * Primary: activities?home=true + cookies (1 unit/poll, ~200ms)
 * Fallback: playlistItems per channel batch (only when primary returns 0)
 */

import { fetchSubscriptionFeed } from './subscription_feed.js'

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
}

export interface PollerOptions {
  pollIntervalMs?: number // default 3000 (3 seconds)
  maxVideosPerPoll?: number // max new videos to report per poll, default 5
  onNewVideos?: (videos: DetectedVideo[]) => void
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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 20000 // 20 seconds
const MAX_VIDEOS_PER_POLl = 5
const MAX_VIDEO_AGE_MS = 10 * 60 * 1000 // 10 minutes — accounts for YouTube processing delay after upload

class YouTubePoller {
  private _pollTimer: NodeJS.Timeout | null = null
  private _pollIntervalMs: number
  private _maxVideosPerPoll: number
  private _onNewVideos?: (videos: DetectedVideo[]) => void
  private _seenVideoIds: Set<string> = new Set()
  private _videoCount: number = 0
  private _newVideoCount: number = 0
  private _active: boolean = false
  private _lastPollAt: number | null = null
  private _lastNewVideosAt: number | null = null
  private _lastError: string | null = null
  private _cookiesReady: boolean = false // removed, kept for compat
  private _lastPollTime: number = 0
  private _pollsSinceLastLog: number = 0

  constructor(options: PollerOptions) {
    this._pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this._maxVideosPerPoll = options.maxVideosPerPoll ?? MAX_VIDEOS_PER_POLl
    this._onNewVideos = options.onNewVideos
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
    }
  }

  isActive(): boolean {
    return this._active
  }

  /** Manually add a video ID to the seen set (e.g., from existing workspaces) */
  markSeen(videoId: string): void {
    this._seenVideoIds.add(videoId)
  }

  private async _pollOnce(): Promise<void> {
    this._lastError = null
    this._lastPollAt = Date.now()

    // Log every poll start — confirms poller is alive and making API calls
    if (this._pollsSinceLastLog === 0) {
      console.log(`[YouTubePoller] Scanning...`)
    }

    // API polling: YouTube Data API v3 with 30-key round-robin
    // Always use a 10-minute window for age filtering — NOT _lastPollTime.
    // _lastPollTime is only used for poll scheduling, not for filtering.
    const sinceMs = Date.now() - MAX_VIDEO_AGE_MS
    const subResult = await fetchSubscriptionFeed({
      maxVideos: 20,
      seenVideoIds: this._seenVideoIds,
      sinceMs,
    })

    if (subResult.videos.length === 0) {
      if (subResult.error) {
        this._lastError = subResult.error.slice(0, 80)
        if (subResult.error.includes('OAuth') || subResult.error.includes('token')) {
          console.warn(`[YouTubePoller] API error: ${subResult.error}`)
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
      })

      if (newVideos.length >= this._maxVideosPerPoll) break
    }

    this._lastPollTime = Date.now()

    // Log alive status every 30 polls (~10 min at 20s)
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
    const jitter = this._pollIntervalMs * (0.5 + Math.random())
    this._pollTimer = setTimeout(async () => {
      await this._pollOnce()
      this._scheduleNextPoll()
    }, jitter)
  }

  start(): void {
    if (this._active) return
    this._active = true
    console.log(`[YouTubePoller] Starting (interval: ${this._pollIntervalMs / 1000}s)`)
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
