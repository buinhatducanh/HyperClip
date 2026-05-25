'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useAppStore } from '../lib/store'
import {
  MAX_UNITS_PER_PROJECT,
  QUOTA_WARNING_PCT,
  QUOTA_CRITICAL_THRESHOLD,
  QUOTA_WARNING_THRESHOLD,
  QUOTA_BAR_WARN_PCT,
  QUOTA_BAR_EXHAUSTED_PCT,
  STALE_SESSION_DAYS,
  HOURLY_EVENTS_MAX,
  RESET_ANIMATION_MS,
  CPU_WARN_PCT,
} from '../lib/constants'
import {
  formatNextReset,
  formatTimeAgo,
  UsageTimeline,
  StatCard,
} from '../lib/utils'
import { ipc } from '../lib/ipc'
import type { Project, ApiKeyStatus } from './types'
import ApiKeysSection from './components/ApiKeysSection'
import SessionsSection from './components/SessionsSection'
import { ProjectsSection } from './components/ProjectsSection'
import { OperationPanel } from './components/OperationPanel'
import { PollerStatusPanel } from './components/PollerStatusPanel'
import { StorageWidget } from './components/StorageWidget'
import { DiagnosticsSection } from './components/DiagnosticsSection'
import { LogsSection } from './components/LogsSection'
import { UpdateSection } from './components/UpdateSection'

export const dynamic = 'force-dynamic'

// Types moved to ./types.ts


