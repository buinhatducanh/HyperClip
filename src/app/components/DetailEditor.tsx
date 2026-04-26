'use client'

import { useRef, useState } from 'react'
import { Video, EditorState } from '../types'
import { SpeedControls } from './editor/SpeedControls'
import { BackgroundControls } from './editor/BackgroundControls'
import { ExportPanel } from './editor/ExportPanel'

interface Props {
  video: Video | null
  editorState: EditorState
  onChange: (patch: Partial<EditorState>) => void
  onRender: () => void
  onExportChunked?: () => void
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 8, color: '#333', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0E0E0E' }}>
      <div style={{ fontSize: 40, opacity: 0.1 }}>📽️</div>
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

export function DetailEditor({ video, editorState, onChange, onRender, onExportChunked }: Props) {
  const headerFileRef = useRef<HTMLInputElement>(null)
  const [headerDragY, setHeaderDragY] = useState<number | null>(null)

  if (!video) return <EmptyState />

  const isDark = editorState.canvasBg === 'black'

  const headerHeightPct = 20
  const titleHeightPct = 20
  const videoTopPct = headerHeightPct
  const videoBottomPct = 100 - titleHeightPct

  const titleFontPx = editorState.titleFontSize

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#333' }}>SPEED</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#00FF88', fontFamily: 'monospace' }}>{editorState.speedMultiplier.toFixed(1)}x</span>
          </div>
          <span style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}>1080 × 1920</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: Preview Panel */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0A0A0A', position: 'relative', overflow: 'hidden' }}>
          {/* Grid bg */}
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(#111 1px, transparent 1px)', backgroundSize: '24px 24px', opacity: 0.5 }} />

          {/* Canvas: 9:16, fixed height */}
          <div style={{
            height: '100%', maxHeight: 'calc(100vh - 80px)', aspectRatio: '9 / 16',
            background: isDark ? '#000' : '#FFF',
            borderRadius: 4, boxShadow: '0 30px 100px rgba(0,0,0,0.8), 0 0 0 1px #1A1A1A',
            display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1,
            overflow: 'hidden',
          }}>

            {/* ── Zone 1: Header Image ────────────────────────────── */}
            <div
              style={{
                width: '100%', height: `${headerHeightPct}%`,
                background: isDark ? '#050505' : '#F0F0F0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
                cursor: headerDragY !== null ? 'grabbing' : 'ns-resize',
                position: 'relative',
                borderBottom: `1px solid ${isDark ? '#111' : '#DDD'}`,
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
                    objectFit: 'cover', objectPosition: 'center',
                    pointerEvents: 'none',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', opacity: 0.06 }}>
                  <div style={{ fontSize: 20 }}>🖼️</div>
                  <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.2em', marginTop: 4 }}>HEADER IMAGE</div>
                </div>
              )}
              {/* Drag handle */}
              <div style={{ position: 'absolute', bottom: -3, left: '50%', transform: 'translateX(-50%)', width: 24, height: 6, background: '#00B4FF', borderRadius: 3, opacity: 0.5, cursor: 'ns-resize' }} />
            </div>

            {/* ── Zone 2: Video ──────────────────────────────────── */}
            <div style={{
              width: '100%', flex: 1,
              background: '#000', position: 'relative',
            }}>
              <img
                src={video.thumbnail}
                alt="video"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
              />
              {/* Play indicator */}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: '9px solid #FFF', marginLeft: 2 }} />
                </div>
              </div>
              {/* Speed badge */}
              <div style={{
                position: 'absolute', top: 8, right: 8,
                padding: '2px 6px', borderRadius: 3,
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                fontSize: 9, fontWeight: 700, color: '#00FF88', fontFamily: 'monospace',
              }}>
                {editorState.speedMultiplier.toFixed(1)}x
              </div>
            </div>

            {/* ── Zone 3: Title ──────────────────────────────────── */}
            <div style={{
              width: '100%', height: `${titleHeightPct}%`,
              background: isDark ? '#000' : '#FFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, position: 'relative',
              borderTop: `1px solid ${isDark ? '#111' : '#DDD'}`,
            }}>
              {editorState.titleText ? (
                <div style={{
                  width: '66%',
                  background: editorState.titleBgColor,
                  borderWidth: 2, borderStyle: 'solid', borderColor: editorState.titleBorderColor,
                  borderRadius: editorState.titleShape === 'rounded' ? 999 : editorState.titleShape === 'diamond' ? 4 : 4,
                  transform: editorState.titleShape === 'diamond' ? 'rotate(0deg)' : 'rotate(0deg)',
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
                  <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.15em', marginTop: 3 }}>NHẬP TIÊU ĐỀ</div>
                </div>
              )}
            </div>
          </div>

          {/* Metadata */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: 16, opacity: 0.3 }}>
            <span style={{ fontSize: 9, fontFamily: 'monospace' }}>LEN: {video.duration}</span>
            <span style={{ fontSize: 9, fontFamily: 'monospace' }}>SIZE: {video.fileSize}</span>
          </div>
        </div>

        {/* RIGHT: Controls */}
        <div style={{ width: 300, borderLeft: '1px solid #1A1A1A', display: 'flex', flexDirection: 'column', background: '#111' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px' }} className="scrollbar">

            <ControlGroup label="01. HEADER IMAGE">
              <input
                type="file" accept="image/*" ref={headerFileRef} className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onChange({ headerImageUrl: URL.createObjectURL(f) })
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => headerFileRef.current?.click()}
                  style={{
                    flex: 1, height: 30, background: editorState.headerImageUrl ? '#00B4FF15' : 'transparent',
                    borderWidth: 1, borderStyle: 'solid',
                    borderColor: editorState.headerImageUrl ? '#00B4FF' : '#222',
                    borderRadius: 3, color: editorState.headerImageUrl ? '#00B4FF' : '#444',
                    fontSize: 9, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {editorState.headerImageUrl ? '✓ ĐÃ TẢI' : '↑ TẢI LÊN'}
                </button>
                {editorState.headerImageUrl && (
                  <button
                    onClick={() => onChange({ headerImageUrl: null })}
                    style={{ width: 30, height: 30, background: 'transparent', border: '1px solid #FF444433', borderRadius: 3, color: '#FF4444', fontSize: 12, cursor: 'pointer' }}
                  >×</button>
                )}
              </div>
            </ControlGroup>

            <ControlGroup label="02. TIÊU ĐỀ">
              <textarea
                value={editorState.titleText}
                onChange={(e) => onChange({ titleText: e.target.value })}
                placeholder="VD: Part 1 — Giới thiệu..."
                rows={2}
                style={{
                  width: '100%', background: '#080808', borderWidth: 1, borderStyle: 'solid', borderColor: '#1A1A1A',
                  borderRadius: 3, color: '#AAA', fontSize: 10, padding: '8px',
                  resize: 'none', outline: 'none', fontFamily: 'Inter',
                }}
              />

              {/* Shape presets */}
              <div>
                <div style={{ fontSize: 8, color: '#333', fontWeight: 700, marginBottom: 6 }}>KHUÔN DẠNG</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {SHAPE_PRESETS.map(s => {
                    const active = editorState.titleShape === s.id
                    return (
                      <button
                        key={s.id}
                        onClick={() => onChange({ titleShape: s.id })}
                        style={{
                          flex: 1, height: 30, fontSize: 9, fontWeight: 700, cursor: 'pointer',
                          background: active ? '#00B4FF15' : '#1A1A1A',
                          borderWidth: 1, borderStyle: 'solid', borderColor: active ? '#00B4FF' : '#222',
                          borderRadius: 3, color: active ? '#00B4FF' : '#555',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        }}
                      >
                        <span>{s.icon}</span>{s.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Colors */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 7, color: '#444', marginBottom: 4 }}>VIỀN</div>
                  <div style={{ position: 'relative', height: 24, borderRadius: 2, background: editorState.titleBorderColor, border: '1px solid #222' }}>
                    <input type="color" value={editorState.titleBorderColor} onChange={(e) => onChange({ titleBorderColor: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 7, color: '#444', marginBottom: 4 }}>NỀN</div>
                  <div style={{ position: 'relative', height: 24, borderRadius: 2, background: editorState.titleBgColor, border: '1px solid #222' }}>
                    <input type="color" value={editorState.titleBgColor.startsWith('rgba') ? '#000000' : editorState.titleBgColor} onChange={(e) => onChange({ titleBgColor: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                  </div>
                </div>
              </div>

              {/* Font size */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 7, color: '#444' }}>CỠ CHỮ</span>
                  <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>{editorState.titleFontSize}px</span>
                </div>
                <input
                  type="range" min={8} max={32} value={editorState.titleFontSize}
                  onChange={(e) => onChange({ titleFontSize: +e.target.value })}
                  style={{ width: '100%', height: 4, background: '#1A1A1A', borderRadius: 2, outline: 'none' }}
                />
              </div>
            </ControlGroup>

            <ControlGroup label="03. TỐC ĐỘ">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => {
                    const idx = SPEED_STEPS.indexOf(+editorState.speedMultiplier.toFixed(1))
                    if (idx > 0) onChange({ speedMultiplier: SPEED_STEPS[idx - 1] })
                  }}
                  style={{ width: 28, height: 28, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, color: '#555', fontSize: 14, cursor: 'pointer' }}>−</button>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#00FF88', fontFamily: 'monospace' }}>{editorState.speedMultiplier.toFixed(1)}</span>
                  <span style={{ fontSize: 10, color: '#555', marginLeft: 2 }}>x</span>
                </div>
                <button
                  onClick={() => {
                    const idx = SPEED_STEPS.indexOf(+editorState.speedMultiplier.toFixed(1))
                    if (idx < SPEED_STEPS.length - 1) onChange({ speedMultiplier: SPEED_STEPS[idx + 1] })
                  }}
                  style={{ width: 28, height: 28, background: '#1A1A1A', border: '1px solid #222', borderRadius: 3, color: '#555', fontSize: 14, cursor: 'pointer' }}>+</button>
              </div>
              {/* Slider */}
              <input
                type="range" min={10} max={20} value={Math.round(editorState.speedMultiplier * 10)}
                onChange={(e) => onChange({ speedMultiplier: +((+e.target.value) / 10).toFixed(1) })}
                style={{ width: '100%', height: 4, background: '#1A1A1A', borderRadius: 2, outline: 'none' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 7, color: '#333' }}>1.0x</span>
                <span style={{ fontSize: 7, color: '#333' }}>2.0x</span>
              </div>
            </ControlGroup>

            <ControlGroup label="04. NỀN">
              <BackgroundControls
                type={editorState.backgroundType}
                onTypeChange={(t) => onChange({ backgroundType: t })}
                onRegenerateBlur={() => {}}
                onUploadImage={() => {}}
              />
            </ControlGroup>

            <ControlGroup label="05. CHẾ ĐỘ">
              <div style={{ display: 'flex', gap: 4 }}>
                {(['black', 'white'] as const).map(bg => {
                  const active = editorState.canvasBg === bg
                  return (
                    <button
                      key={bg}
                      onClick={() => onChange({ canvasBg: bg })}
                      style={{
                        flex: 1, height: 28, fontSize: 9, fontWeight: 700, cursor: 'pointer',
                        background: active ? '#00B4FF15' : '#1A1A1A',
                        borderWidth: 1, borderStyle: 'solid', borderColor: active ? '#00B4FF' : '#222',
                        borderRadius: 3, color: active ? '#00B4FF' : '#555',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      }}
                    >
                      <div style={{ width: 8, height: 8, background: bg === 'black' ? '#000' : '#FFF', borderWidth: 1, borderStyle: 'solid', borderColor: '#333', borderRadius: 1 }} />
                      {bg === 'black' ? 'TỐI' : 'SÁNG'}
                    </button>
                  )
                })}
              </div>
            </ControlGroup>

          </div>

          {/* Export Footer */}
          <div style={{ padding: 16, borderTop: '1px solid #1A1A1A', background: '#0D0D0D' }}>
            <ExportPanel
              quality={editorState.exportQuality}
              onChange={(q) => onChange({ exportQuality: q })}
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
            />
          </div>
        </div>
      </div>

      <style>{`
        .scrollbar::-webkit-scrollbar { width: 3px; }
        .scrollbar::-webkit-scrollbar-track { background: transparent; }
        .scrollbar::-webkit-scrollbar-thumb { background: #1A1A1A; border-radius: 2px; }
        input[type=range] { -webkit-appearance: none; background: #1A1A1A; height: 4px; border-radius: 2px; }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 10px; height: 10px;
          background: #00B4FF; border-radius: 50%; cursor: pointer; border: 1px solid #FFF;
        }
        textarea { font-family: Inter, sans-serif; }
      `}</style>
    </div>
  )
}
