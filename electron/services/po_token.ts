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
import { devLog } from './dev_log.js'
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
          if (p) { this._pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result) }
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

  // Get the YouTube tab
  let target = await getCDPTarget(port)
  if (!target) {
    devLog(`[PoToken] No CDP target found on port ${port}`)
    return null
  }

  const client = new CDPClient()
  try {
    await client.connect(target.webSocketDebuggerUrl)

    // Navigate to the video page — must succeed for PO Token to be generated
    devLog(`[PoToken] Navigating to: ${videoUrl}`)
    let navSuccess = false
    try {
      const navResult = await client.send('Page.navigate', { url: videoUrl }) as any
      devLog(`[PoToken] Navigate result: ${JSON.stringify(navResult)}`)
      navSuccess = !navResult?.loadEventFired || true // navigation initiated
    } catch (e) {
      devLog(`[PoToken] Navigation error: ${e}`)
      return null // Can't extract PO Token without navigation
    }
    // Wait for video player to load and generate PO Token
    devLog(`[PoToken] Waiting 8s for video player to load...`)
    await sleep(8000)

    // Extract PO Token from the video page
    // Simplest possible script — just check what's available
    const script = `"ytInitialPlayerResponse" in window ? "EXISTS" : "NOT_FOUND"`

    let evalResult: any
    try {
      evalResult = await client.send('Runtime.evaluate', { expression: script, returnByValue: true })
    } catch (e) {
      devLog(`[PoToken] Runtime.evaluate error: ${e}`)
      return null
    }
    const ytIRExists = evalResult?.result?.value
    devLog(`[PoToken] ytInitialPlayerResponse: ${ytIRExists}`)

    // Now get ytInitialPlayerResponse
    const script2 = `
      (function() {
        try {
        var results = [];

        // Try ytcfg
        if (window.yt && window.yt.config_) {
          if (window.yt.config_.PO_TOKEN) results.push({token: window.yt.config_.PO_TOKEN, source: 'ytcfg.PO_TOKEN'});
          if (window.yt.config_.PLAYER_PO_TOKEN) results.push({token: window.yt.config_.PLAYER_PO_TOKEN, source: 'ytcfg.PLAYER_PO_TOKEN'});
          if (window.yt.config_.INNERTUBE_API_KEY) results.push({source: 'ytcfg', innertubeKey: window.yt.config_.INNERTUBE_API_KEY ? 'found' : 'missing'});
        }

        // Try ytInitialPlayerResponse (embedded in page HTML)
        if (window.ytInitialPlayerResponse) {
          var sd = window.ytInitialPlayerResponse.streamingData;
          if (sd && sd.adaptiveFormats) {
            for (var i = 0; i < sd.adaptiveFormats.length; i++) {
              var url = sd.adaptiveFormats[i].url || sd.adaptiveFormats[i].signatureCipher || '';
              var match = url.match(/[?&]pot=([^&]+)/);
              if (match) results.push({token: decodeURIComponent(match[1]), source: 'streamingData.pot[' + i + ']', url: url.slice(0, 80)});
            }
          }
        }

        // Try ytplayer.config.args
        if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
          var args = window.ytplayer.config.args;
          if (args.po_token) results.push({token: args.po_token, source: 'ytplayer.args'});
          if (args.player_response) {
            try {
              var pr = JSON.parse(args.player_response);
              var prsd = pr.streamingData;
              if (prsd && prsd.adaptiveFormats) {
                for (var j = 0; j < prsd.adaptiveFormats.length; j++) {
                  var prurl = prsd.adaptiveFormats[j].url || prsd.adaptiveFormats[j].signatureCipher || '';
                  var prmatch = prurl.match(/[?&]pot=([^&]+)/);
                  if (prmatch) results.push({token: decodeURIComponent(prmatch[1]), source: 'player_response.pot[' + j + ']'});
                }
              }
            } catch(e) {}
          }
        }

        if (results.length > 0) return { token: results[0].token, source: results[0].source, all: results.slice(0, 3) };
        return { token: null, source: 'none', ytInitialPlayerResponse: !!window.ytInitialPlayerResponse, ytplayer: !!window.ytplayer, ytplayerConfig: !!(window.ytplayer && window.ytplayer.config), ytConfig: !!(window.yt && window.yt.config_) };
      })()
    `

    const result = await client.send('Runtime.evaluate', { expression: script, returnByValue: true }) as any
    const data = (result as any)?.result?.value || {}

    if (data.token) {
      devLog(`[PoToken] Extracted PO Token for ${videoId} — source: ${data.source}`)
      return data.token
    } else {
      devLog(`[PoToken] No PO Token found for ${videoId} — details: ${JSON.stringify(data)}`)
      return null
    }
  } catch (e) {
    devLog(`[PoToken] navigateAndExtractPoToken error: ${e} — ${String(e).slice(0, 100)}`)
    return null
  } finally {
    await client.dispose()
  }
}

function getCDPPort(profileId: string): number {
  const idx = parseInt(profileId, 10)
  return 9222 + (isNaN(idx) ? 0 : idx)
}

// ─── PO Token Extraction ──────────────────────────────────────────────────────

