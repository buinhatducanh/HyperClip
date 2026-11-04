const fs = require('fs');
const path = require('path');

const targetFiles = [
  path.resolve('D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/resources/innertube_helper.js'),
  path.resolve('D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/innertube_helper.js'),
  path.resolve('D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/app/_internal/resources/innertube_helper.js'),
];

for (const filePath of targetFiles) {
  if (!fs.existsSync(filePath)) {
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Fix missing splitPlan in resolveMediaNative
  content = content.replace(
    /const maxHeight = req\.maxHeight \|\| 360;\r?\n\s*const isSmartSplit = !!\(splitPlan && splitPlan\.enabled\);/g,
    "const maxHeight = req.maxHeight || 360;\n  const splitPlan = getSmartSplitPlan();\n  const isSmartSplit = !!(splitPlan && splitPlan.enabled);"
  );

  // 2. Fix ffmpeg path for local slice of Part 2 & Part 3
  const oldSliceFfmpeg = `dlog(\`[smart-split] Local slice for Part \${partNum} [\${startSec}s..\${startSec + durSec}s] (\${durSec}s) from master to \${outputPath}\`);
      const ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');`;

  const newSliceFfmpeg = `dlog(\`[smart-split] Local slice for Part \${partNum} [\${startSec}s..\${startSec + durSec}s] (\${durSec}s) from master to \${outputPath}\`);
      let ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg_real.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = 'D:\\\\HyperClip\\\\HyperClip-TestCustomer-20260616-224538\\\\app\\\\_internal\\\\resources\\\\ffmpeg\\\\bin\\\\ffmpeg_real.exe';`;

  if (content.includes("const ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');")) {
    content = content.replace(
      "const ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');",
      `let ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg_real.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = 'D:\\\\HyperClip\\\\HyperClip-TestCustomer-20260616-224538\\\\app\\\\_internal\\\\resources\\\\ffmpeg\\\\bin\\\\ffmpeg_real.exe';`
    );
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Patched:', filePath);
}
console.log('All innertube_helper.js files successfully patched!');
