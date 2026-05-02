/**
 * Token Manager — HyperClip
 *
 * Manages multiple OAuth tokens from different Google Cloud projects.
 * Each project = 1 OAuth client + 1 API key = 10,000 units/day.
 *
 * Rotation: picks the token with the most remaining quota (least used today).
 * Persists tokens to oauth_tokens.json, stats to token_stats.json.
 */

import path from 'path'
import fs from 'fs'
import os from 'os'
import https from 'https'

// Direct fallback helpers that don't depend on token_manager state
function _getDefaultClientId(): string {
  // Try oauth_tokens.json first (credentials embedded per token entry)
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'))
      const tokens = Array.isArray(raw) ? raw : (raw?.access_token ? [raw] : [])
      for (const t of tokens) {
        if ((t as any).clientId) return (t as any).clientId
      }
    }
  } catch {}
  // Fall back to oauth_config.json
  const configFile = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
  try {
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      if (typeof config === 'object') {
        if (config.client_id) return config.client_id
        for (const pid of ['proj-01', 'proj-02', 'proj-03', 'proj-04']) {
          if (config[pid]?.clientId) return config[pid].clientId
        }
      }
    }
  } catch {}
  return ''
}

function _getDefaultClientSecret(): string {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'))
      const tokens = Array.isArray(raw) ? raw : (raw?.access_token ? [raw] : [])
      for (const t of tokens) {
        if ((t as any).clientSecret) return (t as any).clientSecret
      }
    }
  } catch {}
  const configFile = path.join(os.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
  try {
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      if (typeof config === 'object') {
        if (config.client_secret) return config.client_secret
        for (const pid of ['proj-01', 'proj-02', 'proj-03', 'proj-04']) {
          if (config[pid]?.clientSecret) return config[pid].clientSecret
        }
      }
    }
  } catch {}
  return ''
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface OAuthTokenSet {
  projectId: string
  clientId: string
  clientSecret: string
  access_token: string
  refresh_token: string
  expires_at: number
  token_type: string
}

interface TokenStats {
  usedToday: number
  errors: number
  lastUsed: number
}

export interface TokenStatus {
  projectId: string
  clientId: string
  hasToken: boolean
  tokenExpiry: number | null
  usedToday: number
  quotaTotal: number
  quotaPercent: number
  errors: number
  status: 'healthy' | 'warning' | 'error' | 'exhausted' | 'unauthorized'
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKENS_DIR = path.join(os.tmpdir(), 'hyperclip-cookies')
const TOKENS_FILE = path.join(TOKENS_DIR, 'oauth_tokens.json')
const STATS_FILE = path.join(os.homedir(), 'AppData', 'Roaming', 'HyperClip', 'token_stats.json')
const MAX_UNITS_PER_TOKEN = 9500
const MAX_ERRORS = 3

// ─── Token Manager ──────────────────────────────────────────────────────────

class TokenManager {
  private _tokens: OAuthTokenSet[] = []
  private _stats: Map<string, TokenStats> = new Map()
  private _lastReset: number = Date.now()
  private _lastResetPTDate: string = ''  // tracks PT date for midnight-PT reset
  private _initialized: boolean = false
  private _refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this._loadTokens()
    this._loadStats()
    this._checkReset()
    this._initialized = true
    // Proactive refresh: check every 30 min + once at startup (after tokens loaded)
    this._refreshTimer = setInterval(() => { this._proactiveRefresh() }, 30 * 60 * 1000)
    setTimeout(() => { this._proactiveRefresh() }, 5000)
  }

  // ── Load / Persist ────────────────────────────────────────────────────────

  private _ensureDir(): void {
    if (!fs.existsSync(TOKENS_DIR)) {
      fs.mkdirSync(TOKENS_DIR, { recursive: true })
    }
  }