/**
 * Extract PO Token from a Chrome profile via CDP.
 *
 * Flow:
 * 1. Try profile-specific port (sessions 2-30 — Chrome may be running)
 * 2. If that fails and profileId is "1", ensure persistent Chrome is running, then extract
 * 3. Fall back to null (will use web client instead)
 */
async function extractPoTokenFromProfile(profileId: string): Promise<string | null> {
  // Strategy 1: Try profile-specific port (sessions 2-30)
  const profilePort = getCDPPort(profileId)
  let target = await getCDPTarget(profilePort)
  let targetSource = `profile-${profileId}`

  // Strategy 2: For session 1, try persistent Chrome (port 9223)
  if (!target && profileId === '1') {
    devLog(`[PoToken] No Chrome on port ${profilePort} — launching persistent Chrome...`)
    const persistent = await ensurePersistentChrome()
    if (persistent) {
      target = await getCDPTarget(persistent.port)
      targetSource = 'persistent'
    }
  }

  if (!target) return null

  const client = new CDPClient()
  try {
    await client.connect(target.webSocketDebuggerUrl)

    // No navigation — PO Token extraction from page HTML doesn't work (streamingData is null).
    // PO Token is generated server-side by YouTube. Skip extraction entirely.

    // Strategy 1: Try ytcfg.get('PO_TOKEN') — works for web player
    // Strategy 2: Try ytcfg.get('PLAYER_PO_TOKEN') — android-specific
    // Strategy 3: Try ytInitialPlayerResponse.streamingData.adaptiveFormats
    //   where we look for po_token in the URL parameters
    const script = `
      (function() {
        try {
          // Strategy 1: ytcfg PO_TOKEN (web player)
          if (typeof yt !== 'undefined' && yt.config_ && yt.config_.PO_TOKEN) {
            return { token: yt.config_.PO_TOKEN, source: 'ytcfg.PO_TOKEN' };
          }
          // Strategy 2: ytcfg PLAYER_PO_TOKEN (android player)
          if (typeof yt !== 'undefined' && yt.config_ && yt.config_.PLAYER_PO_TOKEN) {
            return { token: yt.config_.PLAYER_PO_TOKEN, source: 'ytcfg.PLAYER_PO_TOKEN' };
          }
          // Strategy 3: ytInitialData or ytInitialPlayerResponse
          var responses = [
            window.ytInitialPlayerResponse,
            window.ytInitialData,
            window.__ytPlayerData
          ];
          for (var i = 0; i < responses.length; i++) {
            var resp = responses[i];
            if (!resp) continue;
            // Check streamingData for pot parameter in URL
            var formats = resp.streamingData ? resp.streamingData.adaptiveFormats : [];
            for (var j = 0; j < formats.length; j++) {
              var url = formats[j].url || formats[j].signatureCipher || '';
              var match = url.match(/[?&]pot=([^&]+)/);
              if (match && match[1]) {
                return { token: decodeURIComponent(match[1]), source: 'streamingData.pot_param' };
              }
            }
            // Check for poToken in any nested object
            var str = JSON.stringify(resp);
            var potMatch = str.match(/[?&]pot=([^&"']+)/);
            if (potMatch && potMatch[1]) {
              return { token: decodeURIComponent(potMatch[1]), source: 'string.pot_param' };
            }
          }
          // Strategy 4: Try player response from any iframe
          if (typeof window.ytplayer !== 'undefined' && window.ytplayer.config) {
            var cfg = window.ytplayer.config;
            if (cfg.args && cfg.args.po_token) return { token: cfg.args.po_token, source: 'ytplayer.args.po_token' };
            if (cfg.args && cfg.args.player_response) {
              try {
                var pr = JSON.parse(cfg.args.player_response);
                var formats2 = pr.streamingData ? pr.streamingData.adaptiveFormats : [];
                for (var k = 0; k < formats2.length; k++) {
                  var url2 = formats2[k].url || '';
                  var m2 = url2.match(/[?&]pot=([^&]+)/);
                  if (m2 && m2[1]) return { token: decodeURIComponent(m2[1]), source: 'player_response.pot' };
                }
              } catch(e) {}
            }
          }
          // Strategy 5: __ytPlayerData
          if (typeof window.__ytPlayerData !== 'undefined' && window.__ytPlayerData.po_token) {
            return { token: window.__ytPlayerData.po_token, source: '__ytPlayerData' };
          }
          return null;
        } catch(e) {
          return { error: e.toString() };
        }
      })()
    `

    const result = await client.send<{ token?: string; source?: string; error?: string }>('Runtime.evaluate', {
      expression: script,
      returnByValue: true,
      awaitPromise: false,
    })

    await client.dispose()

    if (result && result.token) {
      devLog(`[PoToken] Extracted PO Token from ${targetSource} (${target.title.slice(0, 30)}) — source: ${result.source || 'unknown'}`)
      return result.token
    }

    return null
  } catch (e) {
    devLog(`[PoToken] navigateAndExtractPoToken error: ${e} — ${String(e).slice(0, 100)}`)
    try { await client.dispose() } catch {}
    return null
  }
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
 * Sessions that have YouTube tabs open will get tokens; others will get null.
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
