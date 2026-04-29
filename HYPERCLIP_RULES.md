# HyperClip — Quy tắc & Kiến trúc

> Tài liệu này là **source of truth**. Mọi file spec khác (dashboard-design.md, memory files) phải nhất quán với file này.

---

## 1. Mục tiêu cốt lõi

**Bắt 100% video mới trong < 20 giây, chạy 24/7 cho ~100 kênh YouTube.**

### NGUYÊN LÝ HOẠT ĐỘNG CỐT LÕI (ĐỂ ĐẠT ĐƯỢC MỤC TIÊU TRÊN)

1. **Detection: Innertube API via Chrome Session Cookies (NO QUOTA LIMIT):**
   - 30 dedicated Chrome profiles — user logs in YouTube once per profile
   - Extract SAPISID + __Secure-1PSID cookies via DPAPI (Windows) + sql.js (SQLite)
   - SAPISIDHASH = SHA1(timestamp + " " + SAPISID + " " + "https://www.youtube.com") header
   - YouTube Innertube API (`/youtubei/v1/browse`) — no 10k/day quota limit
   - Fallback: Data API v3 OAuth (10k units/day) nếu Innertube trả 0 video
2. **Strict 10-Min Window:** Chỉ tải video upload trong vòng **10 phút** trở lại.
3. **Tải xuống siêu tốc:** yt-dlp + `--download-sections *00:00:00-MM:SS` (chỉ tải đúng số phút cần thiết), Direct IP binding.
4. **Render ép phần cứng:** FFmpeg + NVENC (RTX 5080), không x264.

---

## 2. Pipeline (5 tầng)

| # | Tầng | Công nghệ | Target |
|---|-------|-----------|--------|
| 1 | **Trigger** | Innertube API (30 Chrome sessions) + OAuth fallback | < 20s |
| 2 | **Download** | yt-dlp + `--download-sections` (chỉ tải N phút) + Direct IP Binding | < 30s |
| 3 | **Pre-process** | Static blur (1 frame, cache vĩnh viễn) | < 3s |
| 4 | **Edit** | React-Konva Canvas 2D (60fps) | < 16ms/frame |
| 5 | **Render** | FFmpeg + NVENC (RTX 5080) | < 2 phút |

---

## 3. Auto-Ingestion — Subscription Feed Detection (Tầng 1)

### Cơ chế: Full Scan mỗi Poll

```
YouTubePoller (4 giây ± jitter)
         ↓
fetchSubscriptionFeed() → ALL channels (parallel, max 20 concurrent)
         ↓
1. Innertube API (SAPISIDHASH cookies): /youtubei/v1/browse per channel
   → OAuth Data API v3 fallback (10k units/day) nếu Innertube trả 0 video
         ↓
Filter: age < 10 min, unseen, not deleted
         ↓
autoDownload() → yt-dlp --download-sections (chỉ N phút cần thiết)
```

### Chi tiết Quota System

Hệ thống có **hai lớp quota độc lập**, chạy song song:

#### Lớp 1 — TokenManager (OAuth tokens, 10,000 units/project/ngày)

Dùng cho **OAuth Data API v3** — fallback path.

| Thông số | Giá trị |
|----------|---------|
| Cap per project | **9,500 units/ngày** (500 buffer so với 10k limit thực) |
| Reset | Mỗi 24h tự clear stats (kiểm tra khi app khởi động) |
| Track | Mỗi lần gọi playlistItems → `track(projectId)` tăng `usedToday` |
| Rotation | Chọn token có `usedToday` thấp nhất (most quota remaining) |
| Error threshold | **3 lỗi liên tiếp** → token bị skip |
| Storage | `%APPDATA%/HyperClip/token_stats.json` |

**TokenManager chỉ dùng khi Innertube trả 0 video.**

#### Lớp 2 — KeyManager (API keys, 10,000 units/key/ngày)

Dùng cho **API key-based** calls. Hiện tại **chưa được dùng trực tiếp** trong subscription_feed — chỉ load sẵn cho tương lai.

| Thông số | Giá trị |
|----------|---------|
| Cap per key | **9,500 units/ngày** |
| Storage | `%APPDATA%/HyperClip/key_stats.json` |

#### Tại sao có 2 lớp?

```
1 Google Cloud Project = 1 OAuth Token + 1 API Key = 1 "nhà"
30 GCP projects × 10,000 units = 300,000 units/ngày (nếu dùng hết)
```

