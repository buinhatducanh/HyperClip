/**
 * Batch OAuth Authorization — HyperClip
 * Authorizes all projects that have credentials but no token.
 *
 * Usage:
 *   node scripts/batch-authorize.cjs
 *
 * Flow:
 *   For each project with clientId + clientSecret but no valid token:
 *     1. Try refreshing existing token (if refresh_token exists)
 *     2. If no refresh_token, open browser for manual OAuth flow
 *     3. Save token to projects/proj-XXX/token.json
 *
 * Note: Full OAuth flow requires user interaction in browser.
 * This script is best run with --interactive flag or as a GUI prompt.
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const readline = require('readline')

// ─── Config ─────────────────────────────────────────────────────────────────────

const DATA_ROOT = process.env.HYPERCLIP_DATA_ROOT ||
  path.join(path.dirname(process.argv[1]), '..', 'HyperClip-Data')
const PROJECTS_DIR = path.join(DATA_ROOT, 'projects')

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

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer) })
  })
}

async function refreshToken(clientId, clientSecret, refreshToken) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
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
      res.on('data', c => { data += c })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) throw new Error(json.error_description || json.error)
          resolve({
            access_token: json.access_token,
            refresh_token: json.refresh_token || refreshToken,
            expires_at: Date.now() + (json.expires_in || 3600) * 1000,
            token_type: json.token_type || 'Bearer',
          })
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function startOAuthBrowser(clientId, clientSecret, projectId) {
  const state = Buffer.from(JSON.stringify({ projectId, ts: Date.now() })).toString('base64')
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&redirect_uri=http://localhost:8888/callback` +
    `&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.readonly')}` +
    `&state=${encodeURIComponent(state)}`

  console.log(`\n  OAuth URL for ${projectId}:`)
  console.log(`  ${authUrl}`)
  console.log(`\n  1. Open the URL above in browser`)
  console.log(`  2. Sign in and authorize`)
  console.log(`  3. You'll be redirected to localhost:8888/callback?code=...`)
  console.log(`  4. Copy the "code\" parameter value`)
  console.log(`  5. Paste it here:`)

  const code = await ask('  Code: ')
  if (!code.trim()) {
    console.log('  Skipped.')
    return null
  }

  // Exchange code for tokens
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: code.trim(),
      grant_type: 'authorization_code',
      redirect_uri: 'http://localhost:8888/callback',
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
      res.on('data', c => { data += c })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) throw new Error(json.error_description || json.error)
          resolve({
            access_token: json.access_token,
            refresh_token: json.refresh_token,
            expires_at: Date.now() + (json.expires_in || 3600) * 1000,
            token_type: json.token_type || 'Bearer',
          })
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== HyperClip Batch Authorize ===\n')
  console.log(`Projects dir: ${PROJECTS_DIR}\n`)

  ensureDir(PROJECTS_DIR)

  const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('proj-'))
    .map(e => e.name)

  if (dirs.length === 0) {
    console.log('No projects found. Run bulk-add-projects.cjs first.\n')
    return
  }

  console.log(`Found ${dirs.length} project(s)\n`)

  const interactive = process.argv.includes('--interactive') || process.argv.includes('-i')

  let authorized = 0, skipped = 0, failed = 0

  for (const projectId of dirs) {
    const config = loadJson(path.join(PROJECTS_DIR, projectId, 'config.json'))
    const token = loadJson(path.join(PROJECTS_DIR, projectId, 'token.json'))

    if (!config?.clientId || !config?.clientSecret) {
      console.log(`[${projectId}] SKIP — no OAuth credentials`)
      skipped++
      continue
    }

    // Check if already has valid token
    if (token?.access_token && token?.expires_at > Date.now() + 60 * 1000) {
      console.log(`[${projectId}] OK — token valid (expires ${new Date(token.expires_at).toLocaleString()})`)
      continue
    }

    // Try refreshing existing token
    if (token?.refresh_token) {
      console.log(`[${projectId}] Refreshing token...`)
      try {
        const refreshed = await refreshToken(config.clientId, config.clientSecret, token.refresh_token)
        saveJson(path.join(PROJECTS_DIR, projectId, 'token.json'), refreshed)
        config.status = 'active'
        saveJson(path.join(PROJECTS_DIR, projectId, 'config.json'), config)
        console.log(`  ✓ Token refreshed (expires ${new Date(refreshed.expires_at).toLocaleString()})`)
        authorized++
        continue
      } catch (e) {
        console.log(`  ✗ Refresh failed: ${e.message}`)
        if (!interactive) {
          console.log(`  Skipping (run with --interactive for manual OAuth)`)
          failed++
          continue
        }
      }
    }

    if (!interactive) {
      console.log(`[${projectId}] Needs OAuth — run with --interactive or authorize manually in Settings`)
      skipped++
      continue
    }

    // Interactive: start browser OAuth
    console.log(`\n[${projectId}] Starting OAuth flow...`)
    try {
      const newToken = await startOAuthBrowser(config.clientId, config.clientSecret, projectId)
      if (newToken) {
        saveJson(path.join(PROJECTS_DIR, projectId, 'token.json'), newToken)
        config.status = 'active'
        saveJson(path.join(PROJECTS_DIR, projectId, 'config.json'), config)
        console.log(`  ✓ Token saved (expires ${new Date(newToken.expires_at).toLocaleString()})`)
        authorized++
      } else {
        skipped++
      }
    } catch (e) {
      console.error(`  ✗ Error: ${e.message}`)
      failed++
    }
  }

  console.log(`\n=== Done ===`)
  console.log(`Authorized: ${authorized}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Failed: ${failed}\n`)
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
