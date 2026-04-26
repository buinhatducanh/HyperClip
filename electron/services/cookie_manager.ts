/**
 * Cookie Manager — HyperClip
 *
 * Extracts cookies from Chrome/Edge on Windows using Python + DPAPI.
 * Auto-refreshes every 15 minutes and writes Netscape-format cookie files
 * for use with yt-dlp and HTTP requests.
 */

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import https from 'https'
import http from 'http'
import { URL } from 'url'
import { EventEmitter } from 'events'

// Auth status change event bus — main.ts listens to relay to renderer
export const authEvents = new EventEmitter()

// Channel sync event — emitted after OAuth subscriptions are synced to store
export const channelEvents = new EventEmitter()

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CookieData {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  expires: number // Unix timestamp (seconds)
}

export interface CookieRefreshResult {
  success: boolean
  cookieFile: string
  cookies: CookieData[]
  browser: 'chrome' | 'edge' | 'none'
  error?: string
}

export interface CookieManager {
  getCookieFile(): string
  getCookies(): CookieData[]
  getSessionHeader(): string
  refresh(): Promise<CookieRefreshResult>
  isReady(): boolean
  ensureInit(): Promise<void>
  startAutoRefresh(onRefresh?: (result: CookieRefreshResult) => void): void
  validateCookies(): Promise<boolean>
  getAuthStatus(): AuthStatus
  logout(): Promise<void>
}

export interface AuthStatus {
  isReady: boolean
  cookieCount: number
  loggedOut: boolean
  accountName: string
  oauthReady: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

// Chrome/Edge base data paths
const CHROME_BASE = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default')
const EDGE_BASE = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data', 'Default')
const CHROME_COOKIES = path.join(CHROME_BASE, 'Network', 'Cookies')
const CHROME_COOKIES_FALLBACK = path.join(CHROME_BASE, 'Cookies')
const EDGE_COOKIES = path.join(EDGE_BASE, 'Network', 'Cookies')
const EDGE_COOKIES_FALLBACK = path.join(EDGE_BASE, 'Cookies')

const YOUTUBE_DOMAINS = ['.youtube.com', '.googlevideo.com', '.google.com']

// Temp dir for cookie extraction
function getTempDir(): string {
  return path.join(os.tmpdir(), 'hyperclip-cookies')
}

// ─── Python extraction script (embedded) ──────────────────────────────────────

/**
 * Python script to extract cookies from Chromium SQLite DB.
 * Handles DPAPI-encrypted cookies on Windows using win32crypt.
 * If DB is locked, it copies to temp first.
 */
function getPythonScript(): string {
  return `
import sqlite3, os, sys, shutil, win32crypt, tempfile, json

def extract_cookies(cookies_path, output_path):
    domains = ['.youtube.com', '.googlevideo.com', '.google.com']

    # Copy to temp if file is locked (browser running)
    temp_path = None
    try:
        test_conn = sqlite3.connect(cookies_path, timeout=1)
        test_conn.close()
    except sqlite3.OperationalError:
        temp_path = os.path.join(tempfile.gettempdir(), f'hc_cookies_{os.getpid()}.db')
        shutil.copy2(cookies_path, temp_path)
        cookies_path = temp_path

    try:
        conn = sqlite3.connect(cookies_path)
        cursor = conn.cursor()

        lines = ['# Netscape HTTP Cookie File\\n']
        cookie_list = []

        for domain in domains:
            cursor.execute("""
                SELECT host_key, name, value, path, secure, expires_utc, is_secure
                FROM cookies WHERE host_key LIKE ?
            """, (f'%{domain}',))

            for row in cursor.fetchall():
                host_key, name, enc_value, path, secure, expires_utc, is_secure = row
                try:
                    dec = win32crypt.CryptUnprotectData(enc_value, None, None, None, 0)[1]
                    dec_str = dec.decode('utf-8', errors='replace')

                    secure_flag = 'TRUE' if (is_secure or secure) else 'FALSE'
                    # expires_utc is in microseconds since 1601-01-01
                    if expires_utc and expires_utc > 0:
                        expires_ts = int(expires_utc / 1000000 - 11644473600)
                    else:
                        expires_ts = 0

                    domain_str = host_key if host_key.startswith('.') else '.' + host_key
                    lines.append(f'{domain_str}\\tTRUE\\t{path}\\t{secure_flag}\\t{expires_ts}\\t{name}\\t{dec_str}\\n')

                    cookie_list.append({
                        'name': name,
                        'value': dec_str,
                        'domain': domain_str,
                        'path': path or '/',
                        'secure': is_secure or secure == 1,
                        'expires': expires_ts,
                    })
                except Exception:
                    pass

        conn.close()

        with open(output_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)

        result = {'success': True, 'cookieCount': len(cookie_list), 'cookies': cookie_list}
        print(json.dumps(result))
    except Exception as e:
        result = {'success': False, 'error': str(e)}
        print(json.dumps(result))
    finally:
        if temp_path and os.path.exists(temp_path):
            try: os.remove(temp_path)
            except: pass

if __name__ == '__main__':
    cookies_path = sys.argv[1]
    output_path = sys.argv[2]
    extract_cookies(cookies_path, output_path)
`
}

// Find Python executable
function getPythonPath(): string {
  // Check PATH first — this finds the active Python installation
  const pathEnv = (process.env.PATH || '').split(path.delimiter)
  for (const dir of pathEnv) {
    const py = path.join(dir, 'python.exe')
    if (fs.existsSync(py)) return py
    const py3 = path.join(dir, 'python3.exe')
    if (fs.existsSync(py3)) return py3
  }

  // Fallback: common installation paths
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python314', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.APPDATA || '', 'Python', 'Python314', 'python.exe'),
    path.join(process.env.APPDATA || '', 'Python', 'Python313', 'python.exe'),
    path.join(process.env.APPDATA || '', 'Python', 'Python312', 'python.exe'),
    'python3',
    'python',
  ]