Trong kiến trúc hiện tại, **KeyManager chưa được dùng** vì:
- Innertube (cookie-based) là primary → **không tốn quota**
- OAuth là fallback → dùng **TokenManager** (token-based, không cần key)

### Innertube — Chi tiết kỹ thuật

#### Innertube là gì?

Innertube là **API nội bộ của YouTube** — cùng API mà trình duyệt Chrome dùng khi bạn mở youtube.com. Khác với Data API v3 (dành cho developers), Innertube không có giới hạn quota published.

```
Data API v3:    https://googleapis.com/youtube/v3/*     → CÓ quota (10k/day)
Innertube API:   https://www.youtube.com/youtubei/v1/*  → KHÔNG quota
```

#### Cookie cần thiết

Để gọi Innertube, app cần đọc cookies từ Chrome profiles đã đăng nhập YouTube:

| Cookie | Vai trò |
|--------|---------|
| `SAPISID` | Cookie bảo mật cao — dùng để tạo SAPISIDHASH header |
| `__Secure-1PSID` | Session ID — xác minh user đã đăng nhập |
| `__Secure-1PSIDCC` | Certificate cookie — cần cho một số requests |
| `__Secure-1PSIDTS` | Timestamp cookie — chống replay attack |
| `SOCS` | Consent cookie — `CAI` = đồng ý quảng cáo cá nhân |

#### SAPISIDHASH — Cách xác minh

Google không chỉ đọc cookie — nó cần một hash đặc biệt:

```
SAPISIDHASH = SHA1(timestamp + " " + SAPISID + " " + "https://www.youtube.com")
Ví dụ: "1745984000_abc123def456..." (timestamp_hash)
```

Header gửi kèm request:
```
Authorization: SAPISIDHASH 1745984000_abc123def456...
Cookie: SAPISID=...; __Secure-1PSID=...; __Secure-1PSIDTS=...; SOCS=CAI
```

### Khi nào Innertube LỖI?

**Nguyên tắc quan trọng:** Innertube chỉ trigger OAuth fallback khi **trả về 0 video** (không phải khi HTTP error).

| Nguyên nhân | Hành vi hiện tại | Cần làm gì? |
|---|---|---|
| **Lỗi mạng / timeout** | Request fail → 0 video → OAuth fallback | Tự hết khi mạng khôi phục |
| **Session die (PSID/SAPISID hết hạn)** | Cookies null → skip Innertube → OAuth fallback | User đăng nhập lại Chrome profile |
| **SOCS thay đổi** | YouTube trả kết quả khác (non-personalized) | Không ảnh hưởng video detection |
| **Session revoke (đổi mật khẩu)** | Cookies invalid → skip Innertube → OAuth | User đăng nhập lại TẤT CẢ 30 profiles |
| **User đăng xuất Chrome profile** | Cookies null → skip Innertube → OAuth | User đăng nhập lại profile đó |
| **YouTube đổi response format** | Parse fail → 0 video → OAuth fallback | Cập nhật code parse |
| **IP bị rate limit Innertube** | HTTP 429 → skip → OAuth | Giảm poll interval hoặc chờ |

#### Minh họa fallback chain trong code

```typescript
// subscription_feed.ts — fetchChannelVideos()
async function fetchChannelVideos(ch, seenVideoIds, sinceMs) {
  // Bước 1: Thử Innertube (cookie-based, NO quota)
  const session = sm.getNextSession() // round-robin 30 profiles
  if (session?.cookies) {
    const browseJson = await apiGetInnertube(channelId, session)
    const videos = parseInnertubePlaylistVideos(...)
    if (videos.length > 0) {
      return videos  // ✓ Innertube thành công — KHÔNG tốn quota
    }
    // Innertube trả 0 video — chuyển sang OAuth
  }

  // Bước 2: OAuth fallback (tốn quota)
  const best = await tm.getBestAvailable() // smart rotation
  const playlistJson = await apiGetOAuth(..., best.token)
  tm.track(best.projectId)  // trừ quota
  // ... parse videos
}
```

### Quota Math thực tế

| Kịch bản | Innertube reliability | OAuth calls/ngày | Units/ngày |
|---------|----------------------|-------------------|-----------|
| Innertube 100% | 100% | 0 | 0 |
| Innertube 95% | Thỉnh thoảng 0 video | ~2,160 | ~2,160 |
| Innertube 50% | Nửa số poll thất bại | ~21,600 | ~21,600 |
| Innertube 0% | Tất cả → OAuth | ~43,200 | ~43,200 |

