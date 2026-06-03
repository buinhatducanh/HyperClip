// ─── Shared FFmpeg constants ────────────────────────────────────────────────────
// These constants are exported separately so overlay_cache.ts (which runs in the
// settings-save path, before any render) can pre-render the bottom bar / title
// PNGs using the SAME font, dimensions, and color values as the actual render
// pipeline — guaranteeing the cached PNG matches what ffmpeg will overlay.

// Layout: HEADER (25%) | VIDEO (50%) | BOTTOM (25%)
// Video bottom touches top of bottom zone — no overlap.
export const HEADER_PCT = 0.25   // 25% — header overlay zone
export const BOTTOM_PCT = 0.25   // 25% — bottom bar zone (opaque bar + title)
export const VIDEO_PCT  = 1 - HEADER_PCT - BOTTOM_PCT  // 50% — video zone

// The font is copied to resources/fonts/arial.ttf at startup.
// FFmpeg 7.x lavfi parser splits option values at COLON characters (drive letter).
// Using a RELATIVE PATH (no `:` anywhere) means lavfi treats the whole path as one token.
export const FONT_FILE = 'resources/fonts/arial.ttf'
