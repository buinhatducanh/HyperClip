# Auto-Render Dashboard — UI Redesign Spec

> Chuyển từ manual editor → 100% auto-render. Settings tích hợp vào dashboard chính.
> Date: 2026-05-27
> Status: Draft

## 1. Tổng quan

### 1.1 Mục tiêu
- Loại bỏ hoàn toàn manual editor (DetailEditor.tsx)
- Đưa tất cả settings lên trang chủ thành panel chính
- 100% auto-render pipeline: video detected → auto download → auto split → auto render
- Desktop app Electron — tận dụng không gian màn hình rộng

### 1.2 Phạm vi
- **Giữ lại:** Channels management, detection pipeline, download pipeline, render pipeline, log/system monitor
- **Xóa khỏi dashboard:** DetailEditor (manual trim, header image, title shape, background selection, speed, canvas bg, manual render button)
- **Chuyển từ /settings lên dashboard:** Auto render config, download config, storage paths, detection health, proxy, system monitor
- **Advanced settings giữ nguyên tại /settings:** Sessions management, OAuth Projects, API Keys, Diagnostics, Logs export, Update
- **Giữ:** RenderedVideoDetail (xem video đã render + metadata)

## 2. Layout tổng thể (Desktop 3-panel)

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOP BAR (32px): Download config · Auto-render toggle · System health │
├────────┬──────────────────────────────────────┬──────────────────────┤
│        │                                      │                      │
│ LEFT   │  CENTER: SETTINGS (2-column cards)   │ RIGHT: Video Queue   │
│ 140px  │                                      │ 280px                │
│ Chls   │ ┌──────────────┬──────────────┐      │ ┌──────────────────┐ │
│ Detect │ │ Auto Render  │ Storage      │      │ │ ALL  DL RENDER   │ │
│        │ │ Download     │ Detection    │      │ │ ┌──┬───────────┐ │ │
│        │ │ Ch Override  │ System       │      │ │ │th│ Title     │A│ │
│        │ │              │ Proxy/Logs   │      │ │ └──┴───────────┘ │ │
│        │ └──────────────┴──────────────┘      │ │ ┌──┬───────────┐ │ │
│        │                                      │ │ │th│ Download  │ │ │
│        │                                      │ │ └──┴───────────┘ │ │
│        │                                      │ │ ┌──┬───────────┐ │ │
│        │                                      │ │ │th│ Render    │ │ │
│        │                                      │ │ └──┴───────────┘ │ │
├────────┴──────────────────────────────────────┴──────────────────────┤
│ BOTTOM LOG BAR (75px): Activity tab · Errors badge · Health dots     │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Tỉ lệ panel
| Panel | Width | Overflow |
|-------|-------|----------|
| Channels | 140px (min 120px) | scroll vertical |
| Settings | flex (min 400px) | scroll vertical + flex-wrap 2-column |
| Video Queue | 280px (min 240px, max 400px) | scroll vertical |
| Bottom Log | 100% × 75px | scroll horizontal log lines |

## 3. Top Bar (32px)

### 3.1 Layout
```
[HyperClip] | DOWNLOAD [720p] Trim 10m | AUTO RENDER [●] 1080p·30fps·3px3m | ← flex → GPU 45° [█░░░] RAM 32/64G [████░]
```

### 3.2 Elements
| Element | Type | Source |
|---------|------|--------|
| Download quality | Button group (360/480/720/1080) | `settings.autoDownloadQuality` |
| Trim limit | Input number + FULL toggle | `settings.defaultTrimLimit` |
| Auto-render | Toggle switch | `settings.autoRender` |
| Auto-render badge | Text `1080p·30fps·3px3m` | `settings.autoRenderResolution`, `autoRenderFPS` + parts config |
| GPU temp | `45°C` text | `systemStats.gpuTemp` |
| GPU usage | Mini bar 30px | `systemStats.gpuUsage` |
| RAM usage | Mini bar + text | `systemStats.ramUsed / ramTotal` |

### 3.3 Behavior
- Click badge text → expand inline config (same as Auto Render card)
- GPU/RAM bars update every 5s via `system:stats-update` event

