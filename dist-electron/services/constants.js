"use strict";
/**
 * Shared constants for HyperClip quota management.
 * All magic numbers centralize here — import from this file, never hardcode.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOURLY_EVENTS_MAX = exports.TOKEN_EXPIRY_BUFFER_MS = exports.REFRESH_INTERVAL_MS = exports.STALE_SESSION_DAYS = exports.EXHAUSTION_ERROR_THRESHOLD = exports.QUOTA_WARNING_PCT = exports.MAX_UNITS_PER_PROJECT = void 0;
exports.MAX_UNITS_PER_PROJECT = 9500; // Daily quota limit per GCP project (YouTube API v3)
exports.QUOTA_WARNING_PCT = 80; // % of quota to trigger warning status
exports.EXHAUSTION_ERROR_THRESHOLD = 5; // Sequential errors to auto-mark exhausted
exports.STALE_SESSION_DAYS = 7; // Days before session cookies are flagged stale
exports.REFRESH_INTERVAL_MS = 30 * 60 * 1000; // Token proactiv refresh interval (30 min)
exports.TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // Refresh tokens expiring within 5 min
exports.HOURLY_EVENTS_MAX = 24; // Max timestamp events per key in UsageTimeline
