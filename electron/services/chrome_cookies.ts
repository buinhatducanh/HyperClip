/**
 * Chrome Cookie Extraction — HyperClip
 *
 * Extracts YouTube session cookies from Chrome profiles using DPAPI + SQLite.
 * Generates SAPISIDHASH headers for YouTube Innertube API authentication.
 *
 * Architecture:
 * 1. Launch Chrome with a dedicated HyperClip profile (if not logged in)
 * 2. Extract YouTube cookies from the profile's SQLite DB
 * 3. Generate SAPISIDHASH = SHA1(timestamp + " " + SAPISID + " " + origin)
 * 4. Use Innertube API (youtube.com/youtubei/v1/*) with cookie auth
 *
 * Innertube API has no published quota limit (vs Data API v3's 10k/day per project).
 * With 30 Chrome profiles (30 sessions) = effectively unlimited quota.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { app, shell } from 'electron'
import initSqlJs from 'sql.js'
import { devLog } from './unified_log.js'
import { getChromeProfilesDir } from './paths.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface YouTubeCookies {
  SAPISID: string
  PSID: string       // __Secure-1PSID
  PSIDCC?: string   // __Secure-1PSIDCC (needed for some requests)
  PSIDTS?: string  // __Secure-1PSIDTS
  socs?: string    // SOCS consent cookie (CAI = accepted, CAA = not logged in)
}

export interface ChromeSession {
  profileId: string
  profileName: string
  profileDir: string
  cookies: YouTubeCookies | null
  usedToday: number
  lastUsed: number
  error?: string
  isLoggedIn: boolean
  wasLoggedIn: boolean
  isConsented: boolean  // true if SOCS cookie = CAI (user accepted Google terms)
  /** Real SOCS value before forced CAI injection — for UI display */
  rawSocs: string | null
  /** Timestamp of last successful cookie refresh (epoch ms) */
  lastRefreshAt: number
  /** Consecutive refresh failures — for degradation detection */
  refreshFailCount: number
}

/** Sanitized session data sent to renderer — NEVER includes cookies or sensitive fields */
export interface SessionPublic {
  profileId: string
  profileName: string
  usedToday: number
  lastUsed: number
  error?: string
  isLoggedIn: boolean
  wasLoggedIn: boolean
  isConsented: boolean
  refreshFailCount: number
  /** Whether the session has been initialized with Chrome cookies */
  hasCookies: boolean
}

/** Sanitize a session object — strips all sensitive data before IPC */
export function toSessionPublic(s: ChromeSession): SessionPublic {
  return {
    profileId: s.profileId,
    profileName: s.profileName,
    usedToday: s.usedToday,
    lastUsed: s.lastUsed,
    error: s.error,
    isLoggedIn: s.isLoggedIn,
    wasLoggedIn: s.wasLoggedIn,
    isConsented: s.isConsented,
    refreshFailCount: s.refreshFailCount,
    hasCookies: s.cookies !== null,
    // STRIP: cookies, rawSocs, profileDir — never send to renderer
  }
}

