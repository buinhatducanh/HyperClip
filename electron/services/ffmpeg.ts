import { spawn } from 'child_process'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { getFfmpegPath, getFfprobePath } from './ffmpeg-paths.js'
import { runFfmpeg, cancelFfmpeg } from './worker-pool.js'

export { getFfmpegPath, getFfprobePath }

export interface RenderMetadata {
  workspace_id: string
  source_video: string
  export_resolution: string  // e.g. "1080x1920"
  video_speed: number
  fps_target: number
  overlays: Overlay[]
  trim: { start: number; end: number }
  codec?: 'h264' | 'hevc'
  preset?: 'p1' | 'p2' | 'p3'
  tune?: 'hq' | 'll' | 'film'
  canvasBg?: 'black' | 'white'
  // Background
  backgroundType?: 'blur' | 'solid' | 'image'
  backgroundColor?: string  // hex color e.g. "#000000" — used when backgroundType='solid'
  backgroundImage?: string  // absolute path — used when backgroundType='image'
  /** Legacy: blur background path (still used when backgroundType='blur') */
  blur_background?: string
  /** Source video aspect ratio — true = 9:16 vertical (short), false = landscape (16:9 or wider) */
  isShort?: boolean
}

export interface Overlay {
  type: 'header' | 'title'
  src?: string
  content?: string
  shape?: string
  borderColor?: string
  bgColor?: string
  fontSize?: number
  /** Pre-rendered overlay PNG path (avoids CPU drawtext per-frame) */
  overlayPath?: string
}

export interface RenderProgress {
  workspaceId: string
  percent: number
  currentTime: number
  totalTime: number
  fps: number
  speed: string
  bitrate: string
}

export interface RenderResult {
  success: boolean
  workspaceId: string
  outputPath?: string
  fileSize?: number
  duration?: number
  error?: string
}

// ─── Shell path helper ─────────────────────────────────────────────────────────
// Always use quoted paths on Windows via cmd /c to handle spaces correctly.

function quotePath(p: string): string {
  // Escape any existing double quotes, then wrap in double quotes
  return '"' + p.replace(/"/g, '""') + '"'
}

function buildArgs(args: string[]): string {
  // Join args into a single cmd.exe command string with proper quoting
  return args.map(a => {
    if (a.startsWith('"') && a.endsWith('"')) return a
    if (a.includes(' ') || a.includes('(') || a.includes(')')) return quotePath(a)
    return a
  }).join(' ')
}

// ─── Probe video dimensions ─────────────────────────────────────────────────────

export async function probeVideoAspect(videoPath: string): Promise<{ width: number; height: number; isShort: boolean } | null> {
  const ffprobe = getFfprobePath()
  try {
    const out = execSync(`"${ffprobe}" -v error -select_streams v:0 -show_entries stream=width,height -of json "${videoPath}"`, {
      encoding: 'utf-8',
      timeout: 15000,
    })
    const json = JSON.parse(out)
    const streams = json.streams
    if (streams && streams.length > 0) {
      const width = Number(streams[0].width) || 0
      const height = Number(streams[0].height) || 0
      return { width, height, isShort: height >= width }
    }
  } catch (e) {
    console.warn('[probeVideoAspect] ffprobe failed:', e)
  }
  return null
}

// ─── Pre-process: Blur background generation ───────────────────────────────────

export async function generateBlurBackground(
  videoPath: string,
  outputPath: string,
  width = 1080,
  height = 1920
): Promise<{ success: boolean; error?: string }> {
  const ffmpeg = getFfmpegPath()

  const run = (ffArgs: string[]): Promise<{ code: number; stderr: string }> => new Promise((resolve) => {
    const cmd = buildArgs([ffmpeg, ...ffArgs])
    const proc = spawn('cmd', ['/c', cmd], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => resolve({ code: code ?? 1, stderr }))
    setTimeout(() => {
      if (!proc.killed) proc.kill()
      resolve({ code: -1, stderr: 'timeout' })
    }, 30_000)
  })

  // Step 1: Try seeking to 5 min (assumes action starts here)
  const primaryArgs = [
    '-ss', '00:05:00',
    '-i', quotePath(videoPath),
    '-vframes', '1',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20,format=yuv420p`,
    '-y', quotePath(outputPath),
  ]

  let result = await run(primaryArgs)
  if (result.code === 0 && fs.existsSync(outputPath)) {
    return { success: true }
  }

  // Step 2: Fallback — first frame
  const fallbackArgs = [
    '-i', quotePath(videoPath),
    '-vframes', '1',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20,format=yuv420p`,
    '-y', quotePath(outputPath),
  ]

  result = await run(fallbackArgs)
  if (result.code !== 0) {
    return { success: false, error: result.stderr || `ffmpeg failed: ${result.code}` }
  }

  return { success: true }
}

// ─── Thumbnail extraction ──────────────────────────────────────────────────────
// Extract a single frame from a video file as JPEG thumbnail.
// Used after download to replace YouTube thumbnail URLs (which 404 for new uploads).
export async function extractVideoThumbnail(
  videoPath: string,
  outputPath: string,
  seekTime = 5,
): Promise<{ success: boolean; thumbnailPath?: string; error?: string }> {
  const ffmpeg = getFfmpegPath()

  return new Promise((resolve) => {
    // Seek to ~5s (past intro, reliable frame)
    const seekStr = `${Math.floor(seekTime / 3600)}:${String(Math.floor((seekTime % 3600) / 60)).padStart(2, '0')}:${String(seekTime % 60).padStart(2, '0')}`
    const args = [
      '-ss', seekStr,
      '-i', videoPath,
      '-vframes', '1',
      '-vf', 'scale=320:-1:force_original_aspect_ratio=decrease',
      '-q:v', '3',
      '-y', outputPath,
    ]

    const cmd = buildArgs([ffmpeg, ...args])
    const proc = spawn('cmd', ['/c', cmd], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ success: true, thumbnailPath: outputPath })
      } else {
        resolve({ success: false, error: `ffmpeg exit ${code}: ${stderr.slice(0, 200)}` })
      }
    })
    setTimeout(() => {
      if (!proc.killed) { proc.kill(); resolve({ success: false, error: 'timeout' }) }
    }, 15_000)
  })
}

