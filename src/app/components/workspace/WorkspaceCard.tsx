'use client'

import { useState, useEffect } from 'react'
import type { Workspace } from '../../lib/store'
import { ipc } from '../../lib/ipc'
import { useAppStore } from '../../lib/store'

type WorkspaceStatus = 'waiting' | 'downloading' | 'ready' | 'editing' | 'rendering' | 'done' | 'error'

interface Props {
  workspace: Workspace
  isSelected: boolean
  onClick: () => void
  onQuickAction?: (action: 'open' | 'delete', id: string) => void
  onRetry?: (id: string) => void
  onSplit?: (id: string, partMinutes: number) => void
  trimLimitMinutes?: number
}

const STATUS_CONFIG: Record<WorkspaceStatus, { label: string; color: string; bg: string; border: string }> = {
  waiting:     { label: 'WAITING',   color: '#FFB800', bg: '#FFB80010', border: '#FFB80022' },
  downloading: { label: 'DOWNLOAD',  color: '#00B4FF', bg: '#00B4FF10', border: '#00B4FF22' },
  ready:       { label: 'READY',     color: '#00FF88', bg: '#00FF8810', border: '#00FF8822' },
  editing:     { label: 'EDITING',   color: '#7C3AED', bg: '#7C3AED10', border: '#7C3AED22' },
  rendering:   { label: 'RENDERING', color: '#FF4444', bg: '#FF444410', border: '#FF444422' },
  done:        { label: 'DONE',      color: '#888888', bg: '#1A1A1A',   border: '#2A2A2A' },
  error:       { label: 'ERROR',     color: '#FF4444', bg: '#FF444410', border: '#FF444422' },
}

function StatusBadge({ status, progress }: { status: WorkspaceStatus; progress?: number }) {
  const cfg = STATUS_CONFIG[status]
  const label = (status === 'rendering' || status === 'downloading') && progress !== undefined
    ? `${progress}%`
    : cfg.label

  return (
    <span style={{
      fontSize: 9, fontWeight: 800, color: cfg.color,
      background: cfg.bg, border: '1px solid', borderColor: cfg.border,
      borderRadius: 2, padding: '1px 5px', letterSpacing: '0.04em',
      display: 'inline-flex', alignItems: 'center', gap: 3,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, display: 'inline-block', flexShrink: 0 }} />
      {label}
    </span>
  )
}

function formatTimeAgo(isoString?: string): string {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 1) return 'vừa xong'
  if (m < 60) return `${m}m trước`
  if (h < 24) return `${h}h trước`
  return `${d}d trước`
}

