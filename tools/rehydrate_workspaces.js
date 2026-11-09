const fs = require('fs');
const path = require('path');

const dataDir = path.resolve('HyperClip-TestCustomer-20260616-224538/HyperClip-Data');
const dotHyperclip = path.join(dataDir, '.hyperclip');
const mediaDir = path.join(dataDir, 'media');
const outputDir = path.join(dataDir, 'output');
const rendersDir = path.join(dataDir, 'renders');

console.log('=== Step 2: Rehydrating Workspaces from Disk & Ledgers ===');

// 1. Load Channels
const channelsFile = path.join(dotHyperclip, 'channels', 'channels.json');
let channelList = [];
try {
  const cd = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
  channelList = cd.channels || (Array.isArray(cd) ? cd : []);
} catch(e) {
  console.error('Error loading channels:', e.message);
}

const channelByName = new Map();
const channelById = new Map();
channelList.forEach(ch => {
  if (ch.name) channelByName.set(ch.name.toLowerCase().trim(), ch);
  if (ch.id) channelById.set(ch.id, ch);
  if (ch.channelId) channelById.set(ch.channelId, ch);
});
console.log(`Loaded ${channelList.length} channels for cross-referencing.`);

// 2. Load Shadow Ledger
const shadowFile = path.join(dotHyperclip, 'shadow_ledger.jsonl');
const videoMetadata = new Map();
if (fs.existsSync(shadowFile)) {
  const lines = fs.readFileSync(shadowFile, 'utf8').split('\n');
  lines.forEach(l => {
    l = l.trim();
    if (!l) return;
    try {
      const item = JSON.parse(l);
      if (item.videoId) {
        videoMetadata.set(item.videoId, item);
      }
    } catch(e) {}
  });
}
console.log(`Loaded metadata for ${videoMetadata.size} videos from shadow_ledger.`);

// 3. Load Existing Workspaces to preserve
const wsFile = path.join(dotHyperclip, 'workspaces.json');
let existingWorkspaces = [];
try {
  if (fs.existsSync(wsFile)) {
    const wd = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
    existingWorkspaces = wd.workspaces || (Array.isArray(wd) ? wd : []);
  }
} catch(e) {}

const workspaceMap = new Map();
existingWorkspaces.forEach(ws => {
  if (ws.video_id) workspaceMap.set(ws.video_id, ws);
  else if (ws.id) workspaceMap.set(ws.id, ws);
});
console.log(`Preserving ${workspaceMap.size} existing workspaces.`);

// 4. Scan all MP4 files in media and output
const mp4Files = [];
function findMp4s(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findMp4s(full);
      } else if (entry.name.toLowerCase().endsWith('.mp4')) {
        mp4Files.push(full);
      }
    }
  } catch(e) {}
}

findMp4s(mediaDir);
findMp4s(outputDir);
findMp4s(rendersDir);
console.log(`Discovered ${mp4Files.length} MP4 media files on disk.`);

