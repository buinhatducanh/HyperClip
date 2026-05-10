import * as fs from 'fs'
const content = fs.readFileSync('src/app/lib/store.ts', 'utf8')
// Fix: }))) -> }))
const fixed = content.replace(/\}\)\)\)\)$/m, '})))\n')
fs.writeFileSync('src/app/lib/store.ts', fixed)
console.log('Fixed bracket count')
