'use client'

import { useState } from 'react'

interface Props {
  defaultTrimLimit: number | 'full'
  onAddTracker: (url: string, trimLimit: number | 'full') => void
  onAddChannel: (url: string) => void
}

export function InputBar({ defaultTrimLimit, onAddTracker, onAddChannel }: Props) {
  const [url, setUrl] = useState('')
  const [trimMinutes, setTrimMinutes] = useState<number>(typeof defaultTrimLimit === 'number' ? defaultTrimLimit : 10)
  const [isFull, setIsFull] = useState(defaultTrimLimit === 'full')
  const [loading, setLoading] = useState(false)

  const isValidUrl = (u: string) =>
    u.includes('youtube.com') || u.includes('youtu.be')

  const isChannelUrl = (u: string) => {
    const lower = u.toLowerCase()
    return lower.includes('/channel/') ||
      lower.includes('/c/') ||
      lower.includes('/@') ||
      lower.includes('/user/') ||
      lower.includes('/videos/') ||
      lower.includes('/playlists')
  }

  const handleSubmit = async () => {
    if (!url.trim() || !isValidUrl(url)) return
    setLoading(true)
    try {
      if (isChannelUrl(url)) {
        await onAddChannel(url.trim())
      } else {
        await onAddTracker(url.trim(), isFull ? 'full' : trimMinutes)
      }
      setUrl('')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
  }

  const canAdd = isValidUrl(url) && !loading
  const isChannel = isChannelUrl(url)

  return (
    <div
      className="flex items-center gap-3 px-4 shrink-0"
      style={{
        height: 56,
        background: '#121212',
        borderBottom: '1px solid #1E1E1E',
      }}
    >
      {/* URL Input */}
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste YouTube Video URL or Channel URL..."
          style={{
            width: '100%',
            height: 36,
            background: '#1A1A1A',
            border: '1px solid #252525',
            borderRadius: 4,
            paddingLeft: 36,
            paddingRight: 12,
            fontSize: 12,
            color: '#ccc',
            outline: 'none',
            fontFamily: 'Inter, sans-serif',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = '#00B4FF44' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = '#252525' }}
        />
        {/* Search icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#444"
          strokeWidth="2"
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </div>

      {/* Trim input — only for video URLs */}
      {!isChannel && (
        <div className="flex items-center gap-1" style={{ height: 36 }}>
          {/* Numeric minutes input */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              max={60}
              value={isFull ? '' : trimMinutes}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (!isNaN(v) && v > 0) {
                  setTrimMinutes(v)
                  setIsFull(false)
                }
              }}
              onFocus={() => setIsFull(false)}
              disabled={isFull}
              style={{
                width: 52,
                height: 36,
                background: isFull ? '#151515' : '#1A1A1A',
                border: '1px solid #252525',
                borderRadius: 4,
                paddingRight: 28,
                paddingLeft: 8,
                fontSize: 11,
                fontWeight: 600,
                color: isFull ? '#444' : '#888',
                outline: 'none',
                fontFamily: 'Inter, sans-serif',
                textAlign: 'right',
              }}
            />
            <span style={{
              position: 'absolute',
              right: 8,
              fontSize: 10,
              color: '#444',
              fontFamily: 'Inter, sans-serif',
              pointerEvents: 'none',
            }}>min</span>
          </div>

          {/* Full toggle */}
          <button
            onClick={() => setIsFull(f => !f)}
            style={{
              height: 36,
              paddingLeft: 8,
              paddingRight: 8,
              background: isFull ? '#00FF8822' : 'transparent',
              border: `1px solid ${isFull ? '#00FF8844' : '#252525'}`,
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              color: isFull ? '#00FF88' : '#555',
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            FULL
          </button>
        </div>
      )}

      {/* Add Button */}
      <button
        onClick={handleSubmit}
        disabled={!canAdd}
        style={{
          height: 36,
          paddingLeft: 16,
          paddingRight: 16,
          background: canAdd ? (isChannel ? '#00FF88' : '#00B4FF') : '#1A1A1A',
          border: '1px solid',
          borderColor: canAdd ? (isChannel ? '#00FF88' : '#00B4FF') : '#252525',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 700,
          color: canAdd ? '#000' : '#444',
          cursor: canAdd ? 'pointer' : 'not-allowed',
          letterSpacing: '0.05em',
          fontFamily: 'Inter, sans-serif',
          whiteSpace: 'nowrap',
          transition: 'all 0.15s',
        }}
      >
        {loading ? '...' : isChannel ? '+ TRACK CHANNEL' : '+ ADD VIDEO'}
      </button>
    </div>
  )
}