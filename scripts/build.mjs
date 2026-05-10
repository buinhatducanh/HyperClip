import { spawn } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const root = process.cwd()
const env = { ...process.env, NODE_ENV: 'production' }

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    console.log(`> ${cmd} ${args.join(' ')}`)
    const child = spawn(cmd, args, { cwd: root, env, stdio: 'inherit', shell: true })
    child.on('close', (code) => {
      if (code === 0) resolve(code)
      else reject(new Error(`Exit code ${code}`))
    })
    child.on('error', reject)
  })
}

async function main() {
  try {
    await run('npx', ['next', 'build'])
    await run('npx', ['tsc', '-p', 'electron/tsconfig.main.json'])
    await run('npx', ['tsc', '-p', 'electron/tsconfig.preload.json'])
    await run('npx', ['electron-builder', '--win', '--config', 'electron-builder.yml'])
    console.log('Build complete!')
  } catch (e) {
    console.error('Build failed:', e.message)
    process.exit(1)
  }
}

main()
