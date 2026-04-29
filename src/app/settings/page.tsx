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
  status: string
  apiKey: string | null
  apiKeyName: string | null
  apiKeyUsed: number
  apiKeyStatus: string
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

  const rowStyle = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }
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

function ProjectCard({ project, onRefresh }: { project: Project; onRefresh: () => void; key?: string }) {
  const { showToast } = useAppStore()
  const [showRemove, setShowRemove] = useState(false)

  const statusColor: Record<string, string> = {
    healthy: '#00FF88',
    warning: '#FFB800',
    error: '#FF6644',
    exhausted: '#FF4444',
    unauthorized: '#444',
    no_oauth: '#FF6644',
  }

  const sc = statusColor[project.status] || '#444'
  const apiSc = statusColor[project.apiKeyStatus] || '#444'

  const totalUsed = project.usedToday + project.apiKeyUsed
  const totalQuota = project.quotaTotal * 2
  const totalPct = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0

  const handleReset = async () => {
    await ipc.resetProjectQuota(project.projectId)
    showToast(`Quota ${project.projectId} đã reset`)
    onRefresh()
  }

  const handleRemove = async () => {
    await ipc.removeProject(project.projectId)
    showToast(`Đã xóa ${project.projectId}`)
    onRefresh()
  }

  const handleAuthorize = async () => {
    // TODO: open OAuth flow for existing project
    showToast('Chức năng re-authorize đang phát triển')
  }

  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid #1a1a1a',
      borderRadius: 6, padding: '14px', marginBottom: 10,
    }}>
      {/* Header row */}
      <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
        <div className="flex items-center gap-2">
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: sc,
            boxShadow: `0 0 4px ${sc}66`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#ccc' }}>{project.projectId}</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>
            {(totalUsed / 1000).toFixed(1)}k / {(totalQuota / 1000).toFixed(0)}k
          </span>
          <div style={{ width: 60, height: 3, background: '#1a1a1a', borderRadius: 1 }}>
            <div style={{
              width: `${Math.min(totalPct, 100)}%`, height: '100%',
              background: totalPct > 80 ? '#FFB800' : '#00FF88', borderRadius: 1,
              transition: 'width 0.8s ease',
            }} />
          </div>
        </div>
      </div>

      {/* OAuth + API Key rows */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {/* OAuth */}
        <div style={{ flex: 1, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>OAUTH</div>
          {project.hasToken ? (
            <div style={{ fontSize: 10, color: '#00FF88' }}>
              ✓ Authorized
              {project.tokenExpiry && <div style={{ fontSize: 8, color: '#444', marginTop: 2 }}>expires {new Date(project.tokenExpiry).toLocaleTimeString()}</div>}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#FF6644' }}>✗ Chưa authorize</div>
          )}
        </div>
        {/* API Key */}
        <div style={{ flex: 1, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>API KEY</div>
          {project.apiKey ? (
            <div style={{ fontSize: 10, color: apiSc }}>
              {project.apiKey.slice(0, 10)}…
              <div style={{ fontSize: 8, color: '#444', marginTop: 2 }}>
                {project.apiKeyName || project.projectId} · {(project.apiKeyUsed / 1000).toFixed(1)}k
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#FF6644' }}>✗ Chưa có key</div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1">
        {!project.hasToken && (
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
        <button
          onClick={handleReset}
          style={{
            height: 26, paddingLeft: 10, paddingRight: 10,
            background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 3,
            fontSize: 9, color: '#555', cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#444' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#2a2a2a' }}
        >↺ Reset</button>
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

// ─── Projects Section ───────────────────────────────────────────────────────────

function ProjectsSection() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

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

  const totalUsed = projects.reduce((s, p) => s + p.usedToday + p.apiKeyUsed, 0)
  const totalQuota = projects.length * 9500 * 2
  const totalPct = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0

  return (
    <div>
      {/* Summary bar */}
      {!loading && (
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
        </div>
      )}

      {/* Info */}
      <div style={{ padding: '0 14px 12px', fontSize: 9, color: '#444', lineHeight: '14px' }}>
        Mỗi project = OAuth + API Key = 10,000 units/ngày.
        Thêm project để tăng quota polling.
        <br />Quota reset mỗi 24h (midnight PT).
      </div>

      {/* Project list */}
      {loading ? (
        <div style={{ fontSize: 10, color: '#444', textAlign: 'center', padding: '16px' }}>Đang tải...</div>
      ) : projects.length === 0 ? (
        <div style={{ padding: '24px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#333', marginBottom: 12 }}>
            Chưa có project nào.
            <br />Thêm Google Cloud project để bắt đầu.
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              height: 28, paddingLeft: 14, paddingRight: 14,
              background: '#00B4FF', border: 'none', borderRadius: 4,
              fontSize: 10, fontWeight: 700, color: '#000', cursor: 'pointer',
            }}
          >+ Thêm Project đầu tiên</button>
        </div>
      ) : (
        <div style={{ padding: '0 14px' }}>
          {projects.map(p => (
            <ProjectCard key={p.projectId} project={p} onRefresh={load} />
          ))}
        </div>
      )}

      {showAdd && <AddProjectForm onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load() }} />}
    </div>
  )
}

// ─── Settings Page ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { settings, systemStats } = useAppStore()
  const [gateState, setGateState] = useState<'loading' | 'setup' | 'locked' | 'unlocked'>('loading')

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
    <div style={{ height: '100vh', background: '#0E0E0E', fontFamily: 'Inter, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        height: 48, background: '#0D0D0D', borderBottom: '1px solid #1E1E1E',
        display: 'flex', alignItems: 'center', paddingLeft: 20, gap: 24, flexShrink: 0,
      }}>
        <Link href="/" style={{ fontSize: 10, color: '#444', textDecoration: 'none', fontWeight: 600, letterSpacing: '0.08em' }}>← BACK</Link>
        <div style={{ width: 1, height: 12, background: '#222' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>SETTINGS</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 20px' }}>
        <div style={{ maxWidth: 600 }}>

          {/* Projects */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>GOOGLE PROJECTS</div>
            <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden' }}>
              <ProjectsSection />
            </div>
          </div>

          {/* Output */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>OUTPUT</div>
            <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
                <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>Output Folder</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                  <input type="text" value={settings.outputFolder} readOnly style={{ flex: 1, height: 30, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, paddingLeft: 8, fontSize: 11, color: '#888', fontFamily: 'monospace', outline: 'none' }} />
                  <button onClick={() => ipc.openFolder(settings.outputFolder)} style={{ height: 30, paddingLeft: 10, paddingRight: 10, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, fontSize: 9, fontWeight: 600, color: '#555', cursor: 'pointer' }}>OPEN</button>
                </div>
              </div>
            </div>
          </div>

          {/* System */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>SYSTEM</div>
            <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden' }}>
              {[
                ['RAM Disk', '#FFB800', '64GB DDR5'],
                ['GPU', '#00FF88', (systemStats as any).gpuEncoder?.toUpperCase() ?? 'NVENC'],
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
          </div>

          {/* About */}
          <div>
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
