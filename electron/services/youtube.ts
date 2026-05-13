import { spawn, execSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import https from 'https'
import { app } from 'electron'
import { getFfmpegPath, getFfprobePath } from './ffmpeg-paths.js'
import { buildArgs, runSimpleFfmpeg, quotePath } from './ffmpeg.js'

// ─── HTTP helpers ───────────────────────────────────────────────────────────────
function httpGet(url: string, timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      } 
    }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString()))
    })
    req.on('error', reject)
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

export interface RssVideo {
  videoId: string
  title: string
  published: string
}

// Fetch latest videos from a channel's RSS feed
export async function getLatestVideosFromRss(channelId: string, limit = 3): Promise<RssVideo[]> {
  // Only use if it looks like a valid UC ID. If it's a handle, this will (and should) fail.
  if (!channelId || !channelId.startsWith('UC')) return []
  const resolvedId = channelId;
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${resolvedId}`
    const body = await httpGet(rssUrl)

    const videos: RssVideo[] = []
    // Parse each <entry> block
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
    let match
    while ((match = entryRegex.exec(body)) !== null && videos.length < limit) {
      const entry = match[1]
      const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/)
      const pubMatch = entry.match(/<published>([^<]+)<\/published>/)
      if (videoIdMatch) {
        videos.push({
          videoId: videoIdMatch[1],
          title: titleMatch ? titleMatch[1] : 'Unknown',
          published: pubMatch ? pubMatch[1] : '',
        })
      }
    }
    return videos
  } catch {
    return []
  }
}

export async function getChannelMetadataFromHttp(url: string): Promise<YtdlpChannelInfo | null> {
  // Extract channel ID from URL: /channel/UCxxx or /@handle or raw corrupted UC ID
  let channelId = ''
  let channelUrl = url

  const channelMatch = url.match(/\/channel\/(UC[^/?]+)/)
  if (channelMatch) {
    channelId = channelMatch[1]
    channelUrl = `https://www.youtube.com/channel/${channelId}`
  } else {
    const handleMatch = url.match(/\/@([^/?]+)/)
    if (handleMatch) {
      channelId = handleMatch[1]
      channelUrl = `https://www.youtube.com/@${channelId}`
    } else if (url.startsWith('UC') && url.length > 20) {
      // Raw UC ID passed as URL — build proper channel URL
      channelId = url
      channelUrl = `https://www.youtube.com/channel/${channelId}`
    }
  }

  if (!channelId) return null

  let resolvedId = channelId
  let channelName = 'Unknown'
  let avatarUrl = ''

  // Check if the channelId looks like a real UC ID (exactly 24 chars: UC + 22 base64 chars)
  const isRealId = /^(UC[a-zA-Z0-9_-]{22})$/.test(resolvedId)

  if (!isRealId) {
    try {
      const body = await httpGet(channelUrl)
      // Search for channelId in the page source
      const idMatch = body.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/) ||
                      body.match(/"browseId":"(UC[a-zA-Z0-9_-]{22})"/) ||
                      body.match(/channel_id=(UC[a-zA-Z0-9_-]{22})/)

      if (idMatch) {
        resolvedId = idMatch[1]
      } else {
        // If we can't find the ID, return early to trigger yt-dlp fallback
        return { channelName: 'Unknown', channelId: '', avatarUrl: '', handle: url }
      }
    } catch (e: any) {
      return { channelName: 'Unknown', channelId: '', avatarUrl: '', handle: url }
    }
  }

  // 2. Use YouTube RSS feed to get canonical channel name
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${resolvedId}`
    const rssBody = await httpGet(rssUrl)

    const nameMatch = rssBody.match(/<title>([^<]+)<\/title>/)
    if (nameMatch) channelName = nameMatch[1]
  } catch (e: any) {
    console.warn(`[getChannelMetadataFromHttp] RSS failed for ${resolvedId}:`, e.message)
  }

  // 3. Scrape channel page HTML to get the correct avatar URL and channel name
  try {
    const resolvedUrl = `https://www.youtube.com/channel/${resolvedId}`
    const pageBody = await httpGet(resolvedUrl)

    // Extract channel name if RSS failed
    if (channelName === 'Unknown') {
      const titleMatch = pageBody.match(/<title>([^<]+)\s+-\s+YouTube<\/title>/)
      if (titleMatch) {
        channelName = titleMatch[1]
      } else {
        // Try JSON metadata
        const jsonNameMatch = pageBody.match(/"title":"([^"]+)"/)
        if (jsonNameMatch) channelName = jsonNameMatch[1]
      }
    }

    // Extract avatar from JSON data embedded in the page
    const avatarJsonMatch = pageBody.match(/"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/)
    if (avatarJsonMatch) {
      avatarUrl = avatarJsonMatch[1].replace(/=s\d+-c-k-c0x00ffffff-no-rj/, '=s100-c-k-c0x00ffffff-no-rj')
    } else {
      const ogMatch = pageBody.match(/og:image"[^>]*content="([^"]+)"/)
      if (ogMatch) {
        avatarUrl = ogMatch[1].replace(/=s\d+/, '=s100')
      }
    }
  } catch (e: any) {
    console.warn(`[getChannelMetadataFromHttp] Page scrape failed for ${resolvedId}:`, e.message)
  }

  // Final fallback for avatar
  if (!avatarUrl && resolvedId.startsWith('UC')) {
    avatarUrl = `https://yt3.googleusercontent.com/ytc/${resolvedId}=s100-c-k-c0x00ffffff-no-rj`
  }

  const safeName = (channelName && channelName !== 'Unknown' && channelName !== 'N/A') ? channelName : ''
  return {
    channelName: safeName,
    channelId: resolvedId,
    avatarUrl,
    handle: url.includes('@') ? url : `https://www.youtube.com/channel/${resolvedId}`,
  }
}

// yt-dlp JS runtime args — modern yt-dlp requires a JS runtime for YouTube extraction.
// Without this, videos are incorrectly reported as "not available".
// Supported runtimes: deno, node, bun, quickjs
function getJsRuntimeArgs(): string[] {
  return ['--js-runtimes', 'node']
}

// Find yt-dlp executable
function getYtdlpPath(): string {
  // 1. Bundled in resources/ (shipped with app)
  //    In dev mode: app.getAppPath() = project root (D:\...\HyperClip) → resources/yt-dlp/yt-dlp.exe ✓
  //    In prod:    process.resourcesPath = app.asar/resources              → yt-dlp/yt-dlp.exe ✓
  const appPath = app?.getAppPath?.()
  if (appPath) {
    const devBundled = path.join(appPath, 'resources', 'yt-dlp', 'yt-dlp.exe')
    if (fs.existsSync(devBundled)) return devBundled
  }
  if (process.resourcesPath) {
    const prodBundled = path.join(process.resourcesPath, 'yt-dlp', 'yt-dlp.exe')
    if (fs.existsSync(prodBundled)) return prodBundled
  }

  // 2. node_modules/.bin (npm package — no Python needed if using bundled binary)
  const npmBin = path.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp')
  if (fs.existsSync(npmBin)) return npmBin
  const npmBinExe = path.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp.exe')
  if (fs.existsSync(npmBinExe)) return npmBinExe

  // 3. Common pip install locations (Roaming Python + Local Python Scripts)
  for (const ver of ['Python314', 'Python313', 'Python312', 'Python311']) {
    const roamingScripts = path.join(process.env.APPDATA || '', 'Python', ver, 'Scripts')
    const ytdlpExe = path.join(roamingScripts, 'yt-dlp.exe')
    if (fs.existsSync(ytdlpExe)) return ytdlpExe
    const ytdlpSh = path.join(roamingScripts, 'yt-dlp')
    if (fs.existsSync(ytdlpSh)) return ytdlpSh

    // Local Python install (Python313 etc. in AppData\Local\Programs)
    const localScripts = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', ver, 'Scripts')
    const localExe = path.join(localScripts, 'yt-dlp.exe')
    if (fs.existsSync(localExe)) return localExe
    const localSh = path.join(localScripts, 'yt-dlp')
    if (fs.existsSync(localSh)) return localSh
  }
  // 4. User-local AppData Roaming Python fallback
  const roamingPythonScripts = path.join(process.env.APPDATA || '', 'Python', 'Scripts')
  if (fs.existsSync(path.join(roamingPythonScripts, 'yt-dlp.exe'))) {
    return path.join(roamingPythonScripts, 'yt-dlp.exe')
  }

  // 4. PATH
  const pathEnv = process.env.PATH || ''
  for (const dir of pathEnv.split(path.delimiter)) {
    const ytdlp = path.join(dir, 'yt-dlp')
    if (fs.existsSync(ytdlp)) return ytdlp
  }

  // Fallback: assume in PATH
  return 'yt-dlp'
}

export interface YtdlpVideoInfo {
  id: string
  title: string
  thumbnail: string
  duration: number
  channelName: string
  channelId: string
  uploadDate: string
  fileSize: number
  resolution: string
  url: string
}

export interface YtdlpChannelInfo {
  channelName: string
  channelId: string
  avatarUrl: string
  handle: string
}

export interface DownloadProgress {
  workspaceId: string
  percent: number
  speed: string
  eta: string
  downloaded: string
  total: string
}

export interface DownloadResult {
  success: boolean
  workspaceId: string
  filePath?: string
  thumbnail?: string
  duration?: number
  fileSize?: number
  error?: string
}

export interface YtdlpOptions {
  workspaceId: string
  videoUrl: string
  outputDir: string
  trimLimit: number | 'full'  // number = minutes, 'full' = no limit
  onProgress?: (progress: DownloadProgress) => void
  /** Max height for download quality. Defaults to '720'. '360'|'480'|'720'|'1080' */
  quality?: string
  /**
   * Max concurrent yt-dlp instances for multi-section download.
   * - 'auto' (default): 1 for 360-720p, 2 for 1080p+
   * - 1: single instance (no splitting)
   * - 2-4: split into N sections, download in parallel, merge with FFmpeg concat
   */
  maxInstances?: 'auto' | number
  /**
   * Pre-fetched video duration in seconds. When provided, skips the sequential getVideoInfo
   * probe in multi-instance mode — saves ~1-3s network round-trip per download.
   * Auto-download already fetches this in parallel, so pass it here for zero extra latency.
   */
  preFetchedDuration?: number
  /**
   * Retry strategy: 'immediate' (default, yt-dlp native retries)
   * or 'exponential' (manual retry with exponential backoff + jitter to avoid rate-limit).
   * Use 'exponential' when YouTube is aggressively rate-limiting.
   */
  retryStrategy?: 'immediate' | 'exponential'
  /**
   * PO Token for android client. Extracted from Chrome sessions via CDP.
   * Required for android client to access formats >360p.
   * If not provided, falls back to web client (VP9 codec).
   */
  po_token?: string | null
  /**
   * Path to Netscape cookie file exported from Chrome via CDP.
   * yt-dlp uses --cookies flag to authenticate and bypass EJS anti-bot challenge.
   */
  ytCookiesFile?: string | null
}

export async function getChannelId(videoUrl: string): Promise<string | null> {
  const ytdlp = getYtdlpPath()

  return new Promise((resolve) => {
    const proc = spawn(ytdlp, [
      ...getJsRuntimeArgs(),
      '--flat-playlist',
      '--print', '%(channel_id)s',
      '--no-download',
      '--no-playlist',
      videoUrl,
    ], {
      
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        const channelId = stdout.trim()
        // Valid YouTube channel ID starts with "UC"
        if (channelId.startsWith('UC')) {
          resolve(channelId)
          return
        }
      }
      // Fallback: try to get from dump-json
      resolve(null)
    })

    proc.on('error', () => resolve(null))
    setTimeout(() => { proc.kill(); resolve(null) }, 15000)
  })
}