## 4. Panel 1: Channels (Trái, 140px)

**Kế thừa từ Sidebar.tsx hiện tại, thu gọn.**

```
CHANNELS
[+ Add channel URL...]  ← input
├─ Channel A          [A]  ← auto badge
├─ Channel B         [3]   ← count badge
├─ Kênh D
├─ Pet Channel      [⏸]   ← paused

───
● Innertube 30/30
● OAuth 180/200
Poller: active · 5s
```

### 4.1 Channel item
- Avatar (16px circle) + name (9px) + status badge/override indicator
- Auto badge `[A]` = channel có override settings active
- Count badge = số video đang chờ xử lý
- Hover: pause/resume/delete buttons (kế thừa từ Sidebar hiện tại)

### 4.2 Detection status strip
- Innertube health: `●` green/dim + consented/total
- OAuth health: `●` green/dim + healthy/total
- Poller: active/inactive + interval

## 5. Panel 2: Settings (Giữa, 2-column cards)

**Chiếm diện tích chính. 2-column flex-wrap khi cửa sổ rộng, 1-column khi hẹp.**

### 5.1 Card: Auto Render

```
AUTO RENDER                          [●──]
Resolution: [1080p] [720p] [360p]
FPS:        [30]    [60]
Số phần:    [2] [3] [4] [5]
Phút/phần:  [2] [3] [5] [10]
Title template: [{title} - {channel}]
────────────────────────────────────
Video: 10:48 → 3 phần × 3:36
```

**Fields:**
| Field | Store key | Type | Notes |
|-------|-----------|------|-------|
| Toggle | `settings.autoRender` | boolean | |
| Resolution | `settings.autoRenderResolution` | `'480x480'|'720x720'|'1080x1080'` | **TODO: xem xét đổi sang `1080p` format** |
| FPS | `settings.autoRenderFPS` | 30 \| 60 | |
| Num parts | `settings.autoSplitParts` (new) | number 1-10 | Cần thêm vào AppSettings + backend |
| Minutes/part | `settings.autoSplitMinutes` (new) | number 1-60 | Cần thêm vào AppSettings + backend |
| Title template | `settings.autoRenderTitleTemplate` | string | Variables: `{title}`, `{channel}`, `{date:YYYY-MM-DD}`, `{time:HH:MM}`, `{part}` |
| Preview estimate | computed | `duration → parts × duration/parts @ speed` | Frontend tính từ video duration |

**Logic split:**
- Nếu `numParts = 1` + `minutesPerPart = 0` → không split (render 1 file)
- Nếu `numParts > 1` → `splitMinutes = Math.ceil(duration / numParts)` → gọi `splitWorkspace()`
- Nếu `minutesPerPart > 0` → override numParts: `numParts = Math.ceil(duration / minutesPerPart)`
- **Ưu tiên:** `minutesPerPart` > `numParts` (nếu cả 2 được set)

### 5.2 Card: Download

```
DOWNLOAD
Chất lượng: [360p] [480p] [720p] [1080p]
Trim: [10 minutes       ] [FULL]
Tải đồng thời: [3] [5] [10]
Render đồng thời:[2] [4] [8]
Thời gian tối thiểu: [60] sec
Thời gian tối đa:   [0] sec (0 = không giới hạn)
```

**Fields:**
| Field | Store key | Type |
|-------|-----------|------|
| Quality | `settings.autoDownloadQuality` | `'360'|'480'|'720'|'1080'` |
| Trim | `settings.defaultTrimLimit` | number \| 'full' |
| Concurrent downloads | `settings.maxConcurrentDownloads` | number |
| Concurrent renders | `settings.maxConcurrentRenders` | number |
| Min duration | `settings.videoMinDurationSec` | number |
| Max duration | `settings.videoMaxDurationSec` | number |

### 5.3 Card: Channel Override

```
CHANNEL OVERRIDE            [Channel A ▼] [override]
Resolution: [720p] [1080p]
FPS:        [30]   [60]
Parts:      [2 part] [4m/p] [custom]
Trim: [5 minutes] [FULL]
[Reset to global]
```

