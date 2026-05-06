# HyperClip — Quy tắc & Kiến trúc

> Tài liệu này là **source of truth**. Mọi file spec khác (dashboard-design.md, memory files) phải nhất quán với file này.

---

## 1. Mục tiêu cốt lõi

**Bắt 100% video mới trong < 10 giây, chạy 24/7 cho ~100 kênh YouTube.**

### NGUYÊN LÝ HOẠT ĐỘNG CỐT LÕI (ĐỂ ĐẠT ĐƯỢC MỤC TIÊU TRÊN)

1. **Detection: Innertube (youtubei.js) PRIMARY — no quota limit:**
   - Uses 30 Chrome sessions as cookie source (ChromeSessionManager)
   - youtubei.js → Innertube API → no quota, ~200ms/request
   - Full scan all channels per poll (5 concurrent)
   - Early termination once 5 new videos found
   - OAuth Data API v3 only as **fallback** (when Innertube pool has 0 ready sessions)
2. **Auto-download Window: 30 phút** — chỉ tải video upload trong vòng 30 phút trở lại (cho yt-dlp trim). Không block detection.
3. **Tải xuống siêu tốc:** yt-dlp + `--download-sections *00:00:00-MM:SS` (chỉ tải đúng số phút cần thiết), Direct IP binding.
4. **Render ép phần cứng:** FFmpeg + NVENC (GPU), không x264.

---

## 2. Pipeline (5 tầng)

| # | Tầng | Công nghệ | Target |
|---|-------|-----------|--------|
| 1 | **Trigger** | Innertube (youtubei.js) + OAuth fallback (TokenManager) | < 5s |
| 2 | **Download** | yt-dlp + `--download-sections` (chỉ tải N phút) + Direct IP Binding | < 30s |
| 3 | **Pre-process** | Static blur (1 frame, cache vĩnh viễn) | < 3s |
| 4 | **Edit** | React-Konva Canvas 2D (60fps) | < 16ms/frame |
| 5 | **Render** | FFmpeg + NVENC (GPU) | < 2 phút |

---

## 3. Auto-Ingestion — Subscription Feed Detection (Tầng 1)

### Cơ chế: Full Scan mỗi Poll (5s)

```
YouTubePoller (5 giây ± 0.5s jitter)
         ↓
fetchSubscriptionFeed() → ALL channels (parallel, 5 concurrent)
         ↓
1. Innertube (youtubei.js) — PRIMARY (no quota)
   → getInnertubePool() → 30 pre-warmed Innertube clients (from Chrome sessions)
   → Round-robin across sessions, 10s cooldown on error
   → getChannel(channelId) → getVideos() → getLatestVideo(channelId) → check top-1 dedup + age ≤ 10 min
         ↓ (khi all sessions fail)
2. OAuth Data API v3 — FALLBACK (quota: TokenManager, 10k/day/token)
   → getBestAvailable() → playlistItems per channel (maxResults=1)
   → Tracked: track(projectId) per channel, skip exhausted tokens
         ↓
Filter: unseen (seenVideoIds dedup), not deleted/private
  Tab order: trust YouTube Videos tab (newest-first). No age filter in Innertube path.
         ↓
autoDownload() → yt-dlp --download-sections (chỉ N phút cần thiết)
```

### Innertube Detection (youtubei.js) — PRIMARY (2026-05-04)

youtubei.js dùng **Innertube API** — API nội bộ của YouTube, không có quota limit.

**Ưu điểm:**
- Không quota limit → poll 5s thoải mái
- ~200ms/request (nhanh hơn OAuth ~500ms)
- Detection latency trung bình < 3s

**Cookie source:** 30 Chrome sessions (ChromeSessionManager)
- Session 1: Chrome profile mặc định của user
- Sessions 2-30: HyperClip-Chrome-Profile-{2..30}
- Mỗi session pre-warmed tại startup (5 sessions/batch)
- Round-robin với 10s cooldown trên session lỗi

**Service:** `electron/services/innertube_client.ts` — InnertubeClientPool

### OAuth Fallback — Only when Innertube Fails

Chỉ được gọi khi Innertube trả về 0 video (tất cả 30 sessions die).

