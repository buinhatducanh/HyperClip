"use strict";
/**
 * CDP (Chrome DevTools Protocol) Client — HyperClip
 *
 * Opens a Chrome window with remote debugging, waits for YouTube login,
 * extracts session cookies via CDP, then closes Chrome.
 *
 * Uses the built-in `ws` WebSocket library (no new dependencies).
 *
 * CDP WebSocket endpoint: ws://localhost:{port}/devtools/browser/{browser-id}
 * JSON endpoint for targets:  http://localhost:{port}/json
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
exports.loginInBackground = loginInBackground;
exports.cdpOpenChromeForLogin = cdpOpenChromeForLogin;
exports.ensurePersistentChrome = ensurePersistentChrome;
exports.killPersistentChrome = killPersistentChrome;
const child_process_1 = require("child_process");
const ws_1 = __importDefault(require("ws"));
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chrome_cookies_js_1 = require("./chrome_cookies.js");
const unified_log_js_1 = require("./unified_log.js");
// ─── CDP WebSocket Client ───────────────────────────────────────────────────────
class CDPClient {
    _ws = null;
    _msgId = 0;
    _pending = new Map();
    _eventHandlers = new Map();
    _alive = false;
    async connect(wsUrl) {
        return new Promise((resolve, reject) => {
            this._ws = new ws_1.default(wsUrl);
            this._alive = true;
            this._ws.on('open', () => resolve());
            this._ws.on('error', (e) => {
                this._alive = false;
                reject(e);
            });
            this._ws.on('message', (data) => this._handleMessage(Array.isArray(data) ? Buffer.concat(data).toString() : data.toString()));
            this._ws.on('close', () => {
                this._alive = false;
            });
        });
    }
    _handleMessage(raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        }
        catch {
            return;
        }
        // Dispatch event handlers
        if (msg.method) {
            const handlers = this._eventHandlers.get(msg.method);
            if (handlers) {
                for (const h of handlers)
                    h(msg.params);
            }
        }
        // Resolve pending request
        if (msg.id !== undefined) {
            const pending = this._pending.get(msg.id);
            if (pending) {
                this._pending.delete(msg.id);
                if (msg.error) {
                    pending.reject(new Error(msg.error.message));
                }
                else {
                    pending.resolve(msg.result);
                }
            }
        }
    }
    on(method, handler) {
        if (!this._eventHandlers.has(method)) {
            this._eventHandlers.set(method, new Set());
        }
        this._eventHandlers.get(method).add(handler);
    }
    off(method, handler) {
        this._eventHandlers.get(method)?.delete(handler);
    }
    async send(method, params) {
        if (!this._ws || !this._alive)
            throw new Error('CDP not connected');
        return new Promise((resolve, reject) => {
            const id = ++this._msgId;
            this._pending.set(id, { resolve: resolve, reject });
            this._ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async dispose() {
        this._alive = false;
        if (this._ws) {
            this._ws.removeAllListeners();
            if (this._ws.readyState === ws_1.default.OPEN) {
                this._ws.close();
            }
            this._ws = null;
        }
        this._pending.clear();
        this._eventHandlers.clear();
    }
}
// ─── Chrome Launch ─────────────────────────────────────────────────────────────
function getCDPPort(profileId) {
    // Each profile gets a unique debugging port to avoid conflicts
    const idx = parseInt(profileId, 10);
    return 9222 + (isNaN(idx) ? 0 : idx);
}
function getProfileDir(profileId) {
    const idx = parseInt(profileId, 10);
    const isDefaultChrome = !isNaN(idx) && idx === 1;
    return isDefaultChrome
        ? (0, chrome_cookies_js_1.getDefaultChromeProfileDir)()
        : (0, chrome_cookies_js_1.getHyperClipProfileDir)(profileId);
}
function ensureProfileDir(profileId) {
    const profileDir = getProfileDir(profileId);
    const idx = parseInt(profileId, 10);
    const isDefaultChrome = !isNaN(idx) && idx === 1;
    if (!isDefaultChrome) {
        const defaultDir = path_1.default.join(profileDir, 'Default');
        if (!fs_1.default.existsSync(defaultDir)) {
            fs_1.default.mkdirSync(defaultDir, { recursive: true });
        }
    }
    return profileDir;
}
async function httpGet(url) {
    return new Promise((resolve, reject) => {
        http_1.default.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve(body));
            res.on('error', reject);
        }).on('error', reject);
    });
}
async function getCDPTarget(port) {
    try {
        const json = await httpGet(`http://localhost:${port}/json`);
        const tabs = JSON.parse(json);
        // Find the YouTube tab
        const ytTab = tabs.find(t => t.url?.includes('youtube.com'));
        if (ytTab)
            return ytTab;
        // Otherwise return the first available tab
        return tabs[0] || null;
    }
    catch {
        return null;
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function parseCookies(cdpCookies) {
    if (!cdpCookies)
        return null;
    const cookies = {};
    for (const c of cdpCookies) {
        if (c.name === 'SAPISID')
            cookies.SAPISID = c.value;
        else if (c.name === '__Secure-1PSID')
            cookies.PSID = c.value;
        else if (c.name === '__Secure-1PSIDTS')
            cookies.PSIDTS = c.value;
        else if (c.name === '__Secure-1PSIDCC')
            cookies.PSIDCC = c.value;
        else if (c.name === 'SOCS')
            cookies.socs = c.value;
    }
    if (cookies.SAPISID && cookies.PSID)
        return cookies;
    return null;
}
// ─── Non-blocking background login ─────────────────────────────────────────────
/**
 * Open Chrome for login WITHOUT blocking. Fires off the CDP login flow in
 * background and resolves immediately. Cookies are persisted to disk when done,
 * ready for the next cookie-extraction cycle.
 *
 * Does NOT kill existing Chrome instances — avoids disrupting user's browsing.
 */