export async function getChannelInfo(url: string): Promise<YtdlpChannelInfo | null> {
  // Try HTTP oEmbed first (fast, no external tool needed)
  const httpResult = await getChannelMetadataFromHttp(url)
  if (httpResult && httpResult.channelName !== 'Unknown') {
    return httpResult
  }

  // Fall back to yt-dlp
  const ytdlp = getYtdlpPath()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(ytdlp, [
      ...getJsRuntimeArgs(),
      '--dump-json',
      '--no-download',
      '--no-playlist',
      '--flat-playlist',
      url,
    ], {
      
      env: { ...process.env },
    })

    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        console.error('[yt-dlp] getChannelInfo failed:', stderr)
        resolve(null)
        return
      }

      try {
        const firstLine = stdout.trim().split('\n')[0]
        const info = JSON.parse(firstLine)

        const avatarUrl = info.thumbnail || info.avatar || info.uploader_thumbnail || ''

        resolve({
          channelName: (info.channel && info.channel !== 'N/A') ? info.channel : (info.uploader && info.uploader !== 'N/A') ? info.uploader : 'Unknown',
          channelId: info.channel_id || '',
          avatarUrl,
          handle: info.channel_handle || info.uploader_url || '',
        })
      } catch {
        resolve(null)
      }
    })

    proc.on('error', () => resolve(null))
    setTimeout(() => { proc.kill(); resolve(null) }, 20000)
  })
}

