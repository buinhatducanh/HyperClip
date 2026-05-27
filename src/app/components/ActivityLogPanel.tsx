'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import type { ActivityEntry } from './ActivityLog'

interface Props {
  entries: ActivityEntry[]
  onClear?: () => void
}

function formatRelTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 5) return 'now'
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  detected:   { icon: '●', color: '#00B4FF' },
  downloading:{ icon: '↓', color: '#FFB800' },
  downloaded: { icon: '✓', color: '#00FF88' },
  rendering: { icon: '⚡', color: '#7C3AED' },
  done:      { icon: '✓', color: '#00FF88' },
  error:     { icon: '✗', color: '#FF4444' },
  warning:   { icon: '⚠', color: '#FFB800' },
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, fontWeight: 700, letterSpacing: '0.06em' }}>
      <span style={{ color: '#555' }}>{label}:</span>
      <span style={{ color, fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}

export function ActivityLogPanel({ entries, onClear }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (entries.length > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevLenRef.current = entries.length
  }, [entries])

  // Counts
  const counts = useMemo(() => ({
    det: entries.filter(e => e.type === 'detected').length,
    dl:  entries.filter(e => e.type === 'downloading').length,
    ok:  entries.filter(e => e.type === 'done' || e.type === 'downloaded').length,
    err: entries.filter(e => e.type === 'error').length,
  }), [entries])

  const displayEntries = entries.slice(-80)

  return (
    <div style={{
      height: 180, flexShrink: 0,
      borderTop: '1px solid #1E1E1E',
      background: '#0D0D0D',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header stats bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 12px',
        borderBottom: '1px solid #1A1A1A',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 8, color: '#00B4FF', fontWeight: 700, letterSpacing: '0.06em', marginRight: 4 }}>ACT</span>

        <StatChip label="DET" value={counts.det} color="#00B4FF" />
        <StatChip label="DL"  value={counts.dl}  color="#FFB800" />
        <StatChip label="OK"  value={counts.ok}  color="#00FF88" />
        {counts.err > 0 && <StatChip label="ERR" value={counts.err} color="#FF4444" />}

        <div style={{ flex: 1 }} />

        {onClear && (
          <button
            onClick={onClear}
            style={{
              fontSize: 8, fontWeight: 700, color: '#555', background: 'transparent',
              border: 'none', cursor: 'pointer', letterSpacing: '0.06em', padding: '2px 6px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#FF4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          >
            [Clear]
          </button>
        )}
      </div>

      {/* Entry list */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '4px 12px',
        fontFamily: 'monospace', fontSize: 10, lineHeight: 1.7,
      }}>
        {displayEntries.length === 0 && (
          <div style={{ color: '#333', padding: '4px 0' }}>No activity</div>
        )}
        {displayEntries.map(e => {
          const cfg = TYPE_CONFIG[e.type] || TYPE_CONFIG.info
          return (
            <div
              key={e.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                color: '#aaa', marginBottom: 1,
                background: e.type === 'error' ? 'rgba(255,68,68,0.05)' : 'transparent',
                borderRadius: 2, padding: '1px 2px',
              }}
            >
              {/* Relative time */}
              <span style={{ color: '#555', fontSize: 9, minWidth: 28, flexShrink: 0 }}>
                {formatRelTime(e.timestamp)}
              </span>
              {/* Icon */}
              <span style={{ color: cfg.color, flexShrink: 0, fontSize: 10 }}>
                {cfg.icon}
              </span>
              {/* Message */}
              <span style={{ color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.message}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
