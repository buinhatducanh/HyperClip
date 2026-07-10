# Video Split Feature — PO/MMO Design

## Tóm tắt use case

**MOMO creator cần 1 video dài chia thành nhiều Short:**

> Video: 9:35 (575s)
> → Part 1: 5:00 (từ 0:00)
> → Part 2: 4:35 (từ 5:00 → 9:35)
> → Tối đa 4 parts

**Tại sao cần feature này:**
- Mỗi part có thể trim khác nhau (Part 1 hay Part 2 hấp dẫn hơn → giữ lâu hơn)
- Tốc độ: stream-copy FFmpeg ~5 giây cho 10 phút video (không re-encode)
- Tự động: bật auto-split per-channel → video mới tự chia parts → tất cả parts vào render queue
- MMO: cần batch split + auto-render cho nhiều videos cùng lúc

---

## 1. Mô hình dữ liệu

### 1.1 WorkspaceData — thêm split fields

**File:** `electron/services/store.ts`

```typescript
export interface WorkspaceData {
  // ... existing fields ...

  // Split tracking
  parentId?: string           // ID của workspace gốc (nếu đây là part)
  partIndex?: number         // 1 = Part 1, 2 = Part 2, ...
  totalParts?: number        // Tổng số parts (1 = không split)
  splitFrom?: string         // Timestamp khi split được tạo (ISO)
}
```

### 1.2 ChannelSettings — thêm autoSplit

**File:** `electron/services/store.ts`

```typescript
export interface ChannelSettings {
  trimLimit?: number | 'full'
  downloadQuality?: string
  autoRender?: boolean
  resolution?: string
  autoSplit?: boolean        // ← Tự động split khi video download xong
  splitMinutes?: number      // ← Mỗi part dài bao nhiêu phút (default: 5)
}
```

---

## 2. Split Logic

### 2.1 Split Handler — custom intervals

**File:** `electron/ipc/handlers/workspace-split.ts`

**THAY ĐỔI:** Giữ nguyên existing code, thêm params mới.

**IPC signature mới:**
```typescript
IPC_CHANNELS.WORKSPACE_SPLIT
Params: {
  id: string,
  intervals?: number[]   // mảng thời điểm split (giây). VD: [300, 600, 900] → 4 parts
  partMinutes?: number    // auto-split đều mỗi N phút (bỏ qua nếu intervals có)
  autoSplit?: boolean   // true = gọi tự động sau download
}
```

**Validation:**
```typescript
const MAX_PARTS = 4
const intervals = opts.intervals ?? autoGenerateIntervals(totalSec, partMinutes)
const numParts = intervals.length + 1
if (numParts > MAX_PARTS) {
  return { success: false, error: `Too many parts: ${numParts} (max ${MAX_PARTS}). Use shorter intervals.` }
}
```

**Auto-generate intervals:**
```typescript
function autoGenerateIntervals(totalSec: number, partMinutes: number): number[] {
  const partSec = partMinutes * 60
  const intervals: number[] = []
  let t = partSec
  while (t < totalSec - partSec) {  // Luôn có ít nhất 1 part với remaining
    intervals.push(t)
    t += partSec
  }
  return intervals  // VD: 575s, 5min → [300] → Part1(0-300) + Part2(300-575)
}
```

**Naming convention:**
```typescript
// Part metadata in workspace title
const partTitle = totalParts > 1
  ? `[Part ${partIndex}/${totalParts}] ${ws.videoTitle}`
  : ws.videoTitle
```

**Parent workspace update:**
```typescript
// Khi split → update workspace gốc: totalParts = numParts
updateWorkspace(ws.id, { totalParts: numParts, splitFrom: new Date().toISOString() })
```

**Performance — NO re-encode:**
```typescript
// FFmpeg stream-copy (copy video+audio bitstream, ~5s cho 10min video)
const trimResult = await trimVideo(ws.downloadedPath, partFilePath, startSec, partDuration)
// trimVideo đã dùng stream-copy (không re-encode), KHÔNG cần thay đổi
```

### 2.2 Auto-split trigger

**File:** `electron/main.ts` — sau khi download xong trong `processBgDownloadQueue()`

```typescript
// Sau khi workspace chuyển sang 'ready'
const chSettings = getChannelSettings(ws.channelId)
if (chSettings?.autoSplit && (chSettings.splitMinutes ?? 5) > 0) {
  devLog(`[AutoSplit] Triggering auto-split for ${ws.videoTitle}`)
  // Gọi split trong background, không block render queue
  splitWorkspace(ws.id, { partMinutes: chSettings.splitMinutes })
    .then(({ newWorkspaces }) => {
      // Auto-render từng part
      for (const part of newWorkspaces ?? []) {
        triggerAutoRender(part.id)
      }
    })
    .catch(err => devLog(`[AutoSplit] Failed: ${err}`))
}
```

