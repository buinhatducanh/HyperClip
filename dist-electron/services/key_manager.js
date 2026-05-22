"use strict";
/**
 * Key Manager — HyperClip (refactored 2026-05-14)
 *
 * Manages YouTube Data API keys using ProjectManager as data source.
 * Each GCP project has an associated API key in project.config.json.
 *
 * Smart Rotation: for a given project, returns the project's API key.
 * For unassigned/detection keys: picks the project with most remaining quota.
 *
 * Quota tracking is done via ProjectManager (shared with OAuth quota).
 * Each project = 10k units/day for ALL YouTube API calls (OAuth + key).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyManager = void 0;
exports.getKeyManager = getKeyManager;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const unified_log_js_1 = require("./unified_log.js");
const paths_js_1 = require("./paths.js");
const project_manager_js_1 = require("./project_manager.js");
// ─── Legacy Compat ─────────────────────────────────────────────────────────────
const KEYS_DIR = (0, paths_js_1.getAppStoreDir)();
const KEYS_FILE = path_1.default.join(KEYS_DIR, 'api_keys.json');
const STATS_FILE = path_1.default.join(KEYS_DIR, 'key_stats.json');
const MAX_UNITS_PER_KEY = 9500;
const MAX_ERRORS = 3;
function _loadLegacyKeys() {
    if (!fs_1.default.existsSync(KEYS_FILE))
        return [];
    try {
        const data = JSON.parse(fs_1.default.readFileSync(KEYS_FILE, 'utf-8'));
        return (data.keys || []).filter((k) => k.key && k.key !== 'YOUR_API_KEY_01');
    }
    catch {
        return [];
    }
}
// ─── Key Manager ─────────────────────────────────────────────────────────────
class KeyManager {
    _legacyKeys = [];
    _initialized = false;
    constructor() {
        // Legacy compat: migrate old api_keys.json to project configs
        if (_loadLegacyKeys().length > 0) {
            this._migrateLegacyKeys();
        }
        this._initialized = true;
    }
    _migrateLegacyKeys() {
        const legacy = _loadLegacyKeys();
        if (legacy.length === 0)
            return;
        const pm = (0, project_manager_js_1.getProjectManager)();
        for (const k of legacy) {
            const project = pm.getProject(k.projectId);
            if (project) {
                pm.updateProject(k.projectId, { apiKey: k.key });
                (0, unified_log_js_1.devLog)(`[KeyManager] Migrated key for ${k.projectId}: ${k.key.slice(0, 12)}...`);
            }
            else {
                // Create project for legacy key
                pm.addProject({
                    projectId: k.projectId,
                    projectName: k.name || k.projectId,
                    gmailAccount: '',
                    clientId: '',
                    clientSecret: '',
                    apiKey: k.key,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                });
                (0, unified_log_js_1.devLog)(`[KeyManager] Created project ${k.projectId} from legacy key`);
            }
        }
        (0, unified_log_js_1.devLog)(`[KeyManager] Migrated ${legacy.length} legacy API keys`);
    }
    // ── Smart Rotation ─────────────────────────────────────────────────────────
    /**
     * Get the best available API key for a project.
     * If projectId provided: return that project's key.
     * Otherwise: return key from least-used active project.
     */
    getKey(projectId) {
        const pm = (0, project_manager_js_1.getProjectManager)();
        if (projectId) {
            const project = pm.getProject(projectId);
            if (project?.apiKey) {
                return {
                    key: project.apiKey,
                    projectId: project.projectId,
                    name: project.projectName,
                };
            }
            return null;
        }
        // Get least-used project with a key
        const candidates = pm.getActiveProjects().filter(p => p.apiKey);
        if (candidates.length === 0)
            return null;
        candidates.sort((a, b) => a.stats.usedToday - b.stats.usedToday);
        const chosen = candidates[0];
        return {
            key: chosen.apiKey,
            projectId: chosen.projectId,
            name: chosen.projectName,
        };
    }
    /**
     * Get API key for a specific project.
     */
    getKeyForProject(projectId) {
        return this.getKey(projectId);
    }
    // ── Tracking ───────────────────────────────────────────────────────────────
    track(projectId, units = 1) {
        (0, project_manager_js_1.getProjectManager)().track(projectId, units);
    }
    recordError(projectId) {
        (0, project_manager_js_1.getProjectManager)().recordError(projectId);
    }
    trackError(projectId) {
        (0, project_manager_js_1.getProjectManager)().recordQuotaError(projectId);
    }
    // ── CRUD ──────────────────────────────────────────────────────────────────
    addKey(key, projectId, name) {
        const pm = (0, project_manager_js_1.getProjectManager)();
        pm.updateProject(projectId, { apiKey: key });
        (0, unified_log_js_1.devLog)(`[KeyManager] Added key: ${name} (${key.slice(0, 12)}...) for ${projectId}`);
    }
    removeKey(projectId) {
        const pm = (0, project_manager_js_1.getProjectManager)();
        pm.updateProject(projectId, { apiKey: '' });
        (0, unified_log_js_1.devLog)(`[KeyManager] Removed key for ${projectId}`);
    }
    resetKey(projectId) {
        const pm = (0, project_manager_js_1.getProjectManager)();
        pm.resetProject(projectId);
        return { success: true, nextReset: pm.getNextResetTime() };
    }
    resetAll() {
        const pm = (0, project_manager_js_1.getProjectManager)();
        pm.resetAll();
        return { success: true, nextReset: pm.getNextResetTime() };
    }
    markUnauthorized(projectId) {
        (0, project_manager_js_1.getProjectManager)().markUnauthorized(projectId);
    }
    markAuthorized(projectId) {
        (0, project_manager_js_1.getProjectManager)().resetProject(projectId);
    }
    _getNextResetTime() {
        return (0, project_manager_js_1.getProjectManager)().getNextResetTime();
    }
    // ── Query ─────────────────────────────────────────────────────────────────
    getAllKeys() {
        const pm = (0, project_manager_js_1.getProjectManager)();
        return pm.getAllProjects().map(p => {
            const usedToday = p.stats.usedToday;
            const errors = p.stats.errors;
            const quotaPercent = Math.round((usedToday / MAX_UNITS_PER_KEY) * 100);
            let status = 'healthy';
            if (!p.apiKey)
                status = 'no_key';
            else if (p.status === 'unauthorized' || p.stats.unauthorized)
                status = 'unauthorized';
            else if (usedToday >= MAX_UNITS_PER_KEY || p.status === 'exhausted')
                status = 'exhausted';
            else if (quotaPercent >= 80)
                status = 'warning';
            else if (errors > 0)
                status = 'error';
            return {
                key: p.apiKey || '',
                projectId: p.projectId,
                projectName: p.projectName,
                gmailAccount: p.gmailAccount,
                name: p.projectName,
                usedToday,
                quotaTotal: MAX_UNITS_PER_KEY,
                quotaPercent: Math.min(100, quotaPercent),
                errors,
                lastUsed: p.stats.lastUsed || null,
                status,
                lastReset: null,
                nextReset: pm.getNextResetTime(),
            };
        });
    }
    getKeyCount() {
        return (0, project_manager_js_1.getProjectManager)().getAllProjects().filter(p => p.apiKey).length;
    }
    getUnauthorizedCount() {
        return (0, project_manager_js_1.getProjectManager)().getAllProjects().filter(p => p.status === 'unauthorized').length;
    }
    getUsedToday(projectId) {
        return (0, project_manager_js_1.getProjectManager)().getUsedToday(projectId);
    }
    /** Test an API key by making a lightweight API call */
    async testKey(key) {
        const url = new URL('https://www.googleapis.com/youtube/v3/channels');
        url.searchParams.set('part', 'id');
        url.searchParams.set('regionCode', 'US');
        url.searchParams.set('key', key);
        return new Promise((resolve) => {
            const req = https_1.default.get(url.toString(), { timeout: 10000 }, (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => {
                    if (res.statusCode === 401) {
                        resolve({ valid: false, error: 'Unauthorized — key is invalid or has been revoked', errorType: 'unauthorized' });
                    }
                    else if (res.statusCode === 403) {
                        try {
                            const json = JSON.parse(data);
                            if (json?.error?.errors?.[0]?.reason === 'quotaExceeded') {
                                resolve({ valid: false, error: 'Quota exceeded', errorType: 'quota_exhausted' });
                            }
                            else {
                                resolve({ valid: false, error: 'Forbidden — check key permissions', errorType: 'quota_exhausted' });
                            }
                        }
                        catch {
                            resolve({ valid: false, error: 'Forbidden (403)', errorType: 'quota_exhausted' });
                        }
                    }
                    else if (res.statusCode === 400) {
                        resolve({ valid: false, error: 'Invalid API key format', errorType: 'invalid_key' });
                    }
                    else if (res.statusCode === 200) {
                        resolve({ valid: true });
                    }
                    else {
                        resolve({ valid: false, error: `Unexpected status: ${res.statusCode}`, errorType: 'invalid_key' });
                    }
                });
            });
            req.on('error', (e) => {
                resolve({ valid: false, error: e.message, errorType: 'network_error' });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve({ valid: false, error: 'Request timed out', errorType: 'network_error' });
            });
        });
    }
}
exports.KeyManager = KeyManager;
// ─── Singleton ────────────────────────────────────────────────────────────────
let _instance = null;
function getKeyManager() {
    if (!_instance)
        _instance = new KeyManager();
    return _instance;
}
