'use client'

import React, { useState, useEffect } from 'react'
import { useAppStore } from '../../lib/store'
import { STALE_SESSION_DAYS } from '../../lib/constants'
import { ipc } from '../../lib/ipc'
import type { SessionStatus } from '../types'

export default function SessionsSection() {
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const { showToast } = useAppStore()

  const load = () => {
    setLoading(true)
    ipc.getSessionStatus().then((s: any) => {
      setStatus(s as SessionStatus)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    const result = await ipc.refreshAllSessions()
    showToast(result.success ? `Đã refresh ${result.refreshedCount} sessions` : 'Refresh thất bại')
    setRefreshing(false)
  }

  const handleOpenLogin = async (profileId: string) => {
    showToast(`Chrome đang mở — đăng nhập YouTube, chờ extraction...`)
    const result = await ipc.openSessionLogin(profileId)
    // openSessionLogin waits up to 5 min for CDP extraction
    const refresh = await ipc.refreshAllSessions()
    if (refresh.refreshedCount > 0) {
      showToast(`Session ${profileId}: cookies extracted — Innertube active`)
    } else {
      showToast(`Session ${profileId}: extraction failed hoặc đã đóng Chrome quá sớm`)
    }
  }

  const consented = status?.sessions.filter(s => s.isConsented) ?? []
  const notLoggedIn = status?.sessions.filter(s => !s.isLoggedIn) ?? []
  const notConsented = status?.sessions.filter(s => s.isLoggedIn && !s.isConsented) ?? []

  return (
    <div>
      {/* Summary bar */}
      {!loading && status && (
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="flex items-center gap-2">
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: consented.length > 0 ? '#00FF88' : '#FF4444',
              boxShadow: `0 0 4px ${consented.length > 0 ? '#00FF88' : '#FF4444'}66`,
            }} />
            <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>
              {status.consentedCount}/{status.sessionCount} sessions ready
              {consented.length > 0 && ' · Innertube API: active'}
            </span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              height: 22, paddingLeft: 8, paddingRight: 8,
              background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 3,
              cursor: refreshing ? 'not-allowed' : 'pointer', color: '#555', fontSize: 9, fontWeight: 600,
              opacity: refreshing ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (!refreshing) { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.color = '#888' } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#555' }}
          >{refreshing ? 'Refreshing...' : '↻ Refresh all'}</button>
        </div>
      )}

      {/* Info */}
      <div style={{ padding: '0 14px 12px', fontSize: 9, color: '#444', lineHeight: '14px' }}>
        Session cookies → YouTube Innertube API (không quota limit). Dùng cho detection.
        OAuth projects → Data API v3 (10k units/ngày). Dùng cho download + fallback.
        <br />Click &quot;Mở Chrome&quot; để đăng nhập YouTube cho profile đó.
        <br />Nếu thấy &quot;SOCS&quot; → mở YouTube trong Chrome, chấp nhận các điều khoản.
      </div>

      {loading ? (
        <div style={{ fontSize: 10, color: '#444', textAlign: 'center', padding: '16px' }}>Đang tải sessions...</div>
      ) : (
        <div style={{ padding: '0 14px 14px' }}>
          {/* Logged in sessions */}
          {consented.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 8, color: '#333', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 700 }}>READY ({consented.length})</div>
              {consented.map(s => {
                const isStale = s.refreshFailCount > 2;
                return (
                  <div key={s.profileId} style={{
                    background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 4,
                    padding: '6px 10px', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: isStale ? '#FFB800' : '#00FF88', flexShrink: 0 }} title={isStale ? "Needs refresh" : "Healthy"}/>
                    <span style={{ fontSize: 10, color: '#888', flex: 1 }}>{s.profileName}</span>
                    {s.refreshFailCount > 0 && (
                      <span style={{ fontSize: 7, color: '#FFB800', fontFamily: 'monospace', marginRight: 8 }}>
                        {s.refreshFailCount}x fail
                      </span>
                    )}
                    <span style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>
                      {s.usedToday}x
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Not consented (cookies but terms not accepted) */}
          {notConsented.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 8, color: '#FFB800', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 700 }}>NEEDS ACCEPT TERMS ({notConsented.length})</div>
              {notConsented.map(s => (
                <div key={s.profileId} style={{
                  background: '#1a1500', border: '1px solid #3a2a00', borderRadius: 4,
                  padding: '6px 10px', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#FFB800', flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: '#888', flex: 1 }}>{s.profileName}</span>
                  <button
                    onClick={() => handleOpenLogin(s.profileId)}
                    style={{
                      height: 22, paddingLeft: 8, paddingRight: 8,
                      background: '#FFB80022', border: '1px solid #FFB80044',
                      borderRadius: 3, cursor: 'pointer',
                      fontSize: 8, fontWeight: 700, color: '#FFB800',
                    }}
                  >
                    Mở YouTube
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Not logged in — show all in grid */}
          {notLoggedIn.length > 0 && (
            <div>
              <div style={{ fontSize: 8, color: '#333', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 700 }}>
                NEEDS LOGIN ({notLoggedIn.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
                {notLoggedIn.map(s => (
                  <button
                    key={s.profileId}
                    onClick={() => handleOpenLogin(s.profileId)}
                    title={s.error || 'Open Chrome and log in to YouTube'}
                    style={{
                      background: '#0d0d0d', border: '1px solid #222', borderRadius: 6,
                      padding: '12px', textAlign: 'left', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#FF664466'; e.currentTarget.style.background = '#1a0a0a' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.background = '#0d0d0d' }}
                  >
                    <span style={{ fontSize: 10, color: '#666', fontWeight: 600 }}>{s.profileName}</span>
                    <span style={{ fontSize: 9, color: '#FF6644' }}>Mở Chrome & Đăng nhập YouTube</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {status?.sessionCount === 0 && (
            <div style={{ textAlign: 'center', padding: '24px' }}>
              <div style={{ fontSize: 10, color: '#333', marginBottom: 8 }}>Chưa khởi tạo Chrome profiles.</div>
              <div style={{ fontSize: 9, color: '#2a2a2a' }}>Khởi động lại app để tạo 30 HyperClip-Chrome-Profile folders.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
