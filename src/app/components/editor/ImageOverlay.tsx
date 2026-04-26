'use client'

interface Props {
  position: 'top' | 'bottom' | 'overlay'
  onPositionChange: (p: 'top' | 'bottom' | 'overlay') => void
  onUpload: () => void
  hasImage: boolean
  onRemove: () => void
}

export function ImageOverlay({ position, onPositionChange, onUpload, hasImage, onRemove }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {/* Position selector */}
      <div className="grid grid-cols-3 gap-1.5">
        {(['top', 'bottom', 'overlay'] as const).map((p) => {
          const isActive = position === p
          const labels = { top: 'TOP', bottom: 'BOTTOM', overlay: 'OVERLAY' }
          return (
            <button
              key={p}
              onClick={() => onPositionChange(p)}
              style={{
                height: 28,
                background: isActive ? '#00B4FF15' : '#1A1A1A',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: isActive ? '#00B4FF' : '#222',
                borderRadius: 3,
                fontSize: 8,
                fontWeight: 700,
                color: isActive ? '#00B4FF' : '#444',
                cursor: 'pointer',
                letterSpacing: '0.06em',
                transition: 'all 0.15s',
              }}
            >
              {labels[p]}
            </button>
          )
        })}
      </div>

      {/* Upload / Remove */}
      <div className="flex gap-1.5">
        {!hasImage ? (
          <button
            onClick={onUpload}
            style={{
              flex: 1,
              height: 28,
              background: '#1A1A1A',
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: '#222',
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 600,
              color: '#444',
              cursor: 'pointer',
              letterSpacing: '0.04em',
              transition: 'all 0.15s',
            }}
          >
            ↑ UPLOAD ASSET
          </button>
        ) : (
          <>
            <div
              style={{
                flex: 1,
                height: 28,
                background: '#00FF8810',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: '#00FF8822',
                borderRadius: 3,
                fontSize: 9,
                fontWeight: 600,
                color: '#00FF88',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#00FF88" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              ATTACHED
            </div>
            <button
              onClick={onRemove}
              style={{
                height: 28,
                width: 28,
                background: '#FF444410',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: '#FF444422',
                borderRadius: 3,
                fontSize: 11,
                color: '#FF4444',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              ×
            </button>
          </>
        )}
      </div>
    </div>
  )
}