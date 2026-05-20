/**
 * License IPC handlers.
 * Channels: LICENSE_STATUS, LICENSE_ACTIVATE, LICENSE_VALIDATE, LICENSE_REVOKE
 */

import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../channels.js'
import {
  getLicenseStatus,
  activateLicense,
  validateLicense,
  revokeLocalLicense,
  initLicense,
  type ActivateResult,
  type LicenseStatus,
} from '../../services/license.js'

export function registerLicenseHandlers(ipcMain: IpcMain): void {
  // ── Status ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.LICENSE_STATUS, async (): Promise<LicenseStatus> => {
    return getLicenseStatus()
  })

  // ── Activate ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.LICENSE_ACTIVATE, async (_, key: string): Promise<ActivateResult> => {
    return activateLicense(key)
  })

  // ── Validate ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.LICENSE_VALIDATE, async (): Promise<LicenseStatus> => {
    return validateLicense()
  })

  // ── Revoke ────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.LICENSE_REVOKE, async () => {
    revokeLocalLicense()
    return { success: true }
  })
}
