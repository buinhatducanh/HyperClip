'use client'

import { px, type SpacingKey, colors } from './tokens'

interface CardProps {
  children: React.ReactNode
  padding?: SpacingKey | number
  border?: boolean
  hover?: boolean
  className?: string
  style?: React.CSSProperties
}

export function Card({
  children, padding = 'lg', border = true, hover = false,
  className = '', style = {},
}: CardProps) {
  return (
    <div
      className={className}
      style={{
        background: colors.surface,
        borderRadius: 6,
        padding: px(padding),
        border: border ? `1px solid ${colors.border}` : 'none',
        transition: hover ? 'box-shadow 0.15s, border-color 0.15s' : undefined,
        ...(hover ? { cursor: 'pointer' } : {}),
        ...style,
      }}
      onMouseEnter={hover ? (e) => {
        e.currentTarget.style.borderColor = colors.borderHover
        e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'
      } : undefined}
      onMouseLeave={hover ? (e) => {
        e.currentTarget.style.borderColor = colors.border
        e.currentTarget.style.boxShadow = 'none'
      } : undefined}
    >
      {children}
    </div>
  )
}
