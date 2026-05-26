'use client'

import { useState, useMemo } from 'react'
import type { ActivityEntry } from './ActivityLog'

interface Props {
  entries: ActivityEntry[]
  etaDisplay?: Map<string, string>
  onCompare?: (workspaceId: string) => void
  renderedWorkspaceIds?: Set<string>
}

type LogTab = 'activity' | 'errors' | 'system'

const LEVEL_COLORS: Record<string, string> = {
  success: '#00FF88', info: '#888', warning: '#FFB800', error: '#FF4444', render: '#7C3AED',
}
const LEVEL_ICONS: Record<string, string> = {
  success: '✓', info: '●', warning: '⚠', error: '✗', render: '⚡',
}

export function ActivityLogBar({ entries, etaDisplay }: Props) {
  const [tab, setTab] = useState<LogTab>('activity')
  const [expanded, setExpanded] = useState(false)

  const errorCount = useMemo(() => entries.filter(e => e.type === 'error').length, [entries])
  const displayEntries = expanded ? entries.slice(0, 15) : entries.slice(0, 5)

  return (
    <div style={{
      height: expanded ? 200 : 75,
      background: '#0A0A0A', borderTop: '1px solid #222',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      transition: 'height 0.2s',
    }}>
      {/* Tabs bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
        borderBottom: '1px solid #1A1A1A', height: 18, flexShrink: 0,
      }}>
        {(['activity', 'errors', 'system'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontSize: 6, fontWeight: 700, cursor: 'pointer', height: 14, padding: '0 6px',
              background: tab === t ? 'rgba(0,180,255,0.08)' : 'transparent',
              border: tab === t ? '1px solid #00B4FF44' : '1px solid transparent',
              borderRadius: 2, color: tab === t ? '#00B4FF' : '#555',
              display: 'flex', alignItems: 'center', gap: 3,
              fontFamily: 'monospace', letterSpacing: '0.04em',
            }}
          >
            {t.toUpperCase()}
            {t === 'errors' && errorCount > 0 && (
              <span style={{
                width: 14, height: 14, background: '#FF4444', borderRadius: '50%',
                fontSize: 6, fontWeight: 700, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {errorCount}
              </span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            fontSize: 5, color: '#333', cursor: 'pointer', background: 'none',
            border: 'none', padding: '0 4px', fontFamily: 'monospace',
          }}
        >
          {expanded ? 'collapse' : 'expand'}
        </button>
      </div>

      {/* Content */}
      <div style={{
        flex: 1, overflow: 'hidden', padding: '2px 8px',
        fontFamily: 'monospace', fontSize: expanded ? 7 : 6, lineHeight: 1.55,
      }}>
        {tab === 'system' ? (
          <div style={{ display: 'flex', gap: 16, padding: 4, fontSize: 7, color: '#555' }}>
            <div><span style={{ color: '#888' }}>GPU</span> NVENC</div>
            <div><span style={{ color: '#888' }}>Codec</span> H.264 p1</div>
          </div>
        ) : tab === 'errors' ? (
          entries.filter(e => e.type === 'error').length === 0 ? (
            <div style={{ color: '#333', padding: 4, fontSize: 7 }}>No errors</div>
          ) : (
            entries.filter(e => e.type === 'error').slice(0, expanded ? 15 : 5).map(e => (
              <div key={e.id} style={{ color: '#FF6B6B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ color: '#FF4444' }}>[{new Date(e.timestamp).toLocaleTimeString()}]</span> ✗ {e.message}
              </div>
            ))
          )
        ) : (
          displayEntries.length === 0 ? (
            <div style={{ color: '#333', padding: 4, fontSize: 7 }}>No activity yet</div>
          ) : (
            displayEntries.map(e => {
              const ts = new Date(e.timestamp)
              const time = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
              const color = LEVEL_COLORS[e.type] || '#888'
              const icon = LEVEL_ICONS[e.type] || '●'
              const eta = e.workspaceId ? etaDisplay?.get(e.workspaceId) : undefined
              return (
                <div key={e.id} style={{ color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color }}>[{time}]</span>
                  {' '}<span style={{ color }}>{icon}</span>
                  {' '}{e.message}
                  {e.detail ? <span style={{ color: '#555' }}> · {e.detail}</span> : null}
                  {eta ? <span style={{ color: '#7C3AED' }}> · {eta}</span> : null}
                </div>
              )
            })
          )
        )}
      </div>

      {/* Health status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px',
        borderTop: '1px solid #1A1A1A', fontSize: 5, color: '#444', height: 14, flexShrink: 0,
      }}>
        {[
          { label: 'Innertube', color: '#00FF88' },
          { label: 'OAuth', color: '#00FF88' },
          { label: 'GPU', color: '#00FF88' },
          { label: 'Disk', color: '#00FF88' },
          { label: 'Queue', color: '#FFB800' },
        ].map(dot => (
          <span key={dot.label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: dot.color }} />
            {dot.label}
          </span>
        ))}
      </div>
    </div>
  )
}
