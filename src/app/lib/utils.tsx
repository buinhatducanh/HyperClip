'use client'

import React from 'react'
import {
  QUOTA_BAR_WARN_PCT,
  QUOTA_BAR_EXHAUSTED_PCT,
} from './constants'

// ─── Time formatting helpers ─────────────────────────────────────────────────────

export function formatNextReset(ts: number | null): string {
  if (!ts) return '—'
  const diff = ts - Date.now()
  if (diff <= 0) return 'sắp reset'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatTimeAgo(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  return `${Math.floor(diff / 3600000)}h`
}

function _getPTOffset(): { isPDT: boolean; ptOffsetHours: number } {
  const now = new Date()
  const utcHour = now.getUTCHours()
  const utcYear = now.getUTCFullYear()
  const march1 = new Date(Date.UTC(utcYear, 2, 1))
  const firstSundayMarch = new Date(Date.UTC(utcYear, 2, march1.getUTCDay() === 0 ? 1 : 8 - march1.getUTCDay()))
  const nov1 = new Date(Date.UTC(utcYear, 10, 1))
  const firstSundayNov = new Date(Date.UTC(utcYear, 10, nov1.getUTCDay() === 0 ? 1 : 8 - nov1.getUTCDay()))
  const isPDT = now >= firstSundayMarch && now < firstSundayNov
  const ptOffsetHours = isPDT ? -7 : -8
  return { isPDT, ptOffsetHours }
}

export function getPTDateStr(): { hour: number; dayStr: string } {
  const now = new Date()
  const utcHour = now.getUTCHours()
  const utcYear = now.getUTCFullYear()
  const { ptOffsetHours } = _getPTOffset()
  let ptHour = utcHour + ptOffsetHours
  const adjustedHour = ptHour < 0 ? ptHour + 24 : ptHour
  const dayStr = ptHour < 0
    ? `${utcYear}-${String(new Date(now.getTime() - 86400000).getUTCMonth() + 1).padStart(2, '0')}-${String(new Date(now.getTime() - 86400000).getUTCDate()).padStart(2, '0')}`
    : `${utcYear}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
  return { hour: Math.floor(adjustedHour), dayStr }
}

// ─── Usage Timeline Chart ─────────────────────────────────────────────────────────

export function UsageTimeline({ events }: { events: number[] }) {
  const { hour: currentHour } = getPTDateStr()

  // Build 24 hourly buckets based on PT time
  const buckets = Array.from({ length: 24 }, () => 0)
  for (const ts of events) {
    const d = new Date(ts)
    const utcHour = d.getUTCHours()
    const utcYear = d.getUTCFullYear()
    const march1 = new Date(Date.UTC(utcYear, 2, 1))
    const firstSundayMarch = new Date(Date.UTC(utcYear, 2, march1.getUTCDay() === 0 ? 1 : 8 - march1.getUTCDay()))
    const nov1 = new Date(Date.UTC(utcYear, 10, 1))
    const firstSundayNov = new Date(Date.UTC(utcYear, 10, nov1.getUTCDay() === 0 ? 1 : 8 - nov1.getUTCDay()))
    const isPDT = d >= firstSundayMarch && d < firstSundayNov
    const ptOffsetHours = isPDT ? -7 : -8
    let ptHour = utcHour + ptOffsetHours
    if (ptHour < 0) ptHour += 24
    buckets[Math.floor(ptHour)]++
  }

  const maxBucket = Math.max(...buckets, 1)
  const axisLabels = [0, 6, 12, 18]
  const bucketsPerLabel: Record<number, string> = { 0: '00', 6: '06', 12: '12', 18: '18' }

  return (
    <div style={{ padding: '0 2px' }}>
      {/* Time axis labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, paddingLeft: 2, paddingRight: 2 }}>
        {axisLabels.map(h => (
          <span key={h} style={{ fontSize: 7, color: '#2A2A2A', fontFamily: 'monospace' }}>{bucketsPerLabel[h]}</span>
        ))}
        <span style={{ fontSize: 7, color: '#1A1A1A', fontFamily: 'monospace' }}>PT</span>
      </div>

      {/* Bars */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 1,
        height: 36, borderBottom: '1px solid #1A1A1A',
      }}>
        {buckets.map((count, i) => {
          const heightPct = (count / maxBucket) * 100
          const isCurrent = i === currentHour
          const isPast = i < currentHour
          const barColor = isCurrent
            ? '#00B4FF'
            : isPast
              ? count > 0 ? `rgba(0,180,255,${Math.max(0.15, count / maxBucket * 0.7)})` : '#0d0d0d'
              : '#111'
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', position: 'relative' }} title={`${String(i).padStart(2, '0')}:00 PT — ${count} calls`}>
              {heightPct > 0 && (
                <div style={{
                  width: '100%',
                  height: `${Math.max(heightPct, 3)}%`,
                  background: barColor,
                  borderRadius: '1px 1px 0 0',
                  transition: 'height 0.3s ease',
                  ...(isCurrent ? { boxShadow: '0 0 4px #00B4FF88' } : {}),
                }} />
              )}
              {heightPct === 0 && <div style={{ width: '100%', flex: 1 }} />}
            </div>
          )
        })}
      </div>

      {/* Current hour indicator */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
        <span style={{ fontSize: 7, color: '#00B4FF88', fontFamily: 'monospace' }}>
          now {String(currentHour).padStart(2, '0')}:00 PT
        </span>
      </div>
    </div>
  )
}

// ─── Stat Card ───────────────────────────────────────────────────────────────────

export function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, minWidth: 120, padding: '12px 14px',
      background: '#0D0D0D', border: '1px solid #1A1A1A', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        <span style={{ fontSize: 8, color: '#3A3A3A', fontWeight: 700, letterSpacing: '0.1em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#ccc', fontFamily: 'monospace', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 8, color: '#333' }}>{sub}</div>}
    </div>
  )
}

// ─── Overall Quota Bar ──────────────────────────────────────────────────────────

export function QuotaBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  const barColor = pct >= QUOTA_BAR_EXHAUSTED_PCT ? '#FF4444' : pct >= QUOTA_BAR_WARN_PCT ? '#FFB800' : '#00FF88'

  return (
    <div style={{ padding: '12px 16px', background: '#0D0D0D', borderBottom: '1px solid #141414' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'baseline' }}>
        <span style={{ fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: '0.08em' }}>OVERALL QUOTA</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: barColor, fontWeight: 700 }}>
          {used.toLocaleString()} <span style={{ color: '#333' }}>/</span> {total.toLocaleString()} <span style={{ color: '#333', fontSize: 9 }}>units</span>
          <span style={{ color: '#222', fontSize: 9, marginLeft: 8 }}>({pct}%)</span>
        </span>
      </div>
      <div style={{ height: 8, background: '#141414', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`, height: '100%', background: barColor,
          borderRadius: 4, transition: 'width 0.6s ease',
          boxShadow: `0 0 8px ${barColor}55`,
        }} />
        <div style={{ position: 'absolute', top: 0, left: `${QUOTA_BAR_WARN_PCT}%`, width: 1, height: '100%', background: '#333' }} />
        <div style={{ position: 'absolute', top: 0, left: `${QUOTA_BAR_EXHAUSTED_PCT}%`, width: 1, height: '100%', background: '#555' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 7, color: '#2A2A2A' }}>0%</span>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ fontSize: 7, color: '#2A2A2A' }}>{QUOTA_BAR_WARN_PCT}%</span>
          <span style={{ fontSize: 7, color: '#2A2A2A' }}>{QUOTA_BAR_EXHAUSTED_PCT}%</span>
          <span style={{ fontSize: 7, color: '#2A2A2A' }}>100%</span>
        </div>
      </div>
    </div>
  )
}
