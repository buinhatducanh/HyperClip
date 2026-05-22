'use client'

import { useState, useEffect, useCallback } from 'react'

export const dynamic = 'force-dynamic'

// License server: uses local license server in dev/electron (NEXT_PUBLIC_LICENSE_SERVER set),
// or same-origin Next.js API routes in production (empty = use relative URLs)
const LICENSE_SERVER = (process.env.NEXT_PUBLIC_LICENSE_SERVER || '').trim()
const ADMIN_SECRET = process.env.NEXT_PUBLIC_ADMIN_SECRET || 'hyperclip-admin-secret-change-me'

interface License {
  keyId: string
  key: string
  machineId: string
  machineIdShort: string
  activatedAt: string | null
  expiresAt: string | null
  isExpired: boolean
  daysLeft: number
}

interface CreateResult {
  success: boolean
  keyId?: string
  key?: string
  expiresAt?: string
  days?: number
  error?: string
}

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [licenses, setLicenses] = useState<License[]>([])
  const [creating, setCreating] = useState(false)
  const [newDays, setNewDays] = useState(2)
  const [newKey, setNewKey] = useState('')
  const [newMachineId, setNewMachineId] = useState('')
  const [createResult, setCreateResult] = useState<CreateResult | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  const adminBase64 = btoa(`admin:${ADMIN_SECRET}`)
  const authHeader = `Basic ${adminBase64}`
  const base = LICENSE_SERVER  // empty = relative URL (Next.js API routes), or absolute URL for local server

  const fetchLicenses = useCallback(async () => {
    if (!loggedIn) return
    setLoading(true)
    try {
      const res = await fetch(`${base}/api/admin/licenses`, {
        headers: { Authorization: authHeader },
      })
      if (res.status === 401 || res.status === 403) {
        setLoggedIn(false)
        setError('Sai mật khẩu')
        return
      }
      if (!res.ok) {
        setError(`Lỗi server: ${res.status}`)
        return
      }
      const data = await res.json()
      setLicenses(data.licenses || [])
    } catch {
      setError(`Không thể kết nối API. Hãy chắc chắn Next.js dev server đang chạy.`)
    } finally {
      setLoading(false)
    }
  }, [loggedIn, authHeader])

  useEffect(() => {
    if (loggedIn) fetchLicenses()
  }, [loggedIn, fetchLicenses])

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim()) return
    setLoggedIn(true)
    setError(null)
  }

  async function handleCreateDemo(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateResult(null)
    try {
      const body: Record<string, string | number> = { days: newDays }
      if (newKey.trim()) body.customKey = newKey.trim()
      if (newMachineId.trim()) body.machineId = newMachineId.trim()

      const res = await fetch(`${base}/api/admin/licenses`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setCreateResult(data)
      if (data.success) {
        setNewKey('')
        setNewMachineId('')
        fetchLicenses()
      }
    } catch {
      setCreateResult({ success: false, error: `Không thể kết nối API` })
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm('Thu hồi license này?')) return
    setRevoking(keyId)
    try {
      const res = await fetch(`${base}/api/admin/licenses/${keyId}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      })
      if (res.ok) {
        setLicenses(prev => prev.filter(l => l.keyId !== keyId))
      }
    } catch {
      setError('Lỗi khi thu hồi')
    } finally {
      setRevoking(null)
    }
  }

  function formatDate(iso: string) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  function getStatus(l: License) {
    if (l.isExpired) return { label: `EXPIRED`, color: '#ff6b6b', bg: 'rgba(255,107,107,0.15)' }
    if (!l.expiresAt) return { label: 'UNLIMITED', color: '#00B4FF', bg: 'rgba(0,180,255,0.15)' }
    return { label: `ACTIVE (${l.daysLeft}d)`, color: '#00FF88', bg: 'rgba(0,255,136,0.15)' }
  }

  if (!loggedIn) {
    return (
      <div style={{
        minHeight: '100vh', background: '#080808',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{
          background: '#0e0e0e', border: '1px solid #1a1a1a',
          borderRadius: 12, padding: '40px 48px', width: 360,
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4, textAlign: 'center' }}>
            HyperClip Admin
          </div>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 28, textAlign: 'center' }}>
            Quản lý License Keys
          </div>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Admin token"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0a0a0a', border: `1px solid ${error ? '#ff4444' : '#2a2a2a'}`,
                borderRadius: 8, padding: '12px 16px',
                fontSize: 14, color: '#fff', outline: 'none', marginBottom: 12,
              }}
            />
            {error && (
              <div style={{ fontSize: 12, color: '#ff4444', marginBottom: 12, whiteSpace: 'pre-line' }}>{error}</div>
            )}
            <button
              type="submit"
              style={{
                width: '100%', padding: '12px',
                background: '#00B4FF', border: 'none', borderRadius: 8,
                fontSize: 14, fontWeight: 600, color: '#000', cursor: 'pointer',
              }}
            >
              Đăng nhập
            </button>
            <div style={{ marginTop: 16, fontSize: 10, color: '#333', textAlign: 'center' }}>
              Default secret: hyperclip-admin-secret-change-me<br />
              {base && `Server: ${base}`}
            </div>
          </form>
        </div>
      </div>
    )
  }

  const activeCount = licenses.filter(l => !l.isExpired).length
  const expiredCount = licenses.filter(l => l.isExpired).length

  return (
    <div style={{
      minHeight: '100vh', background: '#080808',
      fontFamily: 'Inter, system-ui, sans-serif', color: '#e0e0e0',
      padding: '24px 32px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>HyperClip Admin</div>
          <div style={{ fontSize: 12, color: '#555' }}>Admin API: {base || '/api/admin/licenses'}</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={fetchLicenses} style={{
            padding: '8px 16px', background: '#1a1a1a', border: '1px solid #2a2a2a',
            borderRadius: 6, fontSize: 12, color: '#888', cursor: 'pointer',
          }}>Refresh</button>
          <button onClick={() => setLoggedIn(false)} style={{
            padding: '8px 16px', background: '#1a1a1a', border: '1px solid #2a2a2a',
            borderRadius: 6, fontSize: 12, color: '#888', cursor: 'pointer',
          }}>Đăng xuất</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Tổng Keys', value: licenses.length, color: '#888' },
          { label: 'Đang hoạt động', value: activeCount, color: '#00FF88' },
          { label: 'Hết hạn / Thu hồi', value: expiredCount, color: '#ff6b6b' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#0e0e0e', border: '1px solid #1a1a1a',
            borderRadius: 10, padding: '16px 24px', minWidth: 140,
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: '#555' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
        {/* License table */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
            Danh sách License ({licenses.length})
          </div>
          <div style={{ background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: 10, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#555' }}>Đang tải...</div>
            ) : licenses.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#555' }}>Chưa có license nào</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                    {['Key', 'Machine ID', 'Kích hoạt', 'Hết hạn', 'Trạng thái', ''].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#555', fontWeight: 500, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {licenses.map(l => {
                    const status = getStatus(l)
                    return (
                      <tr key={l.keyId} style={{ borderBottom: '1px solid #111', opacity: l.isExpired ? 0.5 : 1 }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontFamily: 'monospace', color: l.key.startsWith('DEMO') ? '#00FF88' : '#00B4FF', fontWeight: 600, fontSize: 11 }}>{l.key}</div>
                          <div style={{ fontSize: 10, color: '#333', fontFamily: 'monospace' }}>{l.keyId}</div>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#666', fontSize: 10 }}>{l.machineIdShort || '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#555', fontSize: 11, whiteSpace: 'nowrap' }}>{formatDate(l.activatedAt)}</td>
                        <td style={{ padding: '10px 12px', color: '#555', fontSize: 11, whiteSpace: 'nowrap' }}>{formatDate(l.expiresAt)}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: status.bg, color: status.color,
                          }}>
                            {status.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button
                            onClick={() => handleRevoke(l.keyId)}
                            disabled={revoking === l.keyId}
                            style={{
                              padding: '4px 10px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.3)',
                              borderRadius: 4, fontSize: 10, color: '#ff6b6b', cursor: 'pointer',
                              opacity: revoking === l.keyId ? 0.5 : 1,
                            }}
                          >
                            {revoking === l.keyId ? '...' : 'Xóa'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Create demo key form */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
            Tạo Demo Key (max 2 ngày)
          </div>
          <form onSubmit={handleCreateDemo} style={{
            background: '#0e0e0e', border: '1px solid #1a1a1a',
            borderRadius: 10, padding: 20,
          }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Thời hạn
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1, 2].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setNewDays(d)}
                    style={{
                      flex: 1, padding: '10px',
                      background: newDays === d ? '#00B4FF' : '#1a1a1a',
                      border: `1px solid ${newDays === d ? '#00B4FF' : '#2a2a2a'}`,
                      borderRadius: 6, fontSize: 14, fontWeight: 700,
                      color: newDays === d ? '#000' : '#666', cursor: 'pointer',
                    }}
                  >
                    {d} ngày
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Key tùy chỉnh (tùy chọn)
              </label>
              <input
                value={newKey}
                onChange={e => setNewKey(e.target.value.toUpperCase())}
                placeholder="VD: MYTEAM-2026"
                maxLength={8}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0a0a0a', border: '1px solid #2a2a2a',
                  borderRadius: 6, padding: '10px 12px',
                  fontSize: 13, fontFamily: 'monospace', color: '#fff', outline: 'none',
                }}
              />
              <div style={{ fontSize: 10, color: '#333', marginTop: 4 }}>
                Key: <span style={{ fontFamily: 'monospace', color: '#555' }}>DEMO-{newDays}-{newKey || 'XXXX'}</span>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Machine ID cố định (tùy chọn)
              </label>
              <input
                value={newMachineId}
                onChange={e => setNewMachineId(e.target.value)}
                placeholder="Bind key to one machine only"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0a0a0a', border: '1px solid #2a2a2a',
                  borderRadius: 6, padding: '10px 12px',
                  fontSize: 12, fontFamily: 'monospace', color: '#fff', outline: 'none',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={creating}
              style={{
                width: '100%', padding: '12px',
                background: creating ? '#1a2a3a' : '#00B4FF',
                border: 'none', borderRadius: 6,
                fontSize: 13, fontWeight: 700, color: '#000', cursor: creating ? 'not-allowed' : 'pointer',
              }}
            >
              {creating ? 'Đang tạo...' : 'Tạo Demo Key'}
            </button>

            {createResult && (
              <div style={{
                marginTop: 12, padding: '10px 12px', borderRadius: 6, fontSize: 12,
                background: createResult.success ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,68,0.1)',
                border: `1px solid ${createResult.success ? 'rgba(0,255,136,0.3)' : 'rgba(255,68,68,0.3)'}`,
                color: createResult.success ? '#00FF88' : '#ff6b6b',
              }}>
                {createResult.success ? (
                  <>
                    <div style={{ fontWeight: 700 }}>Tạo thành công!</div>
                    <div style={{ fontFamily: 'monospace', marginTop: 4, fontSize: 13 }}>{createResult.key}</div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                      Hết hạn: {createResult.expiresAt ? formatDate(createResult.expiresAt) : ''}
                    </div>
                  </>
                ) : (
                  <div style={{ whiteSpace: 'pre-line' }}>{createResult.error}</div>
                )}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
