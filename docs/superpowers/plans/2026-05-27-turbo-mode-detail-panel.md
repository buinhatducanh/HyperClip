# Turbo Mode + Video Detail Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Max-out RTX 5080 performance with Ultra preset tuning, zero-latency downloads, and a Video Detail Panel with per-video performance metrics.

**Architecture:** Three independent layers: (1) backend preset values + parallel settings in `system.ts`/`worker-pool.ts`/`ffmpeg.ts`, (2) metrics collection in `main.ts` download/render pipeline, (3) new `VideoDetailPanel.tsx` frontend component displayed in right panel on video click.

**Tech Stack:** Electron/Node.js (backend), Next.js/React/Zustand/Tailwind (frontend), FFmpeg NVENC (encode)

---

## File Structure

### Modified files:
- `electron/services/system.ts` — Ultra preset tune (PRESETS, getDownloadParams, getEffectiveWorkers)
- `electron/services/worker-pool.ts` — Remove cap on chunk workers
- `electron/services/ffmpeg.ts` — Auto-render audio codec = libopus, NVENC preset = p1+ull
- `electron/main.ts` — Zero-latency download + metrics collection in download + render pipeline
- `src/app/lib/store.ts` — Add WorkspaceMetrics type, metrics field on Workspace
- `src/app/types.ts` — Export WorkspaceMetrics
- `src/app/page.tsx` — Layout condition: right panel = VideoDetailPanel or SettingsPanel

### Created files:
- `src/app/components/VideoDetailPanel.tsx` — New right-panel component with metrics display

---

### Task 1: Ultra preset tune in system.ts

**Files:**
- Modify: `electron/services/system.ts` (PRESETS table, getDownloadParams, getEffectiveWorkers)

- [ ] **Step 1: Update Ultra preset values**

Find the `PRESETS` array and change the `ultra` entry:

```typescript
const PRESETS: PresetDef[] = [
  { id: 'ultra',   label: 'Ultra',   vramGB: 16, ramGB: 64, downloadInstances: 6, renderWorkers: 6, chunkWorkers: 14, sessions: 10 },
  { id: 'high',   label: 'High',     vramGB: 12, ramGB: 48, downloadInstances: 2, renderWorkers: 3, chunkWorkers: 6,  sessions: 8  },
  { id: 'medium', label: 'Medium',   vramGB: 8,  ramGB: 32, downloadInstances: 2, renderWorkers: 2, chunkWorkers: 4,  sessions: 6  },
  { id: 'low',    label: 'Low',      vramGB: 6,  ramGB: 24, downloadInstances: 1, renderWorkers: 2, chunkWorkers: 2,  sessions: 4  },
  { id: 'minimal',label: 'Minimal',  vramGB: 4,  ramGB: 16, downloadInstances: 1, renderWorkers: 1, chunkWorkers: 1,  sessions: 2  },
]
```

- [ ] **Step 2: Update getDownloadParams for Ultra**

Find `getDownloadParams()`. Add `fragments: 64, maxInstances: 6` for the ultra case (already handled via preset lookup, but ensure the fallback auto-detect also scales):

```typescript
export function getDownloadParams(): DownloadParams {
  const profile = loadSettings().hardwareProfile
  if (profile) {
    const preset = PRESETS.find(p => p.vramGB === profile.vramGB && p.ramGB === profile.ramGB)
    if (preset) {
      return { fragments: Math.max(16, preset.chunkWorkers * 8), maxInstances: preset.downloadInstances }
    }
  }
  if (_cachedDownloadParams) return _cachedDownloadParams
  // ... existing high/mid/low code unchanged
}
```

- [ ] **Step 3: Update getEffectiveWorkers for Ultra**

