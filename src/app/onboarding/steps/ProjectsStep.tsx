'use client'
import { colors, spacing, fontSize } from '../../design-system/tokens'

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
      case 'healthy': return colors.success
      case 'warning': return colors.warning
      case 'exhausted': case 'rate_limited': return colors.error
      case 'unauthorized': case 'no_oauth': return colors.textSecondary
      default: return colors.textSecondary
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
        <p style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.7, margin: '0 0 16px 0' }}>
          <strong style={{ color: colors.text }}>GCP Projects</strong> là lớp dự phòng cho detection.
          Khi <strong style={{ color: colors.text }}>Innertube</strong> (Chrome sessions) gặp sự cố,
          HyperClip tự động chuyển sang dùng YouTube Data API với quota từ các projects này.
        </p>
        <p style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.6, margin: 0 }}>
          Mỗi project cung cấp <strong style={{ color: colors.textSecondary }}>10,000 units/ngày</strong>.
          200 projects = 2 triệu units/ngày — đủ cho ~100 kênh.
        </p>
      </div>

      {/* Status summary */}
      {projects.length > 0 && (
        <div style={{
          background: colors.bg, border: `1px solid ${colors.border}`,
          borderRadius: 12, padding: '16px 20px',
          marginBottom: 24,
          display: 'flex', gap: 24,
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>{projects.length}</div>
            <div style={{ fontSize: 10, color: colors.textSecondary }}>Projects</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.success }}>{healthyCount}</div>
            <div style={{ fontSize: 10, color: colors.textSecondary }}>Healthy</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.accent }}>
              {projects.reduce((s, p) => s + (p.quotaTotal - p.usedToday), 0).toLocaleString()}
            </div>
            <div style={{ fontSize: 10, color: colors.textSecondary }}>Units/day</div>
          </div>
        </div>
      )}

      {/* Project list */}
      {projects.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 10 }}>
            GCP Projects của bạn
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map((p) => (
              <div
                key={p.projectId}
                style={{
                  background: colors.bg, border: `1px solid ${colors.border}`,
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
                    fontSize: 11, fontWeight: 600, color: colors.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.projectId}
                  </div>
                  <div style={{ fontSize: 9, color: colors.textSecondary, marginTop: 2 }}>
                    {p.gmailAccount}
                  </div>
                </div>
                {p.quotaTotal > 0 && (
                  <div style={{ width: 80 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: 9, color: colors.textSecondary }}>{p.usedToday.toLocaleString()}</span>
                      <span style={{ fontSize: 9, color: colors.textSecondary }}>{p.quotaTotal.toLocaleString()}</span>
                    </div>
                    <div style={{ height: 3, background: colors.text, borderRadius: 2 }}>
                      <div style={{
                        width: `${quotaPercent(p)}%`, height: '100%',
                        background: quotaPercent(p) > 80 ? colors.error : quotaPercent(p) > 50 ? colors.warning : colors.success,
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
                        background: colors.surface, border: 'none',
                        borderRadius: 4, fontSize: 9, fontWeight: 600,
                        color: colors.text, cursor: 'pointer',
                        transition: 'background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = colors.surface; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
                    >
                      {reauthorizing === p.projectId ? '...' : 'Authorize'}
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(p.projectId)}
                    style={{
                      height: 24, width: 24, padding: 0,
                      background: 'transparent', border: `1px solid ${colors.borderHover}`,
                      borderRadius: 4, fontSize: 12,
                      color: colors.textSecondary, cursor: 'pointer',
                      transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = colors.error; e.currentTarget.style.borderColor = colors.error; e.currentTarget.style.transform = 'scale(1.05)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.borderColor = colors.borderHover; e.currentTarget.style.transform = 'scale(1)' }}
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
              background: colors.surface, border: 'none',
              borderRadius: 8, fontSize: 11, fontWeight: 600,
              color: colors.text, cursor: 'pointer',
              transition: 'background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)' }}
            onMouseLeave={e => { e.currentTarget.style.background = colors.surface; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
          >
            + Thêm GCP Project
          </button>
        ) : (
          <div style={{
            background: colors.bg, border: `1px solid ${colors.borderHover}`,
            borderRadius: 10, padding: '16px 20px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 14 }}>
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
              <div style={{ fontSize: 11, color: colors.error, marginBottom: 10 }}>{addError}</div>
            )}
            {addSuccess && (
              <div style={{ fontSize: 11, color: colors.success, marginBottom: 10 }}>✓ Project đã được thêm</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAdd}
                disabled={adding}
                style={{
                  height: 32, padding: '0 16px',
                  background: adding ? colors.accentHover : colors.accent,
                  border: 'none', borderRadius: 6,
                  fontSize: 11, fontWeight: 700,
                  color: colors.text, cursor: adding ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease',
                  opacity: adding ? 0.7 : 1,
                }}
                onMouseEnter={e => { if (!adding) { e.currentTarget.style.background = colors.accentHover; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 3px 10px rgba(59,130,246,0.35)' } }}
                onMouseLeave={e => { e.currentTarget.style.background = colors.accent; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                {adding ? 'Đang thêm...' : 'Thêm Project'}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setAddError(''); setAddSuccess(false) }}
                style={{
                  height: 32, padding: '0 16px',
                  background: 'transparent', border: `1px solid ${colors.borderHover}`,
                  borderRadius: 6, fontSize: 11,
                  color: colors.textSecondary, cursor: 'pointer',
                  transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.borderColor = colors.borderHover; e.currentTarget.style.color = colors.textTertiary; e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = colors.borderHover; e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.transform = 'translateY(0)' }}
              >
                Hủy
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{
        background: colors.bg, border: `1px solid ${colors.border}`,
        borderRadius: 8, padding: '12px 16px', marginBottom: 32,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <div style={{ fontSize: 14, color: colors.textSecondary, flexShrink: 0, marginTop: 1 }}>💡</div>
        <div style={{ fontSize: 11, color: colors.textSecondary, lineHeight: 1.6 }}>
          <strong style={{ color: colors.textSecondary }}>Có thể bỏ qua bước này</strong> nếu Chrome sessions đã hoạt động tốt.
          GCP Projects chỉ cần thiết khi bạn cần monitoring 24/7 với khả năng chịu lỗi cao.
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button
          onClick={onBack}
          style={{
            height: 40, padding: '0 20px',
            background: 'transparent', border: `1px solid ${colors.borderHover}`,
            borderRadius: 8, fontSize: 12, fontWeight: 600,
            color: colors.textSecondary, cursor: 'pointer',
            transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.borderColor = colors.borderHover; e.currentTarget.style.color = colors.textTertiary; e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = colors.borderHover; e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.transform = 'translateY(0)' }}
        >
          ← Quay lại
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onSkip}
            style={{
              height: 40, padding: '0 20px',
              background: 'transparent', border: `1px solid ${colors.borderHover}`,
              borderRadius: 8, fontSize: 12, fontWeight: 600,
              color: colors.textSecondary, cursor: 'pointer',
              transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.borderColor = colors.borderHover; e.currentTarget.style.color = colors.textTertiary; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = colors.borderHover; e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            Bỏ qua bước này
          </button>
          <button
            onClick={onComplete}
            style={{
              height: 40, padding: '0 24px',
              background: colors.accent, border: 'none',
              borderRadius: 8, fontSize: 12, fontWeight: 700,
              color: colors.text, cursor: 'pointer',
              transition: 'background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = colors.accentHover; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 3px 10px rgba(59,130,246,0.35)' }}
            onMouseLeave={e => { e.currentTarget.style.background = colors.accent; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
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
  background: colors.bg, border: `1px solid ${colors.borderHover}`,
  borderRadius: 6, padding: '0 12px',
  fontSize: 11, color: colors.text, outline: 'none',
}
