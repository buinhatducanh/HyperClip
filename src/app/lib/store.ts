import { create } from 'zustand'
import type { Channel, Video, SystemStats, EditorState, RenderedVideo } from '../types'
import { ipc } from './ipc'

// ─── Types ──────────────────────────────────────────────────────────────────────

export type WorkspaceStatus = 'new' | 'waiting' | 'downloading' | 'ready' | 'editing' | 'rendering' | 'done' | 'error'

export interface AppNotification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error' | 'autodownload'
  message: string
  timestamp: number
  read: boolean
}

export interface Workspace {
  id: string
  channelId: string
  channelName: string
  channelColor: string
  videoTitle: string
  thumbnail: string
  duration: string
  downloadedAt: string
  status: WorkspaceStatus
  renderProgress?: number
  fileSize: string
  /** When YouTube posted this video */
  publishedAt?: string
  /** When HyperClip first detected this video */
  detectedAt?: string
  /** Video resolution (e.g. "1920x1080") */
  videoResolution?: string
  trimLimit: number | 'full'  // number = minutes
  /** Export quality for this workspace — set when user edits in editor */
  quality: 1080 | 720 | 360
  /** Path to downloaded video file — populated after download */
  downloadedPath?: string
  /** Path to blur background image — populated after pre-processing */
  blurBackgroundPath?: string
  /** Output path — populated after render */
  outputPath?: string
  /** Download progress 0–100 — populated during download */
  downloadProgress?: number
  /** Detected on download: true = vertical 9:16 short, false = landscape 16:9+ video */
  isShort?: boolean
}

export interface AppSettings {
  outputFolder: string
  defaultTrimLimit: number | 'full'  // number = minutes
  defaultQuality: 1080 | 720
  autoRender: boolean
  minimizeToTray: boolean
}

export interface AppStore {
  // Data
  workspaces: Workspace[]
  renderedVideos: RenderedVideo[]
  channels: Channel[]
  selectedWorkspaceId: string | null
  systemStats: SystemStats
  settings: AppSettings

  // UI state
  renderQueueExpanded: boolean
  toast: string
  notifications: AppNotification[]

  // Actions — Notifications
  addNotification: (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clearNotifications: () => void

  // Editor state
  editorState: EditorState

  // Actions — Workspace
  initWorkspaces: () => Promise<void>
  addWorkspace: (ws: Workspace) => void
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void
  removeWorkspace: (id: string) => void
  selectWorkspace: (id: string | null) => void

  // Actions — Rendered Videos
  initRenderedVideos: () => Promise<void>
  addRenderedVideo: (v: RenderedVideo) => void
  removeRenderedVideo: (id: string) => void

  // Actions — Channel
  initChannels: () => Promise<void>
  addChannel: (url: string) => Promise<void>
  updateChannel: (id: string, patch: Partial<Channel>) => Promise<void>
  removeChannel: (id: string) => Promise<void>
  selectChannel: (id: string) => void

  // Actions — Render
  startRender: (workspaceId: string) => void

  // Actions — System
  updateSystemStats: (stats: SystemStats) => void

  // Actions — UI
  setRenderQueueExpanded: (expanded: boolean) => void
  setSettings: (patch: Partial<AppSettings>) => void
  showToast: (msg: string) => void

  // Actions — Editor
  updateEditorState: (patch: Partial<EditorState>) => void
  resetEditorState: () => void
}

// ─── Initial State ──────────────────────────────────────────────────────────────

const INIT_STATS: SystemStats = {
  ramUsed: 11.4, ramTotal: 32, ramFree: 20.6,
  ramDiskUsed: 0, ramDiskTotal: 64, ramDiskAvailable: 64, ramDiskIsAvailable: false,
  cpuUsage: 0, cpuCores: 24, cpuName: 'Intel Core Ultra 9 285K',
  gpuUsage: 76, gpuTemp: 71, gpuName: 'RTX 5080', gpuEncoder: 'nvenc', gpuMemoryTotal: 16384,
  networkIp: '192.168.1.105',
  isOnline: true,
  activeWorkers: 2,
}

const INIT_EDITOR: EditorState = {
  canvasBg: 'black',
  trimStart: 0,
  trimEnd: 100,
  headerImageUrl: null,
  headerImageDiskPath: null,
  headerImageOffsetY: 50,
  titleText: '',
  titleShape: 'rounded',
  titleBorderColor: '#00B4FF',
  titleBgColor: 'rgba(0, 180, 255, 0.12)',
  titleFontSize: 13,
  speedMultiplier: 1.0,
  exportQuality: 1080,
  exportCodec: 'hevc',
  exportPreset: 'p1',
  exportTune: 'hq',
  enableChunked: false,
  backgroundType: 'blur',
  backgroundImageUrl: null,
  backgroundImageDiskPath: null,
  backgroundColor: '#000000',
  vidHeightPct: 50,
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppStore>((set, get) => ({
  // Initial state
  workspaces: [],
  renderedVideos: [],
  channels: [],
  selectedWorkspaceId: null,
  systemStats: INIT_STATS,
  settings: {
    outputFolder: '~/HyperClip/output',
    defaultTrimLimit: 10,  // 10 minutes — auto-download respects this
    defaultQuality: 1080,
    autoRender: false,
    minimizeToTray: true,
  },
  renderQueueExpanded: false,
  toast: '',
  notifications: [],
  editorState: INIT_EDITOR,

  // Actions — Workspace
  initWorkspaces: async () => {
    try {
      const raw = await ipc.getWorkspaces() as any[] || []
      const ws: Workspace[] = raw.map((w: any) => ({
        id: w.id,
        channelId: w.channelId,
        channelName: w.channelName,
        channelColor: w.channelColor || '#00B4FF',
        videoTitle: w.videoTitle || 'Unknown Video',
        thumbnail: w.thumbnail || '',
        duration: formatDuration(w.duration),
        downloadedAt: w.downloadedAt ? formatDate(w.downloadedAt) : '',
        status: w.status || 'new',
        renderProgress: w.renderProgress,
        fileSize: formatFileSize(w.fileSize),
        trimLimit: w.trimLimit !== undefined ? w.trimLimit : 10,
        quality: w.quality || 1080,
        downloadedPath: w.downloadedPath,
        blurBackgroundPath: w.blurBackgroundPath,
        outputPath: w.outputPath,
        isShort: w.isShort,
      }))
      set({ workspaces: ws })
    } catch (e) {
      console.warn('[store] initWorkspaces failed:', e)
    }
  },

  addWorkspace: (ws) =>
    set((s) => ({ workspaces: [...s.workspaces, ws] })),

  updateWorkspace: (id, patch) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === id ? { ...w, ...patch } : w
      ),
    })),

