# HyperClip — Quy tắc & Kiến trúc

> Tài liệu này là **source of truth**. Mọi file spec khác (dashboard-design.md, memory files) phải nhất quán với file này.

---

## 1. Mục tiêu cốt lõi

**Bắt 100% video mới trong < 5 giây, chạy 24/7 cho ~100 kênh YouTube.**

### NGUYÊN LÝ HOẠT ĐỘNG CỐT LÕI (ĐỂ ĐẠT ĐƯỢC MỤC TIÊU TRÊN)
Để đảm bảo yêu cầu này hoạt động hoàn hảo mà không bị sập hệ thống hay bị Google chặn, dự án bắt buộc tuân theo 4 nguyên lý sống còn sau:

1. **Quét liên tục bằng YouTube Data API v3 (4 Projects):** Dùng 4 Google Cloud projects riêng biệt, mỗi project có 1 OAuth client + 1 API key = 10.000 units/ngày. Tổng 40.000 units/ngày → poll mỗi ~2.2s. `activities?home=true` = 1 unit/call → 4s poll = 21.600 units/ngày (54% quota/project). **OAuth Client ID và API Key phải cùng project.** Token + key được pair theo projectId. Fallback playlistItems chỉ chạy khi có HTTP error thực sự (không phải khi feed trống).
2. **Khắt khe về thời gian (Strict 10-Min Window):** Chỉ bắt và đưa vào luồng xử lý các video vừa được tải lên trong vòng **10 phút** trở lại. Bỏ qua toàn bộ video cũ hơn để đảm bảo hệ thống không bị thắt cổ chai (bottleneck) khi khởi động lại.
3. **Tải xuống siêu tốc (High-Speed Ingestion):** Sử dụng `yt-dlp` với cấu hình Direct IP (bỏ qua VPN) để kéo luồng video nhanh nhất có thể. Dữ liệu thô ưu tiên đẩy qua RAM Disk (10GB/s I/O), hạn chế tối đa ghi lên HDD/SSD.
4. **Render ép phần cứng (Hardware-Forced Render):** Toàn bộ việc xuất video phải được đẩy qua GPU (FFmpeg + NVENC của card NVIDIA). Tuyệt đối không dùng CPU (x264 software) để đảm bảo thời gian xuất video luôn < 2 phút.

---

## 2. Pipeline (5 tầng)

| # | Tầng | Công nghệ | Target |
|---|-------|-----------|--------|
| 1 | **Trigger** | YouTube Data API 4s (4 Keys) | < 5s |
| 2 | **Download** | yt-dlp + Direct IP Binding (bypass VPN) | < 30s |
| 3 | **Pre-process** | Static blur (1 frame, cache vĩnh viễn) | < 3s |
| 4 | **Edit** | React-Konva Canvas 2D (60fps) | < 16ms/frame |
| 5 | **Render** | FFmpeg + NVENC (RTX 5080) | < 2 phút |

---

## 3. Auto-Ingestion — Subscription Feed Detection (Tầng 1)

### Cơ chế — 2 chế độ

**Chế độ 1 (Real-time, ~4s):** YouTube Data API v3 via OAuth Bearer Token

```
YouTubePoller (4s jitter)
         ↓
activities?home=true (1 unit, OAuth Bearer) — personalized feed
         ↓
parse videos → filter age < 1 min
         ↓
autoDownloadFromWebSub()
         ↓
Workspace → Download → Blur → Notify
```

**Fallback:** playlistItems per 50 channels batch (100 units/poll)
→ Triggered when activities returns 0 videos for 2 consecutive polls
→ Throttled to max 1 run per 5 min

### Lý do không dùng RSS
YouTube feed indexing có độ trễ **5-30 phút** — dù polling bao nhiêu lần cũng không nhận video mới trong khoảng thời gian này. RSS không phải giải pháp.

### Lý do không dùng activities?mine=true
`activities?mine=true&type=upload` chỉ trả về **uploads của chính tài khoản OAuth**, không phải subscribed channels. Subscription notification items trong feed có thumbnail = channel avatar (không chứa videoId).

### Authentication Model
- **OAuth 2.0 Bearer Token**: YouTube Data API v3 — authenticates API calls
- **No browser cookies needed**: OAuth token handles API authentication
- **CookieManager**: OAuth token verification (no browser extraction)
- **yt-dlp**: Uses OAuth for downloads (via `--no-playlist` + API auth)

### Quy tắc Lọc Video (Chống nghẽn hệ thống)

1. **Giới hạn thời gian (1 phút)**: CHỈ tải và tự động xử lý các video vừa được upload trong vòng **1 phút** trở lại đây.
2. **Bỏ qua video cũ**: Bỏ qua toàn bộ các video cũ hơn 1 phút để tránh gây quá tải/tắc nghẽn hàng đợi (Queue) khi có quá nhiều kênh, đặc biệt là lúc app vừa khởi động lại.

