# HyperClip — Technology Overview

> Document này ghi lại trạng thái công nghệ thực tế tại thời điểm 2026-05-06. Source of truth cho nghiệp vụ: `HYPERCLIP_RULES.md`.

---

## 1. Kiến trúc tổng thể

```
Browser (Chrome) ←→ Electron main process ←→ Next.js frontend
     │                    │
     │              InnertubeClientPool (30 sessions)
     │                    │
     │              YouTubePoller (5s jitter)
     │                    │
     │              SubscriptionFeed
     │                    │
     │              AutoDownload (yt-dlp + FFmpeg)
```

**Poll interval:** 5 giây ± 1s jitter
**Channels:** ~100 kênh
**Poller chạy sau `did-finish-load`** — window frontend phải load xong trước

---

## 2. Hai lớp xác thực Detection

### 2.1. Innertube PRIMARY (không quota)

| Thành phần | Chi tiết |
|------------|---------|
| Công nghệ | youtubei.js (Innertube API nội bộ YouTube) |
| Cookie source | 30 Chrome profiles (ChromeSessionManager) |
| Sessions ready | `isLoggedIn=true && isConsented=true (SOCS=CAI)` |
| Quota | Không giới hạn |
| Speed | ~200ms/request |
| Cookie path | `%LOCALAPPDATA%\Google\Chrome\User Data\_hyperclip_cookies.json` (Chrome Default) |
| Cookie path | `%LOCALAPPDATA%\HyperClip-Chrome-Profile-N\Default\_hyperclip_cookies.json` (HyperClip profiles) |

**Cookie extraction flow:**
```
Chrome đóng → sql.js đọc SQLite → DPAPI decrypt → _hyperclip_cookies.json
Chrome mở → cookies bị lock → retry 5 lần → copy file → có thể fail
CDP (Chrome DevTools Protocol) → extract in-memory cookies → không cần DB
```

**⚠️ IMPORTANT:** SOCS cookie (consent) phải = `CAI`. Nếu SOCS = null → `isConsented=false` → session không được dùng.

### 2.2. OAuth FALLBACK (có quota)

| Thành phần | Chi tiết |
|------------|---------|
| Công nghệ | YouTube Data API v3 playlistItems |
| Token source | TokenManager (N Google Cloud projects) |
| Quota | 9,500 units/project/ngày |
| Trigger | Chỉ khi Innertube pool = 0 sessions ready |
| Persistence | oauth_tokens.json (multi-project array) |

**OAuth được trigger khi:**
- Tất cả Innertube sessions fail (`isReady() = false`)
- Exception trong Innertube call

**OAuth KHÔNG trigger khi:**
- Innertube trả về 0 video (bình thường, không có video mới)
- → Đây là "silent death" — không có cơ chế phát hiện

---

## 3. Detection Pipeline (chi tiết từng bước)

```
YouTubePoller._pollOnce() [5s]
  │
  └→ fetchSubscriptionFeed(seenVideoIds, sinceMs)
        │
        ├─ Innertube PRIMARY (pool.isReady()?)
        │    │
        │    ├─ Round-robin 30 sessions
        │    ├─ session.getNextClient() — skip sessions error < 10s
        │    │
        │    └─ pool.getLatestVideo(channelId)
        │         │
        │         ├─ entry.client.getChannel(channelId)
        │         ├─ channel.getVideos()
        │         ├─ extractVideosFromTab() — 7 strategies
        │         │    1. memo.get('Video')
        │         │    2. memo.get('GridVideo')
        │         │    3. memo.get('ReelItem')
        │         │    4. memo.get('CompactVideo')
        │         │    5. .videos getter
        │         │    6. walkForVideosStrict() — type-based only
        │        7. walk entire object
        │         │
        │         ├─ top-1 check: seenVideoIds dedup
        │         ├─ top-1 check: not deleted/private
        │         └─ Age filter: First poll: < 24h | Normal poll: < 10 phút
        │             (parseRelativeDate → publishedAt → age check)
        │
        └─ OAuth FALLBACK (only if pool.isReady()=false or 3+ consecutive Innertube zero-result polls)
             └─ 1-channel health check to verify OAuth still works
```

---

## 4. Filters trong Detection

### 4.1. Age Filter

**Normal poll:** < 10 phút | **First poll after restart:** < 24 giờ

