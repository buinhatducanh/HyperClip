import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from 'electron'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import http from 'http'
import fs from 'fs'
import zlib from 'zlib'
import { URL } from 'url'
import { IPC_CHANNELS } from './ipc/channels.js'
import { collectSystemStats, type SystemStats } from './services/system.js'
import {
  getWorkspaces, getWorkspace, addWorkspace, updateWorkspace, deleteWorkspace,
  getSubscription,
  getChannels, getChannel, addChannel, updateChannel, removeChannel, markVideoSeen, loadSeenVideos, type StoredChannel,
  type WorkspaceData
} from './services/store.js'
import { downloadVideo, getVideoInfo, getChannelInfo, getChannelId, type YtdlpVideoInfo, type YtdlpChannelInfo } from './services/youtube.js'
import { renderVideo, renderChunked, generateBlurBackground, cancelChunked, cancelAllChunked, type RenderMetadata, type RenderProgress, type ChunkConfig } from './services/ffmpeg.js'
import { cancelFfmpeg, cancelAllFfmpeg, getPoolStatus } from './services/worker-pool.js'
import { getVideoStoragePath, getOutputPath, generateWorkspacePaths, cleanupWorkspace, ensureStorageDirs, loadSettings, saveSettings } from './services/ramdisk.js'
import { createYouTubePoller, stopYouTubePoller, getYouTubePoller } from './services/youtube_poller.js'
import { initCookieManager, getCookieManager, authEvents, channelEvents } from './services/cookie_manager.js'

