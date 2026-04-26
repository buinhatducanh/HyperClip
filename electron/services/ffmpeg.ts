import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { getFfmpegPath, getFfprobePath } from './ffmpeg-paths.js'
import { runFfmpeg, cancelFfmpeg } from './worker-pool.js'

export { getFfmpegPath, getFfprobePath }

export interface RenderMetadata {
  workspace_id: string
  source_video: string
  blur_background: string
  export_resolution: string
  video_speed: number
  fps_target: number
  overlays: Overlay[]
  trim: { start: number; end: number }
  codec?: 'h264' | 'hevc'
  preset?: 'p1' | 'p2' | 'p3'
  tune?: 'hq' | 'll' | 'film'
}

export interface Overlay {
  type: 'header' | 'title'
  src?: string
  content?: string
  shape?: string
  borderColor?: string
  bgColor?: string
  fontSize?: number
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

// Get ffmpeg/ffprobe path
// (imported from ffmpeg-paths.ts)

// Generate blur background from a video frame
export async function generateBlurBackground(
  videoPath: string,
  outputPath: string,
  width = 1080,
  height = 1920
): Promise<{ success: boolean; error?: string }> {
  const ffmpeg = getFfmpegPath()

  // Step 1: Extract 1 frame from center of video
  // Step 2: Blur it heavily
  // Step 3: Scale to 9:16

  return new Promise((resolve) => {
    const args = [
      '-ss', '00:05:00', // seek to 5 min in (usually the action starts here)
      '-i', `"${videoPath}"`,
      '-vframes', '1',
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20,format=yuv420p`,
      '-y',
      `"${outputPath}"`,
    ]

    const proc = spawn(ffmpeg, args, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(outputPath)) {
        // Try fallback: first frame
        const fallbackArgs = [
          '-i', `"${videoPath}"`,
          '-vframes', '1',
          '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20,format=yuv420p`,
          '-y',
          `"${outputPath}"`,
        ]
        const proc2 = spawn(ffmpeg, fallbackArgs, {
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        proc2.on('close', (c2) => {
          if (c2 !== 0) {
            resolve({ success: false, error: stderr || `ffmpeg failed: ${c2}` })
          } else {
            resolve({ success: true })
          }
        })
      } else {
        resolve({ success: true })
      }
    })

    // 30s timeout
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill()
        resolve({ success: false, error: 'Blur generation timeout' })
      }
    }, 30000)
  })
}

