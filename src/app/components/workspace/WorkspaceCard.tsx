'use client'

import type { Workspace } from '../../lib/store'

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
  downloading:  { label: 'DOWNLOAD', color: '#00B4FF', bg: '#00B4FF10', border: '#00B4FF22' },
  ready:       { label: 'READY',     color: '#00FF88', bg: '#00FF8810', border: '#00FF8822' },
  editing:     { label: 'EDITING',   color: '#7C3AED', bg: '#7C3AED10', border: '#7C3AED22' },
  rendering:   { label: 'RENDERING', color: '#FF4444', bg: '#FF444410', border: '#FF444422' },
  done:        { label: 'DONE',      color: '#444444', bg: '#1A1A1A',   border: '#222222' },
  error:       { label: 'ERROR',     color: '#FF4444', bg: '#FF444410', border: '#FF444422' },
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 MB'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`
}

export function WorkspaceCard({ workspace, isSelected, onClick, onQuickAction, onRetry }: Props) {
  const status = workspace.status as WorkspaceStatus
  const cfg = STATUS_CONFIG[status]
  const isReady = status === 'ready'
  const isNew = (workspace as any)._isNew

  return (
    <div
      onClick={onClick}
      style={{
        background: isSelected ? '#0D1F30' : '#161616',
        borderLeft: isSelected ? '2px solid #00B4FF' : '2px solid transparent',
        borderBottom: '1px solid #181818',
        padding: '12px 14px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
        boxShadow: isReady && !isSelected ? 'inset 0 0 0 1px #00FF8822, 0 0 12px #00FF8808' : undefined,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = '#1A1A1A'
        const actions = e.currentTarget.querySelector('.card-actions') as HTMLElement
        if (actions) actions.style.opacity = '1'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = isSelected ? '#0D1F30' : '#161616'
        const actions = e.currentTarget.querySelector('.card-actions') as HTMLElement
        if (actions) actions.style.opacity = '0'
      }}
    >
      <div className="flex items-start gap-3">
        {/* Thumbnail */}
        {/* Thumbnail: 9:16 vertical — đúng aspect ratio của video output */}
        <div
          style={{
            width: 45,
            height: 80,
            borderRadius: 3,
            overflow: 'hidden',
            flexShrink: 0,
            background: '#111',
            border: '1px solid #222',
            position: 'relative',
          }}
        >
          <img
            src={workspace.thumbnail || 'https://via.placeholder.com/45x80/1A1A1A/333?text=?'}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={(e) => {
              const img = e.currentTarget
              if (!img.dataset.fallbacked) {
                img.dataset.fallbacked = '1'
                // Try mqdefault (320x180) — YouTube generates this faster than hqdefault
                const src = img.src
                if (src.includes('/hqdefault.jpg')) {
                  img.src = src.replace('/hqdefault.jpg', '/mqdefault.jpg')
                } else if (src.includes('/mqdefault.jpg')) {
                  img.src = src.replace('/mqdefault.jpg', '/sddefault.jpg')
                } else if (src.includes('/sddefault.jpg')) {
                  img.src = src.replace('/sddefault.jpg', '/maxresdefault.jpg')
                } else {
                  // Not a YouTube thumbnail — use placeholder
                  img.src = 'https://via.placeholder.com/45x80/1A1A1A/333?text=▶'
                }
              }
            }}
          />
          {/* Duration badge */}
          <div
            style={{
              position: 'absolute',
              bottom: 3,
              right: 3,
              background: 'rgba(0,0,0,0.75)',
              borderRadius: 2,
              padding: '1px 3px',
              fontSize: 9,
              fontWeight: 700,
              color: '#fff',
              fontFamily: 'monospace',
            }}
          >
            {workspace.duration || '0:00'}
          </div>
          {/* Channel color indicator */}
          <div
            style={{
              position: 'absolute',
              top: 3,
              left: 3,
              width: 4,
              height: 4,
              borderRadius: 1,
              background: workspace.channelColor || '#00B4FF',
              boxShadow: `0 0 4px ${workspace.channelColor || '#00B4FF'}`,
            }}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isNew && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: '#00FF88',
                  background: '#00FF8810',
                  border: '1px solid #00FF8822',
                  borderRadius: 2,
                  padding: '1px 4px',
                  letterSpacing: '0.04em',
                }}
              >
                NEW
              </span>
            )}
            {/* Status badge */}
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                color: cfg.color,
                background: cfg.bg,
                border: '1px solid',
                borderColor: cfg.border,
                borderRadius: 2,
                padding: '1px 4px',
                letterSpacing: '0.04em',
              }}
            >
              {workspace.renderProgress !== undefined && status === 'rendering'
                ? `${workspace.renderProgress}%`
                : cfg.label}
            </span>
            {/* Trim limit */}
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: '#555',
                fontFamily: 'monospace',
              }}
            >
              {workspace.trimLimit === '5min' ? '5MIN' : workspace.trimLimit === '10min' ? '10MIN' : 'FULL'}
            </span>
            {/* Quality indicator */}
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: workspace.quality === 1080 ? '#00FF88' : workspace.quality === 720 ? '#FFB800' : '#555',
                fontFamily: 'monospace',
                letterSpacing: '0.02em',
              }}
            >
              {workspace.quality}p
            </span>
          </div>

          <div
            style={{
              fontSize: 11,
              color: isSelected ? '#fff' : '#bbb',
              fontWeight: isSelected ? 500 : 400,
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              marginBottom: 4,
            }}
          >
            {workspace.videoTitle}
          </div>

          <div className="flex items-center gap-2">
            {/* Channel dot */}
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: 1,
                background: workspace.channelColor || '#00B4FF',
                flexShrink: 0,
                boxShadow: `0 0 4px ${workspace.channelColor || '#00B4FF'}66`,
              }}
            />
            <span style={{ fontSize: 9, color: '#444', fontWeight: 500 }}>
              {workspace.channelName}
            </span>
            {workspace.downloadedAt && (
              <>
                <span style={{ fontSize: 9, color: '#333' }}>·</span>
                <span style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}>
                  {workspace.downloadedAt}
                </span>
              </>
            )}
            <span style={{ fontSize: 9, color: '#2a2a2a' }}>·</span>
            <span style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>
              {workspace.fileSize}
            </span>
          </div>

          {/* Progress bar */}
          {status === 'rendering' && workspace.renderProgress !== undefined && (
            <div style={{ marginTop: 6, height: 2, background: '#1A1A1A', borderRadius: 1 }}>
              <div
                style={{
                  width: `${workspace.renderProgress}%`,
                  height: '100%',
                  background: '#FF4444',
                  borderRadius: 1,
                  transition: 'width 0.5s',
                }}
              />
            </div>
          )}

          {/* Download progress bar */}
          {status === 'downloading' && (
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 3, background: '#1A1A1A', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${workspace.downloadProgress || 0}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #00B4FF, #00D4FF)',
                    borderRadius: 2,
                    transition: 'width 0.5s',
                    boxShadow: '0 0 6px #00B4FF88',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                <span style={{ fontSize: 9, color: '#00B4FF', fontFamily: 'monospace', fontWeight: 600 }}>
                  ↓ DOWNLOADING
                </span>
                <span style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>
                  {workspace.downloadProgress || 0}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick actions (hover) */}
      <div
        className="card-actions flex justify-end gap-3 mt-2"
        style={{ opacity: 0, transition: 'opacity 0.15s' }}
      >
        {onQuickAction && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onQuickAction('open', workspace.id) }}
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: '#888',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                letterSpacing: '0.08em',
                padding: 0,
              }}
            >
              OPEN
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onQuickAction('delete', workspace.id) }}
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: '#ff4444',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                letterSpacing: '0.08em',
                padding: 0,
              }}
            >
              DELETE
            </button>
          </>
        )}
        {onRetry && (status === 'waiting' || status === 'error') && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetry(workspace.id) }}
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: '#FFB800',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.08em',
              padding: 0,
            }}
          >
            RETRY
          </button>
        )}
      </div>
    </div>
  )
}