// IPC client wrapper for Electron
// Exposes window.electronAPI (from preload) to the renderer

import type { KeyStatus } from '../types'

export const ipc = {
  async addTracker(url: string, trimLimit: number | 'full') {
    return window.electronAPI?.addTracker(url, String(trimLimit))
  },
  async removeTracker(id: string) {
    return window.electronAPI?.removeTracker(id)
  },
  async getTrackers() {
    return window.electronAPI?.getTrackers()
  },
  async getChannelInfo(url: string) {
    return window.electronAPI?.getChannelInfo(url)
  },
  async getChannels() {
    return window.electronAPI?.getChannels()
  },

  async syncChannels() {
    return window.electronAPI?.syncChannels() ?? { added: 0, removed: 0 }
  },
  async addChannel(url: string) {
    return window.electronAPI?.addChannel(url)
  },
  async updateChannel(id: string, patch: object) {
    return window.electronAPI?.updateChannel(id, patch)
  },
  async removeChannel(id: string) {
    return window.electronAPI?.removeChannel(id)
  },
  async getWorkspaces() {
    return window.electronAPI?.getWorkspaces()
  },
  async updateWorkspace(id: string, patch: object) {
    return window.electronAPI?.updateWorkspace(id, patch)
  },
  async deleteWorkspace(id: string) {
    return window.electronAPI?.deleteWorkspace(id)
  },
  async retryWorkspace(id: string) {
    return window.electronAPI?.retryWorkspace(id)
  },
  async regenerateWorkspaceBlur(id: string) {
    return window.electronAPI?.regenerateWorkspaceBlur(id)
  },
  async splitWorkspace(id: string, partMinutes = 10) {
    return window.electronAPI?.splitWorkspace(id, partMinutes)
  },
  async getVideoFile(workspaceId: string) {
    return window.electronAPI?.getVideoFile(workspaceId) ?? null
  },
  async getVideoBlob(workspaceId: string): Promise<Uint8Array | null> {
    const result = await window.electronAPI?.getVideoBlob(workspaceId)
    return result ?? null
  },
  async getImageFile(workspaceId: string) {
    return window.electronAPI?.getImageFile(workspaceId) ?? null
  },
  async saveBlobToFile(arrayBuffer: Uint8Array, filename: string) {
    return window.electronAPI?.saveBlobToFile(arrayBuffer, filename) ?? null
  },
  async startRender(workspaceId: string, metadata: object) {
    return window.electronAPI?.startRender(workspaceId, metadata)
  },
  async cancelRender(workspaceId: string) {
    return window.electronAPI?.cancelRender(workspaceId)
  },
    async startChunked(workspaceId: string, metadata: object, config?: object) {
    return window.electronAPI?.startChunked(workspaceId, metadata, config)
  },
  async getSystemStats() {
    return window.electronAPI?.getSystemStats()
  },
  async openFolder(folderPath: string) {
    return window.electronAPI?.openFolder(folderPath)
  },
  async openUrl(url: string) {
    return window.electronAPI?.openUrl(url)
  },
  onSystemStats(callback: (stats: object) => void) {
    return window.electronAPI?.onSystemStats(callback) ?? (() => {})
  },
  onRenderProgress(callback: (progress: object) => void) {
    return window.electronAPI?.onRenderProgress(callback) ?? (() => {})
  },
  onNotification(callback: (n: object) => void) {
    return window.electronAPI?.onNotification(callback) ?? (() => {})
  },
  onWorkspaceUpdate(callback: (ws: object) => void) {
    return window.electronAPI?.onWorkspaceUpdate(callback) ?? (() => {})
  },
  onQuickAdd(callback: () => void) {
    return window.electronAPI?.onQuickAdd(callback) ?? (() => {})
  },
  onAutoDownload(callback: (data: object) => void) {
    return window.electronAPI?.onAutoDownload(callback) ?? (() => {})
  },
  onAuthUpdate(callback: (status: object) => void) {
    return window.electronAPI?.onAuthUpdate(callback) ?? (() => {})
  },
  onCookieCritical(callback: (errorMsg: string) => void) {
    return window.electronAPI?.onCookieCritical(callback) ?? (() => {})
  },
  onChannelSynced(callback: () => void) {
    return window.electronAPI?.onChannelSynced(callback) ?? (() => {})
  },
  async getSettings() {
    return window.electronAPI?.getSettings() ?? { videoStoragePath: undefined, outputPath: undefined, defaultTrimLimit: undefined, autoDownloadQuality: undefined }
  },
  async updateSettings(patch: { videoStoragePath?: string; outputPath?: string; defaultTrimLimit?: number | 'full'; autoDownloadQuality?: string }) {
    return window.electronAPI?.updateSettings(patch)
  },
  async getAuthStatus() {
    return window.electronAPI?.getAuthStatus() ?? { isReady: false, cookieCount: 0, loggedOut: true, accountName: '', oauthReady: false }
  },
  async logout() {
    return window.electronAPI?.logout() ?? { success: false }
  },
  async startOAuthFlow() {
    return window.electronAPI?.startOAuthFlow() ?? { isReady: false, cookieCount: 0, loggedOut: true, accountName: '', oauthReady: false }
  },
  async setOAuthCredentials(clientId: string, clientSecret: string) {
    return window.electronAPI?.setOAuthCredentials(clientId, clientSecret) ?? { success: false }
  },
  async getOAuthCredentials() {
    return window.electronAPI?.getOAuthCredentials() ?? { clientId: '', clientSecret: '' }
  },
  async getKeys(): Promise<KeyStatus[]> {
    const result = await window.electronAPI?.getKeys()
    return (result as KeyStatus[]) ?? []
  },
  async addKey(key: string, projectId: string, name: string): Promise<{ success: boolean; keys: unknown[]; error?: string; errorType?: string }> {
    return window.electronAPI?.addKey(key, projectId, name) ?? { success: false, keys: [], error: 'electronAPI not available' }
  },
  async removeKey(key: string) {
    return window.electronAPI?.removeKey(key) ?? { success: false, keys: [] }
  },
  async resetKey(key?: string) {
    return window.electronAPI?.resetKey(key) ?? { success: false, keys: [], nextReset: 0 }
  },
  async testKey(key: string) {
    return window.electronAPI?.testKey(key) ?? { valid: false, error: 'electronAPI not available', errorType: 'network_error' }
  },
  async testAllKeys() {
    return window.electronAPI?.testAllKeys() ?? { results: [], keys: [] }
  },
  async adminCheckPassword(password: string) {
    return window.electronAPI?.adminCheckPassword(password) ?? { ok: false }
  },
  async adminSetPassword(password: string) {
    return window.electronAPI?.adminSetPassword(password) ?? { success: false }
  },
  async adminHasPassword() {
    return window.electronAPI?.adminHasPassword() ?? { has: false }
  },
  async getPollerStatus(): Promise<{ active: boolean; lastPollAt: number | null; newVideoCount: number; lastError: string | null; exhaustedUntil: number | null } | null> {
    return window.electronAPI?.getPollerStatus() ?? null
  },
  async resumePoller() {
    return window.electronAPI?.resumePoller() ?? { success: false }
  },

  // ─── Project Management ──────────────────────────────────────────────────────

  async getProjects() {
    return window.electronAPI?.getProjects() ?? []
  },

  async addProject(data: { projectId: string; clientId: string; clientSecret: string; apiKey: string; apiKeyName?: string }) {
    return window.electronAPI?.addProject(data) ?? { success: false, error: 'electronAPI not available' }
  },

  async removeProject(projectId: string) {
    return window.electronAPI?.removeProject(projectId) ?? { success: false }
  },

  async resetProjectQuota(projectId: string) {
    return window.electronAPI?.resetProjectQuota(projectId) ?? { success: false, nextReset: 0, wasUnauthorized: false }
  },

  async reauthorizeProject(projectId: string) {
    return window.electronAPI?.reauthorizeProject(projectId) ?? { success: false, error: 'electronAPI not available' }
  },

  async testToken(projectId: string) {
    return window.electronAPI?.testToken(projectId) ?? { valid: false, error: 'electronAPI not available' }
  },

  // ─── Chrome Sessions ──────────────────────────────────────────────────────────

  async getSessionStatus() {
    return window.electronAPI?.getSessionStatus() ?? { ready: false, sessionCount: 0, loggedInCount: 0, sessions: [] }
  },

  async refreshAllSessions() {
    return window.electronAPI?.refreshAllSessions() ?? { success: false, refreshedCount: 0 }
  },

  async openSessionLogin(profileId: string) {
    return window.electronAPI?.openSessionLogin(profileId) ?? { success: false }
  },

  // ─── Rendered Videos ────────────────────────────────────────────────────────────

  async getRenderedVideos() {
    return window.electronAPI?.getRenderedVideos() ?? []
  },

  async archiveRendered(workspaceId: string, customArchiveDir?: string) {
    return window.electronAPI?.archiveRendered(workspaceId, customArchiveDir) ?? { success: false, error: 'electronAPI not available' }
  },

  async removeRenderedVideo(id: string) {
    return window.electronAPI?.removeRenderedVideo(id) ?? { success: false }
  },

  async openRenderedFolder(id?: string) {
    return window.electronAPI?.openRenderedFolder(id) ?? { success: false }
  },

  async setRenderedArchivePath(path: string) {
    return window.electronAPI?.setRenderedArchivePath(path) ?? { success: false }
  },

  // ─── Storage Management ───────────────────────────────────────────────────────

  async getStorageSize(): Promise<{ downloads: number; blur: number; total: number; downloadPath: string; outputPath: string }> {
    return window.electronAPI?.getStorageSize() ?? { downloads: 0, blur: 0, total: 0, downloadPath: '', outputPath: '' }
  },

  async clearDownloads(): Promise<{ success: boolean; freedMB: number }> {
    return window.electronAPI?.clearDownloads() ?? { success: false, freedMB: 0 }
  },

  async clearBlur(): Promise<{ success: boolean; freedMB: number }> {
    return window.electronAPI?.clearBlur() ?? { success: false, freedMB: 0 }
  },

  async pickFolder(currentPath?: string): Promise<{ path: string } | null> {
    return window.electronAPI?.pickFolder(currentPath) ?? null
  },
}