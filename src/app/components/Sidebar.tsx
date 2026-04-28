'use client'

import { Channel, SystemStats } from '../types'
import { NotificationCenter } from './NotificationCenter'

interface Props {
  channels: Channel[]
  activeChannelId: string
  newCounts: Record<string, number>
  onChannelSelect: (id: string) => void
  systemStats: SystemStats
  authStatus?: { isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady?: boolean; quotaExceeded?: boolean; quotaError?: string }
  pollerStatus?: { active: boolean; lastPollAt: number | null; newVideoCount: number; lastError: string | null } | null
  onLogout?: () => void
}

export function Sidebar({
  channels, activeChannelId, newCounts,
  onChannelSelect,
  systemStats,
  authStatus,
  pollerStatus,
  onLogout,
}: Props) {

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
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        {/* Settings gear — links to /settings (password-gated) */}
        <a
          href="/settings"
          title="Settings"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, borderRadius: 4,
            color: '#444', textDecoration: 'none', flexShrink: 0,
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.background = '#1a1a1a' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.background = 'transparent' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </a>
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
                  {authStatus.quotaExceeded ? (
                    <>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF8800', boxShadow: '0 0 4px #FF8800', flexShrink: 0 }} />
                      <span style={{ fontSize: 9, color: '#FF8800' }}>Quota exceeded</span>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00FF88', boxShadow: '0 0 4px #00FF88', flexShrink: 0 }} />
                      <span style={{ fontSize: 9, color: '#00FF88' }}>
                        {authStatus.oauthReady ? 'OAuth active' : `${authStatus.cookieCount} cookies`}
                      </span>
                    </>
                  )}
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
                <div style={{ fontSize: 9, color: '#666', letterSpacing: '0.08em' }}>CHANNELS</div>
              </div>
              <div className="flex-1 rounded" style={{ background: '#1a1a1a', padding: '4px 8px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#FFB800' }}>4s</div>
                <div style={{ fontSize: 9, color: '#666', letterSpacing: '0.08em' }}>INTERVAL</div>
              </div>
            </div>
            {authStatus.cookieCount < 3 && authStatus.oauthReady ? (
              <div style={{ fontSize: 9, color: '#FF8800', lineHeight: '14px', background: '#1a1a00', padding: '4px 6px', borderRadius: 3 }}>
                ⚠️ Chỉ có OAuth — cookies yếu. Để real-time &lt;5s: mở Chrome với <span style={{ fontFamily: 'monospace', color: '#FFB800' }}>--remote-debugging-port=9222</span>
              </div>
            ) : (
              <div style={{ fontSize: 9, color: '#444', lineHeight: '14px' }}>
                Video mới từ các kênh đã sub sẽ tự động được download
              </div>
            )}
            {/* ─── Poller Status ─────────────────────────────────────────── */}
            {pollerStatus && (
              <div className="flex items-center gap-2" style={{ padding: '4px 0 0' }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: pollerStatus.active ? '#00FF88' : '#FF4444',
                  boxShadow: pollerStatus.active ? '0 0 4px #00FF88' : '0 0 4px #FF4444',
                  flexShrink: 0,
                }} />
                <div className="flex-1 min-w-0">
                  {pollerStatus.active ? (
                    <span style={{ fontSize: 9, color: '#666' }}>
                      {pollerStatus.newVideoCount > 0
                        ? <span style={{ color: '#00FF88' }}>{pollerStatus.newVideoCount} video(s) caught</span>
                        : pollerStatus.lastError
                          ? <span style={{ color: '#FF8800' }}>{pollerStatus.lastError}</span>
                          : <span>Đang quét... 4s/poll</span>
                      }
                    </span>
                  ) : (
                    <span style={{ fontSize: 9, color: '#FF4444' }}>Poller stopped</span>
                  )}
                </div>
              </div>
            )}
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
            <div style={{ fontSize: 9, color: '#444', lineHeight: '14px' }}>
              Đang đợi đăng nhập OAuth...
            </div>
          </div>
        )}
      </div>


      {/* OAuth subscriptions count */}
      <div className="px-3 py-2" style={{ borderBottom: '1px solid #1E1E1E' }}>
        {authStatus?.isReady ? (
          <div className="flex items-center gap-2">
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00FF88', boxShadow: '0 0 4px #00FF88', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#555' }}>{channels.length} subscriptions</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF4444', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#444' }}>Chưa đăng nhập</span>
          </div>
        )}
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-1" style={{ fontSize: 9, letterSpacing: '0.15em', color: '#444', fontWeight: 700 }}>SUBSCRIPTIONS</div>
        {channels.map((ch) => {
          const isActive = ch.id === activeChannelId
          const count = newCounts[ch.id] ?? 0

          return (
            <div key={ch.id}>
              <div
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{
                  background: isActive ? 'rgba(0,180,255,0.07)' : 'transparent',
                  borderLeft: isActive ? '2px solid #00B4FF' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
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

                <div className="flex-1 min-w-0" onClick={() => onChannelSelect(ch.id)}>
                  <div className="truncate" style={{ fontSize: 12, color: isActive ? '#fff' : '#888', fontWeight: isActive ? 600 : 400 }}>{ch.name}</div>
                  <div style={{ fontSize: 9, color: '#444' }}>{ch.handle}</div>
                </div>

                {count > 0 && (
                  <div className="flex items-center justify-center rounded-full shrink-0" style={{ minWidth: 18, height: 18, background: '#00B4FF', fontSize: 9, fontWeight: 700, color: '#000', padding: '0 4px' }}>
                    {count}
                  </div>
                )}
              </div>
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

