'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../lib/store'
import {
  MAX_UNITS_PER_PROJECT,
  QUOTA_WARNING_PCT,
  QUOTA_CRITICAL_THRESHOLD,
  QUOTA_WARNING_THRESHOLD,
  QUOTA_BAR_WARN_PCT,
  QUOTA_BAR_EXHAUSTED_PCT,
  STALE_SESSION_DAYS,
  HOURLY_EVENTS_MAX,
  RESET_ANIMATION_MS,
  CPU_WARN_PCT,
} from '../../lib/constants'
import {
  formatNextReset,
  formatTimeAgo,
  UsageTimeline,
  StatCard,
} from '../../lib/utils'
import { ipc } from '../../lib/ipc'
import type { Project, ApiKeyStatus, SessionStatus } from '../types'

export function PollerStatusPanel() {
  const { showToast } = useAppStore()
  const [pollerStatus, setPollerStatus] = useState<any>(null)
  const [sessionStatus, setSessionStatus] = useState<any>(null)
  const [projectStatus, setProjectStatus] = useState<any>(null)
  const [keyStatus, setKeyStatus] = useState<any>(null)
  const [cloning, setCloning] = useState(false)
  const [innertubeDegraded, setInnertubeDegraded] = useState(false)

  const load = async () => {
    await Promise.all([
      ipc.getPollerStatus().then(setPollerStatus).catch(() => {}),
      ipc.getSessionStatus().then(setSessionStatus).catch(() => {}),
      ipc.getProjects().then(setProjectStatus).catch(() => {}),
      ipc.getKeys().then(setKeyStatus).catch(() => {}),
    ])
  }

  useEffect(() => { load() }, [])
  useEffect(() => { const t = setInterval(load, 8000); return () => clearInterval(t) }, [])

  // Listen for Innertube degraded events from main process
  useEffect(() => {
    const cleanup = ipc.onInnertubeDegraded((data) => {
      setInnertubeDegraded(data.degraded)
    })
    return cleanup
  }, [])

  const backoffMs = pollerStatus?.exhaustedUntil ? pollerStatus.exhaustedUntil - Date.now() : 0
  const backoffMin = backoffMs > 0 ? Math.round(backoffMs / 60000) : 0
  const isBackedOff = backoffMin > 0

  const consented = sessionStatus?.consentedCount ?? 0
  const totalSessions = sessionStatus?.sessionCount ?? 0
  const hasInnertube = consented > 0

  const healthyProjects = projectStatus?.filter((p: any) => p.status === 'healthy').length ?? 0
  const totalProjects = projectStatus?.length ?? 0
  const hasOAuth = healthyProjects > 0

  const totalKeys = keyStatus?.length ?? 0

  // Phase 6: OAuth quota monitoring — sum remaining units across all projects
  const QUOTA_PER_PROJECT = 9500
  const totalQuotaRemaining = (projectStatus as any[])?.reduce((sum: number, p: any) => {
    if (p.status === 'exhausted' || p.status === 'unauthorized') return sum
    return sum + Math.max(0, QUOTA_PER_PROJECT - (p.usedToday ?? 0))
  }, 0) ?? 0
  const totalQuotaPercent = totalProjects > 0
    ? Math.round(((projectStatus as any[])?.reduce((sum: number, p: any) => sum + (p.usedToday ?? 0), 0) ?? 0) / (totalProjects * QUOTA_PER_PROJECT) * 100)
    : 0
  const quotaColor = totalQuotaRemaining < 1000 ? '#FF4444' : totalQuotaRemaining < 5000 ? '#FFB800' : '#00FF88'
  const quotaLabel = totalQuotaRemaining < 1000 ? '🔴 CRITICAL' : totalQuotaRemaining < 5000 ? '🟡 WARNING' : '🟢 OK'

  // Phase 5: Session health — from sessionStatus.health breakdown if available
  const sessions = sessionStatus?.sessions ?? []
  const loggedInCount = sessions.filter((s: any) => s.isLoggedIn).length
  const consentedCount = sessions.filter((s: any) => s.isConsented).length
  
  const health = sessionStatus?.health
  const sessionHealthPct = health?.healthPct ?? (totalSessions > 0 ? Math.round((consentedCount / totalSessions) * 100) : 0)
  const sessionHealthColor = health ? (health.level === 'healthy' ? '#00FF88' : health.level === 'degraded' ? '#FFB800' : '#FF4444') 
    : (sessionHealthPct >= 50 ? '#00FF88' : sessionHealthPct >= 20 ? '#FFB800' : '#FF4444')
  const sessionHealthLabel = health ? (health.level === 'healthy' ? '🟢 HEALTHY' : health.level === 'degraded' ? '🟡 DEGRADED' : '🔴 CRITICAL')
    : (sessionHealthPct >= 50 ? '🟢 HEALTHY' : sessionHealthPct >= 20 ? '🟡 DEGRADED' : '🔴 CRITICAL')
  
  const hasAnySession = loggedInCount > 0
  const needsConsent = loggedInCount > 0 && consentedCount === 0

  // Phase 7: Session Expiration warning
  const expiredSessions = sessions.filter((s: any) => s.wasLoggedIn && !s.isLoggedIn)
  const hasExpiredSessions = expiredSessions.length > 0

  const detectionPath = hasInnertube ? 'innertube' : hasOAuth ? 'oauth' : null
  const primaryFix = !hasInnertube ? 'sessions' : !hasOAuth ? 'projects' : null

  const handleResume = async () => {
    await ipc.resumePoller()
    showToast('Đã resume poller — sẽ thử lại sau vài giây')
    load()
  }

  const handleCloneOne = async () => {
    if (!window.confirm('Bạn có chắc muốn nhân bản Cookie từ Session 1 ra tất cả các session còn lại? Việc này sẽ ghi đè các session hiện có.')) return
    setCloning(true)
    const result = await ipc.cloneSessionOne()
    if (result.success) {
      showToast(`Đã nhân bản thành công ra ${result.clonedCount} sessions!`)
      load()
    } else {
      showToast(`Lỗi nhân bản: ${result.error}`)
    }
    setCloning(false)
  }

  const session1 = sessions.find((s: any) => s.profileId === '1')
  const isSession1Ready = session1?.isLoggedIn
  const showCloneAction = isSession1Ready && consentedCount < totalSessions && !isBackedOff


  // Determine banner type
  let bannerColor: string
  let bannerBg: string
  let bannerBorder: string
  let statusLabel: string
  let statusIcon: string

  if (isBackedOff) {
    if (!hasInnertube && !hasOAuth) {
      bannerColor = '#FF6644'; bannerBg = '#1a0808'; bannerBorder = '#FF444444'
      statusLabel = `BACKED OFF — ${backoffMin}m until midnight PT`
      statusIcon = '✗'
    } else if (!hasInnertube) {
      bannerColor = '#FFB800'; bannerBg = '#1a1500'; bannerBorder = '#FFB80044'
      statusLabel = `BACKED OFF — ${backoffMin}m (OAuth fallback active)`
      statusIcon = '⚠'
    } else {
      bannerColor = '#FFB800'; bannerBg = '#1a1500'; bannerBorder = '#FFB80044'
      statusLabel = `BACKED OFF — ${backoffMin}m (Innertube active after recovery)`
      statusIcon = '⚠'
    }
  } else {
    bannerColor = '#00FF88'; bannerBg = '#0a1a0a'; bannerBorder = '#00FF8844'
    statusLabel = 'RUNNING'
    statusIcon = '●'
  }

  return (
    <div style={{ padding: '20px', maxWidth: 800 }}>
      {/* Main banner */}
      <div style={{
        background: bannerBg,
        border: `1px solid ${bannerBorder}`,
        borderRadius: 8,
        padding: '16px 20px',
        marginBottom: 16,
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: bannerColor, boxShadow: `0 0 8px ${bannerColor}66` }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: bannerColor, letterSpacing: '0.06em' }}>
              POLLER: {statusLabel}
            </span>
          </div>
          {isBackedOff && (
            <button
              onClick={handleResume}
              style={{
                height: 28, paddingLeft: 12, paddingRight: 12,
                background: bannerColor + '22', border: `1px solid ${bannerColor}66`,
                borderRadius: 4, cursor: 'pointer',
                fontSize: 9, fontWeight: 700, color: bannerColor,
                letterSpacing: '0.06em',
              }}
            >
              ▶ FORCE RESUME
            </button>
          )}
        </div>

        {/* Detection path status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Innertube */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: hasInnertube ? '#00FF88' : '#FF4444' }}>
              {hasInnertube ? '✓' : '✗'}
            </span>
            <span style={{ fontSize: 10, color: '#888', width: 160 }}>Innertube Sessions</span>
            <span style={{ fontSize: 9, color: hasInnertube ? '#00FF88' : '#444', fontFamily: 'monospace' }}>
              {consented}/{totalSessions} consented
            </span>
            <span style={{ fontSize: 9, color: '#333' }}>
              {hasInnertube ? '— PRIMARY [ACTIVE]' : totalSessions === 0 ? '— chưa khởi tạo' : '— cần đăng nhập Chrome'}
            </span>
          </div>

          {/* Unified Detection Status Panel */}
          <div style={{
            background: '#0a0a0a',
            border: '1px solid #1a1a1a',
            borderRadius: 6,
            padding: '12px 14px',
            marginTop: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {/* Header: detection path badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                background: hasInnertube ? '#00FF8820' : hasOAuth ? '#FFB80020' : '#FF444420',
                border: `1px solid ${hasInnertube ? '#00FF8844' : hasOAuth ? '#FFB80044' : '#FF444444'}`,
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: hasInnertube ? '#00FF88' : hasOAuth ? '#FFB800' : '#FF4444',
              }}>
                {hasInnertube ? 'PRIMARY' : hasOAuth ? 'FALLBACK' : 'NO SOURCE'}
              </div>
              <span style={{ fontSize: 8, color: '#555', letterSpacing: '0.06em' }}>
                DETECTION PATH
              </span>
              {innertubeDegraded && (
                <span style={{ fontSize: 8, color: '#FFB800', background: '#FFB80020', border: '1px solid #FFB80044', borderRadius: 3, padding: '1px 5px' }}>
                  DEGRADED
                </span>
              )}
              {needsConsent && (
                <span style={{ fontSize: 8, color: '#FF6644', background: '#FF664420', border: '1px solid #FF664444', borderRadius: 3, padding: '1px 5px' }}>
                  CONSENT MISSING
                </span>
              )}
            </div>

            {/* Capacity row */}
            <div style={{ display: 'flex', gap: 16 }}>
              {/* Innertube */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: hasInnertube ? '#00FF88' : '#333' }} />
                <span style={{ fontSize: 9, color: '#666' }}>Innertube</span>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: hasInnertube ? '#00FF88' : '#444' }}>
                  {consented}/{totalSessions} sessions
                </span>
                {needsConsent && (
                  <span style={{ fontSize: 8, color: '#FF6644' }}>({loggedInCount - consented} need consent)</span>
                )}
              </div>

              {/* OAuth */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: hasOAuth ? '#00FF88' : '#333' }} />
                <span style={{ fontSize: 9, color: '#666' }}>OAuth</span>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: hasOAuth ? '#00FF88' : '#444' }}>
                  {healthyProjects}/{totalProjects} projects
                </span>
                {hasOAuth && (
                  <span style={{ fontSize: 8, color: quotaColor, fontFamily: 'monospace' }}>
                    ({totalQuotaRemaining.toLocaleString()} quota)
                  </span>
                )}
              </div>
            </div>

            {/* Warnings */}
            {(needsConsent || sessionHealthPct < 50 || hasExpiredSessions) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {needsConsent && (
                  <span style={{ fontSize: 8, color: '#FF6644' }}>
                    ⚠ {loggedInCount - consented} session(s) missing SOCS consent — open YouTube in Chrome, accept terms
                  </span>
                )}
                {hasExpiredSessions && (
                  <span style={{ fontSize: 8, color: '#FFB800' }}>
                    ⚠ {hasExpiredSessions} session(s) lost cookies since last run
                  </span>
                )}
                {!needsConsent && sessionHealthPct < 50 && (
                  <span style={{ fontSize: 8, color: '#FFB800' }}>
                    ⚠ Session health {sessionHealthPct}% — consider refreshing Chrome sessions
                  </span>
                )}
              </div>
            )}
          </div>

          {/* OAuth */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: hasOAuth ? '#00FF88' : '#FF6644' }}>
              {hasOAuth ? '✓' : '✗'}
            </span>
            <span style={{ fontSize: 10, color: '#888', width: 160 }}>OAuth Projects</span>
            <span style={{ fontSize: 9, color: hasOAuth ? '#00FF88' : '#444', fontFamily: 'monospace' }}>
              {healthyProjects}/{totalProjects} healthy
            </span>
            <span style={{ fontSize: 9, color: '#333' }}>
              {hasOAuth ? '— FALLBACK [ACTIVE]' : totalProjects === 0 ? '— chưa có project' : '— quota hết hoặc chưa authorize'}
            </span>
          </div>

          {/* API Keys */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: totalKeys > 0 ? '#00B4FF' : '#333' }}>
              {totalKeys > 0 ? '●' : '○'}
            </span>
            <span style={{ fontSize: 10, color: '#888', width: 160 }}>API Keys</span>
            <span style={{ fontSize: 9, color: totalKeys > 0 ? '#00B4FF' : '#333', fontFamily: 'monospace' }}>
              {totalKeys} key{totalKeys !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 9, color: '#333' }}>
              {totalKeys > 0 ? '— Data API fallback' : '— chưa có key'}
            </span>
          </div>

          {/* Phase 6: OAuth quota total */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: quotaColor }}>●</span>
            <span style={{ fontSize: 10, color: '#888', width: 160 }}>OAuth Quota</span>
            <span style={{ fontSize: 9, color: quotaColor, fontFamily: 'monospace' }}>
              {totalQuotaRemaining.toLocaleString()} units left ({totalQuotaPercent}% used)
            </span>
            <span style={{ fontSize: 9, color: quotaColor }}>
              {quotaLabel}
            </span>
          </div>
        </div>

        {/* Phase 6: OAuth quota critical warning */}
        {hasOAuth && totalQuotaRemaining < 1000 && !isBackedOff && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#1a0808', border: '1px solid #FF444444',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: '#FF4444' }}>🚨</span>
            <span style={{ fontSize: 10, color: '#888' }}>
              OAuth quota gần hết ({totalQuotaRemaining.toLocaleString()} units còn lại). Thêm GCP project trong tab OAUTH PROJECTS trước khi quota hết.
            </span>
          </div>
        )}

        {/* Fix call-to-action */}
        {isBackedOff && primaryFix && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#0a0a0a', border: '1px solid #1a1a1a',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: '#555' }}>→</span>
            <span style={{ fontSize: 10, color: '#888' }}>
              System đang backed off. Sẽ tự resume sau vài phút, hoặc click{' '}
              <button
                onClick={handleResume}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 700, color: '#00B4FF', padding: 0,
                }}
              >
                FORCE RESUME
              </button>
              .
            </span>
          </div>
        )}

        {/* Running but no Innertube warning */}
        {!isBackedOff && !hasInnertube && hasOAuth && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#1a1500', border: '1px solid #FFB80044',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: '#FFB800' }}>⚠</span>
            <span style={{ fontSize: 10, color: '#888' }}>
              OAuth đang active (có quota limit/ngày). Hệ thống vẫn hoạt động tốt.
            </span>
          </div>
        )}

        {/* Running with Innertube */}
        {!isBackedOff && hasInnertube && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: innertubeDegraded ? '#1a1500' : '#0a1a0a',
            border: `1px solid ${innertubeDegraded ? '#FFB80044' : '#00FF8844'}`,
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: innertubeDegraded ? '#FFB800' : '#00FF88' }}>
              {innertubeDegraded ? '⚠' : '✓'}
            </span>
            <span style={{ fontSize: 10, color: innertubeDegraded ? '#888' : '#666' }}>
              {innertubeDegraded
                ? 'Innertube đang degraded (0 video trong 3+ poll liên tiếp) — đang kiểm tra OAuth...'
                : 'Innertube (Chrome cookies) + OAuth cùng active — detection tối ưu.'}
            </span>
          </div>
        )}
      </div>

      {/* Phase 5: Session health alert — sessions logged in but need consent */}
      {needsConsent && !isBackedOff && (
        <div style={{
          marginTop: 14, padding: '12px 16px',
          background: '#1a0808', border: '1px solid #FF664444',
          borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#FF6644' }}>⚠</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#FF6644', letterSpacing: '0.06em' }}>
              CHROME CONSENT REQUIRED
            </span>
            <span style={{ fontSize: 9, color: sessionHealthColor }}>{sessionHealthLabel}</span>
          </div>
          <div style={{ fontSize: 9, color: '#888', lineHeight: '16px' }}>
            {loggedInCount} session(s) logged into Chrome but <strong style={{ color: '#ccc' }}>consent not accepted</strong>.
            SOCS cookie missing — open Chrome manually → youtube.com → accept consent banner → close Chrome → HyperClip will pick it up automatically.
          </div>
          <div style={{ fontSize: 8, color: '#555', background: '#0a0a0a', borderRadius: 4, padding: '8px 10px', lineHeight: '14px' }}>
            HOW TO: 1) Close HyperClip &amp; all Chrome windows. 2) Open Chrome → youtube.com → sign in → accept consent. 3) Close Chrome completely. 4) Reopen HyperClip.
          </div>
        </div>
      )}

      {/* Phase 7: Session expiration alert — wasLoggedIn but currently !isLoggedIn */}
      {hasExpiredSessions && !isBackedOff && (
        <div style={{
          marginTop: 14, padding: '12px 16px',
          background: '#1a0808', border: '1px solid #FF444444',
          borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#FF4444' }}>⚠</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#FF4444', letterSpacing: '0.06em' }}>
              SESSION EXPIRED
            </span>
          </div>
          <div style={{ fontSize: 9, color: '#888', lineHeight: '16px' }}>
            Cookie của {expiredSessions.length} session đã hết hạn hoặc bị lỗi xác thực.
            Hãy bấm "Mở Chrome" bên dưới để đăng nhập lại nhằm duy trì năng lực tải dữ liệu.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
            {expiredSessions.map((s: any) => (
              <button
                key={s.profileId}
                onClick={async () => {
                  const { ipc } = await import('../../lib/ipc')
                  const { useAppStore } = await import('../../lib/store')
                  const store = useAppStore.getState()
                  store.showToast(`Đang mở Chrome cho ${s.profileName}...`)
                  const result = await ipc.openSessionLogin(s.profileId)
                  const refresh = await ipc.refreshAllSessions()
                  if (refresh.refreshedCount > 0) {
                    store.showToast(`Đã phục hồi ${s.profileName}`)
                  } else {
                    store.showToast(`Phục hồi ${s.profileName} thất bại`)
                  }
                  // Let the interval auto-reload status
                }}
                title={s.error || 'Open Chrome and log in again'}
                style={{
                  background: '#0a0a0a', border: '1px solid #FF444444', borderRadius: 6,
                  padding: '8px 12px', textAlign: 'left', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#FF444488'; e.currentTarget.style.background = '#1a0a0a' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#FF444444'; e.currentTarget.style.background = '#0a0a0a' }}
              >
                <span style={{ fontSize: 10, color: '#ccc', fontWeight: 600 }}>{s.profileName}</span>
                <span style={{ fontSize: 9, color: '#FF4444' }}>Mở Chrome</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Phase 8: Auto-Clone from Session 1 */}
      {showCloneAction && (
        <div style={{
          marginTop: 14, padding: '12px 16px',
          background: '#0a1a0a', border: '1px solid #00FF8844',
          borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#00FF88', letterSpacing: '0.06em', marginBottom: 4 }}>
              QUICK SETUP: CLONE SESSION 1
            </div>
            <div style={{ fontSize: 9, color: '#888', lineHeight: '14px' }}>
              Session 1 đã sẵn sàng. Bạn có thể nhân bản Cookie này ra {totalSessions - 1} session còn lại để tiết kiệm thời gian.
            </div>
          </div>
          <button
            onClick={handleCloneOne}
            disabled={cloning}
            style={{
              height: 32, paddingLeft: 16, paddingRight: 16,
              background: '#00FF8811', border: '1px solid #00FF8844',
              borderRadius: 4, cursor: cloning ? 'not-allowed' : 'pointer',
              fontSize: 10, fontWeight: 800, color: '#00FF88',
              letterSpacing: '0.04em', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!cloning) { e.currentTarget.style.background = '#00FF8822'; e.currentTarget.style.borderColor = '#00FF8866' } }}
            onMouseLeave={e => { e.currentTarget.style.background = '#00FF8811'; e.currentTarget.style.borderColor = '#00FF8844' }}
          >
            {cloning ? 'CLONING...' : 'NHÂN BẢN NGAY'}
          </button>
        </div>
      )}

      {/* Phase 5: Session health critical — < 20% consented */}
      {!needsConsent && hasAnySession && sessionHealthPct < 50 && !isBackedOff && (
        <div style={{
          marginTop: 14, padding: '12px 16px',
          background: '#1a1000', border: '1px solid #FFB80044',
          borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#FFB800' }}>⚠</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#FFB800', letterSpacing: '0.06em' }}>
              SESSION HEALTH: {sessionHealthPct}% READY
            </span>
            <span style={{ fontSize: 9, color: sessionHealthColor }}>{sessionHealthLabel}</span>
          </div>
          <div style={{ fontSize: 9, color: '#888' }}>
            {consentedCount}/{totalSessions} sessions consented. Innertube PRIMARY detection limited.
            {loggedInCount > consentedCount && ` ${loggedInCount - consentedCount} session(s) need Chrome consent.`}
            {health?.staleCount > 0 && ` Cookie của ${health.staleCount} session(s) đã quá 7 ngày tuổi (cũ nhất: ${health.oldestCookieAgeHours}h).`}
          </div>
        </div>
      )}

      {/* Quick action — only when neither path is available */}
      {!hasInnertube && !hasOAuth && (
        <button
          onClick={() => { const btn = document.querySelector('[data-tab="projects"]') as HTMLButtonElement; btn?.click() }}
          style={{
            width: '100%', padding: '14px 16px',
            background: '#0d1520', border: '1px solid #00FF8844',
            borderRadius: 6, cursor: 'pointer', textAlign: 'left',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#0d1f15'; e.currentTarget.style.borderColor = '#00FF8866' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0d1520'; e.currentTarget.style.borderColor = '#00FF8844' }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, color: '#00FF88', letterSpacing: '0.08em', marginBottom: 4 }}>
            GOOGLE PROJECTS — THÊM OAuth
          </div>
          <div style={{ fontSize: 9, color: '#666', lineHeight: '14px' }}>
            Thêm Google Cloud project để bắt đầu poll YouTube channels.
          </div>
        </button>
      )}
    </div>
  )
}
