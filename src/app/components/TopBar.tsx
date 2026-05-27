'use client'
import { colors, spacing, fontSize } from '../design-system/tokens'

import { useState, useEffect } from 'react'
import { ipc } from '../lib/ipc'
import type { SystemStats } from '../types'
import type { AppSettings } from '../lib/store'

interface Props {
  settings: AppSettings
  systemStats: SystemStats
  onSettingsChange: (patch: Partial<AppSettings>) => void
}

interface HardwareProfileInfo {
  active: string | null
  presets: Array<{ id: string; label: string; vramGB: number; ramGB: number }>
}

export function TopBar({ settings, systemStats, onSettingsChange }: Props) {
  const gpuPct = Math.min(systemStats.gpuUsage ?? 0, 100)
  const ramPct = systemStats.ramTotal > 0
    ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100)
    : 0
  const [hwProfile, setHwProfile] = useState<HardwareProfileInfo | null>(null)

  useEffect(() => {
    ipc.getHardwareProfile().then((d) => {
      setHwProfile(d as HardwareProfileInfo)
    }).catch(() => {})
    const t = setInterval(() => {
      ipc.getHardwareProfile().then((d) => setHwProfile(d as HardwareProfileInfo)).catch(() => {})
    }, 30000)
    return () => clearInterval(t)
  }, [])

  const activePreset = hwProfile?.presets.find(p => p.id === hwProfile.active)

  const partsLabel = (settings as any).autoSplitParts > 1
    ? `${(settings as any).autoSplitParts}p`
    : (settings as any).autoSplitMinutes > 0
      ? `${(settings as any).autoSplitMinutes}m/p`
      : 'no split'

  return (
    <div style={{
      height: 40, background: '#0D0D0D', borderBottom: '1px solid #222',
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>HyperClip</span>
      <div style={{ width: 1, height: 16, background: '#222' }} />

      {/* Download quality */}
      <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>DOWNLOAD</span>
      <span style={{
        background: '#00FF8820', color: colors.success, padding: '3px 8px', borderRadius: 3,
        fontSize: 10, border: '1px solid #00FF8844',
      }}>
        {settings.autoDownloadQuality || '720'}p
      </span>
      <span style={{ fontSize: 10, color: '#555' }}>
        Trim {settings.defaultTrimLimit === 'full' ? 'FULL' : `${settings.defaultTrimLimit}m`}
      </span>

      <div style={{ width: 1, height: 16, background: '#222' }} />

      {/* Auto-render toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>AUTO RENDER</span>
        <div
          onClick={() => {
            const newVal = !settings.autoRender
            onSettingsChange({ autoRender: newVal })
            ipc.updateSettings({ autoRender: newVal })
          }}
          style={{
            width: 36, height: 18, cursor: 'pointer',
            background: settings.autoRender ? colors.success : colors.text,
            border: `1px solid ${settings.autoRender ? '#00FF8866' : '#333'}`,
            borderRadius: 9, position: 'relative', transition: 'background 0.15s',
          }}
        >
          <div style={{
            width: 14, height: 14, background: settings.autoRender ? '#000' : '#555',
            borderRadius: '50%', position: 'absolute', top: 2,
            left: settings.autoRender ? 'unset' : 2, right: settings.autoRender ? 2 : 'unset',
            transition: 'all 0.15s',
          }} />
        </div>
      </div>
      <span style={{ fontSize: 10, color: '#555' }}>
        {activePreset ? `${activePreset.label}` : 'Auto'}
      </span>
      <span style={{ fontSize: 10, color: '#444' }}>·</span>
      <span style={{ fontSize: 10, color: '#555' }}>
        {settings.autoRenderResolution || '1080p'}·{settings.autoRenderFPS || 30}fps·{partsLabel}
      </span>

      <div style={{ flex: 1 }} />

      {/* System health mini */}
      <span style={{ fontSize: 10, color: '#555' }}>GPU {systemStats.gpuTemp || 0}°</span>
      <div style={{ width: 40, height: 4, background: '#222', borderRadius: 2 }}>
        <div style={{ width: `${gpuPct}%`, height: '100%', background: gpuPct > 90 ? colors.error : colors.success, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 10, color: '#555' }}>RAM {Math.round(systemStats.ramUsed || 0)}/{Math.round(systemStats.ramTotal || 64)}G</span>
      <div style={{ width: 40, height: 4, background: '#222', borderRadius: 2 }}>
        <div style={{ width: `${ramPct}%`, height: '100%', background: ramPct > 80 ? colors.error : colors.accent, borderRadius: 2 }} />
      </div>
    </div>
  )
}