export async function getVideoInfo(videoUrl: string): Promise<YtdlpVideoInfo | null> {
  const ytdlp = getYtdlpPath()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(ytdlp, [
      ...getJsRuntimeArgs(),
      '--dump-json',
      '--no-download',
      '--no-playlist',
      videoUrl,
    ], {
      
      env: { ...process.env },
    })

    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        console.error('[yt-dlp] getInfo failed:', stderr)
        resolve(null)
        return
      }

      try {
        const info = JSON.parse(stdout.trim())
        resolve({
          id: info.id || '',
          title: info.title || 'Unknown',
          thumbnail: info.thumbnail || '',
          duration: info.duration || 0,
          channelName: (info.channel && info.channel !== 'N/A') ? info.channel : (info.uploader && info.uploader !== 'N/A') ? info.uploader : 'Unknown',
          channelId: info.channel_id || '',
          uploadDate: info.upload_date || '',
          fileSize: info.filesize || info.filesize_approx || 0,
          resolution: info.resolution || 'unknown',
          url: videoUrl,
        })
      } catch {
        resolve(null)
      }
    })
  })
}

// ─── Multi-instance section download ──────────────────────────────────────────
// Splits a video into N sections, downloads each in parallel with separate yt-dlp
// instances, then merges with FFmpeg concat. Doubles throughput on fast internet.
// Requires: 1080p+ quality, trimLimit < video duration (for section-based splitting).

interface MultiInstanceOpts {
  workspaceId: string; videoUrl: string; outputDir: string
  formatSelector: string; trimLimit: number; instanceCount: number
  onProgress?: (progress: DownloadProgress) => void; ytdlp: string
  /** Pre-fetched duration — skips sequential getVideoInfo probe (~1-3s saving). */
  preFetchedDuration?: number
  /** Exponential backoff retry for instances that fail with 429 rate-limit. */
  retryStrategy?: 'immediate' | 'exponential'
  /** PO Token for android client (extracted from Chrome via CDP). */
  poToken?: string | null
  /** Path to Netscape cookie file for yt-dlp authentication. */
  ytCookiesFile?: string | null
}

/** Exponential backoff with jitter — avoids hammering YouTube during rate-limit windows. */
async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 2000,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn()
      return result
    } catch (err: any) {
      const is429 = String(err).includes('429') || String(err).includes('Too Many Requests')
      if (is429 && attempt < maxAttempts - 1) {
        // Exponential backoff: 2s, 4s, 8s + random jitter (0-2s)
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 2000
        console.log(`[yt-dlp] Rate-limited (429) — retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 2}/${maxAttempts})`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      throw err
    }
  }
  // Should not reach here but satisfy TypeScript
  return fn()
}

function buildYtDlpArgs(ytdlp: string, videoUrl: string, formatSelector: string, outputTemplate: string, sectionArg: string, instanceIdx: number, poToken: string | null | undefined, ytCookiesFile?: string | null): string[] {
  const args = [
    videoUrl,
    ...getJsRuntimeArgs(),
  ]

  // Quality strategy:
  // - With PO Token → android DASH bestvideo+bestaudio (1080p H.264)
  // - Without PO Token → ios client (H.264/AAC, 720p-1080p)
  let resolvedFormat: string
  if (poToken) {
    args.push('--extractor-args', `youtube:player_client=android,po_token=${poToken}`)
    resolvedFormat = formatSelector // DASH: bestvideo+bestaudio
    console.log(`[yt-dlp] Using android DASH with PO Token (${poToken.slice(0, 8)}...)`)
  } else {
    args.push('--extractor-args', 'youtube:player_client=ios')
    resolvedFormat = 'bestvideo[height<=1080][vcodec=h264]+bestaudio[acodec=aac]/bestvideo[height<=1080]+bestaudio/bestvideo[height<=720]+bestaudio/best'
    console.log(`[yt-dlp] Using ios client (H.264 up to 1080p)`)
  }

  // Authenticate yt-dlp with Chrome cookies to bypass EJS anti-bot challenge
  if (ytCookiesFile) {
    args.push('--cookies', ytCookiesFile)
    console.log(`[yt-dlp] Using Chrome cookies: ${ytCookiesFile!.split(/[/\\]/).pop()}`)
  }

  args.push(
    '-f', resolvedFormat,
    '--output', outputTemplate,
    '--no-playlist',
    '--newline',
    '--concurrent-fragments', '16',
    '--retries', '3',
    '--fragment-retries', '3',
    '--socket-timeout', '10',
    '--http-chunk-size', '10485760',
    '--download-sections', sectionArg,
  )
  return args
}

