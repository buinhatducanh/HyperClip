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
  syncChannels: () => Promise<{ added: number; removed: number }>
  addChannel: (url: string) => Promise<unknown>
  updateChannel: (id: string, patch: object) => Promise<unknown>
  removeChannel: (id: string) => Promise<unknown>
  getWorkspaces: () => Promise<unknown[]>
  updateWorkspace: (id: string, patch: object) => Promise<unknown>
  deleteWorkspace: (id: string) => Promise<unknown>
  retryWorkspace: (id: string) => Promise<unknown>
  regenerateWorkspaceBlur: (id: string) => Promise<{ success: boolean; blurPath?: string; error?: string }>
  splitWorkspace: (id: string, partMinutes?: number) => Promise<{ success: boolean; newWorkspaces?: unknown[]; error?: string }>
  getVideoFile: (workspaceId: string) => Promise<{ path: string; url: string } | null>
  getVideoBlob: (workspaceId: string) => Promise<Uint8Array | null>
  getImageFile: (workspaceId: string) => Promise<{ path: string; dataUrl: string } | null>
  saveBlobToFile: (arrayBuffer: Uint8Array, filename: string) => Promise<{ diskPath: string } | null>
  startRender: (workspaceId: string, metadata: object) => Promise<unknown>
  startChunked: (workspaceId: string, metadata: object, config?: object) => Promise<ChunkedResult | null>
  cancelRender: (workspaceId: string) => Promise<unknown>
  getSystemStats: () => Promise<unknown>
  openFolder: (folderPath: string) => Promise<unknown>
  openUrl: (url: string) => Promise<unknown>
  onSystemStats: (callback: (stats: object) => void) => () => void
  onRenderProgress: (callback: (progress: object) => void) => () => void
  onNotification: (callback: (n: object) => void) => () => void
  onWorkspaceUpdate: (callback: (ws: object) => void) => () => void
  onQuickAdd: (callback: () => void) => () => void
  onAutoDownload: (callback: (data: unknown) => void) => () => void
  onAuthUpdate: (callback: (status: unknown) => void) => () => void
  onChannelSynced: (callback: () => void) => () => void
  getSettings: () => Promise<{ videoStoragePath?: string; outputPath?: string; defaultTrimLimit?: number | 'full'; autoDownloadQuality?: string }>
  updateSettings: (patch: { videoStoragePath?: string; outputPath?: string; defaultTrimLimit?: number | 'full'; autoDownloadQuality?: string }) => Promise<void>
  getAuthStatus: () => Promise<{
    isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady: boolean
    cookieCritical?: boolean; cookieError?: string
  }>
  onCookieCritical: (callback: (errorMsg: string) => void) => () => void
  logout: () => Promise<{ success: boolean }>
  startOAuthFlow: () => Promise<{ isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady: boolean }>
  setOAuthCredentials: (clientId: string, clientSecret: string) => Promise<{ success: boolean }>
  getOAuthCredentials: () => Promise<{ clientId: string; clientSecret: string }>
  getKeys: () => Promise<unknown[]>
  addKey: (key: string, projectId: string, name: string) => Promise<{ success: boolean; keys: unknown[] }>
  removeKey: (key: string) => Promise<{ success: boolean; keys: unknown[] }>
  resetKey: (key?: string) => Promise<{ success: boolean; keys: unknown[]; nextReset: number }>
  testKey: (key: string) => Promise<{ valid: boolean; error?: string; errorType?: string }>
  testAllKeys: () => Promise<{
    results: Array<{ key: string; name: string; valid: boolean; error?: string; errorType?: string }>
    keys: unknown[]
  }>
  adminCheckPassword: (password: string) => Promise<{ ok: boolean }>
  adminSetPassword: (password: string) => Promise<{ success: boolean }>
  adminHasPassword: () => Promise<{ has: boolean }>
  getPollerStatus: () => Promise<{
    active: boolean; pollIntervalMs: number; lastPollAt: number | null
    lastNewVideosAt: number | null; cookiesReady: boolean
    videoCount: number; newVideoCount: number; lastError: string | null
    exhaustedUntil: number | null
  } | null>
  resumePoller: () => Promise<{ success: boolean }>
  // Project management
  getProjects: () => Promise<unknown[]>
  addProject: (data: { projectId: string; clientId: string; clientSecret: string; apiKey: string; apiKeyName?: string }) => Promise<{ success: boolean; projectId: string; error?: string }>
  removeProject: (projectId: string) => Promise<{ success: boolean }>
  resetProjectQuota: (projectId: string) => Promise<{ success: boolean }>
  reauthorizeProject: (projectId: string) => Promise<{ success: boolean; error?: string }>
  testToken: (projectId: string) => Promise<{ valid: boolean; error?: string; errorType?: string }>
  // Chrome session management (Innertube API)
  getSessionStatus: () => Promise<unknown>
  refreshAllSessions: () => Promise<{ success: boolean; refreshedCount: number }>
  openSessionLogin: (profileId: string) => Promise<{ success: boolean }>
  // Rendered videos
  getRenderedVideos: () => Promise<unknown[]>
  archiveRendered: (workspaceId: string, customArchiveDir?: string) => Promise<{ success: boolean; archivedPath?: string; error?: string }>
  removeRenderedVideo: (id: string) => Promise<{ success: boolean }>
  openRenderedFolder: (id?: string) => Promise<{ success: boolean }>
  setRenderedArchivePath: (path: string) => Promise<{ success: boolean }>
  // Storage management
  getStorageSize: () => Promise<{ downloads: number; blur: number; total: number; downloadPath: string; outputPath: string }>
  clearDownloads: () => Promise<{ success: boolean; freedMB: number }>
  clearBlur: () => Promise<{ success: boolean; freedMB: number }>
  pickFolder: (currentPath?: string) => Promise<{ path: string } | null>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