---

## 3. IPC Channels

**File:** `electron/ipc/channels.ts`

```typescript
WORKSPACE_SPLIT:           'workspace:split',      // existing — mở rộng params
WORKSPACE_SPLIT_PREVIEW:    'workspace:split-preview', // NEW — preview split points without executing
```

**Preview handler** — trả về các split points mà không tạo workspaces:

```typescript
ipcMain.handle(IPC_CHANNELS.WORKSPACE_SPLIT_PREVIEW, async (_, id: string, intervals?: number[], partMinutes?: number) => {
  const ws = getWorkspace(id)
  if (!ws) return null
  const totalSec = ws.duration ?? 0
  const pts = intervals ?? autoGenerateIntervals(totalSec, partMinutes ?? 5)
  const numParts = pts.length + 1
  const parts = []
  let prev = 0
  for (let i = 0; i < pts.length; i++) {
    parts.push({ index: i + 1, start: prev, end: pts[i], duration: pts[i] - prev })
    prev = pts[i]
  }
  parts.push({ index: pts.length + 1, start: prev, end: totalSec, duration: totalSec - prev })
  return { parts, numParts, totalSec }
})
```

---

## 4. Frontend UI

### 4.1 DetailEditor — Split Button

**File:** `src/app/components/DetailEditor.tsx`

Thêm button "Split Video" trong toolbar hoặc action bar:

```tsx
{ws.status === 'ready' && (
  <button onClick={() => setSplitModal(true)} className="split-btn">
    Split Video
  </button>
)}
```

### 4.2 SplitModal Component — NEW

**File:** `src/app/components/SplitModal.tsx`

**Modal Layout:**

```
┌─ Split: "10 Phút Mỗi Ngày" (9:35) ──────────────────────────────────┐
│                                                                          │
│  ○ Auto-Split (đều mỗi N phút)    ● Manual Split                    │
│                                                                          │
│  ┌─ Auto ──────────────────────────────────────────────────────────────┐  │
│  │  Part length: [5 min ▼]  → Preview: Part 1 (5:00) + Part 2     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─ Manual (click timeline to add split points) ──────────────────┐  │
│  │  Timeline: ──|────────|──────────|─────────── END              │  │
│  │              0:00      5:00       9:35                            │  │
│  │  [+ Add split] [Remove]                                              │  │
│  │  Part 1: 0:00 – 5:00  (300s)    [Remove]                       │  │
│  │  Part 2: 5:00 – 9:35  (275s)    [Remove]                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ⚠️ Maximum 4 parts. Current: 2 parts.                              │
│                                                                          │
│  ☑ Auto-render all parts after split                                  │
│                                                                          │
│  [Cancel]                                    [Split → 2 Parts]          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Features:**

1. **Mode toggle:** Auto-split (equal intervals) vs Manual (custom points)

2. **Auto-Split tab:**
   - Dropdown: 1min / 2min / 3min / 5min / 10min
   - Live preview: "→ Part 1 (Xm) + Part 2 (Ym) + ..."
   - Warning nếu > 4 parts

3. **Manual Split tab:**
   - **Timeline visualization:** progress bar với markers tại split points
   - **Click to add:** click vào timeline → thêm split point tại vị trí đó
   - **Drag to move:** drag split marker → điều chỉnh
   - **Remove:** click X trên marker hoặc row
   - **Input:** click split point → nhập thời điểm chính xác (giây)
   - **Preview:** mỗi row hiện Part N, start time, duration

4. **Validation:**
   - Tối đa 4 parts (enforce trong UI + backend)
   - Mỗi part phải ít nhất 30 giây
   - Split point phải tăng dần
   - Preview: "2 parts — OK" hoặc "⚠️ 5 parts (exceeds max 4)"

5. **Auto-render toggle:** Mặc định ON

6. **Action:**
   - Cancel: đóng modal
   - Split: gọi `ipc.splitWorkspace(id, { intervals })`, đóng modal, hiện toast

### 4.3 Per-Channel Auto-Split Setting

**File:** `src/app/settings/components/ChannelsSection.tsx` (từ plan kia)

Trong inline settings editor:

```
Auto-Split: [● ON ○ OFF]
Part length: [5 min ▼]
```

---

## 5. Performance — Tối ưu MMO

### 5.1 Stream-Copy (đã có)
FFmpeg `stream-copy` — không re-encode, chỉ cắt bitstream:
```
Input: 9:35 @ 1080p → Output: ~8MB split file (5 giây)
vs Re-encode: ~45 giây + quality loss
```

### 5.2 Parallel Split Processing
Tất cả parts split ĐỒNG THỜI (Promise.all):
```typescript
const splits = await Promise.all(
  intervals.map(({ start, end, index }) =>
    splitPart(ws, start, end, index, totalParts)
  )
)
// 2 parts → ~5 giây total (không phải 10 giây)
```

### 5.3 Auto-Render Pipeline
Sau split → mỗi part tự vào render queue:
```
Part 1 → autoRender → Render Queue
Part 2 → autoRender → Render Queue
...
```
Worker pool (max 2 concurrent FFmpeg) xử lý độc lập.

### 5.4 NO Re-Download
Split lấy từ `downloadedPath` — video đã download sẵn. Không tải lại.

### 5.5 Concurrency Limits
- **Split:** không giới hạn — stream-copy nhẹ
- **Render:** max 2 concurrent (worker pool)
- **Auto-render sau split:** giới hạn bởi worker pool

---

## 6. Split → Render Flow

```
Video 9:35 downloaded → workspace created
    │
    ├── User click "Split" → SplitModal
    │       └─ User chọn intervals: [300s]
    │              └─ Call: splitWorkspace(id, intervals: [300])
    │
    ├── Part 1 workspace (0:00–5:00) created
    │       └─ autoRender ON → vào render queue
    │
    └── Part 2 workspace (5:00–9:35) created
            └─ autoRender ON → vào render queue
                    │
                    ├── Render Part 1 ──→ output/Part 1.mp4
                    └── Render Part 2 ──→ output/Part 2.mp4
