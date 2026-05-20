/**
 * License IPC handlers.
 * Channels: LICENSE_STATUS, LICENSE_ACTIVATE, LICENSE_VALIDATE, LICENSE_REVOKE
 */
import { IPC_CHANNELS } from '../channels.js';
import { getLicenseStatus, activateLicense, validateLicense, revokeLocalLicense, } from '../../services/license.js';
export function registerLicenseHandlers(ipcMain) {
    // ── Status ─────────────────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.LICENSE_STATUS, async () => {
        return getLicenseStatus();
    });
    // ── Activate ───────────────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.LICENSE_ACTIVATE, async (_, key) => {
        return activateLicense(key);
    });
    // ── Validate ──────────────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.LICENSE_VALIDATE, async () => {
        return validateLicense();
    });
    // ── Revoke ────────────────────────────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.LICENSE_REVOKE, async () => {
        revokeLocalLicense();
        return { success: true };
    });
}