function loginInBackground(profileId) {
    setTimeout(async () => {
        (0, unified_log_js_1.devLog)(`[CDP] Background: starting login flow for profile ${profileId}`);
        const result = await cdpOpenChromeForLogin(profileId);
        if (result.cookies) {
            // Persist cookies so extractYouTubeCookies() picks them up on next read
            const { getSessionManager } = await Promise.resolve().then(() => __importStar(require('./chrome_cookies.js')));
            try {
                const sm = getSessionManager();
                const session = sm.getSessions().find(s => s.profileId === profileId);
                if (session) {
                    session.cookies = result.cookies;
                    session.isLoggedIn = !!(result.cookies.SAPISID && result.cookies.PSID);
                    session.error = undefined;
                    session.lastUsed = 0;
                    session.usedToday = 0;
                }
                const idx = parseInt(profileId, 10);
                const isDefaultChrome = !isNaN(idx) && idx === 1;
                const { getDefaultChromeProfileDir, getHyperClipProfileDir } = await Promise.resolve().then(() => __importStar(require('./chrome_cookies.js')));
                const profileDir = isDefaultChrome
                    ? getDefaultChromeProfileDir()
                    : getHyperClipProfileDir(profileId);
                // Match _persistCookiesToFile: Chrome Default → User Data\_hc.json, HyperClip → Default\_hc.json
                const cookieFile = isDefaultChrome
                    ? path_1.default.join(profileDir, '..', '_hyperclip_cookies.json')
                    : path_1.default.join(profileDir, 'Default', '_hyperclip_cookies.json');
                fs_1.default.writeFileSync(cookieFile, JSON.stringify(result.cookies), 'utf8');
                (0, unified_log_js_1.devLog)(`[CDP] Background login: cookies saved to ${cookieFile}`);
                if (session) {
                    session.isConsented = !!(result.cookies.socs && !result.cookies.socs.startsWith('CAA'));
                }
                (0, unified_log_js_1.devLog)(`[CDP] Background: cookies persisted for profile ${profileId}`);
                // Rebuild Innertube client so the session becomes usable immediately
                try {
                    const { getInnertubePool } = await Promise.resolve().then(() => __importStar(require('./innertube_client.js')));
                    const pool = await getInnertubePool();
                    const ok = await pool.refreshClient(profileId);
                    (0, unified_log_js_1.devLog)(`[CDP] Background: Innertube client ${ok ? 'rebuilt OK' : 'rebuild failed'} for profile ${profileId}`);
                }
                catch (e) {
                    console.warn(`[CDP] Background: Innertube rebuild skipped: ${e}`);
                }
            }
            catch (e) {
                console.warn(`[CDP] Background: failed to persist cookies for profile ${profileId}: ${e}`);
            }
        }
        else {
            (0, unified_log_js_1.devLog)(`[CDP] Background: login failed for profile ${profileId} — ${result.error}`);
        }
    }, parseInt(profileId, 10) * 800 + Math.random() * 5000); // stagger: profile-3 ~8s, profile-10 ~13s, profile-30 ~29s
}
/**
 * Opens Chrome with CDP debugging enabled, waits for user YouTube login,
 * extracts session cookies, closes Chrome, and returns cookies.
 *
 * @param profileId  Chrome profile ID (1-30)
 * @param timeoutMs  Max time to wait for login (default 5 minutes)
 * @returns Extracted cookies or null if extraction failed / user not logged in
 */
