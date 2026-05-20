/**
 * Token Manager — HyperClip (refactored 2026-05-14)
 *
 * OAuth operations layer on top of ProjectManager.
 * ProjectManager is the source of truth for credentials, tokens, and stats.
 * TokenManager handles: refresh, getBestAvailable, testToken, track.
 *
 * Legacy compat: reads from oauth_tokens.json/oauth_config.json if no project data found.
 */
import path from 'path';
import fs from 'fs';
import https from 'https';
import { devLog } from './dev_log.js';
import { getAppStoreDir, getProjectsDir } from './paths.js';
import { getProjectManager } from './project_manager.js';
// ─── Legacy Compat ─────────────────────────────────────────────────────────────
// Read from legacy files (oauth_tokens.json) if no project data exists.
// Used for migration + backward compat with existing installations.
const MAX_UNITS_PER_TOKEN = 9500;
const TOKENS_DIR = getAppStoreDir();
const TOKENS_FILE = path.join(TOKENS_DIR, 'oauth_tokens.json');
const STATS_FILE = path.join(TOKENS_DIR, 'token_stats.json');
const CONFIG_FILE = path.join(TOKENS_DIR, 'oauth_config.json');
function _loadLegacyTokens() {
    if (!fs.existsSync(TOKENS_FILE))
        return [];
    try {
        const raw = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
        if (Array.isArray(raw))
            return raw;
        if (raw && typeof raw === 'object' && raw.access_token) {
            return [raw];
        }
    }
    catch { }
    return [];
}
function _loadLegacyConfig() {
    if (!fs.existsSync(CONFIG_FILE))
        return {};
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        if (cfg.client_id) {
            // Legacy single-project format → no projectId mapping
            return {};
        }
        const result = {};
        for (const [k, v] of Object.entries(cfg)) {
            if (k === 'client_id' || k === 'client_secret')
                continue;
            if (v && typeof v === 'object') {
                const cred = v;
                if (cred.clientId && cred.clientSecret) {
                    result[k] = cred;
                }
            }
        }
        return result;
    }
    catch { }
    return {};
}
function _hasProjectData() {
    const projectsDir = getProjectsDir();
    if (!fs.existsSync(projectsDir))
        return false;
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && e.name.startsWith('proj-'));
}
function _migrateLegacyToken(entry, configCreds) {
    const pm = getProjectManager();
    const projectId = entry.projectId || `legacy-${Object.keys(_loadLegacyTokens()).length}`;
    const creds = configCreds[entry.projectId];
    pm.addProject({
        projectId,
        projectName: entry.projectId || projectId,
        gmailAccount: '',
        clientId: creds?.clientId || entry.clientId || '',
        clientSecret: creds?.clientSecret || entry.clientSecret || '',
        apiKey: '',
        status: entry.access_token ? 'active' : 'pending_auth',
        createdAt: new Date().toISOString(),
    });
    if (entry.access_token) {
        pm.saveToken(projectId, {
            access_token: entry.access_token,
            refresh_token: entry.refresh_token || '',
            expires_at: entry.expires_at || Date.now() + 3600 * 1000,
            token_type: entry.token_type || 'Bearer',
        });
    }
    if (entry.clientId)
        pm.updateProject(projectId, { clientId: entry.clientId });
    if (entry.clientSecret)
        pm.updateProject(projectId, { clientSecret: entry.clientSecret });
}
// ─── Token Manager ─────────────────────────────────────────────────────────────
class TokenManager {
    _refreshTimer = null;
    _resetCheckTimer = null;
    _initialized = false;
    constructor() {
        this._init();
    }
    _init() {
        // Legacy migration: if no project data exists but legacy tokens exist, migrate them
        if (!_hasProjectData()) {
            const legacyTokens = _loadLegacyTokens();
            const configCreds = _loadLegacyConfig();
            if (legacyTokens.length > 0) {
                devLog(`[TokenManager] Migrating ${legacyTokens.length} legacy tokens to project structure...`);
                for (const entry of legacyTokens) {
                    _migrateLegacyToken(entry, configCreds);
                }
                devLog('[TokenManager] Migration complete');
            }
        }
        this._initialized = true;
        // Proactive refresh: every 30 min
        this._refreshTimer = setInterval(() => { this._proactiveRefresh(); }, 30 * 60 * 1000);
        setTimeout(() => { this._proactiveRefresh(); }, 5000);
        // Periodic reset check: every 30 min
        this._resetCheckTimer = setInterval(() => { this._checkReset(); }, 30 * 60 * 1000);
    }
    _checkReset() {
        const pm = getProjectManager();
        pm.checkReset();
    }
    // ── Token Refresh ─────────────────────────────────────────────────────────
    async refreshToken(projectId) {
        const pm = getProjectManager();
        const project = pm.getProject(projectId);
        if (!project)
            return null;
        const { clientId, clientSecret } = project;
        if (!clientId || !clientSecret) {
            devLog(`[TokenManager] refreshToken(${projectId}): no credentials — skipping`);
            return null;
        }
        const token = pm.getToken(projectId);
        if (!token?.refresh_token) {
            devLog(`[TokenManager] refreshToken(${projectId}): no refresh_token — needs re-auth`);
            return null;
        }
        return new Promise((resolve) => {
            const body = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: token.refresh_token,
                grant_type: 'refresh_token',
            }).toString();
            const options = {
                hostname: 'oauth2.googleapis.com',
                path: '/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(body),
                },
            };
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.error)
                            throw new Error(json.error_description || json.error);
                        const refreshed = {
                            access_token: json.access_token,
                            refresh_token: json.refresh_token || token.refresh_token,
                            expires_at: Date.now() + (json.expires_in || 3600) * 1000,
                            token_type: json.token_type || 'Bearer',
                        };
                        // Save to project
                        pm.saveToken(projectId, refreshed);
                        devLog(`[TokenManager] Token refreshed for ${projectId} (expires ${new Date(refreshed.expires_at).toISOString()})`);
                        resolve(refreshed);
                    }
                    catch (e) {
                        console.error(`[TokenManager] Token refresh failed for ${projectId}:`, e);
                        pm.markUnauthorized(projectId);
                        resolve(null);
                    }
                });
            });
            req.on('error', (e) => {
                console.error(`[TokenManager] Token refresh error for ${projectId}:`, e);
                resolve(null);
            });
            req.write(body);
            req.end();
        });
    }
    /**
     * Proactively refresh tokens expiring within 30 minutes.
     * Runs at startup (5s delay) and every 30 minutes.
     */
    async _proactiveRefresh() {
        const pm = getProjectManager();
        const projects = pm.getAllProjects();
        const now = Date.now();
        const EXPIRY_THRESHOLD_MS = 30 * 60 * 1000;
        const expiring = projects.filter(p => {
            const token = pm.getToken(p.projectId);
            if (!token)
                return false;
            return token.expires_at - now < EXPIRY_THRESHOLD_MS;
        });
        if (expiring.length === 0)
            return;
        devLog(`[TokenManager] Proactive refresh: ${expiring.length}/${projects.length} tokens expiring soon`);
        const results = await Promise.allSettled(expiring.map(p => this.refreshToken(p.projectId)));
        const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === null));
        if (failed.length > 0) {
            console.warn(`[TokenManager] Proactive refresh: ${failed.length} token(s) failed`);
        }
    }
    // ── Smart Rotation ─────────────────────────────────────────────────────────
    /**
     * Get the best available token for a channel.
     * 1. Use assigned project for this channel (coverage priority)
     * 2. Fallback to least-used active project
     * Auto-refreshes if token is expired.
     */
    async getBestAvailable(channelId) {
        const pm = getProjectManager();
        const now = Date.now();
        // Step 1: Get project for this channel (or least-used fallback)
        let project = null;
        if (channelId) {
            project = pm.getProjectForChannel(channelId);
        }
        if (!project) {
            project = pm.getLeastUsedProject();
        }
        if (!project) {
            devLog('[TokenManager] getBestAvailable: no projects available');
            return null;
        }
        // Step 2: Get token
        let token = pm.getToken(project.projectId);
        if (!token) {
            devLog(`[TokenManager] getBestAvailable: ${project.projectId} has no token`);
            return null;
        }
        // Step 3: Refresh if needed (5 min buffer)
        if (token.expires_at - 5 * 60 * 1000 < now) {
            devLog(`[TokenManager] Token for ${project.projectId} expired — refreshing...`);
            const refreshed = await this.refreshToken(project.projectId);
            if (!refreshed) {
                // Fallback to backup project or least-used
                if (channelId) {
                    const backup = pm.getBackupProjectForChannel(channelId);
                    if (backup) {
                        let backupToken = pm.getToken(backup.projectId);
                        if (backupToken && backupToken.expires_at - 5 * 60 * 1000 >= now) {
                            return { token: backupToken.access_token, projectId: backup.projectId, clientId: backup.clientId, clientSecret: backup.clientSecret };
                        }
                        const backupRefreshed = await this.refreshToken(backup.projectId);
                        if (backupRefreshed) {
                            return { token: backupRefreshed.access_token, projectId: backup.projectId, clientId: backup.clientId, clientSecret: backup.clientSecret };
                        }
                    }
                }
                // Last resort: try least-used project
                const fallback = pm.getLeastUsedProject();
                if (fallback && fallback.projectId !== project.projectId) {
                    const fallbackToken = pm.getToken(fallback.projectId);
                    if (fallbackToken && fallbackToken.expires_at - 5 * 60 * 1000 >= now) {
                        return { token: fallbackToken.access_token, projectId: fallback.projectId, clientId: fallback.clientId, clientSecret: fallback.clientSecret };
                    }
                }
                return null;
            }
            token = refreshed;
        }
        return {
            token: token.access_token,
            projectId: project.projectId,
            clientId: project.clientId,
            clientSecret: project.clientSecret,
        };
    }
    // ── Tracking ───────────────────────────────────────────────────────────────
    track(projectId) {
        const pm = getProjectManager();
        pm.track(projectId, 1);
    }
    recordError(projectId) {
        const pm = getProjectManager();
        pm.recordError(projectId);
    }
    trackError(projectId) {
        const pm = getProjectManager();
        pm.recordQuotaError(projectId);
    }
    // ── CRUD ─────────────────────────────────────────────────────────────────
    addToken(projectId, clientId, clientSecret, tokens) {
        const pm = getProjectManager();
        const project = pm.getProject(projectId) || pm.addProject({
            projectId,
            projectName: projectId,
            gmailAccount: '',
            clientId,
            clientSecret,
            apiKey: '',
            status: tokens.access_token ? 'active' : 'pending_auth',
            createdAt: new Date().toISOString(),
        });
        pm.updateProject(projectId, { clientId, clientSecret });
        if (tokens.access_token) {
            pm.saveToken(projectId, tokens);
        }
        devLog(`[TokenManager] Token added/updated for ${projectId}`);
    }
    getToken(projectId) {
        return getProjectManager().getToken(projectId);
    }
    removeToken(projectId) {
        getProjectManager().removeProject(projectId);
        devLog(`[TokenManager] Token removed for ${projectId}`);
    }
    reload() {
        // ProjectManager is always fresh — no-op
    }
    resetAll() {
        getProjectManager().resetAll();
        devLog('[TokenManager] Reset all token quotas');
    }
    resetTokenStats(projectId) {
        const pm = getProjectManager();
        const project = pm.getProject(projectId);
        const wasUnauthorized = project?.status === 'unauthorized';
        pm.resetProject(projectId);
        return { success: true, nextReset: pm.getNextResetTime(), wasUnauthorized };
    }
    markUnauthorized(projectId) {
        getProjectManager().markUnauthorized(projectId);
    }
    markAuthorized(projectId) {
        // Re-enable: just reset stats
        getProjectManager().resetProject(projectId);
    }
    /** Test a token by refreshing it */
    async testToken(projectId) {
        const refreshed = await this.refreshToken(projectId);
        if (!refreshed) {
            return { valid: false, error: 'Token expired or revoked', errorType: 'unauthorized' };
        }
        return { valid: true };
    }
    dispose() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._resetCheckTimer) {
            clearInterval(this._resetCheckTimer);
            this._resetCheckTimer = null;
        }
    }
    getTokenCount() {
        return getProjectManager().getAllProjects().filter(p => p.token?.access_token).length;
    }
    _getNextResetTime() {
        return getProjectManager().getNextResetTime();
    }
    /** Get status for all tokens (for Settings UI) */
    getAllStatuses() {
        const pm = getProjectManager();
        return pm.getAllProjects().map(p => {
            const usedToday = p.stats.usedToday;
            const errors = p.stats.errors;
            const quotaPercent = Math.round((usedToday / MAX_UNITS_PER_TOKEN) * 100);
            let status = 'healthy';
            if (!p.token?.access_token)
                status = 'no_oauth';
            else if (p.status === 'unauthorized' || p.stats.unauthorized)
                status = 'unauthorized';
            else if (usedToday >= MAX_UNITS_PER_TOKEN || p.status === 'exhausted')
                status = 'exhausted';
            else if (errors >= 10)
                status = 'rate_limited';
            else if (quotaPercent >= 80)
                status = 'warning';
            else if (errors > 0)
                status = 'error';
            return {
                projectId: p.projectId,
                projectName: p.projectName,
                gmailAccount: p.gmailAccount,
                clientId: p.clientId,
                hasToken: !!p.token?.access_token,
                tokenExpiry: p.token?.expires_at ?? null,
                usedToday,
                quotaTotal: MAX_UNITS_PER_TOKEN,
                quotaPercent: Math.min(100, quotaPercent),
                errors,
                status,
                lastUsed: p.stats.lastUsed || null,
            };
        });
    }
}
// ─── Singleton ─────────────────────────────────────────────────────────────
let _instance = null;
export function getTokenManager() {
    if (!_instance)
        _instance = new TokenManager();
    return _instance;
}
export { TokenManager };
