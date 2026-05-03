/**
 * Bulk add HyperClip projects from spreadsheet data.
 * Adds OAuth credentials + API keys directly to storage files.
 * Projects will show in Settings UI — click AUTHORIZE per project to complete OAuth.
 *
 * Usage: node scripts/bulk-add-projects.js
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

// ─── Spreadsheet Data ──────────────────────────────────────────────────────────
// Format: projectId | apiKey | clientId | clientSecret | email | authStatus | password | name
// authStatus = "Yes" means already authorized (needs OAuth token), "No" means not yet
// password = not stored (for OAuth flow reference only)

const ENTRIES = []

// ─── Storage Paths ──────────────────────────────────────────────────────────────

const KEYS_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'HyperClip')
const KEYS_FILE = path.join(KEYS_DIR, 'api_keys.json')
const STATS_FILE = path.join(KEYS_DIR, 'key_stats.json')
const COOKIES_DIR = path.join(os.tmpdir(), 'hyperclip-cookies')
const OAUTH_CONFIG_FILE = path.join(COOKIES_DIR, 'oauth_config.json')
const TOKENS_FILE = path.join(COOKIES_DIR, 'oauth_tokens.json')

// ─── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function loadJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return fallback }
}

function saveJson(file, data) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Add Project ────────────────────────────────────────────────────────────────

function addProject(entry) {
  const { projectId, apiKey, clientId, clientSecret, name, hasToken } = entry

  // 1. Save OAuth credentials to oauth_config.json
  const oauthConfig = loadJson(OAUTH_CONFIG_FILE, {})
  oauthConfig[projectId] = {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
  }
  // Also keep legacy fields for backward compat
  oauthConfig['client_id'] = clientId.trim()
  oauthConfig['client_secret'] = clientSecret.trim()
  saveJson(OAUTH_CONFIG_FILE, oauthConfig)

  // 2. Save API key to api_keys.json
  const keysData = loadJson(KEYS_FILE, { keys: [] })
  const existingKey = keysData.keys.find(k => k.key === apiKey.trim())
  if (!existingKey) {
    keysData.keys.push({
      key: apiKey.trim(),
      projectId: projectId,
      name: name || projectId,
    })
    saveJson(KEYS_FILE, keysData)
    console.log(`  [OK] API key added: ${apiKey.slice(0, 20)}... (${name || projectId})`)
  } else {
    console.log(`  [SKIP] API key already exists: ${apiKey.slice(0, 20)}...`)
  }

  // 3. Save token placeholder to oauth_tokens.json (no token yet — needs browser auth)
  const tokensData = loadJson(TOKENS_FILE, [])
  const existingToken = tokensData.find(t => t.projectId === projectId)
  if (!existingToken) {
    tokensData.push({
      projectId: projectId,
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      access_token: '',  // empty = not authorized yet
      refresh_token: '', // empty = not authorized yet
      expires_at: 0,
      token_type: 'Bearer',
    })
    saveJson(TOKENS_FILE, tokensData)
    console.log(`  [OK] OAuth placeholder saved (needs AUTHORIZE): ${projectId}`)
  } else {
    console.log(`  [SKIP] OAuth already exists: ${projectId}`)
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

console.log('\n=== HyperClip Bulk Add Projects ===\n')
console.log(`Entries to add: ${ENTRIES.length}`)
console.log(`Keys file: ${KEYS_FILE}`)
console.log(`OAuth config: ${OAUTH_CONFIG_FILE}`)
console.log(`Tokens file: ${TOKENS_FILE}\n`)

let added = 0, skipped = 0

for (const entry of ENTRIES) {
  const existingTokens = loadJson(TOKENS_FILE, [])
  const existingToken = existingTokens.find(t => t.projectId === entry.projectId)
  const existingKeys = loadJson(KEYS_FILE, { keys: [] })
  const existingKey = existingKeys.keys.find(k => k.key === entry.apiKey.trim())

  if (existingToken && existingKey) {
    console.log(`[${entry.projectId}] Already exists — SKIPPING`)
    skipped++
    continue
  }

  console.log(`Adding: ${entry.projectId} (${entry.name})`)
  try {
    addProject(entry)
    added++
  } catch (e) {
    console.error(`  [ERROR] ${e.message}`)
  }
}

console.log(`\n=== Done ===`)
console.log(`Added: ${added}`)
console.log(`Skipped: ${skipped}`)
console.log(`\nNext: Open HyperClip → Settings → AUTHORIZE each project`)
console.log(`(OAuth browser flow required for each project)\n`)

