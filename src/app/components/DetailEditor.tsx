'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Video, EditorState, SystemStats } from '../types'
import { BackgroundControls } from './editor/BackgroundControls'
import { ExportPanel } from './editor/ExportPanel'
import { TrimControls } from './editor/TrimControls'
import { VideoPreloader } from './VideoPreloader'
import { ipc } from '../lib/ipc'

interface Props {
  video: Video | null
  editorState: EditorState
  onChange: (patch: Partial<EditorState>) => void
  onRender: () => void
  onExportChunked?: () => void
  systemStats?: SystemStats
}

function EmptyState() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0E0E0E' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="1.5">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
      <div style={{ fontSize: 13, color: '#333', fontWeight: 500 }}>Chưa chọn video để chỉnh sửa</div>
    </div>
  )
}

const SHAPE_PRESETS = [
  { id: 'rounded', label: 'Tròn', borderRadius: 999, icon: '●' },
  { id: 'square', label: 'Vuông', borderRadius: 4, icon: '■' },
  { id: 'diamond', label: 'Thoi', borderRadius: 4, icon: '◆' },
] as const

const SPEED_STEPS = Array.from({ length: 21 }, (_, i) => +(1.0 + i * 0.1).toFixed(1))

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export function DetailEditor({ video, editorState, onChange, onRender, onExportChunked, systemStats }: Props) {
  const headerFileRef = useRef<HTMLInputElement>(null)
  const bgImageFileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const [headerDragY, setHeaderDragY] = useState<number | null>(null)
  const [bgSolidColor, setBgSolidColor] = useState<string>('#000000')

  // Canvas 9:16 sizing — measure with getBoundingClientRect BEFORE React paint,
  // so the canvas has correct dimensions from the first render (no flicker)
  const [canvasW, setCanvasW] = useState(0)
  const [canvasH, setCanvasH] = useState(0)

  useEffect(() => {
    const el = previewContainerRef.current
    if (!el) return

    const calc = () => {
      // Use getBoundingClientRect to get accurate dimensions synchronously
      const rect = el.getBoundingClientRect()
      const availW = rect.width - 32
      const availH = rect.height - 32
      if (availW <= 0 || availH <= 0) return

      // Fit to height → canvas height = available height, canvas width = height * 9/16
      const targetH = availH
      const targetW = targetH * (9 / 16)
      if (targetW <= availW) {
        setCanvasW(Math.floor(targetW))
        setCanvasH(Math.floor(targetH))
      } else {
        // Container too narrow — fit to width instead
        const w = availW
        const h = w * (16 / 9)
        setCanvasW(Math.floor(w))
        setCanvasH(Math.floor(h))
      }
    }

    // Run synchronously BEFORE first paint (requestAnimationFrame fires after paint)
    requestAnimationFrame(() => {
      calc()
      const ro = new ResizeObserver(calc)
      ro.observe(el)
    })
  }, [])

  // Sync bgSolidColor when switching to solid background type
  useEffect(() => {
    if (editorState.backgroundType === 'solid') {
      setBgSolidColor(editorState.backgroundColor)
    }
  }, [editorState.backgroundType])
  // Video player state
  const [videoSrc, setVideoSrc] = useState<string>('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [isVideoReady, setIsVideoReady] = useState(false)
  const [videoNotAvailable, setVideoNotAvailable] = useState(false)

  // Load video file when workspace changes
  useEffect(() => {
    if (!video?.id) {
      setVideoSrc('')
      setIsVideoReady(false)
      setVideoNotAvailable(false)
      return
    }

    setIsVideoReady(false)
    setVideoNotAvailable(false)
    setVideoSrc('')
    setIsPlaying(false)
    setCurrentTime(0)
    setVideoDuration(0)

    // Get video file URL from IPC
    ipc.getVideoFile(video.id).then(result => {
      if (result?.url) {
        setVideoSrc(result.url)
      } else {
        // No local file — use YouTube thumbnail as fallback
        setVideoSrc('')
        setVideoNotAvailable(true)
      }
    })
  }, [video?.id])

  // Apply speed multiplier to video playbackRate
  useEffect(() => {
    if (videoRef.current && isVideoReady) {
      videoRef.current.playbackRate = editorState.speedMultiplier
    }
  }, [editorState.speedMultiplier, isVideoReady])

  // Sync play/pause with external state
  useEffect(() => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.play().catch(() => setIsPlaying(false))
    } else {
      videoRef.current.pause()
    }
  }, [isPlaying])

  const handleVideoClick = useCallback(() => {
    if (!videoRef.current || !isVideoReady) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      videoRef.current.play().catch(() => {})
      setIsPlaying(true)
    }
  }, [isPlaying, isVideoReady])

  const handleVideoTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
  }, [])

  const handleVideoLoaded = useCallback(() => {
    if (videoRef.current) {
      setVideoDuration(videoRef.current.duration)
      setIsVideoReady(true)
      videoRef.current.playbackRate = editorState.speedMultiplier
    }
  }, [editorState.speedMultiplier])

  // Keyboard shortcuts for video preview
  useEffect(() => {
    if (!isVideoReady) return
    const handleKey = (e: KeyboardEvent) => {
      // Don't fire when typing in input/textarea
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === ' ') {
        e.preventDefault()
        handleVideoClick()
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const seekBy = e.shiftKey ? 1 : 5
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - seekBy)
        }
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        const seekBy = e.shiftKey ? 1 : 5
        if (videoRef.current) {
          videoRef.current.currentTime = Math.min(videoDuration, videoRef.current.currentTime + seekBy)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isVideoReady, handleVideoClick, videoDuration])

  // Seek from timeline click
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !isVideoReady) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    videoRef.current.currentTime = ratio * videoDuration
  }

  // Parse video duration — handles both "M:SS" string and numeric seconds
  const parseDuration = (d: string | number): number => {
    if (typeof d !== 'string') return Number(d) || 0
    const parts = d.split(':').map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return parseFloat(d) || 0
  }

  if (!video) return <EmptyState />

  {/* Background preloader — pre-caches adjacent workspace videos */}
  <VideoPreloader currentVideoId={video.id} />

  const isDark = editorState.canvasBg === 'black'
  const headerHeightPct = 20  // 20% of canvas — matches FFmpeg render: 1920 * 0.20 = ~384px
  const titleHeightPct = 20  // 20% of canvas — matches FFmpeg render
  const titleFontPx = editorState.titleFontSize

  const totalSec = parseDuration(video.duration)
  const trimStartSec = (editorState.trimStart / 100) * totalSec
  const trimEndSec = (editorState.trimEnd / 100) * totalSec
  const selectedDuration = trimEndSec - trimStartSec

  // Progress within trim range
  const progressPct = videoDuration > 0
    ? Math.min(100, ((currentTime - trimStartSec) / selectedDuration) * 100)
    : 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#121212' }}>

      {/* Slim Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 20, height: 44, borderBottom: '1px solid #1A1A1A', background: '#0D0D0D', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 10, height: 10, background: '#00B4FF', borderRadius: 2 }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: '#555' }}>EDITOR</span>
          <div style={{ width: 1, height: 12, background: '#222' }} />
          <span style={{ fontSize: 11, color: '#999', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{video.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'monospace', fontSize: 9 }}>
          <span style={{ color: '#333' }}>SPEED</span>
          <span style={{ color: '#00FF88', fontWeight: 700 }}>{editorState.speedMultiplier.toFixed(1)}x</span>
          <div style={{ width: 1, height: 12, background: '#222' }} />
          <span style={{ color: editorState.exportQuality === 1080 ? '#00FF88' : editorState.exportQuality === 720 ? '#FFB800' : '#555', fontWeight: 700, fontFamily: 'monospace' }}>
            {editorState.exportQuality}p
          </span>
          <span style={{ color: '#444' }}>
            · H:{Math.round(editorState.exportQuality * 0.2)} V:{Math.round(editorState.exportQuality * 0.6)} T:{Math.round(editorState.exportQuality * 0.2)}
          </span>
          <span style={{ color: '#333', fontSize: 8 }}>
            · {fmtTime(trimEndSec - trimStartSec)} trim
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: Preview Panel */}
        <div
          ref={previewContainerRef}
          style={{
            flex: 1, position: 'relative', overflow: 'hidden',
            padding: 16, background: '#0A0A0A',
          }}>
          {/* Grid bg */}
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(#111 1px, transparent 1px)', backgroundSize: '24px 24px', opacity: 0.5 }} />

          {/* Canvas: 9:16, absolute centered within preview panel. Dimensions are pixel-accurate from ResizeObserver. */}
          <div style={{
            position: 'absolute',
            top: 16, bottom: 16,
            left: 16, right: 16,
            width: canvasW || undefined,
            height: canvasH || undefined,
            margin: 'auto',
            background: isDark ? '#000' : '#FFF',
            borderRadius: 4, boxShadow: '0 30px 100px rgba(0,0,0,0.8), 0 0 0 1px #1A1A1A',
            display: 'flex', flexDirection: 'column',
            zIndex: 1, overflow: 'hidden',
          }}>

            {/* ── Zone 1: Header Image ─── */}
            <div
              style={{
                width: '100%', height: `${headerHeightPct}%`,
                background: isDark ? '#050505' : '#F0F0F0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
                cursor: headerDragY !== null ? 'grabbing' : 'ns-resize',
                position: 'relative',
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
              {editorState.headerImageUrl ? (
                <img
                  src={editorState.headerImageUrl}
                  alt="header"
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover', objectPosition: `center ${editorState.headerImageOffsetY}%`,
                    pointerEvents: 'none',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', opacity: 0.06 }}>
                  <div style={{ fontSize: 20 }}>🖼️</div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', marginTop: 4, color: '#444' }}>HEADER IMAGE</div>
                </div>
              )}
              {/* Zone label */}
              <div style={{ position: 'absolute', top: 3, left: 4, fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em' }}>
                H:{Math.round(editorState.exportQuality * 0.2)}
              </div>
              {/* Drag handle */}
              <div style={{ position: 'absolute', bottom: -3, left: '50%', transform: 'translateX(-50%)', width: 24, height: 6, background: '#00B4FF', borderRadius: 3, opacity: 0.5, cursor: 'ns-resize' }} />
              {/* Zone separator */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: '#1A1A1A' }} />
            </div>

            {/* ── Zone 2: Video (fills remaining space) ── */}
            <div style={{
              width: '100%',
              height: '100%',
              flex: 1,
              background: '#000', position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>

              {/* HTML5 video element */}
              {videoSrc ? (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
                  onClick={handleVideoClick}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onLoadedMetadata={handleVideoLoaded}
                  onEnded={() => { setIsPlaying(false); videoRef.current && (videoRef.current.currentTime = 0) }}
                  onWaiting={() => setIsPlaying(false)}
                  preload="auto"
                />
              ) : videoNotAvailable ? (
                <img
                  src={video.thumbnail}
                  alt="video"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#00B4FF', animation: 'spin 0.8s linear infinite' }} />
                </div>
              )}

              {/* Play/Pause overlay — full-area clickable */}
              {isVideoReady && (
                <div
                  onClick={handleVideoClick}
                  style={{
                    position: 'absolute', inset: 0,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: isPlaying ? 0 : 1,
                    transition: 'opacity 0.2s',
                  }}>
                  {isPlaying ? null : (
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: '16px solid #FFF', marginLeft: 4 }} />
                    </div>
                  )}
                </div>
              )}

              {/* Video not downloaded indicator */}
              {videoNotAvailable && (
                <div style={{
                  position: 'absolute', bottom: 8, left: 8, right: 8,
                  padding: '4px 8px', borderRadius: 3,
                  background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
                  fontSize: 8, color: '#FFB800', fontWeight: 700, textAlign: 'center',
                  letterSpacing: '0.1em',
                }}>
                  CHƯA TẢI VỀ — Preview không khả dụng
                </div>
              )}

              {/* Speed badge */}
              <div style={{
                position: 'absolute', top: 6, right: 6,
                padding: '2px 5px', borderRadius: 3,
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                fontSize: 8, fontWeight: 700, color: '#00FF88', fontFamily: 'monospace',
              }}>
                {editorState.speedMultiplier.toFixed(1)}x
              </div>

              {/* Keyboard shortcut hint */}
              {isVideoReady && (
                <div style={{
                  position: 'absolute', top: 6, left: 6,
                  padding: '2px 5px', borderRadius: 3,
                  background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                  fontSize: 7, color: '#444', fontFamily: 'monospace',
                }}>
                  Space: play · ←→: seek
                </div>
              )}

              {/* Video zone label */}
              <div style={{ position: 'absolute', bottom: 20, right: 4, fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em', opacity: 0.5 }}>
                V:{Math.round(editorState.exportQuality * 0.6)}
              </div>
            </div>

            {/* ── Timeline Bar (always visible below video) ─── */}
            {isVideoReady && (
              <div
                onClick={handleTimelineClick}
                style={{
                  padding: '5px 8px 4px',
                  background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
                  flexShrink: 0,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 8, color: '#00B4FF', fontFamily: 'monospace', fontWeight: 600, minWidth: 32 }}>
                    {fmtTime(currentTime)}
                  </span>
                  <div style={{ flex: 1, position: 'relative', height: 4 }}>
                    <div style={{ position: 'absolute', left: `${editorState.trimStart}%`, width: `${editorState.trimEnd - editorState.trimStart}%`, top: 0, height: '100%', background: 'rgba(255,255,136,0.25)', borderRadius: 2 }} />
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }} />
                    <div style={{ position: 'absolute', left: 0, top: 0, width: `${(currentTime / videoDuration) * 100}%`, height: '100%', background: '#00B4FF', borderRadius: 2, transition: 'width 0.1s linear' }} />
                    <div style={{ position: 'absolute', left: `${editorState.trimStart}%`, top: -1, width: 2, height: 6, background: '#00FF88', borderRadius: 1 }} />
                    <div style={{ position: 'absolute', left: `${editorState.trimEnd}%`, top: -1, width: 2, height: 6, background: '#00FF88', borderRadius: 1 }} />
                  </div>
                  <span style={{ fontSize: 8, color: '#555', fontFamily: 'monospace', minWidth: 32, textAlign: 'right' }}>
                    {fmtTime(videoDuration)}
                  </span>
                </div>
              </div>
            )}


            {/* ── Zone 3: Title ─── */}
            <div style={{
              width: '100%', height: `${titleHeightPct}%`,
              background: isDark ? '#000' : '#FFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, position: 'relative',
            }}>
              {/* Zone label */}
              <div style={{ position: 'absolute', top: 3, left: 4, fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em' }}>
                T:{Math.round(editorState.exportQuality * 0.2)}
              </div>
              {editorState.titleText ? (
                <div style={{
                  width: '66%',
                  background: editorState.titleBgColor,
                  borderWidth: 2, borderStyle: 'solid', borderColor: editorState.titleBorderColor,
                  borderRadius: editorState.titleShape === 'rounded' ? 999 : editorState.titleShape === 'diamond' ? 4 : 4,
                  padding: `${Math.round(titleFontPx * 0.6)}px ${Math.round(titleFontPx * 0.8)}px`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  <span style={{
                    fontSize: titleFontPx,
                    fontWeight: 700,
                    color: isDark ? '#FFF' : '#000',
                    textAlign: 'center',
                    lineHeight: 1.2,
                    wordBreak: 'break-word',
                  }}>
                    {editorState.titleText}
                  </span>
                </div>
              ) : (
                <div style={{ textAlign: 'center', opacity: 0.06 }}>
                  <div style={{ fontSize: 14 }}>✎</div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', marginTop: 3, color: '#444' }}>NHẬP TIÊU ĐỀ</div>
                </div>
              )}
            </div>
          </div>

          {/* Dimension badge — shows canvas output dimensions + zone heights */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
              color: editorState.exportQuality === 1080 ? '#00FF88' : editorState.exportQuality === 720 ? '#FFB800' : '#555',
            }}>
              {editorState.exportQuality}×{Math.round(editorState.exportQuality * 16 / 9)}
            </span>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#333' }}>
              H:{Math.round(editorState.exportQuality * 0.2)}
            </span>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#333' }}>
              V:{Math.round(editorState.exportQuality * 0.6)}
            </span>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#333' }}>
              T:{Math.round(editorState.exportQuality * 0.2)}
            </span>
          </div>
        </div>

        {/* RIGHT: Controls — 2-column grid layout */}
        <div style={{ width: 300, borderLeft: '1px solid #1A1A1A', display: 'flex', flexDirection: 'column', background: '#111' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px' }} className="scrollbar">

            {/* 2-col CSS grid: col1=left, col2=right, .full = both cols */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 8px' }}>

              {/* TRIM — spans both columns */}
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 9, color: '#444', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>00. TRIM</div>
                <TrimControls
                  start={editorState.trimStart}
                  end={editorState.trimEnd}
                  duration={totalSec}
                  onChange={(start, end) => onChange({ trimStart: start, trimEnd: end })}
                />
              </div>

              {/* LEFT COL — Title + Speed */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* 02. TIÊU ĐỀ */}
                <div>
                  <div style={{ fontSize: 9, color: '#444', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>01. TIÊU ĐỀ</div>
                  <textarea
                    value={editorState.titleText}
                    onChange={(e) => onChange({ titleText: e.target.value })}
                    placeholder="VD: Part 1..."
                    rows={2}
                    style={{
                      width: '100%', background: '#080808', borderWidth: 1, borderStyle: 'solid', borderColor: '#1A1A1A',
                      borderRadius: 3, color: '#AAA', fontSize: 10, padding: '6px 8px',
                      resize: 'none', outline: 'none', fontFamily: 'Inter',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    {SHAPE_PRESETS.map(s => {
                      const active = editorState.titleShape === s.id
                      return (
                        <button key={s.id} onClick={() => onChange({ titleShape: s.id })}
                          style={{ flex: 1, height: 26, fontSize: 9, fontWeight: 700, cursor: 'pointer', background: active ? '#00B4FF15' : '#1A1A1A', borderWidth: 1, borderStyle: 'solid', borderColor: active ? '#00B4FF' : '#222', borderRadius: 3, color: active ? '#00B4FF' : '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                          <span>{s.icon}</span>{s.label}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                    <div>
                      <div style={{ fontSize: 9, color: '#444', marginBottom: 3 }}>VIỀN</div>
                      <div style={{ position: 'relative', height: 22, borderRadius: 2, background: editorState.titleBorderColor, border: '1px solid #222' }}>
                        <input type="color" value={editorState.titleBorderColor} onChange={(e) => onChange({ titleBorderColor: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: '#444', marginBottom: 3 }}>NỀN</div>
                      <div style={{ position: 'relative', height: 22, borderRadius: 2, background: editorState.titleBgColor.startsWith('rgba') ? '#000' : editorState.titleBgColor, border: '1px solid #222' }}>
                        <input type="color" value={editorState.titleBgColor.startsWith('rgba') ? '#000000' : editorState.titleBgColor} onChange={(e) => onChange({ titleBgColor: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={{ fontSize: 9, color: '#444' }}>CỠ CHỮ</span>
                    <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>{editorState.titleFontSize}px</span>
                  </div>
                  <input type="range" min={8} max={32} value={editorState.titleFontSize}
                    onChange={(e) => onChange({ titleFontSize: +e.target.value })}
                    style={{ width: '100%', height: 3, marginTop: 4 }} />
                </div>

                {/* 03. TỐC ĐỘ */}
                <div>
                  <div style={{ fontSize: 9, color: '#444', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>02. TỐC ĐỘ</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => { const idx = SPEED_STEPS.indexOf(+editorState.speedMultiplier.toFixed(1)); if (idx > 0) onChange({ speedMultiplier: SPEED_STEPS[idx - 1] }) }}
                      style={{ width: 24, height: 24, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, color: '#555', fontSize: 12, cursor: 'pointer' }}>−</button>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: '#00FF88', fontFamily: 'monospace' }}>{editorState.speedMultiplier.toFixed(1)}</span>
                      <span style={{ fontSize: 9, color: '#555', marginLeft: 2 }}>x</span>
                    </div>
                    <button onClick={() => { const idx = SPEED_STEPS.indexOf(+editorState.speedMultiplier.toFixed(1)); if (idx < SPEED_STEPS.length - 1) onChange({ speedMultiplier: SPEED_STEPS[idx + 1] }) }}
                      style={{ width: 24, height: 24, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, color: '#555', fontSize: 12, cursor: 'pointer' }}>+</button>
                  </div>
                  <input type="range" min={10} max={20} value={Math.round(editorState.speedMultiplier * 10)}
                    onChange={(e) => onChange({ speedMultiplier: +((+e.target.value) / 10).toFixed(1) })}
                    style={{ width: '100%', height: 3, marginTop: 6 }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                    <span style={{ fontSize: 8, color: '#333' }}>1.0x</span>
                    <span style={{ fontSize: 8, color: '#333' }}>2.0x</span>
                  </div>
                </div>
              </div>

              {/* RIGHT COL — Header + Background + Canvas mode */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* 01. HEADER IMAGE */}
                <div>
                  <div style={{ fontSize: 9, color: '#444', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>01. HEADER IMAGE</div>
                  <input
                    type="file" accept="image/*" ref={headerFileRef} className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (f) {
                        const arrayBuffer = await f.arrayBuffer()
                        const uint8 = new Uint8Array(arrayBuffer)
                        const ext = f.name.split('.').pop() || 'png'
                        const result = await ipc.saveBlobToFile(uint8, `header_${Date.now()}.${ext}`)
                        const blobUrl = URL.createObjectURL(f)
                        onChange({ headerImageUrl: blobUrl, headerImageDiskPath: result?.diskPath ?? null })
                      }
                    }}
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => headerFileRef.current?.click()}
                      style={{ flex: 1, height: 28, background: editorState.headerImageUrl ? '#00B4FF15' : 'transparent', borderWidth: 1, borderStyle: 'solid', borderColor: editorState.headerImageUrl ? '#00B4FF' : '#222', borderRadius: 3, color: editorState.headerImageUrl ? '#00B4FF' : '#444', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
                      {editorState.headerImageUrl ? '✓ ĐÃ TẢI' : '↑ TẢI LÊN'}
                    </button>
                    {editorState.headerImageUrl && (
                      <button onClick={() => onChange({ headerImageUrl: null, headerImageDiskPath: null })}
                        style={{ width: 28, height: 28, background: 'transparent', border: '1px solid #FF444433', borderRadius: 3, color: '#FF4444', fontSize: 12, cursor: 'pointer' }}>×</button>
                    )}
                  </div>
                </div>

                {/* 04. NỀN */}
                <div>
                  <div style={{ fontSize: 9, color: '#444', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>04. NỀN</div>
                  <BackgroundControls
                    type={editorState.backgroundType}
                    color={bgSolidColor}
                    onTypeChange={(t) => onChange({ backgroundType: t })}
                    onRegenerateBlur={() => onChange({ backgroundType: 'blur' })}
                    onUploadImage={() => bgImageFileRef.current?.click()}
                  />
                  {editorState.backgroundType === 'solid' && (
                    <div style={{ position: 'relative', height: 26, borderRadius: 3, background: bgSolidColor, border: '1px solid #222', marginTop: 6 }}>
                      <input type="color" value={bgSolidColor}
                        onChange={(e) => { setBgSolidColor(e.target.value); onChange({ backgroundColor: e.target.value }) }}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                    </div>
                  )}
                  <input type="file" accept="image/*" ref={bgImageFileRef} className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (f) {
                        const arrayBuffer = await f.arrayBuffer()
                        const uint8 = new Uint8Array(arrayBuffer)
                        const ext = f.name.split('.').pop() || 'png'
                        const result = await ipc.saveBlobToFile(uint8, `bg_${Date.now()}.${ext}`)
                        const blobUrl = URL.createObjectURL(f)
                        onChange({ backgroundImageUrl: blobUrl, backgroundImageDiskPath: result?.diskPath ?? null, backgroundType: 'image' })
                      }
                    }}
                  />
                </div>

                {/* 05. CHẾ ĐỘ */}
                <div>
                  <div style={{ fontSize: 9, color: '#444', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>05. CHẾ ĐỘ</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['black', 'white'] as const).map(bg => {
                      const active = editorState.canvasBg === bg
                      return (
                        <button key={bg} onClick={() => onChange({ canvasBg: bg })}
                          style={{ flex: 1, height: 28, fontSize: 9, fontWeight: 700, cursor: 'pointer', background: active ? '#00B4FF15' : '#1A1A1A', borderWidth: 1, borderStyle: 'solid', borderColor: active ? '#00B4FF' : '#222', borderRadius: 3, color: active ? '#00B4FF' : '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <div style={{ width: 8, height: 8, background: bg === 'black' ? '#000' : '#FFF', borderWidth: 1, borderStyle: 'solid', borderColor: '#333', borderRadius: 1 }} />
                          {bg === 'black' ? 'TỐI' : 'SÁNG'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* EXPORT — spans both columns */}
              <div style={{ gridColumn: '1 / -1', paddingTop: 4, borderTop: '1px solid #1A1A1A', marginTop: 2 }}>
                <div style={{ fontSize: 9, color: '#444', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 8 }}>06. RENDER</div>
                <ExportPanel
                  quality={editorState.exportQuality}
                  onChange={(q) => onChange({ exportQuality: q as 1080 | 720 | 360 })}
                  onExport={onRender}
                  isRendering={video?.status === 'rendering'}
                  codec={editorState.exportCodec}
                  onCodecChange={(c) => onChange({ exportCodec: c })}
                  preset={editorState.exportPreset}
                  onPresetChange={(p) => onChange({ exportPreset: p })}
                  tune={editorState.exportTune}
                  onTuneChange={(t) => onChange({ exportTune: t })}
                  enableChunked={editorState.enableChunked}
                  onChunkedChange={(v) => onChange({ enableChunked: v })}
                  onExportChunked={onExportChunked}
                  maxChunkWorkers={systemStats?.maxChunkWorkers}
                />
              </div>

            </div>
          </div>

        </div>
      </div>

    </div>
  )
}
