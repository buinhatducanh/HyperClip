import { colors, spacing, fontSize } from '../design-system/tokens'
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
    { id: 'sessions' as const, label: 'Sessions', color: colors.accent },
    { id: 'projects' as const, label: 'Projects', color: colors.success },
    { id: 'keys' as const, label: 'API Keys', color: colors.accent },
    { id: 'system' as const, label: 'Storage', color: colors.warning },
    { id: 'diag' as const, label: 'Diagnostics', color: '#FF6B35' },
    { id: 'operation' as const, label: 'Channels', color: colors.success },
    { id: 'logs' as const, label: 'Logs', color: '#FF6B35' },
    { id: 'update' as const, label: 'Update', color: colors.success },
  ]

  return (
    <div style={{ height: '100vh', background: colors.bg, fontFamily: 'Inter, sans-serif', color: colors.border, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        height: 48, background: colors.bg, borderBottom: '1px solid #E0E0E0',
        display: 'flex', alignItems: 'center', paddingLeft: 20, gap: 16, flexShrink: 0,
      }}>
        <Link href="/" style={{ fontSize: 10, color: '#777', textDecoration: 'none', fontWeight: 700, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 4, transition: 'all 0.15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = colors.border; (e.currentTarget as HTMLElement).style.background = colors.border }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#777'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >← Quay lại</Link>
        <div style={{ width: 1, height: 12, background: colors.borderHover }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: colors.border, letterSpacing: '0.1em' }}>SETTINGS</span>
        <div style={{ width: 1, height: 12, background: colors.borderHover }} />

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
                background: isActive ? colors.border : 'transparent',
                border: `1px solid ${isActive ? tab.color + '44' : 'transparent'}`,
                borderRadius: 4, cursor: 'pointer',
                fontSize: 8, fontWeight: 700,
                color: isActive ? tab.color : '#888',
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
              background: colors.bg,
              borderBottom: '1px solid #E0E0E0',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: colors.border, letterSpacing: '0.1em' }}>SYSTEM MONITOR</div>
            </div>

            {/* Hardware Info */}
            <div style={{ padding: '12px 20px', background: colors.bg, borderBottom: '1px solid #E0E0E0' }}>
              <div style={{ fontSize: 8, color: '#AAA', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>HARDWARE</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {/* CPU */}
                <div style={{ background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#777', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>CPU</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {systemStats.cpuName || 'Unknown'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1, height: 6, background: colors.border, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(systemStats.cpuUsage ?? 0, 100)}%`, height: '100%',
                        background: (systemStats.cpuUsage ?? 0) > 80 ? colors.warning : colors.accent,
                        borderRadius: 2, transition: 'width 1s ease',
                        boxShadow: `0 0 4px ${(systemStats.cpuUsage ?? 0) > 80 ? '#FFB80044' : '#00B4FF44'}`,
                      }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#777', fontFamily: 'monospace', minWidth: 30, textAlign: 'right' }}>
                      {systemStats.cpuUsage ?? 0}%
                    </span>
                  </div>
                  <div style={{ fontSize: 8, color: colors.borderHover, marginTop: 2 }}>{systemStats.cpuCores ?? 0} cores</div>
                </div>

                {/* RAM */}
                <div style={{ background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#777', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>SYSTEM RAM</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#888', fontFamily: 'monospace', lineHeight: 1.2 }}>
                    {Math.round((systemStats.ramUsed ?? 0) * 10) / 10}
                    <span style={{ fontSize: 9, color: '#888', marginLeft: 4 }}>/ {Math.round((systemStats.ramTotal ?? 0) * 10) / 10} GB</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1, height: 6, background: colors.border, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${systemStats.ramTotal ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100) : 0}%`,
                        height: '100%', background: colors.accent, borderRadius: 2,
                        boxShadow: '0 0 4px #00B4FF44',
                      }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#777', fontFamily: 'monospace', minWidth: 30, textAlign: 'right' }}>
                      {systemStats.ramTotal ? Math.round(((systemStats.ramUsed ?? 0) / systemStats.ramTotal) * 100) : 0}%
                    </span>
                  </div>
                  <div style={{ fontSize: 8, color: colors.borderHover, marginTop: 2 }}>
                    {(Math.round(((systemStats.ramFree ?? 0) / (systemStats.ramTotal ?? 1)) * 100))}% free
                  </div>
                </div>

                {/* GPU */}
                <div style={{ background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#777', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>GPU</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: 1,
                      background: systemStats.gpuEncoder === 'nvenc' ? colors.success : systemStats.gpuEncoder === 'qsv' ? colors.warning : '#777',
                      boxShadow: systemStats.gpuEncoder === 'nvenc' ? '0 0 4px #00FF8866' : 'none',
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {systemStats.gpuName || 'No GPU'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, fontSize: 8, color: colors.borderHover, fontFamily: 'monospace', marginTop: 2 }}>
                    <span style={{ color: systemStats.gpuEncoder === 'nvenc' ? colors.success : '#777' }}>{systemStats.gpuEncoder?.toUpperCase() || 'CPU'}</span>
                    <span>tier: {systemStats.gpuTier || '?'}</span>
                    <span>workers: {systemStats.maxChunkWorkers || 2}</span>
                  </div>
                </div>

                {/* GPU Stats */}
                {systemStats.gpuEncoder === 'nvenc' && (
                  <div style={{ background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 6, padding: '10px 12px' }}>
                    <div style={{ fontSize: 8, color: '#777', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>GPU LOAD</div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>{systemStats.gpuUsage ?? 0}%</div>
                        <div style={{ fontSize: 7, color: colors.borderHover, marginTop: 2 }}>utilization</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>{systemStats.gpuTemp ?? 0}°C</div>
                        <div style={{ fontSize: 7, color: colors.borderHover, marginTop: 2 }}>temperature</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>
                          {Math.round((systemStats.gpuMemoryFree ?? 0) / 1024)}GB
                        </div>
                        <div style={{ fontSize: 7, color: colors.borderHover, marginTop: 2 }}>
                          free / {Math.round((systemStats.gpuMemoryTotal ?? 0) / 1024)}GB
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* RAM Disk */}
                <div style={{ background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#777', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>RAM DISK</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: 1,
                      background: systemStats.ramDiskIsAvailable ? colors.success : '#888',
                      boxShadow: systemStats.ramDiskIsAvailable ? '0 0 4px #00FF8866' : 'none',
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: systemStats.ramDiskIsAvailable ? '#888' : '#888' }}>
                      {systemStats.ramDiskIsAvailable ? `${systemStats.ramDiskTotal}GB` : 'N/A'}
                    </span>
                  </div>
                  {systemStats.ramDiskIsAvailable && (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <span style={{ fontSize: 8, color: colors.accent, fontFamily: 'monospace' }}>
                          {systemStats.ramDiskUsed}GB used
                        </span>
                        <span style={{ fontSize: 8, color: colors.borderHover, fontFamily: 'monospace' }}>
                          {systemStats.ramDiskAvailable}GB avail
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Workers */}
                <div style={{ background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#777', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>WORKERS</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: systemStats.activeWorkers > 0 ? colors.accent : '#888', fontFamily: 'monospace' }}>
                      {systemStats.activeWorkers ?? 0}
                    </span>
                    <span style={{ fontSize: 8, color: '#888' }}>/ {systemStats.maxChunkWorkers || 2} max</span>
                  </div>
                  <div style={{ fontSize: 8, color: colors.borderHover, marginTop: 2 }}>NVENC render workers</div>
                </div>

                {/* Network */}
                <div style={{ background: colors.bg, border: '1px solid #E0E0E0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, color: '#777', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>NETWORK</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: systemStats.isOnline ? colors.success : colors.error,
                      boxShadow: systemStats.isOnline ? '0 0 4px #00FF8866' : '0 0 4px #FF444466',
                    }} />
                    <span style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>{systemStats.networkIp || '127.0.0.1'}</span>
                  </div>
                  <div style={{ fontSize: 8, color: colors.borderHover, marginTop: 2 }}>
                    {systemStats.isOnline ? 'Online' : 'Offline'}
                  </div>
                </div>
              </div>
            </div>

            {/* Storage */}
            <div style={{ fontSize: 9, fontWeight: 800, color: '#888', letterSpacing: '0.1em', marginBottom: 0, padding: '12px 20px 8px', background: colors.bg }}>STORAGE</div>
            <div style={{ background: colors.bg, borderBottom: '1px solid #E0E0E0' }}>
              <StorageWidget />
            </div>

            {/* About */}
            <div style={{ fontSize: 9, fontWeight: 800, color: '#888', letterSpacing: '0.1em', marginBottom: 0, padding: '12px 20px 8px', background: colors.bg }}>ABOUT</div>
            <div style={{ background: colors.bg }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#777' }}>
                  <span style={{ color: colors.accent, fontWeight: 700 }}>HyperClip</span> v0.1.0
                </div>
                <div style={{ fontSize: 9, color: colors.borderHover, fontFamily: 'monospace' }}>
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
        ::-webkit-scrollbar-thumb { background: #E0E0E0; border-radius: 2px; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
