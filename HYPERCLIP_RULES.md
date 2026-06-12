# HyperClip — Quy tắc & Kiến trúc

> Tài liệu này là **source of truth**. Mọi file spec khác (dashboard-design.md, memory files) phải nhất quán với file này.

---

## 1. Mục tiêu cốt lõi

**Bắt 100% video mới trong < 20 giây, chạy 24/7 cho ~100 kênh YouTube.**

### NGUYÊN LÝ HOẠT ĐỘNG CỐT LÕI (ĐỂ ĐẠT ĐƯỢC MỤC TIÊU TRÊN)

1. **Detection: Song song 2 cơ chế (Chrome CDP Tab Watcher + Innertube Poller):**
   - **Chrome CDP Tab Watcher (Tức thời):** Quét cổng remote debugging (`localhost:9222/json`) của Chrome mỗi 1.5s. Nếu phát hiện tab đang mở URL video YouTube (watch/shorts), trích xuất Video ID và kích hoạt tải xuống ngay lập tức (< 11s E2E).
   - **Innertube Poller (Bản tin định kỳ):** Quét tất cả kênh đăng ký song song trong nền (chu kỳ 5s ± 20% jitter) để phát hiện video vừa publish. Sử dụng 30 Chrome sessions làm cookie source, gọi Innertube API không tốn quota.
   - **OAuth Data API v3 (Dự phòng):** Chỉ kích hoạt khi toàn bộ 30 Chrome sessions của Innertube bị lỗi hoặc trả về 0 video.
2. **Auto-download Window: 30 phút** — chỉ tải video upload trong vòng 30 phút trở lại (cho yt-dlp trim). Không block detection.
3. **Tải xuống siêu tốc:** yt-dlp + `--download-sections *00:00:00-MM:SS` (chỉ tải đúng số phút cần thiết), Direct IP binding.
4. **Render ép phần cứng:** FFmpeg + NVENC (GPU), không x264.

---

## 2. Pipeline (5 tầng)

| # | Tầng | Công nghệ | Target |
|---|-------|-----------|--------|
| 1 | **Trigger** | Chrome CDP Tab Watcher + Innertube (youtubei.js) + OAuth fallback | < 11s (CDP) / < 20s (Poller) |
| 2 | **Download** | yt-dlp + `--download-sections` (chỉ tải N phút) + 4×32-fragment multi-instance (RAM ≥ 16GB) | < 40s |
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
  Tab order: trust YouTube Videos tab (newest-first). Age ≤ 10 min filter applied.
  publishedAt=0 → OAuth verify (real upload timestamp) → accept if ≤ 10 min
         ↓
autoDownload() → yt-dlp --download-sections (chỉ N phút cần thiết, tv_embedded client → H.264 720p/1080p)
```

### Chrome CDP Tab Watcher — Công nghệ Phát hiện Tức thời (~0s)

Khi người dùng mở một video YouTube trên trình duyệt Chrome (được chạy với tham số `--remote-debugging-port=9222`), HyperClip sử dụng Chrome DevTools Protocol (CDP) để phát hiện tức thời:

- **Địa chỉ quét:** `http://127.0.0.1:9222/json` (Bắt buộc dùng IP loopback `127.0.0.1` thay vì `localhost` để triệt tiêu hoàn toàn độ trễ phân giải DNS ~47s trên hệ điều hành Windows).
- **Chu kỳ quét:** Mỗi 500ms (giúp đạt tốc độ phản hồi tức thì 0s).
- **Cơ chế:**
  1. Gửi request HTTP GET đến endpoint `/json` của Chrome để lấy danh sách các tab đang hoạt động. Request này được thực hiện qua HTTP client cấu hình **bỏ qua proxy hệ thống** (`no_proxy()`) để tránh việc VPN/Proxy can thiệp vào đường truyền loopback cục bộ.
  2. Lọc các tab có kiểu là `"page"` và có URL chứa định dạng YouTube (`youtube.com/watch`, `youtu.be/`, `youtube.com/shorts/`).
  3. Trích xuất `video_id` từ URL.
  4. Đối chiếu với bộ nhớ Seen Videos dùng chung `Arc<tokio::sync::RwLock<SeenVideos>>` (chia sẻ trực tiếp giữa Poller và ChromeTabWatcher để tránh trùng lặp dữ liệu trên RAM). Các thao tác ghi đè trạng thái được spawn bất đồng bộ thông qua `tokio::runtime::Handle` thay vì dùng block_write đồng bộ (ngăn ngừa deadlock luồng worker).
  5. Nếu video chưa từng được xử lý, ngay lập tức đẩy một `NewVideoEvent` vào pipeline tải xuống mà không cần đợi chu kỳ quét của YouTubePoller.
