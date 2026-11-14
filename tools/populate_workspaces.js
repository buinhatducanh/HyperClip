const fs = require('fs');
const path = 'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/workspaces.json';

let current = { workspaces: [] };
try {
  const raw = fs.readFileSync(path, 'utf8');
  current = JSON.parse(raw);
} catch (e) {}

const list = current.workspaces || [];
const map = new Map();
list.forEach(w => { if (w && w.id) map.set(w.id, w); });

// Add FjK1Klk7liY (Unfolded) parts
const fjParts = [
  {
    id: "ws-ch-1794187135933",
    status: "done",
    video_id: "FjK1Klk7liY",
    channelId: "ch-1794148248798",
    channelName: "Unfolded",
    title: "How the Best Captain Would Have Saved This Learjet",
    downloadedPath: "D:\\CapCutをダウンロード\\FjK1Klk7liY_20261109_011855.mp4",
    renderedPath: "D:\\CapCutで編集しました\\PART 1_FjK1Klk7liY.mp4",
    createdAt: 1794187135933,
    durationSec: 180,
    trimStart: 0.0,
    trimEnd: 180.0,
    partIndex: 1,
    partTotal: 3,
    partGroup: "ws-ch-1794187135933",
    tiktokStatus: "done",
    exportResolution: "720p",
    lane: "long"
  },
  {
    id: "ws-ch-1794187135933-part2",
    status: "done",
    video_id: "FjK1Klk7liY",
    channelId: "ch-1794148248798",
    channelName: "Unfolded",
    title: "How the Best Captain Would Have Saved This Learjet (Part 2)",
    downloadedPath: "D:\\CapCutをダウンロード\\FjK1Klk7liY_20261109_011855_part2.mp4",
    renderedPath: "D:\\CapCutで編集しました\\PART 2_FjK1Klk7liY.mp4",
    createdAt: 1794187135934,
    durationSec: 482,
    trimStart: 180.0,
    trimEnd: 662.0,
    partIndex: 2,
    partTotal: 3,
    partGroup: "ws-ch-1794187135933",
    tiktokStatus: "done",
    exportResolution: "720p",
    lane: "long"
  },
  {
    id: "ws-ch-1794187135933-part3",
    status: "done",
    video_id: "FjK1Klk7liY",
    channelId: "ch-1794148248798",
    channelName: "Unfolded",
    title: "How the Best Captain Would Have Saved This Learjet (Part 3)",
    downloadedPath: "D:\\CapCutをダウンロード\\FjK1Klk7liY_20261109_011855_part3.mp4",
    renderedPath: "D:\\CapCutで編集しました\\PART 3_FjK1Klk7liY.mp4",
    createdAt: 1794187135935,
    durationSec: 483,
    trimStart: 662.0,
    trimEnd: 1145.0,
    partIndex: 3,
    partTotal: 3,
    partGroup: "ws-ch-1794187135933",
    tiktokStatus: "done",
    exportResolution: "720p",
    lane: "long"
  }
];

