import { colors, spacing, fontSize } from '../../design-system/tokens'
'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../lib/store'
import {
  MAX_UNITS_PER_PROJECT,
  QUOTA_WARNING_PCT,
  QUOTA_CRITICAL_THRESHOLD,
  QUOTA_WARNING_THRESHOLD,
  QUOTA_BAR_WARN_PCT,
  QUOTA_BAR_EXHAUSTED_PCT,
  STALE_SESSION_DAYS,
  HOURLY_EVENTS_MAX,
  RESET_ANIMATION_MS,
  CPU_WARN_PCT,
} from '../../lib/constants'
import {
  formatNextReset,
  formatTimeAgo,
  UsageTimeline,
  StatCard,
} from '../../lib/utils'
import { ipc } from '../../lib/ipc'
import type { Project, ApiKeyStatus } from '../types'

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
  const labelStyle = { fontSize: 9, color: '#777', letterSpacing: '0.05em', fontWeight: 600 }
  const inputStyle = {
    width: '100%', height: 30, background: colors.bg, border: '1px solid #D0D0D0',
    borderRadius: 3, color: '#888', fontSize: 10, paddingLeft: 8, outline: 'none',
    fontFamily: 'monospace', boxSizing: 'border-box' as const,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <form onSubmit={handleSubmit} style={{
        background: colors.bg, border: '1px solid #D0D0D0', borderRadius: 8,
        padding: 24, width: 440, maxWidth: '90vw',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.border, letterSpacing: '0.06em', marginBottom: 16 }}>
          THÊM GOOGLE PROJECT
        </div>

        <div style={rowStyle}>
          <div style={labelStyle}>PROJECT ID</div>
          <input autoFocus value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="proj-01, my-project-2, ..." style={inputStyle} />
          <div style={{ fontSize: 8, color: '#888' }}>Identifier duy nhất cho project này. Dùng để pair OAuth + API Key.</div>
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
            flex: 1, height: 34, background: loading ? '#F0F8FF' : colors.accent,
            border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#000',
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'ĐANG AUTHORIZE...' : 'THÊM + AUTHORIZE'}
          </button>
          <button type="button" onClick={onClose} style={{
            height: 34, paddingLeft: 16, paddingRight: 16,
            background: 'transparent', border: '1px solid #888', borderRadius: 4,
            fontSize: 10, color: '#888', cursor: 'pointer',
          }}>
            HỦY
          </button>
        </div>
      </form>
    </div>
  )
}

