# ActivityLog Redesign — MMO-Style Bottom Bar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay thế `console-window` + `ActivityLogBar` (rightmost 180px) bằng `ActivityLogPanel` (bottom bar 180px trong center pane). Xóa 2 files console-window.

**Architecture:** ActivityLogPanel là React component nhận `entries[]` prop, render MMO-style activity feed với header stats bar. Center pane split: `WorkspaceQueue (flex:1)` + `ActivityLogPanel (height:180px)`.

**Tech Stack:** React, TypeScript, Zustand (activityMap state), IPC (activity:event)

---

## File Map

```
CREATED:   src/app/components/ActivityLogPanel.tsx    — MMO-style bottom bar component
MODIFIED:  src/app/page.tsx                         — Thay ActivityLogBar → ActivityLogPanel, layout restructure
MODIFIED:  electron/main.ts                        — Xóa createConsoleWindow() call
DELETED:   console-window.html                     — Xóa
DELETED:   electron/services/console-window.ts       — Xóa
```

---

## Task 1: Tạo ActivityLogPanel component

**Files:**
- Create: `src/app/components/ActivityLogPanel.tsx`

- [ ] **Step 1: Write ActivityLogPanel.tsx**

```tsx
'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import type { ActivityEntry } from './ActivityLog'

interface Props {
  entries: ActivityEntry[]
  onClear?: () => void
}

function formatRelTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 5) return 'now'
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  info:       { icon: '●', color: '#00B4FF', label: 'INFO' },
  success:    { icon: '✓', color: '#00FF88', label: 'OK' },
  error:      { icon: '✗', color: '#FF4444', label: 'ERR' },
  warning:    { icon: '⚠', color: '#FFB800', label: 'WARN' },
  render:     { icon: '⚡', color: '#7C3AED', label: 'RDR' },
  downloading:{ icon: '↓', color: '#FFB800', label: 'DL' },
}

function formatMessage(e: ActivityEntry): string {
  if (e.type === 'error') return e.message
  if (e.type === 'success' && e.message.includes('downloaded')) return e.message
  if (e.type === 'success' && e.message.includes('rendered')) return e.message
  return e.message
}

export function ActivityLogPanel({ entries, onClear }: Props) {
  const [relTime, setRelTime] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)

  // Update relative time every 10s
  useEffect(() => {
    const id = setInterval(() => setRelTime(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (entries.length > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevLenRef.current = entries.length
  }, [entries])

  // Counts
  const counts = useMemo(() => ({
    det: entries.filter(e => e.type === 'info' && e.message.includes('Detected')).length,
    dl:  entries.filter(e => e.type === 'downloading' || (e.type === 'info' && e.message.includes('Downloading'))).length,
    ok:  entries.filter(e => e.type === 'success').length,
    err: entries.filter(e => e.type === 'error').length,
  }), [entries])

  return (
    <div style={{
      height: 180, flexShrink: 0,
      borderTop: '1px solid #1E1E1E',
      background: '#0D0D0D',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header stats bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid #1A1A1A',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 8, color: '#555', fontWeight: 700, letterSpacing: '0.06em', marginRight: 4 }}>ACT</span>

        <StatChip label="DET" value={counts.det} color="#00B4FF" />
        <StatChip label="DL"  value={counts.dl}  color="#FFB800" />
        <StatChip label="OK"  value={counts.ok}  color="#00FF88" />
        {counts.err > 0 && <StatChip label="ERR" value={counts.err} color="#FF4444" />}

        <div style={{ flex: 1 }} />

        {onClear && (
          <button
            onClick={onClear}
            style={{
              fontSize: 8, fontWeight: 700, color: '#555', background: 'transparent',
              border: 'none', cursor: 'pointer', letterSpacing: '0.06em', padding: '2px 4px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#FF4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          >
            [Clear]
          </button>
        )}
      </div>

      {/* Entry list */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '4px 12px',
        fontFamily: 'monospace', fontSize: 10, lineHeight: 1.7,
      }}>
        {entries.length === 0 && (
          <div style={{ color: '#333', padding: '4px 0' }}>No activity</div>
        )}
        {entries.slice(-80).map(e => {
          const cfg = TYPE_CONFIG[e.type] || TYPE_CONFIG.info
          return (
            <div
              key={e.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                color: '#aaa', marginBottom: 1,
                background: e.type === 'error' ? 'rgba(255,68,68,0.04)' : 'transparent',
                borderRadius: 2, padding: '1px 2px',
              }}
            >
              {/* Relative time */}
              <span style={{ color: '#555', fontSize: 9, minWidth: 28, flexShrink: 0 }}>
                {formatRelTime(e.timestamp)}
              </span>
              {/* Icon */}
              <span style={{ color: cfg.color, flexShrink: 0, fontSize: 10 }}>
                {cfg.icon}
              </span>
              {/* Message */}
              <span style={{ color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formatMessage(e)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
    }}>
      <span style={{ color: '#555' }}>{label}:</span>
      <span style={{ color, fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit --project electron/tsconfig.json` (React TSX not checked here — just verify no import errors)

