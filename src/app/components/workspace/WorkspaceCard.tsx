'use client'

import { useState, useEffect } from 'react'
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
  onRedownloadHd?: (id: string) => void
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

export function WorkspaceCard({ workspace, isSelected, onClick, onQuickAction, onRetry, onRedownloadHd, onSplit, trimLimitMinutes = 10 }: Props) {
  const isShort = workspace.isShort === true
  const status = workspace.status as WorkspaceStatus
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ready
  const isLocalThumb = workspace.thumbnail.startsWith('local-video://')

  const [thumbSrc, setThumbSrc] = useState<string>('')
  const [thumbFailed, setThumbFailed] = useState(false)
  const [showQualityTip, setShowQualityTip] = useState(false)

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
  const showHdRedownload = status === 'ready' && !!onRedownloadHd
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
  const qBadgeColor = badgeQuality >= 1080 ? '#00FF88'
    : badgeQuality >= 720 ? '#00B4FF'
    : badgeQuality >= 480 ? '#FFB800'
    : '#FF6633'

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
        {/* ── Thumbnail wrapper (allows quality badge tooltip to overflow) ── */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
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
              border: `1px solid ${cfg.color}55`,
              borderRadius: 2, padding: '2px 6px',
              letterSpacing: '0.04em',
              display: 'flex', alignItems: 'center', gap: 4,
              backdropFilter: 'blur(4px)',
              boxShadow: (status === 'downloading' || status === 'rendering')
                ? `0 0 8px ${cfg.color}44, 0 0 2px ${cfg.color}22`
                : 'none',
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: cfg.dotColor,
                boxShadow: `0 0 6px ${cfg.dotColor}`,
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
              {/* Percentage badge — center of thumbnail */}
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'rgba(0,0,0,0.7)',
                border: '1px solid #00B4FF44',
                borderRadius: 4,
                padding: '4px 8px',
                backdropFilter: 'blur(4px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}>
                <span style={{
                  fontSize: 16, fontWeight: 800, color: '#00B4FF',
                  fontFamily: 'monospace', lineHeight: 1,
                  textShadow: '0 0 8px #00B4FF',
                }}>
                  {Math.round(workspace.downloadProgress || 0)}%
                </span>
                <span style={{ fontSize: 7, color: '#00B4FF88', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
                  ↓ {workspace.downloadSpeed || '...'}
                </span>
              </div>
              {/* Progress bar — full width at bottom */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: 6, background: 'rgba(0,0,0,0.7)',
              }}>
                <div style={{
                  height: '100%',
                  width: `${workspace.downloadProgress || 0}%`,
                  background: 'linear-gradient(90deg, #0088cc, #00B4FF)',
                  boxShadow: '0 0 10px #00B4FF, 0 0 4px #00B4FF',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </>
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
              fontSize: 8, fontWeight: 800,
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
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: 4,
                padding: '6px 10px',
                zIndex: 100,
                minWidth: 160,
                boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
                whiteSpace: 'nowrap',
              }}>
                {/* Download config row */}
                <div style={{ fontSize: 7, color: '#555', letterSpacing: '0.06em', marginBottom: 3 }}>CONFIG</div>
                <div style={{ fontSize: 11, color: dlQualityNum > 0 ? qBadgeColor : '#444', fontWeight: 800, fontFamily: 'monospace' }}>
                  {dlQualityNum > 0 ? `${dlQualityNum}p` : '—'}
                </div>

                {/* Source row */}
                {sourceHeight > 0 && (
                  <>
                    <div style={{ fontSize: 7, color: '#555', letterSpacing: '0.06em', marginTop: 6, marginBottom: 3 }}>SOURCE</div>
                    <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', fontWeight: 700 }}>
                      {workspace.videoResolution}
                    </div>
                  </>
                )}

                {/* Capped indicator */}
                {isCapped && (
                  <div style={{ fontSize: 7, color: '#FFB800', marginTop: 5, fontWeight: 700, letterSpacing: '0.02em' }}>
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
            {/* Source resolution — only shown when downloadQuality cap is NOT set (user wants original quality) */}
            {workspace.videoResolution && !workspace.downloadQuality && (
              <span style={{ fontSize: 8, color: '#555', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <rect x="0.5" y="1.5" width="7" height="5" rx="0.5" stroke="#555" strokeWidth="0.8" />
                </svg>
                {workspace.videoResolution}
              </span>
            )}
            {/* Download cap — show when configured (overrides source resolution) */}
            {workspace.downloadQuality && (
              <span style={{ fontSize: 8, color: '#FFB800', fontFamily: 'monospace', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <rect x="0.5" y="1.5" width="7" height="5" rx="0.5" stroke="#FFB800" strokeWidth="0.8" />
                </svg>
                {workspace.downloadQuality}p cap
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
                {/* Animated download icon */}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M5 1v5M5 6l-2 2M5 6l2 2" stroke="#00B4FF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 8h6" stroke="#00B4FF" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                <span style={{ fontSize: 9, color: '#00B4FF', fontFamily: 'monospace', fontWeight: 700 }}>
                  {workspace.downloadSpeed || 'starting...'}
                </span>
                {workspace.isMultiInstance && (
                  <span style={{
                    fontSize: 7, fontWeight: 800, color: '#00FF88',
                    background: '#00FF8812', border: '1px solid #00FF8844',
                    borderRadius: 2, padding: '1px 4px', letterSpacing: '0.06em',
                  }}>
                    2× INST
                  </span>
                )}
              </div>
              <span style={{ fontSize: 9, color: '#00B4FF', fontFamily: 'monospace', fontWeight: 600 }}>
                {workspace.downloadEta ? `ETA ${workspace.downloadEta}` : workspace.downloadProgress !== undefined ? `${workspace.downloadProgress.toFixed(0)}%` : ''}
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
        {showHdRedownload && (
          <button
            onClick={(e) => { e.stopPropagation(); onRedownloadHd!(workspace.id) }}
            style={{ fontSize: 9, fontWeight: 600, color: '#666', background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.08em', padding: '2px 0' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#00B4FF')}
            onMouseLeave={e => (e.currentTarget.style.color = '#666')}
          >
            1080P
          </button>
        )}
      </div>
    </div>
  )
}
