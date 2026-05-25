'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { Channel, SystemStats } from '../types'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../lib/store'
import { VideoCompareModal } from './VideoCompareModal'
import { SkeletonChannelItem } from './Skeleton'
import { DetectionStatusBar } from './DetectionStatusBar'
import { ActivityLog, type ActivityEntry } from './ActivityLog'
import { ConfirmationDialog } from './ConfirmationDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'

/** Pending setting change waiting for user confirmation */
interface PendingChange {
  label: string
  patch: Partial<AppSettings>
}

interface AppSettings {
  defaultTrimLimit: number | 'full'
  autoDownloadQuality: string
  autoRender: boolean
  autoRenderResolution: string
  autoRenderFPS: number
}

interface Props {
  channels: Channel[]
  isLoadingChannels?: boolean
  activeChannelId: string
  newCounts: Record<string, number>
  onChannelSelect: (id: string) => void
  systemStats: SystemStats
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
  settings?: AppSettings
  onSettingsChange?: (patch: Partial<AppSettings>) => void
  activityEntries?: ActivityEntry[]
  etaDisplay?: Map<string, string>
}

function AvatarWithFallback({ url, name, color }: { url: string; name: string; color: string }) {
  const [failed, setFailed] = useState(false)
  const handleError = useCallback(() => setFailed(true), [])
  if (failed || !url) {
    return (
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        background: `${color}22`, border: `1px solid ${color}44`,
        fontSize: 10, fontWeight: 700, color,
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
      width={24}
      height={24}
      style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1px solid ${color}44` }}
      onError={handleError}
    />
  )
}

/** Compact path row for Storage panel */
function StorageRow({ label, path, onOpen, onChange }: { label: string; path: string; onOpen: () => void; onChange: () => void }) {
  const short = path.length > 30 ? '…' + path.slice(-28) : path
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        <span style={{ fontSize: 7, color: '#00B4FF55', fontWeight: 800, letterSpacing: '0.06em', flexShrink: 0, width: 20 }}>{label}</span>
        <span
          title={path}
          style={{ flex: 1, fontSize: 8, color: '#555', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}
        >
          {short}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          onClick={onOpen}
          title="Mở thư mục"
          style={{ height: 28, paddingLeft: 8, paddingRight: 8, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, fontSize: 9, fontWeight: 600, color: '#666', cursor: 'pointer', flex: 1 }}
        >Mở</button>
        <button
          onClick={onChange}
          title="Đổi đường dẫn"
          style={{ height: 28, paddingLeft: 8, paddingRight: 8, background: '#1A1A1A', border: '1px solid #00B4FF33', borderRadius: 3, fontSize: 9, fontWeight: 700, color: '#00B4FF', cursor: 'pointer', flex: 1 }}
        >Đổi</button>
      </div>
    </div>
  )
}

export function Sidebar({
  channels, isLoadingChannels, activeChannelId, newCounts,
  onChannelSelect,
  systemStats,
  authStatus,
  pollerStatus,
  onLogout,
  keyHealth,
  settings,
  onSettingsChange,
  activityEntries = [],
  etaDisplay,
}: Props) {
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  /** Input value for trim — tracks user edits before Enter */
  const [trimInput, setTrimInput] = useState<number | 'full'>(
    () => settings?.defaultTrimLimit ?? 10
  )
  /** Storage stats */
  const [storageStats, setStorageStats] = useState<{
    downloadPath: string; outputPath: string; downloads: number; blur: number; total: number; freeBytes: number
  } | null>(null)
  const [storageOpen, setStorageOpen] = useState(false)
  const [clearingDl, setClearingDl] = useState(false)
  const [clearingBlr, setClearingBlr] = useState(false)
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
  const renderedWorkspaceIds = useMemo(
    () => new Set(renderedVideos.map(v => v.workspaceId)),
    [renderedVideos]
  )

  const handleCompare = useCallback((workspaceId: string) => {
    setCompareWorkspaceId(workspaceId)
  }, [])

  const ramPct = Math.round((systemStats.ramUsed / systemStats.ramTotal) * 100)
  const gpuShort = systemStats.gpuName ? systemStats.gpuName.split(' ').slice(0, 2).join(' ') : 'GPU'

  /** Queue a setting change for confirmation instead of applying immediately */
  const handleSettingChange = useCallback((label: string, patch: Partial<AppSettings>) => {
    setPendingChange({ label, patch })
  }, [])

  /** Load storage stats on mount and periodically */
  const loadStorageStats = useCallback(async () => {
    try {
      const stats = await ipc.getStorageSize()
      setStorageStats(stats as any)
    } catch {}
  }, [])
  useEffect(() => { loadStorageStats() }, [loadStorageStats])
  useEffect(() => {
    const t = setInterval(loadStorageStats, 30000)
    return () => clearInterval(t)
  }, [loadStorageStats])

  /** Sync trimInput when settings load from backend (overwrites stale mount value) */
  useEffect(() => {
    if (settings?.defaultTrimLimit !== undefined) {
      setTrimInput(settings.defaultTrimLimit)
    }
  }, [settings?.defaultTrimLimit])

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
        // Trigger parent to reload channels so the new one appears immediately
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 48, borderBottom: '1px solid #1E1E1E', flexShrink: 0 }}>
        {/* HyperClip logo: 3D play button */}
        <svg width="22" height="22" viewBox="0 0 512 512" style={{ flexShrink: 0 }}>
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
          {/* Background */}
          <rect width="512" height="512" rx="92" fill="url(#sbgg)"/>
          {/* Button shadow */}
          <circle cx="256" cy="251" r="184" fill="#000000" opacity="0.5"/>
          {/* Button body */}
          <circle cx="256" cy="246" r="184" fill="url(#sglass)"/>
          {/* Button rim */}
          <circle cx="256" cy="246" r="184" fill="none" stroke="url(#srim)" strokeWidth="13" filter="url(#ssg)"/>
          {/* Play triangle */}
          <polygon points="220,174 342,246 220,318" fill="#00FF88"/>
          {/* HC */}
          <text x="256" y="471" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="38" fontWeight="800" fill="#00B4FF" opacity="0.65" letterSpacing="8">HC</text>
        </svg>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', flex: 1 }}>HyperClip</span>
        {/* Key health badge */}
        {keyHealth && (keyHealth.exhausted > 0 || keyHealth.unauthorized > 0) && (
          <div
            onClick={() => { window.location.href = '/settings' }}
            title={`${keyHealth.exhausted} exhausted, ${keyHealth.unauthorized} unauthorized`}
            style={{
              minWidth: 16, height: 16, borderRadius: 8,
              background: '#FF4444',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 4px', flexShrink: 0, cursor: 'pointer',
              boxShadow: '0 0 4px #FF444466',
              transition: 'transform 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            <span style={{ fontSize: 8, fontWeight: 800, color: '#fff' }}>
              {keyHealth.exhausted + keyHealth.unauthorized}
            </span>
          </div>
        )}
        <a href="/settings" title="Settings" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 3, color: '#444', textDecoration: 'none', transition: 'color 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.background = '#1a1a1a' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.background = 'transparent' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </a>
      </div>

      {/* Detection status strip — source · sessions · timing · warning → Settings */}
      <DetectionStatusBar />

      {/* Channel list */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Add Channel bar — always visible */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #1A1A1A', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              id="add-channel-input"
              type="text"
              placeholder="Channel URL or @handle"
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !addingChannel && channelInput.trim()) handleAddChannel()
              }}
              style={{
                flex: 1, height: 24, padding: '0 8px',
                background: '#0D0D0D', border: channelError ? '1px solid #FF4444' : '1px solid #222',
                borderRadius: 4, color: '#fff',
                fontSize: 10, fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <button
              onClick={handleAddChannel}
              disabled={addingChannel || !channelInput.trim()}
              title="Add channel"
              style={{
                width: 24, height: 24, flexShrink: 0,
                background: addingChannel ? '#1A3A1A' : channelInput.trim() ? '#00B4FF' : '#1A1A1A',
                border: 'none', borderRadius: 4,
                color: addingChannel ? '#00FF88' : channelInput.trim() ? '#000' : '#333',
                fontSize: 14, fontWeight: 700, cursor: addingChannel ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s',
              }}
            >
              {addingChannel ? '…' : '+'}
            </button>
          </div>
          {channelError && (
            <div style={{ fontSize: 9, color: '#FF4444', marginTop: 3, lineHeight: 1.4 }}>
              {channelError}
            </div>
          )}
        </div>

        {/* Channel items */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isLoadingChannels ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonChannelItem key={i} />)
          ) : channels.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 16px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#222" strokeWidth="1.5">
                <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14v-4z" />
                <rect x="3" y="6" width="12" height="12" rx="2" ry="2" />
              </svg>
              <span style={{ fontSize: 10, color: '#2A2A2A', textAlign: 'center', lineHeight: 1.5 }}>
                Paste a YouTube channel URL<br />or @username above to start
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
                      padding: '7px 12px',
                      background: isActiveCh ? 'rgba(0,180,255,0.07)' : 'transparent',
                      borderLeft: isActiveCh ? '2px solid #00B4FF' : '2px solid transparent',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!isActiveCh) e.currentTarget.style.background = '#1A1A1A' }}
                    onMouseLeave={e => { if (!isActiveCh) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Avatar */}
                    {ch.avatarUrl ? (
                      <AvatarWithFallback url={ch.avatarUrl} name={ch.name} color={ch.avatarColor} />
                    ) : (
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: `${ch.avatarColor}22`, border: `1px solid ${ch.avatarColor}44`,
                        fontSize: 10, fontWeight: 700, color: ch.avatarColor,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {ch.name.charAt(0)}
                      </div>
                    )}

                    {/* Name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: ch.paused ? '#555' : isActiveCh ? '#fff' : '#888', fontWeight: isActiveCh ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ch.name}
                      </div>
                      {ch.paused && (
                        <div style={{ fontSize: 8, color: '#FFB800', fontWeight: 700, letterSpacing: '0.05em' }}>
                          TẠM DỪNG
                        </div>
                      )}
                    </div>

                    {/* Paused indicator */}
                    {ch.paused && (
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#FFB800', flexShrink: 0,
                        boxShadow: '0 0 4px #FFB80066',
                      }} title="Kênh đang tạm dừng" />
                    )}

                    {/* New count badge */}
                    {count > 0 && (
                      <div style={{
                        minWidth: 16, height: 16, borderRadius: 8,
                        background: '#00B4FF', fontSize: 8, fontWeight: 800, color: '#000',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', flexShrink: 0,
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
                        color: '#555', cursor: 'pointer', fontSize: 10,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#FFB800' }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.color = '#555' }}
                    >
                      {ch.paused ? '▶' : '⏸'}
                    </button>

                    {/* Unsubscribe from YouTube button */}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        setConfirmDialog({
                          title: 'Hủy theo dõi YouTube',
                          message: `Hủy theo dõi "${ch.name}" trên YouTube VÀ xóa khỏi HyperClip? Các video đã tải vẫn được giữ lại.`,
                          confirmLabel: 'Hủy theo dõi',
                          confirmDanger: true,
                          onConfirm: async () => {
                            setConfirmDialog(null)
                            const result = await ipc.unsubscribeChannel(ch.id) as { success: boolean; error?: string }
                            if (result.success) {
                              showToast(`Đã hủy theo dõi: ${ch.name}`)
                            } else {
                              showToast(`Lỗi: ${result.error || 'Không thể hủy theo dõi'}`)
                            }
                            if ((window as any).__reloadChannels) (window as any).__reloadChannels()
                          },
                        })
                      }}
                      title={`Hủy theo dõi ${ch.name} trên YouTube`}
                      style={{
                        width: 18, height: 18, flexShrink: 0, opacity: 0,
                        background: 'transparent', border: 'none', borderRadius: 3,
                        color: '#555', cursor: 'pointer', fontSize: 10,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#FFB800' }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.color = '#555' }}
                    >
                      YT
                    </button>

                    {/* Delete channel button (local tracking only) */}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        setConfirmDialog({
                          title: 'Xóa kênh',
                          message: `Bạn có chắc muốn xóa "${ch.name}" khỏi danh sách theo dõi? Các video đã tải vẫn được giữ lại.`,
                          confirmLabel: 'Xóa',
                          confirmDanger: true,
                          onConfirm: async () => {
                            setConfirmDialog(null)
                            await ipc.removeChannel(ch.id)
                            showToast(`Đã xóa: ${ch.name}`)
                            if ((window as any).__reloadChannels) (window as any).__reloadChannels()
                          },
                        })
                      }}
                      title={`Xóa "${ch.name}" khỏi HyperClip`}
                      style={{
                        width: 18, height: 18, flexShrink: 0, opacity: 0,
                        background: 'transparent', border: 'none', borderRadius: 3,
                        color: '#555', cursor: 'pointer', fontSize: 14,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#FF4444' }}
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

      {/* Activity log — pipeline events */}
      <ActivityLog
        entries={activityEntries}
        etaDisplay={etaDisplay}
        onCompare={handleCompare}
        renderedWorkspaceIds={renderedWorkspaceIds}
      />

      {/* Storage manager */}
      <div style={{ padding: '6px 10px 4px', borderTop: '1px solid #1E1E1E', flexShrink: 0 }}>
        {/* Header — collapsible */}
        <div
          onClick={() => setStorageOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none', marginBottom: storageOpen ? 6 : 0 }}
        >
          <span style={{ fontSize: 8, fontWeight: 800, color: '#2A2A2A', letterSpacing: '0.1em', flex: 1 }}>STORAGE</span>
          {storageStats && (
            <span style={{ fontSize: 8, color: '#00B4FF66', fontFamily: 'monospace' }}>
              {storageStats.downloads > 0 ? `${(storageStats.downloads).toFixed(0)}MB` : ''}
            </span>
          )}
          <svg width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ transform: storageOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', color: '#333' }}>
            <path d="M1 2l2.5 3L6 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {storageOpen && (
          <div>
            {/* Download path */}
            <StorageRow
              label="DL"
              path={storageStats?.downloadPath ?? '…'}
              onOpen={() => storageStats?.downloadPath && ipc.openFolder(storageStats.downloadPath)}
              onChange={async () => {
                const r = await ipc.pickFolder(storageStats?.downloadPath)
                if (r?.path) {
                  await (window.electronAPI as any)?.updateSettings({ videoStoragePath: r.path })
                  showToast('Download path updated — restart app')
                  loadStorageStats()
                }
              }}
            />
            {/* Output path */}
            <StorageRow
              label="OUT"
              path={storageStats?.outputPath ?? '…'}
              onOpen={() => storageStats?.outputPath && ipc.openFolder(storageStats.outputPath)}
              onChange={async () => {
                const r = await ipc.pickFolder(storageStats?.outputPath)
                if (r?.path) {
                  await (window.electronAPI as any)?.updateSettings({ outputPath: r.path })
                  showToast('Output path updated — restart app')
                  loadStorageStats()
                }
              }}
            />
            {/* Disk usage bar */}
            {storageStats && storageStats.downloadPath && (() => {
              const freeGB = storageStats.freeBytes / (1024**3)
              const usedGB = storageStats.downloads
              const totalGB = freeGB + usedGB
              const usedPct = totalGB > 0 ? Math.round((usedGB / totalGB) * 100) : 0
              const isLow = freeGB < 5
              return (
                <div style={{ marginBottom: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontSize: 8, color: isLow ? '#FF4444' : '#555', fontFamily: 'monospace' }}>
                      {usedGB > 0 ? `${usedGB.toFixed(1)}MB` : '—'} used
                    </span>
                    <span style={{ fontSize: 8, color: isLow ? '#FF4444' : '#444', fontFamily: 'monospace' }}>
                      {freeGB.toFixed(0)}GB free
                    </span>
                  </div>
                  <div style={{ height: 3, background: '#1A1A1A', borderRadius: 2 }}>
                    <div style={{
                      width: `${Math.min(usedPct, 100)}%`, height: '100%',
                      background: isLow ? '#FF4444' : (usedPct > 70 ? '#FFB800' : '#00B4FF'),
                      borderRadius: 2, transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>
              )
            })()}
            {/* Quick clear */}
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={async () => {
                  setClearingDl(true)
                  const r = await ipc.clearDownloads()
                  setClearingDl(false)
                  if (r.success) { showToast(`Freed ${r.freedMB}MB`); loadStorageStats() }
                  else showToast('Clear failed')
                }}
                disabled={clearingDl || !storageStats || storageStats.downloads === 0}
                style={{
                  flex: 1, height: 28, fontSize: 9, fontWeight: 700,
                  background: 'transparent',
                  border: '1px solid #222',
                  borderRadius: 3, cursor: 'pointer',
                  color: '#555', letterSpacing: '0.04em',
                  opacity: (clearingDl || !storageStats || storageStats.downloads === 0) ? 0.4 : 1,
                }}
              >
                {clearingDl ? '…' : 'Xóa DL'}
              </button>
              <button
                onClick={async () => {
                  setClearingBlr(true)
                  const r = await ipc.clearBlur()
                  setClearingBlr(false)
                  if (r.success) { showToast(`Cleared blur`); loadStorageStats() }
                }}
                disabled={clearingBlr || !storageStats || storageStats.blur === 0}
                style={{
                  flex: 1, height: 28, fontSize: 9, fontWeight: 700,
                  background: 'transparent',
                  border: '1px solid #222',
                  borderRadius: 3, cursor: 'pointer',
                  color: '#555', letterSpacing: '0.04em',
                  opacity: (clearingBlr || !storageStats || storageStats.blur === 0) ? 0.4 : 1,
                }}
              >
                {clearingBlr ? '…' : 'Xóa BLR'}
              </button>
              <button
                onClick={() => window.location.href = '/settings'}
                title="Cài đặt"
                style={{
                  height: 28, paddingLeft: 6, paddingRight: 6,
                  background: 'transparent',
                  border: '1px solid #222',
                  borderRadius: 3, cursor: 'pointer',
                  color: '#333', fontSize: 8, fontWeight: 700,
                }}
              >
                ⚙
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Download settings */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #1E1E1E', flexShrink: 0 }}>
        <div style={{ fontSize: 8, fontWeight: 800, color: '#2A2A2A', letterSpacing: '0.1em', marginBottom: 6 }}>DOWNLOAD</div>

        {/* Trim limit — custom number input */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 8, color: '#444', marginBottom: 3 }}>Trim (phút)</div>
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              max={999}
              value={trimInput === 'full' ? '' : Number(trimInput)}
              placeholder={trimInput === 'full' ? 'full' : String(trimInput === 0 ? 10 : trimInput)}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === '') {
                  setTrimInput(0)
                } else {
                  const n = parseInt(raw, 10)
                  if (!isNaN(n) && n > 0) setTrimInput(n)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = trimInput
                  if (val !== 0 && val !== 'full') {
                    handleSettingChange(`Trim ${val} phút`, { defaultTrimLimit: val })
                  }
                }
              }}
              style={{
                flex: 1, height: 20, padding: '0 6px',
                background: '#0D0D0D', border: '1px solid #222',
                borderRadius: 3, color: '#00B4FF',
                fontSize: 9, fontWeight: 700, fontFamily: 'monospace',
                outline: 'none', width: '100%',
              }}
            />
            <button
              onClick={() => {
                const val = trimInput
                if (val !== 0 && val !== 'full') {
                  handleSettingChange(`Trim ${val} phút`, { defaultTrimLimit: val })
                }
              }}
              title="Enter hoặc nhấn để xác nhận"
              style={{
                height: 20, paddingLeft: 8, paddingRight: 8,
                background: '#00B4FF22', border: '1px solid #00B4FF66',
                borderRadius: 3, cursor: 'pointer',
                fontSize: 8, fontWeight: 700,
                color: '#00B4FF', fontFamily: 'monospace',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              OK
            </button>
            <button
              onClick={() => handleSettingChange('Trim FULL', { defaultTrimLimit: 'full' })}
              title="Full video"
              style={{
                height: 20, paddingLeft: 6, paddingRight: 6,
                background: settings?.defaultTrimLimit === 'full' ? '#00B4FF22' : 'transparent',
                border: `1px solid ${settings?.defaultTrimLimit === 'full' ? '#00B4FF66' : '#222'}`,
                borderRadius: 3, cursor: 'pointer',
                fontSize: 8, fontWeight: 700,
                color: settings?.defaultTrimLimit === 'full' ? '#00B4FF' : '#444',
                fontFamily: 'monospace',
                transition: 'all 0.1s', flexShrink: 0,
              }}
            >
              FULL
            </button>
          </div>
        </div>

        {/* Quality */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 8, color: '#444', marginBottom: 3 }}>Quality</div>
          <div style={{ display: 'flex', gap: 3 }}>
            {(['360', '480', '720', '1080'] as const).map(val => (
              <button
                key={val}
                onClick={() => handleSettingChange(`Quality ${val}p`, { autoDownloadQuality: val })}
                title={`${val}p`}
                style={{
                  flex: 1, height: 20,
                  background: (settings?.autoDownloadQuality ?? '720') === val ? '#00FF8822' : 'transparent',
                  border: `1px solid ${(settings?.autoDownloadQuality ?? '720') === val ? '#00FF8866' : '#222'}`,
                  borderRadius: 3, cursor: 'pointer',
                  fontSize: 8, fontWeight: 700,
                  color: (settings?.autoDownloadQuality ?? '720') === val ? '#00FF88' : '#444',
                  fontFamily: 'monospace',
                  transition: 'all 0.1s',
                }}
              >
                {val}p
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* System stats */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #1E1E1E', flexShrink: 0 }}>
        {/* GPU row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 10, color: '#555', flexShrink: 0 }}>{gpuShort}</span>
          <div style={{ flex: 1, height: 2, background: '#1E1E1E', borderRadius: 1 }}>
            <div style={{
              width: `${systemStats.gpuUsage}%`, height: '100%',
              background: systemStats.gpuUsage > 90 ? '#FF4444' : '#00FF88',
              borderRadius: 1, transition: 'width 0.8s ease',
            }} />
          </div>
          <span style={{ fontSize: 9, color: '#666', fontFamily: 'monospace', flexShrink: 0 }}>
            {systemStats.gpuTemp}°C
          </span>
        </div>
        {/* RAM row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 10, color: '#555', flexShrink: 0 }}>RAM</span>
          <div style={{ flex: 1, height: 2, background: '#1E1E1E', borderRadius: 1 }}>
            <div style={{
              width: `${Math.min(ramPct, 100)}%`, height: '100%',
              background: ramPct > 80 ? '#FF4444' : '#00B4FF',
              borderRadius: 1, transition: 'width 0.8s ease',
            }} />
          </div>
          <span style={{ fontSize: 9, color: '#666', fontFamily: 'monospace', flexShrink: 0 }}>
            {systemStats.ramUsed.toFixed(0)}/{systemStats.ramTotal}G
          </span>
        </div>
        {/* CPU row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#555', flexShrink: 0 }}>CPU</span>
          <div style={{ flex: 1, height: 2, background: '#1E1E1E', borderRadius: 1 }}>
            <div style={{
              width: `${Math.min(systemStats.cpuUsage, 100)}%`, height: '100%',
              background: systemStats.cpuUsage > 90 ? '#FF4444' : '#00B4FF',
              borderRadius: 1, transition: 'width 0.8s ease',
            }} />
          </div>
          <span style={{ fontSize: 9, color: '#666', fontFamily: 'monospace', flexShrink: 0 }}>
            {systemStats.cpuUsage > 0 ? `${systemStats.cpuUsage}%` : '—'}
          </span>
        </div>
      </div>

      {/* Confirm dialog for pending setting changes */}
      <AlertDialog open={pendingChange !== null} onOpenChange={(open) => { if (!open) setPendingChange(null) }}>
        <AlertDialogContent style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, maxWidth: 320 }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>
              Xác nhận thay đổi
            </AlertDialogTitle>
            <AlertDialogDescription style={{ color: '#888', fontSize: 11 }}>
              {pendingChange ? `Bạn có chắc muốn đổi sang "${pendingChange.label}" không?` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter style={{ marginTop: 12 }}>
            <AlertDialogCancel
              onClick={() => setPendingChange(null)}
              style={{
                flex: 1, height: 28, background: 'transparent',
                border: '1px solid #333', borderRadius: 4,
                color: '#888', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Hủy
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingChange) {
                  onSettingsChange?.(pendingChange.patch)
                  setPendingChange(null)
                }
              }}
              style={{
                flex: 1, height: 28, background: '#00FF8820',
                border: '1px solid #00FF8866', borderRadius: 4,
                color: '#00FF88', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Xác nhận
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
