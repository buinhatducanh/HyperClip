# Kế hoạch đảm bảo Detection 100% — HyperClip

> **Yêu cầu cốt lõi:** Bắt 100% video mới trong < 20 giây, chạy 24/7 cho ~100 kênh YouTube.
> **Ngày:** 2026-05-06
> **Tác giả:** PO Review + Claude Code Analysis

---

## 0. Xác nhận UI thực tế (2026-05-06)

**Settings page có 4 tabs:** `STATUS` | `OAUTH PROJECTS` | `API KEYS` | `SYSTEM`

**PollerStatusPanel tồn tại** trên tab `STATUS` (tab mặc định) — đây là nơi xem trạng thái detection.

**Cấu trúc Settings page** (`src/app/settings/page.tsx`):
```typescript
// Tab layout (line 2259-2266)
const TABS = [
  { id: 'status'    as const, label: 'STATUS',       color: '#00FF88' },
  { id: 'projects'  as const, label: 'OAUTH PROJECTS', color: '#00FF88' },
  { id: 'keys'      as const, label: 'API KEYS',      color: '#00B4FF' },
  { id: 'system'    as const, label: 'SYSTEM',       color: '#FFB800' },
]

// Content (line 2321-2334)
activeTab === 'status'    → <PollerStatusPanel />      ← DEFAULT, có sẵn
activeTab === 'projects'  → <ProjectsSection />
activeTab === 'keys'      → <ApiKeysSection />
activeTab === 'system'    → <SystemSection />
```

**PollerStatusPanel hiển thị đúng các metrics cần thiết:**
- Innertube Sessions: `X/30 consented` → PRIMARY [ACTIVE]
- OAuth Projects: `X/Y healthy` → FALLBACK [ACTIVE]
- API Keys: count
- Banner: `RUNNING` / `BACKED OFF`

**Lưu ý:** Settings có **password gate**. Nếu đã set password → phải unlock trước khi vào Settings. Nếu chưa set password → thấy màn Password Setup.

---

## 0b. Trạng thái thực tế đo được (2026-05-06)

```
✗ Innertube Sessions: 0/30 consented — cần đăng nhập Chrome
✓ OAuth Projects: 33/33 healthy — FALLBACK [ACTIVE]
● API Keys: 29 keys
```

### Root cause xác nhận

**Tất cả 30 Chrome sessions đều CHƯA accept Google/YouTube consent terms.**

Bằng chứng trực tiếp từ SQLite DB (HyperClip-Profile-2):
```
SQLite (profile chưa từng mở bằng Chrome): 0 cookies with values ❌
CDP _hyperclip_cookies.json (in-memory browser): SAPISID+PSID có ✅
→ CDP đọc từ IN-MEMORY browser storage, không phải SQLite persistent storage
```

Chrome profile đã LOGIN (CDP có SAPISID + PSID) nhưng user chưa accept consent banner → SOCS cookie không tồn tại → `isConsented = false` → session không counted là "ready".

### Bug đã fix trong code (2026-05-06)

1. **Persist path mismatch** — `_persistCookiesToFile` và `loginInBackground` dùng path khác nhau cho Chrome Default → đã unified
2. **Fast path extraction** — Chrome Default đọc từ `User Data\_hyperclip_cookies.json` thay vì `Default\_hyperclip_cookies.json`
3. **isConsented not set** — `loginInBackground` không set `isConsented` sau khi extract → đã thêm

### P0: Cách có SOCS cookie

**⚠️ CDP login tự động KHÔNG bao giờ set SOCS:**
CDP `Network.getAllCookies` trả cookies từ browser IN-MEMORY. Khi profile đã login → return ngay lập tức → user KHÔNG BAO GIỜ thấy consent banner → SOCS không bao giờ được set.

**Cách đúng:**
1. **Đóng HyperClip**
2. **Mở Chrome thường** (không qua HyperClip) → **youtube.com** → **đăng nhập** → **accept consent banner**
3. **Đóng Chrome hoàn toàn**
4. **Mở HyperClip lại** → sessions có SOCS = CAI → Innertube PRIMARY active

Nếu không thấy consent banner:
1. Đóng mọi Chrome windows
2. Mở Chrome → youtube.com → đăng nhập
3. DevTools (F12) → Application → Cookies → youtube.com → delete all cookies
4. Refresh youtube.com → consent banner xuất hiện
5. Accept → SOCS = CAI được set

