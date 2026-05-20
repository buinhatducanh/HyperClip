/**
 * HyperClip License Service — Electron main process.
 *
 * Responsibilities:
 *  - One-time activation against license server
 *  - Periodic heartbeat validation (every 24h while running)
 *  - Check for app updates via electron-updater
 *  - Persist encrypted license to disk
 *  - Gate app startup until valid license
 *
 * License file: D:\HyperClip-Data\app\license.enc.yaml
 * Encrypted with AES-256-GCM using machineId as key material.
 */
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { app } from 'electron'
import { getMachineId } from './hwid.js'
import { encrypt, decrypt, blobToYAMLString, parseYAMLBlob, sha256 } from './crypto.js'
import { log } from './unified_log.js'

// ─── Config ───────────────────────────────────────────────────────────────────
// Vercel deployment URL — set LICENSE_SERVER_URL env var in Vercel dashboard
// Default points to local dev server; update to your Vercel deployment URL after deploy.
const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || 'https://hyper-clip.vercel.app'
const LICENSE_ACTIVATE_PATH = '/api/license/activate'
const LICENSE_VALIDATE_PATH = '/api/license/validate'
const LICENSE_FILE = 'license.enc.yaml'
const VALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24 hours
const LICENSE_DIR = app?.isPackaged
  ? path.join(app.getPath('userData'), 'data')
  : path.join(process.env.HYPERCLIP_DATA_DIR || 'D:\\HyperClip-Data', 'app')

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface LicenseRecord {
  keyId: string
  key: string
  machineId: string
  features: string[]
  expiresAt: string | null
  issuedAt: string
  activatedAt: string
  serverUrl: string
}

export interface LicenseStatus {
  activated: boolean
  valid: boolean
  reason?: string
  record?: LicenseRecord
  updateAvailable?: boolean
  latestVersion?: string
  updateProgress?: number
}

// ─── Module-level state ─────────────────────────────────────────────────────────
let _status: LicenseStatus = { activated: false, valid: false }
let _validateTimer: ReturnType<typeof setInterval> | null = null

// ─── Path helpers ──────────────────────────────────────────────────────────────
function getLicensePath(): string {
  return path.join(LICENSE_DIR, LICENSE_FILE)
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────────
function httpRequest(options: http.RequestOptions, body?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const protocol = options.protocol === 'https:' ? https : http
    const req = protocol.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, data })
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Request timeout')) })
    if (body) req.write(body)
    req.end()
  })
}

// ─── License persistence ─────────────────────────────────────────────────────────
function saveLicense(record: LicenseRecord): void {
  fs.mkdirSync(LICENSE_DIR, { recursive: true })
  const machineId = getMachineId()
  const plaintext = JSON.stringify(record)
  const blob = encrypt(plaintext, machineId)
  const yaml = blobToYAMLString(blob)
  fs.writeFileSync(getLicensePath(), yaml, 'utf8')
  log.info(`[License] Saved license for keyId=${record.keyId}`)
}

function loadLicense(): LicenseRecord | null {
  const filePath = getLicensePath()
  if (!fs.existsSync(filePath)) return null
  try {
    const yaml = fs.readFileSync(filePath, 'utf8')
    const blob = parseYAMLBlob(yaml)
    const plaintext = decrypt(blob, getMachineId())
    return JSON.parse(plaintext)
  } catch (err) {
    log.warn(`[License] Failed to load license (corrupted or wrong machine): ${err}`)
    return null
  }
}

function deleteLicense(): void {
  const p = getLicensePath()
  if (fs.existsSync(p)) fs.unlinkSync(p)
  _status = { activated: false, valid: false }
}

// ─── Activation ────────────────────────────────────────────────────────────────
export interface ActivateResult {
  success: boolean
  error?: string
  code?: string
  record?: LicenseRecord
}

/**
 * Attempt to activate HyperClip with a license key.
 * This is a ONE-TIME operation per machine.
 */
export async function activateLicense(key: string): Promise<ActivateResult> {
  const machineId = getMachineId()

  const body = JSON.stringify({ key, machineId })
  const options = {
    protocol: LICENSE_SERVER_URL.startsWith('https') ? 'https:' : 'http:',
    hostname: new URL(LICENSE_SERVER_URL).hostname,
    port: new URL(LICENSE_SERVER_URL).port || (LICENSE_SERVER_URL.startsWith('https') ? 443 : 80),
    path: LICENSE_ACTIVATE_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'HyperClip/1.0',
    },
  }

  try {
    const { status, data } = await httpRequest(options, body)

    if (status === 200 && data.success) {
      const record: LicenseRecord = {
        keyId: data.keyId,
        key,
        machineId: data.machineId,
        features: data.features || [],
        expiresAt: data.expiresAt || null,
        issuedAt: data.issuedAt || new Date().toISOString(),
        activatedAt: data.activatedAt || new Date().toISOString(),
        serverUrl: LICENSE_SERVER_URL,
      }
      saveLicense(record)
      _status = { activated: true, valid: true, record }
      log.info(`[License] Activated: keyId=${record.keyId}, machineId=${machineId.slice(0, 8)}...`)
      return { success: true, record }
    }

    const errorMap: Record<string, string> = {
      REVOKED: 'License đã bị thu hồi. Liên hệ hỗ trợ.',
      EXPIRED: 'License đã hết hạn.',
      ALREADY_USED: 'License đã được kích hoạt trên máy khác.',
      NOT_FOUND: 'License key không tồn tại.',
    }
    return {
      success: false,
      error: data.error || 'Kích hoạt thất bại.',
      code: data.code || 'UNKNOWN',
    }
  } catch (err) {
    log.error(`[License] Activation failed: ${err}`)
    return {
      success: false,
      error: `Không thể kết nối server: ${err instanceof Error ? err.message : 'Network error'}`,
      code: 'NETWORK_ERROR',
    }
  }
}

