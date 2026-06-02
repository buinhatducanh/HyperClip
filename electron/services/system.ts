import os from 'os'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { getRamDiskInfo, getAutoRamDiskSize, loadSettings } from './ramdisk.js'
import { getPoolStatus } from './worker-pool.js'
import { getFfmpegPath } from './ffmpeg-paths.js'
import { devLog } from './unified_log.js'

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
  // Surface count 64: RTX 5080 16GB can easily handle high surface pools.
  // Workers 16: matches RTX 5080 NVENC session limit for maximum parallelism.
  'RTX 5080': { maxSessions: 14, surfaceCount: 64, recommendedWorkers: 16, label: 'RTX 50 series (Blackwell)' },
  'RTX 5090': { maxSessions: 14, surfaceCount: 64, recommendedWorkers: 16, label: 'RTX 50 series (Blackwell)' },
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
      devLog(`[GPU] Found: ${gpuName} (${memory}MB VRAM)`)
    }
  } catch (e) {
    // nvidia-smi not found — try Intel GPU
  }

  // ── Step 2: Try Intel Arc / Arc B-Series via WMI ─────────────────────────────
  if (!hasGPU) {
    try {
      // PowerShell approach (wmic deprecated on Windows 11)
      const psOutput = execSync(
        `powershell -Command "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Csv -NoTypeInformation"`,
        { encoding: 'utf-8', timeout: 8000, windowsHide: true }
      ).trim()
      const lines = psOutput.split('\n').filter(l => l.trim())
      for (const line of lines.slice(1)) {  // skip header
        const cols = line.replace(/"/g, '').split(',')
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
            devLog(`[GPU] Found Intel GPU: ${gpuName} (${memory}MB)`)
            break
          }
        }
      }
    } catch (e) {
      devLog('[GPU] WMI GPU query failed:', e)
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
          devLog(`[GPU] NVENC hardware test passed (${testCodec})`)
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
          devLog(`[GPU] NVENC — ${archConfig.label} — sessions=${nvencSessions} workers=${maxChunkWorkers} surfaces=${nvencSurfaceCount}`)
        }
      } else {
        devLog(`[GPU] No NVENC in FFmpeg build`)
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
          devLog(`[GPU] QSV encoder (Intel Arc) — tier=mid, workers=${maxChunkWorkers}`)
        } else {
          tier = 'low'; maxChunkWorkers = 2; nvencSessions = 2; nvencSurfaceCount = 8
          devLog(`[GPU] QSV encoder — tier=low, workers=${maxChunkWorkers}`)
        }
      } else if (encodersOut.includes('hevc_vaapi') || encodersOut.includes('h264_vaapi')) {
        encoder = 'vaapi'; preset = 'fast'; tier = 'low'; maxChunkWorkers = 2
        nvencSessions = 2; nvencSurfaceCount = 8
        devLog('[GPU] VAAPI encoder — tier=low, workers=2')
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
        devLog('[GPU] VAAPI available on Linux/WSL — tier=low, workers=2')
      }
    } catch {}
  }

  if (!hasGPU) {
    devLog('[GPU] No hardware encoder found — using CPU (software tier)')
  }

  devLog(`[GPU] Detection result: ${gpuName} [${encoder}] tier=${tier} workers=${maxChunkWorkers} sessions=${nvencSessions} surfaces=${nvencSurfaceCount}`)

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

// ─── System profile detection (run once at startup) ────────────────────────────

let _cachedSessionCount: number | null = null

/**
 * Detect hardware profile and return the appropriate Chrome session count.
 * - Laptop (RAM ≤ 32GB): 15 sessions — fewer Chrome processes, more RAM for FFmpeg workers
 * - Desktop (RAM > 32GB): 30 sessions — full parallelism for RTX 5080 detection pipeline
 */
