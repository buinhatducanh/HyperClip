import { spawn, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import https from 'https'
import { getFfmpegPath, getFfprobePath } from './ffmpeg-paths.js'

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

  return {
    channelName,
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
  // Check in node_modules/.bin
  const npmBin = path.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp')
  if (fs.existsSync(npmBin)) return npmBin

  // Check common pip install locations (Roaming Python)
  for (const ver of ['Python314', 'Python313', 'Python312', 'Python311']) {
    const scriptsDir = path.join(process.env.APPDATA || '', 'Python', ver, 'Scripts')
    const ytdlpExe = path.join(scriptsDir, 'yt-dlp.exe')
    if (fs.existsSync(ytdlpExe)) return ytdlpExe
    const ytdlpSh = path.join(scriptsDir, 'yt-dlp')
    if (fs.existsSync(ytdlpSh)) return ytdlpSh
  }

  // Check PATH
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
  trimLimit: '5min' | '10min' | 'full'
  onProgress?: (progress: DownloadProgress) => void
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
          channelName: info.channel || info.uploader || 'Unknown',
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
          channelName: info.channel || info.uploader || 'Unknown',
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

export async function downloadVideo(opts: YtdlpOptions): Promise<DownloadResult> {
  const { workspaceId, videoUrl, outputDir, trimLimit, onProgress } = opts
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
      return fs.readdirSync(outputDir).filter(f => f.startsWith(workspaceId + '_'))
    } catch { return [] }
  })()
  if (existingFiles.length > 0) {
    const existingFile = path.join(outputDir, existingFiles[0])
    let fileSize = 0
    try { fileSize = fs.statSync(existingFile).size } catch {}
    console.log(`[yt-dlp] File already exists: ${existingFile} (${fileSize} bytes) — skipping download`)
    // Get duration
    let duration = 0
    try {
      const ffprobePath = getFfprobePath()
      const out = execSync(`"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${existingFile}"`, { encoding: 'utf-8', timeout: 10000 })
      duration = Math.floor(parseFloat(out.trim()))
    } catch {}
    return { success: true, workspaceId, filePath: existingFile, duration, fileSize }
  }

  const outputTemplate = path.join(outputDir, `${workspaceId}_%(id)s.%(ext)s`)

  const args: string[] = [
    // URL FIRST — Windows spawn can drop the last arg in some edge cases
    videoUrl,
    ...getJsRuntimeArgs(),
    '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--output', outputTemplate,
    '--no-playlist',
    '--merge-output-format', 'mp4',
    '--newline',
  ]

  // Trim limit: download only first N seconds
  if (trimLimit === '5min') {
    args.push('--download-sections', '*0-300')
  } else if (trimLimit === '10min') {
    args.push('--download-sections', '*0-600')
  }
  // 'full' = no trim, download entire video

  // Build ffmpeg-enriched PATH
  const ffmpegPath = getFfmpegPath()
  const ffmpegDir = path.dirname(ffmpegPath)
  const ytDlpDir = path.dirname(ytdlp)
  const enrichedPath = ffmpegDir + path.delimiter + ytDlpDir + path.delimiter + (process.env.PATH || '')
  console.log(`[yt-dlp] ffmpeg path: ${ffmpegPath}`)
  console.log(`[yt-dlp] ffmpeg exists: ${fs.existsSync(ffmpegPath)}`)
  console.log(`[yt-dlp] ffmpeg dir: ${ffmpegDir}`)
  console.log(`[yt-dlp] PATH dirs (first 5):`, (process.env.PATH || '').split(path.delimiter).slice(0, 5))
  console.log(`[yt-dlp] Spawning: "${ytdlp}"`)
  console.log(`[yt-dlp] Args (${args.length}):`, args)

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let downloadedFile = ''
    let lastProgress: DownloadProgress | null = null
    let procStarted = false

    const proc = spawn(ytdlp, args, {
      env: {
        ...process.env,
        PATH: enrichedPath,
      },
    })

    proc.on('error', (err) => {
      console.error(`[yt-dlp] spawn error: ${err.message} — path: ${ytdlp}`)
      resolve({ success: false, workspaceId, error: `spawn error: ${err.message}` })
    })

    proc.stdout?.on('data', (data) => {
      const text = data.toString()
      stdout += text

      // Parse progress: [download]   0.1% of   45.23M at   12.5MiB/s ETA 00:05
      const progressMatch = text.match(/(\d+\.?\d*)%.*at\s+([\d.]+\w+)\s+ETA\s+([\d:]+)/)
      const destMatch = text.match(/Destination:\s+(.+)/)
      const mergeMatch = text.match(/Merging formats into "(.+)"/)
      const errorMatch = text.match(/ERROR.*?:?\s*(.+)/)

      if (progressMatch) {
        if (!procStarted) { console.log(`[yt-dlp] Download started!`); procStarted = true }
        lastProgress = {
          workspaceId,
          percent: parseFloat(progressMatch[1]),
          speed: progressMatch[2],
          eta: progressMatch[3],
          downloaded: '',
          total: '',
        }
        onProgress?.(lastProgress)
      } else if (destMatch) {
        console.log(`[yt-dlp] Destination: ${destMatch[1].trim()}`)
      } else if (mergeMatch) {
        downloadedFile = mergeMatch[1]
        console.log(`[yt-dlp] Merged to: ${downloadedFile}`)
      } else if (errorMatch) {
        stderr += errorMatch[1] + '\n'
        console.error(`[yt-dlp] ERROR: ${errorMatch[1]}`)
      }
    })

    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      stderr += text

      // Parse [download] Dest: /path/to/file.mp4
      const destMatch = text.match(/\[download\]\s+Destination:\s+(.+)/)
      if (destMatch && !downloadedFile) {
        downloadedFile = destMatch[1].trim()
        console.log(`[yt-dlp] Dest (stderr): ${downloadedFile}`)
      }

      // Final merge
      const mergeMatch = text.match(/\[download\] Merging formats into "(.+)"/)
      if (mergeMatch) {
        downloadedFile = mergeMatch[1]
        console.log(`[yt-dlp] Merge (stderr): ${downloadedFile}`)
      }

      // Error detection
      if (text.includes('ERROR') && !text.includes('WARNING')) {
        console.error(`[yt-dlp] STDERR ERROR: ${text.trim()}`)
      }
    })

    proc.on('close', (code) => {
      console.log(`[yt-dlp] Closed with code ${code}, downloadedFile: "${downloadedFile}", stderr chars: ${stderr.length}`)

      // Print first 20 lines of stderr for debugging
      if (stderr.length > 0) {
        const lines = stderr.trim().split('\n').slice(0, 20)
        console.log(`[yt-dlp] stderr (first ${lines.length} lines):`)
        lines.forEach(l => console.log(`  | ${l}`))
      }

      // Fallback: search for any file matching workspaceId pattern in output dir
      if (!downloadedFile && outputDir) {
        try {
          const files = fs.readdirSync(outputDir)
          const match = files.find(f => f.startsWith(workspaceId + '_') && f.endsWith('.mp4'))
          if (match) {
            downloadedFile = path.join(outputDir, match)
            console.log(`[yt-dlp] Found file via fallback scan: ${downloadedFile}`)
          }
        } catch {}
      }

      // yt-dlp exit codes: 0=success, 1=error, 2=warning (non-critical), else=error
      const isFatalError = code !== 0 && code !== 2
      if (isFatalError || !downloadedFile) {
        const errorLines = stderr.trim().split('\n').filter(l => l.includes('ERROR'))
        const errorMsg = errorLines.join(' | ') || `yt-dlp exited with code ${code}`
        console.error(`[yt-dlp] Download FAILED: ${errorMsg}`)
        resolve({
          success: false,
          workspaceId,
          error: errorMsg,
        })
        return
      }

      // Get file info
      let fileSize = 0
      try {
        const stat = fs.statSync(downloadedFile)
        fileSize = stat.size
        console.log(`[yt-dlp] File size: ${fileSize} bytes`)
      } catch (e) {
        console.error(`[yt-dlp] Could not stat file: ${e}`)
      }

      // Get duration using ffprobe
      let duration = 0
      try {
        const ffprobePath = getFfprobePath()
        const out = execSync(
          `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${downloadedFile}"`,
          { encoding: 'utf-8', timeout: 10000 }
        )
        duration = Math.floor(parseFloat(out.trim()))
      } catch (e) {
        console.warn(`[yt-dlp] ffprobe failed: ${e}`)
      }

      console.log(`[yt-dlp] Download SUCCESS: ${downloadedFile} (${duration}s, ${fileSize} bytes)`)
      resolve({
        success: true,
        workspaceId,
        filePath: downloadedFile,
        duration,
        fileSize,
      })
    })

    // Timeout after 30 minutes
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill()
        resolve({
          success: false,
          workspaceId,
          error: 'Download timeout (30 min)',
        })
      }
    }, 30 * 60 * 1000)
  })
}

