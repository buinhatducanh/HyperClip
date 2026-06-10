// innertube_helper.js — Spawned by Rust InnertubeClient for youtubei.js v17
// JSON-RPC: stdin requests -> stdout OR temp file responses
// v3 — LockupView extraction + handle→UC ID resolution + temp file support

const { Innertube } = require('youtubei.js');

let yt = null;

async function ensureClient(cookieStr) {
  if (yt) return yt;
  yt = await Innertube.create({ cookie: cookieStr, retrieve_player: false });
  return yt;
}

async function resolveChannelId(yt, rawId) {
  const id = rawId.replace(/^@/, '');
  if (id.startsWith('UC') && id.length >= 22) return id;
  try {
    const results = await yt.search(id);
    if (results.channels?.[0]?.id) return results.channels[0].id;
  } catch (_) {}
  try {
    const resp = await fetch(`https://www.youtube.com/@${id}`);
    if (resp.ok) {
      const html = await resp.text();
      const m = html.match(/\/channel\/(UC[\w-]{20,})/);
      if (m) return m[1];
    }
  } catch (_) {}
  return rawId;
}

// ─── LockupView extraction ──────────────────────────────────

function extractFromLockupView(lv) {
  const videoId = lv.content_id;
  if (!videoId) return null;
  const title = lv.metadata?.title?.text || '';
  let publishedAt = 0;
  const md = lv.metadata?.metadata;
  if (md?.metadata_rows) {
    for (const row of md.metadata_rows) {
      if (!row?.metadata_parts) continue;
      for (const part of row.metadata_parts) {
        const text = (part.text && part.text.text) || '';
        if (publishedAt) continue;
        const m = text.match(/(\d+)\s*(seconds?|minutes?|hours?|days?)\b/);
        if (m) {
          const now = Math.floor(Date.now() / 1000);
          const v = parseInt(m[1], 10);
          if      (m[2].startsWith('second')) publishedAt = now - v;
          else if (m[2].startsWith('minute')) publishedAt = now - v * 60;
          else if (m[2].startsWith('hour'))   publishedAt = now - v * 3600;
          else if (m[2].startsWith('day'))    publishedAt = now - v * 86400;
        }
      }
    }
  }
  let durationSec = 0;
  const overlays = lv.content_image?.overlays || [];
  for (const overlay of overlays) {
    if (overlay.badges?.length > 0) {
      const t = overlay.badges[0].text || '';
      if (!t.includes(':')) continue;
      const p = t.split(':');
      if (p.length === 2) durationSec = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
    }
  }
  let thumbnailUrl = '';
  const sources = lv.content_image?.image?.sources || [];
  if (sources.length > 0) thumbnailUrl = sources[0].url || '';
  return { videoId, title, publishedAt, thumbnailUrl, durationSec };
}

function extractPublishedAt(v) {
  if (v.published && v.published.timestamp) {
    const ts = Number(v.published.timestamp);
    return ts > 1e12 ? Math.floor(ts / 1000) : ts;
  }
  return 0;
}

function normalizeVideo(v) {
  return {
    videoId: v.id || v.videoId || '',
    title: (v.title && v.title.text) || v.title || '',
    publishedAt: extractPublishedAt(v),
    thumbnailUrl: (() => { try { const s = [...(v.thumbnails||[])].sort((a,b)=>(b.width||0)-(a.width||0)); return s[0]?.url||''; } catch(_){return'';}})(),
    durationSec: (() => { try { return v.duration?.seconds||v.duration_seconds||0; } catch(_){return 0;} })(),
  };
}

async function strategyGetVideos(channel) {
  try {
    const videos = await channel.getVideos();
    const normal = (videos.videos || []).map(normalizeVideo).filter(v => v.videoId);
    if (normal.length > 0) return normal;
    const memo = videos.page?.contents_memo;
    if (memo) {
      const lockups = memo.get('LockupView') || [];
      return lockups.map(extractFromLockupView).filter(v => v !== null);
    }
    return [];
  } catch (_) { return []; }
}

async function strategySearch(channel) {
  try {
    const r = await channel.search('');
    return (r.videos || []).map(normalizeVideo).filter(v => v.videoId);
  } catch (_) { return []; }
}

async function getLatestVideo(channelId, cookieStr) {
  try {
    const client = await ensureClient(cookieStr);
    const resolvedId = await resolveChannelId(client, channelId);
    const channel = await client.getChannel(resolvedId);
    let videos = await strategyGetVideos(channel);
    if (videos.length >= 1) return { ok: true, videos: videos.slice(0, 5) };
    videos = await strategySearch(channel);
    if (videos.length >= 1) return { ok: true, videos: videos.slice(0, 5) };
    return { ok: true, videos: [] };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Write response to temp file (HYPERCLIP_RESPONSE_FILE) or stdout (fallback)
function writeResponse(obj) {
  const msg = JSON.stringify(obj) + '\n';
  const respFile = process.env.HYPERCLIP_RESPONSE_FILE;
  if (respFile) {
    require('fs').writeFileSync(respFile, msg, 'utf-8');
  } else {
    require('fs').writeSync(1, msg);
  }
}

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
      writeResponse({ id: req.id, ...result });
    } catch (e) {
      writeResponse({ id: null, ok: false, error: e.message });
    }
  }
});

// ─── Entry point ──────────────────────────────────────────────

// If a CLI argument is provided, treat it as a request file path (file-based mode,
// avoids Windows stdin pipe buffering issues).
if (process.argv[2]) {
  const reqPath = process.argv[2];
  (async () => {
    try {
      const content = require('fs').readFileSync(reqPath, 'utf-8');
      const req = JSON.parse(content);
      const result = await getLatestVideo(req.channelId, req.cookie);
      writeResponse({ id: req.id, ...result });
    } catch (e) {
      writeResponse({ id: null, ok: false, error: e.message });
    }
    process.exit(0);
  })();
} else {
  // stdin-based mode (fallback, used when spawned without args)
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
        writeResponse({ id: req.id, ...result });
      } catch (e) {
        writeResponse({ id: null, ok: false, error: e.message });
      }
    }
  });
  // NO on('end') handler — Rust closes stdin (take()) to signal EOF, but
  // process.exit(0) would kill the process before async handlers complete.
  // Rust force-kills after reading the response.
}