// ─── Build filter complex for 3-zone layout ─────────────────────────────────────
// Canvas: [0     - headerH-1] = Header (top 20%)
//         [headerH - canvasH-titleH-1] = Video zone (middle 60%)
//         [canvasH-titleH - canvasH-1] = Title (bottom 20%)
//
// Strategy: build as one single semicolon-separated filtergraph.
// Each semicolon line can output multiple labels. Intermediate labels are
// guaranteed available to downstream lines because FFmpeg collects all
// labels before executing.

function buildFilterComplex(opts: {
  headerOl: Overlay | undefined
  titleOl: Overlay | undefined
  canvasW: number
  canvasH: number
  headerH: number
  titleH: number
  videoH: number
  videoTop: number
  videoW: number
  speedFilter: string
  canvasBg: 'black' | 'white'
  backgroundType?: 'blur' | 'solid' | 'image'
  /** Pre-rendered title overlay PNG — replaces CPU drawtext per frame */
  titleOverlayPath?: string
  /** Source video is a short (9:16 or taller). Landscape (16:9 or wider) uses thumbnail-bg + square-cropped video */
  isShort?: boolean
}): string {
  const {
    headerOl, titleOl, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW, speedFilter, canvasBg,
    backgroundType = 'blur',
    titleOverlayPath,
    isShort = true,
  } = opts

  // ── LANDSCAPE layout: thumbnail bg + centered square video + part number ──
  if (!isShort) {
    // Landscape video: crop center to square, scale to fit videoH
    const cropW = videoH  // crop to square
    const cropX = `(iw-${cropW})/2`
    const speedChain = speedFilter ? `,${speedFilter}` : ''
    // [0:v] crop square → scale to fit zone → pad into canvas
    const videoChain = `[0:v]crop=${cropW}:${cropW}:${cropX}:0,scale=${videoH}:${videoH}:force_original_aspect_ratio=exact,pad=${canvasW}:${canvasH}:(ow-iw)/2:${videoTop}${speedChain}[vid]`
    // [1:v] thumbnail → scale to fill canvas
    const bgChain = `[1:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}[bg]`
    // Video over thumbnail bg
    const vzChain = `[bg][vid]overlay=0:0[vz]`
    // Title overlay (part number) at bottom
    if (titleOl?.content && titleOverlayPath) {
      const sections = [videoChain, bgChain, vzChain]
      sections.push(`[2:v]scale=${canvasW}:${titleH}[titleScaled]`, `[vz][titleScaled]overlay=0:${canvasH - titleH}[td]`)
      return sections.join('; ')
    }
    return [videoChain, bgChain, vzChain].join('; ')
  }

  // ── SHORT (vertical) layout: header + video zone + title ──
  // Scale + speed filter chain for video
  // Order: scale → setpts (speed) → pad. speedFilter is "" or "setpts=X*PTS"
  const scaleChain = `[0:v]scale=${videoW}:${videoH}:force_original_aspect_ratio=decrease`
  const speedChain = speedFilter ? `,${speedFilter}` : ''
  const padChain = `,pad=${canvasW}:${canvasH}:(ow-iw)/2:${videoTop}[vid]`
  const videoChain = `${scaleChain}${speedChain}${padChain}`

  // Scale background to canvas
  // blur/image: scale from source size. solid: color filter outputs exact size already.
  const bgChain = backgroundType === 'solid'
    ? `[1:v]null[bg]`
    : `[1:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease[bg]`

  // Header image scale (full canvas width)
  const hdChain = headerOl?.src ? `[2:v]scale=${canvasW}:${headerH}[hd]` : ''

  // Video over bg → [vz]
  const vzChain = `[bg][vid]overlay=0:${videoTop}[vz]`

  // Build sections
  const sections: string[] = [videoChain, bgChain]

  if (hdChain) {
    sections.push(hdChain, `[vz][hd]overlay=0:0[fh]`)
  }

  if (titleOl?.content && titleOverlayPath) {
    // Pre-rendered PNG overlay — overlay on GPU instead of CPU drawtext
    // Input [3:v] = pre-rendered title PNG
    const baseLabel = hdChain ? '[fh]' : '[vz]'
    sections.push(`[3:v]null[titleOverlay]`, `${baseLabel}[titleOverlay]overlay=0:0[td]`)
  }

  return sections.join('; ')
}

// ─── Optimized NVENC parameters ─────────────────────────────────────────────────

