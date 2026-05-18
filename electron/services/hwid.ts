/**
 * Hardware ID — stable, non-reversible machine fingerprint for license binding.
 *
 * Strategy: SHA-256 hash of a composite identifier built from:
 *   - Machine UUID (most stable across reboots)
 *   - CPU id (raw processor name string)
 *   - Motherboard serial (SMBIOS)
 *
 * On Windows: uses WMIC / PowerShell to extract raw values.
 * On non-Windows: falls back to MAC + hostname + user-uid hash.
 *
 * The resulting hash is:
 *   - Non-reversible (no PII exposed)
 *   - Stable across reboots (unless hardware changes)
 *   - Unique enough to identify a single machine (collision practically impossible)
 */
import { execSync } from 'child_process'
import crypto from 'crypto'
import os from 'os'

// ─── Cache (module-level, computed once per process lifetime) ─────────────────
let _cachedHwid: string | null = null

// ─── Windows: extract hardware identifiers ─────────────────────────────────────
function wmicQuery(query: string): string {
  try {
    return execSync(`wmic ${query}`, { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
      .trim()
  } catch {
    return ''
  }
}

function getWindowsMachineId(): string {
  try {
    // CSProduct UUID — unique per Windows installation
    const uuid = wmicQuery('csproduct get uuid')
    const uuidMatch = uuid.match(/GUID\s*[:\-]?\s*([a-f0-9-]+)/i)
    if (uuidMatch) return uuidMatch[1].toLowerCase()
  } catch {}
  return ''
}

function getWindowsCPUId(): string {
  try {
    const cpu = wmicQuery('cpu get processorid')
    const match = cpu.match(/ProcessorId\s*[:\-]?\s*([a-f0-9]+)/i)
    if (match) return match[1].toUpperCase()
  } catch {}
  return ''
}

function getWindowsMotherboardSerial(): string {
  try {
    const baseboard = wmicQuery('baseboard get serialnumber')
    const match = baseboard.match(/SerialNumber\s*[:\-]?\s*([a-z0-9*\-]+)/i)
    if (match) return match[1].replace(/\*/g, 'X').trim()
  } catch {}
  return ''
}

function getWindowsDiskSerial(): string {
  try {
    const disk = wmicQuery('diskdrive get serialnumber')
    const match = disk.match(/SerialNumber\s*[:\-]?\s*([a-f0-9]+)/i)
    if (match) return match[1].toUpperCase()
  } catch {}
  return ''
}

// ─── Cross-platform entry point ────────────────────────────────────────────────
/** Get the stable hardware ID for this machine. Cached after first call. */
export function getMachineId(): string {
  if (_cachedHwid) return _cachedHwid

  let composite: string

  if (process.platform === 'win32') {
    const parts: string[] = []
    const uuid = getWindowsMachineId()
    const cpuId = getWindowsCPUId()
    const boardSerial = getWindowsMotherboardSerial()
    const diskSerial = getWindowsDiskSerial()

    if (uuid) parts.push(`uuid:${uuid}`)
    if (cpuId) parts.push(`cpu:${cpuId}`)
    if (boardSerial) parts.push(`mb:${boardSerial}`)
    if (diskSerial) parts.push(`disk:${diskSerial}`)

    if (parts.length === 0) {
      // Ultimate fallback: MAC + hostname + platform
      const mac = getPrimaryMAC()
      const hostname = os.hostname()
      composite = `fallback:mac=${mac},host=${hostname},plat=win32`
    } else {
      composite = parts.join('|')
    }
  } else {
    // macOS / Linux fallback
    const mac = getPrimaryMAC()
    const hostname = os.hostname()
    const uid = String(process.getuid?.() ?? 0)
    composite = `mac=${mac},host=${hostname},uid=${uid},plat=${process.platform}`
  }

  _cachedHwid = crypto.createHash('sha256').update(composite).digest('hex')
  return _cachedHwid
}

/** Short form for display (first 8 + last 4 chars). */
export function getMachineIdShort(): string {
  const id = getMachineId()
  return `${id.slice(0, 8).toUpperCase()}-${id.slice(-4).toUpperCase()}`
}

/** Get the primary MAC address (first non-loopback interface). */
function getPrimaryMAC(): string {
  try {
    if (process.platform === 'win32') {
      // WMIC approach — no PowerShell escaping issues
      try {
        const wmicOut = execSync(
          'wmic nic where "NetEnabled=true" get MACAddress /format:csv',
          { encoding: 'utf8', windowsHide: true, timeout: 10_000 }
        ).trim()
        const macMatch = wmicOut.match(/([0-9A-F]{2}[:-]){5}[0-9A-F]{2}/i)
        if (macMatch) return macMatch[0].toUpperCase().replace(/-/g, ':')
      } catch {}
    } else {
      const out = execSync("ip link show | grep ether | head -1 | awk '{print $2}'", {
        encoding: 'utf8', timeout: 10_000
      }).trim()
      if (out && out.length > 0) return out.toUpperCase()
    }
  } catch {}
  return 'UNKNOWNMAC'
}

/** Generate a random UUID (for development / fallback). */
export function generateFallbackId(): string {
  return crypto.randomUUID()
}
