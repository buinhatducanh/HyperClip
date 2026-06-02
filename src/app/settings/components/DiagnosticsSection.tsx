'use client'
import { colors, spacing, fontSize } from '../../design-system/tokens'

import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../lib/store'
import {
  MAX_UNITS_PER_PROJECT,
  QUOTA_WARNING_PCT,
  QUOTA_CRITICAL_THRESHOLD,
  QUOTA_WARNING_THRESHOLD,
  QUOTA_BAR_WARN_PCT,
  QUOTA_BAR_EXHAUSTED_PCT,
  STALE_SESSION_DAYS,
  HOURLY_EVENTS_MAX,
  RESET_ANIMATION_MS,
  CPU_WARN_PCT,
} from '../../lib/constants'
import {
  formatNextReset,
  formatTimeAgo,
  UsageTimeline,
  StatCard,
} from '../../lib/utils'
import { ipc } from '../../lib/ipc'
import type { Project, ApiKeyStatus, SessionStatus, DiagResult } from '../types'

function DiagRow({ label, ok, okColor, errorColor, details, fix }: {
  label: string
  ok: boolean
  okColor: string
  errorColor: string
  details: string
  fix?: string
}) {
  const color = ok ? okColor : errorColor
  return (
    <div style={{ marginBottom: 12, padding: '10px 14px', background: colors.bg, borderRadius: 6, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: fix ? 6 : 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 70 }}>{label}</span>
        <span style={{ fontSize: 9, color: colors.textSecondary }}>{details}</span>
      </div>
      {fix && (
        <div style={{ fontSize: 9, color: colors.textTertiary, paddingLeft: 16, lineHeight: 1.6 }}>
          💡 {fix}
        </div>
      )}
    </div>
  )
}

export function DiagnosticsSection() {
  const [diag, setDiag] = useState<DiagResult | null>(null)
  const [loading, setLoading] = useState(false)

  const runDiag = async () => {
    setLoading(true)
    try {
      const result = await (window.electronAPI?.runDiagnostics as () => Promise<DiagResult>)()
      setDiag(result)
    } catch (e) {
      console.error('Diagnostics failed:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { runDiag() }, [])

  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: colors.text, letterSpacing: '0.1em' }}>SYSTEM DIAGNOSTICS</span>
        <button
          onClick={runDiag}
          disabled={loading}
          style={{
            fontSize: 9, fontWeight: 700, color: colors.warning, background: 'transparent',
            border: `1px solid ${colors.warning}44`, borderRadius: 4, padding: '4px 10px', cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'CHECKING...' : 'REFRESH'}
        </button>
      </div>

      {!diag ? (
        <div style={{ color: colors.textTertiary, fontSize: 11 }}>Checking prerequisites...</div>
      ) : (
        <>
          {/* Overall status */}
          <div style={{
            padding: '12px 16px', borderRadius: 6, marginBottom: 16,
            background: diag.overall.ready ? `${colors.success}11` : `${colors.warning}11`,
            border: `1px solid ${diag.overall.ready ? `${colors.success}44` : `${colors.warning}44`}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: diag.overall.ready ? colors.success : colors.warning }}>
              {diag.overall.ready ? '✓ READY — All prerequisites met' : '✗ ISSUES FOUND — Fix before use'}
            </div>
          </div>

          {/* FFmpeg */}
          <DiagRow
            label="FFmpeg"
            ok={diag.ffmpeg.ok}
            okColor={colors.success}
            errorColor={colors.error}
            details={[
              diag.ffmpeg.ok ? `${diag.ffmpeg.version}` : 'Not found',
              diag.ffmpeg.bundled ? 'bundled' : 'system',
              diag.ffmpeg.hasNvenc ? 'NVENC ✓' : 'NVENC ✗ (CPU encoding)',
            ].filter(Boolean).join(' · ')}
            fix={
              !diag.ffmpeg.ok
                ? 'Download FFmpeg từ https://ffmpeg.org (chọn "essentials" build). Giải nén, thêm thư mục bin vào PATH.'
                : !diag.ffmpeg.hasNvenc
                ? 'FFmpeg build hiện tại không có NVIDIA NVENC. Tải FFmpeg build hỗ trợ NVENC (gyan.dev builds recommended).'
                : undefined
            }
          />

          {/* yt-dlp */}
          <DiagRow
            label="yt-dlp"
            ok={diag.ytDlp.ok}
            okColor={colors.success}
            errorColor={colors.error}
            details={diag.ytDlp.ok ? `v${diag.ytDlp.version}` : 'Not found'}
            fix={
              !diag.ytDlp.ok
                ? 'Chạy lệnh: npm install yt-dlp\nHoặc: pip install yt-dlp'
                : undefined
            }
          />

          {/* Storage */}
          <DiagRow
            label="RAM Disk"
            ok={diag.storage.ramDiskAvailable}
            okColor={colors.success}
            errorColor={colors.warning}
            details={diag.storage.ramDiskAvailable ? 'R:\\hyperclip ✓' : 'Không có — dùng ổ C'}
            fix={
              !diag.storage.ramDiskAvailable
                ? 'Tốc độ I/O sẽ chậm hơn. Bỏ qua nếu không cần tốc độ cao. (Hướng dẫn cài ImDisk: hyperclip.com/ramdisk)'
                : undefined
            }
          />

          {/* Store dir */}
          <div style={{ marginTop: 12, padding: '8px 12px', background: colors.bg, borderRadius: 6, fontSize: 9, color: colors.textTertiary }}>
            Data: {diag.storage.storeDir}
          </div>

          {/* Issues list */}
          {diag.overall.issues.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: colors.warning, marginBottom: 8, letterSpacing: '0.05em' }}>CẦN FIX:</div>
              {diag.overall.issues.map((issue, i) => (
                <div key={i} style={{ fontSize: 10, color: colors.textSecondary, padding: '4px 0', borderBottom: `1px solid ${colors.border}` }}>
                  • {issue}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, fontSize: 9, color: colors.textTertiary }}>
            Last checked: {new Date(diag.timestamp).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  )
}
