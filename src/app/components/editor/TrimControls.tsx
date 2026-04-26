'use client'

interface Props {
  start: number
  end: number
  duration: number
  onChange: (start: number, end: number) => void
}

export function TrimControls({ start, end, duration, onChange }: Props) {
  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0')
    const s = Math.floor(sec % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const startSec = (start / 100) * duration
  const endSec = (end / 100) * duration
  const selectedDuration = Math.max(0, endSec - startSec)

  return (
    <div>
      {/* Dual handle slider */}
      <div style={{ position: 'relative', height: 20, marginBottom: 4 }}>
        {/* Track background */}
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          left: 0, right: 0, height: 4, background: '#1A1A1A', borderRadius: 2,
        }} />
        {/* Selected range */}
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          left: `${start}%`, width: `${end - start}%`,
          height: 4, background: '#00B4FF', borderRadius: 2,
          boxShadow: '0 0 6px rgba(0,180,255,0.4)',
        }} />
        {/* Start handle */}
        <div
          style={{
            position: 'absolute', top: '50%',
            left: `${start}%`, transform: 'translate(-50%, -50%)',
            width: 12, height: 12, borderRadius: '50%',
            background: '#fff', border: '2px solid #00B4FF',
            cursor: 'ew-resize', zIndex: 2,
          }}
          onMouseDown={(e) => {
            e.stopPropagation()
            const container = e.currentTarget.parentElement!
            const rect = container.getBoundingClientRect()
            const onMove = (me: MouseEvent) => {
              const pct = Math.max(0, Math.min(end - 1, ((me.clientX - rect.left) / rect.width) * 100))
              onChange(pct, end)
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
        />
        {/* End handle */}
        <div
          style={{
            position: 'absolute', top: '50%',
            left: `${end}%`, transform: 'translate(-50%, -50%)',
            width: 12, height: 12, borderRadius: '50%',
            background: '#fff', border: '2px solid #00B4FF',
            cursor: 'ew-resize', zIndex: 2,
          }}
          onMouseDown={(e) => {
            e.stopPropagation()
            const container = e.currentTarget.parentElement!
            const rect = container.getBoundingClientRect()
            const onMove = (me: MouseEvent) => {
              const pct = Math.max(start + 1, Math.min(100, ((me.clientX - rect.left) / rect.width) * 100))
              onChange(start, pct)
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
        />
      </div>

      {/* Timestamps */}
      <div className="flex justify-between" style={{ opacity: 0.5 }}>
        <span style={{ fontSize: 8, fontFamily: 'monospace' }}>{fmtTime(startSec)}</span>
        <span style={{ fontSize: 8, color: '#00B4FF', fontFamily: 'monospace' }}>
          {fmtTime(selectedDuration)} selected
        </span>
        <span style={{ fontSize: 8, fontFamily: 'monospace' }}>{fmtTime(endSec)}</span>
      </div>
    </div>
  )
}