function getNvencParams(codec: 'h264' | 'hevc', preset: string, isChunked: boolean): string[] {
  // RTX 5080: ULL tune for chunked (speed), HQ tune for single (quality)
  // Key optimizations:
  //   -bf 0: disable B-frames → faster encode, slightly larger file
  //   -refs 1: single reference frame → fastest possible
  //   -g 60: GOP every 60 frames → fewer reference overhead
  //   -tune ull: ultra-low-latency → maximum throughput
  //   -rc-lookahead 0: disable lookahead → fastest encode
  //   -spatial-aq 1: adaptive quantization for quality
  if (isChunked) {
    return [
      '-preset', preset,
      '-rc', 'vbr',
      '-cq', codec === 'hevc' ? '26' : '22',
      '-tune', 'ull',
      '-bf', '0',
      '-refs', '1',
      '-g', '60',
      '-rc-lookahead', '0',
      '-spatial-aq', '1',
      '-aq-strength', '8',
      '-delay', '0',           // Zero-delay encoding — minimum buffering
      '-surfaces', '32',      // Hardware surface pool — max throughput
      '-extra_hw_frames', '3', // GPU surface buffering overlap
    ]
  }
  return [
    '-preset', preset,
    '-rc', 'vbr',
    '-cq', codec === 'hevc' ? '28' : '23',
    '-tune', 'hq',
    '-bf', '0',
    '-refs', '1',
    '-g', '60',
    '-rc-lookahead', '16',
    '-spatial-aq', '1',
  ]
}

// ─── Pre-render text overlay to PNG (avoids CPU drawtext per-frame) ──────────────
// Replaces drawtext CPU filter with a pre-generated overlay PNG.
// FFmpeg's drawtext runs on CPU every frame — this is the biggest bottleneck.
// Pre-rendering: generate the text box ONCE, overlay as image every frame (CUDA fast).

export async function renderTextOverlay(
  text: string,
  canvasW: number,
  canvasH: number,
  headerH: number,
  titleH: number,
  videoTop: number,
  borderColor: string,
  bgColor: string,
  fontSize: number,
  outputPath: string,
): Promise<{ success: boolean; overlayPath?: string; error?: string }> {
  const ffmpeg = getFfmpegPath()

  // Title box layout
  const boxW = Math.floor(canvasW * 0.66)
  const boxH = Math.floor(titleH * 0.55)
  const boxY = canvasH - Math.floor(titleH * 0.72)
  const boxX = Math.floor((canvasW - boxW) / 2)

  // Extract alpha from bgColor
  const alphaMatch = bgColor.match(/[\d.]+(?=\)$)/)
  const alpha = alphaMatch ? parseFloat(alphaMatch[0]) : 0.12

  const filter = [
    `color=c=${borderColor}@${alpha}:s=${boxW}x${boxH}:d=1:r=1[bg]`,
    `color=c=${borderColor}:s=${boxW}x${boxH}:d=1:r=1[border]`,
    // Center text in box
    `drawtext=text='${text.replace(/'/g, "\\'")}':fontsize=${Math.max(40, fontSize * 5)}:fontcolor=white:borderw=2:bordercolor=${borderColor}:x=(w-text_w)/2:y=(h-text_h)/2[texted]`,
    // Overlay border on bg
    `[bg][border]overlay=x=${boxX}:y=${boxY}[bgBorder]`,
    // Overlay text on bg+border
    `[bgBorder][texted]overlay=x=${boxX}:y=${boxY}[final]`,
    // Crop final to box size
    `crop=${boxW}:${boxH}:${boxX}:${boxY}`,
    // Pad to full canvas width (so it overlays correctly)
    `pad=${canvasW}:${canvasH}:0:0:color=black@0[out]`,
  ].join(';')

  return new Promise((resolve) => {
    const args = [
      '-f', 'lavfi',
      '-i', `color=c=black:s=${canvasW}x${canvasH}:d=1:r=1`,
      '-filter_complex', filter,
      '-map', '[out]',
      '-frames:v', '1',
      '-y', quotePath(outputPath),
    ]

    const cmd = buildArgs([ffmpeg, ...args])
    const proc = spawn('cmd', ['/c', cmd], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ success: true, overlayPath: outputPath })
      } else {
        resolve({ success: false, error: stderr || `ffmpeg exited ${code}` })
      }
    })
    setTimeout(() => {
      if (!proc.killed) proc.kill()
      resolve({ success: false, error: 'timeout' })
    }, 30_000)
  })
}

// Pre-render all title overlays in metadata to PNG files
export async function preRenderOverlays(
  metadata: RenderMetadata,
  outputDir: string,
  workspaceId: string,
): Promise<{ titleOverlayPath: string | null; error: string | null }> {
  const titleOl = metadata.overlays?.find(o => o.type === 'title' && o.content)
  if (!titleOl?.content) return { titleOverlayPath: null, error: null }

  const [outW, outH] = metadata.export_resolution.split('x').map(Number)
  const canvasW = outW || 1080
  const canvasH = outH || 1920
  const isShort = metadata.isShort !== false
  const headerH = isShort ? Math.floor(canvasH * 0.20) : Math.floor(canvasH * 0.30)
  const titleH = isShort ? Math.floor(canvasH * 0.20) : Math.floor(canvasH * 0.30)
  const videoTop = headerH
  // For landscape, overlay needs to be at bottom of canvas (not centered)
  const overlayY = isShort ? videoTop : canvasH - titleH

  const overlayDir = path.join(outputDir, 'overlays', workspaceId)
  if (!fs.existsSync(overlayDir)) fs.mkdirSync(overlayDir, { recursive: true })

  const overlayPath = path.join(overlayDir, 'title_overlay.png')

  const result = await renderTextOverlay(
    titleOl.content,
    canvasW,
    canvasH,
    headerH,
    titleH,
    overlayY,  // placement Y (short=zone top, landscape=bottom)
    titleOl.borderColor ?? '#00B4FF',
    titleOl.bgColor ?? 'rgba(0,180,255,0.12)',
    titleOl.fontSize ?? 13,
    overlayPath,
  )

  if (result.success) {
    return { titleOverlayPath: overlayPath, error: null }
  }
  return { titleOverlayPath: null, error: result.error ?? 'Failed to render text overlay' }
}

