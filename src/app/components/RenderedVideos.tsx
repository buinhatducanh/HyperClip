'use client'
import { colors, spacing, fontSize } from '../design-system/tokens'

import { useState, useEffect } from 'react'
import type { RenderedVideo } from '../types'
import { ipc } from '../lib/ipc'

interface Props {
  videos: RenderedVideo[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onShowToast: (msg: string) => void
  onCompare?: (workspaceId: string) => void
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatRenderTime(ms?: number): string {
  if (!ms || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}m ${s}s`
}

/** Convert Uint8Array JPEG blob to base64 data URL safely (avoids call-stack overflow from ...spread). */
function blobToBase64(blob: Uint8Array): string | null {
  try {
    const CHUNK = 8192
    const len = blob.length
    let binary = ''
    for (let i = 0; i < len; i += CHUNK) {
      binary += String.fromCharCode(...blob.subarray(i, i + CHUNK))
    }
    return 'data:image/jpeg;base64,' + btoa(binary)
  } catch { return null }
}

export function RenderedVideos({ videos, selectedId, onSelect, onRemove, onShowToast, onCompare }: Props) {
  const [localThumbCache, setLocalThumbCache] = useState<Record<string, string>>({})

  useEffect(() => {
    videos.forEach((video) => {
      if (
        video.thumbnail.startsWith('local-video://') &&
        !video.thumbnailData &&
        !localThumbCache[video.id]
      ) {
        ipc.getVideoBlob(video.workspaceId).then(async (blob) => {
          if (blob) {
            const base64 = blobToBase64(blob)
            if (base64) {
              setLocalThumbCache(prev => ({ ...prev, [video.id]: base64 }))
            }
          }
        }).catch(() => {})
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos])

  const resolveThumb = (video: RenderedVideo) => {
    if (video.thumbnailData) return video.thumbnailData
    if (video.thumbnail.startsWith('local-video://')) {
      return localThumbCache[video.id] || ''
    }
    return video.thumbnail
  }

  const handleOpenFolder = async (id: string) => {
    try {
      await ipc.openRenderedFolder(id)
    } catch {
      onShowToast('Không thể mở thư mục')
    }
  }

  const handleRemove = async (id: string) => {
    const result = await ipc.removeRenderedVideo(id)
    if (result?.success) {
      onRemove(id)
      if (result.bytesFreed > 0) {
        const freedMB = (result.bytesFreed / 1024 / 1024).toFixed(1)
        onShowToast(`Đã xóa (${freedMB} MB được giải phóng)`)
      } else {
        onShowToast('Đã xóa khỏi danh sách (file vẫn giữ lại)')
      }
    } else {
      onShowToast('Không thể xóa')
    }
  }

  if (videos.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        padding: '40px 20px',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: `${colors.success}10`,
          border: `1px solid ${colors.success}15`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={`${colors.success}44`} strokeWidth="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>Chưa có video đã render</div>
          <div style={{ fontSize: 9, color: colors.borderHover }}>Video sẽ xuất hiện ở đây sau khi render xong</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {videos.map((video) => {
        const isSelected = video.id === selectedId
        const thumbSrc = resolveThumb(video)

        return (
          <div
            key={video.id}
            onClick={() => onSelect(video.id)}
            style={{
              display: 'flex',
              gap: 10,
              padding: '8px 12px',
              cursor: 'pointer',
              borderBottom: `1px solid ${colors.borderLight}`,
              background: isSelected ? `${colors.success}0D` : 'transparent',
              borderLeft: isSelected ? `2px solid ${colors.success}` : '2px solid transparent',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = colors.surfaceHover
            }}
            onMouseLeave={e => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            {/* Thumbnail */}
            <div style={{
              width: 48, height: 48, borderRadius: 4,
              background: colors.bg,
              flexShrink: 0, overflow: 'hidden',
              border: isSelected ? `1px solid ${colors.success}33` : `1px solid ${colors.border}`,
              position: 'relative',
            }}>
              {thumbSrc ? (
                <img
                  src={thumbSrc}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { (e.target as HTMLElement).style.display = 'none' }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.textTertiary} strokeWidth="1.5">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
              )}
              <div style={{
                position: 'absolute', bottom: 2, right: 2,
                background: 'rgba(0,0,0,0.8)',
                borderRadius: 2, padding: '1px 3px',
                fontSize: 7, fontWeight: 700, color: colors.textSecondary,
                fontFamily: 'monospace',
              }}>
                {formatDuration(video.duration)}
              </div>
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, fontWeight: 600,
                color: isSelected ? colors.text : colors.textSecondary,
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', lineHeight: 1.3,
              }}>
                {video.videoTitle || 'Untitled'}
              </div>
              <div style={{
                fontSize: 8, color: colors.textTertiary,
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', marginTop: 2,
              }}>
                {video.channelName}
              </div>
              {/* Tags row */}
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 7, fontWeight: 700,
                  color: colors.accent, background: `${colors.accent}12`,
                  border: `1px solid ${colors.accent}22`,
                  borderRadius: 2, padding: '1px 4px',
                  fontFamily: 'monospace',
                }}>
                  {video.quality}p
                </span>
                <span style={{
                  fontSize: 7, fontWeight: 700,
                  color: colors.accent, background: `${colors.accent}12`,
                  border: `1px solid ${colors.accent}22`,
                  borderRadius: 2, padding: '1px 4px',
                  fontFamily: 'monospace', textTransform: 'uppercase',
                }}>
                  {video.codec}
                </span>
                <span style={{
                  fontSize: 7, fontWeight: 600,
                  color: colors.textTertiary, fontFamily: 'monospace',
                }}>
                  {video.fileSize}
                </span>
                {video.renderDurationMs != null && video.renderDurationMs > 0 && (
                  <span style={{
                    fontSize: 7, fontWeight: 700,
                    color: colors.success, background: `${colors.success}12`,
                    border: `1px solid ${colors.success}22`,
                    borderRadius: 2, padding: '1px 4px',
                    fontFamily: 'monospace',
                  }}>
                    ⚡ {formatRenderTime(video.renderDurationMs)}
                  </span>
                )}
                {onCompare && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onCompare(video.workspaceId) }}
                    style={{
                      fontSize: 7, fontWeight: 700,
                      color: colors.accent, background: `${colors.accent}10`,
                      border: `1px solid ${colors.accent}28`,
                      borderRadius: 2, padding: '1px 6px',
                      cursor: 'pointer', letterSpacing: '0.04em',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${colors.accent}20` }}
                    onMouseLeave={e => { e.currentTarget.style.background = `${colors.accent}10` }}
                  >
                    ↔ SO SÁNH
                  </button>
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => handleOpenFolder(video.id)}
                title="Mở thư mục"
                style={{
                  width: 24, height: 24,
                  background: `${colors.success}08`,
                  border: `1px solid ${colors.success}22`,
                  borderRadius: 4, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${colors.success}20`; e.currentTarget.style.borderColor = `${colors.success}44` }}
                onMouseLeave={e => { e.currentTarget.style.background = `${colors.success}08`; e.currentTarget.style.borderColor = `${colors.success}22` }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={colors.success} strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <button
                onClick={() => handleRemove(video.id)}
                title="Xóa khỏi danh sách (file vẫn giữ lại trên ổ cứng)"
                style={{
                  width: 24, height: 24,
                  background: 'transparent',
                  border: `1px solid ${colors.error}18`,
                  borderRadius: 4, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${colors.error}12`; e.currentTarget.style.borderColor = `${colors.error}44` }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = `${colors.error}18` }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={colors.error} strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
