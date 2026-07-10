# Turbo Mode + Video Detail Panel — Design Spec

**Date:** 2026-05-27
**Status:** Approved for implementation

---

## 1. Overview

Three changes to make HyperClip siêu tốc trên RTX 5080 + 64GB RAM:

1. **Tune hardware preset `Ultra` để max-out RTX 5080** — download parallel max, chunk workers tối đa
2. **Zero-latency download pipeline** — bỏ queue, spawn ngay, không giới hạn concurrency cho Ultra
3. **Video Detail Panel với bảng thống kê performance** — panel bên phải khi click vào video, hiển thị tất cả metrics

---

## 2. Ultra Preset Max-out

### 2.1 Thông số hiện tại vs target

| Tham số | Hiện tại (Ultra) | Ultra Max-out | Ghi chú |
|---------|-----------------|---------------|---------|
| `downloadInstances` | 3 | **6** | RTX 5080 + 64GB RAM + fiber, spawn ngay |
| `concurrent-fragments` | 64 | **64** (giữ) | Đã tối ưu |
| `chunkWorkers` | 8 | **14** | 2× NVENC engines, max 14 sessions |
| `renderWorkers` | 4 | **6** | Thêm parallel render pool |
| `sessions` | 10 | **10** (giữ) | 10 Innertube sessions là đủ cho ~100 kênh |
| `chunkDuration` | 90s | **60s** | Chunk nhỏ hơn → parallel tối đa |
| `audioCodec` (auto-render) | `aac` | **`libopus`** | 3x nhanh hơn aac |
| `nvenc preset` (auto-render) | `p3` / `hq` | **`p1` + `ull`** | GPU encode, quality vẫn acceptable |
| `surfaces` | 48 | **48** (giữ) | Đã tối đa cho RTX 5080 |

### 2.2 File changes: `electron/services/system.ts`

- `PRESETS` array: update Ultra entry:

```typescript
{ id: 'ultra', label: 'Ultra', vramGB: 16, ramGB: 64,
  downloadInstances: 6, renderWorkers: 6, chunkWorkers: 14, sessions: 10 }
```

- `getDownloadParams()`: Ultra preset → `{ fragments: 64, maxInstances: 6 }`
- `detectSystemProfile()`: khi hardwareProfile=Ultra → sessionCount=10 (thay vì 8 mặc định)

### 2.3 File changes: `electron/services/worker-pool.ts`

- `getChunkPool()`: bỏ cap `Math.min(getEffectiveWorkers(), 4)`. Đổi thành `Math.min(getEffectiveWorkers(), 14)` — RTX 5080 có thể chạy 14 chunk workers.

### 2.4 File changes: `electron/services/ffmpeg.ts`

- `getNvencParams()`: khi `isChunked && isHighTier`:
  - Preset hiện tại: `p1` (ULL khi chunked)
  - Thêm tùy chọn cho auto-render: mặc định dùng `p1` + `ull` cả cho single-pass

- `buildFilterComplex()` / `renderVideo()`: auto-render với Ultra preset dùng `libopus` thay vì `aac`.

### 2.5 Luồng hoạt động mới cho download

```
Poller detects video
    ↓
enqueueBgDownload() (tạo workspace 'waiting')
    ↓
processBgDownloadQueue()
  └─ Nếu hardwareProfile=Ultra → maxConcurrent = 10 (bỏ qua RAM check)
  └─ Không queue → spawn ngay (gọi autoDownloadFromWebSub tức thì)
```

---

## 3. Zero-Latency Download

### 3.1 Vấn đề hiện tại

`processBgDownloadQueue()` dùng `getMaxConcurrentDownloads()`:
- 64GB RAM → max 3 concurrent
- Queue xử lý từng cái một, mỗi lần chỉ shift() 1 item

Với Ultra preset, 6 `downloadInstances` nhưng queue chỉ cho 3 concurrent → bottleneck.

### 3.2 Giải pháp

