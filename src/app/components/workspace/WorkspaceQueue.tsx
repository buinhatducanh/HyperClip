'use client'

import { useState, useMemo } from 'react'
import type { Workspace } from '../../lib/store'
import type { RenderedVideo } from '../../types'
import type { Channel } from '../../types'
import { WorkspaceCard } from './WorkspaceCard'
import { RenderedVideos } from '../RenderedVideos'

interface Props {
  workspaces: Workspace[]
  renderedVideos?: RenderedVideo[]
  channels?: Channel[]
  selectedId: string | null
  selectedRenderedId?: string | null
  onSelect: (id: string) => void
  onSelectRendered?: (id: string | null) => void
  onQuickAction?: (action: 'open' | 'delete', id: string) => void
  onRetry?: (id: string) => void
  onRemoveRendered?: (id: string) => void
  onShowToast?: (msg: string) => void
  onSplit?: (id: string, partMinutes: number) => void
  trimLimitMinutes?: number
}

type GroupStatus = 'ready' | 'rendering' | 'downloading' | 'waiting' | 'editing' | 'done'
type ActiveTab = 'pipeline' | 'rendered'

const STATUS_ORDER: GroupStatus[] = ['ready', 'rendering', 'downloading', 'waiting', 'editing', 'done']

const GROUP_CONFIG: Record<GroupStatus, { label: string; color: string; collapsible?: boolean }> = {
  ready:      { label: 'READY',      color: '#00FF88', collapsible: false },
  rendering:  { label: 'RENDERING',  color: '#FF4444', collapsible: false },
  downloading: { label: 'DOWNLOAD',  color: '#00B4FF', collapsible: false },
  waiting:    { label: 'WAITING',    color: '#FFB800', collapsible: false },
  editing:    { label: 'EDITING',    color: '#7C3AED', collapsible: false },
  done:       { label: 'DONE',       color: '#444444', collapsible: true },
}

function groupByStatus(workspaces: Workspace[]): Map<GroupStatus, Workspace[]> {
  const groups = new Map<GroupStatus, Workspace[]>()
  for (const status of STATUS_ORDER) {
    groups.set(status, [])
  }
  for (const ws of workspaces) {
    const status = ws.status as GroupStatus
    if (groups.has(status)) {
      groups.get(status)!.push(ws)
    }
  }
  return groups
}