// Fix UTF-8 console output on Windows — set code page to 65001 (UTF-8)
if (process.platform === 'win32') {
  import('child_process').then(({ execSync }) => {
    try { execSync('chcp 65001', { stdio: 'ignore' }) } catch {}
  }).catch(() => {})
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV !== 'production'
const NEXT_PORT = 3000

// Single terminal: Electron auto-boots Next.js if not already running
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let nextServer: ReturnType<typeof spawn> | null = null
let nextServerOwned = false // did WE spawn the Next.js server?

// ─── Render Queue (Tier 2+3.2: Multi-worker via worker pool) ──────────────────
// Concurrency controlled by worker-pool (max 2 concurrent FFmpeg processes).
// The render queue here is for job ordering and user-level queue management.

const renderQueue: Array<{
  workspaceId: string
  metadata: RenderMetadata
  resolve: (r: { success: boolean; outputPath?: string; error?: string }) => void
}> = []

function startNextQueuedRender(): void {
  if (getPoolStatus().active >= 2) return
  if (renderQueue.length === 0) return

  const job = renderQueue.shift()!
  executeRenderJob(job)
}

function executeRenderJob(job: typeof renderQueue[0]): void {
  const { workspaceId, metadata, resolve } = job
  const workspace = getWorkspace(workspaceId)
  if (!workspace) { resolve({ success: false, error: 'Workspace not found' }); startNextQueuedRender(); return }

  updateWorkspace(workspaceId, { status: 'rendering', renderProgress: 0 })
  sendNotification('info', `Rendering: ${workspace.videoTitle}`, workspaceId)

  const outputDir = getOutputPath()
  ensureStorageDirs()

  renderVideo(metadata, outputDir, (progress: RenderProgress) => {
    updateWorkspace(workspaceId, { renderProgress: progress.percent })
    broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, progress)
  }).then((result) => {
    if (result.success) {
      updateWorkspace(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' })
      sendNotification('success', `Done: ${workspace.videoTitle}`, workspaceId)
      if (result.outputPath) shell.showItemInFolder(result.outputPath)
    } else {
      updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
      sendNotification('error', `Render failed: ${result.error}`, workspaceId)
    }
    resolve({ success: result.success, outputPath: result.outputPath })
    startNextQueuedRender()
  }).catch((err) => {
    updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
    resolve({ success: false, error: String(err) })
    startNextQueuedRender()
  })
}

// ─── YouTube Poller ──────────────────────────────────────────────────────────────
// Cookie-based subscription feed polling — no tunnel, no proxy needed.
// 1 request every `intervalMs` captures all 100 channels from the subscriptions feed.
// Cookie refreshes every 15 minutes to stay valid.

/**
 * Start the YouTube subscription feed poller.
 * @param intervalMs Polling interval in milliseconds (default: 3000 = 3 seconds)
 * @param onVideos Callback fired with new videos detected since last poll
 */
export function startYouTubePoller(
  intervalMs: number,
  onVideos: (videos: Array<{ videoId: string; channelId: string; channelName: string; title: string }>) => void
): void {
  const poller = createYouTubePoller({
    pollIntervalMs: intervalMs,
    onNewVideos: (detectedVideos) => {
      onVideos(detectedVideos.map(v => ({
        videoId: v.videoId,
        channelId: v.channelId,
        channelName: v.channelName,
        title: v.title,
      })))
    },
  })
  poller.start()
}

// ─── Auto-download from new video detected by poller ────────────────────────────
async function autoDownloadFromWebSub(videoId: string, channelId: string, title: string) {
  try {
    // Prevent duplicate workspaces: if workspace for this video already exists, skip
    const existingWorkspaces = getWorkspaces()
    const existing = existingWorkspaces.find(ws => ws.videoId === videoId)
    if (existing) {
      console.log(`[Poll] Workspace already exists for ${videoId} (status: ${existing.status}) — skipping`)
      return
    }

    // Mark as seen immediately to prevent retries on app restart if download fails
    markVideoSeen(channelId, videoId)

    const channelName = getSubscription(channelId)?.channelName || 'Unknown Channel'
    console.log(`[Poll] Auto-downloading: ${title} (${videoId}) from ${channelName}`)

    const storagePath = getVideoStoragePath()
    ensureStorageDirs()

    const workspace = addWorkspace({
      channelId,
      channelName,
      channelColor: '#00B4FF',
      videoId,
      videoTitle: title,
      videoUrl: 'https://www.youtube.com/watch?v=' + videoId,
      // maxresdefault 404 for short/no-HD videos; use hqdefault which always exists
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration: 0,
      trimLimit: '10min',
      status: 'downloading',
      renderProgress: 0,
      downloadedAt: '',
      downloadedPath: '',
      blurBackgroundPath: '',
      outputPath: '',
      metadataPath: '',
      fileSize: 0,
      renderMetadata: null,
    })

    broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, workspace)
    sendNotification('info', `Auto-downloading: ${title}`, workspace.id)
    console.log(`[Auto] Starting download: ${workspace.id} → ${'https://www.youtube.com/watch?v=' + videoId}`)
    const result = await downloadVideo({
      workspaceId: workspace.id,
      videoUrl: 'https://www.youtube.com/watch?v=' + videoId,
      outputDir: storagePath,
      trimLimit: '10min',
      onProgress: (progress) => {
        broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, {
          workspaceId: workspace.id,
          percent: progress.percent,
          speed: progress.speed,
          eta: progress.eta,
        })
      },
    })

    if (result.success && result.filePath) {
      console.log(`[Auto] Download success: ${title} → ${result.filePath}`)
      playSuccessBeep()

      // Fetch real metadata from yt-dlp (thumbnail, real title)
      const videoInfo = await getVideoInfo('https://www.youtube.com/watch?v=' + videoId)
      const realThumbnail = videoInfo?.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      const realTitle = videoInfo?.title || title
      const realDuration = result.duration || videoInfo?.duration || 0

      updateWorkspace(workspace.id, {
        status: 'ready',
        downloadedAt: new Date().toISOString(),
        downloadedPath: result.filePath,
        fileSize: result.fileSize || 0,
        thumbnail: realThumbnail,
        videoTitle: realTitle,
        duration: realDuration,
      })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(workspace.id))

      const { blurPath } = generateWorkspacePaths(workspace.id)
      const blurResult = await generateBlurBackground(result.filePath, blurPath)

      updateWorkspace(workspace.id, {
        status: 'ready',
        blurBackgroundPath: blurResult.success ? blurPath : '',
      })
      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, getWorkspace(workspace.id))
      sendNotification('success', `Auto-ready: ${realTitle}`, workspace.id)
      broadcast(IPC_CHANNELS.AUTO_DOWNLOAD_EVENT, { videoId, title: realTitle, channelName })
    } else {
      // Permanent failure: "not available" means video is gone — don't retry
      const errorMsg = result.error || ''
      const isNotAvailable = errorMsg.includes('not available') || errorMsg.includes('Video unavailable')
      if (isNotAvailable) {
        updateWorkspace(workspace.id, { status: 'error' })
        console.log(`[Auto] Video permanently unavailable: ${title} (${videoId}) — skipped`)
      } else {
        // Retryable error (network, ffmpeg, etc.) — keep in waiting for next poll
        updateWorkspace(workspace.id, { status: 'waiting' })
        sendNotification('error', `Auto-download failed: ${result.error}`, workspace.id)
      }
    }
  } catch (err) {
    console.error('[Poll] Auto-download error:', err)
  }
}

