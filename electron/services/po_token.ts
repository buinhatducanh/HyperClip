/**
 * PO Token Extractor — HyperClip
 *
 * Extracts Playback Origin (PO) Tokens from Chrome browser sessions via CDP.
 * PO Token is required for YouTube android client to access formats >360p.
 *
 * Android client streams use H.264 codec (better for editing than VP9 from web client).
 * Without PO Token, android client only returns 360p.
 *
 * The PO Token is bound to the client type ("ANDROID") and the session cookies.
 * We extract it by evaluating JavaScript in the Chrome tab that already has YouTube loaded.
 */

import WebSocket from 'ws'
import http from 'http'

// ─── CDP Connection ───────────────────────────────────────────────────────────

interface CDPTarget {
  id: string
  webSocketDebuggerUrl: string
  url: string
  title: string
}

async function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve(body))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function getCDPTarget(port: number): Promise<CDPTarget | null> {
  try {
    const json = await httpGet(`http://localhost:${port}/json`)
    const tabs: CDPTarget[] = JSON.parse(json)
    // Prefer YouTube tab
    const ytTab = tabs.find(t => t.url?.includes('youtube.com'))
    if (ytTab) return ytTab
    return tabs[0] || null
  } catch {
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

function getCDPPort(profileId: string): number {
  const idx = parseInt(profileId, 10)
  return 9222 + (isNaN(idx) ? 0 : idx)
}

// ─── PO Token Extraction ──────────────────────────────────────────────────────

/**
 * Extract PO Token from a Chrome profile via CDP.
 *
 * Attempts multiple strategies:
 * 1. Evaluate ytcfg for web player PO Token
 * 2. Evaluate android-specific PO Token from player config
 * 3. Fall back to null (will use web client instead)
 */
async function extractPoTokenFromProfile(profileId: string): Promise<string | null> {
  const port = getCDPPort(profileId)
  const target = await getCDPTarget(port)
  if (!target) return null

  const client = new CDPClient()
  try {
    await client.connect(target.webSocketDebuggerUrl)

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
      console.log(`[PoToken] Extracted PO Token from ${profileId} (${target.title.slice(0, 30)}) — source: ${result.source || 'unknown'}`)
      return result.token
    }

    return null
  } catch (e) {
    try { await client.dispose() } catch {}
    return null
  }
}

// ─── PO Token Cache ───────────────────────────────────────────────────────────

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
    console.log(`[PoToken] Real-time extraction failed for profile ${profileId}, using stale cache (${Math.round((PO_TOKEN_TTL_MS - (Date.now() - cached.fetchedAt)) / 1000)}s remaining)`)
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
 */
export async function warmupPoTokenCache(profileIds: string[]): Promise<void> {
  console.log(`[PoToken] Warming up PO Token cache for ${profileIds.length} profiles...`)
  await Promise.all(profileIds.map(async (pid) => {
    try {
      await getPoTokenForProfile(pid)
    } catch {}
  }))

  const withToken = profileIds.filter(pid => _tokenCache.has(pid)).length
  console.log(`[PoToken] Cache warmed: ${withToken}/${profileIds.length} profiles have PO Tokens`)
}

// ─── Innertube Integration ───────────────────────────────────────────────────

/**
 * For Innertube detection, we use the web client which doesn't need PO Token.
 * But if we want to also support android client in Innertube, we need to
 * generate the PO Token using BotGuard. The youtubei.js library handles
 * this internally if we pass the po_token option.
 *
 * The youtubei.js BotGuard approach:
 * 1. Fetch the android player JavaScript from YouTube
 * 2. Execute the BotGuard program with visitor_data + video_id
 * 3. Get the generated po_token
 *
 * Since this is complex, we use CDP as a simpler alternative.
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
