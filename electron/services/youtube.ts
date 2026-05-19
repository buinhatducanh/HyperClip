import { spawn, execSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import https from 'https'
import { app } from 'electron'
import { getFfmpegPath, getFfprobePath } from './ffmpeg-paths.js'
import { buildArgs, runSimpleFfmpeg, quotePath } from './ffmpeg.js'
import { devLog } from './unified_log.js'

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
    } catch {
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
  /** ETA: seconds (numeric) or 'M:SS' string — fmtEta handles both */
  eta: number | string
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

// ─── Simulated progress ticker ─────────────────────────────────────────────────
// Simulates download progress when yt-dlp is slow to emit real %. Prevents 0% stuck bar.
const _simTicker = new Map<string, ReturnType<typeof setInterval>>()

function stopSimulation(workspaceId: string) {
  const id = _simTicker.get(workspaceId)
  if (id !== undefined) {
    clearInterval(id)
    _simTicker.delete(workspaceId)
  }
}

function _simulateDownloadProgress(
  workspaceId: string,
  onProgress: ((progress: DownloadProgress) => void) | undefined,
  durationSec: number,
  quality: string,
  trimLimitSec: number,
) {
  stopSimulation(workspaceId)

  // Estimate file size (MB) based on quality + duration
  const kbps: Record<string, number> = { '360': 800, '480': 1500, '720': 3000, '1080': 6000 }
  const speedKbps = kbps[quality] ?? 2000
  const actualSec = trimLimitSec > 0 && trimLimitSec < durationSec ? trimLimitSec : durationSec
  const estimatedSec = Math.max(10, (actualSec * speedKbps) / 4000) // generous estimate (kbps/4000 ≈ seconds for typical connection)
  const totalTicks = Math.floor(estimatedSec * 4) // update every ~250ms
  const tickMs = Math.max(150, Math.min(400, (estimatedSec * 1000) / totalTicks))

  let currentPct = 0
  let stuckAt = 0 // if > 0, simulation is "stuck" waiting for real download

  const ticker = setInterval(() => {
    // Stop automatically when real progress has taken over (progressEmitted tracked by caller)
    if (!_simTicker.has(workspaceId)) { clearInterval(ticker); return }
    if (stuckAt > 0) {
      // Stuck phase: advance very slowly (0.1-0.5%)
      const inc = 0.1 + Math.random() * 0.4
      currentPct = Math.min(stuckAt + inc, stuckAt + 2)
      if (currentPct >= stuckAt + 2) stuckAt = 0 // unstick after 2%
    } else if (currentPct < 90) {
      // Normal phase: 0.1-2% per tick
      const inc = 0.1 + Math.random() * 1.9
      currentPct = Math.min(currentPct + inc, 90)
      if (currentPct >= 88 && currentPct < 90) stuckAt = currentPct // start stuck phase near 90%
    } else {
      // Finishing phase: 0.1-0.5%
      const inc = 0.1 + Math.random() * 0.4
      currentPct = Math.min(currentPct + inc, 99.9)
    }

    const pct = Math.min(99.9, Math.max(0, currentPct))
    const speedMap: Record<string, string> = { '360': '2.5MiB/s', '480': '4.5MiB/s', '720': '9MiB/s', '1080': '18MiB/s' }
    const speed = speedMap[quality] ?? '5MiB/s'
    const remainingSec = Math.max(1, Math.round((estimatedSec * (100 - pct)) / 100))

    onProgress?.({ workspaceId, percent: pct, speed, eta: remainingSec, downloaded: '', total: '' })
  }, tickMs)

  _simTicker.set(workspaceId, ticker)
  return stopSimulation.bind(null, workspaceId)
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
  /**
   * Override the default yt-dlp player client.
   * Use 'tv_embedded' for more lenient auth (H.264 720p without PO Token).
   * Use 'web' for standard web client (VP9/H.264 1080p with cookies).
   * If not set, yt-dlp auto-selects the best client.
   */
  playerClient?: string
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

    proc.stdout?.on('data', (d) => { stdout += d.toString() })

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
  // - Without PO Token → web client with Chrome cookies (1080p VP9/H.264).
  //   web client works for most public videos. On "Private video" error, caller retries
  //   with tv_embedded client (more lenient, H.264 720p).
  let resolvedFormat: string
  if (poToken) {
    args.push('--extractor-args', `youtube:player_client=android,po_token=${poToken}`)
    resolvedFormat = formatSelector // DASH: bestvideo+bestaudio
    console.log(`[yt-dlp] Using android DASH with PO Token (${poToken.slice(0, 8)}...)`)
  } else {
    // web client: works with session cookies for most public videos.
    args.push('--extractor-args', 'youtube:player_client=web')
    resolvedFormat = formatSelector
    console.log(`[yt-dlp] Using web client with cookies (best quality)`)
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

async function _multiInstanceDownload(opts: MultiInstanceOpts): Promise<DownloadResult | null> {
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
        // Detect FFmpeg post-processing start → freeze progress bar
        const str = data.toString()
        if (str.includes('Deleting original') || str.includes('Merging formats')) {
          onProgress?.({ workspaceId, percent: 99, speed: 'processing', eta: 0, downloaded: '', total: '' })
        }
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

// ─── Video availability pre-check ──────────────────────────────────────────────
// Fast probe: runs yt-dlp --no-download to check if a video is accessible.
// Used BEFORE downloading to avoid wasting time on private/geo-blocked/deleted videos.
// Returns null on probe failure (caller should proceed with caution).

export interface VideoProbeResult {
  available: boolean
  isPrivate: boolean       // yt-dlp says "Private video"
  isNotFound: boolean      // yt-dlp says "Video unavailable" / "not found"
  isRateLimited: boolean   // yt-dlp says 429 / "Too Many Requests"
  isProcessing: boolean     // yt-dlp says "is being processed"
  title: string
  duration: number         // actual duration from ffprobe (seconds), 0 if unknown
  error?: string           // raw error message if not available
}

/**
 * Probe video availability without downloading.
 * Uses web client + Chrome cookies for best detection accuracy.
 * Falls back to tv_embedded on "Private video" error.
 */
export async function probeVideoAvailability(
  videoUrl: string,
  ytCookiesFile: string | null,
): Promise<VideoProbeResult | null> {
  const ytdlp = getYtdlpPath()
  const ffmpeg = getFfmpegPath()
  const ffmpegDir = path.dirname(ffmpeg)
  const ytDlpDir = path.dirname(ytdlp)
  const enrichedPath = ffmpegDir + path.delimiter + ytDlpDir + path.delimiter + (process.env.PATH || '')

  const tryClient = async (client: string): Promise<VideoProbeResult | null> => {
    return new Promise((resolve) => {
      const args = [
        videoUrl,
        ...getJsRuntimeArgs(),
        '--extractor-args', `youtube:player_client=${client}`,
        '--dump-json',
        '--no-download',
        '--no-playlist',
        '--socket-timeout', '15',
      ]
      if (ytCookiesFile) {
        args.push('--cookies', ytCookiesFile)
      }

      const proc = spawn(ytdlp, args, {
        env: { ...process.env, PATH: enrichedPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (d) => { stdout += d.toString() })
      proc.stderr?.on('data', (d) => { stderr += d.toString() })

      const killTimer = setTimeout(() => {
        if (!proc.killed) proc.kill()
        resolve(null)
      }, 20000)

      proc.on('close', (code) => {
        clearTimeout(killTimer)
        const err = stderr.toLowerCase()

        if (code === 0 && stdout.trim()) {
          try {
            const info = JSON.parse(stdout.trim())
            return resolve({
              available: true,
              isPrivate: false,
              isNotFound: false,
              isRateLimited: false,
              isProcessing: false,
              title: info.title || '',
              duration: info.duration || 0,
            })
          } catch {
            return resolve(null)
          }
        }

        const isPrivate = err.includes('private video')
        const isNotFound = err.includes('not available') || err.includes('video unavailable') || err.includes('video not found')
        const isRateLimited = err.includes('429') || err.includes('too many requests')
        const isProcessing = err.includes('processing') || err.includes('is being processed')

        if (isPrivate || isNotFound || isRateLimited || isProcessing) {
          return resolve({
            available: false,
            isPrivate,
            isNotFound,
            isRateLimited,
            isProcessing,
            title: '',
            duration: 0,
            error: stderr.trim().slice(0, 300),
          })
        }

        // Unknown error — return null to signal "couldn't determine"
        resolve(null)
      })

      proc.on('error', () => {
        clearTimeout(killTimer)
        resolve(null)
      })
    })
  }

  // Try web client first
  const webResult = await tryClient('web')
  if (webResult) {
    // If web says private, try tv_embedded as fallback probe
    if (webResult.isPrivate) {
      const tvResult = await tryClient('tv_embedded')
      if (tvResult) return tvResult
      // tv_embedded also failed — return web's result
      return webResult
    }
    return webResult
  }

  // Probe failed entirely — return null (caller should attempt download with caution)
  return null
}

/** Use ffprobe to get real video duration from a downloaded file. */
export async function probeActualDuration(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) return 0
  try {
    const ffprobePath = getFfprobePath()
    const out = execSync(
      `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -- "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 },
    )
    return Math.max(0, Math.floor(parseFloat(out.trim())))
  } catch {
    return 0
  }
}

// ─── Client strategy download with fallback chain ───────────────────────────────
// Client chain: tv_embedded → web → ios
// - tv_embedded: H.264 720p/1080p60 (avc1.64001f/avc1.64002a), bypasses EJS via HLS
// - web: H.264 360p only when EJS blocks it with Chrome session cookies
// - ios: H.264, another fallback for edge cases

// ─── Available formats probe ───────────────────────────────────────────────────
// Probes YouTube for available video heights without downloading.
// Returns the heights (360, 720, 1080) that are actually available.
// tv_embedded probe (not web) since it returns full format list even when EJS challenges web.

export interface AvailableFormatsResult {
  videoId: string
  heights: number[]  // e.g. [360, 720, 1080] — sorted ascending
}

export async function probeAvailableFormats(
  videoUrl: string,
  ytCookiesFile: string | null,
): Promise<AvailableFormatsResult | null> {
  const ytdlp = getYtdlpPath()
  const ffmpeg = getFfmpegPath()
  const ffmpegDir = path.dirname(ffmpeg)
  const ytDlpDir = path.dirname(ytdlp)
  const enrichedPath = ffmpegDir + path.delimiter + ytDlpDir + path.delimiter + (process.env.PATH || '')

  // Try tv_embedded first — returns full format list even when web is EJS-blocked
  for (const client of ['tv_embedded', 'web'] as const) {
    const result = await new Promise<AvailableFormatsResult | null>((resolve) => {
      const args = [
        videoUrl,
        ...getJsRuntimeArgs(),
        '--extractor-args', `youtube:player_client=${client}`,
        '--dump-json',
        '--no-download',
        '--no-playlist',
        '--socket-timeout', '15',
      ]
      if (ytCookiesFile) args.push('--cookies', ytCookiesFile)

      const proc = spawn(ytdlp, args, {
        env: { ...process.env, PATH: enrichedPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''

      proc.stdout?.on('data', (d) => { stdout += d.toString() })

      const killTimer = setTimeout(() => { if (!proc.killed) proc.kill(); resolve(null) }, 15000)

      proc.on('close', (code) => {
        clearTimeout(killTimer)
        if (code === 0 && stdout.trim()) {
          try {
            const info = JSON.parse(stdout.trim())
            const formats: Array<{ height?: number; vcodec?: string }> = info.formats || []
            const heights = [...new Set(
              formats
                .filter(f => f.height != null && f.height > 0 && f.vcodec !== 'none' && !f.vcodec?.startsWith('jpg'))
                .map(f => f.height!)
            )]
            heights.sort((a, b) => a - b)

            // Extract videoId from URL
            const idMatch = videoUrl.match(/[?&]v=([^&]+)/)
            const videoId = idMatch ? idMatch[1] : ''

            resolve({ videoId, heights })
          } catch {
            resolve(null)
          }
        }
        resolve(null)
      })

      proc.on('error', () => { clearTimeout(killTimer); resolve(null) })
    })

    if (result && result.heights.length > 0) return result
  }

  return null
}
//
// Error classification:
//   Private → try next client
//   429 / rate-limit → exponential backoff + try next client
//   not available / deleted → STOP, return error
//   processing → exponential backoff, retry same client
//   probe failure → try next client
//   all failed → return error

type YtdlpClient = 'web' | 'tv_embedded' | 'ios'

interface DownloadStrategyOpts {
  workspaceId: string
  videoUrl: string
  outputDir: string
  trimLimit: number | 'full'
  quality?: string
  maxInstances?: 'auto' | number
  onProgress?: (progress: DownloadProgress) => void
  ytCookiesFile?: string | null
  /** Pre-probed availability result — skips the pre-check probe if provided. */
  preChecked?: VideoProbeResult
}

interface DownloadStrategyResult {
  success: boolean
  workspaceId: string
  filePath?: string
  duration?: number
  fileSize?: number
  error?: string
  /** Client that succeeded */
  client?: string
  /** Why download ended (for logging) */
  reason?: string
}

/**
 * High-level download function with client fallback chain.
 * Replaces the old downloadVideo() — callers should use this.
 *
 * Flow:
 * 1. (Optional) Fast pre-check probe — detect private/short/unavailable BEFORE downloading
 * 2. Client chain: web → tv_embedded → ios, each with section→full fallback
 * 3. Multi-instance only if video is actually > 30s
 * 4. Rate-limit detection with exponential backoff
 */
export async function downloadVideoStrategy(
  opts: DownloadStrategyOpts,
): Promise<DownloadStrategyResult> {
  const { workspaceId } = opts

  // tv_embedded first: returns H.264 720p/1080p (avc1.64001f/avc1.64002a)
  // even when 'web' client is limited to 360p by EJS challenge with Chrome session cookies.
  // web second: fallback for edge cases (private videos, geo-restrictions).
  const clients: YtdlpClient[] = ['tv_embedded', 'web', 'ios']

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i]
    devLog(`[Download] Trying client: ${client} (${i + 1}/${clients.length})`)

    const result = await downloadWithClient({
      ...opts,
      client,
    })

    if (result.success) {
      devLog(`[Download] ${client} succeeded: ${result.filePath}`)
      return result
    }

    const err = result.error || ''

    // Fatal errors — stop trying other clients
    if (result.isNotFound) {
      devLog(`[Download] ${client} → video not available/deleted — giving up`)
      return result
    }

    if (result.isRateLimited) {
      devLog(`[Download] ${client} → rate-limited (429) — exponential backoff`)
      // Exponential backoff: 2s, 4s, 8s
      const delay = 2000 * Math.pow(2, i)
      await new Promise(r => setTimeout(r, delay))
      // Continue to next client
      continue
    }

    if (result.isProcessing) {
      devLog(`[Download] ${client} → video still processing — exponential backoff`)
      const delay = 15000 + Math.random() * 10000
      await new Promise(r => setTimeout(r, delay))
      // Retry same client after backoff
      const retry = await downloadWithClient({ ...opts, client })
      if (retry.success) return retry
    }

    // Private video — try next client
    if (result.isPrivate) {
      devLog(`[Download] ${client} → private/unauthorized — trying next client`)
      continue
    }

    // Unknown error — try next client
    devLog(`[Download] ${client} → unknown error: ${err.slice(0, 100)} — trying next client`)
    continue
  }

  // All clients failed
  return {
    success: false,
    workspaceId,
    error: 'All download clients failed',
  }
}

interface DownloadWithClientOpts extends DownloadStrategyOpts {
  client: YtdlpClient
}

async function downloadWithClient(opts: DownloadWithClientOpts): Promise<DownloadStrategyResult & { isPrivate?: boolean; isNotFound?: boolean; isRateLimited?: boolean; isProcessing?: boolean }> {
  const { workspaceId, videoUrl, outputDir, trimLimit, quality = '720', maxInstances = 'auto', onProgress, ytCookiesFile, client } = opts

  const ytdlp = getYtdlpPath()
  if (!fs.existsSync(ytdlp)) {
    return { success: false, workspaceId, error: `yt-dlp not found at ${ytdlp}` }
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Check for existing file
  const existingFiles = (() => {
    try {
      return fs.readdirSync(outputDir).filter(f =>
        f.startsWith(workspaceId + '_') && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f)
      )
    } catch { return [] }
  })()
  if (existingFiles.length > 0) {
    const existingFile = path.join(outputDir, existingFiles[0])
    let fileSize = 0
    try { fileSize = fs.statSync(existingFile).size } catch {}
    const duration = await probeActualDuration(existingFile)
    devLog(`[Download] File already exists: ${existingFile} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`)
    return { success: true, workspaceId, filePath: existingFile, duration, fileSize, reason: 'existing_file' }
  }

  const q = parseInt(quality)
  const maxHeight = isNaN(q) ? 720 : q
  // Priority: any codec @ target quality + AAC -> any codec @ target + best audio
  // -> any codec @ lower quality -> bestvideo+bestaudio (no cap).
  // This ensures VP9/AV1 1080p is picked over H.264 360p when H.264 1080p unavailable.
  const formatSelector = [
    // Any codec @ target quality + AAC
    `bestvideo[height<=${maxHeight}]+bestaudio[acodec=aac]/bestvideo[height<=${maxHeight}]+bestaudio/bestvideo+bestaudio/bestvideo+bestaudio`,
    // Any codec @ any quality + best audio
    `bestvideo+bestaudio/bestvideo+bestaudio/bestvideo+bestaudio/bestvideo+bestaudio`,
  ].join('/')
  console.log(`[Download] quality=${quality} maxHeight=${maxHeight}p selector=${formatSelector}`)

  // Multi-instance: only for 1080p+ with enough free RAM AND video > 30s
  const freeMemGB = os.freemem() / (1024 ** 3)
  let instanceCount = 1
  if (maxInstances === 'auto' && freeMemGB >= 8 && maxHeight >= 1080) {
    instanceCount = 2
  } else if (typeof maxInstances === 'number' && maxInstances > 1) {
    instanceCount = Math.min(maxInstances, 4)
  }

  // ── Try section download first (fast) ──────────────────────────────────────
  const sectionArg = (() => {
    if (typeof trimLimit !== 'number' || trimLimit <= 0) return null
    const totalSeconds = trimLimit * 60
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
    const ss = String(totalSeconds % 60).padStart(2, '0')
    return `*00:00:00-${hh}:${mm}:${ss}`
  })()

  if (sectionArg && instanceCount > 1) {
    // For multi-instance: use trimLimit duration, but verify video is long enough AFTER download
    // by checking the file size. If file is suspiciously small (< 100KB per 10s), skip multi.
    const result = await spawnDownload({
      workspaceId, videoUrl, outputDir, formatSelector, client, ytCookiesFile,
      extraArgs: ['--download-sections', sectionArg],
      instanceCount, sectionArg, maxInstances, quality, onProgress,
    })

    if (result.success) {
      // Verify actual duration with ffprobe
      const actualDuration = await probeActualDuration(result.filePath!)
      if (actualDuration > 0 && actualDuration < 30) {
        devLog(`[Download] Section succeeded but video is only ${actualDuration}s — multi-instance wasted, continuing`)
      }
      return result
    }

    // Section failed — classify error
    const classified = classifyError(result.error || '', result.stderr || '')
    if (classified.isNotFound) return { ...result, ...classified }
    if (classified.isRateLimited) return { ...result, ...classified }
    if (classified.isProcessing) return { ...result, ...classified }

    // For private/error: try full download below
    devLog(`[Download] Section failed: ${result.error?.slice(0, 80)} — falling back to full`)
  }

  // ── Full download (with section if trimLimit was set) ─────────────────────
  // ALWAYS pass sectionArg to yt-dlp if trimLimit was configured — this makes yt-dlp
  // skip HLS segments beyond the trim window (significant bandwidth savings).
  const result = await spawnDownload({
    workspaceId, videoUrl, outputDir, formatSelector, client, ytCookiesFile,
    extraArgs: sectionArg ? ['--download-sections', sectionArg] : [],
    instanceCount: 1, sectionArg: null, maxInstances: 1, quality, onProgress,
  })

  if (result.success) {
    const actualDuration = await probeActualDuration(result.filePath!)
    return { ...result, duration: actualDuration > 0 ? actualDuration : result.duration }
  }

  const classified = classifyError(result.error || '', result.stderr || '')
  return { ...result, ...classified }
}

interface SpawnDownloadOpts {
  workspaceId: string
  videoUrl: string
  outputDir: string
  formatSelector: string
  client: YtdlpClient
  ytCookiesFile?: string | null
  extraArgs: string[]
  instanceCount: number
  sectionArg: string | null
  maxInstances: 'auto' | number
  quality: string
  onProgress?: (progress: DownloadProgress) => void
}

function classifyError(error: string, stderr: string): { isPrivate: boolean; isNotFound: boolean; isRateLimited: boolean; isProcessing: boolean } {
  const combined = (error + ' ' + stderr).toLowerCase()
  return {
    isPrivate: combined.includes('private video') || combined.includes('sign in if you\'ve been granted access'),
    isNotFound: combined.includes('not available') || combined.includes('video unavailable') || combined.includes('video not found') || combined.includes('removed by'),
    isRateLimited: combined.includes('429') || combined.includes('too many requests') || combined.includes('rate limit'),
    isProcessing: combined.includes('processing') && combined.includes('video'),
  }
}

async function spawnDownload(opts: SpawnDownloadOpts): Promise<DownloadStrategyResult & { stderr?: string }> {
  const { workspaceId, videoUrl, outputDir, formatSelector, client, ytCookiesFile, extraArgs, onProgress } = opts

  const ytdlp = getYtdlpPath()
  const ffmpeg = getFfmpegPath()
  const ffmpegDir = path.dirname(ffmpeg)
  const ytDlpDir = path.dirname(ytdlp)
  const enrichedPath = ffmpegDir + path.delimiter + ytDlpDir + path.delimiter + (process.env.PATH || '')

  const outputTemplate = path.join(outputDir, `${workspaceId}_%(id)s.%(ext)s`)
  const args: string[] = [
    videoUrl,
    ...getJsRuntimeArgs(),
    '--extractor-args', `youtube:player_client=${client}`,
    ...(ytCookiesFile ? ['--cookies', ytCookiesFile] : []),
    '-f', formatSelector,
    '--merge-output-format', 'mp4',
    '--remux-video', 'mp4',
    '--output', outputTemplate,
    '--no-playlist',
    '--newline',
    '--concurrent-fragments', '16',
    '--retries', '3',
    '--fragment-retries', '3',
    '--socket-timeout', '15',
    '--http-chunk-size', '10485760',
    ...extraArgs,
  ]

  devLog(`[Download] Spawning yt-dlp (${client}): ${ytdlp}`)
  devLog(`[Download] Args:`, args.map(a => a.length > 60 ? a.slice(0, 60) + '...' : a))

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn(ytdlp, args, {
        env: { ...process.env, PATH: enrichedPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err: any) {
      resolve({ success: false, workspaceId, error: `spawn failed: ${err.message}` })
      return
    }

    let stderr = ''
    let downloadedFile = ''
    let progressEmitted = false

    onProgress?.({ workspaceId, percent: 0, speed: '...', eta: 0, downloaded: '', total: '' })

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      const pctMatch = text.match(/(\d+\.?\d*)%/)
      const destMatch = text.match(/(?:Dest(?:ination)?):\s*(.+)/)
      const mergeMatch = text.match(/Merging formats into "(.+)"/)
      const errorMatch = text.match(/ERROR.*?:?\s*(.+)/)

      if (pctMatch) {
        const pct = parseFloat(pctMatch[1])
        if (pct >= 0 && pct <= 100) {
          if (!progressEmitted) { devLog(`[Download] Progress: ${pct}%`); progressEmitted = true }
          onProgress?.({ workspaceId, percent: pct, speed: '', eta: '', downloaded: '', total: '' })
        }
      } else if (destMatch) {
        downloadedFile = destMatch[1].trim()
        devLog(`[Download] Dest: ${downloadedFile}`)
      } else if (mergeMatch) {
        downloadedFile = mergeMatch[1]
        devLog(`[Download] Merged: ${downloadedFile}`)
        onProgress?.({ workspaceId, percent: 99, speed: 'processing', eta: 0, downloaded: '', total: '' })
      } else if (errorMatch) {
        stderr += errorMatch[1] + '\n'
      } else if (text.includes('[download]') && !text.includes('%') && !text.includes('ERROR')) {
        const trimmed = text.trim().slice(0, 100)
        if (trimmed) devLog(`[Download] ${trimmed}`)
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text
      const pctMatch = text.match(/(\d+\.?\d*)%/)
      const destMatch = text.match(/(?:\[download\]\s*Dest(?:ination)?:)\s*(.+)/)
      const mergeMatch = text.match(/\[download\] Merging formats into "(.+)"/)

      if (pctMatch) {
        const pct = parseFloat(pctMatch[1])
        if (pct >= 0 && pct <= 100) {
          if (!progressEmitted) { progressEmitted = true }
          onProgress?.({ workspaceId, percent: pct, speed: '', eta: '', downloaded: '', total: '' })
        }
      } else if (destMatch && !downloadedFile) {
        downloadedFile = destMatch[1].trim()
      } else if (mergeMatch) {
        downloadedFile = mergeMatch[1]
        onProgress?.({ workspaceId, percent: 99, speed: 'processing', eta: 0, downloaded: '', total: '' })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, workspaceId, error: `spawn error: ${err.message}`, stderr })
    })

    const timeout = extraArgs.length > 0 ? 15 * 60 * 1000 : 30 * 60 * 1000
    const timer = setTimeout(() => {
      if (!proc.killed) proc.kill()
      resolve({ success: false, workspaceId, error: 'Download timeout', stderr })
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      devLog(`[Download] Closed code=${code}, file="${downloadedFile}"`)

      if (!downloadedFile) {
        try {
          const files = fs.readdirSync(outputDir)
          const match = files.find(f => f.startsWith(workspaceId + '_') && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f))
          if (match) downloadedFile = path.join(outputDir, match)
        } catch {}
      }

      const isFatal = code !== 0 && code !== 2
      if (isFatal || !downloadedFile) {
        const errorLines = stderr.trim().split('\n').filter(l => l.includes('ERROR'))
        const fullError = errorLines.join(' | ') || `yt-dlp code ${code}`
        resolve({ success: false, workspaceId, error: fullError, stderr })
        return
      }

      let fileSize = 0
      try { fileSize = fs.statSync(downloadedFile).size } catch {}

      // Verify file is not corrupt (must be > 50KB)
      if (fileSize < 50_000) {
        devLog(`[Download] File too small (${fileSize} bytes) — likely corrupt`)
        try { fs.unlinkSync(downloadedFile) } catch {}
        resolve({ success: false, workspaceId, error: `File too small (${fileSize} bytes)`, stderr })
        return
      }

      const actualDuration = fs.existsSync(downloadedFile) ? 0 : 0 // will be probed by caller
      resolve({ success: true, workspaceId, filePath: downloadedFile, duration: actualDuration, fileSize, stderr })
    })
  })
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
  canvasW: number,
  canvasH: number,
): Promise<{ success: boolean; error?: string }> {
  const ffmpeg = getFfmpegPath()

  // Scale portrait source to EXACTLY canvas dimensions so the render pipeline's scale
  // filter becomes a no-op (or trivial center-crop). This saves ~5-10s per render.
  // For portrait source entering portrait canvas: scale to canvasW, then pad/crop to canvasH.
  // The key insight: for 9:16 source → 9:16 canvas, scale by HEIGHT matches better
  // (avoids excess pillarboxing in the crop step).
  const args: string[] = [
    '-i', quotePath(sourcePath),
    '-vf', `scale=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease`,
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

/**
 * Download wrapper — delegates to downloadVideoStrategy with full client fallback chain.
 * Maintains backward compatibility with callers that pass playerClient/po_token.
 *
 * New callers: prefer downloadVideoStrategy() directly for cleaner API.
 */
export async function downloadVideo(opts: YtdlpOptions): Promise<DownloadResult> {
  // If explicit playerClient is given (e.g. 'tv_embedded'), use it directly without the
  // fallback chain (caller is already retrying with a specific client).
  if (opts.playerClient) {
    const client = opts.playerClient as YtdlpClient
    const result = await downloadWithClient({
      workspaceId: opts.workspaceId,
      videoUrl: opts.videoUrl,
      outputDir: opts.outputDir,
      trimLimit: opts.trimLimit,
      quality: opts.quality,
      maxInstances: opts.maxInstances,
      onProgress: opts.onProgress,
      ytCookiesFile: opts.ytCookiesFile,
      client,
    })
    return {
      success: result.success,
      workspaceId: result.workspaceId,
      filePath: result.filePath,
      duration: result.duration,
      fileSize: result.fileSize,
      error: result.error,
    }
  }

  // Default: use the full client fallback chain (web → tv_embedded → ios)
  const strategyResult = await downloadVideoStrategy({
    workspaceId: opts.workspaceId,
    videoUrl: opts.videoUrl,
    outputDir: opts.outputDir,
    trimLimit: opts.trimLimit,
    quality: opts.quality,
    maxInstances: opts.maxInstances,
    onProgress: opts.onProgress,
    ytCookiesFile: opts.ytCookiesFile,
  })

  return {
    success: strategyResult.success,
    workspaceId: strategyResult.workspaceId,
    filePath: strategyResult.filePath,
    duration: strategyResult.duration,
    fileSize: strategyResult.fileSize,
    error: strategyResult.error,
  }
}