export function detectSystemProfile(): { isLaptop: boolean; sessionCount: number } {
  if (_cachedSessionCount !== null) {
    return { isLaptop: _cachedSessionCount === 15, sessionCount: _cachedSessionCount }
  }

  // User MUST select a hardware preset — no auto-detect.
  // If no profile set, default to Low (safe conservative).
  const settings = loadSettings()
  if (settings.hardwareProfile) {
    const preset = PRESETS.find(p => p.vramGB === settings.hardwareProfile!.vramGB && p.ramGB === settings.hardwareProfile!.ramGB)
    if (preset) {
      _cachedSessionCount = preset.sessions
      devLog(`[SystemProfile] Using preset sessions=${preset.sessions} (${preset.label})`)
      return { isLaptop: false, sessionCount: _cachedSessionCount }
    }
    devLog(`[SystemProfile] hardwareProfile (${settings.hardwareProfile.vramGB}/${settings.hardwareProfile.ramGB}) không match preset — falling back to Low`)
  }
  // No hardwareProfile set OR doesn't match any preset — use Low conservative default
  _cachedSessionCount = 4
  devLog(`[SystemProfile] No valid hardwareProfile — using Low default (${_cachedSessionCount} sessions)`)
  return { isLaptop: false, sessionCount: _cachedSessionCount }
}

export function getSessionCount(): number {
  return detectSystemProfile().sessionCount
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

interface GpuLiveData {
  total: number
  free: number
  used: number
  gpuUsage: number
  gpuTemp: number
}

let _cachedGpuLive: GpuLiveData | null = null
let _cachedGpuLiveTime = 0
const _GPU_CACHE_TTL_MS = 5000

function getVramInfo(): RuntimeVRAM {
  // Single nvidia-smi call with 5s TTL — eliminates duplicate blocking calls.
  // Returns: [total, free, used, gpuUsage, gpuTemp]
  const now = Date.now()
  if (_cachedGpuLive && (now - _cachedGpuLiveTime) < _GPU_CACHE_TTL_MS) {
    return { total: _cachedGpuLive.total, free: _cachedGpuLive.free, used: _cachedGpuLive.used }
  }
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=memory.total,memory.free,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 3000 }
    ).trim()
    const parts = out.split(',').map((s: string) => parseInt(s.trim()) || 0)
    _cachedGpuLive = {
      total: parts[0] || 0,
      free: parts[1] || 0,
      used: parts[2] || 0,
      gpuUsage: parts[3] || 0,
      gpuTemp: parts[4] || 0,
    }
    _cachedGpuLiveTime = now
  } catch {
    // Keep last known values on error
  }
  return _cachedGpuLive ?? { total: 0, free: 0, used: 0, gpuUsage: 0, gpuTemp: 0 }
}

export function getGpuLive(): GpuLiveData {
  // Returns live GPU data (usage + temp) from cache without extra nvidia-smi call.
  getVramInfo() // populate cache if stale
  return _cachedGpuLive ?? { total: 0, free: 0, used: 0, gpuUsage: 0, gpuTemp: 0 }
}

// Get effective worker count based on available VRAM or preset settings.
// Per-session VRAM budget (1920x1080 canvas, H.265 encode + NVDEC decode + filter):
//   - NVDEC decode: ~150MB
//   - libavfilter (scale + pad + overlay): ~200MB
//   - NVENC encode (VBR + spatial-AQ): ~250MB
//   - Total: ~600MB per worker (conservative)
// Safety reserve: 2GB for OS + driver + UI (up from 4GB — RTX 5080 has 16GB)
export function getEffectiveWorkers(perWorkerMB = 600): number {
  // Preset settings only — no auto-detect fallback.
  const profile = loadSettings().hardwareProfile
  if (profile) {
    const preset = PRESETS.find(p => p.vramGB === profile.vramGB && p.ramGB === profile.ramGB)
    if (preset) return preset.chunkWorkers
  }
  // Default safe: Low preset worker count
  return 2
}

// Returns render (single-pass) workers from hardware preset.
// Single-pass uses less VRAM than chunked encoding — more workers can run concurrently.
export function getRenderWorkers(): number {
  const profile = loadSettings().hardwareProfile
  if (profile) {
    const preset = PRESETS.find(p => p.vramGB === profile.vramGB && p.ramGB === profile.ramGB)
    if (preset) return preset.renderWorkers
  }
  return 2
}

// ─── Machine tier & adaptive download params ──────────────────────────────────────

export type MachineTier = 'low' | 'mid' | 'high'

// ─── Hardware Preset Definitions ─────────────────────────────────────────────────

interface PresetDef {
  id: string
  label: string
  vramGB: number
  ramGB: number
  downloadInstances: number
  renderWorkers: number
  chunkWorkers: number
  sessions: number
}

