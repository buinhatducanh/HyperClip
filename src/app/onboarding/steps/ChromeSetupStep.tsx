'use client'

import { useState, useEffect } from 'react'
import { ipc } from '../../lib/ipc'

interface ChromeSetupStepProps {
  onComplete: () => void
  onSkip: () => void
}

interface SessionStatus {
  ready: boolean
  sessionCount: number
  loggedInCount: number
  sessions: Array<{
    profileId: string
    profileName: string
    isLoggedIn: boolean
    isConsented: boolean
    hasCookies: boolean
  }>
}

export function ChromeSetupStep({ onComplete, onSkip }: ChromeSetupStepProps) {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const loadStatus = async () => {
    setLoading(true)
    try {
      const status = await ipc.getSessionStatus() as SessionStatus
      setSessionStatus(status)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStatus() }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await ipc.refreshAllSessions()
    await loadStatus()
    setRefreshing(false)
  }

  const handleOpenLogin = async (profileId: string) => {
    await ipc.openSessionLogin(profileId)
  }

  const readyCount = sessionStatus?.sessions.filter(s => s.isConsented).length ?? 0
  const totalCount = sessionStatus?.sessionCount ?? 0
  const isReady = readyCount > 0

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Explanation */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 13, color: '#999', lineHeight: 1.7, margin: '0 0 16px 0' }}>
          HyperClip sử dụng <strong style={{ color: '#1A1A1A' }}>Chrome sessions</strong> để theo dõi video mới
          từ kênh YouTube đã đăng ký — không tốn quota API.
        </p>
        <p style={{ fontSize: 12, color: '#777', lineHeight: 1.6, margin: 0 }}>
          Mỗi Chrome profile là một "phiên đăng nhập" riêng biệt. HyperClip cần ít nhất 1 profile đã đăng nhập
          YouTube để bắt đầu theo dõi.
        </p>
      </div>

      {/* Status card */}
      <div style={{
        background: '#F5F5F5',
        border: `1px solid ${isReady ? '#00FF8833' : '#D0D0D0'}`,
        borderRadius: 12,
        padding: '20px 24px',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: isReady ? '#00FF8822' : '#FF6B3522',
            border: `2px solid ${isReady ? '#00FF88' : '#FF6B35'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
          }}>
            {isReady ? '✓' : '!'}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: isReady ? '#00FF88' : '#FF6B35' }}>
              {loading ? 'Đang kiểm tra...' : isReady ? 'Sessions đã sẵn sàng' : 'Cần đăng nhập Chrome'}
            </div>
            <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
              {loading ? 'Đang kiểm tra Chrome profiles...' : `${readyCount} / ${totalCount} profiles đã đăng nhập`}
            </div>
          </div>
        </div>

        {/* Session list */}
        {!loading && sessionStatus && sessionStatus.sessions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {sessionStatus.sessions.map((s) => (
              <div
                key={s.profileId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px',
                  borderRadius: 6,
                  background: s.isConsented ? '#00FF8815' : '#1A1A1A',
                  border: `1px solid ${s.isConsented ? '#00FF8844' : '#D0D0D0'}`,
                  fontSize: 10,
                  color: s.isConsented ? '#00FF88' : '#777',
                }}
              >
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: s.isConsented ? '#00FF88' : '#D0D0D0',
                }} />
                {s.profileName.replace('HyperClip-', '')}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              height: 32, padding: '0 16px',
              background: '#1A1A1A', border: '1px solid #D0D0D0',
              borderRadius: 6, fontSize: 11, fontWeight: 600,
              color: '#999', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {refreshing ? (
              <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #999', borderTopColor: '#00B4FF', animation: 'spin 1s linear infinite' }} />
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M10 6a4 4 0 1 1-1.17-2.83" stroke="#999" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M7 2l1.5 2 2-3" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            Kiểm tra lại
          </button>

          {!isReady && (
            <button
              onClick={() => handleOpenLogin('default')}
              style={{
                height: 32, padding: '0 16px',
                background: '#00B4FF', border: 'none',
                borderRadius: 6, fontSize: 11, fontWeight: 700,
                color: '#1A1A1A', cursor: 'pointer',
              }}
            >
              Mở Chrome để đăng nhập
            </button>
          )}
        </div>
      </div>

      {/* Instructions for not-ready state */}
      {!isReady && !loading && (
        <div style={{
          background: '#F5F5F5',
          border: '1px solid #1A1A1A',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A', marginBottom: 10 }}>
            Cách setup Chrome cho HyperClip:
          </div>
          <ol style={{ margin: 0, padding: '0 0 0 18px', fontSize: 11, color: '#999', lineHeight: 2 }}>
            <li>Mở Chrome thường (không phải HyperClip)</li>
            <li>Đăng nhập Google account của bạn tại <strong style={{ color: '#999' }}>youtube.com</strong></li>
            <li>Accept consent banner nếu có</li>
            <li>Đóng Chrome hoàn toàn</li>
            <li>Nhấn <strong style={{ color: '#999' }}>"Mở Chrome để đăng nhập"</strong> bên trên</li>
            <li>HyperClip sẽ tự trích xuất cookies</li>
          </ol>
        </div>
      )}

      {/* Info box */}
      <div style={{
        background: '#F5F5F5',
        border: '1px solid #1A1A1A',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 32,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <div style={{ fontSize: 14, color: '#999', flexShrink: 0, marginTop: 1 }}>ℹ</div>
        <div style={{ fontSize: 11, color: '#999', lineHeight: 1.6 }}>
          HyperClip sử dụng <strong style={{ color: '#777' }}>Innertube API</strong> (không tốn quota) làm detection chính.
          <strong style={{ color: '#777' }}> GCP Projects</strong> (bước tiếp theo) là lớp dự phòng khi Innertube gặp sự cố.
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={onSkip}
          style={{
            height: 40, padding: '0 20px',
            background: 'transparent', border: '1px solid #D0D0D0',
            borderRadius: 8, fontSize: 12, fontWeight: 600,
            color: '#777', cursor: 'pointer',
          }}
        >
          Bỏ qua bước này
        </button>
        <button
          onClick={isReady ? onComplete : undefined}
          disabled={!isReady}
          style={{
            height: 40, padding: '0 24px',
            background: isReady ? '#00B4FF' : '#1A1A1A',
            border: 'none',
            borderRadius: 8, fontSize: 12, fontWeight: 700,
            color: isReady ? '#FFFFFF' : '#999',
            cursor: isReady ? 'pointer' : 'not-allowed',
          }}
        >
          Tiếp tục →
        </button>
      </div>
    </div>
  )
}