function makeSectionArg(startSec: number, endSec: number): string {
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  }
  return `*${fmt(startSec)}-${fmt(endSec)}`
}

async function multiInstanceDownload(opts: MultiInstanceOpts): Promise<DownloadResult | null> {
  const { workspaceId, videoUrl, outputDir, formatSelector, trimLimit, instanceCount, onProgress, ytdlp, preFetchedDuration, retryStrategy = 'immediate', poToken, ytCookiesFile } = opts

  // OPTIMIZATION #1: Skip sequential duration probe if caller already has it.
  // autoDownloadFromWebSub fetches videoInfo in parallel with download, so it's already available.
  // Saves ~1-3s network round-trip per download.
  let videoDurationSec = trimLimit * 60
  if (preFetchedDuration && preFetchedDuration > 0) {
    videoDurationSec = Math.min(preFetchedDuration, trimLimit * 60)
    console.log(`[yt-dlp] Multi-instance: using pre-fetched duration ${videoDurationSec}s (skip probe)`)
  } else {
    // Fallback: probe only if no pre-fetched duration (manual downloads, etc.)
    try {
      const info = await getVideoInfo(videoUrl)
      if (info?.duration && info.duration > 0) {
        videoDurationSec = Math.min(info.duration, trimLimit * 60)
        console.log(`[yt-dlp] Multi-instance: probed duration ${videoDurationSec}s`)
      }
    } catch {
      // Probing failed — use trimLimit as estimated duration
    }
  }

  if (videoDurationSec < 30) {
    // Video too short for multi-instance splitting — fall back to single
    return null
  }

  // Split into N equal sections
  const sectionDuration = videoDurationSec / instanceCount
  const sections: { start: number; end: number; label: string }[] = []
  for (let i = 0; i < instanceCount; i++) {
    const start = i * sectionDuration
    const end = i === instanceCount - 1 ? videoDurationSec : (i + 1) * sectionDuration
    sections.push({ start, end, label: String(i).padStart(2, '0') })
  }

  console.log(`[yt-dlp] Multi-instance: splitting ${videoDurationSec}s into ${instanceCount} sections`)
  sections.forEach(s => {
    console.log(`  Instance ${s.label}: ${makeSectionArg(s.start, s.end)}`)
  })

  const ffmpegPath = getFfmpegPath()
  const ffmpegDir = path.dirname(ffmpegPath)
  const ytDlpDir = path.dirname(ytdlp)
  const enrichedPath = ffmpegDir + path.delimiter + ytDlpDir + path.delimiter + (process.env.PATH || '')

  // OPTIMIZATION #3: Try RAM disk for fragment cache on Linux (tmpfs).
  // On Windows, yt-dlp uses temp dir — already fine. On Linux, this can save disk I/O.
  // Add --cache-dir if running on Linux tmpfs mount
  let cacheDirArgs: string[] = []
  if (process.platform === 'linux') {
    // /dev/shm is Linux RAM disk (typically 50% of RAM)
    cacheDirArgs = ['--cache-dir', '/dev/shm/yt-dlp-cache']
  }

  // Spawn N yt-dlp instances in parallel
  const chunkFiles: (string | undefined)[] = []
  const completedInstances = { count: 0 }
  const progressPerInstance = 100 / instanceCount

  const downloadPromises = sections.map((section, idx) => {
    return new Promise<{ success: boolean; filePath?: string; error?: string; idx: number }>((resolve) => {
      const outputTemplate = path.join(outputDir, `${workspaceId}_part${String(idx).padStart(2, '0')}_%(id)s.%(ext)s`)
      const args = [
        ...buildYtDlpArgs(ytdlp, videoUrl, formatSelector, outputTemplate, makeSectionArg(section.start, section.end), idx, poToken, ytCookiesFile),
        ...cacheDirArgs,
      ]

      const proc = spawn(ytdlp, args, {
        env: { ...process.env, PATH: enrichedPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stderr = ''
      let downloadedFile = ''
      let instanceProgress = 0

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        const pctMatch = text.match(/(\d+\.?\d*)%/)
        if (pctMatch) {
          const pct = parseFloat(pctMatch[1])
          if (pct >= 0 && pct <= 100) {
            instanceProgress = pct
            // Aggregate: completed instances' 100% + this instance's current %
            const total = completedInstances.count * progressPerInstance + (instanceProgress / 100) * progressPerInstance
            onProgress?.({ workspaceId, percent: total, speed: '', eta: '', downloaded: '', total: '' })
          }
        }
        const destMatch = text.match(/Dest(?:ination)?:\s*(.+)/)
        if (destMatch) downloadedFile = destMatch[1].trim()
        const mergeMatch = text.match(/Merging formats into "(.+)"/)
        if (mergeMatch) downloadedFile = mergeMatch[1]
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
        const pctMatch = data.toString().match(/(\d+\.?\d*)%/)
        if (pctMatch) {
          const pct = parseFloat(pctMatch[1])
          if (pct >= 0 && pct <= 100) {
            instanceProgress = pct
            const total = completedInstances.count * progressPerInstance + (instanceProgress / 100) * progressPerInstance
            onProgress?.({ workspaceId, percent: total, speed: '', eta: '', downloaded: '', total: '' })
          }
        }
        const destMatch = data.toString().match(/Dest(?:ination)?:\s*(.+)/)
        if (destMatch && !downloadedFile) downloadedFile = destMatch[1].trim()
        const mergeMatch = data.toString().match(/Merging formats into "(.+)"/)
        if (mergeMatch) downloadedFile = mergeMatch[1]
      })

      proc.on('close', (code) => {
        if (!downloadedFile) {
          try {
            const files = fs.readdirSync(outputDir)
            const match = files.find(f => f.startsWith(`${workspaceId}_part${String(idx).padStart(2, '0')}_`) && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f))
            if (match) downloadedFile = path.join(outputDir, match)
          } catch {}
        }

        completedInstances.count++
        if (code === 0 && downloadedFile) {
          chunkFiles[idx] = downloadedFile
          resolve({ success: true, filePath: downloadedFile, idx })
        } else {
          const err = stderr.includes('ERROR') ? stderr.split('\n').find(l => l.includes('ERROR')) : `code ${code}`
          resolve({ success: false, error: err || `instance ${idx} failed`, idx })
        }
      })

      setTimeout(() => {
        if (!proc.killed) proc.kill()
        resolve({ success: false, error: `instance ${idx} timeout`, idx })
      }, 15 * 60 * 1000) // 15 min per instance
    })
  })

  const results = await Promise.all(downloadPromises)
  const failedInstances = results.filter(r => !r.success)

  if (failedInstances.length > 0) {
    // OPTIMIZATION #6: Exponential backoff retry — if any instances failed, retry once with backoff
    if (retryStrategy === 'exponential' && failedInstances.length > 0) {
      console.log(`[yt-dlp] Retrying ${failedInstances.length} failed instances with exponential backoff...`)
      try {
        const retryResults = await withExponentialBackoff(async () => {
          const retryPromises = failedInstances.map(async (failedResult) => {
            const sectionIdx = failedResult.idx
            const section = sections[sectionIdx]
            const outputTemplate = path.join(outputDir, `${workspaceId}_part${String(sectionIdx).padStart(2, '0')}_%(id)s.%(ext)s`)
            const args = [
              ...buildYtDlpArgs(ytdlp, videoUrl, formatSelector, outputTemplate, makeSectionArg(section.start, section.end), sectionIdx, poToken, ytCookiesFile),
              ...cacheDirArgs,
            ]

            return new Promise<{ success: boolean; filePath?: string; error?: string; idx: number }>((resolve) => {
              const proc = spawn(ytdlp, args, { env: { ...process.env, PATH: enrichedPath }, stdio: ['ignore', 'pipe', 'pipe'] })
              let stderr = ''
              let downloadedFile = ''
              proc.stdout?.on('data', (data: Buffer) => {
                const text = data.toString()
                const destMatch = text.match(/Dest(?:ination)?:\s*(.+)/)
                if (destMatch) downloadedFile = destMatch[1].trim()
                const mergeMatch = text.match(/Merging formats into "(.+)"/)
                if (mergeMatch) downloadedFile = mergeMatch[1]
              })
              proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
              proc.on('close', (code) => {
                if (!downloadedFile) {
                  try {
                    const files = fs.readdirSync(outputDir)
                    const match = files.find(f => f.startsWith(`${workspaceId}_part${String(sectionIdx).padStart(2, '0')}_`) && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f))
                    if (match) downloadedFile = path.join(outputDir, match)
                  } catch {}
                }
                if (code === 0 && downloadedFile) {
                  chunkFiles[sectionIdx] = downloadedFile
                  resolve({ success: true, filePath: downloadedFile, idx: sectionIdx })
                } else {
                  const err = stderr.includes('ERROR') ? stderr.split('\n').find(l => l.includes('ERROR')) : `code ${code}`
                  resolve({ success: false, error: err || `instance ${sectionIdx} retry failed`, idx: sectionIdx })
                }
              })
              setTimeout(() => { if (!proc.killed) proc.kill(); resolve({ success: false, error: `timeout`, idx: sectionIdx }) }, 15 * 60 * 1000)
            })
          })
          return Promise.all(retryPromises)
        })
        const retryFailed = retryResults.filter(r => !r.success)
        if (retryFailed.length > 0) {
          console.warn(`[yt-dlp] ${retryFailed.length} instances still failed after retry — falling back to single-instance`)
          for (const file of chunkFiles) { if (file) try { fs.unlinkSync(file) } catch {} }
          return null
        }
        console.log(`[yt-dlp] All instances succeeded after retry`)
      } catch {
        console.warn(`[yt-dlp] Exponential backoff retry failed — falling back to single-instance`)
        for (const file of chunkFiles) { if (file) try { fs.unlinkSync(file) } catch {} }
        return null
      }
    } else {
      console.warn(`[yt-dlp] ${failedInstances.length}/${instanceCount} instances failed — falling back to single-instance download`)
      for (const file of chunkFiles) { if (file) try { fs.unlinkSync(file) } catch {} }
      return null
    }
  }

  console.log(`[yt-dlp] All ${instanceCount} instances complete — merging with FFmpeg concat`)

  // Merge all sections with FFmpeg concat demuxer (stream copy — no re-encode, very fast)
  const concatListFile = path.join(outputDir, `${workspaceId}_concat.txt`)
  const concatList = chunkFiles.filter((f): f is string => !!f).map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n')
  fs.writeFileSync(concatListFile, concatList, 'utf-8')

  const outputFile = path.join(outputDir, `${workspaceId}.mp4`)
  const mergeArgs = [
    '-f', 'concat', '-safe', '0',
    '-i', `"${concatListFile.replace(/\\/g, '/')}"`,
    '-c', 'copy',
    '-y', `"${outputFile.replace(/\\/g, '/')}"`,
  ]

  const mergeResult = runSimpleFfmpeg(ffmpegPath, mergeArgs)
  try { fs.unlinkSync(concatListFile) } catch {}

  // Clean up intermediate section files
  for (const file of chunkFiles) {
    if (file) try { fs.unlinkSync(file) } catch {}
  }

  if (mergeResult.code !== 0 || !fs.existsSync(outputFile)) {
    console.error(`[yt-dlp] FFmpeg concat failed: ${mergeResult.stderr}`)
    return null
  }

  const fileSize = fs.statSync(outputFile).size
  console.log(`[yt-dlp] Merge complete: ${outputFile} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`)

  return {
    success: true,
    workspaceId,
    filePath: outputFile,
    duration: Math.floor(videoDurationSec),
    fileSize,
  }
}

