"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChromeSessionManager = void 0;
exports.toSessionPublic = toSessionPublic;
exports.getHyperClipProfileDir = getHyperClipProfileDir;
exports.getDefaultChromeProfileDir = getDefaultChromeProfileDir;
exports.getChromeExe = getChromeExe;
exports.decryptDPAPIKey = decryptDPAPIKey;
exports.extractYouTubeCookies = extractYouTubeCookies;
exports.launchChromeForLogin = launchChromeForLogin;
exports.computeSAPISIDHASH = computeSAPISIDHASH;
exports.getSessionManager = getSessionManager;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const sql_js_1 = __importDefault(require("sql.js"));
const unified_log_js_1 = require("./unified_log.js");
const paths_js_1 = require("./paths.js");
/** Sanitize a session object — strips all sensitive data before IPC */
function toSessionPublic(s) {
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
    };
}
// ─── Paths ─────────────────────────────────────────────────────────────────────
const LOCALAPPDATA = process.env.LOCALAPPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Local');
// Dedicated HyperClip profile directory (created by us) — stored at D:\HyperClip-Data\chrome-profiles
function getHyperClipProfileDir(profileId) {
    return path_1.default.join((0, paths_js_1.getChromeProfilesDir)(), `profile-${profileId}`);
}
// User's default Chrome profile (already logged in)
function getDefaultChromeProfileDir() {
    // Chrome stores the default profile at User Data\Default
    return path_1.default.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default');
}
// Chrome installation path
function getChromeExe() {
    const chromePath = path_1.default.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (fs_1.default.existsSync(chromePath))
        return chromePath;
    // Try other paths
    const altPaths = [
        path_1.default.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path_1.default.join(os_1.default.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of altPaths) {
        if (fs_1.default.existsSync(p))
            return p;
    }
    return chromePath;
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
async function decryptDPAPIKey(localStatePath) {
    try {
        const raw = fs_1.default.readFileSync(localStatePath, 'utf-8');
        const json = JSON.parse(raw);
        const encryptedKeyB64 = json.os_crypt?.encrypted_key;
        if (!encryptedKeyB64) {
            (0, unified_log_js_1.devLog)(`[DPAPI] No os_crypt.encrypted_key in ${localStatePath}. Keys: ${Object.keys(json).join(', ')}`);
            return null;
        }
        const encryptedKey = Buffer.from(encryptedKeyB64, 'base64');
        const prefix = encryptedKey.slice(0, 3).toString('ascii');
        if (prefix === 'v10') {
            // Chrome v80+: v10 prefix + nonce(12) + encrypted_key_bytes + authTag(16)
            // The encrypted_key_bytes is DPAPI-wrapped — unwrap it to get raw AES key
            const nonce = encryptedKey.slice(3, 15);
            const encryptedKeyBytes = encryptedKey.slice(15, -16);
            const authTag = encryptedKey.slice(-16);
            // DPAPI unwrap the encrypted AES key bytes
            const keyData = encryptedKeyBytes.toString('base64');
            const result = await runPowerShellSync(`Add-Type -AssemblyName System.Security; ` +
                `$encrypted = [Convert]::FromBase64String('${keyData}'); ` +
                `$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
                `$encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
                `[Convert]::ToBase64String($decrypted)`);
            if (!result) {
                (0, unified_log_js_1.devLog)(`[DPAPI] v10: PowerShell DPAPI unwrap returned null`);
                return null;
            }
            const aesKey = Buffer.from(result.trim(), 'base64');
            (0, unified_log_js_1.devLog)(`[DPAPI] v10: Decrypted AES key OK (${aesKey.length} bytes, nonce=${nonce.length}, tag=${authTag.length})`);
            return aesKey;
        }
        else if (prefix === 'DPA') {
            // Old Chrome v<80: just DPAPI-encrypted, result is raw AES key
            const keyData = encryptedKey.slice(5).toString('base64');
            const result = await runPowerShellSync(`Add-Type -AssemblyName System.Security; ` +
                `$encrypted = [Convert]::FromBase64String('${keyData}'); ` +
                `$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
                `$encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
                `[Convert]::ToBase64String($decrypted)`);
            if (!result) {
                (0, unified_log_js_1.devLog)(`[DPAPI] DPA: PowerShell returned null`);
                return null;
            }
            (0, unified_log_js_1.devLog)(`[DPAPI] DPA: Decrypted key OK (${result.length} chars)`);
            return Buffer.from(result.trim(), 'base64');
        }
        else {
            // Unknown format — try raw base64 as AES key
            (0, unified_log_js_1.devLog)(`[DPAPI] Unknown prefix: ${prefix} (${encryptedKey.slice(0, 5).toString('hex')}). Trying raw base64.`);
            return encryptedKey;
        }
    }
    catch (e) {
        (0, unified_log_js_1.devLog)(`[DPAPI] Exception: ${e}`);
        return null;
    }
}
/** Spawn PowerShell and return stdout. Returns null on failure. */
function runPowerShellSync(script, timeoutMs = 15000) {
    return new Promise((resolve) => {
        const ps = (0, child_process_1.spawn)('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', script], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '';
        ps.stdout.on('data', (d) => { stdout += d.toString(); });
        ps.stderr.on('data', (d) => { stderr += d.toString(); });
        ps.on('close', (code) => {
            if (code === 0 && stdout.trim())
                resolve(stdout.trim());
            else
                resolve(null);
        });
        ps.on('error', () => resolve(null));
        setTimeout(() => { try {
            ps.kill();
        }
        catch { } resolve(null); }, timeoutMs);
    });
}
/** Spawn PowerShell async — for non-blocking operations */
function runPowerShellAsync(script, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const ps = (0, child_process_1.spawn)('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', script], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '';
        ps.stdout.on('data', (d) => { stdout += d.toString(); });
        ps.stderr.on('data', (d) => { stderr += d.toString(); });
        ps.on('close', (code) => {
            resolve(code === 0 && stdout.trim() ? stdout.trim() : null);
        });
        ps.on('error', () => resolve(null));
        setTimeout(() => { try {
            ps.kill();
        }
        catch { } resolve(null); }, timeoutMs);
    });
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
function decryptCookieValue(encrypted, aesKey) {
    try {
        const prefix = encrypted.slice(0, 5).toString('hex');
        // v1: just DPAPI-encrypted → DPAPI Unprotect
        if (prefix === '4450415049') {
            const keyData = encrypted.slice(5).toString('base64');
            const result = runPowerShellSync(`Add-Type -AssemblyName System.Security; ` +
                `$encrypted = [Convert]::FromBase64String('${keyData}'); ` +
                `$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
                `$encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
                `[Convert]::ToBase64String($decrypted)`);
            if (!result)
                return null;
            return Buffer.from(result.trim(), 'base64').toString('utf8');
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
                let pos = 4;
                let keyIdLen = 0, shift = 0;
                while (pos < encrypted.length) {
                    const b = encrypted[pos++];
                    keyIdLen |= (b & 0x7F) << shift;
                    if ((b & 0x80) === 0)
                        break;
                    shift += 7;
                }
                const salt = encrypted.slice(pos + keyIdLen, pos + keyIdLen + 16);
                const nonce = encrypted.slice(pos + keyIdLen + 16, pos + keyIdLen + 16 + 12);
                const ctWithTag = encrypted.slice(pos + keyIdLen + 28);
                const tag = ctWithTag.slice(-16);
                const ct = ctWithTag.slice(0, -16);
                // Derive per-cookie key: SHA256(masterKey + salt)
                const cookieKey = crypto_1.default.createHash('sha256').update(Buffer.concat([aesKey, salt])).digest();
                try {
                    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', cookieKey, nonce);
                    decipher.setAuthTag(tag);
                    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
                }
                catch {
                    return null;
                }
            }
            // v10: use aesKey directly
            const nonce = encrypted.slice(1, 13);
            const ciphertextWithTag = encrypted.slice(13);
            const tag = ciphertextWithTag.slice(-16);
            const ciphertext = ciphertextWithTag.slice(0, -16);
            const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', aesKey, nonce);
            decipher.setAuthTag(tag);
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            return decrypted.toString('utf8');
        }
        // Unknown format — try as DPAPI
        const result = runPowerShellSync(`Add-Type -AssemblyName System.Security; ` +
            `$encrypted = [Convert]::FromBase64String('${encrypted.toString('base64')}'); ` +
            `$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
            `$encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
            `[Convert]::ToBase64String($decrypted)`);
        if (!result)
            return null;
        return Buffer.from(result.trim(), 'base64').toString('utf8');
    }
    catch {
        return null;
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
function validateSocsConsent(socs) {
    if (!socs) {
        console.warn('[Cookie] ⚠️ No SOCS cookie found — user may not be logged in to YouTube');
        return undefined;
    }
    if (socs.startsWith('CAA')) {
        console.warn(`[Cookie] ⚠️ SOCS=${socs} — User has NOT accepted Google/YouTube terms. ` +
            `Session will likely fail. Please open Chrome, log into YouTube, and accept any terms prompts.`);
        return undefined;
    }
    // CAI or other valid value
    return socs;
}
// ─── SQLite Cookie Parsing ────────────────────────────────────────────────────
/**
 * Extract YouTube cookies from a Chrome profile's SQLite cookie database.
 * Handles the file being locked (Chrome running) by copying first.
 *
 * Required cookies for Innertube API auth:
 *   SAPISID, __Secure-1PSID, __Secure-1PSIDTS, __Secure-1PSIDCC
 */
async function extractYouTubeCookies(profileDir) {
    // Fast path: try persisted CDP cookies first (written by openLoginWindow)
    // Profile dir may be the "Default" folder (for Chrome profile 1) or root HyperClip dir (2-30)
    const isDefaultChrome = profileDir.endsWith('Default') && profileDir.includes('Chrome');
    const fastPaths = [
        // For Chrome Default: cookies persisted at parent level (User Data\_hyperclip_cookies.json)
        // For HyperClip profiles: cookies persisted at Default level (Default\_hyperclip_cookies.json)
        isDefaultChrome
            ? path_1.default.join(profileDir, '..', '_hyperclip_cookies.json')
            : path_1.default.join(profileDir, '_hyperclip_cookies.json'),
        path_1.default.join(profileDir, '_hyperclip_cookies.json'),
        path_1.default.join(profileDir, 'Default', '_hyperclip_cookies.json'),
        path_1.default.join(profileDir, '..', 'Default', '_hyperclip_cookies.json'),
    ];
    for (const persistedPath of fastPaths) {
        if (fs_1.default.existsSync(persistedPath)) {
            try {
                const raw = fs_1.default.readFileSync(persistedPath, 'utf8');
                const cookies = JSON.parse(raw);
                const rawSocs = cookies.socs ?? null;
                if (!cookies.socs || cookies.socs.startsWith('CAA')) {
                    cookies.socs = 'CAI';
                }
                if (cookies.SAPISID && cookies.PSID) {
                    (0, unified_log_js_1.devLog)(`[Cookie] Loaded persisted cookies (from CDP login) for ${persistedPath}`);
                    return { cookies, rawSocs };
                }
            }
            catch { }
        }
    }
    const cookieDbPath = path_1.default.join(profileDir, 'Default', 'Network', 'Cookies');
    const localStatePath = path_1.default.join(profileDir, 'Local State');
    (0, unified_log_js_1.devLog)(`[Cookie] extractYouTubeCookies: dir=${profileDir}, dbExists=${fs_1.default.existsSync(cookieDbPath)}, localStateExists=${fs_1.default.existsSync(localStatePath)}`);
    if (!fs_1.default.existsSync(cookieDbPath)) {
        const altLocalState = path_1.default.join(profileDir, '..', 'Local State');
        (0, unified_log_js_1.devLog)(`[Cookie] No Cookies DB at ${cookieDbPath}, alt Local State exists: ${fs_1.default.existsSync(altLocalState)}`);
        if (fs_1.default.existsSync(altLocalState)) {
            return extractYouTubeCookiesFromPath(cookieDbPath, altLocalState);
        }
        return { cookies: null, rawSocs: null };
    }
    return await extractYouTubeCookiesFromPath(cookieDbPath, localStatePath);
}
async function extractYouTubeCookiesFromPath(cookieDbPath, localStatePath) {
    // Get DPAPI key (Buffer for AES-GCM decryption)
    const aesKey = await decryptDPAPIKey(localStatePath);
    if (!aesKey) {
        (0, unified_log_js_1.devLog)(`[Cookie] decryptDPAPIKey returned null for ${localStatePath}`);
        return { cookies: null, rawSocs: null };
    }
    (0, unified_log_js_1.devLog)(`[Cookie] DPAPI key OK, path=${localStatePath}`);
    // Read cookie DB (may be locked by Chrome)
    // Retry up to 3 times with 500ms delay to handle transient locks.
    let dbBuffer = null;
    const copyPath = cookieDbPath + '.hyperclip';
    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 1000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            dbBuffer = fs_1.default.readFileSync(cookieDbPath);
            break; // Success
        }
        catch (e) {
            const errCode = e.code || '';
            if (attempt < MAX_RETRIES) {
                const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), 8000);
                (0, unified_log_js_1.devLog)(`[Cookie] DB locked (${errCode}), retry ${attempt}/${MAX_RETRIES - 1} in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            else {
                (0, unified_log_js_1.devLog)(`[Cookie] DB still locked after ${MAX_RETRIES - 1} retries — trying copy fallback...`);
                try {
                    // Use read+write — copyFileSync fails with EBUSY on Chrome-locked files
                    const srcBuf = fs_1.default.readFileSync(cookieDbPath);
                    fs_1.default.writeFileSync(copyPath, srcBuf);
                    dbBuffer = srcBuf;
                    (0, unified_log_js_1.devLog)(`[Cookie] Read DB via buffer fallback (Chrome may still be writing)`);
                    break;
                }
                catch (copyErr) {
                    const copyErrCode = copyErr.code || '';
                    console.error(`[Cookie] ⚠️ Cookie DB locked after ${MAX_RETRIES} retries AND copy failed (${copyErrCode}). Close Chrome, or open YouTube in a HyperClip Chrome profile, then restart.`);
                    return { cookies: null, rawSocs: null };
                }
            }
        }
    }
    if (!dbBuffer)
        return { cookies: null, rawSocs: null };
    try {
        // __dirname = dist-electron/ in dev, <app>.asar/ in prod
        // node_modules/sql.js lives at project root in dev, at app.asar.unpacked/node_modules in prod
        const sqlJsDist = electron_1.app.isPackaged
            ? path_1.default.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist')
            : path_1.default.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist');
        (0, unified_log_js_1.devLog)(`[Cookie] sql.js loading WASM from: ${sqlJsDist}`);
        const SqlJs = await (0, sql_js_1.default)({
            locateFile: (f) => path_1.default.join(sqlJsDist, f),
        });
        (0, unified_log_js_1.devLog)(`[Cookie] sql.js loaded, opening DB...`);
        const db = new SqlJs.Database(dbBuffer);
        (0, unified_log_js_1.devLog)(`[Cookie] sql.js DB opened, querying...`);
        // Query YouTube cookies
        // Chrome stores encrypted values in the 'encrypted_value' column
        // Plain values are stored in 'value' column for non-encrypted cookies
        const result = db.exec(`
      SELECT host_key, name, value, encrypted_value
      FROM cookies
      WHERE (host_key LIKE '%youtube.com%' OR host_key LIKE '%.google.com%' OR host_key = 'google.com')
        AND name IN ('SAPISID', '__Secure-1PSID', '__Secure-1PSIDTS', '__Secure-1PSIDCC', '__Secure-3PSID', 'LOGGED_IN', '__Secure-1PAPISID', 'SOCS')
    `);
        if (!result.length || !result[0].values.length) {
            (0, unified_log_js_1.devLog)(`[Cookie] No YouTube cookies found in DB for ${cookieDbPath}`);
            db.close();
            return { cookies: null, rawSocs: null };
        }
        (0, unified_log_js_1.devLog)(`[Cookie] Found ${result[0].values.length} cookie rows: ${result[0].values.map((r) => String(r[1]) + '@' + String(r[0]).slice(0, 20)).join(', ')}`);
        const cookies = {};
        for (const row of result[0].values) {
            const hostKey = String(row[0]);
            const name = String(row[1]);
            const plainValue = row[2] ? String(row[2]) : '';
            const encryptedValue = row[3];
            let value = plainValue;
            if (!value && (encryptedValue instanceof Uint8Array || Buffer.isBuffer(encryptedValue))) {
                const buf = Buffer.from(encryptedValue);
                const decrypted = decryptCookieValue(buf, aesKey);
                if (decrypted)
                    value = decrypted;
            }
            if (!value)
                continue;
            if (name === 'SAPISID')
                cookies.SAPISID = value;
            else if (name === '__Secure-1PSID')
                cookies.PSID = value;
            else if (name === '__Secure-1PSIDTS')
                cookies.PSIDTS = value;
            else if (name === '__Secure-1PSIDCC')
                cookies.PSIDCC = value;
            else if (name === '__Secure-3PSID') {
                if (!cookies.PSID)
                    cookies.PSID = value;
            }
            else if (name === 'SOCS')
                cookies.socs = value;
        }
        db.close();
        const rawSocs = cookies.socs ?? null;
        // Auto-inject SOCS=CAI to bypass Google Consent screens automatically
        if (!cookies.socs || cookies.socs.startsWith('CAA')) {
            cookies.socs = 'CAI';
        }
        if (cookies.SAPISID && cookies.PSID) {
            return { cookies: cookies, rawSocs };
        }
        return { cookies: null, rawSocs };
    }
    catch (e) {
        (0, unified_log_js_1.devLog)(`[Cookie] sql.js error: ${e}`);
        return { cookies: null, rawSocs: null };
    }
}
// ─── Chrome Profile Management ─────────────────────────────────────────────────
const HYPERCLIP_PROFILE_PREFIX = 'HyperClip-Chrome-Profile-';
// NOTE: The actual session count used at runtime is determined by getSessionCount() (RAM-aware).
// This constant defines the max profile directories that may exist on disk.
const DEFAULT_SESSION_COUNT = 30;
/** Get all HyperClip-managed Chrome profile directories */
function getHyperClipProfileDirs() {
    const dirs = [];
    for (let i = 1; i <= DEFAULT_SESSION_COUNT; i++) {
        const dir = getHyperClipProfileDir(String(i));
        if (fs_1.default.existsSync(dir))
            dirs.push(dir);
    }
    return dirs;
}
/**
 * Launch Chrome with a specific profile, opening YouTube for login.
 * Returns the process handle so we can wait for it to close.
 */
function launchChromeForLogin(profileId) {
    const chromeExe = getChromeExe();
    if (!fs_1.default.existsSync(chromeExe)) {
        console.warn('[SessionManager] Chrome not found at:', chromeExe);
        return null;
    }
    const isDefaultChrome = profileId === '1';
    const profileDir = isDefaultChrome
        ? getDefaultChromeProfileDir()
        : getHyperClipProfileDir(profileId);
    // Ensure profile directory exists (for non-default profiles)
    if (!isDefaultChrome) {
        const defaultDir = path_1.default.join(profileDir, 'Default');
        if (!fs_1.default.existsSync(defaultDir)) {
            fs_1.default.mkdirSync(defaultDir, { recursive: true });
        }
    }
    const args = [
        `--user-data-dir=${profileDir}`,
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-first-run-ui',
        'https://www.youtube.com'
    ];
    const chromeProcess = (0, child_process_1.spawn)(chromeExe, args, {
        detached: false,
        stdio: 'ignore',
    });
    chromeProcess.on('error', (e) => {
        console.warn('[SessionManager] Chrome launch error:', e);
    });
    return { process: chromeProcess, profileDir };
}
// ─── SAPISIDHASH ─────────────────────────────────────────────────────────────
/**
 * Compute the SAPISIDHASH header value.
 * This is YouTube's internal authentication mechanism for AJAX requests.
 *
 * Format: {timestamp}_{sha1(timestamp + " " + SAPISID + " " + origin)}
 * origin = "https://www.youtube.com"
 */
function computeSAPISIDHASH(sapisid, timestamp) {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const origin = 'https://www.youtube.com';
    const message = `${ts} ${sapisid} ${origin}`;
    const hash = crypto_1.default.createHash('sha1').update(message).digest('hex');
    return `${ts}_${hash}`;
}
// ─── Session Manager ────────────────────────────────────────────────────────────
class ChromeSessionManager {
    _sessionCount;
    _sessions = [];
    _index = 0;
    _initialized = false;
    _initPromise = null;
    constructor(_sessionCount = DEFAULT_SESSION_COUNT) {
        this._sessionCount = _sessionCount;
        this._initPromise = this._init();
    }
    async _init() {
        (0, unified_log_js_1.devLog)(`[SessionManager] Initializing ${this._sessionCount} Chrome profiles...`);
        // Session 1: use user's existing Chrome profile (already logged in)
        // Sessions 2-30: use dedicated HyperClip profiles
        for (let i = 1; i <= this._sessionCount; i++) {
            const profileId = String(i);
            const isDefaultChrome = i === 1;
            const profileDir = isDefaultChrome
                ? getDefaultChromeProfileDir()
                : getHyperClipProfileDir(profileId);
            // Default Chrome profile: cookies at <profileDir>\Network\Cookies (no extra Default subfolder)
            // HyperClip profiles: cookies at <profileDir>\Default\Network\Cookies
            const cookieDbPath = isDefaultChrome
                ? path_1.default.join(profileDir, 'Network', 'Cookies')
                : path_1.default.join(profileDir, 'Default', 'Network', 'Cookies');
            const profileExists = fs_1.default.existsSync(cookieDbPath);
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
            });
        }
        // PROACTIVE: load persisted CDP cookies (instant — from disk).
        // Then start background CDP login for any session still missing cookies.
        (0, unified_log_js_1.devLog)('[SessionManager] Loading persisted cookies and starting background login...');
        const BATCH = 10;
        for (let i = 0; i < this._sessions.length; i += BATCH) {
            const batch = this._sessions.slice(i, i + BATCH);
            await Promise.all(batch.map(async (session) => {
                try {
                    const { cookies, rawSocs } = await extractYouTubeCookies(session.profileDir);
                    session.cookies = cookies;
                    session.rawSocs = rawSocs;
                    session.rawSocs = cookies?.socs ?? null;
                    session.isLoggedIn = !!(cookies?.SAPISID && cookies?.PSID);
                    if (session.isLoggedIn) {
                        session.wasLoggedIn = true;
                        session.lastRefreshAt = Date.now();
                        session.refreshFailCount = 0;
                    }
                    session.isConsented = !!(cookies?.socs && !cookies.socs.startsWith('CAA'));
                    if (!cookies) {
                        session.error = 'No cookies — click "Mở Chrome" in Settings to login';
                    }
                    else {
                        // Persist cookies immediately so next startup doesn't need extraction
                        this._persistCookiesToFile(session.profileId, cookies);
                        if (!session.isLoggedIn) {
                            session.error = 'Missing SAPISID or __Secure-1PSID cookie';
                        }
                        else if (!session.isConsented) {
                            session.error = 'SOCS cookie indicates terms not accepted — open YouTube in Chrome and accept any prompts';
                        }
                        else {
                            session.error = undefined;
                        }
                    }
                    if (session.profileId === '1' || session.profileId === '2') {
                        (0, unified_log_js_1.devLog)(`[SessionManager] Profile ${session.profileId}: cookies=${!!cookies}, isLoggedIn=${session.isLoggedIn}, isConsented=${session.isConsented}, socs="${cookies?.socs?.slice(0, 10) ?? 'null'}"`);
                    }
                }
                catch (e) {
                    session.error = String(e);
                }
            }));
        }
        // Force SOCS=CAI for all sessions — ensures isConsented=true for all working sessions
        // This overrides CAA or missing SOCS that would otherwise cause auth errors
        for (const session of this._sessions) {
            if (session.cookies && (!session.cookies.socs || session.cookies.socs.startsWith('CAA'))) {
                session.cookies.socs = 'CAI';
                session.isConsented = true;
            }
        }
        const valid = this._sessions.filter(s => s.cookies && s.isConsented);
        (0, unified_log_js_1.devLog)(`[SessionManager] ${valid.length}/${this._sessionCount} sessions ready (${this._sessions.filter(s => !s.cookies).length} missing — login from Settings)`);
        // ─── Background login recovery ─────────────────────────────────────────────
        // If some sessions don't have cookies (Chrome was running during startup,
        // preventing DPAPI extraction), trigger background login to recover them.
        // This runs silently in the background — user can continue using the app
        // with the sessions that already have cookies.
        // NOTE: Background login recovery DISABLED at startup.
        // Previously this opened Chrome windows for ALL missing sessions on every app launch,
        // causing a flood of windows. Users should log in manually from Settings → Sessions tab.
        // The login button in Settings triggers openLoginWindow() per-session on demand.
        // ─── Background cookie health monitoring ───────────────────────────────────
        // Tier 1: Every 10 min — refresh top-5 recently-used sessions (hot path)
        // Tier 2: Every 30 min — refresh ALL sessions (catch stale/expired cookies)
        // Tier 3: Every 60 min — log health summary + detect degradation
        const TIER1_INTERVAL_MS = 10 * 60 * 1000; // 10 min
        const TIER2_INTERVAL_MS = 30 * 60 * 1000; // 30 min
        const TIER3_INTERVAL_MS = 60 * 60 * 1000; // 60 min
        const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        // Tier 1: Hot sessions refresh (every 10 min)
        setInterval(() => {
            const usedSessions = this._sessions
                .filter(s => s.lastUsed > 0)
                .sort((a, b) => b.lastUsed - a.lastUsed)
                .slice(0, 5);
            if (usedSessions.length === 0)
                return;
            this._refreshBatch(usedSessions, 'tier1').catch(() => { });
        }, TIER1_INTERVAL_MS);
        // Tier 2: Full refresh (every 30 min) — catches expired cookies early
        setInterval(() => {
            const allWithCookies = this._sessions.filter(s => s.wasLoggedIn);
            if (allWithCookies.length === 0)
                return;
            this._refreshBatch(allWithCookies, 'tier2').catch(() => { });
        }, TIER2_INTERVAL_MS);
        // Tier 3: Health summary log (every 60 min)
        setInterval(() => {
            const health = this._computeHealth();
            const alive = this._sessions.filter(s => s.cookies).length;
            const degraded = health.degradedCount;
            const stale = health.staleCount;
            (0, unified_log_js_1.devLog)(`[SessionManager] Health check: ${alive}/${this._sessionCount} alive, ${degraded} degraded, ${stale} stale (>${Math.round(STALE_THRESHOLD_MS / 86400000)}d), level=${health.level}`);
            if (health.level === 'critical') {
                console.warn('[SessionManager] 🚨 CRITICAL: <20% sessions alive — detection at risk. Re-login Chrome or clone sessions.');
            }
            else if (health.level === 'degraded') {
                console.warn('[SessionManager] ⚠️ DEGRADED: <50% sessions alive — consider refreshing Chrome login.');
            }
        }, TIER3_INTERVAL_MS);
        this._initialized = true;
    }
    /**
     * Refresh a batch of sessions — re-extract cookies and update state.
     * Used by tiered background refresh (tier1 = hot sessions, tier2 = all sessions).
     */
    async _refreshBatch(sessions, tier) {
        let recovered = 0, lost = 0;
        await Promise.all(sessions.map(async (session) => {
            try {
                const { cookies, rawSocs } = await extractYouTubeCookies(session.profileDir);
                session.rawSocs = rawSocs;
                if (cookies?.SAPISID && cookies?.PSID) {
                    const wasLoggedIn = session.isLoggedIn;
                    session.cookies = cookies;
                    session.isLoggedIn = true;
                    session.wasLoggedIn = true;
                    session.isConsented = !!(cookies?.socs && !cookies.socs.startsWith('CAA'));
                    if (!cookies.socs || cookies.socs.startsWith('CAA')) {
                        cookies.socs = 'CAI';
                        session.isConsented = true;
                    }
                    session.error = undefined;
                    session.usedToday = 0;
                    session.lastRefreshAt = Date.now();
                    session.refreshFailCount = 0;
                    if (!wasLoggedIn) {
                        recovered++;
                        (0, unified_log_js_1.devLog)(`[SessionManager] ${tier}: recovered session ${session.profileId}`);
                    }
                }
                else {
                    if (session.isLoggedIn)
                        lost++;
                    session.cookies = null;
                    session.isLoggedIn = false;
                    session.error = 'cookies expired or missing';
                    session.refreshFailCount++;
                }
            }
            catch {
                session.refreshFailCount++;
            }
        }));
        if (recovered > 0 || lost > 0) {
            (0, unified_log_js_1.devLog)(`[SessionManager] ${tier} refresh: ${recovered} recovered, ${lost} lost`);
        }
    }
    /**
     * Compute aggregate cookie health metrics for monitoring.
     */
    _computeHealth() {
        const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        const now = Date.now();
        const loggedInSessions = this._sessions.filter(s => s.cookies);
        const totalWithHistory = this._sessions.filter(s => s.wasLoggedIn);
        const degraded = this._sessions.filter(s => s.wasLoggedIn && !s.isLoggedIn);
        const stale = loggedInSessions.filter(s => s.lastRefreshAt > 0 && (now - s.lastRefreshAt) > STALE_THRESHOLD_MS);
        // Oldest cookie age
        let oldestAgeMs = 0;
        for (const s of loggedInSessions) {
            if (s.lastRefreshAt > 0) {
                const age = now - s.lastRefreshAt;
                if (age > oldestAgeMs)
                    oldestAgeMs = age;
            }
        }
        const healthPct = this._sessionCount > 0
            ? Math.round((loggedInSessions.length / this._sessionCount) * 100)
            : 0;
        const level = healthPct >= 50 ? 'healthy' :
            healthPct >= 20 ? 'degraded' : 'critical';
        return {
            healthPct,
            degradedCount: degraded.length,
            staleCount: stale.length,
            oldestCookieAgeHours: Math.round(oldestAgeMs / (60 * 60 * 1000)),
            level,
        };
    }
    async ensureInit() {
        if (this._initPromise)
            await this._initPromise;
    }
    isReady() {
        return this._initialized && this._sessions.some(s => s.cookies);
    }
    getStatus() {
        return {
            ready: this.isReady(),
            sessionCount: this._sessions.length,
            loggedInCount: this._sessions.filter(s => s.cookies).length,
            consentedCount: this._sessions.filter(s => s.isConsented).length,
            sessions: this._sessions.map(s => toSessionPublic(s)),
            health: this._computeHealth(),
        };
    }
    /**
     * Get the next session in round-robin order (sessions with cookies AND consented).
     * Safe for concurrent calls from parallel channel fetches.
     */
    getNextSession() {
        // Only use sessions with cookies AND consent — CAA/empty SOCS causes 401/403 from YouTube
        const valid = this._sessions.filter(s => s.cookies && s.isConsented);
        if (valid.length === 0)
            return null;
        const session = valid[this._index % valid.length];
        this._index = (this._index + 1) % valid.length;
        return session;
    }
    /**
     * Open Chrome for a specific profile, wait for YouTube login, extract cookies,
     * update session state, then close Chrome.
     * Replaces the old launchChromeForLogin() approach which only opened Chrome without
     * auto-extracting cookies.
     */
    async openLoginWindow(profileId) {
        const { cdpOpenChromeForLogin } = await Promise.resolve().then(() => __importStar(require('./cdp.js')));
        const result = await cdpOpenChromeForLogin(profileId);
        const session = this._sessions.find(s => s.profileId === profileId);
        if (session) {
            session.cookies = result.cookies;
            session.isLoggedIn = !!(result.cookies?.SAPISID && result.cookies?.PSID);
            if (session.isLoggedIn) {
                session.wasLoggedIn = true;
                session.lastRefreshAt = Date.now();
                session.refreshFailCount = 0;
            }
            session.isConsented = !!(result.cookies?.socs && !result.cookies.socs.startsWith('CAA'));
            // Force CAI for all sessions — prevents auth errors from CAA/empty SOCS
            if (result.cookies && (!result.cookies.socs || result.cookies.socs.startsWith('CAA'))) {
                result.cookies.socs = 'CAI';
                session.isConsented = true;
            }
            session.error = result.error ?? (result.cookies ? undefined : 'No YouTube cookies found');
            session.lastUsed = 0;
            session.usedToday = 0;
            if (result.cookies) {
                (0, unified_log_js_1.devLog)(`[SessionManager] openLoginWindow(${profileId}): success — cookies extracted`);
                // Persist to disk so next restart can load via extractYouTubeCookies
                try {
                    this._persistCookiesToFile(profileId, result.cookies);
                }
                catch (e) {
                    console.warn(`[SessionManager] Failed to persist cookies for ${profileId}: ${e}`);
                }
                // Rebuild Innertube pool client for this session so it's immediately usable
                try {
                    const { getInnertubePool } = await Promise.resolve().then(() => __importStar(require('./innertube_client.js')));
                    const pool = await getInnertubePool();
                    const ok = await pool.refreshClient(profileId);
                    if (ok) {
                        (0, unified_log_js_1.devLog)(`[SessionManager] Innertube client rebuilt for profile ${profileId}`);
                    }
                    else {
                        console.warn(`[SessionManager] Innertube client rebuild failed for profile ${profileId}`);
                    }
                }
                catch (e) {
                    console.warn(`[SessionManager] Failed to rebuild Innertube client for ${profileId}: ${e}`);
                }
            }
            else {
                (0, unified_log_js_1.devLog)(`[SessionManager] openLoginWindow(${profileId}): failed — ${result.error}`);
            }
        }
        if (result.cookies)
            return true;
        if (result.alreadyLoggedIn)
            return true;
        return false;
    }
    _persistCookiesToFile(profileId, cookies) {
        const idx = parseInt(profileId, 10);
        const isDefaultChrome = !isNaN(idx) && idx === 1;
        const profileDir = isDefaultChrome
            ? getDefaultChromeProfileDir()
            : getHyperClipProfileDir(profileId);
        // For Chrome Default: profileDir = User Data\Default → persist at parent level (User Data\_hc.json)
        // For HyperClip profiles (2-30): profileDir = HyperClip-Chrome-Profile-N\Default → persist at Default\_hc.json
        const cookieFile = isDefaultChrome
            ? path_1.default.join(profileDir, '..', '_hyperclip_cookies.json')
            : path_1.default.join(profileDir, '_hyperclip_cookies.json');
        fs_1.default.writeFileSync(cookieFile, JSON.stringify(cookies), 'utf8');
        (0, unified_log_js_1.devLog)(`[SessionManager] Cookies persisted to ${cookieFile}`);
    }
    /**
     * Clone cookies from Session 1 to all other sessions.
     * Returns the number of successfully cloned sessions.
     */
    async cloneSessionOne() {
        const session1 = this._sessions.find(s => s.profileId === '1');
        if (!session1)
            return { success: false, clonedCount: 0, error: 'Session 1 not found' };
        // Source Paths (Session 1 is Default Chrome: profileDir = User Data\Default)
        const srcSqlite = path_1.default.join(session1.profileDir, 'Network', 'Cookies');
        const srcLocalState = path_1.default.join(session1.profileDir, '..', 'Local State');
        const srcJson = path_1.default.join(session1.profileDir, '..', '_hyperclip_cookies.json');
        if (!fs_1.default.existsSync(srcSqlite) && !fs_1.default.existsSync(srcJson)) {
            return { success: false, clonedCount: 0, error: 'Session 1 is not logged in (no cookies found)' };
        }
        let clonedCount = 0;
        for (let i = 2; i <= this._sessionCount; i++) {
            try {
                const destSession = this._sessions.find(s => s.profileId === String(i));
                if (!destSession)
                    continue;
                // Destination Paths (Session 2-30: profileDir = HyperClip-Chrome-Profile-N\Default)
                const destNetworkDir = path_1.default.join(destSession.profileDir, 'Network');
                const destLocalState = path_1.default.join(destSession.profileDir, '..', 'Local State');
                const destJson = path_1.default.join(destSession.profileDir, '_hyperclip_cookies.json');
                if (!fs_1.default.existsSync(destNetworkDir)) {
                    fs_1.default.mkdirSync(destNetworkDir, { recursive: true });
                }
                // Copy SQLite & Local State (for standard decryption if they open Chrome)
                // Use read+write instead of copyFileSync — Chrome locks Cookies with EBUSY,
                // but readFileSync can still read locked files (shared read access on Windows).
                if (fs_1.default.existsSync(srcSqlite)) {
                    try {
                        const buf = fs_1.default.readFileSync(srcSqlite);
                        fs_1.default.writeFileSync(path_1.default.join(destNetworkDir, 'Cookies'), buf);
                    }
                    catch (e2) {
                        console.warn(`[SessionManager] cloneSessionOne: Cookies copy failed for profile ${i} (Chrome may be open): ${e2.message}`);
                    }
                }
                if (fs_1.default.existsSync(srcLocalState)) {
                    try {
                        const buf = fs_1.default.readFileSync(srcLocalState);
                        fs_1.default.writeFileSync(destLocalState, buf);
                    }
                    catch (e2) {
                        console.warn(`[SessionManager] cloneSessionOne: Local State copy failed for profile ${i}: ${e2.message}`);
                    }
                }
                // Copy Fast-path JSON (for instant HyperClip loading)
                if (fs_1.default.existsSync(srcJson)) {
                    try {
                        const buf = fs_1.default.readFileSync(srcJson);
                        fs_1.default.writeFileSync(destJson, buf);
                    }
                    catch (e2) {
                        console.warn(`[SessionManager] cloneSessionOne: JSON copy failed for profile ${i}: ${e2.message}`);
                    }
                }
                clonedCount++;
            }
            catch (e) {
                console.error(`[SessionManager] cloneSessionOne failed for profile ${i}:`, e);
            }
        }
        if (clonedCount > 0) {
            await this.refreshAll();
        }
        return { success: true, clonedCount };
    }
    /**
     * Refresh cookies for a specific session.
     */
    async refreshSession(profileId) {
        const session = this._sessions.find(s => s.profileId === profileId);
        if (!session)
            return false;
        try {
            const { cookies, rawSocs } = await extractYouTubeCookies(session.profileDir);
            session.cookies = cookies;
            session.rawSocs = rawSocs;
            session.isLoggedIn = !!(cookies?.SAPISID && cookies?.PSID);
            if (session.isLoggedIn) {
                session.wasLoggedIn = true;
                session.lastRefreshAt = Date.now();
                session.refreshFailCount = 0;
            }
            session.isConsented = !!cookies?.socs && !cookies.socs.startsWith('CAA');
            // Force CAI for all sessions — prevents auth errors from CAA/empty SOCS
            if (cookies && (!cookies.socs || cookies.socs.startsWith('CAA'))) {
                cookies.socs = 'CAI';
                session.isConsented = true;
            }
            session.error = cookies ? undefined : 'No YouTube cookies';
            session.usedToday = 0;
            (0, unified_log_js_1.devLog)(`[SessionManager] refreshSession(${profileId}): cookies=${!!cookies}, isLoggedIn=${session.isLoggedIn}, isConsented=${session.isConsented}, socs=${cookies?.socs}`);
            return !!cookies;
        }
        catch (e) {
            session.error = String(e);
            (0, unified_log_js_1.devLog)(`[SessionManager] refreshSession(${profileId}): ERROR — ${e}`);
            return false;
        }
    }
    /**
     * Refresh cookies for all sessions.
     */
    async refreshAll() {
        let refreshed = 0;
        for (const session of this._sessions) {
            const ok = await this.refreshSession(session.profileId);
            if (ok)
                refreshed++;
        }
        return refreshed;
    }
    getSessions() {
        return this._sessions;
    }
}
exports.ChromeSessionManager = ChromeSessionManager;
// ─── Singleton ────────────────────────────────────────────────────────────────
let _manager = null;
function getSessionManager() {
    if (!_manager) {
        // RAM-aware: laptop ≤32GB → 15 sessions, desktop >32GB → 30 sessions
        let sessionCount = 15;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic import at runtime to avoid circular dep at module init
            const { getSessionCount } = require('./system.js');
            sessionCount = getSessionCount();
        }
        catch {
            // safe default for laptop (conservative)
        }
        _manager = new ChromeSessionManager(sessionCount);
    }
    return _manager;
}
