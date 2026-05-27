'use client'

import { useMemo } from 'react'
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', fontSize: 9, fontFamily: 'monospace', borderBottom: '1px solid #E0E0E0' }}>
      <span style={{ color: '#999' }}>{label}</span>
      <span style={{ color: color || '#00B4FF', fontWeight: 600 }}>{value}{suffix ? ` ${suffix}` : ''}</span>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, fontFamily: 'monospace', padding: '1px 0', color: '#777' }}>
      <span>{label}</span>
      <span style={{ color: '#999' }}>{timeStr}</span>
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
    <div style={{ flex: 1, background: '#F5F5F5', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ fontSize: 8, color: '#777', fontWeight: 700, padding: '5px 10px', borderBottom: '1px solid #D0D0D0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F5F5F5' }}>
        <span style={{ letterSpacing: 1 }}>VIDEO DETAIL</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: 10, padding: '0 4px' }}>X</button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Thumbnail + Title */}
        <div style={{ padding: 8 }}>
          {workspace.thumbnail && (
            <img src={workspace.thumbnail} alt='' style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 4, marginBottom: 6 }} />
          )}
          <div style={{ fontSize: 9, fontWeight: 700, color: '#999', marginBottom: 2, lineHeight: 1.4 }}>{workspace.videoTitle}</div>
          <div style={{ fontSize: 8, color: '#777' }}>{workspace.channelName}</div>
        </div>

        {/* DOWNLOAD METRICS */}
        <Section title='DOWNLOAD' color='#00B4FF'>
          <MetricRow label='Thoi gian' value={formatMs(m?.downloadMs)} color='#00FF88' />
          <MetricRow label='Toc do' value={downloadSpeed || '-'} suffix='MB/s' />
          <MetricRow label='Kich thuoc' value={formatBytes((m?.downloadFileSize || Number(workspace.fileSize) || 0))} />
          <MetricRow label='Chat luong' value={m?.downloadQuality || workspace.downloadQuality || '-'} suffix='p' />
          <MetricRow label='Nguon' value={m?.downloadResolution || workspace.videoResolution || '-'} />
          <MetricRow label='Multi-Instance' value={m?.downloadIsMultiInstance ? 'Co' : 'Khong'} color={m?.downloadIsMultiInstance ? '#00FF88' : '#555'} />
        </Section>

        {/* RENDER METRICS */}
        <Section title='RENDER' color='#00FF88'>
          <MetricRow label='Thoi gian' value={formatMs(m?.renderMs)} color='#00FF88' />
          {m?.renderFps ? <MetricRow label='Encode FPS' value={m.renderFps.toFixed(1)} color='#FFB800' /> : null}
          {m?.renderChunks ? <MetricRow label='So chunk' value={m.renderChunks} /> : null}
          <MetricRow label='Workers' value={m?.renderWorkers || '-'} />
          <MetricRow label='Preset' value={m?.renderPreset || '-'} />
          <MetricRow label='Codec' value={m?.renderCodec || '-'} />
          <MetricRow label='Dau ra' value={m?.renderOutputResolution || '-'} />
        </Section>

        {/* SYSTEM */}
        <Section title='SYSTEM' color='#FFB800'>
          {m?.systemGpuLoad != null ? <MetricRow label='GPU su dung' value={`${m.systemGpuLoad}%`} color='#FF6B6B' /> : null}
          {m?.systemVramUsed != null ? <MetricRow label='VRAM dung' value={`${m.systemVramUsed} MB`} /> : null}
          {m?.systemRamUsed != null ? <MetricRow label='RAM dung' value={`${m.systemRamUsed} GB`} /> : null}
        </Section>

        {/* E2E TIMELINE */}
        <Section title='E2E TIMELINE' color='#888'>
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#777', lineHeight: 1.8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00B4FF' }} />
                <div style={{ width: 1, height: 20, background: '#D0D0D0' }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00B4FF' }} />
                <div style={{ width: 1, height: 20, background: '#D0D0D0' }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00B4FF' }} />
                <div style={{ width: 1, height: 20, background: '#D0D0D0' }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: workspace.status === 'done' ? '#00FF88' : '#444' }} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <TimelineRow label='Phat hien' timestamp={m?.detectedAt} />
                <TimelineRow label='Tai xuong' timestamp={m?.downloadStartedAt} />
                <TimelineRow label='San sang' timestamp={m?.downloadCompletedAt} />
                <TimelineRow label='Hoan thanh' timestamp={m?.renderCompletedAt} />
              </div>
            </div>
          </div>
          {(m?.detectedAt && m?.renderCompletedAt) ? (
            <div style={{ marginTop: 4, padding: '4px 6px', background: '#F0F0F0', borderRadius: 2, border: '1px solid #D0D0D0', display: 'flex', justifyContent: 'space-between', fontSize: 8, fontFamily: 'monospace' }}>
              <span style={{ color: '#777' }}>TONG</span>
              <span style={{ color: '#00FF88', fontWeight: 700 }}>
                {formatMs(new Date(m.renderCompletedAt).getTime() - new Date(m.detectedAt).getTime())}
              </span>
            </div>
          ) : null}
        </Section>

        {/* Raw info */}
        <Section title='RAW INFO' color='#888'>
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
