// IPC client wrapper for Electron
// Exposes window.electronAPI (from preload) to the renderer

import type { KeyStatus } from '../types'

export const ipc = {
  async addTracker(url: string, trimLimit: string) {
    return window.electronAPI?.addTracker(url, trimLimit)
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
  async getVideoFile(workspaceId: string) {
    return window.electronAPI?.getVideoFile(workspaceId) ?? null
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
    return window.electronAPI?.getSettings() ?? { videoStoragePath: undefined, outputPath: undefined }
  },
  async updateSettings(patch: { videoStoragePath?: string; outputPath?: string }) {
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
  async addKey(key: string, projectId: string, name: string) {
    return window.electronAPI?.addKey(key, projectId, name) ?? { success: false, keys: [] }
  },
  async removeKey(key: string) {
    return window.electronAPI?.removeKey(key) ?? { success: false, keys: [] }
  },
  async resetKey(key?: string) {
    return window.electronAPI?.resetKey(key) ?? { success: false, keys: [] }
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
  async getPollerStatus(): Promise<{ active: boolean; lastPollAt: number | null; newVideoCount: number; lastError: string | null } | null> {
    return window.electronAPI?.getPollerStatus() ?? null
  },
}