### 3 thủ thuật chống Bot Detection

1. **Browser Fingerprinting**: Full headers (`User-Agent`, `X-YouTube-Client-Name`, `X-YouTube-Client-Version`, `Sec-Fetch-*`)
2. **Jitter Delay**: Random 4-8s thay vì chính xác 4s (mimics human browsing)
3. **Keep-Alive**: reuse TCP connection — không tạo connection mới mỗi poll

### Setup 4 Projects

Mỗi project cần: YouTube Data API v3 enabled, 1 OAuth Client ID, 1 API Key.

| Project | projectId | OAuth Client | API Key | Quota |
|---------|----------|-------------|---------|-------|
| Cloud Project 1 | proj-01 | credentials + authorize | API key 01 | 10k units/ngày |
| Cloud Project 2 | proj-02 | credentials + authorize | API key 02 | 10k units/ngày |
| Cloud Project 3 | proj-03 | credentials + authorize | API key 03 | 10k units/ngày |
| Cloud Project 4 | proj-04 | credentials + authorize | API key 04 | 10k units/ngày |

→ **Total: 40,000 units/ngày → poll mỗi ~2.2s**

**⚠️ Ràng buộc quan trọng:** OAuth Client ID và API Key phải cùng 1 Google Cloud project. Không dùng chéo credentials giữa các project (lỗi 400: "API Key and authentication credential are from different projects").

### File quan trọng

| File | Vai trò |
|------|---------|
| `electron/services/key_manager.ts` | 4 API keys pool — quota tracking, getKeyForProject() |
| `electron/services/token_manager.ts` | 4 OAuth tokens — smart rotation, refresh, per-project token storage |
| `electron/services/subscription_feed.ts` | activities?home=true + cookies (primary) + playlistItems (fallback) |
| `electron/services/cookie_manager.ts` | OAuth token verification — no browser cookie extraction needed |
| `electron/services/youtube_poller.ts` | Orchestrator — subscription feed polling |
| `electron/main.ts` (`startYouTubePoller`) | Khởi tạo poller, wire callback |
| `electron/main.ts` (`autoDownloadFromWebSub`) | Tạo workspace + download + gen blur |

### Không dùng

- ~~WebSub / PubSubHubbub~~ — đã xóa (cần tunnel, phức tạp)
- ~~Cloudflare Tunnel~~ — đã xóa
- ~~1 OAuth client cho nhiều API keys~~ — lỗi "different projects"
- ~~4 API keys cùng 1 project~~ — quota vẫn chỉ 10k/ngày
- ~~RSS feeds~~ — YouTube indexing delay 5-30 phút
- ~~activities?mine=true~~ — chỉ trả uploads của user, không phải subscribed channels

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
| Video Processing | FFmpeg + NVIDIA NVENC |
| Auth | OAuth 2.0 (no browser cookies needed) |

### Hardware Target
- CPU: Intel Core Ultra 9 285K
- GPU: RTX 5080 16GB (NVENC)
- RAM: 64GB DDR5

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
    youtube_poller.ts   — Subscription feed poller (4s jitter)
    cookie_manager.ts   — OAuth token management (no browser cookies)
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
- `poller:status` — YouTubePoller state (active, OAuth ready, errors)
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

## 12. Phân công công nghệ — CHÍNH SÁCH BẮT BUỘC

> ⚠️ **ĐÂY LÀ NGUYÊN TẮC CỨNG. Không được phép vi phạm.**

### Công nghệ cho từng tác vụ

| Tác vụ | Công nghệ | Ghi chú |
|--------|-----------|---------|
| **Xác thực / Đăng nhập** | OAuth 2.0 (4 lần) | Mỗi project cần authorize 1 lần. Refresh token tự động. Credentials lưu trong `oauth_tokens.json`. |
| **Lấy danh sách kênh đăng ký** | YouTube Data API v3 (`/subscriptions`) | Chỉ gọi **1 lần** khi setup → lưu vào store. **KHÔNG gọi lại** sau khi setup xong. |
| **Phát hiện video mới** | **Primary:** YouTube Data API v3 (`activities?home=true`) | 4s poll interval. 4 projects × 10k units = 40k units/ngày. TokenManager smart rotation. |
|  | **Fallback:** playlistItems per 50 channels | 100 units/poll. Triggered after 2 empty polls. Throttled 5 min. |
| **Download video** | yt-dlp + OAuth auth | Direct IP binding, bypass VPN. |
| **Render video** | FFmpeg + NVENC (RTX 5080) | Hardware encode, KHÔNG x264. |

### ⚠️ SAI SAI — Tuyệt đối không làm

