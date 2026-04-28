const { contextBridge, ipcRenderer } = require('electron')

// IPC channels from main process
const IPC = {
  // Video file serving
  VIDEO_FILE: 'video:file',
  VIDEO_BLOB: 'video:blob',
  // Image file serving (local thumbnails extracted from downloaded videos)
  IMAGE_FILE: 'image:file',
  // Blob URL → disk path (for FFmpeg to read images)
  BLOB_SAVE: 'blob:save',

  // Tracker
  TRACKER_ADD: 'tracker:add',
  TRACKER_REMOVE: 'tracker:remove',
  TRACKER_LIST: 'tracker:list',

  // Workspace
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_ADD: 'workspace:add',
  WORKSPACE_UPDATE_EVENT: 'workspace:update-event',
  WORKSPACE_RETRY: 'workspace:retry',

  // Render
  RENDER_START: 'render:start',
  RENDER_CANCEL: 'render:cancel',
  RENDER_CHUNKED: 'render:chunked',
  RENDER_PROGRESS_EVENT: 'render:progress-event',

  // System
  SYSTEM_STATS: 'system:stats',
  SYSTEM_STATS_EVENT: 'system:stats-update',
  SYSTEM_OPEN_FOLDER: 'system:openFolder',
  SYSTEM_OPEN_URL: 'system:openUrl',

  // Notification
  NOTIFICATION_EVENT: 'notification',

  // Auto-download
  AUTO_DOWNLOAD_EVENT: 'autodownload',

  // Channel
  CHANNEL_INFO: 'channel:info',
  CHANNEL_LIST: 'channel:list',
  CHANNEL_ADD: 'channel:add',
  CHANNEL_UPDATE: 'channel:update',
  CHANNEL_REMOVE: 'channel:remove',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // WebSub
  WEBSUB_TEST: 'websub:test',

  // Keys
  KEY_LIST: 'key:list',
  KEY_ADD: 'key:add',
  KEY_REMOVE: 'key:remove',
  KEY_RESET: 'key:reset',

  // Admin password
  ADMIN_CHECK_PASSWORD: 'admin:check-password',
  ADMIN_SET_PASSWORD: 'admin:set-password',
  ADMIN_HAS_PASSWORD: 'admin:has-password',

  // Poller
  POLLER_STATUS: 'poller:status',

  // Auth
  AUTH_STATUS: 'auth:status',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_OAUTH_START: 'auth:oauth-start',
  AUTH_OAUTH_SET_CREDS: 'auth:oauth-set-creds',
  AUTH_OAUTH_GET_CREDS: 'auth:oauth-get-creds',
  AUTH_UPDATE_EVENT: 'auth:update-event',
  AUTH_COOKIE_CRITICAL: 'auth:cookie-critical',
  CHANNEL_SYNCED_EVENT: 'channel:synced-event',

  // Per-project OAuth
  AUTH_OAUTH_START_PER_PROJECT: 'auth:oauth-start-per-project',
    TOKEN_STATUS_LIST: 'token:status-list',
  TOKEN_REMOVE: 'token:remove',
  TOKEN_GET_DEFAULT_CREDS: 'token:get-default-creds',
}

