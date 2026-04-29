# HyperClip — Quy tắc & Kiến trúc

> Tài liệu này là **source of truth**. Mọi file spec khác (dashboard-design.md, memory files) phải nhất quán với file này.

---

## 1. Mục tiêu cốt lõi

**Bắt 100% video mới trong < 20 giây, chạy 24/7 cho ~100 kênh YouTube.**

### NGUYÊN LÝ HOẠT ĐỘNG CỐT LÕI (ĐỂ ĐẠT ĐƯỢC MỤC TIÊU TRÊN)

1. **Quét full scan bằng YouTube Data API v3 (Nhiều Projects):** Mỗi poll check TẤT CẢ kênh (100 kênh × 2 units = 200 units/poll). Mỗi project = 10,000 units/ngày. Poll interval 20s.
2. **Strict 1-Min Window:** Chỉ tải video upload trong vòng **1 phút** trở lại.
3. **Tải xuống siêu tốc:** yt-dlp + Direct IP binding, RAM Disk.
4. **Render ép phần cứng:** FFmpeg + NVENC (RTX 5080), không x264.

---

## 2. Pipeline (5 tầng)

| # | Tầng | Công nghệ | Target |
|---|-------|-----------|--------|
| 1 | **Trigger** | YouTube Data API 20s (N Keys) | < 20s |
| 2 | **Download** | yt-dlp + Direct IP Binding (bypass VPN) | < 30s |
| 3 | **Pre-process** | Static blur (1 frame, cache vĩnh viễn) | < 3s |
| 4 | **Edit** | React-Konva Canvas 2D (60fps) | < 16ms/frame |
| 5 | **Render** | FFmpeg + NVENC (RTX 5080) | < 2 phút |

---

## 3. Auto-Ingestion — Subscription Feed Detection (Tầng 1)

### Cơ chế: Full Scan mỗi Poll

```
YouTubePoller (20s)
         ↓
fetchSubscriptionFeed() → ALL channels (parallel, max 20 concurrent)
         ↓
Mỗi channel: channels API (1 unit) → uploads playlist ID
              playlistItems (1 unit) → latest 5 videos
         ↓
Filter: age < 1 min, unseen, not deleted
         ↓
autoDownload()
```

### Quota Math (20s poll, 100 kênh)

| Thông số | Giá trị |
|----------|---------|
| Số kênh | 100 |
| Units/channel | 2 (channels + playlistItems) |
| Units/poll | 200 |
| Poll interval | 20s |
| Polls/ngày | 4,320 |
| **Total units/ngày** | **864,000** |
| 1 project | 10,000 units |
| **Projects cần cho 100 kênh** | **87** |
| 30 projects → polls/ngày | 1,500 |
| 30 projects → poll interval | ~58s |
| 50 projects → polls/ngày | 2,500 |
| 50 projects → poll interval | ~35s |

### Cơ chế Key Rotation

- Mỗi API call: `getBestAvailable()` → chọn key có quota dư nhiều nhất
- Key gần hết quota (≥ 9,500 used) → tạm skip
- Tất cả keys hết quota → poll skip, đợi quota reset (midnight PT)
- Uploads playlist ID: cache 24h trong memory → tiết kiệm 1 API call/channel/poll

### Cơ chế Thêm Google Project

Settings cho phép thêm N Google project:
- Mỗi project = OAuth Client ID + OAuth Client Secret + API Key (từ cùng 1 project)
- Thêm project = quota tăng thêm 10,000 units/ngày → poll interval giảm
- Token + key phải cùng project — không dùng chéo

### Không dùng

- ~~WebSub / PubSubHubbub~~ — cần public URL
- ~~Cloudflare Tunnel~~ — đã xóa
- ~~activities?home=true~~ — **DEPRECATED** (Google đã xóa endpoint này)
- ~~RSS feeds~~ — YouTube indexing delay 5-30 phút
- ~~activities?mine=true~~ — chỉ trả uploads của chính tài khoản OAuth

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
| Downloader | yt-dlp + OAuth auth |
| Video Processing | FFmpeg + NVIDIA NVENC (RTX 5080) |
| Auth | OAuth 2.0 (N Google Cloud projects) |

