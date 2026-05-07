import fs from 'fs'
import path from 'path'
import os from 'os'

// Persist data to %APPDATA%/HyperClip on Windows, ~/.hyperclip on Linux/Mac
const APPDATA = process.env.APPDATA || process.env.HOME || process.cwd()
const STORE_DIR = path.join(APPDATA, 'HyperClip')
const STORE_FILE = path.join(STORE_DIR, 'workspaces.json')

// Resolve a stored downloadedPath to an absolute filesystem path.
// Cross-machine compatible: store only filename, resolve using current machine's storage dir.
function resolveDownloadedPath(storedPath: string): string {
  if (!storedPath) return ''
  if (path.isAbsolute(storedPath)) return storedPath  // legacy: already absolute
  // storedPath is just a filename — scan for it in known storage dirs
  const found = findDownloadedFileByName(storedPath)
  if (found) return found
  // Fallback: construct from primary storage dir
  return path.join(getVideoStorageDir(), storedPath)
}

// Find a file by filename across known storage directories.
function findDownloadedFileByName(filename: string): string | null {
  for (const dir of getKnownStorageDirs()) {
    try {
      const fullPath = path.join(dir, filename)
      if (fs.existsSync(fullPath)) return fullPath
    } catch {}
  }
  return null
}

// All directories that might contain downloaded video files.
function getKnownStorageDirs(): string[] {
  return [
    // Primary: APPDATA/HyperClip/downloads
    path.join(STORE_DIR, 'downloads'),
    // Legacy temp path
    path.join(os.tmpdir(), 'hyperclip-video'),
    // RAM disk path (if used)
    ...(isRamDiskAvailable() ? [getVideoStorageDir()] : []),
  ]
}

// Get the primary video storage directory for this machine.
// Duplicated from ramdisk.ts to avoid circular ESM dependency.
function getVideoStorageDir(): string {
  try {
    // Check if RAM disk is available (ImDisk on R:\)
    const ramDiskPath = process.platform === 'win32' ? 'R:\\hyperclip' : '/mnt/ramdisk/hyperclip'
    if (fs.existsSync(ramDiskPath)) return ramDiskPath
  } catch {}
  // Fallback: APPDATA/HyperClip/downloads
  return path.join(STORE_DIR, 'downloads')
}

function isRamDiskAvailable(): boolean {
  try {
    const ramDiskPath = process.platform === 'win32' ? 'R:\\hyperclip' : '/mnt/ramdisk/hyperclip'
    return fs.existsSync(ramDiskPath)
  } catch {
    return false
  }
}

// Extract just the filename from a downloadedPath for storage.
// Cross-machine: only ever store the filename, never an absolute path.
function makeStorableDownloadedPath(absPath: string): string {
  if (!absPath) return ''
  // Already just a filename
  if (!path.isAbsolute(absPath)) return path.basename(absPath)
  // Absolute → extract basename (filename only)
  return path.basename(absPath)
}
const SUBS_FILE = path.join(STORE_DIR, 'subscriptions.json')
const CHANNELS_FILE = path.join(STORE_DIR, 'channels.json')
const SEEN_VIDEOS_FILE = path.join(STORE_DIR, 'seen-videos.json')
const RENDERED_FILE = path.join(STORE_DIR, 'rendered.json')

// ─── Channel store ───────────────────────────────────────────────────────────────

export interface StoredChannel {
  id: string
  name: string
  handle: string
  avatarColor: string
  channelId?: string
  avatarUrl?: string
  createdAt: string
}

const DEFAULT_CHANNELS: StoredChannel[] = [
  { id: 'ch1', name: 'TechViet Daily',  handle: '@techvietdaily',  avatarColor: '#00B4FF', createdAt: new Date().toISOString() },
  { id: 'ch2', name: 'GamingVN Pro',    handle: '@gamingvnpro',    avatarColor: '#7C3AED', createdAt: new Date().toISOString() },
  { id: 'ch3', name: 'FitnessGoal VN',  handle: '@fitnessgoalvn',  avatarColor: '#00FF88', createdAt: new Date().toISOString() },
  { id: 'ch4', name: 'Wanderlust VN',   handle: '@wanderlustvn',   avatarColor: '#FF6B35', createdAt: new Date().toISOString() },
  { id: 'ch5', name: 'Beat Studio',     handle: '@beatstudio',     avatarColor: '#FF0080', createdAt: new Date().toISOString() },
]

