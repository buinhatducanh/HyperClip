/**
 * Shared constants for HyperClip quota management.
 * All magic numbers centralize here — import from this file, never hardcode.
 */

export const MAX_UNITS_PER_PROJECT = 9500   // Daily quota limit per GCP project (YouTube API v3)
export const QUOTA_WARNING_PCT = 80         // % of quota to trigger warning status
export const EXHAUSTION_ERROR_THRESHOLD = 5  // Sequential errors to auto-mark exhausted
export const STALE_SESSION_DAYS = 7          // Days before session cookies are flagged stale
export const REFRESH_INTERVAL_MS = 30 * 60 * 1000   // Token proactiv refresh interval (30 min)
export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // Refresh tokens expiring within 5 min
export const HOURLY_EVENTS_MAX = 24         // Max timestamp events per key in UsageTimeline
