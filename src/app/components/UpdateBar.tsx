'use client'

import { useState, useEffect } from 'react'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../lib/store'

export function UpdateBar() {
  const update = useAppStore(s => s.update)
  const setUpdate = useAppStore(s => s.setUpdate)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    // Listen for update events from main process
    const unsub = ipc.onUpdateEvent((event) => {
      if (event.type === 'available') {
        setUpdate({ ...update, available: true, version: event.version })
      } else if (event.type === 'progress') {
        setUpdate({ ...update, progress: event.percent ?? 0, downloading: true })
      } else if (event.type === 'downloaded') {
        setUpdate({ ...update, progress: 100, downloading: false, ready: true, version: event.version })
      }
    })
    return unsub
  }, [update, setUpdate])

  // Poll update status on mount
  useEffect(() => {
    ipc.getUpdateStatus().then(status => {
      setUpdate({ ...status })
    })
  }, [setUpdate])

  if (!update.available) return null

  async function handleDownload() {
    setDownloading(true)
    setUpdate({ ...update, downloading: true })
    await ipc.downloadUpdate()
  }

  function handleInstall() {
    ipc.installUpdate()
  }

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16,
      background: '#FFFFFF', border: '1px solid #E0E0E0',
      borderRadius: 12, padding: '12px 16px',
      minWidth: 280, maxWidth: 360,
      boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      fontFamily: 'Inter, system-ui, sans-serif',
      zIndex: 9999,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: '#00FF88',
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>
          Cập nhật mới
        </span>
        {update.version && (
          <span style={{
            fontSize: 11, color: '#00B4FF', background: 'rgba(0,180,255,0.1)',
            padding: '2px 6px', borderRadius: 4,
          }}>
            v{update.version}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {update.downloading && (
        <div style={{ marginBottom: 8 }}>
          <div style={{
            height: 4, background: '#E0E0E0', borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', background: '#00B4FF', borderRadius: 2,
              width: `${update.progress}%`, transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 4, textAlign: 'right' }}>
            {update.progress}% đã tải
          </div>
        </div>
      )}

      {/* Ready to install */}
      {update.ready && (
        <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>
          Đã tải xong. Khởi động lại để cập nhật.
        </p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        {!update.downloading && !update.ready && (
          <button
            onClick={handleDownload}
            style={{
              flex: 1, padding: '8px 16px',
              background: '#00B4FF', border: 'none', borderRadius: 6,
              fontSize: 13, fontWeight: 600, color: '#FFFFFF', cursor: 'pointer',
            }}
          >
            Tải cập nhật
          </button>
        )}
        {update.ready && (
          <button
            onClick={handleInstall}
            style={{
              flex: 1, padding: '8px 16px',
              background: '#00FF88', border: 'none', borderRadius: 6,
              fontSize: 13, fontWeight: 600, color: '#FFFFFF', cursor: 'pointer',
            }}
          >
            Khởi động lại ngay
          </button>
        )}
      </div>
    </div>
  )
}
