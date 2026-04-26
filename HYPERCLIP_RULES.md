# HyperClip — Quy tắc & Kiến trúc

> Tài liệu này là **source of truth**. Mọi file spec khác (dashboard-design.md, memory files) phải nhất quán với file này.

---

## 1. Mục tiêu cốt lõi

**Bắt 100% video mới trong < 5 giây, chạy 24/7 cho ~100 kênh YouTube.**

---

## 2. Pipeline (5 tầng)

| # | Tầng | Công nghệ | Target |
|---|-------|-----------|--------|
| 1 | **Trigger** | Cookie Polling 3-6s (Subscription Feed) | < 5s |
| 2 | **Download** | yt-dlp + Direct IP Binding (bypass VPN) | < 30s |
| 3 | **Pre-process** | Static blur (1 frame, cache vĩnh viễn) | < 3s |
| 4 | **Edit** | React-Konva Canvas 2D (60fps) | < 16ms/frame |
| 5 | **Render** | FFmpeg + NVENC (RTX 5080) | < 2 phút |

---

## 3. Auto-Ingestion — Cookie Polling (Tầng 1)

### Cơ chế

Dùng **YouTube Subscription Feed polling** — 1 request cho tất cả ~100 kênh cùng lúc:

```
Browser (Chrome/Edge) → Cookie Manager (15 phút refresh)
                                     ↓
                        YouTubePoller (3-6s jitter)
                                     ↓
                    /feed/subscriptions (1 request)
                                     ↓
                          ytInitialData parser
                                     ↓
                          autoDownloadFromWebSub()
                                     ↓
                    Workspace → Download → Blur → Notify
```

### 3 thủ thuật chống Bot Detection

1. **Browser Fingerprinting**: Full headers (`User-Agent`, `X-YouTube-Client-Name`, `X-YouTube-Client-Version`, `Sec-Fetch-*`)
2. **Jitter Delay**: Random 3-6s thay vì chính xác 3s (mimics human browsing)
3. **Keep-Alive**: `requests.Session()` reuse TCP connection — không tạo connection mới mỗi poll

### File quan trọng

| File | Vai trò |
|------|---------|
| `electron/services/cookie_manager.ts` | Trích cookie Chrome/Edge mỗi 15 phút |
| `electron/services/youtube_poller.ts` | Poll /feed/subscriptions mỗi 3-6s |
| `electron/main.ts` (`startYouTubePoller`) | Khởi tạo poller, wire callback |
| `electron/main.ts` (`autoDownloadFromWebSub`) | Tạo workspace + download + gen blur |

### Không dùng

- ~~WebSub / PubSubHubbub~~ — đã xóa (cần tunnel, phức tạp)
- ~~RSS polling per-channel~~ — đã xóa (chậm, không real-time)
- ~~Cloudflare Tunnel~~ — đã xóa
- ~~Google Data API~~ — quota giới hạn

---

## 4. Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron |
| Frontend | Next.js 14 (App Router) |
| State | Zustand (flat, NO context cascade) |
| Canvas | React-Konva (GPU compositing, 60fps) |
| Styling | Tailwind CSS v3 + inline styles |
| Backend | Node.js (Electron main process) |
| Downloader | yt-dlp + cookie session |
| Video Processing | FFmpeg + NVIDIA NVENC |
| Cookie | Python + win32crypt (DPAPI decryption) |

### Hardware Target
- CPU: Intel Core Ultra 9 285K
- GPU: RTX 5080 16GB (NVENC)
- RAM: 64GB DDR5

---

## 5. Speed Rules

1. **RAM Disk cho video temp** — ~10GB/s I/O, video source không bao giờ đụng HDD
2. **Static Blur** — gen 1 frame blur, cache vĩnh viễn, render chỉ composite (0 GPU cost/render frame)
3. **Direct IP Binding** — yt-dlp bypass VPN để max bandwidth
4. **NVENC** — hardware encode, KHÔNG x264 software
5. **Speed options** — 1.1x/1.2x/1.5x encode ít frame hơn → nhanh hơn
6. **Zustand flat state** — NO context cascade, chỉ re-render component cần

---

## 6. Cấu trúc thư mục

