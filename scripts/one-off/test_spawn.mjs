const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const resourcesPath = process.env.HYPERCLIP_RESOURCES || 'D:\\LOOP_COMPANY\\HyperClip\\release\\win-unpacked\\resources';
const nextBin = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'next', 'dist', 'bin', 'next');

console.log('Resources:', resourcesPath);
console.log('Next bin:', nextBin);
console.log('Next exists:', fs.existsSync(nextBin));
console.log('cwd:', resourcesPath);
console.log('cwd exists:', fs.existsSync(resourcesPath));
console.log('.next exists:', fs.existsSync(path.join(resourcesPath, '.next')));

const child = spawn(process.execPath.replace(/\\node\.exe$/, '\\node.exe'), [nextBin, '-p', '3003'], {
  cwd: resourcesPath,
  stdio: 'pipe'
});

let stdout = '', stderr = '';
child.stdout.on('data', d => { stdout += d; process.stdout.write('[next] ' + d); });
child.stderr.on('data', d => { stderr += d; process.stderr.write('[next] ' + d); });
child.on('error', e => console.error('Spawn error:', e));
child.on('close', (code, sig) => {
  console.log('Next.js exited:', code, sig);
  console.log('stdout:', stdout.substring(0, 500));
  console.log('stderr:', stderr.substring(0, 500));
  process.exit(0);
});
setTimeout(() => {
  console.log('Still running after 20s - good!');
  child.kill();
  process.exit(0);
}, 20000);
