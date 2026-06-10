#!/usr/bin/env node
/**
 * migrate-projects.mjs
 *
 * Imports legacy GCP project data (API keys, OAuth config, tokens) from
 * Electron's D:\HyperClip-Data\app\ plain JSON files
 * into Rust-native keys.json + projects.json at %APPDATA%\HyperClip\.hyperclip\
 *
 * Source files used:
 *   D:\HyperClip-Data\app\api_keys.json    — all API keys
 *   D:\HyperClip-Data\app\oauth_config.json — OAuth client IDs/secrets
 *   D:\HyperClip-Data\app\oauth_tokens.json — OAuth tokens (access/refresh)
 *
 * Run: node scripts/migrate-projects.mjs
 * Safe to re-run — upserts by projectId.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const APP_DIR = 'D:\\HyperClip-Data\\app'
const OUTPUT_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'HyperClip', '.hyperclip')

const KEYS_FILE = path.join(APP_DIR, 'api_keys.json')
const CONFIG_FILE = path.join(APP_DIR, 'oauth_config.json')
const TOKENS_FILE = path.join(APP_DIR, 'oauth_tokens.json')

function loadJson(fp) {
  if (!fs.existsSync(fp)) return null
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')) } catch { return null }
}

async function main() {
  console.log('=== HyperClip GCP Project Migration ===')
  console.log(`Source: ${APP_DIR}`)
  console.log(`Target: ${OUTPUT_DIR}`)
  console.log('')

  // 1. Load API keys
  const apiKeysData = loadJson(KEYS_FILE)
  const legacyKeys = apiKeysData?.keys ?? []
  console.log(`Loaded ${legacyKeys.length} API keys`)

  // Deduplicate by projectId (some entries share the same key)
  const keyMap = new Map()
  for (const entry of legacyKeys) {
    const pid = entry.projectId || entry.name
    if (!pid || !entry.key) continue
    // Skip placeholder keys
    if (entry.key === 'YOUR_API_KEY_01') continue
    keyMap.set(pid, {
      key: entry.key,
      name: entry.name || pid,
      projectId: pid,
    })
  }
  console.log(`Unique projects from API keys: ${keyMap.size}`)

  // 2. Load OAuth config
  const oauthConfig = loadJson(CONFIG_FILE) ?? {}
  console.log(`OAuth config entries: ${Object.keys(oauthConfig).filter(k => !k.startsWith('client_')).length}`)

  // 3. Load OAuth tokens
  const oauthTokensRaw = loadJson(TOKENS_FILE)
  const oauthTokens = Array.isArray(oauthTokensRaw) ? oauthTokensRaw : (oauthTokensRaw ? [oauthTokensRaw] : [])
  console.log(`OAuth tokens: ${oauthTokens.length}`)

  const tokenMap = new Map()
  for (const tok of oauthTokens) {
    const pid = tok.projectId
    if (!pid) continue
    tokenMap.set(pid, {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: tok.expires_at || 0,
      token_type: tok.token_type || 'Bearer',
    })
  }

  // 4. Build project entries
  // Map: projectId → { clientId, clientSecret, apiKey, ... }
  const projectSet = new Set()
  // Collect all project IDs from all sources
  for (const pid of keyMap.keys()) projectSet.add(pid)
  for (const pid of Object.keys(oauthConfig)) {
    if (!pid.startsWith('client_')) projectSet.add(pid)
  }
  for (const tok of oauthTokens) {
    if (tok.projectId) projectSet.add(tok.projectId)
  }

  const keys = []
  const projects = []
  let [keyCount, projCount] = [0, 0]

  for (const pid of [...projectSet].sort()) {
    const keyEntry = keyMap.get(pid)
    const oauthEntry = oauthConfig[pid]
    const tokenEntry = tokenMap.get(pid)

    const clientId = oauthEntry?.clientId || oauthEntry?.client_id || ''
    const clientSecret = oauthEntry?.clientSecret || oauthEntry?.client_secret || ''

    // API key
    if (keyEntry?.key) {
      keys.push({
        key: keyEntry.key,
        name: keyEntry.name || pid,
        projectId: pid,
        valid: true,
        quotaUsed: 0,
        quotaLimit: 10000,
        lastError: null,
      })
      keyCount++
    }

    // OAuth project (only if it has clientId)
    if (clientId && clientSecret) {
      projects.push({
        projectId: pid,
        name: keyEntry?.name || pid,
        clientId: clientId,
        healthy: true,
        quotaUsed: 0,
        quotaLimit: 10000,
        error: null,
        lastRefresh: tokenEntry?.expires_at || 0,
      })
      projCount++
    }

    const hasParts = []
    if (keyEntry?.key) hasParts.push('key')
    if (clientId) hasParts.push('oauth')
    if (tokenEntry) hasParts.push('token')
    console.log(`  ${pid}: ${hasParts.join(', ') || 'empty'}`)
  }

  console.log('')
  console.log(`Summary: ${keyCount} keys, ${projCount} OAuth projects`)

  // 5. Write output (merge with existing, upsert by projectId)
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const keysPath = path.join(OUTPUT_DIR, 'keys.json')
  const existingKeys = fs.existsSync(keysPath)
    ? JSON.parse(fs.readFileSync(keysPath, 'utf8'))
    : { keys: [] }
  for (const nk of keys) {
    const idx = existingKeys.keys.findIndex(k => k.projectId === nk.projectId)
    if (idx >= 0) existingKeys.keys[idx] = nk
    else existingKeys.keys.push(nk)
  }
  fs.writeFileSync(keysPath, JSON.stringify(existingKeys, null, 2), 'utf8')
  console.log(`Wrote → ${keysPath}`)

  const projectsPath = path.join(OUTPUT_DIR, 'projects.json')
  const existingProjects = fs.existsSync(projectsPath)
    ? JSON.parse(fs.readFileSync(projectsPath, 'utf8'))
    : { projects: [] }
  for (const np of projects) {
    const idx = existingProjects.projects.findIndex(p => p.projectId === np.projectId)
    if (idx >= 0) existingProjects.projects[idx] = np
    else existingProjects.projects.push(np)
  }
  fs.writeFileSync(projectsPath, JSON.stringify(existingProjects, null, 2), 'utf8')
  console.log(`Wrote → ${projectsPath}`)
  console.log('')
  console.log('Migration complete.')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
