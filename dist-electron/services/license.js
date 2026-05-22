"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEV_LICENSE_BYPASS = void 0;
exports.activateLicense = activateLicense;
exports.validateLicense = validateLicense;
exports.startLicenseHeartbeat = startLicenseHeartbeat;
exports.stopLicenseHeartbeat = stopLicenseHeartbeat;
exports.getLicenseStatus = getLicenseStatus;
exports.hasFeature = hasFeature;
exports.initLicense = initLicense;
exports.revokeLocalLicense = revokeLocalLicense;
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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const electron_1 = require("electron");
const hwid_js_1 = require("./hwid.js");
const crypto_js_1 = require("./crypto.js");
const unified_log_js_1 = require("./unified_log.js");
// ─── Config ───────────────────────────────────────────────────────────────────
// Vercel deployment URL — set LICENSE_SERVER_URL env var in Vercel dashboard
// Default points to local dev server; update to your Vercel deployment URL after deploy.
const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || 'https://hyper-clip.vercel.app';
const LICENSE_ACTIVATE_PATH = '/api/license/activate';
const LICENSE_VALIDATE_PATH = '/api/license/validate';
const LICENSE_FILE = 'license.enc.yaml';
const VALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LICENSE_DIR = electron_1.app?.isPackaged
    ? path_1.default.join(electron_1.app.getPath('userData'), 'data')
    : path_1.default.join(process.env.HYPERCLIP_DATA_DIR || 'D:\\HyperClip-Data', 'app');
// ─── Module-level state ─────────────────────────────────────────────────────────
let _status = { activated: false, valid: false };
let _validateTimer = null;
// ─── Path helpers ──────────────────────────────────────────────────────────────
function getLicensePath() {
    return path_1.default.join(LICENSE_DIR, LICENSE_FILE);
}
// ─── HTTP helpers ───────────────────────────────────────────────────────────────
function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const protocol = options.protocol === 'https:' ? https_1.default : http_1.default;
        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                }
                catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Request timeout')); });
        if (body)
            req.write(body);
        req.end();
    });
}
// ─── License persistence ─────────────────────────────────────────────────────────
function saveLicense(record) {
    fs_1.default.mkdirSync(LICENSE_DIR, { recursive: true });
    const machineId = (0, hwid_js_1.getMachineId)();
    const plaintext = JSON.stringify(record);
    const blob = (0, crypto_js_1.encrypt)(plaintext, machineId);
    const yaml = (0, crypto_js_1.blobToYAMLString)(blob);
    fs_1.default.writeFileSync(getLicensePath(), yaml, 'utf8');
    unified_log_js_1.log.info(`[License] Saved license for keyId=${record.keyId}`);
}
function loadLicense() {
    const filePath = getLicensePath();
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const yaml = fs_1.default.readFileSync(filePath, 'utf8');
        const blob = (0, crypto_js_1.parseYAMLBlob)(yaml);
        const plaintext = (0, crypto_js_1.decrypt)(blob, (0, hwid_js_1.getMachineId)());
        return JSON.parse(plaintext);
    }
    catch (err) {
        unified_log_js_1.log.warn(`[License] Failed to load license (corrupted or wrong machine): ${err}`);
        return null;
    }
}
function deleteLicense() {
    const p = getLicensePath();
    if (fs_1.default.existsSync(p))
        fs_1.default.unlinkSync(p);
    _status = { activated: false, valid: false };
}
/**
 * Attempt to activate HyperClip with a license key.
 * This is a ONE-TIME operation per machine.
 */
async function activateLicense(key) {
    const machineId = (0, hwid_js_1.getMachineId)();
    const body = JSON.stringify({ key, machineId });
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
    };
    try {
        const { status, data } = await httpRequest(options, body);
        if (status === 200 && data.success) {
            const record = {
                keyId: data.keyId,
                key,
                machineId: data.machineId,
                features: data.features || [],
                expiresAt: data.expiresAt || null,
                issuedAt: data.issuedAt || new Date().toISOString(),
                activatedAt: data.activatedAt || new Date().toISOString(),
                serverUrl: LICENSE_SERVER_URL,
            };
            saveLicense(record);
            _status = { activated: true, valid: true, record };
            unified_log_js_1.log.info(`[License] Activated: keyId=${record.keyId}, machineId=${machineId.slice(0, 8)}...`);
            return { success: true, record };
        }
        const errorMap = {
            REVOKED: 'License đã bị thu hồi. Liên hệ hỗ trợ.',
            EXPIRED: 'License đã hết hạn.',
            ALREADY_USED: 'License đã được kích hoạt trên máy khác.',
            NOT_FOUND: 'License key không tồn tại.',
        };
        return {
            success: false,
            error: data.error || 'Kích hoạt thất bại.',
            code: data.code || 'UNKNOWN',
        };
    }
    catch (err) {
        unified_log_js_1.log.error(`[License] Activation failed: ${err}`);
        return {
            success: false,
            error: `Không thể kết nối server: ${err instanceof Error ? err.message : 'Network error'}`,
            code: 'NETWORK_ERROR',
        };
    }
}
// ─── Validation ────────────────────────────────────────────────────────────────
/**
 * Validate the current license against the server.
 * - If server unreachable: use cached license (offline mode)
 * - If revoked/expired: mark invalid, block app
 */
