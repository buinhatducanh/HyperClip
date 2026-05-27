'use client'

import { useState, useEffect, useCallback } from 'react'
import { colors, spacing, fontSize } from '../design-system/tokens'
import type { Channel, SystemStats } from '../types'
import type { AppSettings, HardwareProfile } from '../lib/store'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../lib/store'

interface HardwarePresetInfo {
  id: string
  label: string
  vramGB: number
  ramGB: number
  downloadInstances: number
  renderWorkers: number
  chunkWorkers: number
  sessions: number
  available: boolean
}

interface HardwareProfileData {
  detected: { vramGB: number; ramGB: number; gpuName: string }
  presets: HardwarePresetInfo[]
  active: string | null
}

interface Props {
  settings: AppSettings
  systemStats: SystemStats
  channels: Channel[]
  activeChannelId: string | null
  onSettingsChange: (patch: Partial<AppSettings>) => void
}

// ─── Shared components ────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 28, height: 12, cursor: 'pointer', flexShrink: 0,
        background: value ? colors.success : colors.text,
        border: `1px solid ${value ? colors.success + '66' : colors.textSecondary}`,
        borderRadius: 6, position: 'relative', transition: 'background 0.15s',
      }}
    >
      <div style={{
        width: 10, height: 10, background: value ? colors.text : colors.textSecondary,
        borderRadius: '50%', position: 'absolute', top: 1,
        left: value ? 'unset' : 1, right: value ? 2 : 'unset',
        transition: 'all 0.15s',
      }} />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSecondary, marginBottom: 4 }}>{children}</div>
}

// ─── Hardware Profile Card ───────────────────────────────────────────────────────

function HardwareProfileCard({ currentProfile }: { currentProfile: HardwareProfile | undefined }) {
  const [data, setData] = useState<HardwareProfileData | null>(null)
  const [hoveredPreset, setHoveredPreset] = useState<string | null>(null)
  const showToast = useAppStore(s => s.showToast)

  const load = useCallback(async () => {
    try {
      const info = await ipc.getHardwareProfile() as HardwareProfileData
      setData(info)
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  if (!data) return (
    <Card>
      <SectionLabel>HARDWARE PROFILE</SectionLabel>
      <div style={{ fontSize: 10, color: colors.textSecondary }}>Loading...</div>
    </Card>
  )

  const activePreset = data.presets.find(p => p.id === data.active)
  const hovered = hoveredPreset ? data.presets.find(p => p.id === hoveredPreset) : null
  const display = hovered || activePreset

  const handleSelect = async (preset: HardwarePresetInfo) => {
    if (!preset.available) return
    const profile: HardwareProfile = { vramGB: preset.vramGB, ramGB: preset.ramGB }
    const newProfile = preset.id === data.active ? undefined : profile
    try {
      await ipc.updateSettings({ hardwareProfile: newProfile ?? null })
      await load()
      showToast(newProfile ? `Preset: ${preset.label}` : 'Preset: Auto (detected)')
    } catch {
      showToast('Lỗi khi lưu preset')
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: colors.accent, flex: 1 }}>HARDWARE PROFILE</span>
        {activePreset && (
          <span style={{ fontSize: 9, color: colors.success, fontFamily: 'monospace', fontWeight: 700 }}>
            ● {activePreset.label}
          </span>
        )}
        {!data.active && (
          <span style={{ fontSize: 9, color: colors.textSecondary, fontFamily: 'monospace' }}>
            ● Auto
          </span>
        )}
      </div>

      {/* Detected hardware */}
      <div style={{ fontSize: 9, color: colors.textSecondary, marginBottom: 8, fontFamily: 'monospace' }}>
        {data.detected.gpuName} · {data.detected.vramGB}GB VRAM · {data.detected.ramGB}GB RAM
      </div>

      {/* Preset pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {data.presets.map(preset => {
          const isActive = preset.id === data.active
          return (
            <button
              key={preset.id}
              disabled={!preset.available}
              onClick={() => handleSelect(preset)}
              onMouseEnter={() => setHoveredPreset(preset.id)}
              onMouseLeave={() => setHoveredPreset(null)}
              title={!preset.available ? `Máy bạn không đủ hardware cho preset này` : preset.label}
              style={{
                height: 30,
                padding: '0 10px',
                border: `1px solid ${isActive ? colors.accent : preset.available ? colors.border : colors.text}`,
                borderRadius: 4,
                fontSize: 9,
                fontWeight: 700,
                cursor: preset.available ? 'pointer' : 'not-allowed',
                background: isActive ? colors.accent + '20' : preset.available ? colors.surface : colors.surfaceHover,
                color: !preset.available ? colors.textSecondary : isActive ? colors.accent : colors.textSecondary,
                letterSpacing: '0.04em',
                fontFamily: 'monospace',
                transition: 'all 0.15s',
                opacity: preset.available ? 1 : 0.5,
                textDecoration: preset.available ? 'none' : 'line-through',
              }}
            >
              {preset.label} {preset.vramGB}/{preset.ramGB}
            </button>
          )
        })}
      </div>

      {/* Stats display */}
      {display && (
        <div style={{ fontSize: 9, color: colors.textSecondary, fontFamily: 'monospace', lineHeight: 1.8 }}>
          <span style={{ color: colors.textSecondary }}>Workers:</span> <span style={{ color: colors.success }}>{display.chunkWorkers}</span>
          {' · '}
          <span style={{ color: colors.textSecondary }}>DL:</span> <span style={{ color: colors.accent }}>{display.downloadInstances}</span>
          {' · '}
          <span style={{ color: colors.textSecondary }}>Sessions:</span> <span style={{ color: colors.warning }}>{display.sessions}</span>
        </div>
      )}
    </Card>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ margin: '4px 6px 2px', background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 4, padding: 8 }}>
      {children}
    </div>
  )
}