- **Node.js Helper Scan (innertube_helper.js):** Lát cắt lấy video từ danh sách phát của kênh YouTube được tăng từ 5 lên **15 video mới nhất** để tránh bỏ sót khi quét tab kênh lúc user tải nhiều video liên tiếp.
- **Hiệu quả thực tế:** Rút ngắn thời gian phát hiện video từ lúc user mở trên Chrome xuống mức **tức thời (~0s)**.

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
- **Session suspension (2026-05-27):** Nếu session trả empty timestamp cho tất cả videos trong 5 poll liên tiếp (dấu hiệu LockupView format không tương thích), session bị suspend. Tự động thử lại sau 5 phút. Điều này ngăn session hỏng làm chậm detection pipeline.

**Service:** `crates/hyperclip_ipc/src/innertube_client.rs` — InnertubeClientPool

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
- `crates/hyperclip_ipc/src/innertube_*.rs`: `getLatestVideo(channelId, seenVideoIds)` — top-1 video, dedup + age ≤ 10 min
- `crates/hyperclip_ipc/src/detection.rs`: `fetchChannelWithInnertube()` — gọi getLatestVideo per channel

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

`crates/hyperclip_ipc/src/innertube_client.rs` — InnertubeClientPool

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
| Desktop Shell | PySide6 QML/QtQuick |
| Frontend | QML (QtQuick) |
| State | Python models + Rust backend |
| Backend | Rust binary (`hyperclip-tauri.exe`) — stdin/stdout JSON-RPC |
| Detection Primary | youtubei.js v17 (Innertube, 30 Chrome sessions, NO quota) |
| Detection Fallback | OAuth 2.0 Data API v3 (TokenManager, N GCP projects) |
| Downloader | yt-dlp + Direct IP Binding |
| Video Processing | FFmpeg + NVIDIA NVENC (GPU) |

---

## 5. Speed Rules

1. **RAM Disk cho video temp** — ~10GB/s I/O, video source không bao giờ đụng HDD
2. **Static Blur** — gen 1 frame blur, cache vĩnh viễn, render chỉ composite (0 GPU cost/render frame)
3. **Direct IP Binding** — yt-dlp bypass VPN để max bandwidth
3b. **Multi-instance download (2026-05-21)** — 4 instances × 32 concurrent fragments khi RAM ≥ 16GB + 1080p. YouTube CDN per-IP cap ~100-200 Mbps → instances tối đa hữu ích = 4. Capped at 4 instances để tránh YouTube rate-limit.
4. **NVENC hardware encode** — KHÔNG x264 software. Dùng `hevc_nvenc`/`h264_nvenc`
4. **NVENC hardware encode** — KHÔNG x264 software. Dùng `hevc_nvenc`/`h264_nvenc`
5. **NVDEC GPU decode** — Dùng `hevc_cuvid`/`h264_cuvid` thay `-hwaccel cuda` để full hardware decode
6. **CUDA filter pipeline** — `-filter_hw_device cuda` để scale/pad/overlay chạy trên GPU
7. **Pre-render text overlay** — drawtext chạy 1 lần → PNG → overlay PNG mỗi frame (GPU fast)
8. **Trim optimization** — decode chỉ `outputDuration/speed` thay vì toàn bộ source
9. **Speed options** — 1.1x/1.2x encode ít frame hơn → decode + encode nhanh hơn
10. **Python models + Rust state** — NO context cascade, chỉ update QML khi data change

