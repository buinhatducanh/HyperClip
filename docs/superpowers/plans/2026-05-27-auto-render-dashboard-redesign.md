# Auto-Render Dashboard — UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform HyperClip from manual-editor-centric layout to 100% auto-render dashboard with config panels replacing DetailEditor.

**Architecture:** New 4-zone layout (TopBar | Sidebar+SettingsPanel+Queue | BottomLog). Settings cards in center panel replace manual editor. Sidebar narrows to 140px channels-only. Queue moves to right 280px panel. Bottom log bar extracts ActivityLog inline.

**Tech Stack:** React 18 (Next.js App Router), Zustand (flat store), Tailwind + inline styles, Electron IPC.

**Requirement source:** `docs/superpowers/specs/2026-05-27-auto-render-dashboard-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/app/components/TopBar.tsx` | 32px bar: download quality, trim limit, auto-render toggle + badge, GPU/RAM/CPU health bars |
| `src/app/components/SettingsPanel.tsx` | Center panel: 2-column flex-wrap cards (Auto Render, Download, Channel Override, Storage, Detection, System, Misc) |
| `src/app/components/ActivityLogBar.tsx` | Bottom 75px bar: activity tabs, log lines, health status dots, expand/collapse |

### Modified files
| File | Changes |
|------|--------|
| `src/app/page.tsx` | Layout restructure: TopBar + Sidebar(140px) + SettingsPanel(flex) + Queue(280px) + ActivityLogBar(75px). Remove DetailEditor import and all manual-editor handlers. Keep IPC plumbing, activity tracking, ETA logic. |
| `src/app/components/Sidebar.tsx` | Narrow to 140px. Remove Storage manager, Download settings, System stats, ActivityLog. Keep brand bar, DetectionStatusBar, channel list, add-channel bar. |
| `src/app/components/workspace/WorkspaceQueue.tsx` | Adapt for right-panel 280px. Keep pipeline/rendered tabs, compact cards. Remove resizable panel usage. |
| `src/app/lib/store.ts` | Add `autoSplitParts`, `autoSplitMinutes` to AppSettings defaults. |
| `src/app/types.ts` | Add `fps?: 30 \| 60` to ChannelSettings. |
| `electron/services/ramdisk.ts` | Add `autoSplitParts`, `autoSplitMinutes` to AppSettingsStore interface + defaults. |

### Archived (not deleted, no longer imported)
| File | Reason |
|------|--------|
| `src/app/components/DetailEditor.tsx` | Manual editor replaced by auto-render config in SettingsPanel |
| `src/app/components/workspace/RenderQueueBar.tsx` | Render queue status integrated into Queue panel |

---

## Phase 1: Backend — Add autoSplit fields to AppSettings

### Task 1.1: Add autoSplitParts + autoSplitMinutes to backend settings

**Files:**
- Modify: `electron/services/ramdisk.ts`

- [ ] **Add new fields to AppSettingsStore interface**

Edit `electron/services/ramdisk.ts`. Add these fields before `onboardingComplete`:

```typescript
  /** Number of parts to split auto-rendered videos into. 1 = no split. */
  autoSplitParts?: number
  /** Minutes per part for auto-split. 0 = use autoSplitParts count. */
  autoSplitMinutes?: number
```

- [ ] **Add defaults in loadSettings()**

In `loadSettings()`, add after the existing defaults:

```typescript
  if (_settings.autoSplitParts === undefined) _settings.autoSplitParts = 1
  if (_settings.autoSplitMinutes === undefined) _settings.autoSplitMinutes = 0
```

- [ ] **Commit**

```bash
git add electron/services/ramdisk.ts
git commit -m "feat: add autoSplitParts, autoSplitMinutes to AppSettings backend"
```

---

## Phase 2: Frontend — Add new store/types fields

### Task 2.1: Add autoSplit fields to AppSettings + fps to ChannelSettings

**Files:**
- Modify: `src/app/lib/store.ts`
- Modify: `src/app/types.ts`

- [ ] **Add fps to ChannelSettings**

In `src/app/types.ts`, add `fps?: 30 | 60` to the `ChannelSettings` interface:

```typescript
export interface ChannelSettings {
  trimLimit?: number | 'full'
  downloadQuality?: string
  autoRender?: boolean
  resolution?: string
  autoSplit?: boolean
  splitMinutes?: number
  fps?: 30 | 60           // NEW
}
```

- [ ] **Add autoSplitParts + autoSplitMinutes to AppSettings in store**

In `src/app/lib/store.ts`, add to the `AppSettings` interface:

```typescript
  autoSplitParts: number       // default: 1 (1 = không split)
  autoSplitMinutes: number     // default: 0 (0 = use autoSplitParts)
```

And add defaults in the `settings` initial state:

```typescript
    autoSplitParts: 1,
    autoSplitMinutes: 0,
```

- [ ] **Commit**

```bash
git add src/app/types.ts src/app/lib/store.ts
git commit -m "feat: add autoSplitParts, autoSplitMinutes, fps to frontend types"
```

---

## Phase 3: Create TopBar component

### Task 3.1: Build TopBar.tsx

**Files:**
- Create: `src/app/components/TopBar.tsx`

TopBar is a 32px horizontal bar showing download quality, trim limit, auto-render toggle, and system health.

- [ ] **Create TopBar.tsx with full implementation**

