// IPC client wrapper for Electron
// Exposes window.electronAPI (from preload) to the renderer

import type { KeyStatus } from '../types'

// Explicit type to ensure TypeScript resolves ElectronAPI from electron.d.ts
type ElectronAPI = {
  addTracker: (url: string, trimLimit: string) => Promise<unknown>
  removeTracker: (id: string) => Promise<unknown>
  getTrackers: () => Promise<unknown[]>
  getChannelInfo: (url: string) => Promise<unknown>
  getChannels: () => Promise<unknown[]>
  syncChannels: () => Promise<{ added: number; removed: number }>
  addChannel: (url: string) => Promise<unknown>
  updateChannel: (id: string, patch: object) => Promise<unknown>
  removeChannel: (id: string) => Promise<unknown>
  getWorkspaces: () => Promise<unknown[]>
  updateWorkspace: (id: string, patch: object) => Promise<unknown>
  deleteWorkspace: (id: string) => Promise<unknown>
  retryWorkspace: (id: string) => Promise<unknown>
  redownloadHd: (id: string) => Promise<{ success: boolean; error?: string }>
  regenerateWorkspaceBlur: (id: string) => Promise<{ success: boolean; blurPath?: string; error?: string }>
  splitWorkspace: (id: string, partMinutes?: number) => Promise<{ success: boolean; newWorkspaces?: unknown[]; error?: string }>
  setActiveWorkspace: (workspaceId: string | null) => Promise<{ success: boolean }>
  getVideoFile: (workspaceId: string) => Promise<{ path: string; url: string } | null>
  getVideoBlob: (workspaceId: string) => Promise<Uint8Array | null>
  getImageFile: (workspaceId: string) => Promise<{ path: string; dataUrl: string } | null>
  saveBlobToFile: (arrayBuffer: Uint8Array, filename: string) => Promise<{ diskPath: string } | null>
  startRender: (workspaceId: string, metadata: object) => Promise<unknown>
  startChunked: (workspaceId: string, metadata: object, config?: object) => Promise<unknown>
  cancelRender: (workspaceId: string) => Promise<unknown>
  getSystemStats: () => Promise<unknown>
  openFolder: (folderPath: string) => Promise<unknown>
  openUrl: (url: string) => Promise<unknown>
  onSystemStats: (callback: (stats: object) => void) => () => void
  onRenderProgress: (callback: (progress: object) => void) => () => void
  onNotification: (callback: (n: object) => void) => () => void
  onWorkspaceUpdate: (callback: (ws: object) => void) => () => void
  onQuickAdd: (callback: () => void) => () => void
  onAutoDownload: (callback: (data: object) => void) => () => void
  onInnertubeDegraded: (callback: (data: { degraded: boolean }) => void) => () => void
  onAuthUpdate: (callback: (status: object) => void) => () => void
  onCookieCritical: (callback: (errorMsg: string) => void) => () => void
  onChannelSynced: (callback: () => void) => () => void
  getSettings: () => Promise<{ videoStoragePath?: string; outputPath?: string; defaultTrimLimit?: number | 'full'; defaultQuality?: 1080 | 720; autoDownloadQuality?: string; autoDownloadEnabled?: boolean; autoRender?: boolean; autoRenderResolution?: string; autoRenderFPS?: number; downloadsCleanupDays?: number; renderedOutputPath?: string; pollIntervalMs?: number; maxConcurrentRenders?: number }>
  updateSettings: (patch: { videoStoragePath?: string; outputPath?: string; defaultTrimLimit?: number | 'full'; defaultQuality?: 1080 | 720; autoDownloadQuality?: string; autoDownloadEnabled?: boolean; autoRender?: boolean; autoRenderResolution?: string; autoRenderFPS?: number; downloadsCleanupDays?: number; renderedOutputPath?: string; pollIntervalMs?: number; maxConcurrentRenders?: number }) => Promise<void>
  getAuthStatus: () => Promise<{ isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady: boolean; cookieCritical?: boolean; cookieError?: string }>
  logout: () => Promise<{ success: boolean }>
  startOAuthFlow: () => Promise<{ isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady: boolean }>
  setOAuthCredentials: (clientId: string, clientSecret: string) => Promise<{ success: boolean }>
  getOAuthCredentials: () => Promise<{ clientId: string; clientSecret: string }>
  getKeys: () => Promise<unknown[]>
  addKey: (key: string, projectId: string, name: string) => Promise<{ success: boolean; keys: unknown[] }>
  removeKey: (key: string) => Promise<{ success: boolean; keys: unknown[] }>
  resetKey: (key?: string) => Promise<{ success: boolean; keys: unknown[]; nextReset: number }>
  testKey: (key: string) => Promise<{ valid: boolean; error?: string; errorType?: string }>
  testAllKeys: () => Promise<{ results: Array<{ key: string; name: string; valid: boolean; error?: string; errorType?: string }>; keys: unknown[] }>
  getPollerStatus: () => Promise<{ active: boolean; lastPollAt: number | null; newVideoCount: number; lastError: string | null; exhaustedUntil: number | null; innertubeDegraded?: boolean } | null>
  resumePoller: () => Promise<{ success: boolean }>
  getProjects: () => Promise<unknown[]>
  addProject: (data: { projectId: string; clientId: string; clientSecret: string; apiKey: string; apiKeyName?: string }) => Promise<{ success: boolean; projectId: string; error?: string }>
  removeProject: (projectId: string) => Promise<{ success: boolean }>
  resetProjectQuota: (projectId: string) => Promise<{ success: boolean }>
  reauthorizeProject: (projectId: string) => Promise<{ success: boolean; error?: string; refreshed?: boolean }>
  repairProject: (projectId: string) => Promise<{ success: boolean; error?: string; repaired?: boolean; refreshed?: boolean; needsCredentials?: boolean; needsOAuthFlow?: boolean }>
  testAllProjects: () => Promise<{ projects: unknown[]; checkedAt: number }>
  batchRepairProjects: (projectIds: string[]) => Promise<Record<string, { success: boolean; error?: string; repaired?: boolean; refreshed?: boolean; needsCredentials?: boolean; needsOAuthFlow?: boolean }>>
  testToken: (projectId: string) => Promise<{ valid: boolean; error?: string; errorType?: string }>
  getSessionStatus: () => Promise<unknown>
  refreshAllSessions: () => Promise<{ success: boolean; refreshedCount: number }>
  openSessionLogin: (profileId: string) => Promise<{ success: boolean }>
  cloneSessionOne: () => Promise<{ success: boolean; clonedCount: number; error?: string }>
  getRenderedVideos: () => Promise<unknown[]>
  archiveRendered: (workspaceId: string, customArchiveDir?: string) => Promise<{ success: boolean; archivedPath?: string; error?: string }>
  removeRenderedVideo: (id: string) => Promise<{ success: boolean }>
  openRenderedFolder: (id?: string) => Promise<{ success: boolean }>
  setRenderedArchivePath: (path: string) => Promise<{ success: boolean }>
  getStorageSize: () => Promise<{ downloads: number; blur: number; total: number; downloadPath: string; outputPath: string; freeBytes?: number }>
  clearDownloads: () => Promise<{ success: boolean; freedMB: number }>
  clearBlur: () => Promise<{ success: boolean; freedMB: number }>
  pickFolder: (currentPath?: string) => Promise<{ path: string } | null>
  runDiagnostics: () => Promise<unknown>
  exportData: () => Promise<{ success: boolean; path?: string; error?: string }>
  importData: () => Promise<{ success: boolean; channelsImported?: number; seenImported?: number; error?: string }>
  readLogs: () => Promise<{ files: { name: string; size: number; mtime: number; content?: string }[]; logDir: string }>
  exportLogs: () => Promise<{ success: boolean; path?: string; error?: string }>
}

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
  async redownloadHd(id: string) {
    return window.electronAPI?.redownloadHd(id)
  },
  async regenerateWorkspaceBlur(id: string) {
    return window.electronAPI?.regenerateWorkspaceBlur(id)
  },
  async splitWorkspace(id: string, partMinutes = 10) {
    return window.electronAPI?.splitWorkspace(id, partMinutes)
  },
  async setActiveWorkspace(workspaceId: string | null) {
    return window.electronAPI?.setActiveWorkspace(workspaceId)
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
  onInnertubeDegraded(callback: (data: { degraded: boolean }) => void) {
    return window.electronAPI?.onInnertubeDegraded(callback) ?? (() => {})
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
    return window.electronAPI?.getSettings() ?? { videoStoragePath: undefined, outputPath: undefined, defaultTrimLimit: undefined, defaultQuality: undefined, autoDownloadQuality: undefined, autoDownloadEnabled: undefined, autoRender: undefined, autoRenderResolution: undefined, autoRenderFPS: undefined, downloadsCleanupDays: undefined, renderedOutputPath: undefined, pollIntervalMs: undefined, maxConcurrentRenders: undefined }
  },
  async updateSettings(patch: { videoStoragePath?: string; outputPath?: string; defaultTrimLimit?: number | 'full'; defaultQuality?: 1080 | 720; autoDownloadQuality?: string; autoDownloadEnabled?: boolean; autoRender?: boolean; autoRenderResolution?: string; autoRenderFPS?: number; downloadsCleanupDays?: number; renderedOutputPath?: string; pollIntervalMs?: number; maxConcurrentRenders?: number }) {
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
  async getPollerStatus(): Promise<{ active: boolean; lastPollAt: number | null; newVideoCount: number; lastError: string | null; exhaustedUntil: number | null; innertubeDegraded?: boolean } | null> {
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

  async repairProject(projectId: string) {
    return window.electronAPI?.repairProject(projectId) ?? { success: false, error: 'electronAPI not available' }
  },

  async testAllProjects() {
    return window.electronAPI?.testAllProjects() ?? { projects: [], checkedAt: 0 }
  },

  async batchRepairProjects(projectIds: string[]) {
    return window.electronAPI?.batchRepairProjects(projectIds) ?? {}
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

  async cloneSessionOne() {
    return window.electronAPI?.cloneSessionOne() ?? { success: false, clonedCount: 0, error: 'electronAPI not available' }
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

  // ─── Log Export ──────────────────────────────────────────────────────────────
  async readLogs(): Promise<{ files: { name: string; size: number; mtime: number; content?: string }[]; logDir: string }> {
    return window.electronAPI?.readLogs() ?? { files: [], logDir: '' }
  },

  async exportLogs(): Promise<{ success: boolean; path?: string; error?: string }> {
    return window.electronAPI?.exportLogs() ?? { success: false, error: 'electronAPI not available' }
  },
}