async function cdpOpenChromeForLogin(profileId, timeoutMs = 5 * 60 * 1000) {
    const chromeExe = (0, chrome_cookies_js_1.getChromeExe)();
    if (!fs_1.default.existsSync(chromeExe)) {
        return { cookies: null, alreadyLoggedIn: false, error: 'Chrome not found' };
    }
    const port = getCDPPort(profileId);
    const profileDir = ensureProfileDir(profileId);
    (0, unified_log_js_1.devLog)(`[CDP] Launching Chrome for profile ${profileId} on port ${port}...`);
    // Kill only the Chrome process using THIS specific debug port (not all Chrome)
    // Using netstat to find the PID on the debug port, then kill just that process
    try {
        const killPs = (0, child_process_1.spawn)('powershell', [
            '-ExecutionPolicy', 'Bypass', '-Command',
            `netstat -ano | findstr ":${port}" | findstr LISTENING`,
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        let netstatOut = '';
        killPs.stdout.on('data', (d) => { netstatOut += d.toString(); });
        await new Promise(resolve => killPs.on('close', resolve));
        const match = netstatOut.match(/\s+(\d+)\s*$|LISTENING\s+(\d+)/);
        if (match) {
            const pid = match[1] || match[2];
            if (pid && pid !== '0') {
                (0, child_process_1.spawn)('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
                (0, unified_log_js_1.devLog)(`[CDP] Killed existing Chrome on port ${port} (PID ${pid})`);
                await sleep(300);
            }
        }
    }
    catch { /* ignore */ }
    // Spawn Chrome with CDP debugging
    const args = [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${port}`,
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-first-run-ui',
        'https://www.youtube.com',
    ];
    const chromeProcess = (0, child_process_1.spawn)(chromeExe, args, {
        detached: true,
        stdio: 'ignore',
    });
    chromeProcess.unref();
    chromeProcess.on('error', (e) => {
        console.warn(`[CDP] Chrome spawn error: ${e}`);
    });
    // Wait for CDP to be ready
    let cdpTab = null;
    const startupTimeout = 15_000;
    const startupStart = Date.now();
    while (Date.now() - startupStart < startupTimeout) {
        cdpTab = await getCDPTarget(port);
        if (cdpTab)
            break;
        await sleep(500);
    }
    if (!cdpTab) {
        try {
            chromeProcess.kill();
        }
        catch { }
        return { cookies: null, alreadyLoggedIn: false, error: 'Could not connect to Chrome DevTools' };
    }
    (0, unified_log_js_1.devLog)(`[CDP] Connected to Chrome tab: ${cdpTab.title} (${cdpTab.url})`);
    // Connect to the tab via WebSocket
    const client = new CDPClient();
    try {
        await client.connect(cdpTab.webSocketDebuggerUrl);
        (0, unified_log_js_1.devLog)('[CDP] WebSocket connected');
    }
    catch (e) {
        try {
            chromeProcess.kill();
        }
        catch { }
        return { cookies: null, alreadyLoggedIn: false, error: `WebSocket connect failed: ${e}` };
    }
    // Enable necessary CDP domains
    try {
        await Promise.all([
            client.send('Network.enable'),
            client.send('Page.enable'),
        ]);
    }
    catch (e) {
        console.warn(`[CDP] Domain enable failed: ${e}`);
    }
    // Check initial cookies
    let cookies = await parseCookies((await client.send('Network.getAllCookies')).cookies);
    if (cookies && cookies.SAPISID && cookies.PSID) {
        (0, unified_log_js_1.devLog)(`[CDP] Already logged in — SAPISID=${cookies.SAPISID.slice(0, 6)}..., PSID=${cookies.PSID.slice(0, 4)}...`);
        await client.dispose();
        try {
            chromeProcess.kill();
        }
        catch { }
        return { cookies, alreadyLoggedIn: true };
    }
    // Wait for login — poll cookies every 3s
    const pollInterval = 3_000;
    const deadline = Date.now() + timeoutMs;
    let lastCookieCount = 0;
    let waited = false;
    (0, unified_log_js_1.devLog)('[CDP] Waiting for login... (poll every 3s, max 5 min)');
    while (Date.now() < deadline) {
        await sleep(pollInterval);
        waited = true;
        try {
            const { cookies: cdpCookies } = await client.send('Network.getAllCookies');
            cookies = parseCookies(cdpCookies);
            if (cookies && cookies.SAPISID && cookies.PSID) {
                (0, unified_log_js_1.devLog)(`[CDP] Login detected — SAPISID=${cookies.SAPISID.slice(0, 6)}..., PSID=${cookies.PSID.slice(0, 4)}...`);
                await client.dispose();
                try {
                    chromeProcess.kill();
                }
                catch { }
                return { cookies, alreadyLoggedIn: false };
            }
            // Detect if user navigated away or closed tab
            if (!cdpCookies || cdpCookies.length === 0) {
                // No cookies ever seen — tab might have been closed
                const currentTab = await getCDPTarget(port);
                if (!currentTab) {
                    (0, unified_log_js_1.devLog)('[CDP] Chrome tab closed — aborting wait');
                    break;
                }
            }
            lastCookieCount = cdpCookies.length;
        }
        catch (e) {
            // Tab may have been closed — check if Chrome is still running
            const currentTab = await getCDPTarget(port);
            if (!currentTab) {
                (0, unified_log_js_1.devLog)('[CDP] Chrome closed — aborting wait');
                break;
            }
            console.warn(`[CDP] Cookie poll error: ${e}`);
        }
    }
    (0, unified_log_js_1.devLog)('[CDP] Timeout or Chrome closed — closing Chrome');
    await client.dispose();
    try {
        chromeProcess.kill();
    }
    catch { }
    if (waited) {
        return { cookies: null, alreadyLoggedIn: false, error: 'Login timeout — no valid YouTube cookies found' };
    }
    return { cookies: null, alreadyLoggedIn: false, error: 'Chrome closed before cookies could be extracted' };
}
// ─── Persistent Chrome for PO Token Extraction ─────────────────────────────────
/**
 * Persistent Chrome process kept alive for PO Token extraction.
 * Runs in background on port 9223 (session 1 profile).
 * NOT killed after use — reused for all subsequent PO Token extractions.
 */
let _persistentChrome = null;
function isChromeRunningOnPort(port) {
    return new Promise((resolve) => {
        const req = http_1.default.get(`http://localhost:${port}/json`, (res) => {
            resolve(res.statusCode === 200);
            res.resume();
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}
async function getPersistentChromePort() {
    // Check if our persistent Chrome is already running
    if (_persistentChrome && await isChromeRunningOnPort(_persistentChrome.port)) {
        return _persistentChrome.port;
    }
    return 9223; // session 1 default port
}
/**
 * Ensure a persistent Chrome is running for PO Token extraction.
 * Launches Chrome with session 1 profile (user's default) and debug port.
 * Does NOT kill Chrome after — keeps it running for future PO Token extractions.
 */
async function ensurePersistentChrome() {
    const port = await getPersistentChromePort();
    // Check if Chrome is already running on our debug port
    if (await isChromeRunningOnPort(port)) {
        (0, unified_log_js_1.devLog)(`[CDP] Persistent Chrome already running on port ${port}`);
        return { port, profileId: '1' };
    }
    // Launch persistent Chrome for session 1
    const chromeExe = (0, chrome_cookies_js_1.getChromeExe)();
    if (!fs_1.default.existsSync(chromeExe)) {
        (0, unified_log_js_1.devLog)('[CDP] Persistent Chrome: Chrome not found');
        return null;
    }
    const profileDir = (0, chrome_cookies_js_1.getDefaultChromeProfileDir)();
    (0, unified_log_js_1.devLog)(`[CDP] Launching persistent Chrome on port ${port} with profile: ${profileDir}`);
    const args = [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${port}`,
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-first-run-ui',
        'https://www.youtube.com',
    ];
    const chromeProcess = (0, child_process_1.spawn)(chromeExe, args, {
        detached: true,
        stdio: 'ignore',
    });
    chromeProcess.unref();
    chromeProcess.on('error', (e) => {
        console.warn(`[CDP] Persistent Chrome spawn error: ${e}`);
    });
    // Wait for Chrome to be ready
    const startupTimeout = 20_000;
    const startupStart = Date.now();
    while (Date.now() - startupStart < startupTimeout) {
        if (await isChromeRunningOnPort(port)) {
            (0, unified_log_js_1.devLog)(`[CDP] Persistent Chrome ready on port ${port}`);
            _persistentChrome = { process: chromeProcess, port, profileId: '1' };
            return { port, profileId: '1' };
        }
        await sleep(500);
    }
    (0, unified_log_js_1.devLog)(`[CDP] Persistent Chrome failed to start on port ${port}`);
    return null;
}
/**
 * Kill the persistent Chrome (call on shutdown).
 */
function killPersistentChrome() {
    if (_persistentChrome) {
        try {
            _persistentChrome.process.kill();
        }
        catch { }
        _persistentChrome = null;
        (0, unified_log_js_1.devLog)('[CDP] Persistent Chrome killed');
    }
}
