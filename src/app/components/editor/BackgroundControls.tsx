'use client'

interface Props {
  type: 'blur' | 'solid' | 'image'
  color?: string
  onTypeChange: (t: 'blur' | 'solid' | 'image') => void
  onRegenerateBlur: () => void
  onUploadImage: () => void
}

export function BackgroundControls({ type, color, onTypeChange, onRegenerateBlur, onUploadImage }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {/* Type selector */}
      <div className="grid grid-cols-3 gap-1.5">
        {(['blur', 'solid', 'image'] as const).map((t) => {
          const isActive = type === t
          return (
            <button
              key={t}
              onClick={() => onTypeChange(t)}
              style={{
                height: 28,
                background: isActive ? '#00B4FF15' : '#1A1A1A',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: isActive ? '#00B4FF' : '#222',
                borderRadius: 3,
                fontSize: 9,
                fontWeight: 700,
                color: isActive ? '#00B4FF' : '#444',
                cursor: 'pointer',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                transition: 'all 0.15s',
              }}
            >
              {t === 'blur' ? 'BLUR' : t === 'solid' ? 'SOLID' : 'IMAGE'}
            </button>
          )
        })}
      </div>

      {/* Solid color picker */}
      {type === 'solid' && (
        <div style={{ position: 'relative', height: 28, borderRadius: 3, background: color || '#000', border: '1px solid #222' }}>
          <input
            type="color"
            value={color || '#000000'}
            onChange={(e) => {}}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
          />
        </div>
      )}

      {/* Blur regenerate */}
      {type === 'blur' && (
        <button
          onClick={onRegenerateBlur}
          style={{
            height: 28,
            background: '#1A1A1A',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: '#222',
            borderRadius: 3,
            fontSize: 9,
            fontWeight: 600,
            color: '#555',
            cursor: 'pointer',
            letterSpacing: '0.04em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#00B4FF44'
            e.currentTarget.style.color = '#00B4FF'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#222'
            e.currentTarget.style.color = '#555'
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
          </svg>
          REGENERATE BLUR
        </button>
      )}

      {/* Image upload */}
      {type === 'image' && (
        <button
          onClick={onUploadImage}
          style={{
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
          ↑ UPLOAD BACKGROUND IMAGE
        </button>
      )}
    </div>
  )
}