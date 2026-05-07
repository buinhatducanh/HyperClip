/**
 * Key Manager — HyperClip
 *
 * Manages YouTube Data API keys with smart least-used rotation.
 * Supports dynamic add/remove, quota tracking, and per-key stats.
 *
 * Smart Rotation: selects the key with the most remaining quota.
 * Persists keys and stats to separate JSON files.
 */

import path from 'path'
import fs from 'fs'
import os from 'os'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface APIKey {
  key: string
  projectId: string
  name: string
}

interface KeyStats {
  key: string
  usedToday: number   // units consumed today
  errors: number       // consecutive errors
  lastUsed: number    // timestamp
  lastErrorAt: number  // timestamp
  lastResetAt: number  // timestamp of last manual reset
}

interface KeyManagerData {
  keys: APIKey[]
  unauthorizedKeys: string[]
  lastReset: number
  lastResetPTDate: string
}

export interface KeyStatus {
  key: string
  projectId: string
  name: string
  usedToday: number
  quotaTotal: number
  quotaPercent: number   // 0-100
  errors: number
  lastUsed: number | null
  status: 'healthy' | 'warning' | 'error' | 'exhausted' | 'unauthorized'
  lastReset: number | null  // timestamp of last manual reset
  nextReset: number | null   // timestamp of next midnight PT reset
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KEYS_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'HyperClip')
const KEYS_FILE = path.join(KEYS_DIR, 'api_keys.json')
const STATS_FILE = path.join(KEYS_DIR, 'key_stats.json')

const MAX_UNITS_PER_KEY = 9500   // 500 unit buffer per key
const MAX_ERRORS = 3             // mark unhealthy after 3 consecutive errors

// ─── Key Manager ─────────────────────────────────────────────────────────────

class KeyManager {
  private _keys: APIKey[] = []
  private _stats: Map<string, KeyStats> = new Map()
  private _lastReset: number = Date.now()
  private _lastResetPTDate: string = ''  // tracks PT date for midnight-PT reset
  private _initialized: boolean = false
  private _unauthorizedKeys: Set<string> = new Set()

  constructor() {
    this._load()
    this._loadStats()
    this._checkReset()
  }

  // ── Load / Persist ──────────────────────────────────────────────────────────

  private _ensureDir(): void {
    if (!fs.existsSync(KEYS_DIR)) {
      fs.mkdirSync(KEYS_DIR, { recursive: true })
    }
  }

  private _load(): void {
    try {
      if (fs.existsSync(KEYS_FILE)) {
        const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'))
        this._keys = (data.keys || []).filter((k: APIKey) => k.key && k.key !== 'YOUR_API_KEY_01')
        this._unauthorizedKeys = new Set(data.unauthorizedKeys || [])
      }
    } catch (e) {
      console.warn('[KeyManager] Failed to load keys:', e)
    }

    if (this._keys.length === 0) {
      console.warn('[KeyManager] No API keys found in', KEYS_FILE)
      console.warn('[KeyManager] Run HyperClip with a valid api_keys.json in AppData/Roaming/HyperClip/')
    } else {
      console.log(`[KeyManager] Loaded ${this._keys.length} keys, smart rotation active`)
      if (this._unauthorizedKeys.size > 0) {
        console.warn(`[KeyManager] ${this._unauthorizedKeys.size} key(s) marked as unauthorized`)
      }
    }
  }

  private _loadStats(): void {
    try {
      if (fs.existsSync(STATS_FILE)) {
        const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'))
        this._stats = new Map(Object.entries(data.stats || {}))
        this._lastReset = data.lastReset || Date.now()
        this._lastResetPTDate = data.lastResetPTDate || ''
      }
    } catch {}
  }

  private _persist(): void {
    this._ensureDir()
    try {
      fs.writeFileSync(KEYS_FILE, JSON.stringify({
        keys: this._keys,
        unauthorizedKeys: [...this._unauthorizedKeys],
      }, null, 2), 'utf-8')
    } catch (e) {
      console.error('[KeyManager] Failed to persist keys:', e)
    }
    this._persistStats()
  }