---

## Task 2: Update page.tsx — replace ActivityLogBar with ActivityLogPanel

**Files:**
- Modify: `src/app/page.tsx:15` — remove `ActivityLogBar` import
- Modify: `src/app/page.tsx:811-813` — replace ActivityLogBar with ActivityLogPanel inside center pane
- Modify: `src/app/page.tsx` — add `handleClearActivity` callback

- [ ] **Step 1: Remove ActivityLogBar import**

Change line 15 from:
```tsx
import { ActivityLogBar } from './components/ActivityLogBar'
```
to:
```tsx
// ActivityLogBar removed — replaced by ActivityLogPanel
```

- [ ] **Step 2: Import ActivityLogPanel**

Add after the ActivityLogBar removal:
```tsx
import { ActivityLogPanel } from './components/ActivityLogPanel'
```

- [ ] **Step 3: Add handleClearActivity function**

Find `handleQuickAction` in page.tsx (around line 652) and add after it:
```tsx
const handleClearActivity = () => {
  setActivityMap(new Map())
}
```

- [ ] **Step 4: Restructure center pane — wrap WorkspaceQueue + add ActivityLogPanel**

Find the div that contains WorkspaceQueue (around line 783). Change:
```tsx
{/* Video Queue (right panel) */}
<div style={{ width: 280, minWidth: 240, maxWidth: 400, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #1E1E1E' }}>
```
→ keep as-is (right panel stays)

Find the center pane div wrapper (the parent that contains both the center content AND ActivityLogBar). Currently it's around line 760. Replace the entire center pane with:

```tsx
{/* Center pane: WorkspaceQueue (flex) + ActivityLogPanel (180px) */}
<div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderLeft: '1px solid #1E1E1E', borderRight: '1px solid #1E1E1E' }}>
  {/* Queue — scrollable */}
  <div style={{ flex: 1, overflow: 'auto' }}>
    {showSkeleton ? (
      <SkeletonQueue />
    ) : (
      <WorkspaceQueue
        workspaces={filteredWorkspaces}
        renderedVideos={renderedVideos}
        channels={channels}
        selectedId={selectedWorkspaceId}
        selectedRenderedId={selectedRenderedVideoId}
        onSelect={(id) => handleVideoSelect(id)}
        onSelectRendered={handleRenderedVideoSelect}
        onQuickAction={handleQuickAction}
        onRetry={handleRetry}
        onRemoveRendered={(id) => {
          if (selectedRenderedVideoId === id) setSelectedRenderedVideoId(null)
          removeRenderedVideo(id)
        }}
        onShowToast={showToast}
        onSplit={handleSplit}
        trimLimitMinutes={settings.defaultTrimLimit as number}
        onCompare={handleCompare}
      />
    )}
  </div>

  {/* Activity log — bottom bar */}
  <ActivityLogPanel
    entries={[...activityMap.values()].reverse()}
    onClear={handleClearActivity}
  />
</div>
```

**Note:** The right panel `<div style={{ width: 280 ... }}>` that previously contained WorkspaceQueue stays in place. The WorkspaceQueue is MOVED from the right panel into the center pane. The right panel becomes empty (or can be removed — but leave it for now to minimize changes).

- [ ] **Step 5: Remove old right panel containing WorkspaceQueue**

Remove this entire div block (previously contained WorkspaceQueue, now empty):
```tsx
{/* Video Queue (right panel) */}
<div style={{ width: 280, minWidth: 240, maxWidth: 400, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #1E1E1E' }}>
  {showSkeleton ? (
    <SkeletonQueue />
  ) : (
    <WorkspaceQueue ... />
  )}
</div>
```

- [ ] **Step 6: Remove ActivityLogBar from rightmost position**

Remove:
```tsx
{/* Activity Log (rightmost panel — vertical) */}
<ActivityLogBar
  entries={[...activityMap.values()].reverse()}
/>
```

---

## Task 3: Xóa console-window

**Files:**
- Delete: `console-window.html`
- Modify: `electron/main.ts:54-57` — remove `createConsoleWindow` import
- Modify: `electron/main.ts:1378` — remove `createConsoleWindow()` call
- Delete: `electron/services/console-window.ts`

- [ ] **Step 1: Xóa console-window.html**

Delete file: `console-window.html`

- [ ] **Step 2: Xóa console-window.ts**

Delete file: `electron/services/console-window.ts`

- [ ] **Step 3: Xóa createConsoleWindow import trong main.ts**

Read lines 50-60 of `electron/main.ts`:
```ts
import { createTray, destroyTray } from './services/tray.js'
import { createConsoleWindow } from './services/console-window.js'
```
Remove the `createConsoleWindow` import line.

- [ ] **Step 4: Xóa createConsoleWindow() call trong main.ts**

Read line 1378 area of `electron/main.ts`. Remove:
```ts
createConsoleWindow()
```

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit --project electron/tsconfig.json 2>&1 | head -20`

---

## Task 4: Build và verify

- [ ] **Step 1: Run Electron dev**

```bash
npm run electron:dev 2>&1 | head -30
```
Verify:
- App starts without console-window
- ActivityLogPanel visible at bottom of center pane
- Stats show: DET, DL, OK, ERR counts
- Entries show with relative time + icon + message

- [ ] **Step 2: Verify auto-scroll on new activity**

Trigger a new download and observe:
- Panel auto-scrolls to newest entry
- Relative time updates
- Stats counts update

- [ ] **Step 3: Verify Clear button**

Click [Clear] → entries disappear, counts reset to 0.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: replace ActivityLogBar with MMO-style bottom panel

- Remove console-window (BrowserWindow + HTML)
- Remove ActivityLogBar from rightmost position
- Add ActivityLogPanel as bottom bar (180px) in center pane
- MMO-style: DET/DL/OK/ERR header stats, relative time, colored icons
- Xóa 2 files: console-window.html, console-window.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| Xóa console-window.html + console-window.ts | Task 3 |
| ActivityLogPanel bottom bar 180px | Task 1, 2 |
| Header stats bar (DET, DL, OK, ERR) | Task 1 |
| Relative time display | Task 1 |
| Colored icons (● ✓ ✗ ⚠ ⚡) | Task 1 |
| Auto-scroll on new entry | Task 1 |
| Clear button | Task 1, 2 |
| MMO-style entry formatting | Task 1 |
| Xóa ActivityLogBar from right panel | Task 2 |
| Xóa createConsoleWindow() call | Task 3 |

**All spec requirements covered.**