// ─── Pre-scale source video to output resolution ─────────────────────────────────
// OPTIMIZATION #3+#6: Downscale the source video to the target export resolution
// AFTER download/trim but BEFORE render. This eliminates the scale filter from the render
// pipeline entirely, saving ~5-10s per render.
//
// How it works:
//   Download: 1080p source (e.g. 1920x1080)
//   Pre-scale: 1920x1080 → 480x480 (ultrafast, ~1-2s)
//   Render: reads pre-scaled 480p → NO scale filter needed → encode only
//
// Tradeoff: extra ~1-2s pre-processing, but render is ~5-10s faster.
// For auto-render pipeline: net savings = ~3-8s per video.

export async function preScaleVideo(
  sourcePath: string,
  outputPath: string,
  targetWidth: number,
): Promise<{ success: boolean; error?: string }> {
  const ffmpeg = getFfmpegPath()

  // Use libx264 with ultrafast preset — scale only, no quality loss
  // The source is being downscaled so ultrafast is perfectly fine
  const args: string[] = [
    '-i', quotePath(sourcePath),
    '-vf', `scale=${targetWidth}:-2:force_original_aspect_ratio=decrease`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '18',           // Lossless for practical purposes (CRF 18 ≈ high quality)
    '-c:a', 'copy',         // Copy audio without re-encoding
    '-threads', '4',
    '-y', quotePath(outputPath),
  ]

  const cmd = buildArgs(ffmpeg, args)

  return new Promise((resolve) => {
    const proc = spawn(cmd, [], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr.slice(0, 200) || `ffmpeg exit ${code}` })
      }
    })
    setTimeout(() => {
      if (!proc.killed) proc.kill()
      resolve({ success: false, error: 'pre-scale timeout' })
    }, 60_000)
  })
}

