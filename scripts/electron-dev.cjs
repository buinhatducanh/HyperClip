// Electron dev launcher — spawns electron with ELECTRON_RUN_AS_NODE unset.
// The system bash environment has ELECTRON_RUN_AS_NODE=1 set, which makes
// electron run as plain Node.js (no electron API). This script clears it.
const { spawn } = require('child_process')
const path = require('path')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DEV_LOG = '1'

const electronPath = require('electron')
const mainPath = path.join(__dirname, '..', 'dist-electron', 'main.js')

const child = spawn(electronPath, [mainPath], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32', // Windows needs shell for electron binary resolution
  windowsHide: false
})

child.on('close', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('Failed to start electron:', err)
  process.exit(1)
})
