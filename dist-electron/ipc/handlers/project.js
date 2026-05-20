/**
 * Project + Token IPC handlers.
 * Channels: PROJECT_*, TOKEN_*
 */
import { IPC_CHANNELS } from '../channels.js';
import { getProjectManager } from '../../services/project_manager.js';
import { getTokenManager } from '../../services/token_manager.js';
export function registerProjectHandlers(ipcMain) {
    // ── Project CRUD ──────────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.PROJECT_LIST, () => {
        return getProjectManager().getAllProjects();
    });
    // Returns enriched project list: GCPProject fields + usedToday/quotaTotal/computed status/errors from token manager.
    // Used by Settings UI (ProjectsSection + PollerStatusPanel).
    ipcMain.handle(IPC_CHANNELS.PROJECT_TOKEN_STATUSES, () => {
        const rawProjects = getProjectManager().getAllProjects();
        const enrichedStatuses = getTokenManager().getAllStatuses();
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
    ipcMain.handle(IPC_CHANNELS.PROJECT_ADD, async (_, data) => {
        try {
            const pm = getProjectManager();
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
    ipcMain.handle(IPC_CHANNELS.PROJECT_REMOVE, (_, projectId) => {
        const success = getProjectManager().removeProject(projectId);
        return { success };
    });
    ipcMain.handle(IPC_CHANNELS.PROJECT_RESET_QUOTA, (_, projectId) => {
        getProjectManager().resetProject(projectId);
        return { success: true };
    });
    ipcMain.handle(IPC_CHANNELS.PROJECT_TEST_ALL, async () => {
        const pm = getProjectManager();
        const projects = pm.getAllProjects();
        const tm = getTokenManager();
        const results = await Promise.all(projects.map(async (p) => {
            const testResult = await tm.testToken(p.projectId);
            return { projectId: p.projectId, ...testResult };
        }));
        return { projects: pm.getAllProjects(), checkedAt: Date.now(), results };
    });
    ipcMain.handle(IPC_CHANNELS.PROJECT_REPAIR, async (_, projectId) => {
        const tm = getTokenManager();
        const refreshed = await tm.refreshToken(projectId);
        if (refreshed) {
            return { success: true, repaired: true, refreshed: true };
        }
        // If no refresh_token or credentials missing, needs re-auth
        const pm = getProjectManager();
        const project = pm.getProject(projectId);
        if (project && (!project.clientId || !project.clientSecret)) {
            return { success: false, error: 'Missing credentials', needsCredentials: true };
        }
        return { success: false, error: 'Token refresh failed', needsOAuthFlow: true };
    });
    ipcMain.handle(IPC_CHANNELS.PROJECT_BATCH_REPAIR, async (_, projectIds) => {
        const results = {};
        const tm = getTokenManager();
        const pm = getProjectManager();
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
    ipcMain.handle(IPC_CHANNELS.PROJECT_AUTO_ASSIGN, (_, channelIds) => {
        getProjectManager().autoAssignChannels(channelIds);
        return { success: true, assigned: channelIds.length };
    });
    // ── Token Management ─────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.TOKEN_STATUS_LIST, () => {
        return getTokenManager().getAllStatuses();
    });
    ipcMain.handle(IPC_CHANNELS.TOKEN_TEST, async (_, projectId) => {
        return getTokenManager().testToken(projectId);
    });
    ipcMain.handle(IPC_CHANNELS.TOKEN_REMOVE, (_, projectId) => {
        getTokenManager().removeToken(projectId);
        return { success: true };
    });
}