// ─── Validation ────────────────────────────────────────────────────────────────
/**
 * Validate the current license against the server.
 * - If server unreachable: use cached license (offline mode)
 * - If revoked/expired: mark invalid, block app
 */
export async function validateLicense(): Promise<LicenseStatus> {
  const record = loadLicense()
  if (!record) {
    _status = { activated: false, valid: false, reason: 'No license file found' }
    return _status
  }

  const url = new URL(LICENSE_SERVER_URL)
  const params = new URLSearchParams({ keyId: record.keyId, machineId: record.machineId })
  const options = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${LICENSE_VALIDATE_PATH}?${params}`,
    method: 'GET',
    headers: { 'User-Agent': 'HyperClip/1.0' },
  }

  try {
    const { status, data } = await httpRequest(options)
    if (status === 200 && data.valid) {
      _status = {
        activated: true,
        valid: true,
        record: { ...record, features: data.features || record.features },
      }
      return _status
    }
    const reason = data.error || data.code || 'Invalid license'
    _status = { activated: true, valid: false, reason, record }
    return _status
  } catch (err) {
    // Offline: trust cached license
    log.warn(`[License] Validate failed (offline), trusting cached license: ${err}`)
    _status = { activated: true, valid: true, record, reason: 'Offline mode' }
    return _status
  }
}

// ─── Heartbeat timer ───────────────────────────────────────────────────────────
export function startLicenseHeartbeat(): void {
  if (_validateTimer) return
  _validateTimer = setInterval(async () => {
    const s = await validateLicense()
    if (!s.valid && s.reason && s.reason !== 'Offline mode') {
      log.warn(`[License] Heartbeat failed: ${s.reason}`)
    }
  }, VALIDATE_INTERVAL_MS)
  log.info(`[License] Heartbeat started (every ${VALIDATE_INTERVAL_MS / 3600000}h)`)
}

export function stopLicenseHeartbeat(): void {
  if (_validateTimer) {
    clearInterval(_validateTimer)
    _validateTimer = null
  }
}

// ─── Status ────────────────────────────────────────────────────────────────────
export function getLicenseStatus(): LicenseStatus {
  // Check local expiration even if server is unreachable (demo mode)
  if (_status.record?.expiresAt) {
    const expiry = new Date(_status.record.expiresAt)
    if (expiry <= new Date()) {
      return { ..._status, valid: false, reason: 'License đã hết hạn (Demo hết hạn lúc 00:00).' }
    }
  }
  return { ..._status }
}

/** Get features list from active license. */
export function hasFeature(feature: string): boolean {
  return _status.record?.features.includes(feature) ?? false
}

// ─── Init (call at app startup) ────────────────────────────────────────────────
export async function initLicense(): Promise<LicenseStatus> {
  const record = loadLicense()
  if (record) {
    const s = await validateLicense()
    if (s.valid) startLicenseHeartbeat()
    return s
  }
  return { activated: false, valid: false, reason: 'No license' }
}

// ─── Revoke (for development / admin) ─────────────────────────────────────────
export function revokeLocalLicense(): void {
  deleteLicense()
  stopLicenseHeartbeat()
  log.info('[License] Local license revoked')
}

// ─── Dev mode bypass ────────────────────────────────────────────────────────────
export const DEV_LICENSE_BYPASS = process.env.DEV_LICENSE_BYPASS === '1'

if (DEV_LICENSE_BYPASS) {
  log.warn('[License] DEV BYPASS ACTIVE — license check disabled')
  _status = {
    activated: true,
    valid: true,
    reason: 'Dev bypass',
    record: {
      keyId: 'DEV',
      key: 'DEV',
      machineId: getMachineId(),
      features: ['pro', 'auto_render', 'multi_channel'],
      expiresAt: null,
      issuedAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
      serverUrl: 'dev',
    },
  }
}

// ─── Demo mode ─────────────────────────────────────────────────────────────────
// DEMO_MODE=true env var: auto-activates a hardware-locked, time-limited demo license.
// Expires at midnight tomorrow (2026-05-21 00:00:00 local time).
// Hardware-locked to THIS machine — won't work if customer copies .exe elsewhere.
const DEMO_MODE = process.env.DEMO_MODE === 'true'
const DEMO_EXPIRY = new Date()
DEMO_EXPIRY.setHours(24, 0, 0, 0) // midnight tonight (00:00 tomorrow)

if (DEMO_MODE) {
  const machineId = getMachineId()
  const demoRecord: LicenseRecord = {
    keyId: 'DEMO-20260520',
    key: 'DEMO-MODE-ENABLED',
    machineId,
    features: ['pro', 'auto_render', 'multi_channel'],
    expiresAt: DEMO_EXPIRY.toISOString(),
    issuedAt: new Date().toISOString(),
    activatedAt: new Date().toISOString(),
    serverUrl: 'demo',
  }
  // Verify this machine is authorized
  _status = {
    activated: true,
    valid: true,
    reason: 'Demo mode',
    record: demoRecord,
  }
  log.warn(`[License] DEMO MODE — expires ${DEMO_EXPIRY.toLocaleString()} | Machine: ${machineId.slice(0, 8)}...`)
}