```
electron/
  main.ts              — Entry point, window, tray, IPC handlers, bootstrap
  preload.ts           — IPC bridge (window.electronAPI)
  ipc/
    channels.ts        — IPC channel constants
  services/
    youtube_poller.ts   — Cookie-based subscription feed poller (3-6s jitter)
    cookie_manager.ts   — Extract Chrome/Edge cookies via Python+DPAPI
    youtube.ts          — yt-dlp wrapper (download, getVideoInfo, getChannelId)
    ffmpeg.ts          — FFmpeg + NVENC render pipeline
    worker-pool.ts      — Concurrent FFmpeg process management
    ramdisk.ts         — Storage path management
    store.ts           — Persistent JSON store (workspaces, channels, seen-videos)
    system.ts          — System stats collector (GPU, RAM, workers)
    websub.ts          — [ĐÃ XÓA] WebSub server — không còn dùng

src/app/               — Next.js App Router
  page.tsx             — Dashboard (3-pane layout)
  layout.tsx           — Root layout
  globals.css          — Tailwind v3 + custom styles
  components/
    Sidebar.tsx         — Navigation + System Monitor
    WorkspaceQueue.tsx  — Video workspace list (grouped by status)
    WorkspaceCard.tsx   — Individual workspace card
    DetailEditor.tsx    — Editor panel (trim, speed, background, overlay, export)
    RenderQueueBar.tsx  — Floating render queue (bottom)
  lib/
    store.ts            — Zustand (flat state)
    ipc.ts              — IPC client wrapper
    constants.ts        — Theme colors, speed config
    types.ts            — TypeScript types

HYPERCLIP_RULES.md     — File này — source of truth
```

---

## 7. Metadata Format (Frontend ↔ Backend)

```json
{
  "workspace_id": "ws-...",
  "source_video": "path/to/video.mp4",
  "blur_background": "path/to/blur.jpg",
  "export_resolution": "1080x1920",
  "video_speed": 1.1,
  "fps_target": 30,
  "overlays": [{ "type": "image", "src": "...", "y": 100, "x": 0 }],
  "trim": { "start": 0, "end": 600 }
}
```

---

## 8. Commands

```bash
npm run dev          # Next.js dev server (localhost:3000)
npm run electron:dev # Dev: Next.js + Electron window
npm run electron:build  # Production .exe
```

**Build fix:** `.next` cache corrupt → `Remove-Item -Recurse -Force .next`

---

## 9. UI Rules

- Layout: 3-pane (Sidebar 220px | Center (flex-1) | Right Editor)
- Theme: Background `#121212`, Accent `#00B4FF`, `#00FF88`
- Flat design: NO shadows, NO gradients, NO decorative UI
- Font: Inter
- **`use client`** là bắt buộc cho mọi React component trong `src/app/`

---

## 10. IPC Protocol

### Renderer → Main (invoke)
- `tracker:add/remove/list` — YouTube tracker management
- `workspace:list/update/delete` — Workspace CRUD
- `render:start/cancel/chunked` — FFmpeg render control
- `system:stats` — System stats
- `channel:list/add/update/remove` — Channel CRUD
- `poller:status` — YouTubePoller state (active, cookies, errors)
- `settings:get/update` — App settings

### Main → Renderer (events)
- `workspace:update-event` — Workspace state changed
- `render:progress-event` — FFmpeg render progress
- `system:stats-update` — Periodic system stats
- `notification` — Toast notification
- `autodownload` — New video auto-downloaded

---

## 11. Đã xóa / Dead code

| File/Code | Lý do |
|-----------|-------|
| `electron/services/websub.ts` | WebSub không còn dùng — polling thay thế |
| `startCloudflaredTunnel()` | Không cần tunnel nữa |
| `createWebSubServer()` | Không cần WebSub server nữa |
| `resubscribeAll()` | Không cần WebSub subscription nữa |
| `pollChannelsForNewVideos()` | RSS per-channel đã xóa |
| `WEBSUB_PORT` | Không còn WebSub |
| `ChannelSubscription` type | Chỉ dùng cho WebSub |

---

## 12. Ngày cập nhật: 2026-04-24
