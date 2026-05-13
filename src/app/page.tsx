'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sidebar } from './components/Sidebar'
import { WorkspaceQueue } from './components/workspace/WorkspaceQueue'
import { RenderQueueBar } from './components/workspace/RenderQueueBar'
import { DetailEditor } from './components/DetailEditor'
import { RenderedVideoDetail } from './components/RenderedVideoDetail'
import { LoginScreen } from './components/LoginScreen'
import type { Channel, Video, SystemStats, EditorState } from './types'
import { useAppStore, type Workspace } from './lib/store'
import { ipc } from './lib/ipc'
import { SkeletonQueue, SkeletonEditor, SkeletonChannelItem, SkeletonStyles } from './components/Skeleton'

export const dynamic = 'force-dynamic'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDurationRaw(seconds: string | number | undefined): string {
  if (!seconds) return '0:00'
  const n = typeof seconds === 'string' ? parseFloat(seconds) : seconds
  if (isNaN(n) || n <= 0) return '0:00'
  const m = Math.floor(n / 60)
  const s = Math.floor(n % 60)
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

function fmtEta(secs: number): string {
  if (!secs || secs <= 0) return ''
  if (secs < 60) return `~${Math.round(secs)}s`
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`
}

// ─── App ────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const {
    workspaces,
    renderedVideos,
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
    initRenderedVideos,
    removeRenderedVideo,
    selectWorkspace,
    updateSystemStats,
    showToast,
    addNotification,
    updateEditorState,
    resetEditorState,
    addRenderedVideo,
    settings,
    setSettings,
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
  const lastRenderCodec = useRef<string>('h264')
  const router = useRouter()
  const [renderQueueExpanded, setRenderQueueExpanded] = useState(false)
  const [keyHealth, setKeyHealth] = useState<{ exhausted: number; unauthorized: number }>({ exhausted: 0, unauthorized: 0 })
  const [selectedRenderedVideoId, setSelectedRenderedVideoId] = useState<string | null>(null)
  const [diagIssues, setDiagIssues] = useState<string[]>([])
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [isLoadingChannels, setIsLoadingChannels] = useState(true)

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

  // Sync backend settings into Zustand store on startup — fixes UI showing stale defaults
  useEffect(() => {
    ipc.getSettings().then((backendSettings: any) => {
      if (backendSettings) setSettings(backendSettings)
    })
  }, [setSettings])

  // Fetch diagnostics on mount — for demo mode banner
  useEffect(() => {
    const fetchDiag = async () => {
      try {
        const diag = await (window.electronAPI?.runDiagnostics as () => Promise<{ overall: { ready: boolean; issues: string[] } }>)()
        if (diag?.overall?.issues?.length) setDiagIssues(diag.overall.issues)
      } catch {}
    }
    fetchDiag()
  }, [])

  // Poll key health every 30s
  useEffect(() => {
    const loadKeyHealth = () => {
      ipc.getKeys().then((keys: any) => {
        const exhausted = keys.filter((k: any) => k.status === 'exhausted').length
        const unauthorized = keys.filter((k: any) => k.status === 'unauthorized').length
        setKeyHealth({ exhausted, unauthorized })
      }).catch(() => {})
    }
    loadKeyHealth()
    const t = setInterval(loadKeyHealth, 30000)
    return () => clearInterval(t)
  }, [])

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
      if (!data) {
        initWorkspaces()
        initRenderedVideos()
        return
      }
      if (!data.id) return
      const existing = useAppStore.getState().workspaces.find(w => w.id === data.id)
      if (existing) {
        const patch: Partial<Workspace> = { ...data }
        if (typeof patch.fileSize === 'number') patch.fileSize = formatFileSizeRaw(patch.fileSize)
        if (patch.downloadedAt) patch.downloadedAt = formatDateRaw(patch.downloadedAt)
        if (typeof patch.duration === 'number') patch.duration = formatDurationRaw(patch.duration)
        updateWorkspace(data.id, patch)
      } else {
        const formatted: Workspace = {
          id: data.id, channelId: data.channelId || '', channelName: (data.channelName && data.channelName !== 'N/A') ? data.channelName : 'Unknown Channel',
          channelColor: data.channelColor || '#00B4FF', videoTitle: data.videoTitle || 'Unknown',
          thumbnail: data.thumbnail || '', duration: formatDurationRaw(data.duration),
          downloadedAt: data.downloadedAt ? formatDateRaw(data.downloadedAt) : '',
          status: data.status || 'new', renderProgress: data.renderProgress,
          fileSize: typeof data.fileSize === 'number' ? formatFileSizeRaw(data.fileSize) : String(data.fileSize || ''),
          trimLimit: data.trimLimit !== undefined ? data.trimLimit : 10,
          quality: data.quality || 1080,
          downloadedPath: data.downloadedPath, blurBackgroundPath: data.blurBackgroundPath,
          outputPath: data.outputPath,
          publishedAt: data.publishedAt,
          detectedAt: data.detectedAt,
          videoResolution: data.videoResolution,
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
    Promise.all([
      initChannels().then(() => setIsLoadingChannels(false)),
      initWorkspaces(),
      initRenderedVideos(),
    ]).then(() => setIsLoadingData(false))
  }, [initChannels, initWorkspaces, initRenderedVideos])

  // Render + download progress — SINGLE global listener (no per-card listeners needed)
  useEffect(() => {
    const cleanup = window.electronAPI?.onRenderProgress((progress) => {
      const p = progress as { workspaceId: string; percent: number; eta?: number; speed?: string }
      if (!p.workspaceId || p.percent === undefined) return
      const ws = useAppStore.getState().workspaces.find(w => w.id === p.workspaceId)
      if (!ws) return
      // Update Zustand store — components read from store, no per-card listeners needed
      if (ws.status === 'rendering') {
        updateWorkspace(p.workspaceId, {
          renderProgress: p.percent,
          renderEta: p.eta ? fmtEta(p.eta) : undefined,
        })
      } else if (ws.status === 'downloading') {
        updateWorkspace(p.workspaceId, {
          downloadProgress: p.percent,
          downloadSpeed: p.speed,
          downloadEta: p.eta ? fmtEta(p.eta) : undefined,
        })
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
      addNotification({ type: 'autodownload', message: `${(d.channelName && d.channelName !== 'N/A') ? d.channelName : 'Unknown Channel'}: ${d.title}` })
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

  // Render-complete → refresh rendered videos list
  useEffect(() => {
    const cleanup = ipc.onNotification((n) => {
      const notif = n as { type: string; message: string; workspaceId?: string }
      if ((notif.type === 'success') && notif.workspaceId &&
          (notif.message?.startsWith('Done') || notif.message?.startsWith('Render done') || notif.message?.startsWith('Render xong'))) {
        // Reload list from backend so it includes thumbnailData and correct output paths
        initRenderedVideos()
      }
    })
    return cleanup
  }, [initRenderedVideos])

  // Map workspaces to videos for DetailEditor
  const videos: Video[] = workspaces.map((ws) => ({
    id: ws.id, channelId: ws.channelId, title: ws.videoTitle, thumbnail: ws.thumbnail,
    duration: ws.duration, downloadedAt: ws.downloadedAt,
    status: ws.status === 'editing' ? 'new' : ws.status === 'done' ? 'done' : ws.status === 'rendering' ? 'rendering' : 'new',
    renderProgress: ws.renderProgress, fileSize: ws.fileSize, downloadedPath: ws.downloadedPath,
    isShort: ws.isShort,
    videoResolution: ws.videoResolution,
    downloadQuality: ws.downloadQuality,
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

  const handleVideoSelect = (id: string) => {
    selectWorkspace(id)
    setSelectedRenderedVideoId(null) // clear rendered selection when selecting a workspace
    resetEditorState()
    const ws = workspaces.find(w => w.id === id)
    if (ws) updateEditorState({ exportQuality: ws.quality || 1080 })
  }

  const handleRenderedVideoSelect = (id: string | null) => {
    setSelectedRenderedVideoId(id)
    if (id) selectWorkspace(null) // clear workspace selection when selecting rendered video
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

  const handleRedownloadHd = async (id: string) => {
    showToast('Re-downloading at HD quality...')
    const result = await ipc.redownloadHd(id) as { success: boolean; error?: string }
    if (result.success) showToast('HD version downloaded')
    else showToast(`HD download failed: ${result.error}`)
  }

  const handleEditorChange = (patch: Partial<EditorState>) => {
    updateEditorState(patch)
    if (patch.exportQuality !== undefined && selectedWorkspaceId) {
      updateWorkspace(selectedWorkspaceId, { quality: patch.exportQuality as 1080 | 720 | 360 })
    }
  }

  const handleRender = async () => {
    if (!selectedWorkspaceId) return
    lastRenderCodec.current = editorState.exportCodec
    const ws = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!ws || !ws.downloadedPath) { showToast('Video not downloaded yet'); return }
    if (editorState.backgroundType === 'blur' && !ws.blurBackgroundPath) {
      // Fallback: render will use solid color if blur is not ready yet
    }

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
    if (editorState.headerImageDiskPath) {
      overlays.push({ type: 'header', src: editorState.headerImageDiskPath })
    } else if ((ws.isShort === false) && (editorState.backgroundImageDiskPath || ws.blurBackgroundPath)) {
      const thumbSrc = editorState.backgroundImageDiskPath || ws.blurBackgroundPath || ''
      overlays.push({ type: 'header', src: thumbSrc })
    }
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
      blur_background: (editorState.backgroundType === 'blur' && ws.blurBackgroundPath) ? ws.blurBackgroundPath : '',
      isShort: ws.isShort !== false,
      vidHeightPct: editorState.vidHeightPct,
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

  const handleSplit = async (workspaceId: string, partMinutes: number) => {
    showToast(`Đang tách video thành các phần...`)
    const result = await ipc.splitWorkspace(workspaceId, partMinutes)
    if (result?.success) {
      const count = result.newWorkspaces?.length || 0
      showToast(`Đã tách thành ${count} phần mới!`)
    } else {
      showToast(`Tách thất bại: ${result?.error || 'Lỗi không xác định'}`)
    }
  }

  const handleExportChunked = async () => {
    if (!selectedWorkspaceId) return
    lastRenderCodec.current = editorState.exportCodec
    const ws = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!ws || !ws.downloadedPath) { showToast('Video not downloaded yet'); return }
    if (editorState.backgroundType === 'blur' && !ws.blurBackgroundPath) {
      // Fallback: chunked render will use solid color if blur is not ready yet
    }

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
    // Use disk path (FFmpeg-readable) not blob URL
    if (editorState.headerImageDiskPath) {
      overlays.push({ type: 'header', src: editorState.headerImageDiskPath })
    } else if ((ws.isShort === false) && editorState.backgroundImageDiskPath) {
      // Landscape: header overlay = custom thumbnail image
      overlays.push({ type: 'header', src: editorState.backgroundImageDiskPath })
    }
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
      blur_background: (editorState.backgroundType === 'blur' && ws.blurBackgroundPath) ? ws.blurBackgroundPath : '',
      isShort: ws.isShort !== false,
      vidHeightPct: editorState.vidHeightPct,
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

  // Skeleton: show when initial data is loading AND auth is ready
  const showSkeleton = isLoadingData && authStatus.isReady

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

      {/* Demo mode banner — visible when logged in but OAuth not active */}
      {authStatus.isReady && !authStatus.oauthReady && authStatus.accountName === 'Demo Mode' && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          background: '#FF6B3522', borderBottom: '1px solid #FF6B3544',
          padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 10, color: '#FF6B35',
        }}>
          <span>⚡</span>
          <span style={{ flex: 1 }}>Demo Mode — Theo dõi tự động đang tắt.</span>
          <Link href="/settings" style={{ color: '#FF6B35', textDecoration: 'none', fontWeight: 600 }}>Đăng nhập →</Link>
        </div>
      )}

      {/* Diagnostics issues banner */}
      {diagIssues.length > 0 && authStatus.isReady && (
        <div style={{
          position: 'fixed', top: authStatus.accountName === 'Demo Mode' ? 28 : 0, left: 0, right: 0, zIndex: 100,
          background: '#FF444422', borderBottom: '1px solid #FF444444',
          padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 9, color: '#FF6666',
        }}>
          <span>⚠️</span>
          <span style={{ flex: 1 }}>{diagIssues[0]}</span>
          <Link href="/settings" style={{ color: '#FF6666', textDecoration: 'none', fontWeight: 600 }}>Diagnostics →</Link>
        </div>
      )}

      {/* Sidebar */}
      <Sidebar
        channels={channels}
        isLoadingChannels={isLoadingChannels}
        activeChannelId={activeChannelId || ''}
        newCounts={newCounts}
        onChannelSelect={handleChannelSelect}
        systemStats={systemStats}
        authStatus={authStatus}
        pollerStatus={pollerStatus}
        onLogout={handleLogout}
        keyHealth={keyHealth}
        settings={settings}
        onSettingsChange={async (patch) => {
          setSettings(patch)
          await ipc.updateSettings(patch)
        }}
      />

      {/* Main: workspace queue + editor */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Workspace queue */}
        <div style={{
          width: 260, borderRight: '1px solid #1E1E1E', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {showSkeleton ? (
            <SkeletonQueue />
          ) : (
            <WorkspaceQueue
            workspaces={filteredWorkspaces}
            renderedVideos={renderedVideos}
            selectedId={selectedWorkspaceId}
            selectedRenderedId={selectedRenderedVideoId}
            onSelect={(id) => handleVideoSelect(id)}
            onSelectRendered={handleRenderedVideoSelect}
            onQuickAction={handleQuickAction}
            onRetry={handleRetry}
            onRedownloadHd={handleRedownloadHd}
            onRemoveRendered={(id) => {
              if (selectedRenderedVideoId === id) setSelectedRenderedVideoId(null)
              removeRenderedVideo(id)
            }}
            onShowToast={showToast}
            onSplit={handleSplit}
            trimLimitMinutes={settings.defaultTrimLimit as number}
          />
          )}
        </div>

        {/* Editor / Rendered detail */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {showSkeleton ? (
            <SkeletonEditor />
          ) : selectedRenderedVideoId && renderedVideos.find(v => v.id === selectedRenderedVideoId) ? (
            <RenderedVideoDetail
              video={renderedVideos.find(v => v.id === selectedRenderedVideoId)!}
              onShowToast={showToast}
            />
          ) : (
            <DetailEditor
              video={selectedVideo}
              editorState={editorState}
              onChange={handleEditorChange}
              onRender={handleRender}
              onExportChunked={handleExportChunked}
              systemStats={systemStats}
              onShowToast={showToast}
              onSplit={handleSplit}
              settings={settings}
              downloadQuality={selectedVideo?.downloadQuality}
            />
          )}
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

      {/* Render queue bar */}
      <RenderQueueBar
        workspaces={workspaces}
        isExpanded={renderQueueExpanded}
        onToggle={() => setRenderQueueExpanded(v => !v)}
        onCancel={handleCancelRender}
      />

      <SkeletonStyles />
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
