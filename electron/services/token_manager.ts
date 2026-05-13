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
import { devLog } from './dev_log.js'
import { getAppStoreDir } from './paths.js'

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
  const configFile = path.join(getAppStoreDir(), 'oauth_config.json')
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
  const configFile = path.join(getAppStoreDir(), 'oauth_config.json')
  try {
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      if (typeof config === 'object') {
        // Try per-project credentials first (matching the projectId of stored tokens)
        for (const pid of ['proj-01', 'proj-02', 'proj-03', 'proj-04']) {
          if (config[pid]?.clientSecret) return config[pid].clientSecret
        }
        // Fall back to legacy single-project field
        if (config.client_secret) return config.client_secret
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
  status: 'healthy' | 'warning' | 'rate_limited' | 'error' | 'exhausted' | 'unauthorized' | 'no_oauth'
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKENS_DIR = getAppStoreDir()
const TOKENS_FILE = path.join(TOKENS_DIR, 'oauth_tokens.json')
const STATS_FILE = path.join(TOKENS_DIR, 'token_stats.json')
const MAX_UNITS_PER_TOKEN = 9500  // exhausted threshold: 9,500 units/day per project (500 buffer of 10,000)
// Note: successful calls (1 unit each) don't count toward this threshold.
// Exhausted threshold: 5 quota errors × 100 each = 500 units added to usedToday.
// But the actual exhaustion signal is `errors >= 5` (not usedToday >= MAX_UNITS_PER_TOKEN).
// This prevents reusing an already-exhausted token for subsequent batches.

// ─── Token Manager ──────────────────────────────────────────────────────────

class TokenManager {
  private _tokens: OAuthTokenSet[] = []
  private _stats: Map<string, TokenStats> = new Map()
  private _lastReset: number = Date.now()
  private _lastResetUTCDate: string = ''  // tracks UTC date for midnight-UTC reset
  private _initialized: boolean = false
  private _refreshTimer: ReturnType<typeof setInterval> | null = null
  private _unauthorizedTokens: Set<string> = new Set()
  private _resetCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this._loadTokens()
    this._loadStats()
    // Always check reset at startup (runs once per restart):
    // Use UTC date for reset — Google quota resets at midnight PT (08:00 UTC next day).
    // For Vietnam (UTC+7): 08:00 UTC = 15:00 local, same UTC day.
    // UTC date alignment ensures local midnight != Google reset doesn't cause stale stats.
    const now = new Date()
    // getDate() returns local day of month
    const todayUTCDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`

    const prevDate = this._lastResetUTCDate
    if (!prevDate || prevDate !== todayUTCDate) {
      this._stats.clear()
      this._unauthorizedTokens.clear()
      this._lastReset = Date.now()
      this._lastResetUTCDate = todayUTCDate
      // Persist cleared stats BEFORE _saveStats() gets overwritten by normal operation.
      // The _saveStats in the constructor saves empty stats. Subsequent track() / trackError()
      // calls will re-populate _stats and save normally.
      try {
        const obj: Record<string, TokenStats> = {}
        for (const [k, v] of this._stats) obj[k] = v
        const dir = path.dirname(STATS_FILE)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(STATS_FILE, JSON.stringify({
          stats: obj,
          lastReset: this._lastReset,
          lastResetUTCDate: this._lastResetUTCDate,
          unauthorizedTokens: [...this._unauthorizedTokens],
        }, null, 2), 'utf-8')
      } catch {}
      devLog(`[TokenManager] Quota reset (was:"${prevDate || '(none)'}", now:"${todayUTCDate}") — all quotas refreshed`)
    }
    this._initialized = true
    // Proactive refresh: check every 30 min + once at startup (after tokens loaded)
    this._refreshTimer = setInterval(() => { this._proactiveRefresh() }, 30 * 60 * 1000)
    setTimeout(() => { this._proactiveRefresh() }, 5000)

    // Periodic quota reset check: every 30 min (guards against midnight-PT logic failure)
    this._resetCheckTimer = setInterval(() => { this._checkReset() }, 30 * 60 * 1000)
  }

  // ── Load / Persist ────────────────────────────────────────────────────────

  private _ensureDir(): void {
    if (!fs.existsSync(TOKENS_DIR)) {
      fs.mkdirSync(TOKENS_DIR, { recursive: true })
    }
    // Migrate tokens from legacy temp directory (v1 storage)
    this._migrateFromLegacy()
  }

  private _migrateFromLegacy(): void {
    const legacyDir = path.join(os.tmpdir(), 'hyperclip-cookies')
    const legacyTokens = path.join(legacyDir, 'oauth_tokens.json')
    const legacyStats = path.join(legacyDir, 'oauth_stats.json')
    const legacyConfig = path.join(legacyDir, 'oauth_config.json')

    if (fs.existsSync(legacyTokens) && !fs.existsSync(TOKENS_FILE)) {
      try {
        fs.copyFileSync(legacyTokens, TOKENS_FILE)
        devLog('[TokenManager] Migrated oauth_tokens.json from legacy temp dir')
      } catch (e) {
        console.warn('[TokenManager] Failed to migrate legacy tokens:', e)
      }
    }
    if (fs.existsSync(legacyStats) && !fs.existsSync(STATS_FILE)) {
      try {
        fs.copyFileSync(legacyStats, STATS_FILE)
        devLog('[TokenManager] Migrated token_stats.json from legacy temp dir')
      } catch {}
    }
    if (fs.existsSync(legacyConfig)) {
      const migratedConfig = path.join(TOKENS_DIR, 'oauth_config.json')
      if (!fs.existsSync(migratedConfig)) {
        try {
          fs.copyFileSync(legacyConfig, migratedConfig)
          devLog('[TokenManager] Migrated oauth_config.json from legacy temp dir')
        } catch {}
      }
    }
  }

  private _loadTokens(): void {
    // Use direct helpers that read from oauth_tokens.json first, avoiding circular import
    const defaultClientId = _getDefaultClientId()
    const defaultClientSecret = _getDefaultClientSecret()
    try {
      if (fs.existsSync(TOKENS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'))
        devLog(`[TokenManager] _loadTokens: file has ${Array.isArray(raw) ? raw.length + ' tokens' : '1 legacy token (object format)'}, first entry: ${Array.isArray(raw) ? (raw[0]?.projectId || 'none') : raw?.projectId || 'none'}`)

        // Multi-project format: array of OAuthTokenSet
        if (Array.isArray(raw)) {
          this._tokens = raw
          // Sync credentials from oauth_config.json for all tokens.
          // Tokens may have stale clientId/clientSecret from older setup.
          const configFile = path.join(TOKENS_DIR, 'oauth_config.json')
          let configCreds: Record<string, { clientId: string; clientSecret: string }> = {}
          try {
            if (fs.existsSync(configFile)) {
              const cfg = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
              for (const [k, v] of Object.entries(cfg)) {
                if (k !== 'client_id' && k !== 'client_secret' && v && typeof v === 'object') {
                  const cred = v as { clientId: string; clientSecret: string }
                  if (cred.clientId && cred.clientSecret) {
                    configCreds[k] = { clientId: cred.clientId, clientSecret: cred.clientSecret }
                  }
                }
              }
            }
          } catch {}

          let migrated = false
          for (const t of this._tokens) {
            const cfgCred = configCreds[t.projectId]
            if (cfgCred) {
              // Override with config credentials (config is source of truth)
              if (t.clientId !== cfgCred.clientId || t.clientSecret !== cfgCred.clientSecret) {
                t.clientId = cfgCred.clientId
                t.clientSecret = cfgCred.clientSecret
                migrated = true
              }
            } else if (!t.clientId || !t.clientSecret) {
              // Fallback for tokens not in config
              t.clientId = defaultClientId
              t.clientSecret = defaultClientSecret
              migrated = true
            }
          }
          if (migrated) {
            devLog('[TokenManager] Synced credentials from oauth_config.json')
            this._saveTokens()
          }
        }
        // Legacy single-token format: convert to multi-project array
        else if (raw && typeof raw === 'object' && raw.access_token) {
          devLog('[TokenManager] Converting legacy single-token format to multi-project array')
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
      console.warn('[TokenManager] No tokens configured — add OAuth credentials in Settings')
    } else {
      devLog(`[TokenManager] Loaded ${this._tokens.length} tokens: ${this._tokens.map(t => t.projectId).join(', ')}`)
    }
  }

  private _loadStats(): void {
    try {
      if (fs.existsSync(STATS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'))
        this._stats = new Map(Object.entries(raw.stats || {}))
        this._lastReset = raw.lastReset || Date.now()
        this._lastResetUTCDate = raw.lastResetUTCDate || ''
        this._unauthorizedTokens = new Set(raw.unauthorizedTokens || [])
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
      fs.writeFileSync(STATS_FILE, JSON.stringify({
        stats: obj,
        lastReset: this._lastReset,
        lastResetUTCDate: this._lastResetUTCDate,
        unauthorizedTokens: [...this._unauthorizedTokens],
      }, null, 2), 'utf-8')
    } catch (e) {
      console.error('[TokenManager] Failed to persist stats:', e)
    }
  }

  /**
   * Check if we need to reset daily stats.
   * Uses local date — quotas reset at local midnight (17:00 UTC for Vietnam UTC+7),
   * which is well before Google's midnight PT (08:00 UTC next day). Safe to reset early.
   */
  private _checkReset(): void {
    const now = new Date()
    const utcDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
    if (this._lastResetUTCDate === utcDate) return  // already reset today

    this._stats.clear()
    this._unauthorizedTokens.clear()
    this._lastReset = Date.now()
    this._lastResetUTCDate = utcDate
    this._saveStats()
    devLog(`[TokenManager] Quota reset — UTC date: "${utcDate}"`)
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

    devLog(`[TokenManager] Proactive refresh: ${expiring.length}/${this._tokens.length} tokens expiring soon`)

    const results = await Promise.allSettled(
      expiring.map(async (t) => {
        const refreshed = await this.refreshToken(t)
        if (!refreshed) {
          this.recordError(t.projectId)
          // Token refresh failed — keep it in the list. getBestAvailable will skip it
          // if usedToday exceeds MAX_UNITS_PER_TOKEN. User can reset stats or re-auth in Settings.
          console.warn(`[TokenManager] Proactive refresh failed for ${t.projectId} — keeping token`)
          return null
        }
        const idx = this._tokens.findIndex(x => x.projectId === t.projectId)
        if (idx !== -1) this._tokens[idx] = refreshed
        this._saveTokens()
        devLog(`[TokenManager] Proactive refresh OK: ${t.projectId} (expires ${new Date(refreshed.expires_at).toISOString()})`)
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

    // Filter candidates: skip unauthorized or exhausted (5+ quota errors) tokens.
    // Error count is the signal — 5 quota errors = exhausted. usedToday accumulates but doesn't
    // directly block (it's for logging/visibility only; MAX_UNITS_PER_TOKEN = 9,500 for docs).
    const candidates = this._tokens.filter(t => {
      if (this._unauthorizedTokens.has(t.projectId)) return false
      const s = this._stats.get(t.projectId)
      if (!s) return true
      // Exhausted = 10 or more quota errors (system is rate-limited, not quota-exhausted)
    return s.errors < 10
    })

    if (candidates.length === 0) {
      console.warn(`[TokenManager] getBestAvailable: All ${this._tokens.length} tokens filtered out — _unauthorized: ${[...this._unauthorizedTokens].join(',')}`)
      for (const t of this._tokens) {
        const s = this._stats.get(t.projectId)
        console.warn(`  token=${t.projectId} usedToday=${s?.usedToday ?? 0} >= ${MAX_UNITS_PER_TOKEN}=${(s?.usedToday ?? 0) >= MAX_UNITS_PER_TOKEN} unauthorized=${this._unauthorizedTokens.has(t.projectId)}`)
      }
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
      devLog(`[TokenManager] Token for ${chosen.projectId} expired (or expiring in ${expiresIn}min), refreshing...`)
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
        devLog(`[TokenManager] Token refreshed for ${chosen.projectId} (expires ${new Date(refreshed.expires_at).toISOString()})`)
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

  /** Track an API error (e.g., 403 quota exceeded) — increments usedToday to skip exhausted tokens */
  trackError(projectId: string): void {
    const s = this._stats.get(projectId) || { usedToday: 0, errors: 0, lastUsed: 0 }
    // Add 100 units to push exhausted tokens above MAX_UNITS_PER_TOKEN threshold
    // This ensures getBestAvailable() skips them even without tracking every call
    s.usedToday += 100
    s.errors++
    s.lastUsed = Date.now()
    this._stats.set(projectId, s)
    this._saveStats()
    console.warn(`[TokenManager] trackError(${projectId}): +100 units, errors: ${s.errors} → usedToday: ${s.usedToday}`)
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
    devLog(`[TokenManager] Token added/updated for ${projectId}`)
  }

  getToken(projectId: string): OAuthTokenSet | null {
    return this._tokens.find(t => t.projectId === projectId) || null
  }

  removeToken(projectId: string): void {
    this._tokens = this._tokens.filter(t => t.projectId !== projectId)
    this._stats.delete(projectId)
    this._saveTokens()
    this._saveStats()
    devLog(`[TokenManager] Token removed for ${projectId}`)
  }

  /** Reload tokens from disk. Call after external code writes tokens (e.g., OAuth flow). */
  reload(): void {
    this._loadTokens()
    this._loadStats()
  }

  resetAll(): void {
    this._stats.clear()
    this._unauthorizedTokens.clear()
    this._lastReset = Date.now()
    this._saveStats()
    devLog('[TokenManager] Reset all token quotas')
  }

  /** Reset stats for a specific project (keeps the token, only clears usedToday/errors/unauthorized flag) */
  resetTokenStats(projectId: string): { success: boolean; nextReset: number; wasUnauthorized: boolean } {
    const wasUnauthorized = this._unauthorizedTokens.has(projectId)
    this._stats.delete(projectId)
    this._unauthorizedTokens.delete(projectId)
    this._saveStats()
    devLog(`[TokenManager] Reset quota stats for ${projectId} (wasUnauthorized=${wasUnauthorized})`)
    return { success: true, nextReset: this._getNextResetTime(), wasUnauthorized }
  }

  /** Mark a token as unauthorized (401 — token revoked or invalid) */
  markUnauthorized(projectId: string): void {
    this._unauthorizedTokens.add(projectId)
    this._saveStats()
    console.warn(`[TokenManager] Token ${projectId} marked as unauthorized`)
  }

  /** Mark a token as authorized — clears unauthorized flag */
  markAuthorized(projectId: string): void {
    if (this._unauthorizedTokens.has(projectId)) {
      this._unauthorizedTokens.delete(projectId)
      this._saveStats()
      devLog(`[TokenManager] Token ${projectId} authorized`)
    }
  }

  /** Test an OAuth token by making a lightweight API call */
  async testToken(projectId: string): Promise<{ valid: boolean; error?: string; errorType?: string }> {
    const token = this._tokens.find(t => t.projectId === projectId)
    if (!token) return { valid: false, error: 'Token not found', errorType: 'not_found' }

    // Try to refresh to verify token is valid
    const refreshed = await this.refreshToken(token)
    if (!refreshed) {
      this.markUnauthorized(projectId)
      return { valid: false, error: 'Token expired or revoked', errorType: 'unauthorized' }
    }

    // Update token in memory
    const idx = this._tokens.findIndex(t => t.projectId === projectId)
    if (idx !== -1) this._tokens[idx] = refreshed
    this._saveTokens()
    this.markAuthorized(projectId)
    return { valid: true }
  }

  /** Stop background timer — call on app quit */
  dispose(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer)
      this._refreshTimer = null
    }
    if (this._resetCheckTimer) {
      clearInterval(this._resetCheckTimer)
      this._resetCheckTimer = null
    }
  }

  getTokenCount(): number {
    return this._tokens.length
  }

  /** Compute timestamp of next midnight UTC reset */
  _getNextResetTime(): number {
    const now = new Date()
    const msUntilMidnightUTC = (24 - now.getUTCHours()) * 3600 * 1000
      - now.getUTCMinutes() * 60000
      - now.getUTCSeconds() * 1000
      - now.getUTCMilliseconds()
    return Date.now() + msUntilMidnightUTC
  }

  /** Get status for all tokens (for Settings UI) */
  getAllStatuses(): TokenStatus[] {
    devLog(`[TokenManager] getAllStatuses: ${this._tokens.length} tokens loaded, _unauthorized: ${[...this._unauthorizedTokens].join(',')}`)
    return this._tokens.map(t => {
      const s = this._stats.get(t.projectId)
      const usedToday = s?.usedToday ?? 0
      const errors = s?.errors ?? 0
      // quotaPercent = real API units only (errors are tracked separately for status)
      const quotaPercent = Math.round((usedToday / MAX_UNITS_PER_TOKEN) * 100)

      let status: TokenStatus['status'] = 'healthy'
      if (this._unauthorizedTokens.has(t.projectId)) status = 'unauthorized'
      else if (usedToday >= MAX_UNITS_PER_TOKEN) status = 'exhausted'
      else if (errors >= 10) status = 'rate_limited'
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
