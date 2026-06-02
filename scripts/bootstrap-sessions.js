#!/usr/bin/env node
/**
 * Bootstrap Chrome profiles for HyperClip.
 * Run with: node scripts/bootstrap-sessions.js [count]
 *
 * Copies SQLite cookies + Local State from Chrome's default profile
 * so all profiles are usable by Chrome immediately.
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

// ─── Resolve HyperClip base dir (mirrors electron/services/paths.ts) ──────────────
function resolveHyperClipBaseDir() {
  // Check known locations
  for (const candidate of ['C:\\HyperClip-Data', 'D:\\HyperClip-Data', 'E:\\HyperClip-Data', 'F:\\HyperClip-Data']) {
    if (fs.existsSync(path.join(candidate, 'chrome-profiles'))) return candidate
  }
  // Check env override
  if (process.env.HYPERCLIP_DATA_DIR) return process.env.HYPERCLIP_DATA_DIR
  // Fallback
  return 'C:\\HyperClip-Data'
}

const BASE_DIR = resolveHyperClipBaseDir()
const PROFILES_DIR = path.join(BASE_DIR, 'chrome-profiles')
const SETTINGS_FILE = path.join(BASE_DIR, 'app', 'settings.json')

// Chrome default profile (Session 1 source)
const CHROME_DEFAULT = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data', 'Default')
const CHROME_USER_DATA = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')

function getProfilePaths(profileId) {
  const dir = path.join(PROFILES_DIR, `profile-${profileId}`)
  return {
    dir,
    defaultDir: path.join(dir, 'Default'),
    networkDir: path.join(dir, 'Default', 'Network'),
    sqlite: path.join(dir, 'Default', 'Network', 'Cookies'),
    localState: path.join(dir, 'Local State'),
    json: path.join(dir, '_hyperclip_cookies.json'),
  }
}

function copyFile(src, dest) {
  try {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, fs.readFileSync(src))
      return true
    }
  } catch (e) {
    console.warn(`  [WARN] ${path.basename(src)} → ${dest}: ${e.message}`)
  }
  return false
}

async function main() {
  const TARGET = parseInt(process.argv[2]) || 30

  console.log(`\n🔧 HyperClip Session Bootstrap`)
  console.log(`   Base dir: ${BASE_DIR}`)
  console.log(`   Profiles dir: ${PROFILES_DIR}`)
  console.log(`   Chrome default: ${CHROME_DEFAULT}`)
  console.log(`   Target: ${TARGET} sessions\n`)

  // Source: Chrome default profile
  const srcSqlite = path.join(CHROME_DEFAULT, 'Network', 'Cookies')
  const srcLocalState = path.join(CHROME_USER_DATA, 'Local State')
  const srcJson = path.join(CHROME_USER_DATA, '_hyperclip_cookies.json')

  // Also check Alternate-Profile-1 path for JSON (some installs persist here)
  const altJson = path.join(CHROME_DEFAULT, '..', '_hyperclip_cookies.json')

  const srcJsonFinal = fs.existsSync(srcJson) ? srcJson : fs.existsSync(altJson) ? altJson : null

  if (!fs.existsSync(CHROME_DEFAULT)) {
    console.error('❌ Chrome default profile not found. Open Chrome and sign in first.')
    process.exit(1)
  }

  if (!fs.existsSync(srcSqlite) && !srcJsonFinal) {
    console.error('❌ No cookies found. Open YouTube in Chrome and sign in first.')
    process.exit(1)
  }

  console.log(`   Source SQLite: ${fs.existsSync(srcSqlite) ? '✅' : '❌'} ${srcSqlite}`)
  console.log(`   Source Local State: ${fs.existsSync(srcLocalState) ? '✅' : '❌'} ${srcLocalState}`)
  console.log(`   Source JSON: ${srcJsonFinal ? '✅' : '❌'} ${srcJsonFinal || 'not found'}\n`)

  let created = 0
  let copied = 0
  let skipped = 0

  for (let i = 1; i <= TARGET; i++) {
    const profileId = String(i)
    const p = getProfilePaths(profileId)
    const hasSQLite = fs.existsSync(p.sqlite)
    const hasJson = fs.existsSync(p.json)
    const hasLocalState = fs.existsSync(p.localState)
    const fullyInitialized = hasSQLite && hasJson

    if (fullyInitialized) {
      skipped++
      continue
    }

    // Create directory structure
    fs.mkdirSync(p.networkDir, { recursive: true })

    let profileCopied = false

    // 1. Copy SQLite cookies
    if (!hasSQLite && fs.existsSync(srcSqlite)) {
      if (copyFile(srcSqlite, p.sqlite)) {
        profileCopied = true
        copied++
      }
    }

    // 2. Copy Local State (encryption keys for Chrome)
    if (!hasLocalState && fs.existsSync(srcLocalState)) {
      copyFile(srcLocalState, p.localState)
      profileCopied = true
    }

    // 3. Copy JSON fast-path cookies (for HyperClip's extractYouTubeCookies)
    if (!hasJson && srcJsonFinal) {
      if (copyFile(srcJsonFinal, p.json)) {
        profileCopied = true
      }
    }

    if (profileCopied || created === 0) {
      created++
      console.log(`  [${profileCopied ? 'ADD' : 'INIT'}] Profile ${profileId} — SQLite=${hasSQLite ? '✓' : profileCopied ? 'copied' : 'missing'}, JSON=${hasJson ? '✓' : 'missing'}`)
    } else {
      console.log(`  [DONE] Profile ${profileId} — fully initialized`)
    }
  }

  // ─── Set Ultra hardwareProfile ────────────────────────────────────────────────────
  let settings = {}
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8').replace(/^﻿/, '')
      settings = JSON.parse(raw)
    }
  } catch {}

  const ultra = { vramGB: 16, ramGB: 64 }
  if (!settings.hardwareProfile || settings.hardwareProfile.vramGB !== 16) {
    settings.hardwareProfile = ultra
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
    console.log(`\n📝 Set hardwareProfile = Ultra (16GB VRAM / 64GB RAM)`)
  } else {
    console.log(`\n📝 hardwareProfile already Ultra — no change`)
  }

  console.log(`\n✅ ${created} new profiles, ${copied} SQLite copies, ${skipped} already done`)
  console.log(`🚀 Restart HyperClip to use ${TARGET} sessions.\n`)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