// ─── Scan existing downloaded files on startup ────────────────────────────────────
// Finds any video files in the storage directory that were downloaded previously
// (either by HyperClip or manually placed there) and registers them as "seen"
// so the poll won't re-download them.
function scanExistingDownloadedFiles(): void {
  // Scan both new persistent path AND legacy temp path (for backwards compat)
  const pathsToScan = [
    getVideoStoragePath(),
    path.join(os.tmpdir(), 'hyperclip-video'), // legacy path
  ]

  const seen = new Set<string>()
  let totalRegistered = 0

  for (const storagePath of pathsToScan) {
    try {
      if (!fs.existsSync(storagePath)) continue
      const files = fs.readdirSync(storagePath).filter(f => f.endsWith('.mp4'))
      if (files.length === 0) continue
      console.log(`[HyperClip] Scanning ${files.length} file(s) in ${storagePath}`)

      for (const file of files) {
        // Pattern: ws-{timestamp}-{random}_{videoId}.mp4
        const match = file.match(/^ws-\d+-[a-z0-9]+_(.+)\.mp4$/)
        if (match && !seen.has(match[1])) {
          const videoId = match[1]
          seen.add(videoId)
          const channels = getChannels()
          for (const ch of channels) {
            if (ch.channelId) markVideoSeen(ch.channelId, videoId)
          }
          totalRegistered++
        }
      }
    } catch (e) {
      console.warn(`[HyperClip] scanExistingDownloadedFiles failed for ${storagePath}:`, e)
    }
  }

  if (totalRegistered > 0) {
    console.log(`[HyperClip] Registered ${totalRegistered} existing file(s) as "seen"`)
  }
}

// ─── Channel ID Resolution ─────────────────────────────────────────────────────────
// Resolves YouTube handle (@channel) to channelId (UC...) for WebSub subscription.
// Called once at startup for demo channels that only have handles.
async function resolveChannelIdsForPoll(): Promise<void> {
  const channels = getChannels()
  for (const ch of channels) {
    // If it's a real UC ID (24 chars), skip. If it's a handle or a fake UC ID (<20 chars), resolve it.
    if (ch.channelId && ch.channelId.startsWith('UC') && ch.channelId.length >= 24) continue
    
    const url = ch.handle || 'https://www.youtube.com/channel/' + ch.id
    try {
      const resolved = await getChannelId(url)
      if (resolved && resolved.startsWith('UC')) {
        console.log('[Channel] Resolved', ch.name, '->', resolved)
        updateChannel(ch.id, { channelId: resolved })
      }
    } catch {}
  }
}
// ─── Port checker ───────────────────────────────────────────────────────────────
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
  })
}

// ─── Next.js server ────────────────────────────────────────────────────────────
function startNextServer(): Promise<void> {
  const nextDir = path.join(__dirname, '..')
  const nextBin = path.join(nextDir, 'node_modules', 'next', 'dist', 'bin', 'next')

  let startupResolve: (() => void) | null = null
  return new Promise<void>((resolve) => {
    startupResolve = resolve

    nextServer = spawn('node', [nextBin, '-p', String(NEXT_PORT)], {
      cwd: nextDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PORT: String(NEXT_PORT) },
    })

    nextServerOwned = true
    console.log(`[HyperClip] Booting Next.js on port ${NEXT_PORT}...`)

    nextServer.stdout?.on('data', (data) => {
      const text = data.toString()
      process.stdout.write('[Next.js] ' + text)
      if (text.includes('Ready') || text.includes('started server')) {
        console.log(`[HyperClip] Next.js ready → http://localhost:${NEXT_PORT}`)
        if (startupResolve) { startupResolve(); startupResolve = null }
      }
    })
    nextServer.stderr?.on('data', (data) => {
      const text = data.toString()
      process.stderr.write('[Next.js] ' + text)
      if (text.includes('Local:')) {
        console.log(`[HyperClip] Next.js ready → http://localhost:${NEXT_PORT}`)
        if (startupResolve) { startupResolve(); startupResolve = null }
      }
    })
    // 20s safety timeout
    setTimeout(() => {
      if (startupResolve) {
        console.warn('[HyperClip] Next.js startup timeout — proceeding anyway')
        startupResolve(); startupResolve = null
      }
    }, 20000)
  })
}

