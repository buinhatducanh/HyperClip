# Auto-Render Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign HyperClip dashboard from manual-editor-first to 100% auto-render-first with settings as primary content.

**Architecture:** 3-panel desktop layout (Channels | Settings 2-column cards | Video Queue) + top config bar + bottom log bar. Eliminate DetailEditor.tsx from dashboard. Migrate settings from `/settings` page into dashboard cards. Keep advanced settings (Sessions, OAuth, API Keys, Diagnostics) on `/settings`.

**Tech Stack:** Next.js 14 (App Router), Zustand, Electron, Tailwind CSS + inline styles

**Spec:** `docs/superpowers/specs/2026-05-27-auto-render-dashboard-design.md`

---

### Task 1: Add new fields to AppSettings (frontend + backend)

**Files:**
- Modify: `src/app/lib/store.ts:78-105`
- Modify: `electron/services/ramdisk.ts:17-64`
- Modify: `src/app/lib/ipc.ts:253-256`
- Test: `electron/services/__tests__/ramdisk.test.ts`

- [ ] **Step 1: Add autoSplitParts + autoSplitMinutes to frontend AppSettings**

In `src/app/lib/store.ts`, add after line 87 (`autoRenderFPS`):
```typescript
autoSplitParts: number         // 1 = no split, 2-10 = number of parts
autoSplitMinutes: number       // 0 = use autoSplitParts instead
```

Update the default at line ~238-240:
```typescript
autoRenderResolution: '1080x1920',
autoRenderFPS: 30,
autoSplitParts: 1,       // default: no split
autoSplitMinutes: 0,     // default: use parts-based
```

- [ ] **Step 2: Add same fields to backend AppSettingsStore**

In `electron/services/ramdisk.ts`, add after line 36 (`autoRenderFPS`):
```typescript
/** Number of parts to split video into for auto-render. 1 = no split. Defaults to 1. */
autoSplitParts?: number
/** Minutes per part for auto-render. 0 = use autoSplitParts instead. Defaults to 0. */
autoSplitMinutes?: number
```

- [ ] **Step 3: Add fields to IPC type definitions**

In `src/app/lib/ipc.ts`, add `autoSplitParts` + `autoSplitMinutes` to the return type of `getSettings()` (line 53) and `updateSettings()` parameter type (line 55).

Current `getSettings` type (line 53):
```typescript
getSettings: () => Promise<{ videoStoragePath?: string; ... }>
```
Add: `autoSplitParts?: number; autoSplitMinutes?: number;`

Current `updateSettings` type (line 55):
```typescript
updateSettings: (patch: { ... }) => Promise<void>
```
Add: `autoSplitParts?: number; autoSplitMinutes?: number;`

- [ ] **Step 4: Change autoRenderResolution format from '480x480' to '1080p'**

In `src/app/lib/store.ts` change default at line ~238:
```typescript
autoRenderResolution: '1080p',  // was '480x480'
```

In `electron/services/ramdisk.ts` change comment at line 33-34:
```typescript
/** Resolution for auto-render: '1080p' | '720p' | '360p'. Defaults to '1080p'. */
autoRenderResolution?: string
```

Update the ipc.ts comment too if present.

- [ ] **Step 5: Add fps + trimLimit to backend channel settings**

In `electron/services/store.ts`, modify `StoredChannel` (line 93-102):
```typescript
export interface StoredChannel {
  id: string
  name: string
  handle: string
  avatarColor: string
  channelId?: string
  avatarUrl?: string
  createdAt: string
  paused?: boolean
  // Per-channel settings overrides
  settings?: {
    trimLimit?: number | 'full'
    downloadQuality?: string
    autoRender?: boolean
    resolution?: string
    fps?: 30 | 60
    autoSplit?: boolean
    splitMinutes?: number
  }
}
```

- [ ] **Step 6: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors (may have ~91 existing warnings, no new errors).

- [ ] **Step 7: Commit**

```bash
git add src/app/lib/store.ts src/app/lib/ipc.ts electron/services/ramdisk.ts electron/services/store.ts
git commit -m "feat: add autoSplit fields, change resolution format, add channel settings to backend"
```

---

### Task 2: Create TopBar component

**Files:**
- Create: `src/app/components/TopBar.tsx`
- Modify: none yet (wired in Task 7)

- [ ] **Step 1: Create TopBar.tsx**

