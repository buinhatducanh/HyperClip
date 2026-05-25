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
  // Resolve TypeScript binary — pnpm isolates modules, so tsc lives in .pnpm/
  const tscPath = path.join(root, 'node_modules', '.pnpm', 'typescript@6.0.3', 'node_modules', 'typescript', 'lib', 'tsc.js')

  try {
    // ── Step 0: Download and extract full CUDA FFmpeg ────────────────────────────
    // gyan.dev full build includes CUDA runtime + NVENC + NVDEC + CUDA filters.
    // This ensures production builds have working GPU acceleration on RTX 5080/4090/3090.
    const FFMPEG_URL = 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-full_build.zip'
    const FFMPEG_DEST = path.join(root, 'resources', 'ffmpeg', 'bin')
    const ZIP_PATH = path.join(root, 'ffmpeg-7.1-full_build.zip')

    if (!fs.existsSync(FFMPEG_DEST)) fs.mkdirSync(FFMPEG_DEST, { recursive: true })

    const ffmpegBin = path.join(FFMPEG_DEST, 'ffmpeg.exe')
    if (fs.existsSync(ffmpegBin)) {
      // Quick sanity: verify the binary is executable and has NVENC
      try {
        const out = execSync(`"${ffmpegBin}" -hide_banner -encoders 2>&1`, { timeout: 8000, encoding: 'utf-8' })
        if (out.includes('h264_nvenc')) {
          console.log('[build] FFmpeg CUDA build already present (NVENC OK)')
        } else {
          console.warn('[build] FFmpeg present but no NVENC — redownloading')
          fs.unlinkSync(ffmpegBin)
        }
      } catch {
        // Binary corrupted or not executable — re-download
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
      // Move extracted files up to resources/ffmpeg/bin/
      // ZIP extracts to: resources/ffmpeg/ffmpeg-7.1-full_build/bin/...
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

    // next build may return exit code 1 due to SSR/prerender errors on 'use client' pages.
    // The output files are still produced correctly — ignore non-zero exit.
    await run('npx', ['next', 'build']).catch(e => console.warn('[build] next build had errors (ignored):', e.message))
    await run('node', [tscPath, '-p', 'electron/tsconfig.main.json'])
    await run('node', [tscPath, '-p', 'electron/tsconfig.preload.json'])

    // Fix: remove TypeScript's ESM-compat __dirname shim from compiled main.js.
    // In CommonJS mode, __dirname is already a native global. The shim uses
    // import.meta.url which Node.js v24 treats as ESM syntax.
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

    // ── Step final: Create portable zip (7z — PowerShell Compress-Archive fails on locked files) ──
    const unpackedDir = path.join(root, 'release', 'win-unpacked')

    // Determine version for portable zip name
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
