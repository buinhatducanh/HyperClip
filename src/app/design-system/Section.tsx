'use client'

import { useState } from 'react'
import { fontSize, colors, spacing } from './tokens'

interface SectionProps {
  label: string
  color?: string
  children: React.ReactNode
  defaultOpen?: boolean
  actions?: React.ReactNode
}

export function Section({
  label, color = colors.accent, children, defaultOpen = true, actions,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: `1px solid ${colors.borderLight}`, marginBottom: 0 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: spacing.sm,
          width: '100%', padding: `${spacing.md}px ${spacing.lg}px`,
          background: 'transparent', border: 'none',
          cursor: 'pointer', fontSize: fontSize.sm, fontWeight: 600,
          color: colors.text,
        }}
      >
        <div style={{
          width: 3, height: 14, borderRadius: 2, background: color, flexShrink: 0,
        }} />
        <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
        {actions}
        <svg width="10" height="10" viewBox="0 0 10 10" style={{
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>
          <path d="M2 4l3 3 3-3" stroke="#888" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div style={{ padding: `0 ${spacing.lg}px ${spacing.md}px` }}>
          {children}
        </div>
      )}
    </div>
  )
}
