/**
 * Bulk add HyperClip projects from spreadsheet data.
 * Updated 2026-05-14: Creates project-based folder structure (projects/proj-XXX/).
 *
 * Creates per-project folders:
 *   projects/proj-XXX/config.json  — credentials
 *   projects/proj-XXX/stats.json  — quota stats
 *   projects/proj-XXX/token.json  — OAuth token (empty until authorized)
 *
 * Usage:
 *   node scripts/bulk-add-projects.cjs
 *
 * Input: Edit the ENTRIES array below with your spreadsheet data.
 * Format: projectId | apiKey | clientId | clientSecret | gmail | name | hasToken
 */

const fs = require('fs')
const path = require('path')

// ─── Spreadsheet Data ──────────────────────────────────────────────────────────
// Paste your CSV/spreadsheet data here.
// Columns: projectId, apiKey, clientId, clientSecret, gmail, name, hasToken

const ENTRIES = [
  // Example (remove/comment out after use):
  // {
  //   projectId: 'proj-001',
  //   apiKey: 'AIzaSy-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  //   clientId: 'xxx.apps.googleusercontent.com',
  //   clientSecret: 'GOCSPX-xxx',
  //   gmail: 'user1@gmail.com',
  //   name: 'Gmail1-ProjectA',
  //   hasToken: false,  // true if you already have refresh_token
  // },
]

// ─── Project Data Root ─────────────────────────────────────────────────────────
// Default: same directory as HyperClip-Data (auto-detected).
// Override by setting HYPERCLIP_DATA_ROOT env var.
const DATA_ROOT = process.env.HYPERCLIP_DATA_ROOT ||
  path.join(path.dirname(process.argv[1]), '..', 'HyperClip-Data')
const PROJECTS_DIR = path.join(DATA_ROOT, 'projects')

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Per-Project Operations ───────────────────────────────────────────────────

function createProjectDir(entry) {
  const { projectId, apiKey, clientId, clientSecret, gmail, name, hasToken } = entry

  const projDir = path.join(PROJECTS_DIR, projectId)
  ensureDir(projDir)

  // 1. config.json — credentials + metadata
  const configPath = path.join(projDir, 'config.json')
  const existingConfig = loadJson(configPath, null)

  const config = {
    projectId,
    projectName: name || projectId,
    gmailAccount: gmail || '',
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    apiKey: apiKey.trim(),
    status: hasToken ? 'active' : 'pending_auth',
    assignedChannels: existingConfig?.assignedChannels || [],
    createdAt: existingConfig?.createdAt || new Date().toISOString(),
    lastUsedAt: existingConfig?.lastUsedAt || null,
    totalQuotasUsed: existingConfig?.totalQuotasUsed || 0,
  }
  saveJson(configPath, config)
  console.log(`  [config] ${configPath}`)

  // 2. stats.json — quota stats
  const statsPath = path.join(projDir, 'stats.json')
  const existingStats = loadJson(statsPath, null)
  const today = new Date().toISOString().split('T')[0]

  const stats = {
    usedToday: existingStats?.usedToday || 0,
    errors: existingStats?.errors || 0,
    lastUsed: existingStats?.lastUsed || 0,
    lastResetAt: existingStats?.lastResetAt || today,
    unauthorized: existingStats?.unauthorized || false,
  }
  saveJson(statsPath, stats)
  console.log(`  [stats] ${statsPath}`)

  // 3. token.json — OAuth token (empty unless hasToken=true)
  const tokenPath = path.join(projDir, 'token.json')
  if (!fs.existsSync(tokenPath)) {
    const token = hasToken
      ? { access_token: 'REPLACE_WITH_TOKEN', refresh_token: 'REPLACE_WITH_TOKEN', expires_at: 0, token_type: 'Bearer' }
      : { access_token: '', refresh_token: '', expires_at: 0, token_type: '' }
    saveJson(tokenPath, token)
    console.log(`  [token] ${tokenPath} ${hasToken ? '(REPLACE WITH REAL TOKEN)' : '(EMPTY — authorize later)'}`)
  } else {
    console.log(`  [token] ${tokenPath} (already exists)`)
  }

  console.log(`  ✓ ${projectId} created`)
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

/**
 * Import from CSV string (pasted directly into ENTRIES_CSV variable).
 * Format: projectId,apiKey,clientId,clientSecret,gmail,name
 *
 * Usage:
 *   const { parseCSV } = require('./bulk-add-projects.cjs')
 *   parseCSV(csvString)
 */
function parseCSV(csvString) {
  const lines = csvString.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())

  const pidIdx = headers.indexOf('projectid')
  const apiIdx = headers.indexOf('apikey')
  const cidIdx = headers.indexOf('clientid')
  const csecIdx = headers.indexOf('clientsecret')
  const gmailIdx = headers.indexOf('gmail')
  const nameIdx = headers.indexOf('name')
  const hasIdx = headers.indexOf('hastoken')

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim())
    const entry = {
      projectId: cols[pidIdx] || '',
      apiKey: cols[apiIdx] || '',
      clientId: cols[cidIdx] || '',
      clientSecret: cols[csecIdx] || '',
      gmail: cols[gmailIdx] || '',
      name: cols[nameIdx] || '',
      hasToken: hasIdx >= 0 ? cols[hasIdx].toLowerCase() === 'true' : false,
    }
    if (entry.projectId) {
      ENTRIES.push(entry)
      console.log(`  Parsed: ${entry.projectId} (${entry.gmail})`)
    }
  }
  console.log(`\n  Total entries parsed: ${ENTRIES.length}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('\n=== HyperClip Bulk Add Projects ===\n')
console.log(`Data root: ${DATA_ROOT}`)
console.log(`Projects dir: ${PROJECTS_DIR}\n`)

ensureDir(PROJECTS_DIR)

// Count existing projects
const existing = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith('proj-'))
console.log(`Existing projects: ${existing.length}\n`)

let added = 0, skipped = 0

for (const entry of ENTRIES) {
  const { projectId } = entry
  if (!projectId) {
    console.log('[SKIP] Missing projectId')
    skipped++
    continue
  }

  const projDir = path.join(PROJECTS_DIR, projectId)
  const configPath = path.join(projDir, 'config.json')

  if (fs.existsSync(configPath)) {
    const existing = loadJson(configPath)
    // Check if credentials match
    if (existing?.clientId === entry.clientId.trim() &&
        existing?.apiKey === entry.apiKey.trim()) {
      console.log(`[${projectId}] Already exists with same credentials — SKIPPING`)
      skipped++
      continue
    } else {
      console.log(`[${projectId}] Exists but credentials changed — UPDATING`)
    }
  }

  console.log(`\nProcessing: ${projectId} (${entry.name || 'no name'})`)
  try {
    createProjectDir(entry)
    added++
  } catch (e) {
    console.error(`  [ERROR] ${e.message}`)
    skipped++
  }
}

console.log(`\n=== Done ===`)
console.log(`Added/updated: ${added}`)
console.log(`Skipped: ${skipped}`)
console.log(`\nNext steps:`)
if (!ENTRIES.some(e => e.hasToken)) {
  console.log(`1. Open HyperClip → Settings → Projects tab`)
  console.log(`2. Click AUTHORIZE for each project (OAuth browser flow)`)
  console.log(`3. Or run: node scripts/batch-authorize.cjs`)
} else {
  console.log(`1. Replace REPLACE_WITH_TOKEN in projects/*/token.json with real OAuth tokens`)
}
console.log()
