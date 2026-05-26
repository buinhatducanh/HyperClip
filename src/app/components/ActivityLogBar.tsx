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
  success: '#00FF88',
  info: '#888',
  warning: '#FFB800',
  error: '#FF4444',
  render: '#7C3AED',
}

const LEVEL_ICONS: Record<string, string> = {
  success: '✓',
  info: '●',
  warning: '⚠',
  error: '✗',
  render: '⚡',
}

export function ActivityLogBar({ entries, etaDisplay }: Props) {
  const [tab, setTab] = useState<LogTab>('activity')
  const [expanded, setExpanded] = useState(false)

  const errorCount = useMemo(() => entries.filter(e => e.type === 'error').length, [entries])

  const displayEntries = expanded ? entries.slice(0, 15) : entries.slice(0, 5)

  return (
    <div style={{
      height: expanded ? 200 : 75,
      background: '#0D0D0D', borderTop: '1px solid #1E1E1E',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      transition: 'height 0.15s ease',
    }}>
      {/* Tabs bar */}
      <div style={{ display: 'flex', alignItems: 'center', height: 22, padding: '0 10px', borderBottom: '1px solid #1A1A1A', flexShrink: 0 }}>
        {(['activity', 'errors', 'system'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              height: '100%', padding: '0 8px', border: 'none', borderBottom: tab === t ? '2px solid #00B4FF' : '2px solid transparent',
              background: 'transparent', color: tab === t ? '#888' : '#444',
              fontSize: 9, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.06em',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {t.toUpperCase()}
            {t === 'errors' && errorCount > 0 && (
              <span style={{ fontSize: 8, color: '#FF4444', fontFamily: 'monospace' }}>●{errorCount}</span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            height: 18, padding: '0 6px', border: '1px solid #222', borderRadius: 3,
            background: 'transparent', color: '#444', fontSize: 8, cursor: 'pointer',
          }}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* Log lines */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '3px 8px' }}>
        {tab === 'activity' && (
          <div style={{ fontFamily: 'monospace', fontSize: 9, lineHeight: '16px' }}>
            {displayEntries.length === 0 ? (
              <span style={{ color: '#333' }}>No activity yet</span>
            ) : (
              displayEntries.map(e => {
                const time = new Date(e.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                const color = LEVEL_COLORS[e.type] || '#888'
                const icon = LEVEL_ICONS[e.type] || '●'
                const eta = e.workspaceId ? etaDisplay?.get(e.workspaceId) : undefined
                return (
                  <div key={e.id} style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#333' }}>[{time}]</span>{' '}
                    <span style={{ color }}>{icon}</span>{' '}
                    <span>{e.message}</span>
                    {e.detail && <span style={{ color: '#444' }}> · {e.detail}</span>}
                    {eta && <span style={{ color: '#7C3AED' }}> · {eta}</span>}
                  </div>
                )
              })
            )}
          </div>
        )}
        {tab === 'errors' && (
          <div style={{ fontFamily: 'monospace', fontSize: 9, lineHeight: '16px', color: '#666' }}>
            {entries.filter(e => e.type === 'error').length === 0 ? (
              <span style={{ color: '#333' }}>No errors</span>
            ) : (
              entries.filter(e => e.type === 'error').slice(0, 10).map(e => (
                <div key={e.id} style={{ color: '#FF444488' }}>
                  [{new Date(e.timestamp).toLocaleTimeString()}] ✗ {e.message}
                </div>
              ))
            )}
          </div>
        )}
        {tab === 'system' && (
          <div style={{ color: '#444', fontSize: 9, fontFamily: 'monospace', lineHeight: '16px' }}>
            System info available in ActivityLogBar expand
          </div>
        )}
      </div>
    </div>
  )
}
