/**
 * YouTube OAuth 2.0 Authentication — HyperClip
 *
 * Uses Google OAuth 2.0 to authenticate with YouTube Data API v3.
 * This bypasses Google's Electron detection entirely because auth
 * happens in the user's real browser.
 *
 * SETUP: User needs to create a Google Cloud project and get credentials.
 * Instructions are in the UI when OAuth setup is needed.
 */

import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { shell } from 'electron'

// ─── Constants ────────────────────────────────────────────────────────────────

const OAUTH_PORT = 8765
const OAUTH_PORT_MAX = 8775 // range of ports to try if primary is in use
const TOKEN_FILE = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_tokens.json')

// Active OAuth server — closed before starting a new flow to prevent EADDRINUSE
let _activeServer: http.Server | null = null

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OAuthTokens {
  access_token: string
  refresh_token: string
  expires_at: number  // Unix ms timestamp
  token_type: string
  clientId?: string   // saved for token refresh
  clientSecret?: string
  projectId?: string  // project this token belongs to (for multi-project key-token pairing)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRedirectUri(): string {
  return `http://localhost:${OAUTH_PORT}/callback`
}

function getTokenFile(): string {
  const dir = path.join(os.tmpdir(), 'hyperclip-cookies')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return TOKEN_FILE
}

// Default Client ID — embedded for 1-click OAuth (no setup needed)
// Google shows "unverified app" warning but user can still approve
const DEFAULT_CLIENT_ID = 'REMOVED_CLIENT_ID'

export function getOAuthClientId(): string {
  // Read from config file first (user can override)
  const configFile = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
  try {
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      if (config.client_id) return config.client_id
    }
  } catch {}
  // Fall back to embedded default
  return DEFAULT_CLIENT_ID
}

export function getOAuthClientSecret(): string {
  // Read from config file — user must provide client_secret for token exchange
  const configFile = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
  try {
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      if (config.client_secret) return config.client_secret
    }
  } catch {}
  return ''
}

export function setOAuthClientId(clientId: string): void {
  const configFile = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
  const dir = path.dirname(configFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const existing: Record<string, string> = {}
  try {
    if (fs.existsSync(configFile)) {
      Object.assign(existing, JSON.parse(fs.readFileSync(configFile, 'utf-8')))
    }
  } catch {}
  existing.client_id = clientId
  fs.writeFileSync(configFile, JSON.stringify(existing, null, 2), 'utf-8')
}

// ─── Token Storage ─────────────────────────────────────────────────────────────

export function loadTokens(): OAuthTokens | null {
  const file = getTokenFile()
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      console.log('[OAuth] Tokens loaded from:', file)
      // Legacy single-token format (object) — return as-is
      if (!Array.isArray(data)) return data
      // Multi-project array: return first valid token (legacy compat)
      const first = Array.isArray(data) ? data.find((t: OAuthTokens) => t.access_token) : null
      return first || null
    }
  } catch (e) {
    console.warn('[OAuth] Failed to load tokens from', file, ':', e)
  }
  console.log('[OAuth] No tokens found at:', file)
  return null
}

export function saveTokens(tokens: OAuthTokens, clientId?: string, clientSecret?: string, projectId?: string): void {
  const file = getTokenFile()
  const resolvedProjectId = projectId || tokens.projectId || 'proj-01'

  try {
    // Always use multi-project array format. Read existing tokens, merge, write back.
    // This prevents overwriting all tokens when startOAuthFlow is called without projectId.
    let existingTokens: Array<OAuthTokens & { clientId?: string; clientSecret?: string; projectId?: string }> = []
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
        if (Array.isArray(raw)) {
          existingTokens = raw
        } else if (raw && typeof raw === 'object' && raw.access_token) {
          // Legacy single-token format — migrate to array
          existingTokens = [raw as OAuthTokens]
        }
      } catch {}
    }

    const entry = {
      ...tokens,
      clientId: clientId || tokens.clientId,
      clientSecret: clientSecret || tokens.clientSecret,
      projectId: resolvedProjectId,
    }

    const idx = existingTokens.findIndex(t => (t.projectId || 'proj-01') === resolvedProjectId)
    if (idx !== -1) {
      existingTokens[idx] = entry
    } else {
      existingTokens.push(entry)
    }

    fs.writeFileSync(file, JSON.stringify(existingTokens, null, 2), 'utf-8')
    console.log('[OAuth] Tokens saved to:', file, '— expires at:', new Date(tokens.expires_at).toISOString(), ` (project: ${resolvedProjectId})`)
  } catch (e) {
    console.error('[OAuth] FAILED to save tokens to', file, ':', e)
    throw e
  }
}

export function clearTokens(): void {
  try { if (fs.existsSync(getTokenFile())) fs.unlinkSync(getTokenFile()) } catch {}
  _cachedToken = null
}

// ─── OAuth URL Builder ─────────────────────────────────────────────────────────

export function buildOAuthUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

