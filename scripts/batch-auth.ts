/**
 * Batch OAuth Authorization — HyperClip
 *
 * Authorize all projects in oauth_config.json that don't have tokens yet.
 * Run: npx ts-node scripts/batch-auth.ts
 *
 * Each project opens a browser window. User logs in with Google.
 * After login, token is saved and next project opens automatically.
 */

import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'

function openBrowser(url: string): void {
  // On Windows, use rundll32 to open URL directly (more reliable than spawn)
  if (process.platform === 'win32') {
    try {
      spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', shell: false })
    } catch {}
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' })
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
  }
}

const OAUTH_PORT = 8765
const OAUTH_PORT_MAX = 8775

const TOKENS_DIR = path.join(os.tmpdir(), 'hyperclip-cookies')
const TOKENS_FILE = path.join(TOKENS_DIR, 'oauth_tokens.json')
const CONFIG_FILE = path.join(TOKENS_DIR, 'oauth_config.json')

function getRedirectUri(port: number): string {
  return `http://localhost:${port}/callback`
}

function loadTokens(): any[] {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'))
      return Array.isArray(data) ? data : (data?.access_token ? [data] : [])
    }
  } catch {}
  return []
}

function saveToken(projectId: string, clientId: string, clientSecret: string, tokens: any): void {
  const existing = loadTokens()
  const idx = existing.findIndex(t => (t.projectId || 'proj-01') === projectId)
  const entry = { ...tokens, clientId, clientSecret, projectId }
  if (idx !== -1) {
    existing[idx] = entry
  } else {
    existing.push(entry)
  }
  if (!fs.existsSync(TOKENS_DIR)) fs.mkdirSync(TOKENS_DIR, { recursive: true })
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(existing, null, 2), 'utf-8')
  console.log(`[Auth] Token saved for ${projectId}`)
}

function buildOAuthUrl(clientId: string, port: number): string {
  const scopes = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube'
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(port),
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

function exchangeCode(clientId: string, clientSecret: string, code: string, port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(port),
      code,
      grant_type: 'authorization_code',
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
          if (json.error) {
            reject(new Error(json.error_description || json.error))
            return
          }
          resolve({
            access_token: json.access_token,
            refresh_token: json.refresh_token || '',
            expires_at: Date.now() + (json.expires_in || 3600) * 1000,
            token_type: json.token_type || 'Bearer',
          })
        } catch (e) {
          reject(new Error('Parse error: ' + data.slice(0, 200)))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function authorizeProject(
  projectId: string,
  clientId: string,
  clientSecret: string,
  port: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let server: http.Server | null = null
    let resolved = false
    let timeout: NodeJS.Timeout | undefined

    const finish = (ok: boolean) => {
      if (resolved) return
      resolved = true
      if (server) { try { server.close() } catch {} server = null }
      clearTimeout(timeout)
      resolve(ok)
    }

    server = http.createServer((req, res) => {
      if (resolved) { res.writeHead(404); res.end(); return }

      const url = new URL(req.url || '', `http://localhost:${port}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      console.log(`[Auth] Callback received: error=${error || 'none'}, hasCode=${!!code}`)

      if (error) {
        console.log(`[Auth] OAuth error: ${error}`)
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif"><h2 style="color:#FF4444">Error</h2><p>Authentication cancelled.</p></body></html>')
        res.on('finish', () => { console.log(`[Auth] Response sent, closing...`); finish(false) })
        return
      }

      if (!code) {
        res.writeHead(400)
        res.on('finish', () => finish(false))
        return
      }

      clearTimeout(timeout!)
      exchangeCode(clientId, clientSecret, code, port)
        .then(tokens => {
          console.log(`[Auth] Token exchange OK for ${projectId}`)
          saveToken(projectId, clientId, clientSecret, tokens)
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif"><h2 style="color:#00FF88">Success!</h2><p>You can close this window.</p></body></html>')
          res.on('finish', () => { console.log(`[Auth] Success response sent, closing...`); finish(true) })
        })
        .catch(e => {
          console.error(`[Auth] Token exchange failed for ${projectId}:`, e.message)
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif"><h2 style="color:#FF4444">Failed</h2><p>${e.message}</p></body></html>`)
          res.on('finish', () => { console.log(`[Auth] Failed response sent, closing...`); finish(false) })
        })
    })

    server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE' && port < OAUTH_PORT_MAX) {
        server!.close()
        const nextPort = port + 1
        console.log(`  Port ${port} in use, trying ${nextPort}...`)
        setTimeout(() => {
          server = http.createServer((req, res) => {
            // Same handler — redefined for new server instance
            const url = new URL(req.url || '', `http://localhost:${nextPort}`)
            const code = url.searchParams.get('code')
            const error = url.searchParams.get('error')
            if (error) { res.writeHead(400); res.end('error'); finish(false); return }
            if (!code) { res.writeHead(400); res.end('no code'); finish(false); return }
            clearTimeout(timeout!)
            exchangeCode(clientId, clientSecret, code, nextPort)
              .then(tokens => { saveToken(projectId, clientId, clientSecret, tokens); res.writeHead(200); res.end('ok'); finish(true) })
              .catch(e => { console.error(`[Auth] Failed: ${e.message}`); res.writeHead(200); res.end('failed'); finish(false) })
          })
          server.listen(nextPort, '127.0.0.1', () => {
            const url = buildOAuthUrl(clientId, nextPort)
            console.log(`  Opening: ${projectId} — ${url.slice(0, 80)}...`)
            openBrowser(url)
          })
        }, 100)
      } else {
        console.error(`[Auth] Server error: ${e.message}`)
        finish(false)
      }
    })

    server.listen(port, '127.0.0.1', () => {
      const oauthUrl = buildOAuthUrl(clientId, port)
      console.log(`\n[Auth] Opening browser for: ${projectId}`)
      console.log(`  Client: ${clientId.slice(0, 40)}...`)
      console.log(`  URL: ${oauthUrl}`)
      openBrowser(oauthUrl)
      // 5 minute timeout
      timeout = setTimeout(() => {
        console.log(`[Auth] Timeout for ${projectId} — skipping`)
        finish(false)
      }, 5 * 60 * 1000)
    })
  })
}

async function main() {
  console.log('='.repeat(60))
  console.log('HyperClip — Batch OAuth Authorization')
  console.log('='.repeat(60))

  // Load existing tokens
  const existing = loadTokens()
  const authorizedProjects = new Set(existing.map((t: any) => t.projectId))
  console.log(`Already authorized: ${authorizedProjects.size} projects`)
  if (authorizedProjects.size > 0) {
    ;[...authorizedProjects].forEach(p => console.log(`  - ${p}`))
  }

  // Load config
  let config: Record<string, any> = {}
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    console.error('Failed to load oauth_config.json')
    process.exit(1)
  }

  // Find projects needing auth
  const configProjects = Object.keys(config).filter(k => !['client_id', 'client_secret'].includes(k))
  const needsAuth = configProjects.filter(p => !authorizedProjects.has(p))

  console.log(`\nProjects needing authorization: ${needsAuth.length}`)
  if (needsAuth.length === 0) {
    console.log('All projects already authorized!')
    process.exit(0)
  }

  console.log('\nList:')
  needsAuth.forEach((p, i) => {
    const cred = config[p]
    console.log(`  ${i + 1}. ${p} (${cred?.clientId?.slice(0, 30) || 'NO_CLIENT_ID'}...)`)
  })

  console.log('\n' + '='.repeat(60))
  console.log('INSTRUCTIONS:')
  console.log('- For each project, a browser window will open')
  console.log('- Log in with the Google account for this project')
  console.log('- Approve the permissions')
  console.log('- Wait for "Success!" then the next window opens')
  console.log('- Press Ctrl+C to stop at any time')
  console.log('='.repeat(60))

  let success = 0
  let failed = 0
  const failedProjects: string[] = []

  for (let i = 0; i < needsAuth.length; i++) {
    const projectId = needsAuth[i]
    const cred = config[projectId]
    if (!cred?.clientId || !cred?.clientSecret) {
      console.log(`\n[${i + 1}/${needsAuth.length}] SKIP ${projectId}: no credentials`)
      failed++
      failedProjects.push(projectId)
      continue
    }

    console.log(`\n[${i + 1}/${needsAuth.length}] Authorizing: ${projectId}`)
    const ok = await authorizeProject(projectId, cred.clientId, cred.clientSecret, OAUTH_PORT)
    console.log(`  Result: ${ok ? 'SUCCESS' : 'FAILED/SKIPPED'}`)
    if (ok) {
      success++
      console.log(`  ✓ ${projectId} — authorized successfully`)
    } else {
      failed++
      failedProjects.push(projectId)
      console.log(`  ✗ ${projectId} — failed or skipped`)
    }

    // Small delay between projects to avoid port conflicts
    if (i < needsAuth.length - 1) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('RESULTS:')
  console.log(`  ✓ Success: ${success}`)
  console.log(`  ✗ Failed:  ${failed}`)
  if (failedProjects.length > 0) {
    console.log('\nFailed projects (run app and authorize manually in Settings):')
    failedProjects.forEach(p => console.log(`  - ${p}`))
  }
  console.log('='.repeat(60))
  console.log('\nRestart HyperClip to load the new tokens.')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
