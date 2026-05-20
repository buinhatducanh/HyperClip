'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAppStore, type Workspace } from '../lib/store'
import { ipc } from '../lib/ipc'

export const dynamic = 'force-dynamic'

export default function WorkspacesPage() {
  const { workspaces, removeWorkspace, showToast, updateWorkspace } = useAppStore()
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all')

  const filtered = workspaces.filter(w => {
    if (filter === 'active') return !['done'].includes(w.status)
    if (filter === 'done') return w.status === 'done'
    return true
  })

  const handleDelete = async (id: string) => {
    removeWorkspace(id)
    showToast('Workspace removed')
  }

  const handleOpenOutput = async (ws: Workspace) => {
    const outputPath = (ws as any).outputPath
    if (outputPath) {
      await ipc.openFolder(outputPath)
    }
  }

  const statusColor: Record<string, string> = {
    waiting: '#FFB800',
    downloading: '#00B4FF',
    ready: '#00FF88',
    editing: '#7C3AED',
    rendering: '#FF4444',
    done: '#444444',
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
          paddingRight: 20,
          gap: 24,
          flexShrink: 0,
        }}
      >
        <Link href="/" style={{ fontSize: 10, color: '#444', textDecoration: 'none', fontWeight: 600, letterSpacing: '0.08em' }}>
          ← BACK
        </Link>
        <div style={{ width: 1, height: 12, background: '#222' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>WORKSPACES</span>
        <span style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>{workspaces.length} total</span>
      </div>

      {/* Toolbar */}
      <div
        style={{
          height: 40,
          background: '#121212',
          borderBottom: '1px solid #1A1A1A',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 20,
          gap: 16,
          flexShrink: 0,
        }}
      >
        {(['all', 'active', 'done'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              height: 26,
              paddingLeft: 10,
              paddingRight: 10,
              background: filter === f ? '#00B4FF15' : 'transparent',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: filter === f ? '#00B4FF44' : 'transparent',
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 700,
              color: filter === f ? '#00B4FF' : '#444',
              cursor: 'pointer',
              letterSpacing: '0.06em',
            }}
          >
            {f.toUpperCase()}
          </button>
        ))}

        {/* Status counts */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          {(['waiting', 'downloading', 'ready', 'rendering', 'done'] as const).map((s) => {
            const count = workspaces.filter(w => w.status === s).length
            if (!count) return null
            return (
              <span key={s} style={{ fontSize: 9, color: statusColor[s], fontFamily: 'monospace' }}>
                {s.toUpperCase()}: {count}
              </span>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#333' }}>No workspaces</span>
            <Link href="/" style={{ fontSize: 10, color: '#00B4FF', textDecoration: 'none' }}>
              Go to Dashboard →
            </Link>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1A1A1A' }}>
                {['TITLE', 'CHANNEL', 'STATUS', 'SIZE', 'DURATION', 'ACTIONS'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 8, fontWeight: 700, color: '#333', letterSpacing: '0.1em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ws) => (
                <tr
                  key={ws.id}
                  style={{ borderBottom: '1px solid #161616', transition: 'background 0.1s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#141414' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {/* Title */}
                  <td style={{ padding: '10px 12px', maxWidth: 320 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img
                        src={ws.thumbnail || 'https://via.placeholder.com/56x32/111/333'}
                        alt=""
                        style={{ width: 56, height: 32, borderRadius: 3, objectFit: 'cover', flexShrink: 0, border: '1px solid #222' }}
                      />
                      <span style={{ fontSize: 11, color: '#ccc', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {ws.videoTitle}
                      </span>
                    </div>
                  </td>

                  {/* Channel */}
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: 1, background: ws.channelColor }} />
                      <span style={{ fontSize: 10, color: '#555' }}>{ws.channelName}</span>
                    </div>
                  </td>

                  {/* Status */}
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 800,
                        color: statusColor[ws.status],
                        background: statusColor[ws.status] + '15',
                        border: `1px solid ${statusColor[ws.status]}22`,
                        borderRadius: 2,
                        padding: '2px 6px',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {ws.renderProgress !== undefined && ws.status === 'rendering'
                        ? `${ws.renderProgress}%`
                        : ws.status.toUpperCase()}
                    </span>
                  </td>

                  {/* Size */}
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, color: '#444', fontFamily: 'monospace' }}>{ws.fileSize}</span>
                  </td>

                  {/* Duration */}
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, color: '#444', fontFamily: 'monospace' }}>{ws.duration}</span>
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {ws.status === 'done' && (
                        <button
                          onClick={() => handleOpenOutput(ws)}
                          style={{
                            fontSize: 9,
                            fontWeight: 600,
                            color: '#00FF88',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          OPEN
                        </button>
                      )}
                      <Link
                        href="/"
                        onClick={() => {}}
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: '#00B4FF',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'none',
                        }}
                      >
                        EDIT
                      </Link>
                      <button
                        onClick={() => handleDelete(ws.id)}
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: '#553333',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        DEL
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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