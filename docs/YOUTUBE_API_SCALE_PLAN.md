# HyperClip — YouTube API Scale Plan: 200 Projects Architecture

> **Date:** 2026-05-14
> **Goal:** Maximize YouTube API detection throughput using 200 GCP projects (10 Gmail × ~20 projects/gmail).
> **Target:** Bắt 100% video mới trong < 20 giây, chạy 24/7 cho ~100-500 kênh.

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Quota Math — 200 Projects](#2-quota-math--200-projects)
3. [Cấu trúc thư mục mới (Project-based)](#3-cấu-trúc-thư-mục-mới-project-based)
4. [Hybrid Detection Pipeline](#4-hybrid-detection-pipeline)
5. [Project Manager — Quản lý 200 projects tự động](#5-project-manager--quản-lý-200-projects-tự-động)
6. [OAuth Token Manager — Multi-Project Rotation](#6-oauth-token-manager--multi-project-rotation)
7. [API Key Manager — Pool thông minh](#7-api-key-manager--pool-thông-minh)
8. [Bulk Import — Setup 200 projects từ spreadsheet](#8-bulk-import--setup-200-projects-từ-spreadsheet)
9. [Settings UI — Quản lý project trong app](#9-settings-ui--quản-lý-project-trong-app)
10. [Detection Flow Chi tiết](#10-detection-flow-chi-tiết)
11. [Thay đổi file cần thực hiện](#11-thay-đổi-file-cần-thực-hiện)
12. [Migration Plan](#12-migration-plan)

---

## 1. Tổng quan kiến trúc

### Triết lý

```
Innertube (30 Chrome sessions, 0 quota) = PRIMARY DETECTION
   → Bắt video trong < 5s, 100% coverage, ~200ms/call

200 OAuth Projects (10k units/project/day) = DISTRIBUTED COVERAGE
   → Xác minh, dự phòng, continuous scan
   → Mỗi project chỉ cần scan ~1-2 channels/poll
   → Quota cực dư khi dùng Innertube primary

Innertube Dead = 200 OAuth projects FILL THE GAP
   → Round-robin 200 projects × channels
   → Tất cả 200 project đều active, không có project nào idle
```

### Hai lớp xác thực — Vai trò mới

| Lớp | Công nghệ | Quota | Vai trò | Tần suất |
|------|-----------|-------|---------|----------|
| **Lớp 1 — Innertube PRIMARY** | youtubei.js (30 sessions) | **0 quota** | Real-time detection, 5s poll, < 5s latency | 100% polls |
| **Lớp 2 — OAuth DISTRIBUTED** | 200 GCP projects (OAuth 2.0) | **10k units/project/day** | Coverage verify, per-channel monitor, Innertube fallback | Secondary |

**Ưu điểm:** Innertube lo detection (0 quota). 200 OAuth projects lo coverage redundancy + fallback khi Innertube die.

---

## 2. Quota Math — 200 Projects

### Tổng quota

```
200 projects × 10,000 units/project/day = 2,000,000 units/day
```

### Chi phí thực tế

| Nguồn | Chi phí/poll | Poll/ngày (5s) | Tổng/ngày |
|-------|-------------|-----------------|-----------|
| Innertube (PRIMARY) | 0 quota | 17,280 | **0** |
| OAuth — publishedAt=0 verify (Innertube verify) | ~1 unit/call | ~300-500 calls | ~500 units |
| OAuth — Innertube fallback (khi die) | ~20 units | rare | variable |
| OAuth — Continuous distributed scan | ~1-2 units/project/poll | — | **Xem bảng dưới** |

### OAuth Distributed Scan — Chi phí cực thấp

**Strategy:** Mỗi poll chỉ scan 1 subset channels bằng OAuth → phân bổ đều qua 200 projects.

```
Giả sử 100 channels:
- Mỗi poll (5s): Innertube scan ALL 100 channels → 0 quota
- Mỗi poll: OAuth scan 1-2 random channels (coverage check)
- 1 channel scan = 2 API calls (channel detail + playlistItems)
- 1 poll = 2-4 OAuth units

OAuth units/ngày = 17,280 polls × 4 units = ~69,000 units
200 projects × 10,000 = 2,000,000 units (đủ dùng 29 ngày!)
```

### Khi Innertube Die — Full OAuth Coverage

```
Nếu Innertube die hoàn toàn (30 sessions đều fail):
→ 200 projects × 10,000 units = 2,000,000 units/ngày
→ 100 channels, 1 call/channel = 100 units/poll
→ 17,280 polls × 100 units = 1,728,000 units/ngày
→ 2,000,000 - 1,728,000 = 272,000 units buffer (dư dùng 1.5 ngày)

Thời gian Innertube die → có thể chạy FULL OAuth trước khi hết quota
```

### Kết luận

- **Innertube PRIMARY:** 0 quota, < 5s detection → dùng TỐI ĐA
- **200 OAuth projects:** Quota gần như vô hạn cho fallback + verify
- **Chi phí thực tế OAuth/ngày:** ~70k units (3.5% của 2M total) → để dành cho fallback

---

## 3. Cấu trúc thư mục mới (Project-based)

### Nguyên tắc

> **Mọi thứ liên quan đến project nằm trong thư mục project đó.**
> **Thư mục gốc `HyperClip-Data/` chứa tất cả projects + data chung.**

### Cấu trúc mới

```
HyperClip-Data/
├── projects/                          ← THƯ MỤC CHÍNH CHO 200 PROJECTS
│   ├── proj-001/                      ← Mỗi project = 1 folder
│   │   ├── config.json                ← Project credentials + metadata
│   │   │   # {
│   │   │   #   "projectId": "proj-001",
│   │   │   #   "projectName": "Gmail 1 - Project A",
│   │   │   #   "clientId": "xxx",
│   │   │   #   "clientSecret": "xxx",
│   │   │   #   "apiKey": "xxx",
│   │   │   #   "gmailAccount": "user1@gmail.com",
│   │   │   #   "createdAt": "2026-05-14",
│   │   │   #   "assignedChannels": ["UCxxx", "UCyyy"],
│   │   │   #   "status": "active"
│   │   │   # }
│   │   ├── stats.json                 ← Quota stats riêng (auto-updated)
│   │   │   # {
│   │   │   #   "usedToday": 345,
│   │   │   #   "errors": 0,
│   │   │   #   "lastUsed": 1747200000,
│   │   │   #   "lastResetAt": "2026-05-14",
│   │   │   #   "unauthorized": false
│   │   │   # }
│   │   ├── token.json                 ← OAuth token (nếu đã authorize)
│   │   └── logs/
│   │       └── detection.log          ← Detection log riêng (optional)
│   ├── proj-002/
│   │   ├── config.json
│   │   ├── stats.json
│   │   └── token.json
│   ├── ...
│   └── proj-200/
│
├── channels/                          ← Channel metadata chung
│   ├── list.json                     ← Danh sách channels
│   ├── seen-videos.json             ← Seen video IDs
│   └── uploads-cache.json           ← Uploads playlist cache
│
├── downloads/                        ← Video source files
│   └── [videoId]_[workspaceId].mp4
│
├── blur/                            ← Blur backgrounds
│   └── [workspaceId]_blur.jpg
│
├── output/                          ← Rendered videos (TRƯỚC archive)
│   └── [workspaceId]_rendered.mp4
│
├── archived/                        ← FINAL OUTPUT — tất cả sản phẩm render
│   ├── 2026-05/
│   │   ├── [channelName]_[videoTitle]_[date].mp4
│   │   └── ...
│   └── 2026-06/
│
├── app/                            ← App metadata
│   ├── workspaces.json
│   ├── rendered.json
│   ├── oauth_config.json           ← Tổng hợp: map projectId → credentials (legacy compat)
│   ├── oauth_tokens.json           ← Tổng hợp: map projectId → token (legacy compat)
│   ├── key_stats.json             ← Key manager stats
│   └── api_keys.json              ← API keys (legacy compat)
│
├── logs/                           ← App-wide logs
│   ├── app.log
│   ├── detection.log
│   └── render.log
│
└── chrome-profiles/               ← 30 Chrome profiles (Innertube cookie source)
    ├── profile-1/
    ├── ...
    └── profile-30/
```

### Project Config File (`projects/proj-XXX/config.json`)

```json
{
  "projectId": "proj-001",
  "projectName": "Gmail1-ProjectA",
  "gmailAccount": "user1@gmail.com",
  "clientId": "xxx.apps.googleusercontent.com",
  "clientSecret": "GOCSPX-xxx",
  "apiKey": "AIzaSy-xxx",
  "assignedChannels": [],
  "status": "active",
  "createdAt": "2026-05-14T00:00:00Z",
  "lastUsedAt": "2026-05-14T10:30:00Z",
  "totalQuotasUsed": 45000
}
```

### Quy tắc lưu trữ

1. **Project config + token + stats:** Mỗi project trong folder riêng → dễ backup, migrate
2. **Credentials:** Chỉ trong `config.json` (mỗi project folder) + `oauth_config.json` (tổng hợp)
3. **Video files:** Không lưu trong project folder → lưu ở `downloads/`, `output/`, `archived/`
4. **Channel data:** Tất cả channels chung ở `channels/` → không phân chia theo project

---

## 4. Hybrid Detection Pipeline

### Flow tổng quát

```
YouTubePoller (5s ± 20% jitter)
         │
         ├─ [1] Innertube PRIMARY (30 sessions, 0 quota)
         │     └─ Round-robin sessions
         │     └─ getLatestVideo per channel (top-1..top-5)
         │     └─ Early termination: stop after 5 new videos
         │     └─ publishedAt=0 → OAuth verify
         │
         └─ [2] OAuth DISTRIBUTED (200 projects)
               └─ Continuous coverage scan
               └─ Per-channel assigned project
               └─ Round-robin: phân bổ 200 projects → 100 channels
               └─ Khi Innertube die → ALL 200 projects fill gap
```

### Chiến lược phân bổ Project → Channel

```
200 projects → 100 channels
→ Mỗi channel được gán 2 projects (primary + backup)
→ Projects được phân bổ round-robin:
  - Channel 0: proj-000, proj-100
  - Channel 1: proj-001, proj-101
  - ...
  - Channel 99: proj-099, proj-199

Mỗi poll:
- Innertube: scan ALL 100 channels (0 quota)
- OAuth distributed: scan 1-2 channels/project (mỗi project ~1 unit/poll)
- → Mỗi project dùng ~345 units/ngày (17 polls × 2 calls × ~1 unit)
- → 200 projects × 345 = ~69,000 units/ngày (3.5% của 2M)
```

### Detection Priority (chi tiết)

```
1. Innertube (30 sessions) → 0 quota, ~200ms
   → Check ALL 100 channels per poll
   → publishedAt=0 → OAuth verify (1 project, ~1 unit)

2. OAuth DISTRIBUTED (200 projects)
   → Continuous scan: mỗi channel được verify bằng OAuth 1-2 lần/phút
   → Per-channel dedicated project: assigned project scan assigned channel
   → Round-robin: unused projects scan random channels
   → ~2 units/poll (1 channel × 2 API calls)

3. OAuth FULL COVERAGE (Innertube die)
   → Tất cả 200 projects scan tất cả channels
   → ~100 units/poll × 200 projects active
   → Có thể duy trì 17,280 polls × 100 units = 1.728M units/ngày
```

---

## 5. Project Manager — Quản lý 200 projects tự động

### File: `electron/services/project_manager.ts`

**Trách nhiệm:**
1. Load tất cả 200 project configs từ `projects/` folder
2. Auto-assign channels to projects (round-robin)
3. Track quota per project (stats.json)
4. Auto-disable exhausted projects
5. Auto-recover projects after reset (midnight UTC)
6. Persist assignment map

### Cấu trúc dữ liệu

```typescript
interface GCPProject {
  projectId: string          // "proj-001"
  projectName: string       // "Gmail1-ProjectA"
  gmailAccount: string      // "user1@gmail.com"
  clientId: string
  clientSecret: string
  apiKey: string
  status: 'active' | 'exhausted' | 'unauthorized' | 'pending_auth'
  assignedChannels: string[] // Channel IDs được gán (1-2 channels)
  usedToday: number
  errorsToday: number
  lastUsedAt: number
  totalUsed: number
  createdAt: string
}

interface ChannelAssignment {
  channelId: string
  primaryProjectId: string
  backupProjectId: string
}
```

### Core logic

```typescript
class ProjectManager {
  // Load all 200 projects from projects/ folder
  loadProjects(): void

  // Auto-assign channels to projects (round-robin)
  // Call after channel add/remove or project add/remove
  reassignChannels(): void

  // Get the project to use for a specific channel
  getProjectForChannel(channelId: string): GCPProject | null

  // Get least-used active project (for on-demand scan)
  getLeastUsedProject(): GCPProject | null

  // Mark project exhausted (quota hit or 5+ errors)
  markExhausted(projectId: string): void

  // Auto-recover: reset stats at midnight UTC, re-enable all
  checkMidnightReset(): void

  // Persist stats to projects/proj-XXX/stats.json
  persistStats(): void
}
```

### Auto-exhaustion logic

```typescript
// Exhaustion conditions:
// 1. 5 consecutive quota errors (403) OR
// 2. usedToday >= 9500 (95% quota) OR
// 3. 3 consecutive 401 (unauthorized/revoked)

// Recovery:
// 1. Auto at midnight UTC: reset all stats, re-enable all
// 2. Manual: user reset from Settings UI
// 3. New project added: auto-assign channels
```

---

## 6. OAuth Token Manager — Multi-Project Rotation

### File: `electron/services/token_manager.ts` (refactor)

**Thay đổi từ bản hiện tại:**

1. **Nguồn credentials:** Đọc từ `projects/proj-XXX/config.json` (mới) + `oauth_config.json` (legacy compat)
2. **Nguồn tokens:** Đọc từ `projects/proj-XXX/token.json` (mới) + `oauth_tokens.json` (legacy compat)
3. **Nguồn stats:** Đọc từ `projects/proj-XXX/stats.json` (mới) + `token_stats.json` (legacy compat)
4. **Rotation:** Round-robin 200 projects với weighted distribution (least-used first)

### Rotation Strategy

```typescript
// getBestAvailable() — smart rotation
// 1. Filter: skip exhausted/unauthorized
// 2. Weight by remaining quota
// 3. Prefer projects with assigned channels (coverage priority)
// 4. Fallback to least-used project (random channel scan)
async getBestAvailable(channelId?: string): Promise<TokenSet | null>
```

### Per-Channel Token Selection

```typescript
// Khi detect cho 1 channel cụ thể:
// → Dùng assigned primary project (coverage scan)
// → Fallback: assigned backup project
// → Second fallback: least-used any project
async getTokenForChannel(channelId: string): Promise<TokenSet | null>
```

### Token Persistence — Multi-file

```
projects/
  proj-001/
    token.json     ← access_token, refresh_token, expires_at (INDIVIDUAL)
  proj-002/
    token.json
  ...

app/
  oauth_config.json   ← { proj-001: {clientId, clientSecret}, ... } (AGGREGATE for Settings UI)
  oauth_tokens.json   ← [token objects] (LEGACY compat — kept for existing code)
```

---

## 7. API Key Manager — Pool thông minh

### File: `electron/services/key_manager.ts` (refactor)

**Thay đổi:**
1. Đọc API keys từ `projects/proj-XXX/config.json`
2. Stats per key trong `projects/proj-XXX/stats.json`
3. Auto-pairing: API key + OAuth token cùng project (không dùng chéo)

### Auto-key rotation

```typescript
// getKeyForProject(projectId) — chỉ dùng key cùng project
// Nếu project có API key → dùng key đó
// Nếu không có → fall back to shared pool (legacy)

// Project config có apiKey → key cố định cho project đó
// Không có apiKey trong config → dùng chung pool
```

---

## 8. Bulk Import — Setup 200 projects từ spreadsheet

### Script: `scripts/bulk-import-projects.js`

**Input:** CSV/JSON spreadsheet
```csv
projectId,apiKey,clientId,clientSecret,gmail,projectName,status
proj-001,AIzaSy-xxx,...,...,user1@gmail.com,Gmail1-ProjA,pending
proj-002,AIzaSy-yyy,...,...,user1@gmail.com,Gmail1-ProjB,pending
...
proj-200,AIzaSy-zzz,...,...,user20@gmail.com,Gmail20-ProjZ,pending
```

**Output:** Tạo folder + config.json + stats.json cho từng project

```javascript
// Pseudocode
for (const entry of ENTRIES) {
  const dir = `projects/${entry.projectId}/`
  fs.mkdirSync(dir, { recursive: true })

  // config.json
  fs.writeFileSync(`${dir}config.json`, JSON.stringify({
    projectId: entry.projectId,
    projectName: entry.projectName,
    gmailAccount: entry.gmail,
    clientId: entry.clientId,
    clientSecret: entry.clientSecret,
    apiKey: entry.apiKey,
    status: 'pending_auth',
    assignedChannels: [],
    createdAt: new Date().toISOString(),
  }))

  // stats.json
  fs.writeFileSync(`${dir}stats.json`, JSON.stringify({
    usedToday: 0,
    errors: 0,
    lastUsed: 0,
    lastResetAt: new Date().toISOString().split('T')[0],
    unauthorized: false,
  }))
}
```

### OAuth Authorization — Batch Flow

```typescript
// Sau khi bulk import:
// 1. Mở browser cho từng project → user authorize
// 2. Extract token từ callback URL
// 3. Save vào projects/proj-XXX/token.json
// 4. Update projects/proj-XXX/config.json: status = 'active'

// Hoặc dùng headless OAuth flow nếu có refresh_token sẵn
```

---

## 9. Settings UI — Quản lý project trong app

### Tab: "Projects (200)"

```
┌─ HyperClip Settings ──────────────────────────────────────────┐
│ [Channels] [Projects (200)] [Chrome Sessions] [Poller] [Keys] │
├───────────────────────────────────────────────────────────────┤
│  Project Manager — 200 GCP Projects                          │
│  Total quota: 2,000,000 units/day | Used today: ~69,000      │
│  Active: 198 | Exhausted: 2 | Pending auth: 0               │
├───────────────────────────────────────────────────────────────┤
│  [Import CSV]  [Export]  [Auto-assign channels]  [Reset all] │
├───────────────────────────────────────────────────────────────┤
│  Gmail: user1@gmail.com (20 projects)                        │
│  ├─ proj-001  AIzaSy-xxx  healthy  345/9500   [Authorize]  │
│  ├─ proj-002  AIzaSy-yyy  healthy  512/9500   [Authorize]  │
│  └─ ... (20 total)                                          │
│                                                             │
│  Gmail: user2@gmail.com (20 projects)                        │
│  ├─ proj-021  healthy  289/9500   [Authorize]              │
│  └─ ...                                                     │
├───────────────────────────────────────────────────────────────┤
│  Channel Assignments                                         │
│  Channel: MrBeast (UCX) → proj-001 (primary), proj-101 (bup)│
│  Channel: Markiplier (UCY) → proj-002 (primary), proj-102  │
│  ...                                                        │
└───────────────────────────────────────────────────────────────┘
```

### Features:
1. **Group by Gmail account** — dễ quản lý 20 accounts
2. **Per-project quota bar** — visualize usage
3. **One-click authorize** — OAuth flow per project
4. **Channel assignment matrix** — xem project nào scan channel nào
5. **Bulk actions:** Import CSV, Reset all stats, Auto-assign

---

## 10. Detection Flow Chi tiết

### Mỗi poll (5s):

```
T=0.000s: YouTubePoller._pollOnce() triggered
│
├─ Innertube Pool: getLatestVideo(channel_0..channel_99)
│     └─ 30 sessions, round-robin, ~200ms/call
│     └─ Early exit: stop after 5 new videos
│
├─ OAuth Distributed: verify 1-2 random channels
│     └─ getProjectForChannel(channel)
│     └─ OAuth API: /channels + /playlistItems
│     └─ ~1-2 units/poll
│
└─ Innertube publishedAt=0 → OAuth verify (1 unit)
```

### Auto-download flow:

```
Innertube/OAuth detect new video
  → autoDownload(videoId, videoUrl)
  → yt-dlp --download-sections (trim minutes)
  → createWorkspace()
  → notify user
```

### Quota consumption per minute:

```
Minute 1: Innertube scan + OAuth distributed = ~4 units total
Minute 2: Innertube scan + OAuth distributed = ~4 units
...
Per hour: ~240 units
Per day: ~5,760 units
200 projects × 10,000 = 2,000,000 (dư 1,994,240 units = 346 ngày!)
```

### Khi Innertube die (tất cả 30 sessions fail):

```
1. Detect: pool.isReady() = false for 3 consecutive polls
2. Switch: OAuth FULL COVERAGE mode
   → 200 projects scan ALL channels
   → ~100 units/poll (100 channels × 1 call/channel)
   → 17,280 polls × 100 = 1,728,000 units/ngày
   → 200 projects = 2,000,000 units (12% buffer)
3. Innertube recover: auto-switch back (pool.isReady() = true again)
```

---

## 11. Thay đổi file cần thực hiện

### Tạo mới

| File | Mô tả |
|------|--------|
| `electron/services/project_manager.ts` | Project Manager — 200 projects auto-management |
| `scripts/bulk-import-projects.js` | Bulk import từ spreadsheet |
| `scripts/authorize-batch.js` | Batch OAuth authorization |
| `docs/YOUTUBE_API_SCALE_PLAN.md` | Plan doc này |

### Sửa

| File | Thay đổi |
|------|----------|
| `electron/services/token_manager.ts` | Đọc từ `projects/` folder (multi-file) + legacy compat |
| `electron/services/key_manager.ts` | Đọc API keys từ `projects/` config |
| `electron/services/paths.ts` | Thêm `getProjectsDir()`, update `getAppStoreDir()` |
| `electron/services/subscription_feed.ts` | Hybrid: Innertube PRIMARY + OAuth DISTRIBUTED |
| `electron/services/store.ts` | Channels/seen-videos trong `channels/` folder |
| `electron/main.ts` | Khởi tạo ProjectManager, channel assignment |
| `src/app/settings/page.tsx` | Thêm Projects (200) tab |

### Migration

| Bước | Hành động |
|------|-----------|
| 1 | Tạo `projects/` folder structure |
| 2 | Migrate existing tokens/keys → project folders |
| 3 | Tạo `channels/` folder, migrate channels.json |
| 4 | Update paths.ts → new directories |
| 5 | Update token_manager.ts → multi-file reading |
| 6 | Update key_manager.ts → project-based |
| 7 | Implement project_manager.ts |
| 8 | Update subscription_feed.ts → hybrid pipeline |
| 9 | Update Settings UI → Projects tab |
| 10 | Test: bulk import + detection |

---

## 12. Migration Plan

### Phase 1: Storage Reorganization

```
Bước 1: Update paths.ts — thêm new directory constants
Bước 2: Tạo migration script — chuyển existing data → new structure
Bước 3: Update store.ts — channels/seen-videos vào channels/ folder
Bước 4: Update token_manager.ts — đọc từ projects/ + legacy compat
Bước 5: Update key_manager.ts — đọc từ projects/ config
```

### Phase 2: Project Manager

```
Bước 6: Implement project_manager.ts
Bước 7: Update main.ts — khởi tạo ProjectManager
Bước 8: Bulk import script — import 200 projects từ spreadsheet
```

### Phase 3: Hybrid Detection

```
Bước 9: Update subscription_feed.ts — Innertube PRIMARY + OAuth DISTRIBUTED
Bước 10: Update youtube_poller.ts — hybrid mode support
```

### Phase 4: UI + Testing

```
Bước 11: Update Settings UI — Projects tab
Bước 12: Run bulk import test với 200 projects
Bước 13: Test detection với Innertube + OAuth distributed
Bước 14: Test auto-exhaustion + recovery
```

---

## Tóm tắt Key Metrics

| Metric | Giá trị |
|--------|---------|
| Tổng quota | **2,000,000 units/ngày** (200 × 10k) |
| Innertube primary cost | **0 units/poll** |
| OAuth distributed cost | **~69,000 units/ngày** (3.5%) |
| OAuth full coverage cost | **1,728,000 units/ngày** (86%) |
| Buffer (Innertube primary) | **1,931,000 units** (96.5%) |
| Buffer (Innertube die) | **272,000 units** (13.6%) |
| Channels có thể monitor | **100-500** (tùy poll rate) |
| Detection latency | **< 5s** (Innertube primary) |
| Redundancy | **2 projects/channel** |

---

*Last updated: 2026-05-14*
