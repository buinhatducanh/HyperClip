import fs from 'fs'
import path from 'path'

// Persist data to %APPDATA%/HyperClip on Windows, ~/.hyperclip on Linux/Mac
const APPDATA = process.env.APPDATA || process.env.HOME || process.cwd()
const STORE_DIR = path.join(APPDATA, 'HyperClip')
const STORE_FILE = path.join(STORE_DIR, 'workspaces.json')
const SUBS_FILE = path.join(STORE_DIR, 'subscriptions.json')
const CHANNELS_FILE = path.join(STORE_DIR, 'channels.json')
const SEEN_VIDEOS_FILE = path.join(STORE_DIR, 'seen-videos.json')

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

function loadChannels(): StoredChannel[] {
  ensureDir()
  if (!fs.existsSync(CHANNELS_FILE)) {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(DEFAULT_CHANNELS, null, 2), 'utf-8')
    return [...DEFAULT_CHANNELS]
  }
  try {
    return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8')) as StoredChannel[]
  } catch { return [] }
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
  return channel
}

export function updateChannel(id: string, patch: Partial<Omit<StoredChannel, 'id' | 'createdAt'>>): StoredChannel | null {
  const channels = loadChannels()
  const idx = channels.findIndex(c => c.id === id)
  if (idx === -1) return null
  channels[idx] = { ...channels[idx], ...patch }
  saveChannels(channels)
  return channels[idx]
}

export function removeChannel(id: string): boolean {
  const channels = loadChannels()
  const before = channels.length
  saveChannels(channels.filter(c => c.id !== id))
  return channels.length !== before
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
  trimLimit: '5min' | '10min' | 'full'
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
  return loadStore().workspaces
}

// Get workspace by ID
export function getWorkspace(id: string): WorkspaceData | null {
  const store = loadStore()
  return store.workspaces.find(ws => ws.id === id) || null
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

  store.workspaces[idx] = {
    ...store.workspaces[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  saveStore(store)
  return store.workspaces[idx]
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

// ─── Seen videos persistence ─────────────────────────────────────────────────────
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