// Theme colors
export const THEME = {
  background: '#121212',
  surface: '#1E1E1E',
  surfaceLight: '#0E0E0E',
  surfaceDeep: '#0A0A0A',
  accent: '#00B4FF',
  accentGreen: '#00FF88',
  accentOrange: '#FF6B35',
  accentPurple: '#7C3AED',
  accentPink: '#FF0080',
  error: '#FF4444',
  warning: '#FFB800',
  textPrimary: '#ffffff',
  textSecondary: '#888888',
  textMuted: '#444444',
  border: '#1E1E1E',
  borderLight: '#222222',
} as const

// Status colors
export const STATUS_COLORS = {
  new: '#00FF88',
  waiting: '#FFB800',
  downloading: '#00B4FF',
  ready: '#00FF88',
  editing: '#7C3AED',
  rendering: '#FF4444',
  done: '#444444',
} as const

// Trim limits
export const TRIM_LIMITS = ['5min', '10min', 'full'] as const

// Speed options
export const SPEED_OPTIONS = [1.0, 1.1, 1.2, 1.5] as const

// Export qualities
export const EXPORT_QUALITIES = [1080, 720, 360] as const

// Worker colors for render queue
export const WORKER_COLORS = ['#00B4FF', '#00FF88', '#7C3AED', '#FF6B35'] as const

// Sidebar dimensions
export const SIDEBAR_WIDTH = 220

// Channel avatar colors
export const CHANNEL_COLORS = [
  '#00B4FF',
  '#7C3AED',
  '#00FF88',
  '#FF6B35',
  '#FF0080',
  '#FFB800',
]

// ─── Settings / Quota constants ────────────────────────────────────────────────
// Mirrors electron/services/constants.ts — these are frontend-visible values.

/** Daily quota limit per GCP project (YouTube API v3) */
export const MAX_UNITS_PER_PROJECT = 9500

/** % of quota to trigger warning status */
export const QUOTA_WARNING_PCT = 80

/** Total remaining units across ALL projects to trigger critical warning */
export const QUOTA_CRITICAL_THRESHOLD = 1000

/** Total remaining units across ALL projects to trigger warning */
export const QUOTA_WARNING_THRESHOLD = 5000

/** % of quota to show amber warning bar (visual threshold in charts) */
export const QUOTA_BAR_WARN_PCT = 75

/** % of quota to show red exhausted bar (visual threshold in charts) */
export const QUOTA_BAR_EXHAUSTED_PCT = 90

/** Days before session cookies are flagged stale */
export const STALE_SESSION_DAYS = 7

/** Max timestamp events per key in UsageTimeline */
export const HOURLY_EVENTS_MAX = 24

/** Milliseconds to show "just reset" animation */
export const RESET_ANIMATION_MS = 5000

/** CPU usage % threshold for warning color */
export const CPU_WARN_PCT = 80