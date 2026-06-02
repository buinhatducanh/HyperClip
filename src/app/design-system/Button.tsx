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

const variantStyles: Record<string, { bg: string; color: string; border: string; hoverBg: string; hoverColor?: string }> = {
  primary:   { bg: colors.accent,     color: colors.textWhite, border: 'transparent', hoverBg: colors.accentHover,   hoverColor: colors.textWhite },
  secondary: { bg: colors.bg,        color: colors.text,     border: colors.border,  hoverBg: colors.borderHover,  hoverColor: colors.text      },
  ghost:     { bg: 'transparent',     color: colors.textSecondary, border: 'transparent', hoverBg: colors.surfaceHover, hoverColor: colors.text },
  danger:    { bg: colors.error,      color: colors.textWhite, border: 'transparent', hoverBg: colors.errorHover,    hoverColor: colors.textWhite },
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
        transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease',
        ...style,
      }}
      onMouseEnter={disabled ? undefined : (e) => {
        e.currentTarget.style.background = v.hoverBg
        if (v.hoverColor) e.currentTarget.style.color = v.hoverColor
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)'
      }}
      onMouseLeave={disabled ? undefined : (e) => {
        e.currentTarget.style.background = v.bg
        e.currentTarget.style.color = v.color
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {children}
    </button>
  )
}
