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
// Concept: "Play Button Pro" — professional 3D play button like CapCut/InShot
// Dark glass background + dimensional play circle + neon glow
// Works from 16px (simple) to 256px (detailed)

function makeSvg(size, variant = 'full') {
  const s = size
  const r = Math.round(s * 0.18) // corner radius

  const bg       = '#0D0D12'
  const blue     = '#00B4FF'
  const green    = '#00FF88'
  const darkBlue = '#004466'

  // ── 16/32px: Simple play button silhouette ──
  if (variant === 'small') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
      <rect width="${s}" height="${s}" rx="${r}" fill="${bg}"/>
      <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.34}" fill="#1a1a2e"/>
      <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.34}" fill="none" stroke="${blue}" stroke-width="${s*0.03}"/>
      <polygon points="${s*0.44},${s*0.36} ${s*0.66},${s*0.50} ${s*0.44},${s*0.64}" fill="${green}"/>
    </svg>`
  }

  // ── 48/64px: Play button with glow ──
  if (variant === 'medium') {
    const glow = s * 0.03
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
      <defs>
        <filter id="pg">
          <feGaussianBlur stdDeviation="${glow}" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <radialGradient id="pg2" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stop-color="#1e3a5f"/>
          <stop offset="100%" stop-color="#0a1628"/>
        </radialGradient>
      </defs>
      <rect width="${s}" height="${s}" rx="${r}" fill="${bg}"/>
      <!-- Glow ring -->
      <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.40}" fill="none" stroke="${blue}" stroke-width="${glow}" opacity="0.4" filter="url(#pg)"/>
      <!-- Button background -->
      <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.34}" fill="url(#pg2)"/>
      <!-- Button rim -->
      <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.34}" fill="none" stroke="${blue}" stroke-width="${s*0.025}"/>
      <!-- Play triangle -->
      <polygon points="${s*0.43},${s*0.36} ${s*0.65},${s*0.50} ${s*0.43},${s*0.64}" fill="${green}" filter="url(#pg)"/>
      <polygon points="${s*0.44},${s*0.37} ${s*0.63},${s*0.50} ${s*0.44},${s*0.63}" fill="#aaffcc"/>
    </svg>`
  }

  // ── 128/256px: Full professional 3D play button ──
  const glow = s * 0.03
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <defs>
      <!-- Background gradient: dark to darker -->
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#111118"/>
        <stop offset="100%" stop-color="#060610"/>
      </linearGradient>

      <!-- Radial glass effect on button body -->
      <radialGradient id="glass" cx="38%" cy="32%" r="68%">
        <stop offset="0%" stop-color="#1e4060"/>
        <stop offset="50%" stop-color="#0c1e36"/>
        <stop offset="100%" stop-color="#061224"/>
      </radialGradient>

      <!-- Blue rim gradient -->
      <linearGradient id="rim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#44CCFF"/>
        <stop offset="50%" stop-color="#00B4FF"/>
        <stop offset="100%" stop-color="#0066AA"/>
      </linearGradient>

      <!-- Play triangle gradient -->
      <linearGradient id="playGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#88FFBB"/>
        <stop offset="100%" stop-color="#00FF88"/>
      </linearGradient>

      <!-- Glow filter -->
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="${glow * 2.5}" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>

      <!-- Soft glow for bg -->
      <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="${glow}" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>

      <!-- Inner shadow / bevel for button -->
      <filter id="bevel">
        <feGaussianBlur in="SourceAlpha" stdDeviation="${s*0.015}" result="blur"/>
        <feOffset dx="${s*-0.01}" dy="${s*-0.01}" result="offset"/>
        <feComposite in="SourceGraphic" in2="offset" operator="over"/>
      </filter>

      <!-- Background film grid lines -->
      <pattern id="grid" width="${s*0.08}" height="${s*0.08}" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="${s*0.08}" stroke="#ffffff" stroke-width="${s*0.003}" opacity="0.03"/>
        <line x1="0" y1="0" x2="${s*0.08}" y2="0" stroke="#ffffff" stroke-width="${s*0.003}" opacity="0.03"/>
      </pattern>

      <!-- Clip path for grid -->
      <clipPath id="bgClip">
        <rect width="${s}" height="${s}" rx="${r}"/>
      </clipPath>
    </defs>

    <!-- Background -->
    <rect width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
    <!-- Subtle grid overlay -->
    <rect width="${s}" height="${s}" rx="${r}" fill="url(#grid)" clip-path="url(#bgClip)"/>

    <!-- Decorative: thin top-left highlight -->
    <rect width="${s}" height="${s}" rx="${r}" fill="none"
      stroke="#ffffff" stroke-width="${s*0.005}" opacity="0.06"
      stroke-dasharray="${s*0.25} ${s*0.5}" stroke-dashoffset="${s*0.1}"/>

    <!-- Outer glow halo -->
    <circle cx="${s*0.5}" cy="${s*0.48}" r="${s*0.42}"
      fill="none" stroke="${blue}" stroke-width="${glow * 1.5}" opacity="0.2" filter="url(#softGlow)"/>

    <!-- Button shadow (below) -->
    <circle cx="${s*0.5}" cy="${s*0.49}" r="${s*0.36}"
      fill="#000000" opacity="0.4" filter="url(#softGlow)"/>

    <!-- Button body (glass circle) -->
    <circle cx="${s*0.5}" cy="${s*0.48}" r="${s*0.36}" fill="url(#glass)"/>

    <!-- Button rim (gradient border) -->
    <circle cx="${s*0.5}" cy="${s*0.48}" r="${s*0.36}"
      fill="none" stroke="url(#rim)" stroke-width="${s*0.025}" filter="url(#glow)"/>

    <!-- Inner highlight arc (top of circle — glass reflection) -->
    <ellipse cx="${s*0.43}" cy="${s*0.33}" rx="${s*0.18}" ry="${s*0.08}"
      fill="#ffffff" opacity="0.07"/>

    <!-- Play triangle: outer glow -->
    <polygon
      points="${s*0.43},${s*0.33} ${s*0.67},${s*0.48} ${s*0.43},${s*0.63}"
      fill="${green}" opacity="0.25" filter="url(#softGlow)"
      transform="translate(${s*0.012}, ${s*0.008})"/>

    <!-- Play triangle: main shape -->
    <polygon
      points="${s*0.43},${s*0.34} ${s*0.66},${s*0.48} ${s*0.43},${s*0.62}"
      fill="url(#playGrad)"/>

    <!-- Play triangle: highlight edge -->
    <polygon
      points="${s*0.43},${s*0.34} ${s*0.52},${s*0.42} ${s*0.43},${s*0.50}"
      fill="#ccffee" opacity="0.25"/>

    <!-- HC text -->
    <text x="${s*0.5}" y="${s*0.92}" text-anchor="middle"
      font-family="Arial,sans-serif" font-size="${s*0.075}" font-weight="800"
      fill="${blue}" opacity="0.65" letter-spacing="${s*0.015}">HC</text>
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
