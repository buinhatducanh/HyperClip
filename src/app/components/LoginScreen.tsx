'use client'

import { ipc } from '../lib/ipc'

interface LoginScreenProps {
  accountName: string
  oauthReady: boolean
  onLogout: () => void
}

function Spinner() {
  return (
    <div style={{
      width: 40, height: 40, borderRadius: '50%',
      border: '3px solid #1A1A1A',
      borderTopColor: '#00B4FF',
      animation: 'spin 1s linear infinite',
    }} />
  )
}

export function LoginScreen({ accountName, oauthReady, onLogout }: LoginScreenProps) {
  return (
    <>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
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

        {/* Status card */}
        <div style={{
          background: '#111', border: '1px solid #1E1E1E',
          borderRadius: 12, padding: '28px 40px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          minWidth: 320, maxWidth: 400,
        }}>
          <Spinner />

          {oauthReady && accountName ? (
            <>
              {/* Already logged in — just waiting */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: '#fff', fontWeight: 600, marginBottom: 4 }}>
                  {accountName}
                </div>
                <div style={{ fontSize: 11, color: '#555' }}>Đã đăng nhập YouTube</div>
              </div>
              <div style={{ width: '100%', height: 1, background: '#1A1A1A' }} />
              <div style={{ fontSize: 11, color: '#555', animation: 'pulse 2s ease-in-out infinite' }}>
                Đang khởi tạo...
              </div>
            </>
          ) : (
            <>
              {/* Waiting for OAuth */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginBottom: 6 }}>
                  Đang đợi đăng nhập
                </div>
                <div style={{ fontSize: 11, color: '#555', lineHeight: 1.6 }}>
                  Cửa sổ Chrome đã mở.{' '}
                  <span style={{ color: '#00B4FF' }}>Đăng nhập Google</span> để tiếp tục.
                </div>
              </div>

              {/* Animated dot indicator */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00B4FF', animation: 'blink 1.4s ease-in-out infinite' }} />
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00B4FF', animation: 'blink 1.4s ease-in-out 0.2s infinite' }} />
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00B4FF', animation: 'blink 1.4s ease-in-out 0.4s infinite' }} />
              </div>

              <div style={{ fontSize: 10, color: '#333', lineHeight: 1.6, textAlign: 'center' }}>
                Nếu cửa sổ Chrome không mở,<br />
                <a href="https://accounts.google.com" target="_blank" rel="noreferrer" style={{ color: '#555', textDecoration: 'underline' }}>
                  nhấn vào đây
                </a>
              </div>
            </>
          )}
        </div>

        {/* Bottom actions */}
        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          {oauthReady && accountName && (
            <button
              onClick={onLogout}
              style={{
                background: 'transparent', border: '1px solid #2A2A2A',
                borderRadius: 6, padding: '8px 16px',
                fontSize: 11, color: '#555', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#444')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
            >
              Đăng xuất
            </button>
          )}
          {!oauthReady && (
            <button
              onClick={() => ipc.openUrl('https://accounts.google.com')}
              style={{
                background: 'transparent', border: '1px solid #2A2A2A',
                borderRadius: 6, padding: '8px 16px',
                fontSize: 11, color: '#555', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#444')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
            >
              Mở Google
            </button>
          )}
        </div>

        <div style={{ position: 'absolute', bottom: 24, fontSize: 10, color: '#2A2A2A' }}>
          HyperClip v1.0 &mdash; Auto-ingestion cho YouTube Shorts
        </div>
      </div>
    </>
  )
}
