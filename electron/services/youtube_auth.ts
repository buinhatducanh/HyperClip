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
const TOKEN_FILE = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_tokens.json')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OAuthTokens {
  access_token: string
  refresh_token: string
  expires_at: number  // Unix ms timestamp
  token_type: string
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
  try {
    if (fs.existsSync(getTokenFile())) {
      return JSON.parse(fs.readFileSync(getTokenFile(), 'utf-8'))
    }
  } catch {}
  return null
}

export function saveTokens(tokens: OAuthTokens): void {
  fs.writeFileSync(getTokenFile(), JSON.stringify(tokens, null, 2), 'utf-8')
}

export function clearTokens(): void {
  try { if (fs.existsSync(getTokenFile())) fs.unlinkSync(getTokenFile()) } catch {}
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
        try {
          const json = JSON.parse(data)
          if (json.error) {
            reject(new Error(json.error_description || json.error))
            return
          }
          resolve({
            access_token: json.access_token,
            refresh_token: json.refresh_token || '',
            expires_at: Date.now() + json.expires_in * 1000,
            token_type: json.token_type,
          })
        } catch (e) {
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

export function refreshAccessToken(clientId: string, refreshToken: string): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString()

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

// ─── Get Valid Access Token ───────────────────────────────────────────────────

export async function getValidAccessToken(clientId: string): Promise<string | null> {
  const tokens = loadTokens()
  if (!tokens?.access_token) return null

  // Refresh if expired (with 60s buffer)
  if (tokens.expires_at - 60000 < Date.now()) {
    try {
      const newTokens = await refreshAccessToken(clientId, tokens.refresh_token)
      saveTokens(newTokens)
      return newTokens.access_token
    } catch (e) {
      console.warn('[OAuth] Token refresh failed:', e)
      clearTokens()
      return null
    }
  }

  return tokens.access_token
}

// ─── OAuth Flow Handler ────────────────────────────────────────────────────────

export interface OAuthResult {
  success: boolean
  error?: string
  tokens?: OAuthTokens
}

/**
 * Start OAuth 2.0 flow. Opens system browser, waits for callback, returns tokens.
 */
export async function startOAuthFlow(clientId: string): Promise<OAuthResult> {
  return new Promise((resolve) => {
    let server: http.Server | null = null
    let resolved = false

    const cleanup = () => {
      if (server) {
        server.close()
        server = null
      }
    }

    const finish = (result: OAuthResult) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(result)
    }

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      finish({ success: false, error: 'OAuth timeout (5 minutes)' })
    }, 5 * 60 * 1000)

    server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${OAUTH_PORT}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#FF4444">OAuth Error</h2><p style="color:#aaa">Authentication was cancelled. You can close this tab.</p></div></html>')
        finish({ success: false, error: error })
        return
      }

      if (!code) {
        res.writeHead(400)
        res.end('Missing code')
        return
      }

      // Got the code — exchange for tokens
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#00FF88">HyperClip</h2><p style="color:#aaa">Authentication successful! You can close this tab and return to HyperClip.</p></div></html>')

      clearTimeout(timeout)

      const clientSecret = getOAuthClientSecret()
      exchangeCodeForTokens(clientId, clientSecret, code)
        .then((tokens) => {
          saveTokens(tokens)
          console.log('[OAuth] Tokens saved — access token expires in', Math.round((tokens.expires_at - Date.now()) / 60000), 'minutes')
          finish({ success: true, tokens })
        })
        .catch((e) => {
          console.warn('[OAuth] Token exchange failed:', e)
          finish({ success: false, error: (e as Error).message })
        })
    })

    server.on('error', (e) => {
      console.warn('[OAuth] Server error:', e)
      finish({ success: false, error: (e as Error).message })
    })

    server.listen(OAUTH_PORT, '127.0.0.1', () => {
      const oauthUrl = buildOAuthUrl(clientId)
      console.log('[OAuth] Starting OAuth flow — opening browser')
      shell.openExternal(oauthUrl).catch((e) => {
        console.warn('[OAuth] Failed to open browser:', e)
        finish({ success: false, error: 'Failed to open browser' })
      })
    })
  })
}

// ─── YouTube Data API v3 ────────────────────────────────────────────────────────

export interface YouTubeChannel {
  channelId: string
  title: string
  thumbnail: string
}

export interface YouTubeVideo {
  videoId: string
  channelId: string
  title: string
  publishedAt: string
}

/**
 * Fetch user's YouTube subscriptions using OAuth tokens.
 */
export async function fetchSubscriptions(accessToken: string): Promise<YouTubeChannel[]> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.googleapis.com',
      path: '/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50&order=alphabetical',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) {
            console.warn('[YouTubeAPI] fetchSubscriptions error:', json.error.message)
            resolve([])
            return
          }
          const channels: YouTubeChannel[] = (json.items || []).map((item: any) => ({
            channelId: item.snippet.resourceId.channelId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails?.default?.url || '',
          }))
          resolve(channels)
        } catch (e) {
          console.warn('[YouTubeAPI] fetchSubscriptions parse error:', e)
          resolve([])
        }
      })
    })
    req.on('error', () => resolve([]))
    req.end()
  })
}

/**
 * Fetch recent uploads from a specific channel using OAuth tokens.
 */
export async function fetchRecentUploads(accessToken: string, channelId: string, sinceMs: number): Promise<YouTubeVideo[]> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.googleapis.com',
      path: `/youtube/v3/activities?part=snippet,contentDetails&channelId=${channelId}&maxResults=5&publishedAfter=${new Date(sinceMs).toISOString()}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) {
            resolve([])
            return
          }
          const videos: YouTubeVideo[] = (json.items || [])
            .filter((item: any) => {
              const kind = item.contentDetails?.upload?.videoId
              return kind && item.snippet?.publishedAt
            })
            .map((item: any) => ({
              videoId: item.contentDetails.upload.videoId,
              channelId: item.snippet.resourceId?.channelId || channelId,
              title: item.snippet.title,
              publishedAt: item.snippet.publishedAt,
            }))
          resolve(videos)
        } catch {
          resolve([])
        }
      })
    })
    req.on('error', () => resolve([]))
    req.end()
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
