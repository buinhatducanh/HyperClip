import { spawn, execSync } from 'child_process'
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import extract from 'extract-zip'

const require = createRequire(import.meta.url)

const root = process.cwd()
const env = { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'true' }

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    console.log(`> ${cmd} ${args.join(' ')}`)
    const child = spawn(cmd, args, { cwd: root, env, stdio: 'inherit', shell: true })
    child.on('close', (code) => {
      if (code === 0) resolve(code)
      else reject(new Error(`Exit code ${code}`))
    })
    child.on('error', reject)
  })
}

async function main() {
  try {
    // Resolve TypeScript binary robustly for both npm and pnpm installs.
    // Old code hardcoded pnpm's store path, which breaks when the repo is installed via npm.
    const tscPath = require.resolve('typescript/lib/tsc.js')

    // ── Step 0: Download and extract full CUDA FFmpeg ────────────────────────────
    const FFMPEG_URL = 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-full_build.zip'
    const FFMPEG_DEST = path.join(root, 'resources', 'ffmpeg', 'bin')
    const ZIP_PATH = path.join(root, 'ffmpeg-7.1-full_build.zip')

    if (!fs.existsSync(FFMPEG_DEST)) fs.mkdirSync(FFMPEG_DEST, { recursive: true })

    const ffmpegBin = path.join(FFMPEG_DEST, 'ffmpeg.exe')
    if (fs.existsSync(ffmpegBin)) {
      try {
        const out = execSync(`"${ffmpegBin}" -hide_banner -encoders 2>&1`, { timeout: 8000, encoding: 'utf-8' })
        if (out.includes('h264_nvenc')) {
          console.log('[build] FFmpeg CUDA build already present (NVENC OK)')
        } else {
          console.warn('[build] FFmpeg present but no NVENC — redownloading')
          fs.unlinkSync(ffmpegBin)
        }
      } catch {
        fs.unlinkSync(ffmpegBin)
      }
    }

    if (!fs.existsSync(ffmpegBin)) {
      console.log(`[build] Downloading FFmpeg full build (~177MB) from ${FFMPEG_URL}...`)
      const res = await fetch(FFMPEG_URL)
      if (!res.ok) throw new Error(`FFmpeg download failed: ${res.status} ${res.statusText}`)
      const buf = await res.arrayBuffer()
      fs.writeFileSync(ZIP_PATH, Buffer.from(buf))
      console.log('[build] Extracting FFmpeg...')
      await extract(ZIP_PATH, { dir: path.join(root, 'resources', 'ffmpeg') })
      fs.unlinkSync(ZIP_PATH)
      const extractedBin = path.join(root, 'resources', 'ffmpeg', 'ffmpeg-7.1-full_build', 'bin')
      if (fs.existsSync(extractedBin)) {
        for (const f of fs.readdirSync(extractedBin)) {
          const src = path.join(extractedBin, f)
          const dst = path.join(FFMPEG_DEST, f)
          if (!fs.existsSync(dst)) fs.renameSync(src, dst)
        }
        fs.rmSync(path.join(root, 'resources', 'ffmpeg', 'ffmpeg-7.1-full_build'), { recursive: true, force: true })
      }
      console.log('[build] FFmpeg CUDA build extracted to resources/ffmpeg/bin/')
    }

    // ── Step 0b: Download yt-dlp to resources/yt-dlp/ ───────────────────────────
    const YTDLP_DEST = path.join(root, 'resources', 'yt-dlp', 'yt-dlp.exe')
    if (!fs.existsSync(path.dirname(YTDLP_DEST))) fs.mkdirSync(path.dirname(YTDLP_DEST), { recursive: true })

    if (fs.existsSync(YTDLP_DEST)) {
      console.log('[build] yt-dlp already present')
    } else {
      console.log('[build] Downloading yt-dlp...')
      execSync(`node ${path.join(root, 'scripts', 'setup-ytdlp.mjs')}`, { stdio: 'inherit', cwd: root })
    }

    await run('npx', ['next', 'build']).catch(e => console.warn('[build] next build had errors (ignored):', e.message))
    await run('node', [tscPath, '-p', 'electron/tsconfig.main.json'])
    await run('node', [tscPath, '-p', 'electron/tsconfig.preload.json'])

    const mainJs = path.join(root, 'dist-electron', 'main.js')
    if (fs.existsSync(mainJs)) {
      let code = fs.readFileSync(mainJs, 'utf8')
      code = code.replace(/^const __dirname = .+;\n/gm, '')
      code = code.replace(/^const __filename = .+;\n/gm, '')
      fs.writeFileSync(mainJs, code)
      console.log('[build] Patched import.meta.url shim from main.js')
    }

    await run('npx', ['electron-builder', '--win', '--config', 'electron-builder.yml'])

    console.log('[build] Build complete!')

    const unpackedDir = path.join(root, 'release', 'win-unpacked')
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const version = pkg.version || '0.0.0'
    const zipPath = path.join(root, 'release', `HyperClip-portable-${version}.zip`)
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)

    console.log(`[build] Creating portable zip v${version} (7z)...`)
    await run('7z', ['a', '-tzip', zipPath, `${unpackedDir}/*`, '-mx=1'])
    const zipSize = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
    console.log(`[build] Portable zip: ${path.basename(zipPath)} (${zipSize} MB)`)
  } catch (e) {
    console.error('Build failed:', e.message)
    process.exit(1)
  }
}

main()
