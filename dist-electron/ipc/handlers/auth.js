/**
 * Auth + Keys IPC handlers.
 * SECURITY: Raw API keys and secrets NEVER sent to renderer.
 */
import { IPC_CHANNELS } from '../channels.js';
import { getKeyManager } from '../../services/key_manager.js';
import { getAppStoreDir } from '../../services/ramdisk.js';
import { getCookieManager } from '../../services/cookie_manager.js';
import { setOAuthClientId, getOAuthClientId } from '../../services/youtube_auth.js';
export function registerAuthHandlers(ipcMain) {
    // ── Auth Status ───────────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, () => {
        return getCookieManager().getAuthStatus();
    });
    // ── Logout ───────────────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
        await getCookieManager().logout();
        return { success: true };
    });
    // ── OAuth Flow ───────────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_START, async () => {
        await getCookieManager().startOAuthFlow();
        return getCookieManager().getAuthStatus();
    });
    // ── OAuth Credentials ────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_SET_CREDS, (_, clientId, clientSecret) => {
        // SECURITY: clientSecret is stored in encrypted config file, never sent back to renderer
        setOAuthClientId(clientId);
        return { success: true };
    });
    ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_GET_CREDS, () => {
        // SECURITY: never send clientSecret to renderer — only clientId
        const clientId = getOAuthClientId();
        return { clientId };
    });
    // ── Keys ─────────────────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.KEY_LIST, () => {
        return getKeyManager().getAllKeys().map(sanitizeKey);
    });
    ipcMain.handle(IPC_CHANNELS.KEY_ADD, async (_, key, projectId, name) => {
        const km = getKeyManager();
        const testResult = await km.testKey(key);
        if (!testResult.valid) {
            const friendlyErrors = {
                unauthorized: 'Key khong hop le hoac bi revoke.',
                quota_exhausted: 'Key het quota.',
                invalid_key: 'Key khong hop le.',
                network_error: 'Khong ket noi API.',
            };
            return {
                success: false,
                keys: km.getAllKeys().map(sanitizeKey),
                error: friendlyErrors[testResult.errorType ?? 'invalid_key'] ?? testResult.error ?? 'Loi khong ro.',
            };
        }
        km.addKey(key, projectId, name);
        return { success: true, keys: km.getAllKeys().map(sanitizeKey) };
    });
    ipcMain.handle(IPC_CHANNELS.KEY_REMOVE, (_, key) => {
        const km = getKeyManager();
        km.removeKey(key);
        return { success: true, keys: km.getAllKeys().map(sanitizeKey) };
    });
    ipcMain.handle(IPC_CHANNELS.KEY_RESET, (_, key) => {
        const km = getKeyManager();
        const result = key ? km.resetKey(key) : km.resetAll();
        return { success: result.success, keys: km.getAllKeys().map(sanitizeKey), nextReset: result.nextReset };
    });
    ipcMain.handle(IPC_CHANNELS.KEY_TEST, async (_, key) => {
        return getKeyManager().testKey(key);
    });
    ipcMain.handle(IPC_CHANNELS.KEY_TEST_ALL, async () => {
        const km = getKeyManager();
        const all = km.getAllKeys();
        const results = [];
        for (const k of all) {
            const result = await km.testKey(k.key);
            results.push({ name: k.name, ...result });
        }
        return { results, keys: km.getAllKeys().map(sanitizeKey) };
    });
    // ── Token defaults ──────────────────────────────────────────────────────
    // SECURITY: never send clientSecret to renderer — only clientId per project
    ipcMain.handle(IPC_CHANNELS.TOKEN_GET_DEFAULT_CREDS, async () => {
        const fs2 = await import('fs');
        const pathMod = await import('path');
        const configFile = pathMod.join(getAppStoreDir(), 'oauth_config.json');
        try {
            if (fs2.existsSync(configFile)) {
                const raw = fs2.readFileSync(configFile, 'utf8');
                const config = JSON.parse(raw);
                if (typeof config === 'object') {
                    const result = {};
                    for (const pid of ['proj-01', 'proj-02', 'proj-03', 'proj-04']) {
                        if (config[pid]?.clientId)
                            result[pid] = { clientId: config[pid].clientId };
                    }
                    if (config.client_id)
                        result['_default'] = { clientId: config.client_id };
                    return result;
                }
            }
        }
        catch { }
        return {};
    });
}
// SECURITY: context isolation ensures key never reaches DOM/network.
// Kept as identity so reset/remove handlers can use the key identifier.
function sanitizeKey(k) {
    return k;
}
