'use client'

import { useEffect, useRef, useMemo } from 'react'
import type { ActivityEntry } from '../lib/activity-types'
import { colors, spacing } from '../design-system/tokens'

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
  detected:   { tag: 'DET', color: colors.accent },
  downloading:{ tag: 'DL',  color: colors.warning },
  downloaded: { tag: 'OK',  color: colors.success },
  rendering:  { tag: 'RND', color: colors.accent },
  done:       { tag: 'OK',  color: colors.success },
  error:      { tag: 'ERR', color: colors.error },
  warning:    { tag: 'WRN', color: colors.warning },
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
      margin: '0 6px 6px',
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      background: colors.surface,
      display: 'flex',
      flexDirection: 'column',
      fontSize: 11,
      overflow: 'hidden',
      height: 220,
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: spacing.sm,
        padding: '6px 10px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, color: colors.textSecondary, fontWeight: 700, letterSpacing: '0.08em' }}>
          ACTIVITY LOG
        </span>

        {counts.det > 0 && (
          <span style={{ fontSize: 8, fontWeight: 700, color: colors.accent, background: colors.accent + '18', padding: '1px 5px', borderRadius: 3 }}>
            DET:{counts.det}
          </span>
        )}
        {counts.dl > 0 && (
          <span style={{ fontSize: 8, fontWeight: 700, color: colors.warning, background: colors.warning + '18', padding: '1px 5px', borderRadius: 3 }}>
            DL:{counts.dl}
          </span>
        )}
        {counts.ok > 0 && (
          <span style={{ fontSize: 8, fontWeight: 700, color: colors.success, background: colors.success + '18', padding: '1px 5px', borderRadius: 3 }}>
            OK:{counts.ok}
          </span>
        )}
        {counts.err > 0 && (
          <span style={{ fontSize: 8, fontWeight: 700, color: colors.error, background: colors.error + '18', padding: '1px 5px', borderRadius: 3 }}>
            ERR:{counts.err}
          </span>
        )}

        <div style={{ flex: 1 }} />
        {onClear && (
          <button
            onClick={onClear}
            style={{
              fontSize: 9, color: colors.textTertiary, background: 'transparent',
              border: 'none', cursor: 'pointer', padding: '2px 4px',
              borderRadius: 3,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = colors.error; e.currentTarget.style.background = colors.error + '18' }}
            onMouseLeave={e => { e.currentTarget.style.color = colors.textTertiary; e.currentTarget.style.background = 'transparent' }}
          >
            clear
          </button>
        )}
      </div>

      {/* Log entries */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '6px 10px',
        lineHeight: 1.7,
      }}>
        {entries.length === 0 && (
          <div style={{ color: colors.textTertiary, paddingTop: 4, fontSize: 10, textAlign: 'center' }}>
            no activity yet
          </div>
        )}
        {entries.slice(-50).map(e => {
          const meta = TYPE_CONFIG[e.type] || TYPE_CONFIG.detected
          return (
            <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ color: colors.textTertiary, flexShrink: 0, minWidth: 54, fontFamily: 'monospace', fontSize: 10 }}>
                {fmtTimestamp(e.timestamp)}
              </span>
              <span style={{
                color: meta.color, fontWeight: 700, flexShrink: 0, minWidth: 26,
                fontSize: 9, fontFamily: 'monospace',
              }}>
                {meta.tag}
              </span>
              <span style={{ color: colors.textTertiary, flexShrink: 0, minWidth: 24, fontSize: 9, fontFamily: 'monospace' }}>
                {fmtRelTime(e.timestamp)}
              </span>
              <span style={{
                color: e.type === 'error' ? colors.error : colors.textSecondary,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                fontSize: 10,
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