// ─── Window ────────────────────────────────────────────────────────────────────
function getPreloadPath() {
  return path.join(__dirname, 'preload.js')
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#121212',
    title: 'HyperClip',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    frame: true,
  })

  mainWindow.loadURL(`http://localhost:${NEXT_PORT}`)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) {
      mainWindow?.webContents.openDevTools()
    }
  })

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

// ─── Tray icon helper ─────────────────────────────────────────────────────────
// Creates a 16x16 tray icon: dark rounded square with blue play triangle
// Matches the sidebar logo design
function createBlueIcon(): Electron.NativeImage {
  const W = 16, H = 16
  const rowLen = 1 + W * 4

  // RGBA pixel buffer (filter byte + pixels per row)
  const raw = Buffer.alloc(H * rowLen)
  for (let i = 0; i < raw.length; i++) raw[i] = 0

  const bgR = 13, bgG = 13, bgB = 13   // #0D0D0D dark
  const fgR = 0,   fgG = 180, fgB = 255 // #00B4FF blue

  function setPixel(x: number, y: number, r: number, g: number, b: number, a: number) {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = y * rowLen + 1 + x * 4
    raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = a
  }

  // Fill background (all opaque)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Skip rounded corners (3px radius)
      const dx = Math.min(x, W - 1 - x)
      const dy = Math.min(y, H - 1 - y)
      if (dx < 3 && dy < 3 && dx + dy < 3) continue
      setPixel(x, y, bgR, bgG, bgB, 255)
    }
  }

  // Play triangle (▶) — filled blue
  // y=3..13 centered at y=8, tip right, base left
  // Each entry: [rowY, xLeft, xRight]
  const rows: [number, number, number][] = [
    [3,5,7], [4,4,9], [5,4,10], [6,4,11],
    [7,3,12], [8,3,13], [9,4,12],
    [10,4,11], [11,4,10], [12,4,9], [13,5,7],
  ]
  for (const [y, x1, x2] of rows) {
    for (let x = x1; x <= x2; x++) setPixel(x, y, fgR, fgG, fgB, 255)
  }

  // Build PNG
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0)
    return Buffer.concat([len, Buffer.from(type, 'ascii'), data, crcB])
  }

  const crcTbl: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTbl[n] = c
  }
  function crc32(buf: Buffer): number {
    let crc = 0xffffffff
    for (let i = 0; i < buf.length; i++) crc = crcTbl[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
    return crc ^ 0xffffffff
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const compressed = zlib.deflateSync(raw)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])

  return nativeImage.createFromBuffer(png)
}

// ─── System tray ──────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(process.resourcesPath || __dirname, 'resources', 'icon.png')
  let trayIcon: Electron.NativeImage

  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.isEmpty()) {
      // Fallback: create a 16x16 blue icon programmatically
      trayIcon = createBlueIcon()
    }
  } catch {
    trayIcon = createBlueIcon()
  }

  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show HyperClip', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quick Add Tracker', click: () => mainWindow?.webContents.send('quick-add') },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitAll() } },
  ])

  tray.setToolTip('HyperClip — Auto-Render')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => mainWindow?.show())
}

// ─── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcast(channel: string, data: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// ─── Audio notification ────────────────────────────────────────────────────────────
function playSuccessBeep() {
  // Distinct double-chime on download complete — loud enough to cut through background noise
  if (process.platform === 'win32') {
    import('child_process').then(({ spawn }) => {
      // Exclamation is louder than Asterisk; play twice for emphasis
      spawn('powershell', [
        '-c',
        'Add-Type -AssemblyName System.Media; 1..2 | ForEach-Object { [System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 350 }'
      ], { stdio: 'ignore' })
    }).catch(() => {})
  }
}

