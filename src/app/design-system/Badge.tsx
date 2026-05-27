'use client'

import { fontSize } from './tokens'

interface BadgeProps {
  label: string
  color: string
  dot?: boolean
  pulse?: boolean
  size?: 'sm' | 'md'
}

export function Badge({ label, color, dot = true, pulse = false, size = 'sm' }: BadgeProps) {
  const fSize = size === 'sm' ? fontSize.xs : fontSize.sm
  const dotSize = size === 'sm' ? 6 : 8
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: `${color}15`,
      border: `1px solid ${color}44`,
      borderRadius: 3,
      padding: size === 'sm' ? '2px 6px' : '3px 8px',
      fontSize: fSize,
      fontWeight: 700,
      color,
      letterSpacing: '0.03em',
    }}>
      {dot && (
        <span style={{
          width: dotSize, height: dotSize, borderRadius: '50%',
          background: color,
          boxShadow: pulse ? `0 0 6px ${color}` : undefined,
          animation: pulse ? 'pulse 1.5s ease-in-out infinite' : undefined,
          flexShrink: 0,
        }} />
      )}
      {label}
    </div>
  )
}
