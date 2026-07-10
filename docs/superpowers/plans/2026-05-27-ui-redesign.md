# UI Full Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete design system (tokens + 5 utility components), replace all hardcoded colors, rewrite Sidebar/TopBar/ActivityLogPanel in new style, clean up remaining panels.

**Architecture:** 4 independent phases. Phase 1 (design system) must come first — all other phases depend on `tokens.ts` exports. Phases 2-4 can be done in any order after Phase 1.

**Tech Stack:** React + Tailwind CSS v3 (prefer utility classes), color/spacing constants from `tokens.ts`

---

## Files

### Create
- `src/app/design-system/tokens.ts` — Design constants (colors, spacing, fontSize)
- `src/app/design-system/Card.tsx` — Surface container
- `src/app/design-system/Badge.tsx` — Status badge with dot
- `src/app/design-system/Button.tsx` — Unified button variants
- `src/app/design-system/Section.tsx` — Collapsible section header + content
- `src/app/design-system/TimelineLog.tsx` — Terminal-style log entry component

### Modify
- `src/app/components/ActivityLogPanel.tsx` — Full rewrite: terminal style
- `src/app/components/Sidebar.tsx` — Full rewrite: icon nav + channels
- `src/app/components/TopBar.tsx` — Full rewrite: stats bar
- `src/app/components/WorkspaceQueue.tsx` — Styling cleanup
- `src/app/components/WorkspaceCard.tsx` — Use Badge + color tokens
- `src/app/components/VideoDetailPanel.tsx` — Use Card + Section
- `src/app/components/SettingsPanel.tsx` — Use Card + Section
- `src/app/components/DetailEditor.tsx` — Color token migration
- `src/app/components/DetectionStatusBar.tsx` — Color token migration
- `src/app/components/RenderedVideoDetail.tsx` — Color token migration
- `src/app/components/SplitModal.tsx` — Color token migration
- `src/app/components/ConfirmationDialog.tsx` — Color token migration
- `src/app/components/VideoCompareModal.tsx` — Color token migration
- `src/app/components/LoginScreen.tsx` — Color token migration
- `src/app/components/Skeleton.tsx` — Color token migration
- `src/app/components/UpdateBar.tsx` — Color token migration
- `src/app/components/RenderedVideos.tsx` — Color token migration
- `src/app/components/workspace/RenderQueueBar.tsx` — Color token migration
- `src/app/components/ActivityLog.tsx` — Add ActivityEntry export if missing
- `src/app/page.tsx` — Layout cleanup (borders, widths)
- `src/app/globals.css` — Add CSS custom properties
- `src/app/layout.tsx` — Remove `.dark` class reference
- `src/app/settings/page.tsx` + components/ — Color token migration
- `src/app/onboarding/` — Color token migration

---

### Task 1: Design tokens + CSS variables

**Files:**
- Create: `src/app/design-system/tokens.ts`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Create tokens.ts**

```typescript
// src/app/design-system/tokens.ts

export const colors = {
  bg: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceHover: '#F8F8F8',
  border: '#E0E0E0',
  borderLight: '#EAEAEA',
  borderHover: '#D0D0D0',
  text: '#1A1A1A',
  textSecondary: '#888888',
  textTertiary: '#AAAAAA',
  accent: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  sidebarBg: '#FFFFFF',
  terminalBg: '#1A1A1A',
} as const

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
} as const

export const fontSize = {
  xs: 10, sm: 12, md: 14, lg: 16,
} as const

export type SpacingKey = keyof typeof spacing
export type FontSizeKey = keyof typeof fontSize

/** Resolve spacing prop to px value */
export function px(n: SpacingKey | number): number {
  return typeof n === 'number' ? n : spacing[n]
}
```

- [ ] **Step 2: Add CSS custom properties to globals.css**

