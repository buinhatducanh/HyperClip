/**
 * Key Manager — HyperClip (refactored 2026-05-14)
 *
 * Manages YouTube Data API keys using ProjectManager as data source.
 * Each GCP project has an associated API key in project.config.json.
 *
 * Smart Rotation: for a given project, returns the project's API key.
 * For unassigned/detection keys: picks the project with most remaining quota.
 *
 * Quota tracking is done via ProjectManager (shared with OAuth quota).
 * Each project = 10k units/day for ALL YouTube API calls (OAuth + key).
 */

import path from 'path'
import fs from 'fs'
import https from 'https'
import { devLog } from './unified_log.js'
import { getAppStoreDir } from './paths.js'
import { getProjectManager, type GCPProject } from './project_manager.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface APIKey {
  key: string
  projectId: string
  name: string
}

export interface KeyStatus {
  key: string
  projectId: string
  projectName: string
  gmailAccount: string
  name: string
  usedToday: number
  quotaTotal: number
  quotaPercent: number
  errors: number
  lastUsed: number | null
  status: 'healthy' | 'warning' | 'error' | 'exhausted' | 'unauthorized' | 'no_key'
  lastReset: number | null
  nextReset: number | null
}

// ─── Legacy Compat ─────────────────────────────────────────────────────────────

const KEYS_DIR = getAppStoreDir()
const KEYS_FILE = path.join(KEYS_DIR, 'api_keys.json')
const STATS_FILE = path.join(KEYS_DIR, 'key_stats.json')

const MAX_UNITS_PER_KEY = 9500
const MAX_ERRORS = 3

interface LegacyKeyEntry {
  key: string
  projectId: string
  name: string
}

function _loadLegacyKeys(): LegacyKeyEntry[] {
  if (!fs.existsSync(KEYS_FILE)) return []
  try {
    const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'))
    return (data.keys || []).filter((k: LegacyKeyEntry) => k.key && k.key !== 'YOUR_API_KEY_01')
  } catch { return [] }
}

// ─── Key Manager ─────────────────────────────────────────────────────────────

class KeyManager {
  private _legacyKeys: LegacyKeyEntry[] = []
  private _initialized: boolean = false

  constructor() {
    // Legacy compat: migrate old api_keys.json to project configs
    if (_loadLegacyKeys().length > 0) {
      this._migrateLegacyKeys()
    }
    this._initialized = true
  }

  private _migrateLegacyKeys(): void {
    const legacy = _loadLegacyKeys()
    if (legacy.length === 0) return

    const pm = getProjectManager()
    for (const k of legacy) {
      const project = pm.getProject(k.projectId)
      if (project) {
        pm.updateProject(k.projectId, { apiKey: k.key })
        devLog(`[KeyManager] Migrated key for ${k.projectId}: ${k.key.slice(0, 12)}...`)
      } else {
        // Create project for legacy key
        pm.addProject({
          projectId: k.projectId,
          projectName: k.name || k.projectId,
          gmailAccount: '',
          clientId: '',
          clientSecret: '',
          apiKey: k.key,
          status: 'active',
          createdAt: new Date().toISOString(),
        })
        devLog(`[KeyManager] Created project ${k.projectId} from legacy key`)
      }
    }
    devLog(`[KeyManager] Migrated ${legacy.length} legacy API keys`)
  }

  // ── Smart Rotation ─────────────────────────────────────────────────────────

  /**
   * Get the best available API key for a project.
   * If projectId provided: return that project's key.
   * Otherwise: return key from least-used active project.
   */
  getKey(projectId?: string): APIKey | null {
    const pm = getProjectManager()

    if (projectId) {
      const project = pm.getProject(projectId)
      if (project?.apiKey) {
        return {
          key: project.apiKey,
          projectId: project.projectId,
          name: project.projectName,
        }
      }
      return null
    }

    // Get least-used project with a key
    const candidates = pm.getActiveProjects().filter(p => p.apiKey)
    if (candidates.length === 0) return null

    candidates.sort((a, b) => a.stats.usedToday - b.stats.usedToday)
    const chosen = candidates[0]
    return {
      key: chosen.apiKey,
      projectId: chosen.projectId,
      name: chosen.projectName,
    }
  }

  /**
   * Get API key for a specific project.
   */
  getKeyForProject(projectId: string): APIKey | null {
    return this.getKey(projectId)
  }

  // ── Tracking ───────────────────────────────────────────────────────────────

  track(projectId: string, units: number = 1): void {
    getProjectManager().track(projectId, units)
  }

  recordError(projectId: string): void {
    getProjectManager().recordError(projectId)
  }

  trackError(projectId: string): void {
    getProjectManager().recordQuotaError(projectId)
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  addKey(key: string, projectId: string, name: string): void {
    const pm = getProjectManager()
    pm.updateProject(projectId, { apiKey: key })
    devLog(`[KeyManager] Added key: ${name} (${key.slice(0, 12)}...) for ${projectId}`)
  }

  removeKey(projectId: string): void {
    const pm = getProjectManager()
    pm.updateProject(projectId, { apiKey: '' })
    devLog(`[KeyManager] Removed key for ${projectId}`)
  }

  resetKey(projectId: string): { success: boolean; nextReset: number } {
    const pm = getProjectManager()
    pm.resetProject(projectId)
    return { success: true, nextReset: pm.getNextResetTime() }
  }

  resetAll(): { success: boolean; nextReset: number } {
    const pm = getProjectManager()
    pm.resetAll()
    return { success: true, nextReset: pm.getNextResetTime() }
  }

  markUnauthorized(projectId: string): void {
    getProjectManager().markUnauthorized(projectId)
  }

  markAuthorized(projectId: string): void {
    getProjectManager().resetProject(projectId)
  }

  _getNextResetTime(): number {
    return getProjectManager().getNextResetTime()
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  getAllKeys(): KeyStatus[] {
    const pm = getProjectManager()
    return pm.getAllProjects().map(p => {
      const usedToday = p.stats.usedToday
      const errors = p.stats.errors
      const quotaPercent = Math.round((usedToday / MAX_UNITS_PER_KEY) * 100)

      let status: KeyStatus['status'] = 'healthy'
      if (!p.apiKey) status = 'no_key'
      else if (p.status === 'unauthorized' || p.stats.unauthorized) status = 'unauthorized'
      else if (usedToday >= MAX_UNITS_PER_KEY || p.status === 'exhausted') status = 'exhausted'
      else if (quotaPercent >= 80) status = 'warning'
      else if (errors > 0) status = 'error'

      return {
        key: p.apiKey || '',
        projectId: p.projectId,
        projectName: p.projectName,
        gmailAccount: p.gmailAccount,
        name: p.projectName,
        usedToday,
        quotaTotal: MAX_UNITS_PER_KEY,
        quotaPercent: Math.min(100, quotaPercent),
        errors,
        lastUsed: p.stats.lastUsed || null,
        status,
        lastReset: null,
        nextReset: pm.getNextResetTime(),
      }
    })
  }

  getKeyCount(): number {
    return getProjectManager().getAllProjects().filter(p => p.apiKey).length
  }

  getUnauthorizedCount(): number {
    return getProjectManager().getAllProjects().filter(p => p.status === 'unauthorized').length
  }

  getUsedToday(projectId: string): number {
    return getProjectManager().getUsedToday(projectId)
  }

  /** Test an API key by making a lightweight API call */
  async testKey(key: string): Promise<{ valid: boolean; error?: string; errorType?: 'unauthorized' | 'quota_exhausted' | 'invalid_key' | 'network_error' }> {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels')
    url.searchParams.set('part', 'id')
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
