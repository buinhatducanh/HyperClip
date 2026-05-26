'use client'

import { ipc } from '../lib/ipc'
import type { SystemStats } from '../types'
import type { AppSettings } from '../lib/store'

interface Props {
  settings: AppSettings
  systemStats: SystemStats
  onSettingsChange: (patch: Partial<AppSettings>) => void
}

export function TopBar({ settings, systemStats, onSettingsChange }: Props) {
  const gpuPct = Math.min(systemStats.gpuUsage ?? 0, 100)
  const ramPct = systemStats.ramTotal > 0
    ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100)
    : 0

  const partsLabel = (settings as any).autoSplitParts > 1
    ? `${(settings as any).autoSplitParts}p`
    : (settings as any).autoSplitMinutes > 0
      ? `${(settings as any).autoSplitMinutes}m/p`
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
      <span style={{ fontSize: 8, color: '#555' }}>
        Trim {settings.defaultTrimLimit === 'full' ? 'FULL' : `${settings.defaultTrimLimit}m`}
      </span>

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