const ProjectCard = React.memo(function ProjectCard({ project, onRefresh }: { project: Project; onRefresh: () => void; key?: string }) {
  const { showToast } = useAppStore()
  const [showRemove, setShowRemove] = useState(false)
  const [repairing, setRepairing] = useState(false)

  const statusColor: Record<string, string> = {
    healthy: colors.success,
    warning: colors.warning,
    rate_limited: colors.warning,
    error: '#FF6644',
    exhausted: colors.error,
    unauthorized: '#FF6644',
    no_oauth: colors.warning,
  }

  const sc = statusColor[project.status] || '#888'
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
    if (project.status === 'rate_limited' || project.status === 'warning') return colors.warning
    if (project.hasToken) return colors.success
    return '#FF6644'
  })()

  const apiSc = statusColor[project.apiKeyStatus] || '#888'

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
      background: project.status === 'exhausted' ? '#FFF0F0' : colors.bg,
      border: `1px solid ${project.status === 'exhausted' ? '#FF444444' : project.status === 'no_oauth' ? '#FFB80022' : colors.border}`,
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
          <span style={{ fontSize: 11, fontWeight: 700, color: '#888' }}>{project.projectId}</span>
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
          <span style={{ fontSize: 8, color: '#888', fontFamily: 'monospace' }}>
            {(project.usedToday / 1000).toFixed(1)}k / {(project.quotaTotal / 1000).toFixed(0)}k
          </span>
          <div style={{ width: 60, height: 3, background: colors.border, borderRadius: 1 }}>
            <div style={{
              width: `${Math.min(oauthPct, 100)}%`, height: '100%',
              background: oauthPct > 80 ? colors.warning : colors.success, borderRadius: 1,
              transition: 'width 0.8s ease',
            }} />
          </div>
        </div>
      </div>

      {/* OAuth + API Key rows */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {/* OAuth */}
        <div style={{ flex: 1, background: colors.bg, border: `1px solid ${oauthColor}22`, borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: '#777', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>OAUTH</div>
          <div style={{ fontSize: 10, color: oauthColor }}>
            {oauthLabel}
            {project.tokenExpiry && project.status !== 'exhausted' && (
              <div style={{ fontSize: 8, color: '#888', marginTop: 2 }}>expires {new Date(project.tokenExpiry).toLocaleTimeString()}</div>
            )}
          </div>
          {project.status === 'exhausted' && (
            <div style={{ fontSize: 8, color: '#FF444466', marginTop: 2 }}>auto-reset midnight PT</div>
          )}
        </div>
        {/* API Key */}
        <div style={{ flex: 1, background: colors.bg, border: `1px solid ${apiSc}22`, borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: '#777', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>API KEY</div>
          {project.apiKey ? (
            <div style={{ fontSize: 10, color: apiSc }}>
              {project.apiKey.slice(0, 10)}…
              <div style={{ fontSize: 8, color: '#888', marginTop: 2 }}>
                {project.apiKeyName || project.projectId} · {(project.apiKeyUsed / 1000).toFixed(1)}k
                {project.apiKeyStatus === 'exhausted' && <span style={{ color: colors.error }}> ⚠ exhausted</span>}
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
            background: 'transparent', border: '1px solid #D0D0D0', borderRadius: 3,
            fontSize: 9, color: '#777', cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = colors.error; e.currentTarget.style.borderColor = colors.error }}
          onMouseLeave={e => { e.currentTarget.style.color = '#777'; e.currentTarget.style.borderColor = colors.borderHover }}
        >✕ Xóa</button>
      </div>

      {/* Remove confirm */}
      {showRemove && (
        <div style={{
          marginTop: 8, padding: '8px 10px',
          background: '#FFF0F0', border: '1px solid #FFE0E0',
          borderRadius: 3, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 9, color: '#FF6644', flex: 1 }}>
            Xóa project này? OAuth + API key sẽ ngừng hoạt động.
          </span>
          <button onClick={handleRemove} style={{ height: 22, paddingLeft: 8, paddingRight: 8, background: '#CC3333', border: 'none', borderRadius: 3, color: colors.border, fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>Xóa</button>
          <button onClick={() => setShowRemove(false)} style={{ height: 22, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #888', borderRadius: 3, color: '#888', fontSize: 9, cursor: 'pointer' }}>Hủy</button>
        </div>
      )}
    </div>
  )
})

export function ProjectsSection() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState<'all' | 'healthy' | 'warning' | 'rate_limited' | 'exhausted' | 'no_oauth' | 'unauthorized'>('all')
  const [groupByGmail, setGroupByGmail] = useState(true)
  const [collapsedGmail, setCollapsedGmail] = useState<Set<string>>(new Set())
  const { showToast } = useAppStore()

  const load = async () => {
    setLoading(true)
    await Promise.all([
      ipc.getProjectTokenStatuses().then((p: any) => {
        setProjects(p as Project[])
      }).catch(() => {}),
    ])
    setLoading(false)
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
        background: colors.bg,
        borderBottom: '1px solid #E0E0E0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: colors.border, letterSpacing: '0.1em' }}>
            {projects.length >= 100 ? '200 PROJECTS' : 'OAUTH PROJECTS'}
          </div>
          {projects.length > 0 && (
            <div style={{ fontSize: 8, color: colors.accent, background: '#00B4FF11', border: '1px solid #00B4FF22', borderRadius: 3, padding: '1px 6px' }}>
              {totalPct}% quota used
            </div>
          )}
          <div style={{ width: 1, height: 12, background: colors.borderHover }} />
          <span style={{ fontSize: 8, color: '#888' }}>refresh {refreshTime}</span>
          {loading && <span style={{ fontSize: 8, color: '#00FF8844' }}>● loading...</span>}
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <button onClick={handleBulkImportCSV} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #00B4FF33', borderRadius: 4, fontSize: 8, fontWeight: 700, color: colors.accent, cursor: 'pointer', letterSpacing: '0.05em', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00B4FF15' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            CSV IMPORT
          </button>
          <button onClick={handleAutoAssignChannels} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #00FF8844', borderRadius: 4, fontSize: 8, fontWeight: 700, color: colors.success, cursor: 'pointer', letterSpacing: '0.05em', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00FF8815' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            AUTO-ASSIGN
          </button>
          <button onClick={handleResetAll} disabled={projects.length === 0} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #FF664422', borderRadius: 4, fontSize: 8, fontWeight: 700, color: '#FF6644', cursor: projects.length === 0 ? 'not-allowed' : 'pointer', opacity: projects.length === 0 ? 0.4 : 1, letterSpacing: '0.05em', transition: 'all 0.15s' }}>
            RESET ALL
          </button>
          <button onClick={handleSyncChannels} disabled={syncing} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: 'transparent', border: '1px solid #00FF8844', borderRadius: 4, fontSize: 8, fontWeight: 700, color: colors.success, cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.5 : 1, letterSpacing: '0.05em', transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!syncing) { e.currentTarget.style.background = '#00FF8822' } }}
            onMouseLeave={e => { if (!syncing) { e.currentTarget.style.background = 'transparent' } }}>
            {syncing ? '...' : 'SYNC'}
          </button>
          <button onClick={() => setShowAdd(v => !v)} style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: showAdd ? '#00B4FF22' : 'transparent', border: `1px solid ${showAdd ? '#00B4FF66' : '#00B4FF33'}`, borderRadius: 4, fontSize: 8, fontWeight: 700, color: colors.accent, cursor: 'pointer', transition: 'all 0.15s' }}>
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
              style={{ height: 26, paddingLeft: 8, paddingRight: 8, background: groupByGmail ? '#00B4FF22' : 'transparent', border: `1px solid ${groupByGmail ? '#00B4FF44' : '#888'}`, borderRadius: 4, fontSize: 8, fontWeight: 700, color: groupByGmail ? colors.accent : '#777', cursor: 'pointer', letterSpacing: '0.05em', transition: 'all 0.15s' }}>
              GROUP: {groupByGmail ? 'GMAIL' : 'ALL'}
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E0E0E0', background: colors.bg }}>
          <div style={{
            background: colors.bg, border: '1px solid #E0E0E0',
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
          background: '#FFF0F0',
          borderBottom: '1px solid #FFE0E0',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.error, flexShrink: 0, boxShadow: '0 0 6px #FF444488' }} />
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
      <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid #E0E0E0', background: colors.bg }}>
        <StatCard
          label="TOTAL"
          value={String(projects.length)}
          sub="projects"
          color="#888"
          icon={<div style={{ width: 6, height: 6, borderRadius: 1, background: '#888' }} />}
        />
        <StatCard
          label="HEALTHY"
          value={`${healthyProjects}/${projects.length}`}
          sub="authorized"
          color="#00FF88"
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.success }} />}
        />
        <StatCard
          label="WARNING"
          value={String(warningProjects)}
          sub="75-90% quota"
          color={warningProjects > 0 ? colors.warning : colors.borderHover}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: warningProjects > 0 ? colors.warning : colors.borderHover }} />}
        />
        <StatCard
          label="RATE LIMITED"
          value={String(rateLimitedProjects)}
          sub="10+ errors"
          color={rateLimitedProjects > 0 ? colors.warning : colors.borderHover}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: rateLimitedProjects > 0 ? colors.warning : colors.borderHover }} />}
        />
        <StatCard
          label="EXHAUSTED"
          value={String(exhaustedProjects)}
          sub="needs reset"
          color={exhaustedProjects > 0 ? colors.error : colors.borderHover}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: exhaustedProjects > 0 ? colors.error : colors.borderHover }} />}
        />
        <StatCard
          label="NO OAUTH"
          value={String(noOauthProjects)}
          sub="not authorized"
          color={noOauthProjects > 0 ? colors.warning : colors.borderHover}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: noOauthProjects > 0 ? colors.warning : colors.borderHover }} />}
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
          color={totalPct > 80 ? colors.warning : colors.success}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: totalPct > 80 ? colors.warning : colors.success }} />}
        />
      </div>

      {/* Per-project quota distribution chart */}
      {projects.length > 0 && (
        <div style={{ padding: '12px 20px', background: colors.bg, borderBottom: '1px solid #E0E0E0' }}>
          <div style={{ fontSize: 8, color: '#AAA', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>PROJECT QUOTA DISTRIBUTION</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {projects
              .sort((a, b) => (b.usedToday ?? 0) - (a.usedToday ?? 0))
              .map(p => {
                const pct = p.quotaTotal > 0 ? Math.round((p.usedToday / p.quotaTotal) * 100) : 0
                const isExhausted = p.status === 'exhausted'
                const isRateLimited = p.status === 'rate_limited'
                const barColor = isExhausted ? colors.error : isRateLimited ? colors.warning : pct >= 90 ? colors.error : pct >= 75 ? colors.warning : pct > 0 ? colors.success : colors.borderHover
                return (
                  <div key={p.projectId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      minWidth: 100, fontSize: 9, color: isExhausted ? colors.error : isRateLimited ? colors.warning : '#777',
                      fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {(isExhausted || isRateLimited) && <span style={{ color: isExhausted ? colors.error : colors.warning, marginRight: 3 }}>⚠</span>}
                      {p.projectId}
                    </div>
                    <div style={{ flex: 1, height: 12, background: colors.border, borderRadius: 2, position: 'relative' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', background: barColor,
                        borderRadius: 2, transition: 'width 0.5s',
                        boxShadow: pct > 0 ? `0 0 4px ${barColor}44` : 'none',
                      }} />
                      <div style={{ position: 'absolute', top: 0, left: '75%', width: 1, height: '100%', background: '#888' }} />
                      <div style={{ position: 'absolute', top: 0, left: '90%', width: 1, height: '100%', background: '#777' }} />
                    </div>
                    <div style={{ minWidth: 170, fontSize: 8, color: '#888', fontFamily: 'monospace', textAlign: 'right' }}>
                      <span style={{ color: barColor }}>{p.usedToday.toLocaleString()}</span>
                      <span style={{ color: colors.borderHover }}>/</span>
                      <span>{p.quotaTotal.toLocaleString()}</span>
                      {p.errors > 0 && (
                        <span style={{ color: colors.error, marginLeft: 4 }}>{p.errors}err</span>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 7, color: colors.borderHover }}>| 75%</span>
            <span style={{ fontSize: 7, color: '#888' }}>| 90%</span>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '8px 20px', borderBottom: '1px solid #E0E0E0', background: colors.bg }}>
        {(['all', 'healthy', 'warning', 'rate_limited', 'exhausted', 'no_oauth'] as const).map(f => {
          const isActive = filter === f
          const tabColors: Record<string, string> = { all: '#888', healthy: colors.success, warning: colors.warning, rate_limited: colors.warning, exhausted: colors.error, no_oauth: colors.warning }
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                height: 24, paddingLeft: 10, paddingRight: 10,
                background: isActive ? colors.border : 'transparent',
                border: `1px solid ${isActive ? colors.borderHover : 'transparent'}`,
                borderRadius: 4, cursor: 'pointer', fontSize: 8, fontWeight: 700,
                color: isActive ? tabColors[f] : '#888',
                letterSpacing: '0.08em', transition: 'all 0.15s',
              }}
            >
              {f === 'no_oauth' ? 'NO OAUTH' : f === 'rate_limited' ? 'RATE LIMITED' : f.toUpperCase()} ({filterCounts[f]})
            </button>
          )
        })}
      </div>

      {/* Info row */}
      <div style={{ padding: '8px 20px', fontSize: 9, color: '#888', lineHeight: '15px', background: colors.bg, borderBottom: '1px solid #E0E0E0' }}>
        Mỗi project = OAuth + API Key = 10,000 units/ngày. Thêm project để tăng quota polling. Quota reset mỗi 24h (midnight PT).
      </div>

      {/* Project list */}
      <div style={{ padding: '14px 20px', background: colors.bg }}>
        {loading && projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 10, color: '#888' }}>Đang tải...</div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 10, color: colors.borderHover, marginBottom: 8 }}>
              {filter !== 'all' ? `Không có project ở trạng thái "${filter}"` : 'Chưa có project nào. Thêm Google Cloud project để bắt đầu.'}
            </div>
            {filter === 'all' && (
              <button
                onClick={() => setShowAdd(true)}
                style={{
                  height: 28, paddingLeft: 14, paddingRight: 14,
                  background: '#00B4FF22', border: '1px solid #00B4FF44', borderRadius: 4,
                  fontSize: 9, fontWeight: 700, color: colors.accent, cursor: 'pointer',
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
                    padding: '6px 10px', background: colors.bg, border: '1px solid #E0E0E0',
                    borderRadius: 4, marginBottom: collapsed ? 0 : 8,
                  }}>
                  <span style={{ fontSize: 10, color: collapsed ? '#888' : colors.accent, transition: 'all 0.15s' }}>{collapsed ? '▶' : '▼'}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: collapsed ? '#888' : '#888', letterSpacing: '0.06em', fontFamily: 'monospace' }}>{gmail}</span>
                  <span style={{ fontSize: 8, color: '#888' }}>({gHealthy}/{gTotal} healthy)</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 8, color: '#888' }}>{gprojects.length} projects</span>
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
    </div>
  )
}
