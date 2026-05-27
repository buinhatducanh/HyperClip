'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { ipc } from '../../lib/ipc'

interface UpdateInfo {
  available: boolean
  version: string
  releaseNotes: string
  downloadSize: number
  publishedAt: string
}

interface UpdateStatus {
  available: boolean
  version: string
  releaseNotes: string
  downloadSize: number
  progress: number
  downloaded: boolean
  downloadedPath: string | null
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function UpdateSection() {
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [currentVersion, setCurrentVersion] = useState('...')

  // Load current version
  useEffect(() => {
    void ipc.getAppVersion().then(v => setCurrentVersion(v))
  }, [])

  // Load initial status
  useEffect(() => {
    void ipc.getUpdateStatus().then((status: unknown) => {
      const s = status as UpdateStatus
      if (s.downloaded) {
        setDownloaded(true)
        setUpdateInfo(s.available ? { available: true, version: s.version, releaseNotes: s.releaseNotes, downloadSize: s.downloadSize, publishedAt: '' } : null)
      }
    })
  }, [])

  // Listen for update events
  useEffect(() => {
    const cleanup = ipc.onUpdateEvent((event) => {
      if (event.type === 'checking') {
        setChecking(true)
        setError(null)
      }
      if (event.type === 'not-available') {
        setChecking(false)
      }
      if (event.type === 'available') {
        setChecking(false)
        setUpdateInfo({
          available: true,
          version: event.version || '',
          releaseNotes: event.releaseNotes || '',
          downloadSize: event.downloadSize || 0,
          publishedAt: event.publishedAt || '',
        })
      }
      if (event.type === 'progress') {
        setProgress(event.percent ?? 0)
      }
      if (event.type === 'downloaded') {
        setDownloading(false)
        setDownloaded(true)
        setProgress(100)
      }
      if (event.type === 'error') {
        setChecking(false)
        setDownloading(false)
        setError(event.message || 'Lỗi không xác định')
      }
    })
    return cleanup
  }, [])

  const handleCheck = useCallback(async () => {
    setChecking(true)
    setError(null)
    setUpdateInfo(null)
    try {
      const result = await ipc.checkForUpdate()
      if (!result.available) {
        setUpdateInfo(null)
      } else {
        setUpdateInfo(result as UpdateInfo)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setChecking(false)
    }
  }, [])

  const handleDownload = useCallback(async () => {
    setDownloading(true)
    setProgress(0)
    setError(null)
    try {
      await ipc.downloadUpdate()
    } catch (e) {
      setError(String(e))
      setDownloading(false)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    setError(null)
    try {
      await ipc.installUpdate()
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const isUpdateAvailable = updateInfo?.available ?? false

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 0,
      padding: '24px 32px', maxWidth: 600,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#E0E0E0', letterSpacing: '0.1em', marginBottom: 6 }}>
          🔄 CẬP NHẬT
        </div>
        <div style={{ fontSize: 10, color: '#888' }}>
          Phiên bản hiện tại: <span style={{ color: '#777', fontFamily: 'monospace' }}>v{currentVersion}</span>
        </div>
      </div>

      {/* Check for updates */}
      <div style={{
        background: '#F5F5F5', border: '1px solid #E0E0E0',
        borderRadius: 8, padding: 20,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 2 }}>
              Kiểm tra cập nhật
            </div>
            <div style={{ fontSize: 9, color: '#888' }}>
              Tự động kiểm tra mỗi 6 giờ
            </div>
          </div>
          <button
            onClick={handleCheck}
            disabled={checking}
            style={{
              height: 32, paddingLeft: 16, paddingRight: 16,
              background: checking ? '#E0E0E0' : '#E0E0E0',
              border: `1px solid ${checking ? '#D0D0D0' : '#00FF8844'}`,
              borderRadius: 6, color: checking ? '#888' : '#00FF88',
              fontSize: 9, fontWeight: 700, cursor: checking ? 'not-allowed' : 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            {checking ? 'ĐANG KIỂM TRA...' : '🔍 KIỂM TRA'}
          </button>
        </div>

        {error && (
          <div style={{
            padding: '10px 12px', background: '#FF555510',
            border: '1px solid #FF555533', borderRadius: 6, marginBottom: 12,
          }}>
            <div style={{ fontSize: 9, color: '#FF5555', fontWeight: 700, marginBottom: 2 }}>LỖI</div>
            <div style={{ fontSize: 9, color: '#FF555588' }}>{error}</div>
          </div>
        )}

        {/* Update available */}
        {isUpdateAvailable && (
          <div style={{
            padding: '14px 16px', background: '#00FF8810',
            border: '1px solid #00FF8833', borderRadius: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 16 }}>🎉</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#00FF88' }}>
                  Có bản cập nhật: v{updateInfo?.version}
                </div>
                {updateInfo?.publishedAt && (
                  <div style={{ fontSize: 8, color: '#00FF8866', marginTop: 2 }}>
                    Phát hành: {formatDate(updateInfo.publishedAt)}
                  </div>
                )}
              </div>
            </div>

            {updateInfo?.releaseNotes && (
              <div style={{
                padding: '8px 10px', background: '#F0F0F0',
                borderRadius: 4, marginBottom: 12, maxHeight: 120, overflowY: 'auto',
              }}>
                <div style={{ fontSize: 8, color: '#888', fontFamily: 'monospace', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {updateInfo.releaseNotes}
                </div>
              </div>
            )}

            {/* Download progress bar */}
            {downloading && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 8, color: '#888' }}>Đang tải xuống...</span>
                  <span style={{ fontSize: 8, color: '#00FF88', fontFamily: 'monospace' }}>{progress}%</span>
                </div>
                <div style={{ height: 3, background: '#E0E0E0', borderRadius: 2 }}>
                  <div style={{
                    height: 3, background: '#00FF88', borderRadius: 2,
                    width: `${progress}%`, transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ fontSize: 8, color: '#D0D0D0', marginTop: 4 }}>
                  {updateInfo?.downloadSize ? `Kích thước: ${formatSize(updateInfo.downloadSize)}` : ''}
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!downloaded && !downloading && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                style={{
                  height: 32, paddingLeft: 16, paddingRight: 16,
                  background: '#00FF8822', border: '1px solid #00FF8866',
                  borderRadius: 6, color: '#00FF88',
                  fontSize: 9, fontWeight: 700, cursor: 'pointer',
                  letterSpacing: '0.05em', marginRight: 8,
                }}
              >
                ⬇ TẢI BẢN MỚI
              </button>
            )}

            {downloaded && !downloading && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleInstall}
                  style={{
                    height: 32, paddingLeft: 16, paddingRight: 16,
                    background: '#00FF88', border: 'none',
                    borderRadius: 6, color: '#000',
                    fontSize: 9, fontWeight: 700, cursor: 'pointer',
                    letterSpacing: '0.05em',
                  }}
                >
                  ▶ CÀI ĐẶT & KHỞI ĐỘNG LẠI
                </button>
                <div style={{ fontSize: 8, color: '#00FF8866', paddingTop: 8 }}>
                  Ứng dụng sẽ tắt, cập nhật, và khởi động lại tự động
                </div>
              </div>
            )}
          </div>
        )}

        {/* No update */}
        {!isUpdateAvailable && !checking && !error && (
          <div style={{
            padding: '10px 14px', background: '#F0F0F0',
            border: '1px solid #E0E0E0', borderRadius: 6,
          }}>
            <div style={{ fontSize: 9, color: '#888', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#00FF88' }}>✓</span>
              <span>Đã cài bản mới nhất (v{currentVersion})</span>
            </div>
          </div>
        )}
      </div>

      {/* Info box */}
      <div style={{
        padding: '12px 14px', background: '#F5F5F5',
        border: '1px solid #E0E0E0', borderRadius: 6,
        borderLeft: '3px solid #888',
      }}>
        <div style={{ fontSize: 8, fontWeight: 700, color: '#888', marginBottom: 6 }}>CÁCH HOẠT ĐỘNG</div>
        <div style={{ fontSize: 8, color: '#D0D0D0', lineHeight: 2 }}>
          1. Khi bạn push git tag mới (vd: <code style={{ color: '#777' }}>git tag v1.2.0 && git push origin v1.2.0</code>), CI sẽ build tự động<br />
          2. App của khách tự kiểm tra GitHub Releases mỗi 6 giờ<br />
          3. Khách nhấn "Tải bản mới" → "Cài đặt & khởi động lại"<br />
          4. App tải portable zip → extract → swap files → tự khởi động lại
        </div>
      </div>
    </div>
  )
}
