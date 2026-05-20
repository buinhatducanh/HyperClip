/**
 * HyperClip Icon Generator
 * Creates a professional multi-size icon set from SVG design.
 *
 * Brand colors:
 *   Primary:   #00B4FF (electric blue)
 *   Secondary: #00FF88 (neon green)
 *   Accent:    #00B4FF with glow
 *   Background:#0D0D12 (near-black)
 *
 * Sizes generated:
 *   - icon.png (256x256) → main app icon
 *   - icon.ico (multi-resolution: 16,32,48,64,128,256)
 *   - favicon.ico (32x32)
 *   - apple-touch-icon.png (180x180)
 */

import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const buildDir = join(rootDir, 'build')
const resourcesDir = join(rootDir, 'resources')

// ─── SVG Design ────────────────────────────────────────────────────────────────
// Concept: "H-Clip" — stylized H with play button, vertical-video motif
// Works from 16px (simple) to 256px (detailed)

function makeSvg(size, variant = 'full') {
  const s = size
  const r = Math.round(s * 0.18) // corner radius

  // Accent colors
  const bg     = '#0D0D12'
  const blue   = '#00B4FF'
  const green  = '#00FF88'
  const dimBlue= '#0070A0'

  if (variant === 'small') {
    // 16/32px: simplified — just H shape
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
      <rect width="${s}" height="${s}" rx="${r}" fill="${bg}"/>
      <rect x="${s*0.20}" y="${s*0.22}" width="${s*0.12}" height="${s*0.56}" rx="${s*0.04}" fill="${blue}"/>
      <rect x="${s*0.40}" y="${s*0.22}" width="${s*0.40}" height="${s*0.20}" rx="${s*0.04}" fill="${blue}"/>
      <rect x="${s*0.40}" y="${s*0.58}" width="${s*0.40}" height="${s*0.20}" rx="${s*0.04}" fill="${blue}"/>
      <rect x="${s*0.68}" y="${s*0.22}" width="${s*0.12}" height="${s*0.56}" rx="${s*0.04}" fill="${blue}"/>
      <polygon points="${s*0.50},${s*0.44} ${s*0.66},${s*0.50} ${s*0.50},${s*0.56}" fill="${green}"/>
    </svg>`
  }

  if (variant === 'medium') {
    // 48/64px: adds glow ring
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
      <rect width="${s}" height="${s}" rx="${r}" fill="${bg}"/>
      <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.44}" fill="none" stroke="${dimBlue}" stroke-width="${s*0.04}"/>
      <!-- H shape -->
      <rect x="${s*0.22}" y="${s*0.24}" width="${s*0.12}" height="${s*0.52}" rx="${s*0.04}" fill="${blue}"/>
      <rect x="${s*0.40}" y="${s*0.24}" width="${s*0.20}" height="${s*0.19}" rx="${s*0.03}" fill="${blue}"/>
      <rect x="${s*0.40}" y="${s*0.57}" width="${s*0.20}" height="${s*0.19}" rx="${s*0.03}" fill="${blue}"/>
      <rect x="${s*0.66}" y="${s*0.24}" width="${s*0.12}" height="${s*0.52}" rx="${s*0.04}" fill="${blue}"/>
      <!-- Play triangle -->
      <polygon points="${s*0.51},${s*0.44} ${s*0.66},${s*0.50} ${s*0.51},${s*0.56}" fill="${green}"/>
    </svg>`
  }

  // 128/256px: full detail with glow + gradient + text
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#12121a"/>
        <stop offset="100%" stop-color="#08080e"/>
      </linearGradient>
      <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#33C8FF"/>
        <stop offset="100%" stop-color="#0088CC"/>
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="${s*0.025}" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="greenGlow">
        <feGaussianBlur stdDeviation="${s*0.015}" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <!-- Background -->
    <rect width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>

    <!-- Outer ring glow -->
    <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.46}" fill="none" stroke="${dimBlue}" stroke-width="${s*0.03}" opacity="0.6"/>

    <!-- Vertical bars of H (clip/bracket motif) -->
    <rect x="${s*0.18}" y="${s*0.20}" width="${s*0.13}" height="${s*0.60}" rx="${s*0.05}" fill="url(#blueGrad)" filter="url(#glow)"/>
    <rect x="${s*0.69}" y="${s*0.20}" width="${s*0.13}" height="${s*0.60}" rx="${s*0.05}" fill="url(#blueGrad)" filter="url(#glow)"/>

    <!-- Crossbar of H -->
    <rect x="${s*0.31}" y="${s*0.20}" width="${s*0.38}" height="${s*0.17}" rx="${s*0.04}" fill="url(#blueGrad)" filter="url(#glow)"/>
    <rect x="${s*0.31}" y="${s*0.63}" width="${s*0.38}" height="${s*0.17}" rx="${s*0.04}" fill="url(#blueGrad)" filter="url(#glow)"/>

    <!-- Clip notch marks (accent detail) -->
    <rect x="${s*0.18}" y="${s*0.20}" width="${s*0.13}" height="${s*0.04}" rx="${s*0.02}" fill="${green}" opacity="0.9"/>
    <rect x="${s*0.18}" y="${s*0.76}" width="${s*0.13}" height="${s*0.04}" rx="${s*0.02}" fill="${green}" opacity="0.9"/>
    <rect x="${s*0.69}" y="${s*0.20}" width="${s*0.13}" height="${s*0.04}" rx="${s*0.02}" fill="${green}" opacity="0.9"/>
    <rect x="${s*0.69}" y="${s*0.76}" width="${s*0.13}" height="${s*0.04}" rx="${s*0.02}" fill="${green}" opacity="0.9"/>

    <!-- Play triangle (centered in H crossbar area) -->
    <polygon points="${s*0.50},${s*0.34} ${s*0.68},${s*0.50} ${s*0.50},${s*0.66}" fill="${green}" filter="url(#greenGlow)"/>

    <!-- Small "HC" micro-text below play button -->
    <text x="${s*0.5}" y="${s*0.86}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${s*0.07}" font-weight="700" fill="${blue}" opacity="0.7" letter-spacing="${s*0.03}">HC</text>
  </svg>`
}

// ─── Generate PNG at specific size ───────────────────────────────────────────
async function generatePng(size, variant) {
  const svg = Buffer.from(makeSvg(size, variant))
  return sharp(svg)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(resourcesDir, { recursive: true })

  console.log('Generating HyperClip icons...')

  // 1. 256x256 full PNG → build/icon.png
  const png256 = await generatePng(256, 'full')
  writeFileSync(join(buildDir, 'icon.png'), png256)
  console.log('  ✓ build/icon.png (256x256)')

  // 2. 512x512 full PNG → for apple-touch-icon
  const png512 = await generatePng(512, 'full')
  const png180 = await sharp(png512).resize(180, 180).png({ compressionLevel: 9 }).toBuffer()
  writeFileSync(join(buildDir, 'apple-touch-icon.png'), png180)
  console.log('  ✓ build/apple-touch-icon.png (180x180)')

  // 3. Multi-resolution ICO
  const sizes = [
    { size: 16,  variant: 'small'  },
    { size: 32,  variant: 'small'  },
    { size: 48,  variant: 'medium' },
    { size: 64,  variant: 'medium' },
    { size: 128, variant: 'full'   },
    { size: 256, variant: 'full'   },
  ]

  const pngBuffers = []
  for (const { size, variant } of sizes) {
    pngBuffers.push(await generatePng(size, variant))
  }

  // png-to-ico expects array of Buffer or file paths
  const icoBuffer = await pngToIco(pngBuffers)
  writeFileSync(join(buildDir, 'icon.ico'), icoBuffer)
  console.log('  ✓ build/icon.ico (16+32+48+64+128+256)')

  // Copy to resources/
  writeFileSync(join(resourcesDir, 'icon.ico'), icoBuffer)
  const png256Copy = await sharp(png256).resize(64, 64).png({ compressionLevel: 9 }).toBuffer()
  writeFileSync(join(resourcesDir, 'icon.png'), png256Copy)
  console.log('  ✓ resources/icon.{ico,png}')

  // 4. Favicon (32x32 ico)
  const favIco = await pngToIco([await generatePng(32, 'small')])
  writeFileSync(join(buildDir, 'favicon.ico'), favIco)
  console.log('  ✓ build/favicon.ico (32x32)')

  // 5. SVG for web
  const svgFull = makeSvg(512, 'full')
  writeFileSync(join(buildDir, 'icon.svg'), Buffer.from(svgFull))
  console.log('  ✓ build/icon.svg (vector)')

  console.log('\nIcon generation complete!')
}

main().catch(e => { console.error(e); process.exit(1) })