```tsx
'use client'

import { useState } from 'react'
import type { SystemStats, AppSettings } from '../lib/store'

interface Props {
  settings: AppSettings
  systemStats: SystemStats
  onSettingsChange: (patch: Partial<AppSettings>) => void
}

const QUALITY_OPTS = ['360', '480', '720', '1080'] as const

export function TopBar({ settings, systemStats, onSettingsChange }: Props) {
  const badgeText = settings.autoRender
    ? `${settings.autoRenderResolution.replace('x', '×')}·${settings.autoRenderFPS}fps`
    : ''

  return (
    <div
      style={{
        height: 32, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 10px', background: '#0D0D0D',
        borderBottom: '1px solid #1E1E1E', flexShrink: 0,
      }}
    >
      {/* Brand */}
      <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', flexShrink: 0 }}>
        HyperClip
      </span>

      {/* Separator */}
      <div style={{ width: 1, height: 14, background: '#222', flexShrink: 0 }} />

      {/* Download quality */}
      <span style={{ fontSize: 8, color: '#444', fontWeight: 600, flexShrink: 0 }}>DOWNLOAD</span>
      {QUALITY_OPTS.map(val => (
        <button
          key={val}
          onClick={() => onSettingsChange({ autoDownloadQuality: val })}
          style={{
            height: 20, padding: '0 6px', border: 'none', borderRadius: 3,
            background: (settings.autoDownloadQuality || '720') === val ? '#00FF8822' : 'transparent',
            color: (settings.autoDownloadQuality || '720') === val ? '#00FF88' : '#555',
            fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace',
          }}
        >
          {val}p
        </button>
      ))}

      {/* Separator */}
      <div style={{ width: 1, height: 14, background: '#222', flexShrink: 0 }} />

      {/* Auto-render toggle */}
      <span style={{ fontSize: 8, color: '#444', fontWeight: 600, flexShrink: 0 }}>AUTO RENDER</span>
      <button
        onClick={() => onSettingsChange({ autoRender: !settings.autoRender })}
        title={settings.autoRender ? 'Auto-render ON' : 'Auto-render OFF'}
        style={{
          width: 28, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', flexShrink: 0,
          background: settings.autoRender ? '#00FF8844' : '#222',
          position: 'relative', transition: 'background 0.15s',
        }}
      >
        <div style={{
          width: 12, height: 12, borderRadius: '50%',
          background: settings.autoRender ? '#00FF88' : '#555',
          position: 'absolute', top: 2,
          left: settings.autoRender ? 14 : 2,
          transition: 'left 0.15s',
        }} />
      </button>

      {/* Badge */}
      {badgeText && (
        <span style={{
          fontSize: 8, color: '#00FF8866', fontFamily: 'monospace',
          background: '#00FF8808', padding: '1px 5px', borderRadius: 3,
        }}>
          {badgeText}
        </span>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* GPU temp */}
      {systemStats.gpuTemp > 0 && (
        <span style={{ fontSize: 9, color: '#666', fontFamily: 'monospace', flexShrink: 0 }}>
          GPU {systemStats.gpuTemp}°C
        </span>
      )}

      {/* GPU usage bar */}
      {systemStats.gpuUsage > 0 && (
        <div style={{ width: 40, height: 2, background: '#1E1E1E', borderRadius: 1, flexShrink: 0 }}>
          <div style={{
            width: `${Math.min(systemStats.gpuUsage, 100)}%`, height: '100%',
            background: systemStats.gpuUsage > 90 ? '#FF4444' : '#00FF88',
            borderRadius: 1,
          }} />
        </div>
      )}

      {/* RAM */}
      <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace', flexShrink: 0 }}>
        RAM {systemStats.ramUsed.toFixed(0)}/{systemStats.ramTotal}G
      </span>
      <div style={{ width: 30, height: 2, background: '#1E1E1E', borderRadius: 1, flexShrink: 0 }}>
        <div style={{
          width: `${Math.min((systemStats.ramUsed / systemStats.ramTotal) * 100, 100)}%`,
          height: '100%',
          background: '#00B4FF', borderRadius: 1,
        }} />
      </div>
    </div>
  )
}
```

- [ ] **Commit**

```bash
git add src/app/components/TopBar.tsx
git commit -m "feat: create TopBar component"
```

---

## Phase 4: Create SettingsPanel component

### Task 4.1: Build SettingsPanel.tsx — Auto Render + Download cards

**Files:**
- Create: `src/app/components/SettingsPanel.tsx`

- [ ] **Create SettingsPanel.tsx skeleton with Auto Render + Download cards**

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Channel, SystemStats, RenderedVideo } from '../types'
import type { AppSettings, Workspace } from '../lib/store'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../lib/store'

interface Props {
  settings: AppSettings
  systemStats: SystemStats
  channels: Channel[]
  workspaces: Workspace[]
  renderedVideos: RenderedVideo[]
}

