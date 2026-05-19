'use client'

import { useState, useEffect } from 'react'

export type ActivityType = 'detected' | 'downloading' | 'downloaded' | 'rendering' | 'done' | 'error'

export interface ActivityEntry {
  id: string
  timestamp: number
  type: ActivityType
  /** Câu tiếng Việt tự nhiên, ví dụ: "Phát hiện video mới: TÔI GHÉT CÂY..." */
  message: string
  /** Subtle detail line — ETA, size, path */
  detail?: string
  workspaceId?: string
}

interface Props {
  entries: ActivityEntry[]
  /** Stable ETA countdown strings keyed by workspaceId. */
  etaDisplay?: Map<string, string>
  /** Called when an entry should be removed (terminal entries older than 1 hour) */
  onRemoveEntry?: (id: string) => void
}

const MAX_ENTRIES = 20
const TERMINAL_CLEANUP_MS = 60 * 60 * 1000 // 1 hour

// ─── Icon + color map ───────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ActivityType, { icon: string; color: string; bgColor: string }> = {
  detected:    { icon: '▶', color: '#00B4FF', bgColor: '#00B4FF15' },
  downloading: { icon: '↓', color: '#FFB800', bgColor: '#FFB80015' },
  downloaded:  { icon: '✓', color: '#00FF88', bgColor: '#00FF8815' },
  rendering:   { icon: '◈', color: '#C084FC', bgColor: '#C084FC15' },
  done:        { icon: '●', color: '#00FF88', bgColor: '#00FF8820' },
  error:       { icon: '✕', color: '#FF4444', bgColor: '#FF444415' },
}

// ─── Timestamp formatter ────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function ActivityLog({ entries, etaDisplay, onRemoveEntry }: Props) {
  const [now, setNow] = useState(Date.now())

  // Update "now" every 30s for relative display
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Auto-cleanup: remove terminal (done/error) entries older than 1 hour
  useEffect(() => {
    const oldTerminal = entries.filter(
      e => (e.type === 'done' || e.type === 'error') && (now - e.timestamp) > TERMINAL_CLEANUP_MS
    )
    oldTerminal.forEach(e => onRemoveEntry?.(e.id))
  }, [entries, now, onRemoveEntry])

  // Filter terminal entries that are too old (don't show them)
  const isStale = (e: ActivityEntry) =>
    (e.type === 'done' || e.type === 'error') && (now - e.timestamp) > TERMINAL_CLEANUP_MS

  const visible = entries.filter(e => !isStale(e)).slice(0, MAX_ENTRIES)

  return (
    <div style={{ borderTop: '1px solid #1A1A1A', flexShrink: 0 }}>
      {/* Header */}
      <div style={{ padding: '6px 12px 4px' }}>
        <span style={{
          fontSize: 8, fontWeight: 800, color: '#2A2A2A',
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          Hoạt động
        </span>
      </div>

      {/* Entries */}
      <div style={{ maxHeight: 180, overflowY: 'auto', padding: '0 8px 8px' }}>
        {visible.length === 0 ? (
          <div style={{
            fontSize: 10, color: '#222', textAlign: 'center',
            padding: '8px 0', lineHeight: 1.5,
          }}>
            Chưa có hoạt động nào
          </div>
        ) : visible.map((entry) => {
          const cfg = TYPE_CONFIG[entry.type]
          const ageMs = now - entry.timestamp
          const ageLabel = ageMs < 60000
            ? 'vừa xong'
            : ageMs < 3600000
              ? `${Math.floor(ageMs / 60000)}p trước`
              : `${Math.floor(ageMs / 3600000)}h trước`

          return (
            <div
              key={entry.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 5,
                padding: '4px 4px', borderRadius: 3, marginBottom: 1,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1A1A1A' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {/* Icon */}
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                background: cfg.bgColor,
                border: `1px solid ${cfg.color}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                fontSize: 9, color: cfg.color, lineHeight: 1,
              }}>
                {cfg.icon}
              </div>

              {/* Message — one natural Vietnamese sentence */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: 5,
                  fontSize: 11, color: cfg.color, lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}>
                  <span style={{ fontSize: 9, color: '#333', fontFamily: 'monospace', flexShrink: 0 }}>
                    {formatTime(entry.timestamp)}
                  </span>
                  <span>{entry.message}</span>
                </div>
                {entry.detail && (
                  <div style={{
                    fontSize: 9, color: '#555', lineHeight: 1.4,
                    marginTop: 1,
                  }}>
                    {entry.detail}
                  </div>
                )}
                {etaDisplay?.has(entry.workspaceId ?? '') && (
                  <div style={{
                    fontSize: 9, color: '#888', lineHeight: 1.4,
                    marginTop: 1, fontStyle: 'italic',
                  }}>
                    {etaDisplay.get(entry.workspaceId ?? '')}
                  </div>
                )}
                <div style={{ fontSize: 8, color: '#2A2A2A', marginTop: 1 }}>
                  {ageLabel}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
