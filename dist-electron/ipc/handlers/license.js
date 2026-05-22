"use strict";
/**
 * License IPC handlers.
 * Channels: LICENSE_STATUS, LICENSE_ACTIVATE, LICENSE_VALIDATE, LICENSE_REVOKE
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLicenseHandlers = registerLicenseHandlers;
const channels_js_1 = require("../channels.js");
const license_js_1 = require("../../services/license.js");
function registerLicenseHandlers(ipcMain) {
    // ── Status ─────────────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.LICENSE_STATUS, async () => {
        return (0, license_js_1.getLicenseStatus)();
    });
    // ── Activate ───────────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.LICENSE_ACTIVATE, async (_, key) => {
        return (0, license_js_1.activateLicense)(key);
    });
    // ── Validate ──────────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.LICENSE_VALIDATE, async () => {
        return (0, license_js_1.validateLicense)();
    });
    // ── Revoke ────────────────────────────────────────────────────────────────
    ipcMain.handle(channels_js_1.IPC_CHANNELS.LICENSE_REVOKE, async () => {
        (0, license_js_1.revokeLocalLicense)();
        return { success: true };
    });
}
