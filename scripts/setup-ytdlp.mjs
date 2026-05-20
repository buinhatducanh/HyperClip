/**
 * Setup script: download yt-dlp.exe to resources/yt-dlp/
 * Run: node scripts/setup-ytdlp.mjs
 */
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

async function getLatestVersion() {
  const res = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.tag_name
}

async function main() {
  const version = await getLatestVersion()
  const REPO = 'yt-dlp/yt-dlp'
  const URL = `https://github.com/${REPO}/releases/download/${version}/yt-dlp.exe`
  const DEST = join(root, 'resources', 'yt-dlp', 'yt-dlp.exe')

  console.log(`Downloading yt-dlp ${version}...`)
  console.log(`From: ${URL}`)
  console.log(`To:   ${DEST}`)

  await mkdir(join(root, 'resources', 'yt-dlp'), { recursive: true })

  const response = await fetch(URL)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  await pipeline(response.body, createWriteStream(DEST))
  const { statSync } = await import('fs')
  const size = statSync(DEST).size
  console.log(`Done! yt-dlp.exe saved (${(size / 1024 / 1024).toFixed(1)} MB)`)
}

main().catch(e => {
  console.error('Failed:', e.message)
  process.exit(1)
})
