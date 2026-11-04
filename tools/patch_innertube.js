const fs = require('fs');
const path = require('path');

const filePath = path.resolve('D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/resources/innertube_helper.js');
// Restore from clean backup if exists
if (fs.existsSync(filePath + '.bak')) {
  fs.copyFileSync(filePath + '.bak', filePath);
}
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add getSmartSplitPlan if not present
if (!content.includes('function getSmartSplitPlan()')) {
  const helperCode = `
function getSmartSplitPlan() {
  try {
    const fs = require('fs');
    const path = require('path');
    const possiblePaths = [
      process.env.HYPERCLIP_DATA_DIR ? path.join(process.env.HYPERCLIP_DATA_DIR, '.hyperclip', 'settings.json') : null,
      process.env.HYPERCLIPB_DATA_DIR ? path.join(process.env.HYPERCLIPB_DATA_DIR, '.hyperclip', 'settings.json') : null,
      path.resolve(__dirname, '..', '..', '..', 'HyperClip-Data', '.hyperclip', 'settings.json'),
      path.resolve(__dirname, '..', '..', 'HyperClip-Data', '.hyperclip', 'settings.json'),
      'D:\\\\HyperClip\\\\HyperClip-TestCustomer-20260616-224538\\\\HyperClip-Data\\\\.hyperclip\\\\settings.json',
    ].filter(Boolean);

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        const s = parsed.settings || parsed;
        if (s.autoSplitEnabled === true) {
          const trimLimitMin = Number(s.defaultTrimLimit) || 10;
          const totalTrimSec = Math.max(60, Math.round(trimLimitMin * 60));
          const p1Min = Number(s.autoSplitCustomP1) || Number(s.autoSplitPart1Minutes) || Number(s.autoSplitMinutes) || 4.0;
          const p1Sec = Math.min(Math.round(p1Min * 60), Math.max(60, totalTrimSec - 60));
          const remSec = Math.max(0, totalTrimSec - p1Sec);
          const p2Sec = Math.round(remSec / 2);
          const p3Sec = Math.max(0, remSec - p2Sec);
          return { enabled: true, trimLimitMin, totalTrimSec, p1Sec, p2Sec, p3Sec };
        }
      }
    }
  } catch (_) {}
  return null;
}
`;
  content = content.replace('async function resolveMediaNative(req) {', helperCode + '\nasync function resolveMediaNative(req) {');
}