// Add xwCERTE43mw (Captain Harlow) parts
const xwParts = [
  {
    id: "ws-ch-1794187136510",
    status: "done",
    video_id: "xwCERTE43mw",
    channelId: "ch-1794148304057",
    channelName: "Captain Harlow",
    title: "Learjet Crash: NTSB's Shocking Update!",
    downloadedPath: "D:\\CapCutをダウンロード\\xwCERTE43mw_20261109_011856.mp4",
    renderedPath: "D:\\CapCutで編集しました\\PART 1_xwCERTE43mw.mp4",
    createdAt: 1794187136510,
    durationSec: 180,
    trimStart: 0.0,
    trimEnd: 180.0,
    partIndex: 1,
    partTotal: 3,
    partGroup: "ws-ch-1794187136510",
    tiktokStatus: "done",
    exportResolution: "720p",
    lane: "long"
  },
  {
    id: "ws-ch-1794187136510-part2",
    status: "done",
    video_id: "xwCERTE43mw",
    channelId: "ch-1794148304057",
    channelName: "Captain Harlow",
    title: "Learjet Crash: NTSB's Shocking Update! (Part 2)",
    downloadedPath: "D:\\CapCutをダウンロード\\xwCERTE43mw_20261109_011856_part2.mp4",
    renderedPath: "D:\\CapCutで編集しました\\PART 2_xwCERTE43mw.mp4",
    createdAt: 1794187136511,
    durationSec: 676,
    trimStart: 180.0,
    trimEnd: 856.0,
    partIndex: 2,
    partTotal: 3,
    partGroup: "ws-ch-1794187136510",
    tiktokStatus: "done",
    exportResolution: "720p",
    lane: "long"
  },
  {
    id: "ws-ch-1794187136510-part3",
    status: "done",
    video_id: "xwCERTE43mw",
    channelId: "ch-1794148304057",
    channelName: "Captain Harlow",
    title: "Learjet Crash: NTSB's Shocking Update! (Part 3)",
    downloadedPath: "D:\\CapCutをダウンロード\\xwCERTE43mw_20261109_011856_part3.mp4",
    renderedPath: "D:\\CapCutで編集しました\\PART 3_xwCERTE43mw.mp4",
    createdAt: 1794187136512,
    durationSec: 677,
    trimStart: 856.0,
    trimEnd: 1533.0,
    partIndex: 3,
    partTotal: 3,
    partGroup: "ws-ch-1794187136510",
    tiktokStatus: "done",
    exportResolution: "720p",
    lane: "long"
  }
];

// Add YETKsYcWqEU (ELY tv2) parts
const yetParts = [
  {
    id: "ws-ch-1794149042009",
    status: "done",
    video_id: "YETKsYcWqEU",
    channelId: "ch-1794146105465",
    channelName: "ELY tv2",
    title: "Angry Security Demands ELY Turns It Off!",
    createdAt: 1794149042009,
    durationSec: 180,
    trimStart: 0.0,
    trimEnd: 180.0,
    partIndex: 1,
    partTotal: 3,
    partGroup: "ws-ch-1794149042009",
    tiktokStatus: "done",
    exportResolution: "720p",
    lane: "long"
  },
  {
    id: "ws-ch-1794149042009-part2",
    status: "done",
    video_id: "YETKsYcWqEU",
    channelId: "ch-1794146105465",
    channelName: "ELY tv2",
    title: "Angry Security Demands ELY Turns It Off! (Part 2)",
    createdAt: 1794149042010,
    durationSec: 217,
    trimStart: 180.0,
    trimEnd: 397.0,
    partIndex: 2,
    partTotal: 3,
    partGroup: "ws-ch-1794149042009",
    tiktokStatus: "done",
    exportResolution: "720p",
    lane: "long"
  },
  {
    id: "ws-ch-1794149042009-part3",
    status: "done",
    video_id: "YETKsYcWqEU",
    channelId: "ch-1794146105465",
    channelName: "ELY tv2",
    title: "Angry Security Demands ELY Turns It Off! (Part 3)",
    createdAt: 1794149042011,
    durationSec: 216,
    trimStart: 397.0,
    trimEnd: 613.0,
    partIndex: 3,
    partTotal: 3,
    partGroup: "ws-ch-1794149042009",
    tiktokStatus: "done",
    exportResolution: "720p",
    lane: "long"
  }
];

[...fjParts, ...xwParts, ...yetParts].forEach(item => {
  if (!map.has(item.id)) {
    map.set(item.id, item);
  } else {
    // merge
    Object.assign(map.get(item.id), item);
  }
});

const merged = Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
fs.writeFileSync(path, JSON.stringify({ workspaces: merged }, null, 2), 'utf8');
console.log('workspaces.json updated with total items:', merged.length);