- **KHÔNG dùng OAuth client từ project khác với API key** — lỗi 400 "API Key and authentication credential are from different projects". Token và key phải cùng project.
- **KHÔNG dùng chung 1 OAuth token cho nhiều projects** — mỗi project cần token riêng.
- **KHÔNG gọi Data API không có OAuth** — cần OAuth token để truy cập subscription feed.

### Luồng dữ liệu đúng

```
App khởi động
  ├─ Load OAuth tokens từ oauth_tokens.json (4 projects)
  ├─ Load API keys từ api_keys.json (4 keys)
  ├─ Data API: fetch subscriptions → lưu vào store (1 LẦN)
  └─ Poller loop (4s jitter)
        ├─ tokenManager.getBestAvailable() → token có quota dư nhiều nhất
        ├─ keyManager.getKeyForProject(projectId) → key cùng project
        ├─ fetchSubscriptionFeed() → activities?home=true (1 unit)
        │     ├─ Videos found → auto-download
        │     ├─ Empty feed → return (normal, no fallback)
        │     └─ HTTP error (quota/403) → playlistItems fallback (5 units)
        └─ (Fallback chỉ chạy khi có lỗi thực sự)
```

### Khi nào được gọi Data API

- ✅ Lần đầu app khởi động: lấy channel list từ subscriptions
- ✅ Polling định kỳ: `activities?home=true` mỗi 4s (dùng 4 projects)
- ✅ Fallback: `playlistItems` per channel khi activities có HTTP error (quota/403/rateLimit)
- ❌ KHÔNG dùng chéo OAuth token và API key từ project khác nhau

---

## 13. Render Pipeline — RTX 5080 Optimization

> **Source of truth cho tất cả render optimizations.**
> Plan chi tiết: `C:\Users\MSI\.claude\plans\render-optimization-phases.md`

### Đã implement (2026-04-27)

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

### NVENC params cho RTX 5080

**Chunked (GPU MAX):**
```bash
-c:v hevc_nvenc/h264_nvenc
-preset p1
-rc vbr
-cq 26/22
-tune ull
-bf 0 -refs 1 -g 60
-rc-lookahead 0
-spatial-aq 1 -aq-strength 8
```

**Single render:**
```bash
-c:v hevc_nvenc/h264_nvenc
-preset p1
-rc vbr
-cq 28/23
-tune hq
-bf 0 -refs 1 -g 60
-rc-lookahead 16
-spatial-aq 1
```

### GPU tier worker config

| GPU | Tier | Workers | Chunk duration | Min chunk |
|-----|------|---------|---------------|-----------|
| RTX 5080 / RTX 4090 | `high` | 8 | 120s | 10s |
| RTX 4080 / RTX 4070 | `high` | 8 | 120s | 10s |
| RTX 3080 / RTX 3060 | `mid` | 4 | 30s | 5s |
| RTX 2080 / RTX 2070 | `mid` | 4 | 30s | 5s |
| Card thấp hơn | `low` | 2 | 30s | 5s |

### Render time targets

| Resolution | Speed | GPU | Target | Realistic |
|------------|-------|-----|--------|-----------|
| 1080p | 1.0x | RTX 5080 | 30s | ~2.5 phút |
| 1080p | 1.1x | RTX 5080 | 30s | ~2.3 phút |
| **720p** | **1.1x** | **RTX 5080** | **30s** | **~25-28s ✅** |
| **720p** | **1.2x** | **RTX 5080** | **30s** | **~25s ✅** |
| 720p | 1.1x | RTX 3060 | 30s | ~40s |
| **360p** | **1.1x** | **RTX 5080** | **30s** | **~13s ✅** |
| 360p | 1.1x | RTX 3060 | 30s | ~25s |

**Ghi chú:**
- 1080p: Decode bottleneck ~40s (NVDEC đã max hardware limit). Không thể < 30s.
- 720p + 1.1x + RTX 5080: Đạt ~28s, rất gần target. Cần Phase 1 (`-delay 0 -surfaces 32`).
- 720p + 1.2x + RTX 5080: Đạt ~25s, vượt target.

### Còn thiếu (xem plan phases)

**Phase 1:** Thêm `-delay 0 -surfaces 32 -extra_hw_frames 3` cho NVENC — giảm ~2-3s.
**Phase 2:** Multi-process parallel filter — không cần implement trừ khi cần cho 1080p.
**Phase 3:** Decode batch optimization (`-fps_mode cfr`).

### File chính

| File | Vai trò |
|------|---------|
| `electron/services/ffmpeg.ts` | Render engine — tất cả FFmpeg calls |
| `electron/services/worker-pool.ts` | Worker pool + `chunkPool` |
| `electron/services/system.ts` | GPU tier detection + `getGPUCapabilities()` |
| `electron/main.ts` | GPU-aware config injection |

---

## 14. Ngày cập nhật: 2026-04-27
