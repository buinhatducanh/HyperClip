'use client'

import { useState, useEffect, memo } from 'react'
import { colors, spacing, fontSize } from '../../design-system/tokens'
import { Badge } from '../../design-system/Badge'
import type { Workspace } from '../../lib/store'
import { ipc } from '../../lib/ipc'

type WorkspaceStatus = 'new' | 'waiting' | 'downloading' | 'ready' | 'editing' | 'rendering' | 'done' | 'error'

// Module-level thumbnail cache — prevents duplicate IPC calls across card mounts
const _thumbCache = new Map<string, string | null>()
// Stagger counter for defer timing
let _thumbLoadCount = 0

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
  new:        { label: 'NEW',      color: colors.accent, dotColor: colors.accent },
  waiting:    { label: 'WAITING',  color: colors.warning, dotColor: colors.warning },
  downloading: { label: 'DOWNLOAD', color: colors.accent, dotColor: colors.accent },
  ready:      { label: 'READY',    color: colors.success, dotColor: colors.success },
  editing:    { label: 'EDITING',  color: colors.accent, dotColor: colors.accent },
  rendering:  { label: 'RENDERING', color: colors.error, dotColor: colors.error },
  done:       { label: 'DONE',     color: colors.textSecondary, dotColor: colors.textSecondary },
  error:      { label: 'ERROR',    color: colors.error, dotColor: colors.error },
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

