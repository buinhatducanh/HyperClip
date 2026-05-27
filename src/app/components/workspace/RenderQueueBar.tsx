'use client'
import { colors, spacing, fontSize } from '../../design-system/tokens'

import { useState } from 'react'
import type { Workspace } from '../../lib/store'

interface Props {
  workspaces: Workspace[]
  isExpanded: boolean
  onToggle: () => void
  onCancel?: (id: string) => void
  autoRenderEnabled?: boolean
  onAutoRenderToggle?: (enabled: boolean) => void
}

export function RenderQueueBar({ workspaces, isExpanded, onToggle, onCancel, autoRenderEnabled, onAutoRenderToggle }: Props) {
  const rendering = workspaces.filter(w => w.status === 'rendering')
  const queued = workspaces.filter(w => ['waiting', 'downloading'].includes(w.status))

  if (rendering.length === 0 && queued.length === 0) return null

  const totalProgress = rendering.reduce((sum, w) => sum + (w.renderProgress || 0), 0)
  const avgProgress = rendering.length > 0 ? Math.round(totalProgress / rendering.length) : 0

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 220, // sidebar width
        right: 0,
        background: colors.bg,
        borderTop: '1px solid #E0E0E0',
        zIndex: 100,
        transition: 'height 0.2s',
        height: isExpanded ? 120 : 40,
        overflow: 'hidden',
      }}
    >
      {/* Toggle bar */}
      <div
        onClick={onToggle}
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 16,
          paddingRight: 16,
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: isExpanded ? '1px solid #1A1A1A' : 'none',
        }}
      >
        {/* Flash icon when rendering */}
        <span style={{ fontSize: 14, marginRight: 8 }}>
          {rendering.length > 0 ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#FF4444" stroke="none">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#00B4FF" stroke="none">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          )}
        </span>

        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: '#777',
            letterSpacing: '0.1em',
            marginRight: 12,
          }}
        >
          RENDER QUEUE
        </span>

        {/* Auto-render quick toggle */}
        {onAutoRenderToggle !== undefined && (
          <button
            onClick={(e) => { e.stopPropagation(); onAutoRenderToggle(!autoRenderEnabled) }}
            title={autoRenderEnabled ? 'Auto-render: ON — click to disable' : 'Auto-render: OFF — click to enable'}
            style={{
              fontSize: 8,
              fontWeight: 800,
              letterSpacing: '0.1em',
              padding: '2px 7px',
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              background: autoRenderEnabled ? '#00FF8822' : colors.text,
              color: autoRenderEnabled ? colors.success : '#999',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: autoRenderEnabled ? '#00FF8844' : '#777',
              transition: 'all 0.15s',
            }}
          >
            AUTO
          </button>
        )}

        {/* Worker badges */}
        {rendering.map((ws, i) => (
          <span
            key={ws.id}
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: colors.error,
              background: '#FF444415',
              border: '1px solid #FF444422',
              borderRadius: 2,
              padding: '1px 6px',
              marginRight: 6,
              fontFamily: 'monospace',
            }}
          >
            W{i + 1}: {ws.renderProgress || 0}%{ws.renderEta ? ` · ${ws.renderEta}` : ''}
          </span>
        ))}
        {queued.map((ws, i) => (
          <span
            key={ws.id}
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: '#999',
              background: colors.text,
              border: '1px solid #777',
              borderRadius: 2,
              padding: '1px 6px',
              marginRight: 6,
              fontFamily: 'monospace',
            }}
          >
            W{rendering.length + i + 1}: QUEUED
          </span>
        ))}

        {/* Overall progress */}
        {(rendering.length > 0 || queued.length > 0) && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 9,
              fontFamily: 'monospace',
              color: '#999',
            }}
          >
            {rendering.length} rendering · {queued.length} queued · {avgProgress}% avg
          </span>
        )}

        {/* Expand chevron */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#999"
          strokeWidth="2"
          style={{
            marginLeft: 8,
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </div>

      {/* Expanded: detailed progress */}
      {isExpanded && (
        <div className="flex flex-col gap-2 px-4 py-3">
          {rendering.map((ws) => (
            <div key={ws.id} className="flex items-center gap-3">
              <div style={{ width: 120, fontSize: 9, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ws.videoTitle}
              </div>
              <div style={{ flex: 1, height: 3, background: colors.text, borderRadius: 1.5 }}>
                <div
                  style={{
                    width: `${ws.renderProgress || 0}%`,
                    height: '100%',
                    background: colors.error,
                    borderRadius: 1.5,
                    transition: 'width 0.5s',
                  }}
                />
              </div>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: colors.error, minWidth: 32, textAlign: 'right' }}>
                {ws.renderProgress || 0}%{ws.renderEta ? ` · ${ws.renderEta}` : ''}
              </span>
              {onCancel && (
                <button
                  onClick={() => onCancel(ws.id)}
                  title="Cancel render"
                  style={{
                    width: 18, height: 18, borderRadius: 2, border: 'none',
                    background: '#FF444420', color: colors.error, cursor: 'pointer',
                    fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >✕</button>
              )}
            </div>
          ))}
          {queued.map((ws) => (
            <div key={ws.id} className="flex items-center gap-3">
              <div style={{ width: 120, fontSize: 9, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ws.videoTitle}
              </div>
              <div style={{ flex: 1, height: 3, background: colors.text, borderRadius: 1.5 }}>
                <div
                  style={{
                    width: '2px',
                    height: '100%',
                    background: '#999',
                    borderRadius: 1.5,
                  }}
                />
              </div>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#999', minWidth: 32, textAlign: 'right' }}>
                QUEUED
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
