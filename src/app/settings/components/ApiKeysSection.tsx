'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '../../lib/store'
import {
  MAX_UNITS_PER_PROJECT,
  QUOTA_WARNING_PCT,
  QUOTA_BAR_WARN_PCT,
  QUOTA_BAR_EXHAUSTED_PCT,
  HOURLY_EVENTS_MAX,
  RESET_ANIMATION_MS,
} from '../../lib/constants'
import {
  formatNextReset,
  formatTimeAgo,
  UsageTimeline,
  StatCard,
} from '../../lib/utils'
import { ipc } from '../../lib/ipc'
import type { ApiKeyStatus } from '../types'

// ─── Key Card ───────────────────────────────────────────────────────────────────

const KeyCard = React.memo(function KeyCard({ k, events, onRemove, onReset, onTest, isActive }: {
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
  const color = sc[k.status] || '#888'
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

  const wasJustReset = k.lastReset && (Date.now() - k.lastReset) < RESET_ANIMATION_MS

  return (
    <div style={{
      background: wasJustReset ? '#00FF8808' : k.status === 'exhausted' ? '#FFF0F0' : k.status === 'unauthorized' ? '#FFF5EE' : '#F5F5F5',
      border: `1px solid ${wasJustReset ? '#00FF8833' : isActive ? '#00B4FF44' : k.status === 'exhausted' ? '#FF444444' : '#FFFFFF'}`,
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
            fontSize: 13, fontWeight: 700, color: '#888',
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
          <div style={{ fontSize: 8, color: '#AAA', fontFamily: 'monospace', marginTop: 2 }}>
            {k.projectId} · {k.key ? k.key.slice(0, 12) + '…' : '•'.repeat(12) + '…'}
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
        background: '#F0F0F0', border: '1px solid #E0E0E0',
        borderRadius: 6, padding: '10px 12px',
      }}>
        {/* Main quota bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color, fontFamily: 'monospace' }}>
              {remaining.toLocaleString()}
            </span>
            <span style={{ fontSize: 9, color: '#777' }}>remaining</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>
              {k.usedToday.toLocaleString()} used
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'monospace' }}>
              {pct}%
            </span>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{
          height: 14, background: '#E0E0E0', borderRadius: 3, overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%', background: color,
            borderRadius: 3, transition: 'width 0.5s',
            boxShadow: `0 0 8px ${color}44`,
          }} />
          <div style={{ position: 'absolute', top: 0, left: '75%', width: 1, height: '100%', background: '#D0D0D0' }} />
          <div style={{ position: 'absolute', top: 0, left: '90%', width: 1, height: '100%', background: '#888' }} />
        </div>
        {/* Sub info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 8, color: '#D0D0D0', fontFamily: 'monospace' }}>
            0 <span style={{ color: '#888' }}>|</span> {Math.round(MAX_UNITS_PER_PROJECT * 0.75).toLocaleString()} <span style={{ color: '#888' }}>|</span> {(MAX_UNITS_PER_PROJECT * 0.9).toLocaleString()} <span style={{ color: '#888' }}>|</span> 9,500
          </span>
          <span style={{ fontSize: 8, color: '#888', fontFamily: 'monospace' }}>
            10,000 units/day
          </span>
        </div>
      </div>

      {/* Usage timeline */}
      <div>
        <div style={{ fontSize: 8, color: '#D0D0D0', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 700 }}>USAGE TIMELINE (24H PT)</div>
        <UsageTimeline events={events} />
      </div>

      {/* Metadata row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {k.errors > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 8, color: '#FF6644' }}>⚠ {k.errors} errors</span>
          </div>
        )}
        <span style={{ fontSize: 8, color: '#AAA', fontFamily: 'monospace' }}>
          last used {formatTimeAgo(k.lastUsed)}
        </span>
        {k.lastReset && (
          <span style={{ fontSize: 8, color: '#00FF8877', fontFamily: 'monospace' }}>
            ↺ reset {formatTimeAgo(k.lastReset)}
          </span>
        )}
        <span style={{ fontSize: 8, color: '#D0D0D0', marginLeft: 'auto', fontFamily: 'monospace' }}>
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
          background: '#FFF0F0', border: '1px solid #FF444433',
          borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 9, color: '#FF6644', flex: 1 }}>
            Xóa key này? Không thể hoàn tác.
          </span>
          <button onClick={handleRemove} style={{ height: 24, paddingLeft: 10, paddingRight: 10, background: '#CC3333', border: 'none', borderRadius: 3, color: '#E0E0E0', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
            Xóa
          </button>
          <button onClick={() => setShowRemoveConfirm(false)} style={{ height: 24, paddingLeft: 10, paddingRight: 10, background: 'transparent', border: '1px solid #888', borderRadius: 3, color: '#777', fontSize: 9, cursor: 'pointer' }}>
            Hủy
          </button>
        </div>
      )}
    </div>
  )
})

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
      background: '#F0F0F0', border: '1px solid #E0E0E0',
      borderRadius: 8, padding: '16px',
    }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: '#888', letterSpacing: '0.12em', marginBottom: 12 }}>THÊM API KEY MỚI</div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          autoFocus value={newKey} onChange={e => setNewKey(e.target.value)}
          placeholder="AIzaSy..."
          style={{ width: '100%', height: 32, background: '#F5F5F5', border: '1px solid #D0D0D0', borderRadius: 4, paddingLeft: 10, fontSize: 11, color: '#888', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newProjectId} onChange={e => setNewProjectId(e.target.value)}
            placeholder="proj-01"
            style={{ flex: 1, height: 32, background: '#F5F5F5', border: '1px solid #D0D0D0', borderRadius: 4, paddingLeft: 10, fontSize: 10, color: '#888', outline: 'none', fontFamily: 'monospace' }}
          />
          <input
            value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
            placeholder="Tên key (tùy chọn)"
            style={{ flex: 2, height: 32, background: '#F5F5F5', border: '1px solid #D0D0D0', borderRadius: 4, paddingLeft: 10, fontSize: 10, color: '#888', outline: 'none' }}
          />
        </div>
        {addError && <div style={{ fontSize: 9, color: '#FF6644' }}>{addError}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={adding} style={{ flex: 1, height: 30, background: '#00B4FF', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#000', cursor: adding ? 'not-allowed' : 'pointer', opacity: adding ? 0.6 : 1 }}>
            {adding ? '...' : 'Thêm Key'}
          </button>
          <button type="button" onClick={onClose} style={{ height: 30, paddingLeft: 14, paddingRight: 14, background: 'transparent', border: '1px solid #D0D0D0', borderRadius: 4, fontSize: 10, color: '#777', cursor: 'pointer' }}>
            Hủy
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── ApiKeysSection ─────────────────────────────────────────────────────────────

export default function ApiKeysSection() {
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
            const newEvents = [...events, Date.now()].slice(-HOURLY_EVENTS_MAX)
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
  const totalQuota = keys.length * MAX_UNITS_PER_PROJECT
  const overallPct = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0
  const nextReset = keys[0]?.nextReset || null

  // Filter keys
  const dedupedKeys = useMemo(() => {
    const seen = new Set<string>()
    return keys.filter(k => {
      if (seen.has(k.key)) return false
      seen.add(k.key)
      return true
    })
  }, [keys])

  // Find the most recently used key (active key)
  const mostRecentTs = useMemo(() => Math.max(...dedupedKeys.map(k => k.lastUsed || 0), 0), [dedupedKeys])
  const isKeyActive = useMemo(() => (ts: number | null) => ts && mostRecentTs > 0 && (mostRecentTs - ts) < 30000, [mostRecentTs])

  const filteredKeys = useMemo(() =>
    filter === 'all' ? dedupedKeys
    : filter === 'healthy' ? dedupedKeys.filter(k => k.status === 'healthy')
    : filter === 'warning' ? dedupedKeys.filter(k => k.status === 'warning')
    : filter === 'exhausted' ? dedupedKeys.filter(k => k.status === 'exhausted')
    : dedupedKeys.filter(k => k.status === 'unauthorized')
  , [dedupedKeys, filter])

  const filterCounts = useMemo(() => ({
    all: dedupedKeys.length,
    healthy: dedupedKeys.filter(k => k.status === 'healthy').length,
    warning: dedupedKeys.filter(k => k.status === 'warning').length,
    exhausted: dedupedKeys.filter(k => k.status === 'exhausted').length,
    unauthorized: dedupedKeys.filter(k => k.status === 'unauthorized').length,
  }), [dedupedKeys])

  const now = new Date()
  const refreshTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Full-width header */}
      <div style={{
        padding: '14px 20px',
        background: '#F5F5F5',
        borderBottom: '1px solid #E0E0E0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#E0E0E0', letterSpacing: '0.1em' }}>API KEY MANAGEMENT</div>
          <div style={{ width: 1, height: 12, background: '#D0D0D0' }} />
          <span style={{ fontSize: 8, color: '#888' }}>last refresh {refreshTime}</span>
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
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E0E0E0', background: '#F0F0F0' }}>
          <AddKeyForm onClose={() => setShowAddForm(false)} onAdded={() => { setShowAddForm(false); load() }} />
        </div>
      )}

            {/* Exhausted / Unauthorized alert banner */}
      {(exhaustedKeys > 0 || unauthorizedKeys > 0) && (
        <div style={{
          padding: '10px 20px',
          background: '#FFF0F0',
          borderBottom: '1px solid #FFE0E0',
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
      <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid #E0E0E0', background: '#F0F0F0' }}>
        <StatCard
          label="TOTAL KEYS"
          value={String(totalKeys)}
          sub={`${totalKeys > 0 ? Math.round(totalUsed / totalKeys) : 0} units/key avg`}
          color="#888"
          icon={<div style={{ width: 6, height: 6, borderRadius: 1, background: '#888' }} />}
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
          color={warningKeys > 0 ? '#FFB800' : '#D0D0D0'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: warningKeys > 0 ? '#FFB800' : '#D0D0D0' }} />}
        />
        <StatCard
          label="EXHAUSTED"
          value={String(exhaustedKeys)}
          sub="needs reset"
          color={exhaustedKeys > 0 ? '#FF4444' : '#D0D0D0'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: exhaustedKeys > 0 ? '#FF4444' : '#D0D0D0' }} />}
        />
        <StatCard
          label="UNAUTHORIZED"
          value={String(unauthorizedKeys)}
          sub="invalid keys"
          color={unauthorizedKeys > 0 ? '#FF6644' : '#D0D0D0'}
          icon={<div style={{ width: 6, height: 6, borderRadius: '50%', background: unauthorizedKeys > 0 ? '#FF6644' : '#D0D0D0' }} />}
        />
        <StatCard
          label="NEXT RESET"
          value={formatNextReset(nextReset)}
          sub="midnight PT"
          color="#777"
          icon={
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="4" stroke="#888" strokeWidth="1" />
              <path d="M5 2 L5 5 L7 5" stroke="#888" strokeWidth="1" strokeLinecap="round" />
            </svg>
          }
        />
      </div>

      {/* Per-key quota distribution chart */}
      {dedupedKeys.length > 0 && useMemo(() => (
        <div style={{ padding: '12px 20px', background: '#F5F5F5', borderBottom: '1px solid #E0E0E0' }}>
          <div style={{ fontSize: 8, color: '#AAA', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>KEY QUOTA DISTRIBUTION</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {dedupedKeys
              .sort((a, b) => (b.usedToday ?? 0) - (a.usedToday ?? 0))
              .map(k => {
                const pct = k.quotaPercent
                const barColor = pct >= QUOTA_BAR_EXHAUSTED_PCT ? '#FF4444' : pct >= QUOTA_BAR_WARN_PCT ? '#FFB800' : pct > 0 ? '#00B4FF' : '#D0D0D0'
                const remaining = Math.max(0, k.quotaTotal - k.usedToday)
                const isRecent = isKeyActive(k.lastUsed)
                return (
                  <div key={k.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Key label */}
                    <div style={{
                      minWidth: 100, fontSize: 9, color: isRecent ? '#00B4FF' : '#777',
                      fontFamily: 'monospace', fontWeight: isRecent ? 700 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {isRecent && <span style={{ color: '#00B4FF', marginRight: 3 }}>●</span>}
                      {k.name}
                    </div>
                    {/* Used bar */}
                    <div style={{ flex: 1, height: 12, background: '#E0E0E0', borderRadius: 2, position: 'relative' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', background: barColor,
                        borderRadius: 2, transition: 'width 0.5s',
                        boxShadow: pct > 0 ? `0 0 4px ${barColor}44` : 'none',
                      }} />
                      {/* 75% and 90% markers */}
                      <div style={{ position: 'absolute', top: 0, left: '75%', width: 1, height: '100%', background: '#888' }} />
                      <div style={{ position: 'absolute', top: 0, left: '90%', width: 1, height: '100%', background: '#777' }} />
                    </div>
                    {/* Stats */}
                    <div style={{ minWidth: 140, fontSize: 8, color: '#888', fontFamily: 'monospace', textAlign: 'right' }}>
                      <span style={{ color: barColor }}>{k.usedToday.toLocaleString()}</span>
                      <span style={{ color: '#D0D0D0' }}>/</span>
                      <span>{k.quotaTotal.toLocaleString()}</span>
                      <span style={{ color: '#D0D0D0', marginLeft: 4 }}>{remaining.toLocaleString()} left</span>
                    </div>
                  </div>
                )
              })}
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 7, color: '#888' }}>● ACTIVE = used in last 30s</span>
            <span style={{ fontSize: 7, color: '#D0D0D0' }}>| 75%</span>
            <span style={{ fontSize: 7, color: '#888' }}>| 90%</span>
          </div>
        </div>
      ), [dedupedKeys, isKeyActive])}

            {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '8px 20px', borderBottom: '1px solid #E0E0E0', background: '#F0F0F0' }}>
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
                background: isActive ? '#E0E0E0' : 'transparent',
                border: `1px solid ${isActive ? '#D0D0D0' : 'transparent'}`,
                borderRadius: 4, cursor: 'pointer', fontSize: 8, fontWeight: 700,
                color: isActive ? tabColors[f] : '#888',
                letterSpacing: '0.08em', transition: 'all 0.15s',
              }}
            >
              {f.toUpperCase()} ({count})
            </button>
          )
        })}
      </div>

      {/* Keys grid */}
      <div style={{ padding: '14px 20px', background: '#F0F0F0' }}>
        {loading && keys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 10, color: '#888' }}>Đang tải...</div>
          </div>
        ) : filteredKeys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 10, color: '#D0D0D0', marginBottom: 8 }}>
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
