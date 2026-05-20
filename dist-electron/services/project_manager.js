/**
 * Project Manager — HyperClip (2026-05-14, updated 2026-05-18)
 *
 * Manages up to 200 GCP projects organized in projects/{id}/ folder structure.
 * Sensitive files (config, token) are stored as encrypted YAML (AES-256-GCM, hwId-keyed).
 * Stats are stored as plain JSON (not sensitive).
 *
 * Responsibilities:
 * 1. Load all project configs from projects/ directory (encrypted YAML)
 * 2. Auto-assign channels to projects (round-robin, 2 projects/channel)
 * 3. Track quota stats per project (plain JSON)
 * 4. Auto-disable exhausted projects
 * 5. Smart rotation: getLeastUsedProject() for detection
 * 6. Midnight UTC reset: re-enable all projects
 *
 * Storage layout:
 *   HyperClip-Data/
 *     projects/
 *       proj-001/config.enc.yaml  ← credentials (encrypted)
 *       proj-001/token.enc.yaml   ← OAuth token (encrypted)
 *       proj-001/stats.json       ← quota stats (plain JSON)
 *       proj-002/
 *       ...
 */
import fs from 'fs';
import path from 'path';
import { devLog } from './unified_log.js';
import { getProjectsDir, getProjectDir, getProjectConfigPath, getProjectConfigEncPath, getProjectTokenPath, getProjectTokenEncPath, getProjectStatsPath, getChannelsDir, } from './paths.js';
import { readEncryptedFile, writeEncryptedFile, isEncryptedYaml, } from './encrypted_yaml.js';
// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_UNITS_PER_PROJECT = 9500;
const EXHAUSTION_ERROR_THRESHOLD = 5;
const QUOTA_WARNING_PCT = 80;
const MIDNIGHT_RESET_HOUR_UTC = 0;
// ─── Project Manager ───────────────────────────────────────────────────────────
class ProjectManager {
    _projects = new Map();
    _assignments = [];
    _lastResetUTCDate = '';
    _initialized = false;
    constructor() {
        this._ensureDirs();
    }
    // ── Initialization ───────────────────────────────────────────────────────────
    /** Ensure required directories exist */
    _ensureDirs() {
        const dirs = [
            getProjectsDir(),
            getChannelsDir(),
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }
    /** Initialize: load all projects and channel assignments */
    init() {
        if (this._initialized)
            return;
        // Load all projects from projects/ folder
        this._loadAllProjects();
        // Load channel assignments
        this._loadAssignments();
        // Check midnight reset
        this._checkReset();
        this._initialized = true;
        devLog(`[ProjectManager] Initialized: ${this._projects.size} projects loaded`);
        this._logSummary();
    }
    /** Load all project configs from projects/{id}/config.enc.yaml (encrypted)
     *  Falls back to config.json for legacy projects (auto-migrates on first write).
     */
    _loadAllProjects() {
        const projectsDir = getProjectsDir();
        if (!fs.existsSync(projectsDir)) {
            fs.mkdirSync(projectsDir, { recursive: true });
            devLog('[ProjectManager] Created projects/ directory');
            return;
        }
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const projectId = entry.name;
            const encPath = getProjectConfigEncPath(projectId);
            const jsonPath = getProjectConfigPath(projectId);
            let config = null;
            // Try encrypted YAML first
            if (isEncryptedYaml(encPath)) {
                config = readEncryptedFile(encPath);
            }
            else if (fs.existsSync(jsonPath)) {
                // Legacy JSON — migrate in memory (write encrypted on next save)
                try {
                    config = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                    devLog(`[ProjectManager] Legacy project config found for ${projectId} — will migrate on next save`);
                }
                catch (e) {
                    console.warn(`[ProjectManager] Failed to parse project config ${projectId}:`, e);
                    continue;
                }
            }
            if (!config)
                continue;
            const stats = this._loadProjectStats(projectId);
            const token = this._loadProjectToken(projectId);
            const project = {
                ...config,
                token,
                stats,
            };
            this._projects.set(projectId, project);
        }
    }
    _loadProjectStats(projectId) {
        const statsPath = getProjectStatsPath(projectId);
        if (fs.existsSync(statsPath)) {
            try {
                return JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
            }
            catch { }
        }
        return this._defaultStats();
    }
    _loadProjectToken(projectId) {
        const encPath = getProjectTokenEncPath(projectId);
        const jsonPath = getProjectTokenPath(projectId);
        // Try encrypted YAML first
        if (isEncryptedYaml(encPath)) {
            const token = readEncryptedFile(encPath);
            if (token?.access_token)
                return token;
            return undefined;
        }
        // Legacy JSON fallback
        if (fs.existsSync(jsonPath)) {
            try {
                const token = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                if (!token.access_token)
                    return undefined;
                return token;
            }
            catch { }
        }
        return undefined;
    }
    _defaultStats() {
        return {
            usedToday: 0,
            errors: 0,
            lastUsed: 0,
            lastResetAt: this._todayUTCDate(),
            unauthorized: false,
        };
    }
    // ── Channel Assignments ───────────────────────────────────────────────────────
    /** Load channel assignments from channels/ directory */
    _loadAssignments() {
        const assignmentsFile = path.join(getChannelsDir(), 'assignments.json');
        if (fs.existsSync(assignmentsFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(assignmentsFile, 'utf-8'));
                this._assignments = data.assignments || [];
            }
            catch {
                this._assignments = [];
            }
        }
        else {
            this._assignments = [];
        }
    }
    /** Persist channel assignments */
    _saveAssignments() {
        const assignmentsFile = path.join(getChannelsDir(), 'assignments.json');
        fs.writeFileSync(assignmentsFile, JSON.stringify({ assignments: this._assignments }, null, 2), 'utf-8');
    }
    /**
     * Auto-assign channels to projects (round-robin).
     * Call after channel add/remove or project add/remove.
     *
     * Strategy:
     * - Each channel gets 2 projects (primary + backup)
     * - Projects assigned round-robin: proj-000, proj-200, proj-001, proj-201, ...
     * - So primary projects are evenly distributed, backup is always +200
     */
    autoAssignChannels(channelIds) {
        const activeProjects = this.getActiveProjects();
        if (activeProjects.length === 0) {
            devLog('[ProjectManager] No active projects — cannot assign channels');
            return;
        }
        const newAssignments = [];
        const projectCount = activeProjects.length;
        for (let i = 0; i < channelIds.length; i++) {
            const channelId = channelIds[i];
            const primaryIdx = i % projectCount;
            const backupIdx = (i + projectCount) % projectCount;
            // If we have fewer than 2 projects, reuse the same project
            const primaryProject = activeProjects[primaryIdx];
            const backupProject = activeProjects[backupIdx] || activeProjects[primaryIdx];
            newAssignments.push({
                channelId,
                primaryProjectId: primaryProject.projectId,
                backupProjectId: backupProject.projectId,
            });
        }
        this._assignments = newAssignments;
        this._saveAssignments();
        // Also update assignedChannels in each project config
        for (const project of this._projects.values()) {
            const assigned = newAssignments
                .filter(a => a.primaryProjectId === project.projectId || a.backupProjectId === project.projectId)
                .map(a => a.channelId);
            project.assignedChannels = [...new Set(assigned)];
            this._saveProjectConfig(project);
        }
        devLog(`[ProjectManager] Assigned ${channelIds.length} channels to ${projectCount} projects`);
    }
    /** Get assignments for a specific channel */
    getAssignmentForChannel(channelId) {
        return this._assignments.find(a => a.channelId === channelId) || null;
    }
    // ── CRUD ─────────────────────────────────────────────────────────────────────
    /** Add a new project from config (used by bulk import + Settings UI) */
    addProject(config) {
        const { projectId } = config;
        const projectDir = getProjectDir(projectId);
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }
        const project = {
            ...config,
            assignedChannels: [],
            lastUsedAt: null,
            totalQuotasUsed: 0,
            stats: this._defaultStats(),
        };
        this._projects.set(projectId, project);
        this._saveProjectConfig(project);
        this._saveProjectStats(project);
        devLog(`[ProjectManager] Added project: ${projectId} (${config.projectName})`);
        return project;
    }
    /** Update project config */
    updateProject(projectId, patch) {
        const project = this._projects.get(projectId);
        if (!project)
            return null;
        Object.assign(project, patch);
        this._saveProjectConfig(project);
        return project;
    }
    /** Remove a project */
    removeProject(projectId) {
        const project = this._projects.get(projectId);
        if (!project)
            return false;
        // Delete project directory
        const projectDir = getProjectDir(projectId);
        try {
            if (fs.existsSync(projectDir)) {
                fs.rmSync(projectDir, { recursive: true });
            }
        }
        catch (e) {
            console.warn(`[ProjectManager] Failed to remove project dir ${projectDir}:`, e);
        }
        // Remove from memory
        this._projects.delete(projectId);
        // Remove assignments
        const removedAssignments = this._assignments.filter(a => a.primaryProjectId === projectId || a.backupProjectId === projectId);
        if (removedAssignments.length > 0) {
            this._assignments = this._assignments.filter(a => a.primaryProjectId !== projectId && a.backupProjectId !== projectId);
            this._saveAssignments();
        }
        devLog(`[ProjectManager] Removed project: ${projectId}`);
        return true;
    }
    // ── Token Management ─────────────────────────────────────────────────────────
    /** Save OAuth token for a project (encrypted YAML) */
    saveToken(projectId, token) {
        const project = this._projects.get(projectId);
        if (!project)
            return;
        project.token = token;
        project.status = 'active';
        this._saveProjectTokenEnc(projectId, token);
        this._saveProjectConfig(project);
        devLog(`[ProjectManager] Token saved (encrypted) for ${projectId}`);
    }
    /** Get token for a project */
    getToken(projectId) {
        const project = this._projects.get(projectId);
        if (!project?.token)
            return null;
        if (!project.token.access_token)
            return null;
        return project.token;
    }
    // ── Stats Tracking ───────────────────────────────────────────────────────────
    /** Track 1 unit consumed by a project */
    track(projectId, units = 1) {
        const project = this._projects.get(projectId);
        if (!project)
            return;
        project.stats.usedToday += units;
        project.stats.lastUsed = Date.now();
        project.totalQuotasUsed += units;
        // Check exhaustion
        if (project.stats.usedToday >= MAX_UNITS_PER_PROJECT) {
            this.markExhausted(projectId);
        }
        this._saveProjectStats(project);
    }
    /** Record an error for a project */
    recordError(projectId) {
        const project = this._projects.get(projectId);
        if (!project)
            return;
        project.stats.errors++;
        if (project.stats.errors >= EXHAUSTION_ERROR_THRESHOLD) {
            this.markExhausted(projectId);
        }
        this._saveProjectStats(project);
    }
    /** Record a quota error (403) */
    recordQuotaError(projectId) {
        const project = this._projects.get(projectId);
        if (!project)
            return;
        // Adding 100 units simulates hitting quota limit
        project.stats.usedToday += 100;
        project.stats.errors++;
        project.stats.lastUsed = Date.now();
        if (project.stats.errors >= EXHAUSTION_ERROR_THRESHOLD) {
            this.markExhausted(projectId);
        }
        this._saveProjectStats(project);
        console.warn(`[ProjectManager] Quota error on ${projectId}: errors=${project.stats.errors}, used=${project.stats.usedToday}`);
    }
    /** Mark a project as exhausted */
    markExhausted(projectId) {
        const project = this._projects.get(projectId);
        if (!project)
            return;
        project.status = 'exhausted';
        this._saveProjectConfig(project);
        devLog(`[ProjectManager] Project ${projectId} marked exhausted (used=${project.stats.usedToday}, errors=${project.stats.errors})`);
    }
    /** Mark a project as unauthorized (401 — token revoked) */
    markUnauthorized(projectId) {
        const project = this._projects.get(projectId);
        if (!project)
            return;
        project.status = 'unauthorized';
        project.stats.unauthorized = true;
        this._saveProjectConfig(project);
        this._saveProjectStats(project);
        console.warn(`[ProjectManager] Project ${projectId} marked unauthorized`);
    }
    /** Mark a project as pending auth */
    markPendingAuth(projectId) {
        const project = this._projects.get(projectId);
        if (!project)
            return;
        project.status = 'pending_auth';
        project.token = undefined;
        this._saveProjectConfig(project);
    }
    /** Reset stats for a project */
    resetProject(projectId) {
        const project = this._projects.get(projectId);
        if (!project)
            return;
        project.stats = {
            ...this._defaultStats(),
            lastResetAt: this._todayUTCDate(),
        };
        project.status = project.token ? 'active' : 'pending_auth';
        project.stats.unauthorized = false;
        this._saveProjectStats(project);
        this._saveProjectConfig(project);
        devLog(`[ProjectManager] Reset stats for ${projectId}`);
    }
    /** Reset ALL projects (manual reset from Settings UI) */
    resetAll() {
        for (const project of this._projects.values()) {
            this.resetProject(project.projectId);
        }
        devLog('[ProjectManager] Reset all project stats');
    }
    // ── Midnight Reset ──────────────────────────────────────────────────────────
    /** Check if midnight UTC reset is needed */
    _checkReset() {
        const today = this._todayUTCDate();
        if (this._lastResetUTCDate === today)
            return;
        devLog(`[ProjectManager] Midnight reset: "${this._lastResetUTCDate}" → "${today}"`);
        this._lastResetUTCDate = today;
        for (const project of this._projects.values()) {
            // Re-enable exhausted projects
            if (project.status === 'exhausted') {
                project.status = project.token ? 'active' : 'pending_auth';
                this._saveProjectConfig(project);
            }
            // Reset daily stats
            project.stats = {
                usedToday: 0,
                errors: 0,
                lastUsed: project.stats.lastUsed,
                lastResetAt: today,
                unauthorized: false,
            };
            this._saveProjectStats(project);
        }
        devLog('[ProjectManager] All projects reset for new day');
    }
    /** Check reset on interval (call every 30 min) */
    checkReset() {
        this._checkReset();
    }
    // ── Rotation / Selection ─────────────────────────────────────────────────────
    /** Get the primary project for a specific channel */
    getProjectForChannel(channelId) {
        const assignment = this.getAssignmentForChannel(channelId);
        if (assignment) {
            const project = this._projects.get(assignment.primaryProjectId);
            if (project && this._isProjectUsable(project))
                return project;
            // Fallback to backup
            const backup = this._projects.get(assignment.backupProjectId);
            if (backup && this._isProjectUsable(backup))
                return backup;
        }
        // No assignment or project unavailable → use least-used active project
        return this.getLeastUsedProject();
    }
    /** Get backup project for a channel */
    getBackupProjectForChannel(channelId) {
        const assignment = this.getAssignmentForChannel(channelId);
        if (assignment) {
            const backup = this._projects.get(assignment.backupProjectId);
            if (backup && this._isProjectUsable(backup))
                return backup;
            // Backup unavailable → use next-least-used
            return this.getLeastUsedProject();
        }
        return this.getLeastUsedProject();
    }
    /** Get the least-used active project (for on-demand scanning) */
    getLeastUsedProject() {
        const active = this.getActiveProjects();
        if (active.length === 0)
            return null;
        active.sort((a, b) => a.stats.usedToday - b.stats.usedToday);
        return active[0];
    }
    /** Get all active (non-exhausted, non-unauthorized) projects */
    getActiveProjects() {
        return [...this._projects.values()].filter(p => this._isProjectUsable(p));
    }
    /** Check if a project is usable */
    _isProjectUsable(p) {
        if (p.status === 'exhausted')
            return false;
        if (p.status === 'unauthorized')
            return false;
        if (p.status === 'pending_auth')
            return false;
        if (!p.token?.access_token)
            return false;
        if (p.stats.usedToday >= MAX_UNITS_PER_PROJECT)
            return false;
        if (p.stats.unauthorized)
            return false;
        return true;
    }
    // ── Persistence ──────────────────────────────────────────────────────────────
    /** Save project config as encrypted YAML (migrates legacy JSON on first write). */
    _saveProjectConfig(project) {
        const encPath = getProjectConfigEncPath(project.projectId);
        const jsonPath = getProjectConfigPath(project.projectId);
        const { token: _token, stats: _stats, ...config } = project;
        writeEncryptedFile(encPath, config);
        // Remove legacy plain JSON after successful encrypted write
        if (fs.existsSync(jsonPath)) {
            try {
                fs.unlinkSync(jsonPath);
            }
            catch { }
        }
    }
    /** Save project token as encrypted YAML (migrates legacy JSON on first write). */
    _saveProjectTokenEnc(projectId, token) {
        const encPath = getProjectTokenEncPath(projectId);
        const jsonPath = getProjectTokenPath(projectId);
        writeEncryptedFile(encPath, token);
        if (fs.existsSync(jsonPath)) {
            try {
                fs.unlinkSync(jsonPath);
            }
            catch { }
        }
    }
    _saveProjectStats(project) {
        const statsPath = getProjectStatsPath(project.projectId);
        fs.writeFileSync(statsPath, JSON.stringify(project.stats, null, 2), 'utf-8');
    }
    // ── Query ───────────────────────────────────────────────────────────────────
    /** Get all projects */
    getAllProjects() {
        return [...this._projects.values()];
    }
    /** Get a specific project */
    getProject(projectId) {
        return this._projects.get(projectId) ?? null;
    }
    /** Get project status summary */
    getStatus() {
        let active = 0, exhausted = 0, pendingAuth = 0, unauthorized = 0;
        let totalUsedToday = 0;
        const totalQuota = this._projects.size * MAX_UNITS_PER_PROJECT;
        for (const p of this._projects.values()) {
            totalUsedToday += p.stats.usedToday;
            switch (p.status) {
                case 'active':
                    active++;
                    break;
                case 'exhausted':
                    exhausted++;
                    break;
                case 'pending_auth':
                    pendingAuth++;
                    break;
                case 'unauthorized':
                    unauthorized++;
                    break;
            }
        }
        return {
            total: this._projects.size,
            active,
            exhausted,
            pendingAuth,
            unauthorized,
            totalQuotaRemaining: totalQuota - totalUsedToday,
            totalQuotaUsedToday: totalUsedToday,
            assignments: this._assignments,
        };
    }
    /** Get projects grouped by Gmail account */
    getProjectsByGmail() {
        const groups = {};
        for (const project of this._projects.values()) {
            const gmail = project.gmailAccount || 'unknown';
            if (!groups[gmail])
                groups[gmail] = [];
            groups[gmail].push(project);
        }
        return groups;
    }
    _todayUTCDate() {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    }
    _logSummary() {
        const status = this.getStatus();
        devLog(`[ProjectManager] Summary: total=${status.total}, active=${status.active}, exhausted=${status.exhausted}, pending_auth=${status.pendingAuth}`);
        devLog(`[ProjectManager] Quota: ${status.totalQuotaUsedToday}/${status.totalQuotaRemaining + status.totalQuotaUsedToday} used today`);
    }
    /** Get usedToday for a specific project */
    getUsedToday(projectId) {
        return this._projects.get(projectId)?.stats.usedToday ?? 0;
    }
    /** Compute timestamp of next midnight UTC reset */
    getNextResetTime() {
        const now = new Date();
        const msUntilMidnightUTC = (24 - now.getUTCHours()) * 3600 * 1000
            - now.getUTCMinutes() * 60000
            - now.getUTCSeconds() * 1000
            - now.getUTCMilliseconds();
        return Date.now() + msUntilMidnightUTC;
    }
}
// ─── Singleton ───────────────────────────────────────────────────────────────
let _instance = null;
export function getProjectManager() {
    if (!_instance) {
        _instance = new ProjectManager();
        _instance.init();
    }
    return _instance;
}
export { ProjectManager };
