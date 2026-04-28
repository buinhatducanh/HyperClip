'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAppStore } from '../lib/store'
import { ipc } from '../lib/ipc'
import type { KeyStatus } from '../types'

export const dynamic = 'force-dynamic'

const DEFAULT_CLIENT_ID = 'REMOVED_CLIENT_ID'

// ─── Password Gate ──────────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) return
    setLoading(true)
    setError('')
    const result = await ipc.adminCheckPassword(password)
    if (result.ok) {
      onUnlock()
    } else {
      setError('Sai mật khẩu')
      setPassword('')
    }
    setLoading(false)
  }

  return (
    <div
      style={{
        height: '100vh',
        background: '#0E0E0E',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: '#111',
          border: '1px solid #1E1E1E',
          borderRadius: 8,
          padding: '32px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          width: 320,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', marginBottom: 4 }}>
            ADMIN SETTINGS
          </div>
          <div style={{ fontSize: 10, color: '#555' }}>
            Nhập mật khẩu để truy cập
          </div>
        </div>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Mật khẩu admin"
          autoFocus
          style={{
            height: 36,
            background: '#0a0a0a',
            border: `1px solid ${error ? '#FF4444' : '#2a2a2a'}`,
            borderRadius: 4,
            padding: '0 12px',
            fontSize: 12,
            color: '#fff',
            outline: 'none',
            fontFamily: 'monospace',
            textAlign: 'center',
            letterSpacing: '0.2em',
          }}
        />
        {error && (
          <div style={{ fontSize: 10, color: '#FF4444', textAlign: 'center' }}>{error}</div>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            height: 36,
            background: '#00B4FF',
            border: 'none',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            color: '#000',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            letterSpacing: '0.08em',
          }}
        >
          {loading ? 'ĐANG KIỂM TRA...' : 'MỞ KHÓA'}
        </button>
        <div style={{ textAlign: 'center' }}>
          <Link href="/" style={{ fontSize: 9, color: '#444', textDecoration: 'none' }}>
            ← Quay lại Dashboard
          </Link>
        </div>
      </form>
    </div>
  )
}

// ─── Password Setup (first time) ───────────────────────────────────────────────

function PasswordSetup({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 4) {
      setError('Mật khẩu tối thiểu 4 ký tự')
      return
    }
    if (password !== confirm) {
      setError('Mật khẩu không khớp')
      return
    }
    setLoading(true)
    await ipc.adminSetPassword(password)
    onDone()
    setLoading(false)
  }

  return (
    <div
      style={{
        height: '100vh',
        background: '#0E0E0E',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: '#111',
          border: '1px solid #1E1E1E',
          borderRadius: 8,
          padding: '32px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          width: 360,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', marginBottom: 4 }}>
            🔒 Thiết lập Admin Password
          </div>
          <div style={{ fontSize: 10, color: '#555', lineHeight: '15px' }}>
            Mật khẩu này bảo vệ trang quản lý API Keys.
            <br />Đặt mật khẩu mạnh và không quên.
          </div>
        </div>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Nhập mật khẩu mới"
          autoFocus
          style={{
            height: 36,
            background: '#0a0a0a',
            border: '1px solid #2a2a2a',
            borderRadius: 4,
            padding: '0 12px',
            fontSize: 12,
            color: '#fff',
            outline: 'none',
            fontFamily: 'monospace',
          }}
        />
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Xác nhận mật khẩu"
          style={{
            height: 36,
            background: '#0a0a0a',
            border: `1px solid ${error && !confirm ? '#FF4444' : '#2a2a2a'}`,
            borderRadius: 4,
            padding: '0 12px',
            fontSize: 12,
            color: '#fff',
            outline: 'none',
            fontFamily: 'monospace',
          }}
        />
        {error && (
          <div style={{ fontSize: 10, color: '#FF4444', textAlign: 'center' }}>{error}</div>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            height: 36,
            background: '#00FF88',
            border: 'none',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            color: '#000',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            letterSpacing: '0.08em',
          }}
        >
          {loading ? 'ĐANG LƯU...' : 'ĐẶT MẬT KHẨU'}
        </button>
        <div style={{ textAlign: 'center' }}>
          <Link href="/" style={{ fontSize: 9, color: '#444', textDecoration: 'none' }}>
            ← Quay lại Dashboard
          </Link>
        </div>
      </form>
    </div>
  )
}

