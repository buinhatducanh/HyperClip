'use client'

import { useState, useEffect } from 'react'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../lib/store'
import type { LicenseStatus } from '../types'

export function ActivationScreen() {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [machineId, setMachineId] = useState('Đang lấy...')
  const [version, setVersion] = useState('...')
  const setLicense = useAppStore(s => s.setLicense)

  useEffect(() => {
    // Get license status to show machine ID + version
    ipc.getLicenseStatus().then((status: any) => {
      const m = status?.record?.machineId
      if (m) {
        setMachineId(`${m.slice(0, 8).toUpperCase()}...${m.slice(-4).toUpperCase()}`)
      }
    })
    ipc.getAppVersion().then(v => setVersion(v))
  }, [])

  async function handleActivate() {
    if (!key.trim()) {
      setError('Vui lòng nhập license key')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result: any = await ipc.activateLicense(key.trim())
      if (result.success) {
        setLicense({ activated: true, valid: true, record: result.record })
        window.location.reload()
      } else {
        const msg: Record<string, string> = {
          REVOKED: 'License đã bị thu hồi. Liên hệ hỗ trợ.',
          EXPIRED: 'License đã hết hạn.',
          ALREADY_USED: 'License đã được kích hoạt trên máy khác.',
          NOT_FOUND: 'License key không tồn tại.',
          NETWORK_ERROR: 'Không thể kết nối server. Kiểm tra internet.',
        }
        setError(msg[result.code ?? ''] || result.error || 'Kích hoạt thất bại.')
      }
    } catch (e) {
      setError('Lỗi không xác định. Thử lại.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleActivate()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0a0a0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Background grid pattern */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03,
        backgroundImage: 'linear-gradient(#00B4FF 1px, transparent 1px), linear-gradient(90deg, #00B4FF 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      <div style={{
        position: 'relative', background: '#121212', border: '1px solid #1e1e1e',
        borderRadius: 16, padding: '48px 56px', maxWidth: 480, width: '90vw',
        textAlign: 'center',
      }}>
        {/* Logo */}
        <div style={{
          width: 64, height: 64, background: 'linear-gradient(135deg, #00B4FF, #00FF88)',
          borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px', fontSize: 28, fontWeight: 700, color: '#0a0a0a',
        }}>
          H
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 600, color: '#fff', margin: '0 0 8px' }}>
          HyperClip
        </h1>
        <p style={{ fontSize: 14, color: '#888', margin: '0 0 32px' }}>
          Kích hoạt license để sử dụng ứng dụng
        </p>

        {/* Machine ID */}
        <div style={{
          background: '#1a1a1a', border: '1px solid #2a2a2a',
          borderRadius: 8, padding: '8px 12px', marginBottom: 24,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: '#666' }}>Machine ID</span>
          <span style={{ fontSize: 13, color: '#00B4FF', fontFamily: 'monospace', letterSpacing: 1 }}>
            {machineId}
          </span>
        </div>

        {/* Key input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{
            display: 'block', fontSize: 12, color: '#888', marginBottom: 8,
            textAlign: 'left',
          }}>
            LICENSE KEY
          </label>
          <input
            type="text"
            value={key}
            onChange={e => setKey(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="HYP-2026-XXXX-XXXX-XXXX"
            disabled={loading}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#1a1a1a', border: `1px solid ${error ? '#ff4444' : '#333'}`,
              borderRadius: 8, padding: '12px 16px',
              fontSize: 15, fontFamily: 'monospace', letterSpacing: 1,
              color: '#fff', outline: 'none', textTransform: 'uppercase',
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.3)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 16,
            fontSize: 13, color: '#ff6b6b', textAlign: 'left',
          }}>
            {error}
          </div>
        )}

        {/* Activate button */}
        <button
          onClick={handleActivate}
          disabled={loading}
          style={{
            width: '100%', padding: '13px 24px',
            background: loading ? '#005577' : '#00B4FF',
            border: 'none', borderRadius: 8,
            fontSize: 15, fontWeight: 600, color: '#000',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {loading ? 'Đang kích hoạt...' : 'Kích hoạt ngay'}
        </button>

        {/* Divider */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0',
        }}>
          <div style={{ flex: 1, height: 1, background: '#2a2a2a' }} />
          <span style={{ fontSize: 12, color: '#555' }}>hoặc</span>
          <div style={{ flex: 1, height: 1, background: '#2a2a2a' }} />
        </div>

        {/* Trial hint */}
        <p style={{ fontSize: 12, color: '#555', margin: 0 }}>
          Liên hệ{' '}
          <span style={{ color: '#00B4FF' }}>support@hyperclip.io</span>
          {' '}để mua license hoặc dùng thử
        </p>

        {/* Version */}
        <p style={{ fontSize: 11, color: '#444', margin: '16px 0 0' }}>
          HyperClip v{version}
        </p>
      </div>
    </div>
  )
}
