import * as fs from 'fs';

let c = fs.readFileSync('electron/services/ffmpeg.ts', 'utf8');

// Fix 1: Add -g 30 GOP and remove -reconnect from getNvencParams standard mode
c = c.replace(
  "'-reconnect', '1',  // Handle stream interruption gracefully",
  "'-g', '30',         // GOP=30 frames (1 keyframe/s) — prevents irregular GOP stuttering"
);

// Fix 2: Remove blank line in renderVideo args
c = c.replace(
  "'-threads', String(numThreads),\n    \n    '-fps_mode'",
  "'-threads', String(numThreads),\n    '-fps_mode'"
);

fs.writeFileSync('electron/services/ffmpeg.ts', c);
console.log('Done');
