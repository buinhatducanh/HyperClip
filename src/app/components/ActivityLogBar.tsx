'use client'
import { colors, spacing, fontSize } from '../design-system/tokens'

import { useState, useMemo } from 'react'

interface LogEntry {
  id: string
  timestamp: number
  /** Level from unified_log (info/warn/error/success/debug) */
  level?: string
  /** Type from activity:event (detected/downloading/done/error) */
  type?: string
  message: string
  detail?: string
  workspaceId?: string
}

interface SystemStatus {
  innertubeReady?: number
  innertubeTotal?: number
  oauthQuota?: { used: number; total: number }
  pollActive?: boolean
  pollInterval?: number
  gpuTemp?: number
  gpuUsage?: number
  freeGB?: number
}

interface Props {
  entries: LogEntry[]
  etaDisplay?: Map<string, string>
  systemStatus?: SystemStatus
}

type LogTab = 'activity' | 'errors' | 'system'

const LEVEL_COLORS: Record<string, string> = {
  success: colors.success, info: colors.textTertiary, warning: colors.warning, error: colors.error, render: colors.accent, debug: colors.textSecondary,
}
const LEVEL_ICONS: Record<string, string> = {
  success: '✓', info: '●', warning: '⚠', error: '✗', render: '⚡', debug: '○',
}

export function ActivityLogBar({ entries, etaDisplay, systemStatus }: Props) {
  const [tab, setTab] = useState<LogTab>('activity')
  const errorCount = useMemo(() => entries.filter(e => e.level === 'error' || e.type === 'error').length, [entries])

  const { innertubeReady, innertubeTotal, pollActive = false, pollInterval = 5 } = systemStatus || {}
  const { gpuTemp = 0, gpuUsage = 0, freeGB = 0 } = systemStatus || {}
  const oauthUsed = systemStatus?.oauthQuota?.used ?? 0
  const oauthTotal = systemStatus?.oauthQuota?.total ?? 0
  const diskColor = freeGB > 10 ? colors.success : freeGB > 5 ? colors.warning : colors.error
  const innertubeColor = innertubeReady !== undefined ? (innertubeReady > 0 ? colors.success : colors.error) : '#555'
  const oauthColor = oauthTotal > 0 ? (oauthUsed / oauthTotal < 0.8 ? colors.success : oauthUsed / oauthTotal < 0.95 ? colors.warning : colors.error) : '#555'

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
              border: tab === t ? `1px solid ${colors.accent}44` : '1px solid transparent',
              borderRadius: 2, color: tab === t ? colors.accent : '#555',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
              fontFamily: 'monospace', letterSpacing: '0.04em',
            }}
          >
            {t === 'errors' ? (
              <>ERR{errorCount > 0 && (
                <span style={{
                  width: 14, height: 14, background: colors.error, borderRadius: '50%',
                  fontSize: 6, fontWeight: 700, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {errorCount}
                </span>
              )}</>
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
              <div style={{ color: colors.accent, fontSize: 6, fontWeight: 700, marginBottom: 2 }}>DETECTION</div>
              <div>⬤ Innertube <span style={{ color: innertubeColor }}>{innertubeReady !== undefined ? `${innertubeReady}/${innertubeTotal ?? '?'}` : '?'}</span></div>
              <div>⬤ OAuth <span style={{ color: oauthColor }}>{oauthTotal > 0 ? `${oauthUsed}/${oauthTotal}` : 'N/A'}</span></div>
              <div>⬤ Poll: <span style={{ color: pollActive ? colors.success : '#555' }}>{pollActive ? `active · ${pollInterval}s` : 'paused'}</span></div>
            </div>
            <div>
              <div style={{ color: colors.accent, fontSize: 6, fontWeight: 700, marginBottom: 2 }}>RENDER</div>
              <div>GPU: {gpuTemp > 0 ? `${gpuTemp}°C` : 'N/A'} · <span style={{ color: gpuUsage > 0 ? colors.success : '#555' }}>{gpuUsage}%</span></div>
              <div>Disk: <span style={{ color: diskColor }}>{freeGB > 0 ? `${freeGB.toFixed(0)}GB free` : 'N/A'}</span></div>
            </div>
          </div>
        ) : tab === 'errors' ? (
          errorCount === 0 ? (
            <div style={{ color: '#333', padding: 2 }}>No errors</div>
          ) : (
            entries.filter(e => e.level === 'error' || e.type === 'error').slice(0, 30).map(e => (
              <div key={e.id} style={{ color: '#FF6B6B', wordBreak: 'break-word', marginBottom: 3 }}>
                <span style={{ color: colors.error }}>[{new Date(e.timestamp).toLocaleTimeString()}]</span>
                <br/>{e.message}
              </div>
            ))
          )
        ) : (
          entries.length === 0 ? (
            <div style={{ color: '#333', padding: 2 }}>No activity</div>
          ) : (
            entries.slice(0, 50).map(e => {
              const ts = new Date(e.timestamp)
              const time = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
              const level = (e.level || e.type || 'info') as string
              const color = LEVEL_COLORS[level] || '#888'
              const icon = LEVEL_ICONS[level] || '●'
              const eta = e.workspaceId ? etaDisplay?.get(e.workspaceId) : undefined
              return (
                <div key={e.id} style={{
                  color: colors.textTertiary, marginBottom: 3, lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}>
                  <span style={{ color }}>[{time}]</span>
                  {' '}<span style={{ color }}>{icon}</span>
                  {' '}{e.message}
                  {eta && <span style={{ color: colors.accent }}> · {eta}</span>}
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
          { label: 'Innertube', color: innertubeColor },
          { label: 'OAuth', color: oauthColor },
          { label: 'GPU', color: gpuTemp > 0 ? colors.success : '#555' },
          { label: 'Disk', color: diskColor },
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