// 5. Build Workspace entries
let rehydratedCount = 0;
mp4Files.forEach(filePath => {
  const fileName = path.basename(filePath);
  // Match YouTube video ID pattern (11 chars)
  // Format examples: -qizdzKNW_w_20260626_175238.mp4 or videoId.mp4 or part 1.mp4
  const m = fileName.match(/^([A-Za-z0-9_-]{11})/);
  if (!m) return;
  const videoId = m[1];

  if (workspaceMap.has(videoId)) {
    // If already exists, update paths if missing
    const ws = workspaceMap.get(videoId);
    if (!ws.downloadedPath && !ws.renderedPath) {
      ws.downloadedPath = filePath;
      ws.renderedPath = filePath;
      ws.status = 'ready';
    }
    return;
  }

  // Determine Channel from path or shadow ledger
  let matchedChannel = null;
  const pathParts = filePath.split(path.sep);
  for (const part of pathParts) {
    if (channelByName.has(part.toLowerCase().trim())) {
      matchedChannel = channelByName.get(part.toLowerCase().trim());
      break;
    }
  }

  const shadowMeta = videoMetadata.get(videoId);
  const channelId = matchedChannel ? matchedChannel.id : (shadowMeta ? shadowMeta.channelId : 'ch-default');
  const channelName = matchedChannel ? matchedChannel.name : (shadowMeta ? shadowMeta.channelName : 'YouTube Channel');
  const publishedAt = shadowMeta ? (shadowMeta.publishedAtMs || shadowMeta.seenAtMs) : Date.now();

  // Find thumbnail if exists
  let thumbPath = null;
  const dirName = path.dirname(filePath);
  const possibleThumbs = [
    path.join(dirName, '..', 'thumbnails', `${videoId}.jpg`),
    path.join(mediaDir, `${videoId}.jpg`),
    path.join(mediaDir, channelName, 'thumbnails', `${videoId}.jpg`)
  ];
  for (const tp of possibleThumbs) {
    if (fs.existsSync(tp)) {
      thumbPath = tp;
      break;
    }
  }

  const stats = fs.statSync(filePath);
  const wsEntry = {
    id: `ws-${channelId}-${videoId}`,
    status: 'ready',
    video_id: videoId,
    channelId: channelId,
    channelName: channelName,
    title: `${channelName} - ${videoId}`,
    downloadedPath: filePath,
    downloadedAt: Math.floor(stats.mtimeMs),
    downloadStartedAt: Math.floor(stats.ctimeMs),
    createdAt: Math.floor(stats.ctimeMs),
    publishedAt: publishedAt,
    trimStart: 0,
    trimEnd: 0,
    videoSpeed: 1,
    fpsTarget: 30,
    exportResolution: '720p',
    isShort: false,
    autoRender: true,
    progress: 100,
    error: null,
    availableFormats: null,
    renderedPath: filePath,
    thumbnailLocal: thumbPath,
    fileSize: stats.size,
    downloadSpeed: null,
    downloadTime: null,
    durationSec: 180,
    quality: null,
    originalDurationSec: 180,
    originalQuality: null,
    renderFps: 30,
    renderWorkers: 2,
    renderPreset: 'p4',
    renderCodec: 'h264_nvenc',
    renderBitrateKbps: 2000,
    renderStartedAt: Math.floor(stats.mtimeMs),
    renderedAt: Math.floor(stats.mtimeMs),
    renderProgress: 100,
    renderTimeSec: 15,
    renderVramUsageMb: 0,
    renderGpuComputePct: 0,
    tiktokUploaded: false,
    tiktokUploadedAt: null,
    tiktokUrl: null,
    uploadedPartIndices: []
  };

  workspaceMap.set(videoId, wsEntry);
  rehydratedCount++;
});

console.log(`Rehydrated ${rehydratedCount} workspaces from media files! Total workspaces now: ${workspaceMap.size}`);

// 6. Save backup and write new workspaces.json
const finalWorkspaces = Array.from(workspaceMap.values());
const payload = { workspaces: finalWorkspaces };

// Backup
if (fs.existsSync(wsFile)) {
  fs.copyFileSync(wsFile, path.join(dotHyperclip, 'workspaces.json.bak'));
}

// Write to Master
fs.writeFileSync(wsFile, JSON.stringify(payload, null, 2), 'utf8');
console.log(`Saved master workspaces.json (${finalWorkspaces.length} entries).`);

// Mirror to all unified targets
const syncTargets = [
  path.resolve('HyperClip-TestCustomer-20260616-224538/app/data/.hyperclip/workspaces.json'),
  path.resolve('HyperClip-Data/.hyperclip/workspaces.json'),
  path.join(process.env.APPDATA, 'HyperClip/.hyperclip/workspaces.json')
];

syncTargets.forEach(st => {
  try {
    const parentDir = path.dirname(st);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    fs.copyFileSync(wsFile, st);
    console.log(`Mirrored workspaces.json -> ${st}`);
  } catch(e) {
    console.error(`Failed to mirror to ${st}:`, e.message);
  }
});

console.log('=== Step 2 Complete: Workspaces fully rehydrated and synchronized! ===\n');
