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

  // 1. Ensure fs and path are required at top level without BOM duplication
  content = content.replace(/^(\uFEFF?\s*const fs = require\('fs'\);\s*const path = require\('path'\);\s*)+/, '');
  content = "const fs = require('fs');\nconst path = require('path');\n" + content;

  // 2. Fix missing splitPlan in resolveMediaNative and fallback to single video limitSec
  content = content.replace(
    /const maxHeight = req\.maxHeight \|\| 360;\r?\n\s*const isSmartSplit = !!\(splitPlan && splitPlan\.enabled\);/g,
    "const maxHeight = req.maxHeight || 360;\n  const splitPlan = getSmartSplitPlan();\n  const isSmartSplit = !!(splitPlan && splitPlan.enabled);\n  let planToUse = splitPlan || { p1Sec: (req.limitSec || 60), p2Sec: 0, p3Sec: 0 };"
  );
  content = content.replace(
    /const limitSec = isSmartSplit \? splitPlan\.totalTrimSec : \(req\.limitSec \|\| 0\);/g,
    "const limitSec = isSmartSplit ? splitPlan.totalTrimSec : (req.limitSec || (splitPlan && splitPlan.totalTrimSec) || 0);"
  );
  content = content.replace(
    /if \(splitPlan && splitPlan\.enabled\) \{ req\.limitSec = splitPlan\.totalTrimSec; \}/g,
    "if (splitPlan && splitPlan.totalTrimSec) { req.limitSec = splitPlan.totalTrimSec; }"
  );

  // 3. Fix ffmpeg path for local slice of Part 2 & Part 3
  if (content.includes("const ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');")) {
    content = content.replace(
      "const ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');",
      `let ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg_real.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = 'D:\\\\HyperClip\\\\HyperClip-TestCustomer-20260616-224538\\\\app\\\\_internal\\\\resources\\\\ffmpeg\\\\bin\\\\ffmpeg_real.exe';`
    );
  }

  // 4. Update getSmartSplitPlan with Adaptive Intelligence for short/long videos
  const oldFuncRegex = /function getSmartSplitPlan\([^)]*\) \{[\s\S]*?return null;\r?\n\}/;
  const newFunc = `function getSmartSplitPlan(actualDurationSec) {
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
          let totalTrimSec = Math.max(60, Math.round(trimLimitMin * 60));

          const actSec = Number(actualDurationSec) || 0;
          let isAdaptiveShort = false;
          if (actSec > 30 && actSec < totalTrimSec) {
            totalTrimSec = actSec;
            isAdaptiveShort = true;
          }

          let p1Sec, p2Sec, p3Sec;
          let partsCount = s.autoSplitParts || 3;

          if (totalTrimSec <= 120) {
            return { enabled: true, trimLimitMin, totalTrimSec, p1Sec: totalTrimSec, p2Sec: 0, p3Sec: 0, parts: 1, isAdaptiveShort };
          }

          if (isAdaptiveShort && totalTrimSec < 420) {
            p1Sec = Math.round(totalTrimSec / 2);
            p2Sec = totalTrimSec - p1Sec;
            p3Sec = 0;
            return { enabled: true, trimLimitMin, totalTrimSec, p1Sec, p2Sec, p3Sec, parts: 2, isAdaptiveShort: true };
          }

          if (s.autoSplitMode === "minutes" || s.autoSplitSubMode === "custom_p1" || (s.autoSplitCustomP1 && s.autoSplitCustomP1 > 0)) {
            const p1Min = Number(s.autoSplitCustomP1) || Number(s.autoSplitPart1Minutes) || Number(s.autoSplitMinutes) || 3.0;
            const targetP1Sec = Math.round(p1Min * 60);
            p1Sec = Math.min(targetP1Sec, Math.max(60, totalTrimSec - 60));
            const remSec = Math.max(0, totalTrimSec - p1Sec);

            if (remSec < 60) {
              p1Sec = totalTrimSec;
              p2Sec = 0;
              p3Sec = 0;
              partsCount = 1;
            } else if (remSec < 120 || partsCount === 2) {
              p2Sec = remSec;
              p3Sec = 0;
              partsCount = 2;
            } else {
              p2Sec = Math.round(remSec / 2);
              p3Sec = Math.max(0, remSec - p2Sec);
              partsCount = 3;
            }
          } else if (s.autoSplitParts === 2 || s.autoSplitSubMode === "parts_2") {
            p1Sec = Math.round(totalTrimSec / 2);
            p2Sec = totalTrimSec - p1Sec;
            p3Sec = 0;
            partsCount = 2;
          } else {
            p1Sec = Math.round(totalTrimSec / 3);
            p2Sec = Math.round(totalTrimSec / 3);
            p3Sec = Math.max(0, totalTrimSec - p1Sec - p2Sec);
            partsCount = 3;
          }
          return { enabled: true, trimLimitMin, totalTrimSec, p1Sec, p2Sec, p3Sec, parts: partsCount, isAdaptiveShort };
        } else {
          const trimLimitMin = Number(s.defaultTrimLimit) || 10;
          let totalTrimSec = (trimLimitMin > 0 && trimLimitMin < 900) ? Math.round(trimLimitMin * 60) : 0;
          return { enabled: false, trimLimitMin, totalTrimSec, parts: 1 };
        }
      }
    }
  } catch (_) {}
  return null;
}`;

  if (oldFuncRegex.test(content)) {
    content = content.replace(oldFuncRegex, newFunc);
  }

  // 5. Support reading masterPath.meta.json in local slice
  if (content.includes("let durSec = splitPlan.p1Sec;")) {
    content = content.replace(
      "let durSec = splitPlan.p1Sec;",
      `let planToUse = splitPlan;
      const metaFile = masterPath + '.meta.json';
      if (fs.existsSync(metaFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          if (meta.splitPlan) planToUse = meta.splitPlan;
        } catch (_) {}
      }
      let durSec = planToUse.p1Sec;`
    );
    content = content.replace(/splitPlan\.p1Sec/g, "planToUse.p1Sec");
    content = content.replace(/splitPlan\.p2Sec/g, "planToUse.p2Sec");
    content = content.replace(/splitPlan\.p3Sec/g, "planToUse.p3Sec");
  }

  // 6. Write masterPath.meta.json on master download complete
  if (content.includes("dlog(`[smart-split] Slicing Part 1 (0 -> ${splitPlan.p1Sec}s)")) {
    content = content.replace(
      "dlog(`[smart-split] Slicing Part 1 (0 -> ${splitPlan.p1Sec}s)",
      `const actualDur = Number(cached.durationSec) || 0;
            if (actualDur > 30 && actualDur < splitPlan.totalTrimSec) {
              const adapted = getSmartSplitPlan(actualDur);
              if (adapted) {
                splitPlan = adapted;
                dlog(\`[smart-split] Adaptive: \${videoId} actual \${actualDur}s < \${splitPlan.totalTrimSec}s -> Adapted to \${adapted.parts} parts (P1: \${adapted.p1Sec}s, P2: \${adapted.p2Sec}s, P3: \${adapted.p3Sec}s)\`);
              }
            }
            try {
              fs.writeFileSync(masterPath + '.meta.json', JSON.stringify({ videoId, actualDurationSec: actualDur, splitPlan }, null, 2), 'utf8');
            } catch (_) {}
            dlog(\`[smart-split] Slicing Part 1 (0 -> \${splitPlan.p1Sec}s)`
    );
  }

  // 7. Add or update guardPart1Duration to guarantee Part 1 output file matches exact p1Sec & sync workspaces.json
  if (content.includes("function guardPart1Duration()")) {
    const oldGuardPattern = /function guardPart1Duration\(\)[\s\S]*?setInterval\(\(\) => \{ cleanDuplicateRenders\(\); guardPart1Duration\(\); \}, 2000\);/;
    content = content.replace(oldGuardPattern, "setInterval(cleanDuplicateRenders, 2000);");
  }
  {
    const guardFunc = `
function guardPart1Duration() {
  try {
    const fs = require('fs');
    const path = require('path');
    const child_process = require('child_process');
    const plan = getSmartSplitPlan();
    if (!plan || !plan.enabled || !plan.p1Sec || plan.p1Sec <= 0) return;

    const targetSec = plan.p1Sec;
    const possibleDirs = [
      (plan && plan.outDir),
      process.env.HYPERCLIP_DATA_DIR,
      'D:\\\\HyperClip\\\\HyperClip-TestCustomer-20260616-224538\\\\HyperClip-Data'
    ].filter(Boolean);

    let ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg_real.exe');
    if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe');
    if (!fs.existsSync(ffmpegExe)) ffmpegExe = 'D:\\\\HyperClip\\\\HyperClip-TestCustomer-20260616-224538\\\\app\\\\_internal\\\\resources\\\\ffmpeg\\\\bin\\\\ffmpeg_real.exe';

    for (const dir of possibleDirs) {
      if (!fs.existsSync(dir)) continue;

      // 1. Synchronize workspaces.json to prevent Rust equal split override (e.g. 225s / 3:45)
      try {
        const wsFile = path.join(dir, '.hyperclip', 'workspaces.json');
        if (fs.existsSync(wsFile)) {
          const wsJson = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
          let changed = false;
          for (const ws of (wsJson.workspaces || [])) {
            if (ws.partIndex === 1 && ws.partTotal >= 2) {
              if (Math.abs(ws.trimEnd - plan.p1Sec) > 1.0 || Math.abs(ws.durationSec - plan.p1Sec) > 1 || Math.abs(ws.sourceEndSec - plan.p1Sec) > 1.0) {
                ws.trimEnd = plan.p1Sec;
                ws.durationSec = plan.p1Sec;
                ws.sourceStartSec = 0;
                ws.sourceEndSec = plan.p1Sec;
                changed = true;
              }
            } else if (ws.partIndex === 2 && ws.partTotal >= 2 && plan.p2Sec > 0) {
              const p2Start = plan.p1Sec;
              const p2End = plan.p1Sec + plan.p2Sec;
              if (Math.abs(ws.trimEnd - plan.p2Sec) > 1.0 || Math.abs(ws.durationSec - plan.p2Sec) > 1 || Math.abs(ws.sourceEndSec - p2End) > 1.0) {
                ws.trimEnd = plan.p2Sec;
                ws.durationSec = plan.p2Sec;
                ws.sourceStartSec = p2Start;
                ws.sourceEndSec = p2End;
                changed = true;
              }
            } else if (ws.partIndex === 3 && ws.partTotal === 3 && plan.p3Sec > 0) {
              const p3Start = plan.p1Sec + plan.p2Sec;
              const p3End = plan.p1Sec + plan.p2Sec + plan.p3Sec;
              if (Math.abs(ws.trimEnd - plan.p3Sec) > 1.0 || Math.abs(ws.durationSec - plan.p3Sec) > 1 || Math.abs(ws.sourceEndSec - p3End) > 1.0) {
                ws.trimEnd = plan.p3Sec;
                ws.durationSec = plan.p3Sec;
                ws.sourceStartSec = p3Start;
                ws.sourceEndSec = p3End;
                changed = true;
              }
            }
          }
          if (changed) {
            fs.writeFileSync(wsFile, JSON.stringify(wsJson, null, 2), 'utf8');
            dlog(\`[part1-guard] Synced workspaces.json parts to plan durations (P1: \${plan.p1Sec}s, P2: \${plan.p2Sec}s, P3: \${plan.p3Sec}s)\`);
          }
        }
      } catch (_) {}

      // 2. Physical file verification & lossless normalization
      if (fs.existsSync(ffmpegExe)) {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (/^PART\\s*1_.*\\.mp4$/i.test(f) && !f.includes("_fixed") && !f.includes(".tmp")) {
            const fullPath = path.join(dir, f);
            const stat = fs.statSync(fullPath);
            if (Date.now() - stat.mtimeMs < 2000) continue;

            const probe = child_process.spawnSync(ffmpegExe, ['-i', fullPath], { encoding: 'utf8' });
            const durMatch = (probe.stderr || '').match(/Duration:\\s*(\\d+):(\\d+):(\\d+\\.?\\d*)/);
            if (durMatch) {
              const actualDur = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
              if (actualDur > targetSec + 1.5) {
                const tmpPath = fullPath + '.norm.mp4';
                const res = child_process.spawnSync(ffmpegExe, ['-y', '-i', fullPath, '-t', String(targetSec), '-c', 'copy', tmpPath]);
                if (res.status === 0 && fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 1000) {
                  fs.unlinkSync(fullPath);
                  fs.renameSync(tmpPath, fullPath);
                  dlog(\`[part1-guard] Successfully normalized \${f} from \${actualDur.toFixed(1)}s to \${targetSec}s (exact Part 1 duration)\`);
                } else {
                  try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
                }
              }
            }
          }
        }
      }
    }
  } catch (_) {}
}
`;
    content = content.replace("setInterval(cleanDuplicateRenders, 2000);", guardFunc + "\nsetInterval(() => { cleanDuplicateRenders(); guardPart1Duration(); }, 2000);");
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Patched:', filePath);
}
console.log('All innertube_helper.js files successfully patched!');
