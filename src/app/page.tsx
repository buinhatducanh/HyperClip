'use client'

import { useState, useEffect, useRef, useCallback, Suspense, memo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { shallow } from 'zustand/shallow'
// SHORT layout: HEADER(25%) | VIDEO(50%) | BOTTOM(25%)
// Must match electron/services/ffmpeg.ts HEADER_PCT / BOTTOM_PCT constants.
const BOTTOM_PCT = 0.25
import { Sidebar } from './components/Sidebar'
import { WorkspaceQueue } from './components/workspace/WorkspaceQueue'
import { RenderQueueBar } from './components/workspace/RenderQueueBar'
import { DetailEditor } from './components/DetailEditor'
import { RenderedVideoDetail } from './components/RenderedVideoDetail'
import { LoginScreen } from './components/LoginScreen'
import { LicenseScreen } from './components/LicenseScreen'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import type { Channel, Video, SystemStats, EditorState } from './types'
import { useAppStore, type Workspace } from './lib/store'
import { ipc } from './lib/ipc'
import { type ActivityEntry, type ActivityType } from './components/ActivityLog'
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

/** Parse ETA value (number seconds or "M:SS" string) to raw seconds. */
function parseEtaSecs(eta: number | string | undefined | null): number | null {
  if (eta == null) return null
  if (typeof eta === 'number') return eta > 0 ? Math.round(eta) : null
  if (typeof eta === 'string' && eta.includes(':')) {
    const parts = eta.split(':')
    if (parts.length === 2) {
      const total = parseInt(parts[0]) * 60 + parseInt(parts[1])
      return total > 0 ? total : null
    }
  }
  const n = parseFloat(eta)
  return n > 0 ? Math.round(n) : null
}

function fmtEta(secs: number | string | undefined | null): string {
  if (!secs) return ''
  // Handle 'MM:SS' string format (yt-dlp / simulation output)
  if (typeof secs === 'string' && secs.includes(':')) {
    const parts = secs.split(':')
    if (parts.length === 2) {
      const m = parseInt(parts[0]) || 0
      const s = parseInt(parts[1]) || 0
      const totalSec = m * 60 + s
      if (totalSec <= 0) return ''
      if (totalSec < 60) return `~${totalSec}s`
      return `~${m}m ${s}s`
    }
  }
  // Handle numeric seconds
  const n = typeof secs === 'string' ? parseFloat(secs) : secs
  if (!n || n <= 0 || isNaN(n)) return ''
  if (n < 60) return `~${Math.round(n)}s`
  const m = Math.floor(n / 60)
  const s = Math.round(n % 60)
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`
}

// ─── App ────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-[#121212]"><div className="text-[#00B4FF] text-sm">Loading...</div></div>}>
      <DashboardContent />
    </Suspense>
  )
}

function DashboardContent() {
  // Individual selectors — each component only re-renders when its specific value changes.
  // Using shallow for arrays/objects to prevent unnecessary re-renders.
  const workspaces = useAppStore(s => s.workspaces, shallow)
  const renderedVideos = useAppStore(s => s.renderedVideos, shallow)
  const channels = useAppStore(s => s.channels, shallow)
  const selectedWorkspaceId = useAppStore(s => s.selectedWorkspaceId)
  const systemStats = useAppStore(s => s.systemStats, shallow)
  const editorState = useAppStore(s => s.editorState, shallow)
  const toast = useAppStore(s => s.toast)
  const settings = useAppStore(s => s.settings, shallow)
  // Actions — always stable references (defined once in create())
  const addWorkspace = useAppStore(s => s.addWorkspace)
  const updateWorkspace = useAppStore(s => s.updateWorkspace)
  const removeWorkspace = useAppStore(s => s.removeWorkspace)
  const initChannels = useAppStore(s => s.initChannels)
  const initWorkspaces = useAppStore(s => s.initWorkspaces)
  const initRenderedVideos = useAppStore(s => s.initRenderedVideos)
  const removeRenderedVideo = useAppStore(s => s.removeRenderedVideo)
  const selectWorkspace = useAppStore(s => s.selectWorkspace)
  const updateSystemStats = useAppStore(s => s.updateSystemStats)
  const showToast = useAppStore(s => s.showToast)
  const addNotification = useAppStore(s => s.addNotification)
  const updateEditorState = useAppStore(s => s.updateEditorState)
  const resetEditorState = useAppStore(s => s.resetEditorState)
  const undoEditor = useAppStore(s => s.undoEditor)
  const redoEditor = useAppStore(s => s.redoEditor)
  const addRenderedVideo = useAppStore(s => s.addRenderedVideo)
  const setSettings = useAppStore(s => s.setSettings)
  const setWorkspacePriority = useAppStore(s => s.setWorkspacePriority)

  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  /** License check: null = loading, true = valid, false = invalid */
  const [licenseValid, setLicenseValid] = useState<boolean | null>(null)
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
  const searchParams = useSearchParams()
  // Sync channel selection to/from URL query param
  const syncChannelToUrl = useCallback((id: string | null) => {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('channel', id)
    else url.searchParams.delete('channel')
    window.history.replaceState(null, '', url.pathname + url.search)
  }, [])
  // Read channel from URL on mount
  useEffect(() => {
    const ch = searchParams.get('channel')
    if (ch) setActiveChannelId(ch)
  }, [searchParams])

  // Keyboard shortcuts for editor undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undoEditor() }
        if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redoEditor() }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undoEditor, redoEditor])

  const [renderQueueExpanded, setRenderQueueExpanded] = useState(false)
  const [keyHealth, setKeyHealth] = useState<{ exhausted: number; unauthorized: number }>({ exhausted: 0, unauthorized: 0 })
  const [selectedRenderedVideoId, setSelectedRenderedVideoId] = useState<string | null>(null)
  const [diagIssues, setDiagIssues] = useState<string[]>([])
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [isLoadingChannels, setIsLoadingChannels] = useState(true)
  const [onboardingDone, setOnboardingDone] = useState(false)
  /** Activity log entries — deduped by workspaceId. Only one entry per video. */
  const [activityMap, setActivityMap] = useState<Map<string, ActivityEntry>>(new Map())
  /** Confirmation dialog state for destructive actions */
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel?: string; confirmDanger?: boolean; onConfirm: () => void
  } | null>(null)

  // ─── Activity: stable local ETA countdown ─────────────────────────────────────
  /** Raw seconds remaining per workspace — decremented every second by interval. */
  const etaCountdownSec = useRef<Map<string, number>>(new Map())
  /** Last ETA string we displayed — skip update if unchanged. */
  const lastEtaDisplayed = useRef<Map<string, string>>(new Map())
  /** Last time we updated ETA display per workspace. */
  const lastEtaUpdateMs = useRef<Map<string, number>>(new Map())
  /** Lightweight ETA display map — only updates when rounded value changes. */
  const [etaDisplay, setEtaDisplay] = useState<Map<string, string>>(new Map())
  /** Ref to track latest etaDisplay for use inside setInterval (avoids stale closure). */
  const etaDisplayRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    etaDisplayRef.current = etaDisplay
  }, [etaDisplay])

  useEffect(() => {
    // No dependency on etaDisplay — interval reads from ref, not closure.
    // Only recreates on mount/unmount.
    const tid = setInterval(() => {
      const now = Date.now()
      // Copy ref's current value (avoids stale closure without needing etaDisplay in deps)
      const currentDisplay = etaDisplayRef.current
      const newDisplay = new Map(currentDisplay)
      let changed = false
      const expired: string[] = []

      etaCountdownSec.current.forEach((sec, wsId) => {
        if (sec <= 0) { expired.push(wsId); return }

        etaCountdownSec.current.set(wsId, sec - 1)
        const displaySec = sec - 1
        const display = displaySec <= 0 ? 'sắp xong…' : `còn ~${fmtEta(displaySec)}`

        // Throttle: ≤10s → every 1s, ≤60s → every 5s, >60s → every 15s
        const lastUpdate = lastEtaUpdateMs.current.get(wsId) ?? 0
        const interval = displaySec <= 10 ? 1000 : displaySec <= 60 ? 5000 : 15000

        if (now - lastUpdate >= interval && lastEtaDisplayed.current.get(wsId) !== display) {
          lastEtaUpdateMs.current.set(wsId, now)
          lastEtaDisplayed.current.set(wsId, display)
          newDisplay.set(wsId, display)
          changed = true
        }
      })

      expired.forEach(id => {
        etaCountdownSec.current.delete(id)
        lastEtaDisplayed.current.delete(id)
        lastEtaUpdateMs.current.delete(id)
        newDisplay.delete(id)
        changed = true
      })

      if (changed) setEtaDisplay(newDisplay)
    }, 1000)
    return () => clearInterval(tid)
  }, [])

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

  // Redirect to onboarding if auth is ready but onboarding not complete
  useEffect(() => {
    if (authStatus.isReady && !onboardingDone) {
      router.push('/onboarding')
    }
  }, [authStatus.isReady, onboardingDone, router])

  // Sync backend settings into Zustand store on startup — fixes UI showing stale defaults
  // Redirect to onboarding if user hasn't completed setup yet
  useEffect(() => {
    ipc.getSettings().then((backendSettings: any) => {
      if (backendSettings) {
        setSettings(backendSettings)
        // Only show onboarding screen if backend explicitly says not complete
        // undefined/null = default to NOT showing onboarding (assume already done)
        if (backendSettings.onboardingComplete === false) {
          setOnboardingDone(false)
        } else {
          setOnboardingDone(true)
        }
      }
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

  // Check license status on mount — blocks app if license is invalid/expired
  useEffect(() => {
    ipc.getLicenseStatus().then((s: any) => {
      // DEMO_MODE env var auto-sets valid=true, reason='Demo mode' — proceed normally
      // Real license: valid=true → proceed; valid=false → show LicenseScreen overlay
      setLicenseValid(s.valid)
    }).catch(() => {
      // Network error — allow app to proceed (offline mode trust)
      setLicenseValid(true)
    })
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

  // Download ETA throttle — prevents flickering when ETA oscillates between close values
  const _lastDownloadEta = useRef<Map<string, string>>(new Map())

  // Activity feed — pipeline events (detected, downloading, downloaded, rendering, done)
  useEffect(() => {
    const cleanup = ipc.onActivityEvent((entry) => {
      const aEntry: ActivityEntry = {
        id: entry.id || String(Date.now()),
        timestamp: entry.timestamp || Date.now(),
        type: entry.type as ActivityType,
        message: entry.title,
        detail: entry.subtitle ? (entry.eta ? `${entry.subtitle} • ETA: ${entry.eta}` : entry.subtitle) : (entry.eta ? `ETA: ${entry.eta}` : undefined),
        workspaceId: entry.workspaceId,
      }
      setActivityMap(prev => {
        const next = new Map(prev)
        // Upsert by workspaceId — same workspaceId replaces the existing entry.
        // Falls back to entry.id only if workspaceId is absent (for backward compat).
        const key = entry.workspaceId || entry.id || aEntry.id
        next.set(key, aEntry)
        return next
      })
    })
    return cleanup
  }, [])

  // Auto-cleanup: remove terminal (done/error) entries older than 1 hour
  useEffect(() => {
    const CLEANUP_MS = 60 * 60 * 1000
    const interval = setInterval(() => {
      const now = Date.now()
      setActivityMap(prev => {
        const next = new Map(prev)
        let changed = false
        for (const [key, entry] of next) {
          if ((entry.type === 'done' || entry.type === 'error') && (now - entry.timestamp) > CLEANUP_MS) {
            next.delete(key)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 30_000) // check every 30s
    return () => clearInterval(interval)
  }, [])

  // Load initial data
  useEffect(() => {
    Promise.all([
      initChannels().then(() => setIsLoadingChannels(false)),
      initWorkspaces(),
      initRenderedVideos(),
    ]).then(() => setIsLoadingData(false))
  }, [initChannels, initWorkspaces, initRenderedVideos])

  // Expose reload function so Sidebar can refresh channels after adding
  useEffect(() => {
    ;(window as any).__reloadChannels = () => initChannels()
    return () => { delete (window as any).__reloadChannels }
  }, [initChannels])

  // Separate Maps for render vs download progress — avoids status race conditions.
  // Status check at FLUSH time (not event time) ensures correct routing.
  const _pendingRender = useRef<Map<string, { percent: number; eta?: number | string }>>(new Map())
  const _pendingDownload = useRef<Map<string, { percent: number }>>(new Map())
  const _lastFlushMs = useRef<number>(0)

  useEffect(() => {
    // Flush pending progress updates every 500ms (max 2 Zustand updates/sec)
    const flushInterval = setInterval(() => {
      const now = Date.now()
      if (now - _lastFlushMs.current < 450) return
      _lastFlushMs.current = now

      // Route render progress
      _pendingRender.current.forEach((data, wsId) => {
        updateWorkspace(wsId, {
          renderProgress: data.percent,
          renderEta: data.eta ? fmtEta(data.eta) : undefined,
        } as Partial<Workspace>)
      })
      _pendingRender.current.clear()

      // Route download progress — check status at flush time (not event time) to avoid race
      _pendingDownload.current.forEach((data, wsId) => {
        const ws = useAppStore.getState().workspaces.find(w => w.id === wsId)
        if (ws?.status === 'downloading') {
          updateWorkspace(wsId, {
            downloadProgress: data.percent,
          } as Partial<Workspace>)
        }
      })
      _pendingDownload.current.clear()
    }, 500)

    const cleanup = window.electronAPI?.onRenderProgress((progress) => {
      const p = progress as { workspaceId: string; percent: number; eta?: number | string; speed?: string }
      if (!p.workspaceId || p.percent === undefined) return
      const current = useAppStore.getState().workspaces.find(w => w.id === p.workspaceId)
      if (!current) return
      if (current.status === 'rendering') {
        _pendingRender.current.set(p.workspaceId, { percent: p.percent, eta: p.eta })
      } else if (current.status === 'downloading') {
        if (p.speed === 'processing') {
          updateWorkspace(p.workspaceId, {
            downloadProgress: 99,
            downloadSpeed: 'processing',
            downloadEta: 'Merging…',
          })
          return
        }
        // Speed + ETA update immediately for responsive UX
        if (p.speed || p.eta !== undefined) {
          updateWorkspace(p.workspaceId, {
            downloadSpeed: p.speed && p.speed !== '...' ? p.speed : undefined,
            downloadEta: p.eta ? fmtEta(p.eta) : undefined,
          } as Partial<Workspace>)
        }
        // Percentage batched to avoid excessive React re-renders
        _pendingDownload.current.set(p.workspaceId, { percent: p.percent })
      }
    })
    return () => { clearInterval(flushInterval); cleanup?.() }
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

  // Render-complete → add rendered video to list via IPC event
  useEffect(() => {
    const cleanup = window.electronAPI?.onRenderedAdd((video) => {
      const rv = video as { id: string; workspaceId?: string; videoTitle?: string; archivedPath?: string; thumbnail?: string; thumbnailData?: string; duration?: number; fileSize?: number; renderedAt?: string; codec?: string; quality?: number }
      if (rv?.id) {
        // Prepend to the list (most recent first)
        useAppStore.setState((s) => ({ renderedVideos: [rv as any, ...s.renderedVideos] }))
      }
    })
    return cleanup ?? (() => {})
  }, [])

  // ─── Activity feed ─────────────────────────────────────────────────────────────
  /**
   * Upsert an activity entry. Each workspaceId gets exactly ONE entry at a time.
   * Terminal states (done, error): entry stays permanently.
   * Non-terminal states: replaced when the same workspace progresses.
   */
  function upsertActivity(
    workspaceId: string,
    type: ActivityType,
    message: string,
    detail?: string,
    terminal = false,
  ) {
    setActivityMap(prev => {
      const next = new Map(prev)
      const existing = next.get(workspaceId)
      if (existing && (existing.type === 'done' || existing.type === 'error') && !terminal) {
        return prev
      }
      next.set(workspaceId, {
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: Date.now(),
        type,
        message,
        detail,
        workspaceId,
      })
      if (next.size > 8) {
        const oldest = [...next.entries()].slice(0, next.size - 8)
        oldest.forEach(([k]) => next.delete(k))
      }
      return next
    })
  }

  // Auto-download: phát hiện video mới
  useEffect(() => {
    const cleanup = ipc.onAutoDownload((data) => {
      const d = data as { videoId: string; title: string; channelName: string; workspaceId?: string }
      if (!d.workspaceId) return
      upsertActivity(d.workspaceId, 'detected', `Phát hiện video mới: ${d.title}`, undefined, false)
      // Seed ETA countdown with default 60s until render progress provides real ETA
      etaCountdownSec.current.set(d.workspaceId, 60)
      lastEtaDisplayed.current.set(d.workspaceId, '')
      lastEtaUpdateMs.current.set(d.workspaceId, 0)
    })
    return cleanup
  }, [])

  // Download / render progress: update activity and seed/refresh ETA countdown
  useEffect(() => {
    const cleanup = ipc.onRenderProgress((progress) => {
      const p = progress as { workspaceId: string; percent: number; eta?: number | string }
      if (!p.workspaceId) return
      const ws = useAppStore.getState().workspaces.find(w => w.id === p.workspaceId)
      if (!ws) return

      // Seed or refresh ETA countdown from backend ETA
      const etaSecs = parseEtaSecs(p.eta)
      if (etaSecs !== null) {
        etaCountdownSec.current.set(p.workspaceId, etaSecs)
        lastEtaDisplayed.current.set(p.workspaceId, '')
        lastEtaUpdateMs.current.set(p.workspaceId, 0)
      }

      if (ws.status === 'downloading') {
        upsertActivity(
          p.workspaceId, 'downloading',
          `Đang tải video về`,
          `📁 ${ws.videoTitle}`,
        )
      } else if (ws.status === 'rendering') {
        upsertActivity(
          p.workspaceId, 'rendering',
          `Đang xử lý video`,
          `📁 ${ws.videoTitle}`,
        )
      }
    })
    return cleanup
  }, [])

  // Notifications: tải xong / render xong / lỗi
  useEffect(() => {
    const cleanup = ipc.onNotification((n) => {
      const notif = n as {
        type: string; message: string
        workspaceId?: string; outputPath?: string; fileSize?: number
      }
      if (!notif.workspaceId) return
      const ws = useAppStore.getState().workspaces.find(w => w.id === notif.workspaceId)
      const title = ws?.videoTitle || 'Video'
      const msg = notif.message || ''

      if (notif.type === 'success') {
        if (
          msg.startsWith('Auto-ready') || msg.startsWith('Download done') ||
          msg.startsWith('Download xong') || msg.includes('Download done')
        ) {
          const size = notif.fileSize
            ? notif.fileSize > 1024 * 1024
              ? `${(notif.fileSize / (1024 * 1024)).toFixed(0)}MB`
              : `${(notif.fileSize / 1024).toFixed(0)}KB`
            : null
          upsertActivity(
            notif.workspaceId, 'downloaded',
            size ? `Tải video hoàn tất — ${size}` : `Tải video hoàn tất`,
            `📁 ${title}`,
            false,
          )
          etaCountdownSec.current.delete(notif.workspaceId)
          lastEtaDisplayed.current.delete(notif.workspaceId)
          lastEtaUpdateMs.current.delete(notif.workspaceId)
          return
        }
        if (msg.startsWith('Done') || msg.startsWith('Render done') || msg.startsWith('Render xong')) {
          const fileName = notif.outputPath
            ? notif.outputPath.split(/[/\\]/).pop()
                ?.replace(/_chunked_output\.mp4|_output\.mp4/, '.mp4')
            : null
          upsertActivity(
            notif.workspaceId, 'done',
            fileName
              ? `Xuất video thành công → ${fileName}`
              : `Xuất video thành công`,
            `📁 ${title}`,
            true,
          )
          etaCountdownSec.current.delete(notif.workspaceId)
          lastEtaDisplayed.current.delete(notif.workspaceId)
          lastEtaUpdateMs.current.delete(notif.workspaceId)
          return
        }
      }

      if (notif.type === 'error') {
        upsertActivity(
          notif.workspaceId, 'error',
          `Có lỗi xảy ra`,
          notif.message.slice(0, 60),
          true,
        )
        etaCountdownSec.current.delete(notif.workspaceId)
        lastEtaDisplayed.current.delete(notif.workspaceId)
        lastEtaUpdateMs.current.delete(notif.workspaceId)
      }
    })
    return cleanup
  }, [])

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
    const newId = id || null
    setActiveChannelId(newId)
    syncChannelToUrl(newId)
    selectWorkspace(null)
    resetEditorState()
  }

  const handleVideoSelect = (id: string) => {
    selectWorkspace(id)
    setSelectedRenderedVideoId(null) // clear rendered selection when selecting a workspace
    resetEditorState()
    const ws = workspaces.find(w => w.id === id)
    if (ws) {
      updateEditorState({ exportQuality: ws.quality || 1080 })
      // Clear previous formats immediately to avoid stale flash
      updateWorkspace(id, { availableFormats: undefined })
      // Probe YouTube available formats for quality validation UI
      if (ws.videoId && ws.videoUrl) {
        let settled = false // prevents fallback → probe race overwriting a valid result
        const probeTimeout = setTimeout(() => {
          settled = true // don't let slow probe overwrite fallback
          // Slow probe (>3s) — show all options as fallback
          updateWorkspace(id, { availableFormats: [360, 720, 1080] })
        }, 3000)
        ipc.getAvailableFormats(ws.videoId, ws.videoUrl).then(result => {
          clearTimeout(probeTimeout)
          if (result && result.heights.length > 0 && !settled) {
            updateWorkspace(id, { availableFormats: result.heights })
          }
        }).catch(() => {
          clearTimeout(probeTimeout)
          // Probe failed — show all options as fallback so buttons always render.
          // maxAllowedHeight in ControlsPanel caps by sourceHeight when known;
          // without YouTube data we trust the user's downloadQuality setting to guide the cap.
          updateWorkspace(id, { availableFormats: [360, 720, 1080] })
        })
      }
    }
  }

  const handleRenderedVideoSelect = (id: string | null) => {
    setSelectedRenderedVideoId(id)
    if (id) selectWorkspace(null) // clear workspace selection when selecting rendered video
  }

  const handleQuickAction = (action: 'open' | 'delete', id: string) => {
    if (action === 'delete') {
      const ws = workspaces.find(w => w.id === id)
      setConfirmDialog({
        title: 'Xóa video',
        message: `Bạn có chắc muốn xóa "${ws?.videoTitle ?? 'video này'}"? File sẽ bị xóa vĩnh viễn khỏi ổ cứng.`,
        confirmLabel: 'Xóa',
        confirmDanger: true,
        onConfirm: () => {
          setConfirmDialog(null)
          removeWorkspace(id)
          ipc.deleteWorkspace(id).then((result) => {
            const r = result as { bytesFreed?: number; filesDeleted?: number } | null
            if (r && r.bytesFreed && r.bytesFreed > 0) {
              const freedMB = (r.bytesFreed / 1024 / 1024).toFixed(1)
              showToast(`Đã xóa (${r.filesDeleted} files, ${freedMB} MB freed)`)
            }
          }).catch(() => {})
        },
      })
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

  const handlePriorityChange = (id: string, direction: 'up' | 'down', type: 'download' | 'render') => {
    const { workspaces: allWorkspaces, setWorkspacePriority: setPriority, showToast: toast } = useAppStore.getState()
    const ws = allWorkspaces.find(w => w.id === id)
    if (!ws) return
    const current = type === 'download'
      ? (ws.downloadPriority ?? 0)
      : (ws.renderPriority ?? 0)
    const delta = direction === 'up' ? -1 : 1
    setPriority(id, current + delta, type)
    toast(direction === 'up' ? `↑ Ưu tiên cao hơn` : `↓ Ưu tiên thấp hơn`)
  }

  const handleEditorChange = useCallback((patch: Partial<EditorState>) => {
    // Use getState() inside callback to avoid closure dependencies on Zustand state.
    // This keeps the callback reference stable across renders.
    const { editorState: currentEditor, workspaces: allWorkspaces, selectedWorkspaceId: currentWsId, updateEditorState: updateEd, updateWorkspace: updateWs } = useAppStore.getState()

    // Auto-upgrade to 720p when TikTok mode is toggled ON (false → true) and source is below 720p
    if (patch.upscaleToTikTok === true && currentEditor.upscaleToTikTok === false) {
      const ws = allWorkspaces.find(w => w.id === currentWsId)
      const sourceHeight = ws?.videoResolution ? parseInt(ws.videoResolution.split('x')[1]) : (ws?.downloadQuality ? parseInt(ws.downloadQuality) : 0)
      if (sourceHeight > 0 && sourceHeight < 720 && currentEditor.exportQuality < 720) {
        patch = { ...patch, exportQuality: 720 as 1080 | 720 | 360 }
        useAppStore.getState().showToast(`Upscale: 360p → 720p for TikTok`)
      }
    }
    updateEd(patch)
    if (patch.exportQuality !== undefined && currentWsId) {
      updateWs(currentWsId, { quality: patch.exportQuality as 1080 | 720 | 360 })
    }
  }, [])

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

    const exportRes = editorState.exportQuality === 360 ? '360x640' : editorState.exportQuality === 720 ? '720x1280' : '1080x1920'
    const canvasH = parseInt(exportRes.split('x')[1])
    const bottomBarH = Math.floor(canvasH * BOTTOM_PCT)

    const overlays: object[] = []
    if (editorState.headerImageDiskPath) {
      overlays.push({ type: 'header', src: editorState.headerImageDiskPath })
    } else if (editorState.backgroundImageDiskPath) {
      // Custom background image → use as header overlay
      overlays.push({ type: 'header', src: editorState.backgroundImageDiskPath })
    } else {
      // No custom image → header overlay will be filled with thumbnail disk path in executeRenderJob
      // Empty src signals "use thumbnail fallback" (executeRenderJob checks fs.existsSync(wsThumbPath))
      overlays.push({ type: 'header', src: '' })
    }
    const isShort = ws.isShort !== false
    // SHORT mode + bottom bar: title text goes to bottom bar, not as video overlay
    if (editorState.titleText && !(isShort && editorState.bottomBarEnabled)) {
      overlays.push({
        type: 'title', content: editorState.titleText, shape: editorState.titleShape,
        borderColor: editorState.titleBorderColor, bgColor: editorState.titleBgColor, fontSize: editorState.titleFontSize,
      })
    }
    // SHORT mode: add title text to bottom bar if enabled
    if (isShort && editorState.bottomBarEnabled && editorState.titleText) {
      overlays.push({
        type: 'title', content: editorState.titleText,
        borderColor: editorState.bottomBarColor,
      })
    }

    const metadata = {
      workspace_id: ws.id, source_video: ws.downloadedPath,
      export_resolution: exportRes,
      video_speed: editorState.speedMultiplier, fps_target: editorState.exportFPS, overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec, preset: editorState.exportPreset, tune: editorState.exportTune,
      backgroundType: editorState.backgroundType, backgroundColor: editorState.backgroundColor,
      backgroundImage: editorState.backgroundImageDiskPath || undefined,
      blur_background: (editorState.backgroundType === 'blur' && ws.blurBackgroundPath) ? ws.blurBackgroundPath : '',
      isShort,
      vidHeightPct: editorState.vidHeightPct,
      bottomBarH,
      bottomBarColor: editorState.bottomBarColor,
      bottomBarEnabled: editorState.bottomBarEnabled,
      upscaleToTikTok: editorState.upscaleToTikTok,
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
    const result = await ipc.splitWorkspace(workspaceId, { partMinutes })
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
    const isShort = ws.isShort !== false
    // SHORT mode + bottom bar: title text goes to bottom bar, not as video overlay
    if (editorState.titleText && !(isShort && editorState.bottomBarEnabled)) {
      overlays.push({
        type: 'title', content: editorState.titleText, shape: editorState.titleShape,
        borderColor: editorState.titleBorderColor, bgColor: editorState.titleBgColor, fontSize: editorState.titleFontSize,
      })
    }
    // SHORT mode: add title text to bottom bar if enabled
    if (isShort && editorState.bottomBarEnabled && editorState.titleText) {
      overlays.push({
        type: 'title', content: editorState.titleText,
        borderColor: editorState.bottomBarColor,
      })
    }

    const exportRes = editorState.exportQuality === 360 ? '360x640' : editorState.exportQuality === 720 ? '720x1280' : '1080x1920'
    const canvasH = parseInt(exportRes.split('x')[1])
    const bottomBarH = Math.floor(canvasH * BOTTOM_PCT)

    const metadata = {
      workspace_id: ws.id, source_video: ws.downloadedPath,
      export_resolution: exportRes,
      video_speed: editorState.speedMultiplier, fps_target: editorState.exportFPS, overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec, preset: editorState.exportPreset, tune: editorState.exportTune,
      backgroundType: editorState.backgroundType, backgroundColor: editorState.backgroundColor,
      backgroundImage: editorState.backgroundImageDiskPath || undefined,
      blur_background: (editorState.backgroundType === 'blur' && ws.blurBackgroundPath) ? ws.blurBackgroundPath : '',
      isShort,
      vidHeightPct: editorState.vidHeightPct,
      bottomBarH,
      bottomBarColor: editorState.bottomBarColor,
      bottomBarEnabled: editorState.bottomBarEnabled,
      upscaleToTikTok: editorState.upscaleToTikTok,
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
      {/* License activation — blocks entire app until valid license activated */}
      {licenseValid === false && <LicenseScreen />}

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
        activityEntries={[...activityMap.values()].reverse()}
        etaDisplay={etaDisplay}
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
            channels={channels}
            selectedId={selectedWorkspaceId}
            selectedRenderedId={selectedRenderedVideoId}
            onSelect={(id) => handleVideoSelect(id)}
            onSelectRendered={handleRenderedVideoSelect}
            onQuickAction={handleQuickAction}
            onRetry={handleRetry}
            onPriorityChange={handlePriorityChange}
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
              availableFormats={selectedVideo?.availableFormats}
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
        autoRenderEnabled={settings.autoRender}
        onAutoRenderToggle={(enabled) => {
          setSettings({ autoRender: enabled })
          ipc.updateSettings({ autoRender: enabled })
          showToast(enabled ? 'Auto-render ON — video sẽ tự render sau khi download' : 'Auto-render OFF')
        }}
      />

      <SkeletonStyles />

      {/* Confirmation dialog for destructive actions */}
      <ConfirmationDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmDanger={confirmDialog?.confirmDanger}
        onConfirm={confirmDialog?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmDialog(null)}
      />

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
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
