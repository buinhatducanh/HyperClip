'use client'

import { useState, useEffect } from 'react'
import type { RenderedVideo } from '../types'
import { ipc } from '../lib/ipc'

interface Props {
  videos: RenderedVideo[]
  onRemove: (id: string) => void
  onShowToast: (msg: string) => void
}

export function RenderedVideos({ videos, onRemove, onShowToast }: Props) {
  // Cache for local-video:// thumbnails that need blob conversion
  const [localThumbCache, setLocalThumbCache] = useState<Record<string, string>>({})

  useEffect(() => {
    videos.forEach((video) => {
      if (
        video.thumbnail.startsWith('local-video://') &&
        !video.thumbnailData &&
        !localThumbCache[video.id]
      ) {
        // Only try blob if no thumbnailData embedded — workspace may have been deleted
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
    // Priority: 1. embedded base64 (survives workspace deletion) 2. blob cache 3. YouTube URL
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
      onShowToast('Removed from list')
    } else {
      onShowToast('Failed to remove')
    }
  }

  if (videos.length === 0) {
    return (
      <div style={{
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        borderTop: '1px solid #1A1A1A',
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1E1E1E" strokeWidth="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ fontSize: 10, color: '#2A2A2A', textAlign: 'center' }}>
          No rendered videos yet
        </span>
      </div>
    )
  }

  return (
    <div style={{
      borderTop: '1px solid #1A1A1A',
      padding: '8px 0',
    }}>
      {/* Section header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 12px',
        gap: 8,
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#00FF88" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ fontSize: 9, fontWeight: 800, color: '#00FF88', letterSpacing: '0.1em' }}>
          RENDERED
        </span>
        <span style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>
          · {videos.length}
        </span>
      </div>

      {/* Video list */}
      {videos.map((video) => (
        <div
          key={video.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            cursor: 'pointer',
            borderBottom: '1px solid #161616',
            transition: 'background 0.1s',
          }}
          onClick={(e) => { e.stopPropagation(); handleOpenFolder(video.id) }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1A1A1A' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          {/* Thumbnail */}
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 3,
            background: '#1A1A1A',
            flexShrink: 0,
            overflow: 'hidden',
            border: '1px solid #222',
          }}>
            {video.thumbnail ? (
              <img
                src={resolveThumb(video)}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLElement).style.display = 'none' }}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#888',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.3,
            }}>
              {video.videoTitle || 'Untitled'}
            </div>
            <div style={{
              fontSize: 8,
              color: '#444',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 1,
            }}>
              {video.channelName} · {video.quality}p {video.codec?.toUpperCase()} · {video.fileSize}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => handleOpenFolder(video.id)}
              title="Open folder"
              style={{
                width: 22, height: 22,
                background: 'transparent',
                border: '1px solid #222',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <button
              onClick={() => handleRemove(video.id)}
              title="Remove from list"
              style={{
                width: 22, height: 22,
                background: 'transparent',
                border: '1px solid #FF444422',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FF4444" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
