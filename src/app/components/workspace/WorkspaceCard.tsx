'use client'

import { memo } from 'react'
import { colors } from '../../design-system/tokens'
import { Badge } from '../../design-system/Badge'
import type { Workspace } from '../../lib/store'

type WorkspaceStatus = 'new' | 'waiting' | 'downloading' | 'ready' | 'editing' | 'rendering' | 'done' | 'error'

interface Props {
  workspace: Workspace
  isSelected: boolean
  isNextRender?: boolean
  onClick: () => void
  onQuickAction?: (action: 'open' | 'delete' | 'open-output' | 'open-output-folder', id: string) => void
  onRetry?: (id: string) => void
  onSplit?: (id: string, partMinutes: number) => void
  trimLimitMinutes?: number
}

const STATUS_CONFIG: Record<WorkspaceStatus, { label: string; color: string; dotColor: string }> = {
  new:        { label: 'NEW',       color: colors.accent, dotColor: colors.accent },
  waiting:    { label: 'WAITING',   color: colors.warning, dotColor: colors.warning },
  downloading:{ label: 'DOWNLOAD',  color: colors.accent, dotColor: colors.accent },
  ready:      { label: 'READY',     color: colors.success, dotColor: colors.success },
  editing:    { label: 'EDITING',   color: colors.accent, dotColor: colors.accent },
  rendering:  { label: 'RENDERING', color: colors.error, dotColor: colors.error },
  done:       { label: 'DONE',      color: colors.textSecondary, dotColor: colors.textSecondary },
  error:      { label: 'ERROR',     color: colors.error, dotColor: colors.error },
}

function formatTimeAgo(isoString?: string): string {
  if (!isoString) return ''
  const ms = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 1) return 'vừa xong'
  if (m < 60) return `${m}m`
  if (h < 24) return `${h}h`
  return `${d}d`
}

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

export const WorkspaceCard = memo(function WorkspaceCard({ workspace, isSelected, isNextRender = false, onClick, onQuickAction, onRetry, onSplit, trimLimitMinutes = 10 }: Props) {
  const status = workspace.status as WorkspaceStatus
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ready
  const showRetry = (status === 'waiting' || status === 'error') && !!onRetry
  const durSec = parseDur(workspace.duration)
  const showSplit = status === 'ready' && durSec > trimLimitMinutes * 60
  const showActions = isSelected

  return (
    <div>
      <div
        onClick={(e) => {
          const target = e.target as HTMLElement
          const actionBtn = target.closest('button[data-action]') as HTMLButtonElement | null
          if (actionBtn) {
            const action = actionBtn.getAttribute('data-action')
            if (action === 'detail') onQuickAction?.('open', workspace.id)
            else if (action === 'delete') onQuickAction?.('delete', workspace.id)
            else if (action === 'open-output') onQuickAction?.('open-output', workspace.id)
            else if (action === 'open-output-folder') onQuickAction?.('open-output-folder', workspace.id)
            else if (action === 'retry') onRetry?.(workspace.id)
            else if (action === 'split') onSplit?.(workspace.id, trimLimitMinutes)
            return
          }
          onClick()
        }}
        style={{
          background: isSelected ? `${colors.accent}12` : colors.bg,
          borderLeft: `3px solid ${isSelected ? colors.accent : 'transparent'}`,
          borderBottom: showActions ? 'none' : `1px solid ${colors.border}`,
          padding: '10px 12px',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <Badge
                label={cfg.label}
                color={cfg.color}
                dot
                pulse={status === 'downloading' || status === 'rendering'}
                size="sm"
              />
              {isNextRender && status === 'ready' && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: colors.warning,
                  border: `1px solid ${colors.warning}55`,
                  background: `${colors.warning}14`,
                  borderRadius: 3,
                  padding: '1px 6px',
                  fontFamily: 'monospace',
                  letterSpacing: '0.04em',
                }}>
                  NEXT
                </span>
              )}
              <span style={{ fontSize: 10, color: colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {workspace.channelName}
              </span>
            </div>

            <div style={{
              fontSize: 12,
              color: isSelected ? colors.text : colors.textSecondary,
              fontWeight: isSelected ? 600 : 500,
              lineHeight: 1.35,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              marginBottom: 8,
            }}>
              {workspace.videoTitle}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 16 }}>
              <span style={{ fontSize: 10, color: colors.textTertiary, fontFamily: 'monospace' }}>
                {formatDuration(workspace.duration)}
              </span>
              {workspace.downloadQuality && (
                <span style={{ fontSize: 10, color: colors.warning, fontFamily: 'monospace', fontWeight: 700 }}>
                  {workspace.downloadQuality}p
                </span>
              )}
              {workspace.fileSize && workspace.fileSize !== '0 B' && (
                <span style={{ fontSize: 10, color: colors.textTertiary, fontFamily: 'monospace' }}>
                  {workspace.fileSize}
                </span>
              )}
              {workspace.downloadedAt && (
                <span style={{ fontSize: 10, color: colors.success, fontFamily: 'monospace', fontWeight: 700 }}>
                  ↓ {formatTimeAgo(workspace.downloadedAt)}
                </span>
              )}
            </div>

            {status === 'downloading' && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                  <span style={{ fontSize: 10, color: colors.accent, fontFamily: 'monospace' }}>
                    {workspace.downloadSpeed === 'processing' ? 'MERGING' : (workspace.downloadSpeed || 'DOWNLOADING')}
                  </span>
                  <span style={{ fontSize: 10, color: colors.accent, fontFamily: 'monospace', fontWeight: 700 }}>
                    {workspace.downloadProgress !== undefined ? `${Math.round(workspace.downloadProgress)}%` : ''}
                    {workspace.downloadEta ? ` · ${workspace.downloadEta}` : ''}
                  </span>
                </div>
                <div style={{ height: 3, background: colors.surface, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${workspace.downloadProgress || 0}%`,
                    height: '100%',
                    background: colors.accent,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            )}

            {status === 'rendering' && workspace.renderProgress !== undefined && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                  <span style={{ fontSize: 10, color: colors.error, fontFamily: 'monospace', fontWeight: 700 }}>RENDERING</span>
                  <span style={{ fontSize: 10, color: colors.error, fontFamily: 'monospace', fontWeight: 700 }}>
                    {workspace.renderProgress}%{workspace.renderEta ? ` · ${workspace.renderEta}` : ''}
                  </span>
                </div>
                <div style={{ height: 3, background: colors.surface, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${workspace.renderProgress}%`,
                    height: '100%',
                    background: colors.error,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {showActions && (
          <div
            data-action-area="1"
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              paddingTop: 6,
              paddingLeft: 12,
              paddingRight: 12,
              paddingBottom: 8,
              borderBottom: `1px solid ${colors.border}`,
              background: colors.bg,
            }}
          >
            {onQuickAction && (
              <>
                <button data-action="detail" style={{ fontSize: 11, fontWeight: 600, color: colors.accent, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
                  CHI TIẾT
                </button>
                <button data-action="delete" style={{ fontSize: 11, fontWeight: 600, color: colors.textTertiary, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
                  XÓA
                </button>
              </>
            )}
            {status === 'done' && workspace.outputPath && onQuickAction && (
              <>
                <button data-action="open-output" style={{ fontSize: 11, fontWeight: 600, color: colors.success, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
                  MỞ FILE
                </button>
                <button data-action="open-output-folder" style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
                  THƯ MỤC
                </button>
              </>
            )}
            {showRetry && (
              <button data-action="retry" style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
                THỬ LẠI
              </button>
            )}
            {showSplit && (
              <button data-action="split" style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
                TÁCH
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

