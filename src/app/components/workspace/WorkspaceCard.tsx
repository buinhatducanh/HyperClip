'use client'

import { useState, useEffect } from 'react'
import type { Workspace } from '../../lib/store'
import { ipc } from '../../lib/ipc'

type WorkspaceStatus = 'waiting' | 'downloading' | 'ready' | 'editing' | 'rendering' | 'done' | 'error'

interface Props {
  workspace: Workspace
  isSelected: boolean
  onClick: () => void
  onQuickAction?: (action: 'open' | 'delete', id: string) => void
  onRetry?: (id: string) => void
}

const STATUS_CONFIG: Record<WorkspaceStatus, { label: string; color: string; bg: string; border: string }> = {
  waiting:     { label: 'WAITING',   color: '#FFB800', bg: '#FFB80010', border: '#FFB80022' },
  downloading: { label: 'DOWNLOAD',  color: '#00B4FF', bg: '#00B4FF10', border: '#00B4FF22' },
  ready:       { label: 'READY',     color: '#00FF88', bg: '#00FF8810', border: '#00FF8822' },
  editing:     { label: 'EDITING',   color: '#7C3AED', bg: '#7C3AED10', border: '#7C3AED22' },
  rendering:   { label: 'RENDERING', color: '#FF4444', bg: '#FF444410', border: '#FF444422' },
  done:        { label: 'DONE',      color: '#444444', bg: '#1A1A1A',   border: '#222222' },
  error:       { label: 'ERROR',     color: '#FF4444', bg: '#FF444410', border: '#FF444422' },
}

function StatusBadge({ status, progress }: { status: WorkspaceStatus; progress?: number }) {
  const cfg = STATUS_CONFIG[status]
  const label = status === 'rendering' && progress !== undefined
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

export function WorkspaceCard({ workspace, isSelected, onClick, onQuickAction, onRetry }: Props) {
  const status = workspace.status as WorkspaceStatus
  const [thumbSrc, setThumbSrc] = useState<string>(workspace.thumbnail || '')

  // Resolve local thumbnail
  useEffect(() => {
    const thumb = workspace.thumbnail || ''
    if (thumb.startsWith('local-video://')) {
      setThumbSrc(thumb)
    } else {
      setThumbSrc(thumb)
    }
  }, [workspace.thumbnail])

  useEffect(() => {
    if (thumbSrc.startsWith('local-video://')) {
      ipc.getImageFile(workspace.id).then(result => {
        if (result?.dataUrl) setThumbSrc(result.dataUrl)
      })
    }
  }, [thumbSrc, workspace.id])

  const showRetry = (status === 'waiting' || status === 'error') && !!onRetry

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
          <img
            src={thumbSrc || 'https://via.placeholder.com/40x72/1A1A1A/333?text=?'}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={(e) => {
              const img = e.currentTarget
              if (!img.dataset.fallbacked) {
                img.dataset.fallbacked = '1'
                const src = img.src
                if (src.includes('/hqdefault.jpg')) img.src = src.replace('/hqdefault.jpg', '/mqdefault.jpg')
                else if (src.includes('/mqdefault.jpg')) img.src = src.replace('/mqdefault.jpg', '/sddefault.jpg')
                else if (src.includes('/sddefault.jpg')) img.src = src.replace('/sddefault.jpg', '/maxresdefault.jpg')
                else img.src = 'https://via.placeholder.com/40x72/1A1A1A/333?text=▶'
              }
            }}
          />
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

          {/* Download progress bar */}
          {status === 'downloading' && (
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 2, background: '#1A1A1A', borderRadius: 1, overflow: 'hidden' }}>
                <div style={{
                  width: `${workspace.downloadProgress || 0}%`, height: '100%',
                  background: '#00B4FF', borderRadius: 1, transition: 'width 0.5s',
                  boxShadow: '0 0 4px #00B4FF88',
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
      </div>
    </div>
  )
}
