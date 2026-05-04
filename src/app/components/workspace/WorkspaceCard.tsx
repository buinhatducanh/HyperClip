'use client'

import { useState, useEffect } from 'react'
import type { Workspace } from '../../lib/store'
import { ipc } from '../../lib/ipc'

type WorkspaceStatus = 'new' | 'waiting' | 'downloading' | 'ready' | 'editing' | 'rendering' | 'done' | 'error'

interface Props {
  workspace: Workspace
  isSelected: boolean
  onClick: () => void
  onQuickAction?: (action: 'open' | 'delete', id: string) => void
  onRetry?: (id: string) => void
  onSplit?: (id: string, partMinutes: number) => void
  trimLimitMinutes?: number
}

const STATUS_CONFIG: Record<WorkspaceStatus, { label: string; color: string; dotColor: string }> = {
  new:        { label: 'NEW',      color: '#00B4FF', dotColor: '#00B4FF' },
  waiting:    { label: 'WAITING',  color: '#FFB800', dotColor: '#FFB800' },
  downloading: { label: 'DOWNLOAD', color: '#00B4FF', dotColor: '#00B4FF' },
  ready:      { label: 'READY',    color: '#00FF88', dotColor: '#00FF88' },
  editing:    { label: 'EDITING',  color: '#7C3AED', dotColor: '#7C3AED' },
  rendering:  { label: 'RENDERING', color: '#FF4444', dotColor: '#FF4444' },
  done:       { label: 'DONE',     color: '#555555', dotColor: '#555555' },
  error:      { label: 'ERROR',    color: '#FF4444', dotColor: '#FF4444' },
}

function formatTimeAgo(isoString?: string): string {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 1) return 'vừa xong'
  if (m < 60) return `${m}m`
  if (h < 24) return `${h}h`
  return `${d}d`
}

// Parse duration string "H:MM:SS" or "M:SS" → seconds
function parseDur(d: string | number | undefined): number {
  if (!d) return 0
  if (typeof d === 'number') return d
  const parts = d.split(':')
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1])
  return parseFloat(d) || 0
}

