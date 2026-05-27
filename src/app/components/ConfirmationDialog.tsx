'use client'

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
        background: '#FFFFFF',
        border: '1px solid #E0E0E0',
        borderRadius: 4,
        padding: '20px 24px',
        maxWidth: 360,
        width: '90%',
        animation: 'slideUp 0.15s ease-out',
      }}>
        {/* Title */}
        <div style={{
          fontSize: 13, fontWeight: 700, color: confirmDanger ? '#FF4444' : '#1A1A1A',
          marginBottom: 10,
        }}>
          {title}
        </div>

        {/* Message */}
        <div style={{
          fontSize: 12, color: '#666', lineHeight: 1.6,
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
              background: '#F0F0F0',
              border: '1px solid #D0D0D0',
              borderRadius: 3,
              fontSize: 11, fontWeight: 600, color: '#555',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              height: 32, padding: '0 16px',
              background: confirmDanger ? '#FF444420' : '#00B4FF20',
              border: `1px solid ${confirmDanger ? '#FF4444' : '#00B4FF'}`,
              borderRadius: 3,
              fontSize: 11, fontWeight: 700, color: confirmDanger ? '#FF4444' : '#00B4FF',
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
