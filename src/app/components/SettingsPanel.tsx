'use client'

import { useState, useEffect } from 'react'
import type { Channel, SystemStats } from '../types'
import type { AppSettings } from '../lib/store'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../lib/store'

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 8, fontWeight: 700, color: '#888', marginBottom: 3 }}>{children}</div>
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ margin: '4px 6px 2px', background: '#0D0D0D', border: '1px solid #1A1A1A', borderRadius: 4, padding: 8 }}>
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
            flex: 1, height: 22, cursor: 'pointer',
            background: active ? '#00B4FF20' : '#1A1A1A',
            border: `1px solid ${active ? '#00B4FF44' : '#222'}`,
            borderRadius: 2, fontSize: 7, fontWeight: 700,
            color: active ? '#00B4FF' : '#555',
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
        <span style={{ fontSize: 10, fontWeight: 700, color: '#00FF88', flex: 1 }}>AUTO RENDER</span>
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
            width: '100%', height: 22, background: '#0A0A0A', border: '1px solid #222',
            borderRadius: 2, color: '#00B4FF', fontSize: 7, fontFamily: 'monospace', padding: '0 6px', outline: 'none',
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
        <span style={{ fontSize: 7, color: '#555', whiteSpace: 'nowrap' }}>Trim</span>
        <div style={{ flex: 1, background: '#0A0A0A', border: '1px solid #222', borderRadius: 2, padding: '2px 6px', fontSize: 7, color: '#00B4FF', fontFamily: 'monospace' }}>
          {s.defaultTrimLimit === 'full' ? 'FULL' : `${s.defaultTrimLimit} phút`}
        </div>
        <button onClick={() => onChange({ defaultTrimLimit: s.defaultTrimLimit === 'full' ? 10 : 'full' })} style={{
          padding: '2px 6px', background: '#1A1A1A', border: '1px solid #222', borderRadius: 2, fontSize: 6,
          color: s.defaultTrimLimit === 'full' ? '#00B4FF' : '#555', cursor: 'pointer', fontWeight: s.defaultTrimLimit === 'full' ? 700 : 400,
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
        <span style={{ fontSize: 10, fontWeight: 700, color: '#FFB800', flex: 1 }}>CHANNEL OVERRIDE</span>
        <select value={channel.id} onChange={e => setChannelId(e.target.value)} style={{
          height: 20, background: '#1A1A1A', border: '1px solid #222', borderRadius: 2, color: '#888', fontSize: 7, fontFamily: 'monospace', cursor: 'pointer',
        }}>
          {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {hasOverride && <span style={{ fontSize: 6, color: '#FFB800', background: '#FFB80015', padding: '1px 4px', borderRadius: 2, border: '1px solid #FFB80044' }}>override</span>}
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
          flex: 1, height: 20, background: chSettings?.autoSplit ? '#00B4FF20' : '#1A1A1A',
          border: `1px solid ${chSettings?.autoSplit ? '#00B4FF44' : '#222'}`, borderRadius: 2, fontSize: 6, cursor: 'pointer',
          color: chSettings?.autoSplit ? '#00B4FF' : '#555', fontWeight: 700,
        }}>Auto-split</button>
        <button onClick={() => handleOverride({ autoSplit: false })} style={{
          flex: 1, height: 20, background: chSettings?.autoSplit === false ? '#00B4FF20' : '#1A1A1A',
          border: `1px solid ${chSettings?.autoSplit === false ? '#00B4FF44' : '#222'}`, borderRadius: 2, fontSize: 6, cursor: 'pointer',
          color: chSettings?.autoSplit === false ? '#00B4FF' : '#555',
        }}>No split</button>
      </div>

      {hasOverride && (
        <button onClick={() => { useAppStore.getState().updateChannel(channel.id, { settings: undefined as any }); ipc.updateChannel(channel.id, { settings: undefined }) }} style={{
          width: '100%', height: 20, background: '#1A1A1A', border: '1px solid #FF444422', borderRadius: 2, fontSize: 6, color: '#FF4444', cursor: 'pointer',
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
        <div style={{ flex: 1, height: 5, background: '#1A1A1A', borderRadius: 2 }}>
          <div style={{ width: `${Math.min(usedPct, 100)}%`, height: '100%', background: usedPct > 80 ? '#FF4444' : '#00B4FF', borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: 7, color: '#00B4FF66', fontFamily: 'monospace' }}>{usedMB}MB / {freeGB}GB free</span>
      </div>

      <div style={{ marginBottom: 3 }}>
        <div style={{ fontSize: 7, color: '#555', marginBottom: 1 }}>Video path</div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <div style={{ flex: 1, background: '#0A0A0A', border: '1px solid #222', borderRadius: 2, padding: '2px 5px', fontSize: 7, color: '#444', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.videoStoragePath || '(default)'}</div>
          <button onClick={async () => { const r = await ipc.pickFolder(s.videoStoragePath); if (r?.path) { onChange({ videoStoragePath: r.path } as any); ipc.updateSettings({ videoStoragePath: r.path }) } }} style={{ padding: '2px 5px', background: '#1A1A1A', border: '1px solid #222', borderRadius: 2, fontSize: 7, color: '#555', cursor: 'pointer', flexShrink: 0 }}>📁</button>
        </div>
      </div>

      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 7, color: '#555', marginBottom: 1 }}>Output path</div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <div style={{ flex: 1, background: '#0A0A0A', border: '1px solid #222', borderRadius: 2, padding: '2px 5px', fontSize: 7, color: '#444', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.outputPath || '(default)'}</div>
          <button onClick={async () => { const r = await ipc.pickFolder(s.outputPath); if (r?.path) { onChange({ outputPath: r.path } as any); ipc.updateSettings({ outputPath: r.path }) } }} style={{ padding: '2px 5px', background: '#1A1A1A', border: '1px solid #222', borderRadius: 2, fontSize: 7, color: '#555', cursor: 'pointer', flexShrink: 0 }}>📁</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
        <button onClick={() => storageStats?.downloadPath && ipc.openFolder(storageStats.downloadPath)} style={{ flex: 1, height: 20, background: '#1A1A1A', border: '1px solid #222', borderRadius: 2, fontSize: 6, color: '#555', cursor: 'pointer' }}>Mở thư mục</button>
        <button onClick={async () => { const r = await ipc.clearDownloads(); if (r.success) showToast(`Freed ${r.freedMB}MB`) }} style={{ flex: 1, height: 20, background: '#1A1A1A', border: '1px solid #FF444422', borderRadius: 2, fontSize: 6, color: '#FF4444', cursor: 'pointer' }}>Xóa cache</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 7, color: '#555' }}>Tự động xóa sau</span>
        <select value={s.downloadsCleanupDays} onChange={e => onChange({ downloadsCleanupDays: Number(e.target.value) } as any)} style={{ height: 20, flex: 1, background: '#1A1A1A', border: '1px solid #222', borderRadius: 2, color: '#00B4FF', fontSize: 7, fontFamily: 'monospace', cursor: 'pointer' }}>
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
      <div style={{ fontSize: 7, color: '#555', lineHeight: 1.7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: consented > 0 ? '#00FF88' : '#333', flexShrink: 0 }} />
          Innertube: <span style={{ color: consented > 0 ? '#00FF88' : '#555', fontWeight: 600 }}>{consented}/{sessionStatus?.sessionCount ?? 0}</span> sessions
          {innertubeDegraded && <span style={{ color: '#FFB800', fontSize: 6, background: '#FFB80020', padding: '0 4px', borderRadius: 2 }}>DEGRADED</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: healthPct >= 50 ? '#00FF88' : healthPct > 0 ? '#FFB800' : '#333', flexShrink: 0 }} />
          Session health: <span style={{ color: healthPct >= 50 ? '#00FF88' : '#FFB800', fontWeight: 600 }}>{healthPct}%</span>
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
      <div style={{ fontSize: 7, color: '#555', lineHeight: 1.7 }}>
        <div>GPU: <span style={{ color: '#888' }}>{systemStats.gpuName || 'N/A'} · {systemStats.gpuTemp || 0}°C · {systemStats.gpuUsage || 0}%</span></div>
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

export function SettingsPanel({ settings, systemStats, channels, onSettingsChange }: Props) {
  return (
    <div style={{ flex: 1, background: '#121212', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{ fontSize: 8, color: '#555', fontWeight: 700, padding: '5px 10px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0D0D0D' }}>
        <span style={{ letterSpacing: 1 }}>SETTINGS</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <a href="/settings?tab=sessions" style={{ padding: '1px 5px', border: '1px solid #222', borderRadius: 2, fontSize: 6, color: '#555', textDecoration: 'none' }}>Sessions</a>
          <a href="/settings?tab=projects" style={{ padding: '1px 5px', border: '1px solid #222', borderRadius: 2, fontSize: 6, color: '#555', textDecoration: 'none' }}>Projects</a>
          <a href="/settings?tab=keys" style={{ padding: '1px 5px', border: '1px solid #222', borderRadius: 2, fontSize: 6, color: '#555', textDecoration: 'none' }}>Keys</a>
          <a href="/settings?tab=diag" style={{ padding: '1px 5px', border: '1px solid #FF444422', borderRadius: 2, fontSize: 6, color: '#FF444466', textDecoration: 'none' }}>Diag</a>
        </div>
      </div>

      {/* 2-column cards */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start' }}>
        <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column' }}>
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
