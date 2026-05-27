import { colors, spacing, fontSize } from '../../design-system/tokens'
'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '../../lib/store'
import { ipc } from '../../lib/ipc'

interface CompleteStepProps {
  onComplete: () => void
  onBack: () => void
}

export function CompleteStep({ onComplete, onBack }: CompleteStepProps) {
  const { channels } = useAppStore()
  const [sessionStatus, setSessionStatus] = useState<any>(null)
  const [projectCount, setProjectCount] = useState(0)
  const [isLaunching, setIsLaunching] = useState(false)

  useEffect(() => {
    ipc.getSessionStatus().then(setSessionStatus)
    ipc.getProjects().then((p: any) => setProjectCount(p?.length || 0))
  }, [])

  const readySessions = sessionStatus?.sessions?.filter((s: any) => s.isConsented).length || 0
  const sessionTotal = sessionStatus?.sessionCount || 0

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Success animation */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '20px 0 32px',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: '#00FF8822', border: '2px solid #00FF88',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24,
          animation: 'fadeIn 0.5s ease',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l5 5L19 7" stroke="#00FF88" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: colors.text, marginBottom: 8, textAlign: 'center' }}>
          Setup hoàn tất!
        </div>
        <div style={{ fontSize: 13, color: '#777', textAlign: 'center', lineHeight: 1.6 }}>
          HyperClip đã sẵn sàng theo dõi video mới từ YouTube.
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 28 }}>
        {/* Sessions */}
        <div style={{
          background: colors.bg, border: '1px solid #E0E0E0',
          borderRadius: 10, padding: '14px 16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: readySessions > 0 ? colors.success : '#777', marginBottom: 4 }}>
            {readySessions}/{sessionTotal}
          </div>
          <div style={{ fontSize: 10, color: '#777' }}>Chrome Sessions</div>
          <div style={{ fontSize: 9, color: '#999', marginTop: 4 }}>
            {readySessions > 0 ? '✓ Đã sẵn sàng' : 'Chưa có session'}
          </div>
        </div>

        {/* Channels */}
        <div style={{
          background: colors.bg, border: '1px solid #E0E0E0',
          borderRadius: 10, padding: '14px 16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: channels.length > 0 ? colors.accent : '#777', marginBottom: 4 }}>
            {channels.length}
          </div>
          <div style={{ fontSize: 10, color: '#777' }}>Channels</div>
          <div style={{ fontSize: 9, color: '#999', marginTop: 4 }}>
            {channels.length > 0 ? '✓ Đang theo dõi' : 'Chưa thêm kênh'}
          </div>
        </div>

        {/* Projects */}
        <div style={{
          background: colors.bg, border: '1px solid #E0E0E0',
          borderRadius: 10, padding: '14px 16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: projectCount > 0 ? colors.success : '#777', marginBottom: 4 }}>
            {projectCount}
          </div>
          <div style={{ fontSize: 10, color: '#777' }}>GCP Projects</div>
          <div style={{ fontSize: 9, color: '#999', marginTop: 4 }}>
            {projectCount > 0 ? '✓ Backup quota' : 'Dự phòng tùy chọn'}
          </div>
        </div>
      </div>

      {/* What's next */}
      <div style={{
        background: colors.bg, border: '1px solid #E0E0E0',
        borderRadius: 12, padding: '20px 24px',
        marginBottom: 28,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 14 }}>
          HyperClip sẽ làm gì?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%',
              background: '#00B4FF22', border: '1px solid #00B4FF44',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: colors.accent, flexShrink: 0,
            }}>1</div>
            <div style={{ fontSize: 11, color: '#999', lineHeight: 1.6 }}>
              <strong style={{ color: colors.text }}>Detection tự động</strong> — Kiểm tra video mới mỗi 5 giây
              từ các kênh đã thêm. Video mới trong vòng 10 phút được phát hiện trong &lt;20 giây.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%',
              background: '#00B4FF22', border: '1px solid #00B4FF44',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: colors.accent, flexShrink: 0,
            }}>2</div>
            <div style={{ fontSize: 11, color: '#999', lineHeight: 1.6 }}>
              <strong style={{ color: colors.text }}>Auto-download</strong> — Video được tải về tự động
              ngay khi detect. Không cần thao tác thủ công.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%',
              background: '#00B4FF22', border: '1px solid #00B4FF44',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: colors.accent, flexShrink: 0,
            }}>3</div>
            <div style={{ fontSize: 11, color: '#999', lineHeight: 1.6 }}>
              <strong style={{ color: colors.text }}>Chỉnh sửa + Render</strong> — Mở video trong app,
              cắt ghép, thêm overlay, render với GPU NVIDIA NVENC.
            </div>
          </div>
        </div>
      </div>

      {/* Quick tips */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 10 }}>
          Mẹo nhanh
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            'Mở Dashboard để xem video đã download và render',
            'Settings → Chrome Sessions để quản lý login profiles',
            'Settings → Projects để thêm GCP projects cho quota dự phòng',
            'Settings → Diagnostics để kiểm tra trạng thái hệ thống',
          ].map((tip, i) => (
            <div key={i} style={{
              display: 'flex', gap: 8, alignItems: 'center',
              fontSize: 11, color: '#777',
            }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#999', flexShrink: 0 }} />
              {tip}
            </div>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button
          onClick={onBack}
          style={{
            height: 40, padding: '0 20px',
            background: 'transparent', border: '1px solid #D0D0D0',
            borderRadius: 8, fontSize: 12, fontWeight: 600,
            color: '#777', cursor: 'pointer',
          }}
        >
          ← Quay lại
        </button>
        <button
          onClick={onComplete}
          disabled={isLaunching}
          style={{
            height: 40, padding: '0 24px',
            background: isLaunching ? '#005577' : colors.success,
            border: 'none',
            borderRadius: 8, fontSize: 12, fontWeight: 700,
            color: '#000', cursor: isLaunching ? 'not-allowed' : 'pointer',
          }}
        >
          {isLaunching ? 'Đang khởi động...' : 'Mở Dashboard →'}
        </button>
      </div>
    </div>
  )
}
