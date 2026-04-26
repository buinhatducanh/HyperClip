// IPC client wrapper for Electron
// Exposes window.electronAPI (from preload) to the renderer

export interface ChunkedResult {
  success: boolean
  workspaceId: string
  outputPath?: string
  fileSize?: number
  duration?: number
  error?: string
  chunks: Array<{
    index: number
    start: number
    end: number
    outputPath: string
    fileSize: number
    encodeMs: number
  }>
  totalEncodeMs: number
}

export interface ElectronAPI {
  addTracker: (url: string, trimLimit: string) => Promise<unknown>
  removeTracker: (id: string) => Promise<unknown>
  getTrackers: () => Promise<unknown[]>
  getChannelInfo: (url: string) => Promise<unknown>
  getChannels: () => Promise<unknown[]>
  addChannel: (url: string) => Promise<unknown>
  updateChannel: (id: string, patch: object) => Promise<unknown>
  removeChannel: (id: string) => Promise<unknown>
  getWorkspaces: () => Promise<unknown[]>
  updateWorkspace: (id: string, patch: object) => Promise<unknown>
  deleteWorkspace: (id: string) => Promise<unknown>
  startRender: (workspaceId: string, metadata: object) => Promise<unknown>
  startChunked: (workspaceId: string, metadata: object, config?: object) => Promise<ChunkedResult | null>
  cancelRender: (workspaceId: string) => Promise<unknown>
  getSystemStats: () => Promise<unknown>
  openFolder: (folderPath: string) => Promise<unknown>
  onSystemStats: (callback: (stats: object) => void) => () => void
  onRenderProgress: (callback: (progress: object) => void) => () => void
  onNotification: (callback: (n: object) => void) => () => void
  onWorkspaceUpdate: (callback: (ws: object) => void) => () => void
  onQuickAdd: (callback: () => void) => () => void
  onAutoDownload: (callback: (data: object) => void) => () => void
  onAuthUpdate: (callback: (status: object) => void) => () => void
  getSettings: () => Promise<{ videoStoragePath?: string; outputPath?: string }>
  updateSettings: (patch: { videoStoragePath?: string; outputPath?: string }) => Promise<void>
  getAuthStatus: () => Promise<{ isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady: boolean }>
  logout: () => Promise<{ success: boolean }>
  setOAuthCredentials: (clientId: string, clientSecret: string) => Promise<{ success: boolean }>
  getOAuthCredentials: () => Promise<{ clientId: string; clientSecret: string }>
}

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
  async setOAuthCredentials(clientId: string, clientSecret: string) {
    return window.electronAPI?.setOAuthCredentials(clientId, clientSecret) ?? { success: false }
  },
  async getOAuthCredentials() {
    return window.electronAPI?.getOAuthCredentials() ?? { clientId: '', clientSecret: '' }
  },
}