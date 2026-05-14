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
  WORKSPACE_REDOWNLOAD_HD: 'workspace:redownload-hd',
  WORKSPACE_REGENERATE_BLUR: 'workspace:regenerate-blur',
  WORKSPACE_SPLIT: 'workspace:split',
  WORKSPACE_SET_ACTIVE: 'workspace:set-active',

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
  CHANNEL_SYNC: 'channel:sync',
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
  KEY_TEST: 'key:test',
  KEY_TEST_ALL: 'key:test-all',

  // Dynamic projects
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_RESET_QUOTA: 'project:reset-quota',
  PROJECT_REAUTHORIZE: 'project:reauthorize',
  PROJECT_REPAIR: 'project:repair',
  PROJECT_TEST_ALL: 'project:test-all',
  PROJECT_BATCH_REPAIR: 'project:batch-repair',
  PROJECT_AUTO_ASSIGN: 'project:auto-assign',

  // Chrome sessions (Innertube API)
  SESSION_LIST: 'session:list',
  SESSION_REFRESH_ALL: 'session:refresh-all',
  SESSION_OPEN_LOGIN: 'session:open-login',
  SESSION_CLONE_ONE: 'session:clone-one',

  // Poller
  POLLER_STATUS: 'poller:status',
  POLLER_RESUME: 'poller:resume',

  // Innertube degraded state
  INNERTUBE_DEGRADED_EVENT: 'innertube:degraded',

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
  TOKEN_TEST: 'token:test',
  TOKEN_REMOVE: 'token:remove',
  TOKEN_GET_DEFAULT_CREDS: 'token:get-default-creds',

  // Rendered videos
  RENDERED_LIST: 'rendered:list',
  RENDERED_ARCHIVE: 'rendered:archive',
  RENDERED_REMOVE: 'rendered:remove',
  RENDERED_OPEN_FOLDER: 'rendered:openFolder',
  RENDERED_SET_ARCHIVE_PATH: 'rendered:setArchivePath',

  // Storage management
  STORAGE_GET_SIZE: 'storage:get-size',
  STORAGE_CLEAR_DOWNLOADS: 'storage:clear-downloads',
  STORAGE_CLEAR_BLUR: 'storage:clear-blur',
  STORAGE_PICK_FOLDER: 'storage:pick-folder',

  // System diagnostics
  DIAGNOSTICS_RUN: 'diagnostics:run',

  // Data portability
  DATA_EXPORT: 'data:export',
  DATA_IMPORT: 'data:import',

  // MMO Operation Center
  OPERATION_LOGS_READ: 'operation:logs-read',
  OPERATION_LOGS_CLEAR: 'operation:logs-clear',
  POLLER_PAUSE: 'poller:pause',
  CHANNEL_BULK_ADD: 'channel:bulk-add',
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
  syncChannels: () => ipcRenderer.invoke(IPC.CHANNEL_SYNC),
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
  redownloadHd: (id: string) =>
    ipcRenderer.invoke(IPC.WORKSPACE_REDOWNLOAD_HD, id) as Promise<{ success: boolean; error?: string }>,
  regenerateWorkspaceBlur: (id: string) =>
    ipcRenderer.invoke(IPC.WORKSPACE_REGENERATE_BLUR, id) as Promise<{ success: boolean; blurPath?: string; error?: string }>,
  splitWorkspace: (id: string, partMinutes: number) =>
    ipcRenderer.invoke(IPC.WORKSPACE_SPLIT, id, partMinutes) as Promise<{ success: boolean; newWorkspaces?: any[]; error?: string }>,
  setActiveWorkspace: (workspaceId: string | null) =>
    ipcRenderer.invoke(IPC.WORKSPACE_SET_ACTIVE, workspaceId) as Promise<{ success: boolean }>,

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

  // Innertube degraded state
  onInnertubeDegraded: (callback: (data: { degraded: boolean; consecutiveZero: number }) => void) => {
    const handler = (_: unknown, data: { degraded: boolean; consecutiveZero: number }) => callback(data)
    ipcRenderer.on(IPC.INNERTUBE_DEGRADED_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.INNERTUBE_DEGRADED_EVENT, handler)
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  updateSettings: (patch: { videoStoragePath?: string; outputPath?: string; defaultTrimLimit?: number | 'full'; autoDownloadQuality?: string; autoRender?: boolean; autoRenderResolution?: string; autoRenderFPS?: number; downloadsCleanupDays?: number; renderedOutputPath?: string; maxConcurrentRenders?: number }) =>
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
    exhaustedUntil: number | null
    innertubeDegraded?: boolean
  } | null>,
  resumePoller: () => ipcRenderer.invoke(IPC.POLLER_RESUME) as Promise<{ success: boolean }>,

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
  testToken: (projectId: string) =>
    ipcRenderer.invoke(IPC.TOKEN_TEST, projectId) as Promise<{ valid: boolean; error?: string; errorType?: string }>,
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
  testKey: (key: string) =>
    ipcRenderer.invoke(IPC.KEY_TEST, key) as Promise<{ valid: boolean; error?: string; errorType?: string }>,
  testAllKeys: () =>
    ipcRenderer.invoke(IPC.KEY_TEST_ALL) as Promise<{
      results: Array<{ key: string; name: string; valid: boolean; error?: string; errorType?: string }>
      keys: unknown[]
    }>,

  // Dynamic projects
  getProjects: () =>
    ipcRenderer.invoke(IPC.PROJECT_LIST) as Promise<unknown[]>,
  addProject: (data: { projectId: string; clientId: string; clientSecret: string; apiKey: string; apiKeyName?: string }) =>
    ipcRenderer.invoke(IPC.PROJECT_ADD, data) as Promise<{ success: boolean; projectId: string; error?: string }>,
  removeProject: (projectId: string) =>
    ipcRenderer.invoke(IPC.PROJECT_REMOVE, projectId) as Promise<{ success: boolean }>,
  resetProjectQuota: (projectId: string) =>
    ipcRenderer.invoke(IPC.PROJECT_RESET_QUOTA, projectId) as Promise<{ success: boolean }>,
  reauthorizeProject: (projectId: string) =>
    ipcRenderer.invoke(IPC.PROJECT_REAUTHORIZE, projectId) as Promise<{ success: boolean; error?: string; refreshed?: boolean }>,
  repairProject: (projectId: string) =>
    ipcRenderer.invoke(IPC.PROJECT_REPAIR, projectId) as Promise<{ success: boolean; error?: string; repaired?: boolean; refreshed?: boolean; needsCredentials?: boolean; needsOAuthFlow?: boolean }>,
  testAllProjects: () =>
    ipcRenderer.invoke(IPC.PROJECT_TEST_ALL) as Promise<{ projects: unknown[]; checkedAt: number }>,
  batchRepairProjects: (projectIds: string[]) =>
    ipcRenderer.invoke(IPC.PROJECT_BATCH_REPAIR, projectIds) as Promise<Record<string, { success: boolean; error?: string; repaired?: boolean; refreshed?: boolean; needsCredentials?: boolean; needsOAuthFlow?: boolean }>>,
  autoAssignChannels: () =>
    ipcRenderer.invoke(IPC.PROJECT_AUTO_ASSIGN) as Promise<{ success: boolean; assigned: number; error?: string }>,

  // Chrome sessions (Innertube API — no quota limit)
  getSessionStatus: () =>
    ipcRenderer.invoke(IPC.SESSION_LIST) as Promise<{
      ready: boolean; sessionCount: number; loggedInCount: number; consentedCount: number
      sessions: Array<{
        profileId: string; profileName: string; isLoggedIn: boolean; isConsented: boolean
        rawSocs: string | null; lastRefreshAt: number; usedToday: number; lastUsed: number; error?: string
      }>
    }>,
  refreshAllSessions: () =>
    ipcRenderer.invoke(IPC.SESSION_REFRESH_ALL) as Promise<{ success: boolean; refreshedCount: number }>,
  openSessionLogin: (profileId: string) =>
    ipcRenderer.invoke(IPC.SESSION_OPEN_LOGIN, profileId) as Promise<{ success: boolean }>,
  cloneSessionOne: () =>
    ipcRenderer.invoke(IPC.SESSION_CLONE_ONE) as Promise<{ success: boolean; clonedCount: number; error?: string }>,

  // Rendered videos
  getRenderedVideos: () =>
    ipcRenderer.invoke(IPC.RENDERED_LIST) as Promise<unknown[]>,
  archiveRendered: (workspaceId: string, customArchiveDir?: string) =>
    ipcRenderer.invoke(IPC.RENDERED_ARCHIVE, workspaceId, customArchiveDir) as Promise<{ success: boolean; archivedPath?: string; error?: string }>,
  removeRenderedVideo: (id: string) =>
    ipcRenderer.invoke(IPC.RENDERED_REMOVE, id) as Promise<{ success: boolean }>,
  openRenderedFolder: (id?: string) =>
    ipcRenderer.invoke(IPC.RENDERED_OPEN_FOLDER, id) as Promise<{ success: boolean }>,
  setRenderedArchivePath: (path: string) =>
    ipcRenderer.invoke(IPC.RENDERED_SET_ARCHIVE_PATH, path) as Promise<{ success: boolean }>,

  // Storage management
  getStorageSize: () =>
    ipcRenderer.invoke(IPC.STORAGE_GET_SIZE) as Promise<{ downloads: number; blur: number; total: number; downloadPath: string; outputPath: string }>,
  clearDownloads: () =>
    ipcRenderer.invoke(IPC.STORAGE_CLEAR_DOWNLOADS) as Promise<{ success: boolean; freedMB: number }>,
  clearBlur: () =>
    ipcRenderer.invoke(IPC.STORAGE_CLEAR_BLUR) as Promise<{ success: boolean; freedMB: number }>,
  pickFolder: (currentPath?: string) =>
    ipcRenderer.invoke(IPC.STORAGE_PICK_FOLDER, currentPath) as Promise<{ path: string } | null>,

  // System diagnostics
  runDiagnostics: () =>
    ipcRenderer.invoke(IPC.DIAGNOSTICS_RUN) as Promise<{
      timestamp: string
      ffmpeg: { ok: boolean; path: string; version: string; hasNvenc: boolean; bundled: boolean; error?: string }
      ytDlp: { ok: boolean; path: string; version: string; error?: string }
      storage: { ramDiskAvailable: boolean; storeDir: string }
      overall: { ready: boolean; issues: string[] }
    }>,

  // Data portability
  exportData: () =>
    ipcRenderer.invoke(IPC.DATA_EXPORT) as Promise<{ success: boolean; path?: string; error?: string }>,
  importData: () =>
    ipcRenderer.invoke(IPC.DATA_IMPORT) as Promise<{ success: boolean; channelsImported?: number; seenImported?: number; error?: string }>,

  // Log export
  readLogs: () =>
    ipcRenderer.invoke('logs:read') as Promise<{ files: { name: string; size: number; mtime: number; content?: string }[]; logDir: string }>,
  exportLogs: () =>
    ipcRenderer.invoke('logs:export') as Promise<{ success: boolean; path?: string; error?: string }>,

  // MMO Operation Center
  getOpLogs: () =>
    ipcRenderer.invoke('operation:logs-read') as Promise<Array<{ id: string; timestamp: number; level: string; category: string; message: string; detail?: string }>>,
  clearOpLogs: () =>
    ipcRenderer.invoke('operation:logs-clear') as Promise<{ success: boolean }>,
  pausePoller: () =>
    ipcRenderer.invoke('poller:pause') as Promise<{ success: boolean }>,
  bulkAddChannels: (urls: string[]) =>
    ipcRenderer.invoke('channel:bulk-add', urls) as Promise<Array<{ url: string; success: boolean; error?: string }>>,
  onOpLogs: (callback: (entries: Array<{ id: string; timestamp: number; level: string; category: string; message: string; detail?: string }>) => void) => {
    const handler = (_: any, entries: any[]) => callback(entries)
    ipcRenderer.on('operation:logs-event', handler)
    return () => ipcRenderer.removeListener('operation:logs-event', handler)
  },
  onActivityEvent: (callback: (entry: { id: string; timestamp: number; type: string; title: string; subtitle?: string; workspaceId?: string; eta?: string }) => void) => {
    const handler = (_: any, entry: any) => callback(entry)
    ipcRenderer.on('activity:event', handler)
    return () => ipcRenderer.removeListener('activity:event', handler)
  },
})