### OAuth quota thực tế

| Thông số | Giá trị |
|-----------|----------|
| Projects | 33 |
| Units/project/ngày | 9,500 |
| **Tổng quota** | **313,500 units/ngày** |
| Polls/ngày (5s) | 17,280 |
| Units/poll (100 ch, 5 conc) | ~20 units |
| **Tiêu thụ/ngày** | **345,600 units** |
| **Quota overrun** | **+10%** → hết sau ~21 giờ |

### Priority cập nhật

**P0 ngay bây giờ:** Accept consent → SOCS set → Innertube PRIMARY active.

**Phase 2-6 vẫn cần thiết** sau khi fix P0, vì:
- Phase 2: Race condition startup (poller đợi pool init)
- Phase 3: OAuth health check (phát hiện silent death)
- Phase 4: First-poll full capture
- Phase 6: OAuth quota monitoring alert



**Settings page có 4 tabs:** `STATUS` | `OAUTH PROJECTS` | `API KEYS` | `SYSTEM`

**PollerStatusPanel tồn tại** trên tab `STATUS` (tab mặc định) — đây là nơi xem trạng thái detection.

**Cấu trúc Settings page** (`src/app/settings/page.tsx`):
```typescript
// Tab layout (line 2259-2266)
const TABS = [
  { id: 'status'    as const, label: 'STATUS',       color: '#00FF88' },
  { id: 'projects'  as const, label: 'OAUTH PROJECTS', color: '#00FF88' },
  { id: 'keys'      as const, label: 'API KEYS',      color: '#00B4FF' },
  { id: 'system'    as const, label: 'SYSTEM',       color: '#FFB800' },
]

// Content (line 2321-2334)
activeTab === 'status'    → <PollerStatusPanel />      ← DEFAULT, có sẵn
activeTab === 'projects'  → <ProjectsSection />
activeTab === 'keys'      → <ApiKeysSection />
activeTab === 'system'    → <SystemSection />
```

**PollerStatusPanel hiển thị đúng các metrics cần thiết:**
- Innertube Sessions: `X/30 consented` → PRIMARY [ACTIVE]
- OAuth Projects: `X/Y healthy` → FALLBACK [ACTIVE]
- API Keys: count
- Banner: `RUNNING` / `BACKED OFF`

**Lưu ý:** Settings có **password gate**. Nếu đã set password → phải unlock trước khi vào Settings. Nếu chưa set password → thấy màn Password Setup.

---

## 1. Tổng quan kiến trúc hiện tại

```
Electron startup (main.ts:2654-2673)
  ├─ ChromeSessionManager._init()         [extract cookies DPAPI+sql.js, 30 profiles]
  ├─ InnertubeClientPool._doInit()        [pre-warm youtubei.js clients, batch-5, ~12s]
  ├─ Window "did-finish-load" event
  └─ startYouTubePoller(5000)
        ↓
YouTubePoller (5s ± 1s jitter, youtube_poller.ts)
  _pollOnce():
    → fetchSubscriptionFeed(seenVideoIds, sinceMs)
          ├─ STEP 1: Innertube PRIMARY (pool.isReady()? → scan 5 channels/batch)
          │    pool.getLatestVideo(channelId) → getChannel() → extractVideosFromTab()
          │    → top-1 dedup check + age < 10 min filter
          │    → Early exit: stop after 5 new videos found
          │    → 0 videos = NORMAL (not an error), return immediately
          │
          └─ STEP 2: OAuth FALLBACK (only if pool.isReady() = false OR throws)
               TokenManager.getBestAvailable() → playlistItems per channel
               → Quota: 9,500 units/ngày/project (3 projects = 28,500/day)
```

---

## 2. Root Cause Analysis — Tại sao detection có thể đang chết im lặng

### 2.1. Race condition ngay startup (HIGH probability)

**Vấn đề:** `main.ts:2657-2672`:
```typescript
mainWindow.webContents.once('did-finish-load', () => {
  startYouTubePoller(5000, ...)  // ← Poller BẮT ĐẦU ngay
  console.log('[HyperClip] Auto-ingestion active (YouTube API — 20s interval)')
})
```