---

## 5. Speed Rules

1. **RAM Disk cho video temp** — ~10GB/s I/O, video source không bao giờ đụng HDD
2. **Static Blur** — gen 1 frame blur, cache vĩnh viễn, render chỉ composite (0 GPU cost/render frame)
3. **Direct IP Binding** — yt-dlp bypass VPN để max bandwidth
4. **NVENC hardware encode** — KHÔNG x264 software. Dùng `hevc_nvenc`/`h264_nvenc`
5. **NVDEC GPU decode** — Dùng `hevc_cuvid`/`h264_cuvid` thay `-hwaccel cuda` để full hardware decode
6. **CUDA filter pipeline** — `-filter_hw_device cuda` để scale/pad/overlay chạy trên GPU
7. **Pre-render text overlay** — drawtext chạy 1 lần → PNG → overlay PNG mỗi frame (GPU fast)
8. **Trim optimization** — decode chỉ `outputDuration/speed` thay vì toàn bộ source
9. **Speed options** — 1.1x/1.2x encode ít frame hơn → decode + encode nhanh hơn
10. **Zustand flat state** — NO context cascade, chỉ re-render component cần

---

## 6. Cấu trúc thư mục

```
electron/
  main.ts              — Entry point, window, tray, IPC handlers, bootstrap
  preload.ts           — IPC bridge (window.electronAPI)
  ipc/
    channels.ts        — IPC channel constants
  services/
    youtube_poller.ts   — Subscription feed poller (20s jitter)
    cookie_manager.ts   — OAuth token management
    key_manager.ts      — API keys pool — quota tracking, dynamic CRUD
    token_manager.ts    — OAuth tokens — smart rotation, refresh, per-project storage
    subscription_feed.ts — Full scan all channels via playlistItems (parallel, 20 concurrent)
    youtube.ts          — yt-dlp wrapper (download, getVideoInfo, getChannelId)
    ffmpeg.ts           — FFmpeg + NVENC render pipeline
    ffmpeg-paths.ts     — FFmpeg binary resolution
    worker-pool.ts      — Concurrent FFmpeg process management
    ramdisk.ts          — Storage path management
    store.ts            — Persistent JSON store (workspaces, channels, seen-videos)
    system.ts           — System stats collector (GPU, RAM, workers)

src/app/               — Next.js App Router
  page.tsx             — Dashboard (3-pane layout)
  layout.tsx           — Root layout
  globals.css          — Tailwind v3 + custom styles
  components/
    Sidebar.tsx         — Navigation + System Monitor
    WorkspaceQueue.tsx  — Video workspace list (grouped by status)
    WorkspaceCard.tsx   — Individual workspace card
    DetailEditor.tsx    — Editor panel (trim, speed, background, overlay, export)
    RenderQueueBar.tsx   — Floating render queue (bottom)
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
- `poller:status` — YouTubePoller state (active, channel count, errors)
- `settings:get/update` — App settings
- `key:list/add/remove/reset` — API key management (dynamic)
- `auth:oauth-start/set-creds/get-creds` — OAuth flow per project

### Main → Renderer (events)
- `workspace:update-event` — Workspace state changed
- `render:progress-event` — FFmpeg render progress
- `system:stats-update` — Periodic system stats (5s)
- `notification` — Toast notification
- `autodownload` — New video auto-downloaded
- `channel:synced-event` — Subscription list synced (15 min interval)

---

## 11. Đã xóa / Dead code

| File/Code | Lý do |
|-----------|--------|
| `electron/services/websub.ts` | WebSub không còn dùng — polling thay thế |
| `startCloudflaredTunnel()` | Không cần tunnel nữa |
| `activities?home=true` | DEPRECATED by Google — xóa hoàn toàn |

---

## 12. Phân công công nghệ — CHÍNH SÁCH BẮT BUỘC

> ⚠️ **ĐÂY LÀ NGUYÊN TẮC CỨNG. Không được phép vi phạm.**

### Công nghệ cho từng tác vụ

| Tác vụ | Công nghệ | Ghi chú |
|--------|-----------|---------|
| **Xác thực / Đăng nhập** | OAuth 2.0 (N lần, mỗi project 1 lần) | Refresh token tự động. Credentials lưu trong `oauth_tokens.json`. |
| **Lấy danh sách kênh đăng ký** | YouTube Data API v3 (`/subscriptions`) | Chỉ gọi **1 lần** khi setup → lưu vào store. **KHÔNG gọi lại** sau khi setup xong. |
| **Phát hiện video mới** | **playlistItems per ALL channels** (full scan mỗi poll) | 200 units/poll (100 kênh × 2). N projects × 10k units = quota pool. |
| **Download video** | yt-dlp + OAuth auth | Direct IP binding, bypass VPN. |
| **Render video** | FFmpeg + NVENC (RTX 5080) | Hardware encode, KHÔNG x264. |

### Settings — Quản lý Google Projects

Settings page cho phép:
- **Thêm Google project**: nhập OAuth Client ID + Client Secret + API Key (cùng 1 project)
- **Xem quota per project**: usedToday / 10,000 units, % sử dụng, status
- **Reset quota per project**: xóa stats của 1 project cụ thể
- **Reset tất cả quota**: clear all key_stats.json
- **Xóa project**: remove key + token khỏi pool

### Luồng dữ liệu đúng

```
App khởi động
  ├─ Load OAuth tokens từ oauth_tokens.json (N projects)
  ├─ Load API keys từ api_keys.json (N keys)
  ├─ Data API: fetch subscriptions → lưu vào store (1 LẦN)
  └─ Poller loop (20s jitter)
        ├─ getBestAvailable() → key+token có quota dư nhiều nhất
        ├─ parallel fetch: ALL channels (20 concurrent)
        │     ├─ channels API → uploads playlist ID (cache 24h)
        │     └─ playlistItems → latest 5 videos
        ├─ Filter: age < 1 min, unseen, not deleted
        └─ autoDownload()