export interface SessionStatus {
  ready: boolean
  sessionCount: number
  loggedInCount: number
  consentedCount: number
  sessions: SessionPublic[]
  /** Cookie health metrics */
  health: {
    /** Percentage of sessions with valid cookies (0-100) */
    healthPct: number
    /** Sessions that were logged in but lost cookies */
    degradedCount: number
    /** Sessions with cookies older than 7 days since last refresh */
    staleCount: number
    /** Oldest cookie age in hours across all sessions */
    oldestCookieAgeHours: number
    /** 'healthy' | 'degraded' | 'critical' */
    level: 'healthy' | 'degraded' | 'critical'
  }
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')

// Dedicated HyperClip profile directory (created by us) — stored at D:\HyperClip-Data\chrome-profiles
export function getHyperClipProfileDir(profileId: string): string {
  return path.join(getChromeProfilesDir(), `profile-${profileId}`)
}

// User's default Chrome profile (already logged in)
export function getDefaultChromeProfileDir(): string {
  // Chrome stores the default profile at User Data\Default
  return path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default')
}

// Chrome installation path
export function getChromeExe(): string {
  const chromePath = path.join(
    process.env['PROGRAMFILES'] || 'C:\\Program Files',
    'Google', 'Chrome', 'Application', 'chrome.exe'
  )
  if (fs.existsSync(chromePath)) return chromePath

  // Try other paths
  const altPaths = [
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]
  for (const p of altPaths) {
    if (fs.existsSync(p)) return p
  }
  return chromePath
}

// ─── DPAPI Decryption ────────────────────────────────────────────────────────

/**
 * Decrypt Chrome's encrypted key from Local State via DPAPI (CurrentUser scope).
 * Chrome v80+ uses a 2-level encryption:
 *   1. Local State encrypted_key: v10 prefix + DPAPI-wrapped AES key
 *   2. Cookie values: encrypted with AES-256-GCM using the AES key from step 1
 *
 * Chrome v80+ format for encrypted_key in Local State:
 *   v10 (3 bytes) + nonce (12 bytes) + DPAPI_wrapped_key + authTag (16 bytes)
 * We DPAPI-unprotect the middle portion to get the raw AES key bytes.
 *
 * @returns 32-byte AES key as Buffer, or null if decryption fails.
 */
export async function decryptDPAPIKey(localStatePath: string): Promise<Buffer | null> {
  try {
    const raw = fs.readFileSync(localStatePath, 'utf-8')
    const json = JSON.parse(raw)
    const encryptedKeyB64 = json.os_crypt?.encrypted_key
    if (!encryptedKeyB64) {
      devLog(`[DPAPI] No os_crypt.encrypted_key in ${localStatePath}. Keys: ${Object.keys(json).join(', ')}`)
      return null
    }

    const encryptedKey = Buffer.from(encryptedKeyB64, 'base64')
    const prefix = encryptedKey.slice(0, 3).toString('ascii')

    if (prefix === 'v10') {
      // Chrome v80+: v10 prefix + nonce(12) + encrypted_key_bytes + authTag(16)
      // The encrypted_key_bytes is DPAPI-wrapped — unwrap it to get raw AES key
      const nonce = encryptedKey.slice(3, 15)
      const encryptedKeyBytes = encryptedKey.slice(15, -16)
      const authTag = encryptedKey.slice(-16)

      // DPAPI unwrap the encrypted AES key bytes
      const keyData = encryptedKeyBytes.toString('base64')
      const result = await runPowerShellSync(
        `Add-Type -AssemblyName System.Security; ` +
        `$encrypted = [Convert]::FromBase64String('${keyData}'); ` +
        `$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
        `$encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
        `[Convert]::ToBase64String($decrypted)`
      )
      if (!result) {
        devLog(`[DPAPI] v10: PowerShell DPAPI unwrap returned null`)
        return null
      }
      const aesKey = Buffer.from(result.trim(), 'base64')
      devLog(`[DPAPI] v10: Decrypted AES key OK (${aesKey.length} bytes, nonce=${nonce.length}, tag=${authTag.length})`)
      return aesKey
    } else if (prefix === 'DPA') {
      // Old Chrome v<80: just DPAPI-encrypted, result is raw AES key
      const keyData = encryptedKey.slice(5).toString('base64')
      const result = await runPowerShellSync(
        `Add-Type -AssemblyName System.Security; ` +
        `$encrypted = [Convert]::FromBase64String('${keyData}'); ` +
        `$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
        `$encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
        `[Convert]::ToBase64String($decrypted)`
      )
      if (!result) {
        devLog(`[DPAPI] DPA: PowerShell returned null`)
        return null
      }
      devLog(`[DPAPI] DPA: Decrypted key OK (${result.length} chars)`)
      return Buffer.from(result.trim(), 'base64')
    } else {
      // Unknown format — try raw base64 as AES key
      devLog(`[DPAPI] Unknown prefix: ${prefix} (${encryptedKey.slice(0, 5).toString('hex')}). Trying raw base64.`)
      return encryptedKey
    }
  } catch (e) {
    devLog(`[DPAPI] Exception: ${e}`)
    return null
  }
}

/** Spawn PowerShell and return stdout. Returns null on failure. */
function runPowerShellSync(script: string, timeoutMs = 15000): string | null {
  return new Promise<string | null>((resolve) => {
    const ps = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = ''
    ps.stdout.on('data', (d) => { stdout += d.toString() })
    ps.stderr.on('data', (d) => { stderr += d.toString() })
    ps.on('close', (code) => {
      if (code === 0 && stdout.trim()) resolve(stdout.trim())
      else resolve(null)
    })
    ps.on('error', () => resolve(null))
    setTimeout(() => { try { ps.kill() } catch {} resolve(null) }, timeoutMs)
  }) as unknown as string | null
}

/** Spawn PowerShell async — for non-blocking operations */
function runPowerShellAsync(script: string, timeoutMs = 30000): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const ps = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = ''
    ps.stdout.on('data', (d) => { stdout += d.toString() })
    ps.stderr.on('data', (d) => { stderr += d.toString() })
    ps.on('close', (code) => {
      resolve(code === 0 && stdout.trim() ? stdout.trim() : null)
    })
    ps.on('error', () => resolve(null))
    setTimeout(() => { try { ps.kill() } catch {} resolve(null) }, timeoutMs)
  })
}

// ─── Cookie Decryption ────────────────────────────────────────────────────────

/**
 * Decrypt Chrome's encrypted cookie value using the DPAPI-decrypted AES key.
 *
 * Chrome cookie encryption formats:
 * - v1 (DPAPI only): just DPAPI-encrypted bytes → DPAPI Unprotect
 * - v10 (AES-256-GCM): version byte + nonce(12) + ciphertext + authTag(16)
 *
 * Chrome v80+ uses v10 for encrypted cookie values.
 * Chrome v79- uses v1.
 */