  for (const py of candidates) {
    try {
      if (fs.existsSync(py)) return py
    } catch {}
  }

  return 'python'
}

// Find cookie DB path for Chrome or Edge
function findCookieDB(): { path: string; browser: 'chrome' | 'edge' | 'none' } {
  // Try Chrome first
  const chromePaths = [CHROME_COOKIES, CHROME_COOKIES_FALLBACK]
  for (const p of chromePaths) {
    try {
      if (fs.existsSync(p)) return { path: p, browser: 'chrome' }
    } catch {}
  }

  // Try Edge
  const edgePaths = [EDGE_COOKIES, EDGE_COOKIES_FALLBACK]
  for (const p of edgePaths) {
    try {
      if (fs.existsSync(p)) return { path: p, browser: 'edge' }
    } catch {}
  }

  return { path: '', browser: 'none' }
}

// ─── Cookie Manager Implementation ────────────────────────────────────────────

class ChromiumCookieManager implements CookieManager {
  private _cookieFile: string = ''
  private _cookies: CookieData[] = []
  private _pythonScriptFile: string = ''
  private _pythonPath: string = ''
  private _lastRefresh: number = 0
  private _refreshTimer: NodeJS.Timeout | null = null
  private _initPromise: Promise<void> | null = null
  // OAuth state
  private _oauthReady: boolean = false
  private _accountName: string = ''
  private _oauthFlowStarted: boolean = false // guard: don't re-trigger OAuth window in same session