---

## 6. Cấu trúc thư mục

```
src/                     — Python + QML
  main.py                — Launcher: QGuiApplication + spawn Rust binary
  backend/
    client.py            — RustClient (stdin/stdout JSON-RPC)
  models/                — Python → QML context models
  ui/qml/               — QML views

crates/hyperclip_ipc/   — Rust IPC crate
  src/
    cookies.rs           — DPAPI decrypt + SQLite parser, SOCS=CAI injection
    cookies_sqlite.rs    — SQLite reader (%youtube.com + .youtube.com filter)
    detection.rs         — Detection pipeline + health monitor
    ffmpeg.rs            — FFmpeg filter chain + NVENC params
    innertube_pool.rs    — 30 sessions, atomic round-robin, 10s cooldown
    innertube_client.rs  — Node subprocess wrapper (youtubei.js via JSON-RPC)
    poller.rs            — Async polling loop (5s ± 20% jitter)
    store.rs             — Persistent JSON store (workspaces, channels, settings)
    system.rs            — GPU detection + system stats
    youtube.rs           — yt-dlp arg builder + download orchestration

src-tauri/
  src/
    main.rs             — Rust binary: stdin/stdout JSON-RPC loop
    commands.rs         — ~80 IPC command handlers

docs/
  MIGRATION_NOTES.md    — Logic từ Electron cần verify trên Rust

HYPERCLIP_RULES.md      — Source of truth nghiệp vụ + kỹ thuật
```
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
python src/main.py             # Run QML app (spawns Rust binary)
cargo build -p hyperclip-tauri  # Build Rust binary
cargo test -p hyperclip-ipc     # Run Rust tests
cargo clippy -p hyperclip-ipc   # Lint Rust code
```

---

## 9. UI Rules

- Layout: 3-pane (Sidebar 220px | Center | Right Editor)
- Theme: Background `#121212`, Accent `#00B4FF`, `#00FF88`
- Flat design: NO shadows, NO gradients, NO decorative UI
- Font: Inter

---

## 10. IPC Protocol (Python ↔ Rust — stdin/stdout JSON-RPC)

**Python → Rust (stdin):**
- `{"id": 1, "cmd": "workspace:list", "params": {}}`

**Rust → Python (stdout):**
- Response: `{"id": 1, "ok": true, "result": {...}}`
- Push event: `{"method": "workspace:update", "params": {...}}` (no `id`)

**Key commands (80+ handlers trong `commands.rs`):**
- `workspace:*`, `channel:*`, `render:*`, `video:*`
- `auth:*`, `key:*`, `session:*`, `project:*`
- `poller:*`, `system:*`, `logs:*`, `update:*`, `storage:*`

---

## 11. Đã xóa / Dead code

| File/Code | Lý do |
|-----------|--------|
| `electron/`, `src/app/` | Đã archive (2026-06-09) — chuyển sang QML/Rust |
| `docs/MIGRATION_NOTES.md` | Logic từ Electron cần verify trên Rust |

---

## 12. Phân công công nghệ — CHÍNH SÁCH BẮT BUỘC

> ⚠️ **ĐÂY LÀ NGUYÊN TẮC CỨNG. Không được phép vi phạm.**

### Công nghệ cho từng tác vụ

