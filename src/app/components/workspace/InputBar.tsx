'use client'

import { useState } from 'react'

interface Props {
  defaultTrimLimit: '5min' | '10min' | 'full'
  onAddTracker: (url: string, trimLimit: '5min' | '10min' | 'full') => void
  onAddChannel: (url: string) => void
}

export function InputBar({ defaultTrimLimit, onAddTracker, onAddChannel }: Props) {
  const [url, setUrl] = useState('')
  const [trimLimit, setTrimLimit] = useState<'5min' | '10min' | 'full'>(defaultTrimLimit)
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
        await onAddTracker(url.trim(), trimLimit)
      }
      setUrl('')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
  }

  const trimOptions: { label: string; value: '5min' | '10min' | 'full' }[] = [
    { label: 'Auto-Trim: Max 5 Min', value: '5min' },
    { label: 'Auto-Trim: Max 10 Min', value: '10min' },
    { label: 'Full Video', value: 'full' },
  ]

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

      {/* Trim dropdown — only for video URLs */}
      {!isChannel && (
        <select
          value={trimLimit}
          onChange={(e) => setTrimLimit(e.target.value as '5min' | '10min' | 'full')}
          style={{
            height: 36,
            background: '#1A1A1A',
            border: '1px solid #252525',
            borderRadius: 4,
            paddingLeft: 10,
            paddingRight: 10,
            fontSize: 11,
            fontWeight: 600,
            color: '#888',
            outline: 'none',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            minWidth: 160,
          }}
        >
          {trimOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
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
          color: canAdd ? (isChannel ? '#000' : '#000') : '#444',
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