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
import type { Project, ApiKeyStatus, SessionStatus } from '../types'

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

export function StorageWidget() {
  const [stats, setStats] = useState<{ downloads: number; blur: number; total: number; downloadPath: string; outputPath: string; freeBytes?: number }>({ downloads: 0, blur: 0, total: 0, downloadPath: '', outputPath: '', freeBytes: 0 })
  const [cleanupDays, setCleanupDays] = useState(7)
  const [cleanupEnabled, setCleanupEnabled] = useState(true)
  const [archivePath, setArchivePath] = useState('')
  const [clearingDl, setClearingDl] = useState(false)
  const [clearingBlr, setClearingBlr] = useState(false)
  const { showToast, settings, setSettings } = useAppStore()

  // App behavior state
  const [quitOnClose, setQuitOnClose] = useState(true)

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

  // Auto-render state
  const [autoRenderEnabled, setAutoRenderEnabled] = useState(settings.autoRender ?? false)
  const [titleTemplate, setTitleTemplate] = useState(settings.autoRenderTitleTemplate ?? '')

  // Load settings on change
  useEffect(() => { setAutoRenderEnabled(settings.autoRender ?? false) }, [settings.autoRender])
  useEffect(() => { setTitleTemplate(settings.autoRenderTitleTemplate ?? '') }, [settings.autoRenderTitleTemplate])

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

    // Sync app behavior
    setQuitOnClose((st as { quitOnClose?: boolean }).quitOnClose !== false)

    // Sync auto-render
    setAutoRenderEnabled((st as { autoRender?: boolean }).autoRender ?? false)
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

  const handleQuitOnCloseToggle = async (val: boolean) => {
    setQuitOnClose(val)
    await ipc.updateSettings({ quitOnClose: val })
    setSettings({ quitOnClose: val })
    showToast(val ? 'Đóng app sẽ tắt hẳn' : 'Đóng app sẽ ẩn xuống tray')
  }

  const handleAutoRenderToggle = async (val: boolean) => {
    setAutoRenderEnabled(val)
    await ipc.updateSettings({ autoRender: val })
    setSettings({ autoRender: val })
    showToast(val ? 'Auto-render ON — video sẽ tự render sau khi download' : 'Auto-render OFF — chỉ download, không render tự động')
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
      {/* ── GENERAL ─────────────────────────────────────── */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: '#333', letterSpacing: '0.1em', fontWeight: 700 }}>GENERAL</div>

      {/* Quit on close */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888' }}>Tắt khi đóng</div>
          <div style={{ fontSize: 9, color: '#444' }}>Nhấn X → tắt hẳn thay vì ẩn tray</div>
        </div>
        <ToggleSwitch
          value={quitOnClose}
          onChange={handleQuitOnCloseToggle}
          onColor="#00FF88"
          offColor="#333"
        />
      </div>

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

      {/* Auto-render toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #181818' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888' }}>Auto-render</div>
          <div style={{ fontSize: 9, color: '#444' }}>Tự động render sau khi download</div>
        </div>
        <ToggleSwitch value={autoRenderEnabled} onChange={handleAutoRenderToggle} />
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