| Tác vụ | Công nghệ | Ghi chú |
|--------|-----------|---------|
| **Xác thực / Đăng nhập** | OAuth 2.0 (N lần, mỗi project 1 lần) | Refresh token tự động. Credentials lưu trong store. |
| **Lấy danh sách kênh đăng ký** | YouTube Data API v3 (`/subscriptions`) | Chỉ gọi **1 lần** khi setup → lưu vào store. **KHÔNG gọi lại** sau khi setup xong. |
| **Phát hiện video mới (PRIMARY)** | **Innertube (youtubei.js) — 30 Chrome sessions, NO quota** | InnertubePool round-robin, health check on first use |
| **Fallback detection** | OAuth Data API v3 playlistItems per channel | TokenManager smart rotation, 9,500 units/day per project, only when Innertube fails |
| **Download video** | yt-dlp + cookies + `--download-sections` | Trim chỉ N phút (user config), bypass VPN. |
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
  ├─ Rust binary startup → load channels/settings từ store
  ├─ Pre-warm InnertubePool (30 Chrome profiles, batch 5)
  └─ Poller loop (5s ± 20% jitter)
        ├─ Innertube (youtubei.js) per channel (max 10 concurrent)
        │     └─ getLatestVideo(channelId) — top N, dedup + age ≤ 10 min
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
- ✅ Age filter: skip videos > 10 min old; `publishedAt=0` → OAuth verify (real upload timestamp, not cached text)
- ✅ Dedup: `return null` → `continue` — if top-1 seen, try top-2..top-5 (prevents 0-result after first successful poll)
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

## 14. Ngày cập nhật: 2026-05-18

## 14. Ngày cập nhật: 2026-05-18

### Changes 2026-05-18 — Download: `tv_embedded` Client Priority (FIX 1080p)
- **Root cause**: `web` client với Chrome CDP session cookies bị YouTube giới hạn 360p. Nguyên nhân: cookies extract từ Chrome CDP (in-memory) thiếu `PREF` preferences đầy đủ → YouTube serve 360p only cho `web` client → yt-dlp EJS challenge fail → format limit.
- **Fix**: Đổi client priority: `['tv_embedded', 'web', 'ios']` — `tv_embedded` dùng HLS (m3u8) thay vì DASH → bypass EJS → trả về H.264 720p/1080p60.
  - `tv_embedded`: 1080p60 (avc1.64002a) ✅
  - `web` (old): only 360p ❌
- **Format selector**: Bỏ codec restrictions — ưu tiên resolution trước. VP9/AV1 1080p được pick trước H.264 360p.
- **E2E verified**: 1920x1080 source → 288.7MB download (30.4s) → 874MB render output (265s) → archive ✅

## 14b. Ngày cập nhật: 2026-05-15

### Changes 2026-05-15 — Download 1080p + Auto-Render + Channel UI
- **`--cookies` + yt-dlp auto client = 1080p H.264** (2026-05-15). YouTube 2026 không còn yêu cầu PO Token khi có Chrome cookies. Chrome cookies authenticate request → YouTube trả highest quality có thể. yt-dlp auto-selects `WEB_EMBEDDED_PLAYER` → H.264 10800p @ 4943 kb/s. PO Token extraction từ Chrome JavaScript KHÔNG hoạt động (PO Token nằm ở network layer, không phải JS layer).
  - Không set `player_client` → yt-dlp tự chọn
  - `yt-dlp auto client + cookies` → **1920x1080 H.264** ✅
  - `--remux-video mp4` → container .mp4 cho HTML5 player
  - Evidence: `Stream: h264 (High), 1920x1080, 60fps, 4943 kb/s`
- **Auto-render pipeline** (2026-05-15): sau download xong → check `settings.autoRender=true` → `preScaleVideo()` → render với `p1+ull` preset → pre-scaled cleanup. `autoRenderAttempted` flag ngăn infinite loop.
- **Channel add UI** (2026-05-15): Sidebar có add bar trực tiếp. ChannelsStep trong onboarding có validation + duplicate check.
- **`DEV_LOG=1`** trong `electron:dev` script (legacy Electron, giữ reference cho history).

