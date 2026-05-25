'use client'

import { useState, useEffect } from 'react'
import { ipc } from '../lib/ipc'

interface LoginScreenProps {
  accountName: string
  oauthReady: boolean
  onLogout: () => void
}

interface AuthStatus {
  isReady: boolean
  cookieCount: number
  loggedOut: boolean
  accountName: string
  oauthReady: boolean
  quotaExceeded?: boolean
  quotaError?: string
}

function Spinner({ style, size }: { style?: React.CSSProperties; size?: number }) {
  const s = size ?? 40
  return (
    <div style={{
      width: s, height: s, borderRadius: '50%',
      border: `${Math.max(2, Math.round(s * 0.075))}px solid #1A1A1A`,
      borderTopColor: '#00B4FF',
      animation: 'spin 1s linear infinite',
      ...style,
    }} />
  )
}

export function LoginScreen({ accountName: initialName, oauthReady: initialOauthReady, onLogout }: LoginScreenProps) {
  const [status, setStatus] = useState<AuthStatus>({
    isReady: false,
    cookieCount: 0,
    loggedOut: true,
    accountName: initialName || '',
    oauthReady: initialOauthReady,
    quotaExceeded: false,
    quotaError: '',
  })
  // P1: loading state for login button + chrome-window-opening badge
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [showChromeBadge, setShowChromeBadge] = useState(false)

  useEffect(() => {
    ipc.getAuthStatus().then((s: AuthStatus) => setStatus(s))
    const cleanup = ipc.onAuthUpdate((s: AuthStatus) => setStatus(s as AuthStatus))
    return cleanup
  }, [])

  const handleRetry = () => {
    window.location.reload()
  }

  const handleLogin = async () => {
    setIsLoggingIn(true)
    setShowChromeBadge(true)
    try {
      const result = await ipc.startOAuthFlow() as AuthStatus
      setStatus(result)
    } finally {
      setIsLoggingIn(false)
    }
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
      `}</style>

      <div style={{
        position: 'fixed', inset: 0,
        background: '#0A0A0A',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
        animation: 'fadeIn 0.4s ease-out',
      }}>
        {/* Logo mark */}
        <div style={{
          width: 72, height: 72,
          background: 'linear-gradient(135deg, #00B4FF 0%, #0066CC 100%)',
          borderRadius: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 32,
          boxShadow: '0 0 40px rgba(0, 180, 255, 0.3)',
        }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="rgba(255,255,255,0.15)" />
            <path d="M10 8l6 4-6 4V8z" fill="white" />
          </svg>
        </div>

        {/* App name */}
        <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', marginBottom: 4 }}>
          HyperClip
        </div>
        <div style={{ fontSize: 11, color: '#444', fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 48 }}>
          Auto-ingestion cho YouTube Shorts
        </div>

        {/* Waiting state — OAuth in progress, browser open */}
        {!status.oauthReady && !status.quotaExceeded && (
          <div style={{
            background: '#111', border: '1px solid #1E1E1E',
            borderRadius: 12, padding: '28px 40px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            minWidth: 320, maxWidth: 400,
            position: 'relative',
          }}>
            <Spinner />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginBottom: 6 }}>
                Đang đợi đăng nhập
              </div>
              <div style={{ fontSize: 11, color: '#555', lineHeight: 1.6 }}>
                Cửa sổ Chrome đã mở.{' '}
                <span style={{ color: '#00B4FF' }}>Đăng nhập Google</span> để tiếp tục.
              </div>
            </div>
            {/* Animated dots */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00B4FF', animation: 'blink 1.4s ease-in-out infinite' }} />
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00B4FF', animation: 'blink 1.4s ease-in-out 0.2s infinite' }} />
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00B4FF', animation: 'blink 1.4s ease-in-out 0.4s infinite' }} />
              {/* P1: Chrome window badge — shown immediately after login click */}
              {showChromeBadge && (
                <div style={{
                  fontSize: 9, color: '#00B4FF',
                  background: 'rgba(0,180,255,0.08)',
                  border: '1px solid rgba(0,180,255,0.2)',
                  borderRadius: 4, padding: '2px 6px',
                  whiteSpace: 'nowrap',
                }}>
                  Chrome đã mở
                </div>
              )}
            </div>
            <div style={{ fontSize: 10, color: '#333', textAlign: 'center', lineHeight: 1.6 }}>
              Nếu cửa sổ Chrome không mở,{' '}
              <span
                style={{ color: '#555', textDecoration: 'underline', cursor: 'pointer' }}
                onClick={() => ipc.openUrl('https://accounts.google.com')}
              >
                nhấn vào đây
              </span>
            </div>

            {/* Divider */}
            <div style={{ width: '100%', height: 1, background: '#1A1A1A' }} />

            {/* Always-visible login actions — prevents blocking on first install */}
            {/* position: relative + z-index: 1 ensures buttons are above any overlapping elements */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', zIndex: 1 }}>
              <button
                onClick={handleLogin}
                type="button"
                disabled={isLoggingIn}
                style={{
                  width: '100%', height: 36,
                  background: isLoggingIn ? '#007ABF' : '#00B4FF',
                  border: 'none',
                  borderRadius: 6, fontSize: 12, fontWeight: 700,
                  color: '#fff',
                  cursor: isLoggingIn ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: isLoggingIn ? 0.8 : 1,
                  transition: 'opacity 0.15s, background 0.15s',
                }}
              >
                {isLoggingIn ? (
                  <>
                    <Spinner size={14} />
                    Đang mở cửa sổ Chrome...
                  </>
                ) : (
                  'Đăng nhập với Google'
                )}
              </button>
              <button
                onClick={() => {
                  setShowChromeBadge(false)
                  setStatus({ ...status, isReady: true, oauthReady: false, accountName: 'Demo Mode' })
                }}
                style={{
                  width: '100%', height: 28,
                  background: 'transparent', border: '1px solid #2A2A2A',
                  borderRadius: 6, fontSize: 10,
                  color: '#555', cursor: 'pointer',
                }}
              >
                Dùng thử (không theo dõi tự động)
              </button>
            </div>
          </div>
        )}

        {/* Quota exceeded — user is logged in but API quota hit */}
        {status.quotaExceeded && (
          <div style={{
            background: '#111', border: '1px solid #2A1A1A',
            borderRadius: 12, padding: '28px 40px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            minWidth: 320, maxWidth: 440,
          }}>
            {/* Checkmark */}
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'rgba(0,255,136,0.1)', border: '2px solid #00FF88',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20,
            }}>✓</div>

            {status.accountName && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: '#fff', fontWeight: 600, marginBottom: 2 }}>
                  {status.accountName}
                </div>
                <div style={{ fontSize: 10, color: '#00FF88' }}>Đã đăng nhập thành công</div>
              </div>
            )}

            <div style={{ width: '100%', height: 1, background: '#1E1E1E' }} />

            {/* Warning */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: '#FF8888', fontWeight: 700, marginBottom: 6 }}>
                YouTube API Quota Exceeded
              </div>
              <div style={{ fontSize: 11, color: '#555', lineHeight: 1.6 }}>
                HyperClip đã dùng hết quota YouTube Data API.
                <br />Auto-polling tạm thời bị vô hiệu hóa.
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              <button
                onClick={handleRetry}
                style={{
                  width: '100%', height: 32,
                  background: '#1A1A1A', border: '1px solid #2A2A2A',
                  borderRadius: 6, fontSize: 11, fontWeight: 600,
                  color: '#888', cursor: 'pointer',
                }}
              >
                Thử lại
              </button>
              <button
                onClick={onLogout}
                style={{
                  width: '100%', height: 32,
                  background: 'transparent', border: '1px solid #1E1E1E',
                  borderRadius: 6, fontSize: 10,
                  color: '#333', cursor: 'pointer',
                }}
              >
                Đăng xuất
              </button>
            </div>

            <div style={{ fontSize: 9, color: '#333', textAlign: 'center', lineHeight: 1.6 }}>
              Để tăng quota:{' '}
              <span
                style={{ color: '#444', textDecoration: 'underline', cursor: 'pointer' }}
                onClick={() => ipc.openUrl('https://console.cloud.google.com')}
              >
                Google Cloud Console
              </span>
              <br />
              Quota reset: 12:00 AM PT mỗi ngày
            </div>
          </div>
        )}

        {/* Initializing — fetching account info from YouTube API after tokens loaded */}
        {!status.isReady && status.oauthReady && !status.quotaExceeded && !status.accountName && (
          <div style={{
            background: '#111', border: '1px solid #1E1E1E',
            borderRadius: 12, padding: '28px 40px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            minWidth: 320, maxWidth: 400,
          }}>
            <Spinner />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginBottom: 4 }}>
                Đang khởi tạo...
              </div>
              <div style={{ fontSize: 11, color: '#555', animation: 'pulse 2s ease-in-out infinite' }}>
                Đang tải danh sách kênh đăng ký...
              </div>
            </div>
          </div>
        )}

        {/* Account known but not yet isReady — brief transition state, resolves on next auth update */}
        {!status.isReady && !status.oauthReady && !status.quotaExceeded && status.accountName && (
          <div style={{
            background: '#111', border: '1px solid #1E1E1E',
            borderRadius: 12, padding: '28px 40px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            minWidth: 320, maxWidth: 400,
          }}>
            <Spinner />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#fff', fontWeight: 600, marginBottom: 2 }}>
                {status.accountName}
              </div>
              <div style={{ fontSize: 10, color: '#00FF88' }}>Đã đăng nhập thành công</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 8, animation: 'pulse 2s ease-in-out infinite' }}>
                Đang đồng bộ...
              </div>
            </div>
          </div>
        )}


      </div>
    </>
  )
}