Với 300,000 units (30 GCP projects × 10,000), ngay cả khi Innertube hoàn toàn fail, vẫn còn **thặng dư quota gấp ~7 lần** nhu cầu thực tế.

**Kết luận:** Với Innertube là primary path và >50% reliability, OAuth quota gần như không bao giờ hết. Mục tiêu tối ưu: **đảm bảo Innertube cookie sessions ổn định** thay vì thêm nhiều GCP projects.

### Trim Limit (auto-download)

- User cấu hình số phút trim (default: 10 phút)
- yt-dlp dùng `--download-sections *00:00:00-MM:SS` — chỉ tải đúng N phút đầu
- Video ngắn hơn trim → yt-dlp tải hết video (không lỗi)
- Auto-download dùng `defaultTrimLimit` từ settings

### Cơ chế Thêm Google Project (OAuth fallback)

Settings cho phép thêm N Google project (OAuth + API Key):
- Mỗi project = 10,000 units/ngày (OAuth fallback path)
- Token + key phải cùng project — không dùng chéo
- OAuth tokens lưu trong `oauth_tokens.json` (multi-project array format)

### Chrome Sessions Management (Settings UI)

Settings page → Chrome Sessions section:
- Danh sách 30 profiles (HyperClip-Chrome-Profile-{1..30})
- Nút "+ Mở Chrome login" → launch Chrome với profile để user đăng nhập
- Sau khi login, cookies được extract tự động (DPAPI + sql.js)
- SOCS cookie: `CAI` = đã accept consent

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
| **Phát hiện video mới (PRIMARY)** | **Innertube API via Chrome Session Cookies** | 30 Chrome profiles → SAPISIDHASH → Innertube `/youtubei/v1/browse`. NO QUOTA LIMIT. |
| **Phát hiện video mới (FALLBACK)** | Data API v3 OAuth playlistItems per channel | 10k units/day — chỉ dùng khi Innertube trả 0 video |
| **Download video** | yt-dlp + OAuth auth + `--download-sections` | Trim chỉ N phút (user config), bypass VPN. |
| **Render video** | FFmpeg + NVENC (RTX 5080) | Hardware encode, KHÔNG x264. |

### Settings — Quản lý Chrome Sessions + Google Projects

**Chrome Sessions section** (Innertube primary):
- 30 HyperClip Chrome profiles — user đăng nhập YouTube 1 lần per profile
- Nút "Mở Chrome login" để mở Chrome với profile chưa có cookies
- Cookie extraction: DPAPI (Windows) + sql.js (SQLite) → SOCS cookie phải là CAI

**Google Projects section** (OAuth fallback):
- Thêm project: OAuth Client ID + Client Secret + API Key
- Xem quota per project: usedToday / 10,000 units
- OAuth tokens lưu multi-project array format (KHÔNG overwrite khi add project mới)

### Luồng dữ liệu đúng

```
App khởi động
  ├─ Load OAuth tokens từ oauth_tokens.json (N projects)
  ├─ Load API keys từ api_keys.json (N keys)
  ├─ Chrome: extract session cookies từ 30 profiles (DPAPI + sql.js)
  ├─ Data API: fetch subscriptions → lưu vào store (1 LẦN)
  └─ Poller loop (20s jitter)
        ├─ Innertube API (primary, NO quota) per channel
        │     └─ Fallback: OAuth playlistItems per channel
        ├─ Filter: age < 10 min, unseen, not deleted
        └─ autoDownload() → yt-dlp --download-sections (defaultTrimLimit minutes)
```

### Key Facts

- ✅ activities?home=true **DEPRECATED** — không dùng nữa
- ✅ playlistItems per channel là **ONLY WORKING METHOD** cho OAuth fallback
- ✅ Innertube API (session cookies) = **NO QUOTA LIMIT** cho detection
- ✅ Full scan = check TẤT CẢ kênh mỗi poll (Innertube primary, OAuth fallback)
- ✅ Uploads playlist ID cache 24h → tiết kiệm 1 call/channel/poll
- ✅ OAuth Data API v3 = fallback path (10k units/day) — không phải primary
- ✅ trimLimit numeric (phút) thay vì '5min'/'10min'/'full'
- ✅ Auto-download dùng `defaultTrimLimit` từ settings (default: 10 phút)
- ✅ SAPISIDHASH = SHA1(timestamp + " " + SAPISID + " " + "https://www.youtube.com")

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