`YouTubePoller` bắt đầu ngay khi window load xong. Nhưng `InnertubeClientPool._doInit()` chạy **song song** ở startup. Pool init mất ~12 giây (30 sessions, batch-5, mỗi batch ~2.4s với health check).

**Hậu quả:**
- Poll #1 (0s): Pool chưa init xong → `pool.isReady() = false` → **OAuth fallback ngay từ poll đầu tiên**
- Poll #2 (5s): Pool vẫn đang init → OAuth
- Poll #3 (10s): Pool có thể đã ready → Innertube primary
- **→ OAuth quota tốn ~12s × (100 channels / 5 concurrent) × 2 calls/channel = ~40 OAuth calls/polls đầu**

Với 3 projects × 9,500 = 28,500 units/ngày → đủ cho ~285 polls/ngày. Nhưng nếu polling 5s × 17,280 polls/ngày = 17,280 OAuth calls → **OAuth quota hết sau ~1.6 ngày**.

### 2.2. OAuth fallback không bao giờ trigger khi Innertube im lặng (HIGH)

**Vấn đề:** `subscription_feed.ts:265-269`:
```typescript
// Innertube 0 video = normal → KHÔNG fallback
return { videos: results, source: 'innertube' }  // 0 results, no fallback

// OAuth chỉ trigger khi isReady() = false
if (results.length === 0 && !innertubeAvailable) {
  // OAuth fallback
}
```

Nếu Innertube trả về `null` cho mọi kênh (vì mọi video đều đã seen), system:
1. Trả về `{ videos: [], source: 'innertube' }`
2. **Không trigger OAuth**
3. Không có error → poller không biết Innertube đang die
4. User KHÔNG BAO GIỜ biết cho đến khi vào Settings check

**Fix cần:** sau N polls liên tiếp với 0 video từ Innertube → force OAuth health check.

### 2.3. seenVideoIds quá lớn → detection blind (MEDIUM)

`seen-ids.json` cap là 10,000 IDs. Khi full, old IDs bị evict. Nếu:
- App restart
- `seenVideoIds` load từ disk (10,000 IDs)
- Mọi kênh top-video đã nằm trong seen set
- → Mọi kênh return null (seen)
- → 0 detection = im lặng

**Hậu quả:** User mở app sau vài ngày → detection chết im lặng cho đến khi seenVideoIds evict old entries.

### 2.4. Cookie hết hạn sau 14 ngày (MEDIUM)

Chrome session cookies hết hạn sau ~14 ngày không login. HyperClip profiles (2-30) có thể:
- Chưa bao giờ được login
- Đã hết hạn
- SOCS cookie không phải `CAI` (chưa accept Google terms)

### 2.5. Age filter 10 phút quá strict (LOW)

`innertube_client.ts:374`:
```typescript
const MAX_VIDEO_AGE_MS = 10 * 60 * 1000  // 10 phút
if (publishedAt > 0 && Date.now() - publishedAt > MAX_VIDEO_AGE_MS) {
  return null  // top-1 too old → skip ALL videos on this channel
}
```

Nếu kênh không upload trong 10 phút → mọi kênh return null → 0 detection.

---

## 3. Kế hoạch hành động

### Phase 1: Đo lường & Xác nhận trạng thái (Ngày 1)

**Mục tiêu:** Hiểu chính xác trạng thái hệ thống hiện tại trước khi thay đổi.

#### Bước 1.1 — Chạy app, kiểm tra PollerStatus panel trong Settings

Kiểm tra trạng thái trong Settings → Poller Status:

```
Innertube Sessions: X/30 consented
  → PRIMARY [ACTIVE] / cần đăng nhập Chrome

Detection path: innertube / oauth / null
  → innertube = ✅ đang dùng Innertube (không quota)
  → oauth = ⚠️ Innertube đang chết, đang dùng OAuth quota
  → null = 🚨 cả hai đều không có, detection đang chết hoàn toàn
```

**Ghi nhận:** Sessions ready count? Detection path đang dùng gì?

#### Bước 1.2 — Chạy app, kiểm tra Electron logs

Khởi động app từ terminal (không phải .exe production):

```bash
npm run electron:dev 2>&1 | tee startup_log.txt
```

Đợi 30 giây, quan sát:

```
[InnertubePool] Building client pool from 30 Chrome sessions...
[InnertubePool] Session 1: creating client (PSID=xxxx, SAPISID=xxxx, SOCS=xxx)
[InnertubePool] Session 1: ✓ client created and health-checked
[InnertubePool] Session 2: skipped — no cookies extracted
...
[InnertubePool] 1/30 sessions ready
[YouTubePoller] Starting (interval: 5s)
[SubFeed] Innertube: 0 videos across N channels (no new content)
```

**Các pattern bất thường cần ghi nhận:**
- `[InnertubePool] 0/X sessions ready` → không có session nào ready
- `[SubFeed] Innertube: 0 videos across N channels` → poll đang chạy nhưng không detect gì
- `[SubFeed] Innertube: X/Y sessions ready — OAuth fallback` → Innertube chưa init xong đã poll
- `OAuth: early exit at N videos` → đang dùng OAuth quota
- `[SubFeed] Innertube error:` → Innertube đang lỗi

#### Bước 1.3 — Kiểm tra OAuth quota

```bash
# Xem token_stats.json
type "%APPDATA%\HyperClip\token_stats.json"
```

```
usedToday: X (quota còn lại = 9500 - X)
errors: N
```

**Ngưỡng nguy hiểm:** `usedToday > 8000` (80% quota dùng rồi)

---

### Phase 2: Fix Race Condition — Poller đợi Pool Init (Ngày 1)

**Mục tiêu:** Poller không bao giờ start khi Innertube pool chưa ready. Nếu pool chưa ready → đợi tối đa 30s, sau đó dùng OAuth fallback có giới hạn.

**Thay đổi:** `electron/main.ts`

```typescript
// main.ts:2657-2672 — THAY ĐỔI

// Biến để track pool init
let poolInitDone = false
let poolInitStartTime = 0

// Track pool init completion (innertube_client.ts emit event hoặc poll pool.isReady())
// Cách đơn giản nhất: poll pool.isReady() cho đến khi ready hoặc timeout
async function waitForInnertubePool(maxWaitMs = 30_000): Promise<boolean> {
  const { getInnertubePoolSync } = await import('./services/innertube_client.js')
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const pool = getInnertubePoolSync()
    if (pool?.isReady()) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

if (mainWindow) {
  mainWindow.webContents.once('did-finish-load', async () => {
    // Đợi Innertube pool init (tối đa 30s)
    const poolReady = await waitForInnertubePool(30_000)
    if (!poolReady) {
      console.warn('[HyperClip] Innertube pool not ready after 30s — using OAuth fallback')
    }

    startYouTubePoller(5_000, (videos) => {
      for (const v of videos) {
        console.log(`[AutoIngest] new video detected: ${v.title} (${v.channelName})`)
        showWindowsToast('📥 Video mới!', `${v.channelName}: ${v.title}`)
        enqueueBgDownload(v)
      }
    })
    console.log('[HyperClip] Auto-ingestion active (5s interval, pool ready=' + poolReady + ')')
    startSystemMonitor()
  })
}
```

**Verification:**
- Logs: `[HyperClip] Auto-ingestion active (pool ready=true)` hoặc `(pool ready=false)`
- Nếu `pool ready=false` → kiểm tra Innertube pool logs, session ready count

---

### Phase 3: Fix Silent Detection Death — OAuth Health Check (Ngày 2)

**Mục tiêu:** Nếu Innertube trả về 0 video trong N polls liên tiếp → force một OAuth call để verify Innertube có thực sự die hay không.

**Thay đổi:** `electron/services/subscription_feed.ts`

```typescript
// Thêm counter cho consecutive zero-result polls
let _consecutiveZeroPolls = 0
const ZERO_POLL_THRESHOLD = 3  // Sau 3 polls liên tiếp = 0 video → force OAuth check

// Trong fetchSubscriptionFeed():
// Sau khi Innertube trả 0 video:
if (results.length === 0) {
  _consecutiveZeroPolls++
  if (_consecutiveZeroPolls >= ZERO_POLL_THRESHOLD) {
    console.warn(`[SubFeed] ⚠️ ${_consecutiveZeroPolls} consecutive Innertube zero-result polls — forcing OAuth health check`)
    // Force OAuth check (dùng 1 call tối thiểu)
    const tm = getTokenManager()
    const best = await tm.getBestAvailable()
    if (best) {
      // Gọi 1 channel để verify OAuth còn sống
      const testChannel = getChannels()[0]
      if (testChannel) {
        const result = await fetchChannelWithOAuth(testChannel, best.token, best.projectId, seenVideoIds, cutoff)
        if (result.video) {
          // OAuth works → Innertube có thể đang im lặng
          console.warn('[SubFeed] OAuth health check OK — Innertube sessions may be alive but returning seen videos')
        } else {
          // OAuth cũng 0 video → bình thường (không có video mới thật)
          console.log('[SubFeed] OAuth health check: no new videos either — all sources truly empty')
        }
      }
    }
    _consecutiveZeroPolls = 0  // Reset sau khi check
  }
} else {
  _consecutiveZeroPolls = 0  // Có video → reset
}
```

