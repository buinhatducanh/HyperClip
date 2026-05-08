import os from 'os'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { getRamDiskInfo, getAutoRamDiskSize } from './ramdisk.js'
import { getPoolStatus } from './worker-pool.js'
import { getFfmpegPath } from './ffmpeg-paths.js'

// Re-export for internal use
const getFfmpegBin = getFfmpegPath

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
  gpuMemoryFree: number
  gpuTier: GPUTier
  maxChunkWorkers: number
  networkIp: string
  isOnline: boolean
  activeWorkers: number
}

// ─── NVENC session limits by architecture ─────────────────────────────────────

interface NvencArchConfig {
  maxSessions: number
  surfaceCount: number
  recommendedWorkers: number
  label: string
}

const NVENC_ARCH: Record<string, NvencArchConfig> = {
  // ── RTX 50 series (Blackwell / GB203) ────────────────────────────────────
  // RTX 5080: 2 NVENC engines, 14 concurrent sessions, 16GB GDDR7
  'RTX 5080': { maxSessions: 14, surfaceCount: 48, recommendedWorkers: 14, label: 'RTX 50 series (Blackwell)' },
  'RTX 5090': { maxSessions: 14, surfaceCount: 48, recommendedWorkers: 14, label: 'RTX 50 series (Blackwell)' },
  // ── RTX 40 series (Ada Lovelace / AD102-AD104) ───────────────────────────
  // RTX 4090: 16 sessions, 24GB GDDR6X — hardware limit
  'RTX 4090': { maxSessions: 16, surfaceCount: 48, recommendedWorkers: 14, label: 'RTX 40 series (Ada Lovelace)' },
  'RTX 4090 D': { maxSessions: 14, surfaceCount: 48, recommendedWorkers: 12, label: 'RTX 40 series (Ada Lovelace)' },
  // RTX 4080 SUPER / RTX 4080: 16GB GDDR6X — 14 sessions recommended
  'RTX 4080': { maxSessions: 16, surfaceCount: 48, recommendedWorkers: 12, label: 'RTX 40 series (Ada Lovelace)' },
  'RTX 4080 SUPER': { maxSessions: 16, surfaceCount: 48, recommendedWorkers: 12, label: 'RTX 40 series (Ada Lovelace)' },
  // RTX 4070 Ti SUPER / RTX 4070 Ti: 16GB — 12 sessions recommended
  'RTX 4070 Ti SUPER': { maxSessions: 14, surfaceCount: 32, recommendedWorkers: 10, label: 'RTX 40 series (Ada Lovelace)' },
  'RTX 4070 Ti': { maxSessions: 14, surfaceCount: 32, recommendedWorkers: 10, label: 'RTX 40 series (Ada Lovelace)' },
  // RTX 4070 / RTX 4070 SUPER / RTX 4060 Ti: 12-16GB
  'RTX 4070': { maxSessions: 14, surfaceCount: 32, recommendedWorkers: 8, label: 'RTX 40 series (Ada Lovelace)' },
  'RTX 4070 SUPER': { maxSessions: 14, surfaceCount: 32, recommendedWorkers: 8, label: 'RTX 40 series (Ada Lovelace)' },
  'RTX 4060 Ti': { maxSessions: 14, surfaceCount: 24, recommendedWorkers: 6, label: 'RTX 40 series (Ada Lovelace)' },
  // RTX 4050 Laptop: 6GB GDDR6 — lower limits than desktop RTX 4060
  'RTX 4050 Laptop GPU': { maxSessions: 6, surfaceCount: 16, recommendedWorkers: 4, label: 'RTX 40 Laptop (Ada Lovelace)' },
  // ── RTX 30 series (Ampere / GA102-GA104) ─────────────────────────────────
  'RTX 3090': { maxSessions: 16, surfaceCount: 32, recommendedWorkers: 12, label: 'RTX 30 series (Ampere)' },
  'RTX 3090 Ti': { maxSessions: 16, surfaceCount: 32, recommendedWorkers: 12, label: 'RTX 30 series (Ampere)' },
  'RTX 3080 Ti': { maxSessions: 16, surfaceCount: 32, recommendedWorkers: 10, label: 'RTX 30 series (Ampere)' },
  'RTX 3080': { maxSessions: 14, surfaceCount: 32, recommendedWorkers: 8, label: 'RTX 30 series (Ampere)' },
  'RTX 3070 Ti': { maxSessions: 14, surfaceCount: 24, recommendedWorkers: 8, label: 'RTX 30 series (Ampere)' },
  'RTX 3070': { maxSessions: 14, surfaceCount: 24, recommendedWorkers: 6, label: 'RTX 30 series (Ampere)' },
  'RTX 3060 Ti': { maxSessions: 14, surfaceCount: 16, recommendedWorkers: 6, label: 'RTX 30 series (Ampere)' },
  'RTX 3060': { maxSessions: 14, surfaceCount: 16, recommendedWorkers: 4, label: 'RTX 30 series (Ampere)' },
  // ── RTX 20 series (Turing / TU102-TU116) ────────────────────────────────
  'RTX 2080 Ti': { maxSessions: 8, surfaceCount: 16, recommendedWorkers: 6, label: 'RTX 20 series (Turing)' },
  'RTX 2080': { maxSessions: 8, surfaceCount: 16, recommendedWorkers: 4, label: 'RTX 20 series (Turing)' },
  'RTX 2070': { maxSessions: 8, surfaceCount: 16, recommendedWorkers: 4, label: 'RTX 20 series (Turing)' },
  'RTX 2060': { maxSessions: 6, surfaceCount: 16, recommendedWorkers: 3, label: 'RTX 20 series (Turing)' },
  // ── GTX 16 series (Turing without NVENC rename) ────────────────────────────
  'GTX 1660 Ti': { maxSessions: 4, surfaceCount: 8, recommendedWorkers: 2, label: 'GTX 16 series (Turing)' },
  'GTX 1660 SUPER': { maxSessions: 4, surfaceCount: 8, recommendedWorkers: 2, label: 'GTX 16 series (Turing)' },
  'GTX 1660': { maxSessions: 4, surfaceCount: 8, recommendedWorkers: 2, label: 'GTX 16 series (Turing)' },
}

