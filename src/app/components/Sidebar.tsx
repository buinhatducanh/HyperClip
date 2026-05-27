'use client'
import { colors, spacing, fontSize } from '../design-system/tokens'

import { useState, useCallback, useMemo } from 'react'
import type { Channel, SystemStats } from '../types'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../lib/store'
import { VideoCompareModal } from './VideoCompareModal'
import { SkeletonChannelItem } from './Skeleton'
import { DetectionStatusBar } from './DetectionStatusBar'
import { ConfirmationDialog } from './ConfirmationDialog'

interface Props {
  channels: Channel[]
  isLoadingChannels?: boolean
  activeChannelId: string
  newCounts: Record<string, number>
  onChannelSelect: (id: string) => void
  systemStats?: SystemStats
  authStatus?: {
    isReady: boolean
    cookieCount: number
    loggedOut: boolean
    accountName: string
    oauthReady?: boolean
    quotaExceeded?: boolean
  }
  pollerStatus?: { active: boolean; newVideoCount: number; lastError: string | null } | null
  onLogout?: () => void
  keyHealth?: { exhausted: number; unauthorized: number }
}

function AvatarWithFallback({ url, name, color }: { url: string; name: string; color: string }) {
  const [failed, setFailed] = useState(false)
  const handleError = useCallback(() => setFailed(true), [])
  if (failed || !url) {
    return (
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: `${color}22`, border: `1px solid ${color}44`,
        fontSize: 11, fontWeight: 700, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {name.charAt(0)}
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={name}
      width={28}
      height={28}
      style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1px solid ${color}44` }}
      onError={handleError}
    />
  )
}

export function Sidebar({
  channels, isLoadingChannels, activeChannelId, newCounts,
  onChannelSelect,
  authStatus,
  pollerStatus,
  keyHealth,
}: Props) {
  /** Add channel input */
  const [channelInput, setChannelInput] = useState('')
  const [addingChannel, setAddingChannel] = useState(false)
  const [channelError, setChannelError] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel?: string; confirmDanger?: boolean; onConfirm: () => void
  } | null>(null)
  const showToast = useAppStore((s) => s.showToast)
  const workspaces = useAppStore((s) => s.workspaces)
  const renderedVideos = useAppStore((s) => s.renderedVideos)

  // ── Video compare ──────────────────────────────────────────────────────────────
  const [compareWorkspaceId, setCompareWorkspaceId] = useState<string | null>(null)
  const compareWorkspace = useMemo(
    () => workspaces.find(w => w.id === compareWorkspaceId) ?? null,
    [workspaces, compareWorkspaceId]
  )
  const compareRendered = useMemo(
    () => compareWorkspaceId ? renderedVideos.find(v => v.workspaceId === compareWorkspaceId) ?? null : null,
    [renderedVideos, compareWorkspaceId]
  )

  /** Add a YouTube channel — called from the Add Channel bar */
  const handleAddChannel = useCallback(async () => {
    const url = channelInput.trim()
    if (!url) return
    setAddingChannel(true)
    setChannelError('')
    try {
      const result = await ipc.addChannel(url)
      if (result) {
        setChannelInput('')
        showToast(`✓ Đã thêm: ${(result as any).name || url}`)
        if ((window as any).__reloadChannels) (window as any).__reloadChannels()
      } else {
        setChannelError('Could not add channel. Check the URL.')
        showToast('Không thể thêm kênh')
      }
    } catch (e: any) {
      setChannelError(e?.message || 'Unknown error')
      showToast('Lỗi khi thêm kênh')
    } finally {
      setAddingChannel(false)
    }
  }, [channelInput, showToast])

  return (
    <div
      style={{
        width: 180, display: 'flex', flexDirection: 'column', height: '100%',
        background: '#161616', borderRight: '1px solid #1E1E1E', flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Brand bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 40, borderBottom: '1px solid #1E1E1E', flexShrink: 0 }}>
        {/* HyperClip logo: 3D play button */}
        <svg width="16" height="16" viewBox="0 0 512 512" style={{ flexShrink: 0 }}>
          <defs>
            <linearGradient id="sbgg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#111118"/>
              <stop offset="100%" stopColor="#060610"/>
            </linearGradient>
            <radialGradient id="sglass" cx="38%" cy="32%" r="68%">
              <stop offset="0%" stopColor="#1e4060"/>
              <stop offset="100%" stopColor="#061224"/>
            </radialGradient>
            <linearGradient id="srim" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#44CCFF"/>
              <stop offset="100%" stopColor="#0066AA"/>
            </linearGradient>
            <filter id="ssg">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <rect width="512" height="512" rx="92" fill="url(#sbgg)"/>
          <circle cx="256" cy="251" r="184" fill="#000000" opacity="0.5"/>
          <circle cx="256" cy="246" r="184" fill="url(#sglass)"/>
          <circle cx="256" cy="246" r="184" fill="none" stroke="url(#srim)" strokeWidth="13" filter="url(#ssg)"/>
          <polygon points="220,174 342,246 220,318" fill="#00FF88"/>
          <text x="256" y="471" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="38" fontWeight="800" fill="#00B4FF" opacity="0.65" letterSpacing="8">HC</text>
        </svg>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', flex: 1 }}>HyperClip</span>
        {keyHealth && (keyHealth.exhausted > 0 || keyHealth.unauthorized > 0) && (
          <div
            onClick={() => { window.location.href = '/settings' }}
            title={`${keyHealth.exhausted} exhausted, ${keyHealth.unauthorized} unauthorized`}
            style={{
              minWidth: 16, height: 16, borderRadius: 8,
              background: colors.error,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 4px', flexShrink: 0, cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 8, fontWeight: 800, color: '#fff' }}>
              {keyHealth.exhausted + keyHealth.unauthorized}
            </span>
          </div>
        )}
        <a href="/settings" title="Settings" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 3, color: '#444', textDecoration: 'none' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </a>
      </div>

      {/* Detection status strip */}
      <DetectionStatusBar />

      {/* Channel list */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Add Channel bar — always visible */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #1A1A1A', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              id="add-channel-input"
              type="text"
              placeholder="URL or @handle"
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !addingChannel && channelInput.trim()) handleAddChannel()
              }}
              style={{
                flex: 1, height: 28, padding: '0 8px',
                background: '#0D0D0D', border: channelError ? '1px solid #FF4444' : '1px solid #222',
                borderRadius: 4, color: '#fff',
                fontSize: 11, fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <button
              onClick={handleAddChannel}
              disabled={addingChannel || !channelInput.trim()}
              title="Add channel"
              style={{
                width: 28, height: 28, flexShrink: 0,
                background: addingChannel ? '#1A3A1A' : channelInput.trim() ? colors.accent : colors.text,
                border: 'none', borderRadius: 4,
                color: addingChannel ? colors.success : channelInput.trim() ? '#000' : '#333',
                fontSize: 14, fontWeight: 700, cursor: addingChannel ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {addingChannel ? '…' : '+'}
            </button>
          </div>
          {channelError && (
            <div style={{ fontSize: 10, color: colors.error, marginTop: 3, lineHeight: 1.3 }}>
              {channelError}
            </div>
          )}
        </div>

        {/* Channel items */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isLoadingChannels ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonChannelItem key={i} />)
          ) : channels.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 12px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#222" strokeWidth="1.5">
                <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14v-4z" />
                <rect x="3" y="6" width="12" height="12" rx="2" ry="2" />
              </svg>
              <span style={{ fontSize: 11, color: '#2A2A2A', textAlign: 'center', lineHeight: 1.5 }}>
                Paste a YouTube channel URL<br />or @username above
              </span>
            </div>
          ) : channels
            .map(ch => {
              const isActiveCh = ch.id === activeChannelId
              const count = newCounts[ch.id] ?? 0

              return (
                <div key={ch.id}>
                  <div
                    onClick={() => onChannelSelect(ch.channelId || ch.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px',
                      background: isActiveCh ? 'rgba(0,180,255,0.07)' : 'transparent',
                      borderLeft: isActiveCh ? '2px solid #00B4FF' : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => { if (!isActiveCh) e.currentTarget.style.background = colors.text }}
                    onMouseLeave={e => { if (!isActiveCh) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Avatar */}
                    {ch.avatarUrl ? (
                      <AvatarWithFallback url={ch.avatarUrl} name={ch.name} color={ch.avatarColor} />
                    ) : (
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: `${ch.avatarColor}22`, border: `1px solid ${ch.avatarColor}44`,
                        fontSize: 11, fontWeight: 700, color: ch.avatarColor,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {ch.name.charAt(0)}
                      </div>
                    )}

                    {/* Name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, color: ch.paused ? '#555' : isActiveCh ? '#fff' : '#888',
                        fontWeight: isActiveCh ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ch.name}
                      </div>
                    </div>

                    {/* New count badge */}
                    {count > 0 && (
                      <div style={{
                        minWidth: 16, height: 16, borderRadius: 8,
                        background: colors.accent, fontSize: 9, fontWeight: 800, color: '#000',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0,
                      }}>
                        {count}
                      </div>
                    )}

                    {/* Pause / Resume button */}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (ch.paused) {
                          await ipc.resumeChannel(ch.id)
                          showToast(`Đã tiếp tục: ${ch.name}`)
                        } else {
                          await ipc.pauseChannel(ch.id)
                          showToast(`Đã tạm dừng: ${ch.name}`)
                        }
                        if ((window as any).__reloadChannels) (window as any).__reloadChannels()
                      }}
                      title={ch.paused ? `Tiếp tục ${ch.name}` : `Tạm dừng ${ch.name}`}
                      style={{
                        width: 18, height: 18, flexShrink: 0, opacity: 0,
                        background: 'transparent', border: 'none', borderRadius: 3,
                        color: '#555', cursor: 'pointer', fontSize: 11,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = colors.warning }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.color = '#555' }}
                    >
                      {ch.paused ? '▶' : '⏸'}
                    </button>

                    {/* Delete channel button */}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        setConfirmDialog({
                          title: 'Xóa kênh',
                          message: `Bạn có chắc muốn xóa "${ch.name}" khỏi danh sách theo dõi?`,
                          confirmLabel: 'Xóa',
                          confirmDanger: true,
                          onConfirm: async () => {
                            setConfirmDialog(null)
                            await useAppStore.getState().removeChannel(ch.id)
                          },
                        })
                      }}
                      title={`Xóa "${ch.name}"`}
                      style={{
                        width: 18, height: 18, flexShrink: 0, opacity: 0,
                        background: 'transparent', border: 'none', borderRadius: 3,
                        color: '#555', cursor: 'pointer', fontSize: 14,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = colors.error }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.color = '#555' }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {/* Confirmation dialog for destructive actions */}
      <ConfirmationDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmDanger={confirmDialog?.confirmDanger}
        onConfirm={confirmDialog?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* Video compare modal */}
      {compareWorkspaceId && (
        <VideoCompareModal
          workspace={compareWorkspace}
          rendered={compareRendered}
          onClose={() => setCompareWorkspaceId(null)}
        />
      )}
    </div>
  )
}