  private _persistStats(): void {
    try {
      const obj: Record<string, KeyStats> = {}
      for (const [k, v] of this._stats) obj[k] = v
      fs.writeFileSync(STATS_FILE, JSON.stringify({ stats: obj, lastReset: this._lastReset, lastResetPTDate: this._lastResetPTDate }, null, 2), 'utf-8')
    } catch (e) {
      console.error('[KeyManager] Failed to persist stats:', e)
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
    // Find first Sunday of March
    const firstSundayMarch = new Date(Date.UTC(utcYear, 2, march1.getUTCDay() === 0 ? 1 : 8 - march1.getUTCDay()))
    const dstStart = new Date(Date.UTC(utcYear, 2, firstSundayMarch.getUTCDate()))
    // Find first Sunday of November
    const nov1 = new Date(Date.UTC(utcYear, 10, 1))
    const firstSundayNov = new Date(Date.UTC(utcYear, 10, nov1.getUTCDay() === 0 ? 1 : 8 - nov1.getUTCDay()))
    const dstEnd = new Date(Date.UTC(utcYear, 10, firstSundayNov.getUTCDate()))

    const isPDT = now >= dstStart && now < dstEnd
    const ptOffsetHours = isPDT ? -7 : -8
    const ptHour = utcHour + ptOffsetHours

    // PT date: if PT hour rolled negative, we're in previous PT day
    // If PT hour is >= 0 and UTC, we're in same PT day
    // Compare PT date strings to detect day change
    const ptDateStr = ptHour >= 0
      ? `${utcYear}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
      : `${utcYear}-${String(new Date(now.getTime() - 86400000).getUTCMonth() + 1).padStart(2, '0')}-${String(new Date(now.getTime() - 86400000).getUTCDate()).padStart(2, '0')}`

    if (this._lastResetPTDate !== ptDateStr) {
      this._stats.clear()
      this._lastReset = Date.now()
      this._lastResetPTDate = ptDateStr
      this._persistStats()
      console.log(`[KeyManager] Daily reset at midnight PT (${ptDateStr}) — all key quotas refreshed`)
    }
  }

  // ── Smart Rotation ─────────────────────────────────────────────────────────

  /**
   * Get the best available key — the one with the most remaining quota.
   * Skips exhausted or unhealthy keys.
   */
  getKey(): APIKey {
    this._checkReset()

    if (this._keys.length === 0) {
      throw new Error('No API keys configured. Add keys to ' + KEYS_FILE)
    }

    const candidates = this._keys.filter(k => {
      if (this._unauthorizedKeys.has(k.key)) return false
      const s = this._stats.get(k.key)
      if (!s) return true
      return s.usedToday < MAX_UNITS_PER_KEY && s.errors < MAX_ERRORS
    })

    if (candidates.length === 0) {
      throw new Error('All API keys exhausted or unhealthy (quota reset at midnight PT)')
    }

    // Sort by remaining quota (least-used first = most remaining)
    candidates.sort((a, b) => {
      const sa = this._stats.get(a.key)
      const sb = this._stats.get(b.key)
      const ua = sa?.usedToday ?? 0
      const ub = sb?.usedToday ?? 0
      // Pick the key with LEAST usage (most quota remaining)
      return ua - ub
    })

    const chosen = candidates[0]
    const stat = this._stats.get(chosen.key) || { key: chosen.key, usedToday: 0, errors: 0, lastUsed: 0, lastErrorAt: 0, lastResetAt: 0 }
    stat.lastUsed = Date.now()
    this._stats.set(chosen.key, stat)
    this._persistStats()
    return chosen
  }

  // ── Tracking ───────────────────────────────────────────────────────────────

  /** Track units consumed by a key */
  track(key: string, units: number): void {
    const stat = this._stats.get(key) || { key, usedToday: 0, errors: 0, lastUsed: 0, lastErrorAt: 0, lastResetAt: 0 }
    stat.usedToday += units
    this._stats.set(key, stat)
    this._persistStats()
  }

  /** Record an error for a key (increments consecutive error count) */
  recordError(key: string): void {
    const stat = this._stats.get(key) || { key, usedToday: 0, errors: 0, lastUsed: 0, lastErrorAt: 0, lastResetAt: 0 }
    stat.errors++
    stat.lastErrorAt = Date.now()
    this._stats.set(key, stat)
    this._persistStats()
    console.warn(`[KeyManager] Error on key ${key.slice(0, 12)}... — errors: ${stat.errors}`)
  }

  /** Track an API error (e.g., 403 quota exceeded) — increments usedToday to push exhausted keys out of rotation */
  trackError(key: string): void {
    const stat = this._stats.get(key) || { key, usedToday: 0, errors: 0, lastUsed: 0, lastErrorAt: 0, lastResetAt: 0 }
    const QUOTA_HIT_UNITS = 100
    stat.usedToday += QUOTA_HIT_UNITS
    stat.errors++
    stat.lastErrorAt = Date.now()
    this._stats.set(key, stat)
    this._persistStats()
    console.warn(`[KeyManager] trackError(${key.slice(0, 12)}...): +${QUOTA_HIT_UNITS} units → usedToday: ${stat.usedToday}`)
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** Add a new key */
  addKey(key: string, projectId: string, name: string): void {
    if (this._keys.find(k => k.key === key)) {
      console.warn('[KeyManager] Key already exists:', key.slice(0, 12))
      return
    }
    this._keys.push({ key, projectId, name })
    this._persist()
    console.log(`[KeyManager] Added key: ${name} (${key.slice(0, 12)}...)`)
  }

  /** Remove a key by key string */
  removeKey(key: string): void {
    const idx = this._keys.findIndex(k => k.key === key)
    if (idx === -1) return
    const removed = this._keys.splice(idx, 1)[0]
    this._stats.delete(key)
    this._persist()
    this._persistStats()
    console.log(`[KeyManager] Removed key: ${removed.name}`)
  }

  /** Reset quota for a specific key */
  resetKey(key: string): { success: boolean; nextReset: number } {
    const stat = this._stats.get(key)
    if (stat) {
      stat.usedToday = 0
      stat.errors = 0
      stat.lastUsed = 0
      stat.lastResetAt = Date.now()
      this._stats.set(key, stat)
      this._persistStats()
      console.log(`[KeyManager] Reset quota for key ${key.slice(0, 12)}...`)
    }
    return { success: true, nextReset: this._getNextResetTime() }
  }

  /** Reset all key quotas */
  resetAll(): { success: boolean; nextReset: number } {
    this._stats.clear()
    this._lastReset = Date.now()
    this._persistStats()
    console.log('[KeyManager] Reset all key quotas')
    return { success: true, nextReset: this._getNextResetTime() }
  }

  /** Mark a key as unauthorized (failed validation) */
  markUnauthorized(key: string): void {
    this._unauthorizedKeys.add(key)
    this._persist()
    console.warn(`[KeyManager] Key ${key.slice(0, 12)}... marked as unauthorized`)
  }

  /** Mark a key as authorized (passed validation) — clears unauthorized flag */
  markAuthorized(key: string): void {
    if (this._unauthorizedKeys.has(key)) {
      this._unauthorizedKeys.delete(key)
      this._persist()
      console.log(`[KeyManager] Key ${key.slice(0, 12)}... authorized`)
    }
  }

  /** Get unauthorized keys count */
  getUnauthorizedCount(): number {
    return this._unauthorizedKeys.size
  }

  /** Compute timestamp of next midnight PT reset */
  _getNextResetTime(): number {
    const now = new Date()
    const utcHour = now.getUTCHours()
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
    // Next midnight PT
    const msUntilMidnightPT = ptHour >= 0
      ? (24 - ptHour) * 3600 * 1000 - now.getUTCMinutes() * 60000 - now.getUTCSeconds() * 1000
      : Math.abs(ptHour) * 3600 * 1000 - now.getUTCMinutes() * 60000 - now.getUTCSeconds() * 1000
    return Date.now() + msUntilMidnightPT
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  /** Get all keys with current stats */
  getAllKeys(): KeyStatus[] {
    this._checkReset()
    return this._keys.map(k => {
      const stat = this._stats.get(k.key)
      const usedToday = stat?.usedToday ?? 0
      const errors = stat?.errors ?? 0
      const quotaPercent = Math.round((usedToday / MAX_UNITS_PER_KEY) * 100)

      let status: KeyStatus['status'] = 'healthy'
      if (this._unauthorizedKeys.has(k.key)) status = 'unauthorized'
      else if (usedToday >= MAX_UNITS_PER_KEY || errors >= MAX_ERRORS) status = 'exhausted'
      else if (quotaPercent >= 80) status = 'warning'
      else if (errors > 0) status = 'error'

      return {
        key: k.key,
        projectId: k.projectId,
        name: k.name,
        usedToday,
        quotaTotal: MAX_UNITS_PER_KEY,
        quotaPercent: Math.min(100, quotaPercent),
        errors,
        lastUsed: stat?.lastUsed ?? null,
        status,
        lastReset: stat?.lastResetAt ?? null,
        nextReset: this._getNextResetTime(),
      }
    })
  }

  getKeyCount(): number {
    return this._keys.length
  }

  getKeyForProject(projectId: string): APIKey | null {
    const candidates = this._keys.filter(k => k.projectId === projectId)
    if (candidates.length === 0) return null
    // Return the least-used key within this project
    candidates.sort((a, b) => {
      const sa = this._stats.get(a.key)?.usedToday ?? 0
      const sb = this._stats.get(b.key)?.usedToday ?? 0
      return sa - sb
    })
    return candidates[0]
  }

  /** Get usedToday for a specific key (for quota guard checks) */
  getUsedToday(key: string): number {
    return this._stats.get(key)?.usedToday ?? 0
  }

  /**
   * Test a key by making a lightweight API call.
   * Returns result indicating: unauthorized (401), quota_exhausted (403), invalid_key, or ok.
   */
  async testKey(key: string): Promise<{ valid: boolean; error?: string; errorType?: 'unauthorized' | 'quota_exhausted' | 'invalid_key' | 'network_error' }> {
    const https = await import('https')
    const url = new URL('https://www.googleapis.com/youtube/v3/channels')
    url.searchParams.set('part', 'id')
    // Use guideCategories — publicly accessible, no specific channel needed.
    // Falls back to categories endpoint which returns results for any valid key.
    url.searchParams.set('regionCode', 'US')
    url.searchParams.set('key', key)

    return new Promise((resolve) => {
      const req = https.get(url.toString(), { timeout: 10000 }, (res: any) => {
        let data = ''
        res.on('data', (c: string) => { data += c })
        res.on('end', () => {
          if (res.statusCode === 401) {
            resolve({ valid: false, error: 'Unauthorized — key is invalid or has been revoked', errorType: 'unauthorized' })
          } else if (res.statusCode === 403) {
            try {
              const json = JSON.parse(data)
              if (json?.error?.errors?.[0]?.reason === 'quotaExceeded') {
                resolve({ valid: false, error: 'Quota exceeded', errorType: 'quota_exhausted' })
              } else {
                resolve({ valid: false, error: 'Forbidden — check key permissions', errorType: 'quota_exhausted' })
              }
            } catch {
              resolve({ valid: false, error: 'Forbidden (403)', errorType: 'quota_exhausted' })
            }
          } else if (res.statusCode === 400) {
            resolve({ valid: false, error: 'Invalid API key format', errorType: 'invalid_key' })
          } else if (res.statusCode === 200) {
            resolve({ valid: true })
          } else {
            resolve({ valid: false, error: `Unexpected status: ${res.statusCode}`, errorType: 'invalid_key' })
          }
        })
      })
      req.on('error', (e: Error) => {
        resolve({ valid: false, error: e.message, errorType: 'network_error' })
      })
      req.on('timeout', () => {
        req.destroy()
        resolve({ valid: false, error: 'Request timed out', errorType: 'network_error' })
      })
    })
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: KeyManager | null = null

export function getKeyManager(): KeyManager {
  if (!_instance) _instance = new KeyManager()
  return _instance
}

export { KeyManager }
