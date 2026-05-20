'use client'

import { useState, useEffect } from 'react'
import { ipc } from '../lib/ipc'

interface LicenseRecord {
  keyId: string
  machineId: string
  features: string[]
  expiresAt: string | null
  issuedAt: string
  activatedAt: string
}

interface LicenseStatus {
  activated: boolean
  valid: boolean
  reason?: string
  record?: LicenseRecord
  updateAvailable?: boolean
  latestVersion?: string
}

export function LicenseScreen() {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    ipc.getLicenseStatus().then((s: LicenseStatus) => {
      setStatus(s)
      setLoading(false)
    })
  }, [])

  const handleActivate = async () => {
    const key = keyInput.trim()
    if (!key) { setError('Vui lòng nhập license key'); return }
    setError(null)
    setActivating(true)
    try {
      const result = await ipc.activateLicense(key) as {
        success: boolean; error?: string; code?: string
      }
      if (result.success) {
        setSuccess(true)
        // Reload to pick up new license state
        setTimeout(() => window.location.reload(), 1200)
      } else {
        setError(result.error || 'Kích hoạt thất bại')
        setActivating(false)
      }
    } catch (err) {
      setError('Lỗi kết nối server. Vui lòng thử lại.')
      setActivating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleActivate()
  }

  if (loading || !status) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0A0A0A',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid #1A1A1A', borderTopColor: '#00B4FF', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  // License valid — no overlay needed
  if (status.activated && status.valid) return null

  const isExpired = status.record?.expiresAt && new Date(status.record.expiresAt) <= new Date()
  const reason = status.reason || (isExpired ? 'License đã hết hạn' : 'License không hợp lệ')

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
      `}</style>

      <div style={{
        position: 'fixed', inset: 0, background: '#080808',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 99999, animation: 'fadeIn 0.3s ease-out',
      }}>
        {/* Logo mark */}
        <div style={{
          width: 64, height: 64,
          background: 'linear-gradient(135deg, #00B4FF 0%, #0066CC 100%)',
          borderRadius: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 28,
          boxShadow: '0 0 40px rgba(0, 180, 255, 0.2)',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="rgba(255,255,255,0.15)" />
            <path d="M10 8l6 4-6 4V8z" fill="white" />
          </svg>
        </div>

        <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', marginBottom: 4 }}>
          HyperClip
        </div>
        <div style={{ fontSize: 10, color: '#444', fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 32 }}>
          Kích hoạt license
        </div>

        {/* Status card */}
        <div style={{
          background: '#0E0E0E', border: '1px solid #1A1A1A',
          borderRadius: 12, padding: '28px 40px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
          minWidth: 340, maxWidth: 400, width: '100%',
          animation: 'slideIn 0.3s ease-out',
        }}>
          {/* Status indicator */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            {/* Warning icon */}
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'rgba(255,107,53,0.12)', border: '2px solid #FF6B35',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 22h20L12 2z" stroke="#FF6B35" strokeWidth="2" strokeLinejoin="round" fill="rgba(255,107,53,0.1)" />
                <path d="M12 9v5" stroke="#FF6B35" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1.2" fill="#FF6B35" />
              </svg>
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#fff', fontWeight: 700, marginBottom: 4 }}>
                {reason}
              </div>
              {status.record?.expiresAt && (
                <div style={{ fontSize: 11, color: '#FF6B35', opacity: 0.8 }}>
                  Hết hạn: {new Date(status.record.expiresAt).toLocaleString('vi-VN')}
                </div>
              )}
              {!status.activated && !status.record && (
                <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                  HyperClip cần license hợp lệ để hoạt động.
                </div>
              )}
            </div>
          </div>

          {/* Machine ID */}
          {status.record?.machineId && (
            <div style={{
              width: '100%', padding: '8px 12px', background: '#0A0A0A',
              borderRadius: 6, border: '1px solid #1A1A1A',
            }}>
              <div style={{ fontSize: 9, color: '#333', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Machine ID</div>
              <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {status.record.machineId.slice(0, 8)}••••••••
              </div>
            </div>
          )}

          {/* Activation form */}
          {!success ? (
            <>
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Nhập License Key
                </div>
                <input
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value.toUpperCase())}
                  onKeyDown={handleKeyDown}
                  placeholder="DEMO-7-XXXXXX"
                  disabled={activating}
                  autoFocus
                  style={{
                    width: '100%', height: 38,
                    background: '#0A0A0A', border: `1px solid ${error ? '#FF4444' : '#2A2A2A'}`,
                    borderRadius: 6, padding: '0 12px',
                    fontSize: 13, color: '#fff', fontFamily: 'monospace', fontWeight: 600,
                    letterSpacing: '0.05em', outline: 'none',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => { e.target.style.borderColor = '#00B4FF' }}
                  onBlur={e => { e.target.style.borderColor = error ? '#FF4444' : '#2A2A2A' }}
                />
                {error && (
                  <div style={{ fontSize: 10, color: '#FF4444', marginTop: 6 }}>
                    {error}
                  </div>
                )}
              </div>

              <button
                onClick={handleActivate}
                disabled={activating || !keyInput.trim()}
                style={{
                  width: '100%', height: 38,
                  background: activating ? '#1A2A3A' : '#00B4FF',
                  border: 'none', borderRadius: 6,
                  fontSize: 12, fontWeight: 700, color: '#fff',
                  cursor: activating || !keyInput.trim() ? 'not-allowed' : 'pointer',
                  opacity: activating || !keyInput.trim() ? 0.6 : 1,
                  transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {activating ? (
                  <>
                    <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'spin 0.8s linear infinite' }} />
                    Đang kích hoạt...
                  </>
                ) : 'Kích hoạt License'}
              </button>

              {/* Demo key hint */}
              <div style={{ fontSize: 9, color: '#333', textAlign: 'center', lineHeight: 1.6 }}>
                License key có format: <span style={{ fontFamily: 'monospace', color: '#444' }}>DEMO-7-ABC123</span><br />
                Liên hệ để nhận license key hợp lệ.
              </div>
            </>
          ) : (
            /* Success state */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(0,255,136,0.1)', border: '2px solid #00FF88',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="#00FF88" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ fontSize: 13, color: '#00FF88', fontWeight: 700 }}>Kích hoạt thành công!</div>
              <div style={{ fontSize: 11, color: '#555' }}>Đang khởi động...</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 24, fontSize: 9, color: '#2A2A2A', textAlign: 'center' }}>
          HyperClip v1.0 — Hardware-locked license<br />
          Mỗi license chỉ hoạt động trên một máy tính
        </div>
      </div>
    </>
  )
}