| Thông số | Giá trị |
|----------|---------|
| Primary detection | Innertube (youtubei.js, 30 sessions) |
| Fallback detection | OAuth Data API v3 (TokenManager) |
| Poll interval | **5 giây** (Innertube primary, no quota) |
| Concurrent per poll | 5 channels |
| Early termination | Stop sau 5 videos found |
| Upload playlist cache | 24h TTL (Innertube + OAuth đều dùng) |

### seenVideoIds + Multi-Video Loop Fix (2026-05-06)

**Vấn đề:** `seenVideoIds` load ~70 video IDs từ disk lúc startup. Nếu video ở top-1 của channel tab đã nằm trong seen set, code cũ trả `null` và bỏ qua hoàn toàn — không bao giờ kiểm tra video ở top-2, top-3,...

**Root cause:**
```typescript
// CODE CŨ — bỏ nếu top-1 đã seen
const latest = await pool.getLatestVideo(channelId) // chỉ lấy 1 video
if (!latest) return null
const isNew = !seenVideoIds?.has(latest.videoId)
if (!isNew) return null // ← DỪNG TẠI ĐÂY, bỏ qua top-2, top-3...
```

**Fix:**
```typescript
// CODE MỚI — getLatestVideo check top-1 dedup + age ≤ 10 min
const latest = await pool.getLatestVideo(channelId, seenVideoIds)
if (!latest) return null
// publishedAt > 0 && age > 10 min → too old, skip all
// publishedAt = 0 → unparseable, treat as new upload → accept
return latest
```

**Code files:**
- `electron/services/innertube_client.ts`: `getLatestVideo(channelId, seenVideoIds)` — top-1 video, dedup + age ≤ 10 min
- `electron/services/subscription_feed.ts`: `fetchChannelWithInnertube()` — gọi getLatestVideo per channel

### Optimizations (2026-05-04)

| # | Optimization | Impact |
|---|-------------|--------|
| 1 | Poll interval: 20s → 5s | Detection latency < 5s (Innertube primary, no quota) |
| 2 | Innertube primary, OAuth only fallback | OAuth almost never used — quota nearly unlimited |
| 3 | InnertubeClientPool: pre-warmed 30 clients at startup | Loại bỏ ~1-2s delay poll đầu |
| 4 | Round-robin + 10s cooldown | Distributes load, avoids hammering failed sessions |
| 5 | Token batching: 1 token per batch of 5 channels | Reduces getBestAvailable() calls |
| 6 | Early termination (stop after 5 videos) | Minimizes API calls |
| 7 | seenVideoIds cap 10,000 | Chống leak memory dài hạn |
| 8 | seenVideoIds persist to disk | Không re-detect sau restart |

### Chi tiết Quota System

Hệ thống có **hai lớp quota**:

#### Lớp 1 — Innertube (youtubei.js) — PRIMARY (no quota)

Dùng **youtubei.js** để gọi Innertube API. Không có quota limit.

- Cookie source: 30 Chrome sessions
- youtubei.js xử lý SAPISIDHASH + cookie format tự động
- Pre-warmed clients tại startup

#### Lớp 2 — TokenManager (OAuth tokens, 10,000 units/project/ngày)

Chỉ dùng khi Innertube fail hoàn toàn (fallback).

| Thông số | Giá trị |
|----------|---------|
| Cap per project | **9,500 units/ngày** (500 buffer) |
| Reset | Mỗi 24h tự clear stats (kiểm tra khi app khởi động) |
| Track | Mỗi lần gọi playlistItems → `track(projectId)` |
| Rotation | Chọn token có `usedToday` thấp nhất |
| Error threshold | **5 lỗi quota** → token bị skip |
| Storage | `%APPDATA%/HyperClip/token_stats.json` |

#### Lớp 3 — KeyManager (API keys, 10,000 units/key/ngày)

Chưa được dùng trực tiếp — dự phòng tương lai.

### youtubei.js — Chi tiết kỹ thuật

`electron/services/innertube_client.ts` — InnertubeClientPool

#### Cookie format

youtubei.js nhận cookie string format từ Chrome cookies:

```javascript
// buildCookieString() trong innertube_client.ts
`SAPISID=${cookies.SAPISID}; __Secure-1PSID=${cookies.PSID}; ` +
`__Secure-1PSIDTS=${cookies.PSIDTS}; __Secure-1PSIDCC=${cookies.PSIDCC}; ` +
`SOCS=${cookies.socs}`

await Innertube.create({ cookie: cookieStr, retrieve_player: false })
```

#### Cookie cần thiết

| Cookie | Vai trò |
|--------|---------|
| `SAPISID` | Cookie bảo mật cao — dùng để tạo SAPISIDHASH header |
| `__Secure-1PSID` | Session ID — xác minh user đã đăng nhập |
| `__Secure-1PSIDCC` | Certificate cookie — cần cho một số requests |
| `__Secure-1PSIDTS` | Timestamp cookie — chống replay attack |
| `SOCS` | Consent cookie — `CAI` = đồng ý quảng cáo cá nhân |

youtubei.js tự động tính SAPISIDHASH từ cookies và gửi request đến Innertube endpoint.

### Khi nào Innertube LỖI?

**Nguyên tắc quan trọng:** Innertube chỉ trigger OAuth fallback khi **tất cả 30 sessions fail** hoặc trả về 0 video.

| Nguyên nhân | Hành vi hiện tại | Cần làm gì? |
|---|---|---|
| **Lỗi mạng / timeout** | Session marked dead (10s cooldown) → next session | Tự hết khi mạng khôi phục |
| **Session die (PSID/SAPISID hết hạn)** | Session fails → round-robin to next session | User đăng nhập lại Chrome profile |
| **SOCS thay đổi** | Session fails → next session | Không ảnh hưởng nếu có sessions còn lại |
| **Session revoke (đổi mật khẩu)** | All sessions die → OAuth fallback | User đăng nhập lại Chrome profiles |
| **User đăng xuất Chrome profile** | That session fails → next session | User đăng nhập lại profile đó |
| **YouTube đổi response format** | Parse fail → session fails → OAuth fallback | Cập nhật youtubei.js hoặc code parse |
| **IP bị rate limit Innertube** | Session error → 10s cooldown | Tự hết khi cooldown trôi qua |

#### Minh họa fallback chain trong code

```typescript
// subscription_feed.ts — fetchSubscriptionFeed()
async function fetchSubscriptionFeed(options) {
  // Bước 1: Thử Innertube (youtubei.js, 30 sessions, NO quota)
  const pool = await getInnertubePool()
  if (pool.isReady()) {
    const video = await pool.getLatestVideo(channelId)  // round-robin
    if (video) return [video]  // ✓ Innertube thành công — KHÔNG tốn quota
  }
  // Tất cả sessions fail → chuyển sang OAuth

  // Bước 2: OAuth fallback (tốn quota, chỉ khi Innertube die)
  const best = await tm.getBestAvailable()
  const playlistJson = await apiGetOAuth(..., best.token)
  tm.track(best.projectId)  // trừ quota
}
```

### Quota Math thực tế (Innertube primary, 5s interval)

| Kịch bản | Channels | Calls/poll | Polls/day | Units/day |
|---------|----------|-----------|-----------|-----------|
| Innertube primary (no quota) | 49 | ~5 | 17,280 | **0** |
| OAuth fallback (early termination) | 49 | ~5 | ~100 | ~500 |
| OAuth fallback (all channels, rare) | 49 | 49 | ~100 | ~4,900 |

**Kết luận:** Innertube primary → **quota nearly zero**. OAuth chỉ dùng khi tất cả 30 sessions die. 3 GCP tokens dư sức cho fallback path. 5s poll interval thoải mái vì Innertube không quota.

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
- ~~activities?home=true~~ — Google đã xóa endpoint này
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
| Detection Primary | youtubei.js v17 (Innertube, 30 Chrome sessions, NO quota) |
| Detection Fallback | OAuth 2.0 Data API v3 (TokenManager, N GCP projects) |
| Downloader | yt-dlp + Direct IP Binding |
| Video Processing | FFmpeg + NVIDIA NVENC (GPU) |

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
    youtube_poller.ts   — Subscription feed poller (5s ± 1s jitter)
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
| **Phát hiện video mới (PRIMARY)** | **Innertube (youtubei.js) — 30 Chrome sessions, NO quota** | InnertubeClientPool round-robin, health check on first use |
| **Fallback detection** | OAuth Data API v3 playlistItems per channel | TokenManager smart rotation, 9,500 units/day per project, only when Innertube fails |
| **Download video** | yt-dlp + OAuth auth + `--download-sections` | Trim chỉ N phút (user config), bypass VPN. |
| **Render video** | FFmpeg + NVENC (GPU tối đa) | Hardware encode, KHÔNG x264. |

