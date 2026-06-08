// innertube_helper.js — Spawned by Rust InnertubeClient for youtubei.js v17
// JSON-RPC: stdin requests -> stdout responses
// Multi-strategy extraction with LockupView handling

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

/**
 * Extract timestamp from LockupView or any video response format.
 */
function extractPublishedAt(v) {
  // Strategy 1: direct structured timestamp
  if (v.published && v.published.timestamp) return v.published.timestamp;

  // Strategy 2: published_time_text
  if (v.published_time_text) {
    const m = String(v.published_time_text).match(/(\d+)\s*(minute|hour|day|second)/);
    if (m) {
      const now = Math.floor(Date.now() / 1000);
      const val = parseInt(m[1], 10);
      if (m[2].startsWith('second')) return now - val;
      if (m[2].startsWith('minute')) return now - val * 60;
      if (m[2].startsWith('hour')) return now - val * 3600;
      if (m[2].startsWith('day')) return now - val * 86400;
    }
  }

  // Strategy 3: lockupMetadata deep scan
  const meta = v.lockupMetadata;
  if (meta) {
    // Try content metadata parts
    const parts = meta.metadata?.metadata?.metadata_parts || [];
    for (const part of parts) {
      const text = part.text?.text || '';
      const m = text.match(/(\d+)\s*(minute|hour|day|second)/);
      if (m) return relativeToTs(m);
    }
    // Fallback: JSON stringify scan
    try {
      const raw = JSON.stringify(meta);
      const m = raw.match(/"(\d+)\s*(minute|hour|day|second)"/);
      if (m) return relativeToTs(m);
    } catch (_) {}
  }

  // Strategy 4: scan top-level stringified
  try {
    const raw = JSON.stringify(v);
    const m = raw.match(/"(\d+)\s*(minute|hour|day|second)"/);
    if (m) return relativeToTs(m);
  } catch (_) {}

  return 0;
}

function relativeToTs(m) {
  const now = Math.floor(Date.now() / 1000);
  const val = parseInt(m[1], 10);
  if (m[2].startsWith('second')) return now - val;
  if (m[2].startsWith('minute')) return now - val * 60;
  if (m[2].startsWith('hour')) return now - val * 3600;
  if (m[2].startsWith('day')) return now - val * 86400;
  return now - val * 60;
}

function extractDuration(v) {
  if (v.duration && v.duration.seconds) return v.duration.seconds;
  if (v.duration_seconds) return v.duration_seconds;
  if (v.lengthSeconds) return parseInt(v.lengthSeconds, 10) || 0;
  if (v.length_seconds) return parseInt(v.length_seconds, 10) || 0;
  return 0;
}

function extractThumbnail(v) {
  if (v.thumbnails && v.thumbnails.length > 0) {
    const sorted = [...v.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
    return sorted[0].url || '';
  }
  if (v.bestThumbnail && v.bestThumbnail.url) return v.bestThumbnail.url;
  if (v.thumbnail && v.thumbnail.url) return v.thumbnail.url;
  return '';
}

function normalizeVideo(v) {
  return {
    videoId: v.id || v.videoId || '',
    title: (v.title && v.title.text) || v.title || '',
    publishedAt: extractPublishedAt(v),
    thumbnailUrl: extractThumbnail(v),
    durationSec: extractDuration(v),
  };
}

// ─── Strategies ──────────────────────────────────────────────

async function strategyGetVideos(channel) {
  try {
    const videos = await channel.getVideos();
    return (videos.videos || []).map(normalizeVideo).filter(v => v.videoId);
  } catch (_) {
    return [];
  }
}

async function strategySearch(channel) {
  try {
    const result = await channel.search('');
    if (result && result.videos) {
      return result.videos.map(normalizeVideo).filter(v => v.videoId);
    }
    return [];
  } catch (_) {
    return [];
  }
}

async function strategyRss(channelId) {
  try {
    const resp = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (!resp.ok) return [];
    const text = await resp.text();
    const ids = [...text.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)].map(m => m[1]);
    const titles = [...text.matchAll(/<title[^>]*>([^<]+)<\/title>/g)].map(m => m[1]);
    const published = [...text.matchAll(/<published>([^<]+)<\/published>/g)].map(m => m[1]);

    const results = [];
    for (let i = 0; i < Math.min(5, ids.length); i++) {
      const ts = published[i + 1]
        ? Math.floor(new Date(published[i + 1]).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
      results.push({
        videoId: ids[i],
        title: titles[i + 1] || '',
        publishedAt: ts,
        thumbnailUrl: `https://i.ytimg.com/vi/${ids[i]}/maxresdefault.jpg`,
        durationSec: 0,
      });
    }
    return results;
  } catch (_) {
    return [];
  }
}

// ─── Multi-strategy extraction ───────────────────────────────

async function getLatestVideo(channelId, cookieStr) {
  try {
    const client = await ensureClient(cookieStr);
    const channel = await client.getChannel(channelId);

    // Strategy 1: getVideos (primary)
    let videos = await strategyGetVideos(channel);
    if (videos.length >= 2) {
      return { ok: true, videos: videos.slice(0, 5) };
    }

    // Strategy 2: search
    videos = await strategySearch(channel);
    if (videos.length >= 1) {
      return { ok: true, videos: videos.slice(0, 5) };
    }

    // Strategy 3: RSS (last resort)
    videos = await strategyRss(channelId);
    if (videos.length >= 1) {
      return { ok: true, videos: videos.slice(0, 5) };
    }

    return { ok: true, videos: [] };
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
  buffer = lines.pop();

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