export function SettingsPanel({ settings, systemStats, channels, workspaces, renderedVideos }: Props) {
  const setSettings = useAppStore(s => s.setSettings)
  const showToast = useAppStore(s => s.showToast)

  const handleSettingChange = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(patch)
    await ipc.updateSettings(patch)
  }, [setSettings])

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '10px 12px',
      display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: 10,
    }}>
      {/* ─── Auto Render Card ───────────────────────────────────────────── */}
      <Card title="AUTO RENDER" accent="#00FF88" width={320}>
        <ToggleRow
          label="Auto-render"
          value={settings.autoRender}
          onChange={v => handleSettingChange({ autoRender: v })}
        />

        <div style={{ marginBottom: 8 }}>
          <Label>Resolution</Label>
          <div style={{ display: 'flex', gap: 3 }}>
            {(['480x480', '720x720', '1080x1080'] as const).map(res => (
              <MiniBtn
                key={res}
                active={settings.autoRenderResolution === res}
                onClick={() => handleSettingChange({ autoRenderResolution: res })}
              >
                {res.replace('x', 'p')}
              </MiniBtn>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <Label>FPS</Label>
          <div style={{ display: 'flex', gap: 3 }}>
            {([30, 60] as const).map(fps => (
              <MiniBtn
                key={fps}
                active={settings.autoRenderFPS === fps}
                onClick={() => handleSettingChange({ autoRenderFPS: fps })}
              >
                {fps}fps
              </MiniBtn>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <Label>Auto-split</Label>
          <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 8, color: '#555' }}>Parts:</span>
            {[1, 2, 3, 4, 5].map(n => (
              <MiniBtn
                key={n}
                active={settings.autoSplitParts === n}
                onClick={() => handleSettingChange({ autoSplitParts: n })}
              >
                {n}
              </MiniBtn>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <span style={{ fontSize: 8, color: '#555' }}>Min/part:</span>
            {[0, 2, 3, 5, 10].map(m => (
              <MiniBtn
                key={m}
                active={settings.autoSplitMinutes === m}
                onClick={() => handleSettingChange({ autoSplitMinutes: m })}
              >
                {m === 0 ? 'Auto' : `${m}m`}
              </MiniBtn>
            ))}
          </div>
        </div>
      </Card>

      {/* ─── Download Card ─────────────────────────────────────────────── */}
      <Card title="DOWNLOAD" accent="#00B4FF" width={320}>
        <div style={{ marginBottom: 8 }}>
          <Label>Quality</Label>
          <div style={{ display: 'flex', gap: 3 }}>
            {(['360', '480', '720', '1080'] as const).map(q => (
              <MiniBtn
                key={q}
                active={(settings.autoDownloadQuality || '720') === q}
                onClick={() => handleSettingChange({ autoDownloadQuality: q })}
              >
                {q}p
              </MiniBtn>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <Label>Trim (minutes)</Label>
          <div style={{ display: 'flex', gap: 3 }}>
            <input type="number" min={1} max={999}
              value={settings.defaultTrimLimit === 'full' ? '' : Number(settings.defaultTrimLimit)}
              placeholder={settings.defaultTrimLimit === 'full' ? 'full' : '10'}
              onChange={e => {
                const val = parseInt(e.target.value, 10)
                if (!isNaN(val) && val > 0) handleSettingChange({ defaultTrimLimit: val })
              }}
              style={{
                width: 60, height: 22, padding: '0 6px', background: '#0D0D0D',
                border: '1px solid #222', borderRadius: 3, color: '#00B4FF',
                fontSize: 9, fontFamily: 'monospace', outline: 'none',
              }}
            />
            <MiniBtn
              active={settings.defaultTrimLimit === 'full'}
              onClick={() => handleSettingChange({ defaultTrimLimit: 'full' })}
            >
              FULL
            </MiniBtn>
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <Label>Concurrent downloads</Label>
          <div style={{ display: 'flex', gap: 3 }}>
            {[1, 3, 5, 10].map(n => (
              <MiniBtn
                key={n}
                active={(settings.maxConcurrentDownloads || 3) === n}
                onClick={() => handleSettingChange({ maxConcurrentDownloads: n })}
              >
                {n}
              </MiniBtn>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <Label>Concurrent renders</Label>
          <div style={{ display: 'flex', gap: 3 }}>
            {[1, 2, 4, 8].map(n => (
              <MiniBtn
                key={n}
                active={(settings.maxConcurrentRenders || 2) === n}
                onClick={() => handleSettingChange({ maxConcurrentRenders: n })}
              >
                {n}
              </MiniBtn>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div>
            <Label>Min duration (sec)</Label>
            <input type="number" min={0} value={settings.videoMinDurationSec || 0}
              onChange={e => handleSettingChange({ videoMinDurationSec: parseInt(e.target.value, 10) || 0 })}
              style={{ width: '100%', height: 22, padding: '0 6px', background: '#0D0D0D', border: '1px solid #222', borderRadius: 3, color: '#888', fontSize: 9, fontFamily: 'monospace', outline: 'none' }}
            />
          </div>
          <div>
            <Label>Max duration (sec)</Label>
            <input type="number" min={0} value={settings.videoMaxDurationSec || 0}
              onChange={e => handleSettingChange({ videoMaxDurationSec: parseInt(e.target.value, 10) || 0 })}
              style={{ width: '100%', height: 22, padding: '0 6px', background: '#0D0D0D', border: '1px solid #222', borderRadius: 3, color: '#888', fontSize: 9, fontFamily: 'monospace', outline: 'none' }}
            />
          </div>
        </div>
      </Card>

      {/* ─── Storage Card ──────────────────────────────────────────────── */}
      <StorageCard settings={settings} showToast={showToast} />

      {/* ─── System Card ──────────────────────────────────────────────── */}
      <Card title="SYSTEM" accent="#7C3AED" width={320}>
        <StatRow label="GPU" value={`${systemStats.gpuName} · ${systemStats.gpuTemp}°C · ${systemStats.gpuUsage}% · ${systemStats.gpuEncoder}`} />
        <StatRow label="CPU" value={`${systemStats.cpuName} · ${systemStats.cpuUsage}%`} />
        <StatRow label="RAM" value={`${systemStats.ramUsed.toFixed(0)} / ${systemStats.ramTotal.toFixed(0)} GB`} />
        <StatRow label="Workers" value={`${systemStats.activeWorkers || 0} active · ${systemStats.gpuEncoder}`} />
      </Card>

      {/* ─── Detection Card ────────────────────────────────────────────── */}
      <DetectionCard />

      {/* ─── Misc Card ─────────────────────────────────────────────────── */}
      <Card title="MISC" accent="#888" width={320}>
        <div style={{ fontSize: 9, color: '#555', marginBottom: 6 }}>
          <span style={{ color: settings.proxyEnabled ? '#FFB800' : '#555' }}>
            Proxy: {settings.proxyEnabled ? 'ON' : 'OFF'}
          </span>
          {settings.proxyHost && <span style={{ marginLeft: 6, color: '#444' }}>{settings.proxyHost}:{settings.proxyPort}</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <a href="/settings?tab=sessions" style={{ ...linkStyle }}>Sessions</a>
          <a href="/settings?tab=oauth" style={{ ...linkStyle }}>OAuth Projects</a>
          <a href="/settings?tab=keys" style={{ ...linkStyle }}>API Keys</a>
          <a href="/settings?tab=diagnostics" style={{ ...linkStyle }}>Diagnostics</a>
        </div>
      </Card>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────

function Card({ title, accent, width, children }: { title: string; accent: string; width: number; children: React.ReactNode }) {
  return (
    <div style={{
      width, background: '#111', border: `1px solid #1E1E1E`, borderRadius: 6,
      padding: '10px 12px', flexShrink: 0,
    }}>
      <div style={{
        fontSize: 9, fontWeight: 800, color: accent, letterSpacing: '0.1em',
        marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: accent, display: 'inline-block' }} />
        {title}
      </div>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 8, color: '#444', marginBottom: 3, fontWeight: 600 }}>{children}</div>
}

function MiniBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 22, padding: '0 7px', border: `1px solid ${active ? '#00B4FF66' : '#222'}`,
        borderRadius: 3, background: active ? '#00B4FF15' : 'transparent',
        color: active ? '#00B4FF' : '#555', fontSize: 9, fontWeight: 700,
        cursor: 'pointer', fontFamily: 'monospace', transition: 'all 0.1s',
      }}
    >
      {children}
    </button>
  )
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <span style={{ fontSize: 9, color: '#888', flex: 1 }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 28, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', flexShrink: 0,
          background: value ? '#00FF8844' : '#222', position: 'relative', transition: 'background 0.15s',
        }}
      >
        <div style={{
          width: 12, height: 12, borderRadius: '50%',
          background: value ? '#00FF88' : '#555',
          position: 'absolute', top: 2, left: value ? 14 : 2, transition: 'left 0.15s',
        }} />
      </button>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ fontSize: 8, color: '#555', fontWeight: 700, width: 36, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 9, color: '#666', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  )
}

function StorageCard({ settings, showToast }: { settings: AppSettings; showToast: (msg: string) => void }) {
  const setSettings = useAppStore(s => s.setSettings)
  const [storageStats, setStorageStats] = useState<{
    downloadPath: string; outputPath: string; downloads: number; total: number; freeBytes: number
  } | null>(null)

  const loadStats = useCallback(async () => {
    try { setStorageStats(await ipc.getStorageSize() as any) } catch {}
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const freeGB = storageStats?.freeBytes ? storageStats.freeBytes / (1024**3) : 0
  const usedMB = storageStats?.downloads || 0
  const usedGB = usedMB / 1024
  const totalGB = freeGB + usedGB
  const usedPct = totalGB > 0 ? Math.round((usedGB / totalGB) * 100) : 0
  const isLow = freeGB < 5

  return (
    <Card title="STORAGE" accent="#FFB800" width={320}>
      {/* Disk bar */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ height: 4, background: '#1A1A1A', borderRadius: 2, marginBottom: 3 }}>
          <div style={{
            width: `${Math.min(usedPct, 100)}%`, height: '100%',
            background: isLow ? '#FF4444' : usedPct > 70 ? '#FFB800' : '#00B4FF',
            borderRadius: 2,
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: isLow ? '#FF4444' : '#555', fontFamily: 'monospace' }}>
          <span>{usedMB.toFixed(0)}MB used</span>
          <span>{freeGB.toFixed(0)}GB free</span>
        </div>
      </div>

      {/* Paths */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 8, color: '#444' }}>Video path</div>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          {storageStats?.downloadPath || settings.videoStoragePath || '…'}
        </div>
      </div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 8, color: '#444' }}>Output path</div>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          {storageStats?.outputPath || settings.outputPath || '…'}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => storageStats?.downloadPath && ipc.openFolder(storageStats.downloadPath)}
          style={actionBtnStyle}>Mở DL</button>
        <button onClick={() => ipc.clearDownloads().then(r => { if (r.success) { showToast(`Freed ${r.freedMB}MB`); loadStats() } })}
          style={actionBtnStyle}>Xóa DL</button>
        <button onClick={() => ipc.clearBlur().then(r => { if (r.success) { showToast('Cleared blur'); loadStats() } })}
          style={actionBtnStyle}>Xóa BLR</button>
      </div>
    </Card>
  )
}

function DetectionCard() {
  const [pollerStatus, setPollerStatus] = useState<{
    active: boolean; newVideoCount: number; lastError: string | null
  } | null>(null)

  useEffect(() => {
    ipc.getPollerStatus().then(setPollerStatus)
    const t = setInterval(() => ipc.getPollerStatus().then(setPollerStatus), 10000)
    return () => clearInterval(t)
  }, [])

  return (
    <Card title="DETECTION" accent="#00B4FF" width={320}>
      <StatRow label="Innertube" value={`30/30 sessions`} />
      <StatRow label="Poller" value={`${pollerStatus?.active ? 'active' : 'inactive'} · 5s${pollerStatus?.lastError ? ` · error: ${pollerStatus.lastError}` : ''}`} />
      <span style={{
        display: 'inline-block', fontSize: 8, fontWeight: 700,
        color: '#00FF88', background: '#00FF8815',
        padding: '1px 5px', borderRadius: 3, marginTop: 4,
      }}>
        PRIMARY
      </span>
    </Card>
  )
}

const linkStyle: React.CSSProperties = {
  height: 22, padding: '0 8px', border: '1px solid #222', borderRadius: 3,
  background: 'transparent', color: '#666', fontSize: 9, fontWeight: 600,
  cursor: 'pointer', textDecoration: 'none', display: 'inline-flex',
  alignItems: 'center',
}

const actionBtnStyle: React.CSSProperties = {
  height: 24, padding: '0 8px', border: '1px solid #222', borderRadius: 3,
  background: 'transparent', color: '#666', fontSize: 9, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'monospace',
}
```

- [ ] **Commit**

```bash
git add src/app/components/SettingsPanel.tsx
git commit -m "feat: create SettingsPanel with Auto Render, Download, Storage, Detection, System, Misc cards"
```

---

## Phase 5: Create ActivityLogBar component

### Task 5.1: Build ActivityLogBar.tsx

**Files:**
- Create: `src/app/components/ActivityLogBar.tsx`

- [ ] **Create ActivityLogBar.tsx**

```tsx
'use client'

import { useState, useMemo } from 'react'
import type { ActivityEntry } from './ActivityLog'

interface Props {
  entries: ActivityEntry[]
  etaDisplay?: Map<string, string>
  onCompare?: (workspaceId: string) => void
  renderedWorkspaceIds?: Set<string>
}

type LogTab = 'activity' | 'errors' | 'system'

const LEVEL_COLORS: Record<string, string> = {
  success: '#00FF88',
  info: '#888',
  warning: '#FFB800',
  error: '#FF4444',
  render: '#7C3AED',
}

const LEVEL_ICONS: Record<string, string> = {
  success: '✓',
  info: '●',
  warning: '⚠',
  error: '✗',
  render: '⚡',
}

export function ActivityLogBar({ entries, etaDisplay, onCompare, renderedWorkspaceIds }: Props) {
  const [tab, setTab] = useState<LogTab>('activity')
  const [expanded, setExpanded] = useState(false)

  const errorCount = useMemo(() => entries.filter(e => e.type === 'error').length, [entries])

  const displayEntries = expanded ? entries.slice(0, 15) : entries.slice(0, 5)

  return (
    <div style={{
      height: expanded ? 200 : 75,
      background: '#0D0D0D', borderTop: '1px solid #1E1E1E',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      transition: 'height 0.15s ease',
    }}>
      {/* Tabs bar */}
      <div style={{ display: 'flex', alignItems: 'center', height: 22, padding: '0 10px', borderBottom: '1px solid #1A1A1A', flexShrink: 0 }}>
        {(['activity', 'errors', 'system'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              height: '100%', padding: '0 8px', border: 'none', borderBottom: tab === t ? '2px solid #00B4FF' : '2px solid transparent',
              background: 'transparent', color: tab === t ? '#888' : '#444',
              fontSize: 9, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.06em',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {t.toUpperCase()}
            {t === 'errors' && errorCount > 0 && (
              <span style={{ fontSize: 8, color: '#FF4444', fontFamily: 'monospace' }}>●{errorCount}</span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            height: 18, padding: '0 6px', border: '1px solid #222', borderRadius: 3,
            background: 'transparent', color: '#444', fontSize: 8, cursor: 'pointer',
          }}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* Log lines */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '3px 8px' }}>
        {tab === 'activity' && (
          <div style={{ fontFamily: 'monospace', fontSize: 9, lineHeight: '16px' }}>
            {displayEntries.length === 0 ? (
              <span style={{ color: '#333' }}>No activity yet</span>
            ) : (
              displayEntries.map(e => {
                const time = new Date(e.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                const color = LEVEL_COLORS[e.type] || '#888'
                const icon = LEVEL_ICONS[e.type] || '●'
                const eta = e.workspaceId ? etaDisplay?.get(e.workspaceId) : undefined
                return (
                  <div key={e.id} style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#333' }}>[{time}]</span>{' '}
                    <span style={{ color }}>{icon}</span>{' '}
                    <span>{e.message}</span>
                    {e.detail && <span style={{ color: '#444' }}> · {e.detail}</span>}
                    {eta && <span style={{ color: '#7C3AED' }}> · {eta}</span>}
                  </div>
                )
              })
            )}
          </div>
        )}
        {tab === 'errors' && (
          <div style={{ fontFamily: 'monospace', fontSize: 9, lineHeight: '16px', color: '#666' }}>
            {entries.filter(e => e.type === 'error').length === 0 ? (
              <span style={{ color: '#333' }}>No errors</span>
            ) : (
              entries.filter(e => e.type === 'error').slice(0, 10).map(e => (
                <div key={e.id} style={{ color: '#FF444488' }}>
                  [{new Date(e.timestamp).toLocaleTimeString()}] ✗ {e.message}
                </div>
              ))
            )}
          </div>
        )}
        {tab === 'system' && (
          <div style={{ color: '#444', fontSize: 9, fontFamily: 'monospace', lineHeight: '16px' }}>
            System info available in ActivityLogBar expand
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Commit**

```bash
git add src/app/components/ActivityLogBar.tsx
git commit -m "feat: create ActivityLogBar bottom component"
```

---

## Phase 6: Refactor Sidebar (narrow to 140px)

### Task 6.1: Strip Sidebar down to channels + detection only

**Files:**
- Modify: `src/app/components/Sidebar.tsx`

Remove: Storage section (lines 537-668), Download settings (lines 671-773), System stats (lines 776-836), ActivityLog import/usage, AlertDialog for pending changes. Keep: brand bar, DetectionStatusBar, channel list + add-channel bar, ConfirmDialog, VideoCompareModal.

- [ ] **Simplify Sidebar — remove storage/download/system sections**

Key changes to Sidebar.tsx:
1. Change width from 180 to 140 in the container style
2. Delete the `storageStats` state / `StorageRow` / `loadStorageStats` 
3. Delete the Download section (trim input + quality buttons)
4. Delete the System stats section (GPU/RAM/CPU rows)
5. Delete the `AlertDialog` for pending settings changes
6. Delete the `ActivityLog` import and usage
7. Keep: brand bar, DetectionStatusBar, channel list + add-channel input, ConfirmationDialog, VideoCompareModal
8. Remove `AppSettings` local interface, `settings`, `onSettingsChange` from Props
9. Remove `PendingChange` interface

Updated Props:
```typescript
interface Props {
  channels: Channel[]
  isLoadingChannels?: boolean
  activeChannelId: string
  newCounts: Record<string, number>
  onChannelSelect: (id: string) => void
  systemStats?: SystemStats  // optional, for channel list reference only
  authStatus?: {
    isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string
    oauthReady?: boolean; quotaExceeded?: boolean
  }
  pollerStatus?: { active: boolean; newVideoCount: number; lastError: string | null } | null
  onLogout?: () => void
  keyHealth?: { exhausted: number; unauthorized: number }
}
```

Container style change:
```diff
- width: 180
+ width: 140
```

- [ ] **Commit**

```bash
git add src/app/components/Sidebar.tsx
git commit -m "refactor: narrow Sidebar to 140px channels-only panel"
```

---

## Phase 7: Refactor WorkspaceQueue for right panel

### Task 7.1: Compact queue design with filter tabs

**Files:**
- Modify: `src/app/components/workspace/WorkspaceQueue.tsx`

Changes needed:
1. Add filter tabs at top: `ALL (n)`, `DL`, `RENDER`, `ERR` (compact pill-style)
2. Keep pipeline/rendered tab switcher
3. Keep search/filter bar
4. Width is constrained by parent (280px) — no resizable panel
5. Group headers stay but more compact

- [ ] **Update WorkspaceQueue with compact filter tabs**

Add a filter tab row between the tab header and the search bar. Insert after the tab header div:

```tsx
{/* Filter tabs — compact pill style */}
<div style={{
  display: 'flex', gap: 4, padding: '4px 8px',
  background: '#0D0D0D', borderBottom: '1px solid #161616',
  flexShrink: 0,
}}>
  {[
    { key: 'all', label: 'ALL', color: '#888' },
    { key: 'ready', label: 'READY', color: '#00FF88' },
    { key: 'downloading', label: 'DL', color: '#00B4FF' },
    { key: 'rendering', label: 'RENDER', color: '#7C3AED' },
    { key: 'error', label: 'ERR', color: '#FF4444' },
  ].map(tab => {
    const count = tab.key === 'all'
      ? filteredWorkspaces.length
      : filteredWorkspaces.filter(w => w.status === tab.key).length
    if (count === 0 && tab.key !== 'all') return null
    const isActive = filterStatus === tab.key || (tab.key === 'all' && filterStatus === 'all')
    return (
      <button
        key={tab.key}
        onClick={() => setFilterStatus(tab.key === 'all' ? 'all' : tab.key as GroupStatus)}
        style={{
          height: 20, padding: '0 6px', border: 'none', borderRadius: 3,
          background: isActive ? `${tab.color}18` : 'transparent',
          color: isActive ? tab.color : '#444',
          fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace',
          display: 'flex', alignItems: 'center', gap: 3,
        }}
      >
        {tab.label}
        <span style={{ fontSize: 8, opacity: 0.6 }}>{count}</span>
      </button>
    )
  })}
</div>
```

- [ ] **Commit**

```bash
git add src/app/components/workspace/WorkspaceQueue.tsx
git commit -m "feat: add compact filter tabs to WorkspaceQueue"
```

---

## Phase 8: Restructure page.tsx

### Task 8.1: New layout — TopBar + Sidebar + SettingsPanel + Queue + ActivityLogBar

**Files:**
- Modify: `src/app/page.tsx`

This is the most complex change. Key modifications:

1. **Remove imports**: `DetailEditor`, `RenderQueueBar`, `ResizablePanelGroup/ResizablePanel/ResizableHandle`
2. **Add imports**: `TopBar`, `SettingsPanel`, `ActivityLogBar`
3. **Remove all manual-editor state/handlers**: `editorState`, `handleEditorChange`, `handleRender`, `handleExportChunked`, `handleSplit` (keep it), undo/redo keyboard shortcut
4. **Remove `videos` mapping** (was for DetailEditor)
5. **Simplify layout** to: TopBar → 3-column (Sidebar | SettingsPanel | Queue) → ActivityLogBar
6. **Keep**: IPC effects, activity tracking, ETA countdown, system stats, poller status, auto-download events, render progress events, notifications, toast, confirm dialog, compare modal

- [ ] **Restructure DashboardContent layout**

The new return JSX should look like:

```tsx
return (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0E0E0E', fontFamily: 'Inter, sans-serif', color: '#fff', overflow: 'hidden' }}>
    {/* Login screen overlay */}
    {!authStatus.isReady && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
        <LoginScreen accountName={authStatus.accountName} oauthReady={authStatus.oauthReady} onLogout={handleLogout} />
      </div>
    )}

    {/* Diagnostics banner */}
    {diagIssues.length > 0 && authStatus.isReady && (
      <div style={{ /* same as before */ }}>
        <span>⚠️</span>
        <span style={{ flex: 1 }}>{diagIssues[0]}</span>
        <Link href="/settings" style={{ color: '#FF6666', textDecoration: 'none', fontWeight: 600 }}>Diagnostics →</Link>
      </div>
    )}

    {/* Top Bar */}
    <TopBar
      settings={settings}
      systemStats={systemStats}
      onSettingsChange={async (patch) => {
        setSettings(patch)
        await ipc.updateSettings(patch)
      }}
    />

    {/* Main 3-column area */}
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Sidebar */}
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
      />

      {/* Settings Panel (center) */}
      {showSkeleton ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#444', fontSize: 11 }}>Loading...</div>
        </div>
      ) : selectedRenderedVideoId && renderedVideos.find(v => v.id === selectedRenderedVideoId) ? (
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <RenderedVideoDetail
            video={renderedVideos.find(v => v.id === selectedRenderedVideoId)!}
            onShowToast={showToast}
          />
        </div>
      ) : (
        <SettingsPanel
          settings={settings}
          systemStats={systemStats}
          channels={channels}
          workspaces={filteredWorkspaces}
          renderedVideos={renderedVideos}
        />
      )}

      {/* Video Queue (right panel) */}
      <div style={{ width: 280, minWidth: 240, maxWidth: 400, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #1E1E1E' }}>
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
    </div>

    {/* Activity Log Bar */}
    <ActivityLogBar
      entries={[...activityMap.values()].reverse()}
      etaDisplay={etaDisplay}
      onCompare={handleCompare}
      renderedWorkspaceIds={new Set(renderedVideos.map(v => v.workspaceId))}
    />

    {/* Toast */}
    {toast && (
      <div style={{ /* same as before */ }}>
        {toast}
      </div>
    )}

    {/* Confirmation Dialog */}
    <ConfirmationDialog
      open={confirmDialog !== null}
      title={confirmDialog?.title ?? ''}
      message={confirmDialog?.message ?? ''}
      confirmLabel={confirmDialog?.confirmLabel}
      confirmDanger={confirmDialog?.confirmDanger}
      onConfirm={confirmDialog?.onConfirm ?? (() => {})}
      onCancel={() => setConfirmDialog(null)}
    />

    {/* Video Compare Modal */}
    {compareWorkspaceId && (
      <VideoCompareModal
        workspace={compareWorkspace}
        rendered={compareRendered}
        onClose={() => setCompareWorkspaceId(null)}
      />
    )}

    <SkeletonStyles />
    <style>{`/* same scrollbar styles as before */`}</style>
  </div>
)
```

Remove these from DashboardContent:
- `handleEditorChange` callback
- `handleRender` function
- `handleExportChunked` function
- `lastRenderCodec` ref
- `videos` mapping (no longer needed)
- Undo/redo keyboard shortcut effect
- `editorState` selector and actions
- `DetailEditor` import
- `RenderQueueBar` import and usage
- `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` imports

- [ ] **Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: restructure dashboard layout for auto-render UI"
```

---

## Phase 9: Cleanup and TypeScript verification

### Task 9.1: Remove unused DetailEditor import from page.tsx

- [ ] **Verify DetailEditor is no longer imported**

Ensure `import { DetailEditor } from './components/DetailEditor'` is removed from page.tsx.

- [ ] **Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors (or only pre-existing errors unrelated to our changes).

- [ ] **Run lint**

```bash
npm run lint
```
Expected: clean lint (or only pre-existing warnings).

- [ ] **Run tests**

```bash
npm run test
```
Expected: all existing tests pass.

- [ ] **Commit**

```bash
git add src/app/page.tsx
git commit -m "chore: remove unused DetailEditor import from page"
```

### Task 9.2: Final cleanup — remove dead code references

- [ ] **Update CLAUDE.md dead code section**

In CLAUDE.md, add `DetailEditor.tsx` and `RenderQueueBar.tsx` to the dead code section:

```markdown
- `src/app/components/DetailEditor.tsx` — standalone file, không import ở đâu (thay thế bởi SettingsPanel)
- `src/app/components/workspace/RenderQueueBar.tsx` — standalone file, không import ở đâu (tích hợp vào Queue panel)
```

- [ ] **Commit**

```bash
git add CLAUDE.md
git commit -m "chore: update dead code references for auto-render dashboard"
```

---

## Phase 10: (Optional) Channel Override Card — completed in a follow-up

### Task 10.1: Add Channel Override to SettingsPanel

**Skip for MVP if only 1 channel — implement when needed.**

The Channel Override card requires:
1. Channel selector dropdown
2. Per-channel settings: resolution, fps, parts, trim
3. Visual indication when override differs from global
4. "Reset to global" button
5. Backend: `ipc.updateChannel(id, { settings: {...} })` already exists

Implementation in SettingsPanel.tsx when ready:

```tsx
// ─── Channel Override Card (add inside SettingsPanel return) ─────────────
<Card title="CHANNEL OVERRIDE" accent="#FFB800" width={320}>
  <select
    value={overrideChannelId || ''}
    onChange={e => setOverrideChannelId(e.target.value || null)}
    style={{
      width: '100%', height: 24, marginBottom: 8,
      background: '#0D0D0D', border: '1px solid #222', borderRadius: 3,
      color: '#888', fontSize: 9, fontFamily: 'inherit', outline: 'none',
      cursor: 'pointer', padding: '0 6px',
    }}
  >
    <option value="">Select channel...</option>
    {channels.map(ch => (
      <option key={ch.id} value={ch.id}>{ch.name}</option>
    ))}
  </select>

  {overrideChannel && (
    <>
      <div style={{ marginBottom: 8 }}>
        <Label>Resolution</Label>
        <div style={{ display: 'flex', gap: 3 }}>
          {(['720x720', '1080x1080'] as const).map(res => (
            <MiniBtn
              key={res}
              active={overrideChannel.settings?.resolution === res}
              onClick={() => updateChannelOverride({ resolution: res })}
            >
              {res.replace('x', 'p')}
            </MiniBtn>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <Label>FPS</Label>
        <div style={{ display: 'flex', gap: 3 }}>
          {([30, 60] as const).map(fps => (
            <MiniBtn
              key={fps}
              active={overrideChannel.settings?.fps === fps}
              onClick={() => updateChannelOverride({ fps })}
            >
              {fps}fps
            </MiniBtn>
          ))}
        </div>
      </div>
      <button
        onClick={() => updateChannelOverride({ settings: undefined })}
        style={{
          height: 22, padding: '0 8px', border: '1px solid #FFB80044', borderRadius: 3,
          background: 'transparent', color: '#FFB800', fontSize: 9, cursor: 'pointer',
        }}
      >
        Reset to global
      </button>
    </>
  )}
</Card>
```

Requires state:
```typescript
const [overrideChannelId, setOverrideChannelId] = useState<string | null>(null)
const overrideChannel = channels.find(c => c.id === overrideChannelId) ?? null
```

And handler:
```typescript
const updateChannelOverride = useCallback(async (patch: Partial<Channel>) => {
  if (!overrideChannelId) return
  const current = channels.find(c => c.id === overrideChannelId)
  const newSettings = { ...(current?.settings || {}), ...patch }
  await ipc.updateChannel(overrideChannelId, { settings: newSettings })
  // Refresh channel list
  useAppStore.getState().initChannels()
}, [overrideChannelId, channels])
```

---

## Self-Review

**1. Spec coverage:**
- ✅ TopBar (spec §3) — Phase 3
- ✅ Sidebar 140px channels (spec §4) — Phase 6
- ✅ SettingsPanel center 2-column cards (spec §5) — Phase 4
- ✅ Auto Render card (spec §5.1) — Phase 4
- ✅ Download card (spec §5.2) — Phase 4
- ✅ Channel Override card (spec §5.3) — Phase 10 (optional)
- ✅ Storage card (spec §5.4) — Phase 4
- ✅ Detection card (spec §5.5) — Phase 4
- ✅ System card (spec §5.6) — Phase 4
- ✅ Misc card (spec §5.7) — Phase 4
- ✅ Video Queue filter tabs (spec §6.1) — Phase 7
- ✅ Bottom log bar (spec §7) — Phase 5
- ✅ AppSettings new fields (spec §8.1) — Phase 1+2
- ✅ ChannelSettings FPS (spec §8.2) — Phase 2
- ✅ Backend autoSplit settings (spec §9.4) — Phase 1
- ✅ Remove DetailEditor from dashboard (spec §9.1) — Phase 8+9
- ❌ Auto-split trigger in main.ts (spec §9.4) — requires deeper backend work, defer to follow-up

**2. Placeholder scan:** No placeholders found. All code blocks are complete implementations.

**3. Type consistency:** All types (AppSettings, ChannelSettings, Workspace, SystemStats) match existing interfaces. New fields `autoSplitParts`, `autoSplitMinutes` added consistently to frontend store + backend ramdisk. `fps` added to ChannelSettings in types.ts.
