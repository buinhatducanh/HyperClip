/**
 * PO Token Extractor — HyperClip
 *
 * Extracts Playback Origin (PO) Tokens from Chrome browser sessions via CDP.
 * PO Token is required for YouTube android client to access formats >360p.
 *
 * Android client streams use H.264 codec (better for editing than VP9 from web client).
 * Without PO Token, android client only returns 360p.
 *
 * Architecture:
 * 1. PO Token is extracted from a persistent Chrome running on port 9223 (session 1 profile).
 * 2. If persistent Chrome is not running, it is launched automatically.
 * 3. The persistent Chrome uses the user's default Chrome profile (same cookies).
 * 4. PO Token is cached for 10 minutes to avoid re-extracting on every download.
 */

import WebSocket from 'ws'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { devLog } from './unified_log.js'
import { ensurePersistentChrome } from './cdp.js'
import { getAppStoreDir } from './paths.js'

// ─── CDP Connection ───────────────────────────────────────────────────────────

interface CDPTarget {
  id: string
  webSocketDebuggerUrl: string
  url: string
  title: string
}

async function httpGet(url: string, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve(body))
    })
    req.on('error', () => resolve(null))
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null) })
  })
}

async function getCDPTarget(port: number): Promise<CDPTarget | null> {
  const json = await httpGet(`http://localhost:${port}/json`)
  if (!json) {
    devLog(`[PoToken] getCDPTarget: no response from port ${port}`)
    return null
  }
  try {
    const tabs: CDPTarget[] = JSON.parse(json)
    if (!tabs.length) {
      devLog(`[PoToken] getCDPTarget: no tabs found on port ${port}`)
      return null
    }
    // Prefer YouTube tab that has a specific video URL (not homepage)
    const ytVideoTab = tabs.find(t => t.url?.includes('youtube.com/watch?v='))
    if (ytVideoTab) {
      devLog(`[PoToken] Target tab (video): "${ytVideoTab.title}" url=${ytVideoTab.url?.slice(0, 60)}`)
      return ytVideoTab
    }
    // Fallback to any YouTube tab
    const ytTab = tabs.find(t => t.url?.includes('youtube.com'))
    if (ytTab) {
      devLog(`[PoToken] Target tab (fallback): "${ytTab.title}" url=${ytTab.url?.slice(0, 60)}`)
      return ytTab
    }
    // Last resort: first tab
    devLog(`[PoToken] Target tab (last resort): "${tabs[0].title}" url=${tabs[0].url?.slice(0, 60)}`)
    return tabs[0]
  } catch (e) {
    devLog(`[PoToken] getCDPTarget parse error: ${e}`)
    return null
  }
}

class CDPClient {
  private _ws: WebSocket | null = null
  private _msgId = 0
  private _pending = new Map<number, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>()

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this._ws = new WebSocket(wsUrl)
      this._ws.on('open', () => resolve())
      this._ws.on('error', (e) => reject(e))
      this._ws.on('message', (data: Buffer | Buffer[]) => {
        const raw = Array.isArray(data) ? Buffer.concat(data).toString() : data.toString()
        let msg: { id?: number; result?: unknown; error?: { message: string } }
        try { msg = JSON.parse(raw) } catch { return }
        if (msg.id !== undefined) {
          const p = this._pending.get(msg.id)
          if (p) {
            this._pending.delete(msg.id)
            if (msg.error) { p.reject(new Error(msg.error.message)) } else { void p.resolve(msg.result) }
          }
        }
      })
    })
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this._ws) throw new Error('CDP not connected')
    return new Promise((resolve, reject) => {
      const id = ++this._msgId
      this._pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this._ws!.send(JSON.stringify({ id, method, params }))
    })
  }

  async dispose(): Promise<void> {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.close()
    }
    this._ws = null
    this._pending.clear()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Navigate a Chrome tab to a video page and extract PO Token.
 * Called when downloading a specific video — PO Token is per-video.
 * Uses the persistent Chrome on the given port.
 */
