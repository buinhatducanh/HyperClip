const fs = require('fs');
let content = fs.readFileSync('electron/services/ffmpeg.ts', 'utf8');
content = content.replace(
  /('-threads', String\(numThreads\),\n    \n    '-avoid_negative_ts')/,
  "$1"
);
fs.writeFileSync('electron/services/ffmpeg.ts', content);
console.log('Done');
