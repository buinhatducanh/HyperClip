import { spawn } from 'child_process'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { getFfmpegPath, getFfprobePath, getFfmpegVersion } from './ffmpeg-paths.js'
import { runFfmpeg, cancelFfmpeg } from './worker-pool.js'
import { getGPUCapabilities, getEffectiveWorkers, type GPUTier } from './system.js'
import { devLog } from './unified_log.js'

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
  /** Height of the bottom bar (opaque bar at canvas bottom). Video shrinks to leave gap. Default: 64. Set to 0 to disable. */
  bottomBarH?: number
  /** Bottom bar accent color hex — used for SHORT mode bottom bar bar color */
  bottomBarColor?: string
  /** Enable bottom bar in SHORT mode. Default: true. */
  bottomBarEnabled?: boolean
  /** Watermark text to draw at bottom-right of rendered output. Set automatically from license. */
  watermarkText?: string
  /** Upscale to 720p for TikTok compliance when source is below 720p */
  upscaleToTikTok?: boolean
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
  /** Estimated seconds remaining. Calculated from elapsed time / progress. */
  eta?: number
  /** Elapsed wall-clock milliseconds since render start. */
  elapsedMs?: number
}

export interface RenderResult {
  success: boolean
  workspaceId: string
  outputPath?: string
  fileSize?: number
  duration?: number
  error?: string
}

// ─── SHORT (9:16) canvas zone constants ─────────────────────────────────────────
// All values as % of canvasH. Responsive to any canvas resolution (360, 720, 1080).
//
// Layout: HEADER (25%) | VIDEO (50%) | BOTTOM (25%)
// Video bottom touches top of bottom zone — no overlap.
export const HEADER_PCT = 0.25   // 25% — header overlay zone
export const BOTTOM_PCT = 0.25   // 25% — bottom bar zone (opaque bar + title)
export const VIDEO_PCT  = 1 - HEADER_PCT - BOTTOM_PCT  // 50% — video zone

// ─── Shared font path for drawtext ─────────────────────────────────────────────
// The font is copied to resources/fonts/arial.ttf at startup.
// FFmpeg 7.x lavfi parser splits option values at COLON characters (drive letter).
// Using a RELATIVE PATH (no `:` anywhere) means lavfi treats the whole path as one token.
// Double quotes around the fontfile path CRASH FFmpeg 7.1 on this gyan.dev build.
// No quotes needed — the path has no spaces or special chars.
const FONT_FILE = 'resources/fonts/arial.ttf'

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
    // CUVID: legacy but still functional, works with scale_cuda for GPU filter pipeline.
    // Pipeline: h264_cuvid (GPU decode) → scale_cuda (GPU filter) → h264_nvenc (GPU encode).
    // Full GPU pipeline when combined with CUDA filters.
    const prefix = codec === 'hevc' ? 'hevc' : 'h264'
    if (ver.hasCudaFilters) {
      devLog('[FFmpeg] Using CUDA pipeline: h264_cuvid → scale_cuda → h264_nvenc (GPU decode + filter + encode)')
    } else {
      devLog('[FFmpeg] CUVID hardware decode (GPU): no CUDA filters available — decode-only GPU acceleration')
    }
    return prefix + '_cuvid'
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

