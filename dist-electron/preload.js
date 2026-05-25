"use strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- preload scripts must use CommonJS
const { contextBridge, ipcRenderer } = require('electron');
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
    // YouTube formats probe
    FORMATS_GET: 'formats:get',
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
    SYSTEM_RESOURCE_ALERT: 'system:resource-alert',
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
    CHANNEL_UNSUBSCRIBE: 'channel:unsubscribe',
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
    PROJECT_TOKEN_STATUSES: 'project:token-statuses',
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
    AUTH_CHROME_START: 'auth:chrome-start',
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
    RENDERED_ADD: 'rendered:add',
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
    // Auto-update
    UPDATE_CHECK: 'update:check',
    UPDATE_DOWNLOAD: 'update:download',
    UPDATE_INSTALL: 'update:install',
    UPDATE_STATUS: 'update:status',
    UPDATE_EVENT: 'update:event',
};
contextBridge.exposeInMainWorld('electronAPI', {
    // YouTube tracking
    addTracker: (url, trimLimit) => ipcRenderer.invoke(IPC.TRACKER_ADD, url, trimLimit),
    removeTracker: (channelId) => ipcRenderer.invoke(IPC.TRACKER_REMOVE, channelId),
    getTrackers: () => ipcRenderer.invoke(IPC.TRACKER_LIST),
    // Channel
    getChannelInfo: (url) => ipcRenderer.invoke(IPC.CHANNEL_INFO, url),
    getChannels: () => ipcRenderer.invoke(IPC.CHANNEL_LIST),
    syncChannels: () => ipcRenderer.invoke(IPC.CHANNEL_SYNC),
    addChannel: (url) => ipcRenderer.invoke(IPC.CHANNEL_ADD, url),
    updateChannel: (id, patch) => ipcRenderer.invoke(IPC.CHANNEL_UPDATE, id, patch),
    removeChannel: (id) => ipcRenderer.invoke(IPC.CHANNEL_REMOVE, id),
    unsubscribeChannel: (id) => ipcRenderer.invoke(IPC.CHANNEL_UNSUBSCRIBE, id),
    // Workspaces
    getWorkspaces: () => ipcRenderer.invoke(IPC.WORKSPACE_LIST),
    getVideoFile: (workspaceId) => ipcRenderer.invoke(IPC.VIDEO_FILE, workspaceId),
    getVideoBlob: (workspaceId) => ipcRenderer.invoke(IPC.VIDEO_BLOB, workspaceId),
    getImageFile: (workspaceId) => ipcRenderer.invoke(IPC.IMAGE_FILE, workspaceId),
    saveBlobToFile: (arrayBuffer, filename) => ipcRenderer.invoke(IPC.BLOB_SAVE, arrayBuffer, filename),
    updateWorkspace: (id, patch) => ipcRenderer.invoke(IPC.WORKSPACE_UPDATE, id, patch),
    deleteWorkspace: (id) => ipcRenderer.invoke(IPC.WORKSPACE_DELETE, id),
    retryWorkspace: (id) => ipcRenderer.invoke(IPC.WORKSPACE_RETRY, id),
    redownloadHd: (id) => ipcRenderer.invoke(IPC.WORKSPACE_REDOWNLOAD_HD, id),
    regenerateWorkspaceBlur: (id) => ipcRenderer.invoke(IPC.WORKSPACE_REGENERATE_BLUR, id),
    splitWorkspace: (id, partMinutes) => ipcRenderer.invoke(IPC.WORKSPACE_SPLIT, id, partMinutes),
    setActiveWorkspace: (workspaceId) => ipcRenderer.invoke(IPC.WORKSPACE_SET_ACTIVE, workspaceId),
    // YouTube formats probe — returns available heights for quality validation UI
    getAvailableFormats: (videoId, videoUrl) => ipcRenderer.invoke(IPC.FORMATS_GET, videoId, videoUrl),
    // Rendering
    startRender: (workspaceId, metadata) => ipcRenderer.invoke(IPC.RENDER_START, workspaceId, metadata),
    cancelRender: (workspaceId) => ipcRenderer.invoke(IPC.RENDER_CANCEL, workspaceId),
    startChunked: (workspaceId, metadata, config) => ipcRenderer.invoke(IPC.RENDER_CHUNKED, workspaceId, metadata, config),
    // System
    getSystemStats: () => ipcRenderer.invoke(IPC.SYSTEM_STATS),
    getResourceAlert: () => ipcRenderer.invoke(IPC.SYSTEM_RESOURCE_ALERT),
    openFolder: (folderPath) => ipcRenderer.invoke(IPC.SYSTEM_OPEN_FOLDER, folderPath),
    openUrl: (url) => ipcRenderer.invoke(IPC.SYSTEM_OPEN_URL, url),
    // Events (renderer listens — return cleanup functions)
    onSystemStats: (callback) => {
        const handler = (_, stats) => callback(stats);
        ipcRenderer.on(IPC.SYSTEM_STATS_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC.SYSTEM_STATS_EVENT, handler);
    },
    onRenderProgress: (callback) => {
        const handler = (_, progress) => callback(progress);
        ipcRenderer.on(IPC.RENDER_PROGRESS_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC.RENDER_PROGRESS_EVENT, handler);
    },
    onNotification: (callback) => {
        const handler = (_, n) => callback(n);
        ipcRenderer.on(IPC.NOTIFICATION_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC.NOTIFICATION_EVENT, handler);
    },
    onWorkspaceUpdate: (callback) => {
        const handler = (_, ws) => callback(ws);
        ipcRenderer.on(IPC.WORKSPACE_UPDATE_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC.WORKSPACE_UPDATE_EVENT, handler);
    },
    onRenderedAdd: (callback) => {
        const handler = (_, video) => callback(video);
        ipcRenderer.on(IPC.RENDERED_ADD, handler);
        return () => ipcRenderer.removeListener(IPC.RENDERED_ADD, handler);
    },
    onQuickAdd: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('quick-add', handler);
        return () => ipcRenderer.removeListener('quick-add', handler);
    },
    // Auto-download from WebSub
    onAutoDownload: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on(IPC.AUTO_DOWNLOAD_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC.AUTO_DOWNLOAD_EVENT, handler);
    },
    // Innertube degraded state
    onInnertubeDegraded: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on(IPC.INNERTUBE_DEGRADED_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC.INNERTUBE_DEGRADED_EVENT, handler);
    },
    // Settings
    getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    updateSettings: (patch) => ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch),
    // WebSub diagnostics
    testWebSub: () => ipcRenderer.invoke(IPC.WEBSUB_TEST),
    // Poller status
    getPollerStatus: () => ipcRenderer.invoke(IPC.POLLER_STATUS),
    resumePoller: () => ipcRenderer.invoke(IPC.POLLER_RESUME),
    // Auth
    getAuthStatus: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
    logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
    startOAuthFlow: () => ipcRenderer.invoke(IPC.AUTH_OAUTH_START),
    setOAuthCredentials: (clientId, clientSecret) => ipcRenderer.invoke(IPC.AUTH_OAUTH_SET_CREDS, clientId, clientSecret),
    getOAuthCredentials: () => ipcRenderer.invoke(IPC.AUTH_OAUTH_GET_CREDS),
    // Per-project OAuth tokens
    startOAuthFlowPerProject: (clientId, clientSecret, projectId) => ipcRenderer.invoke(IPC.AUTH_OAUTH_START_PER_PROJECT, clientId, clientSecret, projectId),
    getTokenStatuses: () => ipcRenderer.invoke(IPC.TOKEN_STATUS_LIST),
    testToken: (projectId) => ipcRenderer.invoke(IPC.TOKEN_TEST, projectId),
    removeToken: (projectId) => ipcRenderer.invoke(IPC.TOKEN_REMOVE, projectId),
    getDefaultOAuthCredentials: () => ipcRenderer.invoke(IPC.TOKEN_GET_DEFAULT_CREDS),
    // Auth events
    onAuthUpdate: (callback) => {
        const handler = (_, status) => callback(status);
        ipcRenderer.on(IPC.AUTH_UPDATE_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC.AUTH_UPDATE_EVENT, handler);
    },
    onCookieCritical: (callback) => {
        const handler = (_, msg) => callback(msg);
        ipcRenderer.on(IPC.AUTH_COOKIE_CRITICAL, handler);
        return () => ipcRenderer.removeListener(IPC.AUTH_COOKIE_CRITICAL, handler);
    },
    onChannelSynced: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(IPC.CHANNEL_SYNCED_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC.CHANNEL_SYNCED_EVENT, handler);
    },
    // Keys
    getKeys: () => ipcRenderer.invoke(IPC.KEY_LIST),
    addKey: (key, projectId, name) => ipcRenderer.invoke(IPC.KEY_ADD, key, projectId, name),
    removeKey: (key) => ipcRenderer.invoke(IPC.KEY_REMOVE, key),
    resetKey: (key) => ipcRenderer.invoke(IPC.KEY_RESET, key),
    testKey: (key) => ipcRenderer.invoke(IPC.KEY_TEST, key),
    testAllKeys: () => ipcRenderer.invoke(IPC.KEY_TEST_ALL),
    // Dynamic projects
    getProjects: () => ipcRenderer.invoke(IPC.PROJECT_LIST),
    getProjectTokenStatuses: () => ipcRenderer.invoke(IPC.PROJECT_TOKEN_STATUSES),
    addProject: (data) => ipcRenderer.invoke(IPC.PROJECT_ADD, data),
    removeProject: (projectId) => ipcRenderer.invoke(IPC.PROJECT_REMOVE, projectId),
    resetProjectQuota: (projectId) => ipcRenderer.invoke(IPC.PROJECT_RESET_QUOTA, projectId),
    reauthorizeProject: (projectId) => ipcRenderer.invoke(IPC.PROJECT_REAUTHORIZE, projectId),
    repairProject: (projectId) => ipcRenderer.invoke(IPC.PROJECT_REPAIR, projectId),
    testAllProjects: () => ipcRenderer.invoke(IPC.PROJECT_TEST_ALL),
    batchRepairProjects: (projectIds) => ipcRenderer.invoke(IPC.PROJECT_BATCH_REPAIR, projectIds),
    autoAssignChannels: () => ipcRenderer.invoke(IPC.PROJECT_AUTO_ASSIGN),
    // Chrome sessions (Innertube API — no quota limit)
    getSessionStatus: () => ipcRenderer.invoke(IPC.SESSION_LIST),
    refreshAllSessions: () => ipcRenderer.invoke(IPC.SESSION_REFRESH_ALL),
    openSessionLogin: (profileId) => ipcRenderer.invoke(IPC.SESSION_OPEN_LOGIN, profileId),
    startChromeLogin: () => ipcRenderer.invoke(IPC.AUTH_CHROME_START),
    cloneSessionOne: () => ipcRenderer.invoke(IPC.SESSION_CLONE_ONE),
    // Rendered videos
    getRenderedVideos: () => ipcRenderer.invoke(IPC.RENDERED_LIST),
    archiveRendered: (workspaceId, customArchiveDir) => ipcRenderer.invoke(IPC.RENDERED_ARCHIVE, workspaceId, customArchiveDir),
    removeRenderedVideo: (id) => ipcRenderer.invoke(IPC.RENDERED_REMOVE, id),
    openRenderedFolder: (id) => ipcRenderer.invoke(IPC.RENDERED_OPEN_FOLDER, id),
    setRenderedArchivePath: (path) => ipcRenderer.invoke(IPC.RENDERED_SET_ARCHIVE_PATH, path),
    // Storage management
    getStorageSize: () => ipcRenderer.invoke(IPC.STORAGE_GET_SIZE),
    clearDownloads: () => ipcRenderer.invoke(IPC.STORAGE_CLEAR_DOWNLOADS),
    clearBlur: () => ipcRenderer.invoke(IPC.STORAGE_CLEAR_BLUR),
    pickFolder: (currentPath) => ipcRenderer.invoke(IPC.STORAGE_PICK_FOLDER, currentPath),
    // System diagnostics
    runDiagnostics: () => ipcRenderer.invoke(IPC.DIAGNOSTICS_RUN),
    // Data portability
    exportData: () => ipcRenderer.invoke(IPC.DATA_EXPORT),
    importData: () => ipcRenderer.invoke(IPC.DATA_IMPORT),
    // Log export
    readLogs: () => ipcRenderer.invoke('logs:read'),
    exportLogs: () => ipcRenderer.invoke('logs:export'),
    getLogDiskUsage: () => ipcRenderer.invoke('logs:disk-usage'),
    cleanupLogs: () => ipcRenderer.invoke('logs:cleanup'),
    // MMO Operation Center
    getOpLogs: () => ipcRenderer.invoke('operation:logs-read'),
    clearOpLogs: () => ipcRenderer.invoke('operation:logs-clear'),
    pausePoller: () => ipcRenderer.invoke('poller:pause'),
    bulkAddChannels: (urls) => ipcRenderer.invoke('channel:bulk-add', urls),
    onOpLogs: (callback) => {
        const handler = (_, entries) => callback(entries);
        ipcRenderer.on('log:stream', handler);
        return () => ipcRenderer.removeListener('log:stream', handler);
    },
    onActivityEvent: (callback) => {
        const handler = (_, entry) => callback(entry);
        ipcRenderer.on('activity:event', handler);
        return () => ipcRenderer.removeListener('activity:event', handler);
    },
    // Auto-update
    checkForUpdate: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    downloadUpdate: () => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
    installUpdate: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL),
    getUpdateStatus: () => ipcRenderer.invoke(IPC.UPDATE_STATUS),
    onUpdateEvent: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on(IPC.UPDATE_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC.UPDATE_EVENT, handler);
    },
});