function formatDuration(d: string | number | undefined): string {
  if (!d) return '0:00'
  const sec = parseDur(d)
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Parse resolution "1920x1080" → width number
function parseRes(res?: string): number {
  if (!res) return 0
  const parts = res.split('x')
  return parseInt(parts[0]) || 0
}

export function WorkspaceCard({ workspace, isSelected, onClick, onQuickAction, onRetry, onSplit, trimLimitMinutes = 10 }: Props) {
  const isShort = workspace.isShort === true
  const status = workspace.status as WorkspaceStatus
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ready
  const isLocalThumb = workspace.thumbnail.startsWith('local-video://')

  const [thumbSrc, setThumbSrc] = useState<string>('')
  const [thumbFailed, setThumbFailed] = useState(false)
  const [downloadMeta, setDownloadMeta] = useState<{ speed?: string; eta?: string; percent?: number }>({})
  const [isMultiInstance, setIsMultiInstance] = useState(false)

  // Resolve thumbnail
  useEffect(() => {
    if (isLocalThumb) {
      ipc.getImageFile(workspace.id).then(result => {
        if (result?.dataUrl) {
          setThumbSrc(result.dataUrl)
          setThumbFailed(false)
        } else {
          setThumbFailed(true)
        }
      }).catch(() => setThumbFailed(true))
    } else {
      setThumbSrc(workspace.thumbnail || '')
      setThumbFailed(!workspace.thumbnail)
    }
  }, [workspace.thumbnail, workspace.id, isLocalThumb])

  // Listen to render progress events (covers both render AND download progress)
  useEffect(() => {
    const unsub = ipc.onRenderProgress((progress: any) => {
      if (progress.workspaceId !== workspace.id) return
      setDownloadMeta({ speed: progress.speed, eta: progress.eta, percent: progress.percent })
      // Show 2× badge when downloading 1080p (multi-instance active)
      if (status === 'downloading' && progress.speed && progress.percent !== undefined) {
        // Estimate: if speed > 10MiB/s during download, likely multi-instance
        // In practice, backend sets isMultiInstance on the workspace
        setIsMultiInstance(workspace.isMultiInstance === true)
      }
    })
    return unsub
  }, [workspace.id, workspace.isMultiInstance, status])

  const showRetry = (status === 'waiting' || status === 'error') && !!onRetry
  const durSec = parseDur(workspace.duration)
  const showSplit = status === 'ready' && durSec > trimLimitMinutes * 60

  // 16:9 thumbnail dimensions
  const thumbH = 72
  const thumbW16 = Math.round(thumbH * 16 / 9)  // ~128px
  const thumbW9 = Math.round(thumbH * 9 / 16)   // ~40px
  const thumbW = isShort ? thumbW9 : thumbW16

  return (
    <div
      onClick={onClick}
      style={{
        background: isSelected ? '#0D1F2A' : '#161616',
        borderLeft: `3px solid ${isSelected ? '#00B4FF' : 'transparent'}`,
        borderBottom: '1px solid #181818',
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'background 0.15s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = '#191919'
        const actions = e.currentTarget.querySelector('.card-actions') as HTMLElement
        if (actions) actions.style.opacity = '1'
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = '#161616'
        const actions = e.currentTarget.querySelector('.card-actions') as HTMLElement
        if (actions) actions.style.opacity = '0'
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        {/* ── Thumbnail ── */}
        <div style={{
          width: thumbW, height: thumbH, flexShrink: 0,
          borderRadius: 4, overflow: 'hidden',
          background: '#111', border: '1px solid #222',
          position: 'relative',
        }}>
          {thumbSrc && !thumbFailed ? (
            <img
              src={thumbSrc}
              alt=""
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover', display: 'block',
              }}
              onError={() => setThumbFailed(true)}
            />
          ) : (
            /* Gradient placeholder with channel color */
            <div style={{
              width: '100%', height: '100%',
              background: `linear-gradient(135deg, ${workspace.channelColor}20 0%, ${workspace.channelColor}08 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderLeft: `3px solid ${workspace.channelColor}`,
            }}>
              <div style={{
                width: isShort ? 12 : 18, height: isShort ? 12 : 18,
                borderRadius: 2,
                background: `${workspace.channelColor}20`,
                border: `1px solid ${workspace.channelColor}50`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width={isShort ? 6 : 9} height={isShort ? 6 : 9} viewBox="0 0 9 9" fill="none">
                  <polygon points="1,1 8,4.5 1,8" fill={workspace.channelColor} opacity="0.8" />
                </svg>
              </div>
            </div>
          )}

          {/* Status badge — top-left */}
          <div style={{
            position: 'absolute', top: 4, left: 4,
          }}>
            <div style={{
              fontSize: 8, fontWeight: 800, color: cfg.color,
              background: `${cfg.color}18`,
              border: `1px solid ${cfg.color}44`,
              borderRadius: 2, padding: '1px 4px',
              letterSpacing: '0.04em',
              display: 'flex', alignItems: 'center', gap: 3,
              backdropFilter: 'blur(4px)',
            }}>
              <span style={{
                width: 4, height: 4, borderRadius: '50%',
                background: cfg.dotColor,
                boxShadow: `0 0 3px ${cfg.dotColor}`,
                flexShrink: 0,
                animation: (status === 'downloading' || status === 'rendering')
                  ? 'pulse 1.5s ease-in-out infinite' : undefined,
              }} />
              {cfg.label}
            </div>
          </div>

          {/* Duration — bottom-right */}
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            background: 'rgba(0,0,0,0.75)',
            borderRadius: 2, padding: '1px 3px',
            fontSize: 8, fontWeight: 700, color: '#fff',
            fontFamily: 'monospace',
            backdropFilter: 'blur(4px)',
          }}>
            {formatDuration(workspace.duration)}
          </div>

          {/* Channel color accent — top-right */}
          <div style={{
            position: 'absolute', top: 4, right: 4,
            width: 4, height: 4, borderRadius: 1,
            background: workspace.channelColor,
            boxShadow: `0 0 4px ${workspace.channelColor}`,
          }} />

          {/* Download progress overlay */}
          {status === 'downloading' && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: 3, background: 'rgba(0,0,0,0.6)',
            }}>
              <div style={{
                height: '100%',
                width: `${workspace.downloadProgress || 0}%`,
                background: '#00B4FF',
                boxShadow: '0 0 6px #00B4FF',
                transition: 'width 0.4s ease',
              }} />
            </div>
          )}

          {/* Short indicator */}
          {isShort && (
            <div style={{
              position: 'absolute', bottom: 4, left: 4,
              fontSize: 7, fontWeight: 800, color: '#fff',
              background: 'rgba(0,0,0,0.7)',
              borderRadius: 2, padding: '1px 3px',
              letterSpacing: '0.04em',
            }}>
              9:16
            </div>
          )}
        </div>

        {/* ── Info ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Channel row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 6, height: 6, borderRadius: 1,
              background: workspace.channelColor,
              boxShadow: `0 0 4px ${workspace.channelColor}66`,
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 9, color: '#666', fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              letterSpacing: '0.02em',
            }}>
              {workspace.channelName}
            </span>
          </div>

          {/* Title */}
          <div style={{
            fontSize: 11, color: isSelected ? '#fff' : '#ccc',
            fontWeight: isSelected ? 500 : 400,
            lineHeight: 1.35,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {workspace.videoTitle}
          </div>

          {/* Metadata row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {workspace.videoResolution && (
              <span style={{ fontSize: 8, color: '#555', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <rect x="0.5" y="1.5" width="7" height="5" rx="0.5" stroke="#555" strokeWidth="0.8" />
                </svg>
                {workspace.videoResolution}
              </span>
            )}
            {workspace.publishedAt && (
              <span style={{ fontSize: 8, color: '#444' }}>
                YT {formatTimeAgo(workspace.publishedAt)}
              </span>
            )}
            {workspace.detectedAt && (
              <span style={{ fontSize: 8, color: '#333' }}>
                detected {formatTimeAgo(workspace.detectedAt)}
              </span>
            )}
            {workspace.fileSize && workspace.fileSize !== '0 B' && (
              <span style={{ fontSize: 8, color: '#444', fontFamily: 'monospace' }}>
                {workspace.fileSize}
              </span>
            )}
          </div>

          {/* Download speed/ETA */}
          {status === 'downloading' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 8, color: '#00B4FF', fontFamily: 'monospace' }}>
                  {downloadMeta.speed || ''}
                </span>
                {isMultiInstance && (
                  <span style={{
                    fontSize: 7, fontWeight: 800, color: '#00FF88',
                    background: '#00FF8812', border: '1px solid #00FF8844',
                    borderRadius: 2, padding: '1px 4px', letterSpacing: '0.06em',
                  }}>
                    2× INST
                  </span>
                )}
              </div>
              <span style={{ fontSize: 8, color: '#00B4FF66', fontFamily: 'monospace' }}>
                {downloadMeta.eta ? `ETA ${downloadMeta.eta}` : downloadMeta.percent !== undefined ? `${downloadMeta.percent.toFixed(0)}%` : ''}
              </span>
            </div>
          )}

          {/* Render progress */}
          {status === 'rendering' && workspace.renderProgress !== undefined && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 8, color: '#FF4444', fontFamily: 'monospace' }}>RENDERING</span>
                <span style={{ fontSize: 8, color: '#FF4444', fontFamily: 'monospace', fontWeight: 700 }}>{workspace.renderProgress}%</span>
              </div>
              <div style={{ height: 3, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${workspace.renderProgress}%`, height: '100%',
                  background: '#FF4444',
                  boxShadow: '0 0 6px #FF4444',
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hover action strip */}
      <div
        className="card-actions"
        style={{
          display: 'flex', gap: 12, alignItems: 'center',
          marginTop: 7, paddingTop: 6, borderTop: '1px solid #1e1e1e',
          opacity: 0, transition: 'opacity 0.15s',
        }}
      >
        {onQuickAction && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onQuickAction('open', workspace.id) }}
              style={{ fontSize: 9, fontWeight: 600, color: '#666', background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.08em', padding: '2px 0' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#00B4FF')}
              onMouseLeave={e => (e.currentTarget.style.color = '#666')}
            >
              MỞ
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onQuickAction('delete', workspace.id) }}
              style={{ fontSize: 9, fontWeight: 600, color: '#666', background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.08em', padding: '2px 0' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#FF4444')}
              onMouseLeave={e => (e.currentTarget.style.color = '#666')}
            >
              XÓA
            </button>
          </>
        )}
        {showRetry && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetry!(workspace.id) }}
            style={{ fontSize: 9, fontWeight: 600, color: '#666', background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.08em', padding: '2px 0' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#FFB800')}
            onMouseLeave={e => (e.currentTarget.style.color = '#666')}
          >
            THỬ LẠI
          </button>
        )}
        {showSplit && (
          <button
            onClick={(e) => { e.stopPropagation(); onSplit?.(workspace.id, trimLimitMinutes) }}
            style={{ fontSize: 9, fontWeight: 600, color: '#666', background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.08em', padding: '2px 0' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#00FF88')}
            onMouseLeave={e => (e.currentTarget.style.color = '#666')}
          >
            TÁCH
          </button>
        )}
      </div>
    </div>
  )
}