// 2. Patch resolveMediaNative limitSec
content = content.replace(
  /async function resolveMediaNative\(req\) \{\r?\n  const videoId = req\.videoId;\r?\n  const maxHeight = req\.maxHeight \|\| 360;\r?\n  const limitSec = req\.limitSec \|\| 0;/,
  match => match.replace(
    /const limitSec = req\.limitSec \|\| 0;/,
    'const splitPlan = getSmartSplitPlan();\n  const isSmartSplit = !!(splitPlan && splitPlan.enabled);\n  const limitSec = isSmartSplit ? splitPlan.totalTrimSec : (req.limitSec || 0);'
  )
);

// 3. Patch downloadVideoNative initialization
content = content.replace(
  /async function downloadVideoNative\(req, ctx\) \{\r?\n  const videoId = req\.videoId;\r?\n  const outputPath = req\.outputPath;\r?\n  const maxHeight = req\.maxHeight \|\| 360;\r?\n  const limitSec = req\.limitSec \|\| 0;/,
  match => match.replace(
    /const limitSec = req\.limitSec \|\| 0;/,
    'const splitPlan = getSmartSplitPlan();\n  const isSmartSplit = !!(splitPlan && splitPlan.enabled && outputPath && outputPath.endsWith(".mp4") && !outputPath.includes("_part"));\n  const limitSec = isSmartSplit ? splitPlan.totalTrimSec : (req.limitSec || 0);\n  const masterPath = isSmartSplit ? outputPath.replace(/\\.mp4$/i, "_master.mp4") : null;\n  const fetchTarget = isSmartSplit ? masterPath : outputPath;'
  )
);

// 4. In downloadVideoNative cached branch: replace outputPath with fetchTarget
content = content.replace(
  /fetchUrlToFileParallelV2\(cached\.directUrl, cached\.range, outputPath, sourceIp/,
  'fetchUrlToFileParallelV2(cached.directUrl, cached.range, fetchTarget, sourceIp'
);
content = content.replace(
  /fetchUrlToFileParallel\(cached\.directUrl, cached\.range, outputPath, sourceIp/,
  'fetchUrlToFileParallel(cached.directUrl, cached.range, fetchTarget, sourceIp'
);

// In cached branch return:
content = content.replace(
  /durationSec: cached\.durationSec,\r?\n        videoWidth: cached\.format\.width,\r?\n        videoHeight: cached\.format\.height,\r?\n        truncated: !!cached\.range,/,
  'durationSec: isSmartSplit ? splitPlan.p1Sec : cached.durationSec,\n        videoWidth: cached.format.width,\n        videoHeight: cached.format.height,\n        truncated: !!cached.range || isSmartSplit,'
);

// 5. In downloadVideoNative non-cached branch: replace outputPath with fetchTarget
content = content.replace('r, outputPath, sourceIp', 'r, fetchTarget, sourceIp');
content = content.replace('r, outputPath, sourceIp', 'r, fetchTarget, sourceIp');
content = content.replace('r, outputPath);', 'r, fetchTarget);');
content = content.replace('null, outputPath, sourceIp', 'null, fetchTarget, sourceIp');
content = content.replace('null, outputPath);', 'null, fetchTarget);');

// In non-cached branch return:
content = content.replace(
  /durationSec: durationSec,\r?\n          videoWidth: format\.width \|\| 0,\r?\n          videoHeight: format\.height \|\| 0,\r?\n          truncated: !!range,/,
  'durationSec: isSmartSplit ? splitPlan.p1Sec : durationSec,\n          videoWidth: format.width || 0,\n          videoHeight: format.height || 0,\n          truncated: !!range || isSmartSplit,'
);

// 6. Slice Part 1 after download in BOTH branches
const sliceSnippet = `
        if (isSmartSplit && masterPath && require('fs').existsSync(masterPath)) {
          try {
            const cp = require('child_process');
            const fs = require('fs');
            const ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');
            dlog(\`[smart-split] Slicing Part 1 (0 -> \${splitPlan.p1Sec}s) from master to \${outputPath}\`);
            cp.execFileSync(ffmpegExe, [
              '-y', '-ss', '0', '-i', masterPath, '-t', String(splitPlan.p1Sec), '-c', 'copy', outputPath
            ], { stdio: 'ignore' });
            if (fs.existsSync(outputPath)) {
              written = fs.statSync(outputPath).size;
            }
          } catch (e) {
            dlog(\`[smart-split] Slicing Part 1 failed: \${(e && e.message) || e}\`);
          }
        }
`;

// Insert after each `if (written < 65536) throw new Error`
content = content.replaceAll(
  'if (written < 65536) throw new Error(`suspiciously small download (${written} bytes)`);',
  'if (written < 65536) throw new Error(`suspiciously small download (${written} bytes)`);' + sliceSnippet
);

// 7. Patch command loop for resolveMedia and downloadVideo
content = content.replace(
  /if \(req\.cmd === 'resolveMedia'\) \{\r?\n          const tR = Date\.now\(\);/,
  'if (req.cmd === \'resolveMedia\') {\n          const splitPlan = getSmartSplitPlan();\n          if (splitPlan && splitPlan.enabled) { req.limitSec = splitPlan.totalTrimSec; }\n          const tR = Date.now();'
);
content = content.replace(
  /if \(req\.cmd === 'downloadVideo'\) \{\r?\n          \/\/ Pass 90/,
  'if (req.cmd === \'downloadVideo\') {\n          const splitPlan = getSmartSplitPlan();\n          if (splitPlan && splitPlan.enabled) { req.limitSec = splitPlan.totalTrimSec; }\n          // Pass 90'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched innertube_helper.js cleanly!');
