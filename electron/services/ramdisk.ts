import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

// RAM Disk Manager
// Manages the virtual RAM disk for fast video temp storage

// ─── User-configurable storage paths ─────────────────────────────────────────────
const APPDATA = process.env.APPDATA || process.env.HOME || process.cwd()
const STORE_DIR = path.join(APPDATA, 'HyperClip')
const SETTINGS_FILE = path.join(STORE_DIR, 'settings.json')

interface AppSettingsStore {
  videoStoragePath?: string
  outputPath?: string
  adminPasswordHash?: string
  defaultTrimLimit?: number | 'full'  // minutes for auto-download
}

let _settings: AppSettingsStore | null = null

export function loadSettings(): AppSettingsStore {
  if (_settings !== null) return _settings
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      _settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    }
  } catch {}
  _settings = _settings || {}
  return _settings
}

export function saveSettings(settings: AppSettingsStore): void {
  _settings = settings
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
}

export function getConfiguredVideoStoragePath(): string | undefined {
  return loadSettings().videoStoragePath
}

export function getConfiguredOutputPath(): string | undefined {
  return loadSettings().outputPath
}

export interface RamDiskInfo {
  total: number       // Total RAM disk size in GB
  used: number        // Used space in GB
  available: number   // Available space in GB
  path: string        // Mount point / drive letter
  isAvailable: boolean
}

// On Windows: Use ImDisk or similar to create RAM disk
// On Linux: Use tmpfs mount
// Fallback: Use a folder on fast storage with RAM-like management

// Auto-detect RAM disk size based on available memory
// Target machine (64GB): use full 64GB
// Test machine (16GB): use 4GB (25%) to avoid OOM
export function getAutoRamDiskSize(): number {
  const totalGB = os.totalmem() / (1024 ** 3)
  if (totalGB >= 32) return Math.min(64, Math.floor(totalGB * 0.8))
  if (totalGB >= 16) return 4   // 16GB machine: 4GB for video temp
  if (totalGB >= 8)  return 2   // 8GB machine: 2GB
  return 1                          // Low memory: 1GB
}

const RAM_DISK_SIZE_GB = getAutoRamDiskSize()
const RAM_DISK_PATH = process.platform === 'win32'
  ? 'R:\\hyperclip'    // Windows: R: drive (create with ImDisk)
  : '/mnt/ramdisk/hyperclip'  // Linux: tmpfs

const OUTPUT_PATH = process.platform === 'win32'
  ? 'R:\\hyperclip\\output'
  : '/mnt/ramdisk/hyperclip/output'

const RAM_DISK_TOTAL = RAM_DISK_SIZE_GB * 1024 * 1024 * 1024 // bytes

// Check if RAM disk is available
export function isRamDiskAvailable(): boolean {
  try {
    return fs.existsSync(RAM_DISK_PATH)
  } catch {
    return false
  }
}

// Get RAM disk info
export function getRamDiskInfo(): RamDiskInfo {
  const available = isRamDiskAvailable()

  if (!available) {
    // Fallback: use temp directory with disk space info
    const tempDir = os.tmpdir()
    try {
      // Estimate based on free temp space
      const freeSpace = getFreeDiskSpace(tempDir)
      return {
        total: RAM_DISK_SIZE_GB,
        used: 0,
        available: Math.min(freeSpace / (1024**3), RAM_DISK_SIZE_GB),
        path: RAM_DISK_PATH,
        isAvailable: false,
      }
    } catch {
      return {
        total: RAM_DISK_SIZE_GB,
        used: 0,
        available: RAM_DISK_SIZE_GB,
        path: RAM_DISK_PATH,
        isAvailable: false,
      }
    }
  }

  // Calculate usage
  let usedBytes = 0
  try {
    usedBytes = calculateDirSize(RAM_DISK_PATH)
  } catch {}

  return {
    total: RAM_DISK_SIZE_GB,
    used: parseFloat((usedBytes / (1024**3)).toFixed(2)),
    available: parseFloat((RAM_DISK_SIZE_GB - usedBytes / (1024**3)).toFixed(2)),
    path: RAM_DISK_PATH,
    isAvailable: true,
  }
}

// Get video storage path (user-configured > RAM disk > temp)
export function getVideoStoragePath(): string {
  const configured = getConfiguredVideoStoragePath()
  if (configured && fs.existsSync(configured)) return configured
  if (isRamDiskAvailable()) return RAM_DISK_PATH
  // Fallback: persistent folder in AppData — NOT temp
  return path.join(STORE_DIR, 'downloads')
}

// Get output path (user-configured > RAM disk > documents)
export function getOutputPath(): string {
  const configured = getConfiguredOutputPath()
  if (configured && fs.existsSync(configured)) return configured
  if (isRamDiskAvailable()) return OUTPUT_PATH
  // Fallback: persistent folder in AppData
  return path.join(STORE_DIR, 'output')
}