export async function renderVideo(
  metadata: RenderMetadata,
  outputDir: string,
  onProgress?: (progress: RenderProgress) => void
): Promise<RenderResult> {
  const {
    workspace_id, source_video, blur_background, export_resolution,
    video_speed, fps_target, overlays, trim,
    codec = 'hevc', preset = 'p1', tune = 'hq',
  } = metadata

  // Parse resolution
  const [outW, outH] = export_resolution.split('x').map(Number)
  if (!outW || !outH) {
    return { success: false, workspaceId: workspace_id, error: 'Invalid resolution' }
  }

  // Output file
  const ext = codec === 'hevc' ? 'mp4' : 'mp4'
  const outputFile = path.join(outputDir, `${workspace_id}_output.${ext}`)

  // Output canvas: 1080x1920
  const canvasW = 1080
  const canvasH = 1920
  const headerH = Math.floor(canvasH * 0.20) // 384px — top 20%
  const titleH = Math.floor(canvasH * 0.20) // 384px — bottom 20%
  const videoH = canvasH - headerH - titleH // 1152px — middle 60%
  const videoTop = headerH
  const videoW = Math.floor(videoH * 16 / 9) // 2048px → scale to 1080

  const trimStart = trim.start
  const trimEnd = trim.end
  const duration = trimEnd - trimStart

  // Speed filter
  const speedFilter = video_speed !== 1.0 ? `,setpts=${1 / video_speed}*PTS` : ''

  // Base filter chain for the video within the video zone
  const baseFilters = [
    `scale=${videoW}:${videoH}:force_original_aspect_ratio=decrease`,
  ]
  if (speedFilter) baseFilters.push(speedFilter)

  const baseChain = baseFilters.join(',')

  // Overlay inputs
  const headerOl = overlays.find(o => o.type === 'header' && o.src)
  const titleOl = overlays.find(o => o.type === 'title' && o.content)

  // NVENC codec
  const nvencCodec = codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc'
  // CQ: H.264 uses 18-28 (lower=better), HEVC uses 22-32
  const cq = codec === 'hevc' ? 28 : 23

  // Build ffmpeg args
  const args: string[] = [
    '-ss', String(trimStart),
    '-t', String(duration),
    '-hwaccel', 'cuda',
    '-hwaccel_device', '0',
    '-i', `"${source_video}"`,
    '-i', `"${blur_background}"`,
    ...(headerOl?.src ? ['-i', `"${headerOl.src}"`] : []),
  ]

  // ── Build filter complex ──────────────────────────────────────────────────
  // 3-zone layout: header(top 20%) | video(middle 60%) | title(bottom 20%)
  //
  // [0:v] = source video
  // [1:v] = blur background (used as base canvas)
  // [2:v] = header image (if present)
  //
  // Strategy:
  // 1. Scale blur bg → canvas size 1080x1920  → [bg]
  // 2. Scale video → fit middle zone, pad to canvas → [vid]
  // 3. Header image → full width, height = headerH → [hd] (if present)
  // 4. Composites: [bg]+[vid] → [vz]; [vz]+[hd] → [final]; drawtext → [out]

  // Title overlay
  let titlePart = ''
  if (titleOl?.content) {
    const txt = titleOl.content.replace(/'/g, "\\'")
    const fs = Math.max(24, (titleOl.fontSize ?? 13) * 4)
    const bc = titleOl.borderColor ?? '#00B4FF'
    const bgc = titleOl.bgColor ?? 'rgba(0,180,255,0.12)'
    const alphaMatch = bgc.match(/[\d.]+(?=\)$)/)
    const alpha = alphaMatch ? parseFloat(alphaMatch[0]) : 0.12
    const boxW = Math.floor(canvasW * 0.66)
    const boxH = Math.floor(titleH * 0.55)
    const boxY = canvasH - Math.floor(titleH * 0.72)
    const boxX = Math.floor((canvasW - boxW) / 2)
    titlePart =
      `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=${bc}@${alpha}:thickness=-2,` +
      `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=${bc}@1:thickness=3,` +
      `drawtext=text='${txt}':fontsize=${fs}:fontcolor=white:borderw=2:bordercolor=${bc}:x=(w-text_w)/2:y=${boxY}+(boxH-text_h)/2`
  }

  // Compose the 3 cases
  const vidPart = `[0:v]${baseChain},scale=${videoW}:${videoH},pad=${canvasW}:${canvasH}:(ow-iw)/2:${videoTop}[vid]`
  const bgPart = `[1:v]scale=${canvasW}:${canvasH}[bg]`
  const hdPart = headerOl?.src ? `[2:v]scale=${canvasW}:${headerH}[hd]` : ''

  let filterComplex: string
  let mapOutput: string

  if (titleOl?.content) {
    // Case 3: Title on top
    filterComplex =
      `${vidPart};${bgPart};${hdPart}` +
      `;[bg][vid]overlay=0:${videoTop}[vz];` +
      (headerOl?.src ? `[vz][hd]overlay=0:0[fh];[fh]` : `[vz]`) +
      `${titlePart}[td]`
    mapOutput = '[td]'
  } else if (headerOl?.src) {
    // Case 2: Header on top
    filterComplex =
      `${vidPart};${bgPart};${hdPart}` +
      `;[bg][vid]overlay=0:${videoTop};[vz][hd]overlay=0:0[final]`
    mapOutput = '[final]'
  } else {
    // Case 1: Video zone only
    filterComplex =
      `${vidPart};${bgPart}` +
      `;[bg][vid]overlay=0:${videoTop}[vz]`
    mapOutput = '[vz]'
  }

  args.push('-filter_complex', filterComplex)
  args.push('-map', mapOutput)

  args.push(
    '-c:v', nvencCodec,
    '-preset', preset,               // p1=fastest, p2=fast, p3=balanced
    '-rc', 'vbr',
    '-cq', String(cq),
    '-tune', tune,                   // hq / ll / ull / film / animation
    '-c:a', 'aac',
    '-b:a', '192k',
    '-r', String(fps_target),
    // NVENC quality enhancements
    '-rc-lookahead', '32',
    '-spatial-aq', '1',
    '-max_muxing_queue_size', '1024',
    '-y',
    `"${outputFile}"`,
  )

  const result = await runFfmpeg({
    jobId: `single:${workspace_id}`,
    args,
    outputFile,
    onProgress: (pct) => {
      onProgress?.({
        workspaceId: workspace_id,
        percent: pct,
        currentTime: (pct / 100) * duration,
        totalTime: duration,
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

// Track active renders for cancellation
const chunkedProcesses = new Map<string, Array<{ proc: ReturnType<typeof spawn>; outputFile: string }>>()
const mergeProcess = new Map<string, ReturnType<typeof spawn>>()

export function cancelChunked(workspaceId: string): void {
  // Kill all chunk processes
  const chunks = chunkedProcesses.get(workspaceId)
  if (chunks) {
    for (const { proc } of chunks) {
      try { proc.kill() } catch {}
    }
    chunkedProcesses.delete(workspaceId)
  }
  // Kill merge process if running
  const merge = mergeProcess.get(workspaceId)
  if (merge) {
    try { merge.kill() } catch {}
    mergeProcess.delete(workspaceId)
  }
}

export function cancelAllChunked(): void {
  for (const [id] of chunkedProcesses) cancelChunked(id)
  for (const [id] of mergeProcess) {
    const p = mergeProcess.get(id)!
    try { p.kill() } catch {}
    mergeProcess.delete(id)
  }
}

// ─── Chunk-based Parallel Encoding (Tier 3.1) ─────────────────────────────────

export interface ChunkConfig {
  /** Number of parallel encode workers. Default: 4. Max: 8. */
  workers?: number
  /** Max chunk duration in seconds. Default: 30s. Smaller = more parallelism, more overhead. */
  chunkDuration?: number
  /** Minimum chunk duration in seconds. Default: 5s. Prevents tiny chunks. */
  minChunkDuration?: number
}

export interface ChunkedResult extends RenderResult {
  chunks: Array<{
    index: number
    start: number
    end: number
    outputPath: string
    fileSize: number
    encodeMs: number
  }>
  totalEncodeMs: number
}

// Probe video for keyframe positions to determine safe split points
async function findKeyframePositions(videoPath: string, duration: number): Promise<number[]> {
  const ffprobe = getFfprobePath()
  const keyframes: number[] = []

  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-select_streams', 'v:0',
      '-show_entries', 'packet=pts_time,flags',
      '-of', 'csv=p=0',
      `"${videoPath}"`,
    ]

    const proc = spawn(ffprobe, args, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''

    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.on('close', () => {
      for (const line of stdout.split('\n')) {
        const match = line.match(/^([\d.]+),K/)
        if (match) {
          const ts = parseFloat(match[1])
          if (ts > 0 && ts < duration) keyframes.push(ts)
        }
      }
      resolve(keyframes)
    })

    setTimeout(() => { try { proc.kill() } catch {} resolve([]) }, 10000)
  })
}

// Build the standard encode args for a single chunk (re-uses Tier 1+2 flags)
function buildChunkArgs(
  sourceVideo: string,
  blurBg: string,
  trimStart: number,
  trimDuration: number,
  outputFile: string,
  codec: 'h264' | 'hevc',
  preset: 'p1' | 'p2' | 'p3',
): string[] {
  const nvencCodec = codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc'
  const cq = codec === 'hevc' ? 28 : 23

  // 3-zone layout: header(20%) | video(60%) | title(20%)
  const canvasW = 1080
  const canvasH = 1920
  const headerH = Math.floor(canvasH * 0.20) // 384
  const titleH = Math.floor(canvasH * 0.20) // 384
  const videoH = canvasH - headerH - titleH // 1152
  const videoTop = headerH
  const videoW = Math.floor(videoH * 16 / 9) // 2048 → scale to 1080

  const filterChain =
    `scale=${videoW}:${videoH},pad=${canvasW}:${canvasH}:(ow-iw)/2:${videoTop}`

  return [
    '-ss', String(trimStart),
    '-t', String(trimDuration),
    '-hwaccel', 'cuda', '-hwaccel_device', '0',
    '-i', `"${sourceVideo}"`,
    '-i', `"${blurBg}"`,
    '-filter_complex', `${filterChain}[vid];[1:v]scale=${canvasW}:${canvasH}[bg];[bg][vid]overlay=0:${videoTop}[v]`,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', nvencCodec,
    '-preset', preset,
    '-rc', 'vbr', '-cq', String(cq),
    '-tune', 'hq',
    '-rc-lookahead', '16',
    '-spatial-aq', '1',
    '-max_muxing_queue_size', '512',
    '-c:a', 'aac', '-b:a', '192k',
    '-r', '30',
    '-y', `"${outputFile}"`,
  ]
}

// Encode a single chunk, returns timing info
async function encodeChunk(
  workspaceId: string,
  sourceVideo: string,
  blurBg: string,
  startSec: number,
  durationSec: number,
  outputFile: string,
  codec: 'h264' | 'hevc',
  preset: 'p1' | 'p2' | 'p3',
  onProgress?: (percent: number) => void,
): Promise<{ success: boolean; fileSize: number; encodeMs: number; error?: string }> {
  const ffmpeg = getFfmpegPath()
  const args = buildChunkArgs(sourceVideo, blurBg, startSec, durationSec, outputFile, codec, preset)

  return new Promise((resolve) => {
    const t0 = Date.now()
    const proc = spawn(ffmpeg, args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })

    // Track for cancellation
    if (!chunkedProcesses.has(workspaceId)) chunkedProcesses.set(workspaceId, [])
    chunkedProcesses.get(workspaceId)!.push({ proc, outputFile })

    let lastPct = 0
    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      const m = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/)
      if (m && onProgress) {
        const h = parseInt(m[1]), min = parseInt(m[2]), s = parseFloat(m[3])
        const cur = h * 3600 + min * 60 + s
        const pct = Math.min(100, (cur / durationSec) * 100)
        if (Math.abs(pct - lastPct) >= 1) { lastPct = pct; onProgress(pct) }
      }
    })

    proc.on('close', () => {
      // Remove this chunk from tracking
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
        resolve({ success: true, fileSize: size, encodeMs: ms })
      }
    })

    setTimeout(() => {
      if (!proc.killed) { proc.kill() }
      resolve({ success: false, fileSize: 0, encodeMs: Date.now() - t0, error: 'Timeout' })
    }, 2 * 60 * 60 * 1000)
  })
}

