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
    ipc.deleteWorkspace(id).then((result) => {
      const r = result as { bytesFreed?: number; filesDeleted?: number } | null
      if (r && r.bytesFreed && r.bytesFreed > 0) {
        const freedMB = (r.bytesFreed / 1024 / 1024).toFixed(1)
        showToast(`Đã xóa (${r.filesDeleted} files, ${freedMB} MB freed)`)
      } else {
        showToast('Workspace removed')
      }
    }).catch(() => {
      showToast('Workspace removed (file cleanup failed)')
    })
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
    done: '#999444',
  }

  return (
    <div
      style={{ height: '100vh', background: '#F5F5F5', fontFamily: 'Inter, sans-serif', color: '#1A1A1A', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header */}
      <div
        style={{
          height: 48,
          background: '#F5F5F5',
          borderBottom: '1px solid #E0E0E0',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 20,
          paddingRight: 20,
          gap: 24,
          flexShrink: 0,
        }}
      >
        <Link href="/" style={{ fontSize: 10, color: '#999', textDecoration: 'none', fontWeight: 600, letterSpacing: '0.08em' }}>
          ← BACK
        </Link>
        <div style={{ width: 1, height: 12, background: '#777' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1A1A1A', letterSpacing: '0.06em' }}>WORKSPACES</span>
        <span style={{ fontSize: 9, color: '#999', fontFamily: 'monospace' }}>{workspaces.length} total</span>
      </div>

      {/* Toolbar */}
      <div
        style={{
          height: 40,
          background: '#F5F5F5',
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
              color: filter === f ? '#00B4FF' : '#999',
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
            <span style={{ fontSize: 11, color: '#999' }}>No workspaces</span>
            <Link href="/" style={{ fontSize: 10, color: '#00B4FF', textDecoration: 'none' }}>
              Go to Dashboard →
            </Link>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1A1A1A' }}>
                {['TITLE', 'CHANNEL', 'STATUS', 'SIZE', 'DURATION', 'ACTIONS'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 8, fontWeight: 700, color: '#999', letterSpacing: '0.1em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ws) => (
                <tr
                  key={ws.id}
                  style={{ borderBottom: '1px solid #FFFFFF', transition: 'background 0.1s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#FFFFFF' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {/* Title */}
                  <td style={{ padding: '10px 12px', maxWidth: 320 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img
                        src={ws.thumbnail || 'https://via.placeholder.com/56x32/111/333'}
                        alt=""
                        style={{ width: 56, height: 32, borderRadius: 3, objectFit: 'cover', flexShrink: 0, border: '1px solid #777' }}
                      />
                      <span style={{ fontSize: 11, color: '#999', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {ws.videoTitle}
                      </span>
                    </div>
                  </td>

                  {/* Channel */}
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: 1, background: ws.channelColor }} />
                      <span style={{ fontSize: 10, color: '#777' }}>{ws.channelName}</span>
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
                    <span style={{ fontSize: 10, color: '#999', fontFamily: 'monospace' }}>{ws.fileSize}</span>
                  </td>

                  {/* Duration */}
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, color: '#999', fontFamily: 'monospace' }}>{ws.duration}</span>
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
        ::-webkit-scrollbar-thumb { background: #E0E0E0; border-radius: 2px; }
      `}</style>
    </div>
  )
}