// Ensure directories exist
export function ensureStorageDirs(): void {
  const storagePath = getVideoStoragePath()
  const outputPath = getOutputPath()

  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true })
  }
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true })
  }
}

// Generate workspace file paths
// yt-dlp outputs: {workspaceId}_{videoId}.mp4 — pass videoId to match the actual file
export function generateWorkspacePaths(workspaceId: string, videoId?: string): {
  videoPath: string
  blurPath: string
  metadataPath: string
  outputPath: string
} {
  const storagePath = getVideoStoragePath()
  const outputDir = getOutputPath()

  return {
    // yt-dlp output template: {workspaceId}_%(id)s.mp4 — videoId required to match
    videoPath: videoId
      ? path.join(storagePath, `${workspaceId}_${videoId}.mp4`)
      : path.join(storagePath, `${workspaceId}.mp4`),
    blurPath: path.join(storagePath, `blur_${workspaceId}.jpg`),
    metadataPath: path.join(storagePath, `meta_${workspaceId}.json`),
    outputPath: path.join(outputDir, `${workspaceId}_output.mp4`),
  }
}

// Calculate directory size recursively
function calculateDirSize(dirPath: string): number {
  let size = 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        size += calculateDirSize(fullPath)
      } else {
        const stat = fs.statSync(fullPath)
        size += stat.size
      }
    }
  } catch {}
  return size
}

// Get free disk space for a path (cross-platform)
function getFreeDiskSpace(dirPath: string): number {
  // On Windows, use wmic command
  if (process.platform === 'win32') {
    try {

      const drive = path.parse(dirPath).root || 'C:'
      const out = execSync(`wmic logicaldisk where "DeviceID='${drive.replace('\\', '')}'" get FreeSpace /format:value`, {
        encoding: 'utf-8',
        timeout: 5000,
        
      })
      const match = out.match(/FreeSpace=(\d+)/)
      return match ? parseInt(match[1]) : 0
    } catch {
      return 0
    }
  }

  // On Linux/macOS, use df
  try {

    const out = execSync(`df -k "${dirPath}"`, { encoding: 'utf-8', timeout: 5000 })
    const lines = out.trim().split('\n')
    const dataLine = lines[lines.length - 1]
    const parts = dataLine.trim().split(/\s+/)
    const freeKb = parseInt(parts[3]) || 0
    return freeKb * 1024
  } catch {
    return 0
  }
}

// Clean up old workspace files
export function cleanupWorkspace(workspaceId: string, downloadedPath?: string): void {
  // Clean the actual downloaded file (yt-dlp uses {workspaceId}_{videoId}.mp4)
  // and the generic path (for backward compat / cleanup of old format files)
  const { videoPath, blurPath, metadataPath, outputPath } = generateWorkspacePaths(workspaceId)

  const filesToClean = new Set<string>()
  if (downloadedPath) filesToClean.add(downloadedPath)
  filesToClean.add(videoPath)  // generic workspaceId.mp4 (old format)
  // Also try workspaceId_*.mp4 pattern (yt-dlp new format without knowing videoId)
  filesToClean.add(blurPath)
  filesToClean.add(metadataPath)
  // output file
  try {
    if (fs.existsSync(outputPath)) {
      filesToClean.add(outputPath)
    }
  } catch {}

  for (const filePath of filesToClean) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        console.log(`[RAMDisk] Cleaned: ${filePath}`)
      }
    } catch (err) {
      // Ignore errors for files that don't exist
    }
  }
}

// Format bytes to human readable
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Get storage stats for a workspace
export function getWorkspaceStorageSize(workspaceId: string): { video: number; blur: number; total: number } {
  const storagePath = getVideoStoragePath()
  let videoSize = 0
  let blurSize = 0

  // yt-dlp outputs: workspaceId_{videoId}.mp4 — scan for matching files
  try {
    const files = fs.readdirSync(storagePath).filter(f => f.startsWith(workspaceId + '_') && f.endsWith('.mp4'))
    for (const f of files) {
      videoSize += fs.statSync(path.join(storagePath, f)).size
    }
  } catch {}

  try {
    const blurPath = path.join(storagePath, `blur_${workspaceId}.jpg`)
    if (fs.existsSync(blurPath)) {
      blurSize = fs.statSync(blurPath).size
    }
  } catch {}

  return {
    video: parseFloat((videoSize / (1024**2)).toFixed(1)), // MB
    blur: parseFloat((blurSize / (1024**2)).toFixed(1)),
    total: parseFloat(((videoSize + blurSize) / (1024**2)).toFixed(1)),
  }
}