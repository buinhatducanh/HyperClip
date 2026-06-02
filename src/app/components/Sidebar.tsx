'use client'

import { useState, useCallback, useMemo, memo } from 'react'
import { shallow } from 'zustand/shallow'
import type { Channel, SystemStats } from '../types'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../lib/store'
import { VideoCompareModal } from './VideoCompareModal'
import { SkeletonChannelItem } from './Skeleton'
import { DetectionStatusBar } from './DetectionStatusBar'
import { ConfirmationDialog } from './ConfirmationDialog'
import { colors, spacing, fontSize } from '../design-system/tokens'

interface Props {
  channels: Channel[]
  isLoadingChannels?: boolean
  activeChannelId: string
  newCounts: Record<string, number>
  onChannelSelect: (id: string) => void
  systemStats?: SystemStats
  authStatus?: {
    isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string
    oauthReady?: boolean; quotaExceeded?: boolean
  }
  onLogout?: () => void
  keyHealth?: { exhausted: number; unauthorized: number }
}

function AvatarRound({ url, name, color }: { url: string; name: string; color: string }) {
  const [failed, setFailed] = useState(false)
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
      src={url} alt={name}
      width={28} height={28}
      style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1px solid ${color}44` }}
      onError={() => setFailed(true)}
    />
  )
}

export const Sidebar = memo(function Sidebar({
  channels, isLoadingChannels, activeChannelId, newCounts,
  onChannelSelect, authStatus, keyHealth,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [channelInput, setChannelInput] = useState('')
  const [addingChannel, setAddingChannel] = useState(false)
  const [channelError, setChannelError] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel?: string; confirmDanger?: boolean; onConfirm: () => void
  } | null>(null)
  const showToast = useAppStore((s) => s.showToast)
  const workspaces = useAppStore((s) => s.workspaces, shallow)
  const renderedVideos = useAppStore((s) => s.renderedVideos, shallow)

  const [compareWorkspaceId, setCompareWorkspaceId] = useState<string | null>(null)
  const compareWorkspace = useMemo(() => workspaces.find(w => w.id === compareWorkspaceId) ?? null, [workspaces, compareWorkspaceId])
  const compareRendered = useMemo(() => compareWorkspaceId ? renderedVideos.find(v => v.workspaceId === compareWorkspaceId) ?? null : null, [renderedVideos, compareWorkspaceId])

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
      } else { setChannelError('Could not add channel. Check the URL.'); showToast('Không thể thêm kênh') }
    } catch (e: any) { setChannelError(e?.message || 'Unknown error'); showToast('Lỗi khi thêm kênh') }
    finally { setAddingChannel(false) }
  }, [channelInput, showToast])

  const sidebarW = expanded ? 220 : 56

  return (
    <div
      style={{
        width: sidebarW, display: 'flex', flexDirection: 'column', height: '100%',
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.15s ease',
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo — always visible */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: spacing.sm,
        padding: expanded ? `0 ${spacing.md}px` : '0',
        justifyContent: expanded ? 'flex-start' : 'center',
        height: 44,
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: colors.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <polygon points="8,5 19,12 8,19" />
          </svg>
        </div>
        {expanded && (
          <span style={{ fontSize: fontSize.sm, fontWeight: 700, color: colors.text, letterSpacing: '0.04em' }}>
            HyperClip
          </span>
        )}
      </div>

      {/* Detection bar */}
      <DetectionStatusBar />

      {/* Channel list */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Add channel — icon only when collapsed */}
        <div style={{
          padding: expanded ? `${spacing.sm}px ${spacing.sm}px` : `${spacing.xs}px`,
          borderBottom: `1px solid ${colors.borderLight}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: expanded ? 'flex-start' : 'center' }}>
            <input
              id="add-channel-input"
              type="text"
              placeholder={expanded ? 'URL or @handle' : ''}
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !addingChannel && channelInput.trim()) handleAddChannel() }}
              style={{
                flex: expanded ? 1 : 0, width: expanded ? 'auto' : 0,
                height: 28, padding: expanded ? '0 8px' : '0',
                background: colors.bg,
                border: channelError ? `1px solid ${colors.error}` : `1px solid ${colors.border}`,
                borderRadius: 4, color: colors.text,
                fontSize: 11, fontFamily: 'monospace',
                outline: 'none', opacity: expanded ? 1 : 0,
              }}
            />
            <button
              onClick={handleAddChannel}
              disabled={addingChannel || !channelInput.trim()}
              title="Add channel"
              style={{
                width: 28, height: 28, flexShrink: 0,
                background: channelInput.trim() ? colors.accent : colors.bg,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                color: channelInput.trim() ? colors.text : colors.textSecondary,
                fontSize: 14, fontWeight: 700,
                cursor: addingChannel ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {addingChannel ? '…' : '+'}
            </button>
          </div>
          {channelError && expanded && (
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.borderHover} strokeWidth="1.5">
                <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14v-4z" />
                <rect x="3" y="6" width="12" height="12" rx="2" ry="2" />
              </svg>
              {expanded && (
                <span style={{ fontSize: 11, color: colors.textTertiary, textAlign: 'center', lineHeight: 1.5 }}>
                  Paste a YouTube channel URL<br />or @username above
                </span>
              )}
            </div>
          ) : channels.map(ch => {
            const isActiveCh = ch.id === activeChannelId
            const count = newCounts[ch.id] ?? 0
            return (
              <div key={ch.id}>
                <div
                  onClick={() => onChannelSelect(ch.channelId || ch.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: expanded ? `${spacing.sm}px ${spacing.md}px` : `${spacing.sm}px`,
                    justifyContent: expanded ? 'flex-start' : 'center',
                    background: isActiveCh ? `${colors.accent}0a` : 'transparent',
                    borderLeft: isActiveCh ? `2px solid ${colors.accent}` : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => { if (!isActiveCh) e.currentTarget.style.background = colors.surfaceHover }}
                  onMouseLeave={e => { if (!isActiveCh) e.currentTarget.style.background = 'transparent' }}
                >
                  {ch.avatarUrl ? (
                    <AvatarRound url={ch.avatarUrl} name={ch.name} color={ch.avatarColor} />
                  ) : (
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: `${ch.avatarColor}22`, border: `1px solid ${ch.avatarColor}44`,
                      fontSize: 11, fontWeight: 700, color: ch.avatarColor,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {ch.name.charAt(0)}
                    </div>
                  )}

                  {expanded && (
                    <>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, color: ch.paused ? colors.textTertiary : colors.text,
                          fontWeight: isActiveCh ? 600 : 400,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {ch.name}
                        </div>
                      </div>
                      {count > 0 && (
                        <div style={{
                          minWidth: 16, height: 16, borderRadius: 8,
                          background: colors.accent, fontSize: 9, fontWeight: 800, color: colors.text,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0,
                        }}>
                          {count}
                        </div>
                      )}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          await (ch.paused ? ipc.resumeChannel(ch.id) : ipc.pauseChannel(ch.id))
                          showToast(`${ch.paused ? 'Đã tiếp tục' : 'Đã tạm dừng'}: ${ch.name}`)
                          if ((window as any).__reloadChannels) (window as any).__reloadChannels()
                        }}
                        title={ch.paused ? `Tiếp tục ${ch.name}` : `Tạm dừng ${ch.name}`}
                        style={{
                          width: 18, height: 18, flexShrink: 0, opacity: 0,
                          background: 'transparent', border: 'none', borderRadius: 3,
                          color: colors.textSecondary, cursor: 'pointer', fontSize: 11,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = colors.warning }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.color = colors.textSecondary }}
                      >
                        {ch.paused ? '▶' : '⏸'}
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          setConfirmDialog({
                            title: 'Xóa kênh',
                            message: `Bạn có chắc muốn xóa "${ch.name}"?`,
                            confirmLabel: 'Xóa', confirmDanger: true,
                            onConfirm: async () => { setConfirmDialog(null); await useAppStore.getState().removeChannel(ch.id) },
                          })
                        }}
                        title={`Xóa "${ch.name}"`}
                        style={{
                          width: 18, height: 18, flexShrink: 0, opacity: 0,
                          background: 'transparent', border: 'none', borderRadius: 3,
                          color: colors.textSecondary, cursor: 'pointer', fontSize: 14,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = colors.error }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.color = colors.textSecondary }}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <ConfirmationDialog
        open={confirmDialog !== null} title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''} confirmLabel={confirmDialog?.confirmLabel}
        confirmDanger={confirmDialog?.confirmDanger}
        onConfirm={confirmDialog?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmDialog(null)}
      />
      {compareWorkspaceId && (
        <VideoCompareModal workspace={compareWorkspace} rendered={compareRendered} onClose={() => setCompareWorkspaceId(null)} />
      )}
    </div>
  )
})