// ─── Token Exchange ────────────────────────────────────────────────────────────

function exchangeCodeForTokens(clientId: string, clientSecret: string, code: string): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const bodyParams: Record<string, string> = {
      client_id: clientId,
      redirect_uri: getRedirectUri(),
      code,
      grant_type: 'authorization_code',
    }
    if (clientSecret) bodyParams['client_secret'] = clientSecret

    const body = new URLSearchParams(bodyParams).toString()

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        // Log the raw response for debugging
        console.log('[OAuth] Token exchange response status:', res.statusCode)
        if (data.length < 200) console.log('[OAuth] Token exchange response:', data)
        try {
          const json = JSON.parse(data)
          if (json.error) {
            console.error('[OAuth] Token exchange ERROR:', json.error, json.error_description)
            reject(new Error(json.error_description || json.error))
            return
          }
          if (!json.access_token) {
            console.error('[OAuth] Token exchange: no access_token in response')
            reject(new Error('No access_token in token response'))
            return
          }
          resolve({
            access_token: json.access_token,
            refresh_token: json.refresh_token || '',
            expires_at: Date.now() + (json.expires_in || 3600) * 1000,
            token_type: json.token_type || 'Bearer',
          })
        } catch (e) {
          console.error('[OAuth] Token exchange: failed to parse response:', data.slice(0, 500))
          reject(new Error('Failed to parse token response'))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

export function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const bodyParams: Record<string, string> = {
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }
    if (clientSecret) bodyParams['client_secret'] = clientSecret
    const body = new URLSearchParams(bodyParams).toString()

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) {
            reject(new Error(json.error_description || json.error))
            return
          }
          resolve({
            access_token: json.access_token,
            refresh_token: refreshToken, // keep old refresh token
            expires_at: Date.now() + (json.expires_in || 3600) * 1000,
            token_type: json.token_type,
          })
        } catch (e) {
          reject(new Error('Failed to parse refresh response'))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─── Get Valid Access Token (cached) ─────────────────────────────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null

export async function getValidAccessToken(clientId: string): Promise<string | null> {
  // Return cached token if still valid (with 60s buffer)
  if (_cachedToken && _cachedToken.expiresAt - 60000 > Date.now()) {
    console.log('[OAuth] Using cached token (expires in', Math.round((_cachedToken.expiresAt - Date.now()) / 60000), 'min)')
    return _cachedToken.token
  }

  const tokens = loadTokens()
  console.log('[OAuth] Tokens loaded:', tokens ? 'yes (expires ' + (tokens.expires_at ? new Date(tokens.expires_at).toISOString() : 'unknown') + ')' : 'NO')
  if (!tokens?.access_token) {
    console.warn('[OAuth] No access_token in loaded tokens')
    return null
  }

  // Refresh if expired (with 60s buffer)
  if (tokens.expires_at - 60000 < Date.now()) {
    console.log('[OAuth] Token expired, refreshing...')
    try {
      const clientSecret = getOAuthClientSecret()
      const newTokens = await refreshAccessToken(clientId, clientSecret, tokens.refresh_token)
      saveTokens(newTokens)
      _cachedToken = { token: newTokens.access_token, expiresAt: newTokens.expires_at }
      return newTokens.access_token
    } catch (e) {
      console.error('[OAuth] Token refresh FAILED:', e, '— clientSecret:', getOAuthClientSecret() ? 'SET' : 'EMPTY')
      clearTokens()
      _cachedToken = null
      return null
    }
  }

  _cachedToken = { token: tokens.access_token, expiresAt: tokens.expires_at }
  return tokens.access_token
}

// ─── OAuth Flow Handler ────────────────────────────────────────────────────────

export interface OAuthResult {
  success: boolean
  error?: string
  tokens?: OAuthTokens
  projectId?: string
}

/**
 * Start OAuth 2.0 flow. Opens system browser, waits for callback, returns tokens.
 * @param clientId OAuth Client ID
 * @param clientSecret OAuth Client Secret (optional — uses default if not provided)
 * @param projectId Project ID to store with token (for multi-project key-token pairing)
 */
export async function startOAuthFlow(clientId: string, clientSecret?: string, projectId?: string): Promise<OAuthResult> {
  // If no secret provided, read from config file (for backward compat with cookie_manager)
  const effectiveSecret = clientSecret || (() => {
    try {
      const configPath = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        return cfg.client_secret || ''
      }
    } catch {}
    return ''
  })()
  return new Promise((resolve) => {
    let server: http.Server | null = null
    let resolved = false
    let timeout: NodeJS.Timeout | undefined

    const cleanup = () => {
      if (server) {
        server.close()
        server = null
      }
      if (_activeServer === server) _activeServer = null
    }

    const finish = (result: OAuthResult) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(result)
    }

    // Close any existing OAuth server first to prevent EADDRINUSE
    const closeExisting = (): Promise<void> => {
      return new Promise((r) => {
        if (_activeServer) {
          _activeServer.close(() => { _activeServer = null; r() })
          // Force close if lingering
          setTimeout(() => { _activeServer = null; r() }, 500)
        } else {
          r()
        }
      })
    }

    const tryListen = (port: number) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://localhost:${port}`)
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#FF4444">OAuth Error</h2><p style="color:#aaa">Authentication was cancelled. You can close this tab.</p></div></html>')
          finish({ success: false, error: error })
          return
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif"><p>Missing code</p></html>')
          finish({ success: false, error: 'Missing code' })
          return
        }

        // Got the code — exchange for tokens (don't send HTML until we know result)
        clearTimeout(timeout!)

        exchangeCodeForTokens(clientId, effectiveSecret, code)
          .then((tokens) => {
            console.log('[OAuth] Token exchanged — expires in', Math.round((tokens.expires_at - Date.now()) / 60000), 'minutes', projectId ? ` (project: ${projectId})` : '')
            // Save to flat file for legacy compat (no projectId = single-project flow).
            // Per-project flows (with projectId) rely on TokenManager.addToken() from main.ts instead.
            if (!projectId) {
              saveTokens(tokens, clientId, effectiveSecret)
            }
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#00FF88">HyperClip</h2><p style="color:#aaa">Authentication successful! You can close this tab and return to HyperClip.</p></div></html>')
            finish({ success: true, tokens, projectId })
          })
          .catch((e) => {
            console.error('[OAuth] Token exchange FAILED:', e)
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px"><div style="text-align:center;max-width:480px"><h2 style="color:#FF4444">Token Exchange Failed</h2><p style="color:#FF8888;font-size:13px;word-break:break-all">${(e as Error).message}</p><p style="color:#555;font-size:12px;margin-top:20px">Close this tab. HyperClip will retry automatically.</p></div></html>`)
            finish({ success: false, error: (e as Error).message })
          })
      })

      server.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE' && port < OAUTH_PORT_MAX) {
          console.warn(`[OAuth] Port ${port} in use — retrying on ${port + 1}`)
          server!.close()
          tryListen(port + 1)
        } else {
          console.warn('[OAuth] Server error:', e)
          finish({ success: false, error: e.message })
        }
      })

      server.listen(port, '127.0.0.1', () => {
        const oauthUrl = buildOAuthUrl(clientId)
        console.log(`[OAuth] Starting OAuth flow on port ${port} — opening browser`)
        _activeServer = server
        shell.openExternal(oauthUrl).catch((e) => {
          console.warn('[OAuth] Failed to open browser:', e)
          finish({ success: false, error: 'Failed to open browser' })
        })
      })
    }

    closeExisting().then(() => {
      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        finish({ success: false, error: 'OAuth timeout (5 minutes)' })
      }, 5 * 60 * 1000)
      tryListen(OAUTH_PORT)
    })
  })
}