function BtnGroup({ options, value, onChange }: {
  options: { label: string; value: any }[]
  value: any
  onChange: (v: any) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button key={String(opt.value)} onClick={() => onChange(opt.value)} style={{
            flex: 1, height: 26, cursor: 'pointer',
            background: active ? colors.accent + '20' : colors.text,
            border: `1px solid ${active ? colors.accent + '44' : colors.border}`,
            borderRadius: 2, fontSize: 9, fontWeight: 700,
            color: active ? colors.accent : colors.textSecondary,
            fontFamily: 'monospace', transition: 'all 0.1s',
          }}>
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// AUTO RENDER CARD
// ═══════════════════════════════════════════════════════════════════════

function AutoRenderCard({ s, onChange }: { s: AppSettings; onChange: (p: Partial<AppSettings>) => void }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: colors.success, flex: 1 }}>AUTO RENDER</span>
        <Toggle value={s.autoRender} onChange={v => onChange({ autoRender: v })} />
      </div>

      <div style={{ marginBottom: 4 }}>
        <SectionLabel>Resolution</SectionLabel>
        <BtnGroup
          options={[{ label: '1080p', value: '1080p' }, { label: '720p', value: '720p' }, { label: '360p', value: '360p' }]}
          value={s.autoRenderResolution}
          onChange={v => onChange({ autoRenderResolution: v as string })}
        />
      </div>

      <div style={{ marginBottom: 4 }}>
        <SectionLabel>FPS</SectionLabel>
        <BtnGroup
          options={[{ label: '30', value: 30 }, { label: '60', value: 60 }]}
          value={s.autoRenderFPS}
          onChange={v => onChange({ autoRenderFPS: v as 30 | 60 })}
        />
      </div>

      <div style={{ marginBottom: 4 }}>
        <SectionLabel>Số phần</SectionLabel>
        <BtnGroup
          options={[{ label: '1 (no split)', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 }, { label: '5', value: 5 }]}
          value={(s as any).autoSplitParts ?? 1}
          onChange={v => onChange({ autoSplitParts: v as number } as any)}
        />
      </div>

      <div style={{ marginBottom: 4 }}>
        <SectionLabel>Phút/phần</SectionLabel>
        <BtnGroup
          options={[{ label: 'Auto', value: 0 }, { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '5', value: 5 }, { label: '10', value: 10 }]}
          value={(s as any).autoSplitMinutes ?? 0}
          onChange={v => onChange({ autoSplitMinutes: v as number } as any)}
        />
      </div>

      <div>
        <SectionLabel>Title template</SectionLabel>
        <input type="text" value={s.autoRenderTitleTemplate} onChange={e => onChange({ autoRenderTitleTemplate: e.target.value } as any)}
          placeholder='{title} - {channel}' style={{
            width: '100%', height: 26, background: colors.bg, border: `1px solid ${colors.border}`,
            borderRadius: 2, color: colors.accent, fontSize: 9, fontFamily: 'monospace', padding: '0 8px', outline: 'none',
          }}
        />
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// DOWNLOAD CARD
// ═══════════════════════════════════════════════════════════════════════

function DownloadCard({ s, onChange }: { s: AppSettings; onChange: (p: Partial<AppSettings>) => void }) {
  return (
    <Card>
      <SectionLabel>DOWNLOAD</SectionLabel>

      <div style={{ marginBottom: 4 }}>
        <SectionLabel>Chất lượng download</SectionLabel>
        <BtnGroup
          options={[{ label: '360p', value: '360' }, { label: '480p', value: '480' }, { label: '720p', value: '720' }, { label: '1080p', value: '1080' }]}
          value={s.autoDownloadQuality}
          onChange={v => onChange({ autoDownloadQuality: v as string })}
        />
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: colors.textSecondary, whiteSpace: 'nowrap' }}>Trim</span>
        <div style={{ flex: 1, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 2, padding: '2px 6px', fontSize: 9, color: colors.accent, fontFamily: 'monospace' }}>
          {s.defaultTrimLimit === 'full' ? 'FULL' : `${s.defaultTrimLimit} phút`}
        </div>
        <button onClick={() => onChange({ defaultTrimLimit: s.defaultTrimLimit === 'full' ? 10 : 'full' })} style={{
          padding: '3px 8px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 2, fontSize: 8,
          color: s.defaultTrimLimit === 'full' ? colors.accent : colors.textSecondary, cursor: 'pointer', fontWeight: s.defaultTrimLimit === 'full' ? 700 : 400,
        }}>FULL</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <div>
          <SectionLabel>Tải đồng thời</SectionLabel>
          <BtnGroup options={[{ label: '3', value: 3 }, { label: '5', value: 5 }, { label: '10', value: 10 }]} value={s.maxConcurrentDownloads} onChange={v => onChange({ maxConcurrentDownloads: v as number })} />
        </div>
        <div>
          <SectionLabel>Render đồng thời</SectionLabel>
          <BtnGroup options={[{ label: '2', value: 2 }, { label: '4', value: 4 }, { label: '8', value: 8 }]} value={s.maxConcurrentRenders} onChange={v => onChange({ maxConcurrentRenders: v as number })} />
        </div>
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// CHANNEL OVERRIDE CARD
// ═══════════════════════════════════════════════════════════════════════

function ChannelOverrideCard({ channels }: { channels: Channel[] }) {
  const [channelId, setChannelId] = useState('')
  const channel = channels.find(c => c.id === channelId) || channels[0]
  const chSettings = channel?.settings

  useEffect(() => {
    if (!channelId && channels.length > 0) setChannelId(channels[0].id)
  }, [channels, channelId])

  if (!channel || channels.length === 0) return null

  const handleOverride = (patch: Record<string, any>) => {
    const newSettings = { ...(chSettings || {}), ...patch }
    useAppStore.getState().updateChannel(channel.id, { settings: newSettings as any })
    ipc.updateChannel(channel.id, { settings: newSettings })
  }

  const hasOverride = !!chSettings && Object.keys(chSettings).length > 0

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: colors.warning, flex: 1 }}>CHANNEL OVERRIDE</span>
        <select value={channel.id} onChange={e => setChannelId(e.target.value)} style={{
          height: 24, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 2, color: colors.textSecondary, fontSize: 9, fontFamily: 'monospace', cursor: 'pointer',
        }}>
          {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {hasOverride && <span style={{ fontSize: 9, color: colors.warning, background: colors.warning + '15', padding: '1px 4px', borderRadius: 2, border: `1px solid ${colors.warning}44` }}>override</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
        <div>
          <SectionLabel>Resolution</SectionLabel>
          <BtnGroup options={[{ label: '720p', value: '720p' }, { label: '1080p', value: '1080p' }]} value={chSettings?.resolution || 'global'} onChange={v => handleOverride({ resolution: v })} />
        </div>
        <div>
          <SectionLabel>FPS</SectionLabel>
          <BtnGroup options={[{ label: '30', value: 30 }, { label: '60', value: 60 }]} value={chSettings?.fps || 'global'} onChange={v => handleOverride({ fps: v })} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
        <button onClick={() => handleOverride({ autoSplit: true, splitMinutes: 3 })} style={{
          flex: 1, height: 24, background: chSettings?.autoSplit ? colors.accent + '20' : colors.text,
          border: `1px solid ${chSettings?.autoSplit ? colors.accent + '44' : colors.border}`, borderRadius: 2, fontSize: 8, cursor: 'pointer',
          color: chSettings?.autoSplit ? colors.accent : colors.textSecondary, fontWeight: 700,
        }}>Auto-split</button>
        <button onClick={() => handleOverride({ autoSplit: false })} style={{
          flex: 1, height: 24, background: chSettings?.autoSplit === false ? colors.accent + '20' : colors.text,
          border: `1px solid ${chSettings?.autoSplit === false ? colors.accent + '44' : colors.border}`, borderRadius: 2, fontSize: 8, cursor: 'pointer',
          color: chSettings?.autoSplit === false ? colors.accent : colors.textSecondary,
        }}>No split</button>
      </div>

      {hasOverride && (
        <button onClick={() => { useAppStore.getState().updateChannel(channel.id, { settings: undefined as any }); ipc.updateChannel(channel.id, { settings: undefined }) }} style={{
          width: '100%', height: 24, background: colors.surface, border: `1px solid ${colors.error}22`, borderRadius: 2, fontSize: 8, color: colors.error, cursor: 'pointer',
        }}>Reset to global</button>
      )}
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// STORAGE CARD
// ═══════════════════════════════════════════════════════════════════════

function StorageCard({ s, onChange }: { s: AppSettings; onChange: (p: Partial<AppSettings>) => void }) {
  const [storageStats, setStorageStats] = useState<any>(null)
  const showToast = useAppStore(s => s.showToast)

  useEffect(() => {
    ipc.getStorageSize().then(setStorageStats).catch(() => {})
    const t = setInterval(() => ipc.getStorageSize().then(setStorageStats).catch(() => {}), 30000)
    return () => clearInterval(t)
  }, [])

  const freeGB = storageStats ? Math.round(storageStats.freeBytes / (1024**3)) : 0
  const usedMB = storageStats ? Math.round(storageStats.downloads) : 0
  const usedPct = freeGB + usedMB / 1024 > 0 ? Math.round((usedMB / 1024) / (freeGB + usedMB / 1024) * 100) : 0

  return (
    <Card>
      <SectionLabel>STORAGE</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <div style={{ flex: 1, height: 5, background: colors.surface, borderRadius: 2 }}>
          <div style={{ width: `${Math.min(usedPct, 100)}%`, height: '100%', background: usedPct > 80 ? colors.error : colors.accent, borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: 9, color: colors.accent + '66', fontFamily: 'monospace' }}>{usedMB}MB / {freeGB}GB free</span>
      </div>

      <div style={{ marginBottom: 3 }}>
        <div style={{ fontSize: 9, color: colors.textSecondary, marginBottom: 1 }}>Video path</div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <div style={{ flex: 1, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 2, padding: '2px 5px', fontSize: 9, color: colors.textSecondary, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.videoStoragePath || '(default)'}</div>
          <button onClick={async () => { const r = await ipc.pickFolder(s.videoStoragePath); if (r?.path) { onChange({ videoStoragePath: r.path } as any); ipc.updateSettings({ videoStoragePath: r.path }) } }} style={{ padding: '2px 5px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 2, fontSize: 9, color: colors.textSecondary, cursor: 'pointer', flexShrink: 0 }}>📁</button>
        </div>
      </div>

      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 9, color: colors.textSecondary, marginBottom: 1 }}>Output path</div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <div style={{ flex: 1, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 2, padding: '2px 5px', fontSize: 9, color: colors.textSecondary, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.outputPath || '(default)'}</div>
          <button onClick={async () => { const r = await ipc.pickFolder(s.outputPath); if (r?.path) { onChange({ outputPath: r.path } as any); ipc.updateSettings({ outputPath: r.path }) } }} style={{ padding: '2px 5px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 2, fontSize: 9, color: colors.textSecondary, cursor: 'pointer', flexShrink: 0 }}>📁</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
        <button onClick={() => storageStats?.downloadPath && ipc.openFolder(storageStats.downloadPath)} style={{ flex: 1, height: 24, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 2, fontSize: 8, color: colors.textSecondary, cursor: 'pointer' }}>Mở thư mục</button>
        <button onClick={async () => { const r = await ipc.clearDownloads(); if (r.success) showToast(`Freed ${r.freedMB}MB`) }} style={{ flex: 1, height: 24, background: colors.surface, border: `1px solid ${colors.error}22`, borderRadius: 2, fontSize: 8, color: colors.error, cursor: 'pointer' }}>Xóa cache</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 9, color: colors.textSecondary }}>Tự động xóa sau</span>
        <select value={s.downloadsCleanupDays} onChange={e => onChange({ downloadsCleanupDays: Number(e.target.value) } as any)} style={{ height: 24, flex: 1, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 2, color: colors.accent, fontSize: 9, fontFamily: 'monospace', cursor: 'pointer' }}>
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
  const [innertubeDegraded, setInnertubeDegraded] = useState(false)

  useEffect(() => {
    const load = () => { ipc.getPollerStatus().then(setPollerStatus).catch(() => {}); ipc.getSessionStatus().then(setSessionStatus).catch(() => {}) }
    load()
    const t = setInterval(load, 8000)
    const cleanup = (ipc as any).onInnertubeDegraded?.((data: any) => setInnertubeDegraded(data.degraded))
    return () => { clearInterval(t); cleanup?.() }
  }, [])

  const consented = sessionStatus?.consentedCount ?? 0
  const healthPct = sessionStatus?.health?.healthPct ?? 0

  return (
    <Card>
      <SectionLabel>DETECTION</SectionLabel>
      <div style={{ fontSize: 9, color: colors.textSecondary, lineHeight: 1.7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: consented > 0 ? colors.success : colors.textSecondary, flexShrink: 0 }} />
          Innertube: <span style={{ color: consented > 0 ? colors.success : colors.textSecondary, fontWeight: 600 }}>{consented}/{sessionStatus?.sessionCount ?? 0}</span> sessions
          {innertubeDegraded && <span style={{ color: colors.warning, fontSize: 9, background: colors.warning + '20', padding: '1px 5px', borderRadius: 2 }}>DEGRADED</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: healthPct >= 50 ? colors.success : healthPct > 0 ? colors.warning : colors.textSecondary, flexShrink: 0 }} />
          Session health: <span style={{ color: healthPct >= 50 ? colors.success : colors.warning, fontWeight: 600 }}>{healthPct}%</span>
        </div>
        <div style={{ marginTop: 2 }}>Poll: {pollerStatus?.active ? 'active' : 'paused'} · {pollerStatus?.lastError ? '⚠ lỗi' : '0 lỗi'}</div>
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// SYSTEM CARD + MISC
// ═══════════════════════════════════════════════════════════════════════

function SystemCard({ systemStats }: { systemStats: SystemStats }) {
  return (
    <Card>
      <SectionLabel>SYSTEM</SectionLabel>
      <div style={{ fontSize: 9, color: colors.textSecondary, lineHeight: 1.7 }}>
        <div>GPU: <span style={{ color: colors.textSecondary }}>{systemStats.gpuName || 'N/A'} · {systemStats.gpuTemp || 0}°C · {systemStats.gpuUsage || 0}%</span></div>
        <div>CPU: <span style={{ color: colors.textSecondary }}>{systemStats.cpuName || 'N/A'} · {systemStats.cpuUsage || 0}%</span></div>
        <div>RAM: <span style={{ color: colors.textSecondary }}>{Math.round(systemStats.ramUsed || 0)} / {Math.round(systemStats.ramTotal || 0)} GB</span></div>
        <div>Workers: <span style={{ color: colors.accent, fontWeight: 600 }}>{systemStats.activeWorkers || 0}</span> / {systemStats.maxChunkWorkers || 8} · NVENC</div>
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════

export function SettingsPanel({ settings, systemStats, channels, onSettingsChange }: Props) {
  return (
    <div style={{ flex: 1, background: colors.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{ fontSize: 10, color: colors.textSecondary, fontWeight: 700, padding: '6px 12px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: colors.bg }}>
        <span style={{ letterSpacing: 1 }}>SETTINGS</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <a href="/settings?tab=sessions" style={{ padding: '2px 6px', border: `1px solid ${colors.border}`, borderRadius: 2, fontSize: 9, color: colors.textSecondary, textDecoration: 'none' }}>Sessions</a>
          <a href="/settings?tab=projects" style={{ padding: '2px 6px', border: `1px solid ${colors.border}`, borderRadius: 2, fontSize: 9, color: colors.textSecondary, textDecoration: 'none' }}>Projects</a>
          <a href="/settings?tab=keys" style={{ padding: '2px 6px', border: `1px solid ${colors.border}`, borderRadius: 2, fontSize: 9, color: colors.textSecondary, textDecoration: 'none' }}>Keys</a>
          <a href="/settings?tab=diag" style={{ padding: '2px 6px', border: `1px solid ${colors.error}22`, borderRadius: 2, fontSize: 9, color: colors.error + '66', textDecoration: 'none' }}>Diag</a>
        </div>
      </div>

      {/* 2-column cards */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start' }}>
        <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column' }}>
          <HardwareProfileCard currentProfile={settings.hardwareProfile} />
          <AutoRenderCard s={settings} onChange={onSettingsChange} />
          <DownloadCard s={settings} onChange={onSettingsChange} />
          <ChannelOverrideCard channels={channels} />
        </div>
        <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column' }}>
          <StorageCard s={settings} onChange={onSettingsChange} />
          <DetectionCard />
          <SystemCard systemStats={systemStats} />
        </div>
      </div>
    </div>
  )
}
