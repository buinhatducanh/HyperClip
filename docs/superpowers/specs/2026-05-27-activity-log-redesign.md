# ActivityLog Redesign — MMO-Style Bottom Bar

## Mục tiêu
Thay thế `console-window` (separate BrowserWindow) bằng ActivityLog bottom bar tích hợp trong main dashboard. Log rõ ràng như nhà MMO operator cần — nhìn nhanh, hiểu ngay.

## Tổng quan

**Thay đổi:**
- Xóa `console-window.html` và `electron/services/console-window.ts`
- Thay `ActivityLogBar` (180px rightmost) bằng `ActivityLogPanel` (180px bottom bar của center pane)
- Hiển thị activity + errors only (không raw log stream)
- Header stats bar với counts
- MMO-style formatting

## Layout

```
┌─ Sidebar (220px) ──┬──── Center pane (flex) ──────────────────┬─ Editor (320px) ──┐
│                    │                                          │                   │
│  Navigation        │  [WorkspaceQueue — flex:1]               │  Detail/Editor   │
│  System Monitor    │                                          │  (shown on select)│
│                    ├──────────────────────────────────────────┤                   │
│                    │  ┌─ ActivityLog (180px fixed bottom) ──┐│                   │
│                    │  │ DET:3  DL:2  RDY:1  ERR:0  [Clear] ││                   │
│                    │  │─────────────────────────────────────  ││                   │
│                    │  │ ● 2m Detected: TÔI GHÉT CÂY...      ││                   │
│                    │  │ ● 1m Downloading: ... (196MB ETA 42s)││                   │
│                    │  │ ⚡ 45s Rendering: ... (67%)           ││                   │
│                    │  │ ✓ 10s Done: → archive ✅             ││                   │
│                    │  └─────────────────────────────────────  ││                   │
└────────────────────┴──────────────────────────────────────────┴───────────────────┘
```

## Component: `ActivityLogPanel`

**File:** `src/app/components/ActivityLogPanel.tsx`

### Props
```typescript
interface Props {
  entries: ActivityEntry[]
  onClear?: () => void
}
```

### Visual Design

**Container:**
- Height: 180px, flex-shrink: 0
- Border-top: `1px solid #1E1E1E`
- Background: `#0D0D0D`
- Font: `monospace`, 10px
- Scroll: vertical, auto-scroll to bottom on new entry

**Header Stats Bar (36px):**
```
DET:3  DL:2  RDY:1  ERR:0  [Clear]
```
- Font: 8px, font-weight: 700
- DET (detected) — `#00B4FF`
- DL (downloading) — `#FFB800`
- RDY (ready/done) — `#00FF88`
- ERR (errors) — `#FF4444` (count badge nếu > 0)
- `[Clear]` button — `#333` text, hover `#FF4444`

**Entry Row (mỗi dòng ~18px):**
```
[relative-time] [icon] [message]
```
- Relative time: "2m ago", "45s ago", "just now" — right-aligned, `#555`, 9px
- Icon: ● ⚡ ✓ ⚠ ✗ — colored theo type
- Message: color theo type, truncate with ellipsis nếu dài

**Entry colors by type:**
| Type | Icon | Color | Examples |
|------|------|-------|---------|
| `info` | ● | `#00B4FF` | Detected, Ready |
| `render` | ⚡ | `#7C3AED` | Rendering |
| `success` | ✓ | `#00FF88` | Downloaded, Done, Rendered |
| `warning` | ⚠ | `#FFB800` | Retry, Slow |
| `error` | ✗ | `#FF4444` | Error, Failed |

**Entry content by type:**
- `info` + `detected`: "Detected: {title} ({channelName})"
- `info` + `downloading`: "Downloading: {title} ({speed}, ETA {eta})"
- `success` + `downloaded`: "Downloaded: {title} ({fileSize})"
- `success` + `rendered`: "Rendered: {title} → archive ✅"
- `error`: "Error: {message}"

### Behavior
- Auto-scroll to bottom when new entry arrives
- Max 100 entries displayed (virtualize if needed)
- `onClear`: xóa tất cả entries trong UI (không xóa backend log)
- Relative time updates every 10s
- Error entries highlighted với subtle red background `rgba(255,68,68,0.05)`

## Xóa Files

1. `console-window.html` — xóa
2. `electron/services/console-window.ts` — xóa
3. `main.ts` call `createConsoleWindow()` — xóa

## Backend Changes

`electron/main.ts`:
- Xóa `createConsoleWindow()` call
- Không thay đổi log stream IPC — `log:stream` vẫn emit cho Settings Logs tab

## Frontend Changes

1. Tạo `src/app/components/ActivityLogPanel.tsx` — MMO-style bottom bar
2. Cập nhật `src/app/page.tsx`:
   - Import `ActivityLogPanel`
   - Đặt dưới WorkspaceQueue trong center pane
   - Pass `activityMap` entries
   - `handleClearActivity`: clear entries

## No Changes
- `unified_log.ts` — giữ nguyên
- `Settings Logs tab` — giữ nguyên (vẫn dùng `log:stream`)
- `electron/services/diagnostics.ts` — giữ nguyên

## Out of Scope
- Raw log stream display (console window replacement)
- Log filtering/search
- Export logs from this panel