// In-memory cache with 60s TTL — avoids disk I/O on every poll (every 5s).
let _channelCache: StoredChannel[] | null = null
let _channelCacheAt = 0
const CHANNEL_CACHE_TTL_MS = 60_000

function loadChannels(): StoredChannel[] {
  const now = Date.now()
  if (_channelCache && now - _channelCacheAt < CHANNEL_CACHE_TTL_MS) {
    return _channelCache
  }
  ensureDir()
  if (!fs.existsSync(CHANNELS_FILE)) {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(DEFAULT_CHANNELS, null, 2), 'utf-8')
    _channelCache = [...DEFAULT_CHANNELS]
    _channelCacheAt = now
    return _channelCache
  }
  try {
    _channelCache = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8')) as StoredChannel[]
    _channelCacheAt = now
    return _channelCache
  } catch { return [] }
}

/** Invalidate the channel cache — call after any add/update/remove. */
export function _invalidateChannelCache(): void {
  _channelCache = null
  _channelCacheAt = 0
}

function saveChannels(channels: StoredChannel[]): void {
  ensureDir()
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2), 'utf-8')
}

export function getChannels(): StoredChannel[] {
  return loadChannels()
}

export function getChannel(id: string): StoredChannel | null {
  return loadChannels().find(c => c.id === id) || null
}

export function addChannel(channel: StoredChannel): StoredChannel {
  const channels = loadChannels()
  channels.push(channel)
  saveChannels(channels)
  _invalidateChannelCache()
  return channel
}

export function updateChannel(id: string, patch: Partial<Omit<StoredChannel, 'id' | 'createdAt'>>): StoredChannel | null {
  const channels = loadChannels()
  const idx = channels.findIndex(c => c.id === id)
  if (idx === -1) return null
  channels[idx] = { ...channels[idx], ...patch }
  saveChannels(channels)
  _invalidateChannelCache()
  return channels[idx]
}

export function removeChannel(id: string): boolean {
  const channels = loadChannels()
  const before = channels.length
  const filtered = channels.filter(c => c.id !== id)
  if (filtered.length === before) return false
  saveChannels(filtered)
  _invalidateChannelCache()
  return true
}

export interface ChannelSubscription {
  channelId: string
  channelName: string
  hubUrl: string
  topic: string
  callback: string
  leaseSeconds: number
  expiresAt: number
  verifyToken: string
  subscribedAt: string
}

// ─── Subscription store ───────────────────────────────────────────────────────

function loadSubscriptions(): ChannelSubscription[] {
  ensureDir()
  if (!fs.existsSync(SUBS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8')) as ChannelSubscription[]
  } catch { return [] }
}

function saveSubscriptions(subs: ChannelSubscription[]): void {
  ensureDir()
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf-8')
}

export function getSubscriptions(): ChannelSubscription[] {
  return loadSubscriptions()
}

export function getSubscription(channelId: string): ChannelSubscription | null {
  return loadSubscriptions().find(s => s.channelId === channelId) || null
}

export function addSubscription(sub: ChannelSubscription): void {
  const subs = loadSubscriptions().filter(s => s.channelId !== sub.channelId)
  subs.push(sub)
  saveSubscriptions(subs)
}

export function removeSubscription(channelId: string): void {
  saveSubscriptions(loadSubscriptions().filter(s => s.channelId !== channelId))
}

// ─── Workspace store ──────────────────────────────────────────────────────────

export interface WorkspaceData {
  id: string
  channelId: string
  channelName: string
  channelColor: string
  videoId: string
  videoTitle: string
  videoUrl: string
  thumbnail: string
  duration: number       // seconds
  trimLimit: number | 'full'  // number = minutes (auto-download default), 'full' = no trim
  status: 'waiting' | 'downloading' | 'ready' | 'editing' | 'rendering' | 'done' | 'error'
  renderProgress: number // 0-100
  downloadProgress?: number // 0-100
  downloadedAt: string   // ISO timestamp
  downloadedPath: string
  blurBackgroundPath: string
  outputPath: string
  metadataPath: string
  fileSize: number       // bytes
  renderMetadata: object | null
  createdAt: string
  updatedAt: string
  /** Detected on download: true = vertical 9:16 short, false = landscape 16:9+ video */
  isShort?: boolean
  /** When YouTube posted this video (ISO timestamp from API) */
  publishedAt?: string
  /** When HyperClip first detected this video (ISO timestamp) */
  detectedAt?: string
  /** ISO timestamp — retryableAt must be in the past before retrying a 'waiting' workspace */
  retryableAt?: string
  /** Video resolution (e.g. "1920x1080", "1080x1920") */
  videoResolution?: string
  /** Path to pre-scaled source video (pre-downscaled to export resolution) — speeds up render */
  preScaledPath?: string
}

interface Store {
  workspaces: WorkspaceData[]
  version: number
}

// Ensure store file exists
function ensureDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true })
  }
}

