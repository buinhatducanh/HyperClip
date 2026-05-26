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
  const errorCount = useMemo(() => entries.filter(e => e.type === 'error').length, [entries])

  return (
    <div style={{
      width: 180, flexShrink: 0, borderLeft: '1px solid #222',
      background: '#0A0A0A', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Tabs bar */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '4px 6px',
        borderBottom: '1px solid #1A1A1A', flexShrink: 0, gap: 2,
      }}>
        {(['activity', 'errors', 'system'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, fontSize: 7, fontWeight: 700, cursor: 'pointer', height: 18,
              background: tab === t ? 'rgba(0,180,255,0.08)' : 'transparent',
              border: tab === t ? '1px solid #00B4FF44' : '1px solid transparent',
              borderRadius: 2, color: tab === t ? '#00B4FF' : '#555',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
              fontFamily: 'monospace', letterSpacing: '0.04em',
            }}
          >
            {t === 'errors' ? (
              <>
                ERR{errorCount > 0 && (
                  <span style={{
                    width: 14, height: 14, background: '#FF4444', borderRadius: '50%',
                    fontSize: 6, fontWeight: 700, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {errorCount}
                  </span>
                )}
              </>
            ) : t === 'activity' ? 'ACT' : 'SYS'}
          </button>
        ))}
      </div>

      {/* Content — full height scroll */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '4px 6px',
        fontFamily: 'monospace', fontSize: 7, lineHeight: 1.6,
      }}>
        {tab === 'system' ? (
          <div style={{ color: '#555', fontSize: 7 }}>
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: '#00B4FF', fontSize: 6, fontWeight: 700, marginBottom: 2 }}>DETECTION</div>
              <div>⬤ Innertube <span style={{ color: '#00FF88' }}>30/30</span></div>
              <div>⬤ OAuth <span style={{ color: '#00FF88' }}>180/200</span></div>
              <div>⬤ Poll: active · 5s</div>
            </div>
            <div>
              <div style={{ color: '#7C3AED', fontSize: 6, fontWeight: 700, marginBottom: 2 }}>RENDER</div>
              <div>GPU: NVENC · H.264</div>
              <div>Preset: p1 · ull</div>
            </div>
          </div>
        ) : tab === 'errors' ? (
          entries.filter(e => e.type === 'error').length === 0 ? (
            <div style={{ color: '#333', padding: 2 }}>No errors</div>
          ) : (
            entries.filter(e => e.type === 'error').slice(0, 30).map(e => (
              <div key={e.id} style={{ color: '#FF6B6B', wordBreak: 'break-word', marginBottom: 3 }}>
                <span style={{ color: '#FF4444' }}>[{new Date(e.timestamp).toLocaleTimeString()}]</span>
                <br/>{e.message}
              </div>
            ))
          )
        ) : (
          entries.length === 0 ? (
            <div style={{ color: '#333', padding: 2 }}>No activity</div>
          ) : (
            entries.slice(0, 40).map(e => {
              const ts = new Date(e.timestamp)
              const time = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
              const color = LEVEL_COLORS[e.type] || '#888'
              const icon = LEVEL_ICONS[e.type] || '●'
              const eta = e.workspaceId ? etaDisplay?.get(e.workspaceId) : undefined
              return (
                <div key={e.id} style={{
                  color: '#aaa', marginBottom: 3, lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}>
                  <span style={{ color }}>[{time}]</span>
                  {' '}<span style={{ color }}>{icon}</span>
                  {' '}{e.message}
                  {eta && <span style={{ color: '#7C3AED' }}> · {eta}</span>}
                </div>
              )
            })
          )
        )}
      </div>

      {/* Health status bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 3, padding: '3px 6px',
        borderTop: '1px solid #1A1A1A', fontSize: 6, color: '#444', flexShrink: 0,
      }}>
        {[
          { label: 'Innertube', color: '#00FF88' },
          { label: 'OAuth', color: '#00FF88' },
          { label: 'GPU', color: '#00FF88' },
          { label: 'Disk', color: '#00FF88' },
        ].map(dot => (
          <span key={dot.label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: dot.color, flexShrink: 0 }} />
            {dot.label}
          </span>
        ))}
      </div>
    </div>
  )
}