```css
/* Add to :root in src/app/globals.css */
:root {
  /* existing vars */
  --color-bg: #F5F5F5;
  --color-surface: #FFFFFF;
  --color-surface-hover: #F8F8F8;
  --color-border: #E0E0E0;
  --color-border-light: #EAEAEA;
  --color-border-hover: #D0D0D0;
  --color-text: #1A1A1A;
  --color-text-secondary: #888888;
  --color-text-tertiary: #AAAAAA;
  --color-accent: #3B82F6;
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;
  --spacing-xxl: 32px;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/design-system/tokens.ts src/app/globals.css
git commit -m "feat: design tokens — colors, spacing, fontSize constants + CSS vars"
```

---

### Task 2: Utility components — Card, Badge, Button, Section

**Files:**
- Create: `src/app/design-system/Card.tsx`
- Create: `src/app/design-system/Badge.tsx`
- Create: `src/app/design-system/Button.tsx`
- Create: `src/app/design-system/Section.tsx`

- [ ] **Step 1: Create Card.tsx**

```tsx
'use client'

import { px, type SpacingKey, colors } from './tokens'

interface CardProps {
  children: React.ReactNode
  padding?: SpacingKey | number
  border?: boolean
  hover?: boolean
  className?: string
  style?: React.CSSProperties
}

export function Card({
  children, padding = 'lg', border = true, hover = false,
  className = '', style = {},
}: CardProps) {
  return (
    <div
      className={className}
      style={{
        background: colors.surface,
        borderRadius: 6,
        padding: px(padding),
        border: border ? `1px solid ${colors.border}` : 'none',
        transition: hover ? 'box-shadow 0.15s, border-color 0.15s' : undefined,
        ...(hover ? { cursor: 'pointer' } : {}),
        ...style,
      }}
      onMouseEnter={hover ? (e) => {
        e.currentTarget.style.borderColor = colors.borderHover
        e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'
      } : undefined}
      onMouseLeave={hover ? (e) => {
        e.currentTarget.style.borderColor = colors.border
        e.currentTarget.style.boxShadow = 'none'
      } : undefined}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Create Badge.tsx**

```tsx
'use client'

import { fontSize } from './tokens'

interface BadgeProps {
  label: string
  color: string
  dot?: boolean
  pulse?: boolean
  size?: 'sm' | 'md'
}

export function Badge({ label, color, dot = true, pulse = false, size = 'sm' }: BadgeProps) {
  const fSize = size === 'sm' ? fontSize.xs : fontSize.sm
  const dotSize = size === 'sm' ? 6 : 8
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: `${color}15`,
      border: `1px solid ${color}44`,
      borderRadius: 3,
      padding: size === 'sm' ? '2px 6px' : '3px 8px',
      fontSize: fSize,
      fontWeight: 700,
      color,
      letterSpacing: '0.03em',
    }}>
      {dot && (
        <span style={{
          width: dotSize, height: dotSize, borderRadius: '50%',
          background: color,
          boxShadow: pulse ? `0 0 6px ${color}` : undefined,
          animation: pulse ? 'pulse 1.5s ease-in-out infinite' : undefined,
          flexShrink: 0,
        }} />
      )}
      {label}
    </div>
  )
}
```

- [ ] **Step 3: Create Button.tsx**

```tsx
'use client'

import { fontSize, colors } from './tokens'

interface ButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  onClick?: () => void
  disabled?: boolean
  style?: React.CSSProperties
  className?: string
}

const variantStyles: Record<string, { bg: string; color: string; border: string; hoverBg: string }> = {
  primary: { bg: '#3B82F6', color: '#FFFFFF', border: 'transparent', hoverBg: '#2563EB' },
  secondary: { bg: '#F5F5F5', color: '#1A1A1A', border: '#E0E0E0', hoverBg: '#EAEAEA' },
  ghost: { bg: 'transparent', color: '#888888', border: 'transparent', hoverBg: '#F5F5F5' },
  danger: { bg: '#FFF0F0', color: '#EF4444', border: '#EF4444', hoverBg: '#FFE0E0' },
}