// ─── Smart keyframe finder ──────────────────────────────────────────────────────
// Scans only near target split points instead of reading the entire file.
// For a 30-min video with 8 chunks: ~8 seeks × 4s = ~2s vs 10+ seconds full scan.

async function findKeyframeSmart(
  videoPath: string,
  totalDuration: number,
  targetCount: number
): Promise<number[]> {
  if (targetCount <= 1 || totalDuration <= 120) return []

  const ffprobe = getFfprobePath()
  const keyframes: number[] = []

  // Probe at evenly-spaced positions and find nearest keyframe ±2s
  const probePositions: number[] = []
  for (let i = 1; i <= targetCount; i++) {
    probePositions.push((totalDuration / (targetCount + 1)) * i)
  }

  return new Promise((resolve) => {
    let resolved = 0
    for (const targetTime of probePositions) {
      const seekFrom = Math.max(0, targetTime - 2)
      const cmd = buildArgs([
        ffprobe,
        '-v', 'quiet',
        '-select_streams', 'v:0',
        '-show_entries', 'packet=pts_time,flags',
        '-skip_frame', 'nokey',
        '-ss', String(seekFrom),
        '-to', String(targetTime + 2),
        '-of', 'csv=p=0',
        quotePath(videoPath),
      ])
      const proc = spawn('cmd', ['/c', cmd], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      proc.stdout?.on('data', (d) => { stdout += d.toString() })
      proc.on('close', () => {
        for (const line of stdout.split('\n')) {
          const match = line.match(/^([\d.]+)/)
          if (match) {
            const ts = parseFloat(match[1])
            // Deduplicate within 0.5s window
            const isDupe = keyframes.some(k => Math.abs(k - ts) < 0.5)
            if (!isDupe && ts > 0 && ts < totalDuration) {
              keyframes.push(ts)
            }
          }
        }
        resolved++
        if (resolved === probePositions.length) {
          keyframes.sort((a, b) => a - b)
          resolve(keyframes)
        }
      })
    }
    // Safety fallback
    setTimeout(() => {
      if (resolved < probePositions.length) resolve(keyframes.length > 0 ? keyframes : [])
    }, 15_000)
  })
}

// ─── Main render ───────────────────────────────────────────────────────────────

export async function renderVideo(
  metadata: RenderMetadata,
  outputDir: string,
  onProgress?: (progress: RenderProgress) => void
): Promise<RenderResult> {
  const {
    workspace_id, source_video, export_resolution,
    video_speed, fps_target, overlays, trim,
    codec = 'hevc', preset = 'p1', tune = 'hq', canvasBg = 'black',
    backgroundType = 'blur', backgroundColor = '#000000', backgroundImage,
    blur_background,
    isShort = true,
  } = metadata

  // Parse resolution from export_resolution — this IS used
  const [outW, outH] = export_resolution.split('x').map(Number)
  if (!outW || !outH) {
    return { success: false, workspaceId: workspace_id, error: 'Invalid resolution' }
  }

  const outputFile = path.join(outputDir, `${workspace_id}_output.mp4`)

  // 3-zone layout derived from OUTPUT resolution
  const canvasW = outW
  const canvasH = outH

  // LANDSCAPE: thumbnail (30%) + video square (40%) + part number (30%)
  // SHORT:     header (20%) + video (60%) + title (20%)
  const headerH = isShort ? Math.floor(canvasH * 0.20) : Math.floor(canvasH * 0.30)
  const titleH = isShort ? Math.floor(canvasH * 0.20) : Math.floor(canvasH * 0.30)
  const videoH = canvasH - headerH - titleH
  const videoTop = headerH
  const videoW = Math.floor(videoH * 16 / 9)  // scale to fit 16:9 video in zone

  const trimStart = trim.start
  const trimEnd = trim.end
  const duration = trimEnd - trimStart

  // Trim optimization: when video is sped up, output is shorter.
  // Decode/filter only what will appear in output → saves decode time.
  // e.g. 10min input, 1.1x speed → output = 9.1min → decode 9.1min instead of 10min
  const outputDuration = video_speed !== 1.0 ? duration / video_speed : duration
  // Buffer for GOP alignment (keyframe boundaries may not align exactly)
  const GOP_BUFFER = 3
  const decodeDuration = Math.min(outputDuration + GOP_BUFFER, duration)

  // Speed filter: setpts to change playback speed
  // e.g. video_speed=1.5 → setpts=0.67*PTS (faster), video_speed=0.5 → setpts=2.0*PTS (slower)
  const speedFilter = video_speed !== 1.0 ? `setpts=${1 / video_speed}*PTS` : ''

  // Overlay inputs
  const headerOl = overlays.find(o => o.type === 'header' && o.src)
  const titleOl = overlays.find(o => o.type === 'title' && o.content)

  // NVENC codec
  const nvencCodec = codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc'

  // Build filter complex
  // Pre-render title overlay to PNG first (avoids CPU drawtext per frame)
  const titleOverlayResult = await preRenderOverlays(metadata, outputDir, workspace_id)
  const titleOverlayPath = titleOverlayResult.titleOverlayPath ?? undefined

  const filterComplex = buildFilterComplex({
    headerOl,
    titleOl,
    canvasW,
    canvasH,
    headerH,
    titleH,
    videoH,
    videoTop,
    videoW,
    speedFilter,
    canvasBg,
    backgroundType,
    titleOverlayPath,
    isShort,
  })

  // Determine output label
  let mapOutput = '[vz]'
  if (titleOverlayPath) mapOutput = '[td]'
  else if (titleOl?.content) mapOutput = '[td]'
  else if (headerOl?.src) mapOutput = '[fh]'

  // Build ffmpeg args
  // Inputs: [0]=source video, [1]=background, [2]=header image (optional), [3]=title overlay PNG (optional)
  // For LANDSCAPE: [1] = thumbnail (used as bg), [2] = title overlay PNG
  const args: string[] = [
    '-ss', String(trimStart),
    '-t', String(decodeDuration),
    // NVDEC GPU decode + threading for video processing
    '-c:v', codec === 'hevc' ? 'hevc_cuvid' : 'h264_cuvid',
    '-threads', '8',
    '-fps_mode', 'cfr',
    '-avoid_negative_ts', 'make_zero',
    '-i', quotePath(source_video),
    '-filter_hw_device', 'cuda',
    // Multi-threaded filter pipeline — parallel CUDA filter execution
    '-filter_threads', '16',
    ...(backgroundType === 'solid'
      ? ['-f', 'lavfi', '-i', `color=c=${backgroundColor}:s=${canvasW}x${canvasH}:d=1:r=1`]
      : backgroundType === 'image' && backgroundImage
        ? ['-i', quotePath(backgroundImage)]
        : ['-i', quotePath(blur_background || '')]),
    // Input [2]: header image for short mode; title overlay for landscape mode
    ...(isShort
      ? (headerOl?.src ? ['-i', quotePath(headerOl.src)] : [])
      : (titleOverlayPath ? ['-i', quotePath(titleOverlayPath)] : [])),
    // Input [3]: title overlay for short mode
    ...(isShort && titleOverlayPath ? ['-i', quotePath(titleOverlayPath)] : []),
    '-filter_complex', filterComplex,
    '-map', mapOutput,
    '-c:v', nvencCodec,
    ...getNvencParams(codec, preset, false),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-r', String(fps_target),
    '-max_muxing_queue_size', '1024',
    '-y', quotePath(outputFile),
  ]

  const result = await runFfmpeg({
    jobId: `single:${workspace_id}`,
    args,
    outputFile,
    onProgress: (pct) => {
      onProgress?.({
        workspaceId: workspace_id,
        percent: pct,
        currentTime: (pct / 100) * outputDuration,
        totalTime: outputDuration,
        fps: 0,
        speed: '',
        bitrate: '',
      })
    },
  })

  return {
    success: result.success,
    workspaceId: workspace_id,
    outputPath: result.outputFile,
    fileSize: result.fileSize,
    duration,
    error: result.error,
  }
}

// ─── Chunked parallel encoding ─────────────────────────────────────────────────

const chunkedProcesses = new Map<string, Array<{ proc: ReturnType<typeof spawn>; outputFile: string }>>()
const mergeProcess = new Map<string, ReturnType<typeof spawn>>()

export function cancelChunked(workspaceId: string): void {
  const chunks = chunkedProcesses.get(workspaceId)
  if (chunks) {
    for (const { proc } of chunks) { try { proc.kill() } catch {} }
    chunkedProcesses.delete(workspaceId)
  }
  const merge = mergeProcess.get(workspaceId)
  if (merge) { try { merge.kill() } catch {}; mergeProcess.delete(workspaceId) }
}

export function cancelAllChunked(): void {
  for (const [id] of chunkedProcesses) cancelChunked(id)
  for (const [id] of mergeProcess) {
    const p = mergeProcess.get(id)!
    try { p.kill() } catch {}
    mergeProcess.delete(id)
  }
}

export interface ChunkConfig {
  workers?: number
  chunkDuration?: number
  minChunkDuration?: number
}

export interface ChunkedResult extends RenderResult {
  chunks: Array<{ index: number; start: number; end: number; outputPath: string; fileSize: number; encodeMs: number; decodeFps?: number; encodeFps?: number }>
  totalEncodeMs: number
  profileSummary?: { avgDecodeFps: number; avgEncodeFps: number; totalMs: number }
}

// Build chunk encode args
function buildChunkArgs(
  sourceVideo: string,
  blurBg: string,
  trimStart: number,
  trimDuration: number,
  outputFile: string,
  codec: 'h264' | 'hevc',
  preset: 'p1' | 'p2' | 'p3',
  tune: 'hq' | 'll' | 'film',
  canvasW: number,
  canvasH: number,
  headerH: number,
  titleH: number,
  videoH: number,
  videoTop: number,
  videoW: number,
  /** Pre-rendered title overlay PNG — replaces CPU drawtext per frame */
  titleOverlayPath?: string,
  /** Source video is a short (9:16 or taller). Landscape uses thumbnail-bg + square-cropped video */
  isShort?: boolean,
): string[] {
  const nvencCodec = codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc'

  // ── LANDSCAPE layout: thumbnail bg + centered square video + part number ──
  if (!isShort) {
    const cropW = videoH
    const cropX = `(iw-${cropW})/2`
    const sections = [
      // [0:v] crop square → scale → pad into canvas
      `[0:v]crop=${cropW}:${cropW}:${cropX}:0,scale=${videoH}:${videoH}:force_original_aspect_ratio=exact,pad=${canvasW}:${canvasH}:(ow-iw)/2:${videoTop}[vid]`,
      // [1:v] thumbnail → fill canvas
      `[1:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}[bg]`,
      // Video over thumbnail bg
      `[bg][vid]overlay=0:0[vz]`,
    ]
    // Title overlay (input [2]) at bottom
    if (titleOverlayPath) {
      sections.push(`[2:v]scale=${canvasW}:${titleH}[titleScaled]`, `[vz][titleScaled]overlay=0:${canvasH - titleH}[final]`)
    }
    const filterChain = sections.join('; ')
    const mapOutput = titleOverlayPath ? '[final]' : '[vz]'
    return [
      '-ss', String(trimStart), '-t', String(trimDuration),
      '-c:v', codec === 'hevc' ? 'hevc_cuvid' : 'h264_cuvid',
      '-threads', '8', '-fps_mode', 'cfr',
      '-avoid_negative_ts', 'make_zero',
      '-i', quotePath(sourceVideo),
      '-i', quotePath(blurBg),        // [1] = thumbnail for landscape
      ...(titleOverlayPath ? ['-i', quotePath(titleOverlayPath)] : []),  // [2] = title overlay
      '-filter_hw_device', 'cuda', '-filter_threads', '16',
      '-filter_complex', filterChain,
      '-map', mapOutput, '-map', '0:a?',
      '-c:v', nvencCodec,
      ...getNvencParams(codec, preset, true),
      '-max_muxing_queue_size', '512',
      '-c:a', 'aac', '-b:a', '192k',
      '-r', '30',
      '-y', quotePath(outputFile),
    ]
  }

  // ── SHORT (vertical) layout: header + video zone + title ──
  const sections = [
    `[0:v]scale=${videoW}:${videoH}:force_original_aspect_ratio=decrease,pad=${canvasW}:${canvasH}:(ow-iw)/2:${videoTop}[vid]`,
    `[1:v]scale=${canvasW}:${canvasH}[bg]`,
    `[bg][vid]overlay=0:${videoTop}[vz]`,
  ]

  // Title overlay: pre-rendered PNG overlay on GPU
  if (titleOverlayPath) {
    sections.push(`[2:v]null[titleOl]`, `[vz][titleOl]overlay=0:0[final]`)
  }

  const filterChain = sections.join('; ')
  const mapOutput = titleOverlayPath ? '[final]' : '[vz]'

  // Inputs: [0]=video, [1]=background, [2]=title overlay (optional)
  return [
    '-ss', String(trimStart),
    '-t', String(trimDuration),
    '-c:v', codec === 'hevc' ? 'hevc_cuvid' : 'h264_cuvid',
    '-threads', '8',
    '-fps_mode', 'cfr',           // Constant frame rate — sync output
    '-avoid_negative_ts', 'make_zero', // Clean timestamp handling
    '-i', quotePath(sourceVideo),
    '-i', quotePath(blurBg),
    ...(titleOverlayPath ? ['-i', quotePath(titleOverlayPath)] : []),
    '-filter_hw_device', 'cuda',
    '-filter_threads', '16',
    '-filter_complex', filterChain,
    '-map', mapOutput, '-map', '0:a?',
    '-c:v', nvencCodec,
    ...getNvencParams(codec, preset, true),
    '-max_muxing_queue_size', '512',
    '-c:a', 'aac', '-b:a', '192k',
    '-r', '30',
    '-y', quotePath(outputFile),
  ]
}

// Encode a single chunk
async function encodeChunk(
  workspaceId: string,
  sourceVideo: string,
  blurBg: string,
  startSec: number,
  durationSec: number,
  outputFile: string,
  codec: 'h264' | 'hevc',
  preset: 'p1' | 'p2' | 'p3',
  tune: 'hq' | 'll' | 'film',
  canvasW: number,
  canvasH: number,
  headerH: number,
  titleH: number,
  videoH: number,
  videoTop: number,
  videoW: number,
  titleOverlayPath?: string,
  onProgress?: (percent: number) => void,
  isShort?: boolean,
): Promise<{ success: boolean; fileSize: number; encodeMs: number; error?: string; decodeFps?: number; encodeFps?: number }> {
  const ffmpeg = getFfmpegPath()
  const args = buildChunkArgs(
    sourceVideo, blurBg, startSec, durationSec, outputFile,
    codec, preset, tune, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW,
    titleOverlayPath, isShort,
  )

  return new Promise((resolve) => {
    const t0 = Date.now()
    const cmd = buildArgs([ffmpeg, ...args])
    const proc = spawn('cmd', ['/c', cmd], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })

    if (!chunkedProcesses.has(workspaceId)) chunkedProcesses.set(workspaceId, [])
    chunkedProcesses.get(workspaceId)!.push({ proc, outputFile })

    let lastPct = 0
    let decodeFps = 0
    let encodeFps = 0
    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      // Parse fps=X and speed=X from FFmpeg progress line
      const fpsM = text.match(/fps=\s*([\d.]+)/)
      const speedM = text.match(/speed=\s*([\d.]+)x/)
      if (fpsM) {
        const v = parseFloat(fpsM[1])
        if (speedM) {
          const spd = parseFloat(speedM[1])
          // During decode, fps ~= decode speed; later it reflects encode speed
          if (spd < 0.5) decodeFps = v // very slow = decode phase
          else encodeFps = v           // normal/encode phase
        }
      }
      const m = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/)
      if (m && onProgress) {
        const h = parseInt(m[1]), min = parseInt(m[2]), s = parseFloat(m[3])
        const cur = h * 3600 + min * 60 + s
        const pct = Math.min(100, (cur / durationSec) * 100)
        if (Math.abs(pct - lastPct) >= 1) { lastPct = pct; onProgress(pct) }
      }
    })

    proc.on('close', () => {
      const chunks = chunkedProcesses.get(workspaceId)
      if (chunks) {
        const idx = chunks.findIndex(c => c.outputFile === outputFile)
        if (idx !== -1) chunks.splice(idx, 1)
        if (chunks.length === 0) chunkedProcesses.delete(workspaceId)
      }
      const ms = Date.now() - t0
      if (!fs.existsSync(outputFile)) {
        resolve({ success: false, fileSize: 0, encodeMs: ms, error: 'FFmpeg process ended without output' })
      } else {
        let size = 0
        try { size = fs.statSync(outputFile).size } catch {}
        resolve({ success: true, fileSize: size, encodeMs: ms, decodeFps, encodeFps })
      }
    })

    setTimeout(() => {
      if (!proc.killed) proc.kill()
      resolve({ success: false, fileSize: 0, encodeMs: Date.now() - t0, error: 'Timeout' })
    }, 2 * 60 * 60 * 1000)
  })
}

