#!/usr/bin/env node
/**
 * HyperClip Customer Package — Cookie Extraction Engine
 *
 * Runs on the OPERATOR's machine to:
 * 1. Extract YouTube cookies from Chrome profile (DPAPI + sql.js)
 * 2. Clone to 30 HyperClip sessions
 * 3. Return the cookie JSON for packaging
 *
 * Usage: node extract-cookies.js [--profile "C:\path\to\Chrome\User Data"]
 *
 * Output: JSON to stdout { cookies, profile, success, error }
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const initSqlJs = require('sql.js');

// ─── DPAPI via PowerShell ────────────────────────────────────────────────────

function runPowerShell(script) {
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell', [
            '-ExecutionPolicy', 'Bypass',
            '-NoProfile',
            '-NonInteractive',
            '-Command', script
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        let stdout = '', stderr = '';
        ps.stdout.on('data', d => { stdout += d.toString(); });
        ps.stderr.on('data', d => { stderr += d.toString(); });
        ps.on('close', code => {
            if (code === 0 && stdout.trim()) resolve(stdout.trim());
            else reject(new Error(stderr || `exit code ${code}`));
        });
        ps.on('error', reject);
    });
}

async function dpapiUnwrap(encryptedKeyBytes) {
    // Chrome v80+ Local State: v10 prefix + nonce(12) + encrypted_key + authTag(16)
    // encryptedKeyBytes here is the raw encrypted key portion (between nonce and authTag)
    const keyB64 = Buffer.from(encryptedKeyBytes).toString('base64');
    const ps = `
Add-Type -AssemblyName System.Security
try {
    \\$encrypted = [System.Convert]::FromBase64String('${keyB64}')
    \\$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(
        \\$encrypted, \\$null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [Convert]::ToBase64String(\\$decrypted)
} catch {
    Write-Error \\$_.Exception.Message
    exit 1
}
`;
    try {
        const result = await runPowerShell(ps);
        return Buffer.from(result.trim(), 'base64');
    }
    catch (e) {
        throw new Error(`DPAPI unwrap failed: ${e.message}`);
    }
}

// ─── AES-256-GCM Decryption ──────────────────────────────────────────────────

function decryptAesGcm(ciphertext, key, nonce, authTag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext;
}

// ─── Chrome Cookie Extraction ─────────────────────────────────────────────────

async function extractCookies(profileDir) {
    // Normalize: Chrome Default → User Data\Default
    const defaultPath = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
        : path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');

    if (!profileDir || profileDir === defaultPath || !profileDir.includes('Chrome')) {
        profileDir = path.join(defaultPath, 'Default');
    }

    // Also support HyperClip profile format: .../HyperClip-Chrome-Profile-N/Default
    const cookieDbPath = path.join(profileDir, 'Network', 'Cookies');
    let localStatePath = path.join(profileDir, '..', 'Local State');
    let altCookieDb = null;

    if (!fs.existsSync(cookieDbPath)) {
        // Try profileDir itself (HyperClip profile structure)
        altCookieDb = path.join(profileDir, 'Cookies');
        if (fs.existsSync(altCookieDb)) {
            const altLocal = path.join(profileDir, '..', 'Local State');
            if (fs.existsSync(altLocal)) {
                localStatePath = altLocal;
            }
        }
    }

    if (!fs.existsSync(localStatePath)) {
        throw new Error(`Local State not found at: ${localStatePath}`);
    }

    const actualCookieDb = fs.existsSync(cookieDbPath) ? cookieDbPath : altCookieDb;
    if (!actualCookieDb) {
        throw new Error(`Cookies DB not found at: ${cookieDbPath}`);
    }

    console.error(`[extract] DB: ${actualCookieDb}`);
    console.error(`[extract] LocalState: ${localStatePath}`);

    // ── Step 1: DPAPI decrypt AES key ──────────────────────────────────────
    const localStateRaw = fs.readFileSync(localStatePath, 'utf8');
    const localState = JSON.parse(localStateRaw);
    const encryptedKeyB64 = localState.os_crypt?.encrypted_key;
    if (!encryptedKeyB64) {
        throw new Error('No os_crypt.encrypted_key in Local State');
    }

    const encryptedKey = Buffer.from(encryptedKeyB64, 'base64');
    const prefix = encryptedKey.slice(0, 3).toString('ascii');

    let aesKey;
    if (prefix === 'v10') {
        const nonce = encryptedKey.slice(3, 15);
        const encryptedKeyBytes = encryptedKey.slice(15, -16);
        const authTag = encryptedKey.slice(-16);

        // DPAPI unwrap the encrypted AES key bytes → raw 32-byte AES key
        const rawAesKey = await dpapiUnwrap(encryptedKeyBytes);

        // v10: nonce(12) + key derived via AES-KDF? No — v10 uses the raw key directly
        // Actually for v10 Local State: the DPAPI-unwrapped bytes ARE the AES key
        aesKey = rawAesKey;
        console.error(`[extract] DPAPI OK (v10, key len=${aesKey.length})`);
    }
    else if (prefix === 'DPA') {
        const encryptedKeyBytes = encryptedKey.slice(5);
        aesKey = await dpapiUnwrap(encryptedKeyBytes);
        console.error(`[extract] DPAPI OK (DPA, key len=${aesKey.length})`);
    }
    else {
        throw new Error(`Unknown Local State encryption: prefix="${prefix}" (${encryptedKey.slice(0,5).toString('hex')})`);
    }

    // ── Step 2: Read cookie DB via sql.js ──────────────────────────────────
    // Find sql.js
    const searchPaths = [
        path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist'),
        path.join(__dirname, 'node_modules', 'sql.js', 'dist'),
        path.join(process.env.LOCALAPPDATA || '', 'HyperClip', 'node_modules', 'sql.js', 'dist'),
    ];

    let sqlJsDist = null;
    for (const sp of searchPaths) {
        if (fs.existsSync(sp) && fs.existsSync(path.join(sp, 'sql-wasm.wasm'))) {
            sqlJsDist = sp;
            break;
        }
    }

    if (!sqlJsDist) {
        throw new Error('sql.js not found. Please run from HyperClip project directory.');
    }

    // Read DB (may be locked by Chrome — retry logic)
    let dbBuffer = null;
    const MAX_RETRIES = 5;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            dbBuffer = fs.readFileSync(actualCookieDb);
            break;
        }
        catch (e) {
            if (attempt < MAX_RETRIES) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
                console.error(`[extract] DB locked (attempt ${attempt}/${MAX_RETRIES}), retry in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
            else {
                throw new Error(`Cookie DB locked after ${MAX_RETRIES} attempts. Close Chrome and try again.`);
            }
        }
    }

    const SQL = await initSqlJs({
        locateFile: f => path.join(sqlJsDist, f)
    });

    const db = new SQL.Database(dbBuffer);

    const result = db.exec(`
        SELECT host_key, name, value, encrypted_value
        FROM cookies
        WHERE (host_key LIKE '%youtube.com%' OR host_key LIKE '%.google.com%' OR host_key = 'google.com')
          AND name IN ('SAPISID','__Secure-1PSID','__Secure-1PSIDTS','__Secure-1PSIDCC','__Secure-3PSID','LOGGED_IN','__Secure-1PAPISID','SOCS')
    `);

    db.close();

    if (!result.length || !result[0].values.length) {
        throw new Error('No YouTube cookies found in Chrome. Make sure you are logged into YouTube.');
    }

    console.error(`[extract] Found ${result[0].values.length} cookie rows`);

    const cookies = {};

    for (const row of result[0].values) {
        const name = String(row[1]);
        let value = row[2] ? String(row[2]) : '';
        const encryptedValue = row[3];

        if (!value && encryptedValue) {
            // Decrypt via Node.js crypto
            const buf = Buffer.from(encryptedValue);
            if (buf.length < 20) continue;

            const prefix = buf[0];
            if (prefix === 0x76) { // v10/v20
                if (buf.length >= 4 && buf[3] === 0xCC) {
                    // v20: parse ULEB128 key_id_len
                    let pos = 4;
                    let keyIdLen = 0, shift = 0;
                    while (pos < buf.length) {
                        const b = buf[pos++];
                        keyIdLen |= (b & 0x7F) << shift;
                        shift += 7;
                        if ((b & 0x80) === 0) break;
                    }
                    const salt = buf.slice(pos + keyIdLen, pos + keyIdLen + 16);
                    const nonce = buf.slice(pos + keyIdLen + 16, pos + keyIdLen + 28);
                    const ctWithTag = buf.slice(pos + keyIdLen + 28);
                    const authTag = ctWithTag.slice(-16);
                    const ct = ctWithTag.slice(0, -16);
                    const cookieKey = crypto.createHash('sha256').update(Buffer.concat([aesKey, salt])).digest();
                    try {
                        value = decryptAesGcm(ct, cookieKey, nonce, authTag).toString('utf8');
                    }
                    catch (e) {
                        console.error(`[extract] v20 decrypt failed for ${name}: ${e.message}`);
                    }
                }
                else {
                    // v10: aesKey directly
                    const nonce = buf.slice(1, 13);
                    const ctWithTag = buf.slice(13);
                    const authTag = ctWithTag.slice(-16);
                    const ct = ctWithTag.slice(0, -16);
                    try {
                        value = decryptAesGcm(ct, aesKey, nonce, authTag).toString('utf8');
                    }
                    catch (e) {
                        console.error(`[extract] v10 decrypt failed for ${name}: ${e.message}`);
                    }
                }
            }
            // v1 (DPAPI only) — would need PowerShell, skip for now
        }

        if (value) {
            if (name === 'SAPISID') cookies.SAPISID = value;
            else if (name === '__Secure-1PSID') cookies.PSID = value;
            else if (name === '__Secure-1PSIDTS') cookies.PSIDTS = value;
            else if (name === '__Secure-1PSIDCC') cookies.PSIDCC = value;
            else if (name === 'SOCS') cookies.socs = value;
        }
    }

    // Validate
    if (!cookies.SAPISID || !cookies.PSID) {
        const missing = [];
        if (!cookies.SAPISID) missing.push('SAPISID');
        if (!cookies.PSID) missing.push('__Secure-1PSID');
        throw new Error(`Missing required cookies: ${missing.join(', ')}`);
    }

    // Auto-inject SOCS=CAI
    const rawSocs = cookies.socs || null;
    if (!cookies.socs || cookies.socs.startsWith('CAAL')) {
        cookies.socs = 'CAI';
        console.error('[extract] SOCS injected as CAI (was: ' + (rawSocs || 'null') + ')');
    }

    console.error(`[extract] Done: SAPISID=${cookies.SAPISID.slice(0,6)}... PSID=${cookies.PSID.slice(0,4)}... SOCS=${cookies.socs}`);

    return { cookies, rawSocs };
}

// ─── Session Cloning ──────────────────────────────────────────────────────────

function cloneCookies(cookies, dataDir, sessionCount = 30) {
    const profilesDir = path.join(dataDir, 'chrome-profiles');
    const results = { success: 0, failed: [] };

    for (let i = 1; i <= sessionCount; i++) {
        const profileDir = path.join(profilesDir, `profile-${i}`);
        if (!fs.existsSync(profileDir)) {
            fs.mkdirSync(profileDir, { recursive: true });
        }
        const cookieFile = path.join(profileDir, '_hyperclip_cookies.json');
        try {
            fs.writeFileSync(cookieFile, JSON.stringify(cookies), 'utf8');
            results.success++;
        }
        catch (e) {
            results.failed.push({ profile: i, error: e.message });
        }
    }

    // Also write to Chrome User Data for Session 1
    const defaultUserData = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
    try {
        fs.writeFileSync(
            path.join(defaultUserData, '_hyperclip_cookies.json'),
            JSON.stringify(cookies), 'utf8'
        );
    }
    catch (e) {
        // Non-critical
    }

    return results;
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    let profileDir = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--profile' || args[i] === '-p') {
            profileDir = args[i + 1] || '';
            i++;
        }
        else if (args[i] === '--help' || args[i] === '-h') {
            console.log('Usage: node extract-cookies.js [--profile "C:\\path\\to\\Chrome\\User Data"]');
            console.log('Output: JSON { cookies, success, profile, cloneResults, error }');
            process.exit(0);
        }
    }

    try {
        console.error('[extract] Starting cookie extraction...');
        const { cookies, rawSocs } = await extractCookies(profileDir);

        const output = {
            success: true,
            cookies,
            rawSocs,
            profile: profileDir || 'Chrome Default',
            message: `Extracted: SAPISID, PSID, SOCS=${cookies.socs}`
        };

        console.log(JSON.stringify(output, null, 2));
    }
    catch (e) {
        console.error(`[extract] ERROR: ${e.message}`);
        const output = {
            success: false,
            error: e.message,
            profile: profileDir || 'Chrome Default'
        };
        console.log(JSON.stringify(output, null, 2));
        process.exit(1);
    }
}

main().catch(e => {
    console.error('[extract] Fatal:', e.message);
    process.exit(1);
});
