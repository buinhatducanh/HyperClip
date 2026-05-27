'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import type { ActivityEntry } from './ActivityLog'
import { colors, spacing, fontSize } from '../design-system/tokens'

interface Props {
  entries: ActivityEntry[]
  onClear?: () => void
}

function fmtTimestamp(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function fmtRelTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 5) return 'now'
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

const TYPE_CONFIG: Record<string, { tag: string; color: string }> = {
  detected:   { tag: 'DET', color: '#3B82F6' },
  downloading:{ tag: 'DL',  color: '#F59E0B' },
  downloaded: { tag: 'OK',  color: '#10B981' },
  rendering:  { tag: 'RND', color: '#8B5CF6' },
  done:       { tag: 'OK',  color: '#10B981' },
  error:      { tag: 'ERR', color: '#EF4444' },
  warning:    { tag: 'WRN', color: '#F59E0B' },
}

export function ActivityLogPanel({ entries, onClear }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)

  useEffect(() => {
    if (entries.length > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevLenRef.current = entries.length
  }, [entries])

  const counts = useMemo(() => ({
    det: entries.filter(e => e.type === 'detected').length,
    dl:  entries.filter(e => e.type === 'downloading').length,
    ok:  entries.filter(e => e.type === 'done' || e.type === 'downloaded').length,
    err: entries.filter(e => e.type === 'error').length,
  }), [entries])

  return (
    <div style={{
      height: 300, flexShrink: 0,
      background: '#1A1A1A',
      display: 'flex', flexDirection: 'column',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 11,
      borderTop: '1px solid #2A2A2A',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: spacing.sm,
        padding: '7px 12px',
        borderBottom: '1px solid #2A2A2A',
        background: '#1A1A1A',
        flexShrink: 0, minHeight: 28,
      }}>
        <span style={{ fontSize: 10, color: '#666', fontWeight: 600, letterSpacing: '0.05em' }}>
          ╰ activity.log
        </span>

        {counts.det > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, color: '#3B82F6', background: '#3B82F615', padding: '1px 5px', borderRadius: 3 }}>
            DET:{counts.det}
          </span>
        )}
        {counts.dl > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, color: '#F59E0B', background: '#F59E0B15', padding: '1px 5px', borderRadius: 3 }}>
            DL:{counts.dl}
          </span>
        )}
        {counts.ok > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, color: '#10B981', background: '#10B98115', padding: '1px 5px', borderRadius: 3 }}>
            OK:{counts.ok}
          </span>
        )}
        {counts.err > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, color: '#EF4444', background: '#EF444415', padding: '1px 5px', borderRadius: 3 }}>
            ERR:{counts.err}
          </span>
        )}

        <div style={{ flex: 1 }} />
        {onClear && (
          <button
            onClick={onClear}
            style={{
              fontSize: 10, color: '#555', background: 'transparent',
              border: 'none', cursor: 'pointer', padding: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          >
            clear
          </button>
        )}
      </div>

      {/* Log entries */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '6px 12px',
        lineHeight: 1.8,
      }}>
        {entries.length === 0 && (
          <div style={{ color: '#555', paddingTop: 4, fontSize: 11 }}>
            ── no activity yet ──
          </div>
        )}
        {entries.slice(-80).map(e => {
          const meta = TYPE_CONFIG[e.type] || TYPE_CONFIG.detected
          return (
            <div key={e.id} style={{
              display: 'flex', gap: 8,
            }}>
              <span style={{ color: '#555', flexShrink: 0, minWidth: 56 }}>
                [{fmtTimestamp(e.timestamp)}]
              </span>
              <span style={{
                color: meta.color, fontWeight: 700, flexShrink: 0, minWidth: 26,
              }}>
                {meta.tag}
              </span>
              <span style={{ color: '#555', flexShrink: 0, minWidth: 26 }}>
                {fmtRelTime(e.timestamp)}
              </span>
              <span style={{
                color: e.type === 'error' ? '#EF4444' : '#ccc',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
              }}>
                {e.message}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