function ensureStore(): void {
  ensureDir()
  if (!fs.existsSync(STORE_FILE)) {
    const initial: Store = { workspaces: [], version: 1 }
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf-8')
  }
}

// Load store from disk
function loadStore(): Store {
  ensureStore()
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8')
    return JSON.parse(raw) as Store
  } catch {
    return { workspaces: [], version: 1 }
  }
}

// Save store to disk
function saveStore(store: Store): void {
  ensureStore()
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8')
}

// Get all workspaces
export function getWorkspaces(): WorkspaceData[] {
  return loadStore().workspaces.map(resolveWorkspacePaths)
}

// Get workspace by ID
export function getWorkspace(id: string): WorkspaceData | null {
  const store = loadStore()
  const ws = store.workspaces.find(ws => ws.id === id)
  if (!ws) return null
  return resolveWorkspacePaths(ws)
}

// Resolve relative downloadedPath → absolute, and scan for missing files.
function resolveWorkspacePaths(ws: WorkspaceData): WorkspaceData {
  if (!ws.downloadedPath) return ws
  const absPath = resolveDownloadedPath(ws.downloadedPath)
  if (fs.existsSync(absPath)) return { ...ws, downloadedPath: absPath }
  // File not found at stored path — scan storage dirs for a file matching this workspaceId
  const found = findDownloadedFile(ws.id)
  return {
    ...ws,
    downloadedPath: found || absPath,  // use found path, or keep stored path (will be flagged as missing)
  }
}

// Scan known storage directories for a file matching {workspaceId}_*.mp4
// Uses in-memory cache with 60s TTL to avoid O(n) scans on every workspace load.
const _fileIndexCache = new Map<string, { absPath: string; cachedAt: number }>()
let _fileIndexLastBuild = 0

function rebuildFileIndex(): void {
  _fileIndexCache.clear()
  for (const dir of getKnownStorageDirs()) {
    try {
      if (!fs.existsSync(dir)) continue
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4'))
      for (const file of files) {
        // Pattern: workspaceId_filename.mp4 or workspaceId.mp4
        const base = file.replace(/\.mp4$/, '')
        const underscoreIdx = base.indexOf('_')
        const workspaceId = underscoreIdx !== -1 ? base.slice(0, underscoreIdx) : base
        if (workspaceId) {
          _fileIndexCache.set(workspaceId, { absPath: path.join(dir, file), cachedAt: Date.now() })
        }
      }
    } catch {}
  }
  _fileIndexLastBuild = Date.now()
}

function findDownloadedFile(workspaceId: string): string | null {
  // Serve from cache if fresh
  const now = Date.now()
  if (now - _fileIndexLastBuild > FILE_INDEX_TTL_MS) {
    rebuildFileIndex()
  }
  const cached = _fileIndexCache.get(workspaceId)
  if (cached) return cached.absPath
  // Not in cache — rebuild and check again (new file)
  rebuildFileIndex()
  return _fileIndexCache.get(workspaceId)?.absPath ?? null
}