```

---

## 7. Naming Convention

| Field | Format |
|-------|--------|
| `videoTitle` | `[Part N/M] original title` |
| `downloadedPath` | `wsId_partN.mp4` |
| `thumbnail` | `thumb_wsId_partN.jpg` |

**Example:**
```
Original: "10 Phút Mỗi Ngày" (9:35)
Part 1: "[Part 1/2] 10 Phút Mỗi Ngày" — 0:00–5:00
Part 2: "[Part 2/2] 10 Phút Mỗi Ngày" — 5:00–9:35
```

---

## 8. Files to Modify

| File | Changes |
|------|---------|
| `electron/services/store.ts` | Thêm `parentId`, `partIndex`, `totalParts`, `splitFrom` vào `WorkspaceData`; thêm `autoSplit`, `splitMinutes` vào `ChannelSettings` |
| `electron/ipc/channels.ts` | Thêm `WORKSPACE_SPLIT_PREVIEW` constant |
| `electron/ipc/handlers/workspace-split.ts` | Mở rộng params (intervals, partMinutes, autoSplit); parallel Promise.all; parent-child metadata; MAX_PARTS validation; auto-render trigger |
| `electron/main.ts` | Thêm auto-split trigger sau download trong `processBgDownloadQueue()` |
| `src/app/types.ts` | Thêm split fields vào `Workspace` type |
| `src/app/lib/ipc.ts` | Thêm `splitWorkspacePreview()` |
| `src/app/components/SplitModal.tsx` | **NEW** — SplitModal component |
| `src/app/components/DetailEditor.tsx` | Thêm Split button + open modal |

---

## 9. Verification Checklist

- [ ] Split 9:35 video at [300s] → Part 1 (5:00) + Part 2 (4:35)
- [ ] Split video > 20 min → auto-generate intervals [300, 600, 900, 1200]
- [ ] Attempt > 4 parts → error: "Maximum 4 parts exceeded"
- [ ] Split part < 30s → warning: "Part too short"
- [ ] Split → Part workspaces có đúng `parentId`, `partIndex`, `totalParts`
- [ ] Split → tên workspace = "[Part N/M] original title"
- [ ] Split → thumbnail riêng cho từng part
- [ ] Split → auto-render all parts (nếu toggle ON)
- [ ] Split → render parts song song (2 concurrent)
- [ ] Split 2 videos cùng lúc → không conflict
- [ ] Channel autoSplit ON → video mới tự split sau download
- [ ] `splitWorkspacePreview()` → trả về preview mà không tạo workspace
- [ ] `npx tsc --noEmit` clean