// Convert CSS hex (#RRGGBB) to FFmpeg hex (0xRRGGBB) for drawtext boxcolor.
// FFmpeg drawtext interprets 0xRRGGBB as RGB (confirmed by drawbox test).
// CSS colors can be passed directly: #00B4FF → 0x00B4FF → RGB(0,180,255) = cyan.
function toFfmpegColor(hex: string): string {
  return '0x' + hex.replace(/^#/, '')
}

export function buildArgs(program: string, args: string[]): string {
  // Build a command string for cmd.exe (shell: true).
  // - Forward slashes only: backslashes in paths cause issues with cmd.exe parsing.
  // - Quote ALL args to prevent cmd.exe from interpreting special characters.
  //   Double-quotes protect semicolons from being treated as command separators.
  // - Escape internal double-quotes by doubling them (" → "").
  const toShellPath = (s: string) => s.replace(/\\/g, '/')
  const quoteArg = (s: string) => '"' + s.replace(/"/g, '""') + '"'

  const prog = quoteArg(toShellPath(program))
  const shellArgs = args.map(a => {
    const normalized = toShellPath(a)
    // Quote all args. This prevents cmd.exe from interpreting semicolons (;) as
    // command separators. FFmpeg receives quoted args correctly.
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
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20`,
    '-y', quotePath(outputPath),
  ]

  let result = await run(primaryArgs)
  if (result.code === 0 && fs.existsSync(outputPath)) {
    devLog(`[Blur] Generated blur bg (seek=${seekLabel})`)
    return { success: true }
  }

  // Fallback 1: try 10% of video (earlier position)
  if (duration != null && duration > 0) {
    const earlySeek = Math.max(1, Math.floor(duration * 0.10))
    const fallback1Args = [
      '-ss', String(earlySeek),
      '-i', quotePath(videoPath),
      '-vframes', '1',
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20`,
      '-y', quotePath(outputPath),
    ]
    result = await run(fallback1Args)
    if (result.code === 0 && fs.existsSync(outputPath)) {
      devLog(`[Blur] Generated blur bg (seek=early ${earlySeek}s)`)
      return { success: true }
    }
  }

  // Fallback 2: first frame
  const fallback2Args = [
    '-i', quotePath(videoPath),
    '-vframes', '1',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20`,
    '-y', quotePath(outputPath),
  ]

  result = await run(fallback2Args)
  if (result.code !== 0) {
    return { success: false, error: result.stderr || `ffmpeg failed: ${result.code}` }
  }

  devLog(`[Blur] Generated blur bg (seek=first frame)`)
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
      '-vf', 'scale=1280:-2:force_original_aspect_ratio=decrease',
      '-q:v', '2',
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
  /** Pre-rendered bottom bar PNG (opaque bar with text, NOT transparent). */
  bottomBarOverlayPath?: string
  /** Source video is a short (9:16 or taller). Landscape (16:9 or wider) uses thumbnail-bg + square-cropped video */
  isShort?: boolean
  /** Output frame rate. Default 30. Added as explicit fps filter to guarantee output fps. */
  fpsTarget?: number
  /** Trim start in seconds. Default 0. Adds trim filter to avoid input seeking (which causes timestamp corruption on FFmpeg gyan.dev 7.1). */
  trimStart?: number
  /** Trim duration in seconds. Default unlimited. */
  trimDuration?: number
  /** Watermark text (license info) — drawn at bottom-right corner. */
  watermarkText?: string
}): string {
  const {
    headerOl, titleOl, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW, speedFilter,
    backgroundType = 'blur',
    titleOverlayPath,
    bottomBarOverlayPath,
    isShort = true,
    useCuda = true,
    fpsTarget = 30,
    trimStart = 0,
    trimDuration = 0,
    watermarkText,
  } = opts

  // GPU pipeline: scale_cuda/overlay_cuda with format=yuv420p conversion.
  // scale_cuda outputs NV12 CUDA surface. overlay_cuda needs yuv420p system RAM format.
  // format=yuv420p after every scale_cuda bridges the gap — output becomes system RAM yuv420p,
  // which overlay_cuda (and all downstream filters) can consume directly.
  const scale = useCuda ? 'scale_cuda' : 'scale'
  const ov = useCuda ? 'overlay_cuda' : 'overlay'

  // ── LANDSCAPE layout: thumbnail bg + landscape video + part number ──
  // IMPORTANT: sections[1] = bgChain2 outputs [bg] via [1:v].
  // But bgScaleFilter replaces sections[1] with a different background filter.
  // The original sections[1] bgChain2 and sections[2] vzChain2 BOTH use [bg] label.
  // When we replace sections[1] with bgScaleFilter (which also outputs [bg]),
  // the vzChain2 that follows still references [bg] from sections[1]'s output.
  // This works because sections[2] references the [bg] label that bgScaleFilter produces.
  if (!isShort) {
    // Landscape: fit source video into canvas with center crop.
    // videoH = height of video zone in canvas (e.g., 50% of portrait canvas = 960px for 1920px canvas)
    // videoTop = vertical center of canvas for the video zone.
    //
    // CORRECT approach: scale SOURCE to videoH (not canvasH), then crop to canvasW.
    // - If canvasW <= videoH * 16/9: source is wide → crop horizontally (landscape source)
    // - If canvasW > videoH * 16/9: source is narrow → crop vertically (portrait-ish source)
    //
    // cropX: center-crop from scaled source (scaled to videoH tall) down to canvasW wide.
    // After scaling source to videoH: scaledW = videoH * 16/9 (landscape)
    // cropX = (scaledW - canvasW) / 2 = (videoH * 16/9 - canvasW) / 2
    // cropX >= 0: crop from both sides. cropX < 0: source narrower → use cropY branch.
    //
    // cropY: center-crop from scaled source (scaled to canvasW wide) down to videoH tall.
    // After scaling source to canvasW: scaledH = canvasW * 9/16 (landscape)
    // cropY = (scaledH - videoH) / 2 = (canvasW * 9/16 - videoH) / 2
    // cropY >= 0: crop from both top/bottom. cropY < 0: source taller → use cropX branch.
    // eslint-disable-next-line no-useless-assignment
    let videoChain2 = ''
    const cropXNum = Math.round((videoH * 16 / 9 - canvasW) / 2)

    // Speed-adjusted trim duration: when speed > 1, input timestamps are compressed,
    // so the same raw duration produces fewer output seconds.
    const speedAdjust = speedFilter
      ? (() => {
          const m = speedFilter.match(/setpts=([\d.]+)\/([\d.]+)\*PTS/)
          return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1
        })()
      : 1
    const adjustedDuration = trimDuration > 0 ? trimDuration * speedAdjust : 999999

    if (cropXNum >= 0) {
      // Scale source to videoH tall (preserves aspect), then crop to canvasW wide.
      // e.g. canvas 1080x1920, videoH=960: scale 1920x1080 → 1707x960, crop 157 each side → 1080x960.
      const cropX = cropXNum
      // Correct order: fps → setpts(speed) → trim → setpts(reset) → scale → crop
      // Speed BEFORE trim: compresses timestamps so trim duration refers to output seconds.
      const fpsTag = fpsTarget ? `fps=${fpsTarget},` : ''
      const speedTag = speedFilter ? `${speedFilter},` : ''
      const trimSection = (trimStart > 0 || trimDuration > 0)
        ? `[0:v]${fpsTag}${speedTag}trim=start=${trimStart}:duration=${adjustedDuration},setpts=PTS-STARTPTS,`
        : `[0:v]${fpsTag}${speedTag}setpts=PTS-STARTPTS,`
      const cropY = videoTop
      videoChain2 = `${trimSection}${scale}=-2:${videoH}:flags=lanczos,crop=${canvasW}:${videoH}:${cropX}:${cropY}[vid]`
    } else {
      const cropY = Math.round((canvasW * 9 / 16 - videoH) / 2) + videoTop
      const fpsTag = fpsTarget ? `fps=${fpsTarget},` : ''
      const speedTag = speedFilter ? `${speedFilter},` : ''
      const trimSection = (trimStart > 0 || trimDuration > 0)
        ? `[0:v]${fpsTag}${speedTag}trim=start=${trimStart}:duration=${adjustedDuration},setpts=PTS-STARTPTS,`
        : `[0:v]${fpsTag}${speedTag}setpts=PTS-STARTPTS,`
      videoChain2 = `${trimSection}${scale}=${canvasW}:-2:flags=lanczos,crop=${canvasW}:${videoH}:0:${cropY >= 0 ? cropY : 0}[vid]`
    }
    // [1:v] thumbnail → FILL canvas (not fit within).
    // force_original_aspect_ratio=increase: scale up until canvas is covered.
    // crop: center-cut to exact canvas dimensions — no black bars.
    const bgChain2 = `[1:v]${scale}=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2[bg]`
    // Video OVER thumbnail bg: video at videoTop (below header), thumbnail shows in header zone.
    // [bg][vid]overlay=0:videoTop = bg bottom, vid top: bg shows in header/title zones, video covers video zone.
    // Z-order: bg (bottom), video (middle), headerOl (top) — thumbnail visible in header zone.
    const vzChain2 = `[bg][vid]${ov}=0:${videoTop}[vz]`
    // Header overlay: scale header image to canvas width × headerH, overlay on [vz].
    // Z-order: bg (bottom) → video (middle) → headerOl (top).
    // Header on top → thumbnail shows in header zone (where video doesn't cover).
    const hdChain2 = headerOl?.src
      ? `[2:v]${scale}=${canvasW}:${headerH}:force_original_aspect_ratio=increase,crop=${canvasW}:${headerH}:(ow-iw)/2:(oh-ih)/2[hd];[vz][hd]${ov}=0:0[fh]`
      : ''
    // Title overlay (part number) at bottom
    if (titleOl?.content) {
      const sections = [videoChain2, bgChain2, vzChain2]
      if (hdChain2) sections.push(hdChain2)
      const titleBase = hdChain2 ? 'fh' : 'vz'
      if (titleOverlayPath) {
        // PNG overlay: scale title image and overlay
        const titleInputIdx = hdChain2 ? '3' : '2'
        sections.push(`[${titleInputIdx}:v]${scale}=${canvasW}:${titleH}:force_original_aspect_ratio=increase,crop=${canvasW}:${titleH}:(ow-iw)/2:(oh-ih)/2[titleScaled]`, `[${titleBase}][titleScaled]${ov}=0:${canvasH - titleH}[td]`)
      } else {
        // Drawtext fallback: add text on top of [fh] (or [vz]).
        // Z-order: bg → video → header → text (text on TOP of header).
        // CRITICAL: drawtext outputs to [tdo] (intermediate), NOT [fh].
        // Then overlay [fh][tdo]: [fh] (header) bottom, [tdo] (header+text) top.
        const fontSize = Math.max(24, Math.floor(titleH * 0.15))
        const escapedText = titleOl.content.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
        const borderColor = toFfmpegColor(titleOl.borderColor ?? '#00B4FF')
        // Landscape: title centered in header zone. headerH is TypeScript var — substitute numeric value.
        // FFmpeg drawtext can't use TS variable names; compute Y as fixed pixel value instead.
        // Center of header zone: headerH/2 (top of canvas to middle of header)
        // Then subtract text_h/2 to center text vertically in that zone.
        const titleY = Math.floor(headerH / 2) // integer — FFmpeg can subtract text_h from this
        const drawtext = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${titleY}-text_h/2:fontfile=${FONT_FILE}`
        // [fh] (header) bottom, [tdo] (header+text) top → text on top of header
        sections.push(`[${titleBase}]${drawtext}[tdo]`)
        sections.push(`[${titleBase}][tdo]${ov}=0:0[td]`)
      }
      return sections.join('; ')
    }
    if (hdChain2) return [videoChain2, bgChain2, vzChain2, hdChain2].join('; ')
    return [videoChain2, bgChain2, vzChain2].join('; ')
  }

  // ── SHORT (vertical) layout: header + video + bottom bar ──
  // Layout: [0 .. headerH-1] = header overlay (top)
  //         [headerH .. canvasH-bottomBarH-1] = video (middle, bottom touches bar)
  //         [canvasH-bottomBarH .. canvasH-1] = bottom bar (opaque, y = canvasH-bottomBarH)
  //
  // Video shrinking: videoH = canvasH - headerH - bottomBarH.
  // BottomBarH defaults to 64px. Video bottom edge touches bar top edge — no overlap.
  //
  // Filter order (MIRRORS scripts/render-core.ps1):
  //   fps=30 → setpts=PTS-STARTPTS → trim → scale → crop
  // NO select='not(mod(n\,2))' — causes 2x frame halving when combined with fps=30.
  const needsTrim = trimStart > 0 || trimDuration > 0
  const fpsTag = fpsTarget ? `fps=${fpsTarget},` : ''
  // fps BEFORE trim+setpts: normalizes framerate first, then setpts resets timestamps to 0.
  // Speed-adjusted trim duration: when speed > 1, input timestamps are compressed,
  // so the same raw duration produces fewer output seconds.
  const speedAdjust = speedFilter
    ? (() => {
        const m = speedFilter.match(/setpts=([\d.]+)\/([\d.]+)\*PTS/)
        return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1
      })()
    : 1
  const adjustedDuration = trimDuration > 0 ? trimDuration * speedAdjust : 999999

  // Correct filter order: fps → setpts(speed) → trim → setpts(reset) → scale → crop
  // Speed BEFORE trim: compresses timestamps so trim duration refers to output seconds.
  const speedTag = speedFilter ? `${speedFilter},` : ''
  const trimSection = needsTrim
    ? `[0:v]${fpsTag}${speedTag}trim=start=${trimStart}:duration=${adjustedDuration},setpts=PTS-STARTPTS[trimmed]; `
    : `[0:v]${fpsTag}${speedTag}setpts=PTS-STARTPTS[trimmed]; `
  // Video: fill canvas width, crop to videoH tall (bottomBarH gap left at bottom).
  // For 16:9 source → 9:16 canvas (1080x1920) with 64px bottom bar:
  //   scale=-2:videoH → source 1920x1080 → 1920x1472 (scales to target height, width auto)
  //   crop=canvasW:videoH:cropX:0 → crop center columns from scaled source
  //   cropX = (scaledW - canvasW) / 2 = (1920*videoH/1080 - canvasW) / 2
  //   Result: video covers rows headerH..(canvasH-bottomBarH-1), BG shows in header + bottom bar gap
  const scaledW = Math.round(videoH * 16 / 9)
  const cropX = Math.round((scaledW - canvasW) / 2)
  const scaleChain = `${trimSection}[trimmed]${scale}=-2:${videoH}:flags=lanczos,crop=${canvasW}:${videoH}:${cropX}:0[vid]`
  const videoChain = scaleChain

  // Scale background to canvas — FILL canvas (not fit within).
  // BG shows through: header zone (top) + bottom bar gap (bottom).
  const bgChain = backgroundType === 'solid'
    ? `[1:v]null[bg]`
    : `[1:v]${scale}=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2,setsar=1[bg]`

  // Header image scale (full canvas width) — FILL header zone
  // Use 'increase' so small header images (e.g. 320x160) scale UP to fill the zone
  const hdChain = headerOl?.src ? `[2:v]${scale}=${canvasW}:${headerH}:force_original_aspect_ratio=increase,crop=${canvasW}:${headerH}:(ow-iw)/2:(oh-ih)/2[hd]` : ''

  // Bottom bar: pre-rendered opaque PNG (canvasW x bottomBarH).
  // Y = canvasH - bottomBarH (top of bottom bar zone).
  // If bottomBarOverlayPath provided, use it (input index 3).
  // If not, drawtext inline on the bg at the bottom bar zone.
  const bbOverlay = bottomBarOverlayPath ? `[3:v]null[bb]` : ''

  // Build sections
  // CORRECT z-order: bg(bottom) → video(middle) → bottom bar → header(top)
  // Layer chain:
  //   [bg][vid]overlay=0:headerH → [vz] (bg + video, bg shows in header + bottom bar gap)
  //   [vz][bb]overlay=0:bottomBarY → [vb] (bottom bar on top of video)
  //   [vb][hd]overlay=0:0 → [final] (header on top of bottom bar)
  const sections: string[] = [videoChain, bgChain]

  if (bbOverlay) {
    // Z-order: bg → video → [vz] → header → [vh] → bottom bar → [final]
    // Header (thumbnail) goes on TOP of video zone first (y=0, full header zone).
    // Then bottom bar goes on TOP of header+video zone (y=bottomBarY).
    // Bottom bar PNG is transparent at top (only bottom portion has the bar graphic).
    sections.push(`[bg][vid]${ov}=0:${headerH}[vz]`)
    if (hdChain) {
      // Header on TOP of [vz] → [vh]
      sections.push(hdChain, `[vz][hd]${ov}=0:0[vh]`)
    } else {
      sections.push(`[vz]null[vh]`)
    }
    // Bottom bar on TOP of header+video → [final]
    sections.push(bbOverlay, `[vh][bb]${ov}=0:${headerH + videoH}[final]`)
  } else if (hdChain) {
    // CORRECT: create [vz] first (bg + video), then overlay header on top.
    sections.push(`[bg][vid]${ov}=0:${headerH}[vz]`, hdChain, `[vz][hd]${ov}=0:0[final]`)
  } else if (titleOl?.content) {
    // CORRECT: create [vz] first (bg + video), then apply drawtext on top.
    sections.push(`[bg][vid]${ov}=0:${headerH}[vz]`)
    const bbY = headerH + videoH // top of bottom bar zone
    const bbCenter = bbY + Math.floor((canvasH - bbY) / 2)
    const fontSize = Math.max(24, Math.floor((canvasH - bbY) * 0.25))
    const escapedText = titleOl.content.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
    const borderColor = toFfmpegColor(titleOl.borderColor ?? '#00B4FF')
    const baseLabel = hdChain ? 'fh' : 'vz'
    const drawtext = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${bbCenter}-text_h/2:fontfile=${FONT_FILE}`
    sections.push(`[${baseLabel}]${drawtext}[final]`)
  }

  const fc = sections.join('; ')

  // ── Watermark: draw license info at bottom-right corner ────────────────────────
  // Watermark is ALWAYS the last step — applied after all other overlays.
  // Determine the correct output label (last used label in the chain).
  // Then apply watermark on top of it.
  const lastLabel = sections.length > 0
    ? (sections[sections.length - 1].match(/\[([^\]]+)\]$/m)?.[1] ?? 'final')
    : 'final'
  const wmFc = watermarkText
    ? fc + `; [${lastLabel}]drawtext=text='${watermarkText.replace(/'/g, "\\'").replace(/:/g, "\\:")}':fontsize=${Math.max(6, Math.floor(canvasH * 0.008))}:fontcolor=ffffff44:borderw=1:bordercolor=00000088:x=(w-text_w)-${Math.floor(canvasW * 0.015)}:y=(h-text_h)-${Math.floor(canvasH * 0.01)}:fontfile=${FONT_FILE}[wm_final]`
    : fc

  devLog(`[FilterComplex] ${wmFc}`)
  return wmFc
}

