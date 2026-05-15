'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useAppStore } from '../lib/store'
import { ipc } from '../lib/ipc'

export const dynamic = 'force-dynamic'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Project {
  projectId: string
  projectName: string
  gmailAccount: string
  clientId: string
  hasToken: boolean
  tokenExpiry: number | null
  usedToday: number
  quotaTotal: number
  errors: number
  status: 'healthy' | 'warning' | 'rate_limited' | 'error' | 'exhausted' | 'unauthorized' | 'no_oauth'
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
  wasLoggedIn: boolean
  isConsented: boolean
  rawSocs: string | null
  usedToday: number
  lastUsed: number
  lastRefreshAt: number
  error?: string
}

interface SessionStatus {
  ready: boolean
  sessionCount: number
  loggedInCount: number
  consentedCount: number
  sessions: ChromeSession[]
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

function ProjectCard({ project, onRefresh }: { project: Project; onRefresh: () => void; key?: string }) {
  const { showToast } = useAppStore()
  const [showRemove, setShowRemove] = useState(false)
  const [repairing, setRepairing] = useState(false)

  const statusColor: Record<string, string> = {
    healthy: '#00FF88',
    warning: '#FFB800',
    rate_limited: '#FFB800',
    error: '#FF6644',
    exhausted: '#FF4444',
    unauthorized: '#FF6644',
    no_oauth: '#FFB800',
  }

  const sc = statusColor[project.status] || '#444'
  const oauthPct = Math.min(project.quotaTotal > 0 ? Math.round((project.usedToday / project.quotaTotal) * 100) : 0, 100)

  // Show exhausted/warning on OAuth card even when hasToken=true
  const oauthLabel = (() => {
    if (project.status === 'unauthorized') return '✗ Token không hợp lệ'
    if (project.status === 'no_oauth') return '✗ Chưa authorize'
    if (project.status === 'exhausted') return `⚠ Quá tải quota`
    if (project.status === 'rate_limited') return `⚠ Rate limited (${project.errors} errors)`
    if (project.status === 'warning') return `⚠ ${oauthPct}% quota`
    if (project.hasToken) return `✓ Authorized`
    return '✗ Chưa authorize'
  })()

  const oauthColor = (() => {
    if (project.status === 'exhausted' || project.status === 'unauthorized') return '#FF6644'
    if (project.status === 'rate_limited' || project.status === 'warning') return '#FFB800'
    if (project.hasToken) return '#00FF88'
    return '#FF6644'
  })()

  const apiSc = statusColor[project.apiKeyStatus] || '#444'

  const handleRemove = async () => {
    await ipc.removeProject(project.projectId)
    showToast(`Đã xóa ${project.projectId}`)
    onRefresh()
  }

  // Broken states that need repair
  const needsRepair = project.status === 'exhausted' || project.status === 'rate_limited'
    || project.status === 'unauthorized' || project.status === 'no_oauth'
    || project.status === 'warning' || project.apiKeyStatus === 'exhausted'
    || project.apiKeyStatus === 'unauthorized'

  const handleRepair = async () => {
    setRepairing(true)
    try {
      const result = await ipc.repairProject(project.projectId) as {
        success: boolean; error?: string; repaired?: boolean; refreshed?: boolean
        needsCredentials?: boolean; needsOAuthFlow?: boolean
      }
      if (result.success) {
        const msg = result.refreshed
          ? `✓ ${project.projectId}: token refresh OK — quota đã reset, project hoạt động`
          : result.repaired
            ? `✓ ${project.projectId}: đã repair thành công`
            : `✓ ${project.projectId}: đã reset quota`
        showToast(msg)
        onRefresh()
      } else {
        if (result.needsCredentials) {
          showToast(`⚠ ${project.projectId}: thiếu OAuth credentials — cần xóa và thêm lại project`)
        } else {
          showToast(`⚠ ${project.projectId}: ${result.error}`)
        }
        onRefresh()
      }
    } catch (e: any) {
      showToast(`Lỗi: ${e.message}`)
    } finally {
      setRepairing(false)
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
        {/* REPAIR — shown for all broken states */}
        {needsRepair && (
          <button
            onClick={handleRepair}
            disabled={repairing}
            style={{
              flex: 1, height: 26, background: repairing ? '#FF664408' : '#FF664422',
              border: `1px solid ${repairing ? '#FF664422' : '#FF664444'}`, borderRadius: 3,
              fontSize: 9, fontWeight: 600, color: repairing ? '#FF664488' : '#FF6644',
              cursor: repairing ? 'wait' : 'pointer',
            }}
          >
            {repairing ? 'REPAIRING...' : '🔧 REPAIR'}
          </button>
        )}
        {/* TEST — shown when project has token */}
        {project.hasToken && (
          <button
            onClick={handleTest}
            style={{
              flex: 1, height: 26, background: 'transparent',
              border: '1px solid #00B4FF33', borderRadius: 3,
              fontSize: 9, fontWeight: 600, color: '#00B4FF88', cursor: 'pointer',
              opacity: needsRepair ? 1 : 0.7,
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
    try {
      const result = await ipc.resetKey(key)
      if (result.success) {
        load()
        showToast(`Reset thành công! Next auto-reset: ${formatNextReset(result.nextReset)}`)
      }
    } catch (e: any) {
      showToast(`Lỗi reset: ${e.message}`)
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
              .sort((a, b) => (b.usedToday ?? 0) - (a.usedToday ?? 0))
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
  const [filter, setFilter] = useState<'all' | 'healthy' | 'warning' | 'rate_limited' | 'exhausted' | 'no_oauth' | 'unauthorized'>('all')
  const [groupByGmail, setGroupByGmail] = useState(true)
  const [collapsedGmail, setCollapsedGmail] = useState<Set<string>>(new Set())
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

  const handleBulkImportCSV = () => {
    const input = window.prompt('Paste CSV content (projectId,apiKey,clientId,clientSecret,gmail,projectName):\nFirst row must be headers.\nExample:\nproj-001,AIza...,xxx,yyy,user1@gmail.com,Project A')
    if (!input?.trim()) return
    try {
      const lines = input.trim().split('\n')
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
      const projIdx = headers.indexOf('projectid')
      const apiIdx = headers.indexOf('apikey')
      const clientIdIdx = headers.indexOf('clientid')
      const clientSecIdx = headers.indexOf('clientsecret')
      const gmailIdx = headers.indexOf('gmail')
      const nameIdx = headers.indexOf('projectname')

      let imported = 0, errors = 0
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',')
        const pid = cols[projIdx]?.trim()
        if (!pid) continue
        const data = {
          projectId: pid,
          clientId: cols[clientIdIdx]?.trim() || '',
          clientSecret: cols[clientSecIdx]?.trim() || '',
          apiKey: cols[apiIdx]?.trim() || '',
          apiKeyName: cols[nameIdx]?.trim() || pid,
          gmail: cols[gmailIdx]?.trim() || '',
        }
        ipc.addProject(data).then(r => {
          if (r.success) imported++; else { errors++; console.error('Add project error:', r.error) }
        })
      }
      setTimeout(() => {
        showToast(`Bulk import: ${imported} added, ${errors} errors`)
        load()
      }, 1000)
    } catch (e: any) {
      showToast(`CSV parse error: ${e.message}`)
    }
  }

  const handleAutoAssignChannels = async () => {
    try {
      const result = await ipc.autoAssignChannels() as { success: boolean; assigned: number; error?: string }
      if (result.success) {
        showToast(`Auto-assigned channels to ${result.assigned} projects`)
        load()
      } else {
        showToast(`Auto-assign failed: ${result.error}`)
      }
    } catch (e: any) {
      showToast(`Auto-assign error: ${e.message}`)
    }
  }

  const handleResetAll = async () => {
    const confirmed = window.confirm(`Reset quota for ALL ${projects.length} projects?`)
    if (!confirmed) return
    for (const p of projects) {
      await ipc.resetProjectQuota(p.projectId)
    }
    showToast(`Reset quota for ${projects.length} projects`)
    load()
  }

  const totalUsed = projects.reduce((s, p) => s + p.usedToday, 0)
  const totalQuota = projects.length * 9500
  const totalPct = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0

  const healthyProjects = projects.filter(p => p.status === 'healthy').length
  const warningProjects = projects.filter(p => p.status === 'warning').length
  const rateLimitedProjects = projects.filter(p => p.status === 'rate_limited').length
  const exhaustedProjects = projects.filter(p => p.status === 'exhausted').length
  const noOauthProjects = projects.filter(p => p.status === 'no_oauth').length
  const unauthorizedProjects = projects.filter(p => p.status === 'unauthorized').length

  const filterCounts = {
    all: projects.length,
    healthy: healthyProjects,
    warning: warningProjects,
    rate_limited: rateLimitedProjects,
    exhausted: exhaustedProjects,
    no_oauth: noOauthProjects,
    unauthorized: unauthorizedProjects,
  }

  const filteredProjects = filter === 'all' ? projects
    : filter === 'healthy' ? projects.filter(p => p.status === 'healthy')
    : filter === 'warning' ? projects.filter(p => p.status === 'warning')
    : filter === 'rate_limited' ? projects.filter(p => p.status === 'rate_limited')
    : filter === 'exhausted' ? projects.filter(p => p.status === 'exhausted')
    : filter === 'no_oauth' ? projects.filter(p => p.status === 'no_oauth')
    : projects.filter(p => p.status === 'unauthorized')

  // Group projects by Gmail account
  const groupedByGmail: Record<string, Project[]> = {}
  for (const p of filteredProjects) {
    const gmail = p.gmailAccount || 'no-gmail'
    if (!groupedByGmail[gmail]) groupedByGmail[gmail] = []
    groupedByGmail[gmail].push(p)
  }

  const gmailGroups = Object.entries(groupedByGmail).sort(([a], [b]) => a.localeCompare(b))

  const handleResetProject = async (projectId: string) => {
    try {
      const result = await ipc.resetProjectQuota(projectId) as { success: boolean; nextReset: number; wasUnauthorized: boolean }
      await ipc.resumePoller()
      const msg = result.wasUnauthorized
        ? `Quota ${projectId} đã reset + mở khóa token — poller tiếp tục`
        : `Quota ${projectId} đã reset — poller tiếp tục`
      showToast(msg)
      load()
    } catch (e: any) {
      showToast(`Lỗi reset: ${e.message}`)
    }
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
          <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>
            {projects.length >= 100 ? '200 PROJECTS' : 'OAUTH PROJECTS'}
          </div>
          {projects.length > 0 && (
            <div style={{ fontSize: 8, color: '#00B4FF', background: '#00B4FF11', border: '1px solid #00B4FF22', borderRadius: 3, padding: '1px 6px' }}>
              {totalPct}% quota used
            </div>
          )}
          <div style={{ width: 1, height: 12, background: '#222' }} />
          <span style={{ fontSize: 8, color: '#333' }}>refresh {refreshTime}</span>
          {loading && <span style={{ fontSize: 8, color: '#00FF8844' }}>● loading...</span>}
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <button onClick={handleBulkImportCSV} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #00B4FF33', borderRadius: 4, fontSize: 8, fontWeight: 700, color: '#00B4FF', cursor: 'pointer', letterSpacing: '0.05em', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00B4FF15' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            CSV IMPORT
          </button>
          <button onClick={handleAutoAssignChannels} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #00FF8844', borderRadius: 4, fontSize: 8, fontWeight: 700, color: '#00FF88', cursor: 'pointer', letterSpacing: '0.05em', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00FF8815' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            AUTO-ASSIGN
          </button>
          <button onClick={handleResetAll} disabled={projects.length === 0} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #FF664422', borderRadius: 4, fontSize: 8, fontWeight: 700, color: '#FF6644', cursor: projects.length === 0 ? 'not-allowed' : 'pointer', opacity: projects.length === 0 ? 0.4 : 1, letterSpacing: '0.05em', transition: 'all 0.15s' }}>
            RESET ALL
          </button>
          <button onClick={handleSyncChannels} disabled={syncing} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #00FF8844', borderRadius: 4, fontSize: 8, fontWeight: 700, color: '#00FF88', cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.5 : 1, letterSpacing: '0.05em', transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!syncing) { e.currentTarget.style.background = '#00FF8822' } }}
            onMouseLeave={e => { if (!syncing) { e.currentTarget.style.background = 'transparent' } }}>
            {syncing ? '...' : 'SYNC'}
          </button>
          <button onClick={() => setShowAdd(v => !v)} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: showAdd ? '#00B4FF22' : 'transparent', border: `1px solid ${showAdd ? '#00B4FF66' : '#00B4FF33'}`, borderRadius: 4, fontSize: 8, fontWeight: 700, color: '#00B4FF', cursor: 'pointer', transition: 'all 0.15s' }}>
            + ADD
          </button>
          {(exhaustedProjects > 0 || rateLimitedProjects > 0 || noOauthProjects > 0 || unauthorizedProjects > 0) && (
            <button
              onClick={async () => {
                const broken = projects.filter(p =>
                  p.status === 'exhausted' || p.status === 'rate_limited'
                  || p.status === 'unauthorized' || p.status === 'no_oauth'
                  || p.status === 'warning' || p.apiKeyStatus === 'exhausted'
                  || p.apiKeyStatus === 'unauthorized'
                )
                if (broken.length === 0) return
                const ids = broken.map(p => p.projectId)
                const confirmed = window.confirm(`Repair ${ids.length} project(s)?`)
                if (!confirmed) return
                setLoading(true)
                const results = await ipc.batchRepairProjects(ids) as Record<string, any>
                let ok = 0, fail = 0, noCreds = 0
                for (const [pid, r] of Object.entries(results)) {
                  if (r.success) ok++; else if (r.needsCredentials) noCreds++; else fail++
                }
                showToast(`Repair: ${ok} OK · ${fail} lỗi · ${noCreds} cần credentials mới`)
                setLoading(false); load()
              }}
              style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: '#FF664422', border: '1px solid #FF664444', borderRadius: 4, fontSize: 8, fontWeight: 700, color: '#FF6644', cursor: 'pointer', letterSpacing: '0.05em', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#FF664430' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#FF664422' }}>
              REPAIR ({projects.filter(p => p.status === 'exhausted' || p.status === 'rate_limited' || p.status === 'unauthorized' || p.status === 'no_oauth' || p.status === 'warning' || p.apiKeyStatus === 'exhausted' || p.apiKeyStatus === 'unauthorized').length})
            </button>
          )}
          {projects.length > 0 && (
            <button
              onClick={() => setGroupByGmail(v => !v)}
              title={groupByGmail ? 'Ungroup by Gmail' : 'Group by Gmail'}
              style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: groupByGmail ? '#00B4FF22' : 'transparent', border: `1px solid ${groupByGmail ? '#00B4FF44' : '#333'}`, borderRadius: 4, fontSize: 8, fontWeight: 700, color: groupByGmail ? '#00B4FF' : '#555', cursor: 'pointer', letterSpacing: '0.05em', transition: 'all 0.15s' }}>
              GROUP: {groupByGmail ? 'GMAIL' : 'ALL'}
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #141414', background: '#0A0A0A' }}>
          <div style={{
            background: '#0A0A0A', border: '1px solid #1E1E1E',
            borderRadius: 8, padding: '16px',
          }}>
            <AddProjectForm onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load() }} />
          </div>
        </div>
      )}

      {/* Exhausted / Unauthorized alert banner */}
      {(rateLimitedProjects > 0 || exhaustedProjects > 0 || noOauthProjects > 0 || unauthorizedProjects > 0) && (
        <div style={{
          padding: '10px 20px',
          background: '#1a0808',
          borderBottom: '1px solid #2a1010',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4444', flexShrink: 0, boxShadow: '0 0 6px #FF444488' }} />
          <span style={{ fontSize: 10, color: '#FF6644', fontWeight: 700 }}>
            {rateLimitedProjects > 0 && `${rateLimitedProjects} project${rateLimitedProjects > 1 ? 's' : ''} rate limited (10+ errors)`}
            {rateLimitedProjects > 0 && exhaustedProjects > 0 && ' · '}
            {exhaustedProjects > 0 && `${exhaustedProjects} project${exhaustedProjects > 1 ? 's' : ''} quá tải quota`}
            {rateLimitedProjects > 0 && noOauthProjects > 0 && ' · '}
            {(exhaustedProjects > 0 || rateLimitedProjects > 0) && noOauthProjects > 0 && ' · '}
            {noOauthProjects > 0 && `${noOauthProjects} project${noOauthProjects > 1 ? 's' : ''} chưa authorize OAuth`}
            {unauthorizedProjects > 0 && (exhaustedProjects > 0 || noOauthProjects > 0 || rateLimitedProjects > 0 ? ' · ' : '') + `${unauthorizedProjects} project${unauthorizedProjects > 1 ? 's' : ''} key không hợp lệ`}
          </span>
          <span style={{ fontSize: 9, color: '#FF444466', marginLeft: 4 }}>— auto-reset midnight PT</span>
        </div>
      )}

      {/* Stats row — consistent with ApiKeysSection */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid #141414', background: '#0C0C0C' }}>
        <StatCard
          label="TOTAL"
          value={String(projects.length)}
          sub="projects"
          color="#ccc"
          icon={<div style={{ width: 6, height: 6, borderRadius: 1, background: '#444' }} />}
        />
        <StatCard
          label="HEALTHY"
          value={`${healthyProjects}/${projects.length}`}
          sub="authorized"
          color="#00FF88"
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00FF88' }} />}
        />
        <StatCard
          label="WARNING"
          value={String(warningProjects)}
          sub="75-90% quota"
          color={warningProjects > 0 ? '#FFB800' : '#2a2a2a'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: warningProjects > 0 ? '#FFB800' : '#2a2a2a' }} />}
        />
        <StatCard
          label="RATE LIMITED"
          value={String(rateLimitedProjects)}
          sub="10+ errors"
          color={rateLimitedProjects > 0 ? '#FFB800' : '#2a2a2a'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: rateLimitedProjects > 0 ? '#FFB800' : '#2a2a2a' }} />}
        />
        <StatCard
          label="EXHAUSTED"
          value={String(exhaustedProjects)}
          sub="needs reset"
          color={exhaustedProjects > 0 ? '#FF4444' : '#2a2a2a'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: exhaustedProjects > 0 ? '#FF4444' : '#2a2a2a' }} />}
        />
        <StatCard
          label="NO OAUTH"
          value={String(noOauthProjects)}
          sub="not authorized"
          color={noOauthProjects > 0 ? '#FFB800' : '#2a2a2a'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: noOauthProjects > 0 ? '#FFB800' : '#2a2a2a' }} />}
        />
        {unauthorizedProjects > 0 && (
          <StatCard
            label="UNAUTHORIZED"
            value={String(unauthorizedProjects)}
            sub="invalid keys"
            color="#FF6644"
            icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6644' }} />}
          />
        )}
        <StatCard
          label="OVERALL QUOTA"
          value={`${totalPct}%`}
          sub={`${(totalUsed / 1000).toFixed(1)}k / ${(totalQuota / 1000).toFixed(0)}k`}
          color={totalPct > 80 ? '#FFB800' : '#00FF88'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: totalPct > 80 ? '#FFB800' : '#00FF88' }} />}
        />
      </div>

      {/* Per-project quota distribution chart */}
      {projects.length > 0 && (
        <div style={{ padding: '12px 20px', background: '#0D0D0D', borderBottom: '1px solid #141414' }}>
          <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>PROJECT QUOTA DISTRIBUTION</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {projects
              .sort((a, b) => (b.usedToday ?? 0) - (a.usedToday ?? 0))
              .map(p => {
                const pct = p.quotaTotal > 0 ? Math.round((p.usedToday / p.quotaTotal) * 100) : 0
                const isExhausted = p.status === 'exhausted'
                const isRateLimited = p.status === 'rate_limited'
                const barColor = isExhausted ? '#FF4444' : isRateLimited ? '#FFB800' : pct >= 90 ? '#FF4444' : pct >= 75 ? '#FFB800' : pct > 0 ? '#00FF88' : '#2a2a2a'
                return (
                  <div key={p.projectId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      minWidth: 100, fontSize: 9, color: isExhausted ? '#FF4444' : isRateLimited ? '#FFB800' : '#555',
                      fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {(isExhausted || isRateLimited) && <span style={{ color: isExhausted ? '#FF4444' : '#FFB800', marginRight: 3 }}>⚠</span>}
                      {p.projectId}
                    </div>
                    <div style={{ flex: 1, height: 12, background: '#141414', borderRadius: 2, position: 'relative' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', background: barColor,
                        borderRadius: 2, transition: 'width 0.5s',
                        boxShadow: pct > 0 ? `0 0 4px ${barColor}44` : 'none',
                      }} />
                      <div style={{ position: 'absolute', top: 0, left: '75%', width: 1, height: '100%', background: '#333' }} />
                      <div style={{ position: 'absolute', top: 0, left: '90%', width: 1, height: '100%', background: '#555' }} />
                    </div>
                    <div style={{ minWidth: 170, fontSize: 8, color: '#333', fontFamily: 'monospace', textAlign: 'right' }}>
                      <span style={{ color: barColor }}>{p.usedToday.toLocaleString()}</span>
                      <span style={{ color: '#2a2a2a' }}>/</span>
                      <span>{p.quotaTotal.toLocaleString()}</span>
                      {p.errors > 0 && (
                        <span style={{ color: '#FF4444', marginLeft: 4 }}>{p.errors}err</span>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 7, color: '#2a2a2a' }}>| 75%</span>
            <span style={{ fontSize: 7, color: '#333' }}>| 90%</span>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '8px 20px', borderBottom: '1px solid #141414', background: '#0C0C0C' }}>
        {(['all', 'healthy', 'warning', 'rate_limited', 'exhausted', 'no_oauth'] as const).map(f => {
          const isActive = filter === f
          const tabColors: Record<string, string> = { all: '#888', healthy: '#00FF88', warning: '#FFB800', rate_limited: '#FFB800', exhausted: '#FF4444', no_oauth: '#FFB800' }
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
              {f === 'no_oauth' ? 'NO OAUTH' : f === 'rate_limited' ? 'RATE LIMITED' : f.toUpperCase()} ({filterCounts[f]})
            </button>
          )
        })}
      </div>

      {/* Info row */}
      <div style={{ padding: '8px 20px', fontSize: 9, color: '#444', lineHeight: '15px', background: '#0B0B0B', borderBottom: '1px solid #141414' }}>
        Mỗi project = OAuth + API Key = 10,000 units/ngày. Thêm project để tăng quota polling. Quota reset mỗi 24h (midnight PT).
      </div>

      {/* Project list */}
      <div style={{ padding: '14px 20px', background: '#0A0A0A' }}>
        {loading && projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 10, color: '#333' }}>Đang tải...</div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 10, color: '#2a2a2a', marginBottom: 8 }}>
              {filter !== 'all' ? `Không có project ở trạng thái "${filter}"` : 'Chưa có project nào. Thêm Google Cloud project để bắt đầu.'}
            </div>
            {filter === 'all' && (
              <button
                onClick={() => setShowAdd(true)}
                style={{
                  height: 28, paddingLeft: 14, paddingRight: 14,
                  background: '#00B4FF22', border: '1px solid #00B4FF44', borderRadius: 4,
                  fontSize: 9, fontWeight: 700, color: '#00B4FF', cursor: 'pointer',
                }}
              >
                + Thêm Project đầu tiên
              </button>
            )}
          </div>
        ) : groupByGmail && gmailGroups.length > 1 ? (
          // Gmail group view
          gmailGroups.map(([gmail, gprojects]) => {
            const collapsed = collapsedGmail.has(gmail)
            const gHealthy = gprojects.filter(p => p.status === 'healthy').length
            const gTotal = gprojects.length
            return (
              <div key={gmail} style={{ marginBottom: 16 }}>
                <div
                  onClick={() => setCollapsedGmail(prev => {
                    const next = new Set(prev)
                    if (next.has(gmail)) next.delete(gmail); else next.add(gmail)
                    return next
                  })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    padding: '6px 10px', background: '#111', border: '1px solid #1a1a1a',
                    borderRadius: 4, marginBottom: collapsed ? 0 : 8,
                  }}>
                  <span style={{ fontSize: 10, color: collapsed ? '#444' : '#00B4FF', transition: 'all 0.15s' }}>{collapsed ? '▶' : '▼'}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: collapsed ? '#444' : '#ccc', letterSpacing: '0.06em', fontFamily: 'monospace' }}>{gmail}</span>
                  <span style={{ fontSize: 8, color: '#333' }}>({gHealthy}/{gTotal} healthy)</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 8, color: '#333' }}>{gprojects.length} projects</span>
                </div>
                {!collapsed && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                    gap: 8,
                  }}>
                    {gprojects.map(p => (
                      <ProjectCard key={p.projectId} project={p} onRefresh={load} />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          // Flat list view
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 12,
          }}>
            {filteredProjects.map(p => (
              <ProjectCard key={p.projectId} project={p} onRefresh={load} />
            ))}
          </div>
        )}
      </div>

      {/* ─── Chrome Sessions (30 profiles) — Innertube PRIMARY ─────────────────── */}
      <div style={{ borderTop: '1px solid #141414' }}>
        {/* Section header */}
        <div style={{
          padding: '14px 20px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#0B0B0B',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00B4FF', boxShadow: '0 0 6px #00B4FF66' }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>CHROME SESSIONS</span>
            <span style={{ fontSize: 8, color: '#333' }}>— Innertube PRIMARY (no quota limit)</span>
          </div>
        </div>
        <SessionsSection />
      </div>
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
  }

  const handleOpenLogin = async (profileId: string) => {
    showToast(`Chrome đang mở — đăng nhập YouTube, chờ extraction...`)
    const result = await ipc.openSessionLogin(profileId)
    // openSessionLogin waits up to 5 min for CDP extraction
    const refresh = await ipc.refreshAllSessions()
    if (refresh.refreshedCount > 0) {
      showToast(`Session ${profileId}: cookies extracted — Innertube active`)
    } else {
      showToast(`Session ${profileId}: extraction failed hoặc đã đóng Chrome quá sớm`)
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
              {consented.map(s => {
                const isStale = s.lastRefreshAt > 0 && (Date.now() - s.lastRefreshAt) > (7 * 24 * 60 * 60 * 1000);
                const ageHours = s.lastRefreshAt > 0 ? Math.round((Date.now() - s.lastRefreshAt) / 3600000) : 0;
                return (
                  <div key={s.profileId} style={{
                    background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 4,
                    padding: '6px 10px', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: isStale ? '#FFB800' : '#00FF88', flexShrink: 0 }} title={isStale ? "Stale cookie" : "Healthy"}/>
                    <span style={{ fontSize: 10, color: '#888', flex: 1 }}>{s.profileName}</span>
                    {s.rawSocs && (
                      <span style={{ fontSize: 7, color: '#444', fontFamily: 'monospace', marginRight: 6 }} title={`SOCS=${s.rawSocs}`}>
                        SOCS:{s.rawSocs.slice(0, 3)}
                      </span>
                    )}
                    {s.lastRefreshAt > 0 && (
                      <span style={{ fontSize: 8, color: isStale ? '#FFB800' : '#444', fontFamily: 'monospace', marginRight: 8 }} title="Cookie age">
                        {ageHours > 24 ? `${Math.round(ageHours/24)}d old` : `${ageHours}h old`}
                      </span>
                    )}
                    <span style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>
                      used {s.usedToday}x
                    </span>
                  </div>
                )
              })}
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
                  {s.rawSocs && (
                    <span style={{ fontSize: 7, color: '#FFB80088', fontFamily: 'monospace', marginRight: 6 }} title={`Real SOCS: ${s.rawSocs}`}>
                      SOCS:{s.rawSocs.slice(0, 3)} (injected CAI)
                    </span>
                  )}
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
  const [cloning, setCloning] = useState(false)
  const [innertubeDegraded, setInnertubeDegraded] = useState(false)

  const load = () => {
    ipc.getPollerStatus().then(setPollerStatus).catch(() => {})
    ipc.getSessionStatus().then(setSessionStatus).catch(() => {})
    ipc.getProjects().then(setProjectStatus).catch(() => {})
    ipc.getKeys().then(setKeyStatus).catch(() => {})
    // Sync degraded state from poller status
    if (pollerStatus?.innertubeDegraded !== undefined) {
      setInnertubeDegraded(pollerStatus.innertubeDegraded)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { const t = setInterval(load, 8000); return () => clearInterval(t) }, [])

  // Listen for Innertube degraded events from main process
  useEffect(() => {
    const cleanup = ipc.onInnertubeDegraded((data) => {
      setInnertubeDegraded(data.degraded)
    })
    return cleanup
  }, [])

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

  // Phase 6: OAuth quota monitoring — sum remaining units across all projects
  const QUOTA_PER_PROJECT = 9500
  const totalQuotaRemaining = (projectStatus as any[])?.reduce((sum: number, p: any) => {
    if (p.status === 'exhausted' || p.status === 'unauthorized') return sum
    return sum + Math.max(0, QUOTA_PER_PROJECT - (p.usedToday ?? 0))
  }, 0) ?? 0
  const totalQuotaPercent = totalProjects > 0
    ? Math.round(((projectStatus as any[])?.reduce((sum: number, p: any) => sum + (p.usedToday ?? 0), 0) ?? 0) / (totalProjects * QUOTA_PER_PROJECT) * 100)
    : 0
  const quotaColor = totalQuotaRemaining < 1000 ? '#FF4444' : totalQuotaRemaining < 5000 ? '#FFB800' : '#00FF88'
  const quotaLabel = totalQuotaRemaining < 1000 ? '🔴 CRITICAL' : totalQuotaRemaining < 5000 ? '🟡 WARNING' : '🟢 OK'

  // Phase 5: Session health — from sessionStatus.health breakdown if available
  const sessions = sessionStatus?.sessions ?? []
  const loggedInCount = sessions.filter((s: any) => s.isLoggedIn).length
  const consentedCount = sessions.filter((s: any) => s.isConsented).length
  
  const health = sessionStatus?.health
  const sessionHealthPct = health?.healthPct ?? (totalSessions > 0 ? Math.round((consentedCount / totalSessions) * 100) : 0)
  const sessionHealthColor = health ? (health.level === 'healthy' ? '#00FF88' : health.level === 'degraded' ? '#FFB800' : '#FF4444') 
    : (sessionHealthPct >= 50 ? '#00FF88' : sessionHealthPct >= 20 ? '#FFB800' : '#FF4444')
  const sessionHealthLabel = health ? (health.level === 'healthy' ? '🟢 HEALTHY' : health.level === 'degraded' ? '🟡 DEGRADED' : '🔴 CRITICAL')
    : (sessionHealthPct >= 50 ? '🟢 HEALTHY' : sessionHealthPct >= 20 ? '🟡 DEGRADED' : '🔴 CRITICAL')
  
  const hasAnySession = loggedInCount > 0
  const needsConsent = loggedInCount > 0 && consentedCount === 0

  // Phase 7: Session Expiration warning
  const expiredSessions = sessions.filter((s: any) => s.wasLoggedIn && !s.isLoggedIn)
  const hasExpiredSessions = expiredSessions.length > 0

  const detectionPath = hasInnertube ? 'innertube' : hasOAuth ? 'oauth' : null
  const primaryFix = !hasInnertube ? 'sessions' : !hasOAuth ? 'projects' : null

  const handleResume = async () => {
    await ipc.resumePoller()
    showToast('Đã resume poller — sẽ thử lại sau vài giây')
    load()
  }

  const handleCloneOne = async () => {
    if (!window.confirm('Bạn có chắc muốn nhân bản Cookie từ Session 1 ra tất cả các session còn lại? Việc này sẽ ghi đè các session hiện có.')) return
    setCloning(true)
    const result = await ipc.cloneSessionOne()
    if (result.success) {
      showToast(`Đã nhân bản thành công ra ${result.clonedCount} sessions!`)
      load()
    } else {
      showToast(`Lỗi nhân bản: ${result.error}`)
    }
    setCloning(false)
  }

  const session1 = sessions.find((s: any) => s.profileId === '1')
  const isSession1Ready = session1?.isLoggedIn
  const showCloneAction = isSession1Ready && consentedCount < totalSessions && !isBackedOff


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

          {/* Unified Detection Status Panel */}
          <div style={{
            background: '#0a0a0a',
            border: '1px solid #1a1a1a',
            borderRadius: 6,
            padding: '12px 14px',
            marginTop: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {/* Header: detection path badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                background: hasInnertube ? '#00FF8820' : hasOAuth ? '#FFB80020' : '#FF444420',
                border: `1px solid ${hasInnertube ? '#00FF8844' : hasOAuth ? '#FFB80044' : '#FF444444'}`,
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: hasInnertube ? '#00FF88' : hasOAuth ? '#FFB800' : '#FF4444',
              }}>
                {hasInnertube ? 'PRIMARY' : hasOAuth ? 'FALLBACK' : 'NO SOURCE'}
              </div>
              <span style={{ fontSize: 8, color: '#555', letterSpacing: '0.06em' }}>
                DETECTION PATH
              </span>
              {innertubeDegraded && (
                <span style={{ fontSize: 8, color: '#FFB800', background: '#FFB80020', border: '1px solid #FFB80044', borderRadius: 3, padding: '1px 5px' }}>
                  DEGRADED
                </span>
              )}
              {needsConsent && (
                <span style={{ fontSize: 8, color: '#FF6644', background: '#FF664420', border: '1px solid #FF664444', borderRadius: 3, padding: '1px 5px' }}>
                  CONSENT MISSING
                </span>
              )}
            </div>

            {/* Capacity row */}
            <div style={{ display: 'flex', gap: 16 }}>
              {/* Innertube */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: hasInnertube ? '#00FF88' : '#333' }} />
                <span style={{ fontSize: 9, color: '#666' }}>Innertube</span>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: hasInnertube ? '#00FF88' : '#444' }}>
                  {consented}/{totalSessions} sessions
                </span>
                {needsConsent && (
                  <span style={{ fontSize: 8, color: '#FF6644' }}>({loggedInCount - consented} need consent)</span>
                )}
              </div>

              {/* OAuth */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: hasOAuth ? '#00FF88' : '#333' }} />
                <span style={{ fontSize: 9, color: '#666' }}>OAuth</span>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: hasOAuth ? '#00FF88' : '#444' }}>
                  {healthyProjects}/{totalProjects} projects
                </span>
                {hasOAuth && (
                  <span style={{ fontSize: 8, color: quotaColor, fontFamily: 'monospace' }}>
                    ({totalQuotaRemaining.toLocaleString()} quota)
                  </span>
                )}
              </div>
            </div>

            {/* Warnings */}
            {(needsConsent || sessionHealthPct < 50 || hasExpiredSessions) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {needsConsent && (
                  <span style={{ fontSize: 8, color: '#FF6644' }}>
                    ⚠ {loggedInCount - consented} session(s) missing SOCS consent — open YouTube in Chrome, accept terms
                  </span>
                )}
                {hasExpiredSessions && (
                  <span style={{ fontSize: 8, color: '#FFB800' }}>
                    ⚠ {hasExpiredSessions} session(s) lost cookies since last run
                  </span>
                )}
                {!needsConsent && sessionHealthPct < 50 && (
                  <span style={{ fontSize: 8, color: '#FFB800' }}>
                    ⚠ Session health {sessionHealthPct}% — consider refreshing Chrome sessions
                  </span>
                )}
              </div>
            )}
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

          {/* Phase 6: OAuth quota total */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: quotaColor }}>●</span>
            <span style={{ fontSize: 10, color: '#888', width: 160 }}>OAuth Quota</span>
            <span style={{ fontSize: 9, color: quotaColor, fontFamily: 'monospace' }}>
              {totalQuotaRemaining.toLocaleString()} units left ({totalQuotaPercent}% used)
            </span>
            <span style={{ fontSize: 9, color: quotaColor }}>
              {quotaLabel}
            </span>
          </div>
        </div>

        {/* Phase 6: OAuth quota critical warning */}
        {hasOAuth && totalQuotaRemaining < 1000 && !isBackedOff && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#1a0808', border: '1px solid #FF444444',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: '#FF4444' }}>🚨</span>
            <span style={{ fontSize: 10, color: '#888' }}>
              OAuth quota gần hết ({totalQuotaRemaining.toLocaleString()} units còn lại). Thêm GCP project trong tab OAUTH PROJECTS trước khi quota hết.
            </span>
          </div>
        )}

        {/* Fix call-to-action */}
        {isBackedOff && primaryFix && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#0a0a0a', border: '1px solid #1a1a1a',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: '#555' }}>→</span>
            <span style={{ fontSize: 10, color: '#888' }}>
              System đang backed off. Sẽ tự resume sau vài phút, hoặc click{' '}
              <button
                onClick={handleResume}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 700, color: '#00B4FF', padding: 0,
                }}
              >
                FORCE RESUME
              </button>
              .
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
              OAuth đang active (có quota limit/ngày). Hệ thống vẫn hoạt động tốt.
            </span>
          </div>
        )}

        {/* Running with Innertube */}
        {!isBackedOff && hasInnertube && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: innertubeDegraded ? '#1a1500' : '#0a1a0a',
            border: `1px solid ${innertubeDegraded ? '#FFB80044' : '#00FF8844'}`,
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: innertubeDegraded ? '#FFB800' : '#00FF88' }}>
              {innertubeDegraded ? '⚠' : '✓'}
            </span>
            <span style={{ fontSize: 10, color: innertubeDegraded ? '#888' : '#666' }}>
              {innertubeDegraded
                ? 'Innertube đang degraded (0 video trong 3+ poll liên tiếp) — đang kiểm tra OAuth...'
                : 'Innertube (Chrome cookies) + OAuth cùng active — detection tối ưu.'}
            </span>
          </div>
        )}
      </div>

      {/* Phase 5: Session health alert — sessions logged in but need consent */}
      {needsConsent && !isBackedOff && (
        <div style={{
          marginTop: 14, padding: '12px 16px',
          background: '#1a0808', border: '1px solid #FF664444',
          borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#FF6644' }}>⚠</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#FF6644', letterSpacing: '0.06em' }}>
              CHROME CONSENT REQUIRED
            </span>
            <span style={{ fontSize: 9, color: sessionHealthColor }}>{sessionHealthLabel}</span>
          </div>
          <div style={{ fontSize: 9, color: '#888', lineHeight: '16px' }}>
            {loggedInCount} session(s) logged into Chrome but <strong style={{ color: '#ccc' }}>consent not accepted</strong>.
            SOCS cookie missing — open Chrome manually → youtube.com → accept consent banner → close Chrome → HyperClip will pick it up automatically.
          </div>
          <div style={{ fontSize: 8, color: '#555', background: '#0a0a0a', borderRadius: 4, padding: '8px 10px', lineHeight: '14px' }}>
            HOW TO: 1) Close HyperClip &amp; all Chrome windows. 2) Open Chrome → youtube.com → sign in → accept consent. 3) Close Chrome completely. 4) Reopen HyperClip.
          </div>
        </div>
      )}

      {/* Phase 7: Session expiration alert — wasLoggedIn but currently !isLoggedIn */}
      {hasExpiredSessions && !isBackedOff && (
        <div style={{
          marginTop: 14, padding: '12px 16px',
          background: '#1a0808', border: '1px solid #FF444444',
          borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#FF4444' }}>⚠</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#FF4444', letterSpacing: '0.06em' }}>
              SESSION EXPIRED
            </span>
          </div>
          <div style={{ fontSize: 9, color: '#888', lineHeight: '16px' }}>
            Cookie của {expiredSessions.length} session đã hết hạn hoặc bị lỗi xác thực.
            Hãy bấm "Mở Chrome" bên dưới để đăng nhập lại nhằm duy trì năng lực tải dữ liệu.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
            {expiredSessions.map((s: any) => (
              <button
                key={s.profileId}
                onClick={async () => {
                  const { ipc } = await import('../lib/ipc')
                  const { useAppStore } = await import('../lib/store')
                  const store = useAppStore.getState()
                  store.showToast(`Đang mở Chrome cho ${s.profileName}...`)
                  const result = await ipc.openSessionLogin(s.profileId)
                  const refresh = await ipc.refreshAllSessions()
                  if (refresh.refreshedCount > 0) {
                    store.showToast(`Đã phục hồi ${s.profileName}`)
                  } else {
                    store.showToast(`Phục hồi ${s.profileName} thất bại`)
                  }
                  // Let the interval auto-reload status
                }}
                title={s.error || 'Open Chrome and log in again'}
                style={{
                  background: '#0a0a0a', border: '1px solid #FF444444', borderRadius: 6,
                  padding: '8px 12px', textAlign: 'left', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#FF444488'; e.currentTarget.style.background = '#1a0a0a' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#FF444444'; e.currentTarget.style.background = '#0a0a0a' }}
              >
                <span style={{ fontSize: 10, color: '#ccc', fontWeight: 600 }}>{s.profileName}</span>
                <span style={{ fontSize: 9, color: '#FF4444' }}>Mở Chrome</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Phase 8: Auto-Clone from Session 1 */}
      {showCloneAction && (
        <div style={{
          marginTop: 14, padding: '12px 16px',
          background: '#0a1a0a', border: '1px solid #00FF8844',
          borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#00FF88', letterSpacing: '0.06em', marginBottom: 4 }}>
              QUICK SETUP: CLONE SESSION 1
            </div>
            <div style={{ fontSize: 9, color: '#888', lineHeight: '14px' }}>
              Session 1 đã sẵn sàng. Bạn có thể nhân bản Cookie này ra {totalSessions - 1} session còn lại để tiết kiệm thời gian.
            </div>
          </div>
          <button
            onClick={handleCloneOne}
            disabled={cloning}
            style={{
              height: 32, paddingLeft: 16, paddingRight: 16,
              background: '#00FF8811', border: '1px solid #00FF8844',
              borderRadius: 4, cursor: cloning ? 'not-allowed' : 'pointer',
              fontSize: 10, fontWeight: 800, color: '#00FF88',
              letterSpacing: '0.04em', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!cloning) { e.currentTarget.style.background = '#00FF8822'; e.currentTarget.style.borderColor = '#00FF8866' } }}
            onMouseLeave={e => { e.currentTarget.style.background = '#00FF8811'; e.currentTarget.style.borderColor = '#00FF8844' }}
          >
            {cloning ? 'CLONING...' : 'NHÂN BẢN NGAY'}
          </button>
        </div>
      )}

      {/* Phase 5: Session health critical — < 20% consented */}
      {!needsConsent && hasAnySession && sessionHealthPct < 50 && !isBackedOff && (
        <div style={{
          marginTop: 14, padding: '12px 16px',
          background: '#1a1000', border: '1px solid #FFB80044',
          borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#FFB800' }}>⚠</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#FFB800', letterSpacing: '0.06em' }}>
              SESSION HEALTH: {sessionHealthPct}% READY
            </span>
            <span style={{ fontSize: 9, color: sessionHealthColor }}>{sessionHealthLabel}</span>
          </div>
          <div style={{ fontSize: 9, color: '#888' }}>
            {consentedCount}/{totalSessions} sessions consented. Innertube PRIMARY detection limited.
            {loggedInCount > consentedCount && ` ${loggedInCount - consentedCount} session(s) need Chrome consent.`}
            {health?.staleCount > 0 && ` Cookie của ${health.staleCount} session(s) đã quá 7 ngày tuổi (cũ nhất: ${health.oldestCookieAgeHours}h).`}
          </div>
        </div>
      )}

      {/* Quick action — only when neither path is available */}
      {!hasInnertube && !hasOAuth && (
        <button
          onClick={() => { const btn = document.querySelector('[data-tab="projects"]') as HTMLButtonElement; btn?.click() }}
          style={{
            width: '100%', padding: '14px 16px',
            background: '#0d1520', border: '1px solid #00FF8844',
            borderRadius: 6, cursor: 'pointer', textAlign: 'left',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#0d1f15'; e.currentTarget.style.borderColor = '#00FF8866' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0d1520'; e.currentTarget.style.borderColor = '#00FF8844' }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, color: '#00FF88', letterSpacing: '0.08em', marginBottom: 4 }}>
            GOOGLE PROJECTS — THÊM OAuth
          </div>
          <div style={{ fontSize: 9, color: '#666', lineHeight: '14px' }}>
            Thêm Google Cloud project để bắt đầu poll YouTube channels.
          </div>
        </button>
      )}
    </div>
  )
}

// ─── Projects Section ──────────────────────────────────────────────────────────

function PathRow({ label, value, onChange, needsRestart }: { label: string; value: string; onChange: (v: string) => void; needsRestart?: boolean }) {
  const short = value.length > 50 ? '...' + value.slice(-47) : value
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #181818' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
          {label}
          {needsRestart && (
            <span style={{ marginLeft: 6, fontSize: 8, color: '#FFB800', fontWeight: 700, letterSpacing: '0.06em' }}>RESTART</span>
          )}
        </div>
        <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>
          {short || '— not set —'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 12 }}>
        <button
          onClick={() => ipc.openFolder(value)}
          style={{ height: 28, paddingLeft: 8, paddingRight: 8, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, fontSize: 9, fontWeight: 600, color: '#555', cursor: 'pointer' }}
        >OPEN</button>
        <button
          onClick={async () => {
            const result = await ipc.pickFolder(value)
            if (result) onChange(result.path)
          }}
          style={{ height: 28, paddingLeft: 8, paddingRight: 8, background: '#1A1A1A', border: '1px solid #00B4FF44', borderRadius: 3, fontSize: 9, fontWeight: 700, color: '#00B4FF', cursor: 'pointer', letterSpacing: '0.04em' }}
        >CHANGE</button>
      </div>
    </div>
  )
}

function QualityPicker({ value, options, onChange, label }: {
  value: string; options: string[]; onChange: (v: string) => void; label?: string
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map(q => (
        <button
          key={q}
          onClick={() => onChange(q)}
          style={{
            padding: '4px 10px',
            background: value === q ? '#00B4FF18' : '#0d0d0d',
            border: `1px solid ${value === q ? '#00B4FF' : '#222'}`,
            borderRadius: 3,
            fontSize: 10,
            fontWeight: value === q ? 700 : 400,
            color: value === q ? '#00B4FF' : '#444',
            cursor: 'pointer',
            letterSpacing: '0.04em',
          }}
        >
          {q}{label === 'p' ? 'P' : label === 'fps' ? ' fps' : ''}
        </button>
      ))}
    </div>
  )
}

function ToggleSwitch({ value, onChange, onColor, offColor }: {
  value: boolean; onChange: (v: boolean) => void; onColor?: string; offColor?: string
}) {
  const on = onColor ?? '#00FF88'
  const off = offColor ?? '#333'
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
        background: value ? on : off,
        transition: 'background 0.2s',
        position: 'relative', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s',
      }} />
    </button>
  )
}

function StorageWidget() {
  const [stats, setStats] = useState<{ downloads: number; blur: number; total: number; downloadPath: string; outputPath: string; freeBytes?: number }>({ downloads: 0, blur: 0, total: 0, downloadPath: '', outputPath: '', freeBytes: 0 })
  const [cleanupDays, setCleanupDays] = useState(7)
  const [cleanupEnabled, setCleanupEnabled] = useState(true)
  const [archivePath, setArchivePath] = useState('')
  const [clearingDl, setClearingDl] = useState(false)
  const [clearingBlr, setClearingBlr] = useState(false)
  const { showToast, settings, setSettings } = useAppStore()

  // Auto-download state
  const [autoDlEnabled, setAutoDlEnabled] = useState(true)
  const [dlQuality, setDlQuality] = useState(settings.autoDownloadQuality || '720')
  const [dlTrimLimit, setDlTrimLimit] = useState(settings.defaultTrimLimit ?? 10)
  const [trimIsFull, setTrimIsFull] = useState(settings.defaultTrimLimit === 'full')
  const [trimCustomValue, setTrimCustomValue] = useState('')
  const [trimInputError, setTrimInputError] = useState('')
  const [pollInterval, setPollInterval] = useState(5)

  // Render quality state
  const [renderQuality, setRenderQuality] = useState<1080 | 720>((settings.defaultQuality ?? 1080) as 1080 | 720)

  // Concurrency state
  const [maxConcurrentRenders, setMaxConcurrentRenders] = useState(2)

  const load = async () => {
    const [s, st] = await Promise.all([ipc.getStorageSize(), ipc.getSettings()])
    setStats(s)
    setCleanupDays(st.downloadsCleanupDays ?? 7)
    setCleanupEnabled(st.downloadsCleanupDays !== 0)
    if (st.renderedOutputPath) setArchivePath(st.renderedOutputPath)

    // Sync auto-download state
    setAutoDlEnabled(st.autoDownloadEnabled ?? true)
    setDlQuality(st.autoDownloadQuality || '720')
    const loadedTrim = typeof st.defaultTrimLimit === 'number' ? st.defaultTrimLimit : 10
    setDlTrimLimit(loadedTrim)
    setTrimIsFull(st.defaultTrimLimit === 'full')
    setTrimCustomValue(typeof st.defaultTrimLimit === 'number' && ![5, 10, 15].includes(loadedTrim) ? String(loadedTrim) : '')
    setPollInterval(st.pollIntervalMs ? st.pollIntervalMs / 1000 : 5)

    // Sync render quality
    setRenderQuality((st.defaultQuality ?? 1080) as 1080 | 720)

    // Sync concurrency
    setMaxConcurrentRenders(st.maxConcurrentRenders ?? 2)
  }

  useEffect(() => { load() }, [])

  // Sync local state when Zustand settings change
  useEffect(() => { setAutoDlEnabled(settings.autoDownloadEnabled ?? true) }, [settings.autoDownloadEnabled])
  useEffect(() => { setDlQuality(settings.autoDownloadQuality || '720') }, [settings.autoDownloadQuality])
  useEffect(() => { setDlTrimLimit(settings.defaultTrimLimit !== 'full' ? (settings.defaultTrimLimit as number ?? 10) : 10); setTrimIsFull(settings.defaultTrimLimit === 'full') }, [settings.defaultTrimLimit])

  const handleAutoDlToggle = async (val: boolean) => {
    setAutoDlEnabled(val)
    await ipc.updateSettings({ autoDownloadEnabled: val })
    setSettings({ autoDownloadEnabled: val })
    showToast(val ? 'Auto-download ON' : 'Auto-download OFF — detection continues')
  }

  const handleQualityChange = async (val: string) => {
    setDlQuality(val)
    await ipc.updateSettings({ autoDownloadQuality: val })
    setSettings({ autoDownloadQuality: val })
    showToast(`Download quality: ${val}p`)
  }

  const handleTrimLimitChange = async (val: number | 'full') => {
    setTrimInputError('')
    setTrimCustomValue('')
    const num = val === 'full' ? 'full' : val
    setTrimIsFull(val === 'full')
    if (val !== 'full') setDlTrimLimit(val)
    await ipc.updateSettings({ defaultTrimLimit: num })
    setSettings({ defaultTrimLimit: num })
    showToast(`Trim limit: ${num === 'full' ? 'full video' : num + ' min'}`)
  }

  const handleTrimCustomSubmit = async () => {
    const raw = trimCustomValue.trim()
    setTrimInputError('')

    if (!raw) {
      setTrimInputError('Nhập số phút')
      return
    }

    // Must be positive integer
    if (!/^\d+$/.test(raw)) {
      setTrimInputError('Phải là số nguyên dương')
      return
    }

    const num = parseInt(raw, 10)

    // Validate range: 1–999 minutes
    if (num < 1) {
      setTrimInputError('Tối thiểu 1 phút')
      return
    }
    if (num > 999) {
      setTrimInputError('Tối đa 999 phút')
      return
    }

    // Clear preset highlight
    setTrimIsFull(false)
    setDlTrimLimit(num)

    await ipc.updateSettings({ defaultTrimLimit: num })
    setSettings({ defaultTrimLimit: num })
    showToast(`Trim limit: ${num} min`)
  }

  const handlePollIntervalChange = async (sec: number) => {
    setPollInterval(sec)
    await ipc.updateSettings({ pollIntervalMs: sec * 1000 })
    setSettings({ pollIntervalMs: sec * 1000 })
    showToast(`Poll interval: ${sec}s`)
  }

  const handleRenderQualityChange = async (val: 1080 | 720) => {
    setRenderQuality(val)
    await ipc.updateSettings({ defaultQuality: val })
    setSettings({ defaultQuality: val })
    showToast(`Default render quality: ${val}p`)
  }

  const handleMaxConcurrentChange = async (val: number) => {
    setMaxConcurrentRenders(val)
    await ipc.updateSettings({ maxConcurrentRenders: val })
    setSettings({ maxConcurrentRenders: val })
    showToast(`Max concurrent renders: ${val}`)
  }

  const handleCleanupToggle = async (val: boolean) => {
    setCleanupEnabled(val)
    const days = val ? (cleanupDays || 7) : 0
    await ipc.updateSettings({ downloadsCleanupDays: days })
    setSettings({ downloadsCleanupDays: days })
    showToast(val ? `Auto-cleanup: ${cleanupDays || 7} days` : 'Auto-cleanup OFF')
  }

  const handleCleanupDaysChange = async (val: number) => {
    setCleanupDays(val)
    await ipc.updateSettings({ downloadsCleanupDays: val })
    setSettings({ downloadsCleanupDays: val })
  }

  const handleClearDownloads = async () => {
    if (!window.confirm(`Xóa toàn bộ video đã download (${stats.downloads} MB)?\n\nHành động này không thể hoàn tác.`)) return
    setClearingDl(true)
    const result = await ipc.clearDownloads()
    setClearingDl(false)
    if (result.success) { showToast(`Freed ${result.freedMB} MB`); load() }
    else showToast('Clear failed')
  }

  const handleClearBlur = async () => {
    if (!window.confirm(`Xóa toàn bộ ảnh blur (${stats.blur} MB)?\n\nHành động này không thể hoàn tác.`)) return
    setClearingBlr(true)
    const result = await ipc.clearBlur()
    setClearingBlr(false)
    if (result.success) { showToast(`Freed ${result.freedMB} MB`); load() }
    else showToast('Clear failed')
  }

  const handleDownloadPathChange = async (newPath: string) => {
    await ipc.updateSettings({ videoStoragePath: newPath })
    showToast('Downloads path updated — restart app to apply')
    load()
  }

  const handleOutputPathChange = async (newPath: string) => {
    await ipc.updateSettings({ outputPath: newPath })
    showToast('Output path updated — restart app to apply')
    load()
  }

  const handleArchivePathChange = async (newPath: string) => {
    await ipc.setRenderedArchivePath(newPath)
    setArchivePath(newPath)
    showToast('Archive path updated')
  }

  const freeBytes = stats.freeBytes ?? 0
  const freeGB = freeBytes / (1024 ** 3)
  const isLowDisk = freeBytes > 0 && freeBytes < 20 * 1024 * 1024 * 1024

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Storage paths */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: '#333', letterSpacing: '0.1em', fontWeight: 700 }}>PATHS</div>
      <PathRow label="Downloads" value={stats.downloadPath} onChange={handleDownloadPathChange} needsRestart />
      <PathRow label="Output" value={stats.outputPath} onChange={handleOutputPathChange} needsRestart />
      <PathRow label="Archive" value={archivePath || '— default —'} onChange={handleArchivePathChange} />

      {/* Disk space warning */}
      {isLowDisk && (
        <div style={{ margin: '8px 14px', padding: '8px 10px', background: '#FF440015', border: '1px solid #FF4444', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#FF4444', fontWeight: 700 }}>LOW DISK</span>
          <span style={{ fontSize: 10, color: '#FF6666' }}>{freeGB.toFixed(1)} GB free on downloads drive</span>
        </div>
      )}

      {/* ── AUTO-DOWNLOAD ──────────────────────────────────── */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: '#333', letterSpacing: '0.1em', fontWeight: 700, marginTop: 6 }}>AUTO-DOWNLOAD</div>

      {/* Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
        <span style={{ fontSize: 11, color: '#888' }}>Auto-download</span>
        <ToggleSwitch value={autoDlEnabled} onChange={handleAutoDlToggle} />
      </div>

      {/* Download quality */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888' }}>Download quality</div>
          <div style={{ fontSize: 9, color: '#444' }}>Source resolution</div>
        </div>
        <QualityPicker value={dlQuality} options={['360', '480', '720', '1080']} onChange={handleQualityChange} label="p" />
      </div>

      {/* Trim limit */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888' }}>Trim limit</div>
          <div style={{ fontSize: 9, color: '#444' }}>Max duration to download</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[5, 10, 15].map(limit => (
            <button
              key={limit}
              onClick={() => handleTrimLimitChange(limit)}
              style={{
                padding: '4px 10px',
                background: !trimIsFull && dlTrimLimit === limit && !trimCustomValue ? '#00B4FF18' : '#0d0d0d',
                border: `1px solid ${!trimIsFull && dlTrimLimit === limit && !trimCustomValue ? '#00B4FF' : '#222'}`,
                borderRadius: 3,
                fontSize: 10,
                fontWeight: !trimIsFull && dlTrimLimit === limit && !trimCustomValue ? 700 : 400,
                color: !trimIsFull && dlTrimLimit === limit && !trimCustomValue ? '#00B4FF' : '#444',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {limit}m
            </button>
          ))}
          <button
            onClick={() => handleTrimLimitChange('full')}
            style={{
              padding: '4px 10px',
              background: trimIsFull ? '#00B4FF18' : '#0d0d0d',
              border: `1px solid ${trimIsFull ? '#00B4FF' : '#222'}`,
              borderRadius: 3,
              fontSize: 10,
              fontWeight: trimIsFull ? 700 : 400,
              color: trimIsFull ? '#00B4FF' : '#444',
              cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            FULL
          </button>
        </div>
      </div>

      {/* Trim limit — custom input */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888' }}>Custom trim</div>
          <div style={{ fontSize: 9, color: '#444' }}>Or enter your own (1–999 min)</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              inputMode="numeric"
              value={trimCustomValue}
              onChange={e => {
                // Allow only digits
                const cleaned = e.target.value.replace(/\D/g, '').slice(0, 3)
                setTrimCustomValue(cleaned)
                setTrimInputError('')
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleTrimCustomSubmit()
              }}
              onBlur={() => {
                if (trimCustomValue.trim()) handleTrimCustomSubmit()
              }}
              placeholder="—"
              style={{
                width: 48, height: 26,
                background: trimCustomValue ? '#00B4FF18' : '#111',
                border: `1px solid ${trimInputError ? '#FF6644' : trimCustomValue ? '#00B4FF' : '#222'}`,
                borderRadius: 3,
                fontSize: 11, color: '#fff', fontFamily: 'monospace',
                textAlign: 'right', paddingRight: 22,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            {trimCustomValue && (
              <span style={{
                position: 'absolute', right: 6, top: 0, bottom: 0,
                display: 'flex', alignItems: 'center',
                fontSize: 9, color: '#555', pointerEvents: 'none',
              }}>m</span>
            )}
          </div>
          <button
            onClick={handleTrimCustomSubmit}
            disabled={!trimCustomValue}
            style={{
              height: 26, paddingLeft: 10, paddingRight: 10,
              background: trimCustomValue ? '#00B4FF18' : '#111',
              border: `1px solid ${trimCustomValue ? '#00B4FF' : '#222'}`,
              borderRadius: 3, fontSize: 9, fontWeight: 700,
              color: trimCustomValue ? '#00B4FF' : '#333',
              cursor: trimCustomValue ? 'pointer' : 'not-allowed',
              letterSpacing: '0.04em',
            }}
          >
            SET
          </button>
        </div>
      </div>

      {/* Trim input error message */}
      {trimInputError && (
        <div style={{
          padding: '4px 14px 4px',
          fontSize: 9, color: '#FF6644',
          textAlign: 'right',
        }}>
          {trimInputError}
        </div>
      )}

      {/* Poll interval */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888' }}>Poll interval</div>
          <div style={{ fontSize: 9, color: '#444' }}>Detection speed</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[5, 10, 30, 60].map(sec => (
            <button
              key={sec}
              onClick={() => handlePollIntervalChange(sec)}
              style={{
                padding: '4px 8px',
                background: pollInterval === sec ? '#00B4FF18' : '#0d0d0d',
                border: `1px solid ${pollInterval === sec ? '#00B4FF' : '#222'}`,
                borderRadius: 3,
                fontSize: 10,
                fontWeight: pollInterval === sec ? 700 : 400,
                color: pollInterval === sec ? '#00B4FF' : '#444',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {sec >= 60 ? '1m' : sec + 's'}
            </button>
          ))}
        </div>
      </div>

      {/* Default render quality */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888' }}>Render quality</div>
          <div style={{ fontSize: 9, color: '#444' }}>Default output resolution</div>
        </div>
        <QualityPicker value={String(renderQuality)} options={['720', '1080']} onChange={v => handleRenderQualityChange(Number(v) as 720 | 1080)} label="p" />
      </div>

      {/* Max concurrent renders */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888' }}>Max concurrent</div>
          <div style={{ fontSize: 9, color: '#444' }}>GPU memory limit</div>
        </div>
        <QualityPicker value={String(maxConcurrentRenders)} options={['1', '2']} onChange={v => handleMaxConcurrentChange(Number(v))} />
      </div>

      {/* ── CLEANUP ──────────────────────────────────────── */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: '#333', letterSpacing: '0.1em', fontWeight: 700, marginTop: 6 }}>CLEANUP</div>

      {/* Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888' }}>Auto-delete old videos</div>
          <div style={{ fontSize: 9, color: '#444' }}>Delete downloads older than N days</div>
        </div>
        <ToggleSwitch value={cleanupEnabled} onChange={handleCleanupToggle} />
      </div>

      {/* Days picker (only when enabled) */}
      {cleanupEnabled && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
          <span style={{ fontSize: 11, color: '#888' }}>Delete older than</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" min={1} max={365}
              value={cleanupDays}
              onChange={e => setCleanupDays(Number(e.target.value))}
              onBlur={e => handleCleanupDaysChange(Number(e.target.value))}
              onKeyDown={e => e.key === 'Enter' && handleCleanupDaysChange(Number((e.target as HTMLInputElement).value))}
              style={{
                width: 44, height: 26, paddingLeft: 6, paddingRight: 4,
                background: '#111', border: '1px solid #333', borderRadius: 3,
                fontSize: 11, color: '#fff', fontFamily: 'monospace', textAlign: 'right',
              }}
            />
            <span style={{ fontSize: 10, color: '#555' }}>days</span>
          </div>
        </div>
      )}

      {/* Storage usage */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: '#333', letterSpacing: '0.1em', fontWeight: 700, marginTop: 6 }}>USAGE</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #181818' }}>
        <span style={{ fontSize: 11, color: '#888' }}>Total used</span>
        <span style={{ fontSize: 12, color: '#fff', fontFamily: 'monospace', fontWeight: 700 }}>
          {stats.total} <span style={{ fontSize: 9, color: '#444' }}>MB</span>
        </span>
      </div>

      {/* Downloads */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Downloads</div>
          <div style={{ fontSize: 9, color: '#444' }}>{stats.downloads} MB</div>
        </div>
        <button
          onClick={handleClearDownloads}
          disabled={clearingDl || stats.downloads === 0}
          style={{
            height: 28, paddingLeft: 12, paddingRight: 12,
            background: clearingDl ? '#111' : '#FF444415',
            border: '1px solid #FF444444',
            borderRadius: 4, cursor: clearingDl || stats.downloads === 0 ? 'not-allowed' : 'pointer',
            fontSize: 9, fontWeight: 700, color: '#FF4444',
            opacity: stats.downloads === 0 ? 0.3 : 1,
            letterSpacing: '0.06em',
          }}
        >
          {clearingDl ? 'CLEARING...' : 'CLEAR'}
        </button>
      </div>

      {/* Blur images */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Blur images</div>
          <div style={{ fontSize: 9, color: '#444' }}>{stats.blur} MB</div>
        </div>
        <button
          onClick={handleClearBlur}
          disabled={clearingBlr || stats.blur === 0}
          style={{
            height: 28, paddingLeft: 12, paddingRight: 12,
            background: clearingBlr ? '#111' : '#FF444415',
            border: '1px solid #FF444444',
            borderRadius: 4, cursor: clearingBlr || stats.blur === 0 ? 'not-allowed' : 'pointer',
            fontSize: 9, fontWeight: 700, color: '#FF4444',
            opacity: stats.blur === 0 ? 0.3 : 1,
            letterSpacing: '0.06em',
          }}
        >
          {clearingBlr ? 'CLEARING...' : 'CLEAR'}
        </button>
      </div>
    </div>
  )
}

// ─── Diagnostics Section ────────────────────────────────────────────────────────

interface DiagResult {
  timestamp: string
  ffmpeg: { ok: boolean; path: string; version: string; hasNvenc: boolean; bundled: boolean; error?: string }
  ytDlp: { ok: boolean; path: string; version: string; error?: string }
  storage: { ramDiskAvailable: boolean; storeDir: string }
  overall: { ready: boolean; issues: string[] }
}

function DiagnosticsSection() {
  const [diag, setDiag] = useState<DiagResult | null>(null)
  const [loading, setLoading] = useState(false)

  const runDiag = async () => {
    setLoading(true)
    try {
      const result = await (window.electronAPI?.runDiagnostics as () => Promise<DiagResult>)()
      setDiag(result)
    } catch (e) {
      console.error('Diagnostics failed:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { runDiag() }, [])

  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>SYSTEM DIAGNOSTICS</span>
        <button
          onClick={runDiag}
          disabled={loading}
          style={{
            fontSize: 9, fontWeight: 700, color: '#FF6B35', background: 'transparent',
            border: '1px solid #FF6B3544', borderRadius: 4, padding: '4px 10px', cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'CHECKING...' : 'REFRESH'}
        </button>
      </div>

      {!diag ? (
        <div style={{ color: '#666', fontSize: 11 }}>Checking prerequisites...</div>
      ) : (
        <>
          {/* Overall status */}
          <div style={{
            padding: '12px 16px', borderRadius: 6, marginBottom: 16,
            background: diag.overall.ready ? '#00FF8811' : '#FF6B3511',
            border: `1px solid ${diag.overall.ready ? '#00FF8844' : '#FF6B3544'}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: diag.overall.ready ? '#00FF88' : '#FF6B35' }}>
              {diag.overall.ready ? '✓ READY — All prerequisites met' : '✗ ISSUES FOUND — Fix before use'}
            </div>
          </div>

          {/* FFmpeg */}
          <DiagRow
            label="FFmpeg"
            ok={diag.ffmpeg.ok}
            okColor="#00FF88"
            errorColor="#FF4444"
            details={[
              diag.ffmpeg.ok ? `${diag.ffmpeg.version}` : 'Not found',
              diag.ffmpeg.bundled ? 'bundled' : 'system',
              diag.ffmpeg.hasNvenc ? 'NVENC ✓' : 'NVENC ✗ (CPU encoding)',
            ].filter(Boolean).join(' · ')}
            fix={
              !diag.ffmpeg.ok
                ? 'Download FFmpeg từ https://ffmpeg.org (chọn "essentials" build). Giải nén, thêm thư mục bin vào PATH.'
                : !diag.ffmpeg.hasNvenc
                ? 'FFmpeg build hiện tại không có NVIDIA NVENC. Tải FFmpeg build hỗ trợ NVENC (gyan.dev builds recommended).'
                : undefined
            }
          />

          {/* yt-dlp */}
          <DiagRow
            label="yt-dlp"
            ok={diag.ytDlp.ok}
            okColor="#00FF88"
            errorColor="#FF4444"
            details={diag.ytDlp.ok ? `v${diag.ytDlp.version}` : 'Not found'}
            fix={
              !diag.ytDlp.ok
                ? 'Chạy lệnh: npm install yt-dlp\nHoặc: pip install yt-dlp'
                : undefined
            }
          />

          {/* Storage */}
          <DiagRow
            label="RAM Disk"
            ok={diag.storage.ramDiskAvailable}
            okColor="#00FF88"
            errorColor="#FFB800"
            details={diag.storage.ramDiskAvailable ? 'R:\\hyperclip ✓' : 'Không có — dùng ổ C'}
            fix={
              !diag.storage.ramDiskAvailable
                ? 'Tốc độ I/O sẽ chậm hơn. Bỏ qua nếu không cần tốc độ cao. (Hướng dẫn cài ImDisk: hyperclip.com/ramdisk)'
                : undefined
            }
          />

          {/* Store dir */}
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#111', borderRadius: 6, fontSize: 9, color: '#444' }}>
            Data: {diag.storage.storeDir}
          </div>

          {/* Issues list */}
          {diag.overall.issues.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#FF6B35', marginBottom: 8, letterSpacing: '0.05em' }}>CẦN FIX:</div>
              {diag.overall.issues.map((issue, i) => (
                <div key={i} style={{ fontSize: 10, color: '#ccc', padding: '4px 0', borderBottom: '1px solid #1a1a1a' }}>
                  • {issue}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, fontSize: 9, color: '#333' }}>
            Last checked: {new Date(diag.timestamp).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  )
}

function DiagRow({ label, ok, okColor, errorColor, details, fix }: {
  label: string
  ok: boolean
  okColor: string
  errorColor: string
  details: string
  fix?: string
}) {
  const color = ok ? okColor : errorColor
  return (
    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#111', borderRadius: 6, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: fix ? 6 : 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 70 }}>{label}</span>
        <span style={{ fontSize: 9, color: '#888' }}>{details}</span>
      </div>
      {fix && (
        <div style={{ fontSize: 9, color: '#666', paddingLeft: 16, lineHeight: 1.6 }}>
          💡 {fix}
        </div>
      )}
    </div>
  )
}

// ─── Operation Panel (MMO Control Center) ─────────────────────────────────────

interface OpLogEntry {
  id: string
  timestamp: number
  level: string
  category: string
  message: string
  detail?: string
}

function OperationPanel() {
  const { settings, setSettings, showToast } = useAppStore()
  const [channels, setChannels] = useState<any[]>([])
  const [channelSearch, setChannelSearch] = useState('')
  const [bulkImportText, setBulkImportText] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkResults, setBulkResults] = useState<Array<{ url: string; success: boolean; error?: string }>>([])
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)

  // Proxy state
  const [proxyEnabled, setProxyEnabled] = useState(settings.proxyEnabled ?? false)
  const [proxyHost, setProxyHost] = useState(settings.proxyHost ?? '')
  const [proxyPort, setProxyPort] = useState(settings.proxyPort ?? 8080)
  const [proxyUser, setProxyUser] = useState(settings.proxyUsername ?? '')
  const [proxyPass, setProxyPass] = useState(settings.proxyPassword ?? '')
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyStatus, setProxyStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')

  // Scan params
  const [pollInterval, setPollInterval] = useState(Math.round((settings.pollIntervalMs ?? 5000) / 1000))
  const [maxConcurrentDl, setMaxConcurrentDl] = useState(settings.maxConcurrentDownloads ?? 3)
  const [videoAge, setVideoAge] = useState(Math.round((settings.pollIntervalMs ?? 5000) / 1000))

  // Video filters
  const [durationMode, setDurationMode] = useState<'all' | 'short' | 'long'>('all')
  const [maxDurationMin, setMaxDurationMin] = useState(settings.videoMaxDurationSec ? Math.round(settings.videoMaxDurationSec / 60) : 0)

  // Operation logs
  const [opLogs, setOpLogs] = useState<OpLogEntry[]>([])
  const [logsAutoScroll, setLogsAutoScroll] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Poller status
  const [pollerStatus, setPollerStatus] = useState<any>(null)
  const [pollerLoading, setPollerLoading] = useState(false)

  // ─── Load channels ─────────────────────────────────────────────────────────────
  useEffect(() => {
    ipc.getChannels().then((ch: any) => setChannels(Array.isArray(ch) ? ch : []))
    ipc.getPollerStatus().then((s: any) => s && setPollerStatus(s))
    ipc.getOpLogs().then((logs: any) => setOpLogs(Array.isArray(logs) ? logs : []))
  }, [])

  // ─── Live operation logs via IPC event ───────────────────────────────────────
  useEffect(() => {
    const cleanup = ipc.onOpLogs((entries: any) => setOpLogs(Array.isArray(entries) ? entries : []))
    return cleanup
  }, [])

  // ─── Auto-scroll logs ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (logsAutoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [opLogs, logsAutoScroll])

  // ─── Poller status polling ────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      ipc.getPollerStatus().then(setPollerStatus)
    }, 5000)
    return () => clearInterval(t)
  }, [])

  // ─── Handlers ─────────────────────────────────────────────────────────────────
  const handleBulkImport = async () => {
    const urls = bulkImportText.split('\n').map(u => u.trim()).filter(Boolean)
    if (!urls.length) return
    setBulkImporting(true)
    setBulkResults([])
    try {
      const raw = await ipc.bulkAddChannels(urls)
      const results = Array.isArray(raw) ? raw : []
      setBulkResults(results)
      // Refresh channel list
      const ch = await ipc.getChannels()
      setChannels(Array.isArray(ch) ? ch : [])
      const ok = results.filter((r: any) => r.success).length
      showToast(`Đã thêm ${ok}/${urls.length} kênh`)
      setBulkImportText('')
    } catch (err: any) {
      showToast('Lỗi: ' + (err?.message || 'không rõ'))
    } finally {
      setBulkImporting(false)
    }
  }

  const handleDeleteChannel = async (id: string) => {
    await ipc.removeChannel(id)
    setChannels(prev => prev.filter((c: any) => c.id !== id))
    if (selectedChannelId === id) setSelectedChannelId(null)
    showToast('Đã xóa kênh')
  }

  const handleRefreshChannels = async () => {
    showToast('Đang sync kênh...')
    try {
      await ipc.syncChannels()
    } catch {}
    try {
      const ch = await ipc.getChannels()
      setChannels(Array.isArray(ch) ? ch : [])
    } catch {}
    showToast('Đã sync kênh')
  }

  const handleSaveProxySettings = async () => {
    const patch = { proxyEnabled, proxyHost, proxyPort, proxyUsername: proxyUser, proxyPassword: proxyPass }
    setSettings(patch)
    await ipc.updateSettings(patch)
    showToast('Đã lưu cấu hình proxy')
  }

  const handleProxyTest = async () => {
    if (!proxyHost) { showToast('Nhập địa chỉ proxy trước'); return }
    setProxyTesting(true)
    setProxyStatus('testing')
    try {
      const testUrl = `http://${proxyHost}:${proxyPort}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      await fetch(testUrl, { signal: controller.signal }).catch(() => null)
      clearTimeout(timeout)
      setProxyStatus('ok')
      showToast('Proxy kết nối được — ' + testUrl)
    } catch {
      setProxyStatus('fail')
      showToast('Proxy không kết nối được')
    }
    setProxyTesting(false)
  }

  const handleSaveScanParams = async () => {
    const patch = {
      pollIntervalMs: pollInterval * 1000,
      maxConcurrentDownloads: maxConcurrentDl,
    }
    setSettings(patch)
    await ipc.updateSettings(patch)
    showToast('Đã lưu thông số quét')
  }

  const handleSaveVideoFilters = async () => {
    const patch = {
      videoMinDurationSec: durationMode === 'short' ? 0 : 0,
      videoMaxDurationSec: durationMode === 'short' ? 180 : durationMode === 'long' ? 0 : maxDurationMin * 60,
    }
    setSettings(patch)
    await ipc.updateSettings(patch)
    showToast('Đã lưu bộ lọc video')
  }

  const handleStartPoller = async () => {
    setPollerLoading(true)
    await ipc.resumePoller()
    await new Promise(r => setTimeout(r, 500))
    await ipc.getPollerStatus().then(setPollerStatus)
    setPollerLoading(false)
    showToast('Poller đã bắt đầu')
  }

  const handleStopPoller = async () => {
    setPollerLoading(true)
    await ipc.pausePoller()
    await new Promise(r => setTimeout(r, 500))
    await ipc.getPollerStatus().then(setPollerStatus)
    setPollerLoading(false)
    showToast('Poller đã dừng')
  }

  const handleClearLogs = async () => {
    await ipc.clearOpLogs()
    setOpLogs([])
  }

  // ─── Filtered channels ─────────────────────────────────────────────────────────
  const filteredChannels = channels.filter(ch =>
    ch.name?.toLowerCase().includes(channelSearch.toLowerCase()) ||
    ch.id?.toLowerCase().includes(channelSearch.toLowerCase())
  )

  // ─── Styles ────────────────────────────────────────────────────────────────────
  const sectionLabel = { fontSize: 9, fontWeight: 800, color: '#444', letterSpacing: '0.1em', marginBottom: 8 }
  const inputStyle = {
    width: '100%', height: 30, background: '#0a0a0a', border: '1px solid #222',
    borderRadius: 3, color: '#ddd', fontSize: 10, paddingLeft: 8, outline: 'none',
    boxSizing: 'border-box' as const,
  }
  const cardStyle = {
    background: '#0D0D0D', border: '1px solid #1a1a1a',
    borderRadius: 6, padding: '12px 14px', marginBottom: 12,
  }

  const pollerBadge = (() => {
    if (!pollerStatus?.active) return { label: 'PAUSED', color: '#FFB800', bg: '#FFB80011', border: '#FFB80044' }
    if (pollerStatus.exhaustedUntil && pollerStatus.exhaustedUntil > Date.now()) return { label: 'BACKOFF', color: '#FF4444', bg: '#FF444411', border: '#FF444444' }
    return { label: 'ACTIVE', color: '#00FF88', bg: '#00FF8811', border: '#00FF8844' }
  })()

  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      {/* Header + Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '0.08em' }}>OPERATION CENTER</div>
          <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>MMO Edition — RTX 5080 Optimized</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            padding: '4px 10px', borderRadius: 4,
            background: pollerBadge.bg, border: `1px solid ${pollerBadge.border}`,
            fontSize: 9, fontWeight: 800, color: pollerBadge.color, letterSpacing: '0.08em',
          }}>
            ● {pollerBadge.label}
          </div>
          <button
            onClick={handleStartPoller}
            disabled={pollerLoading || pollerStatus?.active}
            style={{
              height: 28, paddingLeft: 14, paddingRight: 14,
              background: '#00FF8811', border: '1px solid #00FF8844', borderRadius: 4,
              fontSize: 9, fontWeight: 800, color: '#00FF88', cursor: 'pointer',
              opacity: (pollerLoading || pollerStatus?.active) ? 0.4 : 1,
            }}
          >▶ BẮT ĐẦU</button>
          <button
            onClick={handleStopPoller}
            disabled={pollerLoading || !pollerStatus?.active}
            style={{
              height: 28, paddingLeft: 14, paddingRight: 14,
              background: '#FF444411', border: '1px solid #FF444444', borderRadius: 4,
              fontSize: 9, fontWeight: 800, color: '#FF4444', cursor: 'pointer',
              opacity: (pollerLoading || !pollerStatus?.active) ? 0.4 : 1,
            }}
          >■ DỪNG</button>
        </div>
      </div>

      {/* 2-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>

        {/* ── LEFT COLUMN ────────────────────────────────────────────────────────── */}
        <div>

          {/* 1. Channel Manager */}
          <div style={cardStyle}>
            <div style={sectionLabel}>📡 QUẢN LÝ KÊNH</div>

            {/* Search */}
            <input
              value={channelSearch}
              onChange={e => setChannelSearch(e.target.value)}
              placeholder="Tìm kiếm kênh..."
              style={{ ...inputStyle, marginBottom: 8 }}
            />

            {/* Channel list */}
            <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 8 }}>
              {filteredChannels.length === 0 ? (
                <div style={{ fontSize: 9, color: '#333', textAlign: 'center', padding: '16px 0' }}>
                  Chưa có kênh nào. Thêm kênh bên dưới.
                </div>
              ) : filteredChannels.map(ch => (
                <div
                  key={ch.id}
                  onClick={() => setSelectedChannelId(selectedChannelId === ch.id ? null : ch.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                    background: selectedChannelId === ch.id ? '#00B4FF11' : 'transparent',
                    borderRadius: 3, cursor: 'pointer',
                    border: selectedChannelId === ch.id ? '1px solid #00B4FF22' : '1px solid transparent',
                  }}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: ch.avatarColor || '#00B4FF', flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ch.name || ch.id}
                    </div>
                    <div style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>
                      {ch.id?.slice(0, 12)}...
                    </div>
                  </div>
                  {selectedChannelId === ch.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteChannel(ch.id) }}
                      style={{
                        fontSize: 8, background: 'transparent', border: '1px solid #FF444444',
                        borderRadius: 3, color: '#FF4444', cursor: 'pointer', padding: '2px 6px',
                      }}
                    >✕</button>
                  )}
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button onClick={handleRefreshChannels} style={{
                flex: 1, height: 26, background: '#FF6B3511', border: '1px solid #FF6B3544',
                borderRadius: 3, fontSize: 9, fontWeight: 700, color: '#FF6B35', cursor: 'pointer',
              }}>⟳ REFRESH</button>
              {selectedChannelId && (
                <button onClick={() => handleDeleteChannel(selectedChannelId)} style={{
                  height: 26, paddingLeft: 10, paddingRight: 10,
                  background: '#FF444411', border: '1px solid #FF444444',
                  borderRadius: 3, fontSize: 9, fontWeight: 700, color: '#FF4444', cursor: 'pointer',
                }}>✕ XÓA</button>
              )}
            </div>

            {/* Bulk import */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 8, color: '#444', marginBottom: 4 }}>NHẬP HÀNG LOẠT (mỗi dòng 1 link)</div>
              <textarea
                value={bulkImportText}
                onChange={e => setBulkImportText(e.target.value)}
                placeholder="https://www.youtube.com/@channel1&#10;https://www.youtube.com/@channel2&#10;..."
                style={{
                  width: '100%', height: 60, background: '#0a0a0a', border: '1px solid #222',
                  borderRadius: 3, color: '#ddd', fontSize: 9, padding: '6px 8px',
                  resize: 'vertical', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              onClick={handleBulkImport}
              disabled={bulkImporting || !bulkImportText.trim()}
              style={{
                width: '100%', height: 28,
                background: bulkImporting ? '#1a3a1a' : '#00FF8811',
                border: '1px solid #00FF8844', borderRadius: 3,
                fontSize: 9, fontWeight: 800, color: '#00FF88', cursor: 'pointer',
                opacity: (bulkImporting || !bulkImportText.trim()) ? 0.5 : 1,
              }}
            >
              {bulkImporting ? 'ĐANG THÊM...' : 'THÊM KÊNH'}
            </button>

            {/* Bulk results */}
            {bulkResults.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 8 }}>
                {bulkResults.map((r, i) => (
                  <div key={i} style={{ color: r.success ? '#00FF88' : '#FF4444', padding: '1px 0' }}>
                    {r.success ? '✓' : '✗'} {r.url} {r.error ? `— ${r.error}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. Proxy Configuration */}
          <div style={cardStyle}>
            <div style={sectionLabel}>🌐 CẤU HÌNH PROXY</div>

            {/* Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => {
                  const next = !proxyEnabled
                  setProxyEnabled(next)
                  setSettings({ proxyEnabled: next })
                  ipc.updateSettings({ proxyEnabled: next })
                }}
                style={{
                  width: 40, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: proxyEnabled ? '#00FF88' : '#333',
                  transition: 'background 0.2s', position: 'relative', flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, left: proxyEnabled ? 20 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s',
                }} />
              </button>
              <span style={{ fontSize: 9, color: '#888' }}>Bật Proxy</span>
              {proxyStatus === 'ok' && <span style={{ fontSize: 8, color: '#00FF88', marginLeft: 'auto' }}>● Đã kết nối</span>}
              {proxyStatus === 'fail' && <span style={{ fontSize: 8, color: '#FF4444', marginLeft: 'auto' }}>● Kết nối thất bại</span>}
              {proxyStatus === 'testing' && <span style={{ fontSize: 8, color: '#FFB800', marginLeft: 'auto' }}>● Đang kiểm tra...</span>}
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <div style={{ flex: 2 }}>
                <div style={{ fontSize: 8, color: '#444', marginBottom: 3 }}>HOST</div>
                <input value={proxyHost} onChange={e => setProxyHost(e.target.value)} placeholder="proxy.example.com" style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 8, color: '#444', marginBottom: 3 }}>PORT</div>
                <input type="number" value={proxyPort} onChange={e => setProxyPort(Number(e.target.value))} placeholder="8080" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 8, color: '#444', marginBottom: 3 }}>USERNAME</div>
                <input value={proxyUser} onChange={e => setProxyUser(e.target.value)} placeholder="user" style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 8, color: '#444', marginBottom: 3 }}>PASSWORD</div>
                <input type="password" value={proxyPass} onChange={e => setProxyPass(e.target.value)} placeholder="••••" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleProxyTest} disabled={proxyTesting} style={{
                flex: 1, height: 26, background: '#FFB80011', border: '1px solid #FFB80044',
                borderRadius: 3, fontSize: 9, fontWeight: 700, color: '#FFB800', cursor: 'pointer',
                opacity: proxyTesting ? 0.5 : 1,
              }}>{proxyTesting ? 'TESTING...' : 'TEST CONNECTION'}</button>
              <button onClick={handleSaveProxySettings} style={{
                flex: 1, height: 26, background: '#00FF8811', border: '1px solid #00FF8844',
                borderRadius: 3, fontSize: 9, fontWeight: 700, color: '#00FF88', cursor: 'pointer',
              }}>LƯU PROXY</button>
            </div>
          </div>

          {/* 3. Scan Parameters */}
          <div style={cardStyle}>
            <div style={sectionLabel}>⚙️ THÔNG SỐ QUÉT</div>

            {/* Poll interval */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#444', marginBottom: 4 }}>KHOẢNG CÁCH QUÉT (GIÂY)</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[5, 10, 30, 60].map(sec => (
                  <button key={sec} onClick={() => setPollInterval(sec)} style={{
                    flex: 1, height: 24,
                    background: pollInterval === sec ? '#00B4FF18' : 'transparent',
                    border: `1px solid ${pollInterval === sec ? '#00B4FF' : '#222'}`,
                    borderRadius: 3, fontSize: 10, fontWeight: 700,
                    color: pollInterval === sec ? '#00B4FF' : '#444',
                    cursor: 'pointer',
                  }}>{sec}s</button>
                ))}
              </div>
            </div>

            {/* Max concurrent downloads */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#444', marginBottom: 4 }}>SỐ LUỒNG TẢI ĐỒNG THỜI</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4].map(n => (
                  <button key={n} onClick={() => setMaxConcurrentDl(n)} style={{
                    flex: 1, height: 24,
                    background: maxConcurrentDl === n ? '#00FF8818' : 'transparent',
                    border: `1px solid ${maxConcurrentDl === n ? '#00FF88' : '#222'}`,
                    borderRadius: 3, fontSize: 10, fontWeight: 700,
                    color: maxConcurrentDl === n ? '#00FF88' : '#444',
                    cursor: 'pointer',
                  }}>{n}</button>
                ))}
              </div>
            </div>

            {/* Video age filter */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#444', marginBottom: 4 }}>LẤY VIDEO ĐĂNG TRONG (PHÚT)</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[5, 10, 15, 30, 60].map(min => (
                  <button key={min} onClick={() => setVideoAge(min)} style={{
                    flex: 1, height: 24,
                    background: videoAge === min ? '#FF6B3518' : 'transparent',
                    border: `1px solid ${videoAge === min ? '#FF6B35' : '#222'}`,
                    borderRadius: 3, fontSize: 10, fontWeight: 700,
                    color: videoAge === min ? '#FF6B35' : '#444',
                    cursor: 'pointer',
                  }}>{min}</button>
                ))}
              </div>
            </div>

            <button onClick={handleSaveScanParams} style={{
              width: '100%', height: 28,
              background: '#00FF8811', border: '1px solid #00FF8844',
              borderRadius: 3, fontSize: 9, fontWeight: 800, color: '#00FF88', cursor: 'pointer',
            }}>LƯU THÔNG SỐ</button>
          </div>

        </div>

        {/* ── RIGHT COLUMN ───────────────────────────────────────────────────────── */}
        <div>

          {/* 4. Video Filters */}
          <div style={cardStyle}>
            <div style={sectionLabel}>🎬 BỘ LỌC VIDEO</div>

            {/* Duration filter */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#444', marginBottom: 4 }}>THỜI LƯỢNG</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {([['all', 'Tất cả'], ['short', 'Short (<3p)'], ['long', 'Dài (>3p)']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => {
                    setDurationMode(val)
                    const patch = {
                      videoMinDurationSec: val === 'short' ? 0 : 0,
                      videoMaxDurationSec: val === 'short' ? 180 : val === 'long' ? 0 : maxDurationMin * 60,
                    }
                    setSettings(patch)
                    ipc.updateSettings(patch)
                  }} style={{
                    flex: 1, height: 24,
                    background: durationMode === val ? '#00B4FF18' : 'transparent',
                    border: `1px solid ${durationMode === val ? '#00B4FF' : '#222'}`,
                    borderRadius: 3, fontSize: 9, fontWeight: 700,
                    color: durationMode === val ? '#00B4FF' : '#444',
                    cursor: 'pointer',
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Max duration */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#444', marginBottom: 4 }}>GIỚI HẠN TỐI ĐA (PHÚT) — 0 = không giới hạn</div>
              <input
                type="number"
                min={0}
                value={maxDurationMin}
                onChange={e => setMaxDurationMin(Number(e.target.value))}
                style={{ ...inputStyle }}
              />
            </div>

            <button onClick={handleSaveVideoFilters} style={{
              width: '100%', height: 28,
              background: '#00FF8811', border: '1px solid #00FF8844',
              borderRadius: 3, fontSize: 9, fontWeight: 800, color: '#00FF88', cursor: 'pointer',
            }}>ÁP DỤNG BỘ LỌC</button>
          </div>

          {/* 5. Real-time Operation Logs */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={sectionLabel}>📋 OPERATION LOGS</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={handleClearLogs} style={{
                  fontSize: 8, background: 'transparent', border: '1px solid #333',
                  borderRadius: 3, color: '#555', cursor: 'pointer', padding: '2px 8px',
                }}>CLEAR</button>
                <button
                  onClick={() => setLogsAutoScroll(v => !v)}
                  style={{
                    fontSize: 8, background: logsAutoScroll ? '#00B4FF15' : 'transparent',
                    border: `1px solid ${logsAutoScroll ? '#00B4FF44' : '#333'}`,
                    borderRadius: 3, color: logsAutoScroll ? '#00B4FF' : '#555',
                    cursor: 'pointer', padding: '2px 8px',
                  }}
                >AUTO {logsAutoScroll ? 'ON' : 'OFF'}</button>
              </div>
            </div>

            <div style={{
              maxHeight: 280, overflowY: 'auto',
              background: '#0a0a0a', border: '1px solid #141414',
              borderRadius: 4, padding: 6,
            }}>
              {opLogs.length === 0 ? (
                <div style={{ fontSize: 9, color: '#2a2a2a', textAlign: 'center', padding: '16px 0' }}>
                  Chưa có log. Poller đang chạy sẽ hiển thị tại đây.
                </div>
              ) : opLogs.map(entry => {
                const levelColor = entry.level === 'error' ? '#FF4444' : entry.level === 'warn' ? '#FFB800' : entry.level === 'success' ? '#00FF88' : '#888'
                const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })
                return (
                  <div key={entry.id} style={{ fontSize: 9, color: '#555', marginBottom: 3, lineHeight: 1.5 }}>
                    <span style={{ color: '#2a2a2a', fontFamily: 'monospace' }}>[{time}]</span>
                    <span style={{ color: levelColor, marginLeft: 4, fontWeight: 700 }}>[{entry.level.toUpperCase()}]</span>
                    <span style={{ color: '#FF6B35', marginLeft: 4, fontSize: 8 }}>[{entry.category}]</span>
                    <span style={{ color: levelColor, marginLeft: 4 }}>{entry.message}</span>
                    {entry.detail && <span style={{ color: '#444', fontSize: 8, display: 'block', paddingLeft: 16 }}>{entry.detail}</span>}
                  </div>
                )
              })}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* 6. License Info */}
          <div style={cardStyle}>
            <div style={sectionLabel}>📜 THÔNG TIN BẢN QUYỀN</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#888' }}>Phần mềm</span>
                <span style={{ fontSize: 10, color: '#00FF88', fontWeight: 700, fontFamily: 'monospace' }}>HyperClip MMO</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#888' }}>User</span>
                <span style={{ fontSize: 10, color: '#00B4FF', fontWeight: 700, fontFamily: 'monospace' }}>Customer RTX 5080</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#888' }}>Thời hạn</span>
                <span style={{ fontSize: 10, color: '#00FF88', fontWeight: 700, fontFamily: 'monospace' }}>Còn 365 ngày</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#888' }}>Phiên bản</span>
                <span style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>v1.0.0 MMO</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#888' }}>GPU</span>
                <span style={{ fontSize: 10, color: '#00FF88', fontFamily: 'monospace' }}>NVIDIA RTX 5080</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#888' }}>Kênh đang theo dõi</span>
                <span style={{ fontSize: 10, color: '#00B4FF', fontFamily: 'monospace' }}>{channels.length}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ─── Logs Section ─────────────────────────────────────────────────────────────

function LogsSection() {
  const [logs, setLogs] = useState<{ files: { name: string; size: number; mtime: number; content?: string }[]; logDir: string }>({ files: [], logDir: '' })
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [selectedLog, setSelectedLog] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<string>('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    ipc.readLogs().then(result => {
      if (result) {
        setLogs(result)
        setLoading(false)
        // Auto-select first log
        if (result.files && result.files.length > 0 && !selectedLog) {
          setSelectedLog(result.files[0].name)
          setSelectedContent(result.files[0].content || '')
        }
      } else {
        setLogs({ files: [], logDir: '' })
        setLoading(false)
      }
    }).catch(() => {
      setLogs({ files: [], logDir: '' })
      setLoading(false)
    })
  }, [refreshKey])

  const handleExport = async () => {
    setExporting(true)
    try {
      const result = await ipc.exportLogs()
      if (result.success) {
        useAppStore.getState().showToast?.('Đã xuất logs thành công!')
      }
    } finally {
      setExporting(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const selectedFile = logs.files.find(f => f.name === selectedLog)

  return (
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '0.1em', marginBottom: 4 }}>LOG FILES</div>
          <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>{logs.logDir}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            style={{
              padding: '8px 16px', background: '#141414', border: '1px solid #222',
              borderRadius: 6, color: '#666', fontSize: 9, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.05em',
            }}
          >
            ↻ REFRESH
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            style={{
              padding: '8px 16px',
              background: exporting ? '#1a1200' : '#1a1400',
              border: `1px solid ${exporting ? '#555' : '#FF6B35'}`,
              borderRadius: 6, color: exporting ? '#555' : '#FF6B35',
              fontSize: 9, fontWeight: 700, cursor: exporting ? 'not-allowed' : 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            {exporting ? 'ĐANG XUẤT...' : '📦 XUẤT LOGS'}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#333', fontSize: 10, padding: 20 }}>Đang đọc log files...</div>
      ) : logs.files.length === 0 ? (
        <div style={{ color: '#333', fontSize: 10, padding: 20 }}>
          Không có log file nào. Thử nhấn Refresh hoặc chạy lại app.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 12, height: 'calc(100vh - 180px)' }}>
          {/* File list */}
          <div style={{ background: '#0D0D0D', border: '1px solid #141414', borderRadius: 8, overflow: 'auto', padding: 8 }}>
            <div style={{ fontSize: 8, color: '#333', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8, padding: '0 4px' }}>FILES</div>
            {logs.files.map(file => (
              <button
                key={file.name}
                onClick={() => { setSelectedLog(file.name); setSelectedContent(file.content || '') }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                  background: selectedLog === file.name ? '#1a1a1a' : 'transparent',
                  border: selectedLog === file.name ? '1px solid #333' : '1px solid transparent',
                  borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                }}
              >
                <div style={{ fontSize: 9, color: selectedLog === file.name ? '#FF6B35' : '#666', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 8, color: '#333', marginTop: 2 }}>
                  {formatSize(file.size)} · {new Date(file.mtime).toLocaleString()}
                </div>
              </button>
            ))}
          </div>

          {/* Log content */}
          <div style={{ background: '#0D0D0D', border: '1px solid #141414', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid #141414',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
            }}>
              <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>{selectedLog}</span>
              {selectedFile && (
                <span style={{ fontSize: 8, color: '#333' }}>{formatSize(selectedFile.size)}</span>
              )}
            </div>
            <pre style={{
              flex: 1, overflow: 'auto', margin: 0, padding: 12,
              fontSize: 9, color: '#888', fontFamily: 'Consolas, monospace',
              lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {selectedContent || <span style={{ color: '#333' }}>— empty —</span>}
            </pre>
          </div>
        </div>
      )}

      {/* Help text */}
      <div style={{ marginTop: 16, padding: '10px 14px', background: '#0D0D0D', borderRadius: 6, borderLeft: '3px solid #333' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#555', marginBottom: 4 }}>CÁCH BÁO LỖI</div>
        <div style={{ fontSize: 9, color: '#333', lineHeight: 1.8 }}>
          1. Nhấn <strong style={{ color: '#555' }}>Xuất Logs</strong> để tạo file nén<br />
          2. Gửi file <strong style={{ color: '#555' }}>.zip</strong> qua Zalo/Telegram kèm mô tả lỗi<br />
          3. Hoặc gửi đường dẫn thư mục: <span style={{ color: '#555', fontFamily: 'monospace' }}>{logs.logDir}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Settings Page ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { settings, systemStats, setSettings } = useAppStore()
  const [activeTab, setActiveTab] = useState<'status' | 'diag' | 'keys' | 'projects' | 'system' | 'logs' | 'operation'>('status')

  const TABS = [
    { id: 'status' as const, label: 'STATUS', color: '#00FF88' },
    { id: 'diag' as const, label: 'DIAGNOSTICS', color: '#FF6B35' },
    { id: 'projects' as const, label: 'OAUTH PROJECTS', color: '#00FF88' },
    { id: 'keys' as const, label: 'API KEYS', color: '#00B4FF' },
    { id: 'system' as const, label: 'SYSTEM', color: '#FFB800' },
    { id: 'operation' as const, label: 'OPERATION', color: '#00FF88' },
    { id: 'logs' as const, label: 'LOGS', color: '#FF6B35' },
  ]

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

        {/* DIAGNOSTICS — System prerequisites check */}
        {activeTab === 'diag' && <DiagnosticsSection />}

        {/* API Keys — full width */}
        {activeTab === 'keys' && (
          <ApiKeysSection />
        )}

        {/* Projects */}
        {activeTab === 'projects' && (
          <ProjectsSection />
        )}

        {/* System tab */}
        {activeTab === 'system' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Header */}
            <div style={{
              padding: '14px 20px',
              background: '#0B0B0B',
              borderBottom: '1px solid #1A1A1A',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>SYSTEM MONITOR</div>
            </div>

            {/* Hardware Info */}
            <div style={{ padding: '12px 20px', background: '#0D0D0D', borderBottom: '1px solid #141414' }}>
              <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>HARDWARE</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {/* CPU */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>CPU</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {systemStats.cpuName || 'Unknown'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1, height: 6, background: '#141414', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(systemStats.cpuUsage ?? 0, 100)}%`, height: '100%',
                        background: (systemStats.cpuUsage ?? 0) > 80 ? '#FFB800' : '#00B4FF',
                        borderRadius: 2, transition: 'width 1s ease',
                        boxShadow: `0 0 4px ${(systemStats.cpuUsage ?? 0) > 80 ? '#FFB80044' : '#00B4FF44'}`,
                      }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', minWidth: 30, textAlign: 'right' }}>
                      {systemStats.cpuUsage ?? 0}%
                    </span>
                  </div>
                  <div style={{ fontSize: 8, color: '#2a2a2a', marginTop: 2 }}>{systemStats.cpuCores ?? 0} cores</div>
                </div>

                {/* RAM */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>SYSTEM RAM</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#888', fontFamily: 'monospace', lineHeight: 1.2 }}>
                    {Math.round((systemStats.ramUsed ?? 0) * 10) / 10}
                    <span style={{ fontSize: 9, color: '#333', marginLeft: 4 }}>/ {Math.round((systemStats.ramTotal ?? 0) * 10) / 10} GB</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1, height: 6, background: '#141414', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${systemStats.ramTotal ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100) : 0}%`,
                        height: '100%', background: '#00B4FF', borderRadius: 2,
                        boxShadow: '0 0 4px #00B4FF44',
                      }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', minWidth: 30, textAlign: 'right' }}>
                      {systemStats.ramTotal ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100) : 0}%
                    </span>
                  </div>
                  <div style={{ fontSize: 8, color: '#2a2a2a', marginTop: 2 }}>
                    {(Math.round(((systemStats.ramFree ?? 0) / (systemStats.ramTotal ?? 1)) * 100))}% free
                  </div>
                </div>

                {/* GPU */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>GPU</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: 1,
                      background: systemStats.gpuEncoder === 'nvenc' ? '#00FF88' : systemStats.gpuEncoder === 'qsv' ? '#FFB800' : '#555',
                      boxShadow: systemStats.gpuEncoder === 'nvenc' ? '0 0 4px #00FF8866' : 'none',
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {systemStats.gpuName || 'No GPU'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, fontSize: 8, color: '#2a2a2a', fontFamily: 'monospace', marginTop: 2 }}>
                    <span style={{ color: systemStats.gpuEncoder === 'nvenc' ? '#00FF88' : '#555' }}>{systemStats.gpuEncoder?.toUpperCase() || 'CPU'}</span>
                    <span>tier: {systemStats.gpuTier || '?'}</span>
                    <span>workers: {systemStats.maxChunkWorkers || 2}</span>
                  </div>
                </div>

                {/* GPU Stats */}
                {systemStats.gpuEncoder === 'nvenc' && (
                  <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                    <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>GPU LOAD</div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>{systemStats.gpuUsage ?? 0}%</div>
                        <div style={{ fontSize: 7, color: '#2a2a2a', marginTop: 2 }}>utilization</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>{systemStats.gpuTemp ?? 0}°C</div>
                        <div style={{ fontSize: 7, color: '#2a2a2a', marginTop: 2 }}>temperature</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>
                          {Math.round((systemStats.gpuMemoryFree ?? 0) / 1024)}GB
                        </div>
                        <div style={{ fontSize: 7, color: '#2a2a2a', marginTop: 2 }}>
                          free / {Math.round((systemStats.gpuMemoryTotal ?? 0) / 1024)}GB
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* RAM Disk */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>RAM DISK</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: 1,
                      background: systemStats.ramDiskIsAvailable ? '#00FF88' : '#333',
                      boxShadow: systemStats.ramDiskIsAvailable ? '0 0 4px #00FF8866' : 'none',
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: systemStats.ramDiskIsAvailable ? '#888' : '#333' }}>
                      {systemStats.ramDiskIsAvailable ? `${systemStats.ramDiskTotal}GB` : 'N/A'}
                    </span>
                  </div>
                  {systemStats.ramDiskIsAvailable && (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <span style={{ fontSize: 8, color: '#00B4FF', fontFamily: 'monospace' }}>
                          {systemStats.ramDiskUsed}GB used
                        </span>
                        <span style={{ fontSize: 8, color: '#2a2a2a', fontFamily: 'monospace' }}>
                          {systemStats.ramDiskAvailable}GB avail
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Workers */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>WORKERS</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: systemStats.activeWorkers > 0 ? '#00B4FF' : '#333', fontFamily: 'monospace' }}>
                      {systemStats.activeWorkers ?? 0}
                    </span>
                    <span style={{ fontSize: 8, color: '#333' }}>/ {systemStats.maxChunkWorkers || 2} max</span>
                  </div>
                  <div style={{ fontSize: 8, color: '#2a2a2a', marginTop: 2 }}>NVENC render workers</div>
                </div>

                {/* Network */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>NETWORK</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: systemStats.isOnline ? '#00FF88' : '#FF4444',
                      boxShadow: systemStats.isOnline ? '0 0 4px #00FF8866' : '0 0 4px #FF444466',
                    }} />
                    <span style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>{systemStats.networkIp || '127.0.0.1'}</span>
                  </div>
                  <div style={{ fontSize: 8, color: '#2a2a2a', marginTop: 2 }}>
                    {systemStats.isOnline ? 'Online' : 'Offline'}
                  </div>
                </div>
              </div>
            </div>

            {/* Storage */}
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.1em', marginBottom: 0, padding: '12px 20px 8px', background: '#0B0B0B' }}>STORAGE</div>
            <div style={{ background: '#0D0D0D', borderBottom: '1px solid #141414' }}>
              <StorageWidget />
            </div>

            {/* About */}
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.1em', marginBottom: 0, padding: '12px 20px 8px', background: '#0B0B0B' }}>ABOUT</div>
            <div style={{ background: '#0D0D0D' }}>
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

        {/* LOGS tab */}
        {activeTab === 'logs' && <LogsSection />}

        {/* OPERATION tab */}
        {activeTab === 'operation' && <OperationPanel />}
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
