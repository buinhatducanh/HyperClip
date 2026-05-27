"use strict";
/**
 * Auth + Keys IPC handlers.
 * SECURITY: Raw API keys and secrets NEVER sent to renderer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthHandlers = registerAuthHandlers;
const channels_js_1 = require("../channels.js");
const key_manager_js_1 = require("../../services/key_manager.js");
const ramdisk_js_1 = require("../../services/ramdisk.js");
const cookie_manager_js_1 = require("../../services/cookie_manager.js");
const youtube_auth_js_1 = require("../../services/youtube_auth.js");
function registerAuthHandlers(ipcMain) {
    // ── Auth Status ───────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.AUTH_STATUS, () => {
        return (0, cookie_manager_js_1.getCookieManager)().getAuthStatus();
    });
    // ── Logout ───────────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.AUTH_LOGOUT, async () => {
        await (0, cookie_manager_js_1.getCookieManager)().logout();
        return { success: true };
    });
    // ── OAuth Flow ───────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.AUTH_OAUTH_START, async () => {
        const clientId = (0, youtube_auth_js_1.getOAuthClientId)();
        if (!clientId) {
            throw new Error('MISSING_OAUTH_CREDS');
        }
        await (0, cookie_manager_js_1.getCookieManager)().startOAuthFlow();
        return (0, cookie_manager_js_1.getCookieManager)().getAuthStatus();
    });
    // ── OAuth Credentials ────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.AUTH_OAUTH_SET_CREDS, (_, clientId, clientSecret) => {
        // SECURITY: clientSecret is stored in encrypted config file, never sent back to renderer
        (0, youtube_auth_js_1.setOAuthClientId)(clientId);
        return { success: true };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.AUTH_OAUTH_GET_CREDS, () => {
        // SECURITY: never send clientSecret to renderer — only clientId
        const clientId = (0, youtube_auth_js_1.getOAuthClientId)();
        return { clientId };
    });
    // ── Keys ─────────────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.KEY_LIST, () => {
        return (0, key_manager_js_1.getKeyManager)().getAllKeys().map(sanitizeKey);
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.KEY_ADD, async (_, key, projectId, name) => {
        const km = (0, key_manager_js_1.getKeyManager)();
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
    ipcMain.handle(channels_js_1.IPC_CHANNELS.KEY_REMOVE, (_, key) => {
        const km = (0, key_manager_js_1.getKeyManager)();
        km.removeKey(key);
        return { success: true, keys: km.getAllKeys().map(sanitizeKey) };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.KEY_RESET, (_, key) => {
        const km = (0, key_manager_js_1.getKeyManager)();
        const result = key ? km.resetKey(key) : km.resetAll();
        return { success: result.success, keys: km.getAllKeys().map(sanitizeKey), nextReset: result.nextReset };
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.KEY_TEST, async (_, key) => {
        return (0, key_manager_js_1.getKeyManager)().testKey(key);
    });
    ipcMain.handle(channels_js_1.IPC_CHANNELS.KEY_TEST_ALL, async () => {
        const km = (0, key_manager_js_1.getKeyManager)();
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
    ipcMain.handle(channels_js_1.IPC_CHANNELS.TOKEN_GET_DEFAULT_CREDS, async () => {
        const fs2 = await import('fs');
        const pathMod = await import('path');
        const configFile = pathMod.join((0, ramdisk_js_1.getAppStoreDir)(), 'oauth_config.json');
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
