'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../lib/store'

const TYPE_META: Record<string, { icon: string; color: string; bg: string; border: string }> = {
  autodownload: { icon: '↓', color: '#00B4FF', bg: 'rgba(0,180,255,0.08)', border: 'rgba(0,180,255,0.2)' },
  success:      { icon: '✓', color: '#00FF88', bg: 'rgba(0,255,136,0.08)', border: 'rgba(0,255,136,0.2)' },
  info:         { icon: 'i', color: '#888',   bg: 'rgba(136,136,136,0.06)', border: 'rgba(136,136,136,0.2)' },
  warning:      { icon: '⚠', color: '#FFB800', bg: 'rgba(255,184,0,0.08)', border: 'rgba(255,184,0,0.2)' },
  error:        { icon: '✕', color: '#FF4444', bg: 'rgba(255,68,68,0.08)', border: 'rgba(255,68,68,0.2)' },
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s trước`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}p trước`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h trước`
  return `${Math.floor(h / 24)}d trước`
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { notifications, markRead, markAllRead, clearNotifications } = useAppStore()
  const unread = notifications.filter((n) => !n.read).length

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Sync btnRect on window resize / scroll
  useEffect(() => {
    if (!open) return
    function onResize() {
      if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect())
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  // Get button position for portal placement
  const btnRef = useRef<HTMLButtonElement>(null)
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null)

  const updateBtnRect = () => {
    if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect())
  }

  // Bell button
  const BellButton = (
    <button
      ref={btnRef}
      onClick={() => {
        if (open) {
          setOpen(false)
        } else {
          updateBtnRect()
          setOpen(true)
        }
      }}
      title="Notifications"
      style={{
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: open ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = open ? 'rgba(255,255,255,0.06)' : 'transparent')}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={open ? '#00B4FF' : '#555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unread > 0 && (
        <div style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#FF4444',
          border: '1px solid #121212',
        }} />
      )}
    </button>
  )

  // Dropdown via portal — rendered at body level so it's above all panels
  const Dropdown = open && btnRect ? createPortal(
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: btnRect.bottom + 6,
        left: Math.max(8, Math.min(btnRect.left, window.innerWidth - 336)),
        width: 320,
        background: '#181818',
        border: '1px solid #2a2a2a',
        borderRadius: 8,
        zIndex: 99999,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid #2a2a2a',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.1em' }}>
          NOTIFICATIONS {unread > 0 && <span style={{ color: '#FF4444' }}>({unread})</span>}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {notifications.length > 0 && (
            <>
              <button
                onClick={() => { markAllRead(); setOpen(false) }}
                style={{ fontSize: 9, color: '#555', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#00B4FF')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
              >
                Mark all read
              </button>
              <button
                onClick={clearNotifications}
                style={{ fontSize: 9, color: '#555', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#FF4444')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {notifications.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2a2a2a" strokeWidth="1.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <div style={{ fontSize: 11, color: '#333', marginTop: 8 }}>No notifications yet</div>
          </div>
        ) : (
          notifications.map((n) => {
            const meta = TYPE_META[n.type] || TYPE_META.info
            return (
              <div
                key={n.id}
                onClick={() => markRead(n.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #222',
                  background: n.read ? 'transparent' : meta.bg,
                  borderLeft: n.read ? '2px solid transparent' : `2px solid ${meta.border}`,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = n.read ? 'rgba(255,255,255,0.03)' : meta.bg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = n.read ? 'transparent' : meta.bg)}
              >
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: meta.bg,
                  border: `1px solid ${meta.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: meta.color,
                  flexShrink: 0,
                  marginTop: 1,
                }}>
                  {meta.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: n.read ? '#555' : '#ccc', lineHeight: 1.4, wordBreak: 'break-word' }}>
                    {n.message}
                  </div>
                  <div style={{ fontSize: 9, color: '#444', marginTop: 3 }}>
                    {relativeTime(n.timestamp)}
                  </div>
                </div>
                {!n.read && (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0, marginTop: 6 }} />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {BellButton}
      {Dropdown}
    </div>
  )
}