Find `getEffectiveWorkers()`. Ensure the preset path works (it already reads `loadSettings().hardwareProfile` and uses the preset. No code change needed, but verify the preset lookup handles `chunkWorkers: 14` correctly — `getChunkPool()` in worker-pool.ts is the consumer.

- [ ] **Step 4: Adjust detectSystemProfile for Ultra**

Find `detectSystemProfile()`. Add Ultra-aware session count:

```typescript
export function detectSystemProfile(): { isLaptop: boolean; sessionCount: number } {
  if (_cachedSessionCount !== null) return { isLaptop: _cachedSessionCount === 15, sessionCount: _cachedSessionCount }

  // Check hardware preset first
  const settings = loadSettings()
  if (settings.hardwareProfile) {
    const preset = PRESETS.find(p => p.vramGB === settings.hardwareProfile!.vramGB && p.ramGB === settings.hardwareProfile!.ramGB)
    if (preset) {
      _cachedSessionCount = preset.sessions
      devLog(`[SystemProfile] Using preset sessions=${preset.sessions} (${preset.label})`)
      return { isLaptop: false, sessionCount: _cachedSessionCount }
    }
  }

  // Env override
  const envCount = parseInt(process.env.HYPERCLIP_SESSION_COUNT || '', 10)
  if (!isNaN(envCount) && envCount > 0) {
    // ... rest unchanged
```

- [ ] **Step 5: Commit**

```bash
git add electron/services/system.ts
git commit -m "perf: ultra preset tune for RTX 5080 — 14 workers, 6 download instances, 10 sessions"
```

---

### Task 2: Uncap chunk workers in worker-pool.ts

**Files:**
- Modify: `electron/services/worker-pool.ts` (getChunkPool)

- [ ] **Step 1: Remove the cap on chunk workers**

Find `getChunkPool()` around line 174-184. Change:

```typescript
const effective = envOverride ? envMax : Math.min(getEffectiveWorkers(), 4) // cap at 4 max
```

To:

```typescript
const effective = envOverride ? envMax : getEffectiveWorkers()
```

This allows 14 chunk workers on RTX 5080 with Ultra preset.

- [ ] **Step 2: Commit**

```bash
git add electron/services/worker-pool.ts
git commit -m "perf: remove chunk worker cap — RTX 5080 can handle 14 concurrent chunk encodes"
```

---

### Task 3: Auto-render audio codec + NVENC preset tune in ffmpeg.ts

**Files:**
- Modify: `electron/services/ffmpeg.ts` (renderVideo, getNvencParams)

- [ ] **Step 1: Set auto-render default audio codec to libopus when using GPU**

Find `renderVideo()` around line 1142, the `audioCodec` extraction. Change default from `'aac'` to check if high tier:

```typescript
const autoCodec = (gpuTier === 'high' && metadata.audioCodec === undefined) ? 'libopus' : (metadata.audioCodec || 'aac')
// ... use autoCodec in the args construction further down
```

Find the args construction around line 1301-1307:

```typescript
// Change:
'-c:a', audioCodec,
// To:
'-c:a', audioCodec,
```

Where `audioCodec` is now resolved as `autoCodec`.

- [ ] **Step 2: Ensure NVENC uses p1+ull for auto-render on high tier**

Find `getNvencParams()` function. The logic at line 720-722 already uses:
```typescript
const preset = userPreset || (isChunked
  ? (isHighTier ? 'p1' : isMidTier ? 'p2' : 'p3')
  : 'p3')
```

For non-chunked (single-pass) auto-render, `userPreset` comes from editorState. When auto-render triggers, `metadata.preset` is `undefined`, so it falls to `'p3'`. Change to `'p1'` for high tier:

```typescript
const preset = userPreset || (isChunked
  ? (isHighTier ? 'p1' : isMidTier ? 'p2' : 'p3')
  : (isHighTier ? 'p1' : 'p3'))
```

Also ensure tune is `'ull'` for high tier single-pass:
```typescript
const tune = isChunked
  ? (isHighTier ? 'ull' : isMidTier ? 'll' : 'll')
  : (isHighTier ? 'ull' : 'hq')
```

- [ ] **Step 3: Commit**

```bash
git add electron/services/ffmpeg.ts
git commit -m "perf: auto-render defaults — libopus audio, p1+ull NVENC preset for RTX 5080"
```

---

### Task 4: Metrics type definitions

**Files:**
- Modify: `src/app/lib/store.ts` (WorkspaceMetrics, add to Workspace)
- Modify: `src/app/types.ts` (export WorkspaceMetrics)

- [ ] **Step 1: Define WorkspaceMetrics in store.ts**

Before the `Workspace` interface (around line 17), add:

```typescript
export interface WorkspaceMetrics {
  /** Wall-clock download time in ms */
  downloadMs?: number
  /** Average download speed in MB/s */
  downloadSpeedMBs?: number
  /** Downloaded file size in bytes */
  downloadFileSize?: number
  /** Quality setting used ('360'|'480'|'720'|'1080') */
  downloadQuality?: string
  /** Source resolution (e.g. '1920x1080') */
  downloadResolution?: string
  /** Whether multi-instance section download was used */
  downloadIsMultiInstance?: boolean

  /** Wall-clock render time in ms */
  renderMs?: number
  /** Average encode fps recorded during render */
  renderFps?: number
  /** Number of chunk workers used (chunked encoding only) */
  renderWorkers?: number
  /** NVENC preset used ('p1'|'p2'|'p3') */
  renderPreset?: string
  /** Encode codec ('h264'|'hevc') */
  renderCodec?: string
  /** Number of chunks in chunked encoding */
  renderChunks?: number
  /** Output render resolution (e.g. '1080x1920') */
  renderOutputResolution?: string

  /** GPU utilization peak % during render */
  systemGpuLoad?: number
  /** VRAM used in MB during render */
  systemVramUsed?: number
  /** System RAM used in GB during render */
  systemRamUsed?: number

  /** ISO timestamp — when video was first detected */
  detectedAt?: string
  /** ISO timestamp — when download started */
  downloadStartedAt?: string
  /** ISO timestamp — when download completed */
  downloadCompletedAt?: string
  /** ISO timestamp — when render started */
  renderStartedAt?: string
  /** ISO timestamp — when render completed */
  renderCompletedAt?: string
}
```

- [ ] **Step 2: Add `metrics` field to Workspace interface**

Find the `Workspace` interface. Add after `renderPriority`:

```typescript
  /** Performance metrics collected during download + render */
  metrics?: WorkspaceMetrics
```

- [ ] **Step 3: Export WorkspaceMetrics from types.ts**

Append to `src/app/types.ts`:

```typescript
export type { WorkspaceMetrics } from '../lib/store'
```

- [ ] **Step 4: Commit**

```bash
git add src/app/lib/store.ts src/app/types.ts
git commit -m "feat: add WorkspaceMetrics type for per-video performance tracking"
```

---

### Task 5: Backend metrics collection in main.ts

**Files:**
- Modify: `electron/main.ts` (autoDownloadFromWebSub, executeRenderJob)

- [ ] **Step 1: Import workspace metrics update helper**

Near imports, ensure `updateWorkspace` and `getWorkspace` are already imported (they are).

- [ ] **Step 2: Collect download metrics in autoDownloadFromWebSub**

Find the download section around line 617 (`const downloadStartMs = Date.now()`). After download completes at line 691 (`const downloadElapsed = ((Date.now() - downloadStartMs) / 1000).toFixed(1)`), after the aspect check and before probeParallelAll, add metrics collection:

```typescript
// ── Collect download metrics ──────────────────────────────────
const metrics = {
  downloadMs: Date.now() - downloadStartMs,
  downloadFileSize: result.fileSize || 0,
  downloadQuality: autoQuality,
  downloadResolution: aspect ? `${aspect.width}x${aspect.height}` : undefined,
  downloadSpeedMBs: downloadElapsed !== '0' && result.fileSize
    ? parseFloat(((result.fileSize / 1024 / 1024) / parseFloat(downloadElapsed)).toFixed(1))
    : undefined,
  downloadIsMultiInstance: instanceCount > 1,
  downloadStartedAt: new Date(downloadStartMs).toISOString(),
  downloadCompletedAt: new Date().toISOString(),
}
updateWorkspace(ws.id, { metrics })
```

Wait — we're still in the scope where `instanceCount` isn't directly available. We need to capture it before. Let me adjust:

Actually, `instanceCount` is defined inside `downloadWithClient()` in `youtube.ts` — it's not accessible from `main.ts`. We'll use a simpler proxy: if the download used multi-instance (detected from workspace config or quality level), we can infer it. For now, set `downloadIsMultiInstance` based on quality >= 1080 (the multi-instance threshold in `downloadWithClient`):

```typescript
const downloadIsMultiInstance = parseInt(autoQuality) >= 1080
```

Modify the metrics block and use `updateWorkspace` after probing:

Find the existing state update at line 777 (`const updatedWs = updateWorkspace(ws.id, {`). It already has a big update block. Merge metrics there:

```typescript
const updatedWs = updateWorkspace(ws.id, {
  status: 'ready',
  downloadedAt: new Date().toISOString(),
  downloadedPath: finalFilePath,
  fileSize: finalFileSize,
  thumbnail: localThumbnail,
  videoTitle: realTitle,
  duration: finalDuration,
  isShort: aspect?.isShort ?? false,
  videoResolution: aspect ? `${aspect.width}x${aspect.height}` : undefined,
  blurBackgroundPath: blurBgPath,
  preScaledPath,
  downloadQuality: autoQuality,
  metrics: {
    downloadMs: Date.now() - downloadStartMs,
    downloadSpeedMBs: parseFloat(downloadElapsed) > 0 && finalFileSize
      ? parseFloat(((finalFileSize / 1024 / 1024) / parseFloat(downloadElapsed)).toFixed(1))
      : undefined,
    downloadFileSize: finalFileSize,
    downloadQuality: autoQuality,
    downloadResolution: aspect ? `${aspect.width}x${aspect.height}` : undefined,
    downloadIsMultiInstance: parseInt(autoQuality) >= 1080,
    downloadStartedAt: new Date(downloadStartMs).toISOString(),
    downloadCompletedAt: new Date().toISOString(),
    detectedAt: ws.detectedAt || new Date().toISOString(),
  } as WorkspaceMetrics,
})
```

Note: `instanceCount` is local to `downloadWithClient` in `youtube.ts` and not exposed to `main.ts`. We'll approximate by quality — 1080p always uses multi-instance (see `downloadWithClient` line 1332-1334).

- [ ] **Step 3: Collect render metrics in executeRenderJob**

Find `executeRenderJob()` around line 270. At the top, the `renderStartMs` is captured. In the `.then()` handler after `renderVideo(...)` completes (line 352), after `result.success` check, add render metrics before `updateWorkspace(workspaceId, { status: 'done', ... })`:

```typescript
if (result.success) {
  // Collect render metrics
  const ws2 = getWorkspace(workspaceId)
  const existingMetrics = ws2?.metrics || {}
  const renderMetrics = {
    renderMs: Date.now() - renderStartMs,
    renderPreset: metadata.preset,
    renderCodec: metadata.codec,
    renderOutputResolution: metadata.export_resolution,
    renderWorkers: gpuTier === 'high' ? 14 : gpuTier === 'mid' ? 6 : 2,
    renderStartedAt: new Date(renderStartMs).toISOString(),
    renderCompletedAt: new Date().toISOString(),
  }
  updateWorkspace(workspaceId, {
    status: 'done',
    renderProgress: 100,
    outputPath: result.outputPath || '',
    metrics: { ...existingMetrics, ...renderMetrics } as any,
  })
  // ... rest unchanged
```

The `renderFps` and `renderChunks` fields are populated by `renderChunked()` result. For single `renderVideo()`, they remain undefined. We'll add them when chunked render provides the data in its result handler.

- [ ] **Step 4: Also collect chunked render metrics**

If there's a chunked render path, find where `renderChunked()` is called and add similar collection there. Search for `renderChunked` usage in main.ts. If present, add:

```typescript
// After chunked render success:
const chunkedResult = result as any
const renderMetrics = {
  renderMs: Date.now() - renderStartMs,
  renderPreset: metadata.preset,
  renderCodec: metadata.codec,
  renderOutputResolution: metadata.export_resolution,
  renderWorkers: chunkedResult.profileSummary ? undefined : (gpuTier === 'high' ? 14 : 6),
  renderFps: chunkedResult.profileSummary?.avgEncodeFps,
  renderChunks: chunkedResult.chunks?.length,
  renderStartedAt: new Date(renderStartMs).toISOString(),
  renderCompletedAt: new Date().toISOString(),
}
updateWorkspace(workspaceId, { metrics: renderMetrics } as any)
```

- [ ] **Step 5: Zero-latency download for Ultra**

Find `getMaxConcurrentDownloads()` around line 105. Modify:

```typescript
function getMaxConcurrentDownloads(): number {
  const settings = loadSettings()
  if (settings.maxConcurrentDownloads && settings.maxConcurrentDownloads > 0) {
    return settings.maxConcurrentDownloads
  }
  // Ultra preset: zero-latency, max concurrency
  if (settings.hardwareProfile?.vramGB === 16 && settings.hardwareProfile?.ramGB === 64) {
    return 10 // spawn ngay, không queue, 10 concurrent downloads
  }
  const freeGB = os.freemem() / (1024 ** 3)
  const totalGB = os.totalmem() / (1024 ** 3)
  if (totalGB >= 48) return 3
  if (freeGB >= 8) return 2
  if (freeGB >= 4) return 1
  return 0
}
```

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat: metrics collection in download+render pipeline + zero-latency download for Ultra"
```

---

### Task 6: VideoDetailPanel component

**Files:**
- Create: `src/app/components/VideoDetailPanel.tsx`

- [ ] **Step 1: Create VideoDetailPanel component**

Write the full component:

```tsx
'use client'

import { useMemo } from 'react'
import type { Workspace, WorkspaceMetrics } from '../lib/store'

function formatMs(ms: number | undefined): string {
  if (ms == null || ms === 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function MetricRow({ label, value, suffix, color }: { label: string; value: string | number; suffix?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', fontSize: 9, fontFamily: 'monospace', borderBottom: '1px solid #181818' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{ color: color || '#00B4FF', fontWeight: 600 }}>{value}{suffix ? ` ${suffix}` : ''}</span>
    </div>
  )
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '6px 8px' }}>
      <div style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: 1, marginBottom: 4, borderBottom: `1px solid ${color}22`, paddingBottom: 2 }}>
        ◆ {title}
      </div>
      {children}
    </div>
  )
}

