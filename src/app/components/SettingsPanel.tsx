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

export function SettingsPanel({ settings, systemStats }: Props) {
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
      <StorageCard />

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

function StorageCard() {
  const showToast = useAppStore(s => s.showToast)
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
          {storageStats?.downloadPath || '…'}
        </div>
      </div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 8, color: '#444' }}>Output path</div>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          {storageStats?.outputPath || '…'}
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
      <StatRow label="Innertube" value="30/30 sessions" />
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