Write `src/app/components/TopBar.tsx`:
```tsx
'use client'

import { useAppStore } from '../lib/store'
import { ipc } from '../lib/ipc'
import type { SystemStats } from '../types'

interface AppSettings {
  autoDownloadQuality: string
  defaultTrimLimit: number | 'full'
  autoRender: boolean
  autoRenderResolution: string
  autoRenderFPS: number
  autoSplitParts: number
  autoSplitMinutes: number
}

export function TopBar({
  settings,
  systemStats,
  onSettingsChange,
}: {
  settings: AppSettings
  systemStats: SystemStats
  onSettingsChange: (patch: Partial<AppSettings>) => void
}) {
  const gpuPct = Math.min(systemStats.gpuUsage ?? 0, 100)
  const ramPct = systemStats.ramTotal > 0
    ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100)
    : 0

  const partsLabel = settings.autoSplitParts > 1
    ? `${settings.autoSplitParts}p`
    : settings.autoSplitMinutes > 0
      ? `${settings.autoSplitMinutes}m/p`
      : 'no split'

  return (
    <div style={{
      height: 32, background: '#0D0D0D', borderBottom: '1px solid #222',
      display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, flexShrink: 0,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>HyperClip</span>
      <div style={{ width: 1, height: 12, background: '#222' }} />

      {/* Download quality */}
      <span style={{ fontSize: 8, color: '#888', fontWeight: 600 }}>DOWNLOAD</span>
      <span style={{
        background: '#00FF8820', color: '#00FF88', padding: '2px 6px', borderRadius: 2,
        fontSize: 7, border: '1px solid #00FF8844',
      }}>
        {settings.autoDownloadQuality || '720'}p
      </span>
      <span style={{ fontSize: 8, color: '#555' }}>Trim {settings.defaultTrimLimit === 'full' ? 'FULL' : `${settings.defaultTrimLimit}m`}</span>

      <div style={{ width: 1, height: 12, background: '#222' }} />

      {/* Auto-render toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 8, color: '#888', fontWeight: 600 }}>AUTO RENDER</span>
        <div
          onClick={() => {
            const newVal = !settings.autoRender
            onSettingsChange({ autoRender: newVal })
            ipc.updateSettings({ autoRender: newVal })
          }}
          style={{
            width: 28, height: 12, cursor: 'pointer',
            background: settings.autoRender ? '#00FF88' : '#1A1A1A',
            border: `1px solid ${settings.autoRender ? '#00FF8866' : '#333'}`,
            borderRadius: 6, position: 'relative', transition: 'background 0.15s',
          }}
        >
          <div style={{
            width: 10, height: 10, background: settings.autoRender ? '#000' : '#555',
            borderRadius: '50%', position: 'absolute', top: 1,
            left: settings.autoRender ? 'unset' : 1, right: settings.autoRender ? 2 : 'unset',
            transition: 'all 0.15s',
          }} />
        </div>
      </div>
      <span style={{ fontSize: 8, color: '#555' }}>
        {settings.autoRenderResolution || '1080p'}·{settings.autoRenderFPS || 30}fps·{partsLabel}
      </span>

      <div style={{ flex: 1 }} />

      {/* System health mini */}
      <span style={{ fontSize: 7, color: '#555' }}>GPU {systemStats.gpuTemp || 0}°</span>
      <div style={{ width: 30, height: 3, background: '#222', borderRadius: 1 }}>
        <div style={{ width: `${gpuPct}%`, height: '100%', background: gpuPct > 90 ? '#FF4444' : '#00FF88', borderRadius: 1 }} />
      </div>
      <span style={{ fontSize: 7, color: '#555' }}>RAM {Math.round(systemStats.ramUsed || 0)}/{Math.round(systemStats.ramTotal || 64)}G</span>
      <div style={{ width: 30, height: 3, background: '#222', borderRadius: 1 }}>
        <div style={{ width: `${ramPct}%`, height: '100%', background: ramPct > 80 ? '#FF4444' : '#00B4FF', borderRadius: 1 }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/TopBar.tsx
git commit -m "feat: create TopBar component with config + system health"
```

---

### Task 3: Create SettingsPanel component (2-column cards)

**Files:**
- Create: `src/app/components/SettingsPanel.tsx`

- [ ] **Step 1: Create SettingsPanel.tsx**

Write `src/app/components/SettingsPanel.tsx` with the following sections. This is a large file — each card is self-contained.

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '../lib/store'
import { ipc } from '../lib/ipc'
import type { Channel, SystemStats } from '../types'

// ─── Props ────────────────────────────────────────────────────────────

interface SettingsData {
  autoRender: boolean
  autoRenderResolution: string
  autoRenderFPS: number
  autoSplitParts: number
  autoSplitMinutes: number
  autoRenderTitleTemplate: string
  autoDownloadQuality: string
  defaultTrimLimit: number | 'full'
  maxConcurrentDownloads: number
  maxConcurrentRenders: number
  videoMinDurationSec: number
  videoMaxDurationSec: number
  videoStoragePath: string
  outputPath: string
  downloadsCleanupDays: number
  proxyEnabled: boolean
}

interface Props {
  settings: SettingsData
  systemStats: SystemStats
  channels: Channel[]
  activeChannelId: string | null
  onSettingsChange: (patch: Partial<SettingsData>) => void
}

// ─── Button group helper ──────────────────────────────────────────────

function BtnGroup({ options, value, onChange, size = 'md' }: {
  options: { label: string; value: string | number | boolean }[]
  value: string | number | boolean
  onChange: (v: any) => void
  size?: 'sm' | 'md'
}) {
  const h = size === 'sm' ? 20 : 22
  const fs = size === 'sm' ? 7 : 7
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1, height: h, cursor: 'pointer',
              background: active ? '#00B4FF20' : '#1A1A1A',
              border: `1px solid ${active ? '#00B4FF44' : '#222'}`,
              borderRadius: 2, fontSize: fs, fontWeight: 700,
              color: active ? '#00B4FF' : '#555',
              fontFamily: 'monospace', transition: 'all 0.1s',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Toggle switch ────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 28, height: 12, cursor: 'pointer', flexShrink: 0,
        background: value ? '#00FF88' : '#1A1A1A',
        border: `1px solid ${value ? '#00FF8866' : '#333'}`,
        borderRadius: 6, position: 'relative', transition: 'background 0.15s',
      }}
    >
      <div style={{
        width: 10, height: 10, background: value ? '#000' : '#555',
        borderRadius: '50%', position: 'absolute', top: 1,
        left: value ? 'unset' : 1, right: value ? 2 : 'unset',
        transition: 'all 0.15s',
      }} />
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 700, color: '#888', marginBottom: 4 }}>{children}</div>
}

// ─── Card wrapper ─────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      margin: '4px 6px 2px', background: '#0D0D0D', border: '1px solid #1A1A1A',
      borderRadius: 4, padding: 8, ...style,
    }}>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// AUTO RENDER CARD
// ═══════════════════════════════════════════════════════════════════════

