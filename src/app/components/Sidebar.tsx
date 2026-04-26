'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Channel, SystemStats } from '../types'

interface Props {
  channels: Channel[]
  activeChannelId: string
  newCounts: Record<string, number>
  onChannelSelect: (id: string) => void
  onAddChannel: (url: string) => void
  onEditChannel?: (id: string, patch: Partial<Channel>) => void
  onDeleteChannel?: (id: string) => void
  systemStats: SystemStats
  authStatus?: { isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady?: boolean }
  onLogout?: () => void
}

export function Sidebar({
  channels, activeChannelId, newCounts,
  onChannelSelect, onAddChannel,
  onEditChannel, onDeleteChannel,
  systemStats,
  authStatus,
  onLogout,
}: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')

  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editHandle, setEditHandle] = useState('')
  const [editAvatarUrl, setEditAvatarUrl] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const submit = () => {
    if (!urlInput.trim()) return
    onAddChannel(urlInput.trim())
    setUrlInput('')
    setAddOpen(false)
  }

  const openEdit = (ch: Channel) => {
    setEditId(ch.id)
    setEditName(ch.name)
    setEditHandle(ch.handle)
    setEditAvatarUrl(ch.avatarUrl || '')
  }

  const saveEdit = () => {
    if (!editId) return
    onEditChannel?.(editId, {
      name: editName.trim() || 'Kênh',
      handle: editHandle.trim() || '@channel',
      avatarUrl: editAvatarUrl.trim() || null,
    })
    setEditId(null)
  }

  const confirmDelete = (id: string) => {
    onDeleteChannel?.(id)
    setDeleteConfirm(null)
  }

  const ramPct = Math.round((systemStats.ramUsed / systemStats.ramTotal) * 100)

  return (
    <div
      className="flex flex-col h-full select-none shrink-0"
      style={{ width: 220, background: '#161616', borderRight: '1px solid #1E1E1E' }}
    >
      {/* App brand */}
      <div className="flex items-center gap-2 px-4" style={{ height: 48, borderBottom: '1px solid #1E1E1E' }}>
        <div className="flex items-center justify-center rounded" style={{ width: 22, height: 22, background: '#00B4FF', flexShrink: 0 }}>
          <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 9,5 1,9" fill="white" /></svg>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>AUTO-RENDER</span>
      </div>

      {/* ─── YouTube Account ─────────────────────────────────────────────── */}
      <div className="px-3 py-3" style={{ borderBottom: '1px solid #1E1E1E', background: '#111' }}>
        {authStatus?.isReady ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center rounded shrink-0" style={{ width: 28, height: 28, background: '#FF0000' }}>
                <svg width="14" height="10" viewBox="0 0 14 10" fill="white">
                  <path d="M13.5 1.5s-.3-2-.8-2.8C12.2.2 10 .2 10 .2s-2.2 0-2.7.5S6 2.2 6 2.2s-.3 1.2-.3 2.8v1C5.7 6.3 5.5 7.5 5.5 7.5s-.1 2 .4 3.2c.4.8.8 1.6 2.2 1.6 2.2 0 2.7-.8 2.7-.8s.3-1.4.3-2.8v-1c0-.8.1-2.3.1-2.3s.2-1.3.7-1.7c.6-.5 1.3-.5 1.6-.4s.9.5.9.5zM8.7 7.8V3.3l3 2.2-3 2.3zM5.5 9.7H1v-9h4.5v9z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>
                  {authStatus.accountName || 'YouTube Account'}
                </div>
                <div className="flex items-center gap-1">
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00FF88', boxShadow: '0 0 4px #00FF88', flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: '#00FF88' }}>
                    {authStatus.oauthReady ? 'OAuth ready' : `${authStatus.cookieCount} cookies`}
                  </span>
                </div>
              </div>
              <button
                onClick={() => { if (confirm('Đăng xuất YouTube?')) onLogout?.() }}
                title="Logout"
                style={{ width: 20, height: 20, background: 'transparent', border: 'none', cursor: 'pointer', color: '#444', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, flexShrink: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = '#FF4444')}
                onMouseLeave={e => (e.currentTarget.style.color = '#444')}
              >✕</button>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 rounded" style={{ background: '#1a1a1a', padding: '4px 8px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#00B4FF' }}>{channels.length}</div>
                <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.08em' }}>CHANNELS</div>
              </div>
              <div className="flex-1 rounded" style={{ background: '#1a1a1a', padding: '4px 8px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#FFB800' }}>3s</div>
                <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.08em' }}>INTERVAL</div>
              </div>
            </div>
            <div style={{ fontSize: 8, color: '#333', lineHeight: '13px' }}>
              Video mới từ các kênh đã sub sẽ tự động được download
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center rounded" style={{ width: 28, height: 28, background: '#333' }}>
                <svg width="14" height="10" viewBox="0 0 14 10" fill="#666">
                  <path d="M13.5 1.5s-.3-2-.8-2.8C12.2.2 10 .2 10 .2s-2.2 0-2.7.5S6 2.2 6 2.2s-.3 1.2-.3 2.8v1C5.7 6.3 5.5 7.5 5.5 7.5s-.1 2 .4 3.2c.4.8.8 1.6 2.2 1.6 2.2 0 2.7-.8 2.7-.8s.3-1.4.3-2.8v-1c0-.8.1-2.3.1-2.3s.2-1.3.7-1.7c.6-.5 1.3-.5 1.6-.4s.9.5.9.5zM8.7 7.8V3.3l3 2.2-3 2.3zM5.5 9.7H1v-9h4.5v9z" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#888' }}>YouTube</div>
                <div className="flex items-center gap-1">
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF4444' }} />
                  <span style={{ fontSize: 9, color: '#FF4444' }}>Chưa đăng nhập</span>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 8, color: '#333', lineHeight: '13px' }}>
              Đang đợi đăng nhập OAuth...
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="px-3 py-2" style={{ borderBottom: '1px solid #1A1A1A' }}>
        <div style={{ fontSize: 8, fontWeight: 700, color: '#333', letterSpacing: '0.15em', marginBottom: 4, paddingLeft: 4 }}>NAVIGATE</div>
        <NavLink href="/" icon="⊹" label="DASHBOARD" active={false} />
        <NavLink href="/workspaces" icon="▦" label="WORKSPACES" active={false} />
        <NavLink href="/settings" icon="⚙" label="SETTINGS" active={false} />
      </div>

      {/* Add tracker */}
      <div className="px-3 py-2" style={{ borderBottom: '1px solid #1E1E1E' }}>
        {!addOpen ? (
          <button
            onClick={() => setAddOpen(true)}
            className="w-full flex items-center gap-2 rounded px-3 transition-colors"
            style={{ height: 30, background: 'rgba(0,180,255,0.1)', border: '1px solid rgba(0,180,255,0.25)', color: '#00B4FF', fontSize: 11, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.04em' }}
          >
            + Add Tracker
          </button>
        ) : (
          <div className="flex gap-1">
            <input
              autoFocus
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAddOpen(false) }}
              placeholder="youtube.com/@channel"
              className="flex-1 rounded px-2 outline-none"
              style={{ height: 30, background: '#111', border: '1px solid #333', color: '#ddd', fontSize: 11, minWidth: 0 }}
            />
            <button onClick={submit} style={{ width: 30, height: 30, background: '#00B4FF', border: 'none', borderRadius: 4, color: '#fff', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>↵</button>
          </div>
        )}
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-1" style={{ fontSize: 9, letterSpacing: '0.15em', color: '#444', fontWeight: 700 }}>TRACKED CHANNELS</div>
        {channels.map((ch) => {
          const isActive = ch.id === activeChannelId
          const count = newCounts[ch.id] ?? 0
          const isEditing = editId === ch.id
          const isDeleting = deleteConfirm === ch.id

          return (
            <div key={ch.id}>
              {/* Channel row */}
              <div
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{
                  background: isActive ? 'rgba(0,180,255,0.07)' : 'transparent',
                  borderLeft: isActive ? '2px solid #00B4FF' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                {/* Avatar */}
                {ch.avatarUrl ? (
                  <div className="shrink-0 relative" style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', border: `1px solid ${ch.avatarColor}44` }}>
                    <img
                      src={ch.avatarUrl}
                      alt={ch.name}
                      width={28}
                      height={28}
                      style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => {
                        const parent = e.currentTarget.parentElement as HTMLDivElement
                        if (parent) {
                          parent.style.display = 'none'
                          const fallback = document.createElement('div')
                          fallback.className = 'flex items-center justify-center rounded shrink-0'
                          fallback.style.cssText = `width:28px;height:28px;background:${ch.avatarColor}22;border:1px solid ${ch.avatarColor}44;font-size:11px;font-weight:700;color:${ch.avatarColor}`
                          fallback.textContent = ch.name.charAt(0)
                          parent.parentElement!.insertBefore(fallback, parent)
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center rounded shrink-0" style={{ width: 28, height: 28, background: ch.avatarColor + '22', border: `1px solid ${ch.avatarColor}44`, fontSize: 11, fontWeight: 700, color: ch.avatarColor }}>
                    {ch.name.charAt(0)}
                  </div>
                )}

                {/* Info — click to select */}
                <div className="flex-1 min-w-0" onClick={() => onChannelSelect(ch.id)}>
                  <div className="truncate" style={{ fontSize: 12, color: isActive ? '#fff' : '#888', fontWeight: isActive ? 600 : 400 }}>{ch.name}</div>
                  <div style={{ fontSize: 9, color: '#444' }}>{ch.handle}</div>
                </div>

                {/* Count badge */}
                {count > 0 && (
                  <div className="flex items-center justify-center rounded-full shrink-0" style={{ minWidth: 18, height: 18, background: '#00B4FF', fontSize: 9, fontWeight: 700, color: '#000', padding: '0 4px' }}>
                    {count}
                  </div>
                )}

                {/* Action buttons */}
                {(onEditChannel || onDeleteChannel) && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    {onEditChannel && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(ch) }}
                        title="Edit channel"
                        style={{ width: 20, height: 20, background: 'transparent', border: 'none', cursor: 'pointer', color: '#555', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#aaa')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
                      >✎</button>
                    )}
                    {onDeleteChannel && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(ch.id) }}
                        title="Delete channel"
                        style={{ width: 20, height: 20, background: 'transparent', border: 'none', cursor: 'pointer', color: '#555', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#ff5555')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
                      >✕</button>
                    )}
                  </div>
                )}
              </div>

              {/* Edit dialog */}
              {isEditing && (
                <div className="mx-2 mb-2 rounded" style={{ background: '#1a1a1a', border: '1px solid #333', padding: 10 }}>
                  <div style={{ fontSize: 9, color: '#555', fontWeight: 700, marginBottom: 6, letterSpacing: '0.1em' }}>EDIT CHANNEL</div>
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null) }}
                    placeholder="Channel name"
                    style={{ display: 'block', width: '100%', marginBottom: 6, height: 26, background: '#111', border: '1px solid #333', color: '#ddd', fontSize: 11, borderRadius: 3, padding: '0 6px', outline: 'none', boxSizing: 'border-box' }}
                  />
                  <input
                    value={editHandle}
                    onChange={(e) => setEditHandle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null) }}
                    placeholder="@handle"
                    style={{ display: 'block', width: '100%', marginBottom: 6, height: 26, background: '#111', border: '1px solid #333', color: '#ddd', fontSize: 11, borderRadius: 3, padding: '0 6px', outline: 'none', boxSizing: 'border-box' }}
                  />
                  <div className="flex gap-1 items-center" style={{ marginBottom: 8 }}>
                    <input
                      value={editAvatarUrl}
                      onChange={(e) => setEditAvatarUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null) }}
                      placeholder="Avatar URL (optional)"
                      style={{ flex: 1, height: 26, background: '#111', border: '1px solid #333', color: '#ddd', fontSize: 10, borderRadius: 3, padding: '0 6px', outline: 'none', minWidth: 0 }}
                    />
                    {editAvatarUrl && (
                      <button
                        onClick={() => setEditAvatarUrl('')}
                        title="Remove avatar"
                        style={{ height: 26, padding: '0 6px', background: '#333', border: 'none', borderRadius: 3, color: '#888', fontSize: 10, cursor: 'pointer' }}
                      >✕</button>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={saveEdit}
                      style={{ flex: 1, height: 26, background: '#00B4FF', border: 'none', borderRadius: 3, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                    >Save</button>
                    <button
                      onClick={() => setEditId(null)}
                      style={{ flex: 1, height: 26, background: '#222', border: '1px solid #333', borderRadius: 3, color: '#888', fontSize: 10, cursor: 'pointer' }}
                    >Cancel</button>
                  </div>
                </div>
              )}

              {/* Delete confirm */}
              {isDeleting && (
                <div className="mx-2 mb-2 rounded" style={{ background: '#1a0808', border: '1px solid #5a1a1a', padding: 10 }}>
                  <div style={{ fontSize: 9, color: '#ff5555', fontWeight: 700, marginBottom: 6 }}>DELETE "{ch.name}"?</div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => confirmDelete(ch.id)}
                      style={{ flex: 1, height: 26, background: '#aa2222', border: 'none', borderRadius: 3, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                    >Delete</button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      style={{ flex: 1, height: 26, background: '#222', border: '1px solid #333', borderRadius: 3, color: '#888', fontSize: 10, cursor: 'pointer' }}
                    >Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* System monitor */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid #1E1E1E' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#444', fontWeight: 700, marginBottom: 8 }}>SYSTEM</div>
        {systemStats.ramDiskIsAvailable ? (
          <>
            <div className="flex items-center gap-1.5 mb-1.5">
              <div style={{ width: 5, height: 5, borderRadius: 1, background: '#FFB800', boxShadow: '0 0 4px #FFB80066' }} />
              <span style={{ fontSize: 9, color: '#FFB800', fontWeight: 600 }}>RAM DISK</span>
            </div>
            <StatRow label={`RAM Disk (${systemStats.ramDiskUsed.toFixed(1)}GB)`} value={`${(systemStats.ramDiskTotal - systemStats.ramDiskAvailable).toFixed(1)} / ${systemStats.ramDiskTotal}GB`} percent={Math.round(((systemStats.ramDiskTotal - systemStats.ramDiskAvailable) / systemStats.ramDiskTotal) * 100)} color="#FFB800" />
          </>
        ) : (
          <StatRow label="RAM" value={`${systemStats.ramUsed.toFixed(1)} / ${systemStats.ramTotal}GB`} percent={ramPct} color={ramPct > 80 ? '#FF4444' : '#00B4FF'} />
        )}
        <div className="flex items-center justify-between mt-1.5">
          <span style={{ fontSize: 10, color: '#555' }}>CPU</span>
          <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{systemStats.cpuUsage > 0 ? `${systemStats.cpuUsage}% · ${systemStats.cpuCores}c` : '—'}</span>
        </div>
        <div style={{ height: 2, background: '#1E1E1E', borderRadius: 1, marginTop: 4 }}>
          <div style={{ width: `${Math.min(systemStats.cpuUsage, 100)}%`, height: '100%', background: systemStats.cpuUsage > 90 ? '#FF4444' : '#00B4FF', borderRadius: 1, transition: 'width 0.8s ease' }} />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span style={{ fontSize: 10, color: '#555' }}>{systemStats.gpuName ? systemStats.gpuName.split(' ').slice(0, 2).join(' ') : 'GPU'}</span>
          <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{systemStats.gpuUsage}% · {systemStats.gpuTemp}°C</span>
        </div>
        <div style={{ height: 2, background: '#1E1E1E', borderRadius: 1, marginTop: 4 }}>
          <div style={{ width: `${systemStats.gpuUsage}%`, height: '100%', background: systemStats.gpuUsage > 90 ? '#FF4444' : '#00FF88', borderRadius: 1, transition: 'width 0.8s ease' }} />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1.5">
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: systemStats.isOnline ? '#00FF88' : '#FF4444', boxShadow: systemStats.isOnline ? '0 0 4px #00FF88' : 'none' }} />
            <span style={{ fontSize: 10, color: systemStats.isOnline ? '#00FF88' : '#FF4444', fontFamily: 'monospace' }}>{systemStats.networkIp}</span>
          </div>
          <span style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>{(systemStats as any).activeWorkers || 0}w</span>
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value, percent, color }: { label: string; value: string; percent: number; color: string }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between mb-0.5">
        <span style={{ fontSize: 10, color: '#555' }}>{label}</span>
        <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{value}</span>
      </div>
      <div style={{ height: 3, background: '#1E1E1E', borderRadius: 2 }}>
        <div style={{ width: `${Math.min(percent, 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.8s ease' }} />
      </div>
    </div>
  )
}

function NavLink({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 8, height: 30, borderRadius: 3, textDecoration: 'none', background: active ? '#00B4FF15' : 'transparent', borderLeft: active ? '2px solid #00B4FF' : '2px solid transparent', transition: 'all 0.15s', marginBottom: 2 }}>
      <span style={{ fontSize: 12, color: active ? '#00B4FF' : '#333', fontFamily: 'monospace' }}>{icon}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: active ? '#00B4FF' : '#444', letterSpacing: '0.08em' }}>{label}</span>
    </Link>
  )
}