function decryptCookieValue(encrypted: Buffer, aesKey: Buffer): string | null {
  try {
    const prefix = encrypted.slice(0, 5).toString('hex')

    // v1: just DPAPI-encrypted → DPAPI Unprotect
    if (prefix === '4450415049') {
      const keyData = encrypted.slice(5).toString('base64')
      const result = runPowerShellSync(
        `Add-Type -AssemblyName System.Security; ` +
        `$encrypted = [Convert]::FromBase64String('${keyData}'); ` +
        `$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
        `$encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
        `[Convert]::ToBase64String($decrypted)`
      )
      if (!result) return null
      return Buffer.from(result.trim(), 'base64').toString('utf8')
    }

    // v10: AES-256-GCM — format: version(1) + nonce(12) + ciphertext + tag(16)
    // aesKey is the raw 32-byte AES key (obtained via DPAPI unwrap of Local State's encrypted_key)
    if (encrypted[0] === 0x76) {
      // Determine format:
      // v10 (Chrome v79): v10(3) + nonce(12) + ciphertext + tag(16) → use aesKey directly
      // v20 (Chrome v127+): v20(3) + key_id_len(ULEB128) + key_id + salt(16) + nonce(12) + ct + tag(16)
      // Check if the 4th byte is 0xCC (v20 signature) vs another value (v10)
      if (encrypted.length >= 4 && encrypted[3] === 0xCC) {
        // v20: parse ULEB128 key_id_len
        let pos = 4
        let keyIdLen = 0, shift = 0
        while (pos < encrypted.length) {
          const b = encrypted[pos++]
          keyIdLen |= (b & 0x7F) << shift
          if ((b & 0x80) === 0) break
          shift += 7
        }
        const salt = encrypted.slice(pos + keyIdLen, pos + keyIdLen + 16)
        const nonce = encrypted.slice(pos + keyIdLen + 16, pos + keyIdLen + 16 + 12)
        const ctWithTag = encrypted.slice(pos + keyIdLen + 28)
        const tag = ctWithTag.slice(-16)
        const ct = ctWithTag.slice(0, -16)
        // Derive per-cookie key: SHA256(masterKey + salt)
        const cookieKey = crypto.createHash('sha256').update(Buffer.concat([aesKey, salt])).digest()
        try {
          const decipher = crypto.createDecipheriv('aes-256-gcm', cookieKey, nonce)
          decipher.setAuthTag(tag)
          return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
        } catch {
          return null
        }
      }
      // v10: use aesKey directly
      const nonce = encrypted.slice(1, 13)
      const ciphertextWithTag = encrypted.slice(13)
      const tag = ciphertextWithTag.slice(-16)
      const ciphertext = ciphertextWithTag.slice(0, -16)
      const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce)
      decipher.setAuthTag(tag)
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return decrypted.toString('utf8')
    }

    // Unknown format — try as DPAPI
    const result = runPowerShellSync(
      `Add-Type -AssemblyName System.Security; ` +
      `$encrypted = [Convert]::FromBase64String('${encrypted.toString('base64')}'); ` +
      `$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
      `$encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
      `[Convert]::ToBase64String($decrypted)`
    )
    if (!result) return null
    return Buffer.from(result.trim(), 'base64').toString('utf8')
  } catch {
    return null
  }
}

// ─── SOCS Consent Validation ────────────────────────────────────────────────────

/**
 * Validate Google SOCS (Terms of Service) consent cookie.
 * CAI = user consented (OK)
 * CAA = user has NOT consented (will cause YouTube API failures)
 *
 * Returns the SOCS value if valid (CAI), or logs warning and returns null if not consented.
 */
function validateSocsConsent(socs: string | undefined): string | undefined {
  if (!socs) {
    console.warn('[Cookie] ⚠️ No SOCS cookie found — user may not be logged in to YouTube')
    return undefined
  }
  if (socs.startsWith('CAA')) {
    console.warn(`[Cookie] ⚠️ SOCS=${socs} — User has NOT accepted Google/YouTube terms. ` +
      `Session will likely fail. Please open Chrome, log into YouTube, and accept any terms prompts.`)
    return undefined
  }
  // CAI or other valid value
  return socs
}

// ─── SQLite Cookie Parsing ────────────────────────────────────────────────────

/**
 * Extract YouTube cookies from a Chrome profile's SQLite cookie database.
 * Handles the file being locked (Chrome running) by copying first.
 *
 * Required cookies for Innertube API auth:
 *   SAPISID, __Secure-1PSID, __Secure-1PSIDTS, __Secure-1PSIDCC
 */
export async function extractYouTubeCookies(profileDir: string): Promise<{ cookies: YouTubeCookies | null; rawSocs: string | null }> {
  // Fast path: try persisted CDP cookies first (written by openLoginWindow)
  // Profile dir may be the "Default" folder (for Chrome profile 1) or root HyperClip dir (2-30)
  const isDefaultChrome = profileDir.endsWith('Default') && profileDir.includes('Chrome')
  const fastPaths = [
    // For Chrome Default: cookies persisted at parent level (User Data\_hyperclip_cookies.json)
    // For HyperClip profiles: cookies persisted at Default level (Default\_hyperclip_cookies.json)
    isDefaultChrome
      ? path.join(profileDir, '..', '_hyperclip_cookies.json')
      : path.join(profileDir, '_hyperclip_cookies.json'),
    path.join(profileDir, '_hyperclip_cookies.json'),
    path.join(profileDir, 'Default', '_hyperclip_cookies.json'),
    path.join(profileDir, '..', 'Default', '_hyperclip_cookies.json'),
  ]
  for (const persistedPath of fastPaths) {
    if (fs.existsSync(persistedPath)) {
      try {
        const raw = fs.readFileSync(persistedPath, 'utf8')
        const cookies: YouTubeCookies = JSON.parse(raw)
        const rawSocs = cookies.socs ?? null
        if (!cookies.socs || cookies.socs.startsWith('CAA')) {
          cookies.socs = 'CAI'
        }
        if (cookies.SAPISID && cookies.PSID) {
          devLog(`[Cookie] Loaded persisted cookies (from CDP login) for ${persistedPath}`)
          return { cookies, rawSocs }
        }
      } catch {}
    }
  }

  const cookieDbPath = path.join(profileDir, 'Default', 'Network', 'Cookies')
  const localStatePath = path.join(profileDir, 'Local State')

  devLog(`[Cookie] extractYouTubeCookies: dir=${profileDir}, dbExists=${fs.existsSync(cookieDbPath)}, localStateExists=${fs.existsSync(localStatePath)}`)

  if (!fs.existsSync(cookieDbPath)) {
    const altLocalState = path.join(profileDir, '..', 'Local State')
    devLog(`[Cookie] No Cookies DB at ${cookieDbPath}, alt Local State exists: ${fs.existsSync(altLocalState)}`)
    if (fs.existsSync(altLocalState)) {
      return extractYouTubeCookiesFromPath(cookieDbPath, altLocalState)
    }
    return { cookies: null, rawSocs: null }
  }

  return await extractYouTubeCookiesFromPath(cookieDbPath, localStatePath)
}

