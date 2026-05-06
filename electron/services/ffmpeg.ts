import { spawn } from 'child_process'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { getFfmpegPath, getFfprobePath, getFfmpegVersion } from './ffmpeg-paths.js'
import { runFfmpeg, cancelFfmpeg } from './worker-pool.js'
import { getGPUCapabilities, getEffectiveWorkers, type GPUTier } from './system.js'

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
  tune?: 'hq' | 'll' | 'ull' | 'film'
  canvasBg?: 'black' | 'white'
  // Background
  backgroundType?: 'blur' | 'solid' | 'image'
  backgroundColor?: string  // hex color e.g. "#000000" — used when backgroundType='solid'
  backgroundImage?: string  // absolute path — used when backgroundType='image'
  /** Legacy: blur background path (still used when backgroundType='blur') */
  blur_background?: string
  /** Source video aspect ratio — true = 9:16 vertical (short), false = landscape (16:9 or wider) */
  isShort?: boolean
  /** Landscape video zone height as % of canvas (30-100). Larger = bigger video, less thumbnail space. */
  vidHeightPct?: number
  /** Audio codec. Default: 'aac'. 'libopus' = ~3x faster audio encode. */
  audioCodec?: 'aac' | 'libopus'
  /** Audio bitrate. Default: '192k'. Lower values (64k, 96k) = faster encode, smaller file. */
  audioBitrate?: string
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

// ─── Hardware decode/filter helpers ──────────────────────────────────────────────

// Get hardware capability flags (cached, single call per lifetime).
function getHwCaps() {
  return getFfmpegVersion(getFfmpegPath())
}

// Determine the best hardware decoder for the current platform and FFmpeg build.
// Priority: NVDEC (cuda) > CUVID (legacy) > software
function getBestHwDecCodec(codec: 'h264' | 'hevc'): string {
  const ver = getHwCaps()
  if (ver.hasNvdec) {
    // NVDEC: modern CUDA Video Decoder API, recommended for RTX 30+/40+/50+
    return codec === 'hevc' ? 'hevc_nvdec' : 'h264_nvdec'
  }
  if (ver.hasCuvid) {
    // CUVID: legacy but still functional, fallback for older FFmpeg builds
    console.log('[FFmpeg] NVDEC not available — falling back to CUVID (legacy)')
    return codec === 'hevc' ? 'hevc_cuvid' : 'h264_cuvid'
  }
  // No hardware decode available — let FFmpeg auto-select or use software
  return codec === 'hevc' ? 'hevc' : 'h264'
}

// Determine the best scale filter. scale_cuda is GPU-accelerated and much faster
// than CPU-based scale for high-resolution video. Falls back to CPU scale if unavailable.
function getScaleFilter(useGpu: boolean): string {
  if (!useGpu) return 'scale'
  return getHwCaps().hasCudaFilters ? 'scale_cuda' : 'scale'
}

// Determine overlay filter (GPU-accelerated if available)
function getOverlayFilter(useGpu: boolean): string {
  if (!useGpu) return 'overlay'
  return getHwCaps().hasCudaFilters ? 'overlay_cuda' : 'overlay'
}

// ─── Shell path helper ─────────────────────────────────────────────────────────
// Path quoting utility — exported for use by youtube.ts pre-scale function
export function quotePath(p: string): string {
  return '"' + p.replace(/"/g, '""') + '"'
}

export function buildArgs(program: string, args: string[]): string {
  // Build a command string for cmd.exe (shell: true).
  // - Forward slashes only: backslashes in paths cause issues with cmd.exe parsing.
  // - Double-quotes in cmd.exe protect semicolons from being treated as command
  //   separators — no caret escaping needed.
  // - Quote args that contain spaces.
  //   NOTE: do NOT quote semicolons — they are FFmpeg filter separators and must pass through unquoted.
  //   Parentheses, brackets are safe in bash double quotes too, but spaces are the only real risk.
  const toShellPath = (s: string) => s.replace(/\\/g, '/')
  const needsQuote = (s: string) =>
    s.includes(' ') || s.includes('"')
  const quoteArg = (s: string) => '"' + s.replace(/"/g, '""') + '"'

  const prog = quoteArg(toShellPath(program))
  const shellArgs = args.map(a => {
    const normalized = toShellPath(a)
    if (!needsQuote(normalized)) return normalized
    return quoteArg(normalized)
  })
  return [prog, ...shellArgs].join(' ')
}

// Run FFmpeg via execSync — only use this for simple one-shot commands (no complex quoting issues).
// For anything with multiple inputs or filter_complex, use spawn() + buildArgs() instead.
export function runSimpleFfmpeg(ffmpeg: string, ffArgs: string[]): { code: number; stderr: string } {
  const cmd = `"${ffmpeg}" ${ffArgs.join(' ')}`
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stderr: out }
  } catch (err: any) {
    return { code: err.status ?? 1, stderr: err.stderr?.toString() || err.message }
  }
}

// ─── Probe video dimensions ──────────────────────────────────────────────────────

