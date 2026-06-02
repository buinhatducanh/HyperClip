'use client'
import { colors } from '../../design-system/tokens'

import React, { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '../../lib/store'
import { HOURLY_EVENTS_MAX } from '../../lib/constants'
import {
  formatNextReset,
  formatTimeAgo,
  StatCard,
} from '../../lib/utils'
import { ipc } from '../../lib/ipc'
import type { Project, ApiKeyStatus } from '../types'

// ─── Project Card (enhanced with quota bar + TEST) ─────────────────────────────

const ProjectCard = React.memo(function ProjectCard({
  project, keys, events,
  onRefresh, onRemove, onTest,
}: {
  project: Project
  keys: ApiKeyStatus[]
  events: number[]
  onRefresh: () => void
  onRemove: () => void
  onTest: () => void
}) {
  const { showToast } = useAppStore()
  const [showRemove, setShowRemove] = useState(false)
  const [testing, setTesting] = useState(false)

  const keyData = keys.find(k => k.projectId === project.projectId)
  const sc: Record<string, string> = {
    healthy: colors.success, warning: colors.warning,
    rate_limited: colors.warning, error: colors.error,
    exhausted: colors.error, unauthorized: colors.error, no_oauth: colors.warning,
  }
  const statusColor = sc[project.status] || colors.textSecondary

  // OAuth label
  const oauthLabel = (() => {
    if (project.status === 'unauthorized') return '✗ Token lỗi'
    if (project.status === 'no_oauth') return '✗ Chưa authorize'
    if (project.status === 'exhausted') return '⚠ Quota OAuth hết'
    if (project.status === 'rate_limited') return `⚠ Rate limited (${project.errors} err)`
    if (project.status === 'warning') return `⚠ ${Math.round((project.usedToday / project.quotaTotal) * 100)}% quota`
    if (project.hasToken) return '✓ Authorized'
    return '✗ Chưa authorize'
  })()

  const oauthColor = (() => {
    if (project.status === 'exhausted' || project.status === 'unauthorized') return colors.error
    if (project.status === 'rate_limited' || project.status === 'warning') return colors.warning
    if (project.hasToken) return colors.success
    return colors.error
  })()

  // API key quota
  const apiKeyPct = keyData ? Math.min(Math.round((keyData.usedToday / keyData.quotaTotal) * 100), 100) : 0
  const apiKeyRemaining = keyData ? Math.max(0, keyData.quotaTotal - keyData.usedToday) : 0
  const apiKeyColor = keyData ? (
    keyData.status === 'exhausted' || keyData.status === 'unauthorized' ? colors.error :
    keyData.status === 'warning' ? colors.warning : colors.accent
  ) : colors.textSecondary

  const needsRepair = project.status === 'exhausted' || project.status === 'rate_limited'
    || project.status === 'unauthorized' || project.status === 'no_oauth'
    || project.status === 'warning' || keyData?.status === 'exhausted'
    || keyData?.status === 'unauthorized'

  const handleRepair = async () => {
    const result = await ipc.repairProject(project.projectId) as {
      success: boolean; error?: string; repaired?: boolean; refreshed?: boolean
    }
    if (result.success) {
      showToast(`✓ ${project.projectId}: đã repair / refresh`)
    } else {
      showToast(`⚠ ${project.projectId}: ${result.error}`)
    }
    onRefresh()
  }

  const handleTest = async () => {
    setTesting(true)
    const result = await ipc.testKey(project.apiKey || '')
    if (result.valid) {
      showToast(`Key ${project.projectId} hợp lệ ✓`)
    } else {
      showToast(`Key lỗi: ${result.error}`)
    }
    setTesting(false)
    onRefresh()
  }

  return (
    <div style={{
      background: project.status === 'exhausted' ? `${colors.error}11` : colors.bg,
      border: `1px solid ${project.status === 'exhausted' ? `${colors.error}44` : colors.border}`,
      borderRadius: 6, padding: '12px 14px',
      transition: 'border-color 0.3s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: statusColor,
            boxShadow: `0 0 4px ${statusColor}66`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary, fontFamily: 'monospace' }}>
            {project.projectId}
          </span>
          {project.status !== 'healthy' && (
            <div style={{
              padding: '1px 5px', borderRadius: 3, border: `1px solid ${statusColor}44`,
              background: statusColor + '14',
              fontSize: 8, fontWeight: 700, color: statusColor, letterSpacing: '0.06em',
            }}>
              {project.status.toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 8, color: colors.textSecondary }}>reset {formatNextReset(null)}</span>
          <button
            onClick={handleTest}
            disabled={testing || !project.apiKey}
            title="Test API key"
            style={{
              height: 20, paddingLeft: 8, paddingRight: 8,
              background: 'transparent', border: `1px solid ${colors.accent}33`,
              borderRadius: 3, fontSize: 8, fontWeight: 600,
              color: testing ? `${colors.accent}66` : colors.accent,
              cursor: testing || !project.apiKey ? 'default' : 'pointer',
              opacity: project.apiKey ? 1 : 0.4,
            }}
          >
            {testing ? '...' : 'TEST'}
          </button>
          <button
            onClick={() => setShowRemove(v => !v)}
            style={{
              height: 20, paddingLeft: 6, paddingRight: 6,
              background: 'transparent', border: `1px solid ${colors.borderHover}`,
              borderRadius: 3, fontSize: 8, color: colors.textSecondary, cursor: 'pointer',
            }}
          >✕</button>
        </div>
      </div>

      {/* OAuth + API Key status row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, background: colors.bg, border: `1px solid ${oauthColor}22`, borderRadius: 4, padding: '7px 10px' }}>
          <div style={{ fontSize: 7, color: colors.textSecondary, letterSpacing: '0.05em', fontWeight: 700, marginBottom: 3 }}>OAUTH</div>
          <div style={{ fontSize: 9, color: oauthColor }}>{oauthLabel}</div>
          <div style={{ fontSize: 7, color: colors.textSecondary, marginTop: 2 }}>
            {(project.usedToday / 1000).toFixed(1)}k / {(project.quotaTotal / 1000).toFixed(0)}k
          </div>
        </div>
        <div style={{ flex: 1, background: colors.bg, border: `1px solid ${apiKeyColor}22`, borderRadius: 4, padding: '7px 10px' }}>
          <div style={{ fontSize: 7, color: colors.textSecondary, letterSpacing: '0.05em', fontWeight: 700, marginBottom: 3 }}>API KEY</div>
          <div style={{ fontSize: 9, color: apiKeyColor }}>
            {project.apiKey ? `${project.apiKey.slice(0, 8)}…` : '✗ Không có key'}
          </div>
          {project.apiKey && (
            <div style={{ marginTop: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: colors.textSecondary, marginBottom: 2 }}>
                <span>{apiKeyRemaining.toLocaleString()} left</span>
                <span style={{ color: apiKeyColor }}>{apiKeyPct}%</span>
              </div>
              <div style={{ height: 4, background: colors.border, borderRadius: 2 }}>
                <div style={{
                  width: `${apiKeyPct}%`, height: '100%', background: apiKeyColor,
                  borderRadius: 2, transition: 'width 0.5s',
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6 }}>
        {needsRepair && (
          <button onClick={handleRepair} style={{
            flex: 1, height: 24, background: `${colors.error}22`, border: `1px solid ${colors.error}44`,
            borderRadius: 3, fontSize: 8, fontWeight: 600, color: colors.error, cursor: 'pointer',
          }}>🔧 REPAIR</button>
        )}
        {project.hasToken && (
          <button onClick={async () => {
            const r = await ipc.testToken(project.projectId)
            showToast(r.valid ? `Token OK ✓` : `Token lỗi: ${r.error}`)
            onRefresh()
          }} style={{
            flex: 1, height: 24, background: 'transparent', border: `1px solid ${colors.accent}33`,
            borderRadius: 3, fontSize: 8, fontWeight: 600, color: colors.accent, cursor: 'pointer',
          }}>TEST TOKEN</button>
        )}
        {showRemove && (
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            <button onClick={onRemove} style={{
              flex: 1, height: 24, background: colors.errorHover, border: 'none',
              borderRadius: 3, fontSize: 8, fontWeight: 700, color: colors.text, cursor: 'pointer',
            }}>Xóa</button>
            <button onClick={() => setShowRemove(false)} style={{
              height: 24, paddingLeft: 6, paddingRight: 6,
              background: 'transparent', border: `1px solid ${colors.textSecondary}`,
              borderRadius: 3, fontSize: 8, color: colors.textSecondary, cursor: 'pointer',
            }}>Hủy</button>
          </div>
        )}
      </div>
    </div>
  )
})

// ─── Add Project Form ───────────────────────────────────────────────────────────

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
        showToast(`Project ${projectId} đã thêm!`)
        onAdded()
      } else {
        setError(result.error || 'Lỗi không rõ')
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const row: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }
  const label: React.CSSProperties = { fontSize: 8, color: colors.textSecondary, letterSpacing: '0.05em', fontWeight: 600 }
  const input: React.CSSProperties = {
    width: '100%', height: 30, background: colors.bg, border: `1px solid ${colors.borderHover}`,
    borderRadius: 3, color: colors.textSecondary, fontSize: 10, paddingLeft: 8, outline: 'none',
    fontFamily: 'monospace', boxSizing: 'border-box' as const,
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8,
      padding: 20, display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSecondary, letterSpacing: '0.08em', marginBottom: 14 }}>
        THÊM GOOGLE PROJECT
      </div>
      <div style={row}>
        <div style={label}>PROJECT ID</div>
        <input autoFocus value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="proj-01" style={input} />
      </div>
      <div style={row}>
        <div style={label}>OAUTH CLIENT ID</div>
        <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="xxx.apps.googleusercontent.com" style={input} />
      </div>
      <div style={row}>
        <div style={label}>OAUTH CLIENT SECRET</div>
        <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="GOCSPX-..." style={input} />
      </div>
      <div style={{ ...row, marginBottom: 0 }}>
        <div style={label}>API KEY</div>
        <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIzaSy..." style={input} />
      </div>
      <div style={{ ...row, marginTop: 8 }}>
        <div style={label}>TÊN (TÙY CHỌN)</div>
        <input value={apiKeyName} onChange={e => setApiKeyName(e.target.value)} placeholder="Project 1" style={input} />
      </div>
      {error && <div style={{ fontSize: 9, color: colors.error, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="submit" disabled={loading} style={{
          flex: 1, height: 32, background: loading ? colors.accentHover : colors.accent,
          border: 'none', borderRadius: 4, fontSize: 9, fontWeight: 700, color: colors.text,
          cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
        }}>{loading ? '...' : 'THÊM PROJECT'}</button>
        <button type="button" onClick={onClose} style={{
          height: 32, paddingLeft: 14, paddingRight: 14,
          background: 'transparent', border: `1px solid ${colors.textSecondary}`, borderRadius: 4,
          fontSize: 9, color: colors.textSecondary, cursor: 'pointer',
        }}>HỦY</button>
      </div>
    </form>
  )
}

// ─── ProjectsSection ────────────────────────────────────────────────────────────

export function ProjectsSection() {
  const [projects, setProjects] = useState<Project[]>([])
  const [keys, setKeys] = useState<ApiKeyStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [testingAll, setTestingAll] = useState(false)
  const [filter, setFilter] = useState<'all' | 'healthy' | 'exhausted' | 'unauthorized' | 'no_oauth'>('all')
  const [groupByGmail, setGroupByGmail] = useState(true)
  const [collapsedGmail, setCollapsedGmail] = useState<Set<string>>(new Set())
  const { showToast } = useAppStore()

  const load = async () => {
    try {
      const [p, k] = await Promise.all([
        ipc.getProjectTokenStatuses() as Promise<Project[]>,
        ipc.getKeys() as Promise<ApiKeyStatus[]>,
      ])
      setProjects(p)
      setKeys(k)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  const handleSyncChannels = async () => {
    setSyncing(true)
    try {
      const result = await ipc.syncChannels()
      showToast(`Đã đồng bộ: +${result.added} kênh mới, -${result.removed} kênh đã xóa`)
    } catch (e: any) { showToast(`Lỗi sync: ${e.message}`) }
    finally { setSyncing(false) }
  }

  const handleBulkImportCSV = async () => {
    const input = window.prompt(
      'Paste CSV (projectId,apiKey,clientId,clientSecret,gmail,projectName):\n' +
      'project-001,AIza...,xxx,yyy,user@gmail.com,Project A'
    )
    if (!input?.trim()) return
    try {
      const lines = input.trim().split('\n')
      const h = lines[0].split(',').map(x => x.trim().toLowerCase())
      let ok = 0, err = 0
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',')
        const pid = c[h.indexOf('projectid')]?.trim()
        if (!pid) continue
        const r = await ipc.addProject({
          projectId: pid,
          clientId: c[h.indexOf('clientid')]?.trim() || '',
          clientSecret: c[h.indexOf('clientsecret')]?.trim() || '',
          apiKey: c[h.indexOf('apikey')]?.trim() || '',
          apiKeyName: c[h.indexOf('projectname')]?.trim() || pid,
        })
        r.success ? ok++ : err++
      }
      showToast(`Import: ${ok} OK, ${err} lỗi`)
      load()
    } catch (e: any) { showToast(`CSV error: ${e.message}`) }
  }

  const handleTestAll = async () => {
    setTestingAll(true)
    const result = await ipc.testAllKeys() as {
      results: Array<{ key: string; name: string; valid: boolean; error?: string }>
    }
    const valid = result.results.filter(r => r.valid).length
    const bad = result.results.length - valid
    showToast(bad > 0 ? `${valid} keys OK, ${bad} có vấn đề` : `Tất cả ${valid} keys đều OK ✓`)
    setTestingAll(false)
    load()
  }

  const handleResetAll = async () => {
    if (!confirm(`Reset quota for all ${projects.length} projects?`)) return
    for (const p of projects) {
      await ipc.resetProjectQuota(p.projectId)
    }
    showToast(`Đã reset ${projects.length} projects`)
    load()
  }

  // Stats
  const totalUsed = projects.reduce((s, p) => s + p.usedToday, 0)
  const totalQuota = projects.length * 9500
  const totalPct = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0
  const healthy = projects.filter(p => p.status === 'healthy').length
  const exhausted = projects.filter(p => p.status === 'exhausted').length
  const unauthorized = projects.filter(p => p.status === 'unauthorized').length
  const noOauth = projects.filter(p => p.status === 'no_oauth').length
  const rateLimited = projects.filter(p => p.status === 'rate_limited').length

  // Filter
  const filtered = filter === 'all' ? projects
    : filter === 'healthy' ? projects.filter(p => p.status === 'healthy')
    : filter === 'exhausted' ? projects.filter(p => p.status === 'exhausted')
    : filter === 'unauthorized' ? projects.filter(p => p.status === 'unauthorized')
    : projects.filter(p => p.status === 'no_oauth')

  // Group by Gmail
  const grouped: Record<string, Project[]> = {}
  for (const p of filtered) {
    const g = p.gmailAccount || 'no-gmail'
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(p)
  }
  const gmailGroups = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))

  const now = new Date()
  const refreshTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px', background: colors.bg,
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: colors.textSecondary, letterSpacing: '0.1em' }}>
            {projects.length >= 100 ? '200 PROJECTS' : 'PROJECTS'}
          </div>
          {projects.length > 0 && (
            <div style={{ fontSize: 8, color: colors.accent, background: `${colors.accent}11`, border: `1px solid ${colors.accent}22`, borderRadius: 3, padding: '1px 6px' }}>
              {totalPct}% quota used
            </div>
          )}
          <div style={{ width: 1, height: 12, background: colors.borderHover }} />
          <span style={{ fontSize: 8, color: colors.textSecondary }}>refresh {refreshTime}</span>
          {loading && <span style={{ fontSize: 8, color: colors.success + '44' }}>●</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={handleBulkImportCSV} style={{
            height: 24, paddingLeft: 8, paddingRight: 8,
            background: 'transparent', border: `1px solid ${colors.accent}33`, borderRadius: 4,
            fontSize: 8, fontWeight: 700, color: colors.accent, cursor: 'pointer',
          }}>CSV IMPORT</button>
          <button onClick={handleTestAll} disabled={testingAll} style={{
            height: 24, paddingLeft: 8, paddingRight: 8,
            background: testingAll ? colors.accent + '11' : 'transparent',
            border: `1px solid ${colors.accent}33`, borderRadius: 4,
            fontSize: 8, fontWeight: 700, color: testingAll ? `${colors.accent}88` : colors.accent,
            cursor: testingAll ? 'default' : 'pointer',
          }}>{testingAll ? '...' : '⚡ TEST ALL'}</button>
          <button onClick={handleResetAll} disabled={projects.length === 0} style={{
            height: 24, paddingLeft: 8, paddingRight: 8,
            background: 'transparent', border: `1px solid ${colors.error}22`, borderRadius: 4,
            fontSize: 8, fontWeight: 700, color: colors.error,
            cursor: projects.length === 0 ? 'not-allowed' : 'pointer',
            opacity: projects.length === 0 ? 0.4 : 1,
          }}>RESET ALL</button>
          <button onClick={handleSyncChannels} disabled={syncing} style={{
            height: 24, paddingLeft: 8, paddingRight: 8,
            background: 'transparent', border: `1px solid ${colors.success}44`, borderRadius: 4,
            fontSize: 8, fontWeight: 700, color: colors.success, cursor: syncing ? 'not-allowed' : 'pointer',
            opacity: syncing ? 0.5 : 1,
          }}>{syncing ? '...' : 'SYNC'}</button>
          <button onClick={() => setShowAdd(v => !v)} style={{
            height: 24, paddingLeft: 8, paddingRight: 8,
            background: showAdd ? `${colors.accent}22` : 'transparent',
            border: `1px solid ${showAdd ? `${colors.accent}66` : `${colors.accent}33`}`, borderRadius: 4,
            fontSize: 8, fontWeight: 700, color: colors.accent, cursor: 'pointer',
          }}>+ ADD</button>
          {projects.length > 0 && (
            <button onClick={() => setGroupByGmail(v => !v)} style={{
              height: 24, paddingLeft: 8, paddingRight: 8,
              background: groupByGmail ? `${colors.accent}22` : 'transparent',
              border: `1px solid ${groupByGmail ? `${colors.accent}44` : colors.textSecondary}`, borderRadius: 4,
              fontSize: 8, fontWeight: 700, color: groupByGmail ? colors.accent : colors.textSecondary,
              cursor: 'pointer',
            }}>GROUP: {groupByGmail ? 'GMAIL' : 'ALL'}</button>
          )}
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${colors.border}`, background: colors.bg }}>
          <AddProjectForm onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load() }} />
        </div>
      )}

      {/* Alert banner */}
      {(exhausted > 0 || noOauth > 0 || unauthorized > 0 || rateLimited > 0) && (
        <div style={{
          padding: '8px 20px', background: `${colors.error}11`, borderBottom: `1px solid ${colors.error}22`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.error, boxShadow: `0 0 6px ${colors.error}88` }} />
          <span style={{ fontSize: 9, color: colors.error, fontWeight: 700 }}>
            {[exhausted > 0 && `${exhausted} quota hết`, noOauth > 0 && `${noOauth} chưa authorize`, unauthorized > 0 && `${unauthorized} key lỗi`, rateLimited > 0 && `${rateLimited} rate limited`].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 20px', borderBottom: `1px solid ${colors.border}`, background: colors.bg, overflowX: 'auto' }}>
        <StatCard label="TOTAL" value={String(projects.length)} sub="projects" color={colors.textSecondary} />
        <StatCard label="HEALTHY" value={`${healthy}/${projects.length}`} sub="authorized" color={colors.success} />
        <StatCard label="EXHAUSTED" value={String(exhausted)} sub="needs reset" color={exhausted > 0 ? colors.error : colors.textSecondary} />
        <StatCard label="NO OAUTH" value={String(noOauth)} sub="not authorized" color={noOauth > 0 ? colors.warning : colors.textSecondary} />
        <StatCard label="OVERALL" value={`${totalPct}%`} sub={`${(totalUsed / 1000).toFixed(1)}k / ${(totalQuota / 1000).toFixed(0)}k`} color={totalPct > 80 ? colors.warning : colors.success} />
      </div>

      {/* Quota chart */}
      {projects.length > 0 && (
        <div style={{ padding: '10px 20px', background: colors.bg, borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: 7, color: colors.textTertiary, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6 }}>QUOTA PER PROJECT</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {projects.sort((a, b) => (b.usedToday ?? 0) - (a.usedToday ?? 0)).slice(0, 15).map(p => {
              const pct = p.quotaTotal > 0 ? Math.round((p.usedToday / p.quotaTotal) * 100) : 0
              const barColor = p.status === 'exhausted' ? colors.error : pct >= 90 ? colors.error : pct >= 75 ? colors.warning : pct > 0 ? colors.success : colors.borderHover
              return (
                <div key={p.projectId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    minWidth: 90, fontSize: 8, color: p.status === 'exhausted' ? colors.error : colors.textSecondary,
                    fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.projectId}
                  </div>
                  <div style={{ flex: 1, height: 8, background: colors.border, borderRadius: 2, position: 'relative' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 2, transition: 'width 0.5s' }} />
                    <div style={{ position: 'absolute', top: 0, left: '75%', width: 1, height: '100%', background: colors.textSecondary }} />
                    <div style={{ position: 'absolute', top: 0, left: '90%', width: 1, height: '100%', background: colors.textSecondary }} />
                  </div>
                  <div style={{ minWidth: 130, fontSize: 7, color: colors.textSecondary, fontFamily: 'monospace', textAlign: 'right' }}>
                    <span style={{ color: barColor }}>{p.usedToday.toLocaleString()}</span>
                    <span style={{ color: colors.borderHover }}>/</span>
                    <span>{p.quotaTotal.toLocaleString()}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '6px 20px', borderBottom: `1px solid ${colors.border}`, background: colors.bg }}>
        {(['all', 'healthy', 'exhausted', 'no_oauth', 'unauthorized'] as const).map(f => {
          const counts: Record<string, number> = { all: projects.length, healthy, exhausted, no_oauth: noOauth, unauthorized }
          const tabColors: Record<string, string> = { all: colors.textSecondary, healthy: colors.success, exhausted: colors.error, no_oauth: colors.warning, unauthorized: colors.error }
          const isActive = filter === f
          return (
            <button key={f} onClick={() => setFilter(f)} style={{
              height: 22, paddingLeft: 8, paddingRight: 8,
              background: isActive ? colors.border : 'transparent',
              border: `1px solid ${isActive ? colors.borderHover : 'transparent'}`,
              borderRadius: 4, cursor: 'pointer', fontSize: 7, fontWeight: 700,
              color: isActive ? tabColors[f] : colors.textSecondary,
              letterSpacing: '0.08em',
            }}>
              {f === 'no_oauth' ? 'NO OAUTH' : f.toUpperCase()} ({counts[f]})
            </button>
          )
        })}
      </div>

      {/* Project list */}
      <div style={{ padding: '12px 20px', background: colors.bg }}>
        {loading && projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', fontSize: 9, color: colors.textSecondary }}>Đang tải...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 9, color: colors.textSecondary, marginBottom: 8 }}>
              {filter !== 'all' ? `Không có project "${filter}"` : 'Chưa có project nào'}
            </div>
            {filter === 'all' && (
              <button onClick={() => setShowAdd(true)} style={{
                height: 26, paddingLeft: 14, paddingRight: 14,
                background: `${colors.accent}22`, border: `1px solid ${colors.accent}44`, borderRadius: 4,
                fontSize: 9, fontWeight: 700, color: colors.accent, cursor: 'pointer',
              }}>+ Thêm Project đầu tiên</button>
            )}
          </div>
        ) : groupByGmail && gmailGroups.length > 1 ? (
          gmailGroups.map(([gmail, gprojects]) => {
            const collapsed = collapsedGmail.has(gmail)
            return (
              <div key={gmail} style={{ marginBottom: 12 }}>
                <div onClick={() => setCollapsedGmail(prev => {
                  const n = new Set(prev)
                  n.has(gmail) ? n.delete(gmail) : n.add(gmail)
                  return n
                })} style={{
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  padding: '5px 8px', background: colors.bg, border: `1px solid ${colors.border}`,
                  borderRadius: 4, marginBottom: collapsed ? 0 : 6,
                }}>
                  <span style={{ fontSize: 8, color: collapsed ? colors.textSecondary : colors.accent }}>{collapsed ? '▶' : '▼'}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: colors.textSecondary, fontFamily: 'monospace' }}>{gmail}</span>
                  <span style={{ fontSize: 8, color: colors.textTertiary }}>({gprojects.filter(p => p.status === 'healthy').length}/{gprojects.length} healthy)</span>
                </div>
                {!collapsed && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8 }}>
                    {gprojects.map(p => (
                      <ProjectCard
                        key={p.projectId}
                        project={p}
                        keys={keys}
                        events={[]}
                        onRefresh={load}
                        onRemove={async () => { await ipc.removeProject(p.projectId); load() }}
                        onTest={async () => {}}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
            {filtered.map(p => (
              <ProjectCard
                key={p.projectId}
                project={p}
                keys={keys}
                events={[]}
                onRefresh={load}
                onRemove={async () => { await ipc.removeProject(p.projectId); load() }}
                onTest={async () => {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
