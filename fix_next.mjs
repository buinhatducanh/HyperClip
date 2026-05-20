import * as fs from 'fs';
const content = fs.readFileSync('electron/main.ts', 'utf8');
const marker = "const nextBin = path.join(nextDir, 'node_modules', 'next', 'dist', 'bin', 'next')";
const idx = content.indexOf(marker);
if (idx === -1) { console.log('NOT FOUND'); process.exit(1); }
console.log('Found at:', idx);
const oldBlock = `function startNextServer(): Promise<void> {
  const nextDir = path.join(__dirname, '..')
  const nextBin = path.join(nextDir, 'node_modules', 'next', 'dist', 'bin', 'next')`;
const newBlock = `function startNextServer(): Promise<void> {
  // Standalone output: .next/standalone/ contains self-contained server (no symlinks).
  const appRoot = path.join(__dirname, '..')
  const standaloneDir = path.join(appRoot, '.next', 'standalone')
  // Start the standalone Next.js server
  const nextBin = path.join(standaloneDir, 'node_modules', '.bin', 'next')`;
const newContent = content.replace(oldBlock, newBlock);
fs.writeFileSync('electron/main.ts', newContent);
console.log('Done');