// Add new workspace
export function addWorkspace(data: Omit<WorkspaceData, 'id' | 'createdAt' | 'updatedAt'>): WorkspaceData {
  const store = loadStore()
  const now = new Date().toISOString()
  const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  const workspace: WorkspaceData = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  }

  store.workspaces.push(workspace)
  saveStore(store)

  return workspace
}

// Update workspace
export function updateWorkspace(id: string, patch: Partial<WorkspaceData>): WorkspaceData | null {
  const store = loadStore()
  const idx = store.workspaces.findIndex(ws => ws.id === id)

  if (idx === -1) return null

  // Convert downloadedPath to filename before persisting (cross-machine compatible)
  const normalizedPatch = { ...patch }
  if (normalizedPatch.downloadedPath) {
    normalizedPatch.downloadedPath = makeStorableDownloadedPath(normalizedPatch.downloadedPath)
  }

  store.workspaces[idx] = {
    ...store.workspaces[idx],
    ...normalizedPatch,
    updatedAt: new Date().toISOString(),
  }

  saveStore(store)
  return resolveWorkspacePaths(store.workspaces[idx])
}

// Delete workspace
export function deleteWorkspace(id: string): boolean {
  const store = loadStore()
  const idx = store.workspaces.findIndex(ws => ws.id === id)

  if (idx === -1) return false

  store.workspaces.splice(idx, 1)
  saveStore(store)
  return true
}

// Get workspaces by status
export function getWorkspacesByStatus(status: WorkspaceData['status']): WorkspaceData[] {
  return getWorkspaces().filter(ws => ws.status === status)
}

// Get workspaces by channel
export function getWorkspacesByChannel(channelId: string): WorkspaceData[] {
  return getWorkspaces().filter(ws => ws.channelId === channelId)
}

// Count workspaces by status
export function getStatusCounts(): Record<WorkspaceData['status'], number> {
  const workspaces = getWorkspaces()
  return {
    waiting: workspaces.filter(w => w.status === 'waiting').length,
    downloading: workspaces.filter(w => w.status === 'downloading').length,
    ready: workspaces.filter(w => w.status === 'ready').length,
    editing: workspaces.filter(w => w.status === 'editing').length,
    rendering: workspaces.filter(w => w.status === 'rendering').length,
    done: workspaces.filter(w => w.status === 'done').length,
    error: workspaces.filter(w => w.status === 'error').length,
  }
}

// Clear all done workspaces
export function clearDoneWorkspaces(): number {
  const store = loadStore()
  const before = store.workspaces.length
  store.workspaces = store.workspaces.filter(ws => ws.status !== 'done')
  saveStore(store)
  return before - store.workspaces.length
}

// ─── Rendered videos store ───────────────────────────────────────────────────────

const MAX_RENDERED_ENTRIES = 500
const MAX_RENDERED_DAYS = 30
const FILE_INDEX_TTL_MS = 60_000

export interface RenderConfigRecord {
  exportResolution: string     // e.g. "1080x1920"
  fps: number                  // e.g. 30
  speed: number                // e.g. 1.1
  codec: string                // 'h264' | 'hevc'
  preset?: string              // 'p1'|'p2'|'p3'
  tune?: string                // 'hq'|'ll'|'ull'
  backgroundType?: string      // 'blur'|'solid'|'image'
  audioCodec?: string          // 'aac'|'libopus'
  audioBitrate?: string        // '192k'|'64k'
  trimStart?: number           // seconds
  trimEnd?: number             // seconds
  isShort?: boolean            // vertical 9:16 vs landscape
  vidHeightPct?: number        // landscape video zone %
  gpuTier?: string             // 'high'|'mid'|'low'|'software'
}

export interface SourceInfoRecord {
  originalResolution?: string  // e.g. "1920x1080"
  originalDuration?: number    // original video duration (before trim) in seconds
  originalFileSize?: number    // bytes
  downloadQuality?: string     // '360'|'480'|'720'|'1080'
}

