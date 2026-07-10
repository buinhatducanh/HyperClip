const fs = require('fs');

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
    else if (unit.startsWith('month')  || unit.startsWith('tháng')) return now - val * 2592000;
    else if (unit.startsWith('year')   || unit.startsWith('năm'))  return now - val * 31536000;
  }
  return 0;
}

function extractPublishedAtFromLockup(lv) {
  const metadata = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel;
  if (metadata?.metadataRows) {
    for (const row of metadata.metadataRows) {
      if (!row?.metadataParts) continue;
      for (const part of row.metadataParts) {
        const text = part.text?.content || '';
        const parsed = parseRelativeTime(text);
        if (parsed > 0) return parsed;
      }
    }
  }
  return 0;
}

function extractDurationFromLockup(lv) {
  let durationSec = 0;
  const overlays = lv.contentImage?.lockupContentImageViewModel?.overlays || lv.contentImage?.overlays || [];
  for (const overlay of overlays) {
    const renderer = overlay.thumbnailOverlayTimeStatusRenderer;
    if (renderer) {
      const t = renderer.text?.simpleText || renderer.text?.content || '';
      if (t.includes(':')) {
        const p = t.split(':');
        if (p.length === 2) {
          durationSec = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
        } else if (p.length === 3) {
          durationSec = parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseInt(p[2], 10);
        }
      }
    }
  }
  return durationSec;
}

async function strategyPlaylistHTML(channelId, cookieStr) {
  try {
    const playlistId = channelId.replace(/^UC/, 'UU');
    const url = `https://www.youtube.com/playlist?list=${playlistId}&_t=${Date.now()}&_r=${Math.random()}`;
    console.log("Fetching Playlist HTML with cookies:", url);
    const res = await fetch(url, {
      headers: {
        'Cookie': cookieStr || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    if (!res.ok) {
      console.log("Playlist HTML fetch failed:", res.status);
      return [];
    }
    const html = await res.text();
    const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (!match) {
      console.log("Playlist HTML no ytInitialData match");
      return [];
    }
    const data = JSON.parse(match[1]);
    const items = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
    if (!items || !Array.isArray(items)) {
      console.log("Playlist HTML no items structure found");
      return [];
    }
    return items.slice(0, 15).map(item => {
      const lv = item.lockupViewModel;
      if (!lv) return null;
      const videoId = lv.contentId;
      const title = lv.metadata?.lockupMetadataViewModel?.title?.content || '';
      const publishedAt = extractPublishedAtFromLockup(lv);
      const durationSec = extractDurationFromLockup(lv);
      return { videoId, title, publishedAt, durationSec };
    }).filter(v => v !== null);
  } catch (e) {
    console.log("Playlist HTML error:", e.message);
    return [];
  }
}

async function strategyRSS(channelId, cookieStr) {
  try {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}&_t=${Date.now()}&_r=${Math.random()}`;
    console.log("Fetching RSS with cookies:", url);
    const res = await fetch(url, {
      headers: {
        'Cookie': cookieStr || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      }
    });
    if (!res.ok) {
      console.log("RSS fetch failed:", res.status);
      return [];
    }
    const xml = await res.text();
    const entries = xml.split('<entry>');
    entries.shift(); // remove xml header
    return entries.map(entry => {
      const videoId = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
      const title = (entry.match(/<title>(.*?)<\/title>/) || [])[1];
      const publishedStr = (entry.match(/<published>(.*?)<\/published>/) || [])[1];
      let publishedAt = 0;
      if (publishedStr) {
        publishedAt = Math.floor(new Date(publishedStr).getTime() / 1000);
      }
      if (!videoId) return null;
      return {
        videoId,
        title: title || '',
        publishedAt,
        durationSec: 0,
      };
    }).filter(v => v !== null);
  } catch (e) {
    console.log("RSS error:", e.message);
    return [];
  }
}

(async () => {
  const cookieStr = fs.readFileSync('data/cookies.txt', 'utf-8').trim();
  const channelId = "UCP0XXnFnS3hgAaQl0DrJgvA";

  console.log("--- STRATEGY RSS ---");
  const rss = await strategyRSS(channelId, cookieStr);
  console.log("RSS returned", rss.length, "videos:");
  rss.slice(0, 5).forEach(v => console.log(`  - ${v.videoId}: "${v.title}" (publishedAt: ${v.publishedAt})`));

  console.log("--- STRATEGY PLAYLIST ---");
  const pl = await strategyPlaylistHTML(channelId, cookieStr);
  console.log("Playlist returned", pl.length, "videos:");
  pl.slice(0, 5).forEach(v => console.log(`  - ${v.videoId}: "${v.title}" (publishedAt: ${v.publishedAt})`));
})();
