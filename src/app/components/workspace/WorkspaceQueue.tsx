'use client'

import { useState } from 'react'
import type { Workspace } from '../../lib/store'
import { WorkspaceCard } from './WorkspaceCard'
import { InputBar } from './InputBar'

interface Props {
  workspaces: Workspace[]
  selectedId: string | null
  onSelect: (id: string) => void
  onQuickAction?: (action: 'open' | 'delete', id: string) => void
  onAddTracker: (url: string, trimLimit: number | 'full') => void
  onAddChannel: (url: string) => void
  defaultTrimLimit: number | 'full'
  onRetry?: (id: string) => void
}

type GroupStatus = 'ready' | 'rendering' | 'downloading' | 'waiting' | 'editing' | 'done'

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

export function WorkspaceQueue({ workspaces, selectedId, onSelect, onQuickAction, onAddTracker, onAddChannel, defaultTrimLimit, onRetry }: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupStatus>>(new Set(['done']))
  const groups = groupByStatus(workspaces)

  const toggleGroup = (status: GroupStatus) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  // Count totals
  const totalActive = workspaces.filter(w =>
    ['ready', 'rendering', 'downloading', 'waiting', 'editing'].includes(w.status)
  ).length
  const totalDone = workspaces.filter(w => w.status === 'done').length

  return (
    <div className="flex flex-col h-full" style={{ background: '#121212' }}>
      {/* Top Input Bar */}
      <InputBar defaultTrimLimit={defaultTrimLimit} onAddTracker={onAddTracker} onAddChannel={onAddChannel} />

      {/* Queue header */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{
          height: 32,
          background: '#0D0D0D',
          borderBottom: '1px solid #1E1E1E',
        }}
      >
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 9, fontWeight: 800, color: '#444', letterSpacing: '0.1em' }}>
            PIPELINE
          </span>
          <span style={{ fontSize: 9, color: '#333' }}>
            {totalActive} active
          </span>
          {totalDone > 0 && (
            <span style={{ fontSize: 9, color: '#333' }}>
              · {totalDone} done
            </span>
          )}
        </div>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#333' }}>
          {workspaces.length} total
        </span>
      </div>

      {/* Workspace groups */}
      <div className="flex-1 overflow-y-auto">
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
              No videos yet<br />
              <span style={{ color: '#2A2A2A', fontSize: 10 }}>Add a channel to start automation</span>
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
                  />
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}