function getNvencArchConfig(gpuName: string): NvencArchConfig {
  // Exact match first
  if (NVENC_ARCH[gpuName]) return NVENC_ARCH[gpuName]
  // Partial match
  for (const key of Object.keys(NVENC_ARCH)) {
    if (gpuName.includes(key)) return NVENC_ARCH[key]
  }
  // Fallback by GPU tier string
  if (gpuName.includes('RTX 50')) return NVENC_ARCH['RTX 5080']
  // Check Laptop GPUs before generic RTX 40/30/20 — "RTX 40" would match RTX 4080 first
  if (gpuName.includes('Laptop') && gpuName.includes('RTX 40')) return NVENC_ARCH['RTX 4050 Laptop GPU']
  if (gpuName.includes('RTX 40')) return NVENC_ARCH['RTX 4080']
  if (gpuName.includes('RTX 30')) return NVENC_ARCH['RTX 3080']
  if (gpuName.includes('RTX 20')) return NVENC_ARCH['RTX 2080']
  // Unknown RTX
  if (gpuName.includes('RTX')) return { maxSessions: 8, surfaceCount: 16, recommendedWorkers: 6, label: 'Unknown RTX' }
  return { maxSessions: 2, surfaceCount: 8, recommendedWorkers: 2, label: 'Unknown GPU' }
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
  nvencSessions: number
  nvencSurfaceCount: number
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
  let nvencSessions = 2
  let nvencSurfaceCount = 8

  // ── Step 1: Try NVIDIA GPU via nvidia-smi ────────────────────────────────────
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
    // nvidia-smi not found — try Intel GPU
  }

  // ── Step 2: Try Intel Arc / Arc B-Series via WMI ─────────────────────────────
  if (!hasGPU) {
    try {
      // Use WMIC to get GPU names (works on Windows without additional tools)
      const wmiOutput = execSync(
        'wmic path win32_VideoController get name,adapterram /format:csv',
        { encoding: 'utf-8', timeout: 8000 }
      ).trim()
      const lines = wmiOutput.split('\n').filter(l => l.trim())
      for (const line of lines.slice(1)) {  // skip header
        const cols = line.split(',')
        if (cols.length >= 2) {
          const name = cols[1]?.trim() || ''
          const ramStr = cols[2]?.trim() || '0'
          const ramMB = Math.round(parseInt(ramStr) / (1024 * 1024))
          // Match Intel Arc series GPUs
          if (/arc\s*(b-?series|rodram)?|arc\s*a\d{3}|arc\s*\d{3}h?/i.test(name) ||
              /intel.*arc/i.test(name) || /intel.*raptor.*lake.*igd/i.test(name)) {
            hasGPU = true
            gpuName = name
            memory = ramMB
            console.log(`[GPU] Found Intel GPU: ${gpuName} (${memory}MB)`)
            break
          }
        }
      }
    } catch (e) {
      console.log('[GPU] WMI GPU query failed:', e)
    }
  }

  // ── Step 3: NVENC check (NVIDIA only) ───────────────────────────────────────
  if (hasGPU) {
    const ffmpeg = getFfmpegBin()
    try {
      const encodersOut = execSync(`"${ffmpeg}" -hide_banner -encoders 2>&1`, {
        encoding: 'utf-8', timeout: 5000,
      }).toString()

      const hasH264Nvenc = encodersOut.includes('h264_nvenc')
      const hasHevcNvenc = encodersOut.includes('hevc_nvenc')

      if (hasH264Nvenc || hasHevcNvenc) {
        // Verify NVENC actually works — encoder may be in the list but driver may not support it.
        // gyan.dev FFmpeg 8.1 on RTX 4050 Laptop (driver 566.14): lists h264_nvenc but fails at runtime.
        // Use 1920x1080 — minimum required by some builds like CapCut FFmpeg 20.5.0.
        const testCodec = hasH264Nvenc ? 'h264_nvenc' : 'hevc_nvenc'
        const testFile = path.join(os.tmpdir(), `hc_nvenc_test_${Date.now()}.mp4`)
        try {
          execSync(
            `"${ffmpeg}" -f lavfi -i color=c=blue:s=1920x1080:d=0.1 -c:v ${testCodec} -frames:v 1 -y "${testFile}"`,
            { timeout: 15000, stdio: 'ignore' }
          )
          if (!fs.existsSync(testFile) || fs.statSync(testFile).size < 100) throw new Error('NVENC test produced no output')
          console.log(`[GPU] NVENC hardware test passed (${testCodec})`)
          encoder = 'nvenc'
        } catch {
          console.warn(`[GPU] NVENC hardware test FAILED — falling back to CPU encoding.`)
          encoder = 'software'
        } finally {
          try { fs.unlinkSync(testFile) } catch {}
        }

        if (encoder === 'nvenc') {
          const archConfig = getNvencArchConfig(gpuName)
          nvencSessions = archConfig.maxSessions
          nvencSurfaceCount = archConfig.surfaceCount
          maxChunkWorkers = archConfig.recommendedWorkers
          preset = 'fast'
          tier = 'high'
          console.log(`[GPU] NVENC — ${archConfig.label} — sessions=${nvencSessions} workers=${maxChunkWorkers} surfaces=${nvencSurfaceCount}`)
        }
      } else {
        console.log(`[GPU] No NVENC in FFmpeg build`)
        encoder = 'software'
      }
    } catch (e) {
      console.warn('[GPU] FFmpeg encoder check failed:', e)
    }
  }

  // ── Step 4: QSV check (Intel Quick Sync — Arc, older Intel) ─────────────────
  if (encoder === 'software' && hasGPU) {
    const ffmpeg = getFfmpegBin()
    try {
      const encodersOut = execSync(`"${ffmpeg}" -hide_banner -encoders 2>&1`, {
        encoding: 'utf-8', timeout: 5000,
      }).toString()

      if (encodersOut.includes('hevc_qsv') || encodersOut.includes('h264_qsv')) {
        encoder = 'qsv'; preset = 'fast'
        // Intel Arc B-Series (B580 etc.) supports 8+ QSV sessions
        if (/arc\s*b/i.test(gpuName) || /arc\s*a\d{3}h?/i.test(gpuName)) {
          tier = 'mid'; maxChunkWorkers = 6; nvencSessions = 6; nvencSurfaceCount = 16
          console.log(`[GPU] QSV encoder (Intel Arc) — tier=mid, workers=${maxChunkWorkers}`)
        } else {
          tier = 'low'; maxChunkWorkers = 2; nvencSessions = 2; nvencSurfaceCount = 8
          console.log(`[GPU] QSV encoder — tier=low, workers=${maxChunkWorkers}`)
        }
      } else if (encodersOut.includes('hevc_vaapi') || encodersOut.includes('h264_vaapi')) {
        encoder = 'vaapi'; preset = 'fast'; tier = 'low'; maxChunkWorkers = 2
        nvencSessions = 2; nvencSurfaceCount = 8
        console.log('[GPU] VAAPI encoder — tier=low, workers=2')
      }
    } catch (e) {
      console.warn('[GPU] FFmpeg QSV/VAAPI check failed:', e)
    }
  }

  // ── Step 5: VAAPI on Linux (WSL/Linux) ────────────────────────────────────────
  if (encoder === 'software' && !hasGPU) {
    const ffmpeg = getFfmpegBin()
    // Check for VAAPI on Linux/WSL
    try {
      const vaapiDevices = execSync(`"${ffmpeg}" -hide_banner -devices 2>&1`, {
        encoding: 'utf-8', timeout: 5000,
      }).toString()
      if (vaapiDevices.includes('vaapi')) {
        encoder = 'vaapi'; preset = 'fast'; tier = 'low'; maxChunkWorkers = 2
        nvencSessions = 2; nvencSurfaceCount = 8
        gpuName = 'VAAPI'
        hasGPU = true
        console.log('[GPU] VAAPI available on Linux/WSL — tier=low, workers=2')
      }
    } catch {}
  }

  if (!hasGPU) {
    console.log('[GPU] No hardware encoder found — using CPU (software tier)')
  }

  console.log(`[GPU] Detection result: ${gpuName} [${encoder}] tier=${tier} workers=${maxChunkWorkers} sessions=${nvencSessions} surfaces=${nvencSurfaceCount}`)

  _cachedGPU = { encoder, preset, gpuName, memory, tier, maxChunkWorkers, hasGPU, nvencSessions, nvencSurfaceCount }
  return _cachedGPU
}

