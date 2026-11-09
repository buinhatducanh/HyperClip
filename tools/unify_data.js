const fs = require('fs');
const path = require('path');

const masterDataDir = path.resolve('HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip');

const targetDirs = [
  path.resolve('HyperClip-TestCustomer-20260616-224538/app/data/.hyperclip'),
  path.resolve('HyperClip-Data/.hyperclip'),
  path.join(process.env.APPDATA, 'HyperClip/.hyperclip')
];

const filesToSync = [
  'keys.json',
  'projects.json',
  'settings.json',
  'tiktok.json',
  'quota_ledger.json',
  'sentinel_counts.json',
  'shadow_ledger.jsonl',
  'watch_probe_ledger.jsonl'
];

console.log('=== Step 1: Unifying Data Directories ===');
console.log('Master data dir:', masterDataDir);

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

targetDirs.forEach(td => {
  if (!fs.existsSync(td)) fs.mkdirSync(td, { recursive: true });
  
  // 1. Copy channels dir
  const srcChannels = path.join(masterDataDir, 'channels');
  const dstChannels = path.join(td, 'channels');
  copyDirRecursive(srcChannels, dstChannels);
  console.log(`Synced channels to: ${td}/channels`);

  // 2. Copy individual master files
  filesToSync.forEach(f => {
    const s = path.join(masterDataDir, f);
    const d = path.join(td, f);
    if (fs.existsSync(s)) {
      fs.copyFileSync(s, d);
      console.log(`Synced ${f} -> ${td}`);
    }
  });
});

console.log('=== Step 1 Complete: All fallback dirs unified! ===\n');