export default function SettingsPage() {
  const { settings, systemStats, setSettings } = useAppStore()
  const [activeTab, setActiveTab] = useState<'sessions' | 'projects' | 'keys' | 'system' | 'diag' | 'operation' | 'logs' | 'update'>('sessions')

  const TABS = [
    { id: 'sessions' as const, label: 'Sessions', color: '#00B4FF' },
    { id: 'projects' as const, label: 'Projects', color: '#00FF88' },
    { id: 'keys' as const, label: 'API Keys', color: '#00B4FF' },
    { id: 'system' as const, label: 'Storage', color: '#FFB800' },
    { id: 'diag' as const, label: 'Diagnostics', color: '#FF6B35' },
    { id: 'operation' as const, label: 'Channels', color: '#00FF88' },
    { id: 'logs' as const, label: 'Logs', color: '#FF6B35' },
    { id: 'update' as const, label: 'Update', color: '#00FF88' },
  ]

  return (
    <div style={{ height: '100vh', background: '#0A0A0A', fontFamily: 'Inter, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        height: 48, background: '#0D0D0D', borderBottom: '1px solid #1A1A1A',
        display: 'flex', alignItems: 'center', paddingLeft: 20, gap: 16, flexShrink: 0,
      }}>
        <Link href="/" style={{ fontSize: 10, color: '#555', textDecoration: 'none', fontWeight: 700, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 4, transition: 'all 0.15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; (e.currentTarget as HTMLElement).style.background = '#1A1A1A' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >← Quay lại</Link>
        <div style={{ width: 1, height: 12, background: '#222' }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>SETTINGS</span>
        <div style={{ width: 1, height: 12, background: '#222' }} />

        {/* Tabs */}
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              data-tab={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                height: 28, paddingLeft: 12, paddingRight: 12,
                background: isActive ? '#141414' : 'transparent',
                border: `1px solid ${isActive ? tab.color + '44' : 'transparent'}`,
                borderRadius: 4, cursor: 'pointer',
                fontSize: 8, fontWeight: 700,
                color: isActive ? tab.color : '#444',
                letterSpacing: '0.08em', transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* SESSIONS — Chrome cookie management */}
        {activeTab === 'sessions' && <SessionsSection />}

        {/* PROJECTS — OAuth project management */}
        {activeTab === 'projects' && <ProjectsSection />}

        {/* API Keys — full width */}
        {activeTab === 'keys' && (
          <ApiKeysSection />
        )}

        {/* Diagnostics */}
        {activeTab === 'diag' && <DiagnosticsSection />}

        {/* System tab */}
        {activeTab === 'system' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Header */}
            <div style={{
              padding: '14px 20px',
              background: '#0B0B0B',
              borderBottom: '1px solid #1A1A1A',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>SYSTEM MONITOR</div>
            </div>

            {/* Hardware Info */}
            <div style={{ padding: '12px 20px', background: '#0D0D0D', borderBottom: '1px solid #141414' }}>
              <div style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>HARDWARE</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {/* CPU */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>CPU</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {systemStats.cpuName || 'Unknown'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1, height: 6, background: '#141414', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(systemStats.cpuUsage ?? 0, 100)}%`, height: '100%',
                        background: (systemStats.cpuUsage ?? 0) > 80 ? '#FFB800' : '#00B4FF',
                        borderRadius: 2, transition: 'width 1s ease',
                        boxShadow: `0 0 4px ${(systemStats.cpuUsage ?? 0) > 80 ? '#FFB80044' : '#00B4FF44'}`,
                      }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', minWidth: 30, textAlign: 'right' }}>
                      {systemStats.cpuUsage ?? 0}%
                    </span>
                  </div>
                  <div style={{ fontSize: 8, color: '#2a2a2a', marginTop: 2 }}>{systemStats.cpuCores ?? 0} cores</div>
                </div>

                {/* RAM */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>SYSTEM RAM</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#888', fontFamily: 'monospace', lineHeight: 1.2 }}>
                    {Math.round((systemStats.ramUsed ?? 0) * 10) / 10}
                    <span style={{ fontSize: 9, color: '#333', marginLeft: 4 }}>/ {Math.round((systemStats.ramTotal ?? 0) * 10) / 10} GB</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1, height: 6, background: '#141414', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${systemStats.ramTotal ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100) : 0}%`,
                        height: '100%', background: '#00B4FF', borderRadius: 2,
                        boxShadow: '0 0 4px #00B4FF44',
                      }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', minWidth: 30, textAlign: 'right' }}>
                      {systemStats.ramTotal ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100) : 0}%
                    </span>
                  </div>
                  <div style={{ fontSize: 8, color: '#2a2a2a', marginTop: 2 }}>
                    {(Math.round(((systemStats.ramFree ?? 0) / (systemStats.ramTotal ?? 1)) * 100))}% free
                  </div>
                </div>

                {/* GPU */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>GPU</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: 1,
                      background: systemStats.gpuEncoder === 'nvenc' ? '#00FF88' : systemStats.gpuEncoder === 'qsv' ? '#FFB800' : '#555',
                      boxShadow: systemStats.gpuEncoder === 'nvenc' ? '0 0 4px #00FF8866' : 'none',
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {systemStats.gpuName || 'No GPU'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, fontSize: 8, color: '#2a2a2a', fontFamily: 'monospace', marginTop: 2 }}>
                    <span style={{ color: systemStats.gpuEncoder === 'nvenc' ? '#00FF88' : '#555' }}>{systemStats.gpuEncoder?.toUpperCase() || 'CPU'}</span>
                    <span>tier: {systemStats.gpuTier || '?'}</span>
                    <span>workers: {systemStats.maxChunkWorkers || 2}</span>
                  </div>
                </div>

                {/* GPU Stats */}
                {systemStats.gpuEncoder === 'nvenc' && (
                  <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                    <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>GPU LOAD</div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>{systemStats.gpuUsage ?? 0}%</div>
                        <div style={{ fontSize: 7, color: '#2a2a2a', marginTop: 2 }}>utilization</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>{systemStats.gpuTemp ?? 0}°C</div>
                        <div style={{ fontSize: 7, color: '#2a2a2a', marginTop: 2 }}>temperature</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>
                          {Math.round((systemStats.gpuMemoryFree ?? 0) / 1024)}GB
                        </div>
                        <div style={{ fontSize: 7, color: '#2a2a2a', marginTop: 2 }}>
                          free / {Math.round((systemStats.gpuMemoryTotal ?? 0) / 1024)}GB
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* RAM Disk */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>RAM DISK</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: 1,
                      background: systemStats.ramDiskIsAvailable ? '#00FF88' : '#333',
                      boxShadow: systemStats.ramDiskIsAvailable ? '0 0 4px #00FF8866' : 'none',
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: systemStats.ramDiskIsAvailable ? '#888' : '#333' }}>
                      {systemStats.ramDiskIsAvailable ? `${systemStats.ramDiskTotal}GB` : 'N/A'}
                    </span>
                  </div>
                  {systemStats.ramDiskIsAvailable && (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <span style={{ fontSize: 8, color: '#00B4FF', fontFamily: 'monospace' }}>
                          {systemStats.ramDiskUsed}GB used
                        </span>
                        <span style={{ fontSize: 8, color: '#2a2a2a', fontFamily: 'monospace' }}>
                          {systemStats.ramDiskAvailable}GB avail
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Workers */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>WORKERS</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: systemStats.activeWorkers > 0 ? '#00B4FF' : '#333', fontFamily: 'monospace' }}>
                      {systemStats.activeWorkers ?? 0}
                    </span>
                    <span style={{ fontSize: 8, color: '#333' }}>/ {systemStats.maxChunkWorkers || 2} max</span>
                  </div>
                  <div style={{ fontSize: 8, color: '#2a2a2a', marginTop: 2 }}>NVENC render workers</div>
                </div>

                {/* Network */}
                <div style={{ background: '#0a0a0a', border: '1px solid #141414', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>NETWORK</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: systemStats.isOnline ? '#00FF88' : '#FF4444',
                      boxShadow: systemStats.isOnline ? '0 0 4px #00FF8866' : '0 0 4px #FF444466',
                    }} />
                    <span style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>{systemStats.networkIp || '127.0.0.1'}</span>
                  </div>
                  <div style={{ fontSize: 8, color: '#2a2a2a', marginTop: 2 }}>
                    {systemStats.isOnline ? 'Online' : 'Offline'}
                  </div>
                </div>
              </div>
            </div>

            {/* Storage */}
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.1em', marginBottom: 0, padding: '12px 20px 8px', background: '#0B0B0B' }}>STORAGE</div>
            <div style={{ background: '#0D0D0D', borderBottom: '1px solid #141414' }}>
              <StorageWidget />
            </div>

            {/* About */}
            <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.1em', marginBottom: 0, padding: '12px 20px 8px', background: '#0B0B0B' }}>ABOUT</div>
            <div style={{ background: '#0D0D0D' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#555' }}>
                  <span style={{ color: '#00B4FF', fontWeight: 700 }}>HyperClip</span> v0.1.0
                </div>
                <div style={{ fontSize: 9, color: '#2A2A2A', fontFamily: 'monospace' }}>
                  Electron + Next.js + FFmpeg + NVENC
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LOGS tab */}
        {activeTab === 'logs' && <LogsSection />}

        {/* UPDATE tab */}
        {activeTab === 'update' && <UpdateSection />}

        {/* OPERATION tab */}
        {activeTab === 'operation' && <OperationPanel />}
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A1A1A; border-radius: 2px; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
