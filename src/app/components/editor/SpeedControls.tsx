'use client'

interface Props {
  speed: number
  onChange: (speed: number) => void
}

const SPEEDS = [1.0, 1.1, 1.2, 1.5]

export function SpeedControls({ speed, onChange }: Props) {
  return (
    <div className="flex gap-1.5">
      {SPEEDS.map((s) => {
        const isActive = speed === s
        return (
          <button
            key={s}
            onClick={() => onChange(s)}
            style={{
              flex: 1,
              height: 28,
              background: isActive ? '#00B4FF' : '#1A1A1A',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: isActive ? '#00B4FF' : '#222',
              borderRadius: 3,
              fontSize: 10,
              fontWeight: 700,
              color: isActive ? '#000' : '#444',
              cursor: 'pointer',
              letterSpacing: '0.02em',
              fontFamily: 'monospace',
              transition: 'all 0.15s',
            }}
          >
            {s}x
          </button>
        )
      })}
    </div>
  )
}