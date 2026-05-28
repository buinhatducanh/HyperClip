'use client'
import { colors, spacing, fontSize } from '../design-system/tokens'

import { useState, useEffect } from 'react'
import type { RenderedVideo } from '../types'
import { ipc } from '../lib/ipc'

interface Props {
  video: RenderedVideo
  onShowToast: (msg: string) => void
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatRenderTime(ms?: number): string {
  if (!ms || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function formatFileSize(bytes?: number | string): string {
  if (!bytes) return '—'
  if (typeof bytes === 'string') return bytes // already formatted (new format)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Display quality: use short side (YouTube convention).
 * Portrait "1080x1920" → quality = 1080 (width).
 * Landscape "1920x1080" → quality = 1080 (height). */
function displayQuality(video: RenderedVideo): number {
  const res = video.videoResolution
  if (res) {
    const parts = res.split('x').map(Number)
    if (parts.length === 2 && parts[1] > parts[0]) {
      return parts[0] // portrait: short side = width
    }
  }
  return video.quality
}

function formatAbsoluteDate(renderedAt: string): string {
  // renderedAt is already formatted as relative time from store
  // Try to provide ISO-like display if it looks like a date
  return renderedAt || '—'
}

// Info row component
function InfoRow({ label, value, color, mono }: {
  label: string; value: string | undefined; color?: string; mono?: boolean
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 0',
      borderBottom: '1px solid #E0E0E0',
    }}>
      <span style={{ fontSize: 9, color: '#777', fontWeight: 600 }}>{label}</span>
      <span style={{
        fontSize: 9, color: color || '#888',
        fontFamily: mono ? 'monospace' : 'inherit',
        fontWeight: 600,
      }}>
        {value || '—'}
      </span>
    </div>
  )
}

// Section header component
function SectionHeader({ icon, title, color }: {
  icon: React.ReactNode; title: string; color: string
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '10px 0 6px',
      marginTop: 4,
    }}>
      {icon}
      <span style={{
        fontSize: 8, fontWeight: 800, color, letterSpacing: '0.12em',
      }}>
        {title}
      </span>
    </div>
  )
}

