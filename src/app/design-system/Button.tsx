'use client'

import { fontSize, colors } from './tokens'

interface ButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  onClick?: () => void
  disabled?: boolean
  style?: React.CSSProperties
  className?: string
}

const variantStyles: Record<string, { bg: string; color: string; border: string; hoverBg: string }> = {
  primary: { bg: '#3B82F6', color: '#FFFFFF', border: 'transparent', hoverBg: '#2563EB' },
  secondary: { bg: colors.bg, color: '#1A1A1A', border: colors.border, hoverBg: colors.borderLight },
  ghost: { bg: 'transparent', color: '#888888', border: 'transparent', hoverBg: colors.bg },
  danger: { bg: '#FFF0F0', color: '#EF4444', border: '#EF4444', hoverBg: '#FFE0E0' },
}

export function Button({
  children, variant = 'primary', size = 'sm',
  onClick, disabled = false, style = {}, className = '',
}: ButtonProps) {
  const v = variantStyles[variant]
  const h = size === 'sm' ? 32 : 40
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={onClick}
      style={{
        height: h, padding: `0 ${size === 'sm' ? 12 : 16}px`,
        background: v.bg, color: v.color, border: `1px solid ${v.border}`,
        borderRadius: 4,
        fontSize: size === 'sm' ? fontSize.sm : fontSize.md,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        transition: 'background 0.12s, border-color 0.12s',
        ...style,
      }}
      onMouseEnter={disabled ? undefined : (e) => {
        if (variant !== 'ghost') e.currentTarget.style.background = v.hoverBg
        else e.currentTarget.style.background = colors.bg
      }}
      onMouseLeave={disabled ? undefined : (e) => {
        e.currentTarget.style.background = v.bg
      }}
    >
      {children}
    </button>
  )
}
