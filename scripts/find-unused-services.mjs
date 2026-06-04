// Find unused services by reading files in memory
import fs from 'fs'
import path from 'path'

const root = process.cwd()
const servicesDir = path.join(root, 'electron', 'services')

const EXCLUDE = new Set(['node_modules', '.next', 'dist-electron', 'release', '.git', 'src-tauri', 'hyperclip', '.claude', 'hyperclip-core'])
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js'])

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (EXTS.has(path.extname(entry.name))) yield full
  }
}

const services = fs.readdirSync(servicesDir)
  .filter(f => f.endsWith('.ts'))
  .map(f => f.replace(/\.ts$/, ''))

// Build a single index: for each service, list of files that import it
const unused = []
for (const svc of services) {
  const pattern = new RegExp(`from\\s+['"][^'"]*[/]${svc}(\\.js)?['"]`)
  let found = false
  for (const file of walk(root)) {
    // Skip the service file itself
    if (file === path.join(servicesDir, `${svc}.ts`)) continue
    const text = fs.readFileSync(file, 'utf8')
    if (pattern.test(text)) {
      found = true
      break
    }
  }
  if (!found) {
    const filePath = path.join(servicesDir, `${svc}.ts`)
    const size = fs.statSync(filePath).size
    unused.push({ name: svc, size })
  }
}

console.log('UNUSED services (no importers anywhere):')
for (const { name, size } of unused) {
  console.log(`  ${name}.ts (${(size / 1024).toFixed(1)}KB)`)
}
const totalKb = unused.reduce((s, u) => s + u.size, 0) / 1024
console.log(`\nTotal: ${unused.length} files, ${totalKb.toFixed(1)}KB`)