export function WorkspaceCard({ workspace, isSelected, onClick, onQuickAction, onRetry, onSplit, trimLimitMinutes = 10 }: Props) {
  const isLocalThumb = workspace.thumbnail.startsWith('local-video://')
  const status = workspace.status as WorkspaceStatus
  const [thumbSrc, setThumbSrc] = useState<string>(workspace.thumbnail || '')
  // Default to placeholder for external URLs — prevents browser from fetching YouTube thumbnails
  const [thumbFailed, setThumbFailed] = useState(!isLocalThumb)

  // Live download speed + ETA from progress events
  const [downloadMeta, setDownloadMeta] = useState<{ speed?: string; eta?: string }>({})

  // Resolve local thumbnail after download
  useEffect(() => {
    if (isLocalThumb) {
      setThumbSrc(workspace.thumbnail)
      setThumbFailed(false)
      ipc.getImageFile(workspace.id).then(result => {
        if (result?.dataUrl) setThumbSrc(result.dataUrl)
      })
    } else {
      setThumbSrc(workspace.thumbnail || '')
      setThumbFailed(true)
    }
  }, [workspace.thumbnail, workspace.id, isLocalThumb])

  // Listen to download/render progress events
  useEffect(() => {
    const unsub = ipc.onRenderProgress((progress: any) => {
      if (progress.workspaceId !== workspace.id) return
      setDownloadMeta({ speed: progress.speed, eta: progress.eta })
    })
    return unsub
  }, [workspace.id])

  const showRetry = (status === 'waiting' || status === 'error') && !!onRetry

  // Split: available for ready videos longer than trim limit
  const parseDur = (d: string | number | undefined) => {
    if (!d) return 0
    if (typeof d === 'number') return d
    const parts = d.split(':')
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
    return parseFloat(d) || 0
  }
  const durSec = parseDur(workspace.duration)
  const showSplit = status === 'ready' && durSec > trimLimitMinutes * 60

  return (
    <div
      onClick={onClick}
      style={{
        background: isSelected ? '#0D1F2A' : '#161616',
        borderLeft: isSelected ? '3px solid #00B4FF' : '3px solid transparent',
        borderBottom: '1px solid #181818',
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'background 0.15s',
        position: 'relative',
        minHeight: 88,
        boxShadow: status === 'ready' && !isSelected ? 'inset 0 0 0 1px #00FF8808' : undefined,
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* Thumbnail 9:16 */}
        <div style={{
          width: 40, height: 72, borderRadius: 3, overflow: 'hidden', flexShrink: 0,
          background: '#111', border: '1px solid #222', position: 'relative',
        }}>
          {thumbSrc && !thumbFailed ? (
            <img
              src={thumbSrc}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={() => setThumbFailed(true)}
            />
          ) : (
            /* Colored placeholder — shown for new videos where YouTube hasn't generated thumbnails yet */
            <div style={{
              width: '100%', height: '100%',
              background: `linear-gradient(135deg, ${workspace.channelColor || '#00B4FF'}22 0%, ${workspace.channelColor || '#00B4FF'}08 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderLeft: `2px solid ${workspace.channelColor || '#00B4FF'}`,
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: 2,
                background: `${workspace.channelColor || '#00B4FF'}30`,
                border: `1px solid ${workspace.channelColor || '#00B4FF'}60`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <polygon points="2,1 7,4 2,7" fill={workspace.channelColor || '#00B4FF'} opacity="0.8" />
                </svg>
              </div>
            </div>
          )}
          {/* Duration */}
          <div style={{
            position: 'absolute', bottom: 3, right: 3,
            background: 'rgba(0,0,0,0.8)', borderRadius: 2, padding: '1px 3px',
            fontSize: 8, fontWeight: 700, color: '#fff', fontFamily: 'monospace',
          }}>
            {workspace.duration || '0:00'}
          </div>
          {/* Channel color dot */}
          <div style={{
            position: 'absolute', top: 3, left: 3,
            width: 4, height: 4, borderRadius: 1,
            background: workspace.channelColor || '#00B4FF',
            boxShadow: `0 0 4px ${workspace.channelColor || '#00B4FF'}`,
          }} />
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Status + title row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
            <StatusBadge status={status} progress={workspace.renderProgress} />
          </div>

          {/* Title */}
          <div style={{
            fontSize: 12, color: isSelected ? '#fff' : '#ccc',
            fontWeight: isSelected ? 500 : 400,
            lineHeight: 1.3, marginBottom: 5,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {workspace.videoTitle}
          </div>

          {/* Channel */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 5, height: 5, borderRadius: 1,
              background: workspace.channelColor || '#00B4FF',
              flexShrink: 0,
              boxShadow: `0 0 4px ${workspace.channelColor || '#00B4FF'}66`,
            }} />
            <span style={{ fontSize: 10, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {workspace.channelName}
            </span>
          </div>

          {/* Download progress bar + metadata */}
          {status === 'downloading' && (
            <div style={{ marginTop: 6 }}>
              {/* Progress bar */}
              <div style={{ height: 3, background: '#1A1A1A', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{
                  width: `${workspace.downloadProgress || 0}%`, height: '100%',
                  background: '#00B4FF', borderRadius: 2, transition: 'width 0.4s',
                  boxShadow: '0 0 6px #00B4FF88',
                }} />
              </div>
              {/* Speed + ETA row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 8, color: '#00B4FF', fontFamily: 'monospace' }}>
                  {downloadMeta.speed || ''} {workspace.videoResolution || ''}
                </span>
                <span style={{ fontSize: 8, color: '#00B4FF55', fontFamily: 'monospace' }}>
                  {downloadMeta.eta ? `ETA ${downloadMeta.eta}` : ''}
                </span>
              </div>
            </div>
          )}

          {/* Ready/other: show metadata below channel — also visible during download */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
            {workspace.videoResolution && (
              <span style={{ fontSize: 8, color: '#444', fontFamily: 'monospace' }}>
                {workspace.videoResolution}
              </span>
            )}
            {workspace.publishedAt && (
              <span style={{ fontSize: 8, color: '#333' }}>
                YT {formatTimeAgo(workspace.publishedAt)}
              </span>
            )}
            {workspace.detectedAt && (
              <span style={{ fontSize: 8, color: '#2a2a2a' }}>
                / {formatTimeAgo(workspace.detectedAt)}
              </span>
            )}
            {workspace.duration && workspace.duration !== '0' && (
              <span style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>
                / {workspace.duration}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Hover action strip */}
      <div
        className="card-actions"
        style={{
          display: 'flex', gap: 10, alignItems: 'center',
          marginTop: 6, paddingTop: 5, borderTop: '1px solid #1A1A1A',
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
