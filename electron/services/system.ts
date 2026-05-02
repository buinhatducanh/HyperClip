import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { getRamDiskInfo, getAutoRamDiskSize } from './ramdisk.js'
import { getPoolStatus } from './worker-pool.js'

// Inline FFmpeg path resolution (avoid circular import from ffmpeg-paths)
function getFfmpegBin(): string {
  const candidates = [
    'C:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffmpeg.exe',
    'C:/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files (x86)/ffmpeg/bin/ffmpeg.exe',
    path.join(process.cwd(), 'node_modules', '.bin', 'ffmpeg.exe'),
    'C:/Users/MSI/AppData/Local/CapCut/Apps/8.1.1.3417/ffmpeg.exe',
    'C:/Users/MSI/AppData/Local/CapCut/Apps/8.0.1.3366/ffmpeg.exe',
  ]
  const fsCheck = (fp: string) => { try { return require('fs').existsSync(fp) } catch { return false } }
  for (const fp of candidates) {
    if (fsCheck(fp)) return fp
  }
  return 'ffmpeg'
}

export type GPUTier = 'high' | 'mid' | 'low' | 'software'

export interface SystemStats {
  ramUsed: number
  ramTotal: number
  ramFree: number
  ramDiskUsed: number
  ramDiskTotal: number
  ramDiskAvailable: number
  ramDiskIsAvailable: boolean
  cpuUsage: number
  cpuCores: number
  cpuName: string
  gpuUsage: number
  gpuTemp: number
  gpuName: string
  gpuEncoder: 'nvenc' | 'qsv' | 'vaapi' | 'software'
  gpuMemoryTotal: number
  gpuTier: GPUTier
  maxChunkWorkers: number
  networkIp: string
  isOnline: boolean
  activeWorkers: number
}

// ─── Static GPU detection (run once at startup) ───────────────────────────────

interface GPUStatic {
  encoder: 'nvenc' | 'qsv' | 'vaapi' | 'software'
  preset: string
  gpuName: string
  memory: number
  tier: GPUTier
  maxChunkWorkers: number
  hasGPU: boolean
}

let _cachedGPU: GPUStatic | null = null

function detectGPUOnce(): GPUStatic {
  if (_cachedGPU) return _cachedGPU

  let encoder: GPUStatic['encoder'] = 'software'
  let preset = 'medium'
  let gpuName = 'CPU'
  let memory = 0
  let tier: GPUTier = 'software'
  let maxChunkWorkers = 2
  let hasGPU = false

  // Check nvidia-smi
  try {
    const nvOutput = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
      encoding: 'utf-8', timeout: 5000,
    }).trim()
    if (nvOutput) {
      hasGPU = true
      const parts = nvOutput.split('\n')[0].split(',').map((s: string) => s.trim())
      gpuName = parts[0] || 'NVIDIA GPU'
      memory = parseInt(parts[1]) || 0
      console.log(`[GPU] Found: ${gpuName} (${memory}MB VRAM)`)
    }
  } catch (e) {
    console.log('[GPU] nvidia-smi not found or failed — using CPU encoding')
  }

  // NVENC check (only if GPU detected)
  if (hasGPU) {
    const ffmpeg = getFfmpegBin()
    try {
      const encodersOut = execSync(`"${ffmpeg}" -hide_banner -encoders 2>&1`, {
        encoding: 'utf-8', timeout: 5000,
      }).toString()
      if (encodersOut.includes('h264_nvenc') || encodersOut.includes('hevc_nvenc')) {
        encoder = 'nvenc'
        if (gpuName.includes('RTX 50') || gpuName.includes('RTX 40')) {
          tier = 'high'; maxChunkWorkers = 8; preset = 'fast'
          console.log(`[GPU] NVENC found — tier=high, workers=8, preset=fast`)
        } else if (gpuName.includes('RTX 30') || gpuName.includes('RTX 20')) {
          tier = 'mid'; maxChunkWorkers = 4; preset = 'fast'
          console.log(`[GPU] NVENC found — tier=mid, workers=4, preset=fast`)
        } else {
          tier = 'low'; maxChunkWorkers = 2; preset = 'medium'
          console.log(`[GPU] NVENC found (legacy GPU) — tier=low, workers=2, preset=medium`)
        }
      } else {
        console.log(`[GPU] No NVENC in ffmpeg build — falling back to software/QSV/VAAPI`)
      }
    } catch (e) {
      console.warn('[GPU] FFmpeg encoder check failed:', e)
    }
  }

  // Fallback: QSV / VAAPI
  if (encoder === 'software') {
    const ffmpeg = getFfmpegBin()
    try {
      const encodersOut = execSync(`"${ffmpeg}" -hide_banner -encoders 2>&1`, {
        encoding: 'utf-8', timeout: 5000,
      }).toString()
      if (encodersOut.includes('h264_qsv')) {
        encoder = 'qsv'; preset = 'fast'; tier = 'low'; maxChunkWorkers = 2
        console.log('[GPU] QSV encoder found — tier=low, workers=2')
      } else if (encodersOut.includes('h264_vaapi')) {
        encoder = 'vaapi'; preset = 'fast'; tier = 'low'; maxChunkWorkers = 2
        console.log('[GPU] VAAPI encoder found — tier=low, workers=2')
      } else {
        console.log('[GPU] No hardware encoder found — using CPU (software tier)')
      }
    } catch (e) {
      console.warn('[GPU] FFmpeg fallback check failed:', e)
    }
  }

  console.log(`[GPU] Detection result: ${gpuName} [${encoder}] tier=${tier} workers=${maxChunkWorkers}`)

  _cachedGPU = { encoder, preset, gpuName, memory, tier, maxChunkWorkers, hasGPU }
  return _cachedGPU
}

