const { execSync } = require('child_process')

const dirs = [
  'electron/main.ts',
  'electron/preload.ts',
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
  'electron/services/encrypted_yaml.ts',
  'electron/ipc/handlers/system.ts',
  'electron/ipc/handlers/auth.ts',
  'electron/ipc/handlers/project.ts',
  'electron/ipc/handlers/session.ts',
]

for (const f of dirs) {
  try {
    const out = execSync(`npx eslint "${f}" 2>&1`, { cwd: process.cwd(), encoding: 'utf8' })
    const errors = out.split('\n').filter(l => l.includes('error'))
    if (errors.length > 0) {
      console.log('=== ' + f + ' ===')
      errors.forEach(e => console.log('  ' + e.trim()))
    }
  } catch (e) {
    const out = e.stdout || ''
    const errors = (out).split('\n').filter(l => l.includes('error'))
    if (errors.length > 0) {
      console.log('=== ' + f + ' ===')
      errors.forEach(e => console.log('  ' + e.trim()))
    }
  }
}
