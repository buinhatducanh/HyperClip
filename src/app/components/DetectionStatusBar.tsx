'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ipc } from '../lib/ipc'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<T | null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

function formatAgo(ts: number | null): string {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'vừa'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

const QUOTA_PER_PROJECT = 9500

export function DetectionStatusBar() {
  const [pollerStatus, setPollerStatus] = useState<any>(null)
  const [sessionStatus, setSessionStatus] = useState<any>(null)
  const [projectStatus, setProjectStatus] = useState<any[]>([])
  const [degraded, setDegraded] = useState(false)
  const stateRef = useRef<any>(null)
  const lastPollAtRef = useRef<number>(0)

  const load = useCallback(async () => {
    const [ps, ss, pr] = await Promise.all([
      withTimeout(ipc.getPollerStatus(), 5000),
      withTimeout(ipc.getSessionStatus(), 8000),
      withTimeout(ipc.getProjectTokenStatuses(), 5000),
    ])
    setPollerStatus(ps ?? null)
    setSessionStatus(ss ?? null)
    setProjectStatus((pr ?? []) as any[])
    stateRef.current = { ps: ps ?? undefined, ss: ss ?? undefined, pr: pr ?? [] }

    if (ps?.lastPollAt && ps.lastPollAt !== lastPollAtRef.current) {
      lastPollAtRef.current = ps.lastPollAt
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const cleanup = ipc.onInnertubeDegraded((data) => setDegraded(data.degraded))
    return cleanup
  }, [])

  const { ps, ss, pr } = stateRef.current ?? {}
  const sessions = ss?.sessions ?? []
  const consentedCount = sessions.filter((s: any) => s.isConsented).length
  const sessionCount = ss?.sessionCount ?? sessions.length
  const loggedInCount = sessions.filter((s: any) => s.isLoggedIn).length
  const projects = pr ?? []
  const oauthHealthy = projects.filter((p: any) => p.status === 'healthy' || p.status === 'warning').length
  const oauthTotal = projects.length
  const backoffMs = ps?.exhaustedUntil ? ps.exhaustedUntil - Date.now() : 0
  const backoffMin = backoffMs > 0 ? Math.ceil(backoffMs / 60000) : 0
  const intervalSec = Math.round((ps?.pollIntervalMs ?? 5000) / 1000)

  // Source determination
  let source: string = 'Innertube'
  let sourceColor: string = '#00FF88'
  if (backoffMin > 0) {
    source = 'Backoff'; sourceColor = '#FF4444'
  } else if (consentedCount === 0 && oauthTotal > 0 && oauthHealthy > 0) {
    source = 'OAuth'; sourceColor = '#FFB800'
  } else if (sessionCount === 0 && oauthTotal > 0) {
    source = oauthHealthy > 0 ? 'OAuth only' : 'No auth'; sourceColor = oauthHealthy > 0 ? '#FFB800' : '#444'
  }

  // Warning text
  let warning = ''
  let warnColor = '#FFB800'
  if (backoffMin > 0) {
    warning = `Backoff ${backoffMin}m — ${!ps?.hasInnertube && !ps?.hasOAuth ? 'All sources dead' : !ps?.hasInnertube ? 'Innertube down' : oauthHealthy === 0 ? 'OAuth exhausted' : 'Waiting...'}`
    warnColor = '#FF4444'
  } else if (oauthHealthy === 0 && oauthTotal > 0) {
    warning = 'OAuth exhausted — add GCP project'
    warnColor = '#FF4444'
  } else if (consentedCount === 0 && loggedInCount === 0 && sessionCount > 0) {
    warning = 'No session login — open Chrome to restore'
    warnColor = '#FFB800'
  } else if (consentedCount === 0 && loggedInCount > 0) {
    warning = 'Accept consent in Chrome'
    warnColor = '#FFB800'
  } else if (degraded) {
    warning = 'Innertube degraded — health check running'
    warnColor = '#FFB800'
  }

  // Session label
  const sessionHealthPct = sessionCount > 0 ? Math.round((consentedCount / sessionCount) * 100) : 0
  const sessionColor = sessionHealthPct >= 60 ? '#00FF88' : sessionHealthPct >= 20 ? '#FFB800' : '#FF4444'
  const sessionLabel = sessionCount === 0
    ? 'no sessions'
    : sessionHealthPct >= 60
    ? `${consentedCount}/${sessionCount}`
    : `${consentedCount}/${sessionCount} ⚠`

  const hasWarning = !!warning
  const isHealthy = source === 'Innertube' && sessionHealthPct >= 60 && !hasWarning

  // Short warning for display — keep under 30 chars so it fits in the bar
  const shortWarning = warning
    .replace('OAuth exhausted — add GCP project', 'OAuth exhausted')
    .replace(' — All sources dead', ' (all dead)')
    .replace(' — Innertube down', ' (YT down)')
    .replace(' — OAuth exhausted', ' (exhausted)')
    .replace(' — Waiting...', ' (wait...)')
    .replace('Backoff ', 'BO ')
    .replace('Innertube down', 'YT down')
    .replace('OAuth ', '')
    .replace('All sources dead', 'all dead')
    .replace('Waiting...', 'wait...')
    .replace('Accept consent in Chrome', 'need consent')
    .replace('No session login — open Chrome to restore', 'sessions lost')
    .replace('Innertube degraded — health check running', 'degraded')

  return (
    <div
      onClick={() => { window.location.href = '/settings' }}
      title={hasWarning ? warning : `Detection: ${source} · ${sessionLabel} sessions · ${formatAgo(ps?.lastPollAt)} ago`}
      style={{
        padding: '0 12px',
        height: 46,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderTop: `1px solid ${hasWarning ? warnColor + '44' : isHealthy ? '#E0E0E0' : sourceColor + '44'}`,
        borderBottom: '1px solid #E0E0E0',
        background: hasWarning ? warnColor + '08' : '#F5F5F5',
        cursor: 'pointer',
        flexShrink: 0,
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      {/* Source badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: sourceColor + '15',
        border: `1px solid ${sourceColor}44`,
        borderRadius: 4, padding: '2px 8px',
        flexShrink: 0,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: sourceColor,
          boxShadow: `0 0 4px ${sourceColor}`,
          animation: source === 'Backoff' ? 'pulse 1.5s infinite' : undefined,
        }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: sourceColor, letterSpacing: '0.04em' }}>
          {source}
        </span>
      </div>

      {/* Sessions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={sessionColor} strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
        <span style={{ fontSize: 11, color: sessionColor, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {sessionLabel}
        </span>
      </div>

      {/* OAuth quota */}
      {oauthTotal > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#555' }}>·</span>
          <span style={{ fontSize: 11, color: oauthHealthy === 0 ? '#FF4444' : oauthHealthy < oauthTotal ? '#FFB800' : '#999' }}>
            {oauthHealthy}/{oauthTotal} OAuth
          </span>
        </div>
      )}

      {/* Warning — shrinks to fill middle space; timing/arrow anchor right via marginLeft:auto in the container below */}
      {hasWarning && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: warnColor + '15',
          border: `1px solid ${warnColor}33`,
          borderRadius: 4, padding: '2px 6px',
          flex: 1,
          overflow: 'hidden',
          minWidth: 0,
          maxWidth: '100%',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: warnColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            ⚠ {shortWarning}
          </span>
        </div>
      )}

      {/* Timing + arrow — marginLeft:auto keeps them anchored to the right edge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 'auto' }}>
        <span style={{ fontSize: 11, color: '#777', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {formatAgo(ps?.lastPollAt)} / {intervalSec}s
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
      `}</style>
    </div>
  )
}
