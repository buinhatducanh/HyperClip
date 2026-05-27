'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { shallow } from 'zustand/shallow'
import { Sidebar } from './components/Sidebar'
import { WorkspaceQueue } from './components/workspace/WorkspaceQueue'
import { RenderedVideoDetail } from './components/RenderedVideoDetail'
import { LoginScreen } from './components/LoginScreen'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import { VideoCompareModal } from './components/VideoCompareModal'
import { TopBar } from './components/TopBar'
import { SettingsPanel } from './components/SettingsPanel'
import { ActivityLogPanel } from './components/ActivityLogPanel'
import { VideoDetailPanel } from './components/VideoDetailPanel'
import type { Channel, SystemStats } from './types'
import { useAppStore, type Workspace } from './lib/store'
import { ipc } from './lib/ipc'
import { type ActivityEntry, type ActivityType } from './components/ActivityLog'
import { SkeletonQueue, SkeletonStyles } from './components/Skeleton'

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
  const workspaces = useAppStore(s => s.workspaces, shallow)
  const renderedVideos = useAppStore(s => s.renderedVideos, shallow)
  const channels = useAppStore(s => s.channels, shallow)
  const selectedWorkspaceId = useAppStore(s => s.selectedWorkspaceId)
  const systemStats = useAppStore(s => s.systemStats, shallow)
  const toast = useAppStore(s => s.toast)
  const settings = useAppStore(s => s.settings, shallow)
  // Actions
  const addWorkspace = useAppStore(s => s.addWorkspace)
  const updateWorkspace = useAppStore(s => s.updateWorkspace)
  const removeWorkspace = useAppStore(s => s.removeWorkspace)
  const initChannels = useAppStore(s => s.initChannels)
  const initWorkspaces = useAppStore(s => s.initWorkspaces)
  const initRenderedVideos = useAppStore(s => s.initRenderedVideos)
  const removeRenderedVideo = useAppStore(s => s.removeRenderedVideo)
  const selectWorkspace = useAppStore(s => s.selectWorkspace)
  const selectedWorkspace = useMemo(() => {
    if (!selectedWorkspaceId) return null
    return workspaces.find(w => w.id === selectedWorkspaceId) || null
  }, [selectedWorkspaceId, workspaces])
  const updateSystemStats = useAppStore(s => s.updateSystemStats)
  const showToast = useAppStore(s => s.showToast)
  const addNotification = useAppStore(s => s.addNotification)
  const setSettings = useAppStore(s => s.setSettings)

  // ── Video compare modal ─────────────────────────────────────────────────────
  const [compareWorkspaceId, setCompareWorkspaceId] = useState<string | null>(null)
  const handleCompare = useCallback((workspaceId: string) => {
    setCompareWorkspaceId(workspaceId)
  }, [])
  const compareWorkspace = workspaces.find(w => w.id === compareWorkspaceId) ?? null
  const compareRendered = compareWorkspaceId
    ? renderedVideos.find(v => v.workspaceId === compareWorkspaceId) ?? null
    : null

  // Stable refs for IPC callbacks
  const updateWorkspaceRef = useRef(updateWorkspace)
  const addWorkspaceRef = useRef(addWorkspace)
  updateWorkspaceRef.current = updateWorkspace
  addWorkspaceRef.current = addWorkspace

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
  const searchParams = useSearchParams()
  const syncChannelToUrl = useCallback((id: string | null) => {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('channel', id)
    else url.searchParams.delete('channel')
    window.history.replaceState(null, '', url.pathname + url.search)
  }, [])
  useEffect(() => {
    const ch = searchParams.get('channel')
    if (ch) setActiveChannelId(ch)
  }, [searchParams])

  const [keyHealth, setKeyHealth] = useState<{ exhausted: number; unauthorized: number }>({ exhausted: 0, unauthorized: 0 })
  const [selectedRenderedVideoId, setSelectedRenderedVideoId] = useState<string | null>(null)
  const [diagIssues, setDiagIssues] = useState<string[]>([])
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [isLoadingChannels, setIsLoadingChannels] = useState(true)
  const [onboardingDone, setOnboardingDone] = useState(false)
  const [activityMap, setActivityMap] = useState<Map<string, ActivityEntry>>(new Map())
  // ── Batched activity: accumulate in ref, flush every 300ms ─────────────
  const _pendingActivity = useRef<Map<string, ActivityEntry>>(new Map())
  const _flushActivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleFlushActivity() {
    if (_flushActivityTimer.current) return
    _flushActivityTimer.current = setTimeout(() => {
      _flushActivityTimer.current = null
      const pending = _pendingActivity.current
      if (pending.size === 0) return
      _pendingActivity.current = new Map()
      setActivityMap(prev => {
        const next = new Map(prev)
        let changed = false
        for (const [key, entry] of pending) {
          const existing = next.get(key)
          if (existing && (existing.type === 'done' || existing.type === 'error') && entry.type !== 'error') {
            continue
          }
          next.set(key, entry)
          changed = true
        }
        if (next.size > 8) {
          const oldest = [...next.entries()].slice(0, next.size - 8)
          oldest.forEach(([k]) => next.delete(k))
        }
        return changed ? next : prev
      })
    }, 300) // 300ms debounce batch
  }
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel?: string; confirmDanger?: boolean; onConfirm: () => void
  } | null>(null)

  // ─── Activity: stable local ETA countdown ─────────────────────────────────────
  const etaCountdownSec = useRef<Map<string, number>>(new Map())
  const lastEtaDisplayed = useRef<Map<string, string>>(new Map())
  const lastEtaUpdateMs = useRef<Map<string, number>>(new Map())
  const [etaDisplay, setEtaDisplay] = useState<Map<string, string>>(new Map())
  const etaDisplayRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    etaDisplayRef.current = etaDisplay
  }, [etaDisplay])

  useEffect(() => {
    const tid = setInterval(() => {
      const now = Date.now()
      const currentDisplay = etaDisplayRef.current
      const newDisplay = new Map(currentDisplay)
      let changed = false
      const expired: string[] = []

      etaCountdownSec.current.forEach((sec, wsId) => {
        if (sec <= 0) { expired.push(wsId); return }
        etaCountdownSec.current.set(wsId, sec - 1)
        const displaySec = sec - 1
        const display = displaySec <= 0 ? 'sắp xong…' : `còn ~${fmtEta(displaySec)}`
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

  // Fetch auth status
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

  // Onboarding redirect
  useEffect(() => {
    if (!authStatus.isReady) return
    if (!onboardingDone) {
      router.push('/onboarding')
    }
  }, [authStatus.isReady, onboardingDone, router])

  // Sync backend settings
  useEffect(() => {
    ipc.getSettings().then((backendSettings: any) => {
      if (backendSettings) {
        setSettings(backendSettings)
        if (backendSettings.onboardingComplete === false) {
          setOnboardingDone(false)
        } else {
          setOnboardingDone(true)
        }
      }
    })
  }, [setSettings])

  // Diagnostics
  useEffect(() => {
    const fetchDiag = async () => {
      try {
        const diag = await (window.electronAPI?.runDiagnostics as () => Promise<{ overall: { ready: boolean; issues: string[] } }>)()
        if (diag?.overall?.issues?.length) setDiagIssues(diag.overall.issues)
      } catch {}
    }
    fetchDiag()
  }, [])

  // Key health
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

  // Quota exceeded
  useEffect(() => {
    if (authStatus.quotaExceeded && !quotaToastShown.current) {
      quotaToastShown.current = true
      addNotification({ type: 'warning', message: 'YouTube API quota exceeded — auto-polling tạm ngưng' })
      showToast('YouTube API quota exceeded')
    }
  }, [authStatus.quotaExceeded, showToast, addNotification])

  // Channels synced
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
        const hasChange = Object.keys(patch).some(k => (existing as any)[k] !== (patch as any)[k])
        if (hasChange) updateWorkspaceRef.current(data.id, patch)
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
        addWorkspaceRef.current(formatted)
      }
    })
    return cleanup
  }, [])

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

  // Activity feed — batched
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
      const key = entry.workspaceId || entry.id || aEntry.id
      _pendingActivity.current.set(key, aEntry)
      scheduleFlushActivity()
    })
    return cleanup
  }, [])


  // Auto-cleanup old activity entries
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
    }, 30_000)
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

  // Expose reload function
  useEffect(() => {
    ;(window as any).__reloadChannels = () => initChannels()
    return () => { delete (window as any).__reloadChannels }
  }, [initChannels])

  // Render/download progress batching
  const _pendingRender = useRef<Map<string, { percent: number; eta?: number | string }>>(new Map())
  const _pendingDownload = useRef<Map<string, { percent: number }>>(new Map())
  const _lastFlushMs = useRef<number>(0)

  useEffect(() => {
    const flushInterval = setInterval(() => {
      const now = Date.now()
      if (now - _lastFlushMs.current < 450) return
      _lastFlushMs.current = now
      _pendingRender.current.forEach((data, wsId) => {
        updateWorkspace(wsId, {
          renderProgress: data.percent,
          renderEta: data.eta ? fmtEta(data.eta) : undefined,
        } as Partial<Workspace>)
      })
      _pendingRender.current.clear()
      _pendingDownload.current.forEach((data, wsId) => {
        updateWorkspace(wsId, {
          downloadProgress: data.percent,
        } as Partial<Workspace>)
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
      } else {
        if (p.speed === 'processing') {
          updateWorkspace(p.workspaceId, {
            downloadProgress: 99,
            downloadSpeed: 'processing',
            downloadEta: 'Merging…',
          })
          return
        }
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

  // Auto-download
  useEffect(() => {
    const cleanup = ipc.onAutoDownload((data) => {
      const d = data as { videoId: string; title: string; channelName: string; workspaceId?: string }
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
      if (d.workspaceId) {
        upsertActivity(d.workspaceId, 'detected', `Phát hiện video mới: ${d.title}`, undefined, false)
        etaCountdownSec.current.set(d.workspaceId, 60)
        lastEtaDisplayed.current.set(d.workspaceId, '')
        lastEtaUpdateMs.current.set(d.workspaceId, 0)
      }
    })
    return cleanup
  }, [showToast, addNotification])

  // Render-complete → add rendered video
  useEffect(() => {
    const cleanup = window.electronAPI?.onRenderedAdd((video) => {
      const rv = video as { id: string; workspaceId?: string; videoTitle?: string; archivedPath?: string; thumbnail?: string; thumbnailData?: string; duration?: number; fileSize?: number; renderedAt?: string; codec?: string; quality?: number }
      if (rv?.id) {
        useAppStore.setState((s) => ({ renderedVideos: [rv as any, ...s.renderedVideos] }))
      }
    })
    return cleanup ?? (() => {})
  }, [])

  // ─── Activity feed — batched ──────────────────────────────────────────────
  function upsertActivity(
    workspaceId: string,
    type: ActivityType,
    message: string,
    detail?: string,
    terminal = false,
  ) {
    const pending = _pendingActivity.current
    const existing = pending.get(workspaceId)
    if (existing && (existing.type === 'done' || existing.type === 'error') && !terminal) {
      return
    }
    pending.set(workspaceId, {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: Date.now(),
      type,
      message,
      detail,
      workspaceId,
    })
    scheduleFlushActivity()
  }

  // Download / render progress: update activity
  useEffect(() => {
    const cleanup = ipc.onRenderProgress((progress) => {
      const p = progress as { workspaceId: string; percent: number; eta?: number | string }
      if (!p.workspaceId) return
      const ws = useAppStore.getState().workspaces.find(w => w.id === p.workspaceId)
      if (!ws) return
      const etaSecs = parseEtaSecs(p.eta)
      if (etaSecs !== null) {
        etaCountdownSec.current.set(p.workspaceId, etaSecs)
        lastEtaDisplayed.current.set(p.workspaceId, '')
        lastEtaUpdateMs.current.set(p.workspaceId, 0)
      }
      if (ws.status === 'downloading') {
        upsertActivity(p.workspaceId, 'downloading', `Đang tải video về`, `📁 ${ws.videoTitle}`)
      } else if (ws.status === 'rendering') {
        upsertActivity(p.workspaceId, 'rendering', `Đang xử lý video`, `📁 ${ws.videoTitle}`)
      }
    })
    return cleanup
  }, [])

  // Notifications
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
          upsertActivity(notif.workspaceId, 'downloaded', size ? `Tải video hoàn tất — ${size}` : `Tải video hoàn tất`, `📁 ${title}`, false)
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
          upsertActivity(notif.workspaceId, 'done', fileName ? `Xuất video thành công → ${fileName}` : `Xuất video thành công`, `📁 ${title}`, true)
          etaCountdownSec.current.delete(notif.workspaceId)
          lastEtaDisplayed.current.delete(notif.workspaceId)
          lastEtaUpdateMs.current.delete(notif.workspaceId)
          return
        }
      }
      if (notif.type === 'error') {
        upsertActivity(notif.workspaceId, 'error', `Có lỗi xảy ra`, notif.message.slice(0, 60), true)
        etaCountdownSec.current.delete(notif.workspaceId)
        lastEtaDisplayed.current.delete(notif.workspaceId)
        lastEtaUpdateMs.current.delete(notif.workspaceId)
      }
    })
    return cleanup
  }, [])

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
  }

  const handleVideoSelect = (id: string) => {
    selectWorkspace(id)
    setSelectedRenderedVideoId(null)
  }

  const handleClearActivity = () => {
    setActivityMap(new Map())
  }

  const handleRenderedVideoSelect = (id: string | null) => {
    setSelectedRenderedVideoId(id)
    if (id) selectWorkspace(null)
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

  const handleOpenFolder = async (id: string) => {
    const ws = workspaces.find(w => w.id === id)
    if (!ws?.downloadedPath) {
      showToast('File chưa được tải về')
      return
    }
    const folderPath = ws.downloadedPath.replace(/[/\\][^/\\]*$/, '')
    await ipc.openFolder(folderPath)
  }

  const handleRetry = async (id: string) => {
    showToast('Retrying download...')
    const result = await ipc.retryWorkspace(id) as { success: boolean; error?: string }
    if (result.success) showToast('Download restarted')
    else showToast(`Retry failed: ${result.error}`)
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

  const handleLogout = async () => {
    await ipc.logout()
    setAuthStatus({ isReady: false, cookieCount: 0, loggedOut: true, accountName: '', oauthReady: false })
    showToast('Đã đăng xuất YouTube')
  }

  const showSkeleton = isLoadingData && authStatus.isReady

  const filteredWorkspaces = activeChannelId
    ? workspaces.filter(w => w.channelId === activeChannelId)
    : workspaces

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0E0E0E', fontFamily: 'Inter, sans-serif', color: '#fff', overflow: 'hidden' }}>
      {/* Login screen */}
      {!authStatus.isReady && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
          <LoginScreen accountName={authStatus.accountName} oauthReady={authStatus.oauthReady} onLogout={handleLogout} />
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

      {/* Top Bar */}
      <TopBar
        settings={settings}
        systemStats={systemStats}
        onSettingsChange={async (patch) => {
          setSettings(patch)
          await ipc.updateSettings(patch)
        }}
      />

      {/* Main 3-column area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
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
        />

        {/* Settings Panel (center) — or rendered video detail */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 400 }}>
          {showSkeleton ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ color: '#444', fontSize: 11 }}>Loading...</div>
            </div>
          ) : selectedRenderedVideoId && renderedVideos.find(v => v.id === selectedRenderedVideoId) ? (
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              <RenderedVideoDetail
                video={renderedVideos.find(v => v.id === selectedRenderedVideoId)!}
                onShowToast={showToast}
              />
            </div>
          ) : selectedWorkspaceId ? (
            <VideoDetailPanel
              workspace={selectedWorkspace}
              onClose={() => selectWorkspace(null)}
            />
          ) : (
            <SettingsPanel
              settings={settings}
              systemStats={systemStats}
              channels={channels}
              activeChannelId={activeChannelId}
              onSettingsChange={async (patch) => {
                setSettings(patch)
                await ipc.updateSettings(patch)
              }}
            />
          )}
        </div>

        {/* Right panel: WorkspaceQueue (flex) + ActivityLogPanel (bottom bar) */}
        <div style={{ width: 280, minWidth: 240, maxWidth: 400, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #1E1E1E' }}>
          {/* Queue — scrollable */}
          <div style={{ flex: 1, overflow: 'auto' }}>
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
                onRemoveRendered={(id) => {
                  if (selectedRenderedVideoId === id) setSelectedRenderedVideoId(null)
                  removeRenderedVideo(id)
                }}
                onShowToast={showToast}
                onSplit={handleSplit}
                trimLimitMinutes={settings.defaultTrimLimit as number}
                onCompare={handleCompare}
                onOpenFolder={handleOpenFolder}
              />
            )}
          </div>
          {/* Activity log — bottom bar */}
          <ActivityLogPanel
            entries={[...activityMap.values()].reverse()}
            onClear={handleClearActivity}
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
          borderRadius: 4, padding: '12px 18px',
          fontSize: 14, color: '#ccc', zIndex: 9999,
          maxWidth: 360,
          animation: 'toastIn 0.2s ease',
        }}>
          {toast}
        </div>
      )}

      <SkeletonStyles />

      {/* Confirmation dialog */}
      <ConfirmationDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmDanger={confirmDialog?.confirmDanger}
        onConfirm={confirmDialog?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* Video compare modal */}
      {compareWorkspaceId && (
        <VideoCompareModal
          workspace={compareWorkspace}
          rendered={compareRendered}
          onClose={() => setCompareWorkspaceId(null)}
        />
      )}

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }
        input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; }
        textarea { box-sizing: border-box; }
      `}</style>
    </div>
  )
}
