'use client'
import { colors, spacing, fontSize } from '../../design-system/tokens'

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
  error: colors.error,
  warn: colors.warning,
  success: colors.success,
  info: colors.textSecondary,
  debug: colors.textTertiary,
}

const LEVEL_BG: Record<string, string> = {
  error: `${colors.error}18`,
  warn: `${colors.warning}14`,
  success: `${colors.success}14`,
  info: 'transparent',
  debug: 'transparent',
}

const CATEGORY_LABELS: Record<string, string> = {
  scan: 'QUÉT',
  download: 'TẢI',
  render: 'RENDER',
  channel: 'KÊNH',
  system: 'HỆ THỐNG',
  auth: 'ĐĂNG NHẬP',
  general: 'CHUNG',
}

const MAX_LINES = 1000

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatLogText(logs: LogEntry[]): string {
  return logs.map(e => {
    const dt = formatDateTime(e.timestamp)
    const cat = (CATEGORY_LABELS[e.category] || e.category).padEnd(9)
    const lvl = e.level.toUpperCase().padEnd(7)
    const detail = e.detail ? ` — ${e.detail}` : ''
    return `[${dt}] [${cat}] [${lvl}] ${e.message}${detail}`
  }).join('\n')
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

  // ─── UI state ────────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [diskUsage, setDiskUsage] = useState<{ totalBytes: number; fileCount: number; oldestAge: number } | null>(null)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  // ─── Load file logs ────────────────────────────────────────────────────────────
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
    void loadFileLogs()
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
        const existingIds = new Set(prev.map(e => e.id))
        const newEntries = entries.filter(e => !existingIds.has(e.id))
        if (newEntries.length === 0) return prev
        return [...prev, ...newEntries].slice(-MAX_LINES)
      })
    })
    return cleanup
  }, [])

  // Also load initial entries
  useEffect(() => {
    void ipc.getOpLogs().then((logs: unknown) => {
      if (Array.isArray(logs)) setOpLogs((logs as LogEntry[]).slice(-MAX_LINES))
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

  // ─── Copy to clipboard ──────────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    const text = formatLogText(filteredLogs)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setCopyError(false)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      setCopyError(true)
      setTimeout(() => setCopyError(false), 2000)
    })
  }, [filteredLogs])

  // ─── Open log folder ─────────────────────────────────────────────────────────
  const handleOpenFolder = useCallback(() => {
    if (logDir) {
      ipc.openFolder(logDir).catch(() => {})
    }
  }, [logDir])

  // ─── Export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true)
    try {
      await ipc.exportLogs()
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
        await loadFileLogs()
      }
    } catch {} finally {
      setCleaningUp(false)
    }
  }

  // ─── Log entry component ─────────────────────────────────────────────────────
  const LogRow = ({ entry }: { entry: LogEntry }) => {
    const color = LEVEL_COLORS[entry.level] || colors.textSecondary
    const bg = LEVEL_BG[entry.level] || 'transparent'
    return (
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 6px',
        borderRadius: 3, marginBottom: 1,
        background: bg,
        minHeight: 18,
      }}>
        <span style={{ fontSize: 8.5, color: colors.textTertiary, fontFamily: 'monospace', flexShrink: 0, paddingTop: 2, minWidth: 68 }}>
          {formatTime(entry.timestamp)}
        </span>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: color, flexShrink: 0, marginTop: 3,
        }} />
        <span style={{ fontSize: 8, color: colors.textTertiary, fontFamily: 'monospace', flexShrink: 0, paddingTop: 2, minWidth: 54 }}>
          {CATEGORY_LABELS[entry.category] || entry.category}
        </span>
        <span style={{ fontSize: 9, color, flex: 1, paddingTop: 1, fontFamily: 'monospace' }}>
          {entry.message}
          {entry.detail && (
            <span style={{ color: colors.textSecondary, fontSize: 8 }}> — {entry.detail}</span>
          )}
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
          <div style={{ fontSize: 13, fontWeight: 800, color: colors.border, letterSpacing: '0.1em' }}>
            <span style={{ color: colors.success, marginRight: 6 }}>▶</span>
            CONSOLE
          </div>
          <div style={{ fontSize: 8, color: colors.textSecondary, fontFamily: 'monospace', marginTop: 2 }}>
            {logDir || 'Đang khởi tạo...'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Disk usage */}
          {diskUsage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
              <span style={{ fontSize: 9, color: colors.textSecondary }}>Disk:</span>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: diskUsage.totalBytes > 10 * 1024 * 1024 ? colors.warning : colors.textSecondary }}>
                {formatSize(diskUsage.totalBytes)}
              </span>
              <span style={{ fontSize: 9, color: colors.borderHover }}>({diskUsage.fileCount} files)</span>
            </div>
          )}

          {/* Copy to clipboard */}
          <button
            onClick={handleCopy}
            disabled={filteredLogs.length === 0}
            title="Sao chép tất cả dòng hiển thị vào clipboard"
            style={{
              height: 28, paddingLeft: 10, paddingRight: 10,
              background: copied ? `${colors.success}11` : copyError ? `${colors.error}22` : colors.border,
              border: `1px solid ${copied ? `${colors.success}66` : copyError ? `${colors.error}66` : colors.border}`,
              borderRadius: 4, color: copied ? colors.success : copyError ? colors.error : colors.textSecondary,
              fontSize: 8, fontWeight: 700, cursor: filteredLogs.length === 0 ? 'not-allowed' : 'pointer',
              minWidth: 70,
            }}>
            {copied ? '✓ ĐÃ COPY' : copyError ? '✗ LỖI' : '📋 COPY'}
          </button>

          {/* Open log folder */}
          <button
            onClick={handleOpenFolder}
            disabled={!logDir}
            title="Mở thư mục chứa file log"
            style={{
              height: 28, paddingLeft: 10, paddingRight: 10,
              background: colors.border, border: `1px solid ${colors.border}`,
              borderRadius: 4, color: logDir ? colors.textSecondary : colors.borderHover,
              fontSize: 8, fontWeight: 700, cursor: logDir ? 'pointer' : 'not-allowed',
            }}>
            📁 MỞ THƯ MỤC
          </button>

          <button onClick={() => setRefreshKey(k => k + 1)} style={{
            height: 28, paddingLeft: 10, paddingRight: 10,
            background: colors.border, border: '1px solid colors.border',
            borderRadius: 4, color: colors.textSecondary, fontSize: 8, fontWeight: 700,
            cursor: 'pointer',
          }}>↻</button>

          <button onClick={handleCleanup} disabled={cleaningUp} style={{
            height: 28, paddingLeft: 10, paddingRight: 10,
            background: cleaningUp ? `${colors.warning}11` : colors.bg,
            border: `1px solid ${cleaningUp ? colors.textSecondary : colors.borderHover}`,
            borderRadius: 4, color: cleaningUp ? colors.textSecondary : colors.textSecondary,
            fontSize: 8, fontWeight: 700, cursor: cleaningUp ? 'not-allowed' : 'pointer',
          }}>
            {cleaningUp ? '...' : '🗑'}
          </button>

          <button onClick={handleExport} disabled={exporting} style={{
            height: 28, paddingLeft: 14, paddingRight: 14,
            background: exporting ? `${colors.warning}11` : `${colors.warning}11`,
            border: `1px solid ${exporting ? colors.textSecondary : colors.warning}`,
            borderRadius: 4, color: exporting ? colors.textSecondary : colors.warning,
            fontSize: 9, fontWeight: 700, cursor: exporting ? 'not-allowed' : 'pointer',
          }}>
            {exporting ? '...' : '📦 XUẤT ZIP'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {(['operation', 'files'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '5px 14px',
            background: activeTab === tab ? colors.border : 'transparent',
            border: `1px solid ${activeTab === tab ? colors.textSecondary : colors.border}`,
            borderRadius: 4, color: activeTab === tab ? colors.textSecondary : colors.textSecondary,
            fontSize: 9, fontWeight: 700, cursor: 'pointer',
            letterSpacing: '0.05em',
          }}>
            {tab === 'operation' ? '📡 CONSOLE (trực tiếp)' : '📁 FILE LOGS'}
          </button>
        ))}
      </div>

      {/* ── CONSOLE TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'operation' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>

          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {/* Level filter */}
            <div style={{ display: 'flex', gap: 3 }}>
              {(['all', 'error', 'warn', 'success', 'info'] as LogLevel[]).map(lvl => (
                <button key={lvl} onClick={() => setFilterLevel(lvl)} style={{
                  height: 22, paddingLeft: 8, paddingRight: 8,
                  background: filterLevel === lvl ? (LEVEL_COLORS[lvl] || colors.textSecondary) + '22' : 'transparent',
                  border: `1px solid ${filterLevel === lvl ? (LEVEL_COLORS[lvl] || colors.textSecondary) + '55' : colors.border}`,
                  borderRadius: 3, fontSize: 8, fontWeight: 700,
                  color: filterLevel === lvl ? (LEVEL_COLORS[lvl] || colors.textSecondary) : colors.textSecondary,
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
                  background: filterCategory === cat ? `${colors.accent}18` : 'transparent',
                  border: `1px solid ${filterCategory === cat ? `${colors.accent}44` : colors.border}`,
                  borderRadius: 3, fontSize: 8, fontWeight: 700,
                  color: filterCategory === cat ? colors.accent : colors.textSecondary,
                  cursor: 'pointer',
                }}>
                  {cat === 'all' ? 'TẤT CẢ' : CATEGORY_LABELS[cat] || cat}
                </button>
              ))}
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* Line count */}
              <span style={{ fontSize: 8, color: colors.borderHover, paddingTop: 4, fontFamily: 'monospace' }}>
                {filteredLogs.length} / {opLogs.length} dòng
                {opLogs.length >= MAX_LINES && <span style={{ color: colors.warning }}> (max {MAX_LINES})</span>}
              </span>

              <button onClick={() => setAutoScroll(v => !v)} style={{
                height: 22, paddingLeft: 8, paddingRight: 8,
                background: autoScroll ? `${colors.accent}18` : 'transparent',
                border: `1px solid ${autoScroll ? `${colors.accent}44` : colors.border}`,
                borderRadius: 3, fontSize: 8, fontWeight: 700,
                color: autoScroll ? colors.accent : colors.textSecondary,
                cursor: 'pointer',
              }}>
                Auto {autoScroll ? 'ON' : 'OFF'}
              </button>
              <button onClick={() => { ipc.clearOpLogs().catch(() => {}); setOpLogs([]) }} style={{
                height: 22, paddingLeft: 8, paddingRight: 8,
                background: 'transparent', border: '1px solid colors.border',
                borderRadius: 3, fontSize: 8, fontWeight: 700,
                color: colors.textSecondary, cursor: 'pointer',
              }}>
                Xóa
              </button>
            </div>
          </div>

          {/* Log list */}
          <div style={{
            flex: 1, overflowY: 'auto',
            background: colors.bg, border: '1px solid colors.border',
            borderRadius: 6, padding: 6,
          }}>
            {filteredLogs.length === 0 ? (
              <div style={{
                fontSize: 9, color: colors.borderHover, textAlign: 'center', padding: '32px 0',
                fontFamily: 'monospace',
              }}>
                {opLogs.length === 0
                  ? 'Chưa có log. Đang theo dõi...'
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
            background: colors.bg, border: '1px solid colors.border',
            borderRadius: 6, overflow: 'auto', padding: 8,
          }}>
            <div style={{ fontSize: 8, color: colors.textSecondary, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8, padding: '0 4px' }}>
              FILES ({logFiles.length})
            </div>
            {loadingFiles ? (
              <div style={{ fontSize: 9, color: colors.borderHover, padding: '16px 0', textAlign: 'center' }}>Đang đọc...</div>
            ) : logFiles.length === 0 ? (
              <div style={{ fontSize: 9, color: colors.borderHover, padding: '16px 0', textAlign: 'center' }}>
                Không có file log.
              </div>
            ) : (
              logFiles.map(file => (
                <button key={file.name} onClick={() => { setSelectedFile(file.name) }} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                  background: selectedFile === file.name ? colors.border : 'transparent',
                  border: selectedFile === file.name ? `1px solid ${colors.textSecondary}` : '1px solid transparent',
                  borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                }}>
                  <div style={{ fontSize: 9, color: selectedFile === file.name ? colors.warning : colors.textSecondary, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: 8, color: colors.textSecondary, marginTop: 2 }}>
                    {formatSize(file.size)} · {formatDate(file.mtime)}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* File content */}
          <div style={{
            background: colors.bg, border: '1px solid colors.border',
            borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid colors.border',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
            }}>
              <span style={{ fontSize: 9, color: colors.textSecondary, fontFamily: 'monospace' }}>{selectedFile || '—'}</span>
              {selectedFile && (
                <span style={{ fontSize: 8, color: colors.textSecondary }}>
                  {formatSize(logFiles.find(f => f.name === selectedFile)?.size || 0)}
                </span>
              )}
            </div>
            <pre style={{
              flex: 1, overflow: 'auto', margin: 0, padding: 10,
              fontSize: 9, color: colors.textSecondary, fontFamily: 'Consolas, monospace',
              lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {fileContent || <span style={{ color: colors.borderHover }}>— empty —</span>}
            </pre>
          </div>
        </div>
      )}

      {/* Help */}
      <div style={{ padding: '8px 12px', background: colors.bg, borderRadius: 6, borderLeft: `3px solid ${colors.textSecondary}`, flexShrink: 0 }}>
        <div style={{ fontSize: 8, fontWeight: 700, color: colors.textSecondary, marginBottom: 4 }}>BÁO LỖI CHO DEV</div>
        <div style={{ fontSize: 8, color: colors.borderHover, lineHeight: 1.8 }}>
          1. Nhấn <strong style={{ color: colors.textSecondary }}>COPY</strong> để sao chép logs<br />
          2. Dán vào Zalo/Telegram kèm mô tả lỗi<br />
          3. Hoặc nhấn <strong style={{ color: colors.textSecondary }}>MỞ THƯ MỤC</strong> → gửi file log
        </div>
      </div>
    </div>
  )
}
