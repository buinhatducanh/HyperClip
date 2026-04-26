import path from 'path'
import fs from 'fs'

export function getFfprobePath(): string {
  const candidates = [
    'C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\ffprobe.exe',
    'C:\\ffmpeg\\bin\\ffprobe.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
    path.join(process.cwd(), 'node_modules', '.bin', 'ffprobe'),
    'C:\\Users\\MSI\\AppData\\Local\\CapCut\\Apps\\8.1.1.3417\\ffprobe.exe',
  ]
  for (const fp of candidates) {
    if (fs.existsSync(fp)) return fp
  }
  // Search PATH
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const fp = path.join(dir, 'ffprobe.exe')
    if (fs.existsSync(fp)) return fp
    const fpNoExt = path.join(dir, 'ffprobe')
    if (fs.existsSync(fpNoExt)) return fpNoExt
  }
  return 'ffprobe'
}

export function getFfmpegPath(): string {
  const candidates = [
    'C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.cwd(), 'node_modules', '.bin', 'ffmpeg'),
    'C:\\Users\\MSI\\AppData\\Local\\CapCut\\Apps\\8.1.1.3417\\ffmpeg.exe',
  ]
  for (const fp of candidates) {
    if (fs.existsSync(fp)) return fp
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const fp = path.join(dir, 'ffmpeg.exe')
    if (fs.existsSync(fp)) return fp
    const fpNoExt = path.join(dir, 'ffmpeg')
    if (fs.existsSync(fpNoExt)) return fpNoExt
  }
  return 'ffmpeg'
}
