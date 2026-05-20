'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ipc } from '../../lib/ipc'

type LogLevel = 'all' | 'debug' | 'info' | 'warn' | 'error' | 'success'
type LogCategory = 'all' | 'scan' | 'download' | 'render' | 'channel' | 'system' | 'auth' | 'general'

interface LogEntry {
  id: string
  timestamp: number
  level: string
  category: string
  message: string
  detail?: string
}

interface LogFile {
  name: string
  size: number
  mtime: number
  content?: string
}

const LEVEL_COLORS: Record<string, string> = {
  error: '#FF5555',
  warn: '#FFB800',
  success: '#00FF88',
  info: '#888888',
  debug: '#444444',
}

const CATEGORY_LABELS: Record<string, string> = {
  scan: 'Quét',
  download: 'Tải',
  render: 'Render',
  channel: 'Kênh',
  system: 'Hệ thống',
  auth: 'Đăng nhập',
  general: 'Chung',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export function LogsSection() {
  const [activeTab, setActiveTab] = useState<'operation' | 'files'>('operation')

  // ─── File logs state ────────────────────────────────────────────────────────────
  const [logFiles, setLogFiles] = useState<LogFile[]>([])
  const [logDir, setLogDir] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [loadingFiles, setLoadingFiles] = useState(false)

  // ─── Operation logs state ─────────────────────────────────────────────────────
  const [opLogs, setOpLogs] = useState<LogEntry[]>([])
  const [filterLevel, setFilterLevel] = useState<LogLevel>('all')
  const [filterCategory, setFilterCategory] = useState<LogCategory>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const opLogsEndRef = useRef<HTMLDivElement>(null)

  // ─── Export state ─────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [diskUsage, setDiskUsage] = useState<{ totalBytes: number; fileCount: number; oldestAge: number } | null>(null)
  const [cleaningUp, setCleaningUp] = useState(false)

  // ─── Load file logs ───────────────────────────────────────────────────────────
  const loadFileLogs = useCallback(async () => {
    setLoadingFiles(true)
    try {
      const [result, usage] = await Promise.all([
        ipc.readLogs(),
        ipc.getLogDiskUsage(),
      ])
      if (result) {
        setLogFiles(result.files || [])
        setLogDir(result.logDir || '')
        if (!selectedFile && result.files?.length > 0) {
          setSelectedFile(result.files[0].name)
          setFileContent(result.files[0].content || '')
        }
      }
      setDiskUsage(usage)
    } catch {} finally {
      setLoadingFiles(false)
    }
  }, [selectedFile])

  useEffect(() => {
    loadFileLogs()
  }, [loadFileLogs, refreshKey])

  useEffect(() => {
    if (selectedFile) {
      const f = logFiles.find(lf => lf.name === selectedFile)
      if (f) setFileContent(f.content || '')
    }
  }, [selectedFile, logFiles])

  // ─── Live operation log streaming ────────────────────────────────────────────
  useEffect(() => {
    const cleanup = ipc.onOpLogs((entries: LogEntry[]) => {
      setOpLogs(prev => {
        if (entries.length === 0) return prev
        // entries is the last 50 from the buffer — merge with existing
        const existingIds = new Set(prev.map(e => e.id))
        const newEntries = entries.filter(e => !existingIds.has(e.id))
        if (newEntries.length === 0) return prev
        return [...prev, ...newEntries].slice(-200)
      })
    })
    return cleanup
  }, [])

  // Also load initial entries
  useEffect(() => {
    ipc.getOpLogs().then((logs: unknown) => {
      if (Array.isArray(logs)) setOpLogs(logs as LogEntry[])
    }).catch(() => {})
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && opLogsEndRef.current) {
      opLogsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [opLogs, autoScroll])

  // ─── Filtered operation logs ──────────────────────────────────────────────────
  const filteredLogs = opLogs.filter(log => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false
    if (filterCategory !== 'all' && log.category !== filterCategory) return false
    return true
  })

  // ─── Export ──────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true)
    try {
      const result = await ipc.exportLogs()
    } catch {} finally {
      setExporting(false)
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────
  const handleCleanup = async () => {
    setCleaningUp(true)
    try {
      const result = await ipc.cleanupLogs()
      if (result.deletedCount > 0) {
        const freedMB = (result.freedBytes / 1024 / 1024).toFixed(1)
        // Reload after cleanup
        await loadFileLogs()
      }
    } catch {} finally {
      setCleaningUp(false)
    }
  }

  // ─── Log entry component ─────────────────────────────────────────────────────
  const LogRow = ({ entry }: { entry: LogEntry }) => {
    const color = LEVEL_COLORS[entry.level] || '#888'
    return (
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 4px',
        borderRadius: 3, marginBottom: 1,
        transition: 'background 0.1s',
      }}>
        <span style={{ fontSize: 8, color: '#2a2a2a', fontFamily: 'monospace', flexShrink: 0, paddingTop: 2 }}>
          {formatTime(entry.timestamp)}
        </span>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: color, flexShrink: 0, marginTop: 3,
        }} />
        <span style={{ fontSize: 8, color: '#3a3a3a', fontFamily: 'monospace', flexShrink: 0, paddingTop: 2, minWidth: 50 }}>
          {CATEGORY_LABELS[entry.category] || entry.category}
        </span>
        <span style={{ fontSize: 9, color, flex: 1, paddingTop: 1 }}>
          {entry.message}
        </span>
      </div>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 12, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>LOGS</div>
          <div style={{ fontSize: 8, color: '#333', fontFamily: 'monospace', marginTop: 2 }}>{logDir}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Disk usage */}
          {diskUsage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
              <span style={{ fontSize: 9, color: '#333' }}>Disk:</span>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: diskUsage.totalBytes > 10 * 1024 * 1024 ? '#FFB800' : '#555' }}>
                {formatSize(diskUsage.totalBytes)}
              </span>
              <span style={{ fontSize: 9, color: '#222' }}>({diskUsage.fileCount} files)</span>
            </div>
          )}
          <button onClick={() => setRefreshKey(k => k + 1)} style={{
            height: 28, paddingLeft: 10, paddingRight: 10,
            background: '#141414', border: '1px solid #1a1a1a',
            borderRadius: 4, color: '#444', fontSize: 8, fontWeight: 700,
            cursor: 'pointer',
          }}>↻ Refresh</button>
          <button onClick={handleCleanup} disabled={cleaningUp} style={{
            height: 28, paddingLeft: 10, paddingRight: 10,
            background: cleaningUp ? '#1a1200' : '#0d0d0d',
            border: `1px solid ${cleaningUp ? '#333' : '#222'}`,
            borderRadius: 4, color: cleaningUp ? '#444' : '#555',
            fontSize: 8, fontWeight: 700, cursor: cleaningUp ? 'not-allowed' : 'pointer',
          }}>
            {cleaningUp ? 'Cleaning...' : '🗑 Dọn cũ'}
          </button>
          <button onClick={handleExport} disabled={exporting} style={{
            height: 28, paddingLeft: 14, paddingRight: 14,
            background: exporting ? '#1a1200' : '#1a1400',
            border: `1px solid ${exporting ? '#333' : '#FF6B35'}`,
            borderRadius: 4, color: exporting ? '#444' : '#FF6B35',
            fontSize: 9, fontWeight: 700, cursor: exporting ? 'not-allowed' : 'pointer',
          }}>
            {exporting ? 'ĐANG XUẤT...' : '📦 XUẤT ZIP'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {(['operation', 'files'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '5px 14px',
            background: activeTab === tab ? '#1a1a1a' : 'transparent',
            border: `1px solid ${activeTab === tab ? '#333' : '#1a1a1a'}`,
            borderRadius: 4, color: activeTab === tab ? '#888' : '#333',
            fontSize: 9, fontWeight: 700, cursor: 'pointer',
            letterSpacing: '0.05em',
          }}>
            {tab === 'operation' ? '📡 HOẠT ĐỘNG' : '📁 FILE LOGS'}
          </button>
        ))}
      </div>

      {/* ── OPERATION LOGS TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'operation' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>

          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {/* Level filter */}
            <div style={{ display: 'flex', gap: 3 }}>
              {(['all', 'info', 'warn', 'error', 'success'] as LogLevel[]).map(lvl => (
                <button key={lvl} onClick={() => setFilterLevel(lvl)} style={{
                  height: 22, paddingLeft: 8, paddingRight: 8,
                  background: filterLevel === lvl ? (LEVEL_COLORS[lvl] || '#888') + '22' : 'transparent',
                  border: `1px solid ${filterLevel === lvl ? (LEVEL_COLORS[lvl] || '#888') + '55' : '#1a1a1a'}`,
                  borderRadius: 3, fontSize: 8, fontWeight: 700,
                  color: filterLevel === lvl ? (LEVEL_COLORS[lvl] || '#888') : '#333',
                  cursor: 'pointer',
                }}>
                  {lvl === 'all' ? 'TẤT CẢ' : lvl.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Category filter */}
            <div style={{ display: 'flex', gap: 3 }}>
              {(['all', 'scan', 'download', 'render', 'system', 'channel'] as LogCategory[]).map(cat => (
                <button key={cat} onClick={() => setFilterCategory(cat)} style={{
                  height: 22, paddingLeft: 8, paddingRight: 8,
                  background: filterCategory === cat ? '#00B4FF18' : 'transparent',
                  border: `1px solid ${filterCategory === cat ? '#00B4FF44' : '#1a1a1a'}`,
                  borderRadius: 3, fontSize: 8, fontWeight: 700,
                  color: filterCategory === cat ? '#00B4FF' : '#333',
                  cursor: 'pointer',
                }}>
                  {cat === 'all' ? 'TẤT CẢ' : CATEGORY_LABELS[cat] || cat}
                </button>
              ))}
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <span style={{ fontSize: 8, color: '#2a2a2a', paddingTop: 4 }}>
                {filteredLogs.length} / {opLogs.length} dòng
              </span>
              <button onClick={() => setAutoScroll(v => !v)} style={{
                height: 22, paddingLeft: 8, paddingRight: 8,
                background: autoScroll ? '#00B4FF18' : 'transparent',
                border: `1px solid ${autoScroll ? '#00B4FF44' : '#1a1a1a'}`,
                borderRadius: 3, fontSize: 8, fontWeight: 700,
                color: autoScroll ? '#00B4FF' : '#333',
                cursor: 'pointer',
              }}>
                Auto {autoScroll ? 'ON' : 'OFF'}
              </button>
              <button onClick={() => { ipc.clearOpLogs().catch(() => {}); setOpLogs([]) }} style={{
                height: 22, paddingLeft: 8, paddingRight: 8,
                background: 'transparent', border: '1px solid #1a1a1a',
                borderRadius: 3, fontSize: 8, fontWeight: 700,
                color: '#333', cursor: 'pointer',
              }}>
                Xóa
              </button>
            </div>
          </div>

          {/* Log list */}
          <div style={{
            flex: 1, overflowY: 'auto',
            background: '#080808', border: '1px solid #141414',
            borderRadius: 6, padding: 6,
          }}>
            {filteredLogs.length === 0 ? (
              <div style={{ fontSize: 9, color: '#222', textAlign: 'center', padding: '32px 0' }}>
                {opLogs.length === 0
                  ? 'Chưa có log. Poller đang quét sẽ hiển thị tại đây.'
                  : 'Không có dòng nào khớp bộ lọc.'}
              </div>
            ) : (
              filteredLogs.map(entry => <LogRow key={entry.id} entry={entry} />)
            )}
            <div ref={opLogsEndRef} />
          </div>
        </div>
      )}

      {/* ── FILE LOGS TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'files' && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '220px 1fr', gap: 10, overflow: 'hidden' }}>
          {/* File list */}
          <div style={{
            background: '#0D0D0D', border: '1px solid #141414',
            borderRadius: 6, overflow: 'auto', padding: 8,
          }}>
            <div style={{ fontSize: 8, color: '#333', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8, padding: '0 4px' }}>
              FILES ({logFiles.length})
            </div>
            {loadingFiles ? (
              <div style={{ fontSize: 9, color: '#2a2a2a', padding: '16px 0', textAlign: 'center' }}>Đang đọc...</div>
            ) : logFiles.length === 0 ? (
              <div style={{ fontSize: 9, color: '#2a2a2a', padding: '16px 0', textAlign: 'center' }}>
                Không có file log.
              </div>
            ) : (
              logFiles.map(file => (
                <button key={file.name} onClick={() => { setSelectedFile(file.name) }} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                  background: selectedFile === file.name ? '#1a1a1a' : 'transparent',
                  border: selectedFile === file.name ? '1px solid #333' : '1px solid transparent',
                  borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                }}>
                  <div style={{ fontSize: 9, color: selectedFile === file.name ? '#FF6B35' : '#666', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: 8, color: '#333', marginTop: 2 }}>
                    {formatSize(file.size)} · {formatDate(file.mtime)}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* File content */}
          <div style={{
            background: '#0D0D0D', border: '1px solid #141414',
            borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid #141414',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
            }}>
              <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>{selectedFile || '—'}</span>
              {selectedFile && (
                <span style={{ fontSize: 8, color: '#333' }}>
                  {formatSize(logFiles.find(f => f.name === selectedFile)?.size || 0)}
                </span>
              )}
            </div>
            <pre style={{
              flex: 1, overflow: 'auto', margin: 0, padding: 10,
              fontSize: 9, color: '#777', fontFamily: 'Consolas, monospace',
              lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {fileContent || <span style={{ color: '#2a2a2a' }}>— empty —</span>}
            </pre>
          </div>
        </div>
      )}

      {/* Help */}
      <div style={{ padding: '8px 12px', background: '#0D0D0D', borderRadius: 6, borderLeft: '3px solid #333', flexShrink: 0 }}>
        <div style={{ fontSize: 8, fontWeight: 700, color: '#444', marginBottom: 4 }}>CÁCH BÁO LỖI</div>
        <div style={{ fontSize: 8, color: '#2a2a2a', lineHeight: 1.8 }}>
          1. Nhấn <strong style={{ color: '#444' }}>Xuất ZIP</strong> để tạo file nén<br />
          2. Gửi file <strong style={{ color: '#444' }}>.zip</strong> qua Zalo/Telegram kèm mô tả lỗi<br />
          3. Hoặc gửi đường dẫn thư mục: <span style={{ color: '#444', fontFamily: 'monospace' }}>{logDir}</span>
        </div>
      </div>
    </div>
  )
}