export function RenderedVideoDetail({ video, onShowToast }: Props) {
  const [localThumb, setLocalThumb] = useState<string>('')
  const [videoUrl, setVideoUrl] = useState<string>('')
  const [videoError, setVideoError] = useState(false)

  useEffect(() => {
    // Reset when video changes
    setVideoUrl('')
    setVideoError(false)
    setLocalThumb('')

    // Thumbnail for display
    if (video.thumbnail.startsWith('local-video://') && !video.thumbnailData) {
      ipc.getVideoBlob(video.workspaceId).then(async (blob) => {
        if (blob) {
          try {
            const bin = String.fromCharCode(...blob)
            setLocalThumb('data:image/jpeg;base64,' + btoa(bin))
          } catch {}
        }
      }).catch(() => {})
    }

    // Fetch rendered video file for preview
    ipc.getRenderedVideoFile(video.id).then(result => {
      if (result) setVideoUrl(result.url)
    }).catch(() => {})
  }, [video])

  const thumbSrc = video.thumbnailData || localThumb || (
    video.thumbnail.startsWith('local-video://') ? '' : video.thumbnail
  )

  const handleOpenFolder = async () => {
    try {
      await ipc.openRenderedFolder(video.id)
    } catch {
      onShowToast('Cannot open folder')
    }
  }

  const rc = video.renderConfig
  const si = video.sourceInfo

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: colors.bg,
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 20px',
        background: colors.bg,
        borderBottom: '1px solid #E0E0E0',
        flexShrink: 0,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.success} strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: colors.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {video.videoTitle || 'Untitled'}
          </div>
          <div style={{ fontSize: 9, color: '#777', marginTop: 1 }}>
            {video.channelName} · {video.renderedAt}
          </div>
        </div>
        {/* Open folder CTA */}
        <button
          onClick={handleOpenFolder}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px',
            background: `linear-gradient(135deg, ${colors.success}18, ${colors.success}08)`,
            border: `1px solid ${colors.success}33`,
            borderRadius: 6, cursor: 'pointer',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = `linear-gradient(135deg, ${colors.success}30, ${colors.success}18)`
            e.currentTarget.style.borderColor = `${colors.success}66`
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = `linear-gradient(135deg, ${colors.success}18, ${colors.success}08)`
            e.currentTarget.style.borderColor = `${colors.success}33`
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.success} strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 700, color: colors.success }}>Mở thư mục</span>
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
        {/* Video preview — HTML5 player when available, fallback to thumbnail */}
        <div style={{
          margin: '16px 0',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #D0D0D0',
          background: colors.bg,
          position: 'relative',
        }}>
          {videoUrl ? (
            <>
              <video
                key={video.id}
                src={videoUrl}
                controls
                style={{ width: '100%', maxHeight: 220, display: 'block', background: '#000' }}
                onError={() => setVideoError(true)}
              />
              {/* Always show thumbnail below video as poster fallback */}
              {thumbSrc && (
                <img
                  src={thumbSrc}
                  alt=""
                  style={{
                    width: '100%', maxHeight: 60, objectFit: 'cover',
                    display: 'block', opacity: 0.6,
                  }}
                />
              )}
            </>
          ) : videoError || !thumbSrc ? (
            <div style={{
              height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 8,
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span style={{ fontSize: 9, color: '#666' }}>Video preview unavailable</span>
            </div>
          ) : (
            <img
              src={thumbSrc}
              alt=""
              style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }}
              onError={(e) => { (e.target as HTMLElement).style.display = 'none' }}
            />
          )}
          {/* Play overlay when no video URL but has thumbnail */}
          {!videoUrl && !videoError && thumbSrc && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.4)',
              cursor: 'pointer',
            }}
              onClick={handleOpenFolder}
              title="Click to open in player"
            >
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'rgba(0,255,136,0.15)',
                border: `2px solid ${colors.success}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill={colors.success}>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* Render performance card */}
        {video.renderDurationMs != null && video.renderDurationMs > 0 && (
          <div style={{
            background: `linear-gradient(135deg, ${colors.success}08, ${colors.accent}08)`,
            border: `1px solid ${colors.success}22`,
            borderRadius: 8,
            padding: '12px 16px',
            margin: '12px 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: colors.success, fontFamily: 'monospace' }}>
                {formatRenderTime(video.renderDurationMs)}
              </span>
              <span style={{ fontSize: 9, color: `${colors.success}88`, fontWeight: 600 }}>render time</span>
            </div>
            {rc && (
              <div style={{ fontSize: 8, color: '#777', marginTop: 4 }}>
                {rc.exportResolution} · {rc.fps}fps · {rc.speed}x speed · {rc.codec?.toUpperCase()} · GPU: {rc.gpuTier || 'software'}
              </div>
            )}
          </div>
        )}

        {/* ═══ Source → Output Comparison ═══ */}
        <SectionHeader
          icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="2"><path d="M16 3h5v5" /><path d="M4 20L21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 4l5 5" /></svg>}
          title="SOURCE → OUTPUT"
          color={colors.accent}
        />
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 30px 1fr',
          background: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 6,
          overflow: 'hidden',
        }}>
          {/* Column headers */}
          <div style={{ padding: '6px 12px', background: '#FFFFFF', borderBottom: '1px solid #E0E0E0' }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: colors.warning, letterSpacing: '0.08em' }}>SOURCE</span>
          </div>
          <div style={{ background: '#FFFFFF', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 10, color: '#666' }}>→</span>
          </div>
          <div style={{ padding: '6px 12px', background: '#FFFFFF', borderBottom: '1px solid #E0E0E0' }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: colors.success, letterSpacing: '0.08em' }}>OUTPUT</span>
          </div>

          {/* Resolution */}
          <div style={{ padding: '5px 12px', borderBottom: '1px solid #E0E0E0' }}>
            <div style={{ fontSize: 7, color: '#888' }}>Resolution</div>
            <div style={{ fontSize: 9, color: '#999', fontFamily: 'monospace', fontWeight: 600 }}>
              {si?.originalResolution || video.videoResolution || '—'}
            </div>
          </div>
          <div style={{ borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 8, color: '#666' }}>→</span>
          </div>
          <div style={{ padding: '5px 12px', borderBottom: '1px solid #E0E0E0' }}>
            <div style={{ fontSize: 7, color: '#888' }}>Resolution</div>
            <div style={{ fontSize: 9, color: colors.success, fontFamily: 'monospace', fontWeight: 600 }}>
              {rc?.exportResolution || `${video.quality}p`}
            </div>
          </div>

          {/* Duration */}
          <div style={{ padding: '5px 12px', borderBottom: '1px solid #E0E0E0' }}>
            <div style={{ fontSize: 7, color: '#888' }}>Duration</div>
            <div style={{ fontSize: 9, color: '#999', fontFamily: 'monospace', fontWeight: 600 }}>
              {formatDuration(si?.originalDuration || 0)}
            </div>
          </div>
          <div style={{ borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 8, color: '#666' }}>→</span>
          </div>
          <div style={{ padding: '5px 12px', borderBottom: '1px solid #E0E0E0' }}>
            <div style={{ fontSize: 7, color: '#888' }}>Duration</div>
            <div style={{ fontSize: 9, color: colors.success, fontFamily: 'monospace', fontWeight: 600 }}>
              {formatDuration(video.duration)}
              {rc?.speed && rc.speed !== 1.0 && (
                <span style={{ color: colors.warning, marginLeft: 4 }}>({rc.speed}x)</span>
              )}
            </div>
          </div>

          {/* File size */}
          <div style={{ padding: '5px 12px', borderBottom: '1px solid #E0E0E0' }}>
            <div style={{ fontSize: 7, color: '#888' }}>File Size</div>
            <div style={{ fontSize: 9, color: '#999', fontFamily: 'monospace', fontWeight: 600 }}>
              {formatFileSize(si?.originalFileSize)}
            </div>
          </div>
          <div style={{ borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 8, color: '#666' }}>→</span>
          </div>
          <div style={{ padding: '5px 12px', borderBottom: '1px solid #E0E0E0' }}>
            <div style={{ fontSize: 7, color: '#888' }}>File Size</div>
            <div style={{ fontSize: 9, color: colors.success, fontFamily: 'monospace', fontWeight: 600 }}>
              {formatFileSize(video.fileSize as any)}
            </div>
          </div>

          {/* Codec */}
          <div style={{ padding: '5px 12px' }}>
            <div style={{ fontSize: 7, color: '#888' }}>Format</div>
            <div style={{ fontSize: 9, color: '#999', fontFamily: 'monospace', fontWeight: 600 }}>
              {si?.downloadQuality ? `${si.downloadQuality}p` : '—'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 8, color: '#666' }}>→</span>
          </div>
          <div style={{ padding: '5px 12px' }}>
            <div style={{ fontSize: 7, color: '#888' }}>Format</div>
            <div style={{ fontSize: 9, color: colors.success, fontFamily: 'monospace', fontWeight: 600 }}>
              {video.quality}p {video.codec?.toUpperCase()}
            </div>
          </div>
        </div>

        {/* ═══ Render Configuration ═══ */}
        <SectionHeader
          icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>}
          title="RENDER CONFIG"
          color={colors.accent}
        />
        <div style={{
          background: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 6,
          padding: '4px 12px',
        }}>
          {rc ? (
            <>
              <InfoRow label="Export Resolution" value={rc.exportResolution} color={colors.accent} mono />
              <InfoRow label="FPS" value={`${rc.fps}`} mono />
              <InfoRow label="Speed" value={`${rc.speed}x`} color={rc.speed !== 1.0 ? colors.warning : '#888'} mono />
              <InfoRow label="Codec" value={rc.codec?.toUpperCase()} color={colors.accent} mono />
              <InfoRow label="Preset" value={rc.preset?.toUpperCase()} mono />
              <InfoRow label="Tune" value={rc.tune?.toUpperCase()} mono />
              <InfoRow label="Background" value={rc.backgroundType} mono />
              <InfoRow label="Audio Codec" value={rc.audioCodec} mono />
              <InfoRow label="Audio Bitrate" value={rc.audioBitrate} mono />
              <InfoRow label="Video Type" value={rc.isShort ? '9:16 Vertical' : '16:9 Landscape'} mono />
              {rc.vidHeightPct && !rc.isShort && (
                <InfoRow label="Video Zone" value={`${rc.vidHeightPct}%`} mono />
              )}
              <InfoRow label="GPU Tier" value={rc.gpuTier?.toUpperCase()} color={
                rc.gpuTier === 'high' ? colors.success :
                rc.gpuTier === 'mid' ? colors.warning :
                rc.gpuTier === 'software' ? colors.error : '#888'
              } mono />
              {(rc.trimStart != null || rc.trimEnd != null) && (
                <InfoRow
                  label="Trim Range"
                  value={`${formatDuration(rc.trimStart || 0)} → ${formatDuration(rc.trimEnd || 0)}`}
                  mono
                />
              )}
            </>
          ) : (
            <div style={{ padding: '12px 0', fontSize: 9, color: '#888', textAlign: 'center' }}>
              No render config available (legacy record)
            </div>
          )}
        </div>

        {/* ═══ Output Details ═══ */}
        <SectionHeader
          icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>}
          title="OUTPUT DETAILS"
          color="#FF6B35"
        />
        <div style={{
          background: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 6,
          padding: '4px 12px',
        }}>
          <InfoRow label="Quality" value={`${displayQuality(video)}p`} color={colors.accent} mono />
          <InfoRow label="Codec" value={video.codec?.toUpperCase()} color={colors.accent} mono />
          <InfoRow label="File Size" value={formatFileSize(video.fileSize as any)} mono />
          <InfoRow label="Duration" value={formatDuration(video.duration)} mono />
          <InfoRow label="Rendered At" value={video.renderedAt} />
          <InfoRow label="Output Path" value={video.outputPath ? video.outputPath.split(/[\\/]/).pop() : '—'} mono />
          <InfoRow label="Archive Path" value={video.archivedPath ? video.archivedPath.split(/[\\/]/).pop() : '—'} mono />
        </div>

        {/* ═══ Source Info ═══ */}
        {si && (
          <>
            <SectionHeader
              icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFB800" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="2" y1="7" x2="7" y2="7" /><line x1="2" y1="17" x2="7" y2="17" /><line x1="17" y1="7" x2="22" y2="7" /><line x1="17" y1="17" x2="22" y2="17" /></svg>}
              title="SOURCE VIDEO"
              color="#FFB800"
            />
            <div style={{
              background: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 6,
              padding: '4px 12px',
            }}>
              <InfoRow label="Original Resolution" value={si.originalResolution || video.videoResolution} mono />
              <InfoRow label="Original Duration" value={si.originalDuration ? formatDuration(si.originalDuration) : '—'} mono />
              <InfoRow label="Original File Size" value={formatFileSize(si.originalFileSize)} mono />
              <InfoRow label="Download Quality" value={si.downloadQuality ? `${si.downloadQuality}p` : '—'} mono />
            </div>
          </>
        )}

        {/* Bottom open folder CTA */}
        <button
          onClick={handleOpenFolder}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px',
            marginTop: 16,
            background: `linear-gradient(135deg, ${colors.success}15, ${colors.success}08)`,
            border: `1px solid ${colors.success}33`,
            borderRadius: 8, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = `linear-gradient(135deg, ${colors.success}30, ${colors.success}18)`
            e.currentTarget.style.borderColor = `${colors.success}66`
            e.currentTarget.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = `linear-gradient(135deg, ${colors.success}15, ${colors.success}08)`
            e.currentTarget.style.borderColor = `${colors.success}33`
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.success} strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.success }}>Mở thư mục chứa file</span>
        </button>
      </div>
    </div>
  )
}