export interface RenderedVideoRecord {
  id: string
  workspaceId: string
  channelId: string
  channelName: string
  videoTitle: string
  archivedPath: string
  outputPath: string   // original output path (before archive)
  quality: number      // 360, 720, or 1080
  codec: string        // 'h264' or 'hevc'
  fileSize: number     // bytes
  duration: number     // seconds
  thumbnail: string
  /** base64 JPEG data URI — populated on render completion, survives workspace deletion */
  thumbnailData?: string
  /** Source video resolution (e.g. "1920x1080") — shows what the original video was */
  videoResolution?: string
  renderedAt: string   // ISO timestamp
  // ─── Render metadata (for PO debug & comparison) ───
  /** Wall-clock render time in milliseconds */
  renderDurationMs?: number
  /** Full render configuration used */
  renderConfig?: RenderConfigRecord
  /** Source video information for before/after comparison */
  sourceInfo?: SourceInfoRecord
}

function loadRendered(): RenderedVideoRecord[] {
  ensureDir()
  if (!fs.existsSync(RENDERED_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(RENDERED_FILE, 'utf-8')) as RenderedVideoRecord[]
  } catch { return [] }
}

function saveRendered(videos: RenderedVideoRecord[]): void {
  ensureDir()
  fs.writeFileSync(RENDERED_FILE, JSON.stringify(videos, null, 2), 'utf-8')
}

// Prune oldest entries if over limit or older than MAX_RENDERED_DAYS
function pruneRenderedVideos(videos: RenderedVideoRecord[]): RenderedVideoRecord[] {
  const cutoffMs = Date.now() - MAX_RENDERED_DAYS * 24 * 60 * 60 * 1000
  const pruned = videos
    .filter(v => new Date(v.renderedAt).getTime() > cutoffMs)
    .slice(0, MAX_RENDERED_ENTRIES)
  return pruned
}

export function getRenderedVideos(): RenderedVideoRecord[] {
  return loadRendered()
}

export function addRenderedVideo(video: RenderedVideoRecord): void {
  const all = loadRendered()
  all.unshift(video) // newest first
  const pruned = pruneRenderedVideos(all)
  saveRendered(pruned)
}

export function removeRenderedVideo(id: string): boolean {
  const all = loadRendered()
  const filtered = all.filter(v => v.id !== id)
  saveRendered(filtered)
  return filtered.length !== all.length
}

export function getRenderedVideosByChannel(channelId: string): RenderedVideoRecord[] {
  return loadRendered().filter(v => v.channelId === channelId)
}

// Tracks which videoIds have been triggered for auto-download, persisted to disk.
// Prevents re-downloading the same video across app restarts.
// Map<channelId, { videoIds: string[], expiresAt: number }>
export interface SeenVideosStore {
  [channelId: string]: { ids: string[]; expiresAt: number }
}

export function loadSeenVideos(): SeenVideosStore {
  try {
    if (fs.existsSync(SEEN_VIDEOS_FILE)) {
      let text = fs.readFileSync(SEEN_VIDEOS_FILE, 'utf-8')
      // Strip BOM (byte order mark) that PowerShell or other editors may inject
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
      const raw = JSON.parse(text)
      // Filter out expired entries
      const now = Date.now()
      for (const chId of Object.keys(raw)) {
        if (raw[chId].expiresAt <= now) {
          delete raw[chId]
        }
      }
      return raw
    }
  } catch (e) {
    console.warn('[store] loadSeenVideos failed:', e)
  }
  return {}
}

export function saveSeenVideos(store: SeenVideosStore): void {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true })
    }
    fs.writeFileSync(SEEN_VIDEOS_FILE, JSON.stringify(store, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[store] saveSeenVideos failed:', e)
  }
}

export function markVideoSeen(channelId: string, videoId: string): void {
  const store = loadSeenVideos()
  if (!store[channelId]) {
    store[channelId] = { ids: [], expiresAt: Date.now() + 48 * 60 * 60 * 1000 }
  }
  store[channelId].ids = [...new Set([...store[channelId].ids, videoId])]
  saveSeenVideos(store)
}

export function isVideoSeen(channelId: string, videoId: string): boolean {
  const store = loadSeenVideos()
  return store[channelId]?.ids.includes(videoId) ?? false
}

// Initialize store on module load
ensureStore()