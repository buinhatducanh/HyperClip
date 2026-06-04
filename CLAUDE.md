# CLAUDE.md — HyperClip

> Source of truth: `HYPERCLIP_RULES.md` (root). File này là hướng dẫn cho Claude Code.

---

## Mục tiêu cốt lõi

**Bắt 100% video mới trong < 20 giây, chạy 24/7 cho ~100 kênh YouTube.**

## Auto-Ingestion Pipeline

```
YouTubePoller (5 giây ± 20% jitter = 4-6s)
         ↓
fetchSubscriptionFeed() → ALL channels (parallel, max 10 concurrent)
         ↓
1. Innertube API (30 Chrome sessions, SAPISIDHASH) — PRIMARY, NO QUOTA
   → getLatestVideo: check top-1..top-5, seen dedup (return null → continue)
   → publishedAt=0 → OAuth verify (real upload timestamp)
   → OAuth Data API v3 fallback khi Innertube die (pool=0)
         ↓
Filter: age ≤ 10 min, unseen, not deleted
         ↓
autoDownload (yt-dlp --download-sections, multi-instance, 16 fragments, tv_embedded client) → workspace ready → notify
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
  ipc/
    channels.ts              — IPC channel constants
    handlers/                — IPC handler groups (extracted from main.ts)
      index.ts               — registers all handlers
      system.ts              — SYSTEM_STATS, SYSTEM_OPEN_*
      auth.ts               — AUTH_*, TOKEN_*, KEY_*
      project.ts             — PROJECT_*, PROJECT_REPAIR, PROJECT_BATCH_REPAIR
      session.ts             — SESSION_*, logs:read, logs:export
  services/__tests__/        — Unit tests (Vitest)
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
npm run lint          # ESLint (electron/)
npm run lint:fix     # ESLint with --fix
npm run test          # Unit tests (Vitest)
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
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

## Dead Code

Đã dọn trong các commit gần đây — KHÔNG còn dead code tracked. Có thể check lại bằng:

```bash
node scripts/find-unused-services.mjs   # scan electron/services/*.ts
```

Từng bước dọn (lịch sử):
- `src/app/components/DetailEditor.tsx` — replaced by SettingsPanel — **dropped** (bdf5f8e)
- `src/app/components/workspace/RenderQueueBar.tsx` — integrated into Queue panel — **dropped** (bdf5f8e)
- `src/app/components/ui/` (60+ shadcn files) — không import — **dropped** (17055be)
- `src/app/components/LoginScreen.tsx` — actually used in page.tsx cho unauth fallback, **giữ lại**
- `electron/services/websub.ts` — **dropped** (pre-CLAUDE.md)
- `electron/services/updater.ts` — replaced by `github-updater.ts` — **dropped** (5ac0fe8)
- `electron/ipc/handlers/_original_project.ts` — empty leftover — **dropped** (37c918a)
- `.claude/docs/DemoDesignTool.zip`, `Description.docx` — outdated binary blobs — **dropped**

---

## Cập nhật: 2026-05-13

- `publishedAt=0` → OAuth verify (2026-05-13): gọi `/videos?id=...&part=snippet` để lấy real `publishedAt`. Accept nếu ≤ 10 min, skip nếu > 10 min. OAuth chỉ trigger khi Innertube trả empty timestamp → quota cost ~300-500 units/ngày.
- Xóa priority re-scan + `getLatestVideoPriority()` + `verifyVideoAgeByOAuth()` + OAuth health check. OAuth quota ≈ 0 consumption.
- Fix dedup bug: `return null` → `continue` trong `getLatestVideo`
- **Download quality (2026-05-18):** Client priority: `tv_embedded` → `web` → `ios`. `web` client với Chrome CDP cookies bị giới hạn 360p (EJS challenge). `tv_embedded` bypass EJS qua HLS → 1080p60 H.264. Format selector: ưu tiên resolution (không H.264 restriction). E2E verified: 1920x1080 → 288.7MB download → 874MB render → archive ✅
- **Preview/render fix (2026-05-13):** `downloadedPath` stored as relative filename (`"XYZ.mp4"`). VIDEO_FILE/VIDEO_BLOB handlers prepend `getVideoStoragePath()` to resolve absolute path. Fix `normalizedStored` undefined reference.

## Cập nhật: 2026-05-12

- DEV_LOG=1 enable qua `cross-env DEV_LOG=1` trong `electron:dev` script