function TimelineRow({ label, timestamp, delta }: { label: string; timestamp?: string; delta?: string }) {
  const timeStr = timestamp
    ? new Date(timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as any)
    : '—'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, fontFamily: 'monospace', padding: '1px 0', color: '#555' }}>
      <span>{label}</span>
      <span style={{ color: '#888' }}>{timeStr}</span>
      {delta && <span style={{ color: '#00B4FF66', marginLeft: 4 }}>+{delta}</span>}
    </div>
  )
}

interface Props {
  workspace: Workspace | null
  onClose: () => void
}

export function VideoDetailPanel({ workspace, onClose }: Props) {
  const m = workspace?.metrics

  const downloadSpeed = useMemo(() => {
    if (m?.downloadSpeedMBs) return m.downloadSpeedMBs.toFixed(1)
    if (m?.downloadMs && m?.downloadFileSize && m.downloadMs > 0) {
      const sec = m.downloadMs / 1000
      return (m.downloadFileSize / 1024 / 1024 / sec).toFixed(1)
    }
    return null
  }, [m])

  if (!workspace) return null

  return (
    <div style={{ flex: 1, background: '#121212', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ fontSize: 8, color: '#555', fontWeight: 700, padding: '5px 10px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0D0D0D' }}>
        <span style={{ letterSpacing: 1 }}>VIDEO DETAIL</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10, padding: '0 4px' }}>✕</button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Thumbnail + Title */}
        <div style={{ padding: 8 }}>
          {workspace.thumbnail && (
            <img src={workspace.thumbnail} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 4, marginBottom: 6 }} />
          )}
          <div style={{ fontSize: 9, fontWeight: 700, color: '#ccc', marginBottom: 2, lineHeight: 1.4 }}>{workspace.videoTitle}</div>
          <div style={{ fontSize: 8, color: '#555' }}>{workspace.channelName}</div>
        </div>

        {/* DOWNLOAD METRICS */}
        <Section title="DOWNLOAD" color="#00B4FF">
          <MetricRow label="Thời gian" value={formatMs(m?.downloadMs)} color="#00FF88" />
          <MetricRow label="Tốc độ" value={downloadSpeed || '—'} suffix="MB/s" />
          <MetricRow label="Kích thước" value={formatBytes(m?.downloadFileSize || workspace.fileSize)} />
          <MetricRow label="Chất lượng" value={m?.downloadQuality || workspace.downloadQuality || '—'} suffix="p" />
          <MetricRow label="Nguồn" value={m?.downloadResolution || workspace.videoResolution || '—'} />
          <MetricRow label="Multi-Instance" value={m?.downloadIsMultiInstance ? 'Có' : 'Không'} color={m?.downloadIsMultiInstance ? '#00FF88' : '#555'} />
        </Section>

        {/* RENDER METRICS */}
        <Section title="RENDER" color="#00FF88">
          <MetricRow label="Thời gian" value={formatMs(m?.renderMs)} color="#00FF88" />
          {m?.renderFps ? <MetricRow label="Encode FPS" value={m.renderFps.toFixed(1)} color="#FFB800" /> : null}
          {m?.renderChunks ? <MetricRow label="Số chunk" value={m.renderChunks} /> : null}
          <MetricRow label="Workers" value={m?.renderWorkers || '—'} />
          <MetricRow label="Preset" value={m?.renderPreset || '—'} />
          <MetricRow label="Codec" value={m?.renderCodec || '—'} />
          <MetricRow label="Đầu ra" value={m?.renderOutputResolution || '—'} />
        </Section>

        {/* SYSTEM */}
        <Section title="SYSTEM" color="#FFB800">
          {m?.systemGpuLoad != null ? <MetricRow label="GPU sử dụng" value={`${m.systemGpuLoad}%`} color="#FF6B6B" /> : null}
          {m?.systemVramUsed != null ? <MetricRow label="VRAM dùng" value={`${m.systemVramUsed} MB`} /> : null}
          {m?.systemRamUsed != null ? <MetricRow label="RAM dùng" value={`${m.systemRamUsed} GB`} /> : null}
        </Section>

        {/* E2E TIMELINE */}
        <Section title="E2E TIMELINE" color="#888">
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#555', lineHeight: 1.8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00B4FF' }} />
                <div style={{ width: 1, height: 20, background: '#222' }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00B4FF' }} />
                <div style={{ width: 1, height: 20, background: '#222' }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00B4FF' }} />
                <div style={{ width: 1, height: 20, background: '#222' }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: workspace.status === 'done' ? '#00FF88' : '#444' }} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <TimelineRow label="Phát hiện" timestamp={m?.detectedAt} delta={null} />
                <TimelineRow label="Tải xuống" timestamp={m?.downloadStartedAt} delta={null} />
                <TimelineRow label="Sẵn sàng" timestamp={m?.downloadCompletedAt} delta={null} />
                <TimelineRow label="Hoàn thành" timestamp={m?.renderCompletedAt} delta={null} />
              </div>
            </div>
          </div>
          {/* Total E2E */}
          {(m?.detectedAt && m?.renderCompletedAt) ? (
            <div style={{ marginTop: 4, padding: '4px 6px', background: '#0A0A0A', borderRadius: 2, border: '1px solid #222', display: 'flex', justifyContent: 'space-between', fontSize: 8, fontFamily: 'monospace' }}>
              <span style={{ color: '#555' }}>TỔNG</span>
              <span style={{ color: '#00FF88', fontWeight: 700 }}>
                {formatMs(new Date(m.renderCompletedAt).getTime() - new Date(m.detectedAt).getTime())}
              </span>
            </div>
          ) : null}
        </Section>

        {/* Raw info */}
        <Section title="RAW INFO" color="#444">
          <MetricRow label="ID" value={workspace.id.slice(0, 12)} />
          <MetricRow label="Video ID" value={workspace.videoId || '—'} />
          <MetricRow label="Status" value={workspace.status} />
          <MetricRow label="Trim" value={workspace.trimLimit === 'full' ? 'Full' : `${workspace.trimLimit}m`} />
          <MetricRow label="Quality" value={String(workspace.quality)} suffix="p" />
        </Section>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/VideoDetailPanel.tsx
git commit -m "feat: VideoDetailPanel component with performance metrics display"
```

---

### Task 7: Wire VideoDetailPanel into layout

**Files:**
- Modify: `src/app/page.tsx` (right panel switching)
- Modify: `src/app/lib/store.ts` (selectedWorkspaceId change to trigger panel)

- [ ] **Step 1: Read current page.tsx to understand layout structure**

Check how the right panel works currently (SettingsPanel vs empty).

- [ ] **Step 2: Wire selectedWorkspaceId to show VideoDetailPanel instead of SettingsPanel**

In `src/app/page.tsx`, find where the right panel renders SettingsPanel. Replace with conditional:

```tsx
import { VideoDetailPanel } from './components/VideoDetailPanel'
// ... in the store usage

const selectedWorkspace = useMemo(() => {
  if (!selectedWorkspaceId) return null
  return workspaces.find(w => w.id === selectedWorkspaceId) || null
}, [selectedWorkspaceId, workspaces])

// In the render, replace:
{/* {activeTab === 'settings' && <SettingsPanel ... />} */}
{/* With: */}
{(selectedWorkspace && selectedWorkspaceId) ? (
  <VideoDetailPanel
    workspace={selectedWorkspace}
    onClose={() => useAppStore.getState().selectWorkspace(null)}
  />
) : activeTab === 'settings' ? (
  <SettingsPanel ... />
) : (
  <div style={{ ... }}>{/* empty state */}</div>
)}
```

- [ ] **Step 3: Add auto-render preset values helper in main.ts**

Find `buildAutoRenderMetadata()` function in main.ts. Ensure it passes `audioCodec: 'libopus'` and `preset: 'p1'` for auto-render:

```typescript
function buildAutoRenderMetadata(ws: WorkspaceData, sourceVideo: string, finalDuration: number, blurBgPath: string, thumbPath: string, settings: AppSettings): RenderMetadata {
  const autoResolution = settings.autoRenderResolution || '1080p'
  const [rw, rh] = autoResolution.endsWith('p')
    ? (autoResolution === '1080p' ? [1080, 1920] : autoResolution === '720p' ? [720, 1280] : [360, 640])
    : [1080, 1920]
  const gpuTier = getGPUCapabilities().tier
  return {
    workspace_id: ws.id,
    source_video: sourceVideo,
    export_resolution: `${rw}x${rh}`,
    video_speed: 1.0,
    fps_target: settings.autoRenderFPS || 30,
    overlays: [],
    trim: { start: 0, end: finalDuration },
    codec: 'h264',
    // Ultra preset: fastest NVENC settings
    preset: gpuTier === 'high' ? 'p1' : 'p3',
    tune: gpuTier === 'high' ? 'ull' : 'hq',
    canvasBg: 'black',
    backgroundType: 'blur',
    audioCodec: gpuTier === 'high' ? 'libopus' : 'aac',
    audioBitrate: '128k',
    bottomBarH: 64,
    bottomBarEnabled: true,
    isShort: true,
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/lib/store.ts electron/main.ts
git commit -m "feat: wire VideoDetailPanel into layout, add Ultra auto-render defaults"
```

---

### Task 8: TypeScript compile check + test

**Files:**
- All modified files

- [ ] **Step 1: Kill any running Electron**

```bash
taskkill /F /IM electron.exe 2>/dev/null; taskkill /F /IM node.exe 2>/dev/null; true
```

- [ ] **Step 2: TypeScript check**

```bash
cd d:/LOOP_COMPANY/HyperClip && npx tsc --noEmit
```

Expected: 0 errors. If errors, fix type mismatches.

- [ ] **Step 3: Run unit tests**

```bash
cd d:/LOOP_COMPANY/HyperClip && npm run test 2>&1 | head -50
```

Expected: All existing tests pass.

- [ ] **Step 4: Verify `hardwareProfile` type used for zero-latency check**

Search for `vramGB === 16` in main.ts — ensure the check is correct for non-Ultra machines (won't match, so falls back to default). Safe.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: type fixes after tsc check"
```

---

## Spec Coverage Check

- **Ultra preset tune (downloadInstances=6, chunkWorkers=14, renderWorkers=6):** Task 1 (system.ts)
- **Uncap chunk workers:** Task 2 (worker-pool.ts)
- **libopus audio + p1/ull NVENC preset:** Task 3 (ffmpeg.ts) + Task 7 (buildAutoRenderMetadata)
- **WorkspaceMetrics type definition:** Task 4 (store.ts)
- **Download metrics collection:** Task 5 (main.ts, autoDownloadFromWebSub)
- **Render metrics collection:** Task 5 (main.ts, executeRenderJob)
- **Zero-latency download (maxConcurrent=10 for Ultra):** Task 5 (main.ts, getMaxConcurrentDownloads)
- **VideoDetailPanel component:** Task 6 (new file)
- **Wire into layout:** Task 7 (page.tsx)
- **TypeScript check:** Task 8

No gaps found.
