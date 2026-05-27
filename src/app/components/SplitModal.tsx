'use client'
import { colors, spacing, fontSize } from '../design-system/tokens'

import { useState, useEffect, useCallback } from 'react'
import { ipc } from '../lib/ipc'

interface SplitPart {
  index: number
  start: number
  end: number
  duration: number
}

interface SplitModalProps {
  open: boolean
  workspaceId: string
  workspaceTitle: string
  videoDuration: number  // seconds
  onClose: () => void
  onSplit: (opts: { intervals?: number[]; partMinutes?: number; autoRender?: boolean }) => void
}

const MAX_PARTS = 4
const MIN_PART_DURATION = 30  // seconds

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export function SplitModal({ open, workspaceId, workspaceTitle, videoDuration, onClose, onSplit }: SplitModalProps) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [partMinutes, setPartMinutes] = useState(5)
  const [intervals, setIntervals] = useState<number[]>([])
  const [autoRender, setAutoRender] = useState(true)
  const [preview, setPreview] = useState<SplitPart[] | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch preview when mode/intervals/partMinutes changes
  const fetchPreview = useCallback(async () => {
    if (!workspaceId) return
    try {
      if (mode === 'auto') {
        const result = await ipc.splitWorkspacePreview(workspaceId, undefined, partMinutes)
        setPreview(result?.parts ?? null)
      } else {
        const result = await ipc.splitWorkspacePreview(workspaceId, intervals)
        setPreview(result?.parts ?? null)
      }
    } catch {
      setPreview(null)
    }
  }, [workspaceId, mode, partMinutes, intervals])

  useEffect(() => {
    if (!open) return
    fetchPreview()
  }, [open, fetchPreview])

  const numParts = preview?.length ?? 0
  const exceedsMax = numParts > MAX_PARTS
  const hasShortPart = preview?.some(p => p.duration < MIN_PART_DURATION) ?? false
  const canSplit = numParts >= 2 && !exceedsMax && !hasShortPart

  const handleAddInterval = (sec: number) => {
    if (intervals.includes(sec)) return
    setIntervals(prev => [...prev, sec].sort((a, b) => a - b))
  }

  const handleRemoveInterval = (sec: number) => {
    setIntervals(prev => prev.filter(t => t !== sec))
  }

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'manual') return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    const sec = Math.round(pct * videoDuration)
    if (sec > 0 && sec < videoDuration - MIN_PART_DURATION) {
      handleAddInterval(sec)
    }
  }

  const handleSplit = async () => {
    if (!canSplit) return
    setLoading(true)
    try {
      onSplit({
        intervals: mode === 'manual' ? intervals : undefined,
        partMinutes: mode === 'auto' ? partMinutes : undefined,
        autoRender,
      })
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        animation: 'fadeInSimple 0.15s ease-out',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #D0D0D0',
        borderRadius: 4,
        padding: '20px 24px',
        width: 480,
        maxWidth: '95vw',
        maxHeight: '85vh',
        overflowY: 'auto',
        animation: 'slideUp 0.15s ease-out',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 2 }}>
              Split Video
            </div>
            <div style={{ fontSize: 11, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 }}>
              {workspaceTitle} ({formatTime(videoDuration)})
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 24, height: 24, background: 'transparent', border: 'none',
              color: '#777', cursor: 'pointer', fontSize: 16, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setMode('auto')}
            style={{
              flex: 1, height: 28, background: mode === 'auto' ? '#00B4FF20' : colors.text,
              border: `1px solid ${mode === 'auto' ? colors.accent : '#2a2a2a'}`,
              borderRadius: 3, fontSize: 10, fontWeight: 600,
              color: mode === 'auto' ? colors.accent : '#555', cursor: 'pointer',
            }}
          >
            Auto-Split (đều mỗi N phút)
          </button>
          <button
            onClick={() => setMode('manual')}
            style={{
              flex: 1, height: 28, background: mode === 'manual' ? '#00B4FF20' : colors.text,
              border: `1px solid ${mode === 'manual' ? colors.accent : '#2a2a2a'}`,
              borderRadius: 3, fontSize: 10, fontWeight: 600,
              color: mode === 'manual' ? colors.accent : '#555', cursor: 'pointer',
            }}
          >
            Manual Split
          </button>
        </div>

        {/* Auto mode */}
        {mode === 'auto' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
              Mỗi part dài:
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[1, 2, 3, 5, 10].map(m => (
                <button
                  key={m}
                  onClick={() => setPartMinutes(m)}
                  style={{
                    height: 28, padding: '0 12px',
                    background: partMinutes === m ? '#00B4FF20' : colors.text,
                    border: `1px solid ${partMinutes === m ? colors.accent : '#2a2a2a'}`,
                    borderRadius: 3, fontSize: 10, fontWeight: 600,
                    color: partMinutes === m ? colors.accent : '#555', cursor: 'pointer',
                  }}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Manual mode */}
        {mode === 'manual' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
              Click vào timeline để thêm split point:
            </div>
            {/* Timeline */}
            <div
              onClick={handleTimelineClick}
              style={{
                height: 36, background: '#FFFFFF', borderRadius: 3,
                position: 'relative', cursor: 'crosshair', border: '1px solid #D0D0D0',
                marginBottom: 8, overflow: 'hidden',
              }}
            >
              {/* Timeline fill */}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                {preview?.map((part, i) => (
                  <div
                    key={i}
                    style={{
                      flex: part.duration,
                      background: i % 2 === 0 ? '#00B4FF10' : '#00FF8810',
                      borderRight: '1px solid #222',
                      height: '100%', display: 'flex', alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ fontSize: 8, color: '#777', fontFamily: 'monospace' }}>
                      P{part.index}
                    </span>
                  </div>
                ))}
              </div>
              {/* Split markers */}
              {intervals.map(t => {
                const pct = (t / videoDuration) * 100
                return (
                  <div
                    key={t}
                    style={{
                      position: 'absolute', top: 0, bottom: 0,
                      left: `${pct}%`,
                      width: 2, background: colors.warning,
                      cursor: 'default',
                    }}
                    title={`${formatTime(t)}`}
                  />
                )
              })}
            </div>
            {/* Interval list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {intervals.map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 10, color: '#999', fontFamily: 'monospace' }}>
                    {formatTime(t)}
                  </div>
                  <button
                    onClick={() => handleRemoveInterval(t)}
                    style={{
                      width: 18, height: 18, background: 'transparent', border: '1px solid #D0D0D0',
                      borderRadius: 3, color: '#777', cursor: 'pointer', fontSize: 12,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              {intervals.length === 0 && (
                <div style={{ fontSize: 10, color: '#666', textAlign: 'center', padding: 8 }}>
                  Click timeline để thêm split point
                </div>
              )}
            </div>
          </div>
        )}

        {/* Parts preview */}
        {preview && (
          <div style={{
            background: colors.bg, border: '1px solid #E0E0E0',
            borderRadius: 3, padding: 12, marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#777', letterSpacing: '0.08em', marginBottom: 8 }}>
              {numParts} PARTS
            </div>
            {preview.map(part => (
              <div key={part.index} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 0', borderBottom: '1px solid #E0E0E0',
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 3, background: '#00B4FF20',
                  border: '1px solid #00B4FF44', fontSize: 9, fontWeight: 700,
                  color: colors.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {part.index}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: '#999' }}>
                    {formatTime(part.start)} — {formatTime(part.end)}
                  </div>
                </div>
                <div style={{
                  fontSize: 9, fontWeight: 600,
                  color: part.duration < MIN_PART_DURATION ? colors.error : '#555',
                  fontFamily: 'monospace',
                }}>
                  {formatDuration(part.duration)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Warnings */}
        {exceedsMax && (
          <div style={{
            background: '#FF444420', border: '1px solid #FF444444',
            borderRadius: 3, padding: '8px 12px', marginBottom: 12,
            fontSize: 11, color: colors.error, fontWeight: 600,
          }}>
            Tối đa 4 parts. Hiện tại: {numParts} parts (vượt {numParts - MAX_PARTS}).
          </div>
        )}
        {hasShortPart && !exceedsMax && (
          <div style={{
            background: '#FFB80020', border: '1px solid #FFB80044',
            borderRadius: 3, padding: '8px 12px', marginBottom: 12,
            fontSize: 11, color: colors.warning, fontWeight: 600,
          }}>
            Có part quá ngắn (&lt;30s). Điều chỉnh split points.
          </div>
        )}

        {/* Auto-render toggle */}
        <div
          onClick={() => setAutoRender(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            marginBottom: 16, padding: '8px 10px', background: '#FFFFFF',
            borderRadius: 3, border: '1px solid #D0D0D0',
          }}
        >
          <div style={{
            width: 14, height: 14, borderRadius: 2, border: '1px solid #00B4FF',
            background: autoRender ? colors.accent : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {autoRender && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="#000" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
          <span style={{ fontSize: 11, color: '#999' }}>
            Auto-render tất cả parts sau khi split
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              height: 32, padding: '0 16px',
              background: '#FFFFFF', border: '1px solid #D0D0D0',
              borderRadius: 3, fontSize: 11, fontWeight: 600, color: '#999',
              cursor: 'pointer',
            }}
          >
            Hủy
          </button>
          <button
            onClick={handleSplit}
            disabled={!canSplit || loading}
            style={{
              height: 32, padding: '0 16px',
              background: canSplit ? colors.accent : colors.text,
              border: `1px solid ${canSplit ? colors.accent : '#2a2a2a'}`,
              borderRadius: 3, fontSize: 11, fontWeight: 700,
              color: canSplit ? '#000' : '#666',
              cursor: canSplit ? 'pointer' : 'not-allowed',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Đang split…' : `Split → ${numParts} Parts`}
          </button>
        </div>
      </div>
    </div>
  )
}
