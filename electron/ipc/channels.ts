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

  // Notification
  NOTIFICATION_EVENT: 'notification',

  // Auto-download
  AUTO_DOWNLOAD_EVENT: 'autodownload',

  // Channel info
  CHANNEL_INFO: 'channel:info',

  // Channel CRUD
  CHANNEL_LIST: 'channel:list',
  CHANNEL_ADD: 'channel:add',
  CHANNEL_UPDATE: 'channel:update',
  CHANNEL_REMOVE: 'channel:remove',

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
} as const