async function extractYouTubeCookiesFromPath(
  cookieDbPath: string,
  localStatePath: string
): Promise<{ cookies: YouTubeCookies | null; rawSocs: string | null }> {
  // Get DPAPI key (Buffer for AES-GCM decryption)
  const aesKey = await decryptDPAPIKey(localStatePath)
  if (!aesKey) {
    devLog(`[Cookie] decryptDPAPIKey returned null for ${localStatePath}`)
    return { cookies: null, rawSocs: null }
  }
  devLog(`[Cookie] DPAPI key OK, path=${localStatePath}`)

  // Read cookie DB (may be locked by Chrome)
// Retry up to 3 times with 500ms delay to handle transient locks.
let dbBuffer: Buffer | null = null
const copyPath = cookieDbPath + '.hyperclip'
const MAX_RETRIES = 5
const BASE_DELAY_MS = 1000

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      dbBuffer = fs.readFileSync(cookieDbPath)
      break  // Success
    } catch (e: unknown) {
      const errCode = (e as NodeJS.ErrnoException).code || ''
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), 8000)
        devLog(`[Cookie] DB locked (${errCode}), retry ${attempt}/${MAX_RETRIES - 1} in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      } else {
        devLog(`[Cookie] DB still locked after ${MAX_RETRIES - 1} retries — trying copy fallback...`)
        try {
          // Use read+write — copyFileSync fails with EBUSY on Chrome-locked files
          const srcBuf = fs.readFileSync(cookieDbPath)
          fs.writeFileSync(copyPath, srcBuf)
          dbBuffer = srcBuf
          devLog(`[Cookie] Read DB via buffer fallback (Chrome may still be writing)`)
          break
        } catch (copyErr: unknown) {
          const copyErrCode = (copyErr as NodeJS.ErrnoException).code || ''
          console.error(`[Cookie] ⚠️ Cookie DB locked after ${MAX_RETRIES} retries AND copy failed (${copyErrCode}). Close Chrome, or open YouTube in a HyperClip Chrome profile, then restart.`)
          return { cookies: null, rawSocs: null }
        }
      }
    }
  }

if (!dbBuffer) return { cookies: null, rawSocs: null }

  try {
    // Use app.getAppPath() which works in both dev and packaged modes (ESM-compatible)
    const sqlJsDist = app.isPackaged
      ? path.join(process.resourcesPath!, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist')
      : path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist')

    devLog(`[Cookie] sql.js loading WASM from: ${sqlJsDist}`)
    const SqlJs = await initSqlJs({
      locateFile: (f: string) => path.join(sqlJsDist, f),
    })
    devLog(`[Cookie] sql.js loaded, opening DB...`)
    const db = new SqlJs.Database(dbBuffer)
    devLog(`[Cookie] sql.js DB opened, querying...`)

    // Query YouTube cookies
    // Chrome stores encrypted values in the 'encrypted_value' column
    // Plain values are stored in 'value' column for non-encrypted cookies
    const result = db.exec(`
      SELECT host_key, name, value, encrypted_value
      FROM cookies
      WHERE (host_key LIKE '%youtube.com%' OR host_key LIKE '%.google.com%' OR host_key = 'google.com')
        AND name IN ('SAPISID', '__Secure-1PSID', '__Secure-1PSIDTS', '__Secure-1PSIDCC', '__Secure-3PSID', 'LOGGED_IN', '__Secure-1PAPISID', 'SOCS')
    `)

    if (!result.length || !result[0].values.length) {
      devLog(`[Cookie] No YouTube cookies found in DB for ${cookieDbPath}`)
      db.close()
      return { cookies: null, rawSocs: null }
    }
    devLog(`[Cookie] Found ${result[0].values.length} cookie rows: ${result[0].values.map((r: any) => String(r[1]) + '@' + String(r[0]).slice(0,20)).join(', ')}`)

    const cookies: Partial<YouTubeCookies> = {}

    for (const row of result[0].values) {
      const hostKey = String(row[0])
      const name = String(row[1])
      const plainValue = row[2] ? String(row[2]) : ''
      const encryptedValue = row[3]

      let value = plainValue
      if (!value && (encryptedValue instanceof Uint8Array || Buffer.isBuffer(encryptedValue))) {
        const buf = Buffer.from(encryptedValue as Buffer)
        const decrypted = decryptCookieValue(buf, aesKey)
        if (decrypted) value = decrypted
      }

      if (!value) continue

      if (name === 'SAPISID') cookies.SAPISID = value
      else if (name === '__Secure-1PSID') cookies.PSID = value
      else if (name === '__Secure-1PSIDTS') cookies.PSIDTS = value
      else if (name === '__Secure-1PSIDCC') cookies.PSIDCC = value
      else if (name === '__Secure-3PSID') { if (!cookies.PSID) cookies.PSID = value }
      else if (name === 'SOCS') cookies.socs = value
    }

    db.close()

    const rawSocs = cookies.socs ?? null
    // Auto-inject SOCS=CAI to bypass Google Consent screens automatically
    if (!cookies.socs || cookies.socs.startsWith('CAA')) {
      cookies.socs = 'CAI'
    }

    if (cookies.SAPISID && cookies.PSID) {
      return { cookies: cookies as YouTubeCookies, rawSocs }
    }
    return { cookies: null, rawSocs }
  } catch (e) {
    devLog(`[Cookie] sql.js error: ${e}`)
    return { cookies: null, rawSocs: null }
  }
}

// ─── Chrome Profile Management ─────────────────────────────────────────────────

const HYPERCLIP_PROFILE_PREFIX = 'HyperClip-Chrome-Profile-'
// NOTE: The actual session count used at runtime is determined by getSessionCount() (RAM-aware).
// This constant defines the max profile directories that may exist on disk.
const DEFAULT_SESSION_COUNT = 30

/** Get all HyperClip-managed Chrome profile directories */
function getHyperClipProfileDirs(): string[] {
  const dirs: string[] = []
  for (let i = 1; i <= DEFAULT_SESSION_COUNT; i++) {
    const dir = getHyperClipProfileDir(String(i))
    if (fs.existsSync(dir)) dirs.push(dir)
  }
  return dirs
}

/**
 * Launch Chrome with a specific profile, opening YouTube for login.
 * Returns the process handle so we can wait for it to close.
 */
export function launchChromeForLogin(profileId: string): { process: ReturnType<typeof spawn>; profileDir: string } | null {
  const chromeExe = getChromeExe()
  if (!fs.existsSync(chromeExe)) {
    console.warn('[SessionManager] Chrome not found at:', chromeExe)
    return null
  }

  const isDefaultChrome = profileId === '1'
  const profileDir = isDefaultChrome
    ? getDefaultChromeProfileDir()
    : getHyperClipProfileDir(profileId)

  // Ensure profile directory exists (for non-default profiles)
  if (!isDefaultChrome) {
    const defaultDir = path.join(profileDir, 'Default')
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true })
    }
  }

  const args = [
    `--user-data-dir=${profileDir}`,
    '--new-window',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-first-run-ui',
    'https://www.youtube.com'
  ]

  const chromeProcess = spawn(chromeExe, args, {
    detached: false,
    stdio: 'ignore',
  })

  chromeProcess.on('error', (e) => {
    console.warn('[SessionManager] Chrome launch error:', e)
  })

  return { process: chromeProcess, profileDir }
}

// ─── SAPISIDHASH ─────────────────────────────────────────────────────────────

/**
 * Compute the SAPISIDHASH header value.
 * This is YouTube's internal authentication mechanism for AJAX requests.
 *
 * Format: {timestamp}_{sha1(timestamp + " " + SAPISID + " " + origin)}
 * origin = "https://www.youtube.com"
 */
export function computeSAPISIDHASH(sapisid: string, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000)
  const origin = 'https://www.youtube.com'
  const message = `${ts} ${sapisid} ${origin}`
  const hash = crypto.createHash('sha1').update(message).digest('hex')
  return `${ts}_${hash}`
}

// ─── Session Manager ────────────────────────────────────────────────────────────

export class ChromeSessionManager {
  private _sessions: ChromeSession[] = []
  private _index = 0
  private _initialized = false
  private _initPromise: Promise<void> | null = null

  constructor(private _sessionCount: number = DEFAULT_SESSION_COUNT) {
    this._initPromise = this._init()
  }

  private async _init(): Promise<void> {
    devLog(`[SessionManager] Initializing ${this._sessionCount} Chrome profiles...`)

    // Session 1: use user's existing Chrome profile (already logged in)
    // Sessions 2-30: use dedicated HyperClip profiles
    for (let i = 1; i <= this._sessionCount; i++) {
      const profileId = String(i)
      const isDefaultChrome = i === 1
      const profileDir = isDefaultChrome
        ? getDefaultChromeProfileDir()
        : getHyperClipProfileDir(profileId)
      const profileExists = fs.existsSync(path.join(profileDir, 'Default', 'Network', 'Cookies'))

      this._sessions.push({
        profileId,
        profileName: isDefaultChrome ? 'Chrome (Default)' : `HyperClip Profile ${i}`,
        profileDir,
        cookies: null,
        usedToday: 0,
        lastUsed: 0,
        isLoggedIn: profileExists,
        wasLoggedIn: profileExists,
        isConsented: false,
        rawSocs: null,
        lastRefreshAt: 0,
        refreshFailCount: 0,
        error: profileExists ? undefined : (isDefaultChrome ? 'Chrome profile not found' : 'Profile not initialized'),
      })
    }

    // PROACTIVE: load persisted CDP cookies (instant — from disk).
    // Then start background CDP login for any session still missing cookies.
    devLog('[SessionManager] Loading persisted cookies and starting background login...')
    const BATCH = 10
    for (let i = 0; i < this._sessions.length; i += BATCH) {
      const batch = this._sessions.slice(i, i + BATCH)
      await Promise.all(batch.map(async (session) => {
        try {
          const { cookies, rawSocs } = await extractYouTubeCookies(session.profileDir)
          session.cookies = cookies
          session.rawSocs = rawSocs
          session.rawSocs = cookies?.socs ?? null
          session.isLoggedIn = !!(cookies?.SAPISID && cookies?.PSID)
          if (session.isLoggedIn) {
            session.wasLoggedIn = true
            session.lastRefreshAt = Date.now()
            session.refreshFailCount = 0
          }
          session.isConsented = !!(cookies?.socs && !cookies.socs.startsWith('CAA'))
          if (!cookies) {
            session.error = 'No cookies — click "Mở Chrome" in Settings to login'
          } else {
            // Persist cookies immediately so next startup doesn't need extraction
            this._persistCookiesToFile(session.profileId, cookies)
            if (!session.isLoggedIn) {
              session.error = 'Missing SAPISID or __Secure-1PSID cookie'
            } else if (!session.isConsented) {
              session.error = 'SOCS cookie indicates terms not accepted — open YouTube in Chrome and accept any prompts'
            } else {
              session.error = undefined
            }
          }
          if (session.profileId === '1' || session.profileId === '2') {
            devLog(`[SessionManager] Profile ${session.profileId}: cookies=${!!cookies}, isLoggedIn=${session.isLoggedIn}, isConsented=${session.isConsented}, socs="${cookies?.socs?.slice(0,10) ?? 'null'}"`)
          }
        } catch (e) {
          session.error = String(e)
        }
      }))
    }

    // Force SOCS=CAI for all sessions — ensures isConsented=true for all working sessions
    // This overrides CAA or missing SOCS that would otherwise cause auth errors
    for (const session of this._sessions) {
      if (session.cookies && (!session.cookies.socs || session.cookies.socs.startsWith('CAA'))) {
        session.cookies.socs = 'CAI'
        session.isConsented = true
      }
    }

    const valid = this._sessions.filter(s => s.cookies && s.isConsented)
    devLog(`[SessionManager] ${valid.length}/${this._sessionCount} sessions ready (${this._sessions.filter(s => !s.cookies).length} missing — login from Settings)`)
    devLog(`[SessionManager] ${valid.length}/${this._sessionCount} sessions ready (${this._sessions.filter(s => !s.cookies).length} missing — login from Settings)`)

    // ─── Background cookie health monitoring ───────────────────────────────────
    // Tier 1: Every 10 min — refresh top-5 recently-used sessions (hot path)
    // Tier 2: Every 30 min — refresh ALL sessions (catch stale/expired cookies)
    // Tier 3: Every 60 min — log health summary + detect degradation
    const TIER1_INTERVAL_MS = 10 * 60 * 1000   // 10 min
    const TIER2_INTERVAL_MS = 30 * 60 * 1000   // 30 min
    const TIER3_INTERVAL_MS = 60 * 60 * 1000   // 60 min
    const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

    // Tier 1: Hot sessions refresh (every 10 min)
    setInterval(() => {
      const usedSessions = this._sessions
        .filter(s => s.lastUsed > 0)
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .slice(0, 5)
      if (usedSessions.length === 0) return
      this._refreshBatch(usedSessions, 'tier1').catch(() => {})
    }, TIER1_INTERVAL_MS)

    // Tier 2: Full refresh (every 30 min) — catches expired cookies early
    setInterval(() => {
      const allWithCookies = this._sessions.filter(s => s.wasLoggedIn)
      if (allWithCookies.length === 0) return
      this._refreshBatch(allWithCookies, 'tier2').catch(() => {})
    }, TIER2_INTERVAL_MS)

    // Tier 3: Health summary log (every 60 min)
    setInterval(() => {
      const health = this._computeHealth()
      const alive = this._sessions.filter(s => s.cookies).length
      const degraded = health.degradedCount
      const stale = health.staleCount
      devLog(`[SessionManager] Health check: ${alive}/${this._sessionCount} alive, ${degraded} degraded, ${stale} stale (>${Math.round(STALE_THRESHOLD_MS / 86400000)}d), level=${health.level}`)
      if (health.level === 'critical') {
        console.warn('[SessionManager] 🚨 CRITICAL: <20% sessions alive — detection at risk. Re-login Chrome or clone sessions.')
      } else if (health.level === 'degraded') {
        console.warn('[SessionManager] ⚠️ DEGRADED: <50% sessions alive — consider refreshing Chrome login.')
      }
    }, TIER3_INTERVAL_MS)

    this._initialized = true
  }

  /**
   * Refresh a batch of sessions — re-extract cookies and update state.
   * Used by tiered background refresh (tier1 = hot sessions, tier2 = all sessions).
   */
  private async _refreshBatch(sessions: ChromeSession[], tier: string): Promise<void> {
    let recovered = 0, lost = 0
    await Promise.all(sessions.map(async (session) => {
      try {
        const { cookies, rawSocs } = await extractYouTubeCookies(session.profileDir)
        session.rawSocs = rawSocs
        if (cookies?.SAPISID && cookies?.PSID) {
          const wasLoggedIn = session.isLoggedIn
          session.cookies = cookies
          session.isLoggedIn = true
          session.wasLoggedIn = true
          session.isConsented = !!(cookies?.socs && !cookies.socs.startsWith('CAA'))
          if (!cookies.socs || cookies.socs.startsWith('CAA')) {
            cookies.socs = 'CAI'
            session.isConsented = true
          }
          session.error = undefined
          session.usedToday = 0
          session.lastRefreshAt = Date.now()
          session.refreshFailCount = 0
          if (!wasLoggedIn) {
            recovered++
            devLog(`[SessionManager] ${tier}: recovered session ${session.profileId}`)
          }
        } else {
          if (session.isLoggedIn) lost++
          session.cookies = null
          session.isLoggedIn = false
          session.error = 'cookies expired or missing'
          session.refreshFailCount++
        }
      } catch {
        session.refreshFailCount++
      }
    }))
    if (recovered > 0 || lost > 0) {
      devLog(`[SessionManager] ${tier} refresh: ${recovered} recovered, ${lost} lost`)
    }
  }

  /**
   * Compute aggregate cookie health metrics for monitoring.
   */
  private _computeHealth(): SessionStatus['health'] {
    const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
    const now = Date.now()

    const loggedInSessions = this._sessions.filter(s => s.cookies)
    const totalWithHistory = this._sessions.filter(s => s.wasLoggedIn)
    const degraded = this._sessions.filter(s => s.wasLoggedIn && !s.isLoggedIn)
    const stale = loggedInSessions.filter(s =>
      s.lastRefreshAt > 0 && (now - s.lastRefreshAt) > STALE_THRESHOLD_MS
    )

    // Oldest cookie age
    let oldestAgeMs = 0
    for (const s of loggedInSessions) {
      if (s.lastRefreshAt > 0) {
        const age = now - s.lastRefreshAt
        if (age > oldestAgeMs) oldestAgeMs = age
      }
    }

    const healthPct = this._sessionCount > 0
      ? Math.round((loggedInSessions.length / this._sessionCount) * 100)
      : 0

    const level: 'healthy' | 'degraded' | 'critical' =
      healthPct >= 50 ? 'healthy' :
      healthPct >= 20 ? 'degraded' : 'critical'

    return {
      healthPct,
      degradedCount: degraded.length,
      staleCount: stale.length,
      oldestCookieAgeHours: Math.round(oldestAgeMs / (60 * 60 * 1000)),
      level,
    }
  }

  async ensureInit(): Promise<void> {
    if (this._initPromise) await this._initPromise
  }

  isReady(): boolean {
    return this._initialized && this._sessions.some(s => s.cookies)
  }

  getStatus(): SessionStatus {
    return {
      ready: this.isReady(),
      sessionCount: this._sessions.length,
      loggedInCount: this._sessions.filter(s => s.cookies).length,
      consentedCount: this._sessions.filter(s => s.isConsented).length,
      sessions: this._sessions.map(s => toSessionPublic(s)),
      health: this._computeHealth(),
    }
  }

  /**
   * Get the next session in round-robin order (sessions with cookies AND consented).
   * Safe for concurrent calls from parallel channel fetches.
   */
  getNextSession(): ChromeSession | null {
    // Only use sessions with cookies AND consent — CAA/empty SOCS causes 401/403 from YouTube
    const valid = this._sessions.filter(s => s.cookies && s.isConsented)
    if (valid.length === 0) return null

    const session = valid[this._index % valid.length]
    this._index = (this._index + 1) % valid.length
    return session
  }

  /**
   * Open Chrome for a specific profile, wait for YouTube login, extract cookies,
   * update session state, then close Chrome.
   * Replaces the old launchChromeForLogin() approach which only opened Chrome without
   * auto-extracting cookies.
   */
  async openLoginWindow(profileId: string): Promise<boolean> {
    const { cdpOpenChromeForLogin } = await import('./cdp.js')
    const result = await cdpOpenChromeForLogin(profileId)

    const session = this._sessions.find(s => s.profileId === profileId)
    if (session) {
      session.cookies = result.cookies
      session.isLoggedIn = !!(result.cookies?.SAPISID && result.cookies?.PSID)
      if (session.isLoggedIn) {
        session.wasLoggedIn = true
        session.lastRefreshAt = Date.now()
        session.refreshFailCount = 0
      }
      session.isConsented = !!(result.cookies?.socs && !result.cookies.socs.startsWith('CAA'))
      // Force CAI for all sessions — prevents auth errors from CAA/empty SOCS
      if (result.cookies && (!result.cookies.socs || result.cookies.socs.startsWith('CAA'))) {
        result.cookies.socs = 'CAI'
        session.isConsented = true
      }
      session.error = result.error ?? (result.cookies ? undefined : 'No YouTube cookies found')
      session.lastUsed = 0
      session.usedToday = 0
      if (result.cookies) {
        devLog(`[SessionManager] openLoginWindow(${profileId}): success — cookies extracted`)
        // Persist to disk so next restart can load via extractYouTubeCookies
        try {
          this._persistCookiesToFile(profileId, result.cookies)
        } catch (e) {
          console.warn(`[SessionManager] Failed to persist cookies for ${profileId}: ${e}`)
        }
        // Rebuild Innertube pool client for this session so it's immediately usable
        try {
          const { getInnertubePool } = await import('./innertube_client.js')
          const pool = await getInnertubePool()
          const ok = await pool.refreshClient(profileId)
          if (ok) {
            devLog(`[SessionManager] Innertube client rebuilt for profile ${profileId}`)
          } else {
            console.warn(`[SessionManager] Innertube client rebuild failed for profile ${profileId}`)
          }
        } catch (e) {
          console.warn(`[SessionManager] Failed to rebuild Innertube client for ${profileId}: ${e}`)
        }
      } else {
        devLog(`[SessionManager] openLoginWindow(${profileId}): failed — ${result.error}`)
      }
    }

    if (result.cookies) return true
    if (result.alreadyLoggedIn) return true
    return false
  }

  private _persistCookiesToFile(profileId: string, cookies: YouTubeCookies): void {
    const idx = parseInt(profileId, 10)
    const isDefaultChrome = !isNaN(idx) && idx === 1
    const profileDir = isDefaultChrome
      ? getDefaultChromeProfileDir()
      : getHyperClipProfileDir(profileId)
    // For Chrome Default: profileDir = User Data\Default → persist at parent level (User Data\_hc.json)
    // For HyperClip profiles (2-30): profileDir = HyperClip-Chrome-Profile-N\Default → persist at Default\_hc.json
    const cookieFile = isDefaultChrome
      ? path.join(profileDir, '..', '_hyperclip_cookies.json')
      : path.join(profileDir, '_hyperclip_cookies.json')
    fs.writeFileSync(cookieFile, JSON.stringify(cookies), 'utf8')
    devLog(`[SessionManager] Cookies persisted to ${cookieFile}`)
  }

  /**
   * Clone cookies from Session 1 to all other sessions.
   * Returns the number of successfully cloned sessions.
   */
  async cloneSessionOne(): Promise<{ success: boolean; clonedCount: number; error?: string }> {
    const session1 = this._sessions.find(s => s.profileId === '1')
    if (!session1) return { success: false, clonedCount: 0, error: 'Session 1 not found' }

    // Source Paths (Session 1 is Default Chrome: profileDir = User Data\Default)
    const srcSqlite = path.join(session1.profileDir, 'Network', 'Cookies')
    const srcLocalState = path.join(session1.profileDir, '..', 'Local State')
    const srcJson = path.join(session1.profileDir, '..', '_hyperclip_cookies.json')

    if (!fs.existsSync(srcSqlite) && !fs.existsSync(srcJson)) {
      return { success: false, clonedCount: 0, error: 'Session 1 is not logged in (no cookies found)' }
    }

    let clonedCount = 0
    for (let i = 2; i <= this._sessionCount; i++) {
      try {
        const destSession = this._sessions.find(s => s.profileId === String(i))
        if (!destSession) continue

        // Destination Paths (Session 2-30: profileDir = HyperClip-Chrome-Profile-N\Default)
        const destNetworkDir = path.join(destSession.profileDir, 'Network')
        const destLocalState = path.join(destSession.profileDir, '..', 'Local State')
        const destJson = path.join(destSession.profileDir, '_hyperclip_cookies.json')

        if (!fs.existsSync(destNetworkDir)) {
          fs.mkdirSync(destNetworkDir, { recursive: true })
        }

        // Copy SQLite & Local State (for standard decryption if they open Chrome)
        // Use read+write instead of copyFileSync — Chrome locks Cookies with EBUSY,
        // but readFileSync can still read locked files (shared read access on Windows).
        if (fs.existsSync(srcSqlite)) {
          try {
            const buf = fs.readFileSync(srcSqlite)
            fs.writeFileSync(path.join(destNetworkDir, 'Cookies'), buf)
          } catch (e2) {
            console.warn(`[SessionManager] cloneSessionOne: Cookies copy failed for profile ${i} (Chrome may be open): ${(e2 as Error).message}`)
          }
        }
        if (fs.existsSync(srcLocalState)) {
          try {
            const buf = fs.readFileSync(srcLocalState)
            fs.writeFileSync(destLocalState, buf)
          } catch (e2) {
            console.warn(`[SessionManager] cloneSessionOne: Local State copy failed for profile ${i}: ${(e2 as Error).message}`)
          }
        }
        
        // Copy Fast-path JSON (for instant HyperClip loading)
        if (fs.existsSync(srcJson)) {
          try {
            const buf = fs.readFileSync(srcJson)
            fs.writeFileSync(destJson, buf)
          } catch (e2) {
            console.warn(`[SessionManager] cloneSessionOne: JSON copy failed for profile ${i}: ${(e2 as Error).message}`)
          }
        }

        clonedCount++
      } catch (e) {
        console.error(`[SessionManager] cloneSessionOne failed for profile ${i}:`, e)
      }
    }

    if (clonedCount > 0) {
      await this.refreshAll()
    }

    return { success: true, clonedCount }
  }

  /**
   * Refresh cookies for a specific session.
   */
  async refreshSession(profileId: string): Promise<boolean> {
    const session = this._sessions.find(s => s.profileId === profileId)
    if (!session) return false

    try {
      const { cookies, rawSocs } = await extractYouTubeCookies(session.profileDir)
      session.cookies = cookies
      session.rawSocs = rawSocs
      session.isLoggedIn = !!(cookies?.SAPISID && cookies?.PSID)
      if (session.isLoggedIn) {
        session.wasLoggedIn = true
        session.lastRefreshAt = Date.now()
        session.refreshFailCount = 0
      }
      session.isConsented = !!cookies?.socs && !cookies.socs.startsWith('CAA')
      // Force CAI for all sessions — prevents auth errors from CAA/empty SOCS
      if (cookies && (!cookies.socs || cookies.socs.startsWith('CAA'))) {
        cookies.socs = 'CAI'
        session.isConsented = true
      }
      session.error = cookies ? undefined : 'No YouTube cookies'
      session.usedToday = 0
      devLog(`[SessionManager] refreshSession(${profileId}): cookies=${!!cookies}, isLoggedIn=${session.isLoggedIn}, isConsented=${session.isConsented}, socs=${cookies?.socs}`)
      return !!cookies
    } catch (e) {
      session.error = String(e)
      devLog(`[SessionManager] refreshSession(${profileId}): ERROR — ${e}`)
      return false
    }
  }

  /**
   * Refresh cookies for all sessions.
   */
  async refreshAll(): Promise<number> {
    let refreshed = 0
    for (const session of this._sessions) {
      const ok = await this.refreshSession(session.profileId)
      if (ok) refreshed++
    }
    return refreshed
  }

  getSessions(): ChromeSession[] {
    return this._sessions
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _manager: ChromeSessionManager | null = null

export function getSessionManager(): ChromeSessionManager {
  if (!_manager) {
    // RAM-aware: laptop ≤32GB → 15 sessions, desktop >32GB → 30 sessions
    let sessionCount = 15
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic import at runtime to avoid circular dep at module init
      const { getSessionCount } = require('./system.js')
      sessionCount = getSessionCount()
    } catch {
      // safe default for laptop (conservative)
    }
    _manager = new ChromeSessionManager(sessionCount)
  }
  return _manager
}