**Fields (per ChannelSettings):**
| Field | Store key |
|-------|-----------|
| Resolution | `.settings?.resolution` |
| FPS | (mới — cần thêm vào ChannelSettings interface) |
| Parts | `.settings?.autoSplit` + `.settings?.splitMinutes` |
| Trim | `.settings?.trimLimit` |
| Auto-render | `.settings?.autoRender` (override global) |

**UI behavior:**
- Dropdown chọn channel hiện tại
- Badge `[override]` màu vàng
- Nút "Reset to global" → set settings = undefined
- Các field màu xanh dương nếu khác global, màu xám nếu = global

### 5.4 Card: Storage

```
STORAGE
[████░░░░░░░░░░░░░░] 245MB / 150GB free

Video path: [D:\HyperClip\videos\           ] [📁]
Output path: [D:\HyperClip\output\           ] [📁]

Tự động xóa sau: [7] ngày (0 = không xóa)
[Mở thư mục] [Xóa cache]
```

**Fields:**
| Field | Store key | Type |
|-------|-----------|------|
| Video path | `settings.videoStoragePath` | string |
| Output path | `settings.outputPath` | string |
| Auto cleanup | `settings.downloadsCleanupDays` | number (0 = disabled) |
| Disk usage | from `ipc.getStorageSize()` | computed |
| Free space | from `ipc.getStorageSize()` | computed |

### 5.5 Card: Detection

```
DETECTION
● Innertube:  30/30 sessions  [PRIMARY]
● OAuth:     180/200 projects · 4.5k quota [FALLBACK]
● Sessions:  85% health [DEGRADED]
Poll: 5s · active · 0 lỗi
```

**Data sources:**
| Field | Source |
|-------|--------|
| Innertube consented/total | `sessionStatus.consentedCount / sessionStatus.sessionCount` |
| OAuth healthy/total | `projectStatus.filter(p => p.status==='healthy').length / totalProjects` |
| OAuth quota remaining | sum of `(9500 - p.usedToday)` per healthy project |
| Session health % | `sessionStatus.health?.healthPct` |
| Innertube degraded | `pollerStatus.innertubeDegraded` |
| Poll status | `pollerStatus.active`, `pollerStatus.lastError` |

**Badge logic:**
- `[PRIMARY]` = xanh lá (Innertube active)
- `[FALLBACK]` = vàng (Innertube die, OAuth active)
- `[DEGRADED]` = đỏ (Innertube < 50% health)
- `[NO SOURCE]` = đỏ (cả 2 đều không active)

### 5.6 Card: System

```
SYSTEM
GPU: RTX 5080 · 45°C · 32% · NVENC
CPU: Intel Core Ultra 9 285K · 12%
RAM: 32.4 / 64 GB
Workers: 2/8 active · H.264 p1 · ull
```

Data từ `systemStats` (update 5s).

### 5.7 Card: Misc (Proxy + Logs + Update)

```
PROXY [OFF]          UPDATE v0.1.0     LOGS
Host:port · Auth: none   [Check]       [Export]

── Advanced ──────────────────────────────
[Sessions] [OAuth Projects] [API Keys] [Diagnostics]
```

| Section | Details |
|---------|---------|
| Proxy | Toggle + host:port + auth (mở modal) |
| Update | Version badge + Check button → `/api/update` |
| Logs | Export button → `ipc.exportLogs()` |
| Advanced | Buttons → mở `/settings?tab=...` hoặc modal overlay |

### 5.8 App Settings (thêm vào Misc hoặc card riêng)
- `minimizeToTray` — toggle
- `quitOnClose` — toggle

## 6. Panel 3: Video Queue (Phải, 280px)

### 6.1 Filter tabs
- `ALL (12)`, `DL`, `RENDER`, `ERR` — số lượng động
- Search icon (expandable input)

### 6.2 Video card (compact)