**Verification:**
- Logs: `[SubFeed] ⚠️ 3 consecutive Innertube zero-result polls — forcing OAuth health check`
- Không xuất hiện khi có video mới

---

### Phase 4: Fix seenVideoIds Blind Spot — First-Run Full Capture (Ngày 2)

**Mục tiêu:** App restart xong → lần poll đầu tiên phải capture mọi video chưa seen, không bị age filter block.

**Cơ chế hiện tại (đã đúng trên lý thuyết):**
```typescript
// youtube_poller.ts:210 — seenVideoIds được load từ disk tại startup
// subscription_feed.ts:55-59: First poll: NO age filter (sinceMs = 0)
// HYPERCLIP_RULES.md section 3:
//   "First poll on app startup: NO age filter — captures any video not yet seen."
```

**Xác nhận:** Kiểm tra `sinceMs` được truyền vào đúng:
```typescript
// youtube_poller.ts:205
const sinceMs = Date.now() - MAX_VIDEO_AGE_MS  // = Date.now() - 30 phút
// subscription_feed.ts:225
const cutoff = sinceMs ?? Date.now()  // = Date.now() - 30 phút (NOT 0)
```

**⚠️ Bug tìm thấy:** `HYPERCLIP_RULES.md` nói "NO age filter for first poll" nhưng code truyền `Date.now() - 30 phút`. Cần xác nhận đây là spec hay bug.

**Fix (nếu cần):**
```typescript
// youtube_poller.ts
// Thêm flag để distinguish first poll vs ongoing
let _isFirstPoll = true

private async _pollOnce(): Promise<void> {
  const sinceMs = _isFirstPoll ? 0 : Date.now() - MAX_VIDEO_AGE_MS
  _isFirstPoll = false
  // ... rest of poll
}
```

**Verification:** App restart → poll đầu tiên phải detect video mới nhất trên mỗi kênh (không bị age filter).

---

### Phase 5: Cookie Health Monitoring & Auto-Refresh (Ngày 3)

**Mục tiêu:** Session cookies hết hạn → được phát hiện và refresh tự động trước khi chết.

**Hiện tại:** `chrome_cookies.ts:628-655` có background refresh mỗi 10 phút cho top-5 sessions. Nhưng:
1. Không refresh all sessions (chỉ top-5)
2. Không có alert khi session die
3. Không track cookie expiry date

**Thay đổi:** Thêm session health tracking + alert trong poller status

```typescript
// chrome_cookies.ts — ChromeSession interface thêm:
interface ChromeSession {
  // ... existing fields
  lastRefreshAt: number
  refreshErrorCount: number
  cookieExpiryDays: number | null  // ước tính từ SOCS/PSID expiry
}

// Thêm health check mỗi 5 phút cho all sessions
// Nếu >50% sessions die → alert "Chrome login required"
```

**Thêm vào Settings UI:**
- Hiển thị "Session health" với màu: 🟢 >50% ready, 🟡 20-50%, 🔴 <20%
- Nếu <20% → show button "Mở Chrome login" với instructions

**Verification:**
- Restart app → check session health trong Settings
- Log out một Chrome profile → verify session marked as "no cookies"
- Re-login → verify session recovered

---

### Phase 6: OAuth Quota Monitoring (Ngày 3)

**Mục tiêu:** OAuth quota exhaustion không gây detection death mà không báo trước.

**Thay đổi:** `subscription_feed.ts` — thêm quota monitoring