function sendNotification(type: 'success' | 'error' | 'warning' | 'info', message: string, workspaceId?: string) {
  broadcast(IPC_CHANNELS.NOTIFICATION_EVENT, {
    id: `notif-${Date.now()}`,
    type,
    message,
    workspaceId,
    timestamp: new Date().toISOString(),
  })
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
async function registerIPCHandlers() {
  ipcMain.handle(IPC_CHANNELS.SYSTEM_STATS, async (): Promise<SystemStats> => {
    return collectSystemStats()
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_FOLDER, async (_, folderPath: string) => {
    await shell.openPath(folderPath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_URL, async (_, url: string) => {
    shell.openExternal(url)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST, async (): Promise<WorkspaceData[]> => {
    return getWorkspaces()
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_UPDATE, async (_, id: string, patch: Partial<WorkspaceData>) => {
    const updated = updateWorkspace(id, patch)
    if (updated) broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, updated)
    return updated || { success: false }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_DELETE, async (_, id: string) => {
    cleanupWorkspace(id)
    deleteWorkspace(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.TRACKER_ADD, async (_, url: string, trimLimit: '5min' | '10min' | 'full'): Promise<WorkspaceData | null> => {
    try {
      const info = await getVideoInfo(url)
      if (!info) {
        sendNotification('error', 'Failed to fetch video info. Check URL.', undefined)
        return null
      }

      const storagePath = getVideoStoragePath()
      ensureStorageDirs()

      const workspace = addWorkspace({
        channelId: info.channelId,
        channelName: info.channelName,
        channelColor: '#00B4FF',
        videoId: info.id,
        videoTitle: info.title,
        videoUrl: url,
        thumbnail: info.thumbnail,
        duration: info.duration,
        trimLimit,
        status: 'downloading',
        renderProgress: 0,
        downloadedAt: '',
        downloadedPath: '',
        blurBackgroundPath: '',
        outputPath: '',
        metadataPath: '',
        fileSize: 0,
        renderMetadata: null,
      })

      broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, workspace)
      sendNotification('info', `Downloading: ${info.title}`, workspace.id)

      const result = await downloadVideo({
        workspaceId: workspace.id,
        videoUrl: url,
        outputDir: storagePath,
        trimLimit,
        onProgress: (progress) => {
          broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, { workspaceId: workspace.id, percent: progress.percent, speed: progress.speed, eta: progress.eta })
        },
      })

      if (result.success && result.filePath) {
        // Step 1: Mark ready immediately after download (non-blocking)
        const { blurPath } = generateWorkspacePaths(workspace.id)
        const initialUpdate = updateWorkspace(workspace.id, {
          status: 'ready',
          downloadedAt: new Date().toISOString(),
          downloadedPath: result.filePath,
          fileSize: result.fileSize || 0,
          blurBackgroundPath: '',
          renderMetadata: {
            workspace_id: workspace.id,
            source_video: result.filePath,
            blur_background: '',
            export_resolution: '1080x1920',
            video_speed: 1.0,
            fps_target: 30,
            overlays: [],
            trim: { start: 0, end: result.duration || 300 },
          },
        })
        if (initialUpdate) broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, initialUpdate)
        sendNotification('success', `Ready: ${info.title}`, workspace.id)

        // Step 2: Generate blur background in parallel (non-blocking)
        generateBlurBackground(result.filePath, blurPath).then((blurResult) => {
          const blurUpdate = updateWorkspace(workspace.id, {
            blurBackgroundPath: blurResult.success ? blurPath : '',
            renderMetadata: {
              workspace_id: workspace.id,
              source_video: result.filePath,
              blur_background: blurResult.success ? blurPath : '',
              export_resolution: '1080x1920',
              video_speed: 1.0,
              fps_target: 30,
              overlays: [],
              trim: { start: 0, end: result.duration || 300 },
            },
          })
          if (blurUpdate) broadcast(IPC_CHANNELS.WORKSPACE_UPDATE_EVENT, blurUpdate)
        }).catch((e) => {
          console.warn('[Blur] Background generation failed:', e)
        })
      } else {
        updateWorkspace(workspace.id, { status: 'waiting' })
        sendNotification('error', `Download failed: ${result.error}`, workspace.id)
      }

      return getWorkspace(workspace.id)
    } catch (err) {
      console.error('[Tracker] Add error:', err)
      sendNotification('error', `Error: ${(err as Error).message}`)
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.TRACKER_LIST, async () => {
    const workspaces = getWorkspaces()
    const channels = new Map<string, { channelId: string; channelName: string }>()
    for (const ws of workspaces) {
      if (!channels.has(ws.channelId)) {
        channels.set(ws.channelId, { channelId: ws.channelId, channelName: ws.channelName })
      }
    }
    return Array.from(channels.values())
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_INFO, async (_, url: string): Promise<YtdlpChannelInfo | null> => {
    return await getChannelInfo(url)
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_LIST, async (): Promise<StoredChannel[]> => {
    return getChannels()
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_ADD, async (_, url: string): Promise<StoredChannel | null> => {
    try {
      let name: string, handle: string, channelId: string | undefined, avatarUrl: string | undefined

      try {
        const info = await getChannelInfo(url)
        if (info) {
          name = info.channelName
          handle = info.handle || `@${info.channelId}`
          channelId = info.channelId
          avatarUrl = info.avatarUrl
        } else {
          throw new Error('no info')
        }
      } catch {
        const raw = url.replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/)?/, '').split(/[/?]/)[0] || 'Kênh Mới'
        name = raw.charAt(0).toUpperCase() + raw.slice(1)
        handle = `@${raw.toLowerCase()}`
      }

      const CHANNEL_COLORS = ['#00B4FF', '#7C3AED', '#00FF88', '#FF6B35', '#FF0080', '#FFB800']
      const channels = getChannels()
      const newCh: StoredChannel = {
        id: `ch${Date.now()}`,
        name,
        handle,
        avatarColor: CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length],
        channelId,
        avatarUrl,
        createdAt: new Date().toISOString(),
      }
      const saved = addChannel(newCh)
      return saved
    } catch (e) {
      console.error('[CHANNEL_ADD] failed:', e)
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_UPDATE, async (_, id: string, patch: Partial<StoredChannel>): Promise<StoredChannel | null> => {
    return updateChannel(id, patch)
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_REMOVE, async (_, id: string): Promise<boolean> => {
    return removeChannel(id)
  })

  ipcMain.handle(IPC_CHANNELS.TRACKER_REMOVE, async (_, channelId: string) => {
    const workspaces = getWorkspaces()
    for (const ws of workspaces) {
      if (ws.channelId === channelId) {
        cleanupWorkspace(ws.id)
        deleteWorkspace(ws.id)
      }
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.RENDER_START, async (_, workspaceId: string, metadata: RenderMetadata): Promise<{ success: boolean; outputPath?: string; error?: string }> => {
    return new Promise((resolve) => {
      renderQueue.push({ workspaceId, metadata, resolve })
      if (getPoolStatus().active < 2) {
        startNextQueuedRender()
      }
    })
  })

  ipcMain.handle(IPC_CHANNELS.RENDER_CANCEL, async (_, workspaceId: string) => {
    // Remove from queue if pending
    const queueIdx = renderQueue.findIndex(j => j.workspaceId === workspaceId)
    if (queueIdx !== -1) {
      const job = renderQueue.splice(queueIdx, 1)[0]
      job.resolve({ success: false, error: 'Cancelled before start' })
    }
    // Cancel standard render (via worker pool) and chunked render (direct processes)
    cancelFfmpeg(`single:${workspaceId}`)
    cancelChunked(workspaceId)
    updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
    sendNotification('warning', 'Render cancelled', workspaceId)
    return { success: true }
  })

  // ─── Chunked Parallel Encoding ──────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.RENDER_CHUNKED, async (_, workspaceId: string, metadata: RenderMetadata, config?: ChunkConfig) => {
    const workspace = getWorkspace(workspaceId)
    if (!workspace) return { success: false, workspaceId, error: 'Workspace not found' }
    if (!workspace.downloadedPath) return { success: false, workspaceId, error: 'Video not downloaded' }

    updateWorkspace(workspaceId, { status: 'rendering', renderProgress: 0 })
    sendNotification('info', `Chunked render: ${workspace.videoTitle}`, workspaceId)

    const outputDir = getOutputPath()
    ensureStorageDirs()

    const result = await renderChunked(
      metadata,
      outputDir,
      config,
      (progress) => {
        updateWorkspace(workspaceId, { renderProgress: Math.round(progress.percent) })
        broadcast(IPC_CHANNELS.RENDER_PROGRESS_EVENT, progress)
      },
    )

    if (result.success) {
      updateWorkspace(workspaceId, { status: 'done', renderProgress: 100, outputPath: result.outputPath || '' })
      sendNotification('success', `Done (chunked): ${workspace.videoTitle}`, workspaceId)
      if (result.outputPath) shell.showItemInFolder(result.outputPath)
    } else {
      updateWorkspace(workspaceId, { status: 'ready', renderProgress: 0 })
      sendNotification('error', `Chunked render failed: ${result.error}`, workspaceId)
    }

    return result
  })

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (): Promise<{ videoStoragePath?: string; outputPath?: string }> => {
    return loadSettings()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_, patch: { videoStoragePath?: string; outputPath?: string }): Promise<void> => {
    const settings = loadSettings()
    if (patch.videoStoragePath !== undefined) settings.videoStoragePath = patch.videoStoragePath
    if (patch.outputPath !== undefined) settings.outputPath = patch.outputPath
    saveSettings(settings)
  })

  // Poller status: return current YouTubePoller state
  ipcMain.handle(IPC_CHANNELS.POLLER_STATUS, () => {
    const poller = getYouTubePoller()
    return poller ? poller.getStatus() : null
  })

  // ─── Auth ────────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async () => {
    const cm = getCookieManager()
    return cm.getAuthStatus()
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    const cm = getCookieManager()
    await cm.logout()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.NOTIFICATION_EVENT, { type: 'info', message: 'Đã đăng xuất YouTube' })
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_SET_CREDS, async (_, clientId: string, clientSecret: string) => {
    // Save OAuth credentials to config file
    const { getOAuthClientId: authGetId } = await import('./services/youtube_auth.js')
    const fs2 = await import('fs')
    const path2 = await import('path')
    const os2 = await import('os')
    const configFile = path2.join(os2.tmpdir(), 'hyperclip-cookies', 'oauth_config.json')
    const dir = path2.dirname(configFile)
    if (!fs2.existsSync(dir)) fs2.mkdirSync(dir, { recursive: true })
    const config = { client_id: clientId, client_secret: clientSecret }
    fs2.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8')
    console.log('[OAuth] Credentials saved to', configFile)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_GET_CREDS, async () => {
    const { getOAuthClientId, getOAuthClientSecret } = await import('./services/youtube_auth.js')
    return { clientId: getOAuthClientId(), clientSecret: getOAuthClientSecret() }
  })
}

// Relay auth status changes to renderer (registered at module load — catches early OAuth events)
authEvents.on('authUpdated', (status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.AUTH_UPDATE_EVENT, status)
  }
})

// Relay channel sync events so frontend re-fetches channel list
channelEvents.on('channelsSynced', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.CHANNEL_SYNCED_EVENT, null)
  }
})

// ─── System monitor ────────────────────────────────────────────────────────────
function startSystemMonitor() {
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const stats = collectSystemStats()
    mainWindow.webContents.send(IPC_CHANNELS.SYSTEM_STATS_EVENT, stats)
  }, 2000)
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────
function quitAll() {
  stopYouTubePoller()
  cancelAllFfmpeg()
  cancelAllChunked()
  renderQueue.forEach(job => job.resolve({ success: false, error: 'App shutting down' }))
  renderQueue.length = 0
  if (nextServerOwned && nextServer) nextServer.kill()
  mainWindow?.destroy()
  app.quit()
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
ensureStorageDirs()

app.whenReady().then(async () => {
  console.log('[HyperClip] Starting...')

  // Auto-boot Next.js if not already running on port 3000
  const nextRunning = await isPortOpen(NEXT_PORT)
  if (nextRunning) {
    console.log(`[HyperClip] Next.js already running on port ${NEXT_PORT}`)
  } else {
    await startNextServer()
  }

  createWindow()
  createTray()
  await registerIPCHandlers()

  // Resolve missing channelIds for demo channels at startup
  resolveChannelIdsForPoll()

  // Scan storage directory for existing downloaded files — register them as "seen"
  // so poll won't re-download files already on disk
  scanExistingDownloadedFiles()

  // Init cookie manager (auto-refresh every 15m) then start polling
  const cookieResult = await initCookieManager()
  if (cookieResult.success) {
    console.log(`[HyperClip] Cookies ready (${cookieResult.browser}, ${cookieResult.cookies.length} cookies)`)
  } else {
    console.warn(`[HyperClip] Cookie init failed: ${cookieResult.error} — polling will retry`)
  }

  startYouTubePoller(3000, (videos) => {
    for (const v of videos) {
      autoDownloadFromWebSub(v.videoId, v.channelId, v.title)
    }
  })
  console.log('[HyperClip] Auto-ingestion active (cookie polling — 3s interval, 100 channels)')

  console.log(`[HyperClip] Ready → http://localhost:${NEXT_PORT}`)
})

app.on('window-all-closed', quitAll)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

process.on('uncaughtException', (err) => {
  console.error('[HyperClip] Uncaught exception:', err)
  sendNotification('error', `Uncaught error: ${err.message}`)
})
