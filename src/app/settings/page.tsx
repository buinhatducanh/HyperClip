'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAppStore } from '../lib/store'
import { ipc } from '../lib/ipc'

export const dynamic = 'force-dynamic'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Project {
  projectId: string
  clientId: string
  hasToken: boolean
  tokenExpiry: number | null
  usedToday: number
  quotaTotal: number
  errors: number
  status: 'healthy' | 'warning' | 'error' | 'exhausted' | 'unauthorized' | 'no_oauth'
  apiKey: string | null
  apiKeyName: string | null
  apiKeyUsed: number
  apiKeyStatus: string
}

interface ApiKeyStatus {
  key: string
  projectId: string
  name: string
  usedToday: number
  quotaTotal: number
  quotaPercent: number
  errors: number
  lastUsed: number | null
  status: 'healthy' | 'warning' | 'error' | 'exhausted' | 'unauthorized'
  lastReset: number | null
  nextReset: number | null
  /** Populated by Settings UI — not from backend */
  isActive?: boolean
}

interface ChromeSession {
  profileId: string
  profileName: string
  isLoggedIn: boolean
  isConsented: boolean
  usedToday: number
  lastUsed: number
  error?: string
}

interface SessionStatus {
  ready: boolean
  sessionCount: number
  loggedInCount: number
  consentedCount: number
  sessions: ChromeSession[]
}

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
    if (result.ok) onUnlock()
    else { setError('Sai mật khẩu'); setPassword('') }
    setLoading(false)
  }

  return (
    <div style={{ height: '100vh', background: '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <form onSubmit={handleSubmit} style={{ background: '#111', border: '1px solid #1E1E1E', borderRadius: 8, padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 16, width: 320 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', marginBottom: 4 }}>ADMIN SETTINGS</div>
          <div style={{ fontSize: 10, color: '#555' }}>Nhập mật khẩu để truy cập</div>
        </div>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mật khẩu admin" autoFocus style={{ height: 36, background: '#0a0a0a', border: `1px solid ${error ? '#FF4444' : '#2a2a2a'}`, borderRadius: 4, padding: '0 12px', fontSize: 12, color: '#fff', outline: 'none', fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.2em' }} />
        {error && <div style={{ fontSize: 10, color: '#FF4444', textAlign: 'center' }}>{error}</div>}
        <button type="submit" disabled={loading} style={{ height: 36, background: '#00B4FF', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700, color: '#000', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, letterSpacing: '0.08em' }}>
          {loading ? 'ĐANG KIỂM TRA...' : 'MỞ KHÓA'}
        </button>
        <div style={{ textAlign: 'center' }}>
          <Link href="/" style={{ fontSize: 9, color: '#444', textDecoration: 'none' }}>← Quay lại Dashboard</Link>
        </div>
      </form>
    </div>
  )
}

function PasswordSetup({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 4) { setError('Mật khẩu tối thiểu 4 ký tự'); return }
    if (password !== confirm) { setError('Mật khẩu không khớp'); return }
    setLoading(true)
    await ipc.adminSetPassword(password)
    onDone()
    setLoading(false)
  }

  return (
    <div style={{ height: '100vh', background: '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <form onSubmit={handleSubmit} style={{ background: '#111', border: '1px solid #1E1E1E', borderRadius: 8, padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 14, width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', marginBottom: 4 }}>🔒 Thiết lập Admin Password</div>
          <div style={{ fontSize: 10, color: '#555', lineHeight: '15px' }}>Mật khẩu này bảo vệ trang quản lý Projects.<br />Đặt mật khẩu mạnh và không quên.</div>
        </div>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Nhập mật khẩu mới" autoFocus style={{ height: 36, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '0 12px', fontSize: 12, color: '#fff', outline: 'none', fontFamily: 'monospace' }} />
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Xác nhận mật khẩu" style={{ height: 36, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '0 12px', fontSize: 12, color: '#fff', outline: 'none', fontFamily: 'monospace' }} />
        {error && <div style={{ fontSize: 10, color: '#FF4444', textAlign: 'center' }}>{error}</div>}
        <button type="submit" disabled={loading} style={{ height: 36, background: '#00FF88', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700, color: '#000', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, letterSpacing: '0.08em' }}>
          {loading ? 'ĐANG LƯU...' : 'ĐẶT MẬT KHẨU'}
        </button>
        <div style={{ textAlign: 'center' }}>
          <Link href="/" style={{ fontSize: 9, color: '#444', textDecoration: 'none' }}>← Quay lại Dashboard</Link>
        </div>
      </form>
    </div>
  )
}

// ─── Add Project Form ──────────────────────────────────────────────────────────

function AddProjectForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [projectId, setProjectId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyName, setApiKeyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { showToast } = useAppStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectId.trim()) { setError('Cần nhập Project ID'); return }
    if (!clientId.trim()) { setError('Cần nhập Client ID'); return }
    if (!clientSecret.trim()) { setError('Cần nhập Client Secret'); return }
    if (!apiKey.trim()) { setError('Cần nhập API Key'); return }

    setLoading(true)
    setError('')
    try {
      const result = await ipc.addProject({
        projectId: projectId.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        apiKey: apiKey.trim(),
        apiKeyName: apiKeyName.trim() || undefined,
      })
      if (result.success) {
        showToast(`Project ${projectId} đã thêm thành công!`)
        onAdded()
      } else {
        setError(result.error || 'Lỗi không rõ')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const rowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }
  const labelStyle = { fontSize: 9, color: '#555', letterSpacing: '0.05em', fontWeight: 600 }
  const inputStyle = {
    width: '100%', height: 30, background: '#0a0a0a', border: '1px solid #222',
    borderRadius: 3, color: '#ddd', fontSize: 10, paddingLeft: 8, outline: 'none',
    fontFamily: 'monospace', boxSizing: 'border-box' as const,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <form onSubmit={handleSubmit} style={{
        background: '#111', border: '1px solid #222', borderRadius: 8,
        padding: 24, width: 440, maxWidth: '90vw',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', marginBottom: 16 }}>
          THÊM GOOGLE PROJECT
        </div>

        <div style={rowStyle}>
          <div style={labelStyle}>PROJECT ID</div>
          <input autoFocus value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="proj-01, my-project-2, ..." style={inputStyle} />
          <div style={{ fontSize: 8, color: '#333' }}>Identifier duy nhất cho project này. Dùng để pair OAuth + API Key.</div>
        </div>

        <div style={rowStyle}>
          <div style={labelStyle}>OAUTH CLIENT ID</div>
          <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="xxx.apps.googleusercontent.com" style={inputStyle} />
        </div>

        <div style={rowStyle}>
          <div style={labelStyle}>OAUTH CLIENT SECRET</div>
          <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="GOCSPX-..." style={inputStyle} />
        </div>

        <div style={{ ...rowStyle, marginBottom: 0 }}>
          <div style={labelStyle}>API KEY</div>
          <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIzaSy..." style={inputStyle} />
        </div>

        <div style={{ ...rowStyle }}>
          <div style={labelStyle}>TÊN (TÙY CHỌN)</div>
          <input value={apiKeyName} onChange={e => setApiKeyName(e.target.value)} placeholder="Project 1" style={inputStyle} />
        </div>

        {error && (
          <div style={{ fontSize: 10, color: '#FF6644', marginTop: 8, textAlign: 'center' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="submit" disabled={loading} style={{
            flex: 1, height: 34, background: loading ? '#1a3a5a' : '#00B4FF',
            border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#000',
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'ĐANG AUTHORIZE...' : 'THÊM + AUTHORIZE'}
          </button>
          <button type="button" onClick={onClose} style={{
            height: 34, paddingLeft: 16, paddingRight: 16,
            background: 'transparent', border: '1px solid #333', borderRadius: 4,
            fontSize: 10, color: '#666', cursor: 'pointer',
          }}>
            HỦY
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Project Card ───────────────────────────────────────────────────────────────

function ProjectCard({ project, onRefresh, onReset }: { project: Project; onRefresh: () => void; onReset?: () => void; key?: string }) {
  const { showToast } = useAppStore()
  const [showRemove, setShowRemove] = useState(false)

  const statusColor: Record<string, string> = {
    healthy: '#00FF88',
    warning: '#FFB800',
    error: '#FF6644',
    exhausted: '#FF4444',
    unauthorized: '#FF6644',
    no_oauth: '#FFB800',
  }

  const sc = statusColor[project.status] || '#444'
  const oauthPct = project.quotaTotal > 0 ? Math.round((project.usedToday / project.quotaTotal) * 100) : 0

  // Show exhausted/warning on OAuth card even when hasToken=true
  const oauthLabel = (() => {
    if (project.status === 'exhausted') return '⚠ Quá tải quota'
    if (project.status === 'unauthorized') return '✗ Token không hợp lệ'
    if (project.status === 'no_oauth') return '✗ Chưa authorize'
    if (project.status === 'warning') return `⚠ ${oauthPct}% quota`
    if (project.hasToken) return `✓ Authorized`
    return '✗ Chưa authorize'
  })()

  const oauthColor = (() => {
    if (project.status === 'exhausted' || project.status === 'unauthorized') return '#FF6644'
    if (project.status === 'warning') return '#FFB800'
    if (project.hasToken) return '#00FF88'
    return '#FF6644'
  })()

  const apiSc = statusColor[project.apiKeyStatus] || '#444'

  const handleRemove = async () => {
    await ipc.removeProject(project.projectId)
    showToast(`Đã xóa ${project.projectId}`)
    onRefresh()
  }

  const handleAuthorize = async () => {
    try {
      const result = await ipc.reauthorizeProject(project.projectId)
      if (result.success) {
        showToast(`Đã re-authorize ${project.projectId}`)
        onRefresh()
      } else {
        showToast(`Lỗi: ${result.error}`)
      }
    } catch (e: any) {
      showToast(`Lỗi: ${e.message}`)
    }
  }

  const handleTest = async () => {
    showToast('Đang kiểm tra token...')
    const result = await ipc.testToken(project.projectId)
    if (result.valid) {
      showToast(`Token ${project.projectId} hợp lệ ✓`)
    } else {
      showToast(`Token lỗi: ${result.error}`)
    }
    onRefresh()
  }

  return (
    <div style={{
      background: project.status === 'exhausted' ? '#1a0808' : '#0d0d0d',
      border: `1px solid ${project.status === 'exhausted' ? '#FF444444' : project.status === 'no_oauth' ? '#FFB80022' : '#1a1a1a'}`,
      borderRadius: 6, padding: '14px', marginBottom: 10,
      transition: 'border-color 0.3s, background 0.3s',
    }}>
      {/* Header row */}
      <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
        <div className="flex items-center gap-2">
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: sc,
            boxShadow: `0 0 4px ${sc}66`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#ccc' }}>{project.projectId}</span>
          {project.status !== 'healthy' && (
            <div style={{
              padding: '1px 6px', borderRadius: 3, border: `1px solid ${sc}44`,
              background: sc + '14',
              fontSize: 8, fontWeight: 700, color: sc, letterSpacing: '0.06em',
            }}>
              {project.status.toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>
            {(project.usedToday / 1000).toFixed(1)}k / {(project.quotaTotal / 1000).toFixed(0)}k
          </span>
          <div style={{ width: 60, height: 3, background: '#1a1a1a', borderRadius: 1 }}>
            <div style={{
              width: `${Math.min(oauthPct, 100)}%`, height: '100%',
              background: oauthPct > 80 ? '#FFB800' : '#00FF88', borderRadius: 1,
              transition: 'width 0.8s ease',
            }} />
          </div>
        </div>
      </div>

      {/* OAuth + API Key rows */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {/* OAuth */}
        <div style={{ flex: 1, background: '#0a0a0a', border: `1px solid ${oauthColor}22`, borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>OAUTH</div>
          <div style={{ fontSize: 10, color: oauthColor }}>
            {oauthLabel}
            {project.tokenExpiry && project.status !== 'exhausted' && (
              <div style={{ fontSize: 8, color: '#444', marginTop: 2 }}>expires {new Date(project.tokenExpiry).toLocaleTimeString()}</div>
            )}
          </div>
          {project.status === 'exhausted' && (
            <div style={{ fontSize: 8, color: '#FF444466', marginTop: 2 }}>auto-reset midnight PT</div>
          )}
        </div>
        {/* API Key */}
        <div style={{ flex: 1, background: '#0a0a0a', border: `1px solid ${apiSc}22`, borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>API KEY</div>
          {project.apiKey ? (
            <div style={{ fontSize: 10, color: apiSc }}>
              {project.apiKey.slice(0, 10)}…
              <div style={{ fontSize: 8, color: '#444', marginTop: 2 }}>
                {project.apiKeyName || project.projectId} · {(project.apiKeyUsed / 1000).toFixed(1)}k
                {project.apiKeyStatus === 'exhausted' && <span style={{ color: '#FF4444' }}> ⚠ exhausted</span>}
                {project.apiKeyStatus === 'unauthorized' && <span style={{ color: '#FF6644' }}> ✗ unauthorized</span>}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#FF6644' }}>✗ Chưa có key</div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1">
        {(project.status === 'no_oauth' || !project.hasToken) && (
          <button
            onClick={handleAuthorize}
            style={{
              flex: 1, height: 26, background: '#00B4FF22',
              border: '1px solid #00B4FF44', borderRadius: 3,
              fontSize: 9, fontWeight: 600, color: '#00B4FF', cursor: 'pointer',
            }}
          >
            AUTHORIZE
          </button>
        )}
        {(project.status === 'exhausted' || project.status === 'warning') && (
          <button
            onClick={() => { onReset?.(); onRefresh() }}
            style={{
              flex: 1, height: 26, background: '#FFB80022',
              border: '1px solid #FFB80044', borderRadius: 3,
              fontSize: 9, fontWeight: 600, color: '#FFB800', cursor: 'pointer',
            }}
          >
            ↺ RESET QUOTA
          </button>
        )}
        {project.hasToken && (
          <button
            onClick={handleTest}
            style={{
              flex: 1, height: 26, background: 'transparent',
              border: '1px solid #00B4FF33', borderRadius: 3,
              fontSize: 9, fontWeight: 600, color: '#00B4FF88', cursor: 'pointer',
              opacity: project.status === 'exhausted' ? 1 : 0.7,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00B4FF15' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            TEST
          </button>
        )}
        <button
          onClick={() => setShowRemove(true)}
          style={{
            height: 26, paddingLeft: 10, paddingRight: 10,
            background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 3,
            fontSize: 9, color: '#555', cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#FF4444'; e.currentTarget.style.borderColor = '#FF4444' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#2a2a2a' }}
        >✕ Xóa</button>
      </div>

      {/* Remove confirm */}
      {showRemove && (
        <div style={{
          marginTop: 8, padding: '8px 10px',
          background: '#1a0808', border: '1px solid #3a1a1a',
          borderRadius: 3, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 9, color: '#FF6644', flex: 1 }}>
            Xóa project này? OAuth + API key sẽ ngừng hoạt động.
          </span>
          <button onClick={handleRemove} style={{ height: 22, paddingLeft: 8, paddingRight: 8, background: '#aa2222', border: 'none', borderRadius: 3, color: '#fff', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>Xóa</button>
          <button onClick={() => setShowRemove(false)} style={{ height: 22, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #333', borderRadius: 3, color: '#666', fontSize: 9, cursor: 'pointer' }}>Hủy</button>
        </div>
      )}
    </div>
  )
}

// ─── API Keys Dashboard ─────────────────────────────────────────────────────────

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatNextReset(ts: number | null): string {
  if (!ts) return '—'
  const diff = ts - Date.now()
  if (diff <= 0) return 'sắp reset'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatTimeAgo(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  return `${Math.floor(diff / 3600000)}h`
}

function getPTDateStr(): { hour: number; dayStr: string } {
  const now = new Date()
  const utcHour = now.getUTCHours()
  const utcYear = now.getUTCFullYear()
  const march1 = new Date(Date.UTC(utcYear, 2, 1))
  const firstSundayMarch = new Date(Date.UTC(utcYear, 2, march1.getUTCDay() === 0 ? 1 : 8 - march1.getUTCDay()))
  const nov1 = new Date(Date.UTC(utcYear, 10, 1))
  const firstSundayNov = new Date(Date.UTC(utcYear, 10, nov1.getUTCDay() === 0 ? 1 : 8 - nov1.getUTCDay()))
  const isPDT = now >= firstSundayMarch && now < firstSundayNov
  const ptOffsetHours = isPDT ? -7 : -8
  const ptHour = utcHour + ptOffsetHours
  const adjustedHour = ptHour < 0 ? ptHour + 24 : ptHour
  const dayStr = ptHour < 0
    ? `${utcYear}-${String(new Date(now.getTime() - 86400000).getUTCMonth() + 1).padStart(2, '0')}-${String(new Date(now.getTime() - 86400000).getUTCDate()).padStart(2, '0')}`
    : `${utcYear}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
  return { hour: Math.floor(adjustedHour), dayStr }
}

// ─── Usage Timeline Chart ───────────────────────────────────────────────────────

function UsageTimeline({ events }: { events: number[] }) {
  // Build 24 hourly buckets based on PT time
  const buckets = Array.from({ length: 24 }, () => 0)
  for (const ts of events) {
    const d = new Date(ts)
    const utcHour = d.getUTCHours()
    const utcYear = d.getUTCFullYear()
    const march1 = new Date(Date.UTC(utcYear, 2, 1))
    const firstSundayMarch = new Date(Date.UTC(utcYear, 2, march1.getUTCDay() === 0 ? 1 : 8 - march1.getUTCDay()))
    const nov1 = new Date(Date.UTC(utcYear, 10, 1))
    const firstSundayNov = new Date(Date.UTC(utcYear, 10, nov1.getUTCDay() === 0 ? 1 : 8 - nov1.getUTCDay()))
    const isPDT = d >= firstSundayMarch && d < firstSundayNov
    const ptOffsetHours = isPDT ? -7 : -8
    let ptHour = utcHour + ptOffsetHours
    if (ptHour < 0) ptHour += 24
    buckets[Math.floor(ptHour)]++
  }

  const maxBucket = Math.max(...buckets, 1)
  const { hour: currentHour } = getPTDateStr()

  const axisLabels = [0, 6, 12, 18]
  const bucketsPerLabel: Record<number, string> = { 0: '00', 6: '06', 12: '12', 18: '18' }

  return (
    <div style={{ padding: '0 2px' }}>
      {/* Time axis labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, paddingLeft: 2, paddingRight: 2 }}>
        {axisLabels.map(h => (
          <span key={h} style={{ fontSize: 7, color: '#2A2A2A', fontFamily: 'monospace' }}>{bucketsPerLabel[h]}</span>
        ))}
        <span style={{ fontSize: 7, color: '#1A1A1A', fontFamily: 'monospace' }}>PT</span>
      </div>

      {/* Bars */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 1,
        height: 36, borderBottom: '1px solid #1A1A1A',
      }}>
        {buckets.map((count, i) => {
          const heightPct = (count / maxBucket) * 100
          const isCurrent = i === currentHour
          const isPast = i < currentHour
          const barColor = isCurrent
            ? '#00B4FF'
            : isPast
              ? count > 0 ? `rgba(0,180,255,${Math.max(0.15, count / maxBucket * 0.7)})` : '#0d0d0d'
              : '#111'
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', position: 'relative' }} title={`${String(i).padStart(2, '0')}:00 PT — ${count} calls`}>
              {heightPct > 0 && (
                <div style={{
                  width: '100%',
                  height: `${Math.max(heightPct, 3)}%`,
                  background: barColor,
                  borderRadius: '1px 1px 0 0',
                  transition: 'height 0.3s ease',
                  ...(isCurrent ? { boxShadow: '0 0 4px #00B4FF88' } : {}),
                }} />
              )}
              {heightPct === 0 && <div style={{ width: '100%', flex: 1 }} />}
            </div>
          )
        })}
      </div>

      {/* Current hour indicator */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
        <span style={{ fontSize: 7, color: '#00B4FF88', fontFamily: 'monospace' }}>
          now {String(currentHour).padStart(2, '0')}:00 PT
        </span>
      </div>
    </div>
  )
}

// ─── Stats Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, minWidth: 120, padding: '12px 14px',
      background: '#0D0D0D', border: '1px solid #1A1A1A', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        <span style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.1em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#ccc', fontFamily: 'monospace', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 8, color: '#333' }}>{sub}</div>}
    </div>
  )
}

// ─── Overall Quota Bar ──────────────────────────────────────────────────────────

function QuotaBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  const barColor = pct >= 90 ? '#FF4444' : pct >= 75 ? '#FFB800' : '#00FF88'

  return (
    <div style={{ padding: '12px 16px', background: '#0D0D0D', borderBottom: '1px solid #141414' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'baseline' }}>
        <span style={{ fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: '0.08em' }}>OVERALL QUOTA</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: barColor, fontWeight: 700 }}>
          {used.toLocaleString()} <span style={{ color: '#333' }}>/</span> {total.toLocaleString()} <span style={{ color: '#333', fontSize: 9 }}>units</span>
          <span style={{ color: '#222', fontSize: 9, marginLeft: 8 }}>({pct}%)</span>
        </span>
      </div>
      <div style={{ height: 8, background: '#141414', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`, height: '100%', background: barColor,
          borderRadius: 4, transition: 'width 0.6s ease',
          boxShadow: `0 0 8px ${barColor}55`,
        }} />
        {/* 75% and 90% threshold markers */}
        {[75, 90].map(t => (
          <div key={t} style={{
            position: 'absolute', top: 0, left: `${t}%`, width: 1, height: '100%',
            background: t === 75 ? '#333' : '#555',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 7, color: '#2A2A2A' }}>0%</span>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ fontSize: 7, color: '#2A2A2A' }}>75%</span>
          <span style={{ fontSize: 7, color: '#2A2A2A' }}>90%</span>
          <span style={{ fontSize: 7, color: '#2A2A2A' }}>100%</span>
        </div>
      </div>
    </div>
  )
}

// ─── Key Card ───────────────────────────────────────────────────────────────────

function KeyCard({ k, events, onRemove, onReset, onTest, isActive }: {
  k: ApiKeyStatus
  events: number[]
  onRemove: (key: string) => void
  onReset: (key: string) => void
  onTest: (key: string) => void
  isActive?: boolean
}) {
  const [resetting, setResetting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)

  const sc: Record<string, string> = { healthy: '#00FF88', warning: '#FFB800', error: '#FF6644', exhausted: '#FF4444', unauthorized: '#FF6644' }
  const color = sc[k.status] || '#444'
  const pct = k.quotaPercent
  const remaining = Math.max(0, k.quotaTotal - k.usedToday)

  const handleReset = async () => {
    setResetting(true)
    await onReset(k.key)
    setTimeout(() => setResetting(false), 800)
  }

  const handleRemove = async () => {
    setRemoving(true)
    await onRemove(k.key)
  }

  const wasJustReset = k.lastReset && (Date.now() - k.lastReset) < 5000

  return (
    <div style={{
      background: wasJustReset ? '#00FF8808' : k.status === 'exhausted' ? '#1a0808' : k.status === 'unauthorized' ? '#1a0a08' : '#0D0D0D',
      border: `1px solid ${wasJustReset ? '#00FF8833' : isActive ? '#00B4FF44' : k.status === 'exhausted' ? '#FF444444' : '#181818'}`,
      borderRadius: 8, padding: '14px',
      transition: 'border-color 0.5s, background 0.5s',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%', background: color,
            boxShadow: `0 0 8px ${color}66`,
          }} />
          {isActive && (
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: '#00B4FF',
              boxShadow: '0 0 4px #00B4FF',
              animation: 'pulse 2s infinite',
            }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: '#ccc',
            fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {k.name}
            {isActive && (
              <span style={{ fontSize: 8, fontWeight: 700, color: '#00B4FF', background: '#00B4FF14', border: '1px solid #00B4FF44', borderRadius: 2, padding: '1px 4px', letterSpacing: '0.06em', flexShrink: 0 }}>
                ACTIVE
              </span>
            )}
          </div>
          <div style={{ fontSize: 8, color: '#3A3A3A', fontFamily: 'monospace', marginTop: 2 }}>
            {k.projectId} · {k.key.slice(0, 12)}…
          </div>
        </div>
        <div style={{
          padding: '3px 8px', borderRadius: 3, border: `1px solid ${color}44`,
          background: color + '14',
          fontSize: 8, fontWeight: 700, color, letterSpacing: '0.08em',
          fontFamily: 'monospace', flexShrink: 0,
        }}>
          {k.status.toUpperCase()}
        </div>
      </div>

      {/* Per-key quota — large prominent display */}
      <div style={{
        background: '#0a0a0a', border: '1px solid #141414',
        borderRadius: 6, padding: '10px 12px',
      }}>
        {/* Main quota bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: color, fontFamily: 'monospace' }}>
              {remaining.toLocaleString()}
            </span>
            <span style={{ fontSize: 9, color: '#555' }}>remaining</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>
              {k.usedToday.toLocaleString()} used
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'monospace' }}>
              {pct}%
            </span>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{
          height: 14, background: '#141414', borderRadius: 3, overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%', background: color,
            borderRadius: 3, transition: 'width 0.5s',
            boxShadow: `0 0 8px ${color}44`,
          }} />
          <div style={{ position: 'absolute', top: 0, left: '75%', width: 1, height: '100%', background: '#2a2a2a' }} />
          <div style={{ position: 'absolute', top: 0, left: '90%', width: 1, height: '100%', background: '#444' }} />
        </div>
        {/* Sub info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 8, color: '#2a2a2a', fontFamily: 'monospace' }}>
            0 <span style={{ color: '#333' }}>|</span> {Math.round(9500 * 0.75).toLocaleString()} <span style={{ color: '#333' }}>|</span> {(9500 * 0.9).toLocaleString()} <span style={{ color: '#333' }}>|</span> 9,500
          </span>
          <span style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>
            10,000 units/day
          </span>
        </div>
      </div>

      {/* Usage timeline */}
      <div>
        <div style={{ fontSize: 8, color: '#2A2A2A', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 700 }}>USAGE TIMELINE (24H PT)</div>
        <UsageTimeline events={events} />
      </div>

      {/* Metadata row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {k.errors > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 8, color: '#FF6644' }}>⚠ {k.errors} errors</span>
          </div>
        )}
        <span style={{ fontSize: 8, color: '#3A3A3A', fontFamily: 'monospace' }}>
          last used {formatTimeAgo(k.lastUsed)}
        </span>
        {k.lastReset && (
          <span style={{ fontSize: 8, color: '#00FF8877', fontFamily: 'monospace' }}>
            ↺ reset {formatTimeAgo(k.lastReset)}
          </span>
        )}
        <span style={{ fontSize: 8, color: '#222', marginLeft: 'auto', fontFamily: 'monospace' }}>
          next reset {formatNextReset(k.nextReset)}
        </span>
      </div>

      {/* Actions */}
      {!showRemoveConfirm ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleReset}
            disabled={resetting}
            style={{
              height: 28, paddingLeft: 10, paddingRight: 10,
              background: resetting ? '#00FF8820' : 'transparent',
              border: `1px solid ${resetting ? '#00FF88' : '#00FF8844'}`,
              borderRadius: 4, fontSize: 9, fontWeight: 700, color: '#00FF88',
              cursor: resetting ? 'default' : 'pointer', opacity: resetting ? 0.8 : 1,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { if (!resetting) { e.currentTarget.style.background = '#00FF8820' } }}
            onMouseLeave={e => { if (!resetting) { e.currentTarget.style.background = 'transparent' } }}
          >
            {resetting ? '✓' : '↺'}
          </button>
          <button
            onClick={() => onTest(k.key)}
            style={{
              flex: 1, height: 28,
              background: 'transparent',
              border: '1px solid #00B4FF44',
              borderRadius: 4, fontSize: 9, fontWeight: 700, color: '#00B4FF',
              cursor: 'pointer', opacity: k.status === 'unauthorized' ? 1 : 0.7,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00B4FF22' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {k.status === 'unauthorized' ? '⚠ TEST / AUTHORIZE' : 'TEST'}
          </button>
          <button
            onClick={() => setShowRemoveConfirm(true)}
            style={{
              height: 28, width: 70,
              background: 'transparent',
              border: '1px solid #FF444444',
              borderRadius: 4, fontSize: 9, fontWeight: 700, color: '#FF444466',
              cursor: 'pointer', opacity: 0.7,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#FF4444'; e.currentTarget.style.opacity = '1'; e.currentTarget.style.borderColor = '#FF4444' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#FF444466'; e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.borderColor = '#FF444444' }}
          >
            ✕
          </button>
        </div>
      ) : (
        <div style={{
          padding: '8px 10px',
          background: '#1a0808', border: '1px solid #FF444433',
          borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 9, color: '#FF6644', flex: 1 }}>
            Xóa key này? Không thể hoàn tác.
          </span>
          <button onClick={handleRemove} style={{ height: 24, paddingLeft: 10, paddingRight: 10, background: '#aa2222', border: 'none', borderRadius: 3, color: '#fff', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
            Xóa
          </button>
          <button onClick={() => setShowRemoveConfirm(false)} style={{ height: 24, paddingLeft: 10, paddingRight: 10, background: 'transparent', border: '1px solid #333', borderRadius: 3, color: '#555', fontSize: 9, cursor: 'pointer' }}>
            Hủy
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Add Key Form ───────────────────────────────────────────────────────────────

function AddKeyForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [newKeyName, setNewKeyName] = useState('')
  const [newProjectId, setNewProjectId] = useState('proj-01')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const { showToast } = useAppStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError('')
    if (!newKey.trim()) { setAddError('API Key is required'); return }
    if (!newKey.startsWith('AIza')) { setAddError('Invalid YouTube API Key format (must start with AIza)'); return }
    setAdding(true)
    try {
      const result = await ipc.addKey(newKey.trim(), newProjectId.trim() || 'proj-01', newKeyName.trim() || 'Default')
      if (result.success) {
        showToast(`Key "${newKeyName || newKey.slice(0, 12)}..." đã thêm và validated`)
        onAdded()
      } else {
        setAddError(result.error || 'Key không hợp lệ')
      }
    } catch (e: any) { setAddError(e.message) }
    finally { setAdding(false) }
  }

  return (
    <div style={{
      background: '#0A0A0A', border: '1px solid #1E1E1E',
      borderRadius: 8, padding: '16px',
    }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: '#444', letterSpacing: '0.12em', marginBottom: 12 }}>THÊM API KEY MỚI</div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          autoFocus value={newKey} onChange={e => setNewKey(e.target.value)}
          placeholder="AIzaSy..."
          style={{ width: '100%', height: 32, background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 4, paddingLeft: 10, fontSize: 11, color: '#ccc', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newProjectId} onChange={e => setNewProjectId(e.target.value)}
            placeholder="proj-01"
            style={{ flex: 1, height: 32, background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 4, paddingLeft: 10, fontSize: 10, color: '#ccc', outline: 'none', fontFamily: 'monospace' }}
          />
          <input
            value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
            placeholder="Tên key (tùy chọn)"
            style={{ flex: 2, height: 32, background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 4, paddingLeft: 10, fontSize: 10, color: '#ccc', outline: 'none' }}
          />
        </div>
        {addError && <div style={{ fontSize: 9, color: '#FF6644' }}>{addError}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={adding} style={{ flex: 1, height: 30, background: '#00B4FF', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#000', cursor: adding ? 'not-allowed' : 'pointer', opacity: adding ? 0.6 : 1 }}>
            {adding ? '...' : 'Thêm Key'}
          </button>
          <button type="button" onClick={onClose} style={{ height: 30, paddingLeft: 14, paddingRight: 14, background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 10, color: '#555', cursor: 'pointer' }}>
            Hủy
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── API Keys Dashboard ─────────────────────────────────────────────────────────

function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'healthy' | 'warning' | 'exhausted' | 'unauthorized'>('all')
  const [testingAll, setTestingAll] = useState(false)
  // Track hourly events per key: record timestamp each poll where usedToday increased
  const [hourlyEvents, setHourlyEvents] = useState<Record<string, number[]>>({})
  const [prevUsedToday, setPrevUsedToday] = useState<Record<string, number>>({})
  const { showToast } = useAppStore()

  const load = () => {
    ipc.getKeys().then((k: any) => {
      const newKeys = k as ApiKeyStatus[]
      setKeys(newKeys)

      // Track events: if usedToday increased since last poll, record a timestamp
      setHourlyEvents(prev => {
        const next = { ...prev }
        for (const keyData of newKeys) {
          const prevVal = prevUsedToday[keyData.key] ?? -1
          if (keyData.usedToday > prevVal) {
            const events = next[keyData.key] || []
            // Record up to 24 events max (one per bucket)
            const MAX_EVENTS = 24
            const newEvents = [...events, Date.now()].slice(-MAX_EVENTS)
            next[keyData.key] = newEvents
          }
        }
        return next
      })

      // Update prevUsedToday
      const next: Record<string, number> = {}
      for (const keyData of newKeys) next[keyData.key] = keyData.usedToday
      setPrevUsedToday(next)

      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [])

  const handleReset = async (key: string) => {
    const result = await ipc.resetKey(key)
    if (result.success) {
      load()
      showToast(`Reset thành công! Next auto-reset: ${formatNextReset(result.nextReset)}`)
    }
  }

  const handleRemove = async (key: string) => {
    await ipc.removeKey(key)
    setHourlyEvents(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    load()
    showToast('Key đã xóa')
  }

  const handleTest = async (key: string) => {
    showToast('Đang kiểm tra key...')
    const result = await ipc.testKey(key)
    if (result.valid) {
      showToast(`Key hợp lệ ✓`)
    } else {
      const msg = result.errorType === 'unauthorized'
        ? `Key không hợp lệ: ${result.error}`
        : result.errorType === 'quota_exhausted'
          ? `Key hết quota: ${result.error}`
          : `Lỗi: ${result.error}`
      showToast(msg)
    }
    load()
  }

  const handleResetAll = async () => {
    await ipc.resetKey()
    await ipc.resumePoller()
    load()
    showToast('Đã reset tất cả quotas! Poller tiếp tục.')
  }

  const handleTestAll = async () => {
    setTestingAll(true)
    const result = await ipc.testAllKeys()
    const validCount = result.results.filter(r => r.valid).length
    const invalidCount = result.results.length - validCount
    if (invalidCount > 0) {
      showToast(`Đã test ${result.results.length} keys: ${validCount} OK, ${invalidCount} có vấn đề`)
    } else {
      showToast(`Tất cả ${validCount} keys đều hợp lệ ✓`)
    }
    load()
    setTestingAll(false)
  }

  // Summary stats
  const totalKeys = keys.length
  const healthyKeys = keys.filter(k => k.status === 'healthy').length
  const warningKeys = keys.filter(k => k.status === 'warning').length
  const exhaustedKeys = keys.filter(k => k.status === 'exhausted').length
  const unauthorizedKeys = keys.filter(k => k.status === 'unauthorized').length
  const totalUsed = keys.reduce((s, k) => s + k.usedToday, 0)
  const totalQuota = keys.length * 9500
  const overallPct = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0
  const nextReset = keys[0]?.nextReset || null

  // Filter keys
  const dedupedKeys = (() => {
    const seen = new Set<string>()
    return keys.filter(k => {
      if (seen.has(k.key)) return false
      seen.add(k.key)
      return true
    })
  })()

  // Find the most recently used key (active key)
  const mostRecentTs = Math.max(...dedupedKeys.map(k => k.lastUsed || 0), 0)
  const isKeyActive = (ts: number | null) => ts && mostRecentTs > 0 && (mostRecentTs - ts) < 30000

  const filteredKeys = filter === 'all' ? dedupedKeys
    : filter === 'healthy' ? dedupedKeys.filter(k => k.status === 'healthy')
    : filter === 'warning' ? dedupedKeys.filter(k => k.status === 'warning')
    : filter === 'exhausted' ? dedupedKeys.filter(k => k.status === 'exhausted')
    : dedupedKeys.filter(k => k.status === 'unauthorized')

  const filterCounts = {
    all: dedupedKeys.length,
    healthy: dedupedKeys.filter(k => k.status === 'healthy').length,
    warning: dedupedKeys.filter(k => k.status === 'warning').length,
    exhausted: dedupedKeys.filter(k => k.status === 'exhausted').length,
    unauthorized: dedupedKeys.filter(k => k.status === 'unauthorized').length,
  }

  const now = new Date()
  const refreshTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Full-width header */}
      <div style={{
        padding: '14px 20px',
        background: '#0B0B0B',
        borderBottom: '1px solid #1A1A1A',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>API KEY MANAGEMENT</div>
          <div style={{ width: 1, height: 12, background: '#222' }} />
          <span style={{ fontSize: 8, color: '#333' }}>last refresh {refreshTime}</span>
          {loading && <span style={{ fontSize: 8, color: '#00B4FF44' }}>● polling...</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={handleTestAll}
            disabled={testingAll}
            style={{
              height: 26, paddingLeft: 10, paddingRight: 10,
              background: testingAll ? '#00B4FF14' : 'transparent',
              border: '1px solid #00B4FF44', borderRadius: 4,
              fontSize: 8, fontWeight: 700, color: testingAll ? '#00B4FF88' : '#00B4FF',
              cursor: testingAll ? 'not-allowed' : 'pointer', letterSpacing: '0.06em',
              transition: 'all 0.15s',
              opacity: testingAll ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (!testingAll) { e.currentTarget.style.background = '#00B4FF22' } }}
            onMouseLeave={e => { if (!testingAll) { e.currentTarget.style.background = 'transparent' } }}
          >
            {testingAll ? '... TESTING' : '⚡ TEST ALL'}
          </button>
          <button
            onClick={handleResetAll}
            style={{
              height: 26, paddingLeft: 10, paddingRight: 10,
              background: 'transparent', border: '1px solid #FFB80033', borderRadius: 4,
              fontSize: 8, fontWeight: 700, color: '#FFB80066', cursor: 'pointer', letterSpacing: '0.06em',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#FFB800'; e.currentTarget.style.borderColor = '#FFB80066' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#FFB80066'; e.currentTarget.style.borderColor = '#FFB80033' }}
          >
            ↺ RESET ALL
          </button>
          <button
            onClick={() => setShowAddForm(v => !v)}
            style={{
              height: 26, paddingLeft: 10, paddingRight: 10,
              background: showAddForm ? '#00B4FF22' : 'transparent',
              border: `1px solid ${showAddForm ? '#00B4FF66' : '#00B4FF33'}`, borderRadius: 4,
              fontSize: 8, fontWeight: 700, color: '#00B4FF', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            + THÊM KEY
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #141414', background: '#0A0A0A' }}>
          <AddKeyForm onClose={() => setShowAddForm(false)} onAdded={() => { setShowAddForm(false); load() }} />
        </div>
      )}

            {/* Exhausted / Unauthorized alert banner */}
      {(exhaustedKeys > 0 || unauthorizedKeys > 0) && (
        <div style={{
          padding: '10px 20px',
          background: '#1a0808',
          borderBottom: '1px solid #2a1010',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4444', flexShrink: 0, boxShadow: '0 0 6px #FF444488' }} />
            <span style={{ fontSize: 10, color: '#FF6644', fontWeight: 700 }}>
              {exhaustedKeys > 0 && `${exhaustedKeys} key${exhaustedKeys > 1 ? 's' : ''} quá tải quota`}
              {exhaustedKeys > 0 && unauthorizedKeys > 0 && ' · '}
              {unauthorizedKeys > 0 && `${unauthorizedKeys} key${unauthorizedKeys > 1 ? 's' : ''} không hợp lệ`}
            </span>
            <span style={{ fontSize: 9, color: '#FF444466' }}>— auto-reset midnight PT</span>
          </div>
          <button
            onClick={() => setFilter(exhaustedKeys > 0 ? 'exhausted' : 'unauthorized')}
            style={{
              height: 22, paddingLeft: 8, paddingRight: 8,
              background: '#FF444422', border: '1px solid #FF444444',
              borderRadius: 3, cursor: 'pointer',
              fontSize: 9, fontWeight: 700, color: '#FF6644',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#FF444433' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#FF444422' }}
          >
            XEM →
          </button>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid #141414', background: '#0C0C0C' }}>
        <StatCard
          label="TOTAL KEYS"
          value={String(totalKeys)}
          sub={`${totalKeys > 0 ? Math.round(totalUsed / totalKeys) : 0} units/key avg`}
          color="#ccc"
          icon={<div style={{ width: 6, height: 6, borderRadius: 1, background: '#444' }} />}
        />
        <StatCard
          label="HEALTHY"
          value={`${healthyKeys}/${totalKeys}`}
          sub="keys available"
          color="#00FF88"
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00FF88' }} />}
        />
        <StatCard
          label="WARNING"
          value={String(warningKeys)}
          sub="75-90% quota"
          color={warningKeys > 0 ? '#FFB800' : '#2a2a2a'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: warningKeys > 0 ? '#FFB800' : '#2a2a2a' }} />}
        />
        <StatCard
          label="EXHAUSTED"
          value={String(exhaustedKeys)}
          sub="needs reset"
          color={exhaustedKeys > 0 ? '#FF4444' : '#2a2a2a'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: exhaustedKeys > 0 ? '#FF4444' : '#2a2a2a' }} />}
        />
        <StatCard
          label="UNAUTHORIZED"
          value={String(unauthorizedKeys)}
          sub="invalid keys"
          color={unauthorizedKeys > 0 ? '#FF6644' : '#2a2a2a'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: unauthorizedKeys > 0 ? '#FF6644' : '#2a2a2a' }} />}
        />
        <StatCard
          label="NEXT RESET"
          value={formatNextReset(nextReset)}
          sub="midnight PT"
          color="#555"
          icon={
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="4" stroke="#333" strokeWidth="1" />
              <path d="M5 2 L5 5 L7 5" stroke="#333" strokeWidth="1" strokeLinecap="round" />
            </svg>
          }
        />
      </div>

      {/* Per-key quota distribution chart */}
      {dedupedKeys.length > 0 && (
        <div style={{ padding: '12px 20px', background: '#0D0D0D', borderBottom: '1px solid #141414' }}>
          <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>KEY QUOTA DISTRIBUTION</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {dedupedKeys
              .sort((a, b) => b.usedToday - a.usedToday)
              .map(k => {
                const pct = k.quotaPercent
                const barColor = pct >= 90 ? '#FF4444' : pct >= 75 ? '#FFB800' : pct > 0 ? '#00B4FF' : '#2a2a2a'
                const remaining = Math.max(0, k.quotaTotal - k.usedToday)
                const isRecent = isKeyActive(k.lastUsed)
                return (
                  <div key={k.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Key label */}
                    <div style={{
                      minWidth: 100, fontSize: 9, color: isRecent ? '#00B4FF' : '#555',
                      fontFamily: 'monospace', fontWeight: isRecent ? 700 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {isRecent && <span style={{ color: '#00B4FF', marginRight: 3 }}>●</span>}
                      {k.name}
                    </div>
                    {/* Used bar */}
                    <div style={{ flex: 1, height: 12, background: '#141414', borderRadius: 2, position: 'relative' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', background: barColor,
                        borderRadius: 2, transition: 'width 0.5s',
                        boxShadow: pct > 0 ? `0 0 4px ${barColor}44` : 'none',
                      }} />
                      {/* 75% and 90% markers */}
                      <div style={{ position: 'absolute', top: 0, left: '75%', width: 1, height: '100%', background: '#333' }} />
                      <div style={{ position: 'absolute', top: 0, left: '90%', width: 1, height: '100%', background: '#555' }} />
                    </div>
                    {/* Stats */}
                    <div style={{ minWidth: 140, fontSize: 8, color: '#333', fontFamily: 'monospace', textAlign: 'right' }}>
                      <span style={{ color: barColor }}>{k.usedToday.toLocaleString()}</span>
                      <span style={{ color: '#2a2a2a' }}>/</span>
                      <span>{k.quotaTotal.toLocaleString()}</span>
                      <span style={{ color: '#222', marginLeft: 4 }}>{remaining.toLocaleString()} left</span>
                    </div>
                  </div>
                )
              })}
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 7, color: '#333' }}>● ACTIVE = used in last 30s</span>
            <span style={{ fontSize: 7, color: '#2a2a2a' }}>| 75%</span>
            <span style={{ fontSize: 7, color: '#333' }}>| 90%</span>
          </div>
        </div>
      )}

            {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '8px 20px', borderBottom: '1px solid #141414', background: '#0C0C0C' }}>
        {(['all', 'healthy', 'warning', 'exhausted', 'unauthorized'] as const).map(f => {
          const isActive = filter === f
          const count = filterCounts[f]
          const tabColors: Record<string, string> = { all: '#888', healthy: '#00FF88', warning: '#FFB800', exhausted: '#FF4444', unauthorized: '#FF6644' }
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                height: 24, paddingLeft: 10, paddingRight: 10,
                background: isActive ? '#141414' : 'transparent',
                border: `1px solid ${isActive ? '#222' : 'transparent'}`,
                borderRadius: 4, cursor: 'pointer', fontSize: 8, fontWeight: 700,
                color: isActive ? tabColors[f] : '#444',
                letterSpacing: '0.08em', transition: 'all 0.15s',
              }}
            >
              {f.toUpperCase()} ({count})
            </button>
          )
        })}
      </div>

      {/* Keys grid */}
      <div style={{ padding: '14px 20px', background: '#0A0A0A' }}>
        {loading && keys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 10, color: '#333' }}>Đang tải...</div>
          </div>
        ) : filteredKeys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 10, color: '#2a2a2a', marginBottom: 8 }}>
              {filter !== 'all' ? `Không có key nào ở trạng thái "${filter}"` : 'Chưa có API key nào'}
            </div>
            {filter === 'all' && (
              <button
                onClick={() => setShowAddForm(true)}
                style={{
                  height: 28, paddingLeft: 14, paddingRight: 14,
                  background: '#00B4FF22', border: '1px solid #00B4FF44', borderRadius: 4,
                  fontSize: 9, fontWeight: 700, color: '#00B4FF', cursor: 'pointer',
                }}
              >
                + Thêm API Key đầu tiên
              </button>
            )}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 12,
          }}>
            {filteredKeys.map(k => (
              <KeyCard
                key={k.key}
                k={k}
                events={hourlyEvents[k.key] || []}
                onRemove={handleRemove}
                onReset={handleReset}
                onTest={handleTest}
                isActive={isKeyActive(k.lastUsed)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Projects Section ───────────────────────────────────────────────────────────

function ProjectsSection() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState<'all' | 'healthy' | 'warning' | 'exhausted' | 'no_oauth' | 'unauthorized'>('all')
  const { showToast } = useAppStore()

  const load = () => {
    setLoading(true)
    ipc.getProjects().then((p: any) => {
      setProjects(p as Project[])
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const interval = setInterval(load, 8000)
    return () => clearInterval(interval)
  }, [])

  const handleSyncChannels = async () => {
    setSyncing(true)
    try {
      const result = await ipc.syncChannels()
      if (result.added > 0 || result.removed > 0) {
        useAppStore.getState().showToast(`Đã đồng bộ: +${result.added} kênh mới, -${result.removed} kênh đã xóa`)
      } else {
        useAppStore.getState().showToast('Không có kênh mới để đồng bộ')
      }
    } catch (e: any) {
      useAppStore.getState().showToast(`Lỗi sync: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const totalUsed = projects.reduce((s, p) => s + p.usedToday, 0)
  const totalQuota = projects.length * 9500
  const totalPct = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0

  const healthyProjects = projects.filter(p => p.status === 'healthy').length
  const warningProjects = projects.filter(p => p.status === 'warning').length
  const exhaustedProjects = projects.filter(p => p.status === 'exhausted').length
  const noOauthProjects = projects.filter(p => p.status === 'no_oauth').length
  const unauthorizedProjects = projects.filter(p => p.status === 'unauthorized').length

  const filterCounts = {
    all: projects.length,
    healthy: healthyProjects,
    warning: warningProjects,
    exhausted: exhaustedProjects,
    no_oauth: noOauthProjects,
    unauthorized: unauthorizedProjects,
  }

  const filteredProjects = filter === 'all' ? projects
    : filter === 'healthy' ? projects.filter(p => p.status === 'healthy')
    : filter === 'warning' ? projects.filter(p => p.status === 'warning')
    : filter === 'exhausted' ? projects.filter(p => p.status === 'exhausted')
    : filter === 'no_oauth' ? projects.filter(p => p.status === 'no_oauth')
    : projects.filter(p => p.status === 'unauthorized')

  const handleResetProject = async (projectId: string) => {
    await ipc.resetProjectQuota(projectId)
    await ipc.resumePoller()
    showToast(`Quota ${projectId} đã reset — poller tiếp tục`)
    load()
  }

  return (
    <div>
      {/* Alert banner for exhausted / no_oauth projects */}
      {(exhaustedProjects > 0 || noOauthProjects > 0 || unauthorizedProjects > 0) && (
        <div style={{
          padding: '10px 14px',
          background: '#1a0808',
          borderBottom: '1px solid #2a1010',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4444', flexShrink: 0, boxShadow: '0 0 6px #FF444488' }} />
            <span style={{ fontSize: 10, color: '#FF6644', fontWeight: 700 }}>
              {exhaustedProjects > 0 && `${exhaustedProjects} project${exhaustedProjects > 1 ? 's' : ''} quá tải quota`}
              {exhaustedProjects > 0 && noOauthProjects > 0 && ' · '}
              {noOauthProjects > 0 && `${noOauthProjects} project${noOauthProjects > 1 ? 's' : ''} chưa authorize OAuth`}
              {unauthorizedProjects > 0 && (exhaustedProjects > 0 || noOauthProjects > 0 ? ' · ' : '') + `${unauthorizedProjects} project${unauthorizedProjects > 1 ? 's' : ''} key không hợp lệ`}
            </span>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderBottom: '1px solid #141414', background: '#0C0C0C', overflowX: 'auto' }}>
        <div style={{ minWidth: 80, padding: '8px 10px', background: '#0D0D0D', border: '1px solid #1A1A1A', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.08em' }}>TOTAL</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#888', fontFamily: 'monospace' }}>{projects.length}</div>
        </div>
        <div style={{ minWidth: 80, padding: '8px 10px', background: '#0D0D0D', border: '1px solid #1A1A1A', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.08em' }}>HEALTHY</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: healthyProjects > 0 ? '#00FF88' : '#2a2a2a', fontFamily: 'monospace' }}>{healthyProjects}</div>
        </div>
        <div style={{ minWidth: 80, padding: '8px 10px', background: '#0D0D0D', border: '1px solid #1A1A1A', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.08em' }}>WARNING</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: warningProjects > 0 ? '#FFB800' : '#2a2a2a', fontFamily: 'monospace' }}>{warningProjects}</div>
        </div>
        <div style={{ minWidth: 80, padding: '8px 10px', background: '#0D0D0D', border: '1px solid #1A1A1A', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.08em' }}>EXHAUSTED</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: exhaustedProjects > 0 ? '#FF4444' : '#2a2a2a', fontFamily: 'monospace' }}>{exhaustedProjects}</div>
        </div>
        <div style={{ minWidth: 80, padding: '8px 10px', background: '#0D0D0D', border: '1px solid #1A1A1A', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.08em' }}>NO OAUTH</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: noOauthProjects > 0 ? '#FFB800' : '#2a2a2a', fontFamily: 'monospace' }}>{noOauthProjects}</div>
        </div>
        {unauthorizedProjects > 0 && (
          <div style={{ minWidth: 80, padding: '8px 10px', background: '#0D0D0D', border: '1px solid #1A1A1A', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.08em' }}>UNAUTH</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#FF6644', fontFamily: 'monospace' }}>{unauthorizedProjects}</div>
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '6px 14px', borderBottom: '1px solid #141414', background: '#0B0B0B', overflowX: 'auto' }}>
        {(['all', 'healthy', 'warning', 'exhausted', 'no_oauth'] as const).map(f => {
          const isActive = filter === f
          const tabColors: Record<string, string> = { all: '#888', healthy: '#00FF88', warning: '#FFB800', exhausted: '#FF4444', no_oauth: '#FFB800' }
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                height: 22, paddingLeft: 8, paddingRight: 8,
                background: isActive ? '#141414' : 'transparent',
                border: `1px solid ${isActive ? '#222' : 'transparent'}`,
                borderRadius: 3, cursor: 'pointer', fontSize: 8, fontWeight: 700,
                color: isActive ? tabColors[f] : '#444',
                letterSpacing: '0.08em', whiteSpace: 'nowrap',
              }}
            >
              {f === 'no_oauth' ? 'NO OAUTH' : f.toUpperCase()} ({filterCounts[f]})
            </button>
          )
        })}
      </div>

      {/* Summary bar */}
      {!loading && (
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="flex items-center gap-2">
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: totalPct > 80 ? '#FFB800' : '#00FF88',
              boxShadow: `0 0 4px ${totalPct > 80 ? '#FFB800' : '#00FF88'}66`,
            }} />
            <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>
              {projects.length} projects · {(totalUsed / 1000).toFixed(1)}k / {(totalQuota / 1000).toFixed(0)}k units
            </span>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              height: 22, paddingLeft: 8, paddingRight: 8,
              background: 'transparent', border: '1px solid #00B4FF44', borderRadius: 3,
              cursor: 'pointer', color: '#00B4FF', fontSize: 9, fontWeight: 600,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00B4FF22' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >+ Thêm Project</button>
          <button
            onClick={handleSyncChannels}
            disabled={syncing}
            style={{
              height: 22, paddingLeft: 8, paddingRight: 8,
              background: 'transparent', border: '1px solid #00FF8844', borderRadius: 3,
              cursor: syncing ? 'not-allowed' : 'pointer', color: '#00FF88', fontSize: 9, fontWeight: 600,
              opacity: syncing ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (!syncing) { e.currentTarget.style.background = '#00FF8822' } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >{syncing ? 'Đang sync...' : '↻ Refresh kênh'}</button>
        </div>
      )}

      {/* Info */}
      <div style={{ padding: '0 14px 8px', fontSize: 9, color: '#444', lineHeight: '14px' }}>
        Mỗi project = OAuth + API Key = 10,000 units/ngày.
        Thêm project để tăng quota polling.
        <br />Quota reset mỗi 24h (midnight PT).
      </div>

      {/* Project list */}
      {loading ? (
        <div style={{ fontSize: 10, color: '#444', textAlign: 'center', padding: '16px' }}>Đang tải...</div>
      ) : filteredProjects.length === 0 ? (
        <div style={{ padding: '24px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#333', marginBottom: 12 }}>
            {filter !== 'all' ? `Không có project ở trạng thái "${filter}"` : 'Chưa có project nào. Thêm Google Cloud project để bắt đầu.'}
          </div>
          {filter === 'all' && (
            <button
              onClick={() => setShowAdd(true)}
              style={{
                height: 28, paddingLeft: 14, paddingRight: 14,
                background: '#00B4FF', border: 'none', borderRadius: 4,
                fontSize: 10, fontWeight: 700, color: '#000', cursor: 'pointer',
              }}
            >+ Thêm Project đầu tiên</button>
          )}
        </div>
      ) : (
        <div style={{ padding: '0 14px 14px' }}>
          {filteredProjects.map(p => (
            <ProjectCard key={p.projectId} project={p} onRefresh={load} onReset={() => handleResetProject(p.projectId)} />
          ))}
        </div>
      )}

      {showAdd && <AddProjectForm onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load() }} />}
    </div>
  )
}

// ─── Chrome Sessions Section ────────────────────────────────────────────────────

function SessionsSection() {
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
    load()
  }

  const handleOpenLogin = async (profileId: string) => {
    const result = await ipc.openSessionLogin(profileId)
    if (result.success) {
      showToast(`Đã mở Chrome — đăng nhập YouTube, HyperClip sẽ tự đọc cookies`)
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
              {consented.map(s => (
                <div key={s.profileId} style={{
                  background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 4,
                  padding: '6px 10px', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00FF88', flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: '#888', flex: 1 }}>{s.profileName}</span>
                  <span style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>
                    used {s.usedToday}x
                  </span>
                </div>
              ))}
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

// ─── Poller Status Panel ────────────────────────────────────────────────────────

function PollerStatusPanel() {
  const { showToast } = useAppStore()
  const [pollerStatus, setPollerStatus] = useState<any>(null)
  const [sessionStatus, setSessionStatus] = useState<any>(null)
  const [projectStatus, setProjectStatus] = useState<any>(null)
  const [keyStatus, setKeyStatus] = useState<any>(null)

  const load = () => {
    ipc.getPollerStatus().then(setPollerStatus).catch(() => {})
    ipc.getSessionStatus().then(setSessionStatus).catch(() => {})
    ipc.getProjects().then(setProjectStatus).catch(() => {})
    ipc.getKeys().then(setKeyStatus).catch(() => {})
  }

  useEffect(() => { load() }, [])
  useEffect(() => { const t = setInterval(load, 8000); return () => clearInterval(t) }, [])

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

  const detectionPath = hasInnertube ? 'innertube' : hasOAuth ? 'oauth' : null
  const primaryFix = !hasInnertube ? 'sessions' : !hasOAuth ? 'projects' : null

  const handleResume = async () => {
    await ipc.resumePoller()
    showToast('Đã resume poller — sẽ thử lại sau vài giây')
    load()
  }

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
        </div>

        {/* Fix call-to-action */}
        {isBackedOff && primaryFix && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#0a0a0a', border: '1px solid #1a1a1a',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: '#555' }}>→</span>
            <span style={{ fontSize: 10, color: '#888' }}>
              Fix:{' '}
              <span style={{ color: '#00B4FF', fontWeight: 700 }}>
                Đăng nhập 1 Chrome profile
              </span>
              {' '}→ tab{' '}
              <button
                onClick={() => { const btn = document.querySelector('[data-tab="sessions"]') as HTMLButtonElement; btn?.click() }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 700, color: '#FF6644', padding: 0,
                }}
              >
                INNERTUBE SESSIONS
              </button>
              <span style={{ color: '#555' }}> (chỉ cần 1-2 profile là đủ)</span>
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
              Poller đang chạy với OAuth (có quota limit). Khuyến nghị: thêm Innertube Sessions để không cần OAuth quota.
            </span>
          </div>
        )}

        {/* Running with Innertube */}
        {!isBackedOff && hasInnertube && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#0a1a0a', border: '1px solid #00FF8844',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: '#00FF88' }}>✓</span>
            <span style={{ fontSize: 10, color: '#666' }}>
              Innertube Sessions đang active — không cần OAuth quota để poll.
            </span>
          </div>
        )}
      </div>

      {/* Quick action cards */}
      {!hasInnertube && (
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => { const btn = document.querySelector('[data-tab="sessions"]') as HTMLButtonElement; btn?.click() }}
            style={{
              flex: 1, padding: '14px 16px',
              background: '#0d1520', border: '1px solid #FF664444',
              borderRadius: 6, cursor: 'pointer', textAlign: 'left',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#0d1a2a'; e.currentTarget.style.borderColor = '#FF664466' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0d1520'; e.currentTarget.style.borderColor = '#FF664444' }}
          >
            <div style={{ fontSize: 10, fontWeight: 800, color: '#FF6644', letterSpacing: '0.08em', marginBottom: 4 }}>
              INNERUBE SESSIONS — KHẮC PHỤC NGAY
            </div>
            <div style={{ fontSize: 9, color: '#666', lineHeight: '14px' }}>
              Chỉ cần đăng nhập <span style={{ color: '#FF6644', fontWeight: 700 }}>1 Chrome profile</span> là đủ.
              Mỗi session không có quota limit — thay thế hoàn toàn OAuth.
            </div>
          </button>

          <button
            onClick={() => { const btn = document.querySelector('[data-tab="projects"]') as HTMLButtonElement; btn?.click() }}
            style={{
              flex: 1, padding: '14px 16px',
              background: '#0d1520', border: '1px solid #00FF8844',
              borderRadius: 6, cursor: 'pointer', textAlign: 'left',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#0d1f15'; e.currentTarget.style.borderColor = '#00FF8866' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0d1520'; e.currentTarget.style.borderColor = '#00FF8844' }}
          >
            <div style={{ fontSize: 10, fontWeight: 800, color: '#00FF88', letterSpacing: '0.08em', marginBottom: 4 }}>
              GOOGLE PROJECTS — FALLBACK
            </div>
            <div style={{ fontSize: 9, color: '#666', lineHeight: '14px' }}>
              Thêm Google Cloud project để có thêm quota (10k units/project/ngày).
              OAuth cần refresh token và có giới hạn.
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Settings Page ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { settings, systemStats, setSettings } = useAppStore()
  const [gateState, setGateState] = useState<'loading' | 'setup' | 'locked' | 'unlocked'>('loading')
  // Always declare all hooks before any early returns to satisfy Rules of Hooks
  const [activeTab, setActiveTab] = useState<'status' | 'keys' | 'projects' | 'sessions' | 'system'>('status')

  const TABS = [
    { id: 'status' as const, label: 'STATUS', color: '#00FF88' },
    { id: 'sessions' as const, label: 'INNERUBE SESSIONS', color: '#FF6644' },
    { id: 'projects' as const, label: 'GOOGLE PROJECTS', color: '#00FF88' },
    { id: 'keys' as const, label: 'API KEYS', color: '#00B4FF' },
    { id: 'system' as const, label: 'SYSTEM', color: '#FFB800' },
  ]

  useEffect(() => {
    ipc.adminHasPassword().then(result => {
      setGateState(result.has ? 'locked' : 'setup')
    })
  }, [])

  if (gateState === 'loading') return (
    <div style={{ height: '100vh', background: '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 10, color: '#444', fontFamily: 'monospace' }}>Loading...</div>
    </div>
  )
  if (gateState === 'setup') return <PasswordSetup onDone={() => setGateState('unlocked')} />
  if (gateState === 'locked') return <PasswordGate onUnlock={() => setGateState('unlocked')} />

  return (
    <div style={{ height: '100vh', background: '#0A0A0A', fontFamily: 'Inter, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        height: 48, background: '#0D0D0D', borderBottom: '1px solid #1A1A1A',
        display: 'flex', alignItems: 'center', paddingLeft: 20, gap: 16, flexShrink: 0,
      }}>
        <Link href="/" style={{ fontSize: 10, color: '#444', textDecoration: 'none', fontWeight: 600, letterSpacing: '0.08em' }}>← BACK</Link>
        <div style={{ width: 1, height: 12, background: '#222' }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>SETTINGS</span>
        <div style={{ width: 1, height: 12, background: '#222' }} />

        {/* Tabs */}
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              data-tab={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                height: 28, paddingLeft: 12, paddingRight: 12,
                background: isActive ? '#141414' : 'transparent',
                border: `1px solid ${isActive ? tab.color + '44' : 'transparent'}`,
                borderRadius: 4, cursor: 'pointer',
                fontSize: 8, fontWeight: 700,
                color: isActive ? tab.color : '#444',
                letterSpacing: '0.08em', transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* STATUS — Poller health dashboard */}
        {activeTab === 'status' && <PollerStatusPanel />}

        {/* API Keys — full width */}
        {activeTab === 'keys' && (
          <ApiKeysSection />
        )}

        {/* Innertube Sessions */}
        {activeTab === 'sessions' && (
          <div style={{ padding: '20px', maxWidth: 900 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>INNERUBE SESSIONS (CHROME COOKIES — NO QUOTA)</div>
            <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden' }}>
              <SessionsSection />
            </div>
          </div>
        )}

        {/* Projects */}
        {activeTab === 'projects' && (
          <div style={{ padding: '20px', maxWidth: 900 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>GOOGLE PROJECTS (OAUTH FALLBACK)</div>
            <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden' }}>
              <ProjectsSection />
            </div>

            {/* Auto-download */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>AUTO-DOWNLOAD</div>
              <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #181818' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Trim Limit</div>
                    <div style={{ fontSize: 9, color: '#444' }}>Video dài hơn sẽ được cắt trước khi tải</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {([5, 8, 10, 15, 20, 'full'] as const).map(val => (
                      <button
                        key={val}
                        onClick={async () => {
                          await ipc.updateSettings({ defaultTrimLimit: val })
                          setSettings({ defaultTrimLimit: val })
                        }}
                        style={{
                          height: 26, minWidth: 42,
                          background: settings.defaultTrimLimit === val ? '#00B4FF22' : 'transparent',
                          border: `1px solid ${settings.defaultTrimLimit === val ? '#00B4FF66' : '#2a2a2a'}`,
                          borderRadius: 3, cursor: 'pointer',
                          fontSize: 9, fontWeight: 700, color: settings.defaultTrimLimit === val ? '#00B4FF' : '#555',
                          fontFamily: 'monospace',
                        }}
                      >
                        {val === 'full' ? 'FULL' : `${val}m`}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Download Quality</div>
                    <div style={{ fontSize: 9, color: '#444' }}>Chỉ tải video ≤ chất lượng này, ưu tiên H.264</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {(['360', '480', '720', '1080'] as const).map(val => (
                      <button
                        key={val}
                        onClick={async () => {
                          await ipc.updateSettings({ autoDownloadQuality: val })
                          setSettings({ autoDownloadQuality: val })
                        }}
                        style={{
                          height: 26, minWidth: 42,
                          background: (settings.autoDownloadQuality ?? '720') === val ? '#00B4FF22' : 'transparent',
                          border: `1px solid ${(settings.autoDownloadQuality ?? '720') === val ? '#00B4FF66' : '#2a2a2a'}`,
                          borderRadius: 3, cursor: 'pointer',
                          fontSize: 9, fontWeight: 700, color: (settings.autoDownloadQuality ?? '720') === val ? '#00B4FF' : '#555',
                          fontFamily: 'monospace',
                        }}
                      >
                        {val}p
                      </button>
                    ))}
                  </div>
                </div>

                {/* Output folder */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
                  <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>Output Folder</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                    <input type="text" value={settings.outputFolder} readOnly style={{ flex: 1, height: 30, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, paddingLeft: 8, fontSize: 11, color: '#888', fontFamily: 'monospace', outline: 'none' }} />
                    <button onClick={() => ipc.openFolder(settings.outputFolder)} style={{ height: 30, paddingLeft: 10, paddingRight: 10, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, fontSize: 9, fontWeight: 600, color: '#555', cursor: 'pointer' }}>OPEN</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* System tab */}
        {activeTab === 'system' && (
          <div style={{ padding: '20px', maxWidth: 700 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>SYSTEM INFO</div>
            <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden', marginBottom: 20 }}>
              {[
                ['RAM Disk', '#FFB800', '64GB DDR5'],
                [
                  'GPU',
                  (systemStats as any).gpuEncoder === 'nvenc' ? '#00FF88' : '#FFB800',
                  `${(systemStats as any).gpuName || 'Unknown'} [${(systemStats as any).gpuEncoder?.toUpperCase() || '?'}] · tier: ${(systemStats as any).gpuTier || '?'} · workers: ${(systemStats as any).maxChunkWorkers || 2}`,
                ],
              ].map(([label, color, value]) => (
                <div key={label as string} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #181818' }}>
                  <span style={{ fontSize: 11, color: '#888' }}>{label as string}</span>
                  <div className="flex items-center gap-2">
                    <div style={{ width: 6, height: 6, borderRadius: 1, background: color as string }} />
                    <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>{value as string}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* About */}
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>ABOUT</div>
            <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#555' }}>
                  <span style={{ color: '#00B4FF', fontWeight: 700 }}>HyperClip</span> v0.1.0
                </div>
                <div style={{ fontSize: 9, color: '#2A2A2A', fontFamily: 'monospace' }}>
                  Electron + Next.js + FFmpeg + NVENC
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A1A1A; border-radius: 2px; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
