'use client'

import { useState, useEffect, useCallback } from 'react'

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
  /** Triggered when user clicks compare on a done entry */
  onCompare?: (workspaceId: string) => void
  /** Whether any done entry has a rendered video available (show compare button) */
  renderedWorkspaceIds?: Set<string>
}

const MAX_ENTRIES = 20
const TERMINAL_CLEANUP_MS = 60 * 60 * 1000 // 1 hour

// ─── Type config ────────────────────────────────────────────────────────────────

type TypeConfig = {
  color: string
  bgColor: string
  borderColor: string
  badgeBg: string
  label: string
  icon: React.ReactNode
}

function DotIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="3" fill={color} />
    </svg>
  )
}

function DownloadIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 2v7M4 6l3 3 3-3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 11h10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" />
      <path d="M4.5 7l2 2 3-3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RenderIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="2" width="10" height="10" rx="2" stroke={color} strokeWidth="1.5" />
      <path d="M5 7l1.5 1.5L9 5.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ErrorIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" />
      <path d="M7 4v3.5M7 9.5v.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function DetectedIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" />
      <path d="M5.5 7l3-2.5v5z" fill={color} />
    </svg>
  )
}

const TYPE_CONFIG: Record<ActivityType, TypeConfig> = {
  detected: {
    color: '#00B4FF',
    bgColor: '#00B4FF0D',
    borderColor: '#00B4FF25',
    badgeBg: '#00B4FF18',
    label: 'Mới',
    icon: <DetectedIcon color="#00B4FF" />,
  },
  downloading: {
    color: '#FFB800',
    bgColor: '#FFB8000D',
    borderColor: '#FFB80025',
    badgeBg: '#FFB80018',
    label: 'Tải',
    icon: <DownloadIcon color="#FFB800" />,
  },
  downloaded: {
    color: '#00FF88',
    bgColor: '#00FF880D',
    borderColor: '#00FF8825',
    badgeBg: '#00FF8818',
    label: 'Tải xong',
    icon: <CheckIcon color="#00FF88" />,
  },
  rendering: {
    color: '#C084FC',
    bgColor: '#C084FC0D',
    borderColor: '#C084FC25',
    badgeBg: '#C084FC18',
    label: 'Render',
    icon: <RenderIcon color="#C084FC" />,
  },
  done: {
    color: '#00FF88',
    bgColor: '#00FF880D',
    borderColor: '#00FF8825',
    badgeBg: '#00FF8818',
    label: 'Xong',
    icon: <DotIcon color="#00FF88" />,
  },
  error: {
    color: '#FF5252',
    bgColor: '#FF52520D',
    borderColor: '#FF525225',
    badgeBg: '#FF525218',
    label: 'Lỗi',
    icon: <ErrorIcon color="#FF5252" />,
  },
}

// ─── Timestamp formatter ────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

// ─── Progress bar for in-progress types ─────────────────────────────────────────

function ProgressBar({ type, detail }: { type: ActivityType; detail?: string }) {
  const isActive = type === 'downloading' || type === 'rendering'
  if (!isActive || !detail) return null

  // Try to parse "1920p • h264 • 240s" style format
  const match = detail.match(/(\d+)\s*[x×](\d+)/i) || detail.match(/(\d+)p/i)
  if (!match) return null

  return (
    <div style={{
      height: 2,
      borderRadius: 1,
      background: '#1A1A1A',
      marginTop: 4,
      overflow: 'hidden',
    }}>
      <div style={{
        height: '100%',
        borderRadius: 1,
        background: TYPE_CONFIG[type].color,
        width: '65%',
        animation: 'activityPulse 2s ease-in-out infinite',
      }} />
    </div>
  )
}

// ─── Entry component ─────────────────────────────────────────────────────────────

