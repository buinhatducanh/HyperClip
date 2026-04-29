# CLAUDE.md — HyperClip

> Source of truth: `HYPERCLIP_RULES.md` (root). File này là hướng dẫn cho Claude Code.

---

## Mục tiêu cốt lõi

**Bắt 100% video mới trong < 20 giây, chạy 24/7 cho ~100 kênh YouTube.**

## Auto-Ingestion Pipeline

```
YouTubePoller (20s ± jitter)
         ↓
fetchSubscriptionFeed() → ALL channels (parallel, max 20 concurrent)
         ↓
1. Innertube API (30 Chrome sessions, SAPISIDHASH) — PRIMARY, NO QUOTA
   → OAuth Data API v3 fallback khi Innertube trả 0 video
         ↓
Filter: age < 10 min, unseen, not deleted
         ↓
autoDownload (yt-dlp --download-sections) → blur → workspace ready → notify
```

**Chi tiết quota system và Innertube failure modes:** xem HYPERCLIP_RULES.md section 3b.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron |
| Frontend | Next.js 14 (App Router) |
| State | Zustand (flat, NO context cascade) |
| Styling | Tailwind CSS v3 + inline styles |
| Backend | Node.js (Electron main process) |
| Auth Primary | Innertube API via Chrome Session Cookies (30 profiles, NO quota) |
| Auth Fallback | OAuth 2.0 + Data API v3 (TokenManager, 10k units/project/day) |
| API Key Pool | KeyManager (chưa dùng trực tiếp, dự phòng tương lai) |
| Downloader | yt-dlp + Direct IP Binding |
| Video Processing | FFmpeg + NVIDIA NVENC (RTX 5080) |
| Hardware | Intel Core Ultra 9 285K, RTX 5080 16GB, 64GB RAM |

---

## Thư mục chính

```
electron/
  main.ts                   — Bootstrap, window, tray, IPC handlers
  preload.ts                — window.electronAPI bridge
  ipc/channels.ts           — IPC channel constants
  services/
    youtube_auth.ts         — OAuth 2.0 flow, token management
    key_manager.ts          — 30 API keys pool (quota tracking, dự phòng tương lai)
    token_manager.ts        — OAuth tokens: smart rotation, refresh, per-project quota
    subscription_feed.ts    — Full scan all channels: Innertube primary + OAuth fallback
    chrome_cookies.ts       — Chrome cookie extraction (DPAPI + sql.js), SAPISIDHASH, SessionManager (30 profiles)
    youtube_poller.ts       — Orchestrator: feed → autoDownload
    youtube.ts              — yt-dlp wrapper (download, getVideoInfo)
    ffmpeg.ts               — FFmpeg + NVENC render pipeline
    ffmpeg-paths.ts        — FFmpeg binary resolution
    worker-pool.ts          — Concurrent FFmpeg process management
    ramdisk.ts             — Storage path management
    store.ts               — Persistent JSON store (workspaces, channels)
    system.ts              — System stats (GPU, RAM, workers, 5s interval)

src/app/
  page.tsx                 — Dashboard (3-pane layout)
  layout.tsx               — Root layout
  globals.css              — Tailwind + :focus-visible outlines
  components/
    Sidebar.tsx            — Navigation + System Monitor
    WorkspaceQueue.tsx      — Video list grouped by status
    WorkspaceCard.tsx      — Individual card (hover actions + retry)
    DetailEditor.tsx       — Editor panel (trim, speed, background, overlay, export)
    RenderQueueBar.tsx     — Floating render queue
    workspace/
      InputBar.tsx         — URL input + trim dropdown + channel URL support
  settings/page.tsx        — OAuth credentials + key management
  lib/
    store.ts               — Zustand (flat state)
    ipc.ts                 — IPC client wrapper
  types.ts                 — Shared TypeScript types

HYPERCLIP_RULES.md         — Source of truth cho nghiệp vụ + kỹ thuật
```

---

## IPC Protocol (key channels)

**Renderer → Main:**
- `workspace:retry` — retry download for `waiting`/`error` workspaces
- `workspace:update/delete/list` — Workspace CRUD
- `channel:add/list/update/remove` — Channel CRUD
- `render:start/cancel/chunked` — FFmpeg render control
- `key:list/add/remove/reset` — API key management
- `auth:oauth-start/set-creds/get-creds` — OAuth flow

**Main → Renderer (events):**
- `workspace:update-event` — Workspace state changed
- `render:progress-event` — FFmpeg render progress
- `system:stats-update` — Periodic system stats (5s)
- `notification` — Toast notification
- `autodownload` — New video auto-downloaded
- `channel:synced-event` — Subscription list synced (15 min interval)

---

## Important Code Patterns

### Zustand store (src/app/lib/store.ts)
- Flat updates only — NO context cascade
- `useAppStore` — single store for all app state
- `WorkspaceStatus` includes `'error'` (for permanently unavailable videos)

### Module-level caching (electron services)
- `_cachedGPU` in `system.ts` — GPU detection runs ONCE at startup
- `_cachedIp` in `system.ts` — network IP cached
- `_cachedChannels` in `subscription_feed.ts` — channel list cached, invalidated on add/sync
- `_cpuFirstDone` in `system.ts` — CPU tick delta needs warmup (first call = 0%)

### Video preview shortcuts (DetailEditor.tsx)
- `Space` = play/pause
- `ArrowLeft/Right` = seek ±5s (±1s with Shift)
- Timeline click-to-seek on scrubber

---

## Commands

```bash
npm run dev           # Next.js dev (localhost:3000)
npm run electron:dev  # Dev: Next.js + Electron
npm run electron:build # Production .exe
```

---

## TypeScript Verify

Luôn chạy `npx tsc --noEmit` sau khi sửa backend Electron. IDE diagnostics không luôn catch được main process errors.

---

## UI Rules

- Layout: 3-pane (Sidebar 220px | Center flex | Right Editor)
- Theme: `#121212` bg, `#00B4FF` accent, `#00FF88` success
- Flat design: NO shadows, NO gradients
- Font: Inter
- `use client` BẮT BUỘC cho mọi React component trong `src/app/`

---

## Dead Code (không dùng, không xóa — chỉ để reference)

- `src/app/components/LoginScreen.tsx` — standalone file, không import ở đâu
- `src/app/components/ui/` — shadcn/ui library files (accordion, alert, card, dialog, etc.) — không import trong app code
- `electron/services/websub.ts` — đã xóa khỏi codebase
- Các file `.claude/docs/` cũ: `PROJECT.md`, `ATTRIBUTIONS.md` — thông tin outdated

---

## Cập nhật: 2026-04-27
