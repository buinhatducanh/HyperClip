// IPC Channel constants — shared between main and renderer
export const IPC_CHANNELS = {
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
  RENDER_PROGRESS: 'render:progress',
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

  // Channel info
  CHANNEL_INFO: 'channel:info',

  // Channel CRUD
  CHANNEL_LIST: 'channel:list',
  CHANNEL_SYNC: 'channel:sync',
  CHANNEL_ADD: 'channel:add',
  CHANNEL_UPDATE: 'channel:update',
  CHANNEL_REMOVE: 'channel:remove',
  CHANNEL_SYNCED_EVENT: 'channel:synced-event',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Poller
  POLLER_STATUS: 'poller:status',

  // WebSub
  WEBSUB_TEST: 'websub:test',

  // Auth
  AUTH_STATUS: 'auth:status',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_OAUTH_START: 'auth:oauth-start',
  AUTH_OAUTH_SET_CREDS: 'auth:oauth-set-creds',
  AUTH_OAUTH_GET_CREDS: 'auth:oauth-get-creds',
  AUTH_UPDATE_EVENT: 'auth:update-event',
  AUTH_SUBS_SYNCED_EVENT: 'auth:subs-synced-event',
  AUTH_COOKIE_CRITICAL: 'auth:cookie-critical',

  // Per-project OAuth
  AUTH_OAUTH_START_PER_PROJECT: 'auth:oauth-start-per-project',
  TOKEN_STATUS_LIST: 'token:status-list',
  TOKEN_ADD: 'token:add',
  TOKEN_REMOVE: 'token:remove',
  TOKEN_GET_DEFAULT_CREDS: 'token:get-default-creds',

  // Video file serving (for HTML5 video player preview)
  VIDEO_FILE: 'video:file',
  // Video blob serving (full file as blob URL for faster playback)
  VIDEO_BLOB: 'video:blob',

  // Image file serving (for local thumbnails — replaces YouTube URLs which 404 for new uploads)
  IMAGE_FILE: 'image:file',

  // Save blob URL to disk (for header/background images that FFmpeg needs to read)
  BLOB_SAVE: 'blob:save',

  // Key management
  KEY_LIST: 'key:list',
  KEY_ADD: 'key:add',
  KEY_REMOVE: 'key:remove',
  KEY_RESET: 'key:reset',

  // Dynamic project management (OAuth + API key per project)
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_RESET_QUOTA: 'project:reset-quota',
  PROJECT_REAUTHORIZE: 'project:reauthorize',

  // Chrome session management (SAPISIDHASH + Innertube API)
  SESSION_LIST: 'session:list',
  SESSION_REFRESH_ALL: 'session:refresh-all',
  SESSION_OPEN_LOGIN: 'session:open-login',

  // Admin password
  ADMIN_CHECK_PASSWORD: 'admin:check-password',
  ADMIN_SET_PASSWORD: 'admin:set-password',
  ADMIN_HAS_PASSWORD: 'admin:has-password',
} as const
