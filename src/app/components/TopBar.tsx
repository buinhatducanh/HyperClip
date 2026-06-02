'use client'

import { memo } from 'react'
import type { AppSettings } from '../lib/store'
import { colors, spacing, fontSize } from '../design-system/tokens'
interface Props {
  settings: AppSettings
  onSettingsChange: (patch: Partial<AppSettings>) => void
}

export const TopBar = memo(function TopBar({ settings, onSettingsChange }: Props) {
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

      <div style={{ flex: 1 }} />
    </div>
  )
})