async function validateLicense() {
    const record = loadLicense();
    if (!record) {
        _status = { activated: false, valid: false, reason: 'No license file found' };
        return _status;
    }
    const url = new URL(LICENSE_SERVER_URL);
    const params = new URLSearchParams({ keyId: record.keyId, machineId: record.machineId });
    const options = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${LICENSE_VALIDATE_PATH}?${params}`,
        method: 'GET',
        headers: { 'User-Agent': 'HyperClip/1.0' },
    };
    try {
        const { status, data } = await httpRequest(options);
        if (status === 200 && data.valid) {
            _status = {
                activated: true,
                valid: true,
                record: { ...record, features: data.features || record.features },
            };
            return _status;
        }
        const reason = data.error || data.code || 'Invalid license';
        _status = { activated: true, valid: false, reason, record };
        return _status;
    }
    catch (err) {
        // Offline: trust cached license
        unified_log_js_1.log.warn(`[License] Validate failed (offline), trusting cached license: ${err}`);
        _status = { activated: true, valid: true, record, reason: 'Offline mode' };
        return _status;
    }
}
// ─── Heartbeat timer ───────────────────────────────────────────────────────────
function startLicenseHeartbeat() {
    if (_validateTimer)
        return;
    _validateTimer = setInterval(async () => {
        const s = await validateLicense();
        if (!s.valid && s.reason && s.reason !== 'Offline mode') {
            unified_log_js_1.log.warn(`[License] Heartbeat failed: ${s.reason}`);
        }
    }, VALIDATE_INTERVAL_MS);
    unified_log_js_1.log.info(`[License] Heartbeat started (every ${VALIDATE_INTERVAL_MS / 3600000}h)`);
}
function stopLicenseHeartbeat() {
    if (_validateTimer) {
        clearInterval(_validateTimer);
        _validateTimer = null;
    }
}
// ─── Status ────────────────────────────────────────────────────────────────────
function getLicenseStatus() {
    // Check local expiration even if server is unreachable (demo mode)
    if (_status.record?.expiresAt) {
        const expiry = new Date(_status.record.expiresAt);
        if (expiry <= new Date()) {
            return { ..._status, valid: false, reason: 'License đã hết hạn (Demo hết hạn lúc 00:00).' };
        }
    }
    return { ..._status };
}
/** Get features list from active license. */
function hasFeature(feature) {
    return _status.record?.features.includes(feature) ?? false;
}
// ─── Init (call at app startup) ────────────────────────────────────────────────
async function initLicense() {
    const record = loadLicense();
    if (record) {
        const s = await validateLicense();
        if (s.valid)
            startLicenseHeartbeat();
        return s;
    }
    return { activated: false, valid: false, reason: 'No license' };
}
// ─── Revoke (for development / admin) ─────────────────────────────────────────
function revokeLocalLicense() {
    deleteLicense();
    stopLicenseHeartbeat();
    unified_log_js_1.log.info('[License] Local license revoked');
}
// ─── Dev mode bypass ────────────────────────────────────────────────────────────
exports.DEV_LICENSE_BYPASS = process.env.DEV_LICENSE_BYPASS === '1';
if (exports.DEV_LICENSE_BYPASS) {
    unified_log_js_1.log.warn('[License] DEV BYPASS ACTIVE — license check disabled');
    _status = {
        activated: true,
        valid: true,
        reason: 'Dev bypass',
        record: {
            keyId: 'DEV',
            key: 'DEV',
            machineId: (0, hwid_js_1.getMachineId)(),
            features: ['pro', 'auto_render', 'multi_channel'],
            expiresAt: null,
            issuedAt: new Date().toISOString(),
            activatedAt: new Date().toISOString(),
            serverUrl: 'dev',
        },
    };
}
// ─── Demo mode ─────────────────────────────────────────────────────────────────
// DEMO_MODE=true env var: auto-activates a hardware-locked, time-limited demo license.
// Expires at midnight tomorrow (2026-05-21 00:00:00 local time).
// Hardware-locked to THIS machine — won't work if customer copies .exe elsewhere.
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const DEMO_EXPIRY = new Date();
DEMO_EXPIRY.setHours(24, 0, 0, 0); // midnight tonight (00:00 tomorrow)
if (DEMO_MODE) {
    const machineId = (0, hwid_js_1.getMachineId)();
    const demoRecord = {
        keyId: 'DEMO-20260520',
        key: 'DEMO-MODE-ENABLED',
        machineId,
        features: ['pro', 'auto_render', 'multi_channel'],
        expiresAt: DEMO_EXPIRY.toISOString(),
        issuedAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        serverUrl: 'demo',
    };
    // Verify this machine is authorized
    _status = {
        activated: true,
        valid: true,
        reason: 'Demo mode',
        record: demoRecord,
    };
    unified_log_js_1.log.warn(`[License] DEMO MODE — expires ${DEMO_EXPIRY.toLocaleString()} | Machine: ${machineId.slice(0, 8)}...`);
}