function formatAbsTime(isoString?: string): string {
  if (!isoString) return ''
  const d = new Date(isoString)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function formatMsDuration(ms?: number): string {
  if (!ms) return ''
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60}s`
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

// Parse resolution "1920x1080" → height number (the smaller of the two)
function parseRes(res?: string): number {
  if (!res) return 0
  const parts = res.split('x')
  const w = parseInt(parts[0]) || 0
  const h = parseInt(parts[1]) || 0
  // For landscape, height is the quality (e.g. 1920x1080 → 1080p)
  // For portrait/short, width is the quality (e.g. 1080x1920 → 1080p)
  return Math.min(w, h) || Math.max(w, h)
}

export const WorkspaceCard = memo(function WorkspaceCard({ workspace, isSelected, onClick, onQuickAction, onRetry, onSplit, trimLimitMinutes = 10 }: Props) {
  const isShort = workspace.isShort === true
  const status = workspace.status as WorkspaceStatus
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ready
  const isLocalThumb = workspace.thumbnail.startsWith('local-video://')

  const [thumbSrc, setThumbSrc] = useState<string>('')
  const [thumbFailed, setThumbFailed] = useState(false)
  const [showQualityTip, setShowQualityTip] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  // Resolve thumbnail — cached + staggered to avoid IPC burst on startup
  useEffect(() => {
    if (!isLocalThumb) {
      setThumbSrc(workspace.thumbnail || '')
      setThumbFailed(!workspace.thumbnail)
      return
    }
    const cached = _thumbCache.get(workspace.id)
    if (cached !== undefined) {
      setThumbSrc(cached || '')
      setThumbFailed(cached === null)
      return
    }
    // Stagger: each subsequent card waits 80ms more before fetching
    const idx = _thumbLoadCount++
    const delay = Math.min(idx * 80, 2000)  // cap at 2s to avoid indefinite wait
    const timer = setTimeout(() => {
      ipc.getImageFile(workspace.id).then(result => {
        if (result?.dataUrl) {
          _thumbCache.set(workspace.id, result.dataUrl)
          setThumbSrc(result.dataUrl)
          setThumbFailed(false)
        } else {
          _thumbCache.set(workspace.id, null)
          setThumbFailed(true)
        }
      }).catch(() => {
        _thumbCache.set(workspace.id, null)
        setThumbFailed(true)
      })
    }, delay)
    return () => clearTimeout(timer)
  }, [workspace.thumbnail, workspace.id, isLocalThumb])

  const showRetry = (status === 'waiting' || status === 'error') && !!onRetry
  const durSec = parseDur(workspace.duration)
  const showSplit = status === 'ready' && durSec > trimLimitMinutes * 60

  // Quality info: always show when we have either source resolution or download config
  const dlQualityNum = workspace.downloadQuality ? parseInt(workspace.downloadQuality) : 0
  const sourceHeight = parseRes(workspace.videoResolution)
  const hasQualityInfo = dlQualityNum > 0 || sourceHeight > 0
  // Primary badge value: download config if set, else source height
  const badgeQuality = dlQualityNum > 0 ? dlQualityNum : sourceHeight
  // Is download capped below source? (e.g., source 1080p, download 720p)
  const isCapped = dlQualityNum > 0 && sourceHeight > 0 && sourceHeight > dlQualityNum
  // Badge color based on what we're working with
  const qBadgeColor = badgeQuality >= 1080 ? colors.success
    : badgeQuality >= 720 ? colors.accent
    : badgeQuality >= 480 ? colors.warning
    : colors.error

  // 16:9 thumbnail dimensions
  const thumbH = 72
  const thumbW16 = Math.round(thumbH * 16 / 9)  // ~128px
  const thumbW9 = Math.round(thumbH * 9 / 16)   // ~40px
  const thumbW = isShort ? thumbW9 : thumbW16

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => {
        const target = e.target as HTMLElement
        const actionBtn = target.closest('button[data-action]') as HTMLButtonElement | null
        if (actionBtn) {
          const action = actionBtn.getAttribute('data-action')
          if (action === 'detail') onQuickAction?.('open', workspace.id)
          else if (action === 'delete') onQuickAction?.('delete', workspace.id)
          else if (action === 'retry') onRetry?.(workspace.id)
          else if (action === 'split') onSplit?.(workspace.id, trimLimitMinutes)
          return
        }
        // Card body clicked → open preview
        onClick()
      }}
    >
      {/* Card body: visual styling only */}
      <div
        className={`card-body-${workspace.id}`}
        style={{
          background: isSelected ? colors.accent + '18' : (isHovered ? colors.surface : colors.surface),
          borderLeft: `3px solid ${isSelected ? colors.accent : 'transparent'}`,
          borderBottom: `1px solid ${colors.border}`,
          padding: '10px 12px',
          cursor: 'pointer',
          transition: 'background 0.15s',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        {/* ── Thumbnail wrapper (allows quality badge tooltip to overflow) ── */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
        {/* ── Thumbnail ── */}
        <div style={{
          width: thumbW, height: thumbH, flexShrink: 0,
          borderRadius: 4, overflow: 'hidden',
          background: colors.bg, border: `1px solid ${colors.textTertiary}`,
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
          <div style={{ position: 'absolute', top: 4, left: 4 }}>
            <Badge
              label={cfg.label}
              color={cfg.color}
              dot
              pulse={status === 'downloading' || status === 'rendering'}
              size="sm"
            />
          </div>

          {/* Duration — bottom-right */}
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            background: 'rgba(0,0,0,0.75)',
            borderRadius: 2, padding: '1px 4px',
            fontSize: 10, fontWeight: 700, color: colors.text,
            fontFamily: 'monospace',
            backdropFilter: 'blur(4px)',
          }}>
            {formatDuration(workspace.duration)}
          </div>

          {/* Channel color accent — top-right of thumbnail (hidden when quality badge shown) */}
          {!hasQualityInfo && (
            <div style={{
              position: 'absolute', top: 4, right: 4,
              width: 4, height: 4, borderRadius: 1,
              background: workspace.channelColor,
              boxShadow: `0 0 4px ${workspace.channelColor}`,
            }} />
          )}

          {/* Download progress overlay — prominent bar */}
          {status === 'downloading' && (
            <>
              {/* Percentage badge — top-right of thumbnail */}
              <div style={{
                position: 'absolute', top: 6, right: 6,
                background: `${colors.text}CC`,
                border: `1px solid ${colors.accent}66`,
                borderRadius: 4,
                padding: '3px 8px',
                backdropFilter: 'blur(4px)',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{
                    fontSize: 16, fontWeight: 800,
                    color: colors.accent,
                    fontFamily: 'monospace', lineHeight: 1,
                    textShadow: `0 0 8px ${colors.accent}`,
                  }}>
                    {workspace.downloadSpeed === 'processing' ? '99%' : `${Math.round(workspace.downloadProgress || 0)}%`}
                  </span>
                  <span style={{ fontSize: 9, color: `${colors.accent}88` }}>
                    {workspace.downloadSpeed === 'processing' ? '● MERGE' : `↓ ${workspace.downloadSpeed || '...'}`}
                  </span>
                </div>
                {workspace.downloadEta && (
                  <span style={{ fontSize: 9, color: `${colors.accent}88`, fontFamily: 'monospace' }}>
                    {workspace.downloadEta}
                  </span>
                )}
              </div>
              {/* Progress bar — full width at bottom */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: 3, background: `${colors.text}B3`,
              }}>
                <div style={{
                  height: '100%',
                  width: `${workspace.downloadProgress || 0}%`,
                  background: `linear-gradient(90deg, ${colors.accent}, ${colors.accent})`,
                  boxShadow: `0 0 8px ${colors.accent}`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </>
          )}

          {/* Short indicator */}
          {isShort && (
            <div style={{
              position: 'absolute', bottom: 4, left: 4,
              fontSize: 9, fontWeight: 800, color: colors.text,
              background: 'rgba(0,0,0,0.7)',
              borderRadius: 2, padding: '1px 4px',
              letterSpacing: '0.04em',
            }}>
              9:16
            </div>
          )}
        </div>

        {/* ── Quality badge — top-right of thumbnail (always visible when quality info available) ── */}
        {hasQualityInfo && (
          <div
            style={{
              position: 'absolute',
              top: -6, right: -4,
              cursor: 'help',
              zIndex: 10,
            }}
            onMouseEnter={() => setShowQualityTip(true)}
            onMouseLeave={() => setShowQualityTip(false)}
          >
            {/* Badge pill */}
            <div style={{
              background: `${qBadgeColor}18`,
              border: `1px solid ${qBadgeColor}66`,
              borderRadius: 3,
              padding: '2px 6px',
              fontSize: 10, fontWeight: 800,
              color: qBadgeColor,
              fontFamily: 'monospace',
              letterSpacing: '0.02em',
              display: 'flex', alignItems: 'center', gap: 3,
              backdropFilter: 'blur(4px)',
            }}>
              <svg width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="3.5" cy="3.5" r="3" stroke={qBadgeColor} strokeWidth="0.8" />
                <path d="M3.5 3v2M3.5 2.2v.1" stroke={qBadgeColor} strokeWidth="0.8" strokeLinecap="round" />
              </svg>
              {badgeQuality}p
            </div>

            {/* Tooltip — shows both download config and source */}
            {showQualityTip && (
              <div style={{
                position: 'absolute',
                top: '100%', right: 0,
                marginTop: 4,
                background: colors.text,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                padding: '8px 12px',
                zIndex: 100,
                minWidth: 160,
                boxShadow: `0 4px 12px ${colors.text}99`,
                whiteSpace: 'nowrap',
              }}>
                {/* Download config row */}
                <div style={{ fontSize: 9, color: colors.textTertiary, letterSpacing: '0.06em', marginBottom: 4 }}>CONFIG</div>
                <div style={{ fontSize: 13, color: dlQualityNum > 0 ? qBadgeColor : colors.textSecondary, fontWeight: 800, fontFamily: 'monospace' }}>
                  {dlQualityNum > 0 ? `${dlQualityNum}p` : '—'}
                </div>

                {/* Source row */}
                {sourceHeight > 0 && (
                  <>
                    <div style={{ fontSize: 9, color: colors.textTertiary, letterSpacing: '0.06em', marginTop: 8, marginBottom: 4 }}>SOURCE</div>
                    <div style={{ fontSize: 13, color: colors.textSecondary, fontFamily: 'monospace', fontWeight: 700 }}>
                      {workspace.videoResolution}
                    </div>
                  </>
                )}

                {/* Capped indicator */}
                {isCapped && (
                  <div style={{ fontSize: 9, color: colors.warning, marginTop: 6, fontWeight: 700, letterSpacing: '0.02em' }}>
                    ↓ {sourceHeight}p → {dlQualityNum}p (capped)
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>
        {/* end thumbnail wrapper */}

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
              fontSize: 11, color: colors.textSecondary, fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              letterSpacing: '0.02em',
            }}>
              {workspace.channelName}
            </span>
          </div>

          {/* Title */}
          <div style={{
            fontSize: 12, color: isSelected ? colors.text : colors.textSecondary,
            fontWeight: isSelected ? 500 : 400,
            lineHeight: 1.35,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {workspace.videoTitle}
          </div>

          {/* Metadata row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 14 }}>
            {workspace.videoResolution && !workspace.downloadQuality && (
              <span style={{ fontSize: 10, color: colors.textTertiary, fontFamily: 'monospace', flexShrink: 0 }}>
                {workspace.videoResolution}
              </span>
            )}
            {workspace.downloadQuality && (
              <span style={{ fontSize: 10, color: colors.warning, fontFamily: 'monospace', fontWeight: 700, flexShrink: 0 }}>
                {workspace.downloadQuality}p cap
              </span>
            )}
            {workspace.downloadedAt && (
              <span style={{ fontSize: 10, color: colors.success, fontFamily: 'monospace', fontWeight: 700, flexShrink: 0 }}>
                ↓ {formatTimeAgo(workspace.downloadedAt)}
              </span>
            )}
            {workspace.fileSize && workspace.fileSize !== '0 B' && (
              <span style={{ fontSize: 10, color: colors.textTertiary, fontFamily: 'monospace', flexShrink: 0 }}>
                {workspace.fileSize}
              </span>
            )}
          </div>

          {/* Pipeline timeline — real-time timestamps for detected/downloaded/rendered */}
          {(workspace.detectedAt || workspace.metrics?.downloadStartedAt || workspace.metrics?.renderStartedAt) && (
            <div style={{
              display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
              minHeight: 12, marginTop: 1,
            }}>
              {workspace.detectedAt && (
                <span style={{ fontSize: 9, color: colors.textTertiary, fontFamily: 'monospace' }}>
                  ▶ {formatAbsTime(workspace.detectedAt)}
                </span>
              )}
              {workspace.metrics?.downloadStartedAt && (
                <span style={{ fontSize: 9, color: colors.textTertiary, fontFamily: 'monospace' }}>
                  ↓ {formatAbsTime(workspace.metrics.downloadCompletedAt || workspace.metrics.downloadStartedAt)}
                  {workspace.metrics.downloadMs ? ` (${formatMsDuration(workspace.metrics.downloadMs)})` : ''}
                </span>
              )}
              {workspace.metrics?.renderStartedAt && (
                <span style={{ fontSize: 9, color: colors.textTertiary, fontFamily: 'monospace' }}>
                  ★ {formatAbsTime(workspace.metrics.renderCompletedAt || workspace.metrics.renderStartedAt)}
                  {workspace.metrics.renderMs ? ` (${formatMsDuration(workspace.metrics.renderMs)})` : ''}
                </span>
              )}
            </div>
          )}

          {/* Download speed/ETA */}
          {status === 'downloading' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M5 1v5M5 6l-2 2M5 6l2 2" stroke={colors.accent} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 8h6" stroke={colors.accent} strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                <span style={{
                  fontSize: 11, color: colors.accent,
                  fontFamily: 'monospace', fontWeight: 700, minWidth: 60,
                }}>
                  {workspace.downloadSpeed === 'processing' ? 'Merging…' : (workspace.downloadSpeed || 'starting...')}
                </span>
              </div>
              <span style={{
                fontSize: 11, color: colors.accent,
                fontFamily: 'monospace', fontWeight: 600, minWidth: 56, textAlign: 'right',
              }}>
                {workspace.downloadEta
                  ? (workspace.downloadSpeed === 'processing' ? workspace.downloadEta : 'ETA ' + workspace.downloadEta)
                  : (workspace.downloadProgress !== undefined ? workspace.downloadProgress.toFixed(0) + '%' : '')}
              </span>
            </div>
          )}

          {/* Render progress */}
          {status === 'rendering' && workspace.renderProgress !== undefined && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: colors.error, fontFamily: 'monospace' }}>RENDERING</span>
                <span style={{ fontSize: 10, color: colors.error, fontFamily: 'monospace', fontWeight: 700 }}>{workspace.renderProgress}%</span>
              </div>
              <div style={{ height: 3, background: colors.text, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${workspace.renderProgress}%`, height: '100%',
                  background: colors.error,
                  boxShadow: `0 0 6px ${colors.error}`,
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}
        </div>
      </div>
      {/* end card body */}

      {/* Action strip — sibling of card body so card onMouseLeave won't hide it */}
      <div
        data-action-area="1"
        className={`card-actions card-actions-${workspace.id}`}
        style={{
          display: 'flex', gap: 10, alignItems: 'center',
          paddingTop: 8, paddingLeft: 12, paddingRight: 12,
          paddingBottom: 8,
          borderBottom: `1px solid ${colors.border}`,
          opacity: isHovered ? 1 : 0.5, transition: 'opacity 0.15s',
          pointerEvents: 'auto',
        }}
      >
        {onQuickAction && (
          <>
            <button
              data-action="detail"
              style={{ fontSize: 11, fontWeight: 600, color: colors.accent, background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.06em', padding: '2px 0', pointerEvents: 'auto' }}
              onMouseEnter={e => (e.currentTarget.style.color = colors.accent)}
              onMouseLeave={e => (e.currentTarget.style.color = colors.accent)}
            >
              CHI TIẾT
            </button>
            <button
              data-action="delete"
              style={{ fontSize: 11, fontWeight: 600, color: colors.textTertiary, background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.08em', padding: '2px 0', pointerEvents: 'auto' }}
              onMouseEnter={e => (e.currentTarget.style.color = colors.error)}
              onMouseLeave={e => (e.currentTarget.style.color = colors.textTertiary)}
            >
              XÓA
            </button>
          </>
        )}
        {showRetry && (
          <button
            data-action="retry"
            style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.08em', padding: '2px 0', pointerEvents: 'auto' }}
            onMouseEnter={e => (e.currentTarget.style.color = colors.warning)}
            onMouseLeave={e => (e.currentTarget.style.color = colors.textSecondary)}
          >
            THỬ LẠI
          </button>
        )}
        {showSplit && (
          <button
            data-action="split"
            style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.08em', padding: '2px 0', pointerEvents: 'auto' }}
            onMouseEnter={e => (e.currentTarget.style.color = colors.success)}
            onMouseLeave={e => (e.currentTarget.style.color = colors.textSecondary)}
          >
            TÁCH
          </button>
        )}
      </div>
    </div>
    </div>
  )
})