```typescript
// Thêm quota check trước mỗi OAuth fallback call
const tm = getTokenManager()
const statuses = tm.getAllStatuses()
const totalRemaining = statuses.reduce((sum, s) => {
  if (s.status === 'exhausted') return sum
  return sum + (9500 - (s.usedToday ?? 0))
}, 0)

if (totalRemaining < 100) {
  console.error('[SubFeed] 🚨 OAuth quota critical: only ' + totalRemaining + ' units remaining across all projects')
  // Alert user trong Settings UI
}

// Thêm PollerStatus panel: OAuth quota remaining (tổng tất cả projects)
```

**Thêm vào Settings PollerStatus panel:**
```
OAuth Quota: X/28,500 units remaining (Y% used today)
  → X < 1000 → 🔴 CRITICAL: Add GCP project in Settings
  → X < 5000 → 🟡 WARNING: Quota running low
  → X >= 5000 → 🟢 OK
```

---

### Phase 7: Comprehensive Test Plan (Ngày 4-5)

#### Test Case 1: Cold Start (App vừa cài xong, không có cookies)

1. Xóa mọi HyperClip Chrome profiles: `rmdir /s "%LOCALAPPDATA%\HyperClip-Chrome-Profile-*"`
2. Xóa `oauth_tokens.json`, `token_stats.json`
3. Start app
4. **Expected:** PollerStatus panel hiển thị "0/30 sessions ready" + "Detection: null (no auth)"
5. **Expected:** Toast/alert "Cần đăng nhập Chrome để bắt đầu detection"
6. **Expected:** OAuth fallback NOT used (no quota wasted)

#### Test Case 2: Startup Race Condition

1. Start app
2. Quan sát logs trong 30 giây đầu
3. **Expected:** Logs phải hiển thị Innertube pool init X/30 ready trước khi poller bắt đầu
4. **Expected:** Không có OAuth fallback trong 30 giây đầu (vì pool init)

#### Test Case 3: Real Video Detection

1. Setup với 5 test channels (tạo 5 workspaces bằng video đã biết)
2. Upload một video mới trên 1 trong 5 channels (từ điện thoại)
3. Bật app, đợi 5 polls (25 giây)
4. **Expected:** Toast hiển thị "📥 Video mới!" trong < 20 giây
5. **Expected:** Workspace được tạo tự động trong dashboard
6. **Expected:** Logs: `[AutoIngest] new video detected: <title> (<channel>)`

#### Test Case 4: OAuth Fallback Activation

1. Disable all Innertube sessions (fake cookies)
2. Verify OAuth is used (check logs `[SubFeed] Innertube: 0/30 sessions ready — OAuth fallback`)
3. Verify quota used incremented
4. **Expected:** PollerStatus panel shows "Detection: oauth"

#### Test Case 5: OAuth Quota Exhaustion

1. Set `token_stats.json` → `usedToday: 9000` (near exhaustion)
2. Start app
3. **Expected:** Warning in PollerStatus: "OAuth quota < 5000 units remaining"
4. **Expected:** After exhaustion → poller backoff với exponential delay

#### Test Case 6: 24-Hour Stability

1. Start app với 10 channels
2. Để chạy 24 giờ
3. **Metrics cần thu thập:**
   - Total polls: ~17,280 (5s interval)
   - Videos detected: count từ dashboard
   - OAuth units used: from `token_stats.json`
   - Innertube sessions alive: from PollerStatus
   - Detection latency: từ `detectedAt - publishedAt` timestamps

---

## 4. Monitoring & Alerting Checklist

### Trong Settings → Poller Status Panel (đã implement, verify đầy đủ):

| Metric | Indicator | Action |
|--------|-----------|--------|
| Innertube sessions ready | 🟢 X/30 consented | ✅ Primary detection active |
| Innertube sessions ready | 🔴 0/X sessions | Cần đăng nhập Chrome profiles |
| Detection path | `innertube` | ✅ Không quota limit |
| Detection path | `oauth` | ⚠️ Innertube die → đang dùng quota |
| Detection path | `null` | 🚨 Cả hai đều không có |
| OAuth quota remaining | 🟢 >5000 units | ✅ Đủ cho cả ngày |
| OAuth quota remaining | 🟡 1000-5000 | ⚠️ Thêm GCP project sớm |
| OAuth quota remaining | 🔴 <1000 | 🚨 Thêm GCP project NGAY |
| Poller backoff | ⚠️ BACKED OFF | Kiểm tra logs + resources |
| Poller active | ✅ Scanning... | Đang chạy |

### Startup Log Checklist:

```
✅ [InnertubePool] X/30 sessions ready
✅ [YouTubePoller] Starting (interval: 5s)
✅ [Auto-ingestion] pool ready=true
✅ [SubFeed] Innertube: N videos found — returning  (HOẶC)
✅ [SubFeed] Innertube: 0 videos across N channels  (0 = normal nếu không có video mới)
```

### Runtime Log Health Signals:

```
🚨 [InnertubePool] 0/X sessions ready              → Cần login Chrome
🚨 [SubFeed] Innertube: 0/X sessions ready — OAuth fallback  → OAuth quota đang bị dùng
🚨 [SubFeed] OAuth: early exit at N videos         → OAuth quota đang active
🚨 [YouTubePoller] Backoff 60s (attempt #1)         → Cả hai path đều chết
🚨 [TokenManager] Proactive refresh failed for X tokens → OAuth tokens cần re-auth
```

---

## 5. Priority Matrix

| Priority | Fix | Effort | Impact | Risk |
|----------|-----|--------|--------|------|
| P0 | Phase 2: Poller đợi pool init | 1h | Ngăn OAuth quota waste ngay startup | Low |
| P0 | Phase 3: OAuth health check khi Innertube silent | 2h | Phát hiện detection death | Low |
| P1 | Phase 4: First-poll full capture | 1h | Fix seenVideoIds blind spot | Low |
| P1 | Phase 6: OAuth quota monitoring in UI | 2h | Alert trước khi quota hết | Low |
| P2 | Phase 5: Cookie health monitoring | 3h | Proactive session refresh | Medium |
| P2 | Phase 7: Test cases 1-5 | 4h | Xác nhận fix hiệu quả | Low |
| P3 | Phase 7: 24-hour stability test | 24h | Baseline performance | - |

---

## 6. Rollout Plan

### Sprint 1 (Day 1-2): Foundation Fixes
- [x] Phase 2: Fix poller startup race → **NO-OP**: pool init is lazy, no race condition exists
- [x] Phase 3: Add OAuth health check → `_consecutiveZeroInnertubePolls` counter + health check after 3 zero polls
- [x] Phase 6: OAuth quota monitoring in Settings UI → quota row + critical warning in PollerStatusPanel
- [x] Phase 5: Cookie health monitoring → session health alerts in PollerStatusPanel
- [x] Phase 4: First-poll full capture → `_isFirstPoll` flag → 24h age filter for first poll
- [x] `npx tsc --noEmit` — verify no TypeScript errors

### Sprint 2 (Day 3-4): Monitoring & First Poll Fix
- [x] Phase 4: First-poll full capture → `_isFirstPoll` flag, 24h age filter
- [x] Phase 6: OAuth quota monitoring in Settings UI
- [x] Phase 5: Cookie health monitoring + alerts (implemented 3-tier background refresh)
- [ ] Test Case 1: Cold start test
- [ ] Test Case 3: Real video detection test

### Sprint 3 (Day 5+): Production Validation
- [ ] Test Case 5: OAuth quota exhaustion test
- [ ] **24-hour stability test (Phase 7)**
- [ ] Commit vào `HYPERCLIP_RULES.md` để cập nhật source of truth

---

## 7. Success Criteria

| Metric | Target | Current (baseline) |
|--------|--------|-------------------|
| Detection latency | < 20s p95 | Cần đo sau Phase 7 |
| Detection path | Innertube primary (>95% polls) | Cần đo sau Phase 7 |
| OAuth quota usage | < 500 units/ngày (khi Innertube OK) | Cần đo sau Phase 7 |
| Detection uptime | 24/7 (zero silent death) | Cần đo sau Phase 7 |
| Startup OAuth waste | 0 OAuth calls trong 30s đầu | Cần đo sau Phase 2 |
| Poller status visibility | 100% trong Settings UI | Partial (cần Phase 6) |

---

## 8. Next Steps (cho PO)

1. **Hôm nay:** Chạy `npm run electron:dev`, kiểm tra Settings → Poller Status, ghi lại:
   - Sessions ready: X/30
   - Detection path: innertube / oauth / null
   - OAuth quota: X/28,500 units
2. **Gửi cho Claude logs startup (30s đầu)** — để confirm race condition có xảy ra không
3. **Sau khi confirm:** Approve Phase 2 + Phase 3 implementation
