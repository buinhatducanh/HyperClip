'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from './components/Sidebar'
import { WorkspaceQueue } from './components/workspace/WorkspaceQueue'
import { DetailEditor } from './components/DetailEditor'
import { LoginScreen } from './components/LoginScreen'
import type { Channel, Video, SystemStats, EditorState } from './types'
import { useAppStore, type Workspace } from './lib/store'
import { ipc } from './lib/ipc'

export const dynamic = 'force-dynamic'

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

// ─── App ────────────────────────────────────────────────────────────────────────

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
    settings,
  } = useAppStore()

  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<{
    isReady: boolean; cookieCount: number; loggedOut: boolean; accountName: string
    oauthReady: boolean; quotaExceeded?: boolean
  }>({ isReady: false, cookieCount: 0, loggedOut: true, accountName: '', oauthReady: false })
  const [pollerStatus, setPollerStatus] = useState<{
    active: boolean; newVideoCount: number; lastError: string | null
  } | null>(null)
  const quotaToastShown = useRef(false)
  const router = useRouter()

  // Fetch auth status on mount + listen for updates
  useEffect(() => {
    ipc.getAuthStatus().then(setAuthStatus)
    const cleanupAuth = ipc.onAuthUpdate((status) => setAuthStatus(status as any))
    const cleanupCritical = ipc.onCookieCritical((errorMsg) => {
      addNotification({ type: 'error', message: `Cookie extraction failed: ${errorMsg}` })
      showToast(`Cookie extraction failed — redirecting to settings`)
      router.push('/settings')
    })
    return () => { cleanupAuth(); cleanupCritical() }
  }, [showToast, addNotification, router])

  // Quota exceeded notification
  useEffect(() => {
    if (authStatus.quotaExceeded && !quotaToastShown.current) {
      quotaToastShown.current = true
      addNotification({ type: 'warning', message: 'YouTube API quota exceeded — auto-polling tạm ngưng' })
      showToast('YouTube API quota exceeded')
    }
  }, [authStatus.quotaExceeded, showToast, addNotification])

  // Re-fetch channels when OAuth subscriptions synced
  useEffect(() => {
    const cleanup = ipc.onChannelSynced(() => initChannels())
    return cleanup
  }, [initChannels])

  // Sync IPC workspace updates into Zustand
  useEffect(() => {
    const cleanup = ipc.onWorkspaceUpdate((ws) => {
      const data = ws as any
      if (!data.id) return
      const existing = useAppStore.getState().workspaces.find(w => w.id === data.id)
      if (existing) {
        const patch: Partial<Workspace> = { ...data }
        if (typeof patch.fileSize === 'number') patch.fileSize = formatFileSizeRaw(patch.fileSize)
        if (patch.downloadedAt) patch.downloadedAt = formatDateRaw(patch.downloadedAt)
        updateWorkspace(data.id, patch)
      } else {
        const formatted: Workspace = {
          id: data.id, channelId: data.channelId || '', channelName: data.channelName || '',
          channelColor: data.channelColor || '#00B4FF', videoTitle: data.videoTitle || 'Unknown',
          thumbnail: data.thumbnail || '', duration: formatDurationRaw(data.duration),
          downloadedAt: data.downloadedAt ? formatDateRaw(data.downloadedAt) : '',
          status: data.status || 'new', renderProgress: data.renderProgress,
          fileSize: typeof data.fileSize === 'number' ? formatFileSizeRaw(data.fileSize) : String(data.fileSize || ''),
          trimLimit: data.trimLimit !== undefined ? data.trimLimit : 10,
          quality: data.quality || 1080,
          downloadedPath: data.downloadedPath, blurBackgroundPath: data.blurBackgroundPath,
          outputPath: data.outputPath,
        }
        addWorkspace(formatted)
      }
    })
    return cleanup
  }, [updateWorkspace, addWorkspace])

  // System stats
  useEffect(() => {
    const cleanup = window.electronAPI?.onSystemStats((stats) => {
      if (stats) updateSystemStats(stats as SystemStats)
    })
    return cleanup
  }, [updateSystemStats])

  // Poller status
  useEffect(() => {
    const interval = setInterval(() => ipc.getPollerStatus().then(setPollerStatus), 10000)
    ipc.getPollerStatus().then(setPollerStatus)
    return () => clearInterval(interval)
  }, [])

  // Notifications
  useEffect(() => {
    const cleanup = window.electronAPI?.onNotification((n) => {
      const notif = n as { type: string; message: string }
      addNotification({ type: notif.type as any, message: notif.message })
      showToast(notif.message)
    })
    return cleanup
  }, [showToast, addNotification])

  // Load initial data
  useEffect(() => {
    initChannels()
    initWorkspaces()
  }, [initChannels, initWorkspaces])

  // Render + download progress
  useEffect(() => {
    const cleanup = window.electronAPI?.onRenderProgress((progress) => {
      const p = progress as { workspaceId: string; percent: number }
      if (p.workspaceId && p.percent !== undefined) {
        const ws = useAppStore.getState().workspaces.find(w => w.id === p.workspaceId)
        const patch = ws?.status === 'downloading'
          ? { downloadProgress: p.percent }
          : { renderProgress: p.percent }
        updateWorkspace(p.workspaceId, patch)
      }
    })
    return cleanup
  }, [updateWorkspace])

  // Quick-add from tray
  useEffect(() => {
    const cleanup = ipc.onQuickAdd(() => {
      const input = document.querySelector('input[placeholder*="YouTube"]') as HTMLInputElement
      input?.focus()
    })
    return cleanup
  }, [])

  // Auto-download notification
  useEffect(() => {
    const cleanup = ipc.onAutoDownload((data) => {
      const d = data as { videoId: string; title: string; channelName: string }
      addNotification({ type: 'autodownload', message: `${d.channelName}: ${d.title}` })
      showToast(`Auto: ${d.title}`)
      try {
        const ctx = new AudioContext()
        const notes = [523.25, 659.25, 783.99]
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination)
          osc.frequency.value = freq; osc.type = 'sine'
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
    id: ws.id, channelId: ws.channelId, title: ws.videoTitle, thumbnail: ws.thumbnail,
    duration: ws.duration, downloadedAt: ws.downloadedAt,
    status: ws.status === 'editing' ? 'new' : ws.status === 'done' ? 'done' : ws.status === 'rendering' ? 'rendering' : 'new',
    renderProgress: ws.renderProgress, fileSize: ws.fileSize, downloadedPath: ws.downloadedPath,
    isShort: ws.isShort,
  }))

  const newCounts: Record<string, number> = {}
  channels.forEach((ch) => {
    newCounts[ch.id] = workspaces.filter(v => v.channelId === ch.id && v.status === 'ready').length
  })

  // Handlers
  const handleChannelSelect = (id: string) => {
    setActiveChannelId(id || null)
    selectWorkspace(null)
    resetEditorState()
  }

  const handleAddTracker = async (url: string, trimLimit: number | 'full') => {
    showToast('Adding video...')
    try {
      const result = await ipc.addTracker(url, trimLimit)
      if (result) showToast('Video queued!')
      else showToast('Failed to add video')
    } catch { showToast('Error adding video') }
  }

  const handleAddChannel = async (url: string) => {
    showToast('Adding channel...')
    try {
      const result = (await ipc.addChannel(url)) as { name?: string } | null
      if (result) { showToast(`Channel "${result.name ?? url}" added`); initChannels() }
      else showToast('Failed to add channel')
    } catch { showToast('Error adding channel') }
  }

  const handleVideoSelect = (id: string) => {
    selectWorkspace(id)
    resetEditorState()
    const ws = workspaces.find(w => w.id === id)
    if (ws) updateEditorState({ exportQuality: ws.quality || 1080 })
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
    if (result.success) showToast('Download restarted')
    else showToast(`Retry failed: ${result.error}`)
  }

  const handleEditorChange = (patch: Partial<EditorState>) => {
    updateEditorState(patch)
    if (patch.exportQuality !== undefined && selectedWorkspaceId) {
      updateWorkspace(selectedWorkspaceId, { quality: patch.exportQuality as 1080 | 720 | 360 })
    }
  }

  const handleRender = async () => {
    if (!selectedWorkspaceId) return
    const ws = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!ws || !ws.downloadedPath) { showToast('Video not downloaded yet'); return }
    if (editorState.backgroundType === 'blur' && !ws.blurBackgroundPath) { showToast('Blur background not ready yet'); return }

    const parseDur = (d: string): number => {
      const parts = d.split(':').map(Number)
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
      if (parts.length === 2) return parts[0] * 60 + parts[1]
      return parseFloat(d) || 0
    }
    const totalSec = parseDur(ws.duration)
    const trimStartSec = Math.round((editorState.trimStart / 100) * totalSec)
    const trimEndSec = Math.round((editorState.trimEnd / 100) * totalSec)

    const overlays: object[] = []
    if (editorState.headerImageDiskPath) overlays.push({ type: 'header', src: editorState.headerImageDiskPath })
    if (editorState.titleText) overlays.push({
      type: 'title', content: editorState.titleText, shape: editorState.titleShape,
      borderColor: editorState.titleBorderColor, bgColor: editorState.titleBgColor, fontSize: editorState.titleFontSize,
    })

    const metadata = {
      workspace_id: ws.id, source_video: ws.downloadedPath,
      export_resolution: editorState.exportQuality === 360 ? '360x640' : editorState.exportQuality === 720 ? '720x1280' : '1080x1920',
      video_speed: editorState.speedMultiplier, fps_target: 30, overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec, preset: editorState.exportPreset, tune: editorState.exportTune,
      backgroundType: editorState.backgroundType, backgroundColor: editorState.backgroundColor,
      backgroundImage: editorState.backgroundImageDiskPath || undefined,
      blur_background: ws.blurBackgroundPath || '',
      isShort: ws.isShort !== false,
    }

    updateWorkspace(ws.id, { status: 'rendering', renderProgress: 0 })
    try {
      const result = await ipc.startRender(ws.id, metadata) as { success: boolean; outputPath?: string; error?: string }
      if (result && !result.success) {
        updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
        addNotification({ type: 'error', message: `Render failed: ${result.error}` })
        showToast(`Render failed: ${result.error}`)
      }
    } catch (err) {
      updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
      addNotification({ type: 'error', message: `Render error: ${(err as Error).message}` })
      showToast(`Render error: ${(err as Error).message}`)
    }
  }

  const handleExportChunked = async () => {
    if (!selectedWorkspaceId) return
    const ws = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!ws || !ws.downloadedPath) { showToast('Video not downloaded yet'); return }
    if (editorState.backgroundType === 'blur' && !ws.blurBackgroundPath) { showToast('Blur background not ready'); return }

    const parseDur = (d: string): number => {
      const parts = d.split(':').map(Number)
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
      if (parts.length === 2) return parts[0] * 60 + parts[1]
      return parseFloat(d) || 0
    }
    const totalSec = parseDur(ws.duration)
    const trimStartSec = Math.round((editorState.trimStart / 100) * totalSec)
    const trimEndSec = Math.round((editorState.trimEnd / 100) * totalSec)

    const overlays: object[] = []
    if (editorState.headerImageUrl) overlays.push({ type: 'header', src: editorState.headerImageUrl })
    if (editorState.titleText) overlays.push({
      type: 'title', content: editorState.titleText, shape: editorState.titleShape,
      borderColor: editorState.titleBorderColor, bgColor: editorState.titleBgColor, fontSize: editorState.titleFontSize,
    })

    const metadata = {
      workspace_id: ws.id, source_video: ws.downloadedPath,
      export_resolution: editorState.exportQuality === 360 ? '360x640' : editorState.exportQuality === 720 ? '720x1280' : '1080x1920',
      video_speed: editorState.speedMultiplier, fps_target: 30, overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec, preset: editorState.exportPreset, tune: editorState.exportTune,
      backgroundType: editorState.backgroundType, backgroundColor: editorState.backgroundColor,
      backgroundImage: editorState.backgroundImageDiskPath || undefined,
      blur_background: ws.blurBackgroundPath || '',
      isShort: ws.isShort !== false,
    }

    updateWorkspace(ws.id, { status: 'rendering', renderProgress: 0 })
    try {
      const result = await ipc.startChunked(ws.id, metadata, { workers: 8, chunkDuration: 120, minChunkDuration: 10 })
      if (result?.success) {
        updateWorkspace(ws.id, { status: 'done', renderProgress: 100 })
        addNotification({ type: 'success', message: `Render done: ${ws.videoTitle}` })
        showToast('Chunked render complete')
      } else {
        updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
        addNotification({ type: 'error', message: `Chunked failed: ${result?.error}` })
        showToast(`Chunked failed: ${result?.error}`)
      }
    } catch (err) {
      updateWorkspace(ws.id, { status: 'ready', renderProgress: 0 })
      addNotification({ type: 'error', message: `Chunked error: ${(err as Error).message}` })
      showToast('Chunked error')
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

  // Filter workspaces by active channel
  const filteredWorkspaces = activeChannelId
    ? workspaces.filter(w => w.channelId === activeChannelId)
    : workspaces

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0E0E0E', fontFamily: 'Inter, sans-serif', color: '#fff', overflow: 'hidden' }}>
      {/* Login screen */}
      {!authStatus.isReady && (
        <LoginScreen accountName={authStatus.accountName} oauthReady={authStatus.oauthReady} onLogout={handleLogout} />
      )}

      {/* Sidebar */}
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

      {/* Main: workspace queue + editor */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Workspace queue */}
        <div style={{
          width: 260, borderRight: '1px solid #1E1E1E', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', flexShrink: 0,
        }}>
          <WorkspaceQueue
            workspaces={filteredWorkspaces}
            selectedId={selectedWorkspaceId}
            onSelect={(id) => handleVideoSelect(id)}
            onQuickAction={handleQuickAction}
            onAddTracker={handleAddTracker}
            onAddChannel={handleAddChannel}
            defaultTrimLimit={settings.defaultTrimLimit}
            onRetry={handleRetry}
          />
        </div>

        {/* Editor */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <DetailEditor
            video={selectedVideo}
            editorState={editorState}
            onChange={handleEditorChange}
            onRender={handleRender}
            onExportChunked={handleExportChunked}
            systemStats={systemStats}
          />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: '#1A1A1A',
          border: '1px solid #2A2A2A',
          borderLeft: '3px solid #00B4FF',
          borderRadius: 4, padding: '10px 16px',
          fontSize: 12, color: '#ccc', zIndex: 9999,
          maxWidth: 320,
          animation: 'toastIn 0.2s ease',
        }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #333; }
        input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; }
        textarea { box-sizing: border-box; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
