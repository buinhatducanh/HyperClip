'use client'

import { useState, useCallback } from 'react'
import type { Channel, SystemStats } from '../types'
import { NotificationCenter } from './NotificationCenter'

interface Props {
  channels: Channel[]
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

export function Sidebar({
  channels, activeChannelId, newCounts,
  onChannelSelect,
  systemStats,
  authStatus,
  pollerStatus,
  onLogout,
  keyHealth,
}: Props) {
  const [showAll, setShowAll] = useState(true)

  const isActive = authStatus?.isReady && !authStatus?.quotaExceeded
  const ramPct = Math.round((systemStats.ramUsed / systemStats.ramTotal) * 100)
  const gpuShort = systemStats.gpuName ? systemStats.gpuName.split(' ').slice(0, 2).join(' ') : 'GPU'

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
        <div style={{ width: 20, height: 20, background: '#00B4FF', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 9,5 1,9" fill="white" /></svg>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', flex: 1 }}>HyperClip</span>
        <NotificationCenter />
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

      {/* YouTube account */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #1E1E1E', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* YouTube icon */}
          <div style={{ width: 26, height: 26, background: '#FF0000', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="13" height="9" viewBox="0 0 14 10" fill="white">
              <path d="M13.5 1.5s-.3-2-.8-2.8C12.2.2 10 .2 10 .2s-2.2 0-2.7.5S6 2.2 6 2.2s-.3 1.2-.3 2.8v1C5.7 6.3 5.5 7.5 5.5 7.5s-.1 2 .4 3.2c.4.8.8 1.6 2.2 1.6 2.2 0 2.7-.8 2.7-.8s.3-1.4.3-2.8v-1c0-.8.1-2.3.1-2.3s.2-1.3.7-1.7c.6-.5 1.3-.5 1.6-.4s.9.5.9.5zM8.7 7.8V3.3l3 2.2-3 2.3zM5.5 9.7H1v-9h4.5v9z" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {authStatus?.accountName || 'YouTube'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background: isActive ? '#00FF88' : '#FF4444',
                boxShadow: isActive ? '0 0 4px #00FF88' : '0 0 4px #FF4444',
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 9, color: isActive ? '#00FF88' : '#FF4444' }}>
                {authStatus?.quotaExceeded ? 'Quota exceeded' : authStatus?.isReady ? 'Active' : 'Not connected'}
              </span>
            </div>
          </div>
          {authStatus?.isReady && (
            <button
              onClick={() => { if (confirm('Đăng xuất YouTube?')) onLogout?.() }}
              title="Logout"
              style={{ width: 18, height: 18, background: 'transparent', border: 'none', cursor: 'pointer', color: '#444', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 2, flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = '#FF4444')}
              onMouseLeave={e => (e.currentTarget.style.color = '#444')}
            >
              ✕
            </button>
          )}
        </div>
        {/* Quick stats */}
        {authStatus?.isReady && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <div style={{ flex: 1, background: '#1A1A1A', borderRadius: 3, padding: '3px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#00B4FF' }}>{channels.length}</div>
              <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.06em' }}>CHANNELS</div>
            </div>
            <div style={{ flex: 1, background: '#1A1A1A', borderRadius: 3, padding: '3px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#00FF88' }}>
                {pollerStatus?.active ? `${Math.round(((pollerStatus as any).pollIntervalMs || 20000) / 1000)}s` : '—'}
              </div>
              <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.06em' }}>INTERVAL</div>
            </div>
          </div>
        )}
      </div>

      {/* Channel list */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid #181818', flexShrink: 0 }}>
          <button
            onClick={() => { setShowAll(true); onChannelSelect('') }}
            style={{
              flex: 1, height: 24, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              background: showAll ? '#00B4FF15' : '#1A1A1A',
              border: `1px solid ${showAll ? '#00B4FF' : '#222'}`,
              borderRadius: 3, color: showAll ? '#00B4FF' : '#555',
              cursor: 'pointer',
            }}
          >
            ALL
          </button>
          <button
            onClick={() => { setShowAll(false); onChannelSelect('') }}
            style={{
              flex: 1, height: 24, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              background: !showAll ? '#00B4FF15' : '#1A1A1A',
              border: `1px solid ${!showAll ? '#00B4FF' : '#222'}`,
              borderRadius: 3, color: !showAll ? '#00B4FF' : '#555',
              cursor: 'pointer',
            }}
          >
            NEW
          </button>
        </div>

        {/* Channel items */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {channels.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 16px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#222" strokeWidth="1.5">
                <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14v-4z" />
                <rect x="3" y="6" width="12" height="12" rx="2" ry="2" />
              </svg>
              <span style={{ fontSize: 10, color: '#2A2A2A', textAlign: 'center', lineHeight: 1.5 }}>
                No channels yet<br />
                <a href="/settings" style={{ color: '#00B4FF', textDecoration: 'none', fontSize: 9 }}>Add in Settings →</a>
              </span>
            </div>
          ) : channels
            .filter(ch => {
              if (showAll) return true
              return (newCounts[ch.id] ?? 0) > 0
            })
            .map(ch => {
              const isActiveCh = ch.id === activeChannelId
              const count = newCounts[ch.id] ?? 0

              return (
                <div key={ch.id}>
                  <div
                    onClick={() => onChannelSelect(ch.id)}
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
                      <div style={{ fontSize: 11, color: isActiveCh ? '#fff' : '#888', fontWeight: isActiveCh ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ch.name}
                      </div>
                    </div>

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
                  </div>
                </div>
              )
            })}
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
    </div>
  )
}