```

### Key Facts

- ✅ activities?home=true **DEPRECATED** — không dùng nữa
- ✅ playlistItems per channel là **ONLY WORKING METHOD**
- ✅ Full scan = check TẤT CẢ kênh mỗi poll
- ✅ Key rotation = mỗi API call dùng key có quota dư nhiều nhất
- ✅ Uploads playlist ID cache 24h → tiết kiệm 1 call/channel/poll
- ✅ N projects = N × 10,000 units quota

---

## 13. Render Pipeline — RTX 5080 Optimization

### Đã implement

| # | Optimization | FFmpeg flags | Impact |
|---|-------------|--------------|--------|
| 1 | NVDEC GPU decode | `-c:v hevc_cuvid/h264_cuvid` | Decode ~2x faster |
| 2 | CUDA filter pipeline | `-filter_hw_device cuda` | Filter ~3x faster |
| 3 | Pre-render text overlay | PNG thay `drawtext` CPU | Xóa CPU bottleneck |
| 4 | B-frames off | `-bf 0 -refs 1 -g 60` | Encode ~20% faster |
| 5 | Trim optimization | decode `= outputDuration / speed` | Decode ít hơn ~5-16% |
| 6 | Smart keyframe detection | seek ±2s thay scan toàn file | Scan ~5x nhanh |
| 7 | GPU tier detection | RTX 50/40=`high`(8w), RTX30=`mid`(4w) | Worker count đúng |
| 8 | Multi-thread filter | `-threads 8 -filter_threads 16` | Parallel CUDA filters |
| 9 | Chunked 120s (RTX 5080) | `chunkDuration=120, workers=8` | Less overhead |
| 10 | Async NVENC | `-rc-lookahead 0 -tune ull` | Max encode throughput |

---

## 14. Ngày cập nhật: 2026-04-29
