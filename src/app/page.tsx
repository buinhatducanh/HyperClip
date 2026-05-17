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
  const [onboardingDone, setOnboardingDone] = useState(false)
  /** Activity log entries — deduped by workspaceId. Only one entry per video. */
  const [activityMap, setActivityMap] = useState<Map<string, ActivityEntry>>(new Map())

  // ─── Activity: stable local ETA countdown ─────────────────────────────────────
  /** Raw seconds remaining per workspace — decremented every second by interval. */
  const etaCountdownSec = useRef<Map<string, number>>(new Map())
  /** Last ETA string we displayed — skip update if unchanged. */
  const lastEtaDisplayed = useRef<Map<string, string>>(new Map())
  /** Last time we updated ETA display per workspace. */
  const lastEtaUpdateMs = useRef<Map<string, number>>(new Map())
  /** Lightweight ETA display map — only updates when rounded value changes. */
  const [etaDisplay, setEtaDisplay] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const tid = setInterval(() => {
      const now = Date.now()
      const newDisplay = new Map(etaDisplay)
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
      })

      if (changed) setEtaDisplay(newDisplay)
    }, 1000)
    return () => clearInterval(tid)
  }, [etaDisplay])

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
        if (!backendSettings.onboardingComplete && backendSettings.onboardingComplete !== undefined) {
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

  // Render + download progress — SINGLE global listener (no per-card listeners needed)
  useEffect(() => {
    const cleanup = window.electronAPI?.onRenderProgress((progress) => {
      const p = progress as { workspaceId: string; percent: number; eta?: number | string; speed?: string }
      if (!p.workspaceId || p.percent === undefined) return
      // Read CURRENT workspace status from store (not stale closure variable)
      const current = useAppStore.getState().workspaces.find(w => w.id === p.workspaceId)
      if (!current) return
      if (current.status === 'rendering') {
        updateWorkspace(p.workspaceId, {
          renderProgress: p.percent,
          renderEta: p.eta ? fmtEta(p.eta) : undefined,
        })
      } else if (current.status === 'downloading') {
        // Throttle ETA: only update if new value differs by >3s from last shown.
        // Prevents flickering when simulation/reality values oscillate between close seconds.
        const newEta = p.eta ? fmtEta(p.eta) : undefined
        let finalEta: string | undefined = undefined
        if (p.speed === 'processing') {
          // Post-processing phase — freeze bar at 99%, show "processing" status
          updateWorkspace(p.workspaceId, {
            downloadProgress: 99,
            downloadSpeed: 'processing',
            downloadEta: 'Merging…',
          })
          return
        }
        if (newEta && newEta !== '') {
          const lastEta = _lastDownloadEta.current.get(p.workspaceId)
          if (!lastEta) {
            finalEta = newEta
          } else {
            // Parse seconds from "~1m 23s" or "~73s" to compare
            const parseSec = (s: string): number => {
              const m = s.match(/~(\d+)m\s*(\d+)s/)
              if (m) return parseInt(m[1]) * 60 + parseInt(m[2])
              const sMatch = s.match(/~(\d+)s/)
              if (sMatch) return parseInt(sMatch[1])
              return -1
            }
            const lastSec = parseSec(lastEta)
            const newSec = parseSec(newEta)
            if (lastSec < 0 || newSec < 0 || Math.abs(newSec - lastSec) > 3) {
              finalEta = newEta
            } else {
              finalEta = lastEta // keep last shown value — prevents flicker
            }
          }
          if (finalEta !== undefined) _lastDownloadEta.current.set(p.workspaceId, finalEta)
        }
        updateWorkspace(p.workspaceId, {
          downloadProgress: p.percent,
          downloadSpeed: p.speed && p.speed !== '...' ? p.speed : current.downloadSpeed,
          downloadEta: finalEta,
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
      ipc.deleteWorkspace(id).then((result) => {
        const r = result as { bytesFreed?: number; filesDeleted?: number } | null
        if (r && r.bytesFreed && r.bytesFreed > 0) {
          const freedMB = (r.bytesFreed / 1024 / 1024).toFixed(1)
          showToast(`Deleted (${r.filesDeleted} files, ${freedMB} MB freed)`)
        }
      }).catch(() => {})
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
    const bottomBarH = Math.floor(canvasH * 0.10)

    const overlays: object[] = []
    if (editorState.headerImageDiskPath) {
      overlays.push({ type: 'header', src: editorState.headerImageDiskPath })
    } else if (editorState.backgroundImageDiskPath || ws.blurBackgroundPath) {
      // SHORT: thumbnail shown in header zone (above video). LANDSCAPE: thumbnail shown in header zone.
      const thumbSrc = editorState.backgroundImageDiskPath || ws.blurBackgroundPath || ''
      overlays.push({ type: 'header', src: thumbSrc })
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
      video_speed: editorState.speedMultiplier, fps_target: 30, overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec, preset: editorState.exportPreset, tune: editorState.exportTune,
      backgroundType: editorState.backgroundType, backgroundColor: editorState.backgroundColor,
      backgroundImage: editorState.backgroundImageDiskPath || undefined,
      blur_background: (editorState.backgroundType === 'blur' && ws.blurBackgroundPath) ? ws.blurBackgroundPath : '',
      isShort,
      vidHeightPct: editorState.vidHeightPct,
      bottomBarH,
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
    const bottomBarH = Math.floor(canvasH * 0.10)

    const metadata = {
      workspace_id: ws.id, source_video: ws.downloadedPath,
      export_resolution: exportRes,
      video_speed: editorState.speedMultiplier, fps_target: 30, overlays,
      trim: { start: trimStartSec, end: trimEndSec },
      codec: editorState.exportCodec, preset: editorState.exportPreset, tune: editorState.exportTune,
      backgroundType: editorState.backgroundType, backgroundColor: editorState.backgroundColor,
      backgroundImage: editorState.backgroundImageDiskPath || undefined,
      blur_background: (editorState.backgroundType === 'blur' && ws.blurBackgroundPath) ? ws.blurBackgroundPath : '',
      isShort,
      vidHeightPct: editorState.vidHeightPct,
      bottomBarH,
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
            selectedId={selectedWorkspaceId}
            selectedRenderedId={selectedRenderedVideoId}
            onSelect={(id) => handleVideoSelect(id)}
            onSelectRendered={handleRenderedVideoSelect}
            onQuickAction={handleQuickAction}
            onRetry={handleRetry}
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
