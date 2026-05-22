const fs = require('fs');
const path = require('path');
const os = require('os');

const projectsDir = path.join(os.homedir(), '.claude', 'projects');

function getJsonlFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      continue; // Skip inaccessible files/folders
    }
    if (stat.isDirectory()) {
      getJsonlFiles(fullPath, files);
    } else if (item.endsWith('.jsonl') && !item.endsWith('.bak')) {
      files.push({ path: fullPath, size: stat.size, mtime: stat.mtime });
    }
  }
  return files;
}

function run() {
  console.log(JSON.stringify({ status: 'info', message: `Scanning directory: ${projectsDir}` }));
  
  if (!fs.existsSync(projectsDir)) {
    console.log(JSON.stringify({ status: 'error', message: `Claude projects folder not found at ${projectsDir}` }));
    return;
  }
  
  const files = getJsonlFiles(projectsDir);
  console.log(JSON.stringify({ status: 'info', message: `Found ${files.length} session files.` }));
  
  // Sort files by modification time descending (newest first)
  files.sort((a, b) => b.mtime - a.mtime);
  
  let scannedCount = 0;
  let corruptedCount = 0;
  let fixedCount = 0;
  
  for (const file of files) {
    scannedCount++;
    const filePath = file.path;
    
    try {
      const buffer = fs.readFileSync(filePath);
      
      // Check for null bytes (0x00)
      let hasNull = false;
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === 0) {
          hasNull = true;
          break;
        }
      }
      
      if (hasNull) {
        corruptedCount++;
        
        console.log(JSON.stringify({
          status: 'corrupted',
          file: path.relative(projectsDir, filePath),
          fullPath: filePath,
          size: file.size
        }));
        
        // Backup the file
        const backupPath = `${filePath}.bak`;
        fs.copyFileSync(filePath, backupPath);
        
        // Filter out null bytes
        const cleanBuffer = Buffer.alloc(buffer.length);
        let cleanLength = 0;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] !== 0) {
            cleanBuffer[cleanLength] = buffer[i];
            cleanLength++;
          }
        }
        
        const finalBuffer = cleanBuffer.subarray(0, cleanLength);
        
        // Write back as raw clean buffer
        fs.writeFileSync(filePath, finalBuffer);
        fixedCount++;
        
        console.log(JSON.stringify({
          status: 'fixed',
          file: path.relative(projectsDir, filePath),
          cleanedSize: finalBuffer.length
        }));
      }
    } catch (e) {
      console.log(JSON.stringify({ status: 'warning', message: `Failed to process ${filePath}: ${e.message}` }));
    }
  }
  
  console.log(JSON.stringify({
    status: 'summary',
    scanned: scannedCount,
    corrupted: corruptedCount,
    fixed: fixedCount
  }));
}

try {
  run();
} catch (error) {
  console.log(JSON.stringify({ status: 'error', message: error.message }));
}