| Trường hợp | Behavior | Tại sao |
|-------------|----------|---------|
| Video đăng 0-10 phút (normal poll) | ✅ Accepted | Trong window |
| Video đăng > 10 phút (normal poll) | ❌ Blocked | Ngoài window |
| Video đăng 0-24h (first poll) | ✅ Accepted | Capture videos since last session |
| Video đăng > 24h (first poll) | ❌ Blocked | Ngoài window |
| Video mới đăng (timestamp chưa update) | ✅ Accepted | publishedAt=0 → treated as new |
| parseRelativeDate fail | ✅ Accepted | publishedAt=0 → treated as new |
| Video livestream | ✅ Accepted | publishedAt=0 → treated as new |

**parseRelativeDate regexes:**
```
/(\d+)\s*minute/    → minutes ago
/(\d+)\s*hour/     → hours ago
/(\d+)\s*day/      → days ago
/(\d+)\s*week/     → weeks ago (không cần 's')
/(\d+)\s*month/    → months ago
/(\d+)\s*year/     → years ago
ISO fallback         → thử parse trực tiếp
→ Fail → 0 → treated as new upload
```

### 4.2. Duration Filter (< 60 giây)

**Checkpoint:** Sau khi download xong, ffprobe kiểm tra duration thực tế.

```
ffprobe → realDuration
  │
  └─ realDuration > 0 && realDuration < 60?
       ├─ YES → skip as YouTube Short
       └─ NO → proceed normally
```

| Threshold | Giá trị |
|-----------|---------|
| Too short | < 60 giây |
| Normal | >= 60 giây |
| File bị xóa sau khi skip | Có |
| Video marked as seen | Có |

### 4.3. Aspect Ratio Filter (9:16 vertical)

**Checkpoint:** Sau khi download xong, ffprobe kiểm tra aspect ratio.

```
ffprobe → aspect.width / aspect.height
  │
  └─ isShort = (width < height) || (width/height < 0.7)?
       ├─ YES → skip (vertical short)
       └─ NO → proceed (landscape)
```

---

## 5. Download Pipeline

```
enqueueBgDownload(video)
  │
  └─ processBgDownloadQueue()
       │
       ├─ yt-dlp download (max 2 concurrent)
       │    ├─ --download-sections *00:00:00-MM:SS (trim)
       │    ├─ Quality: autoDownloadQuality (default 720p)
       │    └─ OAuth token cho authenticated downloads
       │
       ├─ FFprobe (aspect ratio check)
       │
       ├─ Skip vertical shorts (isShort)
       │
       ├─ Skip too short (< 60s)
       │
       └─ createWorkspace()
            ├─ Trim (ffmpeg --download-sections)
            ├─ Thumbnail extract
            └─ Add to dashboard
```

---

## 6. Cấu trúc seenVideoIds

| Thuộc tính | Giá trị |
|-----------|---------|
| Persistence | `%APPDATA%/HyperClip/seen-ids.json` |
| Cap | 10,000 IDs |
| Eviction | Xóa oldest entries |
| Scope | Tất cả video đã detect (không phân biệt download thành công/thất bại) |

---

## 7. Trạng thái các sessions Chrome

| Profile | Cookies | isLoggedIn | isConsented | Ready |
|---------|---------|------------|-------------|-------|
| Chrome Default (1) | SAPISID+PSID+PSIDCC+PSIDTS | ✅ | SOCS=? | ? |
| HyperClip-{2..30} | ? | ? | ? | ? |

**Cookie files:**
- Chrome Default: `%LOCALAPPDATA%\Google\Chrome\User Data\_hyperclip_cookies.json`
- HyperClip profiles: `%LOCALAPPDATA%\HyperClip-Chrome-Profile-N\Default\_hyperclip_cookies.json`

---

## 8. Known Issues (2026-05-06)

### 8.1. SOCS Missing → Root Cause Detection Die

**Tất cả 30 sessions đều `isConsented=false`**

SOCS cookie hoàn toàn không tồn tại trong SQLite DB. User đã login Chrome nhưng chưa accept Google/YouTube consent banner → SOCS chưa được set.

**Hành động cần làm:**
1. Đóng HyperClip
2. Mở Chrome thường → youtube.com → đăng nhập → accept consent banner
3. Đóng Chrome hoàn toàn
4. Mở HyperClip

### 8.2. CDP Login Auto-Return

CDP `Network.getAllCookies` trả cookies từ browser IN-MEMORY. Khi profile đã login → return ngay → user không tương tác → SOCS không bao giờ set.

**Manual flow bắt buộc:** User phải mở Chrome thường (không qua HyperClip).

### 8.3. Cookie DB Lock

Chrome locks Cookies DB khi đang chạy. Retry 5 lần + copy fallback có thể vẫn fail.

