const fs = require('fs');
const path = require('path');

const dotHyperclip = path.resolve('HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip');
const seenFile = path.join(dotHyperclip, 'channels', 'seen.json');
const wsFile = path.join(dotHyperclip, 'workspaces.json');

console.log('=== Step 3: Smart Seen Sync ===');

if (!fs.existsSync(seenFile)) {
  console.log('No seen.json found, skipping.');
  process.exit(0);
}

// Backup
fs.copyFileSync(seenFile, path.join(dotHyperclip, 'channels', 'seen.json.bak'));

const seenData = JSON.parse(fs.readFileSync(seenFile, 'utf8'));
const wsData = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
const wsVideos = new Set((wsData.workspaces || []).map(w => w.video_id));

let totalSeen = 0;
let keptSeen = 0;

if (seenData && seenData.channels) {
  for (const chKey in seenData.channels) {
    const chObj = seenData.channels[chKey];
    if (chObj && Array.isArray(chObj.ids)) {
      totalSeen += chObj.ids.length;
      // Keep IDs that are in workspaces, plus the 5 most recent per channel to prevent immediate spam
      const validIds = [];
      chObj.ids.forEach(id => {
        if (wsVideos.has(id)) {
          validIds.push(id);
        }
      });
      // Also keep the last 5 IDs seen to maintain freshness window
      const tail = chObj.ids.slice(-5);
      tail.forEach(id => {
        if (!validIds.includes(id)) validIds.push(id);
      });
      chObj.ids = validIds;
      keptSeen += validIds.length;
    }
  }
}

fs.writeFileSync(seenFile, JSON.stringify(seenData, null, 2), 'utf8');
console.log(`Cleaned seen.json: Reduced from ${totalSeen} to ${keptSeen} active seen IDs.`);

// Mirror seen.json to all unified dirs
const targetDirs = [
  path.resolve('HyperClip-TestCustomer-20260616-224538/app/data/.hyperclip/channels/seen.json'),
  path.resolve('HyperClip-Data/.hyperclip/channels/seen.json'),
  path.join(process.env.APPDATA, 'HyperClip/.hyperclip/channels/seen.json')
];

targetDirs.forEach(td => {
  try {
    const p = path.dirname(td);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    fs.copyFileSync(seenFile, td);
    console.log(`Mirrored seen.json -> ${td}`);
  } catch(e) {}
});

console.log('=== Step 3 Complete: Seen sync finished! ===\n');

