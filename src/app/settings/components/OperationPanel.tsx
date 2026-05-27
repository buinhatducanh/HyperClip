'use client'
import { colors, spacing, fontSize } from '../../design-system/tokens'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../../lib/store'
import { ipc } from '../../lib/ipc'

export function OperationPanel() {
  const { settings, systemStats, setSettings, showToast } = useAppStore()

  // ─── State ───────────────────────────────────────────────────────────────────
  const [channels, setChannels] = useState<any[]>([])
  const [channelSearch, setChannelSearch] = useState('')
  const [bulkImportText, setBulkImportText] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkResults, setBulkResults] = useState<Array<{ url: string; success: boolean; error?: string }>>([])
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)

  // System data
  const [sessionStatus, setSessionStatus] = useState<any>(null)
  const [projectStatus, setProjectStatus] = useState<any[]>([])
  const [pollerStatus, setPollerStatus] = useState<any>(null)
  const [opLogs, setOpLogs] = useState<any[]>([])
  const [logsAutoScroll, setLogsAutoScroll] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Proxy
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

  // Filters
  const [durationMode, setDurationMode] = useState<'all' | 'short' | 'long'>('all')
  const [maxDurationMin, setMaxDurationMin] = useState(settings.videoMaxDurationSec ? Math.round(settings.videoMaxDurationSec / 60) : 0)

  // ─── Load data ────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [ch, ss, ps, ps2, logs] = await Promise.all([
        ipc.getChannels(),
        ipc.getSessionStatus(),
        ipc.getProjects(),
        ipc.getPollerStatus(),
        ipc.getOpLogs(),
      ])
      setChannels(Array.isArray(ch) ? ch : [])
      setSessionStatus(ss)
      setProjectStatus(Array.isArray(ps) ? ps : [])
      setPollerStatus(ps2)
      setOpLogs(Array.isArray(logs) ? logs : [])
    } catch {}
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const cleanup = ipc.onOpLogs((entries: any) => setOpLogs(Array.isArray(entries) ? entries : []))
    return cleanup
  }, [])

  useEffect(() => {
    if (logsAutoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [opLogs, logsAutoScroll])

  useEffect(() => {
    const t = setInterval(loadAll, 5000)
    return () => clearInterval(t)
  }, [loadAll])

  // ─── Handlers ────────────────────────────────────────────────────────────────
  const handleBulkImport = async () => {
    const urls = bulkImportText.split('\n').map(u => u.trim()).filter(Boolean)
    if (!urls.length) return
    setBulkImporting(true)
    setBulkResults([])
    try {
      const raw = await ipc.bulkAddChannels(urls)
      const results = Array.isArray(raw) ? raw : []
      setBulkResults(results)
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
    try { await ipc.syncChannels() } catch {}
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
    await ipc.resumePoller()
    await new Promise(r => setTimeout(r, 500))
    await loadAll()
    showToast('Poller đã bắt đầu')
  }

  const handleStopPoller = async () => {
    await ipc.pausePoller()
    await new Promise(r => setTimeout(r, 500))
    await loadAll()
    showToast('Poller đã dừng')
  }

  const handleClearLogs = async () => {
    await ipc.clearOpLogs()
    setOpLogs([])
  }

  // ─── Derived state ────────────────────────────────────────────────────────────
  const consentedCount = sessionStatus?.consentedCount ?? 0
  const totalSessions = sessionStatus?.sessionCount ?? 0
  const healthyProjects = (projectStatus as any[])?.filter((p: any) => p.status === 'healthy').length ?? 0
  const totalProjects = (projectStatus as any[])?.length ?? 0
  const totalQuotaRemaining = (projectStatus as any[])?.reduce((sum: number, p: any) => {
    if (p.status === 'exhausted' || p.status === 'unauthorized') return sum
    return sum + Math.max(0, 9500 - (p.usedToday ?? 0))
  }, 0) ?? 0
  const gpuName = systemStats?.gpuName ?? '—'
  const ramUsed = systemStats?.ramUsed ?? 0
  const ramTotal = systemStats?.ramTotal ?? 0
  const ramPct = ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 100) : 0

  const filteredChannels = channels.filter(ch =>
    (ch.name || '').toLowerCase().includes(channelSearch.toLowerCase()) ||
    (ch.id || '').toLowerCase().includes(channelSearch.toLowerCase())
  )

  // Poller badge
  const pollerBadge = (() => {
    if (!pollerStatus?.active) return { label: 'TẠM DỪNG', color: colors.warning, bg: '#FFB80011', border: '#FFB80044' }
    if (pollerStatus.exhaustedUntil && pollerStatus.exhaustedUntil > Date.now()) return { label: 'CHỜ BACKOFF', color: '#FF6644', bg: '#FF664411', border: '#FF664444' }
    return { label: 'ĐANG QUÉT', color: colors.success, bg: '#00FF8811', border: '#00FF8844' }
  })()

  // Innertube status
  const innertubeStatus = (() => {
    if (consentedCount === 0) return { label: 'OFFLINE', color: colors.error }
    if (consentedCount < totalSessions * 0.5) return { label: 'DEGRADED', color: colors.warning }
    return { label: 'HOẠT ĐỘNG', color: colors.success }
  })()

  // ─── Styles ────────────────────────────────────────────────────────────────────
  const s = {
    card: { background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 8, padding: '14px 16px', marginBottom: 12 },
    label: { fontSize: 9, fontWeight: 800, color: '#888', letterSpacing: '0.1em', marginBottom: 10, display: 'block' },
    input: {
      width: '100%', height: 30, background: colors.bg, border: '1px solid #D0D0D0',
      borderRadius: 4, color: '#888', fontSize: 10, paddingLeft: 10, outline: 'none',
      boxSizing: 'border-box' as const,
    },
    btn: (color: string, bg: string, border: string) => ({
      height: 28, paddingLeft: 14, paddingRight: 14,
      background: bg, border: `1px solid ${border}`, borderRadius: 4,
      fontSize: 9, fontWeight: 800, color, cursor: 'pointer',
    }),
  }

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── HEADER ──────────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 8,
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: colors.border, letterSpacing: '0.08em' }}>OPERATION CENTER</div>
          <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>HyperClip MMO — RTX 5080 Edition</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            padding: '4px 12px', borderRadius: 4,
            background: pollerBadge.bg, border: `1px solid ${pollerBadge.border}`,
            fontSize: 9, fontWeight: 800, color: pollerBadge.color, letterSpacing: '0.08em',
          }}>
            ● {pollerBadge.label}
          </div>
          <button onClick={handleStartPoller} disabled={!!pollerStatus?.active}
            style={{ ...s.btn(colors.success, '#00FF8811', '#00FF8844'), opacity: pollerStatus?.active ? 0.4 : 1 }}>
            ▶ BẮT ĐẦU
          </button>
          <button onClick={handleStopPoller} disabled={!pollerStatus?.active}
            style={{ ...s.btn(colors.error, '#FF444411', '#FF444444'), opacity: !pollerStatus?.active ? 0.4 : 1 }}>
            ■ DỪNG
          </button>
        </div>
      </div>

      {/* ── SYSTEM STATUS STRIP ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10,
        padding: '12px 16px', background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 8,
      }}>
        {/* Channels */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.accent, lineHeight: 1 }}>{channels.length}</div>
          <div style={{ fontSize: 8, color: '#888', letterSpacing: '0.08em', marginTop: 4 }}>KÊNH ĐANG QUÉT</div>
        </div>
        {/* Sessions — explanation: sessions = Chrome browsers scanning channels */}
        <div style={{ textAlign: 'center' }} title={`${totalSessions} Chrome browsers — dùng để quét YouTube cho tất cả channels`}>
          <div style={{ fontSize: 20, fontWeight: 800, color: consentedCount > 0 ? colors.success : colors.error, lineHeight: 1 }}>
            {consentedCount}/{totalSessions}
          </div>
          <div style={{ fontSize: 8, color: '#888', letterSpacing: '0.08em', marginTop: 4 }}>SESSION ⚡ CHANNEL</div>
        </div>
        {/* Innertube */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: innertubeStatus.color, lineHeight: 1 }}>
            {innertubeStatus.label}
          </div>
          <div style={{ fontSize: 8, color: '#888', letterSpacing: '0.08em', marginTop: 4 }}>INNERTUBE API</div>
        </div>
        {/* OAuth */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: healthyProjects > 0 ? colors.success : '#888', lineHeight: 1 }}>
            {healthyProjects}/{totalProjects}
          </div>
          <div style={{ fontSize: 8, color: '#888', letterSpacing: '0.08em', marginTop: 4 }}>OAUTH PROJECTS</div>
        </div>
        {/* GPU */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: colors.success, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {gpuName.replace('NVIDIA ', '').replace('GeForce ', '').replace('RTX ', 'RTX ')}
          </div>
          <div style={{ fontSize: 8, color: '#888', letterSpacing: '0.08em', marginTop: 4 }}>GPU</div>
        </div>
        {/* RAM */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: ramPct > 80 ? '#FF6644' : ramPct > 60 ? colors.warning : colors.success, lineHeight: 1 }}>
            {ramPct}%
          </div>
          <div style={{ fontSize: 8, color: '#888', letterSpacing: '0.08em', marginTop: 4 }}>RAM</div>
        </div>
      </div>

      {/* ── MAIN GRID ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start', flex: 1, minHeight: 0 }}>

        {/* ── LEFT ───────────────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Channel Manager */}
          {/* Sessions ↔ Channels explanation */}
          <div style={{
            padding: '8px 12px', background: colors.bg, border: '1px solid #E0E0E0',
            borderRadius: 6, fontSize: 8, color: '#888', lineHeight: '14px',
          }}>
            <span style={{ color: colors.accent }}>⚡</span>{' '}
            <span style={{ color: '#888' }}>
              <b style={{ color: '#888' }}>Sessions</b> = Chrome browsers để quét YouTube.{' '}
              {totalSessions > 0
                ? `${consentedCount}/${totalSessions} sẵn sàng`
                : 'Chưa có sessions'}
              {' — tự động dựa trên RAM.'}
            </span>{' '}
            <span style={{ color: '#888' }}>
              <b style={{ color: '#888' }}>Channels</b> = kênh YouTube cần theo dõi.{' '}
              {channels.length > 0
                ? `${channels.length} kênh đang quét`
                : 'Chưa có kênh nào'}.
            </span>{' '}
            <span style={{ color: '#888' }}>
              Nhiều channels → dùng chung sessions, không cần thêm sessions.
            </span>
          </div>
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#777', letterSpacing: '0.1em' }}>QUẢN LÝ KÊNH</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={handleRefreshChannels} style={{
                  fontSize: 8, background: 'transparent', border: '1px solid #D0D0D0', borderRadius: 3,
                  color: '#777', cursor: 'pointer', padding: '2px 8px',
                }}>⟳ Sync</button>
                <button onClick={() => setSelectedChannelId(null)} style={{
                  fontSize: 8, background: 'transparent', border: '1px solid #D0D0D0', borderRadius: 3,
                  color: '#777', cursor: 'pointer', padding: '2px 8px',
                }}>↺ Reset</button>
              </div>
            </div>

            {/* Search */}
            <input value={channelSearch} onChange={e => setChannelSearch(e.target.value)}
              placeholder="Tìm kênh..." style={{ ...s.input, marginBottom: 8 }} />

            {/* Channel list */}
            <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 8 }}>
              {filteredChannels.length === 0 ? (
                <div style={{ fontSize: 9, color: colors.borderHover, textAlign: 'center', padding: '20px 0' }}>
                  Chưa có kênh nào.
                </div>
              ) : filteredChannels.map(ch => (
                <div key={ch.id} onClick={() => setSelectedChannelId(selectedChannelId === ch.id ? null : ch.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                  background: selectedChannelId === ch.id ? '#00B4FF0a' : 'transparent',
                  borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${selectedChannelId === ch.id ? '#00B4FF22' : 'transparent'}`,
                  marginBottom: 2,
                }}>
                  {/* Avatar dot */}
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: ch.avatarColor || colors.accent,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800, color: '#000',
                    flexShrink: 0,
                  }}>
                    {(ch.name || '?')[0].toUpperCase()}
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {ch.name || ch.handle || ch.id}
                    </div>
                    {ch.handle && (
                      <div style={{ fontSize: 8, color: '#888' }}>@{ch.handle}</div>
                    )}
                  </div>
                  {/* Delete */}
                  {selectedChannelId === ch.id && (
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteChannel(ch.id) }} style={{
                      fontSize: 8, background: '#FF444411', border: '1px solid #FF444444',
                      borderRadius: 3, color: colors.error, cursor: 'pointer', padding: '2px 8px',
                    }}>✕ Xóa</button>
                  )}
                </div>
              ))}
            </div>

            {/* Bulk import */}
            <div style={{ fontSize: 8, color: '#888', marginBottom: 4 }}>NHẬP HÀNG LOẠT (mỗi dòng 1 link)</div>
            <textarea value={bulkImportText} onChange={e => setBulkImportText(e.target.value)}
              placeholder="https://www.youtube.com/@channel1&#10;https://www.youtube.com/@channel2"
              style={{
                width: '100%', height: 56, background: colors.bg, border: '1px solid #D0D0D0',
                borderRadius: 4, color: '#888', fontSize: 9, padding: '6px 10px',
                resize: 'vertical', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' as const,
              }} />
            <button onClick={handleBulkImport} disabled={bulkImporting || !bulkImportText.trim()} style={{
              width: '100%', height: 28, marginTop: 6,
              background: bulkImporting ? '#F0FFF0' : '#00FF8811',
              border: '1px solid #00FF8844', borderRadius: 4,
              fontSize: 9, fontWeight: 800, color: colors.success, cursor: 'pointer',
              opacity: (bulkImporting || !bulkImportText.trim()) ? 0.4 : 1,
            }}>
              {bulkImporting ? 'ĐANG THÊM...' : `THÊM ${bulkImportText.split('\n').filter(Boolean).length} KÊNH`}
            </button>

            {/* Bulk results */}
            {bulkResults.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 8 }}>
                {bulkResults.map((r, i) => (
                  <div key={i} style={{ color: r.success ? colors.success : colors.error, padding: '1px 0', display: 'flex', gap: 4 }}>
                    <span>{r.success ? '✓' : '✗'}</span>
                    <span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</span>
                    {r.error && <span style={{ color: colors.error }}>— {r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Scan Parameters */}
          <div style={s.card}>
            <span style={s.label}>THÔNG SỐ QUÉT</span>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#888', marginBottom: 4 }}>KHOẢNG CÁCH QUÉT</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[5, 10, 30, 60].map(sec => (
                  <button key={sec} onClick={() => setPollInterval(sec)} style={{
                    flex: 1, height: 26,
                    background: pollInterval === sec ? '#00B4FF18' : 'transparent',
                    border: `1px solid ${pollInterval === sec ? colors.accent : colors.borderHover}`,
                    borderRadius: 4, fontSize: 10, fontWeight: 700,
                    color: pollInterval === sec ? colors.accent : '#888',
                    cursor: 'pointer',
                  }}>{sec}s</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#888', marginBottom: 4 }}>LUỒNG TẢI ĐỒNG THỜI</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4].map(n => (
                  <button key={n} onClick={() => setMaxConcurrentDl(n)} style={{
                    flex: 1, height: 26,
                    background: maxConcurrentDl === n ? '#00FF8818' : 'transparent',
                    border: `1px solid ${maxConcurrentDl === n ? colors.success : colors.borderHover}`,
                    borderRadius: 4, fontSize: 10, fontWeight: 700,
                    color: maxConcurrentDl === n ? colors.success : '#888',
                    cursor: 'pointer',
                  }}>{n}</button>
                ))}
              </div>
            </div>
            <button onClick={handleSaveScanParams} style={{
              width: '100%', height: 28,
              background: '#00FF8811', border: '1px solid #00FF8844',
              borderRadius: 4, fontSize: 9, fontWeight: 800, color: colors.success, cursor: 'pointer',
            }}>LƯU THÔNG SỐ</button>
          </div>

          {/* Proxy */}
          <div style={s.card}>
            <span style={s.label}>PROXY</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <button onClick={() => {
                const next = !proxyEnabled
                setProxyEnabled(next)
                setSettings({ proxyEnabled: next })
                ipc.updateSettings({ proxyEnabled: next })
              }} style={{
                width: 36, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer',
                background: proxyEnabled ? colors.success : '#888',
                transition: 'background 0.2s', position: 'relative', flexShrink: 0,
              }}>
                <div style={{
                  position: 'absolute', top: 1, left: proxyEnabled ? 18 : 1,
                  width: 16, height: 16, borderRadius: '50%', background: colors.border,
                  transition: 'left 0.2s',
                }} />
              </button>
              <span style={{ fontSize: 9, color: '#888' }}>Bật Proxy</span>
              {proxyStatus === 'ok' && <span style={{ fontSize: 8, color: colors.success, marginLeft: 'auto' }}>● Kết nối</span>}
              {proxyStatus === 'fail' && <span style={{ fontSize: 8, color: colors.error, marginLeft: 'auto' }}>● Thất bại</span>}
              {proxyStatus === 'testing' && <span style={{ fontSize: 8, color: colors.warning, marginLeft: 'auto' }}>● Đang kiểm tra...</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <div style={{ flex: 2 }}>
                <div style={{ fontSize: 8, color: '#888', marginBottom: 3 }}>HOST</div>
                <input value={proxyHost} onChange={e => setProxyHost(e.target.value)} placeholder="proxy.example.com" style={s.input} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 8, color: '#888', marginBottom: 3 }}>PORT</div>
                <input type="number" value={proxyPort} onChange={e => setProxyPort(Number(e.target.value))} placeholder="8080" style={s.input} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 8, color: '#888', marginBottom: 3 }}>USER</div>
                <input value={proxyUser} onChange={e => setProxyUser(e.target.value)} placeholder="user" style={s.input} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 8, color: '#888', marginBottom: 3 }}>PASS</div>
                <input type="password" value={proxyPass} onChange={e => setProxyPass(e.target.value)} placeholder="••••" style={s.input} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleProxyTest} disabled={proxyTesting} style={{
                flex: 1, height: 26, background: '#FFB80011', border: '1px solid #FFB80044',
                borderRadius: 4, fontSize: 9, fontWeight: 700, color: colors.warning, cursor: 'pointer',
                opacity: proxyTesting ? 0.5 : 1,
              }}>{proxyTesting ? 'TESTING...' : 'TEST'}</button>
              <button onClick={handleSaveProxySettings} style={{
                flex: 1, height: 26, background: '#00FF8811', border: '1px solid #00FF8844',
                borderRadius: 4, fontSize: 9, fontWeight: 700, color: colors.success, cursor: 'pointer',
              }}>LƯU</button>
            </div>
          </div>
        </div>

        {/* ── RIGHT ─────────────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Live Logs — Simplified for non-tech users */}
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#777', letterSpacing: '0.1em' }}>NHẬT KÝ HOẠT ĐỘNG</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={handleClearLogs} style={{
                  fontSize: 8, background: 'transparent', border: '1px solid #D0D0D0', borderRadius: 3,
                  color: '#888', cursor: 'pointer', padding: '2px 8px',
                }}>Xóa</button>
                <button onClick={() => setLogsAutoScroll(v => !v)} style={{
                  fontSize: 8, background: logsAutoScroll ? '#00B4FF15' : 'transparent',
                  border: `1px solid ${logsAutoScroll ? '#00B4FF44' : colors.borderHover}`,
                  borderRadius: 3, color: logsAutoScroll ? colors.accent : '#888',
                  cursor: 'pointer', padding: '2px 8px',
                }}>Auto {logsAutoScroll ? 'ON' : 'OFF'}</button>
              </div>
            </div>
            <div style={{
              maxHeight: 320, overflowY: 'auto',
              background: colors.bg, border: '1px solid #E0E0E0',
              borderRadius: 6, padding: '8px 10px',
            }}>
              {opLogs.length === 0 ? (
                <div style={{ fontSize: 9, color: colors.borderHover, textAlign: 'center', padding: '24px 0' }}>
                  Chưa có hoạt động. Poller đang quét sẽ hiển thị tại đây.
                </div>
              ) : opLogs.map(entry => {
                const dotColor = entry.level === 'error' ? colors.error
                  : entry.level === 'warn' ? colors.warning
                  : entry.level === 'success' ? colors.success
                  : '#777'
                const msgColor = entry.level === 'error' ? '#FF8888'
                  : entry.level === 'warn' ? '#FFD080'
                  : entry.level === 'success' ? '#88FFBB'
                  : '#888'
                const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })
                return (
                  <div key={entry.id} style={{
                    display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5, lineHeight: 1.4,
                  }}>
                    <span style={{ fontSize: 8, color: colors.borderHover, fontFamily: 'monospace', flexShrink: 0 }}>{time}</span>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 9, color: msgColor }}>{entry.message}</span>
                  </div>
                )
              })}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Video Filters */}
          <div style={s.card}>
            <span style={s.label}>BỘ LỌC VIDEO</span>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#888', marginBottom: 4 }}>THỜI LƯỢNG</div>
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
                    flex: 1, height: 26,
                    background: durationMode === val ? '#00B4FF18' : 'transparent',
                    border: `1px solid ${durationMode === val ? colors.accent : colors.borderHover}`,
                    borderRadius: 4, fontSize: 9, fontWeight: 700,
                    color: durationMode === val ? colors.accent : '#888',
                    cursor: 'pointer',
                  }}>{label}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#888', marginBottom: 4 }}>GIỚI HẠN TỐI ĐA (PHÚT) — 0 = không giới hạn</div>
              <input type="number" min={0} value={maxDurationMin}
                onChange={e => setMaxDurationMin(Number(e.target.value))} style={s.input} />
            </div>
            <button onClick={handleSaveVideoFilters} style={{
              width: '100%', height: 28,
              background: '#00FF8811', border: '1px solid #00FF8844',
              borderRadius: 4, fontSize: 9, fontWeight: 800, color: colors.success, cursor: 'pointer',
            }}>ÁP DỤNG BỘ LỌC</button>
          </div>

          {/* Session Detail */}
          {sessionStatus?.sessions && sessionStatus.sessions.length > 0 && (
            <div style={s.card}>
              <span style={s.label}>SESSIONS ({consentedCount}/{totalSessions} SẴN SÀNG)</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sessionStatus.sessions.slice(0, 6).map((sess: any) => (
                  <div key={sess.profileId} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 6px', background: colors.bg, borderRadius: 4,
                    border: `1px solid ${sess.isConsented ? '#00FF8822' : '#FF444422'}`,
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: sess.isConsented ? colors.success : sess.isLoggedIn ? colors.warning : colors.error,
                    }} />
                    <span style={{ fontSize: 9, color: '#888', flex: 1 }}>{sess.profileName}</span>
                    {sess.error && <span style={{ fontSize: 8, color: '#FF6644' }}>{sess.error.slice(0, 30)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
