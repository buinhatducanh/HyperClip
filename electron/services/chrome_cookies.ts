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
}

export interface SessionStatus {
  ready: boolean
  sessionCount: number
  loggedInCount: number
  sessions: ChromeSession[]
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

const APPDATA = process.env.APPDATA || os.homedir()
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')

// Dedicated HyperClip profile directory (created by us)
function getHyperClipProfileDir(profileId: string): string {
  return path.join(LOCALAPPDATA, `HyperClip-Chrome-Profile-${profileId}`)
}

// Chrome installation path
function getChromeExe(): string {
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
 * Chrome encrypts cookies with AES-256, and the AES key is stored in Local State,
 * encrypted with Windows DPAPI tied to the current user account.
 *
 * @returns 32-byte AES key as base64 string, or null if decryption fails.
 */
export function decryptDPAPIKey(localStatePath: string): string | null {
  try {
    const raw = fs.readFileSync(localStatePath, 'utf-8')
    const json = JSON.parse(raw)
    const encryptedKeyB64 = json.os_crypt?.encrypted_key
    if (!encryptedKeyB64) return null

    const encryptedKey = Buffer.from(encryptedKeyB64, 'base64')
    // Chrome v80+: encrypted_key format is "DPAPI" prefix (5 bytes) + raw encrypted data
    // Chrome v79-: just raw DPAPI blob (no prefix)
    const prefix = encryptedKey.slice(0, 5).toString('hex')

    let keyData: string
    if (prefix === '4450415049') {
      // "DPAPI" prefix — strip it
      keyData = encryptedKey.slice(5).toString('base64')
    } else {
      // Already raw
      keyData = encryptedKey.toString('base64')
    }

    // Call PowerShell to decrypt with DPAPI
    const result = runPowerShellSync(
      `Add-Type -AssemblyName System.Security; ` +
      `$encrypted = [Convert]::FromBase64String('${keyData}'); ` +
      `$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
      `$encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
      `[Convert]::ToBase64String($decrypted)`
    )

    if (!result) return null
    return result.trim()
  } catch {
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
function decryptCookieValue(encrypted: Buffer, aesKeyB64: string): string | null {
  try {
    const aesKey = Buffer.from(aesKeyB64, 'base64')
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
    // The "encrypted" buffer here already has the v10 header stripped
    // (we check the first byte in the calling function)
    if (encrypted[0] === 0x76) {
      // v10 format: version(1) + nonce(12) + ciphertext + authTag(16)
      const nonce = encrypted.slice(1, 13)
      const ciphertextWithTag = encrypted.slice(13)
      const tag = ciphertextWithTag.slice(-16)
      const ciphertext = ciphertextWithTag.slice(0, -16)

      // Use the AES key (DPAPI-unwrapped) directly
      // The AES key is already the raw 32-byte key
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce)
        decipher.setAuthTag(tag)
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
        return decrypted.toString('utf8')
      } catch {
        // AES-GCM failed — might need 2nd-stage key unwrap
        return null
      }
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

// ─── SQLite Cookie Parsing ────────────────────────────────────────────────────

/**
 * Extract YouTube cookies from a Chrome profile's SQLite cookie database.
 * Handles the file being locked (Chrome running) by copying first.
 *
 * Required cookies for Innertube API auth:
 *   SAPISID, __Secure-1PSID, __Secure-1PSIDTS, __Secure-1PSIDCC
 */
export async function extractYouTubeCookies(profileDir: string): Promise<YouTubeCookies | null> {
  const cookieDbPath = path.join(profileDir, 'Default', 'Network', 'Cookies')
  const localStatePath = path.join(profileDir, 'Local State')

  if (!fs.existsSync(cookieDbPath)) {
    // Try the parent-level Local State (newer Chrome versions)
    const altLocalState = path.join(profileDir, '..', 'Local State')
    if (fs.existsSync(altLocalState)) {
      return extractYouTubeCookiesFromPath(cookieDbPath, altLocalState)
    }
    return null
  }

  return extractYouTubeCookiesFromPath(cookieDbPath, localStatePath)
}

async function extractYouTubeCookiesFromPath(
  cookieDbPath: string,
  localStatePath: string
): Promise<YouTubeCookies | null> {
  // Get DPAPI key
  const aesKeyB64 = decryptDPAPIKey(localStatePath)
  if (!aesKeyB64) {
    return null
  }

  // Read cookie DB (may be locked by Chrome)
  let dbBuffer: Buffer
  const copyPath = cookieDbPath + '.hyperclip'

  try {
    dbBuffer = fs.readFileSync(cookieDbPath)
  } catch (e: unknown) {
    // File locked — Chrome is running. Try to make a copy.
    try {
      fs.copyFileSync(cookieDbPath, copyPath)
      dbBuffer = fs.readFileSync(copyPath)
    } catch {
      return null // Can't read — Chrome is running
    }
  }

  try {
    // For sql.js in Node.js, we need to pass the binary directly
    // Try loading from node_modules
    const sqlJsDist = path.join(
      app.isPackaged
        ? path.join(process.resourcesPath!, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist')
        : path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist')
    )

    // Use sql.js with the WASM binary loaded from disk
    const SqlJs = await initSqlJs({
      locateFile: (f: string) => path.join(sqlJsDist, f),
    })
    const db = new SqlJs.Database(dbBuffer)

    // Query YouTube cookies
    // Chrome stores encrypted values in the 'encrypted_value' column
    // Plain values are stored in 'value' column for non-encrypted cookies
    const result = db.exec(`
      SELECT name, value, encrypted_value
      FROM cookies
      WHERE host_key LIKE '%youtube.com%'
        AND name IN ('SAPISID', '__Secure-1PSID', '__Secure-1PSIDTS', '__Secure-1PSIDCC', '__Secure-3PSID', 'LOGGED_IN', '__Secure-1PAPISID', 'SOCS')
    `)

    if (!result.length || !result[0].values.length) {
      db.close()
      return null
    }

    const cookies: Partial<YouTubeCookies> = {}

    for (const row of result[0].values) {
      const name = String(row[0])
      const plainValue = row[1] ? String(row[1]) : ''
      const encryptedValue = row[2]

      let value = plainValue

      // Try to decrypt if encrypted
      if (!value && (encryptedValue instanceof Uint8Array || Buffer.isBuffer(encryptedValue))) {
        const buf = Buffer.from(encryptedValue as Buffer)
        const decrypted = decryptCookieValue(buf, aesKeyB64)
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

    if (cookies.SAPISID && cookies.PSID) {
      return cookies as YouTubeCookies
    }
    return null
  } catch (e) {
    return null
  }
}

// ─── Chrome Profile Management ─────────────────────────────────────────────────

const HYPERCLIP_PROFILE_PREFIX = 'HyperClip-Chrome-Profile-'
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

  const profileDir = getHyperClipProfileDir(profileId)

  // Ensure profile directory exists
  const defaultDir = path.join(profileDir, 'Default')
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true })
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
    console.log(`[SessionManager] Initializing ${this._sessionCount} Chrome profiles...`)

    for (let i = 1; i <= this._sessionCount; i++) {
      const profileId = String(i)
      const profileDir = getHyperClipProfileDir(profileId)
      const profileExists = fs.existsSync(path.join(profileDir, 'Default', 'Network', 'Cookies'))

      this._sessions.push({
        profileId,
        profileName: `HyperClip Profile ${i}`,
        profileDir,
        cookies: null,
        usedToday: 0,
        lastUsed: 0,
        isLoggedIn: profileExists,
        error: profileExists ? undefined : 'Profile not initialized',
      })
    }

    // Try to extract cookies from existing profiles (non-blocking)
    this._extractAllCookies().catch(() => {})

    this._initialized = true
  }

  private async _extractAllCookies(): Promise<void> {
    const promises = this._sessions.map(async (session) => {
      try {
        const cookies = await extractYouTubeCookies(session.profileDir)
        session.cookies = cookies
        session.isLoggedIn = !!cookies
        session.error = cookies ? undefined : 'No YouTube cookies found (login required)'
      } catch (e) {
        session.error = String(e)
      }
    })
    await Promise.all(promises)

    const valid = this._sessions.filter(s => s.cookies)
    console.log(`[SessionManager] ${valid.length}/${this._sessionCount} sessions have YouTube cookies`)
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
      sessions: this._sessions,
    }
  }

  /**
   * Get the next session in round-robin order (sessions with cookies only).
   */
  getNextSession(): ChromeSession | null {
    const valid = this._sessions.filter(s => s.cookies)
    if (valid.length === 0) return null

    // Rotate through valid sessions
    const session = valid[this._index % valid.length]
    this._index = (this._index + 1) % valid.length
    return session
  }

  /**
   * Open Chrome for a specific profile — user logs in, then HyperClip reads cookies.
   */
  openLoginWindow(profileId: string): void {
    const result = launchChromeForLogin(profileId)
    if (result) {
      console.log(`[SessionManager] Opened Chrome for login (profile ${profileId})`)
    }
  }

  /**
   * Refresh cookies for a specific session.
   */
  async refreshSession(profileId: string): Promise<boolean> {
    const session = this._sessions.find(s => s.profileId === profileId)
    if (!session) return false

    try {
      const cookies = await extractYouTubeCookies(session.profileDir)
      session.cookies = cookies
      session.isLoggedIn = !!cookies
      session.error = cookies ? undefined : 'No YouTube cookies'
      session.usedToday = 0
      return !!cookies
    } catch (e) {
      session.error = String(e)
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

export function getSessionManager(sessionCount = 30): ChromeSessionManager {
  if (!_manager) _manager = new ChromeSessionManager(sessionCount)
  return _manager
}