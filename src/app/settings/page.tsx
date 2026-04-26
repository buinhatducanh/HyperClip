'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAppStore } from '../lib/store'
import { ipc } from '../lib/ipc'

export const dynamic = 'force-dynamic'

const DEFAULT_CLIENT_ID = 'REMOVED_CLIENT_ID'

export default function SettingsPage() {
  const { settings, showToast, systemStats } = useAppStore()

  // OAuth credentials state
  const [oauthClientId, setOauthClientId] = useState(DEFAULT_CLIENT_ID)
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [oauthSaving, setOauthSaving] = useState(false)

  useEffect(() => {
    ipc.getOAuthCredentials().then(creds => {
      if (creds.clientId) setOauthClientId(creds.clientId)
      if (creds.clientSecret) setOauthClientSecret(creds.clientSecret)
    })
  }, [])

  const saveOAuthCredentials = async () => {
    if (!oauthClientId.trim() || !oauthClientSecret.trim()) {
      showToast('Cần điền đủ Client ID và Client Secret')
      return
    }
    setOauthSaving(true)
    try {
      await ipc.setOAuthCredentials(oauthClientId.trim(), oauthClientSecret.trim())
      showToast('Đã lưu OAuth credentials')
    } finally {
      setOauthSaving(false)
    }
  }

  return (
    <div
      style={{ height: '100vh', background: '#0E0E0E', fontFamily: 'Inter, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header */}
      <div
        style={{
          height: 48,
          background: '#0D0D0D',
          borderBottom: '1px solid #1E1E1E',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 20,
          gap: 24,
          flexShrink: 0,
        }}
      >
        <Link href="/" style={{ fontSize: 10, color: '#444', textDecoration: 'none', fontWeight: 600, letterSpacing: '0.08em' }}>
          ← BACK
        </Link>
        <div style={{ width: 1, height: 12, background: '#222' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>SETTINGS</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 20px', maxWidth: 640 }}>
        {/* Output Folder */}
        <SettingsSection title="OUTPUT">
          <SettingsRow label="Output Folder">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                value={settings.outputFolder}
                readOnly
                style={{
                  flex: 1,
                  height: 30,
                  background: '#1A1A1A',
                  border: '1px solid #222',
                  borderRadius: 3,
                  paddingLeft: 8,
                  paddingRight: 8,
                  fontSize: 11,
                  color: '#888',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => ipc.openFolder(settings.outputFolder)}
                style={{
                  height: 30,
                  paddingLeft: 10,
                  paddingRight: 10,
                  background: '#1A1A1A',
                  border: '1px solid #222',
                  borderRadius: 3,
                  fontSize: 9,
                  fontWeight: 600,
                  color: '#555',
                  cursor: 'pointer',
                }}
              >
                OPEN
              </button>
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* Default Trim */}
        <SettingsSection title="DOWNLOAD">
          <SettingsRow label="Default Trim Limit">
            <div style={{ display: 'flex', gap: 6 }}>
              {(['5min', '10min', 'full'] as const).map((t) => {
                const isActive = settings.defaultTrimLimit === t
                return (
                  <button
                    key={t}
                    onClick={() => showToast(`Default trim: ${t}`)}
                    style={{
                      height: 28,
                      paddingLeft: 10,
                      paddingRight: 10,
                      background: isActive ? '#00B4FF' : '#1A1A1A',
                      border: '1px solid',
                      borderColor: isActive ? '#00B4FF' : '#222',
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 700,
                      color: isActive ? '#000' : '#444',
                      cursor: 'pointer',
                    }}
                  >
                    {t === '5min' ? '5 MIN' : t === '10min' ? '10 MIN' : 'FULL'}
                  </button>
                )
              })}
            </div>
          </SettingsRow>

          <SettingsRow label="Default Quality">
            <div style={{ display: 'flex', gap: 6 }}>
              {([1080, 720, 360] as const).map((q) => {
                const isActive = settings.defaultQuality === q
                return (
                  <button
                    key={q}
                    onClick={() => showToast(`Default quality: ${q}p`)}
                    style={{
                      height: 28,
                      paddingLeft: 10,
                      paddingRight: 10,
                      background: isActive ? '#00B4FF' : '#1A1A1A',
                      border: '1px solid',
                      borderColor: isActive ? '#00B4FF' : '#222',
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 700,
                      color: isActive ? '#000' : '#444',
                      cursor: 'pointer',
                    }}
                  >
                    {q}P
                  </button>
                )
              })}
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* OAuth Credentials */}
        <SettingsSection title="YOUTUBE OAUTH">
          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, color: '#555', lineHeight: '15px', marginBottom: 4 }}>
              Client Secret cần thiết để exchange authorization code thành tokens. Lấy từ{' '}
              <span style={{ color: '#00B4FF' }}>Google Cloud Console → APIs & Services → Credentials</span>
            </div>
            <SettingsRow label="Client ID">
              <input
                type="text"
                value={oauthClientId}
                onChange={e => setOauthClientId(e.target.value)}
                style={{
                  flex: 1,
                  height: 30,
                  background: '#1A1A1A',
                  border: '1px solid #222',
                  borderRadius: 3,
                  paddingLeft: 8,
                  fontSize: 11,
                  color: '#888',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
            </SettingsRow>
            <SettingsRow label="Client Secret">
              <input
                type="password"
                value={oauthClientSecret}
                onChange={e => setOauthClientSecret(e.target.value)}
                placeholder="G4e... (bắt đầu bằng G)"
                style={{
                  flex: 1,
                  height: 30,
                  background: '#1A1A1A',
                  border: '1px solid #222',
                  borderRadius: 3,
                  paddingLeft: 8,
                  fontSize: 11,
                  color: '#888',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
            </SettingsRow>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={saveOAuthCredentials}
                disabled={oauthSaving}
                style={{
                  height: 30,
                  paddingLeft: 16,
                  paddingRight: 16,
                  background: '#00B4FF',
                  border: 'none',
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#000',
                  cursor: oauthSaving ? 'not-allowed' : 'pointer',
                  opacity: oauthSaving ? 0.6 : 1,
                }}
              >
                {oauthSaving ? 'SAVING...' : 'SAVE CREDENTIALS'}
              </button>
              <button
                onClick={async () => {
                  const { isReady } = await ipc.getAuthStatus()
                  if (isReady) {
                    showToast('Đã đăng nhập OAuth rồi!')
                  } else {
                    showToast('Đang mở trình duyệt đăng nhập...')
                  }
                }}
                style={{
                  height: 30,
                  paddingLeft: 16,
                  paddingRight: 16,
                  background: '#FF0000',
                  border: 'none',
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                LOGIN YOUTUBE
              </button>
            </div>
          </div>
        </SettingsSection>

        {/* System */}
        <SettingsSection title="SYSTEM">
          <SettingsRow label="RAM Disk">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: 1, background: '#FFB800' }} />
                <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>64GB DDR5</span>
              </div>
              <span style={{ fontSize: 9, color: '#2A2A2A' }}>Mount at R:\hyperclip</span>
            </div>
          </SettingsRow>

          <SettingsRow label="CPU">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: 1, background: '#00B4FF' }} />
              <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>{(systemStats as any).cpuName ?? '—'} · {(systemStats as any).cpuCores ?? '—'} cores</span>
            </div>
          </SettingsRow>

          <SettingsRow label="GPU Encoding">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: 1, background: '#00FF88' }} />
              <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>{(systemStats as any).gpuEncoder?.toUpperCase() ?? 'NVENC'} ({(systemStats as any).gpuName ?? '—'})</span>
            </div>
          </SettingsRow>

          <SettingsRow label="Minimize to Tray">
            <ToggleSwitch active={settings.minimizeToTray} onChange={() => showToast('Tray setting updated')} />
          </SettingsRow>
        </SettingsSection>

        {/* Speed */}
        <SettingsSection title="SPEED OPTIMIZATION">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Direct IP Binding', desc: 'Bypass VPN for yt-dlp/ffmpeg', active: true },
              { label: 'RAM Disk Storage', desc: '64GB temp video storage (~10GB/s)', active: true },
              { label: 'Static Blur Cache', desc: 'Blur background generated once, reused', active: true },
              { label: 'NVENC Hardware Encode', desc: 'Hardware-accelerated video encoding', active: true },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: '#141414',
                  borderRadius: 3,
                  border: '1px solid #1A1A1A',
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: 1, background: '#00FF88', boxShadow: '0 0 6px #00FF8866', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#ccc', fontWeight: 500 }}>{item.label}</div>
                  <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>{item.desc}</div>
                </div>
                <span style={{ fontSize: 8, fontWeight: 700, color: '#00FF8866', letterSpacing: '0.08em' }}>ACTIVE</span>
              </div>
            ))}
          </div>
        </SettingsSection>

        {/* About */}
        <SettingsSection title="ABOUT">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 11, color: '#555' }}>
              <span style={{ color: '#00B4FF', fontWeight: 700 }}>HyperClip</span> v0.1.0
            </div>
            <div style={{ fontSize: 9, color: '#2A2A2A', fontFamily: 'monospace' }}>
              Electron + Next.js + FFmpeg + NVENC
            </div>
            <div style={{ fontSize: 9, color: '#2A2A2A', marginTop: 4 }}>
              Hardware: Intel Core Ultra 9 285K · RTX 5080 16GB · 64GB DDR5
            </div>
          </div>
        </SettingsSection>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A1A1A; border-radius: 2px; }
      `}</style>
    </div>
  )
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: '#333', letterSpacing: '0.15em', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ background: '#0F0F0F', border: '1px solid #181818', borderRadius: 4, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid #181818',
        gap: 16,
      }}
    >
      <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, maxWidth: 300 }}>{children}</div>
    </div>
  )
}

function ToggleSwitch({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      style={{
        width: 36,
        height: 20,
        background: active ? '#00B4FF' : '#1A1A1A',
        border: '1px solid',
        borderColor: active ? '#00B4FF' : '#222',
        borderRadius: 10,
        cursor: 'pointer',
        position: 'relative',
        transition: 'all 0.2s',
        padding: 0,
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: 2,
          left: active ? 18 : 2,
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  )
}