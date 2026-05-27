import { colors, spacing, fontSize } from '../../design-system/tokens'
'use client'

import { useState, useEffect, useRef } from 'react'
import { ipc } from '../../lib/ipc'
import { useAppStore } from '../../lib/store'

// ─── URL helpers ───────────────────────────────────────────────────────────────

function normalizeUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (t.startsWith('http')) return t
  if (t.startsWith('@')) return `https://www.youtube.com/${t}`
  if (t.startsWith('/')) return `https://www.youtube.com${t}`
  return `https://www.youtube.com/${t}`
}

function isYouTubeChannelUrl(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  if (/^@[\w.-]{1,39}$/.test(t)) return true
  try {
    const url = new URL(normalizeUrl(t))
    if (!['youtube.com', 'www.youtube.com', 'youtu.be'].includes(url.hostname)) return false
    const p = url.pathname
    return /^\/(channel\/UC[\w-]+|@[\w.-]{1,39}|c\/[\w.-]+|user\/[\w.-]+|[\w.-]+)$/.test(p)
  } catch {
    return false
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ChannelsStepProps {
  onComplete: () => void
  onSkip: () => void
  onBack: () => void
}

export function ChannelsStep({ onComplete, onSkip, onBack }: ChannelsStepProps) {
  const { channels, addChannel, removeChannel } = useAppStore()
  const [inputUrl, setInputUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')
  const [bulkUrls, setBulkUrls] = useState('')
  const [bulkAdding, setBulkAdding] = useState(false)
  const [bulkResults, setBulkResults] = useState<Array<{ url: string; success: boolean; error?: string }>>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Load channels on mount
  useEffect(() => {
    useAppStore.getState().initChannels()
  }, [])

  // Optional preview — just fetches and shows channel info
  const handlePreview = async () => {
    const raw = inputUrl.trim()
    if (!raw) return
    setLoading(true)
    setAddError('')
    try {
      await ipc.getChannelInfo(raw)
    } catch {}
    setLoading(false)
  }

  // Add single channel — validates, checks duplicates, shows feedback
  const handleAdd = async () => {
    const raw = inputUrl.trim()
    if (!raw) return

    if (!isYouTubeChannelUrl(raw)) {
      setAddError('URL không hợp lệ. Dùng @handle, /channel/UC..., /c/..., hoặc /user/...')
      return
    }

    const existing = useAppStore.getState().channels
    const norm = normalizeUrl(raw).toLowerCase()
    const isDupe = existing.some((ch) => {
      if (ch.channelId && raw.includes(ch.channelId)) return true
      if (ch.handle && norm.includes(ch.handle.toLowerCase())) return true
      return false
    })
    if (isDupe) {
      setAddError('Kênh này đã được thêm rồi.')
      return
    }

    setAddError('')
    setAddSuccess('')
    setAdding(true)
    try {
      await addChannel(raw)
      setInputUrl('')
      setAddSuccess('Đã thêm kênh!')
      setTimeout(() => setAddSuccess(''), 3000)
      inputRef.current?.focus()
    } catch {
      setAddError('Lỗi khi thêm kênh. Thử lại.')
    } finally {
      setAdding(false)
    }
  }

  // Bulk add — validates each URL, checks duplicates, adds one by one
  const handleBulkAdd = async () => {
    const urls = bulkUrls.split('\n').map(u => u.trim()).filter(Boolean)
    if (!urls.length) return
    const existing = useAppStore.getState().channels
    const results: Array<{ url: string; success: boolean; error?: string }> = []

    setBulkAdding(true)
    setBulkResults([])

    for (const url of urls) {
      if (!isYouTubeChannelUrl(url)) {
        results.push({ url, success: false, error: 'URL không hợp lệ' })
        continue
      }
      const norm = normalizeUrl(url).toLowerCase()
      const isDupe = existing.some((ch) => {
        if (ch.channelId && url.includes(ch.channelId)) return true
        if (ch.handle && norm.includes(ch.handle.toLowerCase())) return true
        return false
      })
      if (isDupe) {
        results.push({ url, success: false, error: 'Đã tồn tại' })
        continue
      }
      try {
        const added = await ipc.addChannel(url) as any
        if (added) {
          // Update local state immediately
          useAppStore.setState((s) => ({ channels: [...s.channels, added] }))
          results.push({ url, success: true })
        } else {
          results.push({ url, success: false, error: 'Thêm thất bại' })
        }
      } catch {
        results.push({ url, success: false, error: 'Lỗi' })
      }
    }

    setBulkResults(results)
    setBulkAdding(false)
    if (results.every(r => r.success)) setBulkUrls('')
  }

  const handleRemove = async (id: string) => {
    await removeChannel(id)
  }

  const canProceed = channels.length > 0

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Tab: single channel */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid #1A1A1A' }}>
        <button
          style={{
            padding: '8px 16px', background: 'transparent', border: 'none',
            borderBottom: '2px solid #00B4FF', fontSize: 12, fontWeight: 600,
            color: colors.text, cursor: 'pointer',
          }}
        >
          Thêm từng kênh
        </button>
      </div>

      {/* Single channel input */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#777', marginBottom: 8 }}>
          Nhập URL kênh YouTube — @handle, /channel/UC..., /c/..., hoặc /user/...
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            ref={inputRef}
            value={inputUrl}
            onChange={(e) => { setInputUrl(e.target.value); setAddError(''); setAddSuccess('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder="youtube.com/@channel hoặc @handle"
            style={{
              flex: 1, height: 40,
              background: colors.bg,
              border: addError ? '1px solid #FF4444' : '1px solid #D0D0D0',
              borderRadius: 8, padding: '0 14px',
              fontSize: 12, color: colors.text, outline: 'none',
            }}
          />
          <button
            onClick={handlePreview}
            disabled={loading || !inputUrl.trim()}
            title="Xem thông tin kênh"
            style={{
              height: 40, padding: '0 14px',
              background: colors.text, border: '1px solid #D0D0D0',
              borderRadius: 8, fontSize: 11, fontWeight: 600,
              color: loading || !inputUrl.trim() ? '#999' : '#999',
              cursor: loading || !inputUrl.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '…' : 'Xem trước'}
          </button>
          <button
            onClick={handleAdd}
            disabled={adding || !inputUrl.trim()}
            style={{
              height: 40, padding: '0 20px',
              background: adding ? '#005577' : colors.accent,
              border: 'none', borderRadius: 8,
              fontSize: 12, fontWeight: 700,
              color: colors.text, cursor: adding || !inputUrl.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {adding ? 'Đang thêm...' : 'Thêm kênh'}
          </button>
        </div>

        {addError && (
          <div style={{
            background: '#FF444415', border: '1px solid #FF444433',
            borderRadius: 8, padding: '8px 12px',
            fontSize: 11, color: '#FF6B6B',
          }}>
            {addError}
          </div>
        )}
        {addSuccess && (
          <div style={{
            background: '#00FF8815', border: '1px solid #00FF8844',
            borderRadius: 8, padding: '8px 12px',
            fontSize: 11, color: colors.success,
          }}>
            {addSuccess}
          </div>
        )}
      </div>

      {/* Bulk add */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: '#777', marginBottom: 8 }}>
          Thêm nhiều kênh cùng lúc (mỗi URL một dòng)
        </div>
        <textarea
          value={bulkUrls}
          onChange={(e) => setBulkUrls(e.target.value)}
          placeholder={'youtube.com/@channel1\nyoutube.com/@channel2\n@handle3'}
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: colors.bg, border: '1px solid #D0D0D0',
            borderRadius: 8, padding: '10px 14px',
            fontSize: 11, fontFamily: 'monospace', color: colors.text,
            outline: 'none', resize: 'vertical', marginBottom: 8,
          }}
        />
        <button
          onClick={handleBulkAdd}
          disabled={bulkAdding || !bulkUrls.trim()}
          style={{
            padding: '8px 20px',
            background: bulkAdding ? '#005577' : colors.text,
            border: '1px solid #D0D0D0',
            borderRadius: 8, fontSize: 12, fontWeight: 600,
            color: bulkAdding || !bulkUrls.trim() ? '#999' : colors.text,
            cursor: bulkAdding || !bulkUrls.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {bulkAdding ? 'Đang thêm...' : 'Thêm tất cả'}
        </button>

        {bulkResults.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {bulkResults.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11 }}>
                <span style={{ color: r.success ? colors.success : '#FF6B6B', width: 14 }}>
                  {r.success ? '✓' : '✗'}
                </span>
                <span style={{ color: '#999', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.url}
                </span>
                {r.error && <span style={{ color: '#FF6B6B', fontSize: 10 }}>{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Channel list */}
      {channels.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: '#777', marginBottom: 8 }}>
            Đã thêm ({channels.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {channels.map((ch) => (
              <div
                key={ch.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: colors.bg, border: '1px solid #1A1A1A',
                  borderRadius: 8, padding: '8px 12px',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: ch.avatarColor || '#999',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: colors.text, flexShrink: 0,
                }}>
                  {ch.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ch.name}
                  </div>
                  {ch.handle && (
                    <div style={{ fontSize: 10, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ch.handle}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(ch.id)}
                  style={{
                    background: 'transparent', border: 'none',
                    color: '#777', cursor: 'pointer', fontSize: 16,
                    padding: '0 4px', lineHeight: 1,
                  }}
                  title="Xóa kênh"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <button
          onClick={onBack}
          style={{ background: 'transparent', border: 'none', fontSize: 11, color: '#777', cursor: 'pointer' }}
        >
          ← Quay lại
        </button>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onSkip}
            style={{ background: 'transparent', border: 'none', fontSize: 11, color: '#777', cursor: 'pointer' }}
          >
            Bỏ qua bước này
          </button>
          <button
            onClick={onComplete}
            disabled={!canProceed}
            style={{
              padding: '8px 24px',
              background: canProceed ? colors.accent : colors.text,
              border: 'none', borderRadius: 8,
              fontSize: 12, fontWeight: 700,
              color: canProceed ? '#000' : '#999',
              cursor: canProceed ? 'pointer' : 'not-allowed',
            }}
          >
            Tiếp tục →
          </button>
        </div>
      </div>
    </div>
  )
}
