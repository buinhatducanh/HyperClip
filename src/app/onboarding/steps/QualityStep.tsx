'use client'
import { colors, spacing, fontSize } from '../../design-system/tokens'

import { useState, useEffect } from 'react'
import { ipc } from '../../lib/ipc'
import { useAppStore } from '../../lib/store'

interface QualityStepProps {
  onComplete: () => void
  onSkip: () => void
  onBack: () => void
}

export function QualityStep({ onComplete, onSkip, onBack }: QualityStepProps) {
  const { settings, setSettings } = useAppStore()
  const [localSettings, setLocalSettings] = useState<{
    pollIntervalMs: number
    autoDownloadQuality: string
    defaultTrimLimit: number | 'full'
    defaultQuality: 1080 | 720
    autoDownloadEnabled: boolean
    autoRender: boolean
  }>({
    pollIntervalMs: (settings.pollIntervalMs || 5000) as number,
    autoDownloadQuality: (settings.autoDownloadQuality || '720') as string,
    defaultTrimLimit: (settings.defaultTrimLimit === 'full' ? 'full' : ((settings.defaultTrimLimit as number) || 10)) as number | 'full',
    defaultQuality: ((settings.defaultQuality as 1080 | 720) || 1080) as 1080 | 720,
    autoDownloadEnabled: settings.autoDownloadEnabled !== false,
    autoRender: settings.autoRender || false,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ipc.getSettings().then((s: any) => {
      if (s) setLocalSettings({
        pollIntervalMs: s.pollIntervalMs || 5000,
        autoDownloadQuality: s.autoDownloadQuality || '720',
        defaultTrimLimit: s.defaultTrimLimit || 10,
        defaultQuality: (s.defaultQuality as 1080 | 720) || 1080,
        autoDownloadEnabled: s.autoDownloadEnabled !== false,
        autoRender: s.autoRender || false,
      })
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await ipc.updateSettings({
        pollIntervalMs: localSettings.pollIntervalMs,
        autoDownloadQuality: localSettings.autoDownloadQuality,
        defaultTrimLimit: localSettings.defaultTrimLimit,
        defaultQuality: localSettings.defaultQuality,
        autoDownloadEnabled: localSettings.autoDownloadEnabled,
        autoRender: localSettings.autoRender,
      } as any)
      setSettings(localSettings as any)
      onComplete()
    } finally {
      setSaving(false)
    }
  }

  const pollOptions = [
    { value: 3000, label: '3 giây', desc: 'Nhanh nhất, tốn nhiều tài nguyên' },
    { value: 5000, label: '5 giây', desc: 'Cân bằng (khuyến nghị)' },
    { value: 10000, label: '10 giây', desc: 'Tiết kiệm tài nguyên' },
    { value: 30000, label: '30 giây', desc: 'Chậm, cho server yếu' },
  ]

  const qualityOptions = [
    { value: '360', label: '360p', desc: 'Tiết kiệm băng thông, nhanh' },
    { value: '480', label: '480p', desc: 'Cân bằng' },
    { value: '720', label: '720p', desc: 'Tốt cho Shorts (khuyến nghị)' },
    { value: '1080', label: '1080p', desc: 'Chất lượng cao, chậm hơn' },
  ]

  const renderQualityOptions: Array<{ value: 720 | 1080; label: string; desc: string }> = [
    { value: 720, label: '720p', desc: 'Nhanh, phù hợp Shorts' },
    { value: 1080, label: '1080p', desc: 'Chất lượng cao (khuyến nghị)' },
  ]

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Explanation */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 13, color: '#999', lineHeight: 1.7, margin: 0 }}>
          Cấu hình tốc độ detection và chất lượng download. Bạn có thể thay đổi sau trong Settings.
        </p>
      </div>

      {/* Detection Interval */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
          Tốc độ detection
        </div>
        <div style={{ fontSize: 11, color: '#777', marginBottom: 12 }}>
          HyperClip kiểm tra video mới mỗi bao lâu?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {pollOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setLocalSettings({ ...localSettings, pollIntervalMs: opt.value })}
              style={{
                padding: '10px 14px',
                background: localSettings.pollIntervalMs === opt.value ? '#00B4FF22' : colors.bg,
                border: `1px solid ${localSettings.pollIntervalMs === opt.value ? colors.accent : colors.borderHover}`,
                borderRadius: 8, textAlign: 'left', cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: localSettings.pollIntervalMs === opt.value ? colors.accent : colors.text, marginBottom: 2 }}>
                {opt.label}
              </div>
              <div style={{ fontSize: 10, color: '#777' }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Download Quality */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
          Chất lượng download
        </div>
        <div style={{ fontSize: 11, color: '#777', marginBottom: 12 }}>
          Chất lượng video source để edit/render
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {qualityOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setLocalSettings({ ...localSettings, autoDownloadQuality: opt.value })}
              style={{
                padding: '10px 14px',
                background: localSettings.autoDownloadQuality === opt.value ? '#00B4FF22' : colors.bg,
                border: `1px solid ${localSettings.autoDownloadQuality === opt.value ? colors.accent : colors.borderHover}`,
                borderRadius: 8, textAlign: 'left', cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: localSettings.autoDownloadQuality === opt.value ? colors.accent : colors.text, marginBottom: 2 }}>
                {opt.label}
              </div>
              <div style={{ fontSize: 10, color: '#777' }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Render Quality */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
          Chất lượng render
        </div>
        <div style={{ fontSize: 11, color: '#777', marginBottom: 12 }}>
          Output resolution cho video đã chỉnh sửa
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {renderQualityOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setLocalSettings({ ...localSettings, defaultQuality: opt.value })}
              style={{
                padding: '10px 14px',
                background: localSettings.defaultQuality === opt.value ? '#00B4FF22' : colors.bg,
                border: `1px solid ${localSettings.defaultQuality === opt.value ? colors.accent : colors.borderHover}`,
                borderRadius: 8, textAlign: 'left', cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: localSettings.defaultQuality === opt.value ? colors.accent : colors.text, marginBottom: 2 }}>
                {opt.label}
              </div>
              <div style={{ fontSize: 10, color: '#777' }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Auto render */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>Auto render</div>
            <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
              Tự động render video ngay sau khi download (dùng preset mặc định)
            </div>
          </div>
          <button
            onClick={() => setLocalSettings({ ...localSettings, autoRender: !localSettings.autoRender })}
            style={{
              width: 44, height: 24,
              background: localSettings.autoRender ? colors.accent : colors.borderHover,
              border: 'none', borderRadius: 12,
              cursor: 'pointer', position: 'relative',
              transition: 'background 0.2s',
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%',
              background: colors.text,
              position: 'absolute',
              top: 3, right: localSettings.autoRender ? 3 : 'unset',
              left: localSettings.autoRender ? 'unset' : 3,
              transition: 'all 0.2s',
            }} />
          </button>
        </div>
      </div>

      {/* Trim limit */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
          Giới hạn thời lượng video
        </div>
        <div style={{ fontSize: 11, color: '#777', marginBottom: 12 }}>
          Chỉ download video ngắn hơn giới hạn này (phút). 0 = không giới hạn.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="number"
            value={localSettings.defaultTrimLimit === 'full' ? 0 : localSettings.defaultTrimLimit}
            onChange={(e) => setLocalSettings({
              ...localSettings,
              defaultTrimLimit: Number(e.target.value) || 0,
            })}
            min={0} max={60}
            style={{
              width: 80, height: 36,
              background: colors.bg, border: '1px solid #D0D0D0',
              borderRadius: 6, padding: '0 12px',
              fontSize: 13, fontWeight: 600, color: colors.text, outline: 'none',
              textAlign: 'center',
            }}
          />
          <span style={{ fontSize: 12, color: '#777' }}>phút (0 = không giới hạn)</span>
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
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onSkip}
            style={{
              height: 40, padding: '0 20px',
              background: 'transparent', border: '1px solid #D0D0D0',
              borderRadius: 8, fontSize: 12, fontWeight: 600,
              color: '#777', cursor: 'pointer',
            }}
          >
            Dùng mặc định
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              height: 40, padding: '0 24px',
              background: saving ? '#005577' : colors.accent,
              border: 'none',
              borderRadius: 8, fontSize: 12, fontWeight: 700,
              color: colors.text, cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Đang lưu...' : 'Lưu & Tiếp tục →'}
          </button>
        </div>
      </div>
    </div>
  )
}