// Merge chunks using ffmpeg concat demuxer
async function mergeChunks(
  workspaceId: string,
  chunkFiles: string[],
  outputFile: string,
  onProgress?: (pct: number) => void,
): Promise<{ success: boolean; fileSize: number; error?: string }> {
  if (chunkFiles.length === 1) {
    fs.copyFileSync(chunkFiles[0], outputFile)
    let size = 0
    try { size = fs.statSync(outputFile).size } catch {}
    return { success: true, fileSize: size }
  }

  const listFile = outputFile + '.concat.txt'
  const listContent = chunkFiles.map(f => `file '${f}'`).join('\n')
  fs.writeFileSync(listFile, listContent, 'utf-8')

  const ffmpeg = getFfmpegPath()
  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-i', quotePath(listFile),
    '-c', 'copy',
    '-y', quotePath(outputFile),
  ]

  return new Promise((resolve) => {
    const cmd = buildArgs([ffmpeg, ...args])
    const proc = spawn('cmd', ['/c', cmd], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    mergeProcess.set(workspaceId, proc)

    let stderr = ''
    let lastPct = 0

    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      stderr += text
      const m = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/)
      if (m && onProgress) {
        const h = parseInt(m[1]), min = parseInt(m[2]), s = parseFloat(m[3])
        const cur = h * 3600 + min * 60 + s
        const pct = Math.min(98, ((cur / (chunkFiles.length * 10)) * 100))
        if (Math.abs(pct - lastPct) >= 1) { lastPct = pct; onProgress(pct) }
      }
    })

    proc.on('close', (code) => {
      mergeProcess.delete(workspaceId)
      try { fs.unlinkSync(listFile) } catch {}
      if (code !== 0 || !fs.existsSync(outputFile)) {
        resolve({ success: false, fileSize: 0, error: stderr || `Concat ${code}` })
      } else {
        let size = 0
        try { size = fs.statSync(outputFile).size } catch {}
        resolve({ success: true, fileSize: size })
      }
    })

    setTimeout(() => {
      if (!proc.killed) proc.kill()
      mergeProcess.delete(workspaceId)
      try { fs.unlinkSync(listFile) } catch {}
      resolve({ success: false, fileSize: 0, error: 'Concat timeout' })
    }, 60_000)
  })
}