function AutoRenderCard({ s, onChange }: { s: SettingsData; onChange: (p: Partial<SettingsData>) => void }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#00FF88', flex: 1 }}>AUTO RENDER</span>
        <Toggle value={s.autoRender} onChange={v => onChange({ autoRender: v })} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <div>
          <SectionLabel>Resolution</SectionLabel>
          <BtnGroup
            options={[
              { label: '1080p', value: '1080p' },
              { label: '720p', value: '720p' },
              { label: '360p', value: '360p' },
            ]}
            value={s.autoRenderResolution}
            onChange={v => onChange({ autoRenderResolution: v })}
          />
        </div>
        <div>
          <SectionLabel>FPS</SectionLabel>
          <BtnGroup
            options={[{ label: '30', value: 30 }, { label: '60', value: 60 }]}
            value={s.autoRenderFPS}
            onChange={v => onChange({ autoRenderFPS: v as 30 | 60 })}
          />
        </div>
      </div>

      <div style={{ marginTop: 4 }}>
        <SectionLabel>Số phần</SectionLabel>
        <BtnGroup
          options={[
            { label: '1 (no split)', value: 1 },
            { label: '2', value: 2 },
            { label: '3', value: 3 },
            { label: '4', value: 4 },
            { label: '5', value: 5 },
          ]}
          value={s.autoSplitParts}
          onChange={v => onChange({ autoSplitParts: v as number })}
          size="sm"
        />
      </div>

      <div style={{ marginTop: 4 }}>
        <SectionLabel>Phút/phần</SectionLabel>
        <BtnGroup
          options={[
            { label: 'Auto', value: 0 },
            { label: '2', value: 2 },
            { label: '3', value: 3 },
            { label: '5', value: 5 },
            { label: '10', value: 10 },
          ]}
          value={s.autoSplitMinutes}
          onChange={v => onChange({ autoSplitMinutes: v as number })}
          size="sm"
        />
      </div>

      <div style={{ marginTop: 4 }}>
        <SectionLabel>Title template</SectionLabel>
        <input
          type="text"
          value={s.autoRenderTitleTemplate}
          onChange={e => onChange({ autoRenderTitleTemplate: e.target.value })}
          placeholder='{title} - {channel}'
          style={{
            width: '100%', height: 22, background: '#0A0A0A', border: '1px solid #222',
            borderRadius: 2, color: '#00B4FF', fontSize: 7, fontFamily: 'monospace',
            padding: '0 6px', outline: 'none',
          }}
        />
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// DOWNLOAD CARD
// ═══════════════════════════════════════════════════════════════════════

function DownloadCard({ s, onChange }: { s: SettingsData; onChange: (p: Partial<SettingsData>) => void }) {
  return (
    <Card>
      <SectionLabel>DOWNLOAD</SectionLabel>

      <div style={{ marginBottom: 4 }}>
        <SectionLabel>Chất lượng download</SectionLabel>
        <BtnGroup
          options={[
            { label: '360p', value: '360' },
            { label: '480p', value: '480' },
            { label: '720p', value: '720' },
            { label: '1080p', value: '1080' },
          ]}
          value={s.autoDownloadQuality}
          onChange={v => onChange({ autoDownloadQuality: v as string })}
        />
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 7, color: '#555', whiteSpace: 'nowrap' }}>Trim</span>
        <div style={{
          flex: 1, background: '#0A0A0A', border: '1px solid #222', borderRadius: 2,
          padding: '2px 6px', fontSize: 7, color: '#00B4FF', fontFamily: 'monospace',
        }}>
          {s.defaultTrimLimit === 'full' ? 'FULL' : `${s.defaultTrimLimit} phút`}
        </div>
        <button
          onClick={() => onChange({ defaultTrimLimit: s.defaultTrimLimit === 'full' ? 10 : 'full' })}
          style={{
            padding: '2px 6px', background: '#1A1A1A', border: '1px solid #222',
            borderRadius: 2, fontSize: 6, color: s.defaultTrimLimit === 'full' ? '#00B4FF' : '#555',
            cursor: 'pointer', fontWeight: s.defaultTrimLimit === 'full' ? 700 : 400,
          }}
        >
          FULL
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <div>
          <SectionLabel>Tải đồng thời</SectionLabel>
          <BtnGroup
            options={[{ label: '3', value: 3 }, { label: '5', value: 5 }, { label: '10', value: 10 }]}
            value={s.maxConcurrentDownloads}
            onChange={v => onChange({ maxConcurrentDownloads: v as number })}
            size="sm"
          />
        </div>
        <div>
          <SectionLabel>Render đồng thời</SectionLabel>
          <BtnGroup
            options={[{ label: '2', value: 2 }, { label: '4', value: 4 }, { label: '8', value: 8 }]}
            value={s.maxConcurrentRenders}
            onChange={v => onChange({ maxConcurrentRenders: v as number })}
            size="sm"
          />
        </div>
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// CHANNEL OVERRIDE CARD
// ═══════════════════════════════════════════════════════════════════════

function ChannelOverrideCard({ settings, channels, activeChannelId, onSettingsChange }: Props) {
  const channel = channels.find(c => c.id === activeChannelId) || channels[0]
  const chSettings = channel?.settings

  const handleOverride = (patch: Record<string, any>) => {
    if (!channel) return
    const newSettings = { ...(chSettings || {}), ...patch }
    useAppStore.getState().updateChannel(channel.id, { settings: newSettings })
    ipc.updateChannel(channel.id, { settings: newSettings })
  }

  if (!channel) return null

  const hasOverride = !!chSettings && Object.keys(chSettings).length > 0

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#FFB800', flex: 1 }}>CHANNEL OVERRIDE</span>
        <select
          value={channel?.id || ''}
          onChange={e => {
            const ch = channels.find(c => c.id === e.target.value)
            if (ch) {
              // update active channel via parent callback
            }
          }}
          style={{
            height: 20, background: '#1A1A1A', border: '1px solid #222', borderRadius: 2,
            color: '#888', fontSize: 7, fontFamily: 'monospace', cursor: 'pointer',
          }}
        >
          {channels.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {hasOverride && (
          <span style={{
            fontSize: 6, color: '#FFB800', background: '#FFB80015',
            padding: '1px 4px', borderRadius: 2, border: '1px solid #FFB80044',
          }}>
            override
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <div>
          <SectionLabel>Resolution</SectionLabel>
          <BtnGroup
            options={[{ label: '720p', value: '720p' }, { label: '1080p', value: '1080p' }]}
            value={chSettings?.resolution || 'global'}
            onChange={v => handleOverride({ resolution: v })}
          />
        </div>
        <div>
          <SectionLabel>FPS</SectionLabel>
          <BtnGroup
            options={[{ label: '30', value: 30 }, { label: '60', value: 60 }]}
            value={chSettings?.fps || 'global'}
            onChange={v => handleOverride({ fps: v })}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
        <button
          onClick={() => handleOverride({ autoSplit: true, splitMinutes: 3 })}
          style={{
            flex: 1, height: 20, background: chSettings?.autoSplit ? '#00B4FF20' : '#1A1A1A',
            border: `1px solid ${chSettings?.autoSplit ? '#00B4FF44' : '#222'}`,
            borderRadius: 2, fontSize: 6, cursor: 'pointer',
            color: chSettings?.autoSplit ? '#00B4FF' : '#555', fontWeight: 700,
          }}
        >
          Auto-split
        </button>
        <button
          onClick={() => handleOverride({ autoSplit: false })}
          style={{
            flex: 1, height: 20, background: chSettings?.autoSplit === false ? '#00B4FF20' : '#1A1A1A',
            border: `1px solid ${chSettings?.autoSplit === false ? '#00B4FF44' : '#222'}`,
            borderRadius: 2, fontSize: 6, cursor: 'pointer',
            color: chSettings?.autoSplit === false ? '#00B4FF' : '#555',
          }}
        >
          No split
        </button>
      </div>

      {hasOverride && (
        <button
          onClick={() => {
            useAppStore.getState().updateChannel(channel.id, { settings: undefined })
            ipc.updateChannel(channel.id, { settings: undefined })
          }}
          style={{
            marginTop: 4, width: '100%', height: 20, background: '#1A1A1A',
            border: '1px solid #FF444422', borderRadius: 2, fontSize: 6,
            color: '#FF4444', cursor: 'pointer',
          }}
        >
          Reset to global
        </button>
      )}
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// STORAGE CARD
// ═══════════════════════════════════════════════════════════════════════

function StorageCard({ s, onChange }: { s: SettingsData; onChange: (p: Partial<SettingsData>) => void }) {
  const [storageStats, setStorageStats] = useState<{ downloads: number; outputPath: string; downloadPath: string; freeBytes: number } | null>(null)

  useEffect(() => {
    ipc.getStorageSize().then((r: any) => setStorageStats(r)).catch(() => {})
    const t = setInterval(() => {
      ipc.getStorageSize().then((r: any) => setStorageStats(r)).catch(() => {})
    }, 30000)
    return () => clearInterval(t)
  }, [])

  const freeGB = storageStats ? Math.round(storageStats.freeBytes / (1024**3)) : 0
  const usedMB = storageStats ? Math.round(storageStats.downloads) : 0
  const usedPct = freeGB + usedMB / 1024 > 0 ? Math.round((usedMB / 1024) / (freeGB + usedMB / 1024) * 100) : 0

  return (
    <Card>
      <SectionLabel>STORAGE</SectionLabel>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <div style={{ flex: 1, height: 5, background: '#1A1A1A', borderRadius: 2 }}>
          <div style={{ width: `${Math.min(usedPct, 100)}%`, height: '100%', background: usedPct > 80 ? '#FF4444' : '#00B4FF', borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: 7, color: '#00B4FF66', fontFamily: 'monospace' }}>
          {usedMB}MB / {freeGB}GB free
        </span>
      </div>

      <div style={{ marginBottom: 3 }}>
        <div style={{ fontSize: 7, color: '#555', marginBottom: 1 }}>Video path</div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <div style={{
            flex: 1, background: '#0A0A0A', border: '1px solid #222', borderRadius: 2,
            padding: '2px 5px', fontSize: 7, color: '#444', fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {s.videoStoragePath || '(default)'}
          </div>
          <button
            onClick={async () => {
              const r = await ipc.pickFolder(s.videoStoragePath)
              if (r?.path) {
                onChange({ videoStoragePath: r.path })
                ipc.updateSettings({ videoStoragePath: r.path })
              }
            }}
            style={{
              padding: '2px 5px', background: '#1A1A1A', border: '1px solid #222',
              borderRadius: 2, fontSize: 7, color: '#555', cursor: 'pointer', flexShrink: 0,
            }}
          >
            📁
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 7, color: '#555', marginBottom: 1 }}>Output path</div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <div style={{
            flex: 1, background: '#0A0A0A', border: '1px solid #222', borderRadius: 2,
            padding: '2px 5px', fontSize: 7, color: '#444', fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {s.outputPath || '(default)'}
          </div>
          <button
            onClick={async () => {
              const r = await ipc.pickFolder(s.outputPath)
              if (r?.path) {
                onChange({ outputPath: r.path })
                ipc.updateSettings({ outputPath: r.path })
              }
            }}
            style={{
              padding: '2px 5px', background: '#1A1A1A', border: '1px solid #222',
              borderRadius: 2, fontSize: 7, color: '#555', cursor: 'pointer', flexShrink: 0,
            }}
          >
            📁
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2 }}>
        <button
          onClick={() => storageStats?.downloadPath && ipc.openFolder(storageStats.downloadPath)}
          style={{
            flex: 1, height: 20, background: '#1A1A1A', border: '1px solid #222',
            borderRadius: 2, fontSize: 6, color: '#555', cursor: 'pointer',
          }}
        >
          Mở thư mục
        </button>
        <button
          onClick={async () => {
            const r = await ipc.clearDownloads()
            if (r.success) useAppStore.getState().showToast(`Freed ${r.freedMB}MB`)
          }}
          style={{
            flex: 1, height: 20, background: '#1A1A1A', border: '1px solid #FF444422',
            borderRadius: 2, fontSize: 6, color: '#FF4444', cursor: 'pointer',
          }}
        >
          Xóa cache
        </button>
      </div>

      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 7, color: '#555' }}>Tự động xóa sau</span>
        <select
          value={s.downloadsCleanupDays}
          onChange={e => onChange({ downloadsCleanupDays: Number(e.target.value) })}
          style={{
            height: 20, background: '#1A1A1A', border: '1px solid #222', borderRadius: 2,
            color: '#00B4FF', fontSize: 7, fontFamily: 'monospace', cursor: 'pointer',
          }}
        >
          <option value={0}>Không</option>
          <option value={3}>3 ngày</option>
          <option value={7}>7 ngày</option>
          <option value={14}>14 ngày</option>
          <option value={30}>30 ngày</option>
        </select>
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// DETECTION CARD
// ═══════════════════════════════════════════════════════════════════════

function DetectionCard() {
  const [pollerStatus, setPollerStatus] = useState<any>(null)
  const [sessionStatus, setSessionStatus] = useState<any>(null)
  const [projectStatus, setProjectStatus] = useState<any>(null)
  const [innertubeDegraded, setInnertubeDegraded] = useState(false)

  useEffect(() => {
    const load = () => {
      ipc.getPollerStatus().then(setPollerStatus).catch(() => {})
      ipc.getSessionStatus().then(setSessionStatus).catch(() => {})
      ipc.getProjects().then(setProjectStatus).catch(() => {})
    }
    load()
    const t = setInterval(load, 8000)
    const cleanup = ipc.onInnertubeDegraded((data: any) => setInnertubeDegraded(data.degraded))
    return () => { clearInterval(t); cleanup() }
  }, [])

  const consented = sessionStatus?.consentedCount ?? 0
  const totalSessions = sessionStatus?.sessionCount ?? 0
  const hasInnertube = consented > 0

  const healthyProjects = projectStatus?.filter((p: any) => p.status === 'healthy').length ?? 0
  const totalProjects = projectStatus?.length ?? 0
  const hasOAuth = healthyProjects > 0

  const sessionHealthPct = sessionStatus?.health?.healthPct ?? 0

  return (
    <Card>
      <SectionLabel>DETECTION</SectionLabel>
      <div style={{ fontSize: 7, color: '#555', lineHeight: 1.7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: hasInnertube ? '#00FF88' : '#333', flexShrink: 0 }} />
          Innertube: <span style={{ color: hasInnertube ? '#00FF88' : '#555', fontWeight: 600 }}>{consented}/{totalSessions}</span> sessions
          {innertubeDegraded && <span style={{ color: '#FFB800', fontSize: 6, background: '#FFB80020', padding: '0 4px', borderRadius: 2 }}>DEGRADED</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: hasOAuth ? '#00FF88' : '#333', flexShrink: 0 }} />
          OAuth: <span style={{ color: hasOAuth ? '#00FF88' : '#555', fontWeight: 600 }}>{healthyProjects}/{totalProjects}</span> projects
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: sessionHealthPct >= 50 ? '#00FF88' : sessionHealthPct > 0 ? '#FFB800' : '#333', flexShrink: 0 }} />
          Session health: <span style={{ color: sessionHealthPct >= 50 ? '#00FF88' : '#FFB800', fontWeight: 600 }}>{sessionHealthPct}%</span>
        </div>
        <div style={{ color: '#555', marginTop: 2 }}>
          Poll: {(pollerStatus?.lastPollAt ? Math.round((Date.now() - pollerStatus.lastPollAt) / 1000) : '?')}s · {pollerStatus?.active ? 'active' : 'paused'} · {pollerStatus?.active && !innertubeDegraded ? '0 lỗi' : ''}
        </div>
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// SYSTEM CARD
// ═══════════════════════════════════════════════════════════════════════

function SystemCard({ systemStats }: { systemStats: SystemStats }) {
  return (
    <Card>
      <SectionLabel>SYSTEM</SectionLabel>
      <div style={{ fontSize: 7, color: '#555', lineHeight: 1.7 }}>
        <div>GPU: <span style={{ color: '#888' }}>{systemStats.gpuName || 'N/A'} · {systemStats.gpuTemp || 0}°C · {systemStats.gpuUsage || 0}% · {(systemStats.gpuEncoder || 'sw').toUpperCase()}</span></div>
        <div>CPU: <span style={{ color: '#888' }}>{systemStats.cpuName || 'N/A'} · {systemStats.cpuUsage || 0}%</span></div>
        <div>RAM: <span style={{ color: '#888' }}>{Math.round(systemStats.ramUsed || 0)} / {Math.round(systemStats.ramTotal || 0)} GB</span></div>
        <div>Workers: <span style={{ color: '#00B4FF', fontWeight: 600 }}>{systemStats.activeWorkers || 0}</span> / {systemStats.maxChunkWorkers || 8} · NVENC</div>
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════

export function SettingsPanel({ settings, systemStats, channels, activeChannelId, onSettingsChange }: Props) {
  const data: SettingsData = {
    autoRender: (settings as any).autoRender ?? false,
    autoRenderResolution: (settings as any).autoRenderResolution ?? '1080p',
    autoRenderFPS: (settings as any).autoRenderFPS ?? 30,
    autoSplitParts: (settings as any).autoSplitParts ?? 1,
    autoSplitMinutes: (settings as any).autoSplitMinutes ?? 0,
    autoRenderTitleTemplate: (settings as any).autoRenderTitleTemplate ?? '',
    autoDownloadQuality: (settings as any).autoDownloadQuality ?? '720',
    defaultTrimLimit: (settings as any).defaultTrimLimit ?? 10,
    maxConcurrentDownloads: (settings as any).maxConcurrentDownloads ?? 3,
    maxConcurrentRenders: (settings as any).maxConcurrentRenders ?? 2,
    videoMinDurationSec: (settings as any).videoMinDurationSec ?? 0,
    videoMaxDurationSec: (settings as any).videoMaxDurationSec ?? 0,
    videoStoragePath: (settings as any).videoStoragePath ?? '',
    outputPath: (settings as any).outputPath ?? '',
    downloadsCleanupDays: (settings as any).downloadsCleanupDays ?? 7,
    proxyEnabled: (settings as any).proxyEnabled ?? false,
  }

  const handleChange = (patch: Partial<SettingsData>) => {
    onSettingsChange(patch as any)
  }

  return (
    <div style={{ flex: 1, background: '#121212', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header bar with advanced buttons */}
      <div style={{
        fontSize: 8, color: '#555', fontWeight: 700, padding: '5px 10px',
        borderBottom: '1px solid #222', letterSpacing: 1, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', background: '#0D0D0D',
      }}>
        <span>SETTINGS</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <a href="/settings?tab=sessions" style={{ padding: '1px 5px', border: '1px solid #222', borderRadius: 2, fontSize: 6, color: '#555', textDecoration: 'none' }}>Sessions</a>
          <a href="/settings?tab=projects" style={{ padding: '1px 5px', border: '1px solid #222', borderRadius: 2, fontSize: 6, color: '#555', textDecoration: 'none' }}>Projects</a>
          <a href="/settings?tab=keys" style={{ padding: '1px 5px', border: '1px solid #222', borderRadius: 2, fontSize: 6, color: '#555', textDecoration: 'none' }}>Keys</a>
          <a href="/settings?tab=diag" style={{ padding: '1px 5px', border: '1px solid #FF444422', borderRadius: 2, fontSize: 6, color: '#FF444466', textDecoration: 'none' }}>Diag</a>
        </div>
      </div>

      {/* 2-column scrollable cards */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start' }}>
        <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column' }}>
          <AutoRenderCard s={data} onChange={handleChange} />
          <DownloadCard s={data} onChange={handleChange} />
          <ChannelOverrideCard
            settings={settings as any}
            systemStats={systemStats}
            channels={channels}
            activeChannelId={activeChannelId}
            onSettingsChange={handleChange}
          />
        </div>
        <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column' }}>
          <StorageCard s={data} onChange={handleChange} />
          <DetectionCard />
          <SystemCard systemStats={systemStats} />
          {/* Misc card */}
          <Card>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, fontWeight: 700, color: '#888', marginBottom: 2 }}>
                  <span>PROXY</span>
                  <Toggle value={data.proxyEnabled} onChange={v => handleChange({ proxyEnabled: v })} />
                </div>
                <div style={{ fontSize: 7, color: '#555' }}>Host:port</div>
              </div>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: '#888', marginBottom: 2 }}>UPDATE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 7, color: '#555' }}>
                  <span style={{ color: '#00B4FF', fontWeight: 600 }}>v0.1.0</span>
                  <button
                    onClick={() => ipc.checkForUpdate()}
                    style={{ padding: '1px 6px', background: '#1A1A1A', border: '1px solid #222', borderRadius: 2, fontSize: 7, color: '#555', cursor: 'pointer' }}
                  >
                    Check
                  </button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: '#888', marginBottom: 2 }}>LOGS</div>
                <button
                  onClick={() => ipc.exportLogs()}
                  style={{ padding: '1px 6px', background: '#1A1A1A', border: '1px solid #222', borderRadius: 2, fontSize: 7, color: '#555', cursor: 'pointer' }}
                >
                  Export
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/SettingsPanel.tsx
git commit -m "feat: create SettingsPanel with 2-column cards for auto-render dashboard"
```

---

### Task 4: Create ActivityLogBar component (bottom log)

**Files:**
- Create: `src/app/components/ActivityLogBar.tsx`

- [ ] **Step 1: Create ActivityLogBar.tsx**

```tsx
'use client'

import { useState } from 'react'
import { useAppStore } from '../lib/store'
import { ipc } from '../lib/ipc'

interface LogEntry {
  id: string
  timestamp: number
  type: string
  message: string
  detail?: string
}

export function ActivityLogBar({
  activityEntries,
  systemStats,
}: {
  activityEntries: LogEntry[]
  systemStats: { activeWorkers: number; maxChunkWorkers: number }
}) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<'activity' | 'errors' | 'system'>('activity')

  const entries = activityEntries.slice(0, expanded ? 15 : 5)
  const errors = activityEntries.filter(e => e.type === 'error')

  const displayEntries = tab === 'errors'
    ? errors.slice(0, expanded ? 15 : 5)
    : tab === 'system'
      ? [] // system tab shows hardware data
      : entries

  const time = (ts: number) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const typeColor = (type: string) => {
    switch (type) {
      case 'done': case 'success': return '#00FF88'
      case 'error': return '#FF4444'
      case 'warning': return '#FFB800'
      case 'rendering': return '#7C3AED'
      case 'downloading': case 'detected': return '#FFB800'
      default: return '#888'
    }
  }

  const typeIcon = (type: string) => {
    switch (type) {
      case 'done': case 'success': return '✓'
      case 'error': return '✗'
      case 'warning': return '⚠'
      case 'rendering': return '⚡'
      case 'downloading': return '⬇'
      case 'detected': return '⬇'
      default: return '●'
    }
  }

  return (
    <div style={{
      height: expanded ? 200 : 75, background: '#0A0A0A', borderTop: '1px solid #222',
      display: 'flex', flexDirection: 'column', flexShrink: 0, transition: 'height 0.2s',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
        borderBottom: '1px solid #1A1A1A', height: 18, flexShrink: 0,
      }}>
        {(['activity', 'errors', 'system'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontSize: 6, fontWeight: 700, cursor: 'pointer', height: 14, padding: '0 6px',
              background: tab === t ? 'rgba(0,180,255,0.08)' : 'transparent',
              border: tab === t ? '1px solid #00B4FF44' : '1px solid transparent',
              borderRadius: 2, color: tab === t ? '#00B4FF' : '#555',
              display: 'flex', alignItems: 'center', gap: 3,
              fontFamily: 'monospace', letterSpacing: '0.04em',
            }}
          >
            {t.toUpperCase()}
            {t === 'errors' && errors.length > 0 && (
              <span style={{
                width: 14, height: 14, background: '#FF4444', borderRadius: '50%',
                fontSize: 6, fontWeight: 700, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {errors.length}
              </span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            fontSize: 5, color: '#333', cursor: 'pointer', background: 'none',
            border: 'none', padding: '0 4px', fontFamily: 'monospace',
          }}
        >
          {expanded ? 'collapse' : 'expand'}
        </button>
      </div>

      {/* Log lines */}
      <div style={{
        flex: 1, overflow: 'hidden', padding: '2px 8px',
        fontFamily: 'monospace', fontSize: expanded ? 7 : 6, lineHeight: 1.55,
      }}>
        {tab === 'system' ? (
          <div style={{ display: 'flex', gap: 16, padding: 4, fontSize: 7, color: '#555' }}>
            <div><span style={{ color: '#888' }}>GPU</span> RTX 5080 · 45°C</div>
            <div><span style={{ color: '#888' }}>CPU</span> Ultra 9 · 12%</div>
            <div><span style={{ color: '#888' }}>RAM</span> 32/64 GB</div>
            <div><span style={{ color: '#888' }}>NVENC</span> H.264 p1 · ull</div>
          </div>
        ) : displayEntries.length === 0 ? (
          <div style={{ color: '#333', padding: 4, fontSize: 7 }}>No {tab === 'errors' ? 'errors' : 'activity'} yet</div>
        ) : (
          displayEntries.map(e => (
            <div key={e.id} style={{ color: e.type === 'error' ? '#FF6B6B' : '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ color: typeColor(e.type) }}>[{time(e.timestamp)}]</span>
              {' '}<span style={{ color: typeColor(e.type) }}>{typeIcon(e.type)}</span>
              {' '}{e.message}
              {e.detail ? <span style={{ color: '#555' }}> · {e.detail}</span> : null}
            </div>
          ))
        )}
      </div>

      {/* Health status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px',
        borderTop: '1px solid #1A1A1A', fontSize: 5, color: '#444', height: 14, flexShrink: 0,
      }}>
        {[
          { label: 'Innertube', color: '#00FF88' },
          { label: 'OAuth', color: '#00FF88' },
          { label: 'GPU', color: '#00FF88' },
          { label: 'Disk', color: '#00FF88' },
          { label: 'Queue', color: '#FFB800' },
        ].map(dot => (
          <span key={dot.label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: dot.color }} />
            {dot.label}
          </span>
        ))}
        <div style={{ flex: 1 }} />
        <span>{systemStats.activeWorkers || 0}/{systemStats.maxChunkWorkers || 8} workers</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/ActivityLogBar.tsx
git commit -m "feat: create ActivityLogBar with tabs, log lines, health dots"
```

---

### Task 5: Update Sidebar — compact channels view

**Files:**
- Modify: `src/app/components/Sidebar.tsx`

- [ ] **Step 1: Remove storage, download settings, system stats from Sidebar**

In `Sidebar.tsx`, remove these sections (keep only channel list + detection mini + activity log):
1. Remove "STORAGE" section (lines ~536-668) — moved to SettingsPanel
2. Remove "DOWNLOAD" section (lines ~670-773) — moved to SettingsPanel/TopBar
3. Remove "System stats" section (lines ~775-836) — moved to SettingsPanel/TopBar

Keep:
- Brand bar (lines 235-300) — compact: just "HC" logo + name
- DetectionStatusBar (line 303) — keep
- Channel list (lines ~307-525) — keep, but reduce padding to compact
- ActivityLog (lines ~528-534) — keep
- Confirmation dialog — keep

Reduce sidebar width from 180px to 140px in the style at line 228-232:
```tsx
width: 140,  // was 180
```

Reduce padding in channel items from `'7px 12px'` to `'4px 6px'` (line 376).

- [ ] **Step 2: Commit**

```bash
git add src/app/components/Sidebar.tsx
git commit -m "refactor: compact Sidebar to 140px, remove storage/download/system sections"
```

---

### Task 6: Create compact WorkspaceQueue for right panel

**Files:**
- Modify: `src/app/components/workspace/WorkspaceQueue.tsx`
- Modify: `src/app/components/workspace/WorkspaceCard.tsx` (optional)

- [ ] **Step 1: Create compact variant of WorkspaceQueue**

Read existing `WorkspaceQueue.tsx`:
```bash
cat src/app/components/workspace/WorkspaceQueue.tsx | head -20
```

Then modify to support `compact` prop. In `WorkspaceQueue.tsx`, add a `compact?: boolean` prop. When compact:
- Smaller thumbnails (48x27 vs default)
- Smaller font sizes (8px vs 10px)
- Remove action buttons (edit, delete shown on hover only)
- Show filter tabs at top (ALL / DL / RENDER / ERR)

Add after the existing imports:
```tsx
interface WorkspaceQueueCompactProps {
  workspaces: Workspace[]
  renderedVideos: any[]
  channels: Channel[]
  selectedId: string | null
  selectedRenderedId: string | null
  onSelect: (id: string) => void
  onQuickAction: (action: 'open' | 'delete', id: string) => void
  onRetry: (id: string) => void
  onShowToast: (msg: string) => void
  compact?: boolean
}
```

In the render function, when `compact` is true, render the compact layout.

- [ ] **Step 2: Commit**

```bash
git add src/app/components/workspace/WorkspaceQueue.tsx
git commit -m "feat: add compact mode to WorkspaceQueue for right panel"
```

---

### Task 7: Rewrite page.tsx — new 3-panel layout

**Files:**
- Modify: `src/app/page.tsx`

This is the core task — wire everything together.

- [ ] **Step 1: Replace imports in page.tsx**

Replace:
```tsx
import { Sidebar } from './components/Sidebar'
import { WorkspaceQueue } from './components/workspace/WorkspaceQueue'
import { RenderQueueBar } from './components/workspace/RenderQueueBar'
import { DetailEditor } from './components/DetailEditor'
import { RenderedVideoDetail } from './components/RenderedVideoDetail'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'
```

With:
```tsx
import { Sidebar } from './components/Sidebar'
import { WorkspaceQueue } from './components/workspace/WorkspaceQueue'
import { RenderedVideoDetail } from './components/RenderedVideoDetail'
import { TopBar } from './components/TopBar'
import { SettingsPanel } from './components/SettingsPanel'
import { ActivityLogBar } from './components/ActivityLogBar'
```

- [ ] **Step 2: Update DashboardContent render**

Replace the render return block (~line 1022-1187) with:

```tsx
return (
    <div style={{ display: 'flex', height: '100vh', background: '#0E0E0E', fontFamily: 'Inter, sans-serif', color: '#fff', overflow: 'hidden', flexDirection: 'column' }}>
      {!authStatus.isReady && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
          <LoginScreen accountName={authStatus.accountName} oauthReady={authStatus.oauthReady} onLogout={handleLogout} />
        </div>
      )}

      {/* TOP BAR */}
      <TopBar
        settings={settings}
        systemStats={systemStats}
        onSettingsChange={async (patch) => {
          setSettings(patch)
          await ipc.updateSettings(patch)
        }}
      />

      {/* 3-PANEL BODY */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* LEFT: Channels */}
        <Sidebar
          channels={channels}
          isLoadingChannels={isLoadingChannels}
          activeChannelId={activeChannelId || ''}
          newCounts={newCounts}
          onChannelSelect={handleChannelSelect}
          systemStats={systemStats}
          authStatus={authStatus}
          pollerStatus={pollerStatus}
          onLogout={handleLogout}
          keyHealth={keyHealth}
          settings={settings}
          onSettingsChange={async (patch) => {
            setSettings(patch)
            await ipc.updateSettings(patch)
          }}
          activityEntries={[...activityMap.values()].reverse()}
          etaDisplay={etaDisplay}
        />

        {/* CENTER: Settings */}
        <SettingsPanel
          settings={settings}
          systemStats={systemStats}
          channels={channels}
          activeChannelId={activeChannelId}
          onSettingsChange={async (patch) => {
            setSettings(patch)
            await ipc.updateSettings(patch)
          }}
        />

        {/* RIGHT: Video Queue */}
        <div style={{
          width: 280, display: 'flex', flexDirection: 'column',
          overflow: 'hidden', borderLeft: '1px solid #222', flexShrink: 0,
        }}>
          {showSkeleton ? (
            <SkeletonQueue />
          ) : selectedRenderedVideoId && renderedVideos.find(v => v.id === selectedRenderedVideoId) ? (
            <RenderedVideoDetail
              video={renderedVideos.find(v => v.id === selectedRenderedVideoId)!}
              onShowToast={showToast}
            />
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
              compact={true}
            />
          )}
        </div>
      </div>

      {/* BOTTOM: Activity Log */}
      <ActivityLogBar
        activityEntries={[...activityMap.values()].reverse()}
        systemStats={systemStats}
      />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: '#1A1A1A', border: '1px solid #2A2A2A',
          borderLeft: '3px solid #00B4FF', borderRadius: 4,
          padding: '10px 16px', fontSize: 12, color: '#ccc',
          zIndex: 9999, maxWidth: 320,
        }}>
          {toast}
        </div>
      )}

      <ConfirmationDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmDanger={confirmDialog?.confirmDanger}
        onConfirm={confirmDialog?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmDialog(null)}
      />

      {compareWorkspaceId && (
        <VideoCompareModal
          workspace={compareWorkspace}
          rendered={compareRendered}
          onClose={() => setCompareWorkspaceId(null)}
        />
      )}
    </div>
  )
```

- [ ] **Step 2b: Clean up unused state/variables**

Remove these from the component (no longer needed):
- `editorState` references (useAppStore selectors)
- `handleRender`, `handleExportChunked`, `handleSplit`, `handleCancelRender`
- `lastRenderCodec` ref
- `BOTTOM_PCT` constant (not needed without editor)
- `RenderQueueBar` import + usage
- `ResizablePanelGroup` imports
- Editor-related callbacks

Keep:
- `selectedWorkspaceId`, `selectWorkspace` — still needed for queue selection
- `workspaces`, `channels`, `renderedVideos` — still needed
- All activity/notification logic
- All IPC event listeners (auto-download, progress, etc.)
- Channel filter logic

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: errors from removed imports. Fix any remaining references to deleted functions.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: rewrite dashboard to new 3-panel auto-render layout"
```

---

### Task 8: Auto-split backend trigger

**Files:**
- Modify: `electron/main.ts`
- Reference: `docs/CHANNEL_MANAGEMENT_PLAN.md`

- [ ] **Step 1: Add auto-split after download in main.ts**

Find the auto-render trigger in `electron/main.ts` (after download completes, workspace status changes to `ready`). Add auto-split logic before auto-render:

```typescript
// After download → workspace ready
// Auto-split check (before auto-render)
const chSettings = store.getChannelSettings(ws.channelId)
const globalSplitParts = settings.autoSplitParts ?? 1
const globalSplitMinutes = settings.autoSplitMinutes ?? 0

const shouldSplit = chSettings?.autoSplit ?? (globalSplitParts > 1 || globalSplitMinutes > 0)
const splitMinutes = chSettings?.splitMinutes ?? (globalSplitMinutes > 0 ? globalSplitMinutes : 0)

if (shouldSplit && splitMinutes > 0) {
  devLog(`[AutoSplit] Splitting ${ws.videoTitle} into ${splitMinutes}min parts`)
  const result = await splitWorkspace(ws.id, { partMinutes: splitMinutes })
  // Auto-render each part
  if (result.success && result.newWorkspaces) {
    for (const part of result.newWorkspaces) {
      if (settings.autoRender) {
        queueAutoRender(part.id)
      }
    }
  }
} else if (settings.autoRender) {
  // No split — auto-render directly
  queueAutoRender(ws.id)
}
```

- [ ] **Step 2: Read the current main.ts to find exact insertion point**

```bash
grep -n "autoRender\|auto-download\|downloadDone\|processBgDownload" electron/main.ts | head -20
```

Insert the auto-split logic at the point where auto-download completes and workspace transitions to ready.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat: auto-split trigger after download with parts config"
```

---

### Task 9: Verify + cleanup

**Files:**
- Modify: none (verify only)

- [ ] **Step 1: Run full TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors. If errors, fix them.

- [ ] **Step 2: Run tests**

```bash
npm run test
```
Expected: all 42 existing tests pass.

- [ ] **Step 3: Verify build**

```bash
npm run electron:build 2>&1 | tail -10
```
Expected: Build completes without errors.

- [ ] **Step 4: Archive DetailEditor (optional — if user confirms)**

```bash
git mv src/app/components/DetailEditor.tsx src/app/components/DetailEditor.tsx.archive
```

Or keep in place but mark as dead code in CLAUDE.md.

---

## Self-Review Checklist

1. **Spec coverage:** The spec has 12 sections. Tasks 1-9 cover every section.
   - Sect 1 (Overview) → implicit
   - Sect 2 (Layout) → Task 7
   - Sect 3 (TopBar) → Task 2, Task 7
   - Sect 4 (Channels) → Task 5
   - Sect 5 (Settings cards) → Task 3
   - Sect 6 (Video Queue) → Task 6, Task 7
   - Sect 7 (Log Bar) → Task 4
   - Sect 8 (Data Flow) → Task 1
   - Sect 9 (File changes) → all tasks
   - Sect 10 (Phases) → all tasks
   - Sect 11 (Open Questions) → resolution format changed in Task 1 step 4
   - Sect 12 (Design Principles) → implicit in all components

2. **Placeholder scan:** No TBD/TODO in any step. All code is complete.

3. **Type consistency:** autoSplitParts/autoSplitMinutes used consistently across frontend store, backend ramdisk, and IPC. AutoRenderResolution changed to '1080p' format everywhere.