/**
 * Get account info from YouTube API.
 */
export async function fetchAccountInfo(accessToken: string): Promise<string | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.googleapis.com',
      path: '/youtube/v3/channels?part=snippet&mine=true',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error || !json.items?.length) {
            resolve(null)
            return
          }
          resolve(json.items[0].snippet.title)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.end()
  })
}

// ─── Subscription List Sync ─────────────────────────────────────────────────────

export interface SubscriptionItem {
  channelId: string
  channelName: string
  avatarUrl: string
}

/**
 * Fetch full subscription list from YouTube Data API v3.
 * Called periodically to keep the channel store in sync with the user's
 * real YouTube subscriptions (handles subscribe/unsubscribe on youtube.com).
 */
export async function fetchMySubscriptions(accessToken: string): Promise<SubscriptionItem[]> {
  const subscriptions: SubscriptionItem[] = []
  let nextPageToken: string | undefined = undefined

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      mine: 'true',
      maxResults: '50',
      order: 'alphabetical',
    })
    if (nextPageToken) params.set('pageToken', nextPageToken)

    const result = await new Promise<{ data: any; error?: string }>((resolve) => {
      const options = {
        hostname: 'www.googleapis.com',
        path: `/youtube/v3/subscriptions?${params.toString()}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          try { resolve({ data: JSON.parse(data) }) }
          catch { resolve({ data: {}, error: 'parse error' }) }
        })
      })
      req.on('error', (e) => resolve({ data: {}, error: e.message }))
      req.setTimeout(15000, () => { req.destroy(); resolve({ data: {}, error: 'timeout' }) })
      req.end()
    })

    if (result.error || result.data.error) break

    for (const item of result.data.items || []) {
      const snippet = item.snippet || {}
      const resource = snippet.resourceId || {}
      if (resource.channelId) {
        subscriptions.push({
          channelId: resource.channelId,
          channelName: snippet.title || 'Unknown',
          avatarUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
        })
      }
    }

    nextPageToken = result.data.nextPageToken
  } while (nextPageToken)

  return subscriptions
}
