import os from 'os'
import { execSync } from 'child_process'
import { getRamDiskInfo, getAutoRamDiskSize } from './ramdisk.js'
import { getPoolStatus } from './worker-pool.js'

export interface SystemStats {
  ramUsed: number
  ramTotal: number
  ramFree: number
  ramDiskUsed: number
  ramDiskTotal: number
  ramDiskAvailable: number
  ramDiskIsAvailable: boolean
  cpuUsage: number        // percent 0-100
  cpuCores: number       // logical cores
  cpuName: string        // e.g. "Intel Core Ultra 9 285K"
  gpuUsage: number
  gpuTemp: number
  gpuName: string
  gpuEncoder: string        // 'nvenc' | 'qsv' | 'vaapi' | 'software'
  gpuMemoryTotal: number   // MB
  networkIp: string
  isOnline: boolean
  activeWorkers: number
}

// ─── CPU detection ──────────────────────────────────────────────────────────────
function getCpuInfo(): { name: string; cores: number; usage: number } {
  const cpus = os.cpus()
  const cores = cpus.length
  const model = cpus[0]?.model || 'Unknown CPU'

  // Calculate usage from tick differences (similar to `top` behavior)
  let totalIdle = 0, totalTick = 0
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times]
    }
    totalIdle += cpu.times.idle
  }

  const idleDiff = totalIdle - (getCpuInfo as any)._lastIdle || 0
  const totalDiff = totalTick - (getCpuInfo as any)._lastTotal || 0
  ;(getCpuInfo as any)._lastIdle = totalIdle
  ;(getCpuInfo as any)._lastTotal = totalTick

  const usage = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0
  return { name: model, cores, usage: Math.max(0, Math.min(100, usage)) }
}

// ─── GPU detection ─────────────────────────────────────────────────────────────
export function detectEncoder(): { encoder: SystemStats['gpuEncoder']; preset: string; gpuName: string; memory: number } {
  let encoder: SystemStats['gpuEncoder'] = 'software'
  let preset = 'medium'
  let gpuName = 'CPU'
  let memory = 0

  // Try NVIDIA first
  try {
    const nvOutput = execSync('nvidia-smi --query-gpu=name,utilization.gpu,memory.total --format=csv,noheader,nounits', {
      encoding: 'utf-8', timeout: 5000,
    }).trim()
    if (nvOutput) {
      const lines = nvOutput.split('\n')
      const parts = lines[0].split(',').map((s: string) => s.trim())
      gpuName = parts[0] || 'NVIDIA GPU'
      memory = parseInt(parts[2]) || 0

      // Verify NVENC support
      const encodersOut = execSync('ffmpeg -hide_banner -encoders 2>&1', {
        encoding: 'utf-8', timeout: 5000,
      }).toString()
      if (encodersOut.includes('h264_nvenc')) {
        encoder = 'nvenc'
        // Adaptive preset: newer GPU = faster preset
        const isRTX4xxx = gpuName.includes('RTX 40') || gpuName.includes('RTX 50')
        const isRTX3xxx = gpuName.includes('RTX 30') || gpuName.includes('RTX 20')
        preset = isRTX4xxx || isRTX3xxx ? 'fast' : 'medium'
      }
    }
  } catch {}

  // Try Intel Quick Sync
  if (encoder === 'software') {
    try {

      const qsOut = execSync('ffmpeg -hide_banner -encoders 2>&1', {
        encoding: 'utf-8', timeout: 5000,
      })
      if (qsOut.includes('h264_qsv')) { encoder = 'qsv'; preset = 'fast' }
      else if (qsOut.includes('h264_vaapi')) { encoder = 'vaapi'; preset = 'fast' }
    } catch {}
  }

  return { encoder, preset, gpuName, memory }
}

export function collectSystemStats(): SystemStats {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const totalGB = totalMem / (1024 ** 3)

  // Auto-detect GPU and encoder
  const { encoder, gpuName, memory } = detectEncoder()

  // Get CPU info
  const cpuInfo = getCpuInfo()

  // Get primary IP
  const nets = os.networkInterfaces()
  let networkIp = '127.0.0.1'
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        networkIp = iface.address
        break
      }
    }
  }

  // GPU usage/temp via nvidia-smi
  let gpuUsage = 0
  let gpuTemp = 0
  if (encoder !== 'software') {
    try {

      const output = execSync('nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader', {
        encoding: 'utf-8', timeout: 5000,
      })
      const parts = output.trim().split(', ')
      if (parts.length >= 2) {
        gpuUsage = parseInt(parts[0]) || 0
        gpuTemp = parseInt(parts[1]) || 0
      }
    } catch {}
  }

  const ramDiskInfo = getRamDiskInfo()
  const ramDiskSizeGB = getAutoRamDiskSize()

  return {
    ramUsed: parseFloat(usedMem.toFixed(1)),
    ramTotal: parseFloat(totalGB.toFixed(1)),
    ramFree: parseFloat((freeMem / (1024 ** 3)).toFixed(1)),
    ramDiskUsed: ramDiskInfo.used,
    ramDiskTotal: ramDiskSizeGB,
    ramDiskAvailable: ramDiskInfo.available,
    ramDiskIsAvailable: ramDiskInfo.isAvailable,
    cpuUsage: cpuInfo.usage,
    cpuCores: cpuInfo.cores,
    cpuName: cpuInfo.name,
    gpuUsage,
    gpuTemp,
    gpuName,
    gpuEncoder: encoder,
    gpuMemoryTotal: memory,
    networkIp,
    isOnline: true,
    activeWorkers: getPoolStatus().active,
  }
}
