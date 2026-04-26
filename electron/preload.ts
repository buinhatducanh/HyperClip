const { contextBridge, ipcRenderer } = require('electron')

// IPC channels from main process
const IPC = {
  // Tracker
  TRACKER_ADD: 'tracker:add',
  TRACKER_REMOVE: 'tracker:remove',
  TRACKER_LIST: 'tracker:list',

  // Workspace
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_UPDATE_EVENT: 'workspace:update-event',

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

  // Poller
  POLLER_STATUS: 'poller:status',

  // Auth
  AUTH_STATUS: 'auth:status',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_OAUTH_SET_CREDS: 'auth:oauth-set-creds',
  AUTH_OAUTH_GET_CREDS: 'auth:oauth-get-creds',
  AUTH_UPDATE_EVENT: 'auth:update-event',
  CHANNEL_SYNCED_EVENT: 'channel:synced-event',
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
  updateWorkspace: (id: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.WORKSPACE_UPDATE, id, patch),
  deleteWorkspace: (id: string) =>
    ipcRenderer.invoke(IPC.WORKSPACE_DELETE, id),

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
  setOAuthCredentials: (clientId: string, clientSecret: string) =>
    ipcRenderer.invoke(IPC.AUTH_OAUTH_SET_CREDS, clientId, clientSecret) as Promise<{ success: boolean }>,
  getOAuthCredentials: () => ipcRenderer.invoke(IPC.AUTH_OAUTH_GET_CREDS) as Promise<{ clientId: string; clientSecret: string }>,

  // Auth events
  onAuthUpdate: (callback: (status: unknown) => void) => {
    const handler = (_: unknown, status: unknown) => callback(status)
    ipcRenderer.on(IPC.AUTH_UPDATE_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.AUTH_UPDATE_EVENT, handler)
  },
  onChannelSynced: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.CHANNEL_SYNCED_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.CHANNEL_SYNCED_EVENT, handler)
  },
})
