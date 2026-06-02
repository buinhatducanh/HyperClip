'use client'
import { colors } from '../../design-system/tokens'
import React, { useState, useEffect } from 'react'
import { useAppStore } from '../../lib/store'
import { ipc } from '../../lib/ipc'

function PathRow({ label, value, onChange, needsRestart }: { label: string; value: string; onChange: (v: string) => void; needsRestart?: boolean }) {
  const short = value.length > 50 ? '...' + value.slice(-47) : value
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>
          {label}
          {needsRestart && (
            <span style={{ marginLeft: 6, fontSize: 8, color: colors.warning, fontWeight: 700, letterSpacing: '0.06em' }}>RESTART</span>
          )}
        </div>
        <div style={{ fontSize: 9, color: colors.textTertiary, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>
          {short || '— not set —'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 12 }}>
        <button
          onClick={() => ipc.openFolder(value)}
          style={{ height: 28, paddingLeft: 8, paddingRight: 8, background: colors.surface, border: 'none', borderRadius: 3, fontSize: 9, fontWeight: 600, color: colors.text, cursor: 'pointer', transition: 'background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease' }}
          onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)' }}
          onMouseLeave={e => { e.currentTarget.style.background = colors.surface; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
        >OPEN</button>
        <button
          onClick={async () => {
            const result = await ipc.pickFolder(value)
            if (result) onChange(result.path)
          }}
          style={{ height: 28, paddingLeft: 8, paddingRight: 8, background: colors.surface, border: `1px solid ${colors.accent}44`, borderRadius: 3, fontSize: 9, fontWeight: 700, color: colors.accent, cursor: 'pointer', letterSpacing: '0.04em', transition: 'background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease' }}
          onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)' }}
          onMouseLeave={e => { e.currentTarget.style.background = colors.surface; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
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
            background: value === q ? colors.accent : colors.surface,
            border: `1px solid ${value === q ? colors.accent : colors.border}`,
            borderRadius: 3,
            fontSize: 10,
            fontWeight: value === q ? 700 : 400,
            color: value === q ? colors.text : colors.textSecondary,
            cursor: 'pointer',
            letterSpacing: '0.04em',
            transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease',
          }}
          onMouseEnter={e => { if (value !== q) { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.color = colors.text; e.currentTarget.style.transform = 'translateY(-1px)' } }}
          onMouseLeave={e => { e.currentTarget.style.background = colors.surface; e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.transform = 'translateY(0)' }}
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
  const on = onColor ?? colors.success
  const off = offColor ?? colors.textTertiary
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
        width: 16, height: 16, borderRadius: '50%', background: colors.text,
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

  const [quitOnClose, setQuitOnClose] = useState(true)
  const [autoDlEnabled, setAutoDlEnabled] = useState(true)
  const [dlQuality, setDlQuality] = useState(settings.autoDownloadQuality || '720')
  const [dlTrimLimit, setDlTrimLimit] = useState(settings.defaultTrimLimit ?? 10)
  const [trimIsFull, setTrimIsFull] = useState(settings.defaultTrimLimit === 'full')
  const [trimCustomValue, setTrimCustomValue] = useState('')
  const [trimInputError, setTrimInputError] = useState('')
  const [pollInterval, setPollInterval] = useState(5)
  const [renderQuality, setRenderQuality] = useState<1080 | 720>((settings.defaultQuality ?? 1080) as 1080 | 720)
  const [autoRenderEnabled, setAutoRenderEnabled] = useState(settings.autoRender ?? false)

  useEffect(() => { setAutoRenderEnabled(settings.autoRender ?? false) }, [settings.autoRender])

  const load = async () => {
    const [s, st] = await Promise.all([ipc.getStorageSize(), ipc.getSettings()])
    setStats(s)
    setCleanupDays(st.downloadsCleanupDays ?? 7)
    setCleanupEnabled(st.downloadsCleanupDays !== 0)
    if (st.renderedOutputPath) setArchivePath(st.renderedOutputPath)
    setAutoDlEnabled(st.autoDownloadEnabled ?? true)
    setDlQuality(st.autoDownloadQuality || '720')
    const loadedTrim = typeof st.defaultTrimLimit === 'number' ? st.defaultTrimLimit : 10
    setDlTrimLimit(loadedTrim)
    setTrimIsFull(st.defaultTrimLimit === 'full')
    setTrimCustomValue(typeof st.defaultTrimLimit === 'number' && ![5, 10, 15].includes(loadedTrim) ? String(loadedTrim) : '')
    setPollInterval(st.pollIntervalMs ? st.pollIntervalMs / 1000 : 5)
    setRenderQuality((st.defaultQuality ?? 1080) as 1080 | 720)
    setQuitOnClose((st as { quitOnClose?: boolean }).quitOnClose !== false)
    setAutoRenderEnabled((st as { autoRender?: boolean }).autoRender ?? false)
  }

  useEffect(() => { load() }, [])

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
    if (!raw) { setTrimInputError('Nhập số phút'); return }
    if (!/^\d+$/.test(raw)) { setTrimInputError('Phải là số nguyên dương'); return }
    const num = parseInt(raw, 10)
    if (num < 1) { setTrimInputError('Tối thiểu 1 phút'); return }
    if (num > 999) { setTrimInputError('Tối đa 999 phút'); return }
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
      {/* GENERAL */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: colors.textTertiary, letterSpacing: '0.1em', fontWeight: 700 }}>GENERAL</div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary }}>Tắt khi đóng</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>Nhấn X → tắt hẳn thay vì ẩn tray</div>
        </div>
        <ToggleSwitch value={quitOnClose} onChange={handleQuitOnCloseToggle} onColor={colors.success} offColor={colors.textTertiary} />
      </div>

      {/* PATHS */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: colors.textTertiary, letterSpacing: '0.1em', fontWeight: 700 }}>PATHS</div>
      <PathRow label="Downloads" value={stats.downloadPath} onChange={handleDownloadPathChange} needsRestart />
      <PathRow label="Output" value={stats.outputPath} onChange={handleOutputPathChange} needsRestart />
      <PathRow label="Archive" value={archivePath || '— default —'} onChange={handleArchivePathChange} />

      {isLowDisk && (
        <div style={{ margin: '8px 14px', padding: '8px 10px', background: `${colors.error}15`, border: `1px solid ${colors.error}44`, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: colors.error, fontWeight: 700 }}>LOW DISK</span>
          <span style={{ fontSize: 10, color: colors.error }}>{freeGB.toFixed(1)} GB free on downloads drive</span>
        </div>
      )}

      {/* AUTO-DOWNLOAD */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: colors.textTertiary, letterSpacing: '0.1em', fontWeight: 700, marginTop: 6 }}>AUTO-DOWNLOAD</div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <span style={{ fontSize: 11, color: colors.textSecondary }}>Auto-download</span>
        <ToggleSwitch value={autoDlEnabled} onChange={handleAutoDlToggle} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary }}>Download quality</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>Source resolution</div>
        </div>
        <QualityPicker value={dlQuality} options={['360', '480', '720', '1080']} onChange={handleQualityChange} label="p" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary }}>Trim limit</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>Max duration to download</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[5, 10, 15].map(limit => (
            <button
              key={limit}
              onClick={() => handleTrimLimitChange(limit)}
              style={{
                padding: '4px 10px',
                background: !trimIsFull && dlTrimLimit === limit && !trimCustomValue ? colors.accent : colors.surface,
                border: `1px solid ${!trimIsFull && dlTrimLimit === limit && !trimCustomValue ? colors.accent : colors.textTertiary}`,
                borderRadius: 3, fontSize: 10,
                fontWeight: !trimIsFull && dlTrimLimit === limit && !trimCustomValue ? 700 : 400,
                color: !trimIsFull && dlTrimLimit === limit && !trimCustomValue ? colors.text : colors.textSecondary,
                cursor: 'pointer', letterSpacing: '0.04em',
                transition: 'background 0.15s ease, color 0.15s ease, transform 0.1s ease',
              }}
              onMouseEnter={e => { if (!trimIsFull && dlTrimLimit !== limit || trimCustomValue) { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.color = colors.text; e.currentTarget.style.transform = 'translateY(-1px)' } }}
              onMouseLeave={e => { e.currentTarget.style.background = !trimIsFull && dlTrimLimit === limit && !trimCustomValue ? colors.accent : colors.surface; e.currentTarget.style.color = !trimIsFull && dlTrimLimit === limit && !trimCustomValue ? colors.text : colors.textSecondary; e.currentTarget.style.transform = 'translateY(0)' }}
            >
              {limit}m
            </button>
          ))}
          <button
            onClick={() => handleTrimLimitChange('full')}
            style={{
              padding: '4px 10px',
              background: trimIsFull ? colors.accent : colors.surface,
              border: `1px solid ${trimIsFull ? colors.accent : colors.textTertiary}`,
              borderRadius: 3, fontSize: 10,
              fontWeight: trimIsFull ? 700 : 400,
              color: trimIsFull ? colors.text : colors.textSecondary,
              cursor: 'pointer', letterSpacing: '0.04em',
              transition: 'background 0.15s ease, color 0.15s ease, transform 0.1s ease',
            }}
            onMouseEnter={e => { if (!trimIsFull) { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.color = colors.text; e.currentTarget.style.transform = 'translateY(-1px)' } }}
            onMouseLeave={e => { e.currentTarget.style.background = trimIsFull ? colors.accent : colors.surface; e.currentTarget.style.color = trimIsFull ? colors.text : colors.textSecondary; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            FULL
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary }}>Custom trim</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>Or enter your own (1–999 min)</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text" inputMode="numeric" value={trimCustomValue}
              onChange={e => { const cleaned = e.target.value.replace(/\D/g, '').slice(0, 3); setTrimCustomValue(cleaned); setTrimInputError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleTrimCustomSubmit() }}
              onBlur={() => { if (trimCustomValue.trim()) handleTrimCustomSubmit() }}
              placeholder="—"
              style={{ width: 48, height: 26, background: trimCustomValue ? `${colors.accent}18` : colors.bg, border: `1px solid ${trimInputError ? colors.error : trimCustomValue ? colors.accent : colors.border}`, borderRadius: 3, fontSize: 11, color: colors.text, fontFamily: 'monospace', textAlign: 'right', paddingRight: 22, outline: 'none', boxSizing: 'border-box' }}
            />
            {trimCustomValue && (
              <span style={{ position: 'absolute', right: 6, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 9, color: colors.textTertiary, pointerEvents: 'none' }}>m</span>
            )}
          </div>
          <button
            onClick={handleTrimCustomSubmit} disabled={!trimCustomValue}
            style={{
              height: 26, paddingLeft: 10, paddingRight: 10,
              background: trimCustomValue ? colors.accent : colors.bg,
              border: `1px solid ${trimCustomValue ? colors.accent : colors.border}`,
              borderRadius: 3, fontSize: 9, fontWeight: 700,
              color: trimCustomValue ? colors.text : colors.textTertiary,
              cursor: trimCustomValue ? 'pointer' : 'not-allowed',
              letterSpacing: '0.04em',
              transition: 'background 0.15s ease, transform 0.1s ease',
            }}
            onMouseEnter={e => { if (trimCustomValue) { e.currentTarget.style.background = colors.accentHover; e.currentTarget.style.transform = 'translateY(-1px)' } }}
            onMouseLeave={e => { e.currentTarget.style.background = trimCustomValue ? colors.accent : colors.bg; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            SET
          </button>
        </div>
      </div>

      {trimInputError && (
        <div style={{ padding: '4px 14px 4px', fontSize: 9, color: colors.error, textAlign: 'right' }}>
          {trimInputError}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary }}>Poll interval</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>Detection speed</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[5, 10, 30, 60].map(sec => (
            <button
              key={sec}
              onClick={() => handlePollIntervalChange(sec)}
              style={{
                padding: '4px 8px',
                background: pollInterval === sec ? colors.accent : colors.surface,
                border: `1px solid ${pollInterval === sec ? colors.accent : colors.textTertiary}`,
                borderRadius: 3, fontSize: 10,
                fontWeight: pollInterval === sec ? 700 : 400,
                color: pollInterval === sec ? colors.text : colors.textSecondary,
                cursor: 'pointer', letterSpacing: '0.04em',
                transition: 'background 0.15s ease, color 0.15s ease, transform 0.1s ease',
              }}
              onMouseEnter={e => { if (pollInterval !== sec) { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.color = colors.text; e.currentTarget.style.transform = 'translateY(-1px)' } }}
              onMouseLeave={e => { e.currentTarget.style.background = pollInterval === sec ? colors.accent : colors.surface; e.currentTarget.style.color = pollInterval === sec ? colors.text : colors.textSecondary; e.currentTarget.style.transform = 'translateY(0)' }}
            >
              {sec >= 60 ? '1m' : sec + 's'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary }}>Render quality</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>Default output resolution</div>
        </div>
        <QualityPicker value={String(renderQuality)} options={['720', '1080']} onChange={v => handleRenderQualityChange(Number(v) as 720 | 1080)} label="p" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary }}>Pipeline</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>1 video → tải → render → tiếp theo</div>
        </div>
        <div style={{ fontSize: 9, color: colors.textTertiary, fontFamily: 'monospace' }}>SEQUENTIAL</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary }}>Auto-render</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>Tự động render sau khi download</div>
        </div>
        <ToggleSwitch value={autoRenderEnabled} onChange={handleAutoRenderToggle} />
      </div>

      {/* CLEANUP */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: colors.textTertiary, letterSpacing: '0.1em', fontWeight: 700, marginTop: 6 }}>CLEANUP</div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary }}>Auto-delete old videos</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>Delete downloads older than N days</div>
        </div>
        <ToggleSwitch value={cleanupEnabled} onChange={handleCleanupToggle} />
      </div>

      {cleanupEnabled && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${colors.border}` }}>
          <span style={{ fontSize: 11, color: colors.textSecondary }}>Delete older than</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" min={1} max={365} value={cleanupDays}
              onChange={e => setCleanupDays(Number(e.target.value))}
              onBlur={e => handleCleanupDaysChange(Number(e.target.value))}
              onKeyDown={e => e.key === 'Enter' && handleCleanupDaysChange(Number((e.target as HTMLInputElement).value))}
              style={{ width: 44, height: 26, paddingLeft: 6, paddingRight: 4, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 3, fontSize: 11, color: colors.text, fontFamily: 'monospace', textAlign: 'right' }}
            />
            <span style={{ fontSize: 10, color: colors.textTertiary }}>days</span>
          </div>
        </div>
      )}

      {/* USAGE */}
      <div style={{ padding: '8px 14px 4px', fontSize: 9, color: colors.textTertiary, letterSpacing: '0.1em', fontWeight: 700, marginTop: 6 }}>USAGE</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <span style={{ fontSize: 11, color: colors.textSecondary }}>Total used</span>
        <span style={{ fontSize: 12, color: colors.text, fontFamily: 'monospace', fontWeight: 700 }}>
          {stats.total} <span style={{ fontSize: 9, color: colors.textTertiary }}>MB</span>
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>Downloads</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>{stats.downloads} MB</div>
        </div>
        <button
          onClick={handleClearDownloads} disabled={clearingDl || stats.downloads === 0}
          style={{
            height: 28, paddingLeft: 12, paddingRight: 12,
            background: clearingDl ? colors.bg : `${colors.error}15`,
            border: `1px solid ${colors.error}44`,
            borderRadius: 4, cursor: clearingDl || stats.downloads === 0 ? 'not-allowed' : 'pointer',
            fontSize: 9, fontWeight: 700, color: colors.error,
            opacity: stats.downloads === 0 ? 0.3 : 1, letterSpacing: '0.06em',
            transition: 'background 0.15s ease, transform 0.1s ease',
          }}
          onMouseEnter={e => { if (!clearingDl && stats.downloads > 0) { e.currentTarget.style.background = `${colors.error}25`; e.currentTarget.style.transform = 'translateY(-1px)' } }}
          onMouseLeave={e => { e.currentTarget.style.background = `${colors.error}15`; e.currentTarget.style.transform = 'translateY(0)' }}
        >
          {clearingDl ? 'CLEARING...' : 'CLEAR'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>Blur images</div>
          <div style={{ fontSize: 9, color: colors.textTertiary }}>{stats.blur} MB</div>
        </div>
        <button
          onClick={handleClearBlur} disabled={clearingBlr || stats.blur === 0}
          style={{
            height: 28, paddingLeft: 12, paddingRight: 12,
            background: clearingBlr ? colors.bg : `${colors.error}15`,
            border: `1px solid ${colors.error}44`,
            borderRadius: 4, cursor: clearingBlr || stats.blur === 0 ? 'not-allowed' : 'pointer',
            fontSize: 9, fontWeight: 700, color: colors.error,
            opacity: stats.blur === 0 ? 0.3 : 1, letterSpacing: '0.06em',
            transition: 'background 0.15s ease, transform 0.1s ease',
          }}
          onMouseEnter={e => { if (!clearingBlr && stats.blur > 0) { e.currentTarget.style.background = `${colors.error}25`; e.currentTarget.style.transform = 'translateY(-1px)' } }}
          onMouseLeave={e => { e.currentTarget.style.background = `${colors.error}15`; e.currentTarget.style.transform = 'translateY(0)' }}
        >
          {clearingBlr ? 'CLEARING...' : 'CLEAR'}
        </button>
      </div>
    </div>
  )
}
