const fs = require('fs')
const path = require('path')

const files = [
  'electron/main.ts',
  'electron/services/cdp.ts',
  'electron/services/chrome_cookies.ts',
  'electron/services/cookie_manager.ts',
  'electron/services/diagnostics.ts',
  'electron/services/ffmpeg-paths.ts',
  'electron/services/ffmpeg.ts',
  'electron/services/innertube_client.ts',
  'electron/services/logger.ts',
  'electron/services/paths.ts',
  'electron/services/po_token.ts',
  'electron/services/project_manager.ts',
  'electron/services/ramdisk.ts',
  'electron/services/store.ts',
  'electron/services/subscription_feed.ts',
  'electron/services/system.ts',
  'electron/services/token_manager.ts',
  'electron/services/worker-pool.ts',
  'electron/services/youtube.ts',
  'electron/services/youtube_auth.ts',
  'electron/services/youtube_poller.ts',
  'electron/services/hwid.ts',
  'electron/services/crypto.ts',
  'electron/services/license.ts',
  'electron/services/e2e_server.ts',
  'electron/ipc/handlers/system.ts',
  'electron/ipc/handlers/auth.ts',
  'electron/ipc/handlers/project.ts',
  'electron/ipc/handlers/session.ts',
]

const byRule = {}
for (const f of files) {
  try {
    const content = fs.readFileSync(f, 'utf8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.includes('eslint-disable') || l.includes('// @ts-')) continue

      // Count things that might trigger rules
      // no-floating-promises: ;(async () => {
      if (l.match(/;\(async \(\) =>/)) {
        const rule = 'no-floating-promises (async IIFE)'
        byRule[rule] = byRule[rule] || []
        byRule[rule].push(f + ':' + (i + 1))
      }
      // void ... = { without await
      if (l.match(/void .+\(\).+\{/)) {
        const rule = 'no-floating-promises (void IIFE)'
        byRule[rule] = byRule[rule] || []
        byRule[rule].push(f + ':' + (i + 1))
      }
    }
  } catch {}
}

Object.keys(byRule).sort().forEach(r => {
  console.log(r + ': ' + byRule[r].length)
})
