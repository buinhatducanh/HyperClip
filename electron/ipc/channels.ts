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
  WORKSPACE_REDOWNLOAD_HD: 'workspace:redownload-hd',

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

  // Innertube degraded state (no videos across all channels for extended period)
  INNERTUBE_DEGRADED_EVENT: 'innertube:degraded',

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
  POLLER_RESUME: 'poller:resume',

  // Auth
  AUTH_STATUS: 'auth:status',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_OAUTH_START: 'auth:oauth-start',
  AUTH_OAUTH_SET_CREDS: 'auth:oauth-set-creds',
  AUTH_OAUTH_GET_CREDS: 'auth:oauth-get-creds',
  AUTH_UPDATE_EVENT: 'auth:update-event',
  AUTH_COOKIE_CRITICAL: 'auth:cookie-critical',

  // Per-project OAuth
  AUTH_OAUTH_START_PER_PROJECT: 'auth:oauth-start-per-project',
  TOKEN_STATUS_LIST: 'token:status-list',
  TOKEN_TEST: 'token:test',
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
  KEY_TEST: 'key:test',
  KEY_TEST_ALL: 'key:test-all',

  // Dynamic project management (OAuth + API key per project)
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_RESET_QUOTA: 'project:reset-quota',
  PROJECT_REAUTHORIZE: 'project:reauthorize',
  PROJECT_REPAIR: 'project:repair',
  PROJECT_TEST_ALL: 'project:test-all',
  PROJECT_BATCH_REPAIR: 'project:batch-repair',
  PROJECT_AUTO_ASSIGN: 'project:auto-assign',

  // Chrome session management (SAPISIDHASH + Innertube API)
  SESSION_LIST: 'session:list',
  SESSION_REFRESH_ALL: 'session:refresh-all',
  SESSION_OPEN_LOGIN: 'session:open-login',
  SESSION_CLONE_ONE: 'session:clone-one',

  // Rendered videos
  RENDERED_LIST: 'rendered:list',
  RENDERED_ADD: 'rendered:add',
  RENDERED_ARCHIVE: 'rendered:archive',
  RENDERED_REMOVE: 'rendered:remove',
  RENDERED_OPEN_FOLDER: 'rendered:openFolder',
  RENDERED_SET_ARCHIVE_PATH: 'rendered:setArchivePath',

  // Workspace blur regeneration
  WORKSPACE_REGENERATE_BLUR: 'workspace:regenerate-blur',

  // Workspace split (split long video into multiple workspaces by trim limit)
  WORKSPACE_SPLIT: 'workspace:split',

  // Track which workspace is active in DetailEditor (protects from auto-cleanup)
  WORKSPACE_SET_ACTIVE: 'workspace:set-active',

  // Storage management
  STORAGE_GET_SIZE: 'storage:get-size',
  STORAGE_CLEAR_DOWNLOADS: 'storage:clear-downloads',
  STORAGE_CLEAR_BLUR: 'storage:clear-blur',
  STORAGE_PICK_FOLDER: 'storage:pick-folder',

  // System diagnostics (P0)
  DIAGNOSTICS_RUN: 'diagnostics:run',

  // Data portability (P1)
  DATA_EXPORT: 'data:export',
  DATA_IMPORT: 'data:import',

  // Log export (P1)
  LOGS_READ: 'logs:read',
  LOGS_EXPORT: 'logs:export',

  // MMO Operation Center
  OPERATION_LOGS_READ: 'operation:logs-read',
  OPERATION_LOGS_CLEAR: 'operation:logs-clear',
  POLLER_PAUSE: 'poller:pause',
  CHANNEL_BULK_ADD: 'channel:bulk-add',

  // Activity feed (pipeline events for sidebar)
  ACTIVITY_EVENT: 'activity:event',

  // YouTube available formats probe (for quality validation UI)
  FORMATS_GET: 'formats:get',

  // License
  LICENSE_STATUS: 'license:status',
  LICENSE_ACTIVATE: 'license:activate',
  LICENSE_VALIDATE: 'license:validate',
  LICENSE_REVOKE: 'license:revoke',

  // Auto-update
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status',
  UPDATE_EVENT: 'update:event',
} as const
