import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

// Shared FFmpeg/FFprobe path resolution.
// On Windows with Bash/Git environments, process.cwd() returns Unix-style paths
// (/d/...). Node's fs.existsSync accepts both forward-slash and backslash paths,
// but mixed/backslash paths may fail. We always normalize to forward slashes.
function resolveBinary(name: string): string {
  const candidates = [
    `C:/ffmpeg/ffmpeg-8.1-essentials_build/bin/${name}.exe`,
    `C:/ffmpeg/bin/${name}.exe`,
    `C:/Program Files/ffmpeg/bin/${name}.exe`,
    `C:/Program Files (x86)/ffmpeg/bin/${name}.exe`,
    path.join(process.cwd(), 'node_modules', '.bin', name),
    'C:/Users/MSI/AppData/Local/CapCut/Apps/8.1.1.3417/' + name + '.exe',
    'C:/Users/MSI/AppData/Local/CapCut/Apps/8.0.1.3366/' + name + '.exe',
  ]
  const exists = (fp: string) => { try { return fs.existsSync(fp) } catch { return false } }
  for (const fp of candidates) {
    if (exists(fp)) return fp
  }
  return name
}

export function getFfprobePath(): string {
  return resolveBinary('ffprobe')
}

export function getFfmpegPath(): string {
  return resolveBinary('ffmpeg')
}

// Validate FFmpeg binary: verify it can be executed and has NVENC encoders.
// Returns a resolved promise on success, rejected on failure.
// Call once at startup or before first render.
export async function validateFfmpeg(ffmpegPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Quick version check
      const version = execSync(`"${ffmpegPath}" -version`, { encoding: 'utf-8', timeout: 5000 })
        .split('\n')[0]
      console.log(`[FFmpeg] Version: ${version}`)

      // Check encoder availability (non-blocking — just verify ffmpeg responds)
      const encoders = execSync(`"${ffmpegPath}" -hide_banner -encoders 2>&1`, { encoding: 'utf-8', timeout: 8000 })
      const hasNvenc = encoders.includes('hevc_nvenc') || encoders.includes('h264_nvenc')
      const hasCuvid = encoders.includes('hevc_cuvid') || encoders.includes('h264_cuvid')
      console.log(`[FFmpeg] NVENC: ${hasNvenc ? '✓' : '✗'} | NVDEC (CUVID): ${hasCuvid ? '✓' : '✗'}`)

      if (!hasNvenc) {
        console.warn('[FFmpeg] Warning: NVENC not found — will use software encoding')
      }
      if (!hasCuvid) {
        console.warn('[FFmpeg] Warning: NVDEC (CUVID) not found — will use software decoding')
      }

      resolve()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[FFmpeg] Validation FAILED: ${msg}`)
      reject(new Error(`FFmpeg validation failed: ${msg}`))
    }
  })
}