// ─── Key Manager Panel ─────────────────────────────────────────────────────────

function KeyManagerSettings() {
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [addKey, setAddKey] = useState('')
  const [addName, setAddName] = useState('')
  const [addProjectId, setAddProjectId] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [keysLoading, setKeysLoading] = useState(true)
  const [keysError, setKeysError] = useState<string | null>(null)

  const loadKeys = () => {
    setKeysLoading(true)
    setKeysError(null)
    ipc.getKeys().then((k) => {
      setKeys(k as KeyStatus[])
      setKeysLoading(false)
    }).catch((e: Error) => {
      setKeysError(e?.message || 'Failed to load keys')
      setKeysLoading(false)
    })
  }

  useEffect(() => {
    loadKeys()
    const interval = setInterval(loadKeys, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleAdd = async () => {
    const trimmedKey = addKey.trim()
    if (!trimmedKey) return
    const name = addName.trim() || 'Key ' + (keys.length + 1)
    const projectId = addProjectId.trim() || 'custom-key'
    await ipc.addKey(trimmedKey, projectId, name)
    loadKeys()
    setAddKey('')
    setAddName('')
    setAddProjectId('')
    setShowAdd(false)
  }

  const handleRemove = async (key: string) => {
    await ipc.removeKey(key)
    loadKeys()
    setRemoving(null)
  }

  const handleReset = async (key?: string) => {
    await ipc.resetKey(key)
    loadKeys()
  }

  const statusColor: Record<string, string> = {
    healthy: '#00FF88',
    warning: '#FFB800',
    error: '#FF6644',
    exhausted: '#FF4444',
  }

  const totalUsed = keys.reduce((s, k) => s + k.usedToday, 0)
  const totalQuota = keys.length * 9500
  const totalPct = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0

  return (
    <div>
      {/* Inline total + add button */}
      {!keysLoading && !keysError && keys.length > 0 && (
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <div className="flex items-center gap-2">
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: totalPct > 80 ? '#FFB800' : '#00FF88',
              boxShadow: `0 0 4px ${totalPct > 80 ? '#FFB800' : '#00FF88'}66`,
            }} />
            <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>
              {keys.length} keys · {(totalUsed / 1000).toFixed(1)}k/{(totalQuota / 1000).toFixed(0)}k
            </span>
            <div style={{ width: 60, height: 3, background: '#1a1a1a', borderRadius: 1 }}>
              <div style={{
                width: `${Math.min(totalPct, 100)}%`,
                height: '100%',
                background: totalPct > 80 ? '#FFB800' : '#00FF88',
                borderRadius: 1,
                transition: 'width 0.8s ease',
              }} />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { if (confirm('Reset quota tất cả keys?')) handleReset() }}
              title="Reset all quota"
              style={{
                height: 22, paddingLeft: 8, paddingRight: 8,
                background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 3,
                cursor: 'pointer', color: '#444', fontSize: 9,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#444' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.borderColor = '#2a2a2a' }}
            >↺ Reset</button>
            <button
              onClick={() => setShowAdd(true)}
              style={{
                height: 22, paddingLeft: 8, paddingRight: 8,
                background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 3,
                cursor: 'pointer', color: '#00B4FF', fontSize: 9, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#00B4FF22' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >+ Key</button>
          </div>
        </div>
      )}

      {/* Key rows */}
      {keysLoading ? (
        <div style={{ fontSize: 10, color: '#444', textAlign: 'center', padding: '8px 0' }}>
          Đang tải...
        </div>
      ) : keysError ? (
        <div style={{ fontSize: 10, color: '#FF4444', textAlign: 'center', padding: '8px 0' }}>
          Lỗi: {keysError}
        </div>
      ) : keys.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: 10, color: '#333', textAlign: 'center' }}>
            Chưa có API key — thêm key bên dưới
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              height: 26, paddingLeft: 12, paddingRight: 12,
              background: '#00B4FF', border: 'none', borderRadius: 3,
              color: '#000', fontSize: 10, fontWeight: 700, cursor: 'pointer',
            }}
          >+ Thêm API Key</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {keys.map((k) => (
            <div key={k.key}>
              {/* Key row */}
              <div
                className="flex items-center"
                style={{
                  padding: '6px 8px',
                  background: removing === k.key ? '#1a0808' : 'transparent',
                  borderRadius: 3,
                  gap: 8,
                  cursor: 'default',
                }}
                onMouseEnter={e => { if (!removing) (e.currentTarget as HTMLDivElement).style.background = '#111' }}
                onMouseLeave={e => { if (!removing) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                {/* Status dot */}
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: statusColor[k.status],
                  boxShadow: `0 0 4px ${statusColor[k.status]}66`,
                  flexShrink: 0,
                }} />

                {/* Name + key preview */}
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 10, color: '#ccc', fontWeight: 600, lineHeight: 1.2 }}>{k.name}</div>
                  <div style={{ fontSize: 8, color: '#2a2a2a', fontFamily: 'monospace', lineHeight: 1.2 }}>
                    {k.key.slice(0, 16)}…
                  </div>
                </div>

                {/* Quota */}
                <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                  <span style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>
                    {(k.usedToday / 1000).toFixed(1)}k
                  </span>
                  <div style={{ width: 48, height: 2, background: '#1a1a1a', borderRadius: 1 }}>
                    <div style={{
                      width: `${k.quotaPercent}%`,
                      height: '100%',
                      background: statusColor[k.status],
                      borderRadius: 1,
                      transition: 'width 0.8s ease',
                    }} />
                  </div>
                  <span style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.04em',
                    color: statusColor[k.status],
                    minWidth: 54,
                  }}>
                    {k.status === 'healthy' ? 'OK' :
                     k.status === 'warning' ? 'WARN' :
                     k.status === 'error' ? 'ERR' :
                     'LIMIT'}
                  </span>

                </div>

                {/* Actions (always visible on hover) */}
                <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                  <button
                    onClick={() => handleReset(k.key)}
                    title="Reset quota"
                    style={{
                      width: 20, height: 20, background: 'transparent',
                      border: '1px solid transparent', borderRadius: 3,
                      cursor: 'pointer', color: '#444', fontSize: 10,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#2a2a2a' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.borderColor = 'transparent' }}
                  >↺</button>
                  <button
                    onClick={() => setRemoving(k.key)}
                    title="Remove"
                    style={{
                      width: 20, height: 20, background: 'transparent',
                      border: '1px solid transparent', borderRadius: 3,
                      cursor: 'pointer', color: '#444', fontSize: 10,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#FF4444'; e.currentTarget.style.borderColor = '#FF444444' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.borderColor = 'transparent' }}
                  >✕</button>
                </div>
              </div>

              {/* Remove confirm */}
              {removing === k.key && (
                <div style={{
                  margin: '4px 0 4px 13px', padding: '6px 10px',
                  background: '#1a0808', border: '1px solid #3a1a1a',
                  borderRadius: 3, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 9, color: '#FF6644', flex: 1 }}>
                    Xóa "{k.name}"? Key sẽ ngừng được dùng.
                  </span>
                  <button
                    onClick={() => handleRemove(k.key)}
                    style={{
                      height: 22, paddingLeft: 8, paddingRight: 8,
                      background: '#aa2222', border: 'none', borderRadius: 3,
                      color: '#fff', fontSize: 9, fontWeight: 700, cursor: 'pointer',
                    }}
                  >Xóa</button>
                  <button
                    onClick={() => setRemoving(null)}
                    style={{
                      height: 22, paddingLeft: 8, paddingRight: 8,
                      background: 'transparent', border: '1px solid #333', borderRadius: 3,
                      color: '#666', fontSize: 9, cursor: 'pointer',
                    }}
                  >Hủy</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add key form */}
      {showAdd && (
        <div style={{
          marginTop: 8, padding: 12,
          background: '#0d0d0d', border: '1px solid #222',
          borderRadius: 4,
        }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              autoFocus
              value={addKey}
              onChange={e => setAddKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAdd(false) }}
              placeholder="AIzaSy..."
              style={{
                flex: 2, height: 28,
                background: '#0a0a0a', border: '1px solid #2a2a2a',
                color: '#ddd', fontSize: 10, borderRadius: 3,
                padding: '0 8px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace',
              }}
            />
            <input
              value={addName}
              onChange={e => setAddName(e.target.value)}
              placeholder="Tên"
              style={{
                flex: 1, height: 28,
                background: '#0a0a0a', border: '1px solid #2a2a2a',
                color: '#ddd', fontSize: 10, borderRadius: 3,
                padding: '0 8px', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <input
              value={addProjectId}
              onChange={e => setAddProjectId(e.target.value)}
              placeholder="proj-..."
              style={{
                width: 80, height: 28,
                background: '#0a0a0a', border: '1px solid #2a2a2a',
                color: '#ddd', fontSize: 10, borderRadius: 3,
                padding: '0 8px', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              style={{
                flex: 1, height: 26, background: '#00B4FF',
                border: 'none', borderRadius: 3, color: '#000',
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >Thêm</button>
            <button
              onClick={() => setShowAdd(false)}
              style={{
                flex: 1, height: 26, background: '#1a1a1a',
                border: '1px solid #333', borderRadius: 3, color: '#666',
                fontSize: 10, cursor: 'pointer',
              }}
            >Hủy</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Settings Page ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { settings, showToast, systemStats } = useAppStore()

  // Auth state
  const [oauthClientId, setOauthClientId] = useState(DEFAULT_CLIENT_ID)
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [oauthSaving, setOauthSaving] = useState(false)

  // Gate state
  const [gateState, setGateState] = useState<'loading' | 'setup' | 'locked' | 'unlocked'>('loading')

  useEffect(() => {
    ipc.adminHasPassword().then(result => {
      setGateState(result.has ? 'locked' : 'setup')
    })
  }, [])

  useEffect(() => {
    ipc.getOAuthCredentials().then(creds => {
      if (creds.clientId) setOauthClientId(creds.clientId)
      if (creds.clientSecret) setOauthClientSecret(creds.clientSecret)
    })
  }, [])

  const saveOAuthCredentials = async () => {
    if (!oauthClientId.trim() || !oauthClientSecret.trim()) {
      showToast('Cần điền đủ Client ID và Client Secret')
      return
    }
    setOauthSaving(true)
    try {
      await ipc.setOAuthCredentials(oauthClientId.trim(), oauthClientSecret.trim())
      showToast('Đã lưu OAuth credentials')
    } finally {
      setOauthSaving(false)
    }
  }

  
  // Loading state
  if (gateState === 'loading') {
    return (
      <div style={{ height: '100vh', background: '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 10, color: '#444', fontFamily: 'monospace' }}>Loading...</div>
      </div>
    )
  }

  // First time: setup password
  if (gateState === 'setup') {
    return <PasswordSetup onDone={() => setGateState('unlocked')} />
  }

  // Locked: enter password
  if (gateState === 'locked') {
    return <PasswordGate onUnlock={() => setGateState('unlocked')} />
  }

  // Unlocked: settings content
  return (
    <div
      style={{ height: '100vh', background: '#0E0E0E', fontFamily: 'Inter, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header */}
      <div
        style={{
          height: 48,
          background: '#0D0D0D',
          borderBottom: '1px solid #1E1E1E',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 20,
          gap: 24,
          flexShrink: 0,
        }}
      >
        <Link href="/" style={{ fontSize: 10, color: '#444', textDecoration: 'none', fontWeight: 600, letterSpacing: '0.08em' }}>
          ← BACK
        </Link>
        <div style={{ width: 1, height: 12, background: '#222' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>SETTINGS</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 20px' }}>
        <div style={{ maxWidth: 640 }}>

          {/* API Keys */}
          <SettingsSection title="API KEYS">
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 9, color: '#444', marginBottom: 10, lineHeight: '14px' }}>
                Quản lý YouTube Data API keys. Smart rotation tự chọn key có quota còn nhiều nhất.
                <br />File: <span style={{ fontFamily: 'monospace', color: '#333' }}>C:\Users\MSI\AppData\Roaming\HyperClip\api_keys.json</span>
              </div>
              <KeyManagerSettings />
            </div>
          </SettingsSection>

          {/* OAuth Tokens (multi-project) */}
          <SettingsSection title="YOUTUBE OAUTH (MULTI-PROJECT)">
            <OAuthTokenPanel showToast={showToast} />
          </SettingsSection>

          {/* Output Folder */}
          <SettingsSection title="OUTPUT">
            <SettingsRow label="Output Folder">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                <input
                  type="text"
                  value={settings.outputFolder}
                  readOnly
                  style={{
                    flex: 1, height: 30, background: '#1A1A1A', border: '1px solid #222',
                    borderRadius: 3, paddingLeft: 8, fontSize: 11, color: '#888',
                    fontFamily: 'monospace', outline: 'none',
                  }}
                />
                <button
                  onClick={() => ipc.openFolder(settings.outputFolder)}
                  style={{
                    height: 30, paddingLeft: 10, paddingRight: 10,
                    background: '#1A1A1A', border: '1px solid #222', borderRadius: 3,
                    fontSize: 9, fontWeight: 600, color: '#555', cursor: 'pointer',
                  }}
                >
                  OPEN
                </button>
              </div>
            </SettingsRow>
          </SettingsSection>

          {/* System */}
          <SettingsSection title="SYSTEM">
            <SettingsRow label="RAM Disk">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div style={{ width: 6, height: 6, borderRadius: 1, background: '#FFB800' }} />
                  <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>64GB DDR5</span>
                </div>
                <span style={{ fontSize: 9, color: '#2A2A2A' }}>Mount at R:\hyperclip</span>
              </div>
            </SettingsRow>
            <SettingsRow label="GPU Encoding">
              <div className="flex items-center gap-2">
                <div style={{ width: 6, height: 6, borderRadius: 1, background: '#00FF88' }} />
                <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
                  {(systemStats as any).gpuEncoder?.toUpperCase() ?? 'NVENC'} ({(systemStats as any).gpuName ?? '—'})
                </span>
              </div>
            </SettingsRow>
          </SettingsSection>

          {/* About */}
          <SettingsSection title="ABOUT">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#555' }}>
                <span style={{ color: '#00B4FF', fontWeight: 700 }}>HyperClip</span> v0.1.0
              </div>
              <div style={{ fontSize: 9, color: '#2A2A2A', fontFamily: 'monospace' }}>
                Electron + Next.js + FFmpeg + NVENC
              </div>
            </div>
          </SettingsSection>
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A1A1A; border-radius: 2px; }
      `}</style>
    </div>
  )
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: '1px solid #181818', gap: 16,
      }}
    >
      <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, maxWidth: 300 }}>{children}</div>
    </div>
  )
}

// ─── Multi-Project OAuth Token Panel ──────────────────────────────────────────

const PROJECT_IDS = ['proj-01', 'proj-02', 'proj-03', 'proj-04']

interface TokenSlotState {
  projectId: string
  clientId: string
  clientSecret: string
  hasToken: boolean
  tokenExpiry: number | null
  usedToday: number
  quotaTotal: number
  errors: number
  status: 'healthy' | 'warning' | 'error' | 'exhausted' | 'unauthorized'
  authorizing: boolean
}

function OAuthTokenPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [slots, setSlots] = useState<TokenSlotState[]>(
    PROJECT_IDS.map(id => ({
      projectId: id, clientId: '', clientSecret: '', hasToken: false,
      tokenExpiry: null, usedToday: 0, quotaTotal: 9500, errors: 0,
      status: 'unauthorized' as const, authorizing: false,
    }))
  )

  // Load default credentials from config file + token statuses
  useEffect(() => {
    ;(async () => {
      try {
        const creds = await (window.electronAPI as any).getDefaultOAuthCredentials()
        const statuses = await (window.electronAPI as any).getTokenStatuses()
        setSlots(PROJECT_IDS.map((id, idx) => {
          const cred = creds[id] || {}
          const st = (statuses as any[]).find((s: any) => s.projectId === id)
          return {
            projectId: id,
            clientId: cred.clientId || '',
            clientSecret: cred.clientSecret || '',
            hasToken: st?.hasToken || false,
            tokenExpiry: st?.tokenExpiry || null,
            usedToday: st?.usedToday || 0,
            quotaTotal: st?.quotaTotal || 9500,
            errors: st?.errors || 0,
            status: st?.status || 'unauthorized',
            authorizing: false,
          }
        }))
      } catch {}
    })()
  }, [])

  const loadStatuses = async () => {
    try {
      const statuses = await (window.electronAPI as any).getTokenStatuses()
      setSlots(prev => prev.map(s => {
        const found = (statuses as any[]).find((st: any) => st.projectId === s.projectId)
        if (found) {
          return { ...s, hasToken: found.hasToken, tokenExpiry: found.tokenExpiry, usedToday: found.usedToday, quotaTotal: found.quotaTotal, errors: found.errors, status: found.status }
        }
        return s
      }))
    } catch {}
  }

  useEffect(() => {
    loadStatuses()
    const interval = setInterval(loadStatuses, 8000)
    return () => clearInterval(interval)
  }, [])

  const handleAuthorize = async (projectId: string, clientId: string, clientSecret: string) => {
    if (!clientId.trim() || !clientSecret.trim()) {
      showToast('Nhập Client ID và Client Secret trước')
      return
    }
    setSlots(prev => prev.map(s => s.projectId === projectId ? { ...s, authorizing: true } : s))
    try {
      const result = await (window.electronAPI as any).startOAuthFlowPerProject(clientId.trim(), clientSecret.trim(), projectId)
      if (result.success) {
        showToast(`Token cho ${projectId} đã được authorize!`)
        loadStatuses()
      } else {
        showToast(`Lỗi: ${result.error || 'Không rõ'}`)
      }
    } catch (e: any) {
      showToast(`Lỗi: ${e.message}`)
    } finally {
      setSlots(prev => prev.map(s => s.projectId === projectId ? { ...s, authorizing: false } : s))
    }
  }

  const statusColor: Record<string, string> = {
    healthy: '#00FF88',
    warning: '#FFB800',
    error: '#FF6644',
    exhausted: '#FF4444',
    unauthorized: '#444',
  }

  return (
    <div style={{ padding: 14 }}>
      <div style={{ fontSize: 9, color: '#444', lineHeight: '14px', marginBottom: 12 }}>
        Mỗi project = 1 OAuth client + 1 API key = 10,000 quota/ngày.
        <br />4 projects = 40,000 quota/ngày → poll mỗi ~2 giây.
        <br />
        <span style={{ color: '#333' }}>
          Tạo 4 Google Cloud projects tại console.cloud.google.com — mỗi project có YouTube Data API enabled.
        </span>
      </div>

      {slots.map((slot, idx) => (
        <div key={slot.projectId} style={{
          background: '#0d0d0d', border: '1px solid #1a1a1a',
          borderRadius: 4, padding: '12px', marginBottom: 10,
        }}>
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: statusColor[slot.status],
                boxShadow: `0 0 4px ${statusColor[slot.status]}66`,
              }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#ccc' }}>
                Project {String(idx + 1).padStart(2, '0')}
              </span>
              <span style={{ fontSize: 8, color: '#2a2a2a', fontFamily: 'monospace' }}>
                {slot.projectId}
              </span>
            </div>
            {slot.hasToken && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}>
                  {(slot.usedToday / 1000).toFixed(1)}k / {(slot.quotaTotal / 1000).toFixed(0)}k
                </span>
                <div style={{ width: 60, height: 3, background: '#1a1a1a', borderRadius: 1 }}>
                  <div style={{
                    width: `${Math.min((slot.usedToday / slot.quotaTotal) * 100, 100)}%`,
                    height: '100%', background: statusColor[slot.status], borderRadius: 1,
                  }} />
                </div>
              </div>
            )}
          </div>

          <input
            placeholder="Client ID (apps.googleusercontent.com)"
            value={slot.clientId}
            onChange={e => setSlots(prev => prev.map(s => s.projectId === slot.projectId ? { ...s, clientId: e.target.value } : s))}
            style={{
              display: 'block', width: '100%', height: 28, marginBottom: 6,
              background: '#0a0a0a', border: '1px solid #222', borderRadius: 3,
              color: '#888', fontSize: 10, paddingLeft: 8, outline: 'none',
              fontFamily: 'monospace', boxSizing: 'border-box',
            }}
          />
          <input
            type="password"
            placeholder="Client Secret (G4e...)"
            value={slot.clientSecret}
            onChange={e => setSlots(prev => prev.map(s => s.projectId === slot.projectId ? { ...s, clientSecret: e.target.value } : s))}
            onKeyDown={e => { if (e.key === 'Enter') handleAuthorize(slot.projectId, slot.clientId, slot.clientSecret) }}
            style={{
              display: 'block', width: '100%', height: 28, marginBottom: 8,
              background: '#0a0a0a', border: '1px solid #222', borderRadius: 3,
              color: '#888', fontSize: 10, paddingLeft: 8, outline: 'none',
              fontFamily: 'monospace', boxSizing: 'border-box',
            }}
          />

          {slot.hasToken && slot.tokenExpiry ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 9, color: statusColor[slot.status], flex: 1 }}>
                ✓ Token OK · expires {new Date(slot.tokenExpiry).toLocaleTimeString()}
              </div>
              <button
                onClick={() => {
                  ;(window.electronAPI as any).removeToken(slot.projectId)
                  setSlots(prev => prev.map(s => s.projectId === slot.projectId
                    ? { ...s, hasToken: false, tokenExpiry: null, usedToday: 0, errors: 0, status: 'unauthorized' }
                    : s))
                  showToast(`Token ${slot.projectId} đã xóa`)
                }}
                style={{
                  height: 22, paddingLeft: 10, paddingRight: 10,
                  background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 3,
                  fontSize: 9, color: '#444', cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#FF4444'; e.currentTarget.style.borderColor = '#FF4444' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.borderColor = '#2a2a2a' }}
              >Xóa token</button>
            </div>
          ) : (
            <button
              onClick={() => handleAuthorize(slot.projectId, slot.clientId, slot.clientSecret)}
              disabled={slot.authorizing}
              style={{
                width: '100%', height: 28,
                background: slot.authorizing ? '#1a3a5a' : '#00B4FF',
                border: 'none', borderRadius: 3,
                fontSize: 10, fontWeight: 700, color: '#000',
                cursor: slot.authorizing ? 'not-allowed' : 'pointer',
                opacity: slot.authorizing ? 0.7 : 1,
              }}
            >
              {slot.authorizing ? 'ĐANG AUTHORIZE...' : 'AUTHORIZE PROJECT ' + String(idx + 1).padStart(2, '0')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
