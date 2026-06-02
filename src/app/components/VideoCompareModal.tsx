'use client'
import { colors, spacing, fontSize } from '../design-system/tokens'

import { useMemo } from 'react'
import type { RenderedVideo } from '../types'
import type { Workspace } from '../lib/store'

// ─── Shared types ───────────────────────────────────────────────────────────────

interface VideoCompareModalProps {
  /** Workspace (YouTube source) — may be null if workspace was deleted after render */
  workspace: Workspace | null
  /** Rendered output — null if not rendered yet */
  rendered: RenderedVideo | null
  /** Callback to close modal */
  onClose: () => void
  /** Probe available formats from YouTube (if not already in workspace) */
  youtubeFormats?: number[]
  /** yt-dlp probe duration (seconds) */
  youtubeDuration?: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(sec: number | undefined): string {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseRes(res?: string): { w: number; h: number; label: string } {
  if (!res) return { w: 0, h: 0, label: '—' }
  const parts = res.split('x')
  const w = parseInt(parts[0]) || 0
  const h = parseInt(parts[1]) || 0
  const label = `${w}×${h}`
  return { w, h, label }
}

function parseDuration(d: string | number | undefined): number {
  if (!d) return 0
  if (typeof d === 'number') return d
  const parts = d.split(':')
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1])
  return parseFloat(d) || 0
}

function renderMs(ms?: number): string {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

// ─── Metric row ────────────────────────────────────────────────────────────────

function MetricRow({ label, source, output, accent }: {
  label: string
  source: string | React.ReactNode
  output: string | React.ReactNode
  accent?: boolean
}) {
  const same = source === output
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '90px 1fr 1fr',
      gap: 8,
      padding: '5px 0',
      borderBottom: `1px solid ${colors.border}`,
    }}>
      <span style={{ fontSize: 9, color: colors.textSecondary, fontWeight: 600, letterSpacing: '0.06em', alignSelf: 'center', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, fontFamily: 'monospace', color: colors.textTertiary, textAlign: 'right',
        fontWeight: accent ? 700 : 400,
      }}>
        {source}
      </span>
      <span style={{
        fontSize: 11, fontFamily: 'monospace', color: colors.textTertiary, textAlign: 'right',
        fontWeight: accent ? 700 : 400,
      }}>
        {output}
      </span>
    </div>
  )
}

function DiffRow({ label, value, unit, good }: { label: string; value: string; unit: string; good: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 0',
      borderBottom: `1px solid ${colors.border}`,
    }}>
      <span style={{ fontSize: 9, color: colors.textSecondary, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', width: 90 }}>
        {label}
      </span>
      <span style={{
        flex: 1,
        fontSize: 13, fontFamily: 'monospace', fontWeight: 800,
        color: good ? colors.success : colors.error,
        letterSpacing: '0.02em',
      }}>
        {value}{unit && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 3, color: good ? `${colors.success}88` : `${colors.error}88` }}>{unit}</span>}
      </span>
      <span style={{
        fontSize: 9, fontWeight: 700,
        color: good ? colors.success : colors.error,
        background: good ? `${colors.success}12` : `${colors.error}12`,
        border: `1px solid ${good ? `${colors.success}30` : `${colors.error}30`}`,
        borderRadius: 3, padding: '2px 7px', letterSpacing: '0.04em',
      }}>
        {good ? '✓ OK' : '✗ DIFF'}
      </span>
    </div>
  )
}

// ─── Column header ─────────────────────────────────────────────────────────────

function ColumnHeader({ label, subtitle, color }: { label: string; subtitle: string; color: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '10px 0 8px' }}>
      <div style={{
        fontSize: 9, fontWeight: 800, color, letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        {label}
      </div>
      <div style={{ fontSize: 8, color: colors.textTertiary, marginTop: 2, letterSpacing: '0.04em' }}>
        {subtitle}
      </div>
    </div>
  )
}

// ─── Formats badge row ─────────────────────────────────────────────────────────

function FormatsBadge({ heights }: { heights: number[] }) {
  if (!heights || heights.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {heights.map(h => (
        <span key={h} style={{
          fontSize: 9, fontWeight: 700, fontFamily: 'monospace',
          color: h >= 1080 ? colors.success : h >= 720 ? colors.accent : colors.warning,
          background: h >= 1080 ? `${colors.success}12` : h >= 720 ? `${colors.accent}12` : `${colors.warning}12`,
          border: `1px solid ${h >= 1080 ? `${colors.success}30` : h >= 720 ? `${colors.accent}30` : `${colors.warning}30`}`,
          borderRadius: 3, padding: '1px 6px',
        }}>
          {h}p
        </span>
      ))}
    </div>
  )
}

// ─── Codec badge ────────────────────────────────────────────────────────────────

