import * as fs from 'fs';

let content = fs.readFileSync('electron/services/ffmpeg.ts', 'utf8');

// Fix 1: Add -g 30 and remove -reconnect from getNvencParams standard mode
content = content.replace(
  /'-reconnect', '1',  \/\/ Handle stream interruption gracefully/,
  '-g', '30',         \/\/ GOP=30 frames (1 keyframe\/s) — prevents irregular GOP stuttering
);

// Fix 2: Remove trailing blank line after threads in renderVideo args
content = content.replace(
  \/'threads', String\(numThreads\),\n    \n    '-fps_mode'/,
  \/'threads', String(numThreads),\n    '-fps_mode'/
);

fs.writeFileSync('electron/services/ffmpeg.ts', content);
console.log('Done');
