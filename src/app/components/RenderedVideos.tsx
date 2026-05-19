'use client'

import { useState, useEffect } from 'react'
import type { RenderedVideo } from '../types'
import { ipc } from '../lib/ipc'

interface Props {
  videos: RenderedVideo[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onShowToast: (msg: string) => void
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

export function RenderedVideos({ videos, selectedId, onSelect, onRemove, onShowToast }: Props) {
  // Cache for local-video:// thumbnails that need blob conversion
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
            const base64 = await blobToBase64(blob)
            if (base64) {
              setLocalThumbCache(prev => ({ ...prev, [video.id]: base64 }))
            }
          }
        }).catch(() => {})
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos])

  // Convert JPEG blob to base64 data URL
  async function blobToBase64(blob: Uint8Array): Promise<string | null> {
    try {
      const bin = String.fromCharCode(...blob)
      return 'data:image/jpeg;base64,' + btoa(bin)
    } catch { return null }
  }

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
      onShowToast('Cannot open folder')
    }
  }

  const handleRemove = async (id: string) => {
    const result = await ipc.removeRenderedVideo(id)
    if (result?.success) {
      onRemove(id)
      if (result.bytesFreed > 0) {
        const freedMB = (result.bytesFreed / 1024 / 1024).toFixed(1)
        onShowToast(`Deleted (${freedMB} MB freed)`)
      } else {
        onShowToast('Đã xóa khỏi danh sách (file vẫn giữ lại)')
      }
    } else {
      onShowToast('Failed to remove')
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
          background: 'linear-gradient(135deg, #00FF8810, #00FF8805)',
          border: '1px solid #00FF8815',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00FF8844" strokeWidth="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#444', marginBottom: 4 }}>Chưa có video đã render</div>
          <div style={{ fontSize: 9, color: '#2A2A2A' }}>Video sẽ xuất hiện ở đây sau khi render xong</div>
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
              borderBottom: '1px solid #161616',
              background: isSelected ? 'rgba(0, 255, 136, 0.05)' : 'transparent',
              borderLeft: isSelected ? '2px solid #00FF88' : '2px solid transparent',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#1A1A1A'
            }}
            onMouseLeave={e => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            {/* Thumbnail */}
            <div style={{
              width: 48, height: 48, borderRadius: 4,
              background: '#1A1A1A',
              flexShrink: 0, overflow: 'hidden',
              border: isSelected ? '1px solid #00FF8833' : '1px solid #222',
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
              )}
              {/* Duration badge */}
              <div style={{
                position: 'absolute', bottom: 2, right: 2,
                background: 'rgba(0,0,0,0.8)',
                borderRadius: 2, padding: '1px 3px',
                fontSize: 7, fontWeight: 700, color: '#ccc',
                fontFamily: 'monospace',
              }}>
                {formatDuration(video.duration)}
              </div>
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, fontWeight: 600,
                color: isSelected ? '#fff' : '#999',
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', lineHeight: 1.3,
              }}>
                {video.videoTitle || 'Untitled'}
              </div>
              <div style={{
                fontSize: 8, color: '#555',
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', marginTop: 2,
              }}>
                {video.channelName}
              </div>
              {/* Tags row */}
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {/* Quality */}
                <span style={{
                  fontSize: 7, fontWeight: 700,
                  color: '#00B4FF', background: '#00B4FF12',
                  border: '1px solid #00B4FF22',
                  borderRadius: 2, padding: '1px 4px',
                  fontFamily: 'monospace',
                }}>
                  {video.quality}p
                </span>
                {/* Codec */}
                <span style={{
                  fontSize: 7, fontWeight: 700,
                  color: '#7C3AED', background: '#7C3AED12',
                  border: '1px solid #7C3AED22',
                  borderRadius: 2, padding: '1px 4px',
                  fontFamily: 'monospace', textTransform: 'uppercase',
                }}>
                  {video.codec}
                </span>
                {/* File size */}
                <span style={{
                  fontSize: 7, fontWeight: 600,
                  color: '#666', fontFamily: 'monospace',
                }}>
                  {video.fileSize}
                </span>
                {/* Render time */}
                {video.renderDurationMs != null && video.renderDurationMs > 0 && (
                  <span style={{
                    fontSize: 7, fontWeight: 700,
                    color: '#00FF88', background: '#00FF8812',
                    border: '1px solid #00FF8822',
                    borderRadius: 2, padding: '1px 4px',
                    fontFamily: 'monospace',
                  }}>
                    ⚡ {formatRenderTime(video.renderDurationMs)}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => handleOpenFolder(video.id)}
                title="Open folder"
                style={{
                  width: 24, height: 24,
                  background: '#00FF8808',
                  border: '1px solid #00FF8822',
                  borderRadius: 4, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#00FF8820'; e.currentTarget.style.borderColor = '#00FF8844' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#00FF8808'; e.currentTarget.style.borderColor = '#00FF8822' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#00FF88" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <button
                onClick={() => handleRemove(video.id)}
                title="Xóa khỏi danh sách (file vẫn giữ lại trên ổ cứng)"
                style={{
                  width: 24, height: 24,
                  background: 'transparent',
                  border: '1px solid #FF444418',
                  borderRadius: 4, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#FF444412'; e.currentTarget.style.borderColor = '#FF444444' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#FF444418' }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FF4444" strokeWidth="2">
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
