'use client'
import { useState, useMemo, memo } from 'react'
import { colors } from '../../design-system/tokens'

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
  onQuickAction?: (action: 'open' | 'delete' | 'open-output' | 'open-output-folder', id: string) => void
  onRetry?: (id: string) => void
  onRemoveRendered?: (id: string) => void
  onShowToast?: (msg: string) => void
  onSplit?: (id: string, partMinutes: number) => void
  trimLimitMinutes?: number
  /** Opens compare modal for a workspace (from RenderedVideos or WorkspaceCard) */
  onCompare?: (workspaceId: string) => void
  onOpenFolder?: (id: string) => void
}

type GroupStatus = 'ready' | 'rendering' | 'downloading' | 'waiting' | 'editing' | 'done' | 'error'
type ActiveTab = 'pipeline' | 'rendered'

const STATUS_ORDER: GroupStatus[] = ['ready', 'rendering', 'downloading', 'waiting', 'editing', 'done', 'error']

const GROUP_CONFIG: Record<GroupStatus, { label: string; color: string; collapsible?: boolean }> = {
  ready:      { label: 'READY',      color: colors.success, collapsible: false },
  rendering:  { label: 'RENDERING',  color: colors.error, collapsible: false },
  downloading: { label: 'DOWNLOAD',  color: colors.accent, collapsible: false },
  waiting:    { label: 'WAITING',    color: colors.warning, collapsible: false },
  editing:    { label: 'EDITING',    color: colors.accent, collapsible: false },
  done:       { label: 'DONE',       color: colors.textSecondary, collapsible: true },
  error:      { label: 'ERROR',      color: colors.error, collapsible: false },
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

function getNextRenderWorkspaceId(workspaces: Workspace[]): string | null {
  const ready = workspaces.filter(w => w.status === 'ready')
  if (ready.length === 0) return null
  ready.sort((a, b) => {
    const ap = a.renderPriority ?? Number.MAX_SAFE_INTEGER
    const bp = b.renderPriority ?? Number.MAX_SAFE_INTEGER
    if (ap !== bp) return ap - bp
    const at = a.detectedAt ? new Date(a.detectedAt).getTime() : Number.MAX_SAFE_INTEGER
    const bt = b.detectedAt ? new Date(b.detectedAt).getTime() : Number.MAX_SAFE_INTEGER
    return at - bt
  })
  return ready[0]?.id ?? null
}

const MemoizedGroupHeader = memo(function GroupHeader({
  status, count, cfg, isCollapsed, onToggle
}: {
  status: GroupStatus; count: number; cfg: typeof GROUP_CONFIG[GroupStatus]
  isCollapsed: boolean; onToggle: () => void
}) {
  return (
    <div
      onClick={() => cfg.collapsible && onToggle()}
      className="flex items-center px-4 shrink-0"
      style={{
        height: 26,
        background: colors.bg,
        borderBottom: `1px solid ${colors.surface}`,
        cursor: cfg.collapsible ? 'pointer' : 'default',
        userSelect: 'none',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, display: 'inline-block', marginRight: 6, boxShadow: `0 0 4px ${cfg.color}88` }} />
      <span style={{ fontSize: 9, fontWeight: 700, color: colors.textSecondary, letterSpacing: '0.08em' }}>
        {cfg.label}
      </span>
      <span style={{ marginLeft: 5, fontSize: 9, fontFamily: 'monospace', color: colors.textSecondary }}>
        · {count}
      </span>
      {cfg.collapsible && (
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={colors.textSecondary} strokeWidth="2"
          style={{ marginLeft: 'auto', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      )}
    </div>
  )
})

export const WorkspaceQueue = memo(function WorkspaceQueue({
  workspaces, renderedVideos = [], channels = [], selectedId, selectedRenderedId,
  onSelect, onSelectRendered, onQuickAction, onRetry, onRemoveRendered, onShowToast, onSplit, trimLimitMinutes = 10,
  onCompare,
}: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupStatus>>(new Set<GroupStatus>())
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

  const nextRenderWorkspaceId = useMemo(
    () => getNextRenderWorkspaceId(filteredWorkspaces),
    [filteredWorkspaces]
  )

  const totalActive = filteredWorkspaces.filter(w =>
    ['ready', 'rendering', 'downloading', 'waiting', 'editing'].includes(w.status)
  ).length

  return (
    <div className="flex flex-col h-full" style={{ background: colors.bg }}>
      {/* Tab header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: colors.bg,
          borderBottom: `1px solid ${colors.border}`,
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
            background: activeTab === 'pipeline' ? colors.bg : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'pipeline' ? `2px solid ${colors.accent}` : '2px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={activeTab === 'pipeline' ? colors.accent : colors.textSecondary} strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            color: activeTab === 'pipeline' ? colors.accent : colors.textSecondary,
            letterSpacing: '0.1em',
          }}>
            PIPELINE
          </span>
          {totalActive > 0 && (
            <span style={{
              fontSize: 8,
              color: colors.textSecondary,
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
            background: activeTab === 'rendered' ? colors.bg : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'rendered' ? `2px solid ${colors.success}` : '2px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={activeTab === 'rendered' ? colors.success : colors.textSecondary} strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            color: activeTab === 'rendered' ? colors.success : colors.textSecondary,
            letterSpacing: '0.1em',
          }}>
            RENDERED
          </span>
          {renderedVideos.length > 0 && (
            <span style={{
              fontSize: 8,
              color: colors.textSecondary,
              fontFamily: 'monospace',
            }}>
              {renderedVideos.length}
            </span>
          )}
        </button>
      </div>

      {/* Filter tabs — compact pill style */}
      {activeTab === 'pipeline' && workspaces.length > 0 && (
        <div style={{
          display: 'flex', gap: 4, padding: '4px 8px',
          background: colors.bg, borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          {[
            { key: 'all', label: 'ALL', color: colors.textSecondary },
            { key: 'ready', label: 'READY', color: colors.success },
            { key: 'downloading', label: 'DL', color: colors.accent },
            { key: 'rendering', label: 'RENDER', color: colors.error },
            { key: 'error', label: 'ERR', color: colors.error },
          ].map(tab => {
            const count = tab.key === 'all'
              ? filteredWorkspaces.length
              : filteredWorkspaces.filter(w => w.status === tab.key).length
            if (count === 0 && tab.key !== 'all') return null
            const isActive = filterStatus === tab.key || (tab.key === 'all' && filterStatus === 'all')
            return (
              <button
                key={tab.key}
                onClick={() => setFilterStatus(tab.key === 'all' ? 'all' : tab.key as GroupStatus)}
                style={{
                  height: 20, padding: '0 6px', border: 'none', borderRadius: 3,
                  background: isActive ? `${tab.color}18` : 'transparent',
                  color: isActive ? tab.color : colors.textSecondary,
                  fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace',
                  display: 'flex', alignItems: 'center', gap: 3,
                }}
              >
                {tab.label}
                <span style={{ fontSize: 8, opacity: 0.6 }}>{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Filter bar — pipeline only */}
      {activeTab === 'pipeline' && workspaces.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, padding: '6px 10px',
          background: colors.bg,
          borderBottom: `1px solid ${colors.borderHover}`,
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={colors.textSecondary} strokeWidth="2"
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
                background: colors.surface, border: `1px solid ${colors.textTertiary}`,
                borderRadius: 3, fontSize: 10, color: colors.textSecondary,
                outline: 'none', fontFamily: 'inherit',
              }}
              onFocus={e => { e.target.style.borderColor = `${colors.accent}44`; e.target.style.color = colors.text }}
              onBlur={e => { e.target.style.borderColor = `${colors.textTertiary}`; e.target.style.color = colors.textSecondary }}
            />
          </div>

          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as GroupStatus | 'all')}
            style={{
              height: 24, padding: '0 4px',
              background: colors.surface, border: `1px solid ${colors.textTertiary}`,
              borderRadius: 3, fontSize: 9, color: colors.textSecondary,
              outline: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <option value="all">Tất cả</option>
            {STATUS_ORDER.map(s => (
              <option key={s} value={s}>{GROUP_CONFIG[s].label}</option>
            ))}
          </select>

          <select
            value={filterChannel}
            onChange={e => setFilterChannel(e.target.value)}
            style={{
              height: 24, padding: '0 4px',
              background: colors.surface, border: `1px solid ${colors.textTertiary}`,
              borderRadius: 3, fontSize: 9, color: colors.textSecondary,
              outline: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <option value="all">Tất cả kênh</option>
            {channels.map(ch => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>

          {(searchQuery || filterStatus !== 'all' || filterChannel !== 'all') && (
            <button
              onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterChannel('all') }}
              title="Xóa bộ lọc"
              style={{
                height: 24, padding: '0 6px',
                background: 'transparent', border: `1px solid ${colors.textTertiary}`,
                borderRadius: 3, fontSize: 9, color: colors.textSecondary,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              ×
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'pipeline' ? (
          <>
            {workspaces.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center"
                style={{ height: '100%', gap: 8 }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={colors.textSecondary} strokeWidth="1.5">
                  <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14v-4z" />
                  <rect x="3" y="6" width="12" height="12" rx="2" ry="2" />
                </svg>
                <span style={{ fontSize: 11, color: colors.textSecondary, textAlign: 'center', lineHeight: 1.5 }}>
                  Chưa có video nào<br />
                  <span style={{ color: colors.borderHover, fontSize: 10 }}>Thêm kênh trong Settings →</span>
                </span>
              </div>
            ) : filteredWorkspaces.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center"
                style={{ height: '100%', gap: 8 }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.textSecondary} strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span style={{ fontSize: 11, color: colors.textSecondary, textAlign: 'center', lineHeight: 1.5 }}>
                  Không có kết quả<br />
                  <span style={{ color: colors.borderHover, fontSize: 10 }}>Thử đổi từ khóa hoặc bộ lọc</span>
                </span>
              </div>
            ) : (
              filteredWorkspaces.map((ws) => (
                <WorkspaceCard
                  key={ws.id}
                  workspace={ws}
                  isSelected={ws.id === selectedId}
                  isNextRender={ws.id === nextRenderWorkspaceId}
                  onClick={() => onSelect(ws.id)}
                  onQuickAction={onQuickAction}
                  onRetry={onRetry}
                  onSplit={onSplit}
                  trimLimitMinutes={trimLimitMinutes}
                />
              ))
            )}
          </>
        ) : (
          <RenderedVideos
            videos={renderedVideos}
            selectedId={selectedRenderedId ?? null}
            onSelect={(id) => onSelectRendered?.(id)}
            onRemove={(id) => onRemoveRendered?.(id)}
            onShowToast={(msg) => onShowToast?.(msg)}
            onCompare={onCompare}
          />
        )}
      </div>
    </div>
  )
})
