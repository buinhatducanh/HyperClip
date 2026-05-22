"use strict";
/**
 * Project + Token IPC handlers.
 * Channels: PROJECT_*, TOKEN_*
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProjectHandlers = registerProjectHandlers;
const channels_js_1 = require("../channels.js");
const project_manager_js_1 = require("../../services/project_manager.js");
const token_manager_js_1 = require("../../services/token_manager.js");
function registerProjectHandlers(ipcMain) {
    // ── Project CRUD ──────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.PROJECT_LIST, () => {
        return (0, project_manager_js_1.getProjectManager)().getAllProjects();
    });
    // Returns enriched project list: GCPProject fields + usedToday/quotaTotal/computed status/errors from token manager.
    // Used by Settings UI (ProjectsSection + PollerStatusPanel).
    ipcMain.handle(channels_js_1.IPC_CHANNELS.PROJECT_TOKEN_STATUSES, () => {
        const rawProjects = (0, project_manager_js_1.getProjectManager)().getAllProjects();
        const enrichedStatuses = (0, token_manager_js_1.getTokenManager)().getAllStatuses();
        const statusMap = new Map(enrichedStatuses.map(s => [s.projectId, s]));
        return rawProjects.map(p => {
            const enriched = statusMap.get(p.projectId);
            return {
                // GCPProject fields
                projectId: p.projectId,
                projectName: p.projectName,
                gmailAccount: p.gmailAccount,
                clientId: p.clientId,
                apiKey: p.apiKey,
                assignedChannels: p.assignedChannels,
                createdAt: p.createdAt,
                lastUsedAt: p.lastUsedAt,
                totalQuotasUsed: p.totalQuotasUsed,
                // Token stats (may be absent for projects not yet tracked)
                usedToday: enriched?.usedToday ?? 0,
                quotaTotal: enriched?.quotaTotal ?? 9500,
                status: enriched?.status ?? 'healthy',
                errors: enriched?.errors ?? 0,
                hasToken: enriched?.hasToken ?? false,
                tokenExpiry: enriched?.tokenExpiry ?? null,
                quotaPercent: enriched?.quotaPercent ?? 0,
                lastUsed: enriched?.lastUsed ?? null,
            };
        });
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.PROJECT_ADD, async (_, data) => {
        try {
            const pm = (0, project_manager_js_1.getProjectManager)();
            // SECURITY: clientSecret stored in encrypted YAML, not sent back to renderer
            const project = pm.addProject({
                projectId: data.projectId,
                projectName: data.projectId,
                gmailAccount: '',
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                apiKey: data.apiKey,
                status: 'active',
                createdAt: new Date().toISOString(),
            });
            return { success: true, projectId: project.projectId };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.PROJECT_REMOVE, (_, projectId) => {
        const success = (0, project_manager_js_1.getProjectManager)().removeProject(projectId);
        return { success };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.PROJECT_RESET_QUOTA, (_, projectId) => {
        (0, project_manager_js_1.getProjectManager)().resetProject(projectId);
        return { success: true };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.PROJECT_TEST_ALL, async () => {
        const pm = (0, project_manager_js_1.getProjectManager)();
        const projects = pm.getAllProjects();
        const tm = (0, token_manager_js_1.getTokenManager)();
        const results = await Promise.all(projects.map(async (p) => {
            const testResult = await tm.testToken(p.projectId);
            return { projectId: p.projectId, ...testResult };
        }));
        return { projects: pm.getAllProjects(), checkedAt: Date.now(), results };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.PROJECT_REPAIR, async (_, projectId) => {
        const tm = (0, token_manager_js_1.getTokenManager)();
        const refreshed = await tm.refreshToken(projectId);
        if (refreshed) {
            return { success: true, repaired: true, refreshed: true };
        }
        // If no refresh_token or credentials missing, needs re-auth
        const pm = (0, project_manager_js_1.getProjectManager)();
        const project = pm.getProject(projectId);
        if (project && (!project.clientId || !project.clientSecret)) {
            return { success: false, error: 'Missing credentials', needsCredentials: true };
        }
        return { success: false, error: 'Token refresh failed', needsOAuthFlow: true };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.PROJECT_BATCH_REPAIR, async (_, projectIds) => {
        const results = {};
        const tm = (0, token_manager_js_1.getTokenManager)();
        const pm = (0, project_manager_js_1.getProjectManager)();
        for (const projectId of projectIds) {
            const refreshed = await tm.refreshToken(projectId);
            if (refreshed) {
                results[projectId] = { success: true, repaired: true, refreshed: true };
            }
            else {
                const project = pm.getProject(projectId);
                if (project && (!project.clientId || !project.clientSecret)) {
                    results[projectId] = { success: false, error: 'Missing credentials', needsCredentials: true };
                }
                else {
                    results[projectId] = { success: false, error: 'Token refresh failed', needsOAuthFlow: true };
                }
            }
        }
        return results;
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.PROJECT_AUTO_ASSIGN, (_, channelIds) => {
        (0, project_manager_js_1.getProjectManager)().autoAssignChannels(channelIds);
        return { success: true, assigned: channelIds.length };
    });
    // ── Token Management ─────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.TOKEN_STATUS_LIST, () => {
        return (0, token_manager_js_1.getTokenManager)().getAllStatuses();
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.TOKEN_TEST, async (_, projectId) => {
        return (0, token_manager_js_1.getTokenManager)().testToken(projectId);
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.TOKEN_REMOVE, (_, projectId) => {
        (0, token_manager_js_1.getTokenManager)().removeToken(projectId);
        return { success: true };
    });
}
