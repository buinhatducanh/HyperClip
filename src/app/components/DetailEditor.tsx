'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Video, EditorState, SystemStats } from '../types'
import { BackgroundControls } from './editor/BackgroundControls'
import { ExportPanel } from './editor/ExportPanel'
import { TrimControls } from './editor/TrimControls'
import { ipc } from '../lib/ipc'

interface Props {
  video: Video | null
  editorState: EditorState
  onChange: (patch: Partial<EditorState>) => void
  onRender: () => void
  onExportChunked?: () => void
  systemStats?: SystemStats
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

// ─── Empty State ────────────────────────────────────────────────────────────────

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

// ─── Constants ─────────────────────────────────────────────────────────────────

const SHAPE_PRESETS = [
  { id: 'rounded', label: 'Tròn', borderRadius: 999, icon: '●' },
  { id: 'square', label: 'Vuông', borderRadius: 4, icon: '■' },
  { id: 'diamond', label: 'Thoi', borderRadius: 4, icon: '◆' },
] as const

const SPEED_STEPS = Array.from({ length: 21 }, (_, i) => +(1.0 + i * 0.1).toFixed(1))

// ─── Main DetailEditor ──────────────────────────────────────────────────────────

export function DetailEditor({ video, editorState, onChange, onRender, onExportChunked, systemStats }: Props) {
  const headerFileRef = useRef<HTMLInputElement>(null)
  const bgImageFileRef = useRef<HTMLInputElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [headerDragY, setHeaderDragY] = useState<number | null>(null)
  const [bgSolidColor, setBgSolidColor] = useState<string>('#000000')

  // Video player state
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  // Video source state
  const [videoSrc, setVideoSrc] = useState('')
  const [videoNotAvailable, setVideoNotAvailable] = useState(false)
  const [localThumbSrc, setLocalThumbSrc] = useState<string | null>(null)

  // 9:16 canvas sizing
  const [canvasW, setCanvasW] = useState(0)
  const [canvasH, setCanvasH] = useState(0)

  // Stable ref for canvas dimensions (used in resize calc)
  const canvasDimsRef = useRef({ w: 0, h: 0 })

  useEffect(() => {
    const el = canvasWrapRef.current
    if (!el) return

    const calc = () => {
      const rect = el.getBoundingClientRect()
      // Account for: 16px padding top+bottom, 16px padding left+right, ~48px for controls bar
      const availW = rect.width - 32
      const availH = rect.height - 32 - 48
      if (availW <= 0 || availH <= 0) return

      // Try fit to height first (9:16 portrait)
      const targetH = availH
      const targetW = targetH * (9 / 16)
      if (targetW <= availW) {
        canvasDimsRef.current = { w: Math.floor(targetW), h: Math.floor(targetH) }
        setCanvasW(Math.floor(targetW))
        setCanvasH(Math.floor(targetH))
      } else {
        // Too narrow — fit to width instead
        canvasDimsRef.current = { w: Math.floor(availW), h: Math.floor(availW * (16 / 9)) }
        setCanvasW(Math.floor(availW))
        setCanvasH(Math.floor(availW * (16 / 9)))
      }
    }

    // Run calc synchronously BEFORE first paint
    requestAnimationFrame(() => {
      calc()
      const ro = new ResizeObserver(calc)
      ro.observe(el)
      return () => ro.disconnect()
    })
  }, [])

  // Load video when workspace changes
  useEffect(() => {
    if (!video?.id) {
      setVideoSrc('')
      setVideoNotAvailable(false)
      setLocalThumbSrc(null)
      setIsReady(false)
      setPlaying(false)
      setCurrentTime(0)
      setVideoDuration(0)
      setVideoError(false)
      return
    }

    setVideoNotAvailable(false)
    setVideoSrc('')
    setLocalThumbSrc(null)
    setIsReady(false)
    setPlaying(false)
    setCurrentTime(0)
    setVideoDuration(0)
    setVideoError(false)

    // Load video file URL + local thumbnail in parallel
    Promise.all([
      ipc.getVideoFile(video.id),
      ipc.getImageFile(video.id),
    ]).then(([videoResult, imgResult]) => {
      if (videoResult?.url) {
        setVideoSrc(videoResult.url)
      } else {
        setVideoNotAvailable(true)
      }
      if (imgResult?.dataUrl) {
        setLocalThumbSrc(imgResult.dataUrl)
      }
    })
  }, [video?.id])

  // Apply speed multiplier when ready
  useEffect(() => {
    if (videoRef.current && isReady) {
      videoRef.current.playbackRate = editorState.speedMultiplier
    }
  }, [editorState.speedMultiplier, isReady])

  // Sync play/pause — use ref to avoid stale closure
  useEffect(() => {
    if (!videoRef.current || !isReady) return
    if (playing) {
      videoRef.current.play().catch(() => setPlaying(false))
    } else {
      videoRef.current.pause()
    }
  }, [playing, isReady])

  // Auto-hide controls
  useEffect(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (playing && !isDragging) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 3000)
    } else {
      setShowControls(true)
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [playing, isDragging])