export async function navigateAndExtractPoToken(port: number, videoId: string): Promise<string | null> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  devLog(`[PoToken] Navigating to ${videoUrl} for PO Token extraction...`)

  const target = await getCDPTarget(port)
  if (!target) {
    devLog(`[PoToken] No CDP target found on port ${port}`)
    return null
  }

  const client = new CDPClient()
  try {
    await client.connect(target.webSocketDebuggerUrl)

    devLog(`[PoToken] Navigating to: ${videoUrl}`)
    try {
      const navResult = await client.send('Page.navigate', { url: videoUrl }) as any
      devLog(`[PoToken] Navigate result: ${JSON.stringify(navResult)}`)
    } catch (e) {
      devLog(`[PoToken] Navigation error: ${e}`)
      return null
    }

    // Wait for the video player to load
    devLog(`[PoToken] Waiting for player to load...`)
    let waited = 0
    let playerLoaded = false
    while (waited < 15000) {
      await sleep(1000)
      waited += 1000
      try {
        const check = await client.send('Runtime.evaluate', {
          expression: '"ytInitialPlayerResponse" in window && window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.streamingData ? "READY" : "NOT_READY"',
          returnByValue: true,
        })
        const val = (check as any)?.result?.value
        if (val === 'READY') {
          playerLoaded = true
          devLog(`[PoToken] Player ready after ${waited / 1000}s`)
          break
        }
      } catch {}
    }

    // Strategy 1: Try JavaScript variable extraction (fastest)
    const jsScript = `
      (function() {
        var results = [];

        // yt.config_.PO_TOKEN / PLAYER_PO_TOKEN
        if (window.yt && window.yt.config_) {
          var cfg = window.yt.config_;
          if (cfg.PO_TOKEN) results.push({token: cfg.PO_TOKEN, source: 'ytcfg.PO_TOKEN'});
          if (cfg.PLAYER_PO_TOKEN) results.push({token: cfg.PLAYER_PO_TOKEN, source: 'ytcfg.PLAYER_PO_TOKEN'});
        }

        // ytInitialPlayerResponse streamingData
        if (window.ytInitialPlayerResponse) {
          var sd = window.ytInitialPlayerResponse.streamingData;
          if (sd) {
            var all = [].concat(sd.formats || [], sd.adaptiveFormats || [], sd.hlsFormats || []);
            for (var i = 0; i < all.length; i++) {
              var url = all[i].url || all[i].signatureCipher || '';
              var m = url.match(/[?&]pot=([^&]+)/);
              if (m && m[1]) results.push({token: decodeURIComponent(m[1]), source: 'streamingData.pot[' + i + ']'});
            }
          }
        }

        // ytplayer.config.args
        if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
          var a = window.ytplayer.config.args;
          if (a.po_token) results.push({token: a.po_token, source: 'ytplayer.args'});
        }

        if (results.length > 0) return {token: results[0].token, source: results[0].source};
        return null;
      })()
    `
    try {
      const jsResult = await client.send('Runtime.evaluate', { expression: jsScript, returnByValue: true }) as any
      const jsData = (jsResult as any)?.result?.value
      if (jsData?.token) {
        devLog(`[PoToken] Extracted from JS: ${jsData.source} (${jsData.token.slice(0, 8)}...)`)
        return jsData.token
      }
    } catch (e) {
      devLog(`[PoToken] JS extraction error: ${e}`)
    }

    // Strategy 2: Click play and intercept video element src / MediaSource URLs
    // PO Token for DASH streams is often embedded in the stream URL
    devLog(`[PoToken] Trying video element capture...`)

    const captureScript = `
      (function() {
        var results = [];
        var videos = document.querySelectorAll('video');
        for (var vi = 0; vi < videos.length; vi++) {
          var v = videos[vi];
          // video.src contains the actual streaming URL
          if (v.src && v.src.length > 10) {
            var src = v.src;
            var potMatch = src.match(/[?&]pot=([^&]+)/);
            if (potMatch) {
              results.push({token: decodeURIComponent(potMatch[1]), source: 'video.src.pot', url: src.slice(0, 120)});
            }
          }
          // MediaSource object
          if (v.mozSrc) results.push({source: 'video.mozSrc', url: v.mozSrc.slice(0, 80)});
          if (v.media && v.media.source) {
            try {
              var ms = v.media.source;
              var urls = ms.urls || Object.keys(ms);
              results.push({source: 'mediaSource', keys: JSON.stringify(urls).slice(0, 200)});
            } catch(e) {}
          }
        }

        // Intercept fetch/XHR for streaming URLs
        var origFetch = window.fetch;
        var origXHROpen = window.XMLHttpRequest.prototype.open;
        var interceptedURLs = [];

        // Try to find streaming URLs in ytInitialPlayerResponse adaptiveFormats
        if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.streamingData) {
          var sd2 = window.ytInitialPlayerResponse.streamingData;
          var formats = [].concat(sd2.formats || [], sd2.adaptiveFormats || []);
          for (var f = 0; f < formats.length; f++) {
            var fmtUrl = formats[f].url || '';
            if (fmtUrl) {
              interceptedURLs.push(fmtUrl.slice(0, 150));
              var m2 = fmtUrl.match(/[?&]pot=([^&]+)/);
              if (m2) results.push({token: decodeURIComponent(m2[1]), source: 'adaptiveFormats.pot[' + f + ']', url: fmtUrl.slice(0, 150)});
            }
          }
        }

        return {results: results, videoCount: videos.length, streamingURLs: interceptedURLs.slice(0, 3)};
      })()
    `
    try {
      const captureResult = await client.send('Runtime.evaluate', { expression: captureScript, returnByValue: true }) as any
      const captureData = (captureResult as any)?.result?.value
      if (captureData?.results?.length > 0) {
        for (const r of captureData.results) {
          if (r.token) {
            devLog(`[PoToken] Extracted from capture: ${r.source} (${r.token.slice(0, 8)}...)`)
            return r.token
          }
        }
      }
      devLog(`[PoToken] Capture: ${captureData?.videoCount || 0} videos, ${captureData?.streamingURLs?.length || 0} stream URLs`)
      for (const u of (captureData?.streamingURLs || [])) {
        devLog(`[PoToken] Stream URL: ${u}`)
      }
    } catch (e) {
      devLog(`[PoToken] Capture error: ${e}`)
    }

    // Strategy 3: Click play and wait, then re-check
    devLog(`[PoToken] Clicking play and waiting for stream...`)
    try {
      const playResult = await client.send('Runtime.evaluate', {
        expression: `
          (function() {
            var video = document.querySelector('video');
            if (!video) return {action: 'no-video'};
            video.currentTime = 0;
            video.play().catch(function(e){});
            return {action: 'played', src: video.src ? video.src.slice(0, 200) : '', readyState: video.readyState, networkState: video.networkState};
          })()
        `,
        returnByValue: true,
      }) as any
      devLog(`[PoToken] Play result: ${JSON.stringify(playResult?.result?.value)}`)
    } catch (e) {
      devLog(`[PoToken] Play click error: ${e}`)
    }

    await sleep(5000)

    // Try extraction again after play
    try {
      const afterResult = await client.send('Runtime.evaluate', {
        expression: `
          (function() {
            var v = document.querySelector('video');
            if (!v || !v.src) return null;
            var m = v.src.match(/[?&]pot=([^&]+)/);
            if (m) return {token: decodeURIComponent(m[1]), source: 'video.src.after-play'};
            return null;
          })()
        `,
        returnByValue: true,
      }) as any
      const afterData = (afterResult as any)?.result?.value
      if (afterData?.token) {
        devLog(`[PoToken] Extracted after play: ${afterData.source} (${afterData.token.slice(0, 8)}...)`)
        return afterData.token
      }
    } catch (e) {
      devLog(`[PoToken] After-play extraction error: ${e}`)
    }

    devLog(`[PoToken] All strategies exhausted — no PO Token found`)
    return null

  } catch (e) {
    devLog(`[PoToken] navigateAndExtractPoToken error: ${String(e).slice(0, 100)}`)
    return null
  } finally {
    await client.dispose()
  }
}

