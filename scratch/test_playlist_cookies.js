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

// Reuse extract functions from innertube_helper.js
function parseRelativeTime(text) {
  if (!text) return 0;
  const m = text.match(/(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|giây|phút|giờ|ngày|tuần|tháng|năm)\b/i);
  if (m) {
    const now = Math.floor(Date.now() / 1000);
    const val = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if      (unit.startsWith('second') || unit.startsWith('giây')) return now - val;
    else if (unit.startsWith('minute') || unit.startsWith('phút')) return now - val * 60;
    else if (unit.startsWith('hour')   || unit.startsWith('giờ'))  return now - val * 3600;
    else if (unit.startsWith('day')    || unit.startsWith('ngày')) return now - val * 86400;
    else if (unit.startsWith('week')   || unit.startsWith('tuần')) return now - val * 604800;
    else if (unit.startsWith('month')  || line.startsWith('tháng')) return now - val * 2592000;
    else if (unit.startsWith('year')   || unit.startsWith('năm'))  return now - val * 31536000;
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

(async () => {
  try {
    const cookieFile = 'd:\\LOOP_COMPANY\\HyperClip\\data\\cookies_netscape.txt';
    const cookieStr = parseNetscapeCookies(cookieFile);
    const yt = await Innertube.create({ cookie: cookieStr, retrieve_player: false });
    const playlistId = 'UUE-PEoUbxALoKIJ2AoSyeqA';
    const playlist = await yt.getPlaylist(playlistId);
    
    const memo = playlist.page.contents_memo;
    if (memo) {
      const lockups = memo.get('LockupView') || [];
      console.log('Found LockupView count:', lockups.length);
      const parsed = lockups.map(extractFromLockupView).filter(v => v !== null);
      console.log('Parsed videos length:', parsed.length);
      if (parsed.length > 0) {
        console.log('First parsed video:', parsed[0]);
      }
    }
  } catch (e) {
    console.error('Error:', e);
  }
})();