- `getMaxConcurrentDownloads()`: khi hardwareProfile=Ultra, return `10` (không giới hạn bởi RAM)
- `processBgDownloadQueue()`: spawn ngay lập tức, không cần chờ slot
- `enqueueBgDownload()`: gọi trực tiếp `autoDownloadFromWebSub()` thay vì push vào queue

### 3.3 File changes: `electron/main.ts`

```typescript
function getMaxConcurrentDownloads(): number {
  const settings = loadSettings()
  if (settings.maxConcurrentDownloads && settings.maxConcurrentDownloads > 0) {
    return settings.maxConcurrentDownloads
  }
  // Ultra preset: zero-latency, không limited
  if (settings.hardwareProfile?.vramGB === 16 && settings.hardwareProfile?.ramGB === 64) {
    return 10  // spawn ngay, không queue
  }
  // Fallback auto-detect
  // ... existing code
}
```

Và `processBgDownloadQueue()`: bỏ while loop, spawn song song tới maxConcurrent.

---

## 4. Video Detail Panel

### 4.1 Vị trí UI

Panel bên phải (right side), thay thế SettingsPanel khi click vào workspace card.

**Layout cũ:** Sidebar (140px) | Queue (center) | SettingsPanel (right panel)
**Layout mới:** Sidebar (140px) | Queue (center) | **VideoDetailPanel** (right panel, khi click video) / SettingsPanel (khi bấm settings)

### 4.2 Component tree

```
VideoDetailPanel (new)
├── VideoHeader
│   ├── Thumbnail
│   └── Title + Channel name
├── PerformanceMetrics
│   ├── DownloadSection
│   │   ├── Time (s)
│   │   ├── Speed (MB/s)
│   │   ├── File size
│   │   ├── Resolution (source)
│   │   ├── Quality setting
│   │   └── Multi-instance (yes/no)
│   ├── RenderSection (chỉ khi đã render)
│   │   ├── Encode time (s)
│   │   ├── Avg encode FPS
│   │   ├── Chunk workers used
│   │   ├── Preset / Codec
│   │   ├── Output resolution
│   │   └── ETA vs actual
│   └── SystemSection
│       ├── GPU load during render (%)
│       ├── VRAM used (MB)
│       ├── RAM used (GB)
│       └── CPU cores used
└── E2ETimeline
    ├── Detected → Download (delay ms)
    ├── Download → Ready (duration s)
    └── Ready → Done (render s)
```

### 4.3 Data model

Thêm vào `Workspace` trong `src/app/lib/store.ts`:

```typescript
export interface WorkspaceMetrics {
  downloadMs?: number          // wall-clock download time (ms)
  downloadSpeedMBs?: number    // avg download speed (MB/s)
  downloadFileSize?: number    // bytes
  downloadQuality?: string     // '360'|'480'|'720'|'1080'
  downloadResolution?: string  // e.g. '1920x1080'
  downloadIsMultiInstance?: boolean  // true nếu dùng section download

  renderMs?: number            // wall-clock render time (ms)
  renderFps?: number           // avg encode fps
  renderWorkers?: number       // chunk workers used
  renderPreset?: string        // 'p1'|'p2'|'p3'
  renderCodec?: string         // 'h264'|'hevc'
  renderChunks?: number        // number of chunks
  renderOutputResolution?: string // e.g. '1080x1920'

  systemGpuLoad?: number       // GPU % during render (max)
  systemVramUsed?: number      // VRAM used (MB)
  systemRamUsed?: number       // RAM used (GB)

  // E2E timing
  detectedAt?: string          // ISO timestamp
  downloadStartedAt?: string   // ISO timestamp
  downloadCompletedAt?: string // ISO timestamp
  renderStartedAt?: string     // ISO timestamp
  renderCompletedAt?: string   // ISO timestamp
}
```

Thêm field `metrics?: WorkspaceMetrics` vào `Workspace` interface.

### 4.4 IPC để collect metrics

Backend collect metrics trong `autoDownloadFromWebSub()` và `executeRenderJob()`:

