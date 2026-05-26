'use client'

import type { SystemStats } from '../types'
import type { AppSettings } from '../lib/store'

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