// ─── Optimized NVENC parameters ─────────────────────────────────────────────────
// Per-architecture NVENC tuning for RTX 5080 and other GPUs.
// Uses GPUCapabilities to get architecture-specific session limits and surface counts.

function getNvencParams(codec: 'h264' | 'hevc', isChunked: boolean, gpuTier: GPUTier = 'software', canvasW = 0, canvasH = 0, userPreset?: 'p1' | 'p2' | 'p3'): string[] {
  const isHighTier = gpuTier === 'high'
  const isMidTier = gpuTier === 'mid'

  // Fall back to CPU encoding (libx264/libx265) when NVENC is unavailable
  // (e.g. RTX 5080 driver incompatible with FFmpeg build's NVENC).
  if (gpuTier === 'software' || gpuTier === 'low') {
    // x264/x265 CPU params — ultrafast for dev laptop iteration speed.
    // CRF raised slightly vs 'fast' to compensate for ultrafast quality loss.
    const cpuPreset = 'ultrafast'
    const threads = String(Math.min(os.cpus().length, 8))
    if (codec === 'hevc') {
      return ['-preset', cpuPreset, '-crf', '26', '-c:v', 'libx265', '-threads', threads]
    } else {
      return ['-preset', cpuPreset, '-crf', '22', '-c:v', 'libx264', '-threads', threads]
    }
  }

  // GPU-aware preset selection:
  //   RTX 5080 (high): p1 for chunked (speed), p3 for single (quality)
  //   RTX 3060 (mid):  p2 for chunked, p3 for single
  //   others (low):   p3 for both
  // User preset (from editor) takes priority — only use tier default if not set.
  const preset = userPreset || (isChunked
    ? (isHighTier ? 'p1' : isMidTier ? 'p2' : 'p3')
    : 'p3')

  // CQ tuning: RTX 5080 uses balanced CQ (quality vs file size)
  //   Chunked: speed focus → slightly higher CQ (smaller files, fast encode)
  //   Single-pass: quality focus → lower CQ (better quality)
  const cq = codec === 'hevc'
    ? (isChunked ? '24' : '20')
    : (isChunked ? '20' : '18')

  // Tune: 'ull' = ultra-low-latency, fastest encode on RTX 5080
  //        'll'  = low-latency for mid-tier
  //        'hq'  = high quality for single-pass
  const tune = isChunked
    ? (isHighTier ? 'ull' : isMidTier ? 'll' : 'll')
    : 'hq'

  // Bitrate cap based on output resolution — portrait upscaling needs more bitrate.
  // Target: ~3 Mbps for 360p, ~6 Mbps for 720p, ~12 Mbps for 1080p.
  // VBR HQ mode respects both max bitrate AND CQ quality target.
  let maxBitrate = ''
  if (canvasH > 0) {
    if (canvasH <= 640) maxBitrate = '3000k'
    else if (canvasH <= 1080) maxBitrate = '6000k'
    else maxBitrate = '12000k'
  }

  const params: string[] = [
    '-preset', preset,
    '-rc', 'vbr_hq',     // vbr_hq: VBR with quality focus + better rate control
    '-cq', cq,
    '-tune', tune,
    '-bf', '0',         // No B-frames → faster encode, hardware-compatible
    '-refs', '1',       // Single reference frame → minimum latency
    '-g', '30',         // GOP=30 (1 keyframe/s) — prevents irregular GOP stuttering
  ]

  // Add bitrate cap for VBR mode — prevents oversized files
  // bufsize = 2× maxrate (FFmpeg best practice for rate control)
  if (maxBitrate) {
    const bufsizeK = String(parseInt(maxBitrate) * 2) + 'k'
    params.push('-maxrate', maxBitrate, '-bufsize', bufsizeK)
  }

  if (isChunked) {
    params.push(
      '-rc-lookahead', '0',    // Disable lookahead → zero-latency encode (ull/ll tune)
      '-spatial-aq', '1',      // Adaptive quantization for quality
      '-aq-strength', '8',
    )
    // Hardware surface pool: use architecture-defined value from system.ts
    // RTX 5080: 48 surfaces, RTX 4090: 48, RTX 4080: 48, RTX 3090: 32, RTX 3060: 16
    const surfaceCount = String(isHighTier ? 48 : 16)
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

  // Font: use Arial from Windows system fonts (fontfile param bypasses fontconfig).
  // FFmpeg gyan.dev build on Windows needs fontconfig, which is usually unavailable.
  // Arial is present on every Windows 10/11 install.
  const fs2 = Math.max(40, fontSize * 5)

  // Escape text for FFmpeg drawtext: escape single quotes and backslashes.
  // FFmpeg drawtext also needs colons escaped (we use :borderw etc. in the same string).
  const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

  // Build a single FFmpeg filter_complex string using native comma-chaining.
  // Using comma-chains (filter1,filter2,...) instead of semicolons to avoid cmd.exe
  // shell quoting issues when the command is passed through buildArgs + spawn(shell:true).
  //
  // FFmpeg 7.x SYNTAX CHANGE: removed `c=` prefix from color values.
  // FFmpeg 7.x SYNTAX CHANGE: fontfile must use DOUBLE quotes, not single quotes.
  //   Single quotes around the Windows path cause "No option name near '/Windows/...'"
  //   because FFmpeg 7.x lavfi parser doesn't treat single quotes as string delimiters.
  const filter =
    // Generate semi-transparent bg color source (FFmpeg 7.x syntax)
    `color=${borderColor}@${alpha}:s=${boxW}x${boxH}:d=1:r=1,` +
    `format=yuva420p[bg];` +
    // Solid border color source (FFmpeg 7.x syntax)
    `color=${borderColor}:s=${boxW}x${boxH}:d=1:r=1,` +
    `format=yuva420p[border];` +
    // Draw text centered in box (FFmpeg 7.x syntax, double-quoted fontfile for FFmpeg 7.x)
    `color=black:s=${boxW}x${boxH}:d=1:r=1,` +
    `drawtext=text='${escapedText}':fontsize=${fs2}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=${FONT_FILE}[texted];` +
    // Overlay border on bg
    `[bg][border]overlay=x=${boxX}:y=${boxY},format=yuva420p[bgBorder];` +
    // Overlay text on bg+border
    `[bgBorder][texted]overlay=x=${boxX}:y=${boxY},format=yuva420p[bgBorderText];` +
    // Crop final to box size, then pad to full canvas (FFmpeg 7.x syntax)
    `crop=${boxW}:${boxH}:${boxX}:${boxY},` +
    `pad=${canvasW}:${canvasH}:0:0:color=black@0.0[out]`

  return new Promise((resolve) => {
    const args = [
      '-f', 'lavfi',
      '-i', `color=black:s=${canvasW}x${canvasH}:d=1:r=1`,
      '-filter_complex', filter,
      '-map', '[out]',
      '-frames:v', '1',
      '-y', outputPath,  // buildArgs already quotes each arg — do NOT double-quote
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

// Pre-render overlays to PNG using PowerShell System.Drawing.
// FFmpeg gyan.dev 7.x does NOT support `color:alpha=N` → pre-render via FFmpeg impossible.
//
// SHORT mode: bottom bar PNG (opaque accent-colored bar with white text at bottom).
// LANDSCAPE mode: title overlay PNG (border+text, used in title zone).
export async function preRenderOverlays(
  metadata: RenderMetadata,
  outputDir: string,
  workspaceId: string,
  gpuTier: GPUTier = 'software',
): Promise<{ bottomBarOverlayPath: string | null; titleOverlayPath: string | null; error: string | null }> {
  // Bottom bar is created when bottomBarEnabled=true (regardless of title text).
  // If there's title text, it's drawn on the bar. If not, the bar is still created (solid color bar).
  const titleOl = metadata.overlays?.find(o => o.type === 'title' && o.content)
  const bottomBarEnabled = metadata.bottomBarEnabled !== false  // default true
  if (!bottomBarEnabled) return { bottomBarOverlayPath: null, titleOverlayPath: null, error: null }

  // Text on bar (empty string if no title text)
  const barText = titleOl?.content || 'PART 1'
  const escapedText = barText.replace(/"/g, '""')

  // Zone math
  const [canvasW, canvasH] = (metadata.export_resolution || '1080x1920').split('x').map(Number)
  const isShort = canvasH >= canvasW
  const bottomBarH = metadata.bottomBarH ?? Math.floor(canvasH * BOTTOM_PCT)
  const headerH = isShort ? Math.floor(canvasH * HEADER_PCT) : Math.floor((canvasH - Math.floor(canvasH * 0.50)) / 2)
  const vidHeightPct = metadata.vidHeightPct ?? 50
  const landscapeVideoH = Math.floor(canvasH * vidHeightPct / 100)
  const landscapeTitleH = Math.floor(canvasH * (100 - vidHeightPct) / 100)

  // Hex color: use editorState.bottomBarColor (for SHORT bottom bar) first,
  // fallback to titleOl.borderColor (for LANDSCAPE title) if not available.
  const hex = (metadata.bottomBarColor || titleOl?.borderColor || '#00B4FF').replace(/^#/, '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b2 = parseInt(hex.slice(4, 6), 16)
  const escapedTitleText = (titleOl?.content || '').replace(/"/g, '""')

  // ── SHORT mode: bottom bar PNG (barW × bottomBarH, blur bg + text) ──
  // Step 1: FFmpeg creates the blur background (scale blur to bar dimensions)
  // Step 2: PowerShell adds gradient overlay + white text + LockBits fix alpha
  // If blur unavailable → solid accent color as background
  const bottomBarOverlayPath = path.join(outputDir, 'bottom_bar_overlay.png')
  const bbBgPath = path.join(os.tmpdir(), 'hc_bb_bg_' + Date.now() + '.png').replace(/\\/g, '/')
  const bbFontSize = Math.max(28, Math.floor(bottomBarH * 0.25))
  const blurPath = metadata.blur_background

  const runFf = (args: string[]) => new Promise<{ code: number; stderr: string }>((resolve) => {
    const ffmpegBin = getFfmpegPath()
    const cmd = buildArgs(ffmpegBin, args)
    const proc = spawn(cmd, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let se = ''
    proc.stderr?.on('data', d => { se += d.toString() })
    proc.on('close', code => resolve({ code: code ?? 1, stderr: se }))
  })

  // UTF-8 BOM + encoding directive so GDI+ correctly renders Vietnamese diacritics
  const bbPs1Enc = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$PSDefaultParameterValues[\'*<:Encoding\']=\'utf8\''
  const bbPs1Parts = [
    'Add-Type -AssemblyName System.Drawing',
    `$w=${canvasW};$h=${bottomBarH};$bg="${bbBgPath}";$out="${bottomBarOverlayPath.replace(/\\/g, '/')}"`,
    '$bmp=New-Object System.Drawing.Bitmap($w,$h)',
    '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    '$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '$g.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAlias',
    // Load blur background if available, else solid accent color
    'if(Test-Path $bg){$orig=[System.Drawing.Image]::FromFile($bg);$g.DrawImage($orig,0,0,$w,$h);$orig.Dispose()}else{$brush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,' + r + ',' + g + ',' + b2 + '));$g.FillRectangle($brush,0,0,$w,$h);$brush.Dispose()}',
    // Gradient overlay: dark at top → transparent at bottom (top 60% of bar)
    '$gw=$w;$gh=$h;$gradTop=[Math]::Floor($gh*0.60)',
    '$brush2=New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point(0,0)),(New-Object System.Drawing.Point(0,$gradTop)),[System.Drawing.Color]::FromArgb(200,0,0,0),[System.Drawing.Color]::Transparent)',
    '$g.FillRectangle($brush2,0,0,$gw,$gradTop)',
    '$brush2.Dispose()',
    // White text centered
    '$font=New-Object System.Drawing.Font("Arial",' + bbFontSize + ',[System.Drawing.FontStyle]::Bold)',
    '$sf=New-Object System.Drawing.StringFormat',
    '$sf.Alignment=[System.Drawing.StringAlignment]::Center',
    '$sf.LineAlignment=[System.Drawing.StringAlignment]::Center',
    '$rect=New-Object System.Drawing.RectangleF(0,0,$w,$h)',
    '$g.DrawString("' + escapedText + '",$font,(New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)),$rect,$sf)',
    '$g.Dispose();$font.Dispose();$sf.Dispose()',
    // LockBits: force alpha=255 (fix anti-aliasing artifacts from FillRectangle)
    '$rect2=New-Object System.Drawing.Rectangle(0,0,$w,$h)',
    '$bd=$bmp.LockBits($rect2,[System.Drawing.Imaging.ImageLockMode]::ReadWrite,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)',
    '$bytes=[byte[]]::new($bd.Stride*$h)',
    '[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0,$bytes,0,$bytes.Length)',
    'for($i=3;$i -lt $bytes.Length;$i+=4){$bytes[$i]=255}',
    '[System.Runtime.InteropServices.Marshal]::Copy($bytes,0,$bd.Scan0,$bytes.Length)',
    '$bmp.UnlockBits($bd)',
    '$bmp.Save($out,[System.Drawing.Imaging.ImageFormat]::Png)',
    '$bmp.Dispose()',
    'Write-Host OK',
  ]
  const bbPs1 = bbPs1Enc + ';' + bbPs1Parts.join(';')

  // Step 1: FFmpeg creates background (blur scaled to bar size, or solid color)
  const ffBgPromise = (blurPath && fs.existsSync(blurPath))
    ? runFf(['-i', blurPath, '-vf', `scale=${canvasW}:${bottomBarH}:force_original_aspect_ratio=increase,crop=${canvasW}:${bottomBarH}:(ow-iw)/2:(oh-ih)/2`, '-y', bbBgPath])
    : runFf(['-f', 'lavfi', '-i', `color=c=${hex.substring(0,6)}:s=${canvasW}x${bottomBarH}:d=0.01`, '-frames:v', '1', '-y', bbBgPath])

  const bbPs1File = path.join(os.tmpdir(), 'hc_bb_' + Date.now() + '.ps1').replace(/\\/g, '/')
  // UTF-8 BOM so PowerShell/GDI+ reads Vietnamese text correctly
  fs.writeFileSync(bbPs1File, '﻿' + bbPs1, 'utf8')

  // ── LANDSCAPE mode: title overlay PNG (transparent bg, border+text) ──
  // eslint-disable-next-line no-useless-assignment
  let titleOverlayPath: string | null = null
  const titleBarH = landscapeTitleH
  const borderPx = Math.max(5, Math.floor(titleBarH * 0.02))
  const fontSize = Math.max(28, Math.floor(titleBarH * 0.28))
  titleOverlayPath = path.join(outputDir, 'title_overlay.png')
  const titlePs1Enc = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$PSDefaultParameterValues[\'*<:Encoding\']=\'utf8\''
  const titlePs1Parts = [
    'Add-Type -AssemblyName System.Drawing',
    `$w=${canvasW};$h=${titleBarH};$b=${borderPx}`,
    '$bmp=New-Object System.Drawing.Bitmap($w,$h)',
    '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    '$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '$g.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAlias',
    '$g.Clear([System.Drawing.Color]::Transparent)',
    '$pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,' + r + ',' + g + ',' + b2 + '),$b)',
    '$g.DrawRectangle($pen,$b,$b,$w-$b*2,$h-$b*2)',
    '$pen.Dispose()',
    '$font=New-Object System.Drawing.Font("Arial",' + fontSize + ',[System.Drawing.FontStyle]::Bold)',
    '$size=$g.MeasureString("' + escapedTitleText + '",$font)',
    '$tw=[int]$size.Width;$th=[int]$size.Height',
    '$tx=($w-$tw)/2;$ty=($h-$th)/2',
    '$g.DrawString("' + escapedTitleText + '",$font,(New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)),$tx,$ty)',
    '$g.Dispose();$font.Dispose()',
    '$bmp.Save("' + titleOverlayPath.replace(/\\/g, '/') + '",[System.Drawing.Imaging.ImageFormat]::Png)',
    '$bmp.Dispose()',
    'Write-Host OK',
  ]
  const titlePs1 = titlePs1Enc + ';' + titlePs1Parts.join(';')

  const titlePs1File = path.join(os.tmpdir(), 'hc_title_' + Date.now() + '.ps1').replace(/\\/g, '/')
  fs.writeFileSync(titlePs1File, '﻿' + titlePs1, 'utf8')

  // Step 1: FFmpeg generates blur background for bottom bar
  const ffResult = await ffBgPromise
  if (ffResult.code !== 0) devLog('[TextOverlay] FFmpeg bg failed: ' + ffResult.stderr.slice(0, 100))

  // Step 2: Run PS scripts (bottom bar + landscape title in parallel)
  const runPs = (f: string) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const proc = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', f], { stdio: ['pipe', 'pipe', 'pipe'] })
    let so = '', se = ''
    proc.stdout?.on('data', d => { so += d.toString() })
    proc.stderr?.on('data', d => { se += d.toString() })
    proc.on('close', code => {
      try { fs.unlinkSync(f) } catch {}
      resolve({ code: code ?? 1, stdout: so, stderr: se })
    })
    proc.on('error', e => { try { fs.unlinkSync(f) } catch {}; resolve({ code: 1, stdout: '', stderr: e.message }) })
  })

  const [bbResult, titleResult] = await Promise.all([runPs(bbPs1File), runPs(titlePs1File)])

  // Cleanup temp blur background
  try { fs.unlinkSync(bbBgPath) } catch {}

  const bbOk = bbResult.code === 0 && bbResult.stdout.trim() === 'OK' && fs.existsSync(bottomBarOverlayPath)
  const titleOk = titleResult.code === 0 && titleResult.stdout.trim() === 'OK' && fs.existsSync(titleOverlayPath)

  if (bbOk) devLog('[TextOverlay] Bottom bar: ' + bottomBarOverlayPath)
  else devLog('[TextOverlay] Bottom bar failed: ' + bbResult.stderr.slice(0, 100))

  if (titleOk) devLog('[TextOverlay] Title overlay: ' + titleOverlayPath)
  else devLog('[TextOverlay] Title overlay failed: ' + titleResult.stderr.slice(0, 100))

  return {
    bottomBarOverlayPath: bbOk ? bottomBarOverlayPath : null,
    titleOverlayPath: isShort ? null : (titleOk ? titleOverlayPath : null),
    error: null,
  }
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
    codec = 'h264',
    backgroundType = 'blur', backgroundColor = '#000000', backgroundImage,
    blur_background,
    vidHeightPct = 50,
    audioCodec = 'aac',
    audioBitrate = '192k',
  } = metadata

  const [outW, outH] = export_resolution.split('x').map(Number)
  if (!outW || !outH) {
    return { success: false, workspaceId: workspace_id, error: 'Invalid resolution' }
  }

  // Determine SHORT vs LANDSCAPE from canvas dimensions (not source aspect ratio)
  const resolvedIsShort = outH >= outW
  const outputFile = path.join(outputDir, `${workspace_id}_output.mp4`)
  const canvasW = outW
  const canvasH = outH

  // If user chose "blur" but no blur file exists, fall back to image
  const effectiveBackgroundType = (backgroundType === 'blur' && !blur_background) ? 'image' : backgroundType

  // Zone dimensions
  const bottomBarH = metadata.bottomBarH ?? Math.floor(canvasH * BOTTOM_PCT)
  const headerH = resolvedIsShort
    ? Math.floor(canvasH * HEADER_PCT)
    : Math.floor((canvasH - Math.floor(canvasH * vidHeightPct / 100)) / 2)
  const videoH = resolvedIsShort
    ? canvasH - headerH - bottomBarH
    : Math.floor(canvasH * vidHeightPct / 100)
  const videoTop = resolvedIsShort ? headerH : Math.floor((canvasH - videoH) / 2)
  const videoW = Math.floor(videoH * 16 / 9)

  const trimStart = trim.start
  const trimEnd = trim.end
  const trimDuration = trimEnd - trimStart

  // Audio speed filter: when video speed != 1.0, audio must be sped up/down too.
  // atempo: 0.5 to 2.0 range. For speed > 2.0, chain multiple atempo filters.
  // e.g. speed=2.5 → 'atempo=2.0,atempo=1.25'; speed=4.0 → 'atempo=2.0,atempo=2.0'
  const audioSpeedFilter = (() => {
    if (!video_speed || video_speed === 1.0) return null
    const s = video_speed
    if (s >= 0.5 && s <= 2.0) return `atempo=${s}`
    if (s > 2.0) {
      const factors: string[] = []
      let remaining = s
      while (remaining > 2.0) { factors.push('2.0'); remaining /= 2.0 }
      if (remaining !== 1.0) factors.push(remaining.toFixed(2))
      return 'atempo=' + factors.join(',atempo=')
    }
    if (s < 0.5) {
      // atempo minimum is 0.5. For slower speeds, use PTS stretch instead (audio desync acceptable for < 1.0)
      return null
    }
    return null
  })()
  // Speed-adjusted output duration: trim duration divided by speed multiplier.
  // e.g. 4:00 (240s) at 1.2x speed → 200s output.
  const duration = video_speed !== 1.0 ? trimDuration / video_speed : trimDuration

  // Speed filter: setpts to change playback speed
  const speedFilter = video_speed !== 1.0 ? `setpts=${1 / video_speed}*PTS` : ''

  // Overlay inputs from editor
  const headerOl = overlays.find(o => o.type === 'header' && o.src)
  const titleOl = overlays.find(o => o.type === 'title' && o.content)

  // Encoder
  const isGpuAvailable = gpuTier !== 'software'
  const nvencCodec = isGpuAvailable
    ? (codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc')
    : (codec === 'hevc' ? 'libx265' : 'libx264')
  const numThreads = Math.min(os.cpus().length, 16)

  // Pre-render overlays (bottom bar PNG for SHORT, title PNG for LANDSCAPE)
  const overlayResult = await preRenderOverlays(metadata, outputDir, workspace_id, gpuTier)
  const bottomBarOverlayPath = overlayResult.bottomBarOverlayPath ?? undefined
  const titleOverlayPath = overlayResult.titleOverlayPath ?? undefined

  // Build filter complex using the corrected SHORT/LANDSCAPE logic.
  // Pass raw trimDuration (not speed-adjusted) — buildFilterComplex applies speed
  // filter BEFORE trim, so it calculates the speed-adjusted duration internally.
  const filterComplex = buildFilterComplex({
    useCuda: getHwCaps().hasCudaFilters,
    headerOl,
    titleOl,
    canvasW,
    canvasH,
    headerH,
    titleH: 0,
    videoH,
    videoTop,
    videoW,
    speedFilter,
    backgroundType: effectiveBackgroundType,
    titleOverlayPath,
    bottomBarOverlayPath,
    isShort: resolvedIsShort,
    fpsTarget: fps_target || 30,
    trimStart,
    trimDuration: trimDuration,
    watermarkText: metadata.watermarkText,
  })

  // Determine which output label from the filter chain to use
  // If watermark is enabled, the final label is [wm_final]
  const hasWatermark = !!(metadata.watermarkText)
  let mapOutput = hasWatermark ? '[wm_final]' : '[vz]'
  if (!hasWatermark) {
    if (resolvedIsShort) {
      if (bottomBarOverlayPath || titleOl?.content) mapOutput = '[final]'
      else if (headerOl?.src) mapOutput = '[fh]'
    } else {
      if (titleOverlayPath) mapOutput = '[final]'
      else if (titleOl?.content) mapOutput = '[td]'
      else if (headerOl?.src) mapOutput = '[fh]'
    }
  }

  devLog(`[RenderLayout] canvas=${canvasW}x${canvasH} isShort=${resolvedIsShort} headerH=${headerH} videoH=${videoH} videoTop=${videoTop} bottomBarH=${bottomBarH}`)
  devLog(`[FilterComplex] ${filterComplex}`)

  // ── ENCODER CONFIG ───────────────────────────────────────────────────────
  const encParams = isGpuAvailable ? getNvencParams(codec, false, gpuTier, canvasW, canvasH, metadata.preset) : ['-preset', 'ultrafast', '-crf', '20']
  const srcExists = fs.existsSync(source_video)
  const srcSize = srcExists ? Math.round(fs.statSync(source_video).size / 1024 / 1024) : 0
  const crfVal = codec === 'hevc' ? (isGpuAvailable ? '20' : '26') : (isGpuAvailable ? '18' : '22')
  const maxrateVal = canvasH <= 640 ? '3M' : canvasH <= 1080 ? '6M' : '12M'
  const bufsizeVal = canvasH <= 640 ? '6M' : canvasH <= 1080 ? '12M' : '24M'
  devLog(`[RenderConfig] SOURCE=${source_video} (${srcSize}MB) CANVAS=${canvasW}x${canvasH}(${canvasH}p) CODEC=${nvencCodec} PRESET=${metadata.preset || (isGpuAvailable ? 'p3' : 'ultrafast')} CRF=${crfVal} MAXRATE=${maxrateVal} BUFSIZE=${bufsizeVal} HEADER=${headerOl?.src || 'THUMBNAIL_FALLBACK'} BOTTOMBAR=${bottomBarOverlayPath ? 'ENABLED' : 'DISABLED'} BGTYPE=${effectiveBackgroundType} SPEED=${video_speed || 1}x TRIM=${trimStart}s-${trimStart + duration}s(${duration}s) AUDIO=${metadata.audioCodec || 'aac'}/${metadata.audioBitrate || '192k'} OUTPUT=${outputFile}`)
  devLog(`[RenderConfig] FFMPEG=${getFfmpegPath()}`)
  devLog(`[RenderConfig] ENCPARAMS=${encParams.join(' ')}`)
  // ───────────────────────────────────────────────────────────────────────

  // Build FFmpeg args
  // Inputs: [0]=source, [1]=background, [2]=header image, [3]=overlay PNG
  const args: string[] = [
    '-threads', String(numThreads),
    '-avoid_negative_ts', 'make_zero',
    '-i', quotePath(source_video),
    // Background: solid color, image, or blur thumbnail
    ...(effectiveBackgroundType === 'solid'
      ? ['-f', 'lavfi', '-i', `color=${backgroundColor}:s=${canvasW}x${canvasH}:d=1:r=1`]
      : effectiveBackgroundType === 'image' && backgroundImage
        ? ['-loop', '1', '-i', quotePath(backgroundImage)]
        : blur_background
          ? ['-loop', '1', '-i', quotePath(blur_background)]
          : ['-f', 'lavfi', '-i', `color=black:s=${canvasW}x${canvasH}:d=1:r=1`]),
    // Header overlay (always present — thumbnail or custom image)
    ...(headerOl?.src ? ['-i', quotePath(headerOl.src)] : ['-f', 'lavfi', '-i', 'color=black:s=2x2:d=1:r=1']),
    // Bottom bar PNG (SHORT) or title overlay PNG (LANDSCAPE)
    ...((resolvedIsShort && bottomBarOverlayPath) || (!resolvedIsShort && titleOverlayPath)
      ? ['-i', quotePath((resolvedIsShort ? bottomBarOverlayPath : titleOverlayPath)!)]
      : []),
    '-filter_complex', filterComplex + (audioSpeedFilter ? `; [0:a?]${audioSpeedFilter}[audio]` : ''),
    '-map', mapOutput,
    '-map', audioSpeedFilter ? '[audio]' : '0:a?',
    '-c:v', nvencCodec,
    ...(isGpuAvailable ? getNvencParams(codec, false, gpuTier, canvasW, canvasH, metadata.preset) : ['-preset', 'ultrafast', '-crf', '20']),
    '-c:a', audioCodec,
    '-b:a', audioBitrate,
    '-t', String(duration),
    '-max_muxing_queue_size', '1024',
    '-y', quotePath(outputFile),
  ]

  const result = await runFfmpeg({
    jobId: `single:${workspace_id}`,
    args,
    outputFile,
    onProgress: (pct, elapsedMs = 0) => {
      const eta = elapsedMs > 0 && pct > 1
        ? Math.max(1, Math.round((elapsedMs / (pct / 100) - elapsedMs) / 1000))
        : undefined
      onProgress?.({
        workspaceId: workspace_id,
        percent: pct,
        currentTime: (pct / 100) * duration,
        totalTime: duration,
        fps: 0,
        speed: '',
        bitrate: '',
        eta,
        elapsedMs,
      })
    },
  })

  if (result.success) {
    devLog(`[TIMER] RENDER DONE: ${workspace_id} — ${result.outputFile} (${Math.round((result.fileSize ?? 0) / 1024 / 1024)} MB)`)
  } else {
    devLog(`[TIMER] RENDER FAILED: ${workspace_id} — ${result.error}`)
  }

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
    for (const { proc } of chunks) {
      try {
        proc.once('close', () => {})
        proc.kill()
      } catch {}
    }
    chunkedProcesses.delete(workspaceId)
  }
  const merge = mergeProcess.get(workspaceId)
  if (merge) {
    try {
      merge.once('close', () => mergeProcess.delete(workspaceId))
      merge.kill()
      setTimeout(() => mergeProcess.delete(workspaceId), 500)
    } catch {}
  }
}

export function cancelAllChunked(): void {
  for (const [id] of chunkedProcesses) cancelChunked(id)
  for (const [id] of mergeProcess) {
    const p = mergeProcess.get(id)!
    try {
      p.once('close', () => mergeProcess.delete(id))
      p.kill()
      // Safety fallback: delete after 500ms even if close event missed.
      setTimeout(() => mergeProcess.delete(id), 500)
    } catch {}
  }
}

export interface ChunkConfig {
  workers?: number
  chunkDuration?: number
  minChunkDuration?: number
  gpuTier?: 'high' | 'mid' | 'low' | 'software'
  fpsTarget?: number
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
  headerOlSrc?: string,
  titleOl?: Overlay,
  fpsTarget: number = 30,
  vidHeightPct?: number,
  bottomBarH?: number,
): string[] {
  const isGpuAvailable = gpuTier !== 'software'
  const nvencCodec = isGpuAvailable
    ? (codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc')
    : (codec === 'hevc' ? 'libx265' : 'libx264')
  // Use hardware decode when available (CUVID/NVDEC).
  // Hardware decode is now safe because we use trim filter instead of input seeking.
  // Input seeking caused timestamp corruption with ALL decoders on FFmpeg gyan.dev 7.1 → 1fps playback.
  // Trim filter + setpts=PTS-STARTPTS produces correct timestamps regardless of decoder.
  // CPU-aware threads: use all cores but cap at 16 to avoid oversubscription
  const chunkThreads = numThreads ?? Math.min(os.cpus().length, 16)

  // GPU-accelerated filters when available and GPU tier is good.
  // Must check hasCudaFilters — essentials build lists CUDA filters but NVDEC unavailable → runtime fail.
  const hasGpuFilters = isGpuAvailable && getHwCaps().hasCudaFilters
  const scale = hasGpuFilters ? 'scale_cuda' : 'scale'
  // lanczos: much better than bilinear for upscaling (720p→1080p) and sharper downscaling (CPU only)
  const sf = hasGpuFilters ? '' : ':flags=lanczos'
  const overlay = hasGpuFilters ? 'overlay_cuda' : 'overlay'

  // Pre-scaled source detection: when the source filename contains '_preScaled',
  // it was already downscaled to the export resolution by preScaleVideo().
  // This lets us skip or simplify the GPU scale filter, saving ~5-10s per render.
  const isPreScaled = /_preScaled[.\w]*$/.test(sourceVideo)

  const speedFilter = videoSpeed && videoSpeed !== 1.0
    ? 'setpts=' + (1 / videoSpeed) + '*PTS'
    : ''

  // Audio speed filter: atempo can handle 0.5-2.0 range. For speed > 2.0, chain multiple.
  const audioSpeedFilter = (() => {
    if (!videoSpeed || videoSpeed === 1.0) return null
    const s = videoSpeed
    if (s >= 0.5 && s <= 2.0) return `atempo=${s}`
    if (s > 2.0) {
      const factors: string[] = []
      let remaining = s
      while (remaining > 2.0) { factors.push('2.0'); remaining /= 2.0 }
      if (remaining !== 1.0) factors.push(remaining.toFixed(2))
      return 'atempo=' + factors.join(',atempo=')
    }
    return null
  })()

  // Build background input based on type: blur (blurBg image), solid (lavfi color), image (image file)
  let bgInput: string[]
  if (backgroundType === 'solid') {
    bgInput = ['-f', 'lavfi', '-i', `color=${backgroundColor || '#000000'}:s=${canvasW}x${canvasH}:d=1:r=1`]
  } else if (backgroundType === 'image' && backgroundImage) {
    bgInput = ['-i', quotePath(backgroundImage)]
  } else if (blurBg) {
    // Default: blur background image
    bgInput = ['-i', quotePath(blurBg)]
  } else {
    // Fallback: solid black
    bgInput = ['-f', 'lavfi', '-i', 'color=black:s=' + canvasW + 'x' + canvasH + ':d=1:r=1']
  }

  // Frame rate: fps=30 (no select filter — causes 2x halving when combined with fps=N)

  if (!isShort) {
    // Landscape: scale source to videoH, crop/pad to fit canvasW.
    // cropXNum = (videoH * 16/9 - canvasW) / 2
    //   >= 0: source wide enough → scale to canvasH, center-crop width
    //   <  0: source narrower → scale by width, center-crop height
    //
    // Pre-scaled optimization: when source is pre-scaled to export resolution, the scale
    // filter is redundant (or even counterproductive — scaling 480→960→crop 480 is wasteful).
    // When pre-scaled and cropXNum < 0 (source narrower than canvas): source is already at
    // canvas width, just format+fps+crop.
    const cropXNum = Math.round((videoH * 16 / 9 - canvasW) / 2)

    // Speed-adjusted trim duration: when speed > 1, input timestamps are compressed,
    // so the same raw duration produces fewer output seconds.
    const speedAdjust = speedFilter
      ? (() => {
          const m = speedFilter.match(/setpts=([\d.]+)\/([\d.]+)\*PTS/)
          return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1
        })()
      : 1
    const adjustedChunkDuration = trimDuration > 0 ? trimDuration * speedAdjust : 999999

    // Correct order: fps → setpts(speed) → trim → setpts(reset) → scale → crop
    // Speed BEFORE trim: compresses timestamps so trim duration refers to output seconds.
    const speedTag = speedFilter ? speedFilter.replace(',', '') + ',' : ''
    const trimPre = (trimStart > 0 || trimDuration > 0)
      ? "[0:v]fps=" + fpsTarget + "," + speedTag + "trim=start=" + trimStart + ":duration=" + adjustedChunkDuration + ",setpts=PTS-STARTPTS,"
      : "fps=" + fpsTarget + "," + speedTag + "setpts=PTS-STARTPTS,"
    let videoSection: string
    if (cropXNum >= 0) {
      // Scale source to videoH tall (preserves aspect), crop horizontally to canvasW.
      // Shift crop by videoTop so video content starts at row videoTop (below header zone).
      const cropYChunked = videoTop
      videoSection = '[0:v]' + trimPre + scale + '=-2:' + videoH + sf + ',crop=' + canvasW + ':' + videoH + ':' + cropXNum + ':' + cropYChunked + '[vid]'
    } else {
      // Source narrower than canvas: scale by width, crop excess height.
      // When pre-scaled: source is already at canvasW wide — skip scale, just format+crop.
      const cropY = Math.round((canvasW * 9 / 16 - videoH) / 2) + videoTop
      if (isPreScaled) {
        videoSection = '[0:v]' + trimPre + 'format=yuv420p,crop=' + canvasW + ':' + videoH + ':0:' + cropY + '[vid]'
      } else {
        videoSection = '[0:v]' + trimPre + scale + '=' + canvasW + ':-2' + sf + ',crop=' + canvasW + ':' + videoH + ':0:' + cropY + '[vid]'
      }
    }

    // Header overlay section: scale header image to canvas width × headerH, overlay on [vz] → [fh].
    // Z-order: bg (bottom) → video (middle) → header (top). Thumbnail shows in header zone.
    const hdChain2 = headerOlSrc
      ? '[2:v]' + scale + '=' + canvasW + ':' + headerH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + headerH + ':(ow-iw)/2:(oh-ih)/2[hd];[vz][hd]' + overlay + '=0:0[fh]'
      : ''
    const hasHeader = !!headerOlSrc

    const sections: string[] = [
      videoSection,
      '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + canvasH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[bg]',
      '[bg][vid]' + overlay + '=0:' + videoTop + '[vz]',
    ]

    // Title: PNG overlay or drawtext. Handle header overlay placement correctly.
    if (titleOl?.content && titleOverlayPath) {
      // PNG title overlay: add header overlay if exists, then title PNG overlay
      if (hdChain2) sections.push(hdChain2)
      const titleInputIdx = hasHeader ? '3' : '2'
      sections.push('[' + titleInputIdx + ':v]' + scale + '=' + canvasW + ':' + titleH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + titleH + ':(ow-iw)/2:(oh-ih)/2[titleScaled]')
      sections.push('[fh][titleScaled]' + overlay + '=0:' + (canvasH - titleH) + '[final]')
    } else if (titleOl?.content) {
      // Drawtext fallback: z-order depends on whether header exists.
      // NO header: drawtext on [vz], overlay on [bg] → [td]
      // WITH header: header on bottom, text on top. Use [tdo] intermediate to avoid [fh]→dst conflict.
      if (hasHeader) {
        // Replace the pushed hdChain2 with correct z-order:
        // bg overlay on [vid] → [vz2]; header on [vz2] → [fh]; drawtext on [fh] → [tdo]; overlay [fh][tdo] → [td]
        // Header on BOTTOM ([fh]), text on TOP ([tdo]).
        sections.pop() // remove the old hdChain2
        sections.push('[bg][vid]' + overlay + '=0:' + videoTop + '[vz2];' +
          '[2:v]' + scale + '=' + canvasW + ':' + headerH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + headerH + ':(ow-iw)/2:(oh-ih)/2[hd];' +
          '[vz2][hd]' + overlay + '=0:0[fh];' +
          '[fh]drawtext=text=\'' + titleOl.content.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\") + '\':fontsize=' + Math.max(24, Math.floor(titleH * 0.15)) + ':fontcolor=white:x=(w-text_w)/2:y=' + Math.floor(headerH / 2) + '-text_h/2:fontfile=' + FONT_FILE + '[tdo];' +
          '[fh][tdo]' + overlay + '=0:0[td]')
      } else {
        // No header: drawtext on [vz], overlay on [bg]
        sections.push('[vz]drawtext=text=\'' + titleOl.content.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\") + '\':fontsize=' + Math.max(24, Math.floor(titleH * 0.15)) + ':fontcolor=white:x=(w-text_w)/2:y=' + Math.floor(headerH / 2) + '-text_h/2:fontfile=' + FONT_FILE + '[td]')
      }
    } else if (hdChain2) {
      // No title — just add header overlay
      sections.push(hdChain2)
    }
    const filterChain = sections.join('; ')
    const mapOutput = titleOverlayPath ? '[final]' : (titleOl?.content ? '[td]' : (hasHeader ? '[fh]' : '[vz]'))

    // Background input index: [0]=video, [1]=bg, [2]=header image, [3]=title overlay PNG
    // For landscape, background is scaled to full canvas — FILL (not fit within)
    let bgScaleFilter = '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + canvasH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[bg]'
    if (backgroundType === 'solid') {
      // Solid bg: bgInput IS the full-canvas color, no extra scale needed
      bgScaleFilter = '[1:v]null[bg]'
    } else if (backgroundType === 'image' && backgroundImage) {
      // Image bg: scale to full canvas — FILL
      bgScaleFilter = '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + canvasH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[bg]'
    }
    // Replace sections[1] with bgScaleFilter
    const fixedSections = [sections[0], bgScaleFilter, ...sections.slice(2)]
    const fixedFilterChain = fixedSections.join('; ')

    return [
      '-threads', String(chunkThreads),
      '-avoid_negative_ts', 'make_zero',
      '-i', quotePath(sourceVideo),
      ...bgInput,
      ...(headerOlSrc ? ['-i', quotePath(headerOlSrc)] : ['-f', 'lavfi', '-i', 'color=black:s=2x2:d=1:r=1']),
      ...(titleOverlayPath ? ['-i', quotePath(titleOverlayPath)] : []),
      '-filter_threads', '16',
      '-filter_complex', fixedFilterChain + (audioSpeedFilter ? `; [0:a?]${audioSpeedFilter}[audio]` : ''),
      '-map', mapOutput, '-map', audioSpeedFilter ? '[audio]' : '0:a?',
      '-c:v', nvencCodec,
      ...getNvencParams(codec, true, gpuTier, canvasW, canvasH),
      '-max_muxing_queue_size', '512',
      '-c:a', audioCodec, '-b:a', audioBitrate,
      '-t', String(videoSpeed && videoSpeed !== 1 ? trimDuration / videoSpeed : trimDuration),
      '-y', quotePath(outputFile),
    ]
  }

  // Build section array for SHORT mode with correct ordering:
  // Layout: header (top) → video (middle, bottom touches bar) → bottom bar (bottom)
  // Frame rate: fps=N (no select filter — causes 2x halving when combined with fps=N)
  //
  // Speed-adjusted trim duration: when speed > 1, input timestamps are compressed,
  // so the same raw duration produces fewer output seconds.
  const speedAdjust = speedFilter
    ? (() => {
        const m = speedFilter.match(/setpts=([\d.]+)\/([\d.]+)\*PTS/)
        return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1
      })()
    : 1
  const adjustedChunkDuration = trimDuration > 0 ? trimDuration * speedAdjust : 999999

  // Correct order: fps → setpts(speed) → trim → setpts(reset) → scale → crop
  // Speed BEFORE trim: compresses timestamps so trim duration refers to output seconds.
  const speedTag = speedFilter ? speedFilter.replace(',', '') + ',' : ''
  const trimPre = (trimStart > 0 || trimDuration > 0)
    ? '[0:v]fps=' + fpsTarget + ',' + speedTag + 'trim=start=' + trimStart + ':duration=' + adjustedChunkDuration + ',setpts=PTS-STARTPTS,'
    : '[0:v]fps=' + fpsTarget + ',' + speedTag + 'setpts=PTS-STARTPTS,'
  const sections: string[] = []
  const hasHeader = !!headerOlSrc
  const hasBottomBar = !!titleOverlayPath || !!titleOl?.content
  const bbH = bottomBarH ?? 64
  let finalLabel = '[vz]'

  // Section 1: video — trim → fps → scale → crop to videoH tall
  // videoH = canvasH - headerH - bbH (bottomBarH gap left at bottom)
  if (isPreScaled) {
    const sc = trimPre + 'format=yuv420p,crop=in_w:' + videoH + ':0:(in_h/2-' + videoH + '/2)[vid]'
    sections.push(sc)
  } else {
    // scale=-2:videoH → source 1920x1080 → 1920x1472; crop center canvasW columns
    // lanczos: better quality than bilinear for upscaling (720p→1080p) and downscaling
    sections.push(trimPre + scale + '=-2:' + videoH + ':flags=lanczos,crop=' + canvasW + ':' + videoH + ':(iw-' + canvasW + ')/2:0[vid]')
  }

  // Section 2: background — FILL canvas.
  const bgFilter = backgroundType === 'solid'
    ? '[1:v]null[bg]'
    : '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + canvasH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[bg]'
  sections.push(bgFilter)

  // Section 3: video over bg at y=headerH → [vz].
  // BG shows through header zone and bottom bar gap.
  sections.push('[bg][vid]' + overlay + '=0:' + headerH + '[vz]')

  // CORRECT z-order: bg → video → bottom bar → header (header on top)
  // Layer chain:
  //   [vz][bb]overlay=bottomBarY → [vb] (bottom bar on top of video)
  //   [vb][hd]overlay=0:0 → [final] (header on top of bottom bar)
  const bottomBarY = headerH + videoH  // = canvasH - bottomBarH

  if (hasBottomBar) {
    // Bottom bar on video FIRST (below header in z-order)
    if (titleOverlayPath) {
      sections.push('[3:v]null[bb]')
      sections.push('[vz][bb]' + overlay + '=0:' + bottomBarY + '[vb]')
    } else if (titleOl?.content) {
      // Drawtext bottom bar: text drawn at center of bottom bar zone.
      const fontSize = Math.max(24, Math.floor(bbH * 0.45))
      const textCenterY = bottomBarY + Math.floor(bbH / 2)
      const escapedText = (titleOl.content || '').replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
      const borderColor = toFfmpegColor(titleOl.borderColor ?? '#00B4FF')
      sections.push('[vz]drawtext=text=\'' + escapedText + '\':fontsize=' + fontSize + ':fontcolor=white:x=(w-text_w)/2:y=' + textCenterY + '-text_h/2:fontfile=' + FONT_FILE + '[vb]')
    }

    // Header on TOP of bottom bar
    if (hasHeader) {
      sections.push('[2:v]' + scale + '=' + canvasW + ':' + headerH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + headerH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[hd]')
      sections.push('[vb][hd]' + overlay + '=0:0[final]')
    } else {
      sections.push('[vb]null[final]')
    }
    finalLabel = '[final]'
  } else if (hasHeader) {
    // No bottom bar — header directly on video
    sections.push('[2:v]' + scale + '=' + canvasW + ':' + headerH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + headerH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[hd]')
    sections.push('[vz][hd]' + overlay + '=0:0[final]')
    finalLabel = '[final]'
  }

  const filterChain = sections.join('; ')

  // Input mapping: [0]=video, [1]=bg, [2]=header (if SHORT), [3]=bottomBarPNG (if SHORT+bottomBar)
  // For SHORT mode: input [2] = header, input [3] = bottom bar (if exists)
  // For SHORT without header: input [2] = placeholder (not used)
  return [
    '-threads', String(chunkThreads),
    '-avoid_negative_ts', 'make_zero',
    '-i', quotePath(sourceVideo),
    ...bgInput,
    ...(isShort
      ? (headerOlSrc ? ['-i', quotePath(headerOlSrc)] : ['-f', 'lavfi', '-i', 'color=black:s=2x2:d=1:r=1'])
      : []),
    ...(isShort && hasBottomBar ? ['-i', quotePath(titleOverlayPath!)] : []),
    '-filter_threads', '16',
    '-filter_complex', filterChain + (audioSpeedFilter ? `; [0:a?]${audioSpeedFilter}[audio]` : ''),
    '-map', finalLabel, '-map', audioSpeedFilter ? '[audio]' : '0:a?',
    '-c:v', nvencCodec,
    ...getNvencParams(codec, true, gpuTier),
    '-max_muxing_queue_size', '512',
    '-c:a', audioCodec, '-b:a', audioBitrate,
    '-t', String(videoSpeed && videoSpeed !== 1 ? trimDuration / videoSpeed : trimDuration),
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
  headerOlSrc?: string,
  titleOl?: Overlay,
  fpsTarget?: number,
  vidHeightPct?: number,
  bottomBarH?: number,
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
    headerOlSrc,
    titleOl,
    fpsTarget ?? 30,
    vidHeightPct,
    bottomBarH,
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
    workspace_id, source_video, blur_background, trim, export_resolution, codec = 'h264',
    isShort = true, overlays, video_speed,
    audioCodec = 'aac', audioBitrate = '192k',
    fps_target = 30,
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
  // Override isShort from CANVAS dimensions, not from source video aspect ratio.
  const resolvedIsShort2 = canvasH >= canvasW
  // SHORT: header=25%, video=50%, bottomBarH=25% (BOTTOM_PCT)
  const bottomBarH = metadata.bottomBarH ?? Math.floor(canvasH * BOTTOM_PCT)
  const headerH = resolvedIsShort2
    ? Math.floor(canvasH * HEADER_PCT)
    : Math.floor((canvasH - Math.floor(canvasH * vidHeightPct / 100)) / 2)
  const titleH = resolvedIsShort2 ? 0 : Math.floor(canvasH * (100 - vidHeightPct) / 100)
  const videoH = resolvedIsShort2
    ? canvasH - headerH - bottomBarH
    : Math.floor(canvasH * vidHeightPct / 100)
  const videoTop = resolvedIsShort2 ? headerH : Math.floor((canvasH - videoH) / 2)
  const videoW = Math.floor(videoH * 16 / 9)

  const trimStart = trim.start
  const trimEnd = trim.end
  const rawTrimDuration = trimEnd - trimStart
  // Speed-adjusted output duration: trim duration divided by speed multiplier.
  const totalDuration = video_speed !== 1.0 ? rawTrimDuration / video_speed : rawTrimDuration

  // Short duration → single-pass (no chunking overhead needed)
  if (totalDuration <= 30) {
    const simple = await renderVideo(metadata, outputDir, onProgress as any, gpuTier)
    return { ...simple, chunks: [], totalEncodeMs: 0 }
  }

  const ffmpeg = getFfmpegPath()
  const workspaceDir = path.join(outputDir, 'chunks', workspace_id)
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true })

  onProgress?.({ workspaceId: workspace_id, percent: 0, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'split' })

  let splitPoints = [trimStart]
  // Chunk splitting is based on RAW duration (input video), not speed-adjusted output duration.
  // Each chunk's raw duration × speed = output duration.
  const targetChunks = Math.ceil(rawTrimDuration / chunkDuration)
  // Smart keyframe detection: only for longer videos
  const keyframes = rawTrimDuration > 120
    ? await findKeyframeSmart(source_video, rawTrimDuration, targetChunks)
    : []

  if (keyframes.length > 2) {
    const idealInterval = rawTrimDuration / targetChunks
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
      splitPoints.push(trimStart + i * (rawTrimDuration / targetChunks))
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
  const overlayResult = await preRenderOverlays(metadata, outputDir, workspace_id, gpuTier)
  const bottomBarOverlayPath = overlayResult.bottomBarOverlayPath ?? undefined
  const titleOverlayPath = overlayResult.titleOverlayPath ?? undefined
  const headerOl = overlays?.find(o => o.type === 'header' && o.src)
  const titleOl = overlays?.find(o => o.type === 'title' && o.content)

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
        resolvedIsShort2 ? bottomBarOverlayPath : (titleOverlayPath ?? undefined),
        (pct) => {
          const chunkOverall = ((idx + pct / 100) / numChunks) * 90 + 5
          onProgress?.({ workspaceId: workspace_id, percent: chunkOverall, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'encode', chunkIndex: idx })
        },
        resolvedIsShort2,
        video_speed,
        gpuTier,
        metadata.backgroundType,
        metadata.backgroundColor,
        metadata.backgroundImage,
        audioCodec,
        audioBitrate,
        headerOl?.src,
        titleOl,
        fps_target,
        vidHeightPct,
        bottomBarH,
      )

      return { idx, startSec, endSec, chunkFile, result }
    }))

    for (const { idx, startSec, endSec, chunkFile, result } of batchResults) {
      if (result.success) {
        chunks.push({ index: idx, start: startSec, end: endSec, outputPath: chunkFile, fileSize: result.fileSize, encodeMs: result.encodeMs, decodeFps: result.decodeFps, encodeFps: result.encodeFps })
        devLog(`[Profile] chunk ${idx}: ${result.encodeMs}ms, decode~${result.decodeFps} fps, encode~${result.encodeFps} fps`)
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
  devLog(`[Profile] Summary: avgDecode=${avgDecodeFps.toFixed(1)} fps, avgEncode=${avgEncodeFps.toFixed(1)} fps, total=${totalEncodeMs}ms`)

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