export function getCDPPort(profileId: string): number {
  const idx = parseInt(profileId, 10)
  return 9222 + (isNaN(idx) ? 0 : idx)
}

// ─── PO Token Extraction ──────────────────────────────────────────────────────

/**
 * Extract PO Token from a Chrome profile via CDP.
 *
 * Flow:
 * 1. Call navigateAndExtractPoToken — opens YouTube video page and extracts PO Token from player.
 *    If a YouTube tab already exists, reuses it (fast). If not, navigates and waits 8s.
 * 2. For profile "1", ensures persistent Chrome is running, then tries again.
 * 3. Fall back to null (download will fail without PO Token).
 *
 * NOTE: YouTube now requires GVS PO Token for ALL client types (android, ios, web).
 */
async function extractPoTokenFromProfile(profileId: string): Promise<string | null> {
  // Use navigateAndExtractPoToken which navigates to YouTube and extracts PO Token.
  // This is the ONLY approach that works: PO Token is generated server-side when the
  // YouTube player page loads — you can't extract it from an arbitrary existing tab.
  const profilePort = getCDPPort(profileId)
  try {
    const token = await navigateAndExtractPoToken(profilePort, 'dQw4w9WgXcQ')
    if (token) return token
  } catch (e) {
    devLog(`[PoToken] extractPoTokenFromProfile(${profileId}) error: ${String(e).slice(0, 100)}`)
  }

  // Profile "1" — ensure persistent Chrome is running, then try again
  if (profileId === '1') {
    try {
      await ensurePersistentChrome()
      const token = await navigateAndExtractPoToken(profilePort, 'dQw4w9WgXcQ')
      if (token) return token
    } catch {}
  }

  return null
}

