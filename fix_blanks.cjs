const fs = require('fs');
let content = fs.readFileSync('electron/services/ffmpeg.ts', 'utf8');

// Fix 1: remove -fps_mode cfr from after -i source_video
content = content.replace(
  "'-i', quotePath(source_video),\n    '-fps_mode', 'cfr',",
  "'-i', quotePath(source_video),"
);

// Fix 2: remove blank line after threads, add -fps_mode cfr before avoid_negative_ts
content = content.replace(
  "'-threads', String(numThreads),\n    \n    '-avoid_negative_ts'",
  "'-threads', String(numThreads),\n    '-fps_mode', 'cfr',\n    '-avoid_negative_ts'"
);

fs.writeFileSync('electron/services/ffmpeg.ts', content);
console.log('Done');