// Merge encoded chunks using ffmpeg concat demuxer
async function mergeChunks(
  workspaceId: string,
  chunkFiles: string[],
  outputFile: string,
  onProgress?: (pct: number) => void,
): Promise<{ success: boolean; fileSize: number; error?: string }> {
  if (chunkFiles.length === 1) {
    // Single chunk — just rename
    fs.copyFileSync(chunkFiles[0], outputFile)
    let size = 0
    try { size = fs.statSync(outputFile).size } catch {}
    return { success: true, fileSize: size }
  }

  // Write concat list
  const listFile = outputFile + '.concat.txt'
  const listContent = chunkFiles.map(f => `file '${f}'`).join('\n')
  fs.writeFileSync(listFile, listContent, 'utf-8')

  const ffmpeg = getFfmpegPath()
  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-i', `"${listFile}"`,
    '-c', 'copy',
    '-y', `"${outputFile}"`,
  ]

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
    }, 60000)
  })
}

export async function renderChunked(
  metadata: RenderMetadata,
  outputDir: string,
  config: ChunkConfig = {},
  onProgress?: (progress: RenderProgress & { phase: 'split' | 'encode' | 'merge'; chunkIndex?: number }) => void,
): Promise<ChunkedResult> {
  const { workspace_id, source_video, blur_background, trim, codec = 'hevc', preset = 'p1' } = metadata
  const { workers = 4, chunkDuration = 30, minChunkDuration = 5 } = config

  const trimStart = trim.start
  const trimEnd = trim.end
  const totalDuration = trimEnd - trimStart

  // Skip chunking for short videos — not worth the overhead
  if (totalDuration <= 60) {
    const simple = await renderVideo(metadata, outputDir, onProgress as any)
    return { ...simple, chunks: [], totalEncodeMs: 0 }
  }

  const ffmpeg = getFfmpegPath()
  const workspaceDir = path.join(outputDir, 'chunks', workspace_id)
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true })

  // Phase 1: Find keyframe positions for safe split points
  onProgress?.({ workspaceId: workspace_id, percent: 0, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'split' })

  let splitPoints = [trimStart]
  const keyframes = await findKeyframePositions(source_video, totalDuration)

  if (keyframes.length > 2) {
    // Use keyframes as split points — ensures clean cuts
    const targetChunks = Math.ceil(totalDuration / chunkDuration)
    const idealInterval = totalDuration / targetChunks

    let nextSplit = trimStart + idealInterval
    for (const kf of keyframes) {
      if (kf >= nextSplit - 0.5 && kf <= nextSplit + 2) {
        // This keyframe is near our ideal split point — use it
        if (kf - splitPoints[splitPoints.length - 1] >= minChunkDuration) {
          splitPoints.push(kf)
          nextSplit += idealInterval
        }
      }
    }
  } else {
    // Fallback: time-based split at keyframe-adjacent positions
    const targetChunks = Math.ceil(totalDuration / chunkDuration)
    for (let i = 1; i < targetChunks; i++) {
      const idealTime = trimStart + i * (totalDuration / targetChunks)
      splitPoints.push(idealTime)
    }
  }
  splitPoints.push(trimEnd)

  // Deduplicate and ensure min duration
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

  // Phase 2: Encode chunks in parallel batches
  onProgress?.({ workspaceId: workspace_id, percent: 5, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'encode', chunkIndex: 0 })

  for (let batchStart = 0; batchStart < numChunks; batchStart += workers) {
    const batchEnd = Math.min(batchStart + workers, numChunks)
    const batch = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)

    const batchResults = await Promise.all(batch.map(async (idx) => {
      const startSec = finalSplits[idx]
      const endSec = finalSplits[idx + 1]
      const durationSec = endSec - startSec
      const chunkFile = path.join(workspaceDir, `chunk_${String(idx).padStart(3, '0')}.mp4`)

      const result = await encodeChunk(
        workspace_id, source_video, blur_background, startSec, durationSec, chunkFile,
        codec as 'h264' | 'hevc', preset as 'p1' | 'p2' | 'p3',
        (pct) => {
          const chunkOverall = ((idx + pct / 100) / numChunks) * 90 + 5
          onProgress?.({ workspaceId: workspace_id, percent: chunkOverall, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'encode', chunkIndex: idx })
        },
      )

      return { idx, startSec, endSec, chunkFile, result }
    }))

    for (const { idx, startSec, endSec, chunkFile, result } of batchResults) {
      if (result.success) {
        chunks.push({ index: idx, start: startSec, end: endSec, outputPath: chunkFile, fileSize: result.fileSize, encodeMs: result.encodeMs })
      } else {
        // Chunk failed — fall back to non-chunked render for this workspace
        console.warn(`[Chunk] Chunk ${idx} failed (${result.error}), falling back to standard render`)
        const fallback = await renderVideo(metadata, outputDir, onProgress as any)
        return { ...fallback, chunks: [], totalEncodeMs: 0 }
      }
    }
  }

  // Phase 3: Merge chunks
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

  // Cleanup chunks (optional — keep for debugging)
  // chunks.forEach(c => { try { fs.unlinkSync(c.outputPath) } catch {} })

  if (!mergeResult.success) {
    return {
      success: false,
      workspaceId: workspace_id,
      chunks,
      totalEncodeMs,
      error: mergeResult.error,
    }
  }

  return {
    success: true,
    workspaceId: workspace_id,
    outputPath: outputFile,
    fileSize: mergeResult.fileSize,
    duration: totalDuration,
    chunks,
    totalEncodeMs,
  }
}