export async function probeVideoAspect(videoPath: string): Promise<{ width: number; height: number; isShort: boolean } | null> {
  const ffprobe = getFfprobePath()
  const normalizedFfprobe = ffprobe.replace(/\\/g, '/')
  const normalizedVideoPath = videoPath.replace(/\\/g, '/')
  try {
    const out = execSync(`"${normalizedFfprobe}" -v error -select_streams v:0 -show_entries stream=width,height -of json "${normalizedVideoPath}"`, {
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

// ─── Probe video duration (for smart blur seek) ─────────────────────────────────

function probeVideoDuration(videoPath: string): number {
  const ffprobe = getFfprobePath()
  const normalizedFfprobe = ffprobe.replace(/\\/g, '/')
  const normalizedVideoPath = videoPath.replace(/\\/g, '/')
  try {
    const out = execSync(
      `"${normalizedFfprobe}" -v error -show_entries format=duration -of json "${normalizedVideoPath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    )
    const json = JSON.parse(out)
    const dur = parseFloat(json.format?.duration || '0')
    return dur > 0 ? dur : 0
  } catch (e) {
    return 0
  }
}

// ─── Post-download: trim video with FFmpeg (fast re-mux, no re-encode) ──────────
// Uses -ss before -i for fast seek, then -t to limit duration.
// Output is stream-copied (not re-encoded) so it's very fast.
// Returns the path to the trimmed file.

export async function trimVideo(
  sourcePath: string,
  outputPath: string,
  startSec: number,
  durationSec: number,
): Promise<{ success: boolean; error?: string }> {
  const ffmpeg = getFfmpegPath()

  return new Promise((resolve) => {
    const args = [
      '-ss', String(startSec),
      '-i', quotePath(sourcePath),
      '-t', String(durationSec),
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-y', quotePath(outputPath),
    ]
    const cmd = buildArgs(ffmpeg, args)
    const proc = spawn(cmd, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr || `trim failed (code ${code})` })
      }
    })
    setTimeout(() => {
      if (!proc.killed) proc.kill()
      resolve({ success: false, error: 'trim timeout' })
    }, 120_000)
  })
}

// ─── Pre-process: Blur background generation ───────────────────────────────────
// Smart seek: probes video duration first and seeks to a reliable position.
// For short videos (< 5min): seek to 25% of duration
// For long videos: seek to 5min (past intro, action typically starts)
// Falls back to first frame if seeking fails.

export async function generateBlurBackground(
  videoPath: string,
  outputPath: string,
  width = 1080,
  height = 1920,
  /** Pass known duration to skip redundant ffprobe call (already fetched by getVideoInfo). */
  duration?: number,
): Promise<{ success: boolean; error?: string }> {
  const ffmpeg = getFfmpegPath()

  const run = (ffArgs: string[]): Promise<{ code: number; stderr: string }> => new Promise((resolve) => {
    const cmd = buildArgs(ffmpeg, ffArgs)
    const proc = spawn(cmd, [], {
      shell: true,
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

  // Use provided duration or probe if not known
  const videoDuration = duration ?? probeVideoDuration(videoPath)

  // Determine seek time:
  // - Video < 5min: seek to 25% of duration (mid-video, usually has action)
  // - Video >= 5min: seek to 5min (past intro)
  let seekTime: number
  let seekLabel: string
  if (videoDuration > 0 && videoDuration < 300) {
    seekTime = Math.max(1, Math.floor(videoDuration * 0.25))
    seekLabel = `${seekTime}s (25% of ${Math.floor(videoDuration)}s video)`
  } else {
    seekTime = 300  // 5 minutes
    seekLabel = `5:00`
  }

  // Primary: seek to determined position
  const primaryArgs = [
    '-ss', String(seekTime),
    '-i', quotePath(videoPath),
    '-vframes', '1',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20,format=yuv420p`,
    '-y', quotePath(outputPath),
  ]

  let result = await run(primaryArgs)
  if (result.code === 0 && fs.existsSync(outputPath)) {
    console.log(`[Blur] Generated blur bg (seek=${seekLabel})`)
    return { success: true }
  }

  // Fallback 1: try 10% of video (earlier position)
  if (duration != null && duration > 0) {
    const earlySeek = Math.max(1, Math.floor(duration * 0.10))
    const fallback1Args = [
      '-ss', String(earlySeek),
      '-i', quotePath(videoPath),
      '-vframes', '1',
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20,format=yuv420p`,
      '-y', quotePath(outputPath),
    ]
    result = await run(fallback1Args)
    if (result.code === 0 && fs.existsSync(outputPath)) {
      console.log(`[Blur] Generated blur bg (seek=early ${earlySeek}s)`)
      return { success: true }
    }
  }

  // Fallback 2: first frame
  const fallback2Args = [
    '-i', quotePath(videoPath),
    '-vframes', '1',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20,format=yuv420p`,
    '-y', quotePath(outputPath),
  ]

  result = await run(fallback2Args)
  if (result.code !== 0) {
    return { success: false, error: result.stderr || `ffmpeg failed: ${result.code}` }
  }

  console.log(`[Blur] Generated blur bg (seek=first frame)`)
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

    const cmd = buildArgs(ffmpeg, args)
    const proc = spawn(cmd, [], {
      shell: true,
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
//
// GPU acceleration: uses scale_cuda/overlay_cuda when available (much faster than CPU).

function buildFilterComplex(opts: {
  useCuda?: boolean

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
  backgroundType?: 'blur' | 'solid' | 'image'
  /** Pre-rendered title overlay PNG — replaces CPU drawtext per frame */
  titleOverlayPath?: string
  /** Source video is a short (9:16 or taller). Landscape (16:9 or wider) uses thumbnail-bg + square-cropped video */
  isShort?: boolean
}): string {
  const {
    headerOl, titleOl, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW, speedFilter,
    backgroundType = 'blur',
    titleOverlayPath,
    isShort = true,
    useCuda = true,
  } = opts

  // Determine filter pipeline.
  // CPU-based scale is more reliable than scale_cuda for certain HEVC streams.
  const scale = useCuda ? 'scale_cuda' : 'scale'
  const overlay = useCuda ? 'overlay_cuda' : 'overlay'

  // ── LANDSCAPE layout: thumbnail bg + landscape video + part number ──
  // IMPORTANT: sections[1] = bgChain2 outputs [bg] via [1:v].
  // But bgScaleFilter replaces sections[1] with a different background filter.
  // The original sections[1] bgChain2 and sections[2] vzChain2 BOTH use [bg] label.
  // When we replace sections[1] with bgScaleFilter (which also outputs [bg]),
  // the vzChain2 that follows still references [bg] from sections[1]'s output.
  // This works because sections[2] references the [bg] label that bgScaleFilter produces.
  if (!isShort) {
    // Scale landscape video to canvas width, then crop to videoH zone height.
    // The crop may fail if videoH exceeds the scaled source height (ultra-wide at high vidHeightPct).
    // Use contain strategy: pad to center in the videoH zone when crop would fail.
    const scaledAfterScaleH = Math.round(canvasW * 9 / 16)  // e.g. 607 for 1080-wide canvas
    let videoChain2 = ''

    if (videoH <= scaledAfterScaleH) {
      // Safe: crop from center-vertical
      const cropY = Math.round((scaledAfterScaleH - videoH) / 2)
      videoChain2 = `[0:v]${scale}=${canvasW}:-2,crop=${canvasW}:${videoH}:0:${cropY}${speedFilter}[vid]`
    } else {
      // Unsafe: target exceeds scaled source — use contain (letterboxing)
      // Use scale+pad in two steps: first scale to target height, then pad to full width
      const scaledIh = Math.round(canvasW * 9 / 16)  // height after scale to canvasW width
      const targetY = Math.round((videoH - scaledIh) / 2)
      // Step 1: scale to target height (preserving aspect)
      // Step 2: pad to canvas width with horizontal centering
      // Note: use iw/ih in pad expressions (ow/oh reference output of THIS pad, not previous)
      videoChain2 = `[0:v]${scale}=${canvasW}:${videoH}:force_original_aspect_ratio=decrease,pad=${canvasW}:${videoH}:(ow-iw)/2:${targetY}${speedFilter}[vid]`
    }
    // [1:v] thumbnail → fill entire canvas background
    const bgChain2 = `[1:v]${scale}=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease[bg]`
    // Video over thumbnail bg, positioned at videoTop
    const vzChain2 = `[bg][vid]${overlay}=0:${videoTop}[vz]`
    // Title overlay (part number) at bottom
    if (titleOl?.content && titleOverlayPath) {
      const sections = [videoChain2, bgChain2, vzChain2]
      sections.push(`[2:v]${scale}=${canvasW}:${titleH}[titleScaled]`, `[vz][titleScaled]${overlay}=0:${canvasH - titleH}[td]`)
      return sections.join('; ')
    }
    return [videoChain2, bgChain2, vzChain2].join('; ')
  }

  // ── SHORT (vertical) layout: header + video zone + title ──
  // Filter chain with explicit labels to avoid FFmpeg parsing ambiguity.
  // Stage 1: scale → output=[scaled]
  // Stage 2: setpts → output=[sped] (only if speed != 1.0)
  // Stage 3: pad → output=[vid]
  const scaleChain = `[0:v]${scale}=${videoW}:${videoH}:force_original_aspect_ratio=decrease[scaled]`
  let videoChain: string
  if (speedFilter) {
    // Two stages: scale → setpts → pad
    videoChain = `${scaleChain}; [scaled]${speedFilter}[sped]; [sped]pad=${canvasW}:${canvasH}:(ow-iw)/2:${videoTop}[vid]`
  } else {
    // Single stage: scale + pad combined
    videoChain = `${scaleChain}; [scaled]pad=${canvasW}:${canvasH}:(ow-iw)/2:${videoTop}[vid]`
  }

  // Scale background to canvas
  // blur/image: scale from source size. solid: color filter outputs exact size already.
  const bgChain = backgroundType === 'solid'
    ? `[1:v]null[bg]`
    : `[1:v]${scale}=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease[bg]`

  // Header image scale (full canvas width)
  const hdChain = headerOl?.src ? `[2:v]${scale}=${canvasW}:${headerH}[hd]` : ''

  // Video over bg → [vz]
  const vzChain = `[bg][vid]${overlay}=0:${videoTop}[vz]`

  // Build sections
  const sections: string[] = [videoChain, bgChain]

  if (hdChain) {
    sections.push(hdChain, `[vz][hd]${overlay}=0:0[fh]`)
  }

  if (titleOl?.content && titleOverlayPath) {
    // Pre-rendered PNG overlay — overlay on GPU instead of CPU drawtext
    // Input [3:v] = pre-rendered title PNG
    const baseLabel = hdChain ? '[fh]' : '[vz]'
    sections.push(`[3:v]null[titleOverlay]`, `${baseLabel}[titleOverlay]${overlay}=0:0[td]`)
  }

  return sections.join('; ')
}

// ─── Optimized NVENC parameters ─────────────────────────────────────────────────
// Per-architecture NVENC tuning for RTX 5080 and other GPUs.
// Uses GPUCapabilities to get architecture-specific session limits and surface counts.

function getNvencParams(codec: 'h264' | 'hevc', isChunked: boolean, gpuTier: GPUTier = 'software'): string[] {
  const caps = getGPUCapabilities()
  const isHighTier = gpuTier === 'high'
  const isMidTier = gpuTier === 'mid'

  // GPU-aware preset selection:
  //   RTX 5080 (high): p1 for chunked (speed), p3 for single (quality)
  //   RTX 3060 (mid):  p2 for chunked, p3 for single
  //   others (low):   p3 for both
  const preset = isChunked
    ? (isHighTier ? 'p1' : isMidTier ? 'p2' : 'p3')
    : 'p3'

  // CQ tuning: RTX 5080 uses balanced CQ (quality vs file size)
  //   Chunked: speed focus → slightly higher CQ (smaller files, fast encode)
  //   Single-pass: quality focus → lower CQ (better quality)
  const cq = codec === 'hevc'
    ? (isChunked ? '26' : '24')
    : (isChunked ? '22' : '20')

  // Tune: 'ull' = ultra-low-latency, fastest encode on RTX 5080
  //        'll'  = low-latency for mid-tier
  //        'hq'  = high quality for single-pass
  const tune = isChunked
    ? (isHighTier ? 'ull' : isMidTier ? 'll' : 'll')
    : 'hq'

  const params: string[] = [
    '-preset', preset,
    '-rc', 'vbr',
    '-cq', cq,
    '-tune', tune,
    '-bf', '0',         // No B-frames → faster encode, hardware-compatible
    '-refs', '1',       // Single reference frame → minimum latency
    '-reconnect', '1',  // Handle stream interruption gracefully
  ]

  if (isChunked) {
    params.push(
      '-rc-lookahead', '0',    // Disable lookahead → zero-latency encode (ull/ll tune)
      '-spatial-aq', '1',      // Adaptive quantization for quality
      '-aq-strength', '8',
    )
    // Hardware surface pool: use architecture-defined value from system.ts
    // RTX 5080: 48 surfaces, RTX 4090: 48, RTX 4080: 48, RTX 3090: 32, RTX 3060: 16
    const surfaceCount = String(caps.nvencSurfaceCount || (isHighTier ? 48 : 16))
    params.push('-surfaces', surfaceCount)
    // Device selection: primary GPU (device 0) — multi-GPU future consideration
    params.push('-gpu', 'any')
  } else {
    params.push(
      '-rc-lookahead', '16',  // Quality-focused lookahead
      '-spatial-aq', '1',
      '-aq-strength', '9',
    )
    params.push('-gpu', 'any')
  }

  return params
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

    const cmd = buildArgs(ffmpeg, args)
    const proc = spawn(cmd, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const vidHeightPct = metadata.vidHeightPct ?? 50
  const headerH = isShort ? Math.floor(canvasH * 0.20) : Math.floor((canvasH - Math.floor(canvasH * vidHeightPct / 100)) / 2)
  const titleH = isShort ? Math.floor(canvasH * 0.20) : Math.floor(canvasH * (100 - vidHeightPct) / 100)
  const videoTop = isShort ? headerH : Math.floor((canvasH - Math.floor(canvasH * vidHeightPct / 100)) / 2)

  const overlayDir = path.join(outputDir, 'overlays', workspaceId)
  if (!fs.existsSync(overlayDir)) fs.mkdirSync(overlayDir, { recursive: true })

  const overlayPath = path.join(overlayDir, 'title_overlay.png')

  const result = await renderTextOverlay(
    titleOl.content,
    canvasW,
    canvasH,
    headerH,
    titleH,
    videoTop,  // placement Y for the overlay box
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

// Parallel keyframe probe — all positions searched simultaneously.
// For a 30-min video with 8 chunks: ~8 concurrent seeks × ~200ms each = ~200ms total vs ~2s sequential.
function probeKeyframeNear(
  ffprobe: string,
  videoPath: string,
  targetTime: number,
  seekWindow: number = 2,
): Promise<string[]> {
  const seekFrom = Math.max(0, targetTime - seekWindow)
  const args = [
    '-v', 'quiet',
    '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time,flags',
    '-skip_frame', 'nokey',
    '-ss', String(seekFrom),
    '-to', String(targetTime + seekWindow),
    '-of', 'csv=p=0',
    quotePath(videoPath),
  ]
  const cmd = buildArgs(ffprobe, args)
  return new Promise((resolve) => {
    const proc = spawn(cmd, [], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.on('close', () => resolve(stdout.split('\n')))
    proc.on('error', () => resolve([]))
  })
}

async function findKeyframeSmart(
  videoPath: string,
  totalDuration: number,
  targetCount: number
): Promise<number[]> {
  if (targetCount <= 1 || totalDuration <= 120) return []

  const ffprobe = getFfprobePath()

  // Probe at evenly-spaced positions and find nearest keyframe ±2s
  const probePositions: number[] = []
  for (let i = 1; i <= targetCount; i++) {
    probePositions.push((totalDuration / (targetCount + 1)) * i)
  }

  // Fire ALL probes in parallel — critical for performance
  const allLines = await Promise.all(
    probePositions.map(t => probeKeyframeNear(ffprobe, videoPath, t, 2))
  )

  const keyframes: number[] = []
  const seen = new Set<number>()

  for (const lines of allLines) {
    for (const line of lines) {
      const match = line.match(/^([\d.]+)/)
      if (!match) continue
      const ts = parseFloat(match[1])
      // Deduplicate within 0.5s window
      const bucket = Math.round(ts * 2) / 2
      if (seen.has(bucket)) continue
      if (ts > 0 && ts < totalDuration) {
        seen.add(bucket)
        keyframes.push(ts)
      }
    }
  }

  keyframes.sort((a, b) => a - b)
  return keyframes
}

// ─── Main render ───────────────────────────────────────────────────────────────

export async function renderVideo(
  metadata: RenderMetadata,
  outputDir: string,
  onProgress?: (progress: RenderProgress) => void,
  gpuTier: 'high' | 'mid' | 'low' | 'software' = 'software',
): Promise<RenderResult> {
  const {
    workspace_id, source_video, export_resolution,
    video_speed, fps_target, overlays, trim,
    codec = 'hevc',
    backgroundType = 'blur', backgroundColor = '#000000', backgroundImage,
    blur_background,
    isShort = true,
    vidHeightPct = 50,
    audioCodec = 'aac',
    audioBitrate = '192k',
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

  // SHORT:     header (20%) + video (60%) + title (20%)
  // LANDSCAPE: vidHeightPct% for video zone, rest is thumbnail background, title below
  const headerH = isShort ? Math.floor(canvasH * 0.20) : Math.floor((canvasH - Math.floor(canvasH * vidHeightPct / 100)) / 2)
  const titleH = isShort ? Math.floor(canvasH * 0.20) : Math.floor(canvasH * (100 - vidHeightPct) / 100)
  const videoH = isShort ? canvasH - headerH - titleH : Math.floor(canvasH * vidHeightPct / 100)
  const videoTop = isShort ? headerH : Math.floor((canvasH - videoH) / 2)
  const videoW = Math.floor(videoH * 16 / 9)

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

  // CPU-aware threading: use all available cores for the filter pipeline.
  // RTX 5080 + Core Ultra 9 (24 cores): can handle more threads.
  // Cap at 16 to avoid thread oversubscription on the filter chain.
  const numThreads = Math.min(os.cpus().length, 16)

  // Use CPU decode to avoid NVDEC/HEVC incompatibility failures.
  // hevc_nvdec fails on certain HEVC profiles with "Invalid NAL unit size".
  // CPU decode → filter → NVENC encode is more reliable.
  const decCodec = codec

  // Build filter complex (CPU-based to avoid scale_cuda/HEVC incompatibility)
  const titleOverlayResult = await preRenderOverlays(metadata, outputDir, workspace_id)
  const titleOverlayPath = titleOverlayResult.titleOverlayPath ?? undefined
  const filterComplex = buildFilterComplex({ useCuda: false, headerOl, titleOl, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW, speedFilter, backgroundType, titleOverlayPath, isShort })

  // Determine output label
  let mapOutput = '[vz]'
  if (titleOverlayPath && headerOl?.src) mapOutput = '[td]'
  else if (!titleOverlayPath && headerOl?.src) mapOutput = '[fh]'

  // Build ffmpeg args
  // Inputs: [0]=source video, [1]=background, [2]=header image (optional), [3]=title overlay PNG (optional)
  // For LANDSCAPE: [1] = thumbnail (used as bg), [2] = title overlay PNG
  const args: string[] = [
    '-ss', String(trimStart),
    '-t', String(decodeDuration),
    '-c:v', decCodec,
    '-threads', String(numThreads),
    '-avoid_negative_ts', 'make_zero',
    '-i', quotePath(source_video),
    // NVDEC GPU decode via per-stream -c:v, filter runs on CPU/GPU depending on build
    ...(backgroundType === 'solid'
      ? ['-f', 'lavfi', '-i', `color=c=${backgroundColor}:s=${canvasW}x${canvasH}:d=1:r=1`]
      : backgroundType === 'image' && backgroundImage
        ? ['-i', quotePath(backgroundImage)]
        : blur_background
          ? ['-i', quotePath(blur_background)]
          : ['-f', 'lavfi', '-i', `color=c=black:s=${canvasW}x${canvasH}:d=1:r=1`]),
    // Input [2]: header image for short mode; title overlay for landscape mode
    ...(isShort
      ? (headerOl?.src ? ['-i', quotePath(headerOl.src)] : [])
      : (titleOverlayPath ? ['-i', quotePath(titleOverlayPath)] : [])),
    // Input [3]: title overlay for short mode
    ...(isShort && titleOverlayPath ? ['-i', quotePath(titleOverlayPath)] : []),
    '-filter_complex', filterComplex,
    '-map', mapOutput,
    '-c:v', nvencCodec,
    ...getNvencParams(codec, false, gpuTier),
    '-c:a', audioCodec,
    '-b:a', audioBitrate,
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
  gpuTier?: 'high' | 'mid' | 'low' | 'software'
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
  canvasW: number,
  canvasH: number,
  headerH: number,
  titleH: number,
  videoH: number,
  videoTop: number,
  videoW: number,
  titleOverlayPath: string | undefined,
  isShort: boolean | undefined,
  videoSpeed: number | undefined,
  gpuTier: GPUTier = 'software',
  backgroundType?: 'blur' | 'solid' | 'image',
  backgroundColor?: string,
  backgroundImage?: string,
  numThreads?: number,
  audioCodec: 'aac' | 'libopus' = 'aac',
  audioBitrate: string = '192k',
): string[] {
  const nvencCodec = codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc'
  // Use CPU decode to avoid NVDEC/HEVC incompatibility failures.
  const decCodec = codec
  // CPU-aware threads: use all cores but cap at 16 to avoid oversubscription
  const chunkThreads = numThreads ?? Math.min(os.cpus().length, 16)

  // CPU-based scale is more reliable than scale_cuda for certain HEVC streams.
  const scale = 'scale'
  const overlay = 'overlay'

  const speedFilter = videoSpeed && videoSpeed !== 1.0
    ? 'setpts=' + (1 / videoSpeed) + '*PTS'
    : ''

  // Build background input based on type: blur (blurBg image), solid (lavfi color), image (image file)
  let bgInput: string[]
  if (backgroundType === 'solid') {
    bgInput = ['-f', 'lavfi', '-i', `color=c=${backgroundColor || '#000000'}:s=${canvasW}x${canvasH}:d=1:r=1`]
  } else if (backgroundType === 'image' && backgroundImage) {
    bgInput = ['-i', quotePath(backgroundImage)]
  } else if (blurBg) {
    // Default: blur background image
    bgInput = ['-i', quotePath(blurBg)]
  } else {
    // Fallback: solid black
    bgInput = ['-f', 'lavfi', '-i', 'color=c=black:s=' + canvasW + 'x' + canvasH + ':d=1:r=1']
  }

  if (!isShort) {
    const scaledAfterScaleH = Math.round(canvasW * 9 / 16)
    const sections: string[] = []

    if (videoH <= scaledAfterScaleH) {
      const cropY = Math.round((scaledAfterScaleH - videoH) / 2)
      if (speedFilter) {
        sections.push('[0:v]' + scale + '=' + canvasW + ':-2,crop=' + canvasW + ':' + videoH + ':0:' + cropY + '[cropped]; [cropped]' + speedFilter.replace(',', '') + '[vid]')
      } else {
        sections.push('[0:v]' + scale + '=' + canvasW + ':-2,crop=' + canvasW + ':' + videoH + ':0:' + cropY + '[vid]')
      }
    } else {
      // Letterboxing: scale to target height, then pad to canvas width with horizontal centering
      const scaledIh = Math.round(canvasW * 9 / 16)
      const targetY = Math.round((videoH - scaledIh) / 2)
      if (speedFilter) {
        sections.push('[0:v]' + scale + '=' + canvasW + ':' + videoH + ':force_original_aspect_ratio=decrease[step1]; [step1]pad=' + canvasW + ':' + videoH + ':(ow-iw)/2:' + targetY + '[step2]; [step2]' + speedFilter.replace(',', '') + '[vid]')
      } else {
        sections.push('[0:v]' + scale + '=' + canvasW + ':' + videoH + ':force_original_aspect_ratio=decrease,pad=' + canvasW + ':' + videoH + ':(ow-iw)/2:' + targetY + '[vid]')
      }
    }

    sections.push('[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=decrease[bg]')
    sections.push('[bg][vid]' + overlay + '=0:' + videoTop + '[vz]')

    if (titleOverlayPath) {
      sections.push('[2:v]' + scale + '=' + canvasW + ':' + titleH + '[titleScaled]')
      sections.push('[vz][titleScaled]' + overlay + '=0:' + (canvasH - titleH) + '[final]')
    }
    const filterChain = sections.join('; ')
    const mapOutput = titleOverlayPath ? '[final]' : '[vz]'

    // Background input index: [0]=video, [1]=bg, [2]=titleOverlay
    // For landscape, background is scaled to full canvas
    let bgScaleFilter = '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=decrease[bg]'
    if (backgroundType === 'solid') {
      // Solid bg: bgInput IS the full-canvas color, no extra scale needed
      bgScaleFilter = '[1:v]null[bg]'
    } else if (backgroundType === 'image' && backgroundImage) {
      // Image bg: scale to full canvas
      bgScaleFilter = '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=decrease[bg]'
    }
    // Replace sections[1] with bgScaleFilter
    const fixedSections = [sections[0], bgScaleFilter, ...sections.slice(2)]
    const fixedFilterChain = fixedSections.join('; ')

    return [
      '-ss', String(trimStart), '-t', String(trimDuration),
      '-c:v', decCodec,
      '-threads', String(chunkThreads),
      '-avoid_negative_ts', 'make_zero',
      '-i', quotePath(sourceVideo),
      ...bgInput,
      ...(titleOverlayPath ? ['-i', quotePath(titleOverlayPath)] : []),
      '-filter_threads', '16',
      '-filter_complex', fixedFilterChain,
      '-map', mapOutput, '-map', '0:a?',
      '-c:v', nvencCodec,
      ...getNvencParams(codec, true, gpuTier),
      '-max_muxing_queue_size', '512',
      '-c:a', audioCodec, '-b:a', audioBitrate,
      '-r', '30',
      '-y', quotePath(outputFile),
    ]
  }

  const scaleChain = '[0:v]' + scale + '=' + videoW + ':' + videoH + ':force_original_aspect_ratio=decrease'
  const padChain = ',pad=' + canvasW + ':' + canvasH + ':(ow-iw)/2:' + videoTop + '[vid]'
  const videoChain = scaleChain + speedFilter + padChain

  // Build background filter for short mode based on background type
  let bgFilter: string
  if (backgroundType === 'solid') {
    bgFilter = '[1:v]null[bg]'
  } else if (backgroundType === 'image' && backgroundImage) {
    bgFilter = '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=decrease[bg]'
  } else {
    bgFilter = '[1:v]' + scale + '=' + canvasW + ':' + canvasH + '[bg]'
  }

  const sections: string[] = [
    videoChain,
    bgFilter,
    '[bg][vid]' + overlay + '=0:' + videoTop + '[vz]',
  ]

  if (titleOverlayPath) {
    sections.push('[2:v]null[titleOl]', '[vz][titleOl]' + overlay + '=0:0[final]')
  }

  const filterChain = sections.join('; ')
  const mapOutput = titleOverlayPath ? '[final]' : '[vz]'

  return [
    '-ss', String(trimStart),
    '-t', String(trimDuration),
    '-c:v', decCodec,
    '-threads', String(chunkThreads),
    '-avoid_negative_ts', 'make_zero',
    '-i', quotePath(sourceVideo),
    ...bgInput,
    ...(titleOverlayPath ? ['-i', quotePath(titleOverlayPath)] : []),
    '-filter_threads', '16',
    '-filter_complex', filterChain,
    '-map', mapOutput, '-map', '0:a?',
    '-c:v', nvencCodec,
    ...getNvencParams(codec, true, gpuTier),
    '-max_muxing_queue_size', '512',
    '-c:a', audioCodec, '-b:a', audioBitrate,
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
  videoSpeed?: number,
  gpuTier?: 'high' | 'mid' | 'low' | 'software',
  backgroundType?: 'blur' | 'solid' | 'image',
  backgroundColor?: string,
  backgroundImage?: string,
  audioCodec?: 'aac' | 'libopus',
  audioBitrate?: string,
): Promise<{ success: boolean; fileSize: number; encodeMs: number; error?: string; decodeFps?: number; encodeFps?: number }> {
  const ffmpeg = getFfmpegPath()
  const numThreads = Math.min(os.cpus().length, 16)
  const args = buildChunkArgs(
    sourceVideo, blurBg, startSec, durationSec, outputFile,
    codec, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW,
    titleOverlayPath, isShort, videoSpeed, gpuTier,
    backgroundType, backgroundColor, backgroundImage,
    numThreads,
    audioCodec ?? 'aac', audioBitrate ?? '192k',
  )

  return new Promise((resolve) => {
    const t0 = Date.now()
    const cmd = buildArgs(ffmpeg, args)
    const proc = spawn(cmd, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })

    if (!chunkedProcesses.has(workspaceId)) chunkedProcesses.set(workspaceId, [])
    chunkedProcesses.get(workspaceId)!.push({ proc, outputFile })

    let lastPct = 0
    let decodeFps = 0
    let encodeFps = 0
    // Ring buffer for stderr — scan recent lines only to avoid stale banner matches
    const LINE_BUF_SIZE = 100
    const lineBuf: string[] = []

    proc.stderr?.on('data', (data) => {
      const chunk = data.toString()
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (line.trim()) {
          lineBuf.push(line)
          if (lineBuf.length > LINE_BUF_SIZE) lineBuf.shift()
        }
      }

      // Scan only recent lines (avoids early banner matching)
      const recent = lineBuf.slice(-20).join('\n')
      const fpsM = recent.match(/fps=\s*([\d.]+)/)
      const speedM = recent.match(/speed=\s*([\d.]+)x/)
      if (fpsM) {
        const v = parseFloat(fpsM[1])
        if (speedM) {
          const spd = parseFloat(speedM[1])
          if (spd < 0.5) decodeFps = v
          else encodeFps = v
        }
      }
      const m = recent.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/)
      if (m && onProgress) {
        const h = parseInt(m[1]), min = parseInt(m[2]), s = parseFloat(m[3])
        const cur = h * 3600 + min * 60 + s
        const pct = Math.min(99, (cur / durationSec) * 100)
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
  totalDuration: number,
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
    const cmd = buildArgs(ffmpeg, args)
    const proc = spawn(cmd, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    mergeProcess.set(workspaceId, proc)

    // Ring buffer for stderr (same approach as runFfmpeg)
    const LINE_BUF_SIZE = 100
    const lineBuf: string[] = []
    let lastPct = 0

    proc.stderr?.on('data', (data) => {
      const chunk = data.toString()
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (line.trim()) {
          lineBuf.push(line)
          if (lineBuf.length > LINE_BUF_SIZE) lineBuf.shift()
        }
      }

      // Only scan recent lines for progress (avoids stale banner matches)
      const recent = lineBuf.slice(-20).join('\n')
      const m = recent.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/)
      if (m && onProgress) {
        const h = parseInt(m[1]), min = parseInt(m[2]), s = parseFloat(m[3])
        const cur = h * 3600 + min * 60 + s
        const pct = Math.min(100, (cur / totalDuration) * 100)
        if (Math.abs(pct - lastPct) >= 1) { lastPct = pct; onProgress(pct) }
      }
    })

    proc.on('close', (code) => {
      mergeProcess.delete(workspaceId)
      try { fs.unlinkSync(listFile) } catch {}
      if (code !== 0 || !fs.existsSync(outputFile)) {
        const recent = lineBuf.slice(-10).join(' | ')
        resolve({ success: false, fileSize: 0, error: recent || `Concat ${code}` })
      } else {
        let size = 0
        try { size = fs.statSync(outputFile).size } catch {}
        resolve({ success: true, fileSize: size })
      }
    })

    // Timeout: 1s per minute of content + 30s overhead (min 60s)
    const timeout = Math.max(60_000, Math.ceil(totalDuration * 1000) + 30_000)
    setTimeout(() => {
      if (!proc.killed) proc.kill()
      mergeProcess.delete(workspaceId)
      try { fs.unlinkSync(listFile) } catch {}
      resolve({ success: false, fileSize: 0, error: 'Concat timeout' })
    }, timeout)
  })
}

// ─── Chunked render ────────────────────────────────────────────────────────────
// Parallel encoding: splits video into chunks, encodes all chunks simultaneously,
// then merges. All background types (blur, solid, image) are supported.

export async function renderChunked(
  metadata: RenderMetadata,
  outputDir: string,
  config: ChunkConfig = {},
  onProgress?: (progress: RenderProgress & { phase: 'split' | 'encode' | 'merge'; chunkIndex?: number }) => void,
): Promise<ChunkedResult> {
  const {
    workspace_id, source_video, blur_background, trim, export_resolution, codec = 'hevc',
    isShort = true, overlays, video_speed,
    audioCodec = 'aac', audioBitrate = '192k',
  } = metadata
  const vidHeightPct = metadata.vidHeightPct ?? 50
  // Use VRAM-aware effective workers if not explicitly specified
  const effectiveWorkers = getEffectiveWorkers()
  const gpuTier = config.gpuTier ?? 'software'
  const workers = config.workers ?? effectiveWorkers
  // RTX 5080/4090: shorter chunks (90s) = more parallelism, faster total encode
  // Mid-tier: standard 120s chunks
  const chunkDuration = config.chunkDuration ?? (gpuTier === 'high' ? 90 : 120)
  const minChunkDuration = config.minChunkDuration ?? 10

  const [outW, outH] = metadata.export_resolution.split('x').map(Number)
  const canvasW = outW || 1080
  const canvasH = outH || 1920
  const headerH = isShort ? Math.floor(canvasH * 0.20) : Math.floor((canvasH - Math.floor(canvasH * vidHeightPct / 100)) / 2)
  const titleH = isShort ? Math.floor(canvasH * 0.20) : Math.floor(canvasH * (100 - vidHeightPct) / 100)
  const videoH = isShort ? canvasH - headerH - titleH : Math.floor(canvasH * vidHeightPct / 100)
  const videoTop = isShort ? headerH : Math.floor((canvasH - videoH) / 2)
  const videoW = Math.floor(videoH * 16 / 9)

  const trimStart = trim.start
  const trimEnd = trim.end
  const totalDuration = trimEnd - trimStart

  // Short duration → single-pass (no chunking overhead needed)
  if (totalDuration <= 60) {
    const simple = await renderVideo(metadata, outputDir, onProgress as any, gpuTier)
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
        workspace_id, source_video, blur_background || '', startSec, durationSec, chunkFile,
        codec as 'h264' | 'hevc',
        canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW,
        titleOverlayPath ?? undefined,
        (pct) => {
          const chunkOverall = ((idx + pct / 100) / numChunks) * 90 + 5
          onProgress?.({ workspaceId: workspace_id, percent: chunkOverall, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'encode', chunkIndex: idx })
        },
        isShort,
        video_speed,
        gpuTier,
        metadata.backgroundType,
        metadata.backgroundColor,
        metadata.backgroundImage,
        audioCodec,
        audioBitrate,
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
    totalDuration,
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

  // Cleanup chunk files and workspace directory after successful merge
  try {
    for (const chunk of chunks) {
      try { fs.unlinkSync(chunk.outputPath) } catch {}
    }
    const workspaceDir = path.join(outputDir, 'chunks', workspace_id)
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }) } catch {}
  } catch {}

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