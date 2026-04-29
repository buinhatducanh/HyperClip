'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
    selectWorkspace,
    updateSystemStats,
    showToast,
    addNotification,
    updateEditorState,
    resetEditorState,
    startRender,
    settings,
  } = useAppStore()

  const [renderQueueExpanded, setRenderQueueExpanded] = useState(false)
  const [workspaceColWidth, setWorkspaceColWidth] = useState<number | undefined>(undefined)
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<{ isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string; oauthReady: boolean; quotaExceeded?: boolean; quotaError?: string; cookieCritical?: boolean; cookieError?: string }>({ isReady: false, cookieCount: 0, loggedOut: true, accountName: '', oauthReady: false })
  const [pollerStatus, setPollerStatus] = useState<{ active: boolean; lastPollAt: number | null; newVideoCount: number; lastError: string | null } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quotaToastShown = useRef(false)
  const router = useRouter()

  // Fetch auth status on mount + listen for updates
  useEffect(() => {
    ipc.getAuthStatus().then(setAuthStatus)
    const cleanupAuth = ipc.onAuthUpdate((status) => {
      setAuthStatus(status as any)
    })
    // Cookie critical failure → redirect to login screen for re-authentication
    const cleanupCritical = ipc.onCookieCritical((errorMsg) => {
      addNotification({ type: 'error', message: `Cookie extraction failed: ${errorMsg} — redirecting to login...` })
      showToast(`⚠️ Cookie extraction failed — redirecting to login`)
      router.push('/settings')
    })
    return () => { cleanupAuth(); cleanupCritical() }
  }, [showToast, addNotification, router])

  // Show toast + notification when quota is exceeded
  useEffect(() => {
    if (authStatus.quotaExceeded && !quotaToastShown.current) {
      quotaToastShown.current = true
      addNotification({ type: 'warning', message: 'YouTube API quota exceeded — auto-polling tạm ngưng' })
      showToast('⚠️ YouTube API quota exceeded — auto-polling tạm ngưng')
    }
  }, [authStatus.quotaExceeded, showToast, addNotification])

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
          if (patch.downloadedAt) {
            patch.downloadedAt = formatDateRaw(patch.downloadedAt)
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
            trimLimit: data.trimLimit !== undefined ? data.trimLimit : 10,
            quality: data.quality || 1080,
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

  // Fetch poller status every 10s
  useEffect(() => {
    const interval = setInterval(() => {
      ipc.getPollerStatus().then(setPollerStatus)
    }, 10000)
    ipc.getPollerStatus().then(setPollerStatus)
    return () => clearInterval(interval)
  }, [])

  // IPC — notifications (route to NotificationCenter + show transient toast)
  useEffect(() => {
    const cleanup = window.electronAPI?.onNotification((n) => {
      const notif = n as { type: string; message: string; workspaceId?: string }
      addNotification({ type: notif.type as any, message: notif.message })
      showToast(notif.message)
    })
    return cleanup
  }, [showToast, addNotification])

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
      addNotification({ type: 'autodownload', message: `${d.channelName}: ${d.title}` })
      showToast(`Auto: ${d.title}`)
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
  }, [showToast, addNotification])


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
    downloadedPath: ws.downloadedPath,
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

  const handleAddTracker = async (url: string, trimLimit: number | 'full') => {
    showToast('Adding video...')
    try {
      const result = await ipc.addTracker(url, trimLimit)
      if (result) {
        showToast('Video queued!')
      } else {
        showToast('Failed to add video')
      }
    } catch {
      showToast('Error adding video')
    }
  }

  const handleAddChannel = async (url: string) => {
    showToast('Adding channel...')
    try {
      const result = (await ipc.addChannel(url)) as { name?: string } | null
      if (result) {
        showToast(`Channel "${result.name ?? url}" added to tracking`)
        initChannels()
      } else {
        showToast('Failed to add channel')
      }
    } catch {
      showToast('Error adding channel')
    }
  }

  const handleVideoSelect = (video: Video) => {
    selectWorkspace(video.id)
    // Load workspace's saved quality into editor state
    const ws = workspaces.find(w => w.id === video.id)
    resetEditorState()
    if (ws) {
      updateEditorState({ exportQuality: ws.quality || 1080 })
    }
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

  const handleRetry = async (id: string) => {
    showToast('Retrying download...')
    const result = await ipc.retryWorkspace(id) as { success: boolean; error?: string }
    if (result.success) {
      showToast('Download restarted')
    } else {
      showToast(`Retry failed: ${result.error}`)
    }
  }

  const handleEditorChange = (patch: Partial<EditorState>) => {
    updateEditorState(patch)
    // Sync export quality to workspace so it persists and shows in workspace queue
    if (patch.exportQuality !== undefined && selectedWorkspaceId) {
      updateWorkspace(selectedWorkspaceId, { quality: patch.exportQuality as 1080 | 720 | 360 })
    }
  }

  const handleRender = async () => {
    if (!selectedWorkspaceId) return

    const ws = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!ws || !ws.downloadedPath) {
      showToast('Video not downloaded yet — download first')
      return
    }
    if (editorState.backgroundType === 'blur' && !ws.blurBackgroundPath) {
      showToast('Blur background not ready yet — wait a few seconds')
      return
    }

    // Respect GPU MAX toggle — delegate to chunked path if enabled
    if (editorState.enableChunked) {
      await handleExportChunked()
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
    if (editorState.headerImageDiskPath) {
      overlays.push({
        type: 'header',
        src: editorState.headerImageDiskPath,
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
      export_resolution: editorState.exportQuality === 360 ? '360x640' : editorState.exportQuality === 720 ? '720x1280' : '1080x1920',
      video_speed: editorState.speedMultiplier,
      fps_target: 30,
      overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec,
      preset: editorState.exportPreset,
      tune: editorState.exportTune,
      backgroundType: editorState.backgroundType,
      backgroundColor: editorState.backgroundColor,
      backgroundImage: editorState.backgroundImageDiskPath || undefined,
      blur_background: ws.blurBackgroundPath || '',
    }

    // Update Zustand (optimistic UI)
    updateWorkspace(ws.id, { status: 'rendering', renderProgress: 0 })
    setRenderQueueExpanded(true)

    // Call IPC — main process runs FFmpeg
    try {
      const result = await ipc.startRender(ws.id, metadata) as { success: boolean; outputPath?: string; error?: string }
      if (result && !result.success) {
        updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
        addNotification({ type: 'error', message: `Render failed: ${result.error}` })
        showToast(`Render failed: ${result.error}`)
      }
      // Success is handled by onRenderProgress → workspace:update-event → Zustand
    } catch (err) {
      updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
      addNotification({ type: 'error', message: `Render error: ${(err as Error).message}` })
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
    if (editorState.backgroundType === 'blur' && !ws.blurBackgroundPath) {
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
      export_resolution: editorState.exportQuality === 360 ? '360x640' : editorState.exportQuality === 720 ? '720x1280' : '1080x1920',
      video_speed: editorState.speedMultiplier,
      fps_target: 30,
      overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec,
      preset: editorState.exportPreset,
      tune: editorState.exportTune,
      backgroundType: editorState.backgroundType,
      backgroundColor: editorState.backgroundColor,
      backgroundImage: editorState.backgroundImageDiskPath || undefined,
      blur_background: ws.blurBackgroundPath || '',
    }

    updateWorkspace(ws.id, { status: 'rendering', renderProgress: 0 })
    setRenderQueueExpanded(true)

    try {
      const result = await ipc.startChunked(ws.id, metadata, { workers: 8, chunkDuration: 120, minChunkDuration: 10 })
      if (result?.success) {
        updateWorkspace(ws.id, { status: 'done', renderProgress: 100 })
        const chunkCount = result.chunks?.length || 0
        addNotification({ type: 'success', message: `Render done (${chunkCount}x chunked): ${ws.videoTitle}` })
        showToast(`Chunked: ${chunkCount} segments rendered in parallel!`)
      } else {
        updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
        addNotification({ type: 'error', message: `Chunked failed: ${result?.error || 'unknown'}` })
        showToast(`Chunked failed: ${result?.error || 'unknown'}`)
      }
    } catch (err) {
      updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
      addNotification({ type: 'error', message: `Chunked error: ${(err as Error).message}` })
      showToast(`Chunked error: ${(err as Error).message}`)
    }
  }

  const handleCancelRender = (id: string) => {
    ipc.cancelRender(id)
    updateWorkspace(id, { status: 'ready', renderProgress: 0 })
    showToast('Render cancelled')
  }

  // ─── Pane Resize ────────────────────────────────────────────────────────────
  const handleDividerMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = typeof workspaceColWidth === 'number' ? workspaceColWidth : 400
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const delta = e.clientX - dragStartXRef.current
      const newWidth = Math.max(180, Math.min(900, dragStartWidthRef.current + delta))
      setWorkspaceColWidth(newWidth)
    }
    const onMouseUp = () => {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

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
        systemStats={systemStats}
        authStatus={authStatus}
        pollerStatus={pollerStatus}
        onLogout={handleLogout}
      />

      {/* Col 2 — Workspace Pipeline */}
      <div
        className="flex flex-col min-w-0"
        style={{
          width: typeof workspaceColWidth === 'number' ? workspaceColWidth : undefined,
          flex: typeof workspaceColWidth === 'number' ? 'none' : 1,
          borderRight: '1px solid #1E1E1E',
          position: 'relative',
        }}
      >
        <WorkspaceQueue
          workspaces={workspaces}
          selectedId={selectedWorkspaceId}
          onSelect={(id) => handleVideoSelect(videos.find(v => v.id === id)!)}
          onQuickAction={handleQuickAction}
          onAddTracker={handleAddTracker}
          onAddChannel={handleAddChannel}
          defaultTrimLimit={settings.defaultTrimLimit}
          onRetry={handleRetry}
        />

        {/* Render Queue Bar */}
        <RenderQueueBar
          workspaces={workspaces}
          isExpanded={renderQueueExpanded}
          onToggle={() => setRenderQueueExpanded(!renderQueueExpanded)}
          onCancel={handleCancelRender}
        />
      </div>

      {/* Drag handle — resize workspace column */}
      <div
        onMouseDown={handleDividerMouseDown}
        style={{
          width: 4,
          cursor: 'col-resize',
          background: isDraggingRef.current ? '#00B4FF' : 'transparent',
          transition: 'background 0.15s',
          flexShrink: 0,
          position: 'relative',
        }}
        className="group"
      >
        <div style={{
          position: 'absolute',
          top: 0,
          left: 1,
          bottom: 0,
          width: 2,
          background: '#2A2A2A',
        }} />
      </div>

      {/* Col 3 — Editor */}
      <div className="flex-1 min-w-0" style={{ overflow: 'hidden' }}>
        <DetailEditor
          video={selectedVideo}
          editorState={editorState}
          onChange={handleEditorChange}
          onRender={handleRender}
          onExportChunked={handleExportChunked}
          systemStats={systemStats}
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