function ActivityEntryRow({ entry, etaDisplay, onCompare, hasRendered }: {
  entry: ActivityEntry
  etaDisplay?: Map<string, string>
  onCompare?: (workspaceId: string) => void
  hasRendered?: boolean
}) {
  const cfg = TYPE_CONFIG[entry.type]

  const detail = entry.detail || (etaDisplay?.has(entry.workspaceId ?? '') ? `ETA: ${etaDisplay.get(entry.workspaceId ?? '')}` : undefined)

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      padding: '6px 10px',
      borderRadius: 6,
      background: cfg.bgColor,
      border: `1px solid ${cfg.borderColor}`,
      transition: 'all 0.15s ease',
    }}>
      {/* Icon */}
      <div style={{
        flexShrink: 0,
        width: 28,
        height: 28,
        borderRadius: 6,
        background: cfg.bgColor,
        border: `1px solid ${cfg.borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 1,
      }}>
        {cfg.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top row: time + message */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 9,
            fontFamily: 'monospace',
            color: '#444',
            flexShrink: 0,
            lineHeight: 1,
          }}>
            {formatTime(entry.timestamp)}
          </span>

          {/* Status badge */}
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            color: cfg.color,
            background: cfg.badgeBg,
            border: `1px solid ${cfg.borderColor}`,
            borderRadius: 3,
            padding: '1px 5px',
            flexShrink: 0,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            {cfg.label}
          </span>

          {/* Message */}
          <span style={{
            fontSize: 11,
            color: '#999',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}>
            {entry.message}
          </span>
        </div>

        {/* Detail line */}
        {detail && (
          <div style={{
            fontSize: 9,
            color: '#555',
            marginTop: 3,
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {detail}
          </div>
        )}

        {/* Progress bar for active types */}
        <ProgressBar type={entry.type} detail={detail} />

        {/* Compare button — only for done entries with workspaceId and rendered video */}
        {entry.type === 'done' && entry.workspaceId && hasRendered && onCompare && (
          <button
            onClick={(e) => { e.stopPropagation(); onCompare(entry.workspaceId!) }}
            style={{
              marginTop: 5,
              background: '#C084FC15',
              border: '1px solid #C084FC30',
              borderRadius: 4,
              padding: '3px 10px',
              fontSize: 9,
              fontWeight: 700,
              color: '#C084FC',
              cursor: 'pointer',
              letterSpacing: '0.06em',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#C084FC25'
              e.currentTarget.style.borderColor = '#C084FC55'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#C084FC15'
              e.currentTarget.style.borderColor = '#C084FC30'
            }}
          >
            ↔ SO SÁNH
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function ActivityLog({ entries, etaDisplay, onRemoveEntry, onCompare, renderedWorkspaceIds }: Props) {
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

  // Filter terminal entries that are too old
  const isStale = useCallback((e: ActivityEntry) =>
    (e.type === 'done' || e.type === 'error') && (now - e.timestamp) > TERMINAL_CLEANUP_MS,
    [now]
  )

  const visible = entries.filter(e => !isStale(e)).slice(0, MAX_ENTRIES)

  // Separate active vs terminal entries
  const activeEntries = visible.filter(e => e.type === 'downloading' || e.type === 'rendering' || e.type === 'detected')
  const terminalEntries = visible.filter(e => e.type !== 'downloading' && e.type !== 'rendering' && e.type !== 'detected')

  return (
    <div style={{ borderTop: '1px solid #1A1A1A', flexShrink: 0 }}>
      {/* Inject keyframes once */}
      <style>{`
        @keyframes activityPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px 6px',
      }}>
        {/* Activity icon */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="3" r="1.5" fill="#3A3A3A" />
          <circle cx="6" cy="6" r="1.5" fill="#3A3A3A" />
          <circle cx="6" cy="9" r="1.5" fill="#3A3A3A" />
        </svg>
        <span style={{
          fontSize: 8,
          fontWeight: 800,
          color: '#333',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          flex: 1,
        }}>
          Hoạt động
        </span>
        {visible.length > 0 && (
          <span style={{
            fontSize: 8,
            color: '#2A2A2A',
            background: '#1A1A1A',
            borderRadius: 3,
            padding: '1px 5px',
          }}>
            {visible.length}
          </span>
        )}
      </div>

      {/* Entries */}
      <div style={{
        maxHeight: 200,
        overflowY: 'auto',
        padding: '0 8px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        scrollbarWidth: 'thin',
        scrollbarColor: '#2A2A2A transparent',
      }}>
        {visible.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 0',
            gap: 6,
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#2A2A2A" strokeWidth="1.5" strokeDasharray="3 3" />
              <path d="M8 12h8M12 8v8" stroke="#2A2A2A" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 10, color: '#2A2A2A', textAlign: 'center' }}>
              Chưa có hoạt động nào
            </span>
          </div>
        ) : (
          <>
            {/* Active items first */}
            {activeEntries.map((entry) => (
              <ActivityEntryRow key={entry.id} entry={entry} etaDisplay={etaDisplay} onCompare={onCompare} hasRendered={renderedWorkspaceIds?.has(entry.workspaceId ?? '')} />
            ))}

            {/* Divider if we have both */}
            {activeEntries.length > 0 && terminalEntries.length > 0 && (
              <div style={{
                height: 1,
                background: '#1A1A1A',
                margin: '2px 0',
              }} />
            )}

            {/* Terminal items */}
            {terminalEntries.map((entry) => (
              <ActivityEntryRow key={entry.id} entry={entry} etaDisplay={etaDisplay} onCompare={onCompare} hasRendered={renderedWorkspaceIds?.has(entry.workspaceId ?? '')} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
