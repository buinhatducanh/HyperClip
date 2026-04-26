/**
 * YouTube Poller — HyperClip
 *
 * High-frequency polling (default: 3 seconds) of the YouTube subscription feed
 * using Python + requests with session cookies extracted from Chrome/Edge.
 * Parses embedded JSON from the subscription feed HTML to detect new video uploads.
 */

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { getCookieManager } from './cookie_manager.js'
import { getOAuthClientId, getValidAccessToken, fetchSubscriptions, fetchRecentUploads, YouTubeChannel } from './youtube_auth.js'
import { getChannels, addChannel, removeChannel } from './store.js'
import { channelEvents } from './cookie_manager.js'
import { getCookieManager as getCM } from './cookie_manager.js'

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
  cookiesReady: boolean
  cookiesFrom: 'chrome' | 'edge' | 'none'
  videoCount: number // total unique videos seen this session
  newVideoCount: number // total new videos detected this session
  lastError: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 3000 // 3 seconds
const MAX_VIDEOS_PER_POLL = 5

function getPythonPath(): string {
  // Check PATH first — this finds the active Python installation
  const pathEnv = (process.env.PATH || '').split(path.delimiter)
  for (const dir of pathEnv) {
    const py = path.join(dir, 'python.exe')
    if (fs.existsSync(py)) return py
    const py3 = path.join(dir, 'python3.exe')
    if (fs.existsSync(py3)) return py3
  }

  // Fallback: common installation paths
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python314', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.APPDATA || '', 'Python', 'Python314', 'python.exe'),
    path.join(process.env.APPDATA || '', 'Python', 'Python313', 'python.exe'),
    path.join(process.env.APPDATA || '', 'Python', 'Python312', 'python.exe'),
    'python3', 'python',
  ]
  for (const py of candidates) {
    try { if (fs.existsSync(py)) return py } catch {}
  }
  return 'python'
}

function getScriptDir(): string {
  const dir = path.join(os.tmpdir(), 'hyperclip-poller')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ─── Python polling script ───────────────────────────────────────────────────

/**
 * Python script to poll YouTube subscription feed using requests with cookies.
 * Parses the embedded JSON data in the YouTube page source.
 * Anti-bot: uses requests.Session (keep-alive), full browser headers, Innertube client headers.
 */
function getPollerScript(): string {
  return `
import sys, json, re, time, requests

# ─── Browser Fingerprint Headers ────────────────────────────────────────────────
# Must match a real Chrome browser to avoid Bot Detection
CLIENT_NAME = '1'           # YouTube web client
CLIENT_VERSION = '2.20240402.09.00'

BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    # YouTube Innertube API headers — required to be recognized as a valid client
    'X-YouTube-Client-Name': CLIENT_NAME,
    'X-YouTube-Client-Version': CLIENT_VERSION,
    'X-YouTube-Device': 'cbr=Chrome&cbrver=123.0.0.0',
    'X-YouTube-PAGE-CL': '378853921',
    'X-YouTube-PAGE-LABEL': 'youtube.desktop_front_page',
}

# Singleton session for Keep-Alive (reuses TCP connections — bot-safe)
_session = None

def get_session(cookie_header):
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update(BASE_HEADERS)
        _session.headers['Cookie'] = cookie_header
        # Keep connection alive & connection pool size
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10,
            pool_maxsize=10,
            max_retries=1,
            pool_block=False,
        )
        _session.mount('https://', adapter)
        _session.mount('http://', adapter)
    else:
        _session.headers['Cookie'] = cookie_header
    return _session

def poll_youtube_subscriptions(session_header):
    url = 'https://www.youtube.com/feed/subscriptions'
    session = get_session(session_header)

    try:
        # keep-alive session reuses TCP — no new connection per request
        resp = session.get(url, timeout=12, headers={'Referer': 'https://www.youtube.com/'})
        html = resp.text
    except requests.exceptions.Timeout:
        return {'success': False, 'error': 'Request timed out after 12s'}
    except requests.exceptions.RequestException as e:
        return {'success': False, 'error': str(e)}

    videos = []

    # Strategy 1: Parse ytInitialData JSON from the page
    # Look for window["ytInitialData"] = {...};
    patterns = [
        r'window\\["ytInitialData"\\]\\s*=\\s*({.+?});\\s*</script>',
        r'ytInitialData\\s*=\\s*({.+?});\\s*</script>',
        r'"ytInitialData"\\s*:\\s*({.+?})(?:;|</script)',
    ]

    data = None
    for pat in patterns:
        m = re.search(pat, html, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(1))
                break
            except:
                pass

    # Strategy 2: Look for any JSON containing videoRenderer blocks
    if not data:
        # Fallback: find videoRenderer JSON blobs directly
        vr_pattern = r'\\{"videoRenderer\\":\\{"videoId\\":\\"([^\\"]+)\\"[^}]*?"title\\":\\{"runs\\":\\[\\{"text\\":\\"([^\\"]+)\\"'
        for m in re.finditer(vr_pattern, html):
            video_id = m.group(1)
            title = m.group(2)
            if video_id and title and len(video_id) >= 10:
                videos.append({
                    'videoId': video_id,
                    'title': title,
                    'channelId': '',
                    'channelName': '',
                    'thumbnail': f'https://img.youtube.com/vi/{video_id}/hqdefault.jpg',
                    'duration': '',
                    'publishedTime': '',
                })

    if data:
        videos = parse_yt_initial_data(data)

    return {'success': True, 'videos': videos, 'videoCount': len(videos)}


def parse_yt_initial_data(data):
    videos = []
    seen_ids = set()

    def extract_videos_from_contents(contents):
        found = []
        for item in contents:
            # RichItemRenderer -> content -> videoRenderer
            renderer = item.get('richItemRenderer', {}).get('content', {}).get('videoRenderer', {})
            if not renderer:
                # ContinuationItemRenderer — skip
                continue

            video_id = renderer.get('videoId', '')
            if not video_id or video_id in seen_ids:
                continue
            seen_ids.add(video_id)

            # Title
            title_runs = renderer.get('title', {}).get('runs', [])
            title = ''
            for run in title_runs:
                t = run.get('text', '')
                if t:
                    title += t

            # Channel info
            short_byline = renderer.get('shortBylineText', {})
            channel_runs = short_byline.get('runs', [])
            channel_id = ''
            channel_name = ''
            for run in channel_runs:
                navigation_endpoint = run.get('navigationEndpoint', {})
                browse_endpoint = navigation_endpoint.get('browseEndpoint', {})
                cid = browse_endpoint.get('browseId', '')
                if cid and cid.startswith('UC'):
                    channel_id = cid
                name = run.get('text', '')
                if name:
                    channel_name += name

            # Published time
            published_time = ''
            const_run = renderer.get('publishedTimeText', {})
            for run in const_run.get('runs', []):
                pt = run.get('text', '')
                if pt:
                    published_time += pt

            # Duration
            length_text = ''
            lt = renderer.get('lengthText', {})
            for run in lt.get('accessibility', {}).get('accessibilityData', {}).get('label', '').split():
                pass
            length_text = renderer.get('lengthText', {}).get('simpleText', '')

            # Thumbnail
            thumbnail = ''
            thumbs = renderer.get('thumbnail', {}).get('thumbnails', [])
            if thumbs:
                thumbnail = thumbs[-1].get('url', '')

            found.append({
                'videoId': video_id,
                'title': title,
                'channelId': channel_id,
                'channelName': channel_name,
                'thumbnail': thumbnail or f'https://img.youtube.com/vi/{video_id}/hqdefault.jpg',
                'duration': length_text,
                'publishedTime': published_time,
            })
        return found

    # Navigate to the tabs section and find the "Videos" tab contents
    # The feed structure: tabs -> tabRenderer -> content -> sectionListRenderer -> contents
    tabs = data.get('contents', {}).get('twoColumnBrowseResults', [])
    if not isinstance(tabs, list):
        tabs = [tabs]

    for tab in tabs:
        tab_renderer = tab.get('tabRenderer', {})
        content = tab_renderer.get('content', {})
        section_list = content.get('sectionListRenderer', {})
        for section in section_list.get('contents', []):
            # Try shelfRenderers, itemSectionRenderers
            for key in ['shelfRenderer', 'itemSectionRenderer']:
                shelf = section.get(key, {})
                content_block = shelf.get('content', {})
                for ckey in ['gridRenderer', 'richGridRenderer']:
                    grid = content_block.get(ckey, {})
                    for item in grid.get('contents', []):
                        found = extract_videos_from_contents([item])
                        videos.extend(found)

    # Fallback: walk the entire data structure looking for videoRenderer nodes
    if not videos:
        videos = walk_for_video_renderers(data, seen_ids)

    return videos


def walk_for_video_renderers(obj, seen_ids):
    videos = []
    if isinstance(obj, dict):
        vr = obj.get('videoRenderer', {})
        if vr and isinstance(vr, dict):
            video_id = vr.get('videoId', '')
            if video_id and video_id not in seen_ids and len(video_id) >= 10:
                seen_ids.add(video_id)
                title_runs = vr.get('title', {}).get('runs', [])
                title = ''.join(r.get('text', '') for r in title_runs)

                short_byline = vr.get('shortBylineText', {})
                channel_runs = short_byline.get('runs', [])
                channel_id = ''
                channel_name = ''
                for run in channel_runs:
                    nav = run.get('navigationEndpoint', {}).get('browseEndpoint', {})
                    cid = nav.get('browseId', '')
                    if cid.startswith('UC'):
                        channel_id = cid
                    name = run.get('text', '')
                    if name:
                        channel_name += name

                published = ''.join(r.get('text', '') for r in vr.get('publishedTimeText', {}).get('runs', []))
                duration = vr.get('lengthText', {}).get('simpleText', '')
                thumbs = vr.get('thumbnail', {}).get('thumbnails', [])
                thumbnail = thumbs[-1].get('url', '') if thumbs else f'https://img.youtube.com/vi/{video_id}/hqdefault.jpg'

                videos.append({
                    'videoId': video_id,
                    'title': title,
                    'channelId': channel_id,
                    'channelName': channel_name,
                    'thumbnail': thumbnail,
                    'duration': duration,
                    'publishedTime': published,
                })

        for val in obj.values():
            videos.extend(walk_for_video_renderers(val, seen_ids))

    elif isinstance(obj, list):
        for item in obj:
            videos.extend(walk_for_video_renderers(item, seen_ids))

    return videos


if __name__ == '__main__':
    session_header = sys.argv[1] if len(sys.argv) > 1 else ''
    result = poll_youtube_subscriptions(session_header)
    print(json.dumps(result))
`
}

// ─── Poller Implementation ────────────────────────────────────────────────────

class YouTubePoller {
  private _pollTimer: NodeJS.Timeout | null = null
  private _pollIntervalMs: number
  private _maxVideosPerPoll: number
  private _onNewVideos?: (videos: DetectedVideo[]) => void
  private _pythonPath: string
  private _scriptFile: string
  private _seenVideoIds: Set<string> = new Set()
  private _videoCount: number = 0
  private _newVideoCount: number = 0
  private _active: boolean = false
  private _lastPollAt: number | null = null
  private _lastNewVideosAt: number | null = null
  private _lastError: string | null = null
  private _cookiesReady: boolean = false
  private _cookiesFrom: 'chrome' | 'edge' | 'none' = 'none'
  // OAuth polling state
  private _oauthChannels: YouTubeChannel[] = []
  private _lastOAuthPollTime = 0

  constructor(options: PollerOptions) {
    this._pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this._maxVideosPerPoll = options.maxVideosPerPoll ?? MAX_VIDEOS_PER_POLL
    this._onNewVideos = options.onNewVideos

    this._pythonPath = getPythonPath()
    this._scriptFile = path.join(getScriptDir(), 'poll_youtube.py')
    fs.writeFileSync(this._scriptFile, getPollerScript(), 'utf-8')
  }

  getStatus(): PollerStatus {
    return {
      active: this._active,
      pollIntervalMs: this._pollIntervalMs,
      lastPollAt: this._lastPollAt,
      lastNewVideosAt: this._lastNewVideosAt,
      cookiesReady: this._cookiesReady,
      cookiesFrom: this._cookiesFrom,
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
    // Try OAuth polling first (primary method — reliable, not blocked)
    const clientId = getOAuthClientId()
    if (clientId) {
      await this._pollViaOAuth(clientId)
      return
    }

    // Fall back to cookie-based Python polling
    const cookieMgr = getCookieManager()

    if (!cookieMgr.isReady()) {
      // Try to refresh cookies
      const result = await cookieMgr.refresh()
      if (!result.success) {
        this._lastError = `Cookie refresh failed: ${result.error}`
        return
      }
      this._cookiesFrom = result.browser
      this._cookiesReady = result.cookies.length > 0
      if (!this._cookiesReady) {
        this._lastError = 'No cookies extracted yet'
        return
      }
    } else {
      this._cookiesReady = true
    }

    const sessionHeader = cookieMgr.getSessionHeader()
    if (!sessionHeader) {
      this._lastError = 'No session cookies available'
      return
    }

    const cookieFile = cookieMgr.getCookieFile()

    // Validate cookies first with a quick test
    const valid = await cookieMgr.validateCookies()
    if (!valid) {
      console.warn('[YouTubePoller] Cookies may be expired, refreshing...')
      const refreshResult = await cookieMgr.refresh()
      if (!refreshResult.success) {
        this._lastError = `Cookie validation failed: ${refreshResult.error}`
        return
      }
    }

    const finalCookieFile = cookieMgr.getCookieFile()
    const finalHeader = cookieMgr.getSessionHeader()

    await this._fetchVideos(finalHeader)
  }

  /**
   * Poll via YouTube Data API v3 using OAuth (primary method).
   * Reliable — not blocked by Google since it uses proper API auth.
   */
  private async _pollViaOAuth(clientId: string): Promise<void> {
    try {
      const accessToken = await getValidAccessToken(clientId)
      if (!accessToken) {
        this._lastError = 'OAuth: no valid token — waiting for login'
        return
      }

      this._lastPollAt = Date.now()

      // Fetch subscriptions on first poll
      if (this._oauthChannels.length === 0) {
        this._oauthChannels = await fetchSubscriptions(accessToken)
        console.log(`[YouTubePoller] OAuth: ${this._oauthChannels.length} subscriptions loaded`)

        // Sync OAuth subscriptions → channel store so sidebar can display them
        this._syncOAuthChannelsToStore()

        // Reset seen videos so we re-detect recent uploads (last 60 min)
        this._seenVideoIds.clear()
        this._lastOAuthPollTime = Date.now() - 60 * 60 * 1000 // look back 60 min on first poll
      }

      if (this._oauthChannels.length === 0) {
        this._lastError = 'OAuth: no subscriptions found'
        return
      }

      this._lastError = null
      this._cookiesReady = true

      const sinceMs = this._lastOAuthPollTime > 0 ? this._lastOAuthPollTime : (Date.now() - 10 * 60 * 1000)

      // Build channelId → channelName map
      const channelMap = new Map(this._oauthChannels.map(c => [c.channelId, c.title]))

      // Fetch all channels in PARALLEL (concurrency: 10 at a time)
      const CONCURRENCY = 10
      const allYtVideos: import('./youtube_auth.js').YouTubeVideo[] = []

      for (let i = 0; i < this._oauthChannels.length; i += CONCURRENCY) {
        const batch = this._oauthChannels.slice(i, i + CONCURRENCY)
        const results = await Promise.all(
          batch.map(ch => fetchRecentUploads(accessToken, ch.channelId, sinceMs))
        )
        for (const vids of results) {
          allYtVideos.push(...vids)
        }
      }

      console.log(`[YouTubePoller] OAuth: polled ${this._oauthChannels.length} channels, got ${allYtVideos.length} total uploads (since ${Math.round((Date.now() - sinceMs) / 60000)}m ago)`)

      const newVideos: DetectedVideo[] = []
      for (const ytVid of allYtVideos) {
        if (this._seenVideoIds.has(ytVid.videoId)) continue

        this._seenVideoIds.add(ytVid.videoId)
        this._videoCount++
        this._newVideoCount++

        const publishedAt = new Date(ytVid.publishedAt).getTime()
        const ageMs = Date.now() - publishedAt
        const ageMin = ageMs / 60000
        const ageStr = ageMin >= 60
          ? `${Math.floor(ageMin / 60)}h ago`
          : ageMin < 1
            ? 'Vừa xong'
            : `${Math.round(ageMin)}m ago`

        newVideos.push({
          videoId: ytVid.videoId,
          title: ytVid.title,
          channelId: ytVid.channelId,
          channelName: channelMap.get(ytVid.channelId) || '',
          thumbnail: `https://img.youtube.com/vi/${ytVid.videoId}/hqdefault.jpg`,
          duration: ageStr,
          publishedTime: ageStr,
          detectedAt: Date.now(),
        })

        if (newVideos.length >= this._maxVideosPerPoll) break
      }

      this._lastOAuthPollTime = Date.now()

      if (newVideos.length > 0) {
        this._lastNewVideosAt = Date.now()
        console.log(`[YouTubePoller] ✓ Detected ${newVideos.length} new video(s): ${newVideos.map(v => `"${v.title}" by ${v.channelName}`).join(', ')}`)
        this._onNewVideos?.(newVideos)
      }
    } catch (e) {
      this._lastError = `OAuth poll error: ${(e as Error).message}`
      console.warn('[YouTubePoller]', this._lastError)
    }
  }

  private async _fetchVideos(sessionHeader: string): Promise<void> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      const timeout = 15_000

      const proc = spawn(this._pythonPath, [this._scriptFile, sessionHeader], {
        env: { ...process.env },
        windowsHide: true,
        shell: true,
      })

      proc.stdout?.on('data', (d) => { stdout += d.toString() })
      proc.stderr?.on('data', (d) => { stderr += d.toString() })

      proc.on('error', (err) => {
        this._lastError = `Spawn error: ${err.message}`
        resolve()
      })

      proc.on('close', (code) => {
        this._lastPollAt = Date.now()

        if (code !== 0 || !stdout.trim()) {
          this._lastError = `Poll failed (code ${code}): ${stderr.slice(0, 200)}`
          resolve()
          return
        }

        try {
          const result = JSON.parse(stdout.trim())

          if (!result.success) {
            this._lastError = result.error || 'Unknown polling error'
            resolve()
            return
          }

          this._lastError = null
          const rawVideos: DetectedVideo[] = (result.videos || []).map((v: Record<string, string>) => ({
            ...v,
            detectedAt: Date.now(),
          }))

          // Filter to new videos only
          const newVideos: DetectedVideo[] = []
          for (const video of rawVideos) {
            if (video.videoId && !this._seenVideoIds.has(video.videoId)) {
              this._seenVideoIds.add(video.videoId)
              this._videoCount++
              this._newVideoCount++
              newVideos.push(video)
              if (newVideos.length >= this._maxVideosPerPoll) break
            }
          }

          if (newVideos.length > 0) {
            this._lastNewVideosAt = Date.now()
            console.log(`[YouTubePoller] Detected ${newVideos.length} new video(s): ${newVideos.map(v => `"${v.title}" (${v.videoId})`).join(', ')}`)
            this._onNewVideos?.(newVideos)
          }

        } catch (e) {
          this._lastError = `Parse error: ${e}. stdout: ${stdout.slice(0, 200)}`
        }

        resolve()
      })

      setTimeout(() => {
        try { proc.kill() } catch {}
        this._lastError = 'Poll timed out'
        resolve()
      }, timeout)
    })
  }

  private _scheduleNextPoll(): void {
    if (!this._active) return
    // Jitter: ±50% random delay around base interval
    // e.g. 3000ms base → random(1500, 4500ms) → 3-6s range
    // Mimics human browsing rhythm — key anti-bot signal
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

  private _syncOAuthChannelsToStore(): void {
    try {
      const existingChannels = getChannels()
      const existingIds = new Set(existingChannels.map(c => c.channelId || c.id))

      let added = 0
      for (const sub of this._oauthChannels) {
        if (existingIds.has(sub.channelId)) continue

        const avatarColors = ['#00B4FF', '#FF0000', '#00FF88', '#FFB800', '#7C3AED', '#FF0080', '#FF6B35']
        const color = avatarColors[added % avatarColors.length]
        const id = `oauth_${sub.channelId}`
        addChannel({
          id,
          name: sub.title,
          handle: `@${sub.channelId}`,
          avatarColor: color,
          channelId: sub.channelId,
          avatarUrl: sub.thumbnail || undefined,
          createdAt: new Date().toISOString(),
        })
        added++
      }

      if (added > 0) {
        console.log(`[YouTubePoller] Synced ${added} OAuth channels to store`)
        // Notify renderer to re-fetch channel list
        channelEvents.emit('channelsSynced', { count: added })
      }
    } catch (e) {
      console.warn('[YouTubePoller] Failed to sync OAuth channels:', e)
    }
  }

  stop(): void {
    this._active = false
    if (this._pollTimer) {
      clearTimeout(this._pollTimer)
      this._pollTimer = null
    }
    console.log('[YouTubePoller] Stopped')
  }

  /** Restart with a new interval */
  restart(intervalMs?: number): void {
    if (intervalMs !== undefined) this._pollIntervalMs = intervalMs
    this.stop()
    this.start()
  }
}

// Singleton instance
let _poller: YouTubePoller | null = null

export function createYouTubePoller(options: PollerOptions): YouTubePoller {
  if (_poller) {
    _poller.stop()
  }
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

