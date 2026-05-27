const fs = require('fs')
const path = require('path')

function walk(dir, files = []) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) walk(path.join(dir, entry.name), files)
      else if (entry.name.endsWith('.tsx')) files.push(path.join(dir, entry.name))
    }
  } catch {}
  return files
}

const FILES = [
  ...walk('src/app/components'),
  ...walk('src/app/settings'),
  ...walk('src/app/onboarding'),
  'src/app/page.tsx', 'src/app/error.tsx', 'src/app/lib/utils.tsx',
  'src/app/workspaces/page.tsx', 'src/app/admin/page.tsx',
]

// Map: oldHex -> newToken
const MAP = {
  '#F5F5F5': 'colors.bg',
  '#F0F0F0': 'colors.bg',
  '#F8F8F8': 'colors.surfaceHover',
  '#E0E0E0': 'colors.border',
  '#EAEAEA': 'colors.borderLight',
  '#D0D0D0': 'colors.borderHover',
  '#1A1A1A': 'colors.text',
  '#888888': 'colors.textSecondary',
  '#AAAAAA': 'colors.textTertiary',
  '#aaa': 'colors.textTertiary',
  '#00B4FF': 'colors.accent',
  '#00FF88': 'colors.success',
  '#FF4444': 'colors.error',
  '#FFB800': 'colors.warning',
}

function getImportPath(filePath) {
  const rel = path.relative(path.dirname(filePath), 'src/app/design-system/tokens').replace(/\\/g, '/')
  return rel.startsWith('.') ? rel : './' + rel
}

for (const filePath of FILES) {
  if (!fs.existsSync(filePath)) continue
  let content = fs.readFileSync(filePath, 'utf-8')
  let changed = false

  for (const [hex, token] of Object.entries(MAP)) {
    // Replace only single-quoted strings: '#00B4FF' -> colors.accent
    const regex = new RegExp(`'${hex}'`, 'g')
    const updated = content.replace(regex, token)
    if (updated !== content) { content = updated; changed = true }
  }

  if (changed) {
    // Add import if missing
    if (!content.includes("design-system/tokens")) {
      const importPath = getImportPath(filePath)
      const importLine = `import { colors, spacing, fontSize } from '${importPath}'`
      if (content.startsWith("'use client'\n")) {
        content = content.replace("'use client'\n", `'use client'\n${importLine}\n`)
      } else {
        content = importLine + '\n' + content
      }
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`UPDATED ${filePath}`)
  }
}
console.log('Done')
