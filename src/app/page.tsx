'use client'

import { useState, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { WorkspaceQueue } from './components/workspace/WorkspaceQueue'
import { RenderQueueBar } from './components/workspace/RenderQueueBar'
import { DetailEditor } from './components/DetailEditor'
import { LoginScreen } from './components/LoginScreen'
import type { Channel, Video, SystemStats, EditorState } from './types'
import { useAppStore, type Workspace } from './lib/store'
import { ipc } from './lib/ipc'

export const dynamic = 'force-dynamic'

// ─── Helpers (same logic as store.ts, for IPC event formatting) ──────────────

function formatDurationRaw(seconds: number): string {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatFileSizeRaw(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDateRaw(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Vừa xong'
    if (diffMin < 60) return `${diffMin} phút trước`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h trước`
    const diffD = Math.floor(diffH / 24)
    return `${diffD} ngày trước`
  } catch {
    return iso
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const {
    workspaces,
    channels,
    selectedWorkspaceId,
    systemStats,
    editorState,
    toast,
    addWorkspace,
    updateWorkspace,
    removeWorkspace,
    initChannels,
    initWorkspaces,
    updateChannel,
    removeChannel,
    selectWorkspace,
    updateSystemStats,
    showToast,
    updateEditorState,
    resetEditorState,
    startRender,
    settings,
  } = useAppStore()

  const [renderQueueExpanded, setRenderQueueExpanded] = useState(false)
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<{ isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady: boolean }>({ isReady: false, cookieCount: 0, loggedOut: true, accountName: '', oauthReady: false })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch auth status on mount + listen for updates
  useEffect(() => {
    ipc.getAuthStatus().then(setAuthStatus)
    const cleanupAuth = ipc.onAuthUpdate((status) => {
      setAuthStatus(status as any)
    })
    return () => { cleanupAuth() }
  }, [])

  // Re-fetch channels when OAuth subscriptions are synced
  useEffect(() => {
    const cleanup = ipc.onChannelSynced(() => {
      initChannels()
    })
    return cleanup
  }, [initChannels])

  // Sync IPC workspace updates into Zustand store
  useEffect(() => {
    const cleanup = ipc.onWorkspaceUpdate((ws) => {
      const data = ws as any
      if (data.id) {
        const existing = useAppStore.getState().workspaces.find(w => w.id === data.id)
        if (existing) {
          // Format backend numeric fields for renderer store
          const patch: Partial<Workspace> = { ...data }
          if (typeof patch.fileSize === 'number') {
            patch.fileSize = formatFileSizeRaw(patch.fileSize)
          }
          updateWorkspace(data.id, patch)
        } else {
          // Format on creation too
          const formatted: Workspace = {
            id: data.id,
            channelId: data.channelId || '',
            channelName: data.channelName || '',
            channelColor: data.channelColor || '#00B4FF',
            videoTitle: data.videoTitle || 'Unknown',
            thumbnail: data.thumbnail || '',
            duration: formatDurationRaw(data.duration),
            downloadedAt: data.downloadedAt ? formatDateRaw(data.downloadedAt) : '',
            status: data.status || 'new',
            renderProgress: data.renderProgress,
            fileSize: typeof data.fileSize === 'number' ? formatFileSizeRaw(data.fileSize) : String(data.fileSize || ''),
            trimLimit: data.trimLimit || '10min',
            downloadedPath: data.downloadedPath,
            blurBackgroundPath: data.blurBackgroundPath,
            outputPath: data.outputPath,
          }
          addWorkspace(formatted)
        }
      }
    })
    return cleanup
  }, [updateWorkspace, addWorkspace])

  // IPC — connect system stats
  useEffect(() => {
    const cleanup = window.electronAPI?.onSystemStats((stats) => {
      if (stats) {
        updateSystemStats(stats as SystemStats)
      }
    })
    return cleanup
  }, [updateSystemStats])

  // IPC — notifications
  useEffect(() => {
    const cleanup = window.electronAPI?.onNotification((n) => {
      const notif = n as { type: string; message: string; workspaceId?: string }
      showToast(notif.message)
    })
    return cleanup
  }, [showToast])

  // Load channels + workspaces from persistent store on mount
  useEffect(() => {
    initChannels()
    initWorkspaces()
  }, [initChannels, initWorkspaces])

  // IPC — render + download progress
  useEffect(() => {
    const cleanup = window.electronAPI?.onRenderProgress((progress) => {
      const p = progress as { workspaceId: string; percent: number }
      if (p.workspaceId && p.percent !== undefined) {
        const ws = useAppStore.getState().workspaces.find(w => w.id === p.workspaceId)
        // Set downloadProgress when downloading, renderProgress when rendering
        const patch = ws?.status === 'downloading'
          ? { downloadProgress: p.percent }
          : { renderProgress: p.percent }
        updateWorkspace(p.workspaceId, patch)
      }
    })
    return cleanup
  }, [updateWorkspace])

  // IPC — quick-add from tray
  useEffect(() => {
    const cleanup = window.electronAPI?.onQuickAdd(() => {
      // Focus the input bar
      const input = document.querySelector('input[placeholder*="YouTube"]') as HTMLInputElement
      input?.focus()
    })
    return cleanup
  }, [])

  // IPC — auto-download from WebSub
  useEffect(() => {
    const cleanup = ipc.onAutoDownload((data) => {
      const d = data as { videoId: string; title: string; channelName: string }
      showToast(`Auto-downloaded: ${d.title}`)
      // Play notification chime
      try {
        const ctx = new AudioContext()
        const notes = [523.25, 659.25, 783.99] // C5, E5, G5
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.frequency.value = freq
          osc.type = 'sine'
          gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.12)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.2)
          osc.start(ctx.currentTime + i * 0.12)
          osc.stop(ctx.currentTime + i * 0.12 + 0.2)
        })
        void ctx.resume()
      } catch {}
    })
    return cleanup
  }, [showToast])


  // Map workspaces to videos for DetailEditor
  const videos: Video[] = workspaces.map((ws) => ({
    id: ws.id,
    channelId: ws.channelId,
    title: ws.videoTitle,
    thumbnail: ws.thumbnail,
    duration: ws.duration,
    downloadedAt: ws.downloadedAt,
    status: ws.status === 'editing' ? 'new' : ws.status === 'done' ? 'done' : ws.status === 'rendering' ? 'rendering' : 'new',
    renderProgress: ws.renderProgress,
    fileSize: ws.fileSize,
  }))

  const newCounts: Record<string, number> = {}
  channels.forEach((ch) => {
    newCounts[ch.id] = workspaces.filter((v) => v.channelId === ch.id && v.status === 'ready').length
  })

  // Handlers
  const handleChannelSelect = (id: string) => {
    setActiveChannelId(id)
    selectWorkspace(null)
    resetEditorState()
  }

  const handleAddTracker = async (url: string, trimLimit: '5min' | '10min' | 'full') => {
    showToast('Adding tracker...')
    try {
      const result = await ipc.addTracker(url, trimLimit)
      if (result) {
        showToast('Tracker added!')
      } else {
        showToast('Failed to add tracker')
      }
    } catch {
      showToast('Error adding tracker')
    }
  }

  const handleVideoSelect = (video: Video) => {
    selectWorkspace(video.id)
    resetEditorState()
  }

  const handleQuickAction = (action: 'open' | 'delete', id: string) => {
    if (action === 'delete') {
      removeWorkspace(id)
      ipc.deleteWorkspace(id).catch(() => {})
      showToast('Workspace removed')
    } else {
      selectWorkspace(id)
    }
  }

  const handleEditorChange = (patch: Partial<EditorState>) => {
    updateEditorState(patch)
  }

  const handleRender = async () => {
    if (!selectedWorkspaceId) return

    const ws = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!ws || !ws.downloadedPath) {
      showToast('Video not downloaded yet — download first')
      return
    }
    if (!ws.blurBackgroundPath) {
      showToast('Blur background not ready yet — wait a few seconds')
      return
    }

    // Parse video duration to seconds
    const parseDuration = (d: string): number => {
      const parts = d.split(':').map(Number)
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
      if (parts.length === 2) return parts[0] * 60 + parts[1]
      return parseFloat(d) || 0
    }
    const totalSec = parseDuration(ws.duration)

    // Convert trim percentages (0-100) to absolute seconds
    const trimStartSec = Math.round((editorState.trimStart / 100) * totalSec)
    const trimEndSec = Math.round((editorState.trimEnd / 100) * totalSec)

    // Build overlays from editor state
    const overlays: object[] = []
    if (editorState.headerImageUrl) {
      overlays.push({
        type: 'header',
        src: editorState.headerImageUrl,
      })
    }
    if (editorState.titleText) {
      overlays.push({
        type: 'title',
        content: editorState.titleText,
        shape: editorState.titleShape,
        borderColor: editorState.titleBorderColor,
        bgColor: editorState.titleBgColor,
        fontSize: editorState.titleFontSize,
      })
    }

    // Build FFmpeg metadata
    const metadata = {
      workspace_id: ws.id,
      source_video: ws.downloadedPath,
      blur_background: ws.blurBackgroundPath || '',
      export_resolution: editorState.exportQuality === 720 ? '720x1280' : '1080x1920',
      video_speed: editorState.speedMultiplier,
      fps_target: 30,
      overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec,
      preset: editorState.exportPreset,
      tune: editorState.exportTune,
    }

    // Update Zustand (optimistic UI)
    updateWorkspace(ws.id, { status: 'rendering', renderProgress: 0 })
    setRenderQueueExpanded(true)

    // Call IPC — main process runs FFmpeg
    try {
      const result = await ipc.startRender(ws.id, metadata) as { success: boolean; outputPath?: string; error?: string }
      if (result && !result.success) {
        updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
        showToast(`Render failed: ${result.error}`)
      }
      // Success is handled by onRenderProgress → workspace:update-event → Zustand
    } catch (err) {
      updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
      showToast(`Render error: ${(err as Error).message}`)
    }
  }

  const handleExportChunked = async () => {
    if (!selectedWorkspaceId) return
    const ws = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!ws || !ws.downloadedPath) {
      showToast('Video not downloaded yet')
      return
    }
    if (!ws.blurBackgroundPath) {
      showToast('Blur background not ready — wait a few seconds')
      return
    }

    const parseDuration = (d: string): number => {
      const parts = d.split(':').map(Number)
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
      if (parts.length === 2) return parts[0] * 60 + parts[1]
      return parseFloat(d) || 0
    }
    const totalSec = parseDuration(ws.duration)
    const trimStartSec = Math.round((editorState.trimStart / 100) * totalSec)
    const trimEndSec = Math.round((editorState.trimEnd / 100) * totalSec)

    const overlays: object[] = []
    if (editorState.headerImageUrl) {
      overlays.push({
        type: 'header',
        src: editorState.headerImageUrl,
      })
    }
    if (editorState.titleText) {
      overlays.push({
        type: 'title',
        content: editorState.titleText,
        shape: editorState.titleShape,
        borderColor: editorState.titleBorderColor,
        bgColor: editorState.titleBgColor,
        fontSize: editorState.titleFontSize,
      })
    }

    const metadata = {
      workspace_id: ws.id,
      source_video: ws.downloadedPath,
      blur_background: ws.blurBackgroundPath || '',
      export_resolution: editorState.exportQuality === 720 ? '720x1280' : '1080x1920',
      video_speed: editorState.speedMultiplier,
      fps_target: 30,
      overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec,
      preset: editorState.exportPreset,
      tune: editorState.exportTune,
    }

    updateWorkspace(ws.id, { status: 'rendering', renderProgress: 0 })
    setRenderQueueExpanded(true)

    try {
      const result = await ipc.startChunked(ws.id, metadata, { workers: 4, chunkDuration: 30 })
      if (result?.success) {
        updateWorkspace(ws.id, { status: 'done', renderProgress: 100 })
        const chunkCount = result.chunks?.length || 0
        showToast(`Chunked: ${chunkCount} segments rendered in parallel!`)
      } else {
        updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
        showToast(`Chunked failed: ${result?.error || 'unknown'}`)
      }
    } catch (err) {
      updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
      showToast(`Chunked error: ${(err as Error).message}`)
    }
  }

  const handleCancelRender = (id: string) => {
    ipc.cancelRender(id)
    updateWorkspace(id, { status: 'ready', renderProgress: 0 })
    showToast('Render cancelled')
  }

  const handleLogout = async () => {
    await ipc.logout()
    setAuthStatus({ isReady: false, cookieCount: 0, loggedOut: true, accountName: '', oauthReady: false })
    showToast('Đã đăng xuất YouTube')
  }

  const selectedVideo = videos.find((v) => v.id === selectedWorkspaceId) ?? null

  return (
    <div
      className="flex overflow-hidden"
      style={{ height: '100vh', background: '#0E0E0E', fontFamily: 'Inter, sans-serif', color: '#fff' }}
    >
      {/* Login waiting screen — blocks all interaction until OAuth completes */}
      {!authStatus.isReady && (
        <LoginScreen
          accountName={authStatus.accountName}
          oauthReady={authStatus.oauthReady}
          onLogout={handleLogout}
        />
      )}

      {/* Col 1 — Sidebar */}
      <Sidebar
        channels={channels}
        activeChannelId={activeChannelId || ''}
        newCounts={newCounts}
        onChannelSelect={handleChannelSelect}
        onEditChannel={(id, patch) => updateChannel(id, patch)}
        onDeleteChannel={(id) => removeChannel(id)}
        systemStats={systemStats}
        authStatus={authStatus}
        onLogout={handleLogout}
      />

      {/* Col 2 — Workspace Pipeline */}
      <div
        className="flex flex-col flex-1 min-w-0"
        style={{ borderRight: '1px solid #1E1E1E', position: 'relative' }}
      >
        <WorkspaceQueue
          workspaces={workspaces}
          selectedId={selectedWorkspaceId}
          onSelect={(id) => handleVideoSelect(videos.find(v => v.id === id)!)}
          onQuickAction={handleQuickAction}
          onAddTracker={handleAddTracker}
          defaultTrimLimit={settings.defaultTrimLimit}
        />

        {/* Render Queue Bar */}
        <RenderQueueBar
          workspaces={workspaces}
          isExpanded={renderQueueExpanded}
          onToggle={() => setRenderQueueExpanded(!renderQueueExpanded)}
          onCancel={handleCancelRender}
        />
      </div>

      {/* Col 3 — Editor */}
      <div className="flex-1 min-w-0" style={{ overflow: 'hidden' }}>
        <DetailEditor
          video={selectedVideo}
          editorState={editorState}
          onChange={handleEditorChange}
          onRender={handleRender}
          onExportChunked={handleExportChunked}
        />
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: renderQueueExpanded ? 128 : 48,
            right: 24,
            background: '#1A1A1A',
            borderWidth: '1px 1px 1px 3px',
            borderStyle: 'solid',
            borderColor: '#2A2A2A #2A2A2A #2A2A2A #00B4FF',
            borderRadius: 4,
            padding: '10px 16px',
            fontSize: 12,
            color: '#ccc',
            zIndex: 9999,
            maxWidth: 320,
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #333; }
        input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; }
        textarea { box-sizing: border-box; }
      `}</style>
    </div>
  )
}