```
┌──────┬──────────────────────┬────┐
│ thumb│ Video title here     │ A  │ ← auto badge
│ 48x27│ Channel A · 10:48   │    │
├──────┼──────────────────────┼────┤
│ thumb│ Downloading...       │ 67%│ ← progress
│      │ Channel B · 5:22    │ █░ │
├──────┼──────────────────────┼────┤
│ thumb│ Rendering video...   │42% │
│      │ Kênh D · 15:30      │ 2:3│ ← ETA
├──────┼──────────────────────┼────┤
│ thumb│ Done video           │ ✓  │ ← rendered
│      │ Channel A · 3:45    │245M│
└──────┴──────────────────────┴────┘
```

**Status indicators:**
| Status | Border color | Right element |
|--------|-------------|---------------|
| ready | `#222` (default) | `[A]` auto badge + status text |
| downloading | `#FFB800` (yellow) | `67%` + mini bar |
| rendering | `#7C3AED` (purple) | `42%` + ETA text |
| done | `#00FF88` (green) | `✓ 245MB` |
| error | `#FF4444` (red) | `[RETRY]` button |

### 6.3 Context menu (right-click)
- Open folder
- Retry (if error)
- Remove
- View rendered (if done)

## 7. Bottom Log Bar (75px)

### 7.1 Tabs
```
[ACTIVITY] [ERRORS ●2] [SYSTEM]           ← flex → [expand]
```

### 7.2 Log lines (5 lines, monospace)

```
[11:45:32] ✓ Channel B: Tải video hoàn tất (245MB)
[11:44:10] ⚡ Video X: Render 42% · ETA 2m 30s
[11:42:05] ⬇ Video Y mới · Kênh D · 15:30
[11:40:00] ⚠ Innertube session timeout — retry #3
[11:39:12] ✓ Detection: 30/30 sessions · poll 4.8s
```

**Log level colors:**
| Level | Timestamp color | Icon |
|-------|----------------|------|
| success | `#00FF88` | ✓ |
| info | `#888` | ● |
| warning | `#FFB800` | ⚠ |
| error | `#FF4444` | ✗ |
| render | `#7C3AED` | ⚡ |

### 7.3 Health status bar

```
● Innertube ● OAuth ● GPU ● Disk ● Queue    3h 12m · 2/8 workers
```

- Dots: green = OK, yellow = warning, red = critical
- Right: uptime + active/max workers

### 7.4 Expand behavior
- Click `[expand]` → log bar expands to 200px, shows 15 lines
- Click again → collapse to 75px
- Auto-scroll to latest

## 8. Data Flow & IPC Changes

### 8.1 New/Modified AppSettings fields
```typescript
// Cần thêm vào AppSettings interface (src/app/lib/store.ts)
interface AppSettings {
  // ... existing fields
  autoSplitParts: number       // default: 1 (1 = không split)
  autoSplitMinutes: number     // default: 0 (0 = use autoSplitParts)
}
```

### 8.2 New/Modified ChannelSettings
```typescript
// Cần thêm FPS + parts override
interface ChannelSettings {
  trimLimit?: number | 'full'
  downloadQuality?: string
  autoRender?: boolean
  resolution?: string
  fps?: 30 | 60           // NEW
  autoSplit?: boolean
  splitMinutes?: number
}
```

### 8.3 IPC events giữ nguyên
| Event | Purpose |
|-------|---------|
| `workspace:update-event` | Workspace state changed |
| `render:progress-event` | Render progress |
| `system:stats-update` | System stats (5s) |
| `notification` | Toast + log entry |
| `autodownload` | New video detected |
| `channel:synced-event` | Subscription list synced |

## 9. Files thay đổi / Xóa

### 9.1 Xóa khỏi dashboard (không xóa file, archive)
| File | Lý do |
|------|-------|
| `src/app/components/DetailEditor.tsx` | Manual editor — không còn dùng |
| `src/app/components/workspace/RenderQueueBar.tsx` | Render queue tích hợp vào queue panel |
| `src/app/components/DetailEditor.tsx` → `TrimSection` | Auto-trim dùng setting global |
| `src/app/components/DetailEditor.tsx` → `SplitSection` | Auto-split dùng settings |