  // Mouse move on canvas wrap — show controls
  const handleMouseMove = useCallback(() => {
    setShowControls(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (playing) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 3000)
    }
  }, [playing])

  // Toggle play/pause
  const handleTogglePlay = useCallback(() => {
    if (!videoRef.current || !isReady) return
    setPlaying(p => !p)
  }, [isReady])

  // Toggle mute
  const handleToggleMute = useCallback(() => {
    if (!videoRef.current) return
    const next = !muted
    videoRef.current.muted = next
    setMuted(next)
  }, [muted])

  // Seek video to ratio (0-1)
  const handleSeekTo = useCallback((ratio: number) => {
    if (!videoRef.current || !isReady || videoDuration === 0) return
    const t = Math.max(0, Math.min(videoDuration, ratio * videoDuration))
    videoRef.current.currentTime = t
    setCurrentTime(t)
  }, [isReady, videoDuration])

  // Keyboard shortcuts — stable, no stale closure
  useEffect(() => {
    if (!isReady) return
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ') { e.preventDefault(); handleTogglePlay() }
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
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); handleToggleMute() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isReady, handleTogglePlay, handleToggleMute, videoDuration])

  // Sync bgSolidColor
  useEffect(() => {
    if (editorState.backgroundType === 'solid') setBgSolidColor(editorState.backgroundColor)
  }, [editorState.backgroundType])

  if (!video) return <EmptyState />

  const isDark = editorState.canvasBg === 'black'
  const headerHeightPct = 20
  const titleHeightPct = 20
  const titleFontPx = editorState.titleFontSize
  const totalSec = parseDuration(video.duration)
  const trimStartSec = (editorState.trimStart / 100) * totalSec
  const trimEndSec = (editorState.trimEnd / 100) * totalSec
  const selectedDuration = trimEndSec - trimStartSec
  const progress = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0

  // Show spinner: videoSrc exists + not ready + not error
  const showSpinner = !isReady && !videoError && (!!videoSrc || videoNotAvailable)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#121212' }}>

      {/* Slim Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingLeft: 20, paddingRight: 20, height: 44,
        borderBottom: '1px solid #1A1A1A', background: '#0D0D0D', flexShrink: 0
      }}>
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
          <span style={{ color: '#444' }}>· H:{Math.round(editorState.exportQuality * 0.2)} V:{Math.round(editorState.exportQuality * 0.6)} T:{Math.round(editorState.exportQuality * 0.2)}</span>
          <span style={{ color: '#333', fontSize: 8 }}>· {fmtTime(selectedDuration)} trim</span>
        </div>
      </div>

      {/* Body: LEFT preview + RIGHT controls */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: 9:16 canvas with embedded video player */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0A0A0A' }}>
          <div
            ref={canvasWrapRef}
            style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: 16 }}
            onMouseMove={handleMouseMove}
          >
            {/* Grid bg */}
            <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(#111 1px, transparent 1px)', backgroundSize: '24px 24px', opacity: 0.5 }} />

            {/* 9:16 Canvas */}
            <div style={{
              position: 'absolute',
              top: 16, bottom: 16, left: 16, right: 16,
              width: canvasW || undefined,
              height: canvasH || undefined,
              margin: 'auto',
              background: isDark ? '#000' : '#FFF',
              borderRadius: 4,
              boxShadow: '0 30px 100px rgba(0,0,0,0.8), 0 0 0 1px #1A1A1A',
              display: 'flex', flexDirection: 'column',
              zIndex: 1, overflow: 'hidden',
            }}>

              {/* Zone 1: Header Image */}
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
                  <img src={editorState.headerImageUrl} alt="header"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `center ${editorState.headerImageOffsetY}%`, pointerEvents: 'none' }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', opacity: 0.06 }}>
                    <div style={{ fontSize: 20 }}>🖼️</div>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', marginTop: 4, color: '#444' }}>HEADER IMAGE</div>
                  </div>
                )}
                <div style={{ position: 'absolute', top: 3, left: 4, fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em' }}>
                  H:{Math.round(editorState.exportQuality * 0.2)}
                </div>
                <div style={{ position: 'absolute', bottom: -3, left: '50%', transform: 'translateX(-50%)', width: 24, height: 6, background: '#00B4FF', borderRadius: 3, opacity: 0.5, cursor: 'ns-resize' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: '#1A1A1A' }} />
              </div>

              {/* Zone 2: Video */}
              <div
                style={{
                  width: '100%', height: '60%',
                  background: '#000', position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
                onClick={handleTogglePlay}
              >
                {/* HTML5 video element — plays directly inside the 9:16 canvas */}
                {videoSrc && !videoNotAvailable && !videoError ? (
                  <video
                    key={videoSrc} // Force remount when src changes — prevents stale element
                    ref={videoRef}
                    src={videoSrc}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                    onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime) }}
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
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
                  />
                )}

                {/* Loading spinner */}
                {showSpinner && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#00B4FF', animation: 'spin 0.8s linear infinite' }} />
                  </div>
                )}

                {/* Center play/pause overlay */}
                {isReady && !playing && (
                  <div style={{
                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none',
                  }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{ width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: '16px solid #FFF', marginLeft: 4 }} />
                    </div>
                  </div>
                )}

                {/* Error / Not available badge */}
                {(videoError || videoNotAvailable) && (
                  <div style={{
                    position: 'absolute', bottom: 6, left: 6, right: 6,
                    padding: '3px 6px', borderRadius: 3,
                    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
                    fontSize: 8, color: videoError ? '#FF4444' : '#FFB800', fontWeight: 700, textAlign: 'center',
                    letterSpacing: '0.1em',
                  }}>
                    {videoError ? 'VIDEO ERROR — Kiểm tra file' : 'CHƯA TẢI — Preview không khả dụng'}
                  </div>
                )}

                {/* Speed badge */}
                {isReady && (
                  <div style={{
                    position: 'absolute', top: 5, right: 5,
                    padding: '2px 5px', borderRadius: 3,
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                    fontSize: 8, fontWeight: 700, color: '#00FF88', fontFamily: 'monospace',
                  }}>
                    {editorState.speedMultiplier.toFixed(1)}x
                  </div>
                )}

                {/* Zone label */}
                <div style={{ position: 'absolute', bottom: 4, right: 4, fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em' }}>
                  V:{Math.round(editorState.exportQuality * 0.6)}
                </div>
              </div>

              {/* Zone 3: Title */}
              <div style={{
                width: '100%', height: `${titleHeightPct}%`,
                background: isDark ? '#000' : '#FFF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, position: 'relative',
              }}>
                <div style={{ position: 'absolute', top: 3, left: 4, fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em' }}>
                  T:{Math.round(editorState.exportQuality * 0.2)}
                </div>
                {editorState.titleText ? (
                  <div style={{
                    width: '66%',
                    background: editorState.titleBgColor,
                    borderWidth: 2, borderStyle: 'solid', borderColor: editorState.titleBorderColor,
                    borderRadius: editorState.titleShape === 'rounded' ? 999 : 4,
                    padding: `${Math.round(titleFontPx * 0.6)}px ${Math.round(titleFontPx * 0.8)}px`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    <span style={{ fontSize: titleFontPx, fontWeight: 700, color: isDark ? '#FFF' : '#000', textAlign: 'center', lineHeight: 1.2, wordBreak: 'break-word' }}>
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

              {/* Controls bar — overlaid at bottom of canvas */}
              {isReady && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
                  padding: '20px 8px 6px',
                  opacity: showControls ? 1 : 0,
                  transition: 'opacity 0.25s',
                  pointerEvents: showControls ? 'auto' : 'none',
                }}>
                  {/* Progress bar */}
                  <div
                    ref={progressRef}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      handleSeekTo((e.clientX - rect.left) / rect.width)
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      const rect = e.currentTarget.getBoundingClientRect()
                      handleSeekTo((e.clientX - rect.left) / rect.width)
                      setIsDragging(true)

                      const onMove = (ev: MouseEvent) => {
                        const r = ev.currentTarget as HTMLDivElement
                        const re = r.getBoundingClientRect()
                        handleSeekTo((ev.clientX - re.left) / re.width)
                      }
                      const onUp = () => {
                        setIsDragging(false)
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                      }
                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                    style={{ position: 'relative', height: 14, cursor: 'pointer', marginBottom: 2 }}
                  >
                    <div style={{ position: 'absolute', inset: 0, top: '50%', transform: 'translateY(-50%)', height: 3, background: 'rgba(255,255,255,0.2)', borderRadius: 2 }}>
                      {/* Trim range */}
                      <div style={{ position: 'absolute', left: `${editorState.trimStart}%`, width: `${editorState.trimEnd - editorState.trimStart}%`, height: '100%', background: 'rgba(255,255,136,0.2)', borderRadius: 2 }} />
                      <div style={{ height: '100%', width: `${progress}%`, background: '#FF0000', borderRadius: 2, transition: isDragging ? 'none' : 'width 0.1s linear' }} />
                    </div>
                    <div style={{ position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)', left: `${progress}%`, width: 10, height: 10, borderRadius: '50%', background: '#FF0000', opacity: showControls ? 1 : 0, transition: 'opacity 0.25s' }} />
                    <div style={{ position: 'absolute', left: `${editorState.trimStart}%`, top: '50%', transform: 'translate(-50%, -50%)', width: 2, height: 8, background: '#00FF88', borderRadius: 1 }} />
                    <div style={{ position: 'absolute', left: `${editorState.trimEnd}%`, top: '50%', transform: 'translate(-50%, -50%)', width: 2, height: 8, background: '#00FF88', borderRadius: 1 }} />
                  </div>

                  {/* Controls row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {/* Rewind 5s */}
                    <button
                      onClick={(e) => { e.stopPropagation(); if (videoRef.current) handleSeekTo((videoRef.current.currentTime - 5) / videoDuration) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                      title="-5s"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                        <text x="7" y="15" fontSize="7" fill="#FFF" stroke="none" fontWeight="700">5</text>
                      </svg>
                    </button>

                    {/* Play/Pause */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTogglePlay() }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                      title={playing ? 'Pause' : 'Play'}
                    >
                      {playing ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFF">
                          <rect x="6" y="4" width="4" height="16" rx="1" />
                          <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFF">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      )}
                    </button>

                    {/* Forward 5s */}
                    <button
                      onClick={(e) => { e.stopPropagation(); if (videoRef.current) handleSeekTo((videoRef.current.currentTime + 5) / videoDuration) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                      title="+5s"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2">
                        <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                        <path d="M21 3v5h-5" />
                        <text x="7" y="15" fontSize="7" fill="#FFF" stroke="none" fontWeight="700">5</text>
                      </svg>
                    </button>

                    {/* Time */}
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#FFF', opacity: 0.9, minWidth: 82, flexShrink: 0 }}>
                      {fmtTime(currentTime)} / {fmtTime(videoDuration)}
                    </span>

                    <div style={{ flex: 1 }} />

                    {/* Volume */}
                    <button onClick={(e) => { e.stopPropagation(); handleToggleMute() }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      {muted || volume === 0 ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#FFF" />
                          <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                        </svg>
                      ) : volume < 0.5 ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#FFF" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#FFF" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        </svg>
                      )}
                    </button>
                    <input
                      type="range" min={0} max={1} step={0.05}
                      value={muted ? 0 : volume}
                      onChange={(e) => {
                        const v = +e.target.value
                        setVolume(v)
                        setMuted(v === 0)
                        if (videoRef.current) videoRef.current.volume = v
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 50, accentColor: '#FF0000', flexShrink: 0 }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Dimension badge */}
            <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: editorState.exportQuality === 1080 ? '#00FF88' : editorState.exportQuality === 720 ? '#FFB800' : '#555' }}>
                {editorState.exportQuality}×{Math.round(editorState.exportQuality * 16 / 9)}
              </span>
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#333' }}>H:{Math.round(editorState.exportQuality * 0.2)}</span>
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#333' }}>V:{Math.round(editorState.exportQuality * 0.6)}</span>
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#333' }}>T:{Math.round(editorState.exportQuality * 0.2)}</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Controls */}
        <div style={{ width: 300, borderLeft: '1px solid #1A1A1A', display: 'flex', flexDirection: 'column', background: '#111' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px' }} className="scrollbar">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 8px' }}>

              {/* TRIM */}
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 9, color: '#444', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>00. TRIM</div>
                <TrimControls
                  start={editorState.trimStart}
                  end={editorState.trimEnd}
                  duration={totalSec}
                  onChange={(start, end) => onChange({ trimStart: start, trimEnd: end })}
                />
              </div>

              {/* LEFT COL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Title */}
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
                        <button key={s.id} onClick={() => onChange({ titleShape: s.id } as any)}
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

                {/* Speed */}
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

              {/* RIGHT COL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Header Image */}
                <div>
                  <div style={{ fontSize: 9, color: '#444', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>03. HEADER IMAGE</div>
                  <input type="file" accept="image/*" ref={headerFileRef} className="hidden"
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
                    <button onClick={() => headerFileRef.current?.click()}
                      style={{ flex: 1, height: 28, background: editorState.headerImageUrl ? '#00B4FF15' : 'transparent', borderWidth: 1, borderStyle: 'solid', borderColor: editorState.headerImageUrl ? '#00B4FF' : '#222', borderRadius: 3, color: editorState.headerImageUrl ? '#00B4FF' : '#444', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
                      {editorState.headerImageUrl ? '✓ ĐÃ TẢI' : '↑ TẢI LÊN'}
                    </button>
                    {editorState.headerImageUrl && (
                      <button onClick={() => onChange({ headerImageUrl: null, headerImageDiskPath: null })}
                        style={{ width: 28, height: 28, background: 'transparent', border: '1px solid #FF444433', borderRadius: 3, color: '#FF4444', fontSize: 12, cursor: 'pointer' }}>×</button>
                    )}
                  </div>
                </div>

                {/* Background */}
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

                {/* Canvas mode */}
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

              {/* RENDER */}
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