const PRESETS: PresetDef[] = [
  { id: 'ultra',   label: 'Ultra',   vramGB: 16, ramGB: 64, downloadInstances: 6, renderWorkers: 6, chunkWorkers: 14, sessions: 30 },
  { id: 'high',   label: 'High',     vramGB: 12, ramGB: 48, downloadInstances: 2, renderWorkers: 3, chunkWorkers: 6,  sessions: 8  },
  { id: 'medium', label: 'Medium',   vramGB: 8,  ramGB: 32, downloadInstances: 2, renderWorkers: 2, chunkWorkers: 4,  sessions: 6  },
  { id: 'low',    label: 'Low',      vramGB: 6,  ramGB: 24, downloadInstances: 1, renderWorkers: 2, chunkWorkers: 2,  sessions: 4  },
  { id: 'minimal',label: 'Minimal',  vramGB: 4,  ramGB: 16, downloadInstances: 1, renderWorkers: 1, chunkWorkers: 1,  sessions: 2  },
]

export interface HardwareProfileInfo {
  detected: { vramGB: number; ramGB: number; gpuName: string }
  presets: Array<PresetDef & { available: boolean }>
  active: string | null
}

export function getHardwareProfileInfo(): HardwareProfileInfo {
  const gpu = detectGPUOnce()
  const detectedRamGB = Math.ceil(os.totalmem() / (1024 ** 3))
  const activeProfile = loadSettings().hardwareProfile
  const active = activeProfile
    ? PRESETS.find(p => p.vramGB === activeProfile.vramGB && p.ramGB === activeProfile.ramGB)?.id ?? null
    : null

  return {
    detected: { vramGB: Math.round(gpu.memory / 1024), ramGB: detectedRamGB, gpuName: gpu.gpuName },
    presets: PRESETS.map(p => ({
      ...p,
      available: p.vramGB <= Math.round(gpu.memory / 1024) && p.ramGB <= detectedRamGB,
    })),
    active,
  }
}

let _cachedMachineTier: MachineTier | null = null

export function getMachineTier(): MachineTier {
  if (_cachedMachineTier) return _cachedMachineTier

  // User MUST select a hardware preset — no auto-detect.
  // If no profile set, default to Low (safe conservative).
  const settings = loadSettings()
  const profile = settings?.hardwareProfile
  if (profile) {
    const preset = PRESETS.find(p => p.vramGB === profile.vramGB && p.ramGB === profile.ramGB)
    if (preset) {
      _cachedMachineTier = preset.id === 'ultra' || preset.id === 'high' ? 'high' : preset.id === 'medium' ? 'mid' : 'low'
      return _cachedMachineTier
    }
  }
  _cachedMachineTier = 'low'
  return 'low'
}

export interface DownloadParams {
  fragments: number
  maxInstances: number
}

let _cachedDownloadParams: DownloadParams | null = null

export function getDownloadParams(): DownloadParams {
  const profile = loadSettings().hardwareProfile
  if (profile) {
    const preset = PRESETS.find(p => p.vramGB === profile.vramGB && p.ramGB === profile.ramGB)
    if (preset) {
      return { fragments: preset.chunkWorkers * 8, maxInstances: preset.downloadInstances }
    }
  }
  if (_cachedDownloadParams) return _cachedDownloadParams

  const tier = getMachineTier()
  switch (tier) {
    case 'high': _cachedDownloadParams = { fragments: 16, maxInstances: 4 }; break
    case 'mid':  _cachedDownloadParams = { fragments: 8, maxInstances: 2 }; break
    case 'low':  _cachedDownloadParams = { fragments: 4, maxInstances: 1 }; break
  }
  return _cachedDownloadParams ?? { fragments: 16, maxInstances: 1 }
}

// ─── CPU usage (tick delta with warmup + TTL cache) ───────────────────────────────

let _cpuLastTotal = 0
let _cpuLastIdle = 0
let _cpuFirstDone = false
let _cpuCache: { name: string; cores: number; usage: number } | null = null
let _cpuCacheTime = 0
const _CPU_CACHE_TTL_MS = 5000

