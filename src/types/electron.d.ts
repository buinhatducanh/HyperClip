// Type declarations for Electron IPC API exposed via preload

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
  onAutoDownload: (callback: (data: unknown) => void) => () => void
  getSettings: () => Promise<{ videoStoragePath?: string; outputPath?: string }>
  updateSettings: (patch: { videoStoragePath?: string; outputPath?: string }) => Promise<void>
  getAuthStatus: () => Promise<{ isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady: boolean }>
  logout: () => Promise<{ success: boolean }>
  setOAuthCredentials: (clientId: string, clientSecret: string) => Promise<{ success: boolean }>
  getOAuthCredentials: () => Promise<{ clientId: string; clientSecret: string }>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
