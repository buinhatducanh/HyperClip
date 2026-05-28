'use client'

import { useMemo } from 'react'
import { colors, spacing, fontSize } from '../design-system/tokens'
import type { Workspace, WorkspaceMetrics } from '../lib/store'

function formatMs(ms: number | undefined): string {
  if (ms == null || ms === 0) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}


function MetricRow({ label, value, suffix, color }: { label: string; value: string | number; suffix?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', fontSize: 9, fontFamily: 'monospace', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ color: colors.textSecondary }}>{label}</span>
      <span style={{ color: color || colors.accent, fontWeight: 600 }}>{value}{suffix ? ` ${suffix}` : ''}</span>
    </div>
  )
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '6px 8px' }}>
      <div style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: 1, marginBottom: 4, borderBottom: `1px solid ${color}22`, paddingBottom: 2 }}>
        ◆ {title}
      </div>
      {children}
    </div>
  )
}

function TimelineRow({ label, timestamp }: { label: string; timestamp?: string }) {
  const timeStr = timestamp
    ? new Date(timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '-'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, fontFamily: 'monospace', padding: '1px 0', color: colors.textSecondary }}>
      <span>{label}</span>
      <span style={{ color: colors.textSecondary }}>{timeStr}</span>
    </div>
  )
}

interface Props {
  workspace: Workspace | null
  onClose: () => void
}

export function VideoDetailPanel({ workspace, onClose }: Props) {
  const m = workspace?.metrics

  const downloadSpeed = useMemo(() => {
    if (m?.downloadSpeedMBs) return m.downloadSpeedMBs.toFixed(1)
    if (m?.downloadMs && m?.downloadFileSize && m.downloadMs > 0) {
      const sec = m.downloadMs / 1000
      return (m.downloadFileSize / 1024 / 1024 / sec).toFixed(1)
    }
    return null
  }, [m])

  if (!workspace) return null

  return (
    <div style={{ flex: 1, background: colors.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ fontSize: 8, color: colors.textSecondary, fontWeight: 700, padding: '5px 10px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: colors.bg }}>
        <span style={{ letterSpacing: 1 }}>VIDEO DETAIL</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: 10, padding: '0 4px' }}>X</button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Thumbnail + Title */}
        <div style={{ padding: 8 }}>
          {workspace.thumbnail && (
            <img src={workspace.thumbnail} alt='' style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 4, marginBottom: 6 }} />
          )}
          <div style={{ fontSize: 9, fontWeight: 700, color: colors.textSecondary, marginBottom: 2, lineHeight: 1.4 }}>{workspace.videoTitle}</div>
          <div style={{ fontSize: 8, color: colors.textSecondary }}>{workspace.channelName}</div>
        </div>

        {/* DOWNLOAD METRICS */}
        <Section title='TẢI XUỐNG' color={colors.accent}>
          <MetricRow label='Thời gian' value={formatMs(m?.downloadMs)} color={colors.success} />
          <MetricRow label='Tốc độ' value={downloadSpeed || '-'} suffix='MB/s' />
          <MetricRow label='Kích thước' value={formatBytes((m?.downloadFileSize || Number(workspace.fileSize) || 0))} />
          <MetricRow label='Chất lượng' value={m?.downloadQuality || workspace.downloadQuality || '-'} suffix='p' />
          <MetricRow label='Nguồn' value={m?.downloadResolution || workspace.videoResolution || '-'} />
          <MetricRow label='Multi-Instance' value={m?.downloadIsMultiInstance ? 'Có' : 'Không'} color={m?.downloadIsMultiInstance ? colors.success : colors.textSecondary} />
        </Section>

        {/* RENDER METRICS */}
        <Section title='RENDER' color={colors.success}>
          <MetricRow label='Thời gian' value={formatMs(m?.renderMs)} color={colors.success} />
          {m?.renderFps ? <MetricRow label='Encode FPS' value={m.renderFps.toFixed(1)} color={colors.warning} /> : null}
          {m?.renderChunks ? <MetricRow label='Số chunk' value={m.renderChunks} /> : null}
          <MetricRow label='Workers' value={m?.renderWorkers || '-'} />
          <MetricRow label='Preset' value={m?.renderPreset || '-'} />
          <MetricRow label='Codec' value={m?.renderCodec || '-'} />
          <MetricRow label='Đầu ra' value={m?.renderOutputResolution || '-'} />
        </Section>

        {/* SYSTEM */}
        <Section title='HỆ THỐNG' color={colors.warning}>
          {m?.systemGpuLoad != null ? <MetricRow label='GPU sử dụng' value={`${m.systemGpuLoad}%`} color={colors.error} /> : null}
          {m?.systemVramUsed != null ? <MetricRow label='VRAM dùng' value={`${m.systemVramUsed} MB`} /> : null}
          {m?.systemRamUsed != null ? <MetricRow label='RAM dùng' value={`${m.systemRamUsed} GB`} /> : null}
        </Section>

        {/* E2E TIMELINE */}
        <Section title='LUỒNG THỜI GIAN' color={colors.textSecondary}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: colors.textSecondary, lineHeight: 1.8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.accent }} />
                <div style={{ width: 1, height: 20, background: colors.textTertiary }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.accent }} />
                <div style={{ width: 1, height: 20, background: colors.textTertiary }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.accent }} />
                <div style={{ width: 1, height: 20, background: colors.textTertiary }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: workspace.status === 'done' ? colors.success : colors.textSecondary }} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <TimelineRow label='Phát hiện' timestamp={m?.detectedAt} />
                <TimelineRow label='Tải xuống' timestamp={m?.downloadStartedAt} />
                <TimelineRow label='Sẵn sàng' timestamp={m?.downloadCompletedAt} />
                <TimelineRow label='Hoàn thành' timestamp={m?.renderCompletedAt} />
              </div>
            </div>
          </div>
          {(m?.detectedAt && m?.renderCompletedAt) ? (
            <div style={{ marginTop: 4, padding: '4px 6px', background: colors.bg, borderRadius: 2, border: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 8, fontFamily: 'monospace' }}>
              <span style={{ color: colors.textSecondary }}>TỔNG</span>
              <span style={{ color: colors.success, fontWeight: 700 }}>
                {formatMs(new Date(m.renderCompletedAt).getTime() - new Date(m.detectedAt).getTime())}
              </span>
            </div>
          ) : null}
        </Section>

        {/* Raw info */}
        <Section title='RAW INFO' color={colors.textSecondary}>
          <MetricRow label='ID' value={workspace.id.slice(0, 12)} />
          <MetricRow label='Video ID' value={workspace.videoId || '-'} />
          <MetricRow label='Status' value={workspace.status} />
          <MetricRow label='Trim' value={workspace.trimLimit === 'full' ? 'Full' : `${workspace.trimLimit}m`} />
          <MetricRow label='Quality' value={String(workspace.quality)} suffix='p' />
        </Section>
      </div>
    </div>
  )
}