export function getGPUCapabilities(): Pick<GPUStatic, 'tier' | 'maxChunkWorkers' | 'encoder' | 'preset' | 'gpuName'> {
  const g = detectGPUOnce()
  return { tier: g.tier, maxChunkWorkers: g.maxChunkWorkers, encoder: g.encoder, preset: g.preset, gpuName: g.gpuName }
}

// ─── CPU usage (tick delta with warmup) ───────────────────────────────────────

let _cpuLastTotal = 0
let _cpuLastIdle = 0
let _cpuFirstDone = false

function getCpuUsage(): { name: string; cores: number; usage: number } {
  const cpus = os.cpus()
  const cores = cpus.length
  const model = cpus[0]?.model || 'Unknown CPU'

  let totalIdle = 0, totalTick = 0
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times]
    }
    totalIdle += cpu.times.idle
  }

  if (!_cpuFirstDone) {
    // First call: prime the pump — don't show a meaningless spike
    _cpuLastTotal = totalTick
    _cpuLastIdle = totalIdle
    _cpuFirstDone = true
    return { name: model, cores, usage: 0 }
  }

  const idleDiff = totalIdle - _cpuLastIdle
  const totalDiff = totalTick - _cpuLastTotal
  _cpuLastTotal = totalTick
  _cpuLastIdle = totalIdle

  const usage = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0
  return { name: model, cores, usage: Math.max(0, Math.min(100, usage)) }
}

// ─── Network IP (cache once) ─────────────────────────────────────────────────

let _cachedIp: string | null = null

function getNetworkIp(): string {
  if (_cachedIp) return _cachedIp
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        _cachedIp = iface.address
        return _cachedIp
      }
    }
  }
  return '127.0.0.1'
}

// ─── Main collector (called every 2s from main.ts) ────────────────────────────

export function collectSystemStats(): SystemStats {
  const gpu = detectGPUOnce()
  const cpuInfo = getCpuUsage()

  // GPU real-time: only query nvidia-smi when GPU is present
  let gpuUsage = 0
  let gpuTemp = 0
  if (gpu.hasGPU) {
    try {
      const output = execSync('nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits', {
        encoding: 'utf-8', timeout: 3000,
      })
      const parts = output.trim().split(',').map((s: string) => s.trim())
      gpuUsage = parseInt(parts[0]) || 0
      gpuTemp = parseInt(parts[1]) || 0
    } catch {}
  }

  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const ramDiskInfo = getRamDiskInfo()
  const ramDiskSizeGB = getAutoRamDiskSize()

  return {
    ramUsed: +(usedMem / (1024 ** 3)).toFixed(1),
    ramTotal: +(totalMem / (1024 ** 3)).toFixed(1),
    ramFree: +(freeMem / (1024 ** 3)).toFixed(1),
    ramDiskUsed: ramDiskInfo.used,
    ramDiskTotal: ramDiskSizeGB,
    ramDiskAvailable: ramDiskInfo.available,
    ramDiskIsAvailable: ramDiskInfo.isAvailable,
    cpuUsage: cpuInfo.usage,
    cpuCores: cpuInfo.cores,
    cpuName: cpuInfo.name,
    gpuUsage,
    gpuTemp,
    gpuName: gpu.gpuName,
    gpuEncoder: gpu.encoder,
    gpuMemoryTotal: gpu.memory,
    gpuTier: gpu.tier,
    maxChunkWorkers: gpu.maxChunkWorkers,
    networkIp: getNetworkIp(),
    isOnline: true,
    activeWorkers: getPoolStatus().active,
  }
}
