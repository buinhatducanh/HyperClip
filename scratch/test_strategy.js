const { Innertube } = require('youtubei.js');
const fs = require('fs');

function parseNetscapeCookies(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const cookies = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length >= 7) {
      const name = parts[5].trim();
      const value = parts[6].trim();
      cookies.push(`${name}=${value}`);
    }
  }
  return cookies.join('; ');
}

function parseRelativeTime(text) {
  if (!text) return 0;
  const cleanText = text.replace(/\u00a0/g, ' ').trim();
  const m = cleanText.match(/(\d+)\s*([a-zA-Z\u00C0-\u1EF9]+)/);
  if (m) {
    const val = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    
    if (unit.startsWith('second') || unit.startsWith('sec') || unit.startsWith('giây')) {
      return now - val;
    }
    if (unit.startsWith('minute') || unit.startsWith('min') || unit.startsWith('phút')) {
      return now - val * 60;
    }
    if (unit.startsWith('hour') || unit.startsWith('hr') || unit.startsWith('giờ')) {
      return now - val * 3600;
    }
    if (unit.startsWith('day') || unit.startsWith('ngày')) {
      return now - val * 86400;
    }
    if (unit.startsWith('week') || unit.startsWith('wk') || unit.startsWith('tuần')) {
      return now - val * 604800;
    }
    if (unit.startsWith('month') || unit.startsWith('mo') || unit.startsWith('tháng')) {
      return now - val * 2592000;
    }
    if (unit.startsWith('year') || unit.startsWith('yr') || unit.startsWith('năm')) {
      return now - val * 31536000;
    }
  }
  return 0;
}

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
        const parsed = parseRelativeTime(text);
        if (parsed > 0) publishedAt = parsed;
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
  let text = '';
  if (v.published && v.published.text) text = v.published.text;
  else if (typeof v.published === 'string') text = v.published;
  return parseRelativeTime(text);
}

async function strategyPlaylistInnertube(client, playlistId) {
  try {
    const playlist = await client.getPlaylist(playlistId);
    if (playlist.items && playlist.items.length > 0) {
      return playlist.items.map(v => ({
        videoId: v.id || '',
        title: v.title?.text || v.title || '',
        publishedAt: extractPublishedAt(v),
        thumbnailUrl: v.thumbnails?.[0]?.url || '',
        durationSec: v.duration?.seconds || 0,
      })).filter(v => v.videoId);
    }
    const memo = playlist.page?.contents_memo;
    if (memo) {
      const lockups = memo.get('LockupView') || [];
      return lockups.map(extractFromLockupView).filter(v => v !== null);
    }
    return [];
  } catch (e) {
    console.error('strategyPlaylistInnertube failed:', e);
    return [];
  }
}

(async () => {
  try {
    const cookieFile = 'd:\\LOOP_COMPANY\\HyperClip\\data\\cookies_netscape.txt';
    const cookieStr = parseNetscapeCookies(cookieFile);
    const yt = await Innertube.create({ cookie: cookieStr, retrieve_player: false });
    const playlistId = 'UUE-PEoUbxALoKIJ2AoSyeqA';
    
    console.log('Running strategyPlaylistInnertube...');
    const result = await strategyPlaylistInnertube(yt, playlistId);
    console.log('Got videos count:', result.length);
    console.log('First 5 videos:', result.slice(0, 5));
  } catch (e) {
    console.error('Error:', e);
  }
})();
