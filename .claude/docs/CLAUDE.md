# CLAUDE.md — HyperClip

## Mục tiêu cốt lõi

**Bắt 100% video trong < 5 giây, chạy 24/7 cho ~100 kênh YouTube.**

---

## Speed Pipeline (5 tầng)

| Tầng | Mục tiêu | Công nghệ |
|------|-----------|-----------|
| 1. Trigger | < 5s | **Cookie Polling 3-6s** (Subscription Feed, 1 request cho tất cả 100 kênh) |
| 2. Download | < 30s | yt-dlp + Direct IP Binding (bypass VPN) |
| 3. Pre-process | < 3s | Static blur (1 frame, cache vĩnh viễn) |
| 4. Edit | < 16ms/frame | React-Konva Canvas 2D (60fps) |
| 5. Render | < 2 phút | FFmpeg + NVENC (RTX 5080) |

---

## Auto-Ingestion: Cookie Polling

### Flow
```
initCookieManager()        → cookie_manager.ts (refresh 15 phút)
                                    ↓
YouTubePoller (3-6s jitter) → youtube_poller.ts
                                    ↓
    Python requests.Session GET /feed/subscriptions
        (1 request → tất cả 100 kênh)
                                    ↓
    ytInitialData parser → new videos
                                    ↓
    autoDownloadFromWebSub() → workspace → yt-dlp → blur → notify
```

### 3 thủ thuật chống Bot
1. **Browser Fingerprint**: Full headers (User-Agent, X-YouTube-Client-Name, X-YouTube-Client-Version, Sec-Fetch-*)
2. **Jitter**: Random 3-6s (không cố định 3s)
3. **Keep-Alive**: `requests.Session()` reuse TCP

### Files
- `electron/services/cookie_manager.ts` — Extract Chrome/Edge cookies (Python + win32crypt/DPAPI)
- `electron/services/youtube_poller.ts` — Poll /feed/subscriptions
- `electron/main.ts` (`startYouTubePoller`) — Bootstrap

### Đã xóa
- ~~WebSub / PubSubHubbub~~
- ~~Cloudflare Tunnel~~
- ~~RSS per-channel polling~~

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron |
| Frontend | Next.js 14 (App Router) |
| State | Zustand (flat updates, NO context cascade) |
| Canvas | React-Konva (GPU compositing, 60fps) |
| Styling | Tailwind CSS v3 + inline styles |
| Backend | Node.js (Electron main process) |
| Downloader | yt-dlp + cookie session |
| Video Processing | FFmpeg + NVIDIA NVENC |

---

## Speed Rules

1. **RAM Disk cho video temp** — ~10GB/s I/O
2. **Static Blur** — 1 frame blur, cache vĩnh viễn, render chỉ composite
3. **Direct IP Binding** — yt-dlp bypass VPN
4. **NVENC** — KHÔNG x264 software encode
5. **Speed options** — 1.1x/1.2x/1.5x
6. **Zustand flat state** — NO context cascade

---

## Commands

```bash
npm run dev          # Next.js dev (localhost:3000)
npm run electron:dev  # Dev: Next.js + Electron
npm run electron:build # Production .exe
```

Build fix: `.next` cache corrupt → `Remove-Item -Recurse -Force .next`

---

## Next.js App Router Rules

- `use client` là BẮT BUỘC cho mọi React component trong `src/app/`
- `src/app/page.tsx` — Dashboard (3-pane)
- `src/app/layout.tsx` — Root layout

---

## File cấu trúc

```
electron/
  main.ts              — Bootstrap, window, tray, IPC handlers
  preload.ts           — window.electronAPI bridge
  ipc/channels.ts      — IPC channel constants
  services/
    youtube_poller.ts   — Cookie polling (3-6s jitter, keep-alive)
    cookie_manager.ts   — Extract Chrome/Edge cookies
    youtube.ts          — yt-dlp wrapper
    ffmpeg.ts          — FFmpeg + NVENC
    worker-pool.ts      — Concurrent FFmpeg processes
    ramdisk.ts         — Storage paths
    store.ts           — Persistent JSON (workspaces, channels)
    system.ts          — GPU/RAM/worker stats

src/app/
  page.tsx              — Dashboard
  components/
    Sidebar.tsx         — Navigation + System Monitor
    WorkspaceQueue.tsx  — Video workspace list
    DetailEditor.tsx    — Editor panel
  lib/
    store.ts            — Zustand
    ipc.ts              — IPC client

HYPERCLIP_RULES.md     — Source of truth (đọc file này TRƯỚC)
```

---

## TSC Compile Verify

Luôn chạy tsc trực tiếp trước khi commit:
```bash
npx tsc -p electron/tsconfig.main.json --noEmit
npx tsc -p electron/tsconfig.preload.json --noEmit
```

---

## Cập nhật: 2026-04-24