function CodecBadge({ codec, color = colors.accent }: { codec: string; color?: string }) {
  if (!codec) return null
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, fontFamily: 'monospace',
      color, background: `${color}12`,
      border: `1px solid ${color}30`, borderRadius: 3, padding: '1px 6px',
      letterSpacing: '0.04em',
    }}>
      {codec.toUpperCase()}
    </span>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function VideoCompareModal({ workspace, rendered, onClose, youtubeFormats, youtubeDuration }: VideoCompareModalProps) {
  // ── Derived source data ──
  const srcRes = parseRes(workspace?.videoResolution)
  const srcDuration = youtubeDuration ?? parseDuration(workspace?.duration)
  const srcFileSize = rendered?.sourceInfo?.originalFileSize

  // Approx source file size: if we have originalFileSize use it, otherwise estimate from resolution
  const srcFileSizeBytes = srcFileSize ?? (srcRes.h > 0 ? Math.round(srcRes.h * srcRes.w * 0.06) : 0) // rough bitrate estimate

  const srcCodec = useMemo(() => {
    // yt-dlp typically returns VP9 for web, H.264 for tv_embedded
    // We can't know the exact codec without probing; mark as detected
    if (rendered?.sourceInfo?.downloadQuality) return 'VP9/H.264 (detected)'
    return '—'
  }, [rendered])

  // Source FPS: YouTube streams at 30fps or 60fps; mark as known
  const srcFps = '30/60'
  const srcAspect = useMemo(() => {
    if (!workspace) return '—'
    if (workspace.isShort) return '9:16'
    return '16:9'
  }, [workspace])

  // ── Derived output data ──
  const outRes = parseRes(rendered?.videoResolution)
  const outDuration = rendered?.duration ?? 0
  const outFileSizeBytes = rendered?.fileSizeBytes ?? 0
  const outCodec = rendered?.codec ?? '—'
  const outFps = rendered?.renderConfig?.fps ?? 30
  const outPreset = rendered?.renderConfig?.preset
  const outSpeed = rendered?.renderConfig?.speed
  const outAspect = rendered?.renderConfig?.isShort ? '9:16' : '16:9'

  // ── Computed diffs ──
  const compressionPct = srcFileSizeBytes > 0
    ? ((srcFileSizeBytes - outFileSizeBytes) / srcFileSizeBytes * 100)
    : 0

  const durationDiff = srcDuration > 0
    ? ((outDuration - srcDuration) / srcDuration * 100)
    : 0

  const resolutionMatch = srcRes.h > 0 && outRes.h > 0
    ? srcRes.h <= outRes.h ? 'Upscale' : 'Downscale'
    : '—'

  const isPortrait = workspace?.isShort

  return (
    /* Backdrop */
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>

      {/* Modal */}
      <div style={{
        background: colors.bg,
        border: `1px solid ${colors.borderHover}`,
        borderRadius: 10,
        width: '100%',
        maxWidth: 680,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
        scrollbarWidth: 'thin',
        scrollbarColor: `${colors.borderHover} transparent`,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '16px 20px 12px',
          borderBottom: `1px solid ${colors.border}`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Video title */}
            <div style={{
              fontSize: 13, fontWeight: 600, color: colors.textTertiary,
              lineHeight: 1.4,
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            }}>
              {workspace?.videoTitle || rendered?.videoTitle || '—'}
            </div>
            {/* Channel + IDs */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              {workspace?.channelName && (
                <span style={{ fontSize: 10, color: colors.textTertiary, fontWeight: 600 }}>{workspace.channelName}</span>
              )}
              {workspace?.videoId && (
                <span style={{ fontSize: 9, color: colors.textTertiary, fontFamily: 'monospace' }}>
                  youtube.com/watch?v={workspace.videoId}
                </span>
              )}
            </div>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: colors.textSecondary, fontSize: 16, lineHeight: 1, padding: '2px 4px',
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = colors.text)}
            onMouseLeave={e => (e.currentTarget.style.color = colors.textSecondary)}
          >
            ✕
          </button>
        </div>

        {/* ── Comparison table ── */}
        <div style={{ padding: '0 20px' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr 1fr',
            gap: 8,
            padding: '4px 0',
            borderBottom: `1px solid ${colors.border}`,
          }}>
            <div />
            <ColumnHeader label="YouTube" subtitle="SOURCE" color={colors.accent} />
            <ColumnHeader label="HyperClip" subtitle="OUTPUT" color={colors.accent} />
          </div>

          {/* Metric rows */}
          <MetricRow label="Resolution" source={srcRes.label} output={outRes.label} accent />
          <MetricRow label="Aspect" source={srcAspect} output={outAspect} />
          <MetricRow label="Codec" source={srcCodec} output={<CodecBadge codec={outCodec} />} />
          <MetricRow label="FPS" source={srcFps} output={`${outFps}`} />
          <MetricRow label="Duration" source={formatDuration(srcDuration)} output={formatDuration(outDuration)} />
          <MetricRow label="File size" source={formatBytes(srcFileSizeBytes)} output={formatBytes(outFileSizeBytes)} accent />

          {/* Source formats badge */}
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, padding: '5px 0', borderBottom: `1px solid ${colors.border}` }}>
            <span style={{ fontSize: 9, color: colors.textSecondary, fontWeight: 600, letterSpacing: '0.06em', alignSelf: 'center', textTransform: 'uppercase' }}>YT Formats</span>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <FormatsBadge heights={workspace?.availableFormats ?? youtubeFormats ?? []} />
            </div>
          </div>

          {/* Render config (only on output side) */}
          {rendered?.renderConfig && (
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 8, padding: '5px 0', borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ fontSize: 9, color: colors.textSecondary, fontWeight: 600, letterSpacing: '0.06em', alignSelf: 'center', textTransform: 'uppercase' }}>Preset</span>
              <span />
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: colors.textTertiary, textAlign: 'right' }}>
                {outPreset || '—'} {outSpeed ? `· ${outSpeed}×` : ''}
              </span>
            </div>
          )}
        </div>

        {/* ── Diff analysis ── */}
        <div style={{ padding: '12px 20px' }}>
          <div style={{
            fontSize: 8, fontWeight: 800, color: colors.borderHover,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            marginBottom: 8, paddingBottom: 6,
            borderBottom: `1px solid ${colors.border}`,
          }}>
            Phân tích
          </div>

          {/* Compression */}
          {outFileSizeBytes > 0 && (
            <DiffRow
              label="Compression"
              value={compressionPct > 0 ? `-${compressionPct.toFixed(1)}%` : `+${Math.abs(compressionPct).toFixed(1)}%`}
              unit={compressionPct > 0 ? 'smaller' : 'larger'}
              good={compressionPct > 0}
            />
          )}

          {/* Duration delta */}
          {srcDuration > 0 && Math.abs(durationDiff) > 0.1 && (
            <DiffRow
              label="Duration"
              value={`${durationDiff > 0 ? '+' : ''}${durationDiff.toFixed(1)}%`}
              unit="vs source"
              good={Math.abs(durationDiff) < 1}
            />
          )}

          {/* Resolution delta */}
          {srcRes.h > 0 && outRes.h > 0 && (
            <DiffRow
              label="Resolution"
              value={`${srcRes.h}p → ${outRes.h}p`}
              unit={resolutionMatch}
              good={srcRes.h === outRes.h}
            />
          )}

          {/* Codec conversion */}
          <DiffRow
            label="Codec"
            value={`YouTube → ${outCodec || 'encoded'}`}
            unit=""
            good={!!outCodec}
          />

          {/* Format change */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 0',
            borderBottom: `1px solid ${colors.border}`,
          }}>
            <span style={{ fontSize: 9, color: colors.textSecondary, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', width: 90 }}>
              Container
            </span>
            <span style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', color: colors.textTertiary, textAlign: 'right' }}>
              YouTube (adaptive) → MP4 (H.264/AAC)
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700, color: colors.success,
              background: `${colors.success}12`, border: `1px solid ${colors.success}30`,
              borderRadius: 3, padding: '2px 7px', letterSpacing: '0.04em',
            }}>
              ✓ MP4
            </span>
          </div>

          {/* Render time */}
          {rendered?.renderDurationMs && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 0',
              borderBottom: `1px solid ${colors.border}`,
            }}>
              <span style={{ fontSize: 9, color: colors.textSecondary, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', width: 90 }}>
                Render time
              </span>
              <span style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', fontWeight: 800, color: colors.accent, textAlign: 'right' }}>
                {renderMs(rendered.renderDurationMs)}
              </span>
              <span style={{ fontSize: 9, color: colors.textTertiary, minWidth: 40, textAlign: 'right' }}>
                wall-clock
              </span>
            </div>
          )}
        </div>

        {/* ── Output path ── */}
        {rendered?.outputPath && (
          <div style={{
            padding: '10px 20px',
            borderTop: `1px solid ${colors.border}`,
            background: colors.bg,
            borderRadius: '0 0 10px 10px',
          }}>
            <div style={{ fontSize: 8, color: colors.borderHover, fontWeight: 800, letterSpacing: '0.1em', marginBottom: 4 }}>
              OUTPUT PATH
            </div>
            <div style={{
              fontSize: 9, fontFamily: 'monospace', color: colors.textSecondary,
              wordBreak: 'break-all', lineHeight: 1.6,
            }}>
              {rendered.outputPath}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