// ─── Chunked render ────────────────────────────────────────────────────────────

export async function renderChunked(
  metadata: RenderMetadata,
  outputDir: string,
  config: ChunkConfig = {},
  onProgress?: (progress: RenderProgress & { phase: 'split' | 'encode' | 'merge'; chunkIndex?: number }) => void,
): Promise<ChunkedResult> {
  const {
    workspace_id, source_video, blur_background, trim, export_resolution, codec = 'hevc', preset = 'p1',
    backgroundType = 'blur', backgroundColor = '#000000', backgroundImage,
    isShort = true,
  } = metadata
  const { workers = 8, chunkDuration = 120, minChunkDuration = 10 } = config

  const [outW, outH] = metadata.export_resolution.split('x').map(Number)
  const canvasW = outW || 1080
  const canvasH = outH || 1920
  const headerH = isShort ? Math.floor(canvasH * 0.20) : Math.floor(canvasH * 0.30)
  const titleH = isShort ? Math.floor(canvasH * 0.20) : Math.floor(canvasH * 0.30)
  const videoH = canvasH - headerH - titleH
  const videoTop = headerH
  const videoW = Math.floor(videoH * 16 / 9)

  const trimStart = trim.start
  const trimEnd = trim.end
  const totalDuration = trimEnd - trimStart

  if (totalDuration <= 60) {
    const simple = await renderVideo(metadata, outputDir, onProgress as any)
    return { ...simple, chunks: [], totalEncodeMs: 0 }
  }

  const ffmpeg = getFfmpegPath()
  const workspaceDir = path.join(outputDir, 'chunks', workspace_id)
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true })

  onProgress?.({ workspaceId: workspace_id, percent: 0, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'split' })

  let splitPoints = [trimStart]
  const targetChunks = Math.ceil(totalDuration / chunkDuration)
  // Smart keyframe detection: only for longer videos
  const keyframes = totalDuration > 120
    ? await findKeyframeSmart(source_video, totalDuration, targetChunks)
    : []

  if (keyframes.length > 2) {
    const idealInterval = totalDuration / targetChunks
    let nextSplit = trimStart + idealInterval
    for (const kf of keyframes) {
      if (kf >= nextSplit - 0.5 && kf <= nextSplit + 2) {
        if (kf - splitPoints[splitPoints.length - 1] >= minChunkDuration) {
          splitPoints.push(kf)
          nextSplit += idealInterval
        }
      }
    }
  } else {
    const targetChunks = Math.ceil(totalDuration / chunkDuration)
    for (let i = 1; i < targetChunks; i++) {
      splitPoints.push(trimStart + i * (totalDuration / targetChunks))
    }
  }
  splitPoints.push(trimEnd)

  const finalSplits: number[] = [splitPoints[0]]
  for (let i = 1; i < splitPoints.length; i++) {
    if (splitPoints[i] - finalSplits[finalSplits.length - 1] >= minChunkDuration) {
      finalSplits.push(Math.min(splitPoints[i], trimEnd))
    }
  }
  if (finalSplits[finalSplits.length - 1] !== trimEnd) {
    finalSplits.push(trimEnd)
  }

  const chunks: ChunkedResult['chunks'] = []
  const numChunks = finalSplits.length - 1

  onProgress?.({ workspaceId: workspace_id, percent: 5, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'encode', chunkIndex: 0 })

  // Pre-render title overlay once (shared across all chunks)
  const titleOverlayResult = await preRenderOverlays(metadata, outputDir, workspace_id)
  const titleOverlayPath = titleOverlayResult.titleOverlayPath

  for (let batchStart = 0; batchStart < numChunks; batchStart += workers) {
    const batchEnd = Math.min(batchStart + workers, numChunks)
    const batch = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)

    const batchResults = await Promise.all(batch.map(async (idx) => {
      const startSec = finalSplits[idx]
      const endSec = finalSplits[idx + 1]
      const durationSec = endSec - startSec
      const chunkFile = path.join(workspaceDir, `chunk_${String(idx).padStart(3, '0')}.mp4`)

      const result = await encodeChunk(
        workspace_id, source_video, blur_background ?? '', startSec, durationSec, chunkFile,
        codec as 'h264' | 'hevc', preset as 'p1' | 'p2' | 'p3', (metadata.tune as 'hq' | 'll' | 'film') ?? 'hq',
        canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW,
        titleOverlayPath ?? undefined,
        (pct) => {
          const chunkOverall = ((idx + pct / 100) / numChunks) * 90 + 5
          onProgress?.({ workspaceId: workspace_id, percent: chunkOverall, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'encode', chunkIndex: idx })
        },
        isShort,
      )

      return { idx, startSec, endSec, chunkFile, result }
    }))

    for (const { idx, startSec, endSec, chunkFile, result } of batchResults) {
      if (result.success) {
        chunks.push({ index: idx, start: startSec, end: endSec, outputPath: chunkFile, fileSize: result.fileSize, encodeMs: result.encodeMs, decodeFps: result.decodeFps, encodeFps: result.encodeFps })
        console.log(`[Profile] chunk ${idx}: ${result.encodeMs}ms, decode~${result.decodeFps} fps, encode~${result.encodeFps} fps`)
      } else {
        console.warn(`[Chunk] Chunk ${idx} failed (${result.error}), falling back to standard render`)
        const fallback = await renderVideo(metadata, outputDir, onProgress as any)
        return { ...fallback, chunks: [], totalEncodeMs: 0 }
      }
    }
  }

  onProgress?.({ workspaceId: workspace_id, percent: 95, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'merge' })

  const outputFile = path.join(outputDir, `${workspace_id}_chunked_output.mp4`)
  chunks.sort((a, b) => a.index - b.index)

  const mergeResult = await mergeChunks(
    workspace_id,
    chunks.map(c => c.outputPath),
    outputFile,
    (pct) => onProgress?.({ workspaceId: workspace_id, percent: 95 + pct * 0.05, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'merge' }),
  )

  const totalEncodeMs = chunks.reduce((s, c) => s + c.encodeMs, 0)

  // Build profile summary from all chunks
  const decodeFpsVals = chunks.map(c => c.decodeFps).filter((v): v is number => v !== undefined && v > 0)
  const encodeFpsVals = chunks.map(c => c.encodeFps).filter((v): v is number => v !== undefined && v > 0)
  const avgDecodeFps = decodeFpsVals.length ? decodeFpsVals.reduce((a, b) => a + b, 0) / decodeFpsVals.length : 0
  const avgEncodeFps = encodeFpsVals.length ? encodeFpsVals.reduce((a, b) => a + b, 0) / encodeFpsVals.length : 0
  console.log(`[Profile] Summary: avgDecode=${avgDecodeFps.toFixed(1)} fps, avgEncode=${avgEncodeFps.toFixed(1)} fps, total=${totalEncodeMs}ms`)

  if (!mergeResult.success) {
    return { success: false, workspaceId: workspace_id, chunks, totalEncodeMs, error: mergeResult.error }
  }

  return {
    success: true,
    workspaceId: workspace_id,
    outputPath: outputFile,
    fileSize: mergeResult.fileSize,
    duration: totalDuration,
    chunks,
    totalEncodeMs,
    profileSummary: { avgDecodeFps, avgEncodeFps, totalMs: totalEncodeMs },
  }
}
