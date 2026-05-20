/**
 * CDN Upload Script — Uploads build artifacts + updates manifest.json on the CDN.
 *
 * Usage:
 *   node scripts/upload-cdn.mjs --version 1.2.3 --file release/HyperClip-Setup-1.2.3.exe
 *
 * Environment:
 *   CDN_HOST      — e.g. cdn.hyperclip.io
 *   CDN_USER      — e.g. root
 *   CDN_KEY_PATH  — path to private SSH key (default: ~/.ssh/id_rsa)
 *   CDN_PATH      — e.g. /var/www/cdn.hyperclip.io/htdocs/updates
 *   CDN_USE_RSYNC — set to "1" to use rsync (recommended), "0" to use scp
 *
 * The CDN must serve files over HTTPS with a valid certificate.
 * electron-updater will read: {CDN_PATH}/manifest.json
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] })
)

const version = args.version || process.env.RELEASE_VERSION
const artifactFile = args.file
const cdnHost = process.env.CDN_HOST
const cdnUser = process.env.CDN_USER || 'root'
const cdnPath = process.env.CDN_PATH || '/var/www/cdn/updates'
const cdnKeyPath = process.env.CDN_KEY_PATH || path.join(process.env.HOME || 'C:\\Users\\MSI', '.ssh', 'id_rsa')
const dryRun = args['dry-run'] || false

if (!version) { console.error('Missing --version'); process.exit(1) }
if (!artifactFile || !fs.existsSync(artifactFile)) { console.error(`File not found: ${artifactFile}`); process.exit(1) }

console.log(`[CDN Upload] Version: ${version}`)
console.log(`[CDN Upload] File: ${artifactFile}`)
console.log(`[CDN Upload] CDN: ${cdnHost ? `${cdnUser}@${cdnHost}:${cdnPath}` : '(DRY RUN — set CDN_HOST to upload)'}`)

// ─── Compute checksums ───────────────────────────────────────────────────────────
function sha256(file) {
  const hash = crypto.createHash('sha256')
  const data = fs.readFileSync(file)
  hash.update(data)
  return hash.digest('hex')
}

function sha256Stream(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

const fileSha256 = sha256Stream(artifactFile)
const fileSize = fs.statSync(artifactFile).size
const fileName = path.basename(artifactFile)

console.log(`[CDN Upload] SHA256: ${fileSha256}`)
console.log(`[CDN Upload] Size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`)

// ─── Generate manifest ───────────────────────────────────────────────────────────
const manifest = {
  version,
  releaseDate: new Date().toISOString(),
  releaseNotes: `https://hyperclip.io/changelog#v${version}`,
  files: [{
    url: fileName,
    sha256: fileSha256,
    size: fileSize,
  }],
  path: fileName,
  sha256: fileSha256,
}

const manifestJSON = JSON.stringify(manifest, null, 2)
console.log(`[CDN Upload] Manifest:\n${manifestJSON}`)

// ─── Upload ─────────────────────────────────────────────────────────────────────
async function upload() {
  if (!cdnHost || dryRun) {
    console.log('[CDN Upload] DRY RUN — saving manifest locally')
    fs.mkdirSync('release/cdn', { recursive: true })
    fs.writeFileSync('release/cdn/manifest.json', manifestJSON)
    return
  }

  // Create version directory on CDN
  const versionDir = `${cdnPath}/${version}`
  const remoteFile = `${cdnUser}@${cdnHost}:${versionDir}/${fileName}`
  const remoteManifest = `${cdnUser}@${cdnHost}:${cdnPath}/manifest.json`
  const remoteIndex = `${cdnUser}@${cdnHost}:${cdnPath}/index.json`

  // SSH command helper
  const ssh = (cmd) => {
    const keyOpt = fs.existsSync(cdnKeyPath) ? `-i "${cdnKeyPath}"` : ''
    return execSync(`ssh ${keyOpt} ${cdnUser}@${cdnHost} "${cmd}"`, { stdio: 'inherit' })
  }

  console.log('[CDN Upload] Creating version directory...')
  try { ssh(`mkdir -p "${versionDir}"`) } catch {}

  console.log('[CDN Upload] Uploading artifact...')
  execSync(`scp ${fs.existsSync(cdnKeyPath) ? `-i "${cdnKeyPath}"` : ''} "${artifactFile}" "${remoteFile}"`, { stdio: 'inherit' })

  console.log('[CDN Upload] Uploading manifest...')
  fs.writeFileSync('/tmp/manifest.json', manifestJSON)
  execSync(`scp ${fs.existsSync(cdnKeyPath) ? `-i "${cdnKeyPath}"` : ''} /tmp/manifest.json "${remoteManifest}"`, { stdio: 'inherit' })

  console.log('[CDN Upload] Updating index.json...')
  try {
    let index = { versions: [] }
    try { index = JSON.parse(execSync(`ssh ${fs.existsSync(cdnKeyPath) ? `-i "${cdnKeyPath}"` : ''} ${cdnUser}@${cdnHost} "cat ${remoteIndex}"`, { encoding: 'utf8' })) } catch {}

    index.versions = (index.versions || []).filter(v => v.version !== version)
    index.versions.unshift({ version, releaseDate: manifest.releaseDate, file: fileName })
    index.latest = version

    fs.writeFileSync('/tmp/index.json', JSON.stringify(index, null, 2))
    execSync(`scp ${fs.existsSync(cdnKeyPath) ? `-i "${cdnKeyPath}"` : ''} /tmp/index.json "${remoteIndex}"`, { stdio: 'inherit' })
  } catch {}

  console.log(`[CDN Upload] DONE — manifest: https://${cdnHost}/manifest.json`)
}

upload().catch(err => { console.error('[CDN Upload] FAILED:', err); process.exit(1) })
