/**
 * HyperClip License Server — Lightweight Node.js backend.
 *
 * Handles:
 *  - License activation (one-time hwId binding)
 *  - Periodic validation / heartbeat
 *  - Admin revocation
 *  - Update manifest delivery
 *
 * Run: node index.js  (default port 3001)
 * Env:
 *   PORT=3001
 *   ADMIN_TOKEN=secret   — admin API auth
 *   LICENSE_DB=./db/licenses.json
 *   UPDATES_DIR=./updates  — directory serving update zips + manifests
 *   PUBLIC_KEY=./keys/public.pem  — RSA public key for client-side verify
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT || '3001', 10)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'hyperclip-admin-secret-2026'
const LICENSE_DB = process.env.LICENSE_DB || path.join(__dirname, 'db', 'licenses.json')
const UPDATES_DIR = process.env.UPDATES_DIR || path.join(__dirname, 'updates')
const PUBLIC_KEY_FILE = process.env.PUBLIC_KEY || path.join(__dirname, 'keys', 'public.pem')

// ─── DB helpers ─────────────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(LICENSE_DB)) return []
  return JSON.parse(fs.readFileSync(LICENSE_DB, 'utf8'))
}
function saveDB(records) {
  fs.mkdirSync(path.dirname(LICENSE_DB), { recursive: true })
  fs.writeFileSync(LICENSE_DB, JSON.stringify(records, null, 2))
}

// ─── Rate limiter (simple in-memory) ──────────────────────────────────────────
const rateLimits = new Map() // key → { count, resetAt }
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 20           // requests per window per IP

function checkRateLimit(ip) {
  const now = Date.now()
  const entry = rateLimits.get(ip)
  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_MAX) return false
  entry.count++
  return true
}

// ─── CORS ───────────────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// ─── Auth middleware ────────────────────────────────────────────────────────────
function adminAuth(req) {
  const token = req.headers['authorization']?.replace('Bearer ', '')
  return token === ADMIN_TOKEN
}

// ─── Routes ────────────────────────────────────────────────────────────────────
const routes = {
  // POST /activate — bind hwId to key (one-time)
  activate(req, res, ip) {
    if (!checkRateLimit(ip)) {
      return sendJSON(res, 429, { success: false, error: 'Too many requests. Try again later.' })
    }

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { key, machineId } = JSON.parse(body)

    if (!key || typeof key !== 'string' || !machineId || typeof machineId !== 'string') {
      return sendJSON(res, 400, { success: false, error: 'Missing key or machineId' })
    }

    // Normalize key (uppercase, trim)
    const normalizedKey = key.trim().toUpperCase()
    const db = loadDB()
    const record = db.find(r => r.key.toUpperCase() === normalizedKey)

    // Demo key activation: DEMO-{days}-{suffix} → create ephemeral record on the fly
    if (!record && normalizedKey.startsWith('DEMO-')) {
      const match = normalizedKey.match(/^DEMO-(\d{1,2})-([A-Z0-9]{3,8})$/)
      if (!match) {
        return sendJSON(res, 400, { success: false, error: 'Invalid demo key format. Use: DEMO-{days}-{suffix}', code: 'INVALID_KEY' })
      }
      const days = parseInt(match[1], 10)
      if (days < 1 || days > 2) {
        return sendJSON(res, 400, { success: false, error: 'Demo key duration must be 1-2 days.', code: 'INVALID_KEY' })
      }
      // Check for re-activation (same machine)
      const existing = db.find(r => r.key.toUpperCase() === normalizedKey && r.hwId === machineId)
      if (existing) {
        return sendJSON(res, 200, {
          success: true, keyId: existing.keyId,
          features: existing.features,
          expiresAt: existing.expiresAt,
          machineId,
        })
      }
      const expiry = new Date()
      expiry.setDate(expiry.getDate() + days)
      expiry.setHours(0, 0, 0, 0)
      const keyId = `D-${Date.now().toString(36).toUpperCase()}-${match[2]}`
      const newRecord = {
        keyId,
        key: normalizedKey,
        hwId: machineId,
        used: true,
        revoked: false,
        maxSeats: 1,
        expiresAt: expiry.toISOString(),
        features: ['pro', 'auto_render', 'multi_channel'],
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        activatedAt: new Date().toISOString(),
        activatedIp: ip,
        createdAt: new Date().toISOString(),
      }
      db.push(newRecord)
      saveDB(db)
      console.log(`[Demo] Activated: ${keyId} | machine: ${machineId.slice(0, 8)}... | expires: ${expiry.toISOString()}`)
      return sendJSON(res, 200, {
        success: true, keyId,
        expiresAt: expiry.toISOString(),
        features: newRecord.features,
        issuedAt: newRecord.activatedAt,
        activatedAt: newRecord.activatedAt,
      })
    }

    if (!record) {
      return sendJSON(res, 404, { success: false, error: 'License key not found' })
    }
    if (record.revoked) {
      return sendJSON(res, 403, {
        success: false,
        error: 'This license has been revoked. Please contact support.',
        code: 'REVOKED',
      })
    }
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return sendJSON(res, 403, {
        success: false,
        error: 'This license has expired.',
        code: 'EXPIRED',
      })
    }
    if (record.used && record.hwId !== machineId) {
      return sendJSON(res, 409, {
        success: false,
        error: 'This license has already been activated on another machine.',
        code: 'ALREADY_USED',
      })
    }
    if (record.used && record.hwId === machineId) {
      // Same machine re-activating — refresh token, return success
      return sendJSON(res, 200, {
        success: true,
        keyId: record.keyId,
        features: record.features,
        expiresAt: record.expiresAt,
        machineId: record.hwId,
        message: 'Already activated on this machine.',
      })
    }

    // First-time activation
    record.hwId = machineId
    record.used = true
    record.activatedAt = new Date().toISOString()
    record.activatedIp = ip
    saveDB(db)

    return sendJSON(res, 200, {
      success: true,
      keyId: record.keyId,
      features: record.features,
      expiresAt: record.expiresAt,
      machineId,
      issuedAt: record.activatedAt,
    })
      } catch (err) {
        sendJSON(res, 400, { success: false, error: 'Bad request' })
      }
    })
  },

  // GET /validate?keyId=...&machineId=... — heartbeat / check not revoked
  validate(req, res, ip) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const keyId = url.searchParams.get('keyId')
    const machineId = url.searchParams.get('machineId')

    if (!keyId || !machineId) {
      return sendJSON(res, 400, { valid: false, error: 'Missing keyId or machineId' })
    }

    const db = loadDB()
    const record = db.find(r => r.keyId === keyId)

    if (!record) {
      return sendJSON(res, 200, { valid: false, error: 'Key not found', code: 'NOT_FOUND' })
    }
    if (record.hwId !== machineId) {
      return sendJSON(res, 200, {
        valid: false,
        error: 'Machine ID mismatch — possible license transfer.',
        code: 'HWID_MISMATCH',
      })
    }
    if (record.revoked) {
      return sendJSON(res, 200, { valid: false, error: 'License revoked', code: 'REVOKED' })
    }
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return sendJSON(res, 200, { valid: false, error: 'License expired', code: 'EXPIRED' })
    }

    return sendJSON(res, 200, {
      valid: true,
      keyId: record.keyId,
      features: record.features,
      expiresAt: record.expiresAt,
    })
  },

  // POST /revoke — admin: revoke a license
  revoke(req, res) {
    if (!adminAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' })
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { keyId } = JSON.parse(body)
        const db = loadDB()
        const record = db.find(r => r.keyId === keyId)
        if (!record) return sendJSON(res, 404, { error: 'Key not found' })
        record.revoked = true
        saveDB(db)
        sendJSON(res, 200, { success: true, message: `License ${keyId} revoked` })
      } catch {
        sendJSON(res, 400, { error: 'Bad request' })
      }
    })
  },

  // POST /generate — admin: create a new license key
  generate(req, res) {
    if (!adminAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' })
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { customerName, customerEmail, customerPhone, maxSeats, features, expiresAt } = JSON.parse(body)
        const keyId = `HYP-2026-${String(Date.now()).slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
        const key = `HYP-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
        const record = {
          keyId, key, hwId: null, used: false, revoked: false,
          maxSeats: maxSeats || 1, expiresAt: expiresAt || null,
          features: features || ['pro'],
          customerName: customerName || '', customerEmail: customerEmail || '', customerPhone: customerPhone || '',
          activatedAt: null, activatedIp: null, createdAt: new Date().toISOString(),
        }
        const db = loadDB()
        db.push(record)
        saveDB(db)
        sendJSON(res, 201, { success: true, keyId, key, record })
      } catch {
        sendJSON(res, 400, { error: 'Bad request' })
      }
    })
  },

  // POST /generate-demo — admin: create a time-limited demo key
  generateDemo(req, res) {
    if (!adminAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' })
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { days, customKey, machineId } = JSON.parse(body)
        const MAX_DAYS = 2
        const useDays = (days && days >= 1 && days <= MAX_DAYS) ? days : MAX_DAYS
        const suffix = customKey
          ? customKey.toUpperCase().trim().slice(0, 8)
          : crypto.randomBytes(3).toString('hex').toUpperCase()
        const key = `DEMO-${useDays}-${suffix}`
        const keyId = `D-${Date.now().toString(36).toUpperCase()}-${suffix}`
        const expiry = new Date()
        expiry.setDate(expiry.getDate() + useDays)
        expiry.setHours(0, 0, 0, 0)
        const record = {
          keyId, key,
          hwId: machineId || null, used: !!machineId, revoked: false, maxSeats: 1,
          expiresAt: expiry.toISOString(),
          features: ['pro', 'auto_render', 'multi_channel'],
          customerName: '', customerEmail: '', customerPhone: '',
          activatedAt: machineId ? new Date().toISOString() : null,
          activatedIp: null, createdAt: new Date().toISOString(),
        }
        const db = loadDB()
        db.push(record)
        saveDB(db)
        console.log(`[Admin] Generated demo key: ${key} | keyId: ${keyId} | expires: ${expiry.toISOString()}`)
        sendJSON(res, 201, {
          success: true, keyId, key,
          expiresAt: expiry.toISOString(), days: useDays,
        })
      } catch {
        sendJSON(res, 400, { error: 'Bad request' })
      }
    })
  },

  // GET /keys — admin: list all licenses
  listKeys(req, res) {
    if (!adminAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' })
    const db = loadDB()
    // Strip sensitive fields
    const sanitized = db.map(({ key, hwId, activatedIp, ...rest }) => ({
      ...rest,
      usedByHwId: hwId ? `${hwId.slice(0, 8)}...${hwId.slice(-4)}` : null,
    }))
    return sendJSON(res, 200, { keys: sanitized })
  },

  // GET /updates/:version/manifest.json — serve update manifest
  getManifest(req, res) {
    const url = new URL(req.url, `http://localhost`)
    const manifestPath = path.join(UPDATES_DIR, 'manifest.json')

    if (!fs.existsSync(manifestPath)) {
      return sendJSON(res, 404, { error: 'No updates available' })
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    })
    res.end(JSON.stringify(manifest))
  },

  // GET /updates/:version/:file — serve update files
  serveUpdate(req, res) {
    const url = new URL(req.url, `http://localhost`)
    const filename = path.basename(url.pathname)
    const safeFile = path.basename(filename) // prevent path traversal
    const filePath = path.join(UPDATES_DIR, safeFile)

    if (!fs.existsSync(filePath)) {
      res.writeHead(404)
      return res.end('Not found')
    }

    const stat = fs.statSync(filePath)
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400',
    })
    fs.createReadStream(filePath).pipe(res)
  },

  // GET /health
  health(req, res) {
    sendJSON(res, 200, { status: 'ok', uptime: process.uptime() })
  },
}

// ─── Router ────────────────────────────────────────────────────────────────────
function route(req, res, ip) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  // Always use 127.0.0.1 as base to avoid IPv6 URL parsing issues
  const url = new URL(req.url, 'http://127.0.0.1')

  if (req.method === 'POST' && url.pathname === '/activate') return routes.activate(req, res, ip)
  if (req.method === 'GET' && url.pathname === '/validate') return routes.validate(req, res, ip)
  if (req.method === 'POST' && url.pathname === '/revoke') return routes.revoke(req, res)
  if (req.method === 'POST' && url.pathname === '/generate') return routes.generate(req, res)
  if (req.method === 'POST' && url.pathname === '/generate-demo') return routes.generateDemo(req, res)
  if (req.method === 'GET' && url.pathname === '/keys') return routes.listKeys(req, res)
  if (req.method === 'GET' && url.pathname === '/health') return routes.health(req, res)
  if (url.pathname === '/manifest.json') return routes.getManifest(req, res)
  if (url.pathname.startsWith('/updates/')) return routes.serveUpdate(req, res)

  sendJSON(res, 404, { error: 'Not found' })
}

// ─── Server ─────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress?.replace('::ffff:', '')
    || '127.0.0.1'

  try {
    route(req, res, ip)
  } catch (err) {
    console.error('[LicenseServer] Error:', err.message, '| url:', req.url, '| stack:', err.stack?.slice(0, 200))
    sendJSON(res, 500, { error: 'Internal server error: ' + err.message })
  }
})

server.listen(PORT, () => {
  console.log(`[HyperClip License Server] Running on http://localhost:${PORT}`)
  console.log(`[HyperClip License Server] Admin token: ${ADMIN_TOKEN}`)
})

// Graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0) })
process.on('SIGINT', () => { server.close(); process.exit(0) })