export function getGPUCapabilities(): Pick<GPUStatic, 'tier' | 'maxChunkWorkers' | 'encoder' | 'preset' | 'gpuName' | 'hasGPU' | 'nvencSessions' | 'nvencSurfaceCount'> {
  const g = detectGPUOnce()
  return {
    tier: g.tier,
    maxChunkWorkers: g.maxChunkWorkers,
    encoder: g.encoder,
    preset: g.preset,
    gpuName: g.gpuName,
    hasGPU: g.hasGPU,
    nvencSessions: g.nvencSessions,
    nvencSurfaceCount: g.nvencSurfaceCount,
  }
}

// Runtime VRAM info (updated every collectSystemStats call)
interface RuntimeVRAM {
  total: number
  free: number
  used: number
}

let _cachedVRAM: RuntimeVRAM = { total: 0, free: 0, used: 0 }

// Use GPU architecture-specific per-worker VRAM estimate.
// RTX 5080/4090/4080: 16GB cards → ~600MB/worker works well.
// Older cards with less VRAM: scale down proportionally.
function getPerWorkerVRAM(): number {
  const gpu = detectGPUOnce()
  if (!gpu.hasGPU) return 600
  // Scale per-worker budget by available VRAM
  const vramGB = gpu.memory / 1024
  if (vramGB >= 14) return 700  // RTX 5080/4090: budget up for large canvas
  if (vramGB >= 10) return 600  // RTX 3090/3080: standard
  if (vramGB >= 6)  return 400  // RTX 3060/4060: tighter
  return 300
}