### 9.2 Sửa đổi
| File | Thay đổi |
|------|----------|
| `src/app/page.tsx` | Layout mới: 3-panel redesigned. Xóa editor logic, giữ filter + queue + log |
| `src/app/components/Sidebar.tsx` | Thu gọn còn 140px, chỉ giữ channels + detection status |
| `src/app/components/WorkspaceQueue.tsx` | Chuyển sang right panel 280px, compact cards |
| `src/app/lib/store.ts` | Thêm `autoSplitParts`, `autoSplitMinutes` vào AppSettings |
| `src/app/types.ts` | Thêm `fps` vào `ChannelSettings` |
| `src/app/settings/page.tsx` | Giữ nguyên — chỉ dùng cho advanced settings |

### 9.3 Mới
| File | Thay đổi |
|------|----------|
| `src/app/components/SettingsPanel.tsx` | **MỚI** — 2-column settings cards (center panel) |
| `src/app/components/ActivityLogBar.tsx` | **MỚI** — Bottom log bar (extract từ ActivityLog) |
| `src/app/components/TopBar.tsx` | **MỚI** — Top config bar |

### 9.4 Backend changes
| File | Thay đổi |
|------|----------|
| `electron/services/ramdisk.ts` | Thêm `autoSplitParts`, `autoSplitMinutes` vào SettingsData |
| `electron/ipc/handlers/project.ts` | Thêm handler cho split settings |
| `electron/main.ts` | Auto-split trigger sau download (dùng `autoSplit` config) |

## 10. Implementation Phases

### Phase 1: Layout skeleton
- Tạo `TopBar.tsx`, `SettingsPanel.tsx`, `ActivityLogBar.tsx`
- Sửa `page.tsx` layout → 3-panel mới
- Giữ nguyên `DetailEditor.tsx` tạm thời (ẩn bằng flag)

### Phase 2: Settings cards data binding
- Card Auto Render: kết nối store + backend
- Card Download: kết nối store + backend  
- Card Storage: paths + disk usage
- Thêm `autoSplitParts`, `autoSplitMinutes` vào store + backend

### Phase 3: Channel Override + Detection
- Channel Override: dropdown + per-channel settings
- Detection: fetch + display session/project health
- Badge system (PRIMARY/FALLBACK/DEGRADED)

### Phase 4: Video Queue refactor
- Compact card design
- Filter tabs
- Context menu
- Rendered video list integration

### Phase 5: Bottom log bar
- Extract + refactor ActivityLog
- Errors badge
- Health status dots
- Expand/collapse

### Phase 6: Auto-split backend
- Auto-split trigger trong `electron/main.ts` sau download
- Sync parts settings với split API
- Test: video 10p → 3 parts × 3m36 → render từng part

### Phase 7: Cleanup
- Archive DetailEditor.tsx
- Xóa dead code
- `npx tsc --noEmit` verify

## 11. Open Questions

1. **Resolution format:** `'480x480'|'720x720'|'1080x1080'` (hiện tại) vs `1080p` (UI)? Quyết định: đổi store sang `1080p` format, backend map sang pixel.

2. **Split vs không split:** `autoSplitParts = 1` = không split. Khi user bật auto-render, default parts = 1.

3. **Rendered video xem ở đâu?** Tab trong Video Queue (RENDERED) hoặc panel popup. Quyết định: tab trong Queue, click → mở `RenderedVideoDetail`.

4. **Advanced settings (/settings) có còn không?** Có — Sessions, OAuth Projects, API Keys, Diagnostics vẫn ở /settings. Dashboard chỉ show status + nút điều hướng.

5. **autoRenderResolution hiện là '480x480'** — đây là resolution output cho short (480x480 square). Khi chuyển sang 100% vertical short, cần xác nhận output luôn là 9:16 (1080x1920) và resolution chỉ là chiều cao (1080p / 720p / 360p).

## 12. Design Principles

- **Flat design:** Không shadow, không gradient (giữ nguyên theme hiện tại)
- **Color:** `#00B4FF` accent, `#00FF88` success, `#FFB800` warning, `#FF4444` error, `#7C3AED` rendering
- **Font:** Inter, monospace cho data
- **Inline styles:** Nhất quán với toàn bộ codebase hiện tại (không Tailwind classes cho layout)
- **Zustand flat state:** Giữ nguyên pattern — không context cascade