### Changes 2026-05-13 — Skip unparseable age + Download quality fix + Preview fix
- **`publishedAt=0` → OAuth verify** (2026-05-13). Innertube trả empty `published_time_text` cho video mới (YouTube cache lag < 1 phút). Fix: khi Innertube trả `publishedAt=0`, gọi OAuth `/videos?id=...&part=snippet` để lấy real `publishedAt`. Accept nếu ≤ 10 phút, skip nếu > 10 phút hoặc error. OAuth chỉ trigger khi Innertube chính nó trả empty timestamp → quota cost ≈ 3-5 calls/poll × ~100 polls/day ≈ 300-500 units/ngày ≪ 313,500 quota.
- **Xóa priority re-scan**: Khi Innertube trả 0 video, không re-scan nữa.
- **Xóa `verifyVideoAgeByOAuth()`**: Không còn cần verify `publishedAt=0`.
- **Xóa `getLatestVideoPriority()`**: Không còn được gọi.
- **Xóa OAuth health check**: Vô nghĩa sau khi xóa `publishedAt=0` verification.
- **Kết quả**: OAuth quota ≈ 0 consumption. OAuth chỉ dùng khi Innertube pool = 0.
- **Download quality (SUPERSEDED 2026-05-15)**: Xem section mới ở trên.

### Changes 2026-06-09 — Electron → QML/Rust migration
- **Chuyển hoàn toàn khỏi Electron/Next.js**: `electron/` và `src/app/` đã archive.
- **UI mới**: PySide6 QML/QtQuick + Rust backend (`hyperclip-tauri.exe`).
- **IPC mới**: stdin/stdout JSON-RPC giữa Python ↔ Rust (thay vì Electron IPC).
- **Logic đã port**: cookie extraction, detection pipeline, download, render, store, poller.
- **Cần verify**: health alerts, token management, auto-render catchup — xem `docs/MIGRATION_NOTES.md`.
- **Code cũ**: `../HyperClip-Electron-Archive/`. Git history giữ đầy đủ.
- **Fix #1 — Dedup bug (2026-05-12):** `return null` → `continue` trong `getLatestVideo()` và `getLatestVideoPriority()`. Bug: khi top-1 đã nằm trong `seenVideoIds`, code cũ trả `null` và skip cả channel → không bao giờ thử top-2..top-5 → sau poll đầu tiên thành công, poll tiếp theo luôn trả 0 cho tất cả channels → OAuth health check chỉ test 1 channel → OAuth fallback không được trigger. Fix: đổi `return null` → `continue` để thử video tiếp theo khi top-1 đã seen.
- **Fix #2 — OAuth age verification (2026-05-12): SUPERSEDED 2026-05-13.** `publishedAt=0` → accept → OAuth verify → skip nếu > 10 phút. Bug: Innertube trả empty `published_time_text` cho video mới upload (< 2 phút) NHƯNG CŨNG cho video cũ mà YouTube chưa cache timestamp. Sau khi analyze log thực tế: 100% video `publishedAt=0` đều là video cũ (từ vài ngày đến vài năm). Video mới upload luôn có `published_time_text` parseable → fix mới: skip hoàn toàn `publishedAt=0` thay vì verify qua OAuth.

### Changes 2026-05-12 — Age filter REFINED (SUPERSEDED 2026-05-13)
- Accept `publishedAt=0` (unparseable) as likely new uploads instead of skipping. SUPERSEDED: thực tế 100% `publishedAt=0` là video cũ → skip thay vì accept + verify.

### Changes 2026-05-06
- **Age filter REMOVED (2026-05-06) — REVERTED 2026-05-12:** `parseRelativeDate` fails for many formats → `publishedAt=0` → age check bypassed → old videos downloaded. Initial fix removed age filter entirely; later refined to accept unparseable age only.

### Changes 2026-05-04
- Sync Section 1 vs Section 12: Innertube PRIMARY (not DEPRECATED)
- Token exhaustion: `MAX_UNITS_PER_TOKEN` = 9,500 (was 500 in code but 9,500 in docs)
- Improved Innertube pool init logging: shows cookie prefix + skipped session list
- Remove health check during pool init (getHomeFeed fails even with valid cookies)
- Add cookie lock warning: Close Chrome before starting HyperClip
