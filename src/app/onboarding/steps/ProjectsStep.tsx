'use client'

import { useState, useEffect } from 'react'
import { ipc } from '../../lib/ipc'

interface ProjectsStepProps {
  onComplete: () => void
  onSkip: () => void
  onBack: () => void
}

interface Project {
  projectId: string
  projectName: string
  gmailAccount: string
  clientId: string
  hasToken: boolean
  usedToday: number
  quotaTotal: number
  status: 'healthy' | 'warning' | 'rate_limited' | 'error' | 'exhausted' | 'unauthorized' | 'no_oauth'
}

export function ProjectsStep({ onComplete, onSkip, onBack }: ProjectsStepProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState({
    projectId: '',
    clientId: '',
    clientSecret: '',
    apiKey: '',
    gmailAccount: '',
  })
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState(false)
  const [adding, setAdding] = useState(false)
  const [reauthorizing, setReauthorizing] = useState<string | null>(null)

  const loadProjects = async () => {
    setLoading(true)
    try {
      const data = await ipc.getProjects() as Project[]
      setProjects(data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProjects() }, [])

  const handleAdd = async () => {
    if (!form.projectId || !form.clientId || !form.clientSecret || !form.apiKey) {
      setAddError('Vui lòng điền đầy đủ thông tin')
      return
    }
    setAdding(true)
    setAddError('')
    setAddSuccess(false)
    try {
      const result = await ipc.addProject({
        projectId: form.projectId,
        clientId: form.clientId,
        clientSecret: form.clientSecret,
        apiKey: form.apiKey,
        apiKeyName: form.gmailAccount,
      }) as any
      if (result.success) {
        setAddSuccess(true)
        setForm({ projectId: '', clientId: '', clientSecret: '', apiKey: '', gmailAccount: '' })
        await loadProjects()
      } else {
        setAddError(result.error || 'Lỗi không xác định')
      }
    } catch {
      setAddError('Lỗi khi thêm project')
    } finally {
      setAdding(false)
    }
  }

  const handleReauthorize = async (projectId: string) => {
    setReauthorizing(projectId)
    try {
      await ipc.reauthorizeProject(projectId)
      await loadProjects()
    } finally {
      setReauthorizing(null)
    }
  }

  const handleRemove = async (projectId: string) => {
    await ipc.removeProject(projectId)
    await loadProjects()
  }

  const healthyCount = projects.filter(p => p.status === 'healthy').length
  const isReady = projects.length > 0

  const statusColor = (status: string) => {
    switch (status) {
      case 'healthy': return '#00FF88'
      case 'warning': return '#FF6B35'
      case 'exhausted': case 'rate_limited': return '#FF4444'
      case 'unauthorized': case 'no_oauth': return '#888'
      default: return '#555'
    }
  }

  const quotaPercent = (p: Project) => {
    if (!p.quotaTotal) return 0
    return Math.round((p.usedToday / p.quotaTotal) * 100)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Explanation */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: '#888', lineHeight: 1.7, margin: '0 0 16px 0' }}>
          <strong style={{ color: '#fff' }}>GCP Projects</strong> là lớp dự phòng cho detection.
          Khi <strong style={{ color: '#fff' }}>Innertube</strong> (Chrome sessions) gặp sự cố,
          HyperClip tự động chuyển sang dùng YouTube Data API với quota từ các projects này.
        </p>
        <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6, margin: 0 }}>
          Mỗi project cung cấp <strong style={{ color: '#666' }}>10,000 units/ngày</strong>.
          200 projects = 2 triệu units/ngày — đủ cho ~100 kênh.
        </p>
      </div>

      {/* Status summary */}
      {projects.length > 0 && (
        <div style={{
          background: '#0D0D0D', border: '1px solid #1A1A1A',
          borderRadius: 12, padding: '16px 20px',
          marginBottom: 24,
          display: 'flex', gap: 24,
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{projects.length}</div>
            <div style={{ fontSize: 10, color: '#555' }}>Projects</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#00FF88' }}>{healthyCount}</div>
            <div style={{ fontSize: 10, color: '#555' }}>Healthy</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#00B4FF' }}>
              {projects.reduce((s, p) => s + (p.quotaTotal - p.usedToday), 0).toLocaleString()}
            </div>
            <div style={{ fontSize: 10, color: '#555' }}>Units/day</div>
          </div>
        </div>
      )}

      {/* Project list */}
      {projects.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 10 }}>
            GCP Projects của bạn
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map((p) => (
              <div
                key={p.projectId}
                style={{
                  background: '#0D0D0D', border: '1px solid #1A1A1A',
                  borderRadius: 8, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: statusColor(p.status), flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: '#fff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.projectId}
                  </div>
                  <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>
                    {p.gmailAccount}
                  </div>
                </div>
                {p.quotaTotal > 0 && (
                  <div style={{ width: 80 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: 9, color: '#555' }}>{p.usedToday.toLocaleString()}</span>
                      <span style={{ fontSize: 9, color: '#555' }}>{p.quotaTotal.toLocaleString()}</span>
                    </div>
                    <div style={{ height: 3, background: '#1A1A1A', borderRadius: 2 }}>
                      <div style={{
                        width: `${quotaPercent(p)}%`, height: '100%',
                        background: quotaPercent(p) > 80 ? '#FF4444' : quotaPercent(p) > 50 ? '#FF6B35' : '#00FF88',
                        borderRadius: 2,
                      }} />
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4 }}>
                  {!p.hasToken && (
                    <button
                      onClick={() => handleReauthorize(p.projectId)}
                      disabled={reauthorizing === p.projectId}
                      style={{
                        height: 24, padding: '0 10px',
                        background: '#1A1A1A', border: '1px solid #2A2A2A',
                        borderRadius: 4, fontSize: 9, fontWeight: 600,
                        color: '#888', cursor: 'pointer',
                      }}
                    >
                      {reauthorizing === p.projectId ? '...' : 'Authorize'}
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(p.projectId)}
                    style={{
                      height: 24, width: 24, padding: 0,
                      background: 'transparent', border: '1px solid #1A1A1A',
                      borderRadius: 4, fontSize: 12,
                      color: '#333', cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add project form */}
      <div style={{ marginBottom: 32 }}>
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              height: 36, padding: '0 16px',
              background: '#1A1A1A', border: '1px dashed #2A2A2A',
              borderRadius: 8, fontSize: 11, fontWeight: 600,
              color: '#888', cursor: 'pointer',
            }}
          >
            + Thêm GCP Project
          </button>
        ) : (
          <div style={{
            background: '#0D0D0D', border: '1px solid #2A2A2A',
            borderRadius: 10, padding: '16px 20px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 14 }}>
              Thêm GCP Project
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <input
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                placeholder="project-id-123"
                style={inputStyle}
              />
              <input
                value={form.gmailAccount}
                onChange={(e) => setForm({ ...form, gmailAccount: e.target.value })}
                placeholder="your@gmail.com"
                style={inputStyle}
              />
            </div>
            <input
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              placeholder="Client ID (xxx.apps.googleusercontent.com)"
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <input
              value={form.clientSecret}
              onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
              placeholder="Client Secret (GOCSPX-xxx)"
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <input
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="API Key (AIzaSy-xxx)"
              style={{ ...inputStyle, marginBottom: 12 }}
            />
            {addError && (
              <div style={{ fontSize: 11, color: '#FF6B6B', marginBottom: 10 }}>{addError}</div>
            )}
            {addSuccess && (
              <div style={{ fontSize: 11, color: '#00FF88', marginBottom: 10 }}>✓ Project đã được thêm</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAdd}
                disabled={adding}
                style={{
                  height: 32, padding: '0 16px',
                  background: adding ? '#005577' : '#00B4FF',
                  border: 'none', borderRadius: 6,
                  fontSize: 11, fontWeight: 700,
                  color: '#fff', cursor: adding ? 'not-allowed' : 'pointer',
                }}
              >
                {adding ? 'Đang thêm...' : 'Thêm Project'}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setAddError(''); setAddSuccess(false) }}
                style={{
                  height: 32, padding: '0 16px',
                  background: 'transparent', border: '1px solid #2A2A2A',
                  borderRadius: 6, fontSize: 11,
                  color: '#555', cursor: 'pointer',
                }}
              >
                Hủy
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{
        background: '#0D0D0D', border: '1px solid #1A1A1A',
        borderRadius: 8, padding: '12px 16px', marginBottom: 32,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <div style={{ fontSize: 14, color: '#444', flexShrink: 0, marginTop: 1 }}>💡</div>
        <div style={{ fontSize: 11, color: '#444', lineHeight: 1.6 }}>
          <strong style={{ color: '#555' }}>Có thể bỏ qua bước này</strong> nếu Chrome sessions đã hoạt động tốt.
          GCP Projects chỉ cần thiết khi bạn cần monitoring 24/7 với khả năng chịu lỗi cao.
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button
          onClick={onBack}
          style={{
            height: 40, padding: '0 20px',
            background: 'transparent', border: '1px solid #2A2A2A',
            borderRadius: 8, fontSize: 12, fontWeight: 600,
            color: '#555', cursor: 'pointer',
          }}
        >
          ← Quay lại
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onSkip}
            style={{
              height: 40, padding: '0 20px',
              background: 'transparent', border: '1px solid #2A2A2A',
              borderRadius: 8, fontSize: 12, fontWeight: 600,
              color: '#555', cursor: 'pointer',
            }}
          >
            Bỏ qua bước này
          </button>
          <button
            onClick={onComplete}
            style={{
              height: 40, padding: '0 24px',
              background: '#00B4FF', border: 'none',
              borderRadius: 8, fontSize: 12, fontWeight: 700,
              color: '#fff', cursor: 'pointer',
            }}
          >
            Tiếp tục →
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 36,
  background: '#0A0A0A', border: '1px solid #2A2A2A',
  borderRadius: 6, padding: '0 12px',
  fontSize: 11, color: '#fff', outline: 'none',
}
