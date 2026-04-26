'use client'

import { useRef, useState, useEffect } from 'react'
import { Video, EditorState } from '../types'
import { SpeedControls } from './editor/SpeedControls'
import { BackgroundControls } from './editor/BackgroundControls'
import { ImageOverlay } from './editor/ImageOverlay'
import { ExportPanel } from './editor/ExportPanel'
import { TrimControls } from './editor/TrimControls'

interface Props {
  video: Video | null
  editorState: EditorState
  onChange: (patch: Partial<EditorState>) => void
  onRender: () => void
  onExportChunked?: () => void
}

// ─── Control Group ───────────────────────────────────────────────────────────
function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 9, color: '#333', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 8, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div className="flex flex-col gap-2">
        {children}
      </div>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ background: '#0E0E0E' }}>
      <div style={{ fontSize: 40, opacity: 0.1 }}>📽️</div>
      <div style={{ fontSize: 13, color: '#333', fontWeight: 500 }}>Chưa chọn video để chỉnh sửa</div>
      <div className="px-3 py-1.5 rounded" style={{ background: '#151515', color: '#444', fontSize: 10 }}>
        Chọn một video từ danh sách bên trái
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export function DetailEditor({ video, editorState, onChange, onRender, onExportChunked }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragType, setDragType] = useState<'text' | 'video' | 'video-resize' | null>(null);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!dragType || !containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      
      if (dragType === 'text') {
        onChange({ 
          overlayPosition: { 
            x: Math.max(0, Math.min(100, x)), 
            y: Math.max(0, Math.min(100, y)) 
          } 
        });
      } else if (dragType === 'video') {
        onChange({ videoYOffset: Math.max(0, Math.min(100, y)) });
      } else if (dragType === 'video-resize') {
        // Vertical distance from center of video area to mouse
        const dy = Math.abs(y - editorState.videoYOffset) * 2;
        onChange({ videoHeight: Math.max(10, Math.min(100, dy)) });
      }
    };

    const handleGlobalMouseUp = () => setDragType(null);

    if (dragType) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [dragType, onChange, editorState.videoYOffset]);

  if (!video) return <EmptyState />;

  const isDark = editorState.canvasBg === 'black';

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#121212' }}>
      
      {/* ── Slim Header ── */}
      <div className="flex items-center justify-between px-6 shrink-0" style={{ height: 44, borderBottom: '1px solid #1A1A1A', background: '#0D0D0D' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div style={{ width: 10, height: 10, background: '#00B4FF', borderRadius: 2 }} />
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: '#555' }}>EDITOR</span>
          </div>
          <div style={{ width: 1, height: 12, background: '#222' }} />
          <span className="truncate" style={{ fontSize: 11, color: '#999', maxWidth: 240 }}>{video.title}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 9, color: '#333' }}>MODE:</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: isDark ? '#666' : '#AAA' }}>{isDark ? 'VERTICAL DARK' : 'VERTICAL LIGHT'}</span>
          </div>
          <div style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}>1080 × 1920 (9:16)</div>
        </div>
      </div>

      {/* ── Workspace Area ── */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* LEFT: Preview Panel */}
        <div className="flex-1 flex items-center justify-center p-8 bg-[#0A0A0A] relative overflow-hidden">
          {/* Subtle grid background */}
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(#111 1px, transparent 1px)', backgroundSize: '24px 24px', opacity: 0.5 }} />
          
          <div 
            ref={containerRef}
            style={{ 
              height: '100%', 
              maxHeight: 'min(calc(100vh - 120px), 800px)',
              aspectRatio: '9 / 16', 
              background: isDark ? '#000' : '#FFF',
              borderRadius: 4,
              boxShadow: '0 30px 100px rgba(0,0,0,0.8), 0 0 0 1px #1A1A1A',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              zIndex: 1,
              transition: 'background 0.3s ease',
              overflow: 'hidden'
            }}
          >
            {/* 1. Image Overlay Zone (Dynamic size based on video position) */}
            <div style={{ 
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${editorState.videoYOffset - (editorState.videoHeight / 2)}%`,
              background: isDark ? '#050505' : '#F9F9F9',
              borderBottom: `1px solid ${isDark ? '#111' : '#EEE'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden'
            }}>
              {editorState.uploadedImageUrl ? (
                <img src={editorState.uploadedImageUrl} alt="overlay" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ textAlign: 'center', opacity: 0.05 }}>
                  <div style={{ fontSize: 24 }}>🖼️</div>
                  <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.2em', marginTop: 4 }}>TOP OVERLAY</div>
                </div>
              )}
            </div>

            {/* 2. Main Video Zone (Dynamic Height & Position) */}
            <div 
              onMouseDown={(e) => {
                e.stopPropagation();
                setDragType('video');
              }}
              style={{ 
                position: 'absolute',
                top: `${editorState.videoYOffset}%`,
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '100%', 
                height: `${editorState.videoHeight}%`,
                background: '#000', 
                zIndex: 5,
                cursor: dragType === 'video' ? 'grabbing' : 'grab',
                boxShadow: '0 0 40px rgba(0,0,0,0.5)'
              }} 
            >
              <img src={video.thumbnail} alt="v" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
              
              {/* Play Button Icon Overlay */}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: '8px solid #FFF', marginLeft: 2 }} />
                </div>
              </div>

              {/* Resize Handles (Top & Bottom) */}
              {[
                { top: -4, type: 'top' },
                { bottom: -4, type: 'bottom' }
              ].map((h, i) => (
                <div 
                  key={i}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDragType('video-resize');
                  }}
                  style={{ 
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 8, height: 8,
                    background: '#FFF',
                    borderRadius: '50%',
                    border: '2px solid #00B4FF',
                    cursor: 'ns-resize',
                    zIndex: 10,
                    ...(h.top !== undefined ? { top: h.top } : { bottom: h.bottom })
                  }} 
                />
              ))}
              
              {/* Border lines for resize feedback */}
              <div style={{ position: 'absolute', inset: 0, border: '1px solid rgba(0,180,255,0.3)', pointerEvents: 'none' }} />
            </div>

            {/* 3. Bottom Text Overlay Zone (Dynamic position) */}
            <div style={{ 
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              height: `${100 - (editorState.videoYOffset + (editorState.videoHeight / 2))}%`,
              background: isDark ? '#000' : '#FFF',
              borderTop: `1px solid ${isDark ? '#111' : '#EEE'}`,
              overflow: 'hidden'
            }}>
              {/* Movable Text Box */}
              <div 
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDragType('text');
                }}
                style={{ 
                  position: 'absolute',
                  left: `${editorState.overlayPosition.x}%`,
                  top: `${editorState.overlayPosition.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: `${editorState.overlayWidth}%`, 
                  minHeight: 40, 
                  padding: '10px',
                  borderWidth: 2, borderStyle: 'solid', borderColor: editorState.overlayBorderColor,
                  background: editorState.overlayBgColor,
                  borderRadius: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: dragType === 'text' ? 'grabbing' : 'grab',
                  userSelect: 'none',
                  zIndex: 10,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }}
              >
                <span style={{ 
                  fontSize: editorState.overlayFontSize, 
                  fontWeight: 800, 
                  color: isDark ? '#FFF' : '#000', 
                  textAlign: 'center', 
                  lineHeight: 1.3 
                }}>
                  {editorState.overlayText || 'TEXT BOX CONTENT'}
                </span>
                
                {/* Drag handle hint */}
                <div style={{ position: 'absolute', bottom: -12, left: '50%', transform: 'translateX(-50%)', fontSize: 8, color: '#333', opacity: 0.5, pointerEvents: 'none' }}>
                  DRAG TO MOVE
                </div>
              </div>
            </div>
          </div>

          {/* Floating metadata */}
          <div className="absolute bottom-6 left-6 flex items-center gap-4" style={{ opacity: 0.3 }}>
            <div style={{ fontSize: 9, fontFamily: 'monospace' }}>LEN: {video.duration}</div>
            <div style={{ fontSize: 9, fontFamily: 'monospace' }}>SIZE: {video.fileSize}</div>
          </div>
        </div>

        {/* RIGHT: Controls Panel */}
        <div className="w-[320px] border-l border-[#1A1A1A] flex flex-col bg-[#111]">
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
            
            <ControlGroup label="01. Timeline & Trim">
              <TrimControls
                start={editorState.trimStart}
                end={editorState.trimEnd}
                duration={600}
                onChange={(s, e) => onChange({ trimStart: s, trimEnd: e })}
              />
              <div className="grid grid-cols-2 gap-2 mt-2">
                {[
                  { id: 'split2', label: 'SPLIT X2', icon: '✂️' },
                  { id: 'split3', label: 'SPLIT X3', icon: '⚡' }
                ].map(b => (
                  <button 
                    key={b.id}
                    className="flex items-center justify-center gap-2 rounded bg-[#1A1A1A] border border-[#222] text-[#666] transition-all hover:border-[#00B4FF] hover:text-[#00B4FF] hover:bg-[#00B4FF0A]"
                    style={{ height: 32, fontSize: 9, fontWeight: 700, cursor: 'pointer', outline: 'none' }}
                  >
                    <span>{b.icon}</span> {b.label}
                  </button>
                ))}
              </div>
            </ControlGroup>

            <ControlGroup label="02. Video Layout">
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: 8, color: '#333', fontWeight: 700 }}>HEIGHT & OFFSET</span>
                <span style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}>
                  H: {Math.round(editorState.videoHeight)}%, Y: {Math.round(editorState.videoYOffset)}%
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span style={{ fontSize: 7, color: '#444' }}>HEIGHT (%)</span>
                  <input 
                    type="range" min={10} max={100} value={editorState.videoHeight}
                    onChange={(e) => onChange({ videoHeight: +e.target.value })}
                    style={{ width: '100%', height: 4, background: '#1A1A1A', borderRadius: 2, outline: 'none' }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span style={{ fontSize: 7, color: '#444' }}>Y OFFSET (%)</span>
                  <input 
                    type="range" min={0} max={100} value={editorState.videoYOffset}
                    onChange={(e) => onChange({ videoYOffset: +e.target.value })}
                    style={{ width: '100%', height: 4, background: '#1A1A1A', borderRadius: 2, outline: 'none' }}
                  />
                </div>
              </div>
              
              <div className="flex items-center gap-2 mt-3">
                <span style={{ fontSize: 9, color: '#333', width: 60 }}>THEME</span>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  {(['black', 'white'] as const).map(bg => {
                    const active = editorState.canvasBg === bg;
                    return (
                      <button 
                        key={bg}
                        onClick={() => onChange({ canvasBg: bg })}
                        className="flex items-center justify-center gap-2 rounded transition-all"
                        style={{ 
                          height: 30, 
                          background: active ? '#00B4FF15' : '#1A1A1A',
                          borderWidth: 1, borderStyle: 'solid', borderColor: active ? '#00B4FF' : '#222',
                          color: active ? '#00B4FF' : '#555',
                          fontSize: 9, fontWeight: 700, cursor: 'pointer', outline: 'none'
                        }}
                      >
                        <div style={{ width: 8, height: 8, background: bg === 'black' ? '#000' : '#FFF', borderWidth: 1, borderStyle: 'solid', borderColor: '#333', borderRadius: 1 }} />
                        {bg.toUpperCase()}
                      </button>
                    )
                  })}
                </div>
              </div>
            </ControlGroup>

            <ControlGroup label="03. Image Overlay">
              <input 
                type="file" accept="image/*" ref={fileInputRef} className="hidden" 
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange({ uploadedImageUrl: URL.createObjectURL(f) }); }} 
              />
              <div className="flex gap-2">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 rounded border border-dashed border-[#222] text-[#444] hover:border-[#00B4FF] hover:text-[#00B4FF] transition-all"
                  style={{ height: 32, fontSize: 9, fontWeight: 700, background: editorState.uploadedImageUrl ? '#00B4FF0A' : 'transparent', cursor: 'pointer' }}
                >
                  {editorState.uploadedImageUrl ? '✓ IMAGE ATTACHED' : '↑ UPLOAD ASSET'}
                </button>
                {editorState.uploadedImageUrl && (
                  <button 
                    onClick={() => onChange({ uploadedImageUrl: null })}
                    className="px-3 rounded border border-[#FF444433] text-[#FF4444] hover:bg-[#FF444411] transition-all"
                    style={{ height: 32, fontSize: 12, cursor: 'pointer', borderWidth: 1, borderStyle: 'solid', borderColor: '#FF444433' }}
                  >
                    ×
                  </button>
                )}
              </div>
            </ControlGroup>

            <ControlGroup label="04. Text Overlay">
              <textarea 
                value={editorState.overlayText}
                onChange={(e) => onChange({ overlayText: e.target.value })}
                placeholder="Nội dung hiển thị trên video..."
                rows={2}
                style={{ 
                  width: '100%', background: '#080808', borderWidth: 1, borderStyle: 'solid', borderColor: '#1A1A1A', 
                  borderRadius: 3, color: '#AAA', fontSize: 10, padding: '8px', 
                  resize: 'none', outline: 'none', fontFamily: 'Inter' 
                }}
              />
              
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div className="flex flex-col gap-1.5">
                  <span style={{ fontSize: 8, color: '#333', fontWeight: 700 }}>BORDER COLOR</span>
                  <div className="flex items-center gap-2">
                    <div style={{ position: 'relative', width: '100%', height: 24, borderRadius: 2, background: editorState.overlayBorderColor, border: '1px solid #222' }}>
                      <input 
                        type="color" 
                        value={editorState.overlayBorderColor} 
                        onChange={(e) => onChange({ overlayBorderColor: e.target.value })}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span style={{ fontSize: 8, color: '#333', fontWeight: 700 }}>BG COLOR</span>
                  <div className="flex items-center gap-2">
                    <div style={{ position: 'relative', width: '100%', height: 24, borderRadius: 2, background: editorState.overlayBgColor, border: '1px solid #222' }}>
                      <input 
                        type="color" 
                        value={editorState.overlayBgColor.startsWith('rgba') ? '#000000' : editorState.overlayBgColor} 
                        onChange={(e) => onChange({ overlayBgColor: e.target.value })}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span style={{ fontSize: 8, color: '#333', fontWeight: 700 }}>SIZE & WIDTH</span>
                <span style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}>
                  W: {editorState.overlayWidth}%, S: {editorState.overlayFontSize}px
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="flex flex-col gap-1">
                  <span style={{ fontSize: 7, color: '#444' }}>WIDTH (%)</span>
                  <input 
                    type="range" min={10} max={100} value={editorState.overlayWidth}
                    onChange={(e) => onChange({ overlayWidth: +e.target.value })}
                    style={{ width: '100%', height: 4, background: '#1A1A1A', borderRadius: 2, outline: 'none' }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span style={{ fontSize: 7, color: '#444' }}>FONT SIZE</span>
                  <input 
                    type="range" min={8} max={40} value={editorState.overlayFontSize}
                    onChange={(e) => onChange({ overlayFontSize: +e.target.value })}
                    style={{ width: '100%', height: 4, background: '#1A1A1A', borderRadius: 2, outline: 'none' }}
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span style={{ fontSize: 8, color: '#333', fontWeight: 700 }}>POSITION (X, Y)</span>
                <span style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}>
                  {Math.round(editorState.overlayPosition.x)}%, {Math.round(editorState.overlayPosition.y)}%
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="flex flex-col gap-1">
                  <input 
                    type="range" min={0} max={100} value={editorState.overlayPosition.x}
                    onChange={(e) => onChange({ overlayPosition: { ...editorState.overlayPosition, x: +e.target.value } })}
                    style={{ width: '100%', height: 4, background: '#1A1A1A', borderRadius: 2, outline: 'none' }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <input 
                    type="range" min={0} max={100} value={editorState.overlayPosition.y}
                    onChange={(e) => onChange({ overlayPosition: { ...editorState.overlayPosition, y: +e.target.value } })}
                    style={{ width: '100%', height: 4, background: '#1A1A1A', borderRadius: 2, outline: 'none' }}
                  />
                </div>
              </div>
            </ControlGroup>

            {/* Speed Control */}
            <ControlGroup label="05. Speed">
              <div style={{ fontSize: 8, color: '#333', marginBottom: 6 }}>
                Encode less frames → render faster
              </div>
              <SpeedControls
                speed={editorState.speedMultiplier}
                onChange={(s) => onChange({ speedMultiplier: s })}
              />
            </ControlGroup>

            {/* Background Control */}
            <ControlGroup label="06. Background">
              <BackgroundControls
                type="blur"
                onTypeChange={(t) => onChange({ backgroundType: t })}
                onRegenerateBlur={() => {}}
                onUploadImage={() => {}}
              />
            </ControlGroup>

          </div>

          {/* Action Footer */}
          <div className="p-5 border-t border-[#1A1A1A] bg-[#0D0D0D]">
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
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1A1A1A; border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #222; }
        input[type=range] { -webkit-appearance: none; background: #1A1A1A; height: 4px; border-radius: 2px; }
        input[type=range]::-webkit-slider-thumb { 
          -webkit-appearance: none; 
          width: 8px; height: 8px; 
          background: #00B4FF; 
          border-radius: 50%; 
          cursor: pointer;
          border: 1px solid #FFF;
        }
      `}</style>
    </div>
  );
}