```typescript
// Trong autoDownloadFromWebSub, sau khi download xong:
updateWorkspace(ws.id, {
  metrics: {
    downloadMs: Date.now() - downloadStartMs,
    downloadSpeedMBs: ...,
    downloadFileSize: finalFileSize,
    downloadQuality: autoQuality,
    downloadResolution: aspect ? `${aspect.width}x${aspect.height}` : undefined,
    downloadIsMultiInstance: ...,
    downloadStartedAt: new Date(downloadStartMs).toISOString(),
    downloadCompletedAt: new Date().toISOString(),
  }
})
```

```typescript
// Trong executeRenderJob, sau khi render xong:
updateWorkspace(workspaceId, {
  metrics: {
    ...existing,
    renderMs: Date.now() - renderStartMs,
    renderWorkers: gpuTier === 'high' ? 14 : ...,
    renderPreset: metadata.preset,
    renderCodec: metadata.codec,
    renderOutputResolution: export_resolution,
    renderCompletedAt: new Date().toISOString(),
  }
})
```

### 4.5 File changes

| File | Change |
|------|--------|
| `src/app/lib/store.ts` | Thêm `WorkspaceMetrics` type + `metrics` field vào `Workspace` |
| `src/app/types.ts` | Export `WorkspaceMetrics` |
| `src/app/components/VideoDetailPanel.tsx` | **New** — component panel bên phải |
| `src/app/page.tsx` | Layout: right panel = VideoDetailPanel khi có selectedWorkspaceId |
| `electron/main.ts` | Collect metrics trong download + render |
| `electron/services/system.ts` | Ultra preset update |
| `electron/services/worker-pool.ts` | Bỏ cap chunk workers |
| `electron/services/ffmpeg.ts` | Auto-render dùng libopus + p1/ull |

### 4.6 Visual layout

```
┌─────────────────────────────┐
│ VIDEO DETAIL                │
├─────────────────────────────┤
│ [thumbnail]                 │
│ Title: "..."                │
│ Channel: ...                │
├─────────────────────────────┤
│ DOWNLOAD                    │
├─────────────────────────────┤
│ ⚡ Time:    12.4s           │
│ ⚡ Speed:   45.2 MB/s       │
│ 📦 Size:   288.7 MB        │
│ 🔍 Source: 1920x1080@1080p │
│ 🔀 Multi-Instance: 2 parts │
├─────────────────────────────┤
│ RENDER                      │
├─────────────────────────────┤
│ ⚡ Time:    87.3s           │
│ ⚡ Encode:  142.5 fps       │
│ 🖥 Workers: 14 chunked      │
│ ⚙ Preset:  p1 · ull        │
│ 🎞 Codec:  h264_nvenc       │
│ 📐 Output: 1080x1920 @ 30  │
├─────────────────────────────┤
│ SYSTEM                      │
├─────────────────────────────┤
│ 🔥 GPU:    78% · 4.2GB     │
│ 💾 RAM:    12.5/64 GB      │
│ 🧠 CPU:    12 cores         │
├─────────────────────────────┤
│ E2E TIMELINE                │
├─────────────────────────────┤
│ Detected   14:23:01.500     │
│ ↓ +0.8s                    │
│ Download   14:23:02.300     │
│ ↓ +12.4s                   │
│ Ready      14:23:14.700     │
│ ↓ +0.3s                    │
│ Render     14:23:15.000     │
│ ↓ +87.3s                   │
│ Done       14:24:42.300     │
│ ─────────────────────────  │
│ **Total: 100.8s**          │
└─────────────────────────────┘
```

---

## 5. Implementation Order

1. **Backend: Ultra preset tune** — `system.ts`, `worker-pool.ts`, `ffmpeg.ts`
2. **Backend: Metrics collection** — workspace metrics tracking in `main.ts`
3. **Backend: Zero-latency download** — bypass queue cho Ultra
4. **Frontend: VideoDetailPanel** — component + layout + data binding
5. **Verification** — test download speed, render speed, metrics display