function getCpuUsage(): { name: string; cores: number; usage: number } {
  const now = Date.now()
  if (_cpuCache && (now - _cpuCacheTime) < _CPU_CACHE_TTL_MS) {
    return _cpuCache
  }

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
    _cpuLastTotal = totalTick
    _cpuLastIdle = totalIdle
    _cpuFirstDone = true
    const result = { name: model, cores, usage: 0 }
    _cpuCache = result
    _cpuCacheTime = now
    return result
  }

  const idleDiff = totalIdle - _cpuLastIdle
  const totalDiff = totalTick - _cpuLastTotal
  _cpuLastTotal = totalTick
  _cpuLastIdle = totalIdle

  const usage = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0
  const result = { name: model, cores, usage: Math.max(0, Math.min(100, usage)) }
  _cpuCache = result
  _cpuCacheTime = now
  return result
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

  // GPU real-time: single nvidia-smi call via getGpuLive() (5s TTL, shared cache)
  let gpuUsage = 0
  let gpuTemp = 0
  let gpuMemFree = 0
  if (gpu.hasGPU && gpu.encoder === 'nvenc') {
    const live = getGpuLive()
    gpuMemFree = live.free
    gpuUsage = live.gpuUsage
    gpuTemp = live.gpuTemp
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

// ─── Resource Monitor ─────────────────────────────────────────────────────────────
// Watchdog: monitors RAM/GPU and detects when system is under load.
// Sends notifications to renderer and can auto-throttle background tasks.

export interface ResourceAlert {
  level: 'normal' | 'warning' | 'critical'
  reason: string
  usedRAM?: number
  usedGPU?: number
  gameDetected?: boolean
}

// Common game process names (Windows)
const GAME_PROCESSES = [
  'Valorant.exe', 'VALORANT.exe',
  'League of Legends.exe', 'LeagueClient.exe',
  'csgo.exe', 'cs2.exe',
  'FortniteClient-Game', 'FortniteLauncher.exe',
  'GenshinImpact.exe', 'YuanShen.exe',
  'PUBG.exe', 'TslGame.exe',
  'RogueGame.exe', 'Apex Legends.exe',
  'Overwatch.exe', 'Overwatch2.exe',
  'Riot Vanguard\\vgk.sys',
  'Dota2.exe',
  'Heroes of the Storm.exe', 'Storm.dll',
]

let _lastAlert: ResourceAlert = { level: 'normal', reason: '' }
let _lastAlertTime = 0
const ALERT_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes
let _lastGameScanTime = 0
const GAME_SCAN_INTERVAL_MS = 30 * 1000 // 30 seconds — tasklist is expensive
let _cachedGameDetected = false

export function checkResourceAlert(): ResourceAlert {
  const now = Date.now()
  if (now - _lastAlertTime < ALERT_COOLDOWN_MS) return _lastAlert

  const stats = collectSystemStats()
  const ramPct = Math.round((1 - stats.ramFree / stats.ramTotal) * 100)
  const gpuPct = stats.gpuUsage ?? 0

  // Detect game processes — throttle tasklist to every 30s
  let gameDetected = _cachedGameDetected
  if (now - _lastGameScanTime >= GAME_SCAN_INTERVAL_MS) {
    try {
      const out = execSync(
        'tasklist /FI "IMAGENAME eq *.exe" /NH 2>nul',
        { encoding: 'utf-8', timeout: 5000, windowsHide: true }
      )
      _cachedGameDetected = false
      for (const game of GAME_PROCESSES) {
        if (out.toLowerCase().includes(game.toLowerCase())) {
          _cachedGameDetected = true
          break
        }
      }
      _lastGameScanTime = now
    } catch {}
    gameDetected = _cachedGameDetected
  }

  let level: ResourceAlert['level'] = 'normal'
  let reason = ''

  if (gameDetected && (ramPct >= 60 || gpuPct >= 60)) {
    level = 'warning'
    reason = `Game detected — RAM ${ramPct}%, GPU ${gpuPct}%`
  } else if (ramPct >= 90) {
    level = 'critical'
    reason = `RAM critical: ${ramPct}% used`
  } else if (ramPct >= 80) {
    level = 'warning'
    reason = `RAM high: ${ramPct}% used`
  } else if (gpuPct >= 95) {
    level = 'critical'
    reason = `GPU usage critical: ${gpuPct}%`
  } else if (gpuPct >= 85) {
    level = 'warning'
    reason = `GPU usage high: ${gpuPct}%`
  }

  if (level !== 'normal') {
    _lastAlert = { level, reason, usedRAM: ramPct, usedGPU: gpuPct, gameDetected }
    _lastAlertTime = now
  }

  return { level, reason, usedRAM: ramPct, usedGPU: gpuPct, gameDetected }
}

export function getLastResourceAlert(): ResourceAlert {
  return _lastAlert
}