export function Button({
  children, variant = 'primary', size = 'sm',
  onClick, disabled = false, style = {}, className = '',
}: ButtonProps) {
  const v = variantStyles[variant]
  const h = size === 'sm' ? 32 : 40
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={onClick}
      style={{
        height: h, padding: `0 ${size === 'sm' ? 12 : 16}px`,
        background: v.bg, color: v.color, border: `1px solid ${v.border}`,
        borderRadius: 4,
        fontSize: size === 'sm' ? fontSize.sm : fontSize.md,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        transition: 'background 0.12s, border-color 0.12s',
        ...style,
      }}
      onMouseEnter={disabled ? undefined : (e) => {
        if (variant !== 'ghost') e.currentTarget.style.background = v.hoverBg
        else e.currentTarget.style.background = '#F5F5F5'
      }}
      onMouseLeave={disabled ? undefined : (e) => {
        e.currentTarget.style.background = v.bg
      }}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 4: Create Section.tsx**

```tsx
'use client'

import { useState } from 'react'
import { fontSize, colors, spacing } from './tokens'

interface SectionProps {
  label: string
  color?: string
  children: React.ReactNode
  defaultOpen?: boolean
  actions?: React.ReactNode
}

export function Section({
  label, color = colors.accent, children, defaultOpen = true, actions,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: `1px solid ${colors.borderLight}`, marginBottom: 0 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: spacing.sm,
          width: '100%', padding: `${spacing.md}px ${spacing.lg}px`,
          background: 'transparent', border: 'none',
          cursor: 'pointer', fontSize: fontSize.sm, fontWeight: 600,
          color: colors.text,
        }}
      >
        <div style={{
          width: 3, height: 14, borderRadius: 2, background: color, flexShrink: 0,
        }} />
        <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
        {actions}
        <svg width="10" height="10" viewBox="0 0 10 10" style={{
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>
          <path d="M2 4l3 3 3-3" stroke="#888" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div style={{ padding: `0 ${spacing.lg}px ${spacing.md}px` }}>
          {children}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/design-system/
git commit -m "feat: Card, Badge, Button, Section utility components"
```

---

### Task 3: Migrate hardcoded colors → tokens (Phase 1.3)

**Files:** ALL tsx files in src/app/components/ + src/app/settings/ + src/app/onboarding/ + src/app/page.tsx

**Goal:** Replace every hardcoded color hex with `colors.xxx` from tokens.ts. This is a mechanical find-and-replace task — no logic changes.

- [ ] **Step 1: Create a migration script** or perform replacements in affected files.

The exact replacements (applied globally across ALL tsx files in src/app/):

Old → New mapping:
- `'#F5F5F5'` → `colors.bg`
- `'#FFFFFF'` (as bg/surface) → `colors.surface`
- `'#E0E0E0'` (as border) → `colors.border`
- `'#EAEAEA'` → `colors.borderLight`
- `'#D0D0D0'` → `colors.borderHover`
- `'#1A1A1A'` (as text) → `colors.text`
- `'#888888'` or `'#888'` (as secondary text) → `colors.textSecondary`
- `'#AAAAAA'` or `'#aaa'` → `colors.textTertiary`
- `'#00B4FF'` → `colors.accent`
- `'#00FF88'` → `colors.success`
- `'#FF4444'` (as error) → `colors.error`
- `'#FFB800'` (as warning) → `colors.warning`
- `'#7C3AED'` → keep (rendering accent, not in tokens — add to colors if used widely)

**Do NOT replace:**
- Colors inside UI component files that are NOT hardcoded constants (e.g., `workspace.channelColor` — dynamic)
- SVG fill/stroke colors that are intentional design choices
- The `terminalBg` dark color in the new ActivityLogPanel (handled in Task 6)

Actually, this mechanical replacement across 30+ files is impractical as a single step. Instead, per-file approach:

- [ ] **Step 1: Migrate page.tsx colors**

Read `src/app/page.tsx` and replace all hardcoded colors with token imports + references. Specifically:
  - `#F5F5F5` → `colors.bg`
  - `#1E1E1E` → `colors.border`  
  - `#1A1A1A` → `colors.text`
  - Change right panel border `#1E1E1E` → `colors.border`
  - Set right panel width from 280 → 300

- [ ] **Step 2: Migrate Sidebar.tsx + TopBar.tsx colors**

- [ ] **Step 3: Migrate WorkspaceQueue.tsx + WorkspaceCard.tsx colors**

- [ ] **Step 4: Migrate VideoDetailPanel.tsx + SettingsPanel.tsx colors**

- [ ] **Step 5: Migrate remaining component files** (DetailEditor, DetectionStatusBar, RenderedVideoDetail, SplitModal, ConfirmationDialog, VideoCompareModal, LoginScreen, Skeleton, UpdateBar, RenderedVideos, RenderQueueBar, ActivityLog)

- [ ] **Step 6: Migrate settings/ + onboarding/ pages colors**

- [ ] **Step 7: Commit after each file group**

```bash
git commit -m "refactor: replace hardcoded colors with design tokens in [component group]"
```

---

### Task 4: Rewrite Sidebar — icon nav

**Files:**
- Modify: `src/app/components/Sidebar.tsx`

**Key changes:**
- Collapsed icon nav (60px width) → expand on hover to show labels
- Channel list with avatar + name + new-count badge (use `<Badge>` from design system)
- DetectionStatusBar at bottom, compact
- Use colors from tokens.ts

- [ ] **Step 1: Read existing Sidebar.tsx** to understand current structure and props

- [ ] **Step 2: Rewrite sidebar layout**

```tsx
// New structure pseudocode
<div style={{ width: collapsed ? 60 : 220, transition: 'width 0.15s', background: colors.sidebarBg, borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
  {/* Logo area */}
  <div style={{ padding: spacing.md, borderBottom: `1px solid ${colors.border}` }}>
    {collapsed ? logo icon : logo + title}
  </div>

  {/* Navigation */}
  <div style={{ flex: 1, overflow: 'auto', padding: spacing.sm }}>
    {/* Channel list */}
    {channels.map(ch => (
      <ChannelItem key={ch.id} ... />
    ))}
  </div>

  {/* Detection status bar */}
  <DetectionStatusBar />
</div>
```

With hover expansion:
```tsx
const [expanded, setExpanded] = useState(false)
// width: expanded ? 220 : 60
// onMouseEnter → setExpanded(true), onMouseLeave → setExpanded(false)
```

- [ ] **Step 3: Implement channel item** with avatar + name + new-count

```tsx
function ChannelItem({ channel, isActive, newCount, onSelect }: {
  channel: Channel; isActive: boolean; newCount: number; onSelect: (id: string) => void
}) {
  // Use Badge for the new-count pill
  // Show avatar circle → on hover or expanded show name
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/components/Sidebar.tsx
git commit -m "feat: rewrite Sidebar — icon nav, collapsible channels, DetectionStatusBar"
```

---

### Task 5: Rewrite TopBar

**Files:**
- Modify: `src/app/components/TopBar.tsx`

**Key changes:**
- Sticky header row with system stats (GPU%, RAM%, VRAM)
- Hardware profile selector (compact)
- Auto-download toggle
- Clean monospace stat displays

- [ ] **Step 1: Read current TopBar.tsx**

- [ ] **Step 2: Rewrite with compact stat bars**

```tsx
export function TopBar({ settings, systemStats, onSettingsChange }: Props) {
  // ...
  return (
    <div style={{
      height: 44,
      background: colors.surface,
      borderBottom: `1px solid ${colors.border}`,
      display: 'flex', alignItems: 'center',
      padding: `0 ${spacing.lg}px`,
      gap: spacing.lg,
      flexShrink: 0,
    }}>
      {/* Logo / brand */}
      <span style={{ fontSize: fontSize.sm, fontWeight: 700, color: colors.accent }}>
        HyperClip
      </span>

      {/* System stats — monospace chips */}
      <div style={{ display: 'flex', gap: spacing.md, marginLeft: 'auto', alignItems: 'center' }}>
        {/* GPU */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <MiniBar value={gpuPct} color={colors.accent} width={40} />
          <span style={statLabelStyle}>{gpuPct}% GPU</span>
        </div>
        {/* RAM */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <MiniBar value={ramPct} color={colors.success} width={40} />
          <span style={statLabelStyle}>{ramPct}% RAM</span>
        </div>
        {/* VRAM */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={statLabelStyle}>{vramUsedPct}% VRAM</span>
        </div>
      </div>

      {/* Hardware profile badge */}
      {activePreset && (
        <Badge label={activePreset.label} color={colors.accent} dot={false} />
      )}

      {/* Auto-download toggle */}
      <Toggle ... />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/components/TopBar.tsx
git commit -m "feat: rewrite TopBar — compact system stats, hardware badge, toggle"
```

---

### Task 6: Rewrite ActivityLogPanel — terminal style

**Files:**
- Create: `src/app/design-system/TimelineLog.tsx`
- Modify: `src/app/components/ActivityLogPanel.tsx`

- [ ] **Step 1: Create TimelineLog.tsx**

```tsx
'use client'

import { colors, fontSize, spacing } from './tokens'

export interface LogEntry {
  id: string
  timestamp: number
  type: 'detected' | 'downloading' | 'downloaded' | 'rendering' | 'done' | 'error'
  message: string
  detail?: string
}

const TYPE_META: Record<string, { tag: string; color: string }> = {
  detected:   { tag: 'DET', color: '#3B82F6' },
  downloading:{ tag: 'DL',  color: '#F59E0B' },
  downloaded: { tag: 'OK',  color: '#10B981' },
  rendering:  { tag: 'RND', color: '#8B5CF6' },
  done:       { tag: 'OK',  color: '#10B981' },
  error:      { tag: 'ERR', color: '#EF4444' },
  warning:    { tag: 'WRN', color: '#F59E0B' },
}

function fmtTimestamp(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function fmtRelTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 5) return 'now'
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export function TimelineLog({ entry }: { entry: LogEntry }) {
  const meta = TYPE_META[entry.type] || TYPE_META.detected
  return (
    <div style={{
      display: 'flex', gap: spacing.sm,
      fontFamily: 'monospace', fontSize: fontSize.xs,
      lineHeight: 1.6,
      padding: '3px 0',
    }}>
      {/* Timestamp */}
      <span style={{ color: '#555', flexShrink: 0, minWidth: 60 }}>
        [{fmtTimestamp(entry.timestamp)}]
      </span>
      {/* Tag */}
      <span style={{
        color: meta.color, fontWeight: 700, flexShrink: 0, minWidth: 28,
      }}>
        {meta.tag}
      </span>
      {/* Relative time */}
      <span style={{ color: '#555', flexShrink: 0, minWidth: 28 }}>
        {fmtRelTime(entry.timestamp)}
      </span>
      {/* Message */}
      <span style={{
        color: entry.type === 'error' ? '#EF4444' : '#ccc',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {entry.message}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite ActivityLogPanel.tsx**

```tsx
'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import type { ActivityEntry } from './ActivityLog'
import { TimelineLog, type LogEntry } from '../design-system/TimelineLog'
import { colors, spacing, fontSize } from '../design-system/tokens'

interface Props {
  entries: ActivityEntry[]
  onClear?: () => void
}

export function ActivityLogPanel({ entries, onClear }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)

  useEffect(() => {
    if (entries.length > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevLenRef.current = entries.length
  }, [entries])

  return (
    <div style={{
      height: 300, flexShrink: 0,
      background: '#1A1A1A',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'monospace',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: spacing.sm,
        padding: '6px 12px',
        borderBottom: '1px solid #2A2A2A',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: fontSize.xs, color: '#888', fontWeight: 600, letterSpacing: '0.05em' }}>
          ╰ activity.log
        </span>
        <div style={{ flex: 1 }} />
        {onClear && (
          <button
            onClick={onClear}
            style={{
              fontSize: fontSize.xs, color: '#555', background: 'transparent',
              border: 'none', cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          >
            clear
          </button>
        )}
      </div>

      {/* Log entries */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '4px 12px',
      }}>
        {entries.length === 0 && (
          <div style={{ color: '#555', paddingTop: 8, fontSize: fontSize.xs }}>
            ── no activity yet ──
          </div>
        )}
        {entries.slice(-80).map(e => (
          <TimelineLog key={e.id} entry={{
            id: e.id,
            timestamp: e.timestamp,
            type: e.type as LogEntry['type'],
            message: e.message,
            detail: e.detail,
          }} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/design-system/TimelineLog.tsx src/app/components/ActivityLogPanel.tsx
git commit -m "feat: terminal-style ActivityLogPanel with TimelineLog component"
```

---

### Task 7: WorkspaceQueue + WorkspaceCard styling refinement

**Files:**
- Modify: `src/app/components/workspace/WorkspaceQueue.tsx`
- Modify: `src/app/components/workspace/WorkspaceCard.tsx`

- [ ] **Step 1: Clean up WorkspaceQueue.tsx**

Key changes:
- Search bar styling with border from tokens
- Group headers use Card/Section styling
- Tab bar (pipeline / rendered) cleaner
- Empty states more friendly

- [ ] **Step 2: Clean up WorkspaceCard.tsx**

Key changes:
- Use `<Badge>` for status badge instead of inline div
- Card body uses card spacing from tokens
- Download progress overlay more compact
- Hover states cleaner

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: WorkspaceQueue + WorkspaceCard styling — use Badge, consistent spacing"
```

---

### Task 8: Detail/Editor panels — use Card + Section

**Files:**
- Modify: `src/app/components/VideoDetailPanel.tsx`
- Modify: `src/app/components/SettingsPanel.tsx`
- Modify: `src/app/components/DetailEditor.tsx`

- [ ] **Step 1: VideoDetailPanel — wrap sections in `<Section>`**

Each metric group (DOWNLOAD, RENDER, SYSTEM, TIMELINE) uses `<Section label="..." color={colors.accent}>`.

```tsx
import { Section } from '../design-system/Section'
import { Card } from '../design-system/Card'

// Replace div wrappers with Section components
<Section label="DOWNLOAD" color={colors.accent} defaultOpen={true}>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <MetricRow label="Thời gian" value={downloadTime} />
    <MetricRow label="Tốc độ" value={downloadSpeed} />
    ...
  </div>
</Section>
```

- [ ] **Step 2: SettingsPanel — wrap groups in `<Section>`**

Same pattern — each settings group uses `<Section>` with appropriate label.

- [ ] **Step 3: DetailEditor — color token migration**

Replace remaining hardcoded colors with tokens.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: VideoDetailPanel + SettingsPanel — use Section/Card components"
```

---

### Task 9: Migrate shadcn/ui components to light theme

**Files:**
- Modify: `src/app/components/ui/sheet.tsx`
- Modify: `src/app/components/ui/dialog.tsx`
- Modify: `src/app/components/ui/drawer.tsx`
- Modify: `src/app/components/ui/button.tsx`
- Modify: `src/app/components/ui/badge.tsx`
- Modify: `src/app/components/ui/alert-dialog.tsx`

These use Tailwind CSS variables which are already light in the default `:root` block. Verify they render correctly with the new theme.

- [ ] **Step 1: Check that shadcn/ui `:root` variables (in theme.css) are correct for light theme**

Already `:root` has `--background: #ffffff`, `--foreground: oklch(0.145 0 0)`, etc. The `.dark` block is irrelevant since we removed `className="dark"`. Should be fine as-is — just verify no `.dark` references remain.

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
npm run test
```

- [ ] **Step 3: Final integration check** — remove dead `.dark` block from globals.css if not referenced anywhere

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: finalize light theme — remove .dark references, verify build"
```

---

## Spec Coverage Check

| Spec requirement | Task |
|-----------------|------|
| tokens.ts (colors, spacing, fontSize) | Task 1 |
| CSS custom properties | Task 1 |
| Card component | Task 2 |
| Badge component | Task 2 |
| Button component | Task 2 |
| Section component | Task 2 |
| TimelineLog component | Task 6 |
| Migrate hardcoded colors → tokens | Task 3 |
| Sidebar icon nav rewrite | Task 4 |
| TopBar stats rewrite | Task 5 |
| ActivityLogPanel terminal style | Task 6 |
| WorkspaceQueue cleanup | Task 7 |
| WorkspaceCard use Badge | Task 7 |
| VideoDetailPanel → Section | Task 8 |
| SettingsPanel → Section | Task 8 |
| DetailEditor color migration | Task 8 |
| shadcn/ui light theme | Task 9 |
| Build verification | Task 9 |