export async function downloadVideo(opts: YtdlpOptions): Promise<DownloadResult> {
  const { workspaceId, videoUrl, outputDir, trimLimit, onProgress, quality = '720', maxInstances = 'auto', preFetchedDuration, retryStrategy, po_token } = opts
  const ytdlp = getYtdlpPath()

  // Verify yt-dlp exists before attempting spawn
  if (!fs.existsSync(ytdlp)) {
    const err = `[yt-dlp] NOT FOUND at: ${ytdlp}\n  Install: pip install yt-dlp\n  Or: winget install yt-dlp`
    console.error(err)
    return { success: false, workspaceId, error: err }
  }

  // Ensure output dir exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Check if file already exists (user may have manually saved it or app restarted mid-download)
  const existingFiles = (() => {
    try {
      return fs.readdirSync(outputDir).filter(f => f.startsWith(workspaceId + '_') && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f))
    } catch { return [] }
  })()
  if (existingFiles.length > 0) {
    const existingFile = path.join(outputDir, existingFiles[0])
    let fileSize = 0
    try { fileSize = fs.statSync(existingFile).size } catch {}
    console.log(`[yt-dlp] File already exists: ${existingFile} (${fileSize} bytes) — skipping download`)
    let duration = 0
    try {
      const ffprobePath = getFfprobePath()
      const out = execSync(`"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${existingFile}"`, { encoding: 'utf-8', timeout: 10000 })
      duration = Math.floor(parseFloat(out.trim()))
    } catch {}
    return { success: true, workspaceId, filePath: existingFile, duration, fileSize }
  }

  // Quality-aware format selector:
  // Priority 1: H.264 (fast decode) at or below quality cap
  // Priority 2: any codec at or below quality cap
  // Priority 3: best available at quality cap (no H.264 available)
  // Priority 4: best available without quality cap (corrupted/inaccessible video)
  const q = parseInt(quality)
  const maxHeight = isNaN(q) ? 720 : q
  const formatSelector = `bestvideo[height<=${maxHeight}][vcodec=h264]+bestaudio[acodec=aac]/bestvideo[height<=${maxHeight}][vcodec!=vp9][vcodec!=av1]+bestaudio[acodec=aac]/bestvideo[height<=${maxHeight}]+bestaudio/bestvideo+bestaudio/best`

  // Determine how many yt-dlp instances to use.
  // - 1080p+ with fast internet (200+ Mbps): multi-instance cuts download time by ~N
  // - 360-720p: single instance (CDN bottleneck, multi-instance won't help much)
  // - Low RAM (< 8GB free): limit to 1 instance
  const freeMemGB = os.freemem() / (1024 ** 3)
  const isHighQuality = maxHeight >= 1080

  let instanceCount: number
  if (maxInstances === 1) {
    instanceCount = 1
  } else if (maxInstances === 'auto') {
    if (freeMemGB >= 8 && isHighQuality) {
      // 1080p+ on decent RAM: 2 instances for near-doubling throughput
      // Cap at 2 to avoid YouTube rate-limit
      instanceCount = 2
    } else {
      instanceCount = 1
    }
  } else {
    instanceCount = Math.min(maxInstances, 4)
  }

  // ── Multi-instance section download (1080p+ on good internet) ────────────────
  if (instanceCount > 1 && typeof trimLimit === 'number' && trimLimit > 0) {
    const multiResult = await multiInstanceDownload({
      workspaceId, videoUrl, outputDir, formatSelector, trimLimit, instanceCount,
      onProgress, ytdlp, preFetchedDuration: opts.preFetchedDuration, retryStrategy: opts.retryStrategy,
      poToken: po_token, ytCookiesFile: opts.ytCookiesFile,
    })
    if (multiResult) return multiResult
    // Fallthrough to single instance if multi failed
  }

  // ── Core download: spawns yt-dlp, resolves with result ─────────────────────
  const doDownload = (extraArgs: string[]): Promise<DownloadResult> => {
    const outputTemplate = path.join(outputDir, `${workspaceId}_%(id)s.%(ext)s`)

    const args: string[] = [
      videoUrl,
      ...getJsRuntimeArgs(),
    ]

    // Quality strategy:
    // - With PO Token → android DASH bestvideo+bestaudio (1080p H.264) — best quality
    // - Without PO Token → ios client (H.264/AAC, 720p-1080p) — no PO Token needed
    //   iOS client reliably serves 720p-1080p H.264 without requiring PO Token.
    //   web client was serving 360p H.264 (format 18) — format availability differs from real browser.
    // - SABR-only experiment (YouTube-only 360p) → cannot be bypassed
    let resolvedFormat: string
    if (po_token) {
      args.push('--extractor-args', `youtube:player_client=android,po_token=${po_token}`)
      resolvedFormat = formatSelector
      console.log(`[yt-dlp] Using android DASH with PO Token (${po_token.slice(0, 8)}...)`)
    } else {
      args.push('--extractor-args', 'youtube:player_client=ios')
      // iOS client: H.264 preferred up to 1080p, then any codec
      resolvedFormat = 'bestvideo[height<=1080][vcodec=h264]+bestaudio[acodec=aac]/bestvideo[height<=1080]+bestaudio/bestvideo[height<=720]+bestaudio/best'
      console.log(`[yt-dlp] Using ios client (H.264 up to 1080p)`)
    }

    // Authenticate yt-dlp with Chrome cookies to bypass EJS anti-bot challenge
    if (opts.ytCookiesFile) {
      args.push('--cookies', opts.ytCookiesFile)
      console.log(`[yt-dlp] Using Chrome cookies: ${opts.ytCookiesFile!.split(/[/\\]/).pop()}`)
    }

    args.push(
      '-f', resolvedFormat,
      '--output', outputTemplate,
      '--no-playlist',
      '--newline',
      '--concurrent-fragments', '32',
      '--retries', '3',
      '--fragment-retries', '3',
      '--socket-timeout', '10',
      '--http-chunk-size', '10485760',
      ...extraArgs,
    )

    // Build ffmpeg-enriched PATH
    const ffmpegPath = getFfmpegPath()
    const ffmpegDir = path.dirname(ffmpegPath)
    const ytDlpDir = path.dirname(ytdlp)
    const enrichedPath = ffmpegDir + path.delimiter + ytDlpDir + path.delimiter + (process.env.PATH || '')
    console.log(`[yt-dlp] Spawning: "${ytdlp}"`)
    console.log(`[yt-dlp] Args:`, args)

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let downloadedFile = ''
      let progressEmitted = false

      const proc = spawn(ytdlp, args, {
        env: { ...process.env, PATH: enrichedPath },
      })

      proc.on('error', (err) => {
        resolve({ success: false, workspaceId, error: `spawn error: ${err.message}` })
      })

      // Emit progress IMMEDIATELY when process spawns.
      // yt-dlp outputs no % lines while YouTube is "processing" (fresh uploads).
      // Users see 0% forever without this — so show "downloading" right away.
      onProgress?.({ workspaceId, percent: 0, speed: '...', eta: '...', downloaded: '', total: '' })

      proc.stdout?.on('data', (data) => {
        const text = data.toString()
        stdout += text
        // Parse standard progress line: "  25.3% of   45.00MiB at  1.23MiB/s ETA 0:32"
        const progressMatch = text.match(/(\d+\.?\d*)%.*at\s+([\d.]+\w+)\s+ETA\s+([\d:]+)/)
        // Fallback: just percent + file size (for section downloads that omit speed/ETA)
        const pctMatch = text.match(/(\d+\.?\d*)%.*(?:of\s+[^\s]+\s+)?(?:at\s+([\d.]+\w+)\/s)?\s*(?:ETA\s+([\d:]+))?/)
        const destMatch = text.match(/(?:Dest(?:ination)?):\s*(.+)/)
        const mergeMatch = text.match(/Merging formats into "(.+)"/)
        const errorMatch = text.match(/ERROR.*?:?\s*(.+)/)


        if (progressMatch) {
          if (!progressEmitted) { console.log(`[yt-dlp] Download started!`); progressEmitted = true }
          onProgress?.({
            workspaceId,
            percent: parseFloat(progressMatch[1]),
            speed: progressMatch[2],
            eta: progressMatch[3],
            downloaded: '',
            total: '',
          })
        } else if (pctMatch) {
          const pct = parseFloat(pctMatch[1])
          if (pct >= 0 && pct <= 100) {
            if (!progressEmitted) { console.log(`[yt-dlp] Download started!`); progressEmitted = true }
            onProgress?.({
              workspaceId,
              percent: pct,
              speed: pctMatch[2] ? pctMatch[2] + '/s' : '',
              eta: pctMatch[3] || '',
              downloaded: '',
              total: '',
            })
          }
        } else if (destMatch) {
          console.log(`[yt-dlp] Dest: ${destMatch[1].trim()}`)
        } else if (mergeMatch) {
          downloadedFile = mergeMatch[1]
          console.log(`[yt-dlp] Merged to: ${downloadedFile}`)
        } else if (errorMatch) {
          stderr += errorMatch[1] + '\n'
        } else if (text.includes('[download]') && !text.includes('%') && !text.includes('ERROR')) {
          // Log interesting download events: fragment info, merge steps, etc.
          const trimmed = text.trim().slice(0, 120)
          if (trimmed) console.log(`[yt-dlp] ${trimmed}`)
        }
      })

      proc.stderr?.on('data', (data) => {
        const text = data.toString()
        stderr += text

        // On Windows, yt-dlp sends progress to stderr — parse it here
        const progressMatch = text.match(/(\d+\.?\d*)%.*at\s+([\d.]+\w+)\s+ETA\s+([\d:]+)/)
        const pctMatch = text.match(/(\d+\.?\d*)%.*(?:of\s+[^\s]+\s+)?(?:at\s+([\d.]+\w+)\/s)?\s*(?:ETA\s+([\d:]+))?/)
        // Match both formats: "[download] Destination: ..." and "[yt-dlp] Dest: ..."
        const destMatch = text.match(/(?:\[download\]\s*Dest(?:ination)?:|\[yt-dlp\]\s*Dest:)\s*(.+)/)
        const mergeMatch = text.match(/\[download\] Merging formats into "(.+)"/)

        if (progressMatch) {
          if (!progressEmitted) { console.log(`[yt-dlp] Download started!`); progressEmitted = true }
          onProgress?.({
            workspaceId,
            percent: parseFloat(progressMatch[1]),
            speed: progressMatch[2],
            eta: progressMatch[3],
            downloaded: '',
            total: '',
          })
        } else if (pctMatch) {
          const pct = parseFloat(pctMatch[1])
          if (pct >= 0 && pct <= 100) {
            if (!progressEmitted) { console.log(`[yt-dlp] Download started!`); progressEmitted = true }
            onProgress?.({
              workspaceId,
              percent: pct,
              speed: pctMatch[2] ? pctMatch[2] + '/s' : '',
              eta: pctMatch[3] || '',
              downloaded: '',
              total: '',
            })
          }
        } else if (destMatch && !downloadedFile) {
          downloadedFile = destMatch[1].trim()
        } else if (mergeMatch) {
          downloadedFile = mergeMatch[1]
        }
      })

      // Timeout: 15 min for section download (YouTube processing delay),
      // 30 min for full download
      const timeout = extraArgs.length > 0 ? 15 * 60 * 1000 : 30 * 60 * 1000
      const timer = setTimeout(() => {
        if (!proc.killed) proc.kill()
        resolve({ success: false, workspaceId, error: 'Download timeout' })
      }, timeout)

      proc.on('close', (code) => {
        clearTimeout(timer)
        console.log(`[yt-dlp] Closed code=${code}, file="${downloadedFile}"`)

        if (stderr.length > 0) {
          const lines = stderr.trim().split('\n').slice(0, 10)
          console.log(`[yt-dlp] stderr: ${lines.join(' | ')}`)
        }

        // Fallback: scan for file by workspaceId pattern
        if (!downloadedFile) {
          try {
            const files = fs.readdirSync(outputDir)
            // Accept any video extension — yt-dlp may produce .webm, .mkv, .mp4, etc.
        const match = files.find(f => f.startsWith(workspaceId + '_') && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f))
            if (match) downloadedFile = path.join(outputDir, match)
          } catch {}
        }

        const isFatalError = code !== 0 && code !== 2
        if (isFatalError || !downloadedFile) {
          const errorLines = stderr.trim().split('\n').filter(l => l.includes('ERROR'))
          const fullError = errorLines.join(' | ') || `yt-dlp code ${code}`
          // Classify error for better debugging
          if (fullError.includes('429') || fullError.includes('Too Many Requests')) {
            console.log(`[yt-dlp] 429 Rate Limit — YouTube is throttling this request`)
          } else if (fullError.includes('processing this video') || fullError.includes('processing this video')) {
            console.log(`[yt-dlp] Video still processing — YouTube hasn't finished encoding yet`)
          } else if (fullError.includes('not available')) {
            console.log(`[yt-dlp] Video unavailable or deleted`)
          } else {
            console.log(`[yt-dlp] Download failed: ${fullError.slice(0, 200)}`)
          }
          resolve({ success: false, workspaceId, error: fullError })
          return
        }

        let fileSize = 0
        try { fileSize = fs.statSync(downloadedFile).size } catch {}

        let duration = 0
        try {
          const ffprobePath = getFfprobePath()
          const out = execSync(`"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${downloadedFile}"`, { encoding: 'utf-8', timeout: 10000 })
          duration = Math.floor(parseFloat(out.trim()))
        } catch {}

        resolve({ success: true, workspaceId, filePath: downloadedFile, duration, fileSize })
      })
    })
  }

  // Step 1: try section download (fast — downloads only needed portion).
  // NOTE: section download is skipped for videos > trimLimit because yt-dlp can't
  // append sections. In that case we download full, then FFmpeg cuts the trim.
  const sectionArg = (() => {
    if (typeof trimLimit !== 'number' || trimLimit <= 0) return null
    const totalSeconds = trimLimit * 60
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
    const ss = String(totalSeconds % 60).padStart(2, '0')
    return `*00:00:00-${hh}:${mm}:${ss}`
  })()

  if (sectionArg) {
    const sectionResult = await doDownload(['--download-sections', sectionArg])
    if (sectionResult.success && sectionResult.filePath) {
      // Verify: file must be > 100KB (corrupt/invalid section download = tiny file)
      if (sectionResult.fileSize && sectionResult.fileSize > 100_000) {
        console.log(`[yt-dlp] Section download OK: ${sectionResult.filePath} (${sectionResult.fileSize} bytes)`)
        return sectionResult
      }
      // Suspiciously small — section download may have produced corrupt output
      console.warn(`[yt-dlp] Section produced tiny file (${sectionResult.fileSize} bytes) — retrying full`)
    } else {
      console.warn(`[yt-dlp] Section download failed: ${sectionResult.error} — retrying full`)
    }
  }

  // Step 2: fallback to full download (covers section-parse failures + 'full' trim limit)
  console.log('[yt-dlp] Falling back to full download...')
  return doDownload([])
}