  private _loadTokens(): void {
    // Use direct helpers that read from oauth_tokens.json first, avoiding circular import
    const defaultClientId = _getDefaultClientId()
    const defaultClientSecret = _getDefaultClientSecret()
    try {
      if (fs.existsSync(TOKENS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'))
        console.log(`[TokenManager] _loadTokens: file has ${Array.isArray(raw) ? raw.length + ' tokens' : '1 legacy token (object format)'}, first entry: ${Array.isArray(raw) ? (raw[0]?.projectId || 'none') : raw?.projectId || 'none'}`)

        // Multi-project format: array of OAuthTokenSet
        if (Array.isArray(raw)) {
          this._tokens = raw
          // Fill in credentials for tokens that don't have them (legacy migration)
          let migrated = false
          for (const t of this._tokens) {
            if (!t.clientId || !t.clientSecret) {
              t.clientId = defaultClientId
              t.clientSecret = defaultClientSecret
              migrated = true
            }
          }
          if (migrated) {
            console.log('[TokenManager] Migrated legacy tokens — filled default credentials')
            this._saveTokens()
          }
        }
        // Legacy single-token format: convert to multi-project array
        else if (raw && typeof raw === 'object' && raw.access_token) {
          console.log('[TokenManager] Converting legacy single-token format to multi-project array')
          const legacy: OAuthTokenSet = {
            projectId: raw.projectId || 'proj-01',
            clientId: defaultClientId,
            clientSecret: defaultClientSecret,
            access_token: raw.access_token,
            refresh_token: raw.refresh_token || '',
            expires_at: raw.expires_at || Date.now() + 3600 * 1000,
            token_type: raw.token_type || 'Bearer',
          }
          this._tokens = [legacy]
          // Save in new format with credentials
          this._saveTokens()
        } else {
          this._tokens = []
        }
      }
    } catch (e) {
      console.warn('[TokenManager] Failed to load tokens:', e)
      this._tokens = []
    }
    if (this._tokens.length === 0) {
      console.log('[TokenManager] No tokens configured — add OAuth credentials in Settings')
    } else {
      console.log(`[TokenManager] Loaded ${this._tokens.length} tokens`)
    }
  }

  private _loadStats(): void {
    try {
      if (fs.existsSync(STATS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'))
        this._stats = new Map(Object.entries(raw.stats || {}))
        this._lastReset = raw.lastReset || Date.now()
        this._lastResetPTDate = raw.lastResetPTDate || ''
      }
    } catch {}
  }

  private _saveTokens(): void {
    this._ensureDir()
    try {
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(this._tokens, null, 2), 'utf-8')
    } catch (e) {
      console.error('[TokenManager] Failed to persist tokens:', e)
    }
  }

  private _saveStats(): void {
    try {
      const obj: Record<string, TokenStats> = {}
      for (const [k, v] of this._stats) obj[k] = v
      const dir = path.dirname(STATS_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(STATS_FILE, JSON.stringify({ stats: obj, lastReset: this._lastReset, lastResetPTDate: this._lastResetPTDate }, null, 2), 'utf-8')
    } catch (e) {
      console.error('[TokenManager] Failed to persist stats:', e)
    }
  }

  /**
   * Check if we need to reset daily stats.
   * Resets at midnight PT (Pacific Time), aligned with Google's quota reset.
   * Uses UTC + DST offset to compute PT without external timezone APIs.
   */
  private _checkReset(): void {
    const now = new Date()
    const utcHour = now.getUTCHours()

    // PT is UTC-7 (PDT, summer) or UTC-8 (PST, winter)
    // DST: second Sunday in March → first Sunday in November
    const utcYear = now.getUTCFullYear()
    const march1 = new Date(Date.UTC(utcYear, 2, 1))
    const firstSundayMarch = new Date(Date.UTC(utcYear, 2, march1.getUTCDay() === 0 ? 1 : 8 - march1.getUTCDay()))
    const dstStart = new Date(Date.UTC(utcYear, 2, firstSundayMarch.getUTCDate()))
    const nov1 = new Date(Date.UTC(utcYear, 10, 1))
    const firstSundayNov = new Date(Date.UTC(utcYear, 10, nov1.getUTCDay() === 0 ? 1 : 8 - nov1.getUTCDay()))
    const dstEnd = new Date(Date.UTC(utcYear, 10, firstSundayNov.getUTCDate()))

    const isPDT = now >= dstStart && now < dstEnd
    const ptOffsetHours = isPDT ? -7 : -8
    const ptHour = utcHour + ptOffsetHours

    const ptDateStr = ptHour >= 0
      ? `${utcYear}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
      : `${utcYear}-${String(new Date(now.getTime() - 86400000).getUTCMonth() + 1).padStart(2, '0')}-${String(new Date(now.getTime() - 86400000).getUTCDate()).padStart(2, '0')}`

    if (this._lastResetPTDate !== ptDateStr) {
      this._stats.clear()
      this._lastReset = Date.now()
      this._lastResetPTDate = ptDateStr
      this._saveStats()
      console.log(`[TokenManager] Daily reset at midnight PT (${ptDateStr}) — all token quotas refreshed`)
    }
  }

  /**
   * Proactively refresh tokens expiring within 30 minutes.
   * Runs at startup (5s delay) and every 30 minutes.
   * Logs each refresh result — warns if ALL tokens fail.
   */
  private async _proactiveRefresh(): Promise<void> {
    if (this._tokens.length === 0) return

    const now = Date.now()
    const EXPIRY_THRESHOLD_MS = 30 * 60 * 1000 // 30 min

    const expiring = this._tokens.filter(t => t.expires_at - now < EXPIRY_THRESHOLD_MS)
    if (expiring.length === 0) return

    console.log(`[TokenManager] Proactive refresh: ${expiring.length}/${this._tokens.length} tokens expiring soon`)

    const results = await Promise.allSettled(
      expiring.map(async (t) => {
        const refreshed = await this.refreshToken(t)
        if (!refreshed) {
          this.recordError(t.projectId)
          // If token is permanently bad (too many errors), remove it
          const s = this._stats.get(t.projectId)
          if (s && s.errors >= MAX_ERRORS) {
            this.removeToken(t.projectId)
            console.warn(`[TokenManager] Token ${t.projectId} permanently removed after ${MAX_ERRORS} refresh failures`)
          }
          return null
        }
        const idx = this._tokens.findIndex(x => x.projectId === t.projectId)
        if (idx !== -1) this._tokens[idx] = refreshed
        this._saveTokens()
        console.log(`[TokenManager] Proactive refresh OK: ${t.projectId} (expires ${new Date(refreshed.expires_at).toISOString()})`)
        return refreshed
      })
    )

    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === null))
    if (failed.length > 0) {
      console.warn(`[TokenManager] Proactive refresh: ${failed.length} token(s) failed — will retry on next poll`)
    }
  }

  // ── Token Refresh ─────────────────────────────────────────────────────────

  async refreshToken(tokenSet: OAuthTokenSet): Promise<OAuthTokenSet | null> {
    // Guard: if credentials are empty, this is a broken legacy token — don't waste a refresh call
    if (!tokenSet.clientId || !tokenSet.clientSecret) {
      console.warn(`[TokenManager] Token for ${tokenSet.projectId} has no credentials — marking for re-auth`)
      return null
    }
    return new Promise((resolve) => {
      const body = new URLSearchParams({
        client_id: tokenSet.clientId,
        client_secret: tokenSet.clientSecret,
        refresh_token: tokenSet.refresh_token,
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

      const req = https.request(options, (res: any) => {
        let data = ''
        res.on('data', (c: string) => { data += c })
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            if (json.error) throw new Error(json.error_description || json.error)
            const refreshed: OAuthTokenSet = {
              ...tokenSet,
              access_token: json.access_token,
              refresh_token: json.refresh_token || tokenSet.refresh_token,
              expires_at: Date.now() + (json.expires_in || 3600) * 1000,
              token_type: json.token_type || 'Bearer',
            }
            resolve(refreshed)
          } catch (e) {
            console.error(`[TokenManager] Token refresh failed for ${tokenSet.projectId}:`, e)
            resolve(null) // null = refresh failed, caller should re-auth
          }
        })
      })
      req.on('error', (e: Error) => {
        console.error(`[TokenManager] Token refresh error for ${tokenSet.projectId}:`, e)
        resolve(null)
      })
      req.write(body)
      req.end()
    })
  }

  // ── Smart Rotation ────────────────────────────────────────────────────────

  /**
   * Get the best available token — least-used today, skip exhausted or errored.
   * Returns token + projectId for pairing with API key.
   */
  async getBestAvailable(): Promise<{ token: string; projectId: string; clientId: string; clientSecret: string } | null> {
    this._checkReset()

    if (this._tokens.length === 0) {
      console.warn('[TokenManager] getBestAvailable: NO tokens in _tokens — returning null')
      return null
    }

    // Filter candidates
    const candidates = this._tokens.filter(t => {
      const s = this._stats.get(t.projectId)
      if (!s) return true
      return s.usedToday < MAX_UNITS_PER_TOKEN && s.errors < MAX_ERRORS
    })

    if (candidates.length === 0) {
      console.warn('[TokenManager] getBestAvailable: All tokens filtered out — returning null')
      return null
    }

    // Sort by remaining quota (most remaining = least used)
    candidates.sort((a, b) => {
      const sa = this._stats.get(a.projectId)?.usedToday ?? 0
      const sb = this._stats.get(b.projectId)?.usedToday ?? 0
      return sa - sb
    })

    const chosen = candidates[0]

    // Check expiry — refresh if needed (5 min buffer)
    const now = Date.now()
    if (chosen.expires_at - 5 * 60 * 1000 < now) {
      const expiresIn = Math.round((chosen.expires_at - now) / 60000)
      console.log(`[TokenManager] Token for ${chosen.projectId} expired (or expiring in ${expiresIn}min), refreshing...`)
      try {
        const refreshed = await this.refreshToken(chosen)
        // null = refresh failed (bad credentials or token revoked) — mark for re-auth
        if (!refreshed) {
          console.warn(`[TokenManager] Refresh returned null for ${chosen.projectId} — removing token and trying next`)
          this.removeToken(chosen.projectId)
          // Try next available token instead
          return this.getBestAvailable()
        }
        const idx = this._tokens.findIndex(t => t.projectId === chosen.projectId)
        if (idx !== -1) this._tokens[idx] = refreshed
        this._saveTokens()
        console.log(`[TokenManager] Token refreshed for ${chosen.projectId} (expires ${new Date(refreshed.expires_at).toISOString()})`)
        return {
          token: refreshed.access_token,
          projectId: refreshed.projectId,
          clientId: refreshed.clientId,
          clientSecret: refreshed.clientSecret,
        }
      } catch (e) {
        console.error(`[TokenManager] Refresh failed for ${chosen.projectId}:`, e)
        return null
      }
    }

    return {
      token: chosen.access_token,
      projectId: chosen.projectId,
      clientId: chosen.clientId,
      clientSecret: chosen.clientSecret,
    }
  }

  /** Track 1 unit consumed by a project */
  track(projectId: string): void {
    const s = this._stats.get(projectId) || { usedToday: 0, errors: 0, lastUsed: 0 }
    s.usedToday++
    s.lastUsed = Date.now()
    this._stats.set(projectId, s)
    this._saveStats()
  }

  /** Record an error for a project — increments error count without consuming quota units */
  recordError(projectId: string): void {
    const s = this._stats.get(projectId) || { usedToday: 0, errors: 0, lastUsed: 0 }
    s.errors++
    this._stats.set(projectId, s)
    this._saveStats()
    console.warn(`[TokenManager] Error on ${projectId} — errors: ${s.errors}`)
  }

  /** Track an API error (e.g., 403 quota exceeded) — increments usedToday to push exhausted tokens out of rotation */
  trackError(projectId: string): void {
    const s = this._stats.get(projectId) || { usedToday: 0, errors: 0, lastUsed: 0 }
    // Add 100 units to simulate quota hit — pushes exhausted tokens above MAX_UNITS_PER_KEY threshold
    // This ensures getBestAvailable() skips them even without an actual quota error from the API
    const QUOTA_HIT_UNITS = 100
    s.usedToday += QUOTA_HIT_UNITS
    s.errors++
    s.lastUsed = Date.now()
    this._stats.set(projectId, s)
    this._saveStats()
    console.warn(`[TokenManager] trackError(${projectId}): +${QUOTA_HIT_UNITS} units, errors: ${s.errors} → usedToday: ${s.usedToday}`)
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  addToken(projectId: string, clientId: string, clientSecret: string, tokens: { access_token: string; refresh_token: string; expires_at: number; token_type: string }): void {
    const idx = this._tokens.findIndex(t => t.projectId === projectId)
    const entry: OAuthTokenSet = { projectId, clientId, clientSecret, ...tokens }
    if (idx !== -1) {
      this._tokens[idx] = entry
    } else {
      this._tokens.push(entry)
    }
    this._saveTokens()
    console.log(`[TokenManager] Token added/updated for ${projectId}`)
  }

  getToken(projectId: string): OAuthTokenSet | null {
    return this._tokens.find(t => t.projectId === projectId) || null
  }

  removeToken(projectId: string): void {
    this._tokens = this._tokens.filter(t => t.projectId !== projectId)
    this._stats.delete(projectId)
    this._saveTokens()
    this._saveStats()
    console.log(`[TokenManager] Token removed for ${projectId}`)
  }

  /** Reload tokens from disk. Call after external code writes tokens (e.g., OAuth flow). */
  reload(): void {
    this._loadTokens()
    this._loadStats()
  }

  resetAll(): void {
    this._stats.clear()
    this._lastReset = Date.now()
    this._saveStats()
    console.log('[TokenManager] Reset all token quotas')
  }

  /** Stop background timer — call on app quit */
  dispose(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer)
      this._refreshTimer = null
    }
  }

  getTokenCount(): number {
    return this._tokens.length
  }

  /** Get status for all tokens (for Settings UI) */
  getAllStatuses(): TokenStatus[] {
    return this._tokens.map(t => {
      const s = this._stats.get(t.projectId)
      const usedToday = s?.usedToday ?? 0
      const errors = s?.errors ?? 0
      const quotaPercent = Math.round((usedToday / MAX_UNITS_PER_TOKEN) * 100)

      let status: TokenStatus['status'] = 'healthy'
      if (usedToday >= MAX_UNITS_PER_TOKEN || errors >= MAX_ERRORS) status = 'exhausted'
      else if (quotaPercent >= 80) status = 'warning'
      else if (errors > 0) status = 'error'

      return {
        projectId: t.projectId,
        clientId: t.clientId,
        hasToken: !!t.access_token,
        tokenExpiry: t.expires_at,
        usedToday,
        quotaTotal: MAX_UNITS_PER_TOKEN,
        quotaPercent: Math.min(100, quotaPercent),
        errors,
        status,
      }
    })
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: TokenManager | null = null

export function getTokenManager(): TokenManager {
  if (!_instance) _instance = new TokenManager()
  return _instance
}

export { TokenManager }
