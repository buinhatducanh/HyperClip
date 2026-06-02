'use client'
import { colors, spacing, fontSize } from '../design-system/tokens'

interface ConfirmationDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmDanger?: boolean   // red accent for destructive actions
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Hủy',
  confirmDanger = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.25)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        animation: 'fadeInSimple 0.15s ease-out',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        padding: '20px 24px',
        maxWidth: 360,
        width: '90%',
        animation: 'slideUp 0.15s ease-out',
      }}>
        {/* Title */}
        <div style={{
          fontSize: 13, fontWeight: 700, color: confirmDanger ? colors.error : colors.text,
          marginBottom: 10,
        }}>
          {title}
        </div>

        {/* Message */}
        <div style={{
          fontSize: 12, color: colors.textSecondary, lineHeight: 1.6,
          marginBottom: 20, whiteSpace: 'pre-line',
        }}>
          {message}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              height: 32, padding: '0 16px',
              background: colors.bg,
              border: `1px solid ${colors.borderHover}`,
              borderRadius: 3,
              fontSize: 11, fontWeight: 600, color: colors.textSecondary,
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              height: 32, padding: '0 16px',
              background: confirmDanger ? `${colors.error}20` : `${colors.accent}20`,
              border: `1px solid ${confirmDanger ? colors.error : colors.accent}`,
              borderRadius: 3,
              fontSize: 11, fontWeight: 700, color: confirmDanger ? colors.error : colors.accent,
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
