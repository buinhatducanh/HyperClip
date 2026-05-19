const fs = require('fs')

const files = [
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
  'electron/main.ts',
]

for (const fname of files) {
  try {
    const content = fs.readFileSync(fname, 'utf8')
    const lines = content.split('\n')
    let changed = false

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed === '} catch {') {
        let usesE = false
        for (let j = 1; j <= 5 && i + j < lines.length; j++) {
          const l = lines[i + j]
          if (l && (l.includes('e)') || l.includes('e}') || l.includes('e as ') || l.includes('(e)') || l.includes('err: e'))) {
            usesE = true
            break
          }
        }
        if (usesE) {
          lines[i] = '} catch (e) {'
          if (i > 0 && !lines[i - 1].includes('eslint-disable')) {
            lines[i - 1] = lines[i - 1].replace(/\n$/, '') + ' // eslint-disable-line @typescript-eslint/no-unused-vars\n'
          }
          changed = true
        }
      }
    }

    if (changed) {
      fs.writeFileSync(fname, lines.join('\n'), 'utf8')
      console.log('Fixed: ' + fname)
    }
  } catch (e) {
    console.log('Error: ' + fname + ' - ' + e.message)
  }
}
