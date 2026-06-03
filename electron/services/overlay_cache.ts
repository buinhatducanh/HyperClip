import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { getHyperClipBaseDir } from './paths.js'
import { getFfmpegPath } from './ffmpeg-paths.js'
import { FONT_FILE } from './ffmpeg-shared.js'
import { devLog } from './unified_log.js'

// ─── Overlay cache (FIX 2026-06-02) ─────────────────────────────────────────────
// Pre-render bottom bar / title overlay PNGs ONCE per (settings, content) pair,
// then reuse across renders. The PNGs are stable on disk at fixed paths so the
// chunked render pipeline can pass them straight to ffmpeg as image inputs
// (no `drawtext` per frame → ~5-10× faster).
//
// Cache strategy:
//   1. Hash the (settings, content) tuple → key
//   2. PNG stored at D:\HyperClip-Data\config\overlays\<key>.png
//   3. Hash stored in `cache_keys.json` for inspection
//   4. Invalidate on settings save (ramdisk.saveSettings) or explicit call
//
// Single-color bottom bar (FIX 2026-06-02): removed the dark gradient overlay
// (was 60% black on top + 40% accent on bottom). User feedback: looks "wrong"
// with 2 colors. New design: solid accent color with white text, clean and
// minimal — works on any background.

const CACHE_DIR = path.join(getHyperClipBaseDir(), 'config', 'overlays')
const KEY_FILE = path.join(CACHE_DIR, 'cache_keys.json')

let _keys: Record<string, string> | null = null

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
  if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, '{}', 'utf-8')
}

function loadKeys(): Record<string, string> {
  if (_keys !== null) return _keys
  try {
    ensureCacheDir()
    _keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf-8'))
  } catch {
    _keys = {}
  }
  return _keys!
}

function saveKeys(keys: Record<string, string>): void {
  ensureCacheDir()
  fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2), 'utf-8')
  _keys = keys
}

function hashKey(parts: Record<string, unknown>): string {
  return crypto.createHash('md5').update(JSON.stringify(parts)).digest('hex').slice(0, 16)
}

function escapeDrawText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

async function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  const ffmpeg = getFfmpegPath()
  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let se = ''
    proc.stderr?.on('data', (d) => { se += d.toString() })
    proc.on('close', (code) => resolve({ code: code ?? 1, stderr: se }))
    proc.on('error', (e) => resolve({ code: -1, stderr: e.message }))
    setTimeout(() => {
      if (!proc.killed) proc.kill()
      resolve({ code: -2, stderr: 'timeout' })
    }, 30_000)
  })
}

// Generate a single-color bottom bar PNG: solid accent color + centered white text.
// No gradient, no border. One color only.
async function renderBottomBarPng(
  outputPath: string,
  canvasW: number,
  canvasH: number,
  bottomBarH: number,
  barText: string,
  colorHex: string,
): Promise<{ ok: boolean; error?: string }> {
  const bbFontSize = Math.max(28, Math.floor(bottomBarH * 0.35))
  const escapedText = escapeDrawText(barText)
  const args = [
    '-f', 'lavfi',
    '-i', `color=${colorHex}:s=${canvasW}x${bottomBarH}:d=1:r=30`,
    '-vf', `drawtext=text='${escapedText}':fontsize=${bbFontSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=${FONT_FILE}`,
    '-frames:v', '1',
    '-update', '1',
    '-y', outputPath,
  ]
  const r = await runFfmpeg(args)
  if (r.code !== 0 || !fs.existsSync(outputPath)) {
    return { ok: false, error: r.stderr.slice(0, 200) || `ffmpeg exited ${r.code}` }
  }
  return { ok: true }
}