  removeWorkspace: (id) =>
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== id),
      selectedWorkspaceId: s.selectedWorkspaceId === id ? null : s.selectedWorkspaceId,
    })),

  selectWorkspace: (id) => set({ selectedWorkspaceId: id }),

  // Actions — Rendered Videos
  initRenderedVideos: async () => {
    try {
      const raw = await ipc.getRenderedVideos() as any[] || []
      const videos: RenderedVideo[] = raw.map((v: any) => ({
        id: v.id,
        workspaceId: v.workspaceId,
        channelId: v.channelId,
        channelName: v.channelName,
        videoTitle: v.videoTitle,
        archivedPath: v.archivedPath,
        outputPath: v.outputPath,
        quality: v.quality || 1080,
        codec: v.codec || 'hevc',
        fileSize: formatFileSize(v.fileSizeBytes || v.fileSize || 0),
        fileSizeBytes: Number(v.fileSizeBytes) || Number(v.fileSize) || 0,
        duration: v.duration || 0,
        thumbnail: v.thumbnail || '',
        renderedAt: v.renderedAt ? formatDate(v.renderedAt) : '',
      }))
      set({ renderedVideos: videos })
    } catch (e) {
      console.warn('[store] initRenderedVideos failed:', e)
    }
  },

  addRenderedVideo: (v) =>
    set((s) => ({ renderedVideos: [v, ...s.renderedVideos] })),

  removeRenderedVideo: (id) =>
    set((s) => ({ renderedVideos: s.renderedVideos.filter((v) => v.id !== id) })),

  // Actions — Channel
  initChannels: async () => {
    try {
      const channels = await ipc.getChannels() as Channel[]
      if (channels && channels.length > 0) {
        set({ channels })
      }
    } catch (e) {
      console.warn('[store] initChannels failed:', e)
    }
  },

  addChannel: async (url) => {
    try {
      const newCh = await ipc.addChannel(url) as Channel | null
      if (newCh) {
        set((s) => ({ channels: [...s.channels, newCh] }))
        get().showToast(`✓ Đã thêm tracker: ${newCh.name}`)
      } else {
        get().showToast('Không thể thêm kênh — kiểm tra URL')
      }
    } catch {
      get().showToast('Lỗi khi thêm kênh')
    }
  },

  updateChannel: async (id, patch) => {
    try {
      const updated = await ipc.updateChannel(id, patch) as Channel | null
      if (updated) {
        set((s) => ({ channels: s.channels.map((c) => c.id === id ? updated : c) }))
        get().showToast('Đã cập nhật kênh')
      }
    } catch {
      get().showToast('Lỗi khi cập nhật kênh')
    }
  },

  removeChannel: async (id) => {
    try {
      await ipc.removeChannel(id)
      set((s) => ({
        channels: s.channels.filter((c) => c.id !== id),
        selectedWorkspaceId: null,
      }))
      get().showToast('Đã xóa kênh')
    } catch {
      get().showToast('Lỗi khi xóa kênh')
    }
  },

  selectChannel: (id) => set({ selectedWorkspaceId: null }),

  // Actions — Render
  startRender: (workspaceId) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, status: 'rendering', renderProgress: 0 } : w
      ),
    }))
    get().showToast('⚡ Đã thêm vào hàng render — GPU NVENC đang xử lý...')
  },

  // Actions — System
  updateSystemStats: (stats) => set({ systemStats: stats }),

  // Actions — UI
  setRenderQueueExpanded: (expanded) => set({ renderQueueExpanded: expanded }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  showToast: (msg) => {
    set({ toast: msg })
    setTimeout(() => set({ toast: '' }), 3200)
  },

  // Actions — Notifications
  addNotification: (n) =>
    set((s) => {
      const notification: AppNotification = {
        ...n,
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        read: false,
      }
      const notifications = [notification, ...s.notifications].slice(0, 50)
      return { notifications }
    }),

  markRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),

  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    })),

  clearNotifications: () => set({ notifications: [] }),

  // Actions — Editor
  updateEditorState: (patch) =>
    set((s) => ({ editorState: { ...s.editorState, ...patch } })),

  resetEditorState: () => set({ editorState: INIT_EDITOR }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(iso: string): string {
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