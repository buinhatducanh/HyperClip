'use client'

import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { Video, EditorState, SystemStats } from '../types'
import { ipc } from '../lib/ipc'
import { SkeletonEditor } from './Skeleton'

interface Props {
  video: Video | null
  editorState: EditorState
  onChange: (patch: Partial<EditorState>) => void
  onRender: () => void
  onExportChunked?: () => void
  systemStats?: SystemStats
  onShowToast?: (msg: string) => void
  onSplit?: (id: string, partMinutes: number) => void
  settings?: { defaultTrimLimit: number | 'full' }
  /** Download quality cap (e.g. "720") — max export quality */
  downloadQuality?: string
  /** YouTube available video heights (e.g. [360, 720, 1080]) — for quality validation UI */
  availableFormats?: number[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function parseDuration(d: string | number): number {
  if (typeof d !== 'string') return Number(d) || 0
  const parts = d.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parseFloat(d) || 0
}

// ─── SVG Icons ───────────────────────────────────────────────────────────────────

function IconScissors({ size = 12, color = '#555' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  )
}

function IconImage({ size = 12, color = '#555' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

function IconType({ size = 12, color = '#555' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  )
}

function IconZap({ size = 12, color = '#555' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function IconPalette({ size = 12, color = '#555' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="8" cy="14" r="1.5" fill={color} stroke="none" />
      <circle cx="16" cy="14" r="1.5" fill={color} stroke="none" />
      <circle cx="12" cy="10" r="1.5" fill={color} stroke="none" />
    </svg>
  )
}

function IconBarBottom({ size = 12, color = '#555' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function IconPlay({ size = 18, color = '#FFF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

function IconPause({ size = 18, color = '#FFF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function IconRewind({ size = 16, color = '#FFF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <polygon points="11 19 2 12 11 5 11 19" fill={color} />
      <polygon points="22 19 13 12 22 5 22 19" fill={color} />
    </svg>
  )
}

function IconForward({ size = 16, color = '#FFF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <polygon points="13 19 22 12 13 5 13 19" fill={color} />
      <polygon points="2 19 11 12 2 5 2 19" fill={color} />
    </svg>
  )
}

function IconVolume({ size = 14, muted = false, color = '#FFF' }: { size?: number; muted?: boolean; color?: string }) {
  if (muted) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={color} />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={color} />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function IconRefresh({ size = 12, color = '#555' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
    </svg>
  )
}

function IconX({ size = 14, color = '#555' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function IconUpload({ size = 12, color = '#555' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function IconChevronRight({ size = 12, color = '#333' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function IconChevronLeft({ size = 12, color = '#333' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

// ─── Empty State ─────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#0A0A0A' }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1E1E1E" strokeWidth="1.5">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
      <div style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>Chọn video để chỉnh sửa</div>
      <div style={{ fontSize: 10, color: '#222', lineHeight: 1.6, textAlign: 'center' }}>
        Danh sách video ở panel bên trái<br />
        <span style={{ color: '#1A1A1A' }}>Kênh mới sẽ xuất hiện tự động trong vài phút</span>
      </div>
    </div>
  )
}

// ─── Trim Controls ───────────────────────────────────────────────────────────────

const TrimSection = React.memo(function TrimSection({ start, end, duration, currentTime, onChange, speedMultiplier = 1.0 }: { start: number; end: number; duration: number; currentTime: number; onChange: (s: number, e: number) => void; speedMultiplier?: number }) {
  const startSec = (start / 100) * duration
  const endSec = (end / 100) * duration
  const selectedSec = Math.max(0, endSec - startSec)
  const spedUpSec = selectedSec / speedMultiplier
  const playbackPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div style={{ padding: '10px 0 8px' }}>
      {/* Dual handle slider */}
      <div style={{ position: 'relative', height: 20, marginBottom: 6 }}>
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: 0, right: 0, height: 4, background: '#1A1A1A', borderRadius: 2 }} />
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: `${start}%`, width: `${end - start}%`, height: 4, background: '#00B4FF', borderRadius: 2 }} />
        {/* Playback position indicator */}
        {playbackPct > 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: `${Math.min(playbackPct, 100)}%`,
            transform: 'translate(-50%, -50%)', width: 2, height: 12,
            background: '#FF4444', borderRadius: 1, zIndex: 3, pointerEvents: 'none',
          }} />
        )}
        {/* Start handle */}
        <div
          style={{ position: 'absolute', top: '50%', left: `${start}%`, transform: 'translate(-50%, -50%)', width: 12, height: 12, borderRadius: '50%', background: '#fff', border: '2px solid #00B4FF', cursor: 'ew-resize', zIndex: 2 }}
          onMouseDown={(e) => {
            e.stopPropagation(); e.preventDefault()
            const container = e.currentTarget.parentElement!
            const rect = container.getBoundingClientRect()
            const onMove = (me: MouseEvent) => {
              const pct = Math.max(0, Math.min(end - 1, ((me.clientX - rect.left) / rect.width) * 100))
              onChange(pct, end)
            }
            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
          }}
        />
        {/* End handle */}
        <div
          style={{ position: 'absolute', top: '50%', left: `${end}%`, transform: 'translate(-50%, -50%)', width: 12, height: 12, borderRadius: '50%', background: '#fff', border: '2px solid #00B4FF', cursor: 'ew-resize', zIndex: 2 }}
          onMouseDown={(e) => {
            e.stopPropagation(); e.preventDefault()
            const container = e.currentTarget.parentElement!
            const rect = container.getBoundingClientRect()
            const onMove = (me: MouseEvent) => {
              const pct = Math.max(start + 1, Math.min(100, ((me.clientX - rect.left) / rect.width) * 100))
              onChange(start, pct)
            }
            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
          }}
        />
      </div>
      {/* Time chips */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: '#444', fontWeight: 600 }}>IN</span>
          <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', fontWeight: 600 }}>{fmtTime(startSec)}</span>
        </div>
        <span style={{ fontSize: 11, color: '#00B4FF', fontFamily: 'monospace', fontWeight: 700 }}>{fmtTime(selectedSec)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', fontWeight: 600 }}>{fmtTime(endSec)}</span>
          <span style={{ fontSize: 10, color: '#444', fontWeight: 600 }}>OUT</span>
        </div>
      </div>
      {/* Sped-up duration */}
      {speedMultiplier !== 1.0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          padding: '5px 8px', background: '#00FF8808', border: '1px solid #00FF8820', borderRadius: 3,
        }}>
          <span style={{ fontSize: 9, color: '#444', fontWeight: 600 }}>OUTPUT</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#00FF88', fontFamily: 'monospace' }}>
            {fmtTime(spedUpSec)}
          </span>
          <span style={{ fontSize: 9, color: '#00FF8866', fontWeight: 600 }}>
            @{speedMultiplier.toFixed(1)}x
          </span>
          <span style={{ fontSize: 9, color: '#333' }}>
            ({Math.round(spedUpSec)}s)
          </span>
        </div>
      )}
      {/* Total duration */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
        <span style={{ fontSize: 9, color: '#2a2a2a' }}>TỔNG: {fmtTime(duration)}</span>
        {speedMultiplier !== 1.0 && (
          <span style={{ fontSize: 9, color: '#222' }}>SPEED → OUTPUT</span>
        )}
      </div>
    </div>
  )
})

// ─── Header Image Section ────────────────────────────────────────────────────────

function SplitIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <line x1="4" y1="1" x2="4" y2="11" stroke="#555" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="8" y1="1" x2="8" y2="11" stroke="#555" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="1" y1="6" x2="11" y2="6" stroke="#555" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

interface SplitSectionProps {
  videoDuration: number
  trimLimitMinutes: number
  speedMultiplier?: number
  onSplit: (partMinutes: number) => void
}

const SplitSection = React.memo(function SplitSection({ videoDuration, trimLimitMinutes, speedMultiplier = 1.0, onSplit }: SplitSectionProps) {
  const [numParts, setNumParts] = useState(2)
  const [splitMode, setSplitMode] = useState<'count' | 'duration'>('count')
  const [customPartMin, setCustomPartMin] = useState(trimLimitMinutes)
  const [isSplitting, setIsSplitting] = useState(false)

  const speed = speedMultiplier

  // Compute parts based on mode
  const parts: Array<{ index: number; start: number; end: number }> = (() => {
    if (splitMode === 'count') {
      const count = Math.max(2, Math.min(numParts, 10))
      const partDur = videoDuration / count
      return Array.from({ length: count }, (_, i) => ({
        index: i + 1,
        start: Math.floor(i * partDur),
        end: i === count - 1 ? videoDuration : Math.floor((i + 1) * partDur),
      }))
    } else {
      const partDur = customPartMin * 60
      const count = Math.ceil(videoDuration / partDur)
      return Array.from({ length: count }, (_, i) => ({
        index: i + 1,
        start: Math.floor(i * partDur),
        end: i === count - 1 ? videoDuration : Math.floor((i + 1) * partDur),
      }))
    }
  })()

  const handleSplit = async () => {
    setIsSplitting(true)
    const actualPartMin = splitMode === 'duration' ? customPartMin : Math.ceil(videoDuration / numParts / 60)
    await onSplit(actualPartMin)
    setIsSplitting(false)
  }

  const maxParts = Math.min(4, Math.floor(videoDuration / 30)) || 2

  return (
    <div style={{ padding: '10px 0 8px' }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button
          onClick={() => setSplitMode('count')}
          style={{
            flex: 1, height: 26,
            background: splitMode === 'count' ? '#00B4FF15' : '#1A1A1A',
            border: `1px solid ${splitMode === 'count' ? '#00B4FF' : '#222'}`,
            borderRadius: 3, fontSize: 9, fontWeight: 700,
            color: splitMode === 'count' ? '#00B4FF' : '#555',
            cursor: 'pointer',
          }}
        >
          SỐ PHẦN
        </button>
        <button
          onClick={() => setSplitMode('duration')}
          style={{
            flex: 1, height: 26,
            background: splitMode === 'duration' ? '#00B4FF15' : '#1A1A1A',
            border: `1px solid ${splitMode === 'duration' ? '#00B4FF' : '#222'}`,
            borderRadius: 3, fontSize: 9, fontWeight: 700,
            color: splitMode === 'duration' ? '#00B4FF' : '#555',
            cursor: 'pointer',
          }}
        >
          ĐỘ DÀI
        </button>
      </div>

      {/* Count mode */}
      {splitMode === 'count' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <input
              type="range"
              min={2} max={maxParts} value={numParts}
              onChange={(e) => setNumParts(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#00B4FF', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#00B4FF', fontFamily: 'monospace', minWidth: 24, textAlign: 'right' }}>
              {numParts}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#333' }}>
              Mỗi phần: {fmtDuration(Math.ceil(videoDuration / numParts))}
            </span>
            {speed !== 1.0 && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#00FF88' }}>
                → OUTPUT: {fmtDuration(Math.ceil(videoDuration / numParts / speed))}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Duration mode */}
      {splitMode === 'duration' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <input
              type="number"
              min={1} max={Math.floor(videoDuration / 60)} value={customPartMin}
              onChange={(e) => setCustomPartMin(Math.max(1, Number(e.target.value)))}
              style={{
                width: 52, height: 26, background: '#1A1A1A', border: '1px solid #222',
                borderRadius: 3, color: '#00B4FF', fontSize: 12, fontWeight: 700,
                fontFamily: 'monospace', textAlign: 'center', outline: 'none',
              }}
            />
            <span style={{ fontSize: 9, color: '#444' }}>phút / phần</span>
            <span style={{ fontSize: 9, color: '#333', marginLeft: 'auto' }}>
              {Math.ceil(videoDuration / customPartMin / 60)} phần
              {speed !== 1.0 && (
                <span style={{ color: '#00FF88', fontWeight: 700 }}>
                  {' '}→ {fmtDuration(Math.ceil(videoDuration / speed))} out
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Total output summary */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '5px 8px', background: '#1A1A1A', borderRadius: 3, marginBottom: 6,
        border: '1px solid #222',
      }}>
        <span style={{ fontSize: 9, color: '#444', fontWeight: 600 }}>TỔNG OUTPUT</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {speed !== 1.0 && (
            <span style={{ fontSize: 9, color: '#555', textDecoration: 'line-through' }}>
              {fmtDuration(videoDuration)}
            </span>
          )}
          <span style={{ fontSize: 13, fontWeight: 800, color: '#00FF88', fontFamily: 'monospace' }}>
            {fmtDuration(videoDuration / speed)}
          </span>
          {speed !== 1.0 && (
            <span style={{ fontSize: 9, color: '#00FF8866', fontWeight: 600 }}>
              @{speed.toFixed(1)}x
            </span>
          )}
        </div>
      </div>

      {/* Timeline preview */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ height: 20, background: '#1A1A1A', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
          {parts.map((p, i) => {
            const colors = ['#00B4FF', '#00FF88', '#FFB800', '#FF6B35', '#7C3AED']
            const color = colors[i % colors.length]
            const left = (p.start / videoDuration) * 100
            const width = ((p.end - p.start) / videoDuration) * 100
            return (
              <div key={p.index} style={{
                position: 'absolute', left: `${left}%`, width: `${width}%`,
                height: '100%', background: color + '44',
                borderLeft: i > 0 ? `2px solid ${color}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
                <span style={{ fontSize: 7, fontWeight: 700, color, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                  {width > 8 ? `${p.index}` : ''}
                </span>
              </div>
            )
          })}
        </div>
        {/* Time labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
          <span style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>0:00</span>
          <span style={{ fontSize: 8, color: '#333', fontFamily: 'monospace' }}>{fmtTime(videoDuration)}</span>
        </div>
      </div>

      {/* Parts list */}
      <div style={{ marginBottom: 8, maxHeight: 120, overflowY: 'auto' }} className="scrollbar">
        {parts.map((p) => {
          const origDur = p.end - p.start
          const outDur = origDur / speed
          return (
            <div key={p.index} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 0', borderBottom: '1px solid #1A1A1A',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 3, fontSize: 7, fontWeight: 800,
                  background: '#00B4FF22', color: '#00B4FF', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {p.index}
                </span>
                <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>
                  {fmtTime(p.start)} – {fmtTime(p.end)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {speed !== 1.0 && (
                  <span style={{ fontSize: 8, color: '#333', textDecoration: 'line-through' }}>
                    {fmtDuration(origDur)}
                  </span>
                )}
                <span style={{ fontSize: 9, fontWeight: 700, color: '#00FF88', fontFamily: 'monospace' }}>
                  {fmtDuration(outDur)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Split button */}
      <button
        onClick={handleSplit}
        disabled={isSplitting}
        style={{
          width: '100%', height: 30,
          background: isSplitting ? '#00B4FF22' : '#00B4FF15',
          border: '1px solid #00B4FF44',
          borderRadius: 3, fontSize: 10, fontWeight: 800, color: '#00B4FF',
          cursor: isSplitting ? 'default' : 'pointer', letterSpacing: '0.06em',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {isSplitting ? (
          <>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="5" cy="5" r="4" stroke="#00B4FF44" strokeWidth="1.5" fill="none"/>
              <path d="M5 1 A4 4 0 0 1 9 5" stroke="#00B4FF" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            </svg>
            ĐANG TÁCH...
          </>
        ) : (
          <>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <line x1="3" y1="1" x2="3" y2="9" stroke="#00B4FF" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="7" y1="1" x2="7" y2="9" stroke="#00B4FF" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            TÁCH {parts.length} PHẦN
          </>
        )}
      </button>
    </div>
  )
})



const HeaderSection = React.memo(function HeaderSection({ headerImageUrl, headerImageOffsetY, onChange, blobRef }: { headerImageUrl: string | null; headerImageOffsetY: number; onChange: (p: Partial<EditorState>) => void; blobRef: React.MutableRefObject<Set<string>> }) {
  const headerFileRef = useRef<HTMLInputElement>(null)

  return (
    <div style={{ padding: '10px 0 8px' }}>
      <input type="file" accept="image/*" ref={headerFileRef} className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) {
            const arrayBuffer = await f.arrayBuffer()
            const uint8 = new Uint8Array(arrayBuffer)
            const ext = f.name.split('.').pop() || 'png'
            const result = await ipc.saveBlobToFile(uint8, `header_${Date.now()}.${ext}`)
            const blobUrl = URL.createObjectURL(f)
            blobRef.current.add(blobUrl)
            onChange({ headerImageUrl: blobUrl, headerImageDiskPath: result?.diskPath ?? null })
          }
        }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={() => headerFileRef.current?.click()}
          style={{
            flex: 1, height: 30,
            background: headerImageUrl ? '#00B4FF15' : '#1A1A1A',
            border: `1px solid ${headerImageUrl ? '#00B4FF' : '#222'}`,
            borderRadius: 3, fontSize: 10, fontWeight: 700,
            color: headerImageUrl ? '#00B4FF' : '#555',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            transition: 'all 0.15s',
          }}
        >
          <IconUpload size={10} color={headerImageUrl ? '#00B4FF' : '#555'} />
          {headerImageUrl ? 'HEADER' : 'ADD HEADER'}
        </button>
        {headerImageUrl && (
          <button
            onClick={() => onChange({ headerImageUrl: null, headerImageDiskPath: null })}
            style={{ width: 30, height: 30, background: 'transparent', border: '1px solid #FF444422', borderRadius: 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <IconX size={12} color="#FF4444" />
          </button>
        )}
      </div>
      {headerImageUrl && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: '#444' }}>POSITION</span>
            <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
              {headerImageOffsetY < 33 ? 'TOP' : headerImageOffsetY < 66 ? 'CENTER' : 'BOTTOM'}
            </span>
          </div>
          <input type="range" min={0} max={100} value={headerImageOffsetY}
            onChange={(e) => onChange({ headerImageOffsetY: +e.target.value })}
            style={{ width: '100%', height: 3 }}
          />
        </div>
      )}
    </div>
  )
})

// ─── Title Section (merged: title overlay + bottom bar for SHORT) ─────────────────

const SHAPE_PRESETS = [
  { id: 'rounded', label: '●', title: 'Rounded' },
  { id: 'square', label: '■', title: 'Square' },
  { id: 'diamond', label: '◆', title: 'Diamond' },
] as const

const TitleSection = React.memo(function TitleSection({ titleText, titleShape, titleBorderColor, titleBgColor, titleFontSize, bottomBarEnabled, bottomBarColor, onChange }: {
  titleText: string; titleShape: 'rounded' | 'square' | 'diamond'; titleBorderColor: string; titleBgColor: string; titleFontSize: number
  bottomBarEnabled: boolean; bottomBarColor: string
  onChange: (p: Partial<EditorState>) => void
}) {
  return (
    <div style={{ padding: '10px 0 8px' }}>
      {/* Textarea */}
      <textarea
        value={titleText}
        onChange={(e) => onChange({ titleText: e.target.value })}
        placeholder="Nhập tiêu đề..."
        rows={2}
        style={{
          width: '100%', background: '#080808', borderWidth: 1, borderStyle: 'solid', borderColor: '#1A1A1A',
          borderRadius: 3, color: '#AAA', fontSize: 11, padding: '6px 8px',
          resize: 'none', outline: 'none', fontFamily: 'Inter', lineHeight: 1.3,
        }}
      />

      {/* Shape buttons */}
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {SHAPE_PRESETS.map(s => {
          const active = titleShape === s.id
          return (
            <button key={s.id} onClick={() => onChange({ titleShape: s.id } as any)}
              style={{ flex: 1, height: 26, fontSize: 11, cursor: 'pointer', background: active ? '#00B4FF15' : '#1A1A1A', borderWidth: 1, borderStyle: 'solid', borderColor: active ? '#00B4FF' : '#222', borderRadius: 3, color: active ? '#00B4FF' : '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
              title={s.title}
            >
              <span style={{ fontSize: 10 }}>{s.label}</span>
            </button>
          )
        })}
      </div>

      {/* Colors + Font size */}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: '#444', marginBottom: 3 }}>VIỀN</div>
          <div style={{ position: 'relative', height: 24, borderRadius: 2, background: titleBorderColor, border: '1px solid #222', overflow: 'hidden' }}>
            <input type="color" value={titleBorderColor} onChange={(e) => onChange({ titleBorderColor: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: '#444', marginBottom: 3 }}>NỀN</div>
          <div style={{ position: 'relative', height: 24, borderRadius: 2, background: titleBgColor.startsWith('rgba') ? '#000' : titleBgColor, border: '1px solid #222', overflow: 'hidden' }}>
            <input type="color" value={titleBgColor.startsWith('rgba') ? '#000000' : titleBgColor} onChange={(e) => onChange({ titleBgColor: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: '#444', marginBottom: 3 }}>CỠ</div>
          <div style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1A1A1A', border: '1px solid #222', borderRadius: 2 }}>
            <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', fontWeight: 700 }}>{titleFontSize}</span>
          </div>
        </div>
      </div>
      <input type="range" min={8} max={32} value={titleFontSize}
        onChange={(e) => onChange({ titleFontSize: +e.target.value })}
        style={{ width: '100%', height: 3, marginTop: 4 }}
      />

      {/* Bottom bar toggle (SHORT only) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid #1A1A1A' }}>
        <input
          type="checkbox"
          id="bb-enabled"
          checked={bottomBarEnabled}
          onChange={(e) => {
            onChange({ bottomBarEnabled: e.target.checked })
            if (e.target.checked && !titleText) {
              onChange({ titleText: 'PART 1', bottomBarColor: '#000000' })
            }
          }}
          style={{ accentColor: '#00B4FF', width: 14, height: 14, cursor: 'pointer' }}
        />
        <label htmlFor="bb-enabled" style={{ fontSize: 11, color: '#888', cursor: 'pointer', flex: 1 }}>
          Bottom bar (SHORT only)
        </label>
      </div>

      {bottomBarEnabled && (
        <>
          {/* Color + Info row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <div style={{ position: 'relative', height: 24, width: 60, borderRadius: 2, background: bottomBarColor, border: '1px solid #222', overflow: 'hidden', flexShrink: 0 }}>
              <input
                type="color"
                value={bottomBarColor}
                onChange={(e) => onChange({ bottomBarColor: e.target.value })}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
              />
            </div>
            <span style={{ fontSize: 10, color: '#555' }}>
              Bar color — text is auto white
            </span>
          </div>

          {/* Preview strip */}
          <div style={{
            marginTop: 8, height: 16, borderRadius: 2,
            background: bottomBarColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, color: 'white', letterSpacing: 1,
          }}>
            {titleText || 'PART 1'}
          </div>
        </>
      )}
    </div>
  )
})

// ─── Speed Section ───────────────────────────────────────────────────────────────

const SPEED_PRESETS = [1.0, 1.5, 2.0]

interface SpeedSectionProps {
  speedMultiplier: number
  onChange: (p: Partial<EditorState>) => void
  videoDuration: number
  trimStart: number
  trimEnd: number
}

const SpeedSection = React.memo(function SpeedSection({ speedMultiplier, onChange, videoDuration, trimStart, trimEnd }: SpeedSectionProps) {
  const fmt = (v: number) => v.toFixed(1)
  const startSec = (trimStart / 100) * videoDuration
  const endSec = (trimEnd / 100) * videoDuration
  const selectedSec = Math.max(0, endSec - startSec)
  const spedUpSec = selectedSec / speedMultiplier
  const totalSpedUp = videoDuration / speedMultiplier

  return (
    <div style={{ padding: '10px 0 8px' }}>
      {/* Main display + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <button
          onClick={() => onChange({ speedMultiplier: Math.max(1.0, +(speedMultiplier - 0.1).toFixed(1)) })}
          style={{ width: 28, height: 28, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, color: '#555', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span>−</span>
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#00FF88', fontFamily: 'monospace' }}>{fmt(speedMultiplier)}</span>
          <span style={{ fontSize: 11, color: '#555', marginLeft: 2 }}>x</span>
        </div>
        <button
          onClick={() => onChange({ speedMultiplier: Math.min(2.0, +(speedMultiplier + 0.1).toFixed(1)) })}
          style={{ width: 28, height: 28, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, color: '#555', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span>+</span>
        </button>
      </div>
      {/* Slider */}
      <input type="range" min={10} max={20} value={Math.round(speedMultiplier * 10)}
        onChange={(e) => onChange({ speedMultiplier: +((+e.target.value) / 10).toFixed(1) })}
        style={{ width: '100%', height: 3, marginBottom: 6 }}
      />
      {/* Quick presets */}
      <div style={{ display: 'flex', gap: 4 }}>
        {SPEED_PRESETS.map(v => {
          const active = Math.abs(speedMultiplier - v) < 0.05
          return (
            <button key={v} onClick={() => onChange({ speedMultiplier: v })}
              style={{
                flex: 1, height: 22, background: active ? '#00FF8820' : '#1A1A1A',
                border: `1px solid ${active ? '#00FF88' : '#222'}`, borderRadius: 3,
                fontSize: 10, fontWeight: 700, color: active ? '#00FF88' : '#555',
                cursor: 'pointer', fontFamily: 'monospace',
              }}
            >
              {fmt(v)}x
            </button>
          )
        })}
      </div>
      {/* Output duration preview */}
      {speedMultiplier !== 1.0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          marginTop: 8, padding: '6px 8px',
          background: '#00FF8808', border: '1px solid #00FF8820', borderRadius: 3,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 9, color: '#444', fontWeight: 600 }}>TRIM OUT</span>
            {selectedSec > 0 && (
              <span style={{ fontSize: 9, color: '#333', textDecoration: 'line-through' }}>
                {fmtTime(selectedSec)}
              </span>
            )}
            {selectedSec > 0 ? (
              <span style={{ fontSize: 12, fontWeight: 800, color: '#00FF88', fontFamily: 'monospace' }}>
                {fmtTime(spedUpSec)}
              </span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 800, color: '#00FF88', fontFamily: 'monospace' }}>
                {fmtTime(totalSpedUp)}
              </span>
            )}
            <span style={{ fontSize: 9, color: '#00FF8866', fontWeight: 600 }}>@{speedMultiplier.toFixed(1)}x</span>
          </div>
        </div>
      )}
    </div>
  )
})

// ─── Background Section ─────────────────────────────────────────────────────────

const BackgroundSection = React.memo(function BackgroundSection({ backgroundType, backgroundColor, backgroundImageUrl, editorIsShort, onChange, vidHeightPct, videoId, onShowToast, blobRef }: {
  backgroundType: 'blur' | 'solid' | 'image'; backgroundColor: string
  backgroundImageUrl: string | null
  editorIsShort: boolean
  onChange: (p: Partial<EditorState>) => void
  vidHeightPct: number
  videoId?: string
  onShowToast?: (msg: string) => void
  blobRef: React.MutableRefObject<Set<string>>
}) {
  const bgImageFileRef = useRef<HTMLInputElement>(null)
  const thumbImageFileRef = useRef<HTMLInputElement>(null)

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const arrayBuffer = await f.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)
    const ext = f.name.split('.').pop() || 'png'
    const prefix = editorIsShort ? 'bg' : 'thumb'
    const result = await ipc.saveBlobToFile(uint8, `${prefix}_${Date.now()}.${ext}`)
    const blobUrl = URL.createObjectURL(f)
    blobRef.current.add(blobUrl)
    onChange({ backgroundImageUrl: blobUrl, backgroundImageDiskPath: result?.diskPath ?? null })
  }

  return (
    <div style={{ padding: '10px 0 8px' }}>
      {/* Type toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(['blur', 'solid', 'image'] as const).map(t => {
          const active = backgroundType === t
          return (
            <button key={t} onClick={() => onChange({ backgroundType: t })}
              style={{
                flex: 1, height: 26,
                background: active ? '#00B4FF15' : '#1A1A1A',
                border: `1px solid ${active ? '#00B4FF' : '#222'}`,
                borderRadius: 3, fontSize: 10, fontWeight: 700,
                color: active ? '#00B4FF' : '#555',
                cursor: 'pointer', letterSpacing: '0.04em',
              }}
            >
              {t === 'blur' ? 'BLUR' : t === 'solid' ? 'SOLID' : 'IMAGE'}
            </button>
          )
        })}
      </div>

      {/* Solid color */}
      {backgroundType === 'solid' && (
        <div style={{ position: 'relative', height: 28, borderRadius: 3, background: backgroundColor, border: '1px solid #222', overflow: 'hidden' }}>
          <input type="color" value={backgroundColor}
            onChange={(e) => onChange({ backgroundColor: e.target.value })}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
          />
        </div>
      )}

      {/* Blur regenerate */}
      {backgroundType === 'blur' && (
        <button
          onClick={async () => {
            if (!videoId) return
            onChange({ backgroundType: 'blur' })
            onShowToast?.('Regenerating blur...')
            const result = await ipc.regenerateWorkspaceBlur(videoId)
            if (result?.success) {
              onShowToast?.('Blur regenerated')
            } else {
              onShowToast?.(`Blur failed: ${result?.error || 'Unknown error'}`)
            }
          }}
          style={{ width: '100%', height: 28, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, color: '#555', fontSize: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#00B4FF44'; e.currentTarget.style.color = '#00B4FF' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.color = '#555' }}
        >
          <IconRefresh size={10} color="currentColor" />
          REGENERATE
        </button>
      )}

      {/* Image upload (background for short, thumbnail for landscape) */}
      {backgroundType === 'image' && (
        <input type="file" accept="image/*" ref={bgImageFileRef} className="hidden"
          onChange={handleImageUpload}
        />
      )}
      {backgroundType === 'image' && (
        <button onClick={() => bgImageFileRef.current?.click()}
          style={{ width: '100%', height: 28, background: '#1A1A1A', border: '1px solid dashed #222', borderRadius: 3, color: '#444', fontSize: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
        >
          <IconUpload size={10} color="currentColor" />
          UPLOAD {editorIsShort ? 'IMAGE' : 'THUMB'}
        </button>
      )}

      {/* Thumbnail upload for landscape mode — only when NOT in image mode */}
      {!editorIsShort && backgroundType !== 'image' && (
        <>
          <input type="file" accept="image/*" ref={thumbImageFileRef} className="hidden"
            onChange={handleImageUpload}
          />
          <button onClick={() => thumbImageFileRef.current?.click()}
            style={{ width: '100%', height: 28, marginTop: 6, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, color: '#555', fontSize: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          >
            <IconUpload size={10} color="currentColor" />
            {backgroundImageUrl ? 'CHANGE THUMB' : 'ADD THUMBNAIL'}
          </button>
          {backgroundImageUrl && (
            <button onClick={() => onChange({ backgroundImageUrl: null, backgroundImageDiskPath: null })}
              style={{ width: '100%', height: 22, marginTop: 4, background: 'transparent', border: '1px solid #FF444422', borderRadius: 3, color: '#FF4444', fontSize: 9, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              REMOVE THUMB
            </button>
          )}

          {/* Video height slider for landscape */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 10, color: '#444', fontWeight: 700 }}>VIDEO</span>
              <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>{vidHeightPct}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 8, color: '#2A2A2A', flexShrink: 0 }}>30</span>
              <input type="range" min={30} max={85} value={vidHeightPct}
                onChange={(e) => onChange({ vidHeightPct: +e.target.value })}
                style={{ flex: 1, height: 3 }}
              />
              <span style={{ fontSize: 8, color: '#2A2A2A', flexShrink: 0 }}>85</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
              <span style={{ fontSize: 8, color: '#2A2A2A' }}>video nhỏ</span>
              <span style={{ fontSize: 8, color: '#2A2A2A' }}>video lớn</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
})

// ─── Canvas Area ─────────────────────────────────────────────────────────────────

const CanvasArea = React.memo(function CanvasArea({ video, editorState, onChange, onTimeUpdate }: {
  video: Video | null
  editorState: EditorState
  onChange: (p: Partial<EditorState>) => void
  onTimeUpdate?: (sec: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Canvas dimensions — always exactly 9:16
  // width = quality × 9/16, height = quality (for output quality)
  const quality = editorState.exportQuality
  const NATIVE_W = Math.round(quality * 9 / 16)   // e.g. 607 at 1080p
  const NATIVE_H = quality                          // e.g. 1080 at 1080p

  const [canvasW, setCanvasW] = useState(0)
  const [canvasH, setCanvasH] = useState(0)

  // Video player state
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track blob URL for cleanup — prevents memory leaks when switching videos
  const blobUrlRef = useRef<string | null>(null)

  // Video source
  const [videoSrc, setVideoSrc] = useState('')
  const [videoNotAvailable, setVideoNotAvailable] = useState(false)
  const [localThumbSrc, setLocalThumbSrc] = useState<string | null>(null)

  // Header drag
  const [headerDragY, setHeaderDragY] = useState<number | null>(null)

  // Canvas sizing: guarantee 9:16 ratio
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const calc = () => {
      const rect = el.getBoundingClientRect()
      const availW = rect.width - 32  // padding
      const availH = rect.height - 32 - 40 // padding + controls
      if (availW <= 0 || availH <= 0) return
      // Scale to fit available space, always maintaining 9:16
      const scaleW = availW / NATIVE_W
      const scaleH = availH / NATIVE_H
      const scale = Math.min(scaleW, scaleH)
      setCanvasW(Math.floor(NATIVE_W * scale))
      setCanvasH(Math.floor(NATIVE_H * scale))
    }
    requestAnimationFrame(() => {
      calc()
      const ro = new ResizeObserver(calc)
      ro.observe(el)
      return () => ro.disconnect()
    })
  }, [NATIVE_W, NATIVE_H])

  // Load video when workspace changes
  useEffect(() => {
    if (!video?.id) {
      setVideoSrc(''); setVideoNotAvailable(false); setLocalThumbSrc(null)
      setIsReady(false); setPlaying(false); setCurrentTime(0); setVideoDuration(0); setVideoError(false)
      return
    }
    // Revoke old blob URL before loading new video
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }
    setVideoNotAvailable(false); setVideoSrc(''); setLocalThumbSrc(null)
    setIsReady(false); setPlaying(false); setCurrentTime(0); setVideoDuration(0); setVideoError(false)

    let cancelled = false
    // Force blob URL — protocol handler (registerFileProtocol) has unreliable file serving on Electron 41.
    // Blob approach reads the entire file into memory but is 100% reliable.
    ipc.getVideoBlob(video.id).then((bytes) => {
      if (cancelled) return
      if (bytes && bytes.length > 0) {
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' })
        const url = URL.createObjectURL(blob)
        blobUrlRef.current = url
        setVideoSrc(url)
      } else {
        setVideoNotAvailable(true)
      }
    })

    ipc.getImageFile(video.id).then((imgResult) => {
      if (!cancelled && imgResult?.dataUrl) setLocalThumbSrc(imgResult.dataUrl)
    })

    return () => {
      cancelled = true
      // Revoke blob URL on unmount or video change to prevent memory leaks
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }
    }
  }, [video?.id])

  // Apply speed
  useEffect(() => {
    if (videoRef.current && isReady) videoRef.current.playbackRate = editorState.speedMultiplier
  }, [editorState.speedMultiplier, isReady])

  // Play/pause sync
  useEffect(() => {
    if (!videoRef.current || !isReady) return
    if (playing) videoRef.current.play().catch(() => setPlaying(false))
    else videoRef.current.pause()
  }, [playing, isReady])

  // Auto-hide controls
  useEffect(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (playing) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 3000)
    } else {
      setShowControls(true)
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [playing])

  // Keyboard shortcuts
  useEffect(() => {
    if (!isReady) return
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (videoRef.current) {
          const seekBy = e.shiftKey ? 1 : 5
          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - seekBy)
          setCurrentTime(videoRef.current.currentTime)
        }
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (videoRef.current) {
          const seekBy = e.shiftKey ? 1 : 5
          videoRef.current.currentTime = Math.min(videoDuration, videoRef.current.currentTime + seekBy)
          setCurrentTime(videoRef.current.currentTime)
        }
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        const next = !muted
        if (videoRef.current) videoRef.current.muted = next
        setMuted(next)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isReady, muted, videoDuration])

  const handleSeekTo = useCallback((ratio: number) => {
    if (!videoRef.current || !isReady || videoDuration === 0) return
    const t = Math.max(0, Math.min(videoDuration, ratio * videoDuration))
    videoRef.current.currentTime = t
    setCurrentTime(t)
  }, [isReady, videoDuration])

  const handleTogglePlay = useCallback(() => {
    if (!videoRef.current || !isReady) return
    setPlaying(p => !p)
  }, [isReady])

  const handleToggleMute = useCallback(() => {
    if (!videoRef.current) return
    const next = !muted
    videoRef.current.muted = next
    setMuted(next)
  }, [muted])

  const totalSec = parseDuration(video?.duration || 0)
  const trimStartSec = (editorState.trimStart / 100) * totalSec
  const trimEndSec = (editorState.trimEnd / 100) * totalSec
  const selectedDuration = trimEndSec - trimStartSec
  const progress = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0
  const isDark = editorState.canvasBg === 'black'
  // Short: header(25%) + video(50%) + title(25%)
  // Landscape: thumb + video(vidHeightPct%) + part
  const isShort = video.isShort !== false
  const headerH = isShort ? Math.round(quality * 0.25) : Math.round(quality * (100 - editorState.vidHeightPct) / 2 / 100)
  const bottomBarH = isShort ? Math.round(quality * 0.25) : 0
  const titleH = isShort ? bottomBarH : Math.round(quality * (100 - editorState.vidHeightPct) / 2 / 100)
  const videoH = isShort ? Math.round(quality * 0.50) : Math.round(quality * editorState.vidHeightPct / 100)
  // Title font: clamp to not overflow the zone
  const maxTitleFont = Math.floor(titleH * 0.15)

  const showSpinner = !isReady && !videoError && (!!videoSrc || videoNotAvailable)

  if (!video) return <EmptyState />

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0A0A0A', position: 'relative' }}
      onMouseMove={() => setShowControls(true)}
    >
      {/* Centered canvas container */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        {canvasW > 0 && canvasH > 0 && (
          <div
            style={{
              width: canvasW,
              height: canvasH,
              background: isDark ? '#000' : '#FFF',
              borderRadius: 3,
              display: 'flex', flexDirection: 'column',
              position: 'relative', overflow: 'hidden',
              boxShadow: '0 20px 80px rgba(0,0,0,0.9), 0 0 0 1px #1A1A1A',
            }}
          >
            {/* Zone 1: Header Image (short) / Thumbnail (landscape) */}
            <div
              style={{
                width: '100%', height: `${(headerH / NATIVE_H) * 100}%`,
                background: isDark ? '#050505' : '#F0F0F0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
                cursor: headerDragY !== null ? 'grabbing' : 'ns-resize',
                position: 'relative',
                borderBottom: '1px solid #1A1A1A',
              }}
              onMouseDown={(e) => {
                const rect = e.currentTarget.parentElement!.getBoundingClientRect()
                setHeaderDragY(e.clientY)
                const move = (ev: MouseEvent) => {
                  const dy = (ev.clientY - rect.top) / rect.height * 100
                  onChange({ headerImageOffsetY: Math.max(0, Math.min(100, dy)) })
                }
                const up = () => {
                  setHeaderDragY(null)
                  window.removeEventListener('mousemove', move)
                  window.removeEventListener('mouseup', up)
                }
                window.addEventListener('mousemove', move)
                window.addEventListener('mouseup', up)
              }}
            >
              {isShort ? (
                // SHORT mode: header image zone — show thumbnail (like FFmpeg render)
                editorState.headerImageUrl ? (
                  <img src={editorState.headerImageUrl} alt="header"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `center ${editorState.headerImageOffsetY}%`, pointerEvents: 'none' }}
                  />
                ) : localThumbSrc ? (
                  // Show thumbnail in header zone (matches FFmpeg header overlay)
                  <img src={localThumbSrc} alt="header"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `center ${editorState.headerImageOffsetY}%`, pointerEvents: 'none' }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', opacity: 0.06 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', marginTop: 3, color: '#444' }}>HEADER</div>
                  </div>
                )
              ) : (
                // LANDSCAPE mode: thumbnail zone — prefer custom uploaded image, then extracted thumb, then YouTube thumbnail
                <img
                  src={editorState.backgroundImageUrl || localThumbSrc || video.thumbnail}
                  alt="thumbnail"
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {isShort && <div style={{ position: 'absolute', bottom: -3, left: '50%', transform: 'translateX(-50%)', width: 24, height: 5, background: '#00B4FF', borderRadius: 3, opacity: 0.6, cursor: 'ns-resize' }} />}
            </div>

            {/* Zone 2: Video */}
            <div
              style={{
                width: '100%', height: `${(videoH / NATIVE_H) * 100}%`,
                background: '#000', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
              onClick={handleTogglePlay}
            >
              {videoSrc && !videoNotAvailable && !videoError ? (
                <video
                  key={videoSrc}
                  ref={videoRef}
                  src={videoSrc}
                  style={{
                    width: '100%',
                    height: '100%',
                    // Both SHORT and LANDSCAPE use cover + center: scale to fill zone, crop excess.
                    // This matches FFmpeg render: scale to fit height → crop excess width (SHORT)
                    // or scale to fit width → crop excess height (LANDSCAPE).
                    objectFit: 'cover',
                    objectPosition: 'center',
                    display: 'block',
                  }}
                  onTimeUpdate={() => { if (videoRef.current) { setCurrentTime(videoRef.current.currentTime); onTimeUpdate?.(videoRef.current.currentTime) } }}
                  onLoadedMetadata={() => {
                    if (videoRef.current) {
                      setVideoDuration(videoRef.current.duration)
                      setIsReady(true)
                      videoRef.current.playbackRate = editorState.speedMultiplier
                    }
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onWaiting={() => setPlaying(false)}
                  onEnded={() => { setPlaying(false); if (videoRef.current) videoRef.current.currentTime = 0 }}
                  onError={() => { setVideoError(true); setIsReady(false) }}
                  preload="auto"
                />
              ) : (
                <img
                  src={localThumbSrc || video.thumbnail}
                  alt="thumbnail"
                  style={{
                    width: '100%',
                    height: '100%',
                    // Cover + center: crop to fill zone (matches FFmpeg render crop behavior)
                    objectFit: 'cover',
                    objectPosition: 'center',
                    display: 'block',
                    pointerEvents: 'none',
                  }}
                />
              )}

              {/* Spinner */}
              {showSpinner && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#00B4FF', animation: 'spin 0.8s linear infinite' }} />
                </div>
              )}

              {/* Center play button */}
              {isReady && !playing && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconPlay />
                  </div>
                </div>
              )}

              {/* Error / status badge */}
              {(videoError || videoNotAvailable) && (
                <div style={{ position: 'absolute', bottom: 4, left: 4, right: 4, padding: '2px 6px', borderRadius: 2, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', fontSize: 8, color: videoError ? '#FF4444' : '#FFB800', fontWeight: 700, textAlign: 'center', letterSpacing: '0.08em' }}>
                  {videoError ? 'VIDEO ERROR' : video.status === 'rendering' ? 'ĐANG RENDER...' : 'PREVIEW UNAVAILABLE'}
                </div>
              )}

              {/* Speed badge */}
              {isReady && editorState.speedMultiplier !== 1.0 && (
                <div style={{ position: 'absolute', top: 4, right: 4, padding: '2px 5px', borderRadius: 2, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', fontSize: 8, fontWeight: 700, color: '#00FF88', fontFamily: 'monospace' }}>
                  {editorState.speedMultiplier.toFixed(1)}x
                </div>
              )}

              {/* Zone label */}
              <div style={{ position: 'absolute', bottom: 3, right: 4, fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em' }}>
                VIDEO
              </div>
            </div>

            {/* Zone 3: Bottom bar (short + enabled) / Title overlay (landscape or short + disabled) */}
            <div style={{
              width: '100%', height: `${(titleH / NATIVE_H) * 100}%`,
              background: isDark ? '#000' : '#FFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 3, left: 4, fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em' }}>
                {isShort && editorState.bottomBarEnabled ? 'BOTTOM BAR' : (isShort ? 'TITLE' : 'PART')}
              </div>

              {isShort && editorState.bottomBarEnabled ? (
                // Bottom bar preview: thumbnail/blur bg + gradient + white text
                // Matches FFmpeg: blur background (same content as header zone) + text overlay
                <div style={{
                  width: '100%', height: '100%',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* Background: thumbnail/blur (same content as header zone) */}
                  {(localThumbSrc || video.thumbnail) ? (
                    <img
                      src={localThumbSrc || video.thumbnail}
                      alt=""
                      style={{
                        position: 'absolute', inset: 0,
                        width: '100%', height: '100%',
                        objectFit: 'cover',
                        objectPosition: `center ${editorState.headerImageOffsetY}%`,
                        pointerEvents: 'none',
                      }}
                    />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, background: editorState.bottomBarColor || '#000' }} />
                  )}
                  {/* Gradient overlay: dark at top → transparent at bottom (top 60%) */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.70) 0%, rgba(0,0,0,0.30) 40%, rgba(0,0,0,0) 100%)',
                    pointerEvents: 'none',
                  }} />
                  {/* White text centered */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{
                      fontSize: Math.round(bottomBarH * 0.45),
                      fontWeight: 700, color: '#FFF', textAlign: 'center', lineHeight: 1.2,
                    }}>
                      {editorState.titleText || 'PART 1'}
                    </span>
                  </div>
                </div>
              ) : (
                // Title overlay preview — matches FFmpeg drawtext (no box, text only on video)
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {editorState.titleText ? (
                    <span style={{ fontSize: Math.min(editorState.titleFontSize, maxTitleFont), fontWeight: 700, color: '#FFF', textAlign: 'center', lineHeight: 1.2, wordBreak: 'break-word', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                      {editorState.titleText}
                    </span>
                  ) : (
                    <span style={{ fontSize: Math.min(editorState.titleFontSize, maxTitleFont), fontWeight: 600, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 1.2 }}>
                      {isShort ? 'Nhập tiêu đề...' : 'Part 1, 2, 3...'}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Video controls overlay */}
            {isReady && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.92))',
                padding: '20px 6px 6px',
                opacity: showControls ? 1 : 0,
                transition: 'opacity 0.25s',
                pointerEvents: showControls ? 'auto' : 'none',
              }}>
                {/* Progress bar */}
                <div
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    handleSeekTo((e.clientX - rect.left) / rect.width)
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    const rect = e.currentTarget.getBoundingClientRect()
                    if (videoRef.current) videoRef.current.pause()
                    handleSeekTo((e.clientX - rect.left) / rect.width)
                    const onMove = (me: MouseEvent) => {
                      handleSeekTo((me.clientX - rect.left) / rect.width)
                    }
                    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
                  }}
                  style={{ position: 'relative', height: 12, cursor: 'pointer', marginBottom: 2 }}
                >
                  <div style={{ position: 'absolute', inset: 0, top: '50%', transform: 'translateY(-50%)', height: 3, background: 'rgba(255,255,255,0.2)', borderRadius: 2 }}>
                    <div style={{ position: 'absolute', left: `${editorState.trimStart}%`, width: `${editorState.trimEnd - editorState.trimStart}%`, height: '100%', background: 'rgba(255,255,136,0.2)', borderRadius: 2 }} />
                    <div style={{ height: '100%', width: `${progress}%`, background: '#FF0000', borderRadius: 2, transition: 'width 0.1s linear' }} />
                  </div>
                  <div style={{ position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)', left: `${progress}%`, width: 8, height: 8, borderRadius: '50%', background: '#FF0000' }} />
                  <div style={{ position: 'absolute', left: `${editorState.trimStart}%`, top: '50%', transform: 'translate(-50%, -50%)', width: 2, height: 7, background: '#00FF88', borderRadius: 1 }} />
                  <div style={{ position: 'absolute', left: `${editorState.trimEnd}%`, top: '50%', transform: 'translate(-50%, -50%)', width: 2, height: 7, background: '#00FF88', borderRadius: 1 }} />
                </div>

                {/* Controls row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button onClick={(e) => { e.stopPropagation(); if (videoRef.current) handleSeekTo((videoRef.current.currentTime - 5) / videoDuration) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <IconRewind size={16} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleTogglePlay() }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {playing ? <IconPause /> : <IconPlay />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); if (videoRef.current) handleSeekTo((videoRef.current.currentTime + 5) / videoDuration) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <IconForward size={16} />
                  </button>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#FFF', opacity: 0.9, minWidth: 80, flexShrink: 0 }}>
                    {fmtTime(currentTime)} / {fmtTime(videoDuration)}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button onClick={(e) => { e.stopPropagation(); handleToggleMute() }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <IconVolume size={14} muted={muted} />
                  </button>
                  <input type="range" min={0} max={1} step={0.05}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      e.stopPropagation()
                      const v = +e.target.value
                      setVolume(v); setMuted(v === 0)
                      if (videoRef.current) videoRef.current.volume = v
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 44, accentColor: '#FF0000', flexShrink: 0 }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dimension badge — show actual export resolution */}
      <div style={{ position: 'absolute', bottom: 20, left: 16, display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: editorState.exportQuality === 1080 ? '#00FF88' : editorState.exportQuality === 720 ? '#FFB800' : '#555' }}>
          {quality}×{Math.round(quality * 16 / 9)}
        </span>
      </div>

      {/* Keyboard shortcut hints */}
      <div style={{
        position: 'absolute', bottom: 6, left: 0, right: 0,
        display: 'flex', gap: 12, justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        {[
          ['Space', 'play/pause'],
          ['← →', 'seek ±5s'],
          ['Shift+←→', '±1s'],
          ['M', 'mute'],
        ].map(([key, desc]) => (
          <span key={key as string} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <kbd style={{ fontSize: 7, fontFamily: 'monospace', color: '#2A2A2A', background: '#1A1A1A', padding: '0 3px', borderRadius: 2, border: '1px solid #222' }}>{key}</kbd>
            <span style={{ fontSize: 7, color: '#2A2A2A' }}>{desc}</span>
          </span>
        ))}
      </div>
    </div>
  )
})

// ─── Controls Panel ─────────────────────────────────────────────────────────────

const ControlsPanel = React.memo(function ControlsPanel({ editorState, onChange, onRender, onExportChunked, isRendering, systemStats, editorIsShort, videoDuration, currentTime, videoId, onShowToast, renderProgress, workspaceId, isReady, trimLimitMinutes, onSplit, sourceResolution, downloadQuality, availableFormats }: {
  editorState: EditorState
  onChange: (p: Partial<EditorState>) => void
  onRender: () => void
  onExportChunked?: () => void
  isRendering: boolean
  currentTime?: number
  videoId?: string
  onShowToast?: (msg: string) => void
  systemStats?: SystemStats
  editorIsShort: boolean
  videoDuration: number
  renderProgress?: number
  workspaceId?: string
  isReady?: boolean
  trimLimitMinutes?: number
  onSplit?: (id: string, partMinutes: number) => void
  sourceResolution?: string
  /** Download quality cap (e.g. "720") — max export quality */
  downloadQuality?: string
  /** YouTube available video heights (e.g. [360, 720, 1080]) — for quality validation UI */
  availableFormats?: number[]
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['trim']))
  // Track blob URLs for cleanup — revoke on unmount to prevent memory leaks
  const blobRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const urls = blobRef.current
    return () => { urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const is = (id: string) => expanded.has(id)

  const sourceHeight = sourceResolution ? parseInt(sourceResolution.split('x')[1]) : 0
  // Max export quality: source height > downloadQuality (global setting) > 1080
  // YouTube probe max is NOT used as ceiling — user can upscale via FFmpeg (e.g. 720p source → 1080p export)
  const maxAllowedHeight = sourceHeight > 0
    ? sourceHeight  // Use actual source resolution as ceiling
    : downloadQuality
      ? parseInt(downloadQuality)
      : 1080  // Unknown source — show all buttons

  // Auto-upgrade only when probe reveals a higher available format AND current is below that max.
  // Never auto-downgrade — respect the user's manual selection.
  useEffect(() => {
    if (availableFormats === undefined || availableFormats.length === 0) return
    const probeMax = Math.max(...availableFormats)
    if (editorState.exportQuality < probeMax) {
      onChange({ exportQuality: probeMax as 1080 | 720 | 360 })
    }
  }, [availableFormats])
  return (
    <div style={{ width: 280, borderLeft: '1px solid #1A1A1A', display: 'flex', flexDirection: 'column', background: '#111' }}>
      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }} className="scrollbar">

        {/* TRIM */}
        <SectionHeader icon={<IconScissors size={11} color="#555" />} label="TRIM" isExpanded={is('trim')} onToggle={() => toggle('trim')} />
        {is('trim') && (
          <TrimSection
            start={editorState.trimStart}
            end={editorState.trimEnd}
            duration={videoDuration}
            currentTime={currentTime || 0}
            onChange={(s, e) => onChange({ trimStart: s, trimEnd: e })}
            speedMultiplier={editorState.speedMultiplier}
          />
        )}

        {/* SPLIT — only for ready workspaces longer than trim limit */}
        {isReady && workspaceId && videoDuration > ((trimLimitMinutes ?? 10) * 60) && (
          <>
            <SectionHeader icon={<SplitIcon />} label="SPLIT" isExpanded={is('split')} onToggle={() => toggle('split')} />
            {is('split') && (
              <SplitSection
                videoDuration={videoDuration}
                trimLimitMinutes={trimLimitMinutes || 10}
                speedMultiplier={editorState.speedMultiplier}
                onSplit={(partMinutes) => onSplit?.(workspaceId, partMinutes)}
              />
            )}
          </>
        )}

        {/* HEADER IMAGE (short mode only) */}
        {editorIsShort && (
          <>
            <SectionHeader icon={<IconImage size={11} color="#555" />} label="HEADER" isExpanded={is('header')} onToggle={() => toggle('header')} />
            {is('header') && (
              <HeaderSection
                headerImageUrl={editorState.headerImageUrl}
                headerImageOffsetY={editorState.headerImageOffsetY}
                onChange={onChange}
                blobRef={blobRef}
              />
            )}
          </>
        )}

        {/* TITLE (merged: title overlay + bottom bar) */}
        <SectionHeader icon={<IconType size={11} color="#555" />} label="TITLE" isExpanded={is('title')} onToggle={() => toggle('title')} />
        {is('title') && (
          <TitleSection
            titleText={editorState.titleText}
            titleShape={editorState.titleShape}
            titleBorderColor={editorState.titleBorderColor}
            titleBgColor={editorState.titleBgColor}
            titleFontSize={editorState.titleFontSize}
            bottomBarEnabled={editorState.bottomBarEnabled}
            bottomBarColor={editorState.bottomBarColor}
            onChange={onChange}
          />
        )}

        {/* SPEED */}
        <SectionHeader icon={<IconZap size={11} color="#555" />} label="SPEED" isExpanded={is('speed')} onToggle={() => toggle('speed')} />
        {is('speed') && (
          <SpeedSection
            speedMultiplier={editorState.speedMultiplier}
            onChange={onChange}
            videoDuration={videoDuration}
            trimStart={editorState.trimStart}
            trimEnd={editorState.trimEnd}
          />
        )}

        {/* BACKGROUND */}
        <SectionHeader icon={<IconPalette size={11} color="#555" />} label="BACKGROUND" isExpanded={is('bg')} onToggle={() => toggle('bg')} />
        {is('bg') && (
          <BackgroundSection
            backgroundType={editorState.backgroundType}
            backgroundColor={editorState.backgroundColor}
            backgroundImageUrl={editorState.backgroundImageUrl}
            editorIsShort={editorIsShort}
            onChange={onChange}
            vidHeightPct={editorState.vidHeightPct}
            videoId={videoId}
            onShowToast={onShowToast}
            blobRef={blobRef}
          />
        )}

        {/* CANVAS */}
        <SectionHeader icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>} label="CANVAS" isExpanded={is('canvas')} onToggle={() => toggle('canvas')} />
        {is('canvas') && (
          <div style={{ padding: '10px 0 8px' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['black', 'white'] as const).map(bg => {
                const active = editorState.canvasBg === bg
                return (
                  <button key={bg} onClick={() => onChange({ canvasBg: bg })}
                    style={{ flex: 1, height: 28, fontSize: 9, fontWeight: 700, cursor: 'pointer', background: active ? '#00B4FF15' : '#1A1A1A', borderWidth: 1, borderStyle: 'solid', borderColor: active ? '#00B4FF' : '#222', borderRadius: 3, color: active ? '#00B4FF' : '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <div style={{ width: 8, height: 8, background: bg === 'black' ? '#000' : '#FFF', borderWidth: 1, borderStyle: 'solid', borderColor: '#333', borderRadius: 1 }} />
                    {bg === 'black' ? 'TỐI' : 'SÁNG'}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Bottom padding for export buttons */}
        <div style={{ height: 100 }} />
      </div>

      {/* Sticky export section */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #1A1A1A', background: '#111', flexShrink: 0 }}>
        {/* Row 1: SPEED + QUALITY + FPS */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          {/* Speed — compact selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 8, color: '#444', letterSpacing: '0.06em' }}>SPD</span>
            <select
              value={editorState.speedMultiplier}
              onChange={e => onChange({ speedMultiplier: parseFloat(e.target.value) })}
              style={{
                height: 22, background: '#1A1A1A',
                border: '1px solid #222', borderRadius: 2,
                color: editorState.speedMultiplier !== 1.0 ? '#00FF88' : '#555',
                fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
                cursor: 'pointer', padding: '0 4px',
              }}
            >
              {[0.5, 0.75, 1.0, 1.1, 1.2, 1.5, 2.0].map(s => (
                <option key={s} value={s}>{s}x</option>
              ))}
            </select>
          </div>

          {/* Separator */}
          <div style={{ width: 1, height: 16, background: '#1A1A1A' }} />

          {/* Quality buttons */}
          <div style={{ display: 'flex', gap: 3 }}>
            {([1080, 720, 360] as const).map(q => {
              const hidden = q > maxAllowedHeight
              const active = editorState.exportQuality === q
              return (
                <button
                  key={q}
                  onClick={() => !hidden && onChange({ exportQuality: q as 1080 | 720 | 360 })}
                  style={{
                    height: 22, padding: '0 8px',
                    background: active ? '#00B4FF' : '#1A1A1A',
                    border: `1px solid ${active ? '#00B4FF' : '#222'}`,
                    borderRadius: 2, fontSize: 10, fontWeight: 700,
                    color: hidden ? '#222' : (active ? '#000' : '#444'),
                    cursor: hidden ? 'default' : 'pointer',
                    fontFamily: 'monospace',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: hidden ? 0.3 : 1,
                  }}>
                  {q}p
                </button>
              )
            })}
          </div>

          {/* Separator */}
          <div style={{ width: 1, height: 16, background: '#1A1A1A' }} />

          {/* FPS */}
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {([30, 60] as const).map(fps => {
              const active = editorState.exportFPS === fps
              return (
                <button
                  key={fps}
                  onClick={() => !isRendering && onChange({ exportFPS: fps })}
                  style={{
                    height: 22, padding: '0 8px',
                    background: active ? '#00FF8820' : '#1A1A1A',
                    border: `1px solid ${active ? '#00FF8844' : '#222'}`,
                    borderRadius: 2, fontSize: 9, fontWeight: 700,
                    color: active ? '#00FF88' : '#444',
                    cursor: isRendering ? 'not-allowed' : 'pointer',
                    fontFamily: 'monospace',
                  }}
                >
                  {fps}fps
                </button>
              )
            })}
          </div>

          {/* GPU MAX toggle */}
          {onExportChunked && (
            <>
              <div style={{ width: 1, height: 16, background: '#1A1A1A' }} />
              <button
                onClick={() => !isRendering && onChange({ enableChunked: !editorState.enableChunked })}
                disabled={isRendering}
                style={{
                  height: 22, padding: '0 8px',
                  background: editorState.enableChunked ? '#00FF8820' : '#1A1A1A',
                  border: `1px solid ${editorState.enableChunked ? '#00FF88' : '#222'}`,
                  borderRadius: 2, fontSize: 9, fontWeight: 700,
                  color: editorState.enableChunked ? '#00FF88' : '#444',
                  cursor: isRendering ? 'not-allowed' : 'pointer',
                  fontFamily: 'monospace', letterSpacing: '0.04em',
                }}
              >
                {editorState.enableChunked ? `${systemStats?.maxChunkWorkers || 8}x MAX` : 'MAX'}
              </button>
            </>
          )}
        </div>

        {/* Upscaling warning — shows source resolution */}
        {sourceHeight > 0 && editorState.exportQuality > sourceHeight && (
          <div style={{ fontSize: 9, color: '#FFB800', marginBottom: 6 }}>
            ⚠ Upscale: source was {sourceHeight}p
          </div>
        )}

        {/* TikTok upscale toggle — only when source is below 720p */}
        {sourceHeight > 0 && sourceHeight < 720 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '4px 8px', background: editorState.upscaleToTikTok ? '#00FF8815' : '#1A1A1A', borderRadius: 3, border: `1px solid ${editorState.upscaleToTikTok ? '#00FF8844' : '#222'}` }}>
            <input
              type="checkbox"
              id="upscale-tiktok"
              checked={editorState.upscaleToTikTok}
              onChange={(e) => onChange({ upscaleToTikTok: e.target.checked })}
              style={{ accentColor: '#00FF88', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }}
            />
            <label htmlFor="upscale-tiktok" style={{ fontSize: 9, cursor: 'pointer', flex: 1 }}>
              <span style={{ color: editorState.upscaleToTikTok ? '#00FF88' : '#555', fontWeight: 700 }}>TikTok 720p</span>
              <span style={{ color: '#333', marginLeft: 4 }}>— force 720p output</span>
            </label>
            {editorState.upscaleToTikTok && (
              <span style={{ fontSize: 8, fontWeight: 800, color: '#00FF88', fontFamily: 'monospace', background: '#00FF8820', padding: '1px 5px', borderRadius: 2, letterSpacing: '0.06em' }}>
                UP
              </span>
            )}
          </div>
        )}

        {/* Source resolution — small hint */}
        {sourceHeight > 0 && (
          <div style={{ fontSize: 8, color: '#2A2A2A', marginBottom: 6, fontFamily: 'monospace' }}>
            SRC {sourceHeight}p · {editorState.exportQuality}p export
          </div>
        )}

        {/* Render button */}
        <button
          onClick={editorState.enableChunked && onExportChunked ? onExportChunked : onRender as () => void}
          disabled={isRendering}
          style={{
            width: '100%', height: 40,
            background: isRendering
              ? '#FF444430'
              : editorState.enableChunked
                ? '#7C3AED'
                : '#00B4FF',
            borderWidth: 0, borderRadius: 3,
            fontSize: 11, fontWeight: 800,
            color: isRendering ? '#FF4444' : '#fff',
            cursor: isRendering ? 'not-allowed' : 'pointer',
            letterSpacing: '0.06em',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {isRendering ? (
            <>
              <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#FF4444', animation: 'spin 1s linear infinite' }} />
              {renderProgress !== undefined ? `${renderProgress}%` : 'RENDERING...'}
            </>
          ) : (
            <>
              {editorState.enableChunked ? 'GPU MAX' : 'RENDER'}
              <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.7 }}>
                · {editorState.exportQuality}p · {editorState.exportFPS}fps · H.264
              </span>
            </>
          )}
        </button>
        <div style={{ fontSize: 8, color: '#2A2A2A', textAlign: 'center', letterSpacing: '0.04em', marginTop: 4 }}>
          NVENC · {systemStats?.gpuName || 'GPU'}
        </div>
      </div>
    </div>
  )
})

// ─── Section Header ─────────────────────────────────────────────────────────────

const SectionHeader = React.memo(function SectionHeader({ icon, label, isExpanded, onToggle }: { icon: React.ReactNode; label: string; isExpanded: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={isExpanded ? 'Collapse' : 'Expand'}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0',
        background: 'transparent', border: 'none', borderBottom: '1px solid #1A1A1A',
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      {icon}
      <span style={{ flex: 1, fontSize: 10, fontWeight: 800, color: '#444', letterSpacing: '0.1em' }}>{label}</span>
      <svg
        width="10" height="10" viewBox="0 0 10 10" fill="none"
        stroke="#333" strokeWidth="1.5" strokeLinecap="round"
        style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }}
      >
        <polyline points="2,3 5,7 8,3" />
      </svg>
    </button>
  )
})

// ─── Main DetailEditor ──────────────────────────────────────────────────────────

export function DetailEditor({ video, editorState, onChange, onRender, onExportChunked, systemStats, onShowToast, onSplit, settings, downloadQuality, availableFormats }: Props) {
  const [currentTime, setCurrentTime] = useState(0)
  // Track blob URLs for cleanup — revoke on unmount to prevent memory leaks
  const blobRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const urls = blobRef.current
    return () => { urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  if (!video) return <EmptyState />

  const isRendering = video?.status === 'rendering'
  const editorIsShort = video.isShort !== false

  // Compute actual video duration for TrimSection
  const totalSec = parseDuration(video.duration || 0)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#121212' }}>
      {/* Header bar — minimal: title + mode + time */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingLeft: 16, paddingRight: 16, height: 36,
        borderBottom: '1px solid #1A1A1A', background: '#0D0D0D', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 7, height: 7, background: '#00B4FF', borderRadius: 2, flexShrink: 0 }} />
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: '#555' }}>EDITOR</span>
          <div style={{ width: 1, height: 10, background: '#222' }} />
          <span style={{ fontSize: 11, color: '#999', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {video.title}
          </span>
          <div style={{ width: 1, height: 10, background: '#222' }} />
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
            padding: '1px 5px',
            background: editorIsShort ? '#FFB80015' : '#00B4FF15',
            border: `1px solid ${editorIsShort ? '#FFB80040' : '#00B4FF40'}`,
            borderRadius: 2, color: editorIsShort ? '#FFB800' : '#00B4FF',
          }}>
            {editorIsShort ? 'SHORT' : 'VIDEO'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace', fontSize: 9, color: '#444' }}>
          <span style={{ color: '#555' }}>{fmtTime(currentTime)} / {fmtTime(totalSec)}</span>
        </div>
      </div>

      {/* Body: Canvas + Controls */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <CanvasArea video={video} editorState={editorState} onChange={onChange} onTimeUpdate={setCurrentTime} />
        <ControlsPanel
          editorState={editorState}
          onChange={onChange}
          onRender={onRender}
          onExportChunked={onExportChunked}
          isRendering={isRendering}
          systemStats={systemStats}
          editorIsShort={editorIsShort}
          videoDuration={totalSec}
          currentTime={currentTime}
          videoId={video?.id}
          onShowToast={onShowToast}
          renderProgress={video?.renderProgress}
          workspaceId={video?.id}
          isReady={(video as any)?.status === 'ready'}
          trimLimitMinutes={settings.defaultTrimLimit as number}
          onSplit={onSplit}
          sourceResolution={video?.videoResolution}
          downloadQuality={downloadQuality}
          availableFormats={availableFormats}
        />
      </div>

      <style>{`
        .scrollbar::-webkit-scrollbar { width: 3px; }
        .scrollbar::-webkit-scrollbar-track { background: transparent; }
        .scrollbar::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        .scrollbar::-webkit-scrollbar-thumb:hover { background: #333; }
      `}</style>
    </div>
  )
}