contextBridge.exposeInMainWorld('electronAPI', {
  // YouTube tracking
  addTracker: (url: string, trimLimit: string) =>
    ipcRenderer.invoke(IPC.TRACKER_ADD, url, trimLimit),
  removeTracker: (channelId: string) =>
    ipcRenderer.invoke(IPC.TRACKER_REMOVE, channelId),
  getTrackers: () => ipcRenderer.invoke(IPC.TRACKER_LIST),

  // Channel
  getChannelInfo: (url: string) => ipcRenderer.invoke(IPC.CHANNEL_INFO, url),
  getChannels: () => ipcRenderer.invoke(IPC.CHANNEL_LIST),
  addChannel: (url: string) => ipcRenderer.invoke(IPC.CHANNEL_ADD, url),
  updateChannel: (id: string, patch: object) => ipcRenderer.invoke(IPC.CHANNEL_UPDATE, id, patch),
  removeChannel: (id: string) => ipcRenderer.invoke(IPC.CHANNEL_REMOVE, id),

  // Workspaces
  getWorkspaces: () => ipcRenderer.invoke(IPC.WORKSPACE_LIST),
  getVideoFile: (workspaceId: string) =>
    ipcRenderer.invoke(IPC.VIDEO_FILE, workspaceId) as Promise<{ path: string; url: string } | null>,
  getVideoBlob: (workspaceId: string) =>
    ipcRenderer.invoke(IPC.VIDEO_BLOB, workspaceId) as Promise<Uint8Array | null>,
  getImageFile: (workspaceId: string) =>
    ipcRenderer.invoke(IPC.IMAGE_FILE, workspaceId) as Promise<{ path: string; dataUrl: string } | null>,
  saveBlobToFile: (arrayBuffer: Uint8Array, filename: string) =>
    ipcRenderer.invoke(IPC.BLOB_SAVE, arrayBuffer, filename) as Promise<{ diskPath: string } | null>,
  updateWorkspace: (id: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.WORKSPACE_UPDATE, id, patch),
  deleteWorkspace: (id: string) =>
    ipcRenderer.invoke(IPC.WORKSPACE_DELETE, id),
  retryWorkspace: (id: string) =>
    ipcRenderer.invoke(IPC.WORKSPACE_RETRY, id),

  // Rendering
  startRender: (workspaceId: string, metadata: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.RENDER_START, workspaceId, metadata),
  cancelRender: (workspaceId: string) =>
    ipcRenderer.invoke(IPC.RENDER_CANCEL, workspaceId),
  startChunked: (workspaceId: string, metadata: Record<string, unknown>, config?: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.RENDER_CHUNKED, workspaceId, metadata, config),

  // System
  getSystemStats: () => ipcRenderer.invoke(IPC.SYSTEM_STATS),
  openFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC.SYSTEM_OPEN_FOLDER, folderPath),
  openUrl: (url: string) =>
    ipcRenderer.invoke(IPC.SYSTEM_OPEN_URL, url),

  // Events (renderer listens — return cleanup functions)
  onSystemStats: (callback: (stats: unknown) => void) => {
    const handler = (_: unknown, stats: unknown) => callback(stats)
    ipcRenderer.on(IPC.SYSTEM_STATS_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.SYSTEM_STATS_EVENT, handler)
  },
  onRenderProgress: (callback: (progress: unknown) => void) => {
    const handler = (_: unknown, progress: unknown) => callback(progress)
    ipcRenderer.on(IPC.RENDER_PROGRESS_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.RENDER_PROGRESS_EVENT, handler)
  },
  onNotification: (callback: (n: unknown) => void) => {
    const handler = (_: unknown, n: unknown) => callback(n)
    ipcRenderer.on(IPC.NOTIFICATION_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.NOTIFICATION_EVENT, handler)
  },
  onWorkspaceUpdate: (callback: (ws: unknown) => void) => {
    const handler = (_: unknown, ws: unknown) => callback(ws)
    ipcRenderer.on(IPC.WORKSPACE_UPDATE_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.WORKSPACE_UPDATE_EVENT, handler)
  },
  onQuickAdd: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('quick-add', handler)
    return () => ipcRenderer.removeListener('quick-add', handler)
  },

  // Auto-download from WebSub
  onAutoDownload: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.AUTO_DOWNLOAD_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.AUTO_DOWNLOAD_EVENT, handler)
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  updateSettings: (patch: { videoStoragePath?: string; outputPath?: string }) =>
    ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch),

  // WebSub diagnostics
  testWebSub: () => ipcRenderer.invoke(IPC.WEBSUB_TEST) as Promise<{ results: string[]; tunnelUrl: string; subscriptions: unknown[] }>,

  // Poller status
  getPollerStatus: () => ipcRenderer.invoke(IPC.POLLER_STATUS) as Promise<{
    active: boolean
    pollIntervalMs: number
    lastPollAt: number | null
    lastNewVideosAt: number | null
    cookiesReady: boolean
    cookiesFrom: string
    videoCount: number
    newVideoCount: number
    lastError: string | null
  } | null>,

  // Auth
  getAuthStatus: () => ipcRenderer.invoke(IPC.AUTH_STATUS) as Promise<{
    isReady: boolean
    cookieCount: number
    loggedOut: boolean
    accountName: string
    oauthReady: boolean
  }>,
  logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT) as Promise<{ success: boolean }>,
  startOAuthFlow: () => ipcRenderer.invoke(IPC.AUTH_OAUTH_START) as Promise<{
    isReady: boolean
    cookieCount: number
    loggedOut: boolean
    accountName: string
    oauthReady: boolean
  }>,
  setOAuthCredentials: (clientId: string, clientSecret: string) =>
    ipcRenderer.invoke(IPC.AUTH_OAUTH_SET_CREDS, clientId, clientSecret) as Promise<{ success: boolean }>,
  getOAuthCredentials: () => ipcRenderer.invoke(IPC.AUTH_OAUTH_GET_CREDS) as Promise<{ clientId: string; clientSecret: string }>,

  // Per-project OAuth tokens
  startOAuthFlowPerProject: (clientId: string, clientSecret: string, projectId: string) =>
    ipcRenderer.invoke(IPC.AUTH_OAUTH_START_PER_PROJECT, clientId, clientSecret, projectId) as Promise<{ success: boolean; error?: string }>,
  getTokenStatuses: () => ipcRenderer.invoke(IPC.TOKEN_STATUS_LIST) as Promise<unknown[]>,
  removeToken: (projectId: string) =>
    ipcRenderer.invoke(IPC.TOKEN_REMOVE, projectId) as Promise<{ success: boolean }>,
  getDefaultOAuthCredentials: () =>
    ipcRenderer.invoke(IPC.TOKEN_GET_DEFAULT_CREDS) as Promise<Record<string, { clientId: string; clientSecret: string }>>,

  // Auth events
  onAuthUpdate: (callback: (status: unknown) => void) => {
    const handler = (_: unknown, status: unknown) => callback(status)
    ipcRenderer.on(IPC.AUTH_UPDATE_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.AUTH_UPDATE_EVENT, handler)
  },
  onCookieCritical: (callback: (errorMsg: string) => void) => {
    const handler = (_: unknown, msg: string) => callback(msg)
    ipcRenderer.on(IPC.AUTH_COOKIE_CRITICAL, handler)
    return () => ipcRenderer.removeListener(IPC.AUTH_COOKIE_CRITICAL, handler)
  },
  onChannelSynced: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.CHANNEL_SYNCED_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.CHANNEL_SYNCED_EVENT, handler)
  },

  // Keys
  getKeys: () => ipcRenderer.invoke(IPC.KEY_LIST),
  addKey: (key: string, projectId: string, name: string) =>
    ipcRenderer.invoke(IPC.KEY_ADD, key, projectId, name) as Promise<{ success: boolean; keys: unknown[] }>,
  removeKey: (key: string) =>
    ipcRenderer.invoke(IPC.KEY_REMOVE, key) as Promise<{ success: boolean; keys: unknown[] }>,
  resetKey: (key?: string) =>
    ipcRenderer.invoke(IPC.KEY_RESET, key) as Promise<{ success: boolean; keys: unknown[] }>,

  // Admin password
  adminCheckPassword: (password: string) =>
    ipcRenderer.invoke(IPC.ADMIN_CHECK_PASSWORD, password) as Promise<{ ok: boolean }>,
  adminSetPassword: (password: string) =>
    ipcRenderer.invoke(IPC.ADMIN_SET_PASSWORD, password) as Promise<{ success: boolean }>,
  adminHasPassword: () =>
    ipcRenderer.invoke(IPC.ADMIN_HAS_PASSWORD) as Promise<{ has: boolean }>,
})
