'use client'

import { useState, useEffect, memo } from 'react'
import { ipc } from '../lib/ipc'
import type { SystemStats } from '../types'
import type { AppSettings } from '../lib/store'
import { colors, spacing, fontSize } from '../design-system/tokens'
interface Props {
  settings: AppSettings
  systemStats: SystemStats
  onSettingsChange: (patch: Partial<AppSettings>) => void
}

interface HardwareProfileInfo {
  active: string | null
  presets: Array<{ id: string; label: string; vramGB: number; ramGB: number }>
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ width: 30, height: 3, background: colors.border, borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
    </div>
  )
}

export const TopBar = memo(function TopBar({ settings, systemStats, onSettingsChange }: Props) {
  const gpuPct = Math.min(systemStats.gpuUsage ?? 0, 100)
  const ramPct = systemStats.ramTotal > 0
    ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100)
    : 0
  const [hwProfile, setHwProfile] = useState<HardwareProfileInfo | null>(null)

  useEffect(() => {
    ipc.getHardwareProfile().then((d) => setHwProfile(d as HardwareProfileInfo)).catch(() => {})
    const t = setInterval(() => {
      ipc.getHardwareProfile().then((d) => setHwProfile(d as HardwareProfileInfo)).catch(() => {})
    }, 30000)
    return () => clearInterval(t)
  }, [])

  const activePreset = hwProfile?.presets.find(p => p.id === hwProfile.active)

  const vramPct = systemStats.gpuMemoryTotal > 0
    ? Math.round(((systemStats.gpuMemoryTotal - (systemStats.gpuMemoryFree ?? 0)) / systemStats.gpuMemoryTotal) * 100)
    : 0

  return (
    <div style={{
      height: 40,
      background: colors.surface,
      borderBottom: `1px solid ${colors.border}`,
      display: 'flex', alignItems: 'center',
      padding: `0 ${spacing.lg}px`,
      gap: spacing.md,
      flexShrink: 0,
    }}>
      {/* Brand */}
      <span style={{ fontSize: fontSize.sm, fontWeight: 700, color: colors.accent, letterSpacing: '0.03em' }}>
        HyperClip
      </span>

      <div style={{ width: 1, height: 14, background: colors.border }} />

      {/* Download quality badge */}
      <span style={{ fontSize: 10, fontWeight: 700, color: colors.textSecondary }}>
        DL
      </span>
      <span style={{
        background: `${colors.success}18`,
        color: colors.success, padding: '2px 6px', borderRadius: 3,
        fontSize: 10, fontWeight: 700, border: `1px solid ${colors.success}44`,
      }}>
        {settings.autoDownloadQuality || '720'}p
      </span>

      <div style={{ width: 1, height: 14, background: colors.border }} />

      {/* Auto-render toggle */}
      <span style={{ fontSize: 10, color: colors.textSecondary, fontWeight: 600 }}>RENDER</span>
      <div
        onClick={() => {
          const newVal = !settings.autoRender
          onSettingsChange({ autoRender: newVal })
          ipc.updateSettings({ autoRender: newVal })
        }}
        style={{
          width: 30, height: 16, cursor: 'pointer',
          background: settings.autoRender ? colors.success : colors.border,
          borderRadius: 8, position: 'relative', transition: 'background 0.15s',
        }}
      >
        <div style={{
          width: 12, height: 12, background: '#FFFFFF',
          borderRadius: '50%', position: 'absolute', top: 2,
          left: settings.autoRender ? 16 : 2,
          transition: 'left 0.15s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }} />
      </div>

      {activePreset ? (
        <span style={{
          fontSize: 9, fontWeight: 700, color: colors.accent,
          background: `${colors.accent}12`, padding: '2px 6px', borderRadius: 3,
        }}>
          {activePreset.label}
        </span>
      ) : (
        <span style={{ fontSize: 9, color: colors.textTertiary }}>auto</span>
      )}

      <div style={{ flex: 1 }} />

      {/* GPU */}
      <span style={{ fontSize: 9, fontFamily: 'monospace', color: colors.textSecondary, minWidth: 36 }}>
        GPU {gpuPct}%
      </span>
      <MiniBar pct={gpuPct} color={gpuPct > 90 ? colors.error : colors.accent} />

      {/* VRAM */}
      <span style={{ fontSize: 9, fontFamily: 'monospace', color: colors.textSecondary, minWidth: 36 }}>
        VRAM {vramPct}%
      </span>
      <MiniBar pct={vramPct} color={vramPct > 90 ? colors.error : colors.accent} />

      {/* RAM */}
      <span style={{ fontSize: 9, fontFamily: 'monospace', color: colors.textSecondary, minWidth: 36 }}>
        RAM {ramPct}%
      </span>
      <MiniBar pct={ramPct} color={ramPct > 80 ? colors.error : colors.success} />
    </div>
  )
})