function getVramInfo(): RuntimeVRAM {
  // Always fresh query — nvidia-smi is fast enough for 2s interval
  // Cache only on failure so we don't spam nvidia-smi if it errors
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=memory.total,memory.free,memory.used --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 3000 }
    ).trim()
    const parts = out.split(',').map((s: string) => parseInt(s.trim()) || 0)
    _cachedVRAM = { total: parts[0] || 0, free: parts[1] || 0, used: parts[2] || 0 }
  } catch {
    // Keep last known values on error
  }
  return _cachedVRAM
}

// Get effective worker count based on available VRAM.
// Per-session VRAM budget (1920x1080 canvas, H.265 encode + NVDEC decode + filter):
//   - NVDEC decode: ~150MB
//   - libavfilter (scale + pad + overlay): ~200MB
//   - NVENC encode (VBR + spatial-AQ): ~250MB
//   - Total: ~600MB per worker (conservative)
// Safety reserve: 2GB for OS + driver + UI (up from 4GB — RTX 5080 has 16GB)
export function getEffectiveWorkers(perWorkerMB = 600): number {
  const gpu = detectGPUOnce()
  const baseWorkers = gpu.maxChunkWorkers
  const vram = getVramInfo()

  if (gpu.encoder !== 'nvenc' || vram.total === 0) return baseWorkers

  // Architecture-aware per-worker VRAM budget (GPU-specific, not hardcoded)
  const actualBudget = Math.min(perWorkerMB, getPerWorkerVRAM())
  const reserveMB = 2048
  const availableMB = vram.free - reserveMB

  if (availableMB <= actualBudget) return Math.max(2, Math.floor(baseWorkers * 0.25))
  const vramCapWorkers = Math.floor(availableMB / actualBudget)
  return Math.max(2, Math.min(baseWorkers, vramCapWorkers))
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

  // GPU real-time: only query nvidia-smi when NVIDIA GPU is present
  let gpuUsage = 0
  let gpuTemp = 0
  let gpuMemFree = 0
  if (gpu.hasGPU && gpu.encoder === 'nvenc') {
    try {
      // Always refresh VRAM on every collectSystemStats call (every 2s)
      const vram = getVramInfo()
      gpuMemFree = vram.free
      // Query usage/temp separately (different query, needed for UI display)
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
    gpuMemoryFree: gpuMemFree,
    gpuTier: gpu.tier,
    maxChunkWorkers: gpu.maxChunkWorkers,
    networkIp: getNetworkIp(),
    isOnline: true,
    activeWorkers: getPoolStatus().active,
  }
}