export function WorkspaceQueue({
  workspaces, renderedVideos = [], channels = [], selectedId, selectedRenderedId,
  onSelect, onSelectRendered, onQuickAction, onRetry, onRemoveRendered, onShowToast, onSplit, trimLimitMinutes = 10,
}: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupStatus>>(new Set<GroupStatus>(['done']))
  const [activeTab, setActiveTab] = useState<ActiveTab>('pipeline')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<GroupStatus | 'all'>('all')
  const [filterChannel, setFilterChannel] = useState<string>('all')

  // Apply filters
  const filteredWorkspaces = useMemo(() => {
    let result = workspaces
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(w =>
        w.videoTitle?.toLowerCase().includes(q) ||
        w.channelName?.toLowerCase().includes(q)
      )
    }
    if (filterStatus !== 'all') {
      result = result.filter(w => w.status === filterStatus)
    }
    if (filterChannel !== 'all') {
      result = result.filter(w => w.channelId === filterChannel)
    }
    return result
  }, [workspaces, searchQuery, filterStatus, filterChannel])

  const groups = groupByStatus(filteredWorkspaces)

  const toggleGroup = (status: GroupStatus) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  // Count totals (from filtered list)
  const totalActive = filteredWorkspaces.filter(w =>
    ['ready', 'rendering', 'downloading', 'waiting', 'editing'].includes(w.status)
  ).length
  const totalDone = filteredWorkspaces.filter(w => w.status === 'done').length

  return (
    <div className="flex flex-col h-full" style={{ background: '#121212' }}>
      {/* Tab header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: '#0D0D0D',
          borderBottom: '1px solid #1E1E1E',
          flexShrink: 0,
        }}
      >
        {/* PIPELINE tab */}
        <button
          onClick={() => { setActiveTab('pipeline'); onSelectRendered?.(null) }}
          style={{
            flex: 1,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            background: activeTab === 'pipeline' ? '#121212' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'pipeline' ? '2px solid #00B4FF' : '2px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={activeTab === 'pipeline' ? '#00B4FF' : '#444'} strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            color: activeTab === 'pipeline' ? '#00B4FF' : '#444',
            letterSpacing: '0.1em',
          }}>
            PIPELINE
          </span>
          {totalActive > 0 && (
            <span style={{
              fontSize: 8,
              color: '#333',
              fontFamily: 'monospace',
            }}>
              {totalActive}
            </span>
          )}
        </button>

        {/* RENDERED tab */}
        <button
          onClick={() => { setActiveTab('rendered'); onSelect?.('') }}
          style={{
            flex: 1,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            background: activeTab === 'rendered' ? '#121212' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'rendered' ? '2px solid #00FF88' : '2px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={activeTab === 'rendered' ? '#00FF88' : '#444'} strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            color: activeTab === 'rendered' ? '#00FF88' : '#444',
            letterSpacing: '0.1em',
          }}>
            RENDERED
          </span>
          {renderedVideos.length > 0 && (
            <span style={{
              fontSize: 8,
              color: '#333',
              fontFamily: 'monospace',
            }}>
              {renderedVideos.length}
            </span>
          )}
        </button>
      </div>

      {/* Filter bar — pipeline only */}
      {activeTab === 'pipeline' && workspaces.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, padding: '6px 10px',
          background: '#0D0D0D',
          borderBottom: '1px solid #161616',
          flexShrink: 0,
        }}>
          {/* Search */}
          <div style={{ flex: 1, position: 'relative' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2"
              style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Tìm video..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%', height: 24, paddingLeft: 24, paddingRight: 6,
                background: '#1A1A1A', border: '1px solid #222',
                borderRadius: 3, fontSize: 10, color: '#888',
                outline: 'none', fontFamily: 'inherit',
              }}
              onFocus={e => { e.target.style.borderColor = '#00B4FF44'; e.target.style.color = '#fff' }}
              onBlur={e => { e.target.style.borderColor = '#222'; e.target.style.color = '#888' }}
            />
          </div>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as GroupStatus | 'all')}
            style={{
              height: 24, padding: '0 4px',
              background: '#1A1A1A', border: '1px solid #222',
              borderRadius: 3, fontSize: 9, color: '#888',
              outline: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <option value="all">Tất cả</option>
            {STATUS_ORDER.map(s => (
              <option key={s} value={s}>{GROUP_CONFIG[s].label}</option>
            ))}
          </select>

          {/* Channel filter */}
          <select
            value={filterChannel}
            onChange={e => setFilterChannel(e.target.value)}
            style={{
              height: 24, padding: '0 4px',
              background: '#1A1A1A', border: '1px solid #222',
              borderRadius: 3, fontSize: 9, color: '#888',
              outline: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <option value="all">Tất cả kênh</option>
            {channels.map(ch => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>

          {/* Clear filters */}
          {(searchQuery || filterStatus !== 'all' || filterChannel !== 'all') && (
            <button
              onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterChannel('all') }}
              title="Xóa bộ lọc"
              style={{
                height: 24, padding: '0 6px',
                background: 'transparent', border: '1px solid #222',
                borderRadius: 3, fontSize: 9, color: '#555',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'pipeline' ? (
          /* Pipeline view */
          <>
            {workspaces.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center"
                style={{ height: '100%', gap: 8 }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#222" strokeWidth="1.5">
                  <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14v-4z" />
                  <rect x="3" y="6" width="12" height="12" rx="2" ry="2" />
                </svg>
                <span style={{ fontSize: 11, color: '#333', textAlign: 'center', lineHeight: 1.5 }}>
                  Chưa có video nào<br />
                  <span style={{ color: '#2A2A2A', fontSize: 10 }}>Thêm kênh trong Settings →</span>
                </span>
              </div>
            ) : filteredWorkspaces.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center"
                style={{ height: '100%', gap: 8 }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#222" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span style={{ fontSize: 11, color: '#333', textAlign: 'center', lineHeight: 1.5 }}>
                  Không có kết quả<br />
                  <span style={{ color: '#2A2A2A', fontSize: 10 }}>Thử đổi từ khóa hoặc bộ lọc</span>
                </span>
              </div>
            ) : (
              STATUS_ORDER.map((status) => {
                const items = groups.get(status) || []
                if (items.length === 0) return null

                const cfg = GROUP_CONFIG[status]
                const isCollapsed = collapsedGroups.has(status)

                return (
                  <div key={status}>
                    {/* Group header */}
                    <div
                      onClick={() => cfg.collapsible && toggleGroup(status)}
                      className="flex items-center px-4 shrink-0"
                      style={{
                        height: 26,
                        background: '#0F0F0F',
                        borderBottom: '1px solid #181818',
                        cursor: cfg.collapsible ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, display: 'inline-block', marginRight: 6, boxShadow: `0 0 4px ${cfg.color}88` }} />
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: '#555',
                          letterSpacing: '0.08em',
                        }}
                      >
                        {cfg.label}
                      </span>
                      <span
                        style={{
                          marginLeft: 5,
                          fontSize: 9,
                          fontFamily: 'monospace',
                          color: '#444',
                        }}
                      >
                        · {items.length}
                      </span>
                      {cfg.collapsible && (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#333"
                          strokeWidth="2"
                          style={{
                            marginLeft: 'auto',
                            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.15s',
                          }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      )}
                    </div>

                    {/* Group items */}
                    {!isCollapsed && items.map((ws) => (
                      <WorkspaceCard
                        key={ws.id}
                        workspace={ws}
                        isSelected={ws.id === selectedId}
                        onClick={() => onSelect(ws.id)}
                        onQuickAction={onQuickAction}
                        onRetry={onRetry}
                        onSplit={onSplit}
                        trimLimitMinutes={trimLimitMinutes}
                      />
                    ))}
                  </div>
                )
              })
            )}
          </>
        ) : (
          /* Rendered videos tab */
          <RenderedVideos
            videos={renderedVideos}
            selectedId={selectedRenderedId ?? null}
            onSelect={(id) => onSelectRendered?.(id)}
            onRemove={(id) => onRemoveRendered?.(id)}
            onShowToast={(msg) => onShowToast?.(msg)}
          />
        )}
      </div>
    </div>
  )
}