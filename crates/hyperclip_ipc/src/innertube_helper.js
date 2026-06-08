// innertube_helper.js — Spawned by Rust InnertubeClient for youtubei.js v17
// JSON-RPC: stdin requests → stdout responses

const { Innertube } = require('youtubei.js');

let yt = null;

async function ensureClient(cookieStr) {
  if (yt) return yt;
  yt = await Innertube.create({
    cookie: cookieStr,
    retrieve_player: false,
  });
  return yt;
}

async function getLatestVideo(channelId, cookieStr) {
  try {
    const client = await ensureClient(cookieStr);
    const channel = await client.getChannel(channelId);
    const videos = await channel.getVideos();

    const results = [];
    for (let i = 0; i < Math.min(5, videos.videos.length); i++) {
      const v = videos.videos[i];
      results.push({
        videoId: v.id || '',
        title: (v.title?.text || v.title || ''),
        publishedAt: v.published?.timestamp || 0,
        thumbnailUrl: v.thumbnails?.[0]?.url || '',
        durationSec: v.duration?.seconds || 0,
      });
    }
    return { ok: true, videos: results };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// JSON-RPC over stdin/stdout
process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop(); // keep incomplete line

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      const result = await getLatestVideo(req.channelId, req.cookie);
      process.stdout.write(JSON.stringify({ id: req.id, ...result }) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ id: null, ok: false, error: e.message }) + '\n');
    }
  }
});

process.stdin.on('end', () => process.exit(0));
