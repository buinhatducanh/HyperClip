'use client'

interface Props {
  quality: number
  onChange: (q: 1080 | 720) => void
  onExport: () => void
  isRendering?: boolean
  codec?: 'h264' | 'hevc'
  onCodecChange?: (c: 'h264' | 'hevc') => void
  preset?: 'p1' | 'p2' | 'p3'
  onPresetChange?: (p: 'p1' | 'p2' | 'p3') => void
  tune?: 'hq' | 'll' | 'film'
  onTuneChange?: (t: 'hq' | 'll' | 'film') => void
  enableChunked?: boolean
  onChunkedChange?: (v: boolean) => void
  onExportChunked?: () => void
}

const TUNE_LABELS: Record<string, string> = { hq: 'HQ', ll: 'LL', film: 'FILM' }
const PRESET_LABELS: Record<string, string> = { p1: 'FAST', p2: 'BAL', p3: 'QUAL' }

export function ExportPanel({
  quality, onChange, onExport, isRendering,
  codec = 'hevc', onCodecChange,
  preset = 'p1', onPresetChange,
  tune = 'hq', onTuneChange,
  enableChunked = false, onChunkedChange,
  onExportChunked,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      {/* Quality */}
      <div>
        <div style={{ fontSize: 8, color: '#333', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>
          QUALITY
        </div>
        <div className="flex gap-1">
          {([1080, 720] as const).map((q) => {
            const active = quality === q
            return (
              <button key={q} onClick={() => onChange(q)}
                style={{
                  flex: 1, height: 24,
                  background: active ? '#00B4FF' : '#1A1A1A',
                  border: '1px solid', borderColor: active ? '#00B4FF' : '#222',
                  borderRadius: 2, fontSize: 10, fontWeight: 700,
                  color: active ? '#000' : '#444',
                  cursor: 'pointer', fontFamily: 'monospace',
                  transition: 'all 0.15s',
                }}>
                {q}p
              </button>
            )
          })}
        </div>
      </div>

      {/* Codec + Preset */}
      <div className="flex gap-2">
        {onCodecChange && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: '#333', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>
              CODEC
            </div>
            <div className="flex gap-1">
              {(['h264', 'hevc'] as const).map((c) => {
                const active = codec === c
                return (
                  <button key={c} onClick={() => onCodecChange(c)}
                    style={{
                      flex: 1, height: 22,
                      background: active ? '#7C3AED' : '#1A1A1A',
                      border: '1px solid', borderColor: active ? '#7C3AED' : '#222',
                      borderRadius: 2, fontSize: 9, fontWeight: 700,
                      color: active ? '#fff' : '#444',
                      cursor: 'pointer', fontFamily: 'monospace',
                    }}>
                    {c === 'h264' ? 'H.264' : 'HEVC'}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {onPresetChange && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: '#333', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>
              PRESET
            </div>
            <div className="flex gap-1">
              {(['p1', 'p2', 'p3'] as const).map((p) => {
                const active = preset === p
                return (
                  <button key={p} onClick={() => onPresetChange(p)}
                    style={{
                      flex: 1, height: 22,
                      background: active ? '#00B4FF' : '#1A1A1A',
                      border: '1px solid', borderColor: active ? '#00B4FF' : '#222',
                      borderRadius: 2, fontSize: 9, fontWeight: 700,
                      color: active ? '#000' : '#444',
                      cursor: 'pointer', fontFamily: 'monospace',
                    }}>
                    {PRESET_LABELS[p]}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Tune */}
      {onTuneChange && (
        <div>
          <div style={{ fontSize: 8, color: '#333', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>
            TUNE
          </div>
          <div className="flex gap-1">
            {(['hq', 'll', 'film'] as const).map((t) => {
              const active = tune === t
              return (
                <button key={t} onClick={() => onTuneChange(t)}
                  style={{
                    flex: 1, height: 22,
                    background: active ? '#00FF88' : '#1A1A1A',
                    border: '1px solid', borderColor: active ? '#00FF8844' : '#222',
                    borderRadius: 2, fontSize: 9, fontWeight: 700,
                    color: active ? '#00FF88' : '#444',
                    cursor: 'pointer', fontFamily: 'monospace',
                  }}>
                  {TUNE_LABELS[t]}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* GPU MAX — parallel chunked encode */}
      {onExportChunked && onChunkedChange && (
        <div className="flex items-center justify-between">
          <span
            title="4 workers encode song song trên NVENC — nhanh hơn nhưng tốn GPU hơn"
            style={{ fontSize: 8, color: '#333', fontWeight: 700, letterSpacing: '0.1em', cursor: 'help' }}>
            GPU MAX
          </span>
          <div className="flex items-center gap-2">
            <span
              title="4 workers encode song song trên NVENC"
              style={{ fontSize: 8, color: enableChunked ? '#00FF88' : '#333', fontWeight: 700, cursor: 'help' }}>
              PARALLEL
            </span>
            <button
              onClick={() => !isRendering && onChunkedChange(!enableChunked)}
              style={{
                width: 32, height: 16,
                background: enableChunked ? '#00FF88' : '#1A1A1A',
                border: '1px solid', borderColor: enableChunked ? '#00FF8844' : '#222',
                borderRadius: 8, cursor: isRendering ? 'not-allowed' : 'pointer', position: 'relative', transition: 'all 0.2s',
              }}
              disabled={isRendering}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: enableChunked ? '#000' : '#444',
                position: 'absolute', top: 2,
                left: enableChunked ? 18 : 3,
                transition: 'left 0.2s',
              }} />
            </button>
            {enableChunked && (
              <span style={{ fontSize: 7, color: '#00FF88', fontFamily: 'monospace' }}>4x</span>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {onExportChunked && (
          <button onClick={onExportChunked} disabled={isRendering}
            style={{
              flex: 1, height: 44,
              background: isRendering ? '#FF444440' : '#7C3AED',
              borderWidth: 0, borderRadius: 4,
              fontSize: 11, fontWeight: 800,
              color: isRendering ? '#FF4444' : '#fff',
              cursor: isRendering ? 'not-allowed' : 'pointer',
              letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all 0.15s',
              boxShadow: isRendering ? 'none' : '0 0 20px rgba(124, 58, 237, 0.2)',
            }}>
            {isRendering ? (
              <><Spinner /> ENCODING...</>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff">
                  <path d="M12 2L2 12h4v8h12v-8h4L12 2z" />
                </svg>
                GPU MAX
              </>
            )}
          </button>
        )}

        {/* Render button */}
        <button onClick={onExport} disabled={isRendering}
          style={{
            flex: 1, height: 44,
            background: isRendering ? '#FF444440' : '#00B4FF',
            borderWidth: 0, borderRadius: 4,
            fontSize: 11, fontWeight: 800,
            color: isRendering ? '#FF4444' : '#000',
            cursor: isRendering ? 'not-allowed' : 'pointer',
            letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'all 0.15s',
            boxShadow: isRendering ? 'none' : '0 0 20px rgba(0, 180, 255, 0.2)',
          }}>
          {isRendering ? (
            <><Spinner /> RENDERING...</>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#000">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              RENDER
            </>
          )}
        </button>
      </div>

      <div style={{ fontSize: 8, color: '#333', textAlign: 'center', letterSpacing: '0.05em' }}>
        NVENC · CUDA DECODE · GPU MAX
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function Spinner() {
  return (
    <div style={{
      width: 14, height: 14, borderRadius: '50%',
      border: '2px solid',
      borderColor: 'rgba(255,255,255,0.2) rgba(255,255,255,0.2) #fff #fff',
      animation: 'spin 1s linear infinite',
    }} />
  )
}