**Best practice:** Đóng Chrome trước khi HyperClip extract cookies.

### 8.4. extractVideosFromTab Parse Fail

`walkForVideos` dùng `node.id` làm điều kiện → RichText nodes bị match nhầm → 0 videos được return.

**Fix:** Strategy memo-based (`memo.get('GridVideo')`, etc.) + `walkForVideosStrict` chỉ match theo `type`.

### 8.5. LockupView Metadata Extraction (FIXED)

YouTubei.js trả về **LockupView** items (NOT GridVideo/VideoRenderer). Metadata nằm trong nested `lockupMetadata` sub-object:

| Field | Top-level (SAI) | lockupMetadata path (ĐÚNG) |
|-------|-----------------|--------------------------|
| videoId | `videoItem.id` = undefined | `lockupMetadata.content_id` |
| title | `videoItem.title` → `"[object Object]"` | `lockupMetadata.content_title?.text` |
| published | `videoItem.published` = undefined | `lockupMetadata.published_time_text?.text` |

**Symptom trước fix:** "all top-2 deleted/private" cho mọi kênh — vì `toString()` trả `"[object Object]"` chứa `[` → `includes('[deleted]')` false match.

**Fix:** Always use `?.text` cho structured Text objects từ youtubei.js. Xem `memory/lockupview_fix.md`.

---

## 9. OAuth Quota Math

| Thông số | Giá trị |
|-----------|---------|
| Projects | 33 |
| Units/project/ngày | 9,500 |
| Tổng quota | 313,500 units/ngày |
| Polls/ngày (5s) | 17,280 |
| Units/poll (~100 ch, 5 conc) | ~20 units |
| Tiêu thụ/ngày | ~345,600 units |
| Quota overrun | +10% → hết sau ~21 giờ |

**=> Innertube PRIMARY phải active để không tốn quota**

---

## 10. Files key

| File | Chức năng |
|------|-----------|
| `electron/services/innertube_client.ts` | Innertube pool + video extraction + parseRelativeDate + first-poll 24h age filter |
| `electron/services/chrome_cookies.ts` | Cookie extraction (DPAPI + sql.js) + SessionManager |
| `electron/services/cdp.ts` | CDP auto-login + cookie persistence |
| `electron/services/subscription_feed.ts` | Detection orchestrator (Innertube + OAuth + health check) |
| `electron/services/youtube_poller.ts` | Poller loop (5s) + seenVideoIds + first-poll flag |
| `electron/main.ts` | Auto-download + render pipeline + IPC |
| `src/app/settings/page.tsx` | Settings UI (4 tabs + PollerStatusPanel với quota & session health) |
| `docs/reliability_plan.md` | Kế hoạch fix detection issues |

---

## 11. Reliability Improvements (2026-05-06)

### 11.1. First-Poll Full Capture

App restart → lần poll đầu tiên dùng age threshold = 24 giờ (thay vì 10 phút). Đảm bảo capture đầy đủ videos trên mỗi kênh trước khi vào real-time mode.

**Implementation:**
- `youtube_poller.ts`: `_isFirstPoll` flag → `sinceMs = Date.now() - 24h` cho poll đầu
- `innertube_client.ts`: `getLatestVideo(channelId, seenVideoIds, firstPoll)` → age threshold context-aware

### 11.2. OAuth Health Check (Silent Death Detection)

Sau 3 polls liên tiếp Innertube trả về 0 video → force 1 OAuth call để verify Innertube có thực sự die hay không.

**Log output:**
```
[SubFeed] Innertube: 0 videos across N channels (no new content)
[SubFeed] ⚠️ 3 consecutive Innertube zero-result polls — running OAuth health check
[SubFeed] OAuth health check: no new videos either — all sources truly empty
```

### 11.3. OAuth Quota Monitoring (Settings UI)

PollerStatusPanel hiển thị tổng quota còn lại qua tất cả 33 projects:
```
OAuth Quota: X units left (Y% used) 🟢OK/🟡WARNING/🔴CRITICAL
```

Warning hiện khi quota < 1000 units: `🚨 OAuth quota critical — add GCP project now`

### 11.4. Session Health Monitoring (Settings UI)

PollerStatusPanel hiển thị session health breakdown từ sessionStatus.sessions:
```
🟢 HEALTHY (>50% consented)
🟡 DEGRADED (20-50% consented)
🔴 CRITICAL (<20% consented)
```

Alert "CHROME CONSENT REQUIRED" khi có sessions logged-in nhưng chưa accept consent (SOCS missing).