### Settings — Quản lý Chrome Sessions + Google Projects

**Chrome Sessions section** (Innertube primary):
- 30 HyperClip Chrome profiles — user đăng nhập YouTube 1 lần per profile
- Nút "Mở Chrome login" để mở Chrome với profile chưa có cookies
- Cookie extraction: DPAPI (Windows) + sql.js (SQLite) → SOCS cookie phải là CAI
- ⚠️ Close Chrome trước khi khởi động HyperClip — cookies bị lock khi Chrome đang chạy

**Google Projects section** (OAuth fallback):
- Thêm project: OAuth Client ID + Client Secret + API Key
- Xem quota per project: usedToday / 10,000 units
- OAuth tokens lưu multi-project array format (KHÔNG overwrite khi add project mới)
- Exhausted threshold: 5 quota errors → token bị skip

### Luồng dữ liệu đúng

```
App khởi động
  ├─ Load OAuth tokens từ oauth_tokens.json (N projects)
  ├─ Load API keys từ api_keys.json (N keys)
  ├─ Pre-warm InnertubeClientPool (30 Chrome profiles, batch 5)
  └─ Poller loop (5s ± 1s jitter)
        ├─ Innertube (youtubei.js) per channel (max 5 concurrent)
        │     └─ InnertubeClientPool.getLatestVideo(channelId) — top-1, dedup + age ≤ 10 min
        │     └─ Early termination: stop after 5 new videos found
        ├─ OAuth fallback: only if Innertube pool = 0 sessions ready
        └─ Filter: unseen (seenVideoIds), not deleted
        └─ autoDownload() → yt-dlp --download-sections (defaultTrimLimit minutes)
```

### Key Facts

- ✅ Innertube (youtubei.js) = **PRIMARY** detection (no quota limit)
- ✅ OAuth Data API v3 = **FALLBACK** (only when Innertube all 30 sessions fail)
- ✅ Full scan = check TẤT CẢ kênh mỗi poll
- ✅ Uploads playlist ID cache 24h → tiết kiệm 1 call/channel/poll
- ✅ trimLimit numeric (phút) thay vì '5min'/'10min'/'full'
- ✅ Auto-download dùng `defaultTrimLimit` từ settings (default: 10 phút)
- ✅ **Auto-render opt-in** — `settings.autoRender` (default: false, user manually triggers)
- ✅ Exhausted threshold: 5 quota errors per token → skip token
- ✅ Token quota reset: UTC date midnight (kiểm tra mỗi 30 phút)
- ⚠️ activities?home=true **DEPRECATED** — không dùng nữa
- ⚠️ Close Chrome trước khi start HyperClip — cookie lock prevention

---

## 13. Render Pipeline — GPU Optimization

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
| 9 | Chunked 120s (GPU) | `chunkDuration=120, workers=8` | Less overhead |
| 10 | Async NVENC | `-rc-lookahead 0 -tune ull` | Max encode throughput |

---

## 14. Ngày cập nhật: 2026-05-06

### Changes 2026-05-06
- **Age filter REMOVED (2026-05-06):** `parseRelativeDate` fails for many formats ("X weeks ago", "X month ago" without 's', empty, "Live", etc.) → `publishedAt=0` → age check bypassed → old videos downloaded. Fix: trust YouTube tab order (newest-first) as the primary guard. `seenVideoIds` dedup prevents re-downloads. Trim limit (30 min) prevents old video processing.

### Changes 2026-05-04
- Sync Section 1 vs Section 12: Innertube PRIMARY (not DEPRECATED)
- Token exhaustion: `MAX_UNITS_PER_TOKEN` = 9,500 (was 500 in code but 9,500 in docs)
- Improved Innertube pool init logging: shows cookie prefix + skipped session list
- Remove health check during pool init (getHomeFeed fails even with valid cookies)
- Add cookie lock warning: Close Chrome before starting HyperClip
