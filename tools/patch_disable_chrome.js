const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== STEP 1: KILL HYPERCLIP & TIKTOK CHROME PROCESSES ===');
try {
  try { execSync('taskkill /F /IM HyperClip.exe /T', { stdio: 'ignore' }); } catch (e) {}
  try { execSync('taskkill /F /IM hyperclip-tauri.exe /T', { stdio: 'ignore' }); } catch (e) {}
  console.log('HyperClip processes stopped.');

  // Kill any chrome running with TikTok-Profiles
  const psKillCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*TikTok-Profiles*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Killed TikTok Chrome PID: ' + $_.ProcessId) }"`;
  const killOut = execSync(psKillCmd).toString();
  console.log(killOut.trim() || 'No active TikTok Chrome instances found.');
} catch (e) {
  console.error('Process cleanup note:', e.message);
}

console.log('\n=== STEP 2: PATCH HYPERCLIP-TAURI.EXE BINARIES ===');
const targets = [
  path.join(__dirname, '..', 'app', '_internal', 'hyperclip-tauri.exe'),
  path.join(__dirname, '..', 'app', 'hyperclip-tauri.exe')
];

const SEARCH_STR = "Start-Process -FilePath '"; // 25 bytes
const REPL_STR   = "#" + " ".repeat(24);       // Exactly 25 bytes: '#                       '

for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.log(`File not found: ${target}`);
    continue;
  }
  console.log(`\nInspecting ${target}...`);
  const buf = fs.readFileSync(target);
  const searchBuf = Buffer.from(SEARCH_STR, 'utf8');
  const replBuf = Buffer.from(REPL_STR, 'utf8');

  if (searchBuf.length !== replBuf.length) {
    throw new Error(`Length mismatch! ${searchBuf.length} vs ${replBuf.length}`);
  }

  let index = buf.indexOf(searchBuf);
  if (index !== -1) {
    console.log(`Found target string "${SEARCH_STR}" at offset ${index} (0x${index.toString(16)})`);
    const bakFile = target + '.bak-pre-chrome-disable';
    if (!fs.existsSync(bakFile)) {
      fs.writeFileSync(bakFile, buf);
      console.log(`Created backup at ${bakFile}`);
    } else {
      console.log(`Backup already exists at ${bakFile}`);
    }
    
    // Patch in-place
    replBuf.copy(buf, index);
    fs.writeFileSync(target, buf);
    console.log(`Successfully patched ${target}! PowerShell spawn command is now neutralized as a comment ('#...').`);
  } else {
    const alreadyPatched = buf.indexOf(replBuf);
    if (alreadyPatched !== -1) {
      console.log(`Already patched at offset ${alreadyPatched}!`);
    } else {
      console.log(`Neither target nor replacement string found in ${target}`);
    }
  }
}

console.log('\nDone.');
