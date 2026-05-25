/**
 * Export Demo Projects — run on the machine that has HyperClip-Data/
 * Exports 30 GCP project credentials as plain JSON for demo bundle.
 *
 * Usage:
 *   node scripts/export-demo-projects.mjs
 *
 * Output: demo-data/projects/{proj-id}/config.json
 *   These are plain JSON (no encryption) — credentials are public Google Cloud info.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PROJECTS_DIR = process.env.HYPERCLIP_DATA_DIR || 'D:\\HyperClip-Data\\projects'
const OUTPUT_DIR = path.join(ROOT, 'demo-data', 'projects')

// ─── Hardware ID (same algorithm as electron/services/hwid.ts) ──────────────────
import { execSync } from 'child_process'

function wmicQuery(query) {
  try {
    return execSync(`wmic ${query}`, { encoding: 'utf8', timeout: 10_000 }).trim()
  } catch { return '' }
}

function getMachineId() {
  const uuid = wmicQuery('csproduct get uuid')
  const uuidMatch = uuid.match(/GUID\s*[:-]?\s*([a-f0-9-]+)/i)
  const uuidVal = uuidMatch ? uuidMatch[1].toLowerCase() : ''
  const cpu = wmicQuery('cpu get processorid')
  const cpuMatch = cpu.match(/ProcessorId\s*[:-]?\s*([a-f0-9]+)/i)
  const cpuVal = cpuMatch ? cpuMatch[1].toUpperCase() : ''
  const board = wmicQuery('baseboard get serialnumber')
  const boardMatch = board.match(/SerialNumber\s*[:-]?\s*([a-z0-9*-]+)/i)
  const boardVal = boardMatch ? boardMatch[1].replace(/\*/g, 'X').trim() : ''
  const disk = wmicQuery('diskdrive get serialnumber')
  const diskMatch = disk.match(/SerialNumber\s*[:-]?\s*([a-f0-9]+)/i)
  const diskVal = diskMatch ? diskMatch[1].toUpperCase() : ''

  const parts = []
  if (uuidVal) parts.push(`uuid:${uuidVal}`)
  if (cpuVal) parts.push(`cpu:${cpuVal}`)
  if (boardVal) parts.push(`mb:${boardVal}`)
  if (diskVal) parts.push(`disk:${diskVal}`)

  const composite = parts.length > 0 ? parts.join('|') : `fallback:host=${os.hostname()}`
  return crypto.createHash('sha256').update(composite).digest('hex')
}

// ─── AES-256-GCM decrypt ────────────────────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 32
const PBKDF2_ITERATIONS = 100_000

function decrypt(blob, machineId) {
  const key = crypto.pbkdf2Sync(
    machineId,
    Buffer.from(blob.salt, 'hex'),
    PBKDF2_ITERATIONS,
    32, 'sha256'
  )
  const iv = Buffer.from(blob.iv, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(Buffer.from(blob.tag, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(blob.data, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

// ─── Parse encrypted YAML ───────────────────────────────────────────────────────
function parseYAMLBlob(raw) {
  const lines = raw.split('\n')
  const get = (key) => {
    const line = lines.find(l => l.startsWith(`${key}:`))
    if (!line) throw new Error(`Missing key: ${key}`)
    return line.replace(`${key}:`, '').replace(/^["\s]+|["\s]+$/g, '').trim()
  }
  const dataIdx = lines.findIndex(l => l.startsWith('data:'))
  const dataLines = lines.slice(dataIdx + 1)
  return {
    version: parseInt(get('version')),
    iv: get('iv'),
    salt: get('salt'),
    tag: get('tag'),
    data: dataLines.join(''),
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────────
const machineId = getMachineId()
console.log(`Machine ID: ${machineId.slice(0, 8)}...`)
console.log(`Source: ${PROJECTS_DIR}`)
console.log(`Output: ${OUTPUT_DIR}`)
console.log('')

if (!fs.existsSync(PROJECTS_DIR)) {
  console.error(`ERROR: Projects directory not found: ${PROJECTS_DIR}`)
  console.error('Set HYPERCLIP_DATA_DIR env var if your data is elsewhere.')
  process.exit(1)
}

const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
const projectDirs = entries.filter(e => e.isDirectory())

console.log(`Found ${projectDirs.length} projects`)
console.log('')

let exported = 0
for (const entry of projectDirs) {
  const projectId = entry.name
  const encPath = path.join(PROJECTS_DIR, projectId, 'config.enc.yaml')

  if (!fs.existsSync(encPath)) {
    console.log(`  SKIP ${projectId}: no config.enc.yaml`)
    continue
  }

  try {
    const yamlContent = fs.readFileSync(encPath, 'utf8')
    const blob = parseYAMLBlob(yamlContent)
    const plaintext = decrypt(blob, machineId)
    const config = JSON.parse(plaintext)

    // Write as plain JSON (credentials are public info)
    const outDir = path.join(OUTPUT_DIR, projectId)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(
      path.join(outDir, 'config.json'),
      JSON.stringify(config, null, 2)
    )

    console.log(`  EXPORTED ${projectId}: ${config.projectName || projectId}`)
    exported++
  } catch (err) {
    console.log(`  ERROR ${projectId}: ${err.message}`)
  }
}

console.log('')
console.log(`Exported ${exported}/${projectDirs.length} projects`)
console.log(`Output: ${OUTPUT_DIR}`)