// ─── Cookie Export for yt-dlp ───────────────────────────────────────────────

/**
 * Export all cookies from the persistent Chrome as a Netscape cookie file.
 * yt-dlp can use this cookie file to authenticate and bypass EJS challenge.
 * Returns path to the cookie file, or null if extraction fails.
 */
export async function exportCookiesForYtDlp(port: number): Promise<string | null> {
  devLog(`[PoToken] Exporting cookies from Chrome port ${port}...`)

  const target = await getCDPTarget(port)
  if (!target) {
    devLog('[PoToken] No CDP target for cookie export')
    return null
  }

  const client = new CDPClient()
  try {
    await client.connect(target.webSocketDebuggerUrl)

    // Get all cookies from Chrome
    const cookiesResult = await client.send('Network.getAllCookies') as any
    const cookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; secure: boolean; httpOnly: boolean }> =
      cookiesResult?.cookies || []

    devLog(`[PoToken] Got ${cookies.length} cookies from Chrome`)

    // Filter to YouTube-relevant cookies
    const ytCookies = cookies.filter(c =>
      c.domain?.includes('youtube') || c.domain?.includes('google')
    )

    if (ytCookies.length === 0) {
      devLog('[PoToken] No YouTube cookies found')
      return null
    }

    devLog(`[PoToken] YouTube cookies: ${ytCookies.map(c => c.name).join(', ')}`)

    // Write as Netscape cookie format (compatible with yt-dlp).
    // Field 2 (flag): TRUE = domain cookie (domain starts with '.'), FALSE = host cookie.
    // Field 4 (secure): TRUE = HTTPS only, FALSE = any scheme.
    // IMPORTANT: flag must match domain format — flag=TRUE requires domain starts with '.',
    // flag=FALSE requires domain does NOT start with '.'.
    const sanitize = (s: string) => s.replace(/[\t\n\r]/g, '')
    const cookieFile = path.join(getAppStoreDir(), '_yt_cookies.txt')
    const lines = [
      '# Netscape HTTP Cookie File',
      '# This file was generated by HyperClip',
      ...ytCookies.map(c => {
        const d = sanitize(c.domain)
        const flag = d.startsWith('.') ? 'TRUE' : 'FALSE'
        return `${d}\t${flag}\t${sanitize(c.path)}\t${c.secure ? 'TRUE' : 'FALSE'}\t${c.expires > 0 ? c.expires : 0}\t${sanitize(c.name)}\t${sanitize(c.value)}`
      }),
    ]
    fs.writeFileSync(cookieFile, lines.join('\n'), 'utf-8')
    devLog(`[PoToken] Cookie file written: ${cookieFile}`)
    return cookieFile
  } catch (e) {
    devLog(`[PoToken] Cookie export error: ${e}`)
    return null
  } finally {
    await client.dispose()
  }
}

// ─── Cached cookie export for yt-dlp ────────────────────────────────────────
// Export cookies once, reuse for all downloads within 5 minutes.
// This avoids the overhead of re-exporting on every download call.

let _cachedCookiesFile: string | null = null
let _cachedCookiesTime = 0
const COOKIE_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function getYtCookiesFile(): Promise<string | null> {
  // Return cached file if still fresh
  if (_cachedCookiesFile && fs.existsSync(_cachedCookiesFile) && Date.now() - _cachedCookiesTime < COOKIE_CACHE_TTL_MS) {
    return _cachedCookiesFile
  }

  // Lazy import to avoid circular deps
  const { ensurePersistentChrome } = await import('./cdp.js')
  const { exportCookiesForYtDlp: exportFn } = await import('./po_token.js')
  const persistent = await ensurePersistentChrome()
  if (!persistent) return null

  const file = await exportFn(persistent.port)
  if (file) {
    _cachedCookiesFile = file
    _cachedCookiesTime = Date.now()
  }
  return file
}

/** Clear the cookie cache — call this if the cookie file is corrupted */
export function clearYtCookiesCache(): void {
  _cachedCookiesFile = null
  _cachedCookiesTime = 0
}

// ─── Innertube Integration ───────────────────────────────────────────────────

interface CachedToken {
  token: string
  fetchedAt: number
}

const _tokenCache = new Map<string, CachedToken>()
const PO_TOKEN_TTL_MS = 10 * 60 * 1000 // Re-fetch every 10 minutes

/**
 * Get PO Token for a Chrome profile.
 * On cache miss: always attempts real-time CDP extraction (tokens are extracted
 * from whatever YouTube video is currently playing in the Chrome tab).
 *
 * Cache TTL = 10 min to avoid hammering CDP. For auto-download scenarios
 * where no video is playing, this returns null and the caller falls back to web client.
 */
export async function getPoTokenForProfile(profileId: string): Promise<string | null> {
  const cached = _tokenCache.get(profileId)
  if (cached && Date.now() - cached.fetchedAt < PO_TOKEN_TTL_MS) {
    return cached.token
  }

  // Cache miss — always attempt real-time extraction.
  // This works when a YouTube video is actively playing in the Chrome tab.
  const token = await extractPoTokenFromProfile(profileId)
  if (token) {
    _tokenCache.set(profileId, { token, fetchedAt: Date.now() })
  } else if (cached) {
    // Extraction failed but we have a stale cache — keep using it until TTL expires.
    // This bridges gaps where no video is currently playing.
    devLog(`[PoToken] Real-time extraction failed for profile ${profileId}, using stale cache (${Math.round((PO_TOKEN_TTL_MS - (Date.now() - cached.fetchedAt)) / 1000)}s remaining)`)
    return cached.token
  }
  return token
}

/**
 * Refresh PO Token for a profile (force re-fetch).
 */
export async function refreshPoToken(profileId: string): Promise<string | null> {
  _tokenCache.delete(profileId)
  return getPoTokenForProfile(profileId)
}

/**
 * Extract PO Tokens for ALL active Chrome profiles in parallel.
 * Call this once at startup to pre-warm the cache.
 * Each profile gets navigated to a YouTube video page and the PO Token is extracted.
 * For session 1, ensures persistent Chrome is running first.
 */
export async function warmupPoTokenCache(profileIds: string[]): Promise<void> {
  devLog(`[PoToken] Warming up PO Token cache for ${profileIds.length} profiles...`)

  // Ensure persistent Chrome is running for session 1
  if (profileIds.includes('1')) {
    await ensurePersistentChrome()
  }

  await Promise.all(profileIds.map(async (pid) => {
    try {
      await getPoTokenForProfile(pid)
    } catch {}
  }))

  const withToken = profileIds.filter(pid => _tokenCache.has(pid)).length
  devLog(`[PoToken] Cache warmed: ${withToken}/${profileIds.length} profiles have PO Tokens`)
}

// ─── Innertube Integration ───────────────────────────────────────────────────

/**
 * For Innertube detection, we use the web client which doesn't need PO Token.
 * But if we want to also support android client in Innertube, we need to
 * generate the PO Token using BotGuard. The youtubei.js library handles
 * this internally if we pass the po_token option.
 *
 * Since this is complex, we use CDP with persistent Chrome as a simpler alternative.
 * The persistent Chrome runs on port 9223 with the user's default profile.
 */
export async function getInnertubePoToken(profileId: string, videoId: string): Promise<string | null> {
  // For Innertube, we need a video-specific PO Token.
  // Try to get from cache first, then extract from a YouTube video page.
  const cached = _tokenCache.get(profileId)
  if (cached && Date.now() - cached.fetchedAt < PO_TOKEN_TTL_MS) {
    return cached.token
  }

  // The PO Token we extract is session-level, not video-specific.
  // For most cases, a session-level token works.
  return extractPoTokenFromProfile(profileId)
}