  constructor() {
    this._pythonPath = getPythonPath()
    this._cookieFile = path.join(getTempDir(), 'youtube_cookies.txt')
    this._pythonScriptFile = path.join(getTempDir(), 'extract_cookies.py')

    // Ensure temp dir exists
    const tmpDir = getTempDir()
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true })
    }

    // Write Python script once
    fs.writeFileSync(this._pythonScriptFile, getPythonScript(), 'utf-8')

    // Initialize — check OAuth first, then cookie fallback
    this._initPromise = this._init()
  }

  private async _init(): Promise<void> {
    // Check if OAuth tokens exist — if so, use OAuth
    try {
      const { getOAuthClientId, loadTokens, fetchAccountInfo } = await import('./youtube_auth.js')
      const clientId = getOAuthClientId()
      const tokens = clientId ? loadTokens() : null
      if (tokens?.access_token) {
        console.log('[CookieManager] OAuth tokens found — activating')
        this._oauthReady = true
        try {
          this._accountName = await fetchAccountInfo(tokens.access_token) || ''
        } catch {}
        // Emit immediately so renderer gets the logged-in state
        authEvents.emit('authUpdated', this.getAuthStatus())
        return
      }
      // No tokens — auto-start OAuth flow
      if (clientId) {
        console.log('[CookieManager] Starting OAuth automatically...')
        this._autoStartOAuth(clientId)
        return
      }
    } catch {}

    // No OAuth — fall back to cookie extraction
    console.log('[CookieManager] No OAuth — falling back to cookie extraction')
    await this.refresh()
  }

  /** Auto-start OAuth flow on boot — Chrome opens, user approves, callback resolves */
  private _autoStartOAuth(clientId: string): void {
    // Guard: only one OAuth window per session
    if (this._oauthFlowStarted || this._oauthReady) return
    this._oauthFlowStarted = true
    import('./youtube_auth.js').then(async ({ startOAuthFlow, fetchAccountInfo }) => {
      const result = await startOAuthFlow(clientId)
      if (result.success && result.tokens) {
        console.log('[CookieManager] OAuth auto-login succeeded')
        this._oauthReady = true
        try {
          this._accountName = await fetchAccountInfo(result.tokens.access_token) || ''
          if (this._accountName) console.log('[CookieManager] Account:', this._accountName)
        } catch {}
        // Notify listeners that auth status changed
        authEvents.emit('authUpdated', this.getAuthStatus())
      } else {
        console.warn('[CookieManager] OAuth auto-login failed:', result.error)
      }
    }).catch((e: Error) => {
      console.warn('[CookieManager] OAuth flow error:', e.message)
    })
  }

  async ensureInit(): Promise<void> {
    if (this._initPromise) await this._initPromise
  }

  getCookieFile(): string {
    return this._cookieFile
  }

  getCookies(): CookieData[] {
    return this._cookies
  }

  /** Build a session cookie header for yt-dlp / HTTP requests */
  getSessionHeader(): string {
    if (this._cookies.length === 0) return ''
    return this._cookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ')
  }

  isReady(): boolean {
    return this._cookies.length > 0 && fs.existsSync(this._cookieFile)
  }

  async refresh(): Promise<CookieRefreshResult> {
    const { path: dbPath, browser } = findCookieDB()

    if (!dbPath || browser === 'none') {
      return {
        success: false,
        cookieFile: this._cookieFile,
        cookies: [],
        browser: 'none',
        error: 'No Chrome or Edge cookie database found. Make sure Chrome/Edge is installed and you have logged into YouTube.',
      }
    }

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      const proc = spawn(this._pythonPath, [this._pythonScriptFile, dbPath, this._cookieFile], {
        env: { ...process.env },
        windowsHide: true,
        shell: true,
      })

      proc.stdout?.on('data', (d) => { stdout += d.toString() })
      proc.stderr?.on('data', (d) => { stderr += d.toString() })

      proc.on('error', (err) => {
        resolve({
          success: false,
          cookieFile: this._cookieFile,
          cookies: [],
          browser,
          error: `Python spawn error: ${err.message}`,
        })
      })

      proc.on('close', (code) => {
        this._lastRefresh = Date.now()

        if (code !== 0 || !stdout.trim()) {
          resolve({
            success: false,
            cookieFile: this._cookieFile,
            cookies: [],
            browser,
            error: `Python exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
          })
          return
        }

        try {
          const result = JSON.parse(stdout.trim())

          if (!result.success) {
            resolve({
              success: false,
              cookieFile: this._cookieFile,
              cookies: [],
              browser,
              error: result.error || 'Unknown extraction error',
            })
            return
          }

          this._cookies = result.cookies || []
          console.log(`[CookieManager] Extracted ${this._cookies.length} cookies from ${browser} (DB: ${dbPath})`)

          resolve({
            success: true,
            cookieFile: this._cookieFile,
            cookies: this._cookies,
            browser,
          })
        } catch (e) {
          resolve({
            success: false,
            cookieFile: this._cookieFile,
            cookies: [],
            browser,
            error: `JSON parse error: ${e}. stdout: ${stdout.slice(0, 200)}`,
          })
        }
      })

      // Timeout after 15 seconds
      setTimeout(() => {
        try { proc.kill() } catch {}
        resolve({
          success: false,
          cookieFile: this._cookieFile,
          cookies: this._cookies,
          browser,
          error: 'Cookie extraction timed out after 15s',
        })
      }, 15_000)
    })
  }

  /** Start auto-refresh timer */
  startAutoRefresh(onRefresh?: (result: CookieRefreshResult) => void): void {
    if (this._refreshTimer) return

    this._refreshTimer = setInterval(async () => {
      console.log('[CookieManager] Auto-refreshing cookies...')
      const result = await this.refresh()
      if (result.success) {
        console.log(`[CookieManager] Refresh OK — ${result.cookies.length} cookies from ${result.browser}`)
      } else {
        console.warn(`[CookieManager] Refresh failed: ${result.error}`)
      }
      onRefresh?.(result)
    }, REFRESH_INTERVAL_MS)
  }

  stopAutoRefresh(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer)
      this._refreshTimer = null
    }
  }

  /** Check if cookies are still valid by making a test HTTP request to YouTube */
  async validateCookies(): Promise<boolean> {
    if (this._cookies.length === 0) return false

    const sessionHeader = this.getSessionHeader()
    if (!sessionHeader) return false

    // Quick HEAD request to YouTube with cookies
    return new Promise((resolve) => {
      const url = 'https://www.youtube.com'
      const parsedUrl = new URL(url)

      const options = {
        hostname: parsedUrl.hostname,
        path: '/',
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': sessionHeader,
          'Accept': 'text/html',
        },
      }

      const req = https.get(options, (res) => {
        // If we get redirected to sign-in, cookies are expired
        const location = res.headers.location || ''
        const isSignedOut = location.includes('consent.google.com') ||
          res.headers['www-authenticate'] ||
          (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location.includes('youtube.com/sign'))

        resolve(!isSignedOut && res.statusCode !== 401)
      })

      req.on('error', () => resolve(false))
      req.setTimeout(8000, () => { req.destroy(); resolve(false) })
    })
  }

  getAuthStatus(): AuthStatus {
    return {
      isReady: this._oauthReady || this.isReady(),
      cookieCount: this._cookies.length,
      loggedOut: !this._oauthReady && this._cookies.length === 0,
      accountName: this._accountName,
      oauthReady: this._oauthReady,
    }
  }

  async logout(): Promise<void> {
    this._oauthReady = false
    this._accountName = ''
    this._cookies = []
    this._initPromise = Promise.resolve()
    try {
      const { clearTokens } = await import('./youtube_auth.js')
      clearTokens()
    } catch {}
    authEvents.emit('authUpdated', this.getAuthStatus())
  }
}

// Singleton instance
let _manager: ChromiumCookieManager | null = null

export function getCookieManager(): CookieManager {
  if (!_manager) {
    _manager = new ChromiumCookieManager()
  }
  return _manager
}

// Quick init function for main.ts to call on startup
export async function initCookieManager(): Promise<CookieRefreshResult> {
  const mgr = getCookieManager()
  await mgr.ensureInit()
  // Return current status (don't block on OAuth — it's async)
  return {
    success: mgr.isReady(),
    cookieFile: mgr.getCookieFile(),
    cookies: mgr.getCookies(),
    browser: 'chrome',
  }
}

export function stopCookieManager(): void {
  if (_manager) {
    _manager.stopAutoRefresh()
  }
}