// Generate a landscape-mode title overlay PNG: black border outline + white text.
async function renderTitleOverlayPng(
  outputPath: string,
  canvasW: number,
  titleBarH: number,
  titleText: string,
  colorHex: string,
): Promise<{ ok: boolean; error?: string }> {
  const borderPx = Math.max(5, Math.floor(titleBarH * 0.02))
  const titleFontSize = Math.max(28, Math.floor(titleBarH * 0.28))
  const escapedText = escapeDrawText(titleText)
  const filter =
    `color=black@0:s=${canvasW}x${titleBarH}:d=1:r=1,format=yuva420p[bg];` +
    `[bg]drawbox=x=${borderPx}:y=${borderPx}:w=${canvasW - borderPx * 2}:h=${titleBarH - borderPx * 2}:color=${colorHex}@1.0:t=${borderPx}[border];` +
    `[border]drawtext=text='${escapedText}':fontsize=${titleFontSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=${FONT_FILE}[out]`
  const args = [
    '-f', 'lavfi',
    '-i', `color=black@0:s=${canvasW}x${titleBarH}:d=1:r=1`,
    '-filter_complex', filter,
    '-map', '[out]',
    '-frames:v', '1',
    '-y', outputPath,
  ]
  const r = await runFfmpeg(args)
  if (r.code !== 0 || !fs.existsSync(outputPath)) {
    return { ok: false, error: r.stderr.slice(0, 200) || `ffmpeg exited ${r.code}` }
  }
  return { ok: true }
}

export interface OverlayParams {
  canvasW: number
  canvasH: number
  bottomBarH: number
  barText: string
  colorHex: string
}

/**
 * Get (or generate + cache) the bottom bar PNG for the given params.
 * Returns absolute path. PNG is cached in `D:\HyperClip-Data\config\overlays\`
 * keyed by an md5 hash of params — same params hit cache, different params regenerate.
 */
export async function getBottomBarPng(params: OverlayParams): Promise<string> {
  ensureCacheDir()
  const key = 'bottom_' + hashKey({ ...params })
  const cachedPath = path.join(CACHE_DIR, `${key}.png`)
  const keys = loadKeys()

  if (keys[`bottom`] === key && fs.existsSync(cachedPath)) {
    devLog(`[OverlayCache] HIT bottom bar: ${cachedPath}`)
    return cachedPath
  }

  // Cache miss or stale — regenerate. Delete old cached file if hash changed.
  if (keys[`bottom`] && keys[`bottom`] !== key) {
    const oldPath = path.join(CACHE_DIR, `${keys[`bottom`]}.png`)
    try { fs.unlinkSync(oldPath) } catch {}
  }

  const r = await renderBottomBarPng(
    cachedPath, params.canvasW, params.canvasH, params.bottomBarH, params.barText, params.colorHex
  )
  if (!r.ok) {
    devLog(`[OverlayCache] bottom bar render failed: ${r.error}`)
    return ''
  }
  keys[`bottom`] = key
  saveKeys(keys)
  devLog(`[OverlayCache] CACHED bottom bar: ${cachedPath}`)
  return cachedPath
}

export interface TitleOverlayParams {
  canvasW: number
  titleBarH: number
  titleText: string
  colorHex: string
}

export async function getTitleOverlayPng(params: TitleOverlayParams): Promise<string> {
  ensureCacheDir()
  const key = 'title_' + hashKey({ ...params })
  const cachedPath = path.join(CACHE_DIR, `${key}.png`)
  const keys = loadKeys()

  if (keys[`title`] === key && fs.existsSync(cachedPath)) {
    devLog(`[OverlayCache] HIT title overlay: ${cachedPath}`)
    return cachedPath
  }

  if (keys[`title`] && keys[`title`] !== key) {
    const oldPath = path.join(CACHE_DIR, `${keys[`title`]}.png`)
    try { fs.unlinkSync(oldPath) } catch {}
  }

  const r = await renderTitleOverlayPng(
    cachedPath, params.canvasW, params.titleBarH, params.titleText, params.colorHex
  )
  if (!r.ok) {
    devLog(`[OverlayCache] title overlay render failed: ${r.error}`)
    return ''
  }
  keys[`title`] = key
  saveKeys(keys)
  devLog(`[OverlayCache] CACHED title overlay: ${cachedPath}`)
  return cachedPath
}

/**
 * Invalidate the overlay cache — call when relevant settings change.
 * `reason` is for logging only.
 */
export function invalidateOverlayCache(reason = 'manual'): void {
  if (_keys === null) {
    try {
      if (fs.existsSync(KEY_FILE)) _keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf-8'))
      else _keys = {}
    } catch { _keys = {} }
  }
  const keys = _keys!
  for (const slot of ['bottom', 'title']) {
    if (keys[slot]) {
      const p = path.join(CACHE_DIR, `${keys[slot]}.png`)
      try { fs.unlinkSync(p) } catch {}
    }
    keys[slot] = ''
  }
  saveKeys(keys)
  devLog(`[OverlayCache] invalidated (reason: ${reason})`)
}
