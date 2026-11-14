const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const DATA_DIR = process.env.HYPERCLIP_DATA_DIR || process.env.HYPERCLIPB_DATA_DIR || '';

// â”€â”€â”€ HyperClip Lifecycle Engine: Auto-Start AdsPower & Auto-Shutdown Watcher â”€â”€â”€
function ensureShutdownWatcher() {
  try {
    const candidateWatchScripts = [
      path.resolve(__dirname, '../../watch-shutdown.ps1'),
      path.resolve(__dirname, '../../../watch-shutdown.ps1'),
      'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/watch-shutdown.ps1',
      'D:/HyperClip/watch-shutdown.ps1'
    ];
    for (const s of candidateWatchScripts) {
      if (fs.existsSync(s)) {
        cp.spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', s], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        }).unref();
        break;
      }
    }
  } catch (e) {}
}

function ensureAutoOpenAdsPower() {
  try {
    const settingsCandidates = [
      DATA_DIR ? path.join(DATA_DIR, '.hyperclip', 'settings.json') : null,
      path.resolve(__dirname, '../../HyperClip-Data/.hyperclip/settings.json'),
      path.resolve(__dirname, '../../../HyperClip-Data/.hyperclip/settings.json'),
      path.resolve(__dirname, '../../app/data/.hyperclip/settings.json'),
      path.resolve(__dirname, '../../../app/data/.hyperclip/settings.json'),
      'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/settings.json'
    ].filter(Boolean);
    let isTiktokEnabled = false;
    for (const sp of settingsCandidates) {
      if (fs.existsSync(sp)) {
        try {
          const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
          const val = s?.settings?.tiktokUploadEnabled ?? s?.tiktokUploadEnabled;
          if (val === true) {
            isTiktokEnabled = true;
            break;
          }
        } catch (e) {}
      }
    }
    if (!isTiktokEnabled) return;

    const startScripts = [
      path.resolve(__dirname, '../../tools/start_assigned_adspower.js'),
      path.resolve(__dirname, '../../../tools/start_assigned_adspower.js')
    ];
    for (const startScript of startScripts) {
      if (fs.existsSync(startScript)) {
        cp.spawn(process.execPath, [startScript], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: process.env
        }).unref();
        break;
      }
    }
  } catch (e) {}
}

try {
  ensureShutdownWatcher();
  ensureAutoOpenAdsPower();
} catch (e) {}
// innertube_helper.js â€” Spawned by Rust InnertubeClient for youtubei.js v17
// JSON-RPC: stdin requests -> stdout OR temp file responses
// v4 â€” Persistent daemon mode for fast polling + LockupView extraction + handleâ†’UC ID resolution

const { Innertube, Log } = require('youtubei.js');
// Daemon stderr is drained into the Rust log since pass 15 â€” youtubei.js
// parser warnings ([YOUTUBEJS][Parser] ChipBarView dumps etc.) flooded it
// with ~5.8k lines/min (62% of customer log 2026-07-14). Only our own dlog()
// diagnostics belong on stderr.
try { Log.setLevel(Log.Level.NONE); } catch (_) {}

const clientPromises = new Map(); // cookieStr -> Promise<Innertube>
let currentCookie = '';
const resolvedChannelCache = new Map(); // '@handle' -> 'UC...'

async function ensureClient(cookieStr) {
  currentCookie = cookieStr;
  if (clientPromises.has(cookieStr)) {
    // LRU bump: re-insert so the most recently used cookie survives eviction.
    const p = clientPromises.get(cookieStr);
    clientPromises.delete(cookieStr);
    clientPromises.set(cookieStr, p);
    return p;
  }
  const promise = Innertube.create({ cookie: cookieStr, retrieve_player: false });
  clientPromises.set(cookieStr, promise);
  // Cap the per-cookie client cache: YouTube rotates SIDCC/PSIDTS roughly every
  // minute, so a 24/7 daemon would otherwise accumulate thousands of Innertube
  // instances (one per distinct cookie string it ever saw). Keep the 8 most
  // recently used â€” a daemon only ever serves a handful of sessions at a time.
  while (clientPromises.size > 8) {
    const oldest = clientPromises.keys().next().value;
    clientPromises.delete(oldest);
  }
  return promise;
}

async function resolveChannelId(yt, rawId) {
  let decodedId = rawId;
  try {
    decodedId = decodeURIComponent(rawId);
  } catch (_) {}
  const id = decodedId.replace(/^@/, '');
  if (id.startsWith('UC') && id.length >= 22) return id;
  const cacheKey = '@' + id.toLowerCase();
  if (resolvedChannelCache.has(cacheKey)) {
    return resolvedChannelCache.get(cacheKey);
  }
  // 1. EXACT â€” Innertube resolveURL on the @handle page itself: a handle URL
  //    can only ever belong to ONE channel, unlike search (which returned the
  //    first hit and could land on a different channel entirely).
  try {
    const ep = await yt.resolveURL(`https://www.youtube.com/@${id}`);
    const browseId = ep?.payload?.browseId;
    if (browseId && browseId.startsWith('UC')) {
      resolvedChannelCache.set(cacheKey, browseId);
      return browseId;
    }
  } catch (_) {}
  // 2. EXACT â€” fetch the @handle page HTML, take the canonical /channel/UC id.
  try {
    const resp = await fetch(encodeURI(`https://www.youtube.com/@${id}`));
    if (resp.ok) {
      const html = await resp.text();
      const m = html.match(/\/channel\/(UC[\w-]{20,})/);
      if (m) {
        const UC = m[1];
        resolvedChannelCache.set(cacheKey, UC);
        return UC;
      }
    }
  } catch (_) {}
  // 3. LAST RESORT â€” search can return a DIFFERENT channel; prefer the result
  //    whose canonical URL matches the handle, warn when falling back blindly.
  try {
    const results = await yt.search(id);
    const channels = results.channels || [];
    const wanted = '@' + id.toLowerCase();
    const exact = channels.find(c => {
      const url = (c.author?.url || c.author?.endpoint?.payload?.canonicalBaseUrl || '').toLowerCase();
      return url.includes(wanted);
    });
    const pick = exact || channels[0];
    if (pick?.id) {
      if (!exact) {
        dlog(`[resolveChannelId] search fallback for "${id}" -> ${pick.id} (handle NOT verified â€” check the channel!)`);
      }
      resolvedChannelCache.set(cacheKey, pick.id);
      return pick.id;
    }
  } catch (_) {}
  return decodedId;
}

// â”€â”€â”€ LockupView extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function isRelativeTimeText(text) {
  if (!text) return false;
  const clean = text.toLowerCase();
  const indicators = [
    'ago', 'trÆ°á»›c', 'å‰', '́ „', 'hour', 'min', 'day', 'week', 'month', 'year',
    'giĂ¢y', 'phĂºt', 'giá»', 'ngĂ y', 'tuáº§n', 'thĂ¡ng', 'nÄƒm',
    'ç§’', 'åˆ†', 'æ™‚', 'æ—¥', 'é€±', 'æœˆ', 'å¹´',
    '́´ˆ', 'ë¶„', '́‹œ', '́¼', '́£¼', 'ë‹¬', 'í•´',
    'seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years',
    'new', 'má»›i', 'vá»«a xong', 'just now', 'æ–°ç€', 'æ–°ă—', 'ăƒ©ă‚¤ăƒ–', 'ç”Ÿæ”¾é€', 'é…ä¿¡ä¸­', 'å…¬é–‹ä¸­',
    'ăƒ—ăƒ¬ăƒŸă‚¢', 'è¦–è´ä¸­', '́ƒˆë¡œ́´', '́ƒˆ ë™́˜́ƒ', 'ë°©ê¸ˆ', '́µœ́‹ ', '́‹¤́‹œê°„', 'ë¼́´ë¸Œ', '́µœ́´ˆ ê³µê°œ',
    'live', 'trá»±c tiáº¿p', 'Ä‘ang phĂ¡t', 'premiering', 'cĂ´ng chiáº¿u', 'watching', 'Ä‘ang xem'
  ];
  return indicators.some(ind => clean.includes(ind));
}

function parseRelativeTime(text) {
  if (!text) return 0;
  const cleanText = text.replace(/\u00a0/g, ' ').trim().toLowerCase();

  // LIVE / premiering-now with a viewer count: "1,234 watching", "1.2\ucc9c\uba85 \uc2dc\uccad \uc911",
  // "3.4K \u0111ang xem" \u2014 digits are a VIEWER COUNT, not an age. Without this the
  // digit branch below returns 0 (no time unit matches) and a premiere that just
  // went live is never re-detected until it ends.
  if (/\d/.test(cleanText)) {
    const liveMarkers = ['watching', '\uc2dc\uccad \uc911', '\u0111ang xem', 'tr\u1ef1c ti\u1ebfp', '\u0111ang ph\u00e1t', 'live now', '\u914d\u4fe1\u4e2d', '\u8996\u8074\u4e2d', '\u30e9\u30a4\u30d6', '\ub77c\uc774\ube0c', '\uc2e4\uc2dc\uac04', '\uc0dd\ubc29\uc1a1', 'viewers', 'en directo'];
    const hasPast = ['ago', 'tr\u01b0\u1edbc', '\u524d', '\uc804'].some(m => cleanText.includes(m));
    if (!hasPast && liveMarkers.some(m => cleanText.includes(m))) {
      return Date.now();
    }
  }

  // UPCOMING premieres/scheduled streams: "Premieres in 5 minutes", "5\ubd84 \ud6c4 \ucd5c\ucd08 \uacf5\uac1c",
  // "C\u00f4ng chi\u1ebfu sau 5 ph\u00fat", "7/13 21:00 \u306b\u30d7\u30ec\u30df\u30a2\u516c\u958b" \u2014 future times must NOT be
  // parsed as "X ago" (the digit branch below would return now-5min and the video
  // would pass the age filter, then loop on yt-dlp "Premieres in..." failures).
  // Return 0 = unknown publish time \u2192 Rust age filter skips it until it goes live.
  // Past forms ("Premiered 3 hours ago", "\u0110\u00e3 c\u00f4ng chi\u1ebfu 3 gi\u1edd tr\u01b0\u1edbc", "3\uc2dc\uac04 \uc804\uc5d0
  // \ucd5c\ucd08 \uacf5\uac1c") contain a past marker and fall through to normal parsing.
  if (/\d/.test(cleanText)) {
    const hasPastMarker = ['ago', 'tr\u01b0\u1edbc', '\u524d', '\uc804'].some(m => cleanText.includes(m));
    const upcomingMarkers = ['premiere', 'scheduled', '\ucd5c\ucd08 \uacf5\uac1c', '\uacf5\uac1c \uc608\uc815', '\u30d7\u30ec\u30df\u30a2\u516c\u958b', '\u516c\u958b\u4e88\u5b9a', 'c\u00f4ng chi\u1ebfu', 'estreno', 'premi\u00e8re'];
    if (!hasPastMarker && upcomingMarkers.some(m => cleanText.includes(m))) {
      return 0;
    }
  }

  // Split by common delimiters to isolate the relative time part
  const parts = cleanText.split(/[\u2022\u00b7\u2023\u2043|â€¢Â·-]/);
  let timePart = cleanText;
  
  // Look for the part that contains relative time indicators
  const indicators = ['ago', 'trÆ°á»›c', 'å‰', '́ „', 'hour', 'min', 'day', 'week', 'month', 'year', 'giĂ¢y', 'phĂºt', 'giá»', 'ngĂ y', 'tuáº§n', 'thĂ¡ng', 'nÄƒm', 'ç§’', 'åˆ†', 'æ™‚', 'æ—¥', 'é€±', 'æœˆ', 'å¹´', '́´ˆ', 'ë¶„', '́‹œ', '́¼', '́£¼', 'ë‹¬', 'í•´'];
  for (const part of parts) {
    const trimmedPart = part.trim();
    if (indicators.some(ind => trimmedPart.includes(ind))) {
      timePart = trimmedPart;
      break;
    }
  }
  
  // Handle "New", "Má»›i", "Live", "Trá»±c tiáº¿p", "Äang phĂ¡t trá»±c tiáº¿p", etc., if no numeric digit is present
  if (!/\d/.test(timePart)) {
    if (
      timePart.includes('new') || 
      timePart.includes('má»›i') || 
      timePart.includes('vá»«a xong') ||
      timePart.includes('just now') ||
      // Japanese
      timePart.includes('æ–°ç€') ||
      timePart.includes('æ–°ă—') ||
      timePart.includes('ăƒ©ă‚¤ăƒ–') ||
      timePart.includes('ç”Ÿæ”¾é€') ||
      timePart.includes('é…ä¿¡ä¸­') ||
      timePart.includes('å…¬é–‹ä¸­') ||
      timePart.includes('ăƒ—ăƒ¬ăƒŸă‚¢') ||
      timePart.includes('è¦–è´ä¸­') ||
      // Korean
      timePart.includes('́ƒˆë¡œ́´') ||
      timePart.includes('́ƒˆ ë™́˜́ƒ') ||
      timePart.includes('ë°©ê¸ˆ') ||
      timePart.includes('́µœ́‹ ') ||
      timePart.includes('́‹¤́‹œê°„') ||
      timePart.includes('ë¼́´ë¸Œ') ||
      timePart.includes('́µœ́´ˆ ê³µê°œ') ||
      timePart.includes('́‹œ́²­ ́¤‘') ||
      // Existing defaults
      timePart === 'live' || 
      timePart.includes('trá»±c tiáº¿p') || 
      timePart.includes('Ä‘ang phĂ¡t') || 
      timePart.includes('premiering') || 
      timePart.includes('cĂ´ng chiáº¿u') ||
      timePart.includes('watching') ||
      timePart.includes('Ä‘ang xem')
    ) {
      return Date.now();
    }
  }
  
  const m = timePart.match(/(\d+)\s*(.+)/);
  if (m) {
    const val = parseInt(m[1], 10);
    const unit = m[2].trim();
    const now = Date.now();
    
    // Seconds â€” includes abbreviated "5s ago" format (YouTube sometimes uses it)
    if (
      unit.startsWith('second') || unit.startsWith('sec') || unit === 's ago' ||
      unit.startsWith('s ') || unit.includes('giĂ¢y') || 
      unit.includes('ç§’') || unit.includes('́´ˆ') || unit.includes('sekunde') || 
      unit.includes('segundo') || unit.includes('ÑĐµĐºÑƒĐ½Đ´')
    ) {
      return now - val * 1000;
    }
    // Minutes
    if (
      unit.startsWith('minute') || unit.startsWith('min') || unit.includes('phĂºt') || 
      unit.includes('åˆ†') || unit.includes('ë¶„') || unit.includes('minute') || 
      unit.includes('minuto') || unit.includes('Đ¼Đ¸Đ½ÑƒÑ‚')
    ) {
      return now - val * 60 * 1000;
    }
    // Hours
    if (
      unit.startsWith('hour') || unit.startsWith('hr') || unit.includes('giá»') || 
      unit.includes('æ™‚é–“') || unit.includes('́‹œê°„') || unit.includes('stunde') || 
      unit.includes('heure') || unit.includes('hora') || unit.includes('Ñ‡Đ°Ñ')
    ) {
      return now - val * 3600 * 1000;
    }
    // Days
    if (
      unit.startsWith('day') || unit.includes('ngĂ y') || unit.includes('æ—¥') || 
      unit.includes('́¼') || unit.includes('tag') || unit.includes('jour') || 
      unit.includes('dĂ­a') || unit.includes('Đ´Đ½Đµ') || unit.includes('ÑÑƒÑ‚Đ¾Đº')
    ) {
      return now - val * 86400 * 1000;
    }
    // Weeks
    if (
      unit.startsWith('week') || unit.startsWith('wk') || unit.includes('tuáº§n') || 
      unit.includes('é€±') || unit.includes('́£¼') || unit.includes('woche') || 
      unit.includes('semaine') || unit.includes('semana') || unit.includes('Đ½ĐµĐ´ĐµĐ»')
    ) {
      return now - val * 604800 * 1000;
    }
    // Months
    if (
      unit.startsWith('month') || unit.startsWith('mo') || unit.includes('thĂ¡ng') || 
      unit.includes('æœˆ') || unit.includes('ê°œ́›”') || unit.includes('ë‹¬') || 
      unit.includes('monat') || unit.includes('mois') || unit.includes('mes') || 
      unit.includes('Đ¼ĐµÑÑÑ†')
    ) {
      return now - val * 2592000 * 1000;
    }
    // Years
    if (
      unit.startsWith('year') || unit.startsWith('yr') || unit.includes('nÄƒm') || 
      unit.includes('å¹´') || unit.includes('ë…„') || unit.includes('jahr') || 
      unit.includes('an') || unit.includes('aĂ±o') || unit.includes('Đ»ĐµÑ‚') || 
      unit.includes('Đ³Đ¾Đ´')
    ) {
      return now - val * 31536000 * 1000;
    }
  }
  
  // Return 1 if there is text, representing a non-empty but non-relative/fixed date string (old video)
  return 1;
}

function extractPublishedAtFromLockup(lv) {
  const metadata = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel 
                || lv.metadata?.metadata;
  if (!metadata) return 0;
  
  const rows = metadata.metadataRows || metadata.metadata_rows;
  if (!rows) return 0;

  let hasFallback = false;
  for (const row of rows) {
    const parts = row.metadataParts || row.metadata_parts;
    if (!parts) continue;
    for (const part of parts) {
      const text = part.text?.content || part.text?.text || (typeof part.text === 'string' ? part.text : '');
      const parsed = parseRelativeTime(text);
      if (parsed > 1) {
        return parsed;
      } else if (parsed === 1) {
        hasFallback = true;
      }
    }
  }
  return hasFallback ? 1 : 0;
}

function extractDurationFromLockup(lv) {
  let durationSec = 0;
  const overlays = lv.contentImage?.lockupContentImageViewModel?.overlays 
                || lv.contentImage?.overlays 
                || lv.content_image?.overlays 
                || [];
                
  for (const overlay of overlays) {
    const renderer = overlay.thumbnailOverlayTimeStatusRenderer;
    if (renderer) {
      const t = renderer.text?.simpleText || renderer.text?.content || '';
      if (t.includes(':')) {
        const p = t.split(':');
        if (p.length === 2) durationSec = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
        else if (p.length === 3) durationSec = parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseInt(p[2], 10);
      }
    }
    if (overlay.badges?.length > 0) {
      const t = overlay.badges[0].text || '';
      if (t.includes(':')) {
        const p = t.split(':');
        if (p.length === 2) durationSec = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
        else if (p.length === 3) durationSec = parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseInt(p[2], 10);
      }
    }
  }
  return durationSec;
}

/// Language-independent upcoming check: scheduled premieres/streams carry an
/// "UPCOMING" time-status overlay style in the lockup JSON regardless of UI
/// language â€” text-marker parsing missed Korean premiere forms and let them
/// into the pipeline (observed: rckmDHThyT8 detected with a bogus 10-min age).
function lockupIsUpcoming(lv) {
  try {
    const overlays = lv.contentImage?.lockupContentImageViewModel?.overlays
                  || lv.contentImage?.overlays
                  || lv.content_image?.overlays
                  || [];
    return JSON.stringify(overlays).includes('UPCOMING');
  } catch (_) { return false; }
}

/// Collect the raw metadata text of an upcoming lockup ("CĂ´ng chiáº¿u 18:35",
/// "Premieres 7/13, 6:35 PM") â€” shown as-is in the UI, no parsing needed.
function extractScheduleTextFromLockup(lv) {
  try {
    const metadata = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
                  || lv.metadata?.metadata;
    const rows = metadata?.metadataRows || metadata?.metadata_rows || [];
    const parts = [];
    for (const row of rows) {
      for (const part of (row.metadataParts || row.metadata_parts || [])) {
        const text = part.text?.content || part.text?.text || (typeof part.text === 'string' ? part.text : '');
        if (text) parts.push(text.trim());
      }
    }
    return parts.join(' Â· ').slice(0, 120);
  } catch (_) { return ''; }
}

// Pass 146 â€” rĂºt UC id tá»« má»™t khá»‘i metadata báº¥t ká»³ (LockupView cá»§a feed Ä‘Äƒng
// kĂ½). Cáº¥u trĂºc lockup Ä‘á»•i theo mĂ¹a, cĂ²n browseId cá»§a kĂªnh thĂ¬ luĂ´n náº±m Ä‘Ă¢u Ä‘Ă³
// trong onTap/endpoint â€” quĂ©t chuá»—i lĂ  cĂ¡ch bá»n nháº¥t, vĂ  ta chá»‰ cáº§n Ä‘Ăºng 1 id.
function extractChannelIdLoose(obj) {
  try {
    const s = JSON.stringify(obj || {});
    const m = s.match(/"browseId":"(UC[\w-]{22})"/) || s.match(/\/channel\/(UC[\w-]{22})/);
    return m ? m[1] : '';
  } catch (_) { return ''; }
}

// Pass 146 â€” rĂºt UC id tá»« má»™t khá»‘i metadata báº¥t ká»³ (LockupView cá»§a feed Ä‘Äƒng
// kĂ½). Cáº¥u trĂºc lockup Ä‘á»•i theo mĂ¹a, cĂ²n browseId cá»§a kĂªnh thĂ¬ luĂ´n náº±m Ä‘Ă¢u Ä‘Ă³
// trong onTap/endpoint â€” quĂ©t chuá»—i lĂ  cĂ¡ch bá»n nháº¥t, vĂ  ta chá»‰ cáº§n Ä‘Ăºng 1 id.
function extractChannelIdLoose(obj) {
  try {
    const s = JSON.stringify(obj || {});
    const m = s.match(/"browseId":"(UC[\w-]{22})"/) || s.match(/\/channel\/(UC[\w-]{22})/);
    return m ? m[1] : '';
  } catch (_) { return ''; }
}

function extractFromLockupView(lv) {
  const videoId = lv.content_id || lv.contentId;
  if (!videoId) return null;

  const title = lv.metadata?.lockupMetadataViewModel?.title?.content 
             || lv.metadata?.title?.text 
             || lv.metadata?.title?.runs?.[0]?.text 
             || '';

  const isUpcoming = lockupIsUpcoming(lv);
  let publishedAt = isUpcoming ? 0 : extractPublishedAtFromLockup(lv);
  let durationSec = extractDurationFromLockup(lv);

  let thumbnailUrl = '';
  const sources = lv.contentImage?.lockupContentImageViewModel?.image?.sources 
               || lv.contentImage?.thumbnailViewModel?.image?.sources
               || lv.contentImage?.image?.sources
               || lv.contentImage?.image 
               || lv.content_image?.image 
               || [];
  if (sources.length > 0) thumbnailUrl = sources[0].url || '';
  if (!thumbnailUrl && videoId) thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  
  return {
    videoId, title, publishedAt, thumbnailUrl, durationSec,
    upcoming: isUpcoming,
    scheduleText: isUpcoming ? extractScheduleTextFromLockup(lv) : '',
  };
}

function extractPublishedAt(v) {
  if (v.published && v.published.timestamp) {
    const ts = Number(v.published.timestamp);
    return ts > 1e12 ? ts : ts * 1000;
  }
  // Fallback to parsing published text (e.g. "3 hours ago", "3 giá» trÆ°á»›c")
  let text = '';
  if (v.published && v.published.text) text = v.published.text;
  else if (typeof v.published === 'string') text = v.published;
  return parseRelativeTime(text) || 0;
}

function normalizeVideo(v) {
  return {
    videoId: v.id || v.videoId || '',
    title: (v.title && v.title.text) || v.title || '',
    publishedAt: (v.is_upcoming || v.upcoming) ? 0 : extractPublishedAt(v),
    thumbnailUrl: (() => { try { const s = [...(v.thumbnails||[])].sort((a,b)=>(b.width||0)-(a.width||0)); return s[0]?.url||''; } catch(_){return'';}})(),
    durationSec: (() => { try { return v.duration?.seconds||v.duration_seconds||0; } catch(_){return 0;} })(),
  };
}

async function strategyPlaylistInnertube(client, playlistId) {
  try {
    const playlist = await client.getPlaylist(playlistId);
    if (playlist.items && playlist.items.length > 0) {
      // youtubei.js â‰¥17.2 tráº£ LockupView (renderer má»›i cá»§a YouTube) trong
      // playlist.items thay cho PlaylistVideo: v.id/v.title lĂ  undefined nĂªn
      // map cÅ© lá»c sáº¡ch 68 item xuá»‘ng 0 vĂ  há»ng IM Láº¶NG â€” poller Ä‘á»c thĂ nh
      // "throttled/empty" suá»‘t, auto-detect cháº¿t háº³n (mĂ¡y má»›i 2026-07-20,
      // package-lock bá»‹ gitignore nĂªn npm kĂ©o báº£n má»›i hÆ¡n mĂ¡y cÅ©).
      // extractFromLockupView Ä‘Ă£ Ä‘á»c Ä‘Ăºng content_id/metadata.title.
      const mapped = playlist.items
        .map(v => (v.type === 'LockupView' || v.content_id)
          ? extractFromLockupView(v)
          : {
              videoId: v.id || '',
              title: v.title?.text || v.title || '',
              publishedAt: (v.is_upcoming || v.upcoming) ? 0 : extractPublishedAt(v),
              thumbnailUrl: v.thumbnails?.[0]?.url || '',
              durationSec: v.duration?.seconds || 0,
              upcoming: !!(v.is_upcoming || v.upcoming),
              scheduleText: '',
            })
        .filter(v => v && v.videoId);
      if (mapped.length > 0) return mapped;
      dlog(`[strategyPlaylistInnertube] ${playlistId}: ${playlist.items.length} item nhÆ°ng 0 cĂ¡i rĂºt Ä‘Æ°á»£c videoId â€” kiá»ƒu item láº¡ (${playlist.items[0]?.type || playlist.items[0]?.constructor?.name})`);
    }
    const memo = playlist.page?.contents_memo;
    if (memo) {
      const lockups = memo.get('LockupView') || [];
      return lockups.map(extractFromLockupView).filter(v => v !== null);
    }
    return [];
  } catch (e) {
    // Nuá»‘t lá»—i tráº¯ng á»Ÿ Ä‘Ă¢y tá»«ng che máº¥t Ä‘Ăºng bug trĂªn: lá»—i pháº£i Ä‘á»ƒ láº¡i váº¿t.
    dlog(`[strategyPlaylistInnertube] ${playlistId} lá»—i: ${e && e.message ? e.message : e}`);
    return [];
  }
}

// Fast surface probe â€” the uploads-playlist WEB PAGE lists brand-new videos
// immediately, minutes before the Innertube browse/playlist API index catches up
// (observed: API list stuck at 87 videos for 11 minutes while a new upload was
// already public). Restored from commit 29b1f01 per the "Instant Playlist HTML
// Resolver" design in docs/_archived/AUTO_INGESTION_TECH_OVERVIEW.md; the page
// weighs ~0.5MB so this only runs for fastProbe channels (bandwidth discipline).
async function strategyPlaylistHTML(channelId, cookieStr) {
  try {
    const playlistId = channelId.replace(/^UC/, 'UU');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}&_t=${Date.now()}&_r=${Math.random()}`, {
      signal: controller.signal,
      headers: {
        'Cookie': cookieStr || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const html = await res.text();
    const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (!match) return [];
    const data = JSON.parse(match[1]);
    const items = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
    if (!items || !Array.isArray(items)) return [];
    return items.slice(0, 15).map(item => {
      const lv = item.lockupViewModel;
      if (!lv) return null;
      // Upcoming premieres must not enter the instant resolver â€” they would be
      // stamped "published now" and loop through yt-dlp premiere failures.
      if (JSON.stringify(lv.contentImage || {}).includes('UPCOMING')) return null;
      const videoId = lv.contentId;
      const title = lv.metadata?.lockupMetadataViewModel?.title?.content || '';
      return { videoId, title, publishedAt: 0, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, durationSec: 0 };
    }).filter(v => v !== null && v.videoId);
  } catch (_) { return []; }
}

// Playability gate for HTML-fresh candidates. The playlist page is fetched
// WITH the operator's session cookie, and for channels owned/managed by that
// account the owner-view page also lists PRIVATE videos â€” which never appear
// in the API playlist, so the resolver mistook them for brand-new uploads and
// fired downloads that all died in yt-dlp with "Private video" (customer log
// 2026-07-13 18-57-03: 4 private videos â†’ 4 failed workspaces at startup,
// each also holding the sequential download queue). Same risk applies to
// members-only content. Verify via the player endpoint before ingesting;
// rejected ids are cached and re-checked at most once per minute so a private
// video that later goes public is still picked up quickly.
const htmlFreshRejected = new Map(); // videoId -> { ts, count } láº§n bá»‹ tá»« chá»‘i
// 20s: a rejected candidate (private / still processing) is re-verified at most
// every 20s, so a video flipped public â€” or an upload that finishes processing â€”
// is picked up within one recheck window. Player call cost only applies to the
// handful of HTML-fresh candidates, so this stays negligible.
const HTML_FRESH_RECHECK_MS = 20000;
// Backoff lÅ©y tiáº¿n cho video bá»‹ tá»« chá»‘i NHIá»€U Láº¦N (private náº±m lĂ¬ trong
// owner-view): 20s â†’ 40 â†’ 80 â†’ cap 120s. 7 video private "cháº¿t" bá»‹ verify
// má»—i cycle + retry 403 tá»«ng kĂ©o getLatestVideo cá»§a kĂªnh lĂªn hĂ ng chá»¥c giĂ¢y
// vĂ  sáº­p cadence poll toĂ n cá»¥c 2s â†’ 98s (log khĂ¡ch 2026-07-17 16-19). Video
// flip public Ä‘iá»ƒn hĂ¬nh (private vĂ i phĂºt) váº«n dĂ­nh recheck 20-80s; Ä‘Æ°á»ng
// API/playlist báº¯t flip song song nĂªn khĂ´ng máº¥t video.
const HTML_FRESH_RECHECK_CAP_MS = 120000;
// Playable verdicts are cached too: owner-view pages keep listing videos the
// app already ingested (seen-dedup drops them Rust-side), which re-verified
// the SAME playable ids every probe cycle â€” one wasted /player call each
// (observed 2026-07-15 19-13-54: eSoEO12_tbA re-verified every ~30s forever).
// 10-minute TTL bounds the staleness if a video is flipped back to private.
const htmlFreshPlayable = new Map(); // videoId -> { ts, durationSec }
const HTML_FRESH_PLAYABLE_TTL_MS = 600000;

// stderr is drained into the Rust log (tracing "[InnertubeDaemon]") â€” stdout
// carries the JSON protocol, NEVER log there.
function dlog(msg) { try { process.stderr.write(msg + '\n'); } catch (_) {} }

// The gate must verify with an ANONYMOUS client, not the session client:
// yt-dlp's first download attempt runs without cookies, and the operator
// account often OWNS the probed channel â€” an authenticated check would call
// the owner's own private videos playable. Client context must be ANDROID:
// the default WEB /player response without visitor-data/po_token is
// "UNPLAYABLE Video unavailable" for EVERY video (verified 2026-07-13 with
// the bundled youtubei.js 17.0.1 â€” even a public control video), while
// ANDROID cleanly returns OK for public and LOGIN_REQUIRED for private.
let gateClientPromise = null;
function ensureGateClient() {
  if (!gateClientPromise) {
    gateClientPromise = Innertube.create({ retrieve_player: false });
    gateClientPromise.catch(() => { gateClientPromise = null; });
  }
  return gateClientPromise;
}

// Giá» Ä‘Äƒng THáº¬T tá»« microformat cá»§a /player.
//
// VĂ¬ sao pháº£i cáº©n tháº­n: Ä‘Æ°á»ng HTML-fresh trÆ°á»›c Ä‘Ă¢y Ä‘Ă³ng dáº¥u `publishedAt =
// Date.now()` Ä‘á»ƒ qua bá»™ lá»c tuá»•i, nhÆ°ng con sá»‘ Ä‘Ă³ cháº£y tháº³ng vĂ o badge Ä‘á»™ trá»…
// (latency = detectedAt âˆ’ publishedAt) vĂ  lĂ m badge bĂ¡o ~0s cho Má»ŒI video báº¯t
// báº±ng Ä‘Æ°á»ng nĂ y â€” Ä‘Ăºng kiá»ƒu "lĂ m Ä‘áº¹p sá»‘" mĂ  INVARIANT #24 cáº¥m.
//
// Microformat cĂ³ lĂºc chá»‰ tráº£ NGĂ€Y (khĂ´ng cĂ³ giá»). Láº¥y nguyĂªn cĂ¡i Ä‘Ă³ cĂ²n tá»‡ hÆ¡n
// now(): badge sáº½ nháº£y lĂªn hĂ ng giá». NĂªn chá»‰ nháº­n khi phĂ¢n tĂ­ch ra má»™t má»‘c Ä‘áº§y
// Ä‘á»§ vĂ  náº±m trong cá»­a sá»• há»£p lĂ½; ngoĂ i ra tráº£ 0 Ä‘á»ƒ caller tá»± quyáº¿t.
function publishedAtMsFromPlayer(info) {
  const mf = (info && info.microformat) || {};
  const raw = mf.publish_date || mf.publishDate || mf.upload_date || mf.uploadDate ||
    (info && info.basic_info && info.basic_info.start_timestamp) || null;
  if (!raw) return 0;
  let ms = 0;
  if (raw instanceof Date) ms = raw.getTime();
  else {
    const s = String(raw);
    // "2026-08-12" (chá»‰ ngĂ y) parse ra ná»­a Ä‘Ăªm UTC â€” khĂ´ng dĂ¹ng Ä‘Æ°á»£c.
    if (!/\d{2}:\d{2}/.test(s)) return 0;
    ms = Date.parse(s);
  }
  if (!ms || isNaN(ms)) return 0;
  const now = Date.now();
  // QuĂ¡ 7 ngĂ y trÆ°á»›c hoáº·c á»Ÿ tÆ°Æ¡ng lai = khĂ´ng pháº£i thá»© ta Ä‘ang tĂ¬m.
  if (ms < now - 7 * 86400000 || ms > now + 3600000) return 0;
  return ms;
}

async function verifyHtmlFreshPlayable(videoId) {
  const cachedOk = htmlFreshPlayable.get(videoId);
  if (cachedOk && Date.now() - cachedOk.ts < HTML_FRESH_PLAYABLE_TTL_MS) {
    return {
      playable: true,
      durationSec: cachedOk.durationSec,
      title: cachedOk.title || '',
      publishedAtMs: cachedOk.publishedAtMs || 0,
    };
  }
  const rej = htmlFreshRejected.get(videoId);
  if (rej) {
    const wait = Math.min(
      HTML_FRESH_RECHECK_MS * Math.pow(2, Math.max(0, (rej.count || 1) - 1)),
      HTML_FRESH_RECHECK_CAP_MS
    );
    if (Date.now() - rej.ts < wait) return { playable: false };
  }
  if (htmlFreshRejected.size > 200) {
    for (const [id, entry] of htmlFreshRejected) {
      if (Date.now() - entry.ts > 3600000) htmlFreshRejected.delete(id);
    }
  }
  try {
    const gateClient = await ensureGateClient();
    const info = await gateClient.getBasicInfo(videoId, { client: 'ANDROID' });
    const status = info.playability_status?.status || '';
    const playable = status === 'OK' && !info.basic_info?.is_upcoming;
    if (!playable) {
      const prev = htmlFreshRejected.get(videoId);
      htmlFreshRejected.set(videoId, { ts: Date.now(), count: ((prev && prev.count) || 0) + 1 });
      dlog(`[probe-gate] ${videoId} rejected: playability=${status || 'unknown'} reason="${info.playability_status?.reason || ''}" upcoming=${!!info.basic_info?.is_upcoming}`);
      return { playable: false };
    }
    htmlFreshRejected.delete(videoId);
    if (htmlFreshPlayable.size > 200) {
      for (const [id, entry] of htmlFreshPlayable) {
        if (Date.now() - entry.ts > HTML_FRESH_PLAYABLE_TTL_MS) htmlFreshPlayable.delete(id);
      }
    }
    const durationSec = info.basic_info?.duration || 0;
    // /player title = original language (browse surfaces auto-translate).
    const title = info.basic_info?.title || '';
    const publishedAtMs = publishedAtMsFromPlayer(info);
    htmlFreshPlayable.set(videoId, { ts: Date.now(), durationSec, title, publishedAtMs });
    return { playable: true, durationSec, title, publishedAtMs };
  } catch (e) {
    // Player errors (private videos often throw) count as not playable.
    const prev = htmlFreshRejected.get(videoId);
    htmlFreshRejected.set(videoId, { ts: Date.now(), count: ((prev && prev.count) || 0) + 1 });
    dlog(`[probe-gate] ${videoId} rejected: player error ${(e && e.message) || e}`);
    return { playable: false };
  }
}

// â”€â”€â”€ Native progressive download (hot-path replacement for yt-dlp) â”€â”€â”€â”€â”€â”€â”€â”€â”€
// yt-dlp pays ~2.5-3s of process spawn + extractor + player fetch on EVERY
// download; this warm daemon already holds an authenticated session and the
// player, so bytes start flowing almost immediately (docs/DETECTION_LATENCY
// section 5: "native download qua Innertube daemon" â€” the remaining e2e item).
// Progressive MP4 only (itag 18 first): one file, no merge step, moov at the
// front so a byte-capped capture stays readable for the Rust-side ffmpeg trim.
// Any throw here is non-fatal: the Rust caller falls back to yt-dlp.

// Pick the progressive (video+audio single-file) MP4 at or under maxHeight.
//
// Báº£n trÆ°á»›c tráº£ itag 18 VĂ” ÄIá»€U KIá»†N trÆ°á»›c khi xĂ©t maxHeight. YouTube gáº§n nhÆ°
// luĂ´n cĂ³ itag 18, nĂªn nhĂ¡nh Ä‘Ă³ luĂ´n trĂºng vĂ  Má»ŒI video Ä‘á»u táº£i 360p báº¥t ká»ƒ
// `autoDownloadQuality` Ä‘áº·t bao nhiĂªu â€” cĂ i Ä‘áº·t cháº¥t lÆ°á»£ng thá»±c táº¿ khĂ´ng cĂ³
// tĂ¡c dá»¥ng (log khĂ¡ch 11/08: 8/8 lÆ°á»£t táº£i Ä‘á»u `itag=18`, rá»“i bá»‹ render phĂ³ng
// ngÆ°á»£c lĂªn 720p nĂªn hĂ¬nh nhĂ²e).
//
// Giá»¯ Æ°u tiĂªn itag 18 khi khĂ¡ch THáº¬T Sá»° muá»‘n â‰¤360p (má»™t file, khĂ´ng pháº£i ghĂ©p,
// moov náº±m Ä‘áº§u â€” Ä‘Ăºng lĂ½ do Ä‘Æ°á»ng native chá»n progressive), cĂ²n láº¡i láº¥y báº£n
// progressive cao nháº¥t vá»«a tráº§n: thÆ°á»ng lĂ  itag 22 (720p).
function pickProgressiveFormat(info, maxHeight) {
  const formats = (info.streaming_data && info.streaming_data.formats) || [];
  const isMp4 = (f) => (f.mime_type || '').includes('mp4');
  const candidates = formats
    .filter(f => f.has_video && f.has_audio && isMp4(f) && (f.height || 0) <= maxHeight)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (candidates.length) return candidates[0];
  // KhĂ´ng báº£n nĂ o vá»«a tráº§n (kĂªnh chá»‰ cĂ³ Ä‘á»‹nh dáº¡ng cao hÆ¡n) â†’ itag 18 lĂ m phao
  // cuá»‘i: thĂ  360p cĂ²n hÆ¡n rÆ¡i xuá»‘ng yt-dlp vĂ  máº¥t vĂ i giĂ¢y spawn.
  return formats.find(f => f.itag === 18) || null;
}

// Replicate yt-dlp --download-sections cheaply: cap the byte range at
// limit/duration of the file +15% container slack; the Rust-side ffmpeg trim
// cuts the exact duration afterwards. itag 18 often omits content_length
// (verified 2026-07-15: ANDROID response clen=0), so fall back to a
// bitrateĂ—duration estimate.
function computeByteRange(format, durationSec, limitSec) {
  const clen = Number(format.content_length || 0);
  let estBytes = clen;
  if (!estBytes) {
    const bitrate = Number(format.bitrate || 0); // bits/sec
    if (bitrate > 0 && durationSec > 0) estBytes = Math.ceil((bitrate / 8) * durationSec);
  }
  if (limitSec > 0 && durationSec > limitSec && estBytes > 0) {
    const capped = Math.min(estBytes - 1, Math.ceil(estBytes * (limitSec / durationSec) * 1.08));
    return { start: 0, end: capped };
  }
  return null;
}

function runFileAsync(filePath, args) {
  const childProcess = require('child_process');
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(filePath, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process failed with exit code ${code}: ${filePath}`));
    });
  });
}

// UA per innertube client context: googlevideo can enforce coherence between
// the client that issued the URL and the UA that fetches it.
const CLIENT_UA = {
  IOS: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
  ANDROID: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  WEB: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// Direct media fetch: plain https GET on the deciphered googlevideo URL with
// minimal headers â€” exactly what yt-dlp does and what googlevideo accepts most
// reliably (info.download() kept 403-ing where yt-dlp succeeded, observed
// 2026-07-15 20-40-35). `localAddress` binds the physical NIC so the transfer
// skips a VPN tunnel â€” parity with yt-dlp's --source-address (docs: "Direct IP
// binding"). Follows redirects; rejects carry `httpStatus` when the server
// answered with a definite status.
function fetchUrlToFile(url, range, outputPath, localAddress, ua) {
  const https = require('https');
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    let redirects = 0;
    const attempt = (u, bindIp) => {
      const opts = { headers: { 'User-Agent': ua || CLIENT_UA.WEB, 'Accept': '*/*' } };
      if (range) opts.headers['Range'] = `bytes=${range.start}-${range.end}`;
      if (bindIp) opts.localAddress = bindIp;
      const req2 = https.get(u, opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          redirects++;
          res.resume();
          return attempt(res.headers.location, bindIp);
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          const err = new Error(`media fetch HTTP ${res.statusCode}`);
          err.httpStatus = res.statusCode;
          return reject(err);
        }
        const out = fs.createWriteStream(outputPath);
        let written = 0;
        res.on('data', (chunk) => { written += chunk.length; });
        res.on('error', (e) => { out.destroy(); reject(e); });
        out.on('error', (e) => reject(e));
        out.on('finish', () => resolve(written));
        res.pipe(out);
      });
      req2.on('error', (e) => {
        // A misconfigured/absent NIC must not kill the native path â€” retry
        // once on the default route instead.
        if (bindIp && /EADDRNOTAVAIL|EINVAL|bind|address not available/i.test(String((e && e.message) || e))) {
          noteBindFailure(bindIp, e);
          return attempt(u, null);
        }
        reject(e);
      });
      req2.setTimeout(30000, () => { req2.destroy(new Error('media fetch timeout')); });
    };
    attempt(url, bindAllowed(localAddress) ? localAddress : null);
  });
}

// One ranged GET, redirect-following, resolved with the live response stream
// (206 or 200). Shared by the parallel fetcher; bind failures retry once on
// the default route like fetchUrlToFile.
// `agent` (Pass 90, fetch v2): https.Agent keep-alive dĂ¹ng chung cho cáº£ lÆ°á»£t â€”
// chunk thá»© hai trĂªn cĂ¹ng socket Ä‘i tiáº¿p cwnd Ä‘Ă£ lá»›n thay vĂ¬ slow-start láº¡i.
function httpGetRange(url, start, end, ua, bindIp, agent, timeoutMs, lookup) {
  const https = require('https');
  const sockTimeout = timeoutMs || 30000;
  return new Promise((resolve, reject) => {
    let redirects = 0;
    const attempt = (u, ip) => {
      const opts = { headers: { 'User-Agent': ua, 'Accept': '*/*', 'Range': `bytes=${start}-${end}` } };
      if (ip) opts.localAddress = ip;
      if (agent) opts.agent = agent;
      // v2: DNS Ä‘Ă£ giáº£i má»™t láº§n cho cáº£ lÆ°á»£t â€” 16 lookup song song trĂªn
      // threadpool 4 luá»“ng cá»§a libuv xáº¿p hĂ ng sau nhau (Ä‘o 18/08: hdr_ms
      // p50 â‰ˆ 1 s cho Cáº¢ 16 slice trĂªn mĂ¡y dev), vĂ  má»—i video má»™t host má»›i.
      if (lookup && redirects === 0) opts.lookup = lookup;
      const req2 = https.get(u, opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          redirects++;
          res.resume();
          return attempt(res.headers.location, ip);
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          const err = new Error(`media fetch HTTP ${res.statusCode}`);
          err.httpStatus = res.statusCode;
          // Pass 90b: kĂ¨m ngá»¯ cáº£nh Ä‘á»ƒ phĂ¢n xá»­ 400 tá»« log (redirect sang host
          // khĂ¡c lĂ  nghi pháº¡m chĂ­nh cá»§a ca "URL resolve sá»›m lá»—i").
          err.hcRedirects = redirects;
          err.hcHost = hostOf(u);
          return reject(err);
        }
        // Telemetry (Pass 90): socket tĂ¡i dĂ¹ng hay báº¯t tay má»›i â€” Ä‘á»c á»Ÿ
        // fetch v2 Ä‘á»ƒ biáº¿t keep-alive cĂ³ Äƒn hay khĂ´ng.
        res.hcReusedSocket = !!req2.reusedSocket;
        resolve(res);
      });
      req2.on('error', (e) => {
        if (ip && /EADDRNOTAVAIL|EINVAL|bind|address not available/i.test(String((e && e.message) || e))) {
          noteBindFailure(ip, e);
          return attempt(u, null);
        }
        reject(e);
      });
      req2.setTimeout(sockTimeout, () => { req2.destroy(new Error('media fetch timeout')); });
    };
    attempt(url, bindAllowed(bindIp) ? bindIp : null);
  });
}

// `onChunk(n)` (Pass 90): Ä‘áº¿m byte vá» theo thá»i gian tháº­t cho tiáº¿n Ä‘á»™ +
// stall detector; `stopAt` (v2): dá»«ng sá»›m khi má»™t káº¿t ná»‘i khĂ¡c Ä‘Ă£ phá»§ pháº§n
// cĂ²n láº¡i (tail-hedge) â€” tráº£ vá» sá»‘ byte Ä‘Ă£ ghi.
async function streamToFd(res, fd, position, onChunk, stopAt) {
  let written = 0;
  for await (const chunk of res) {
    if (stopAt && stopAt.aborted) break;
    await fd.write(chunk, 0, chunk.length, position + written);
    written += chunk.length;
    if (onChunk) onChunk(chunk.length);
  }
  return written;
}

// â”€â”€â”€ Pass 90: tiáº¿n Ä‘á»™ + há»§y + Ä‘o theo slice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Rust chá»‰ nháº­n Má»˜T dĂ²ng tráº£ lá»i cuá»‘i cho `downloadVideo` (innertube_client.rs)
// nĂªn hedge pháº£i Ä‘oĂ¡n mĂ¹ theo Ä‘á»“ng há»“ vĂ  káº» thua khĂ´ng há»§y Ä‘Æ°á»£c â€” log khĂ¡ch
// 15/08 06:59: native thua Ä‘ua váº«n táº£i 8 s ná»¯a, video káº¿ tiáº¿p rÆ¡i yt-dlp vĂ¬
// "daemon busy". ÄÄƒng kĂ½ á»Ÿ Ä‘Ă¢y Ä‘á»ƒ (a) báº¯n `progress` Ä‘á»‹nh ká»³ trĂªn cĂ¹ng stdout,
// (b) nháº­n `abortDownload` vĂ  destroy socket ngay.
const activeDownloads = new Map(); // key: String(reqId) vĂ  videoId -> ctx

function newDownloadCtx(reqId, videoId) {
  const ctx = {
    reqId, videoId,
    aborted: false,
    sockets: new Set(),
    lastProgressAt: 0,
    bytes: 0,
    total: 0,
    abort() {
      if (this.aborted) return;
      this.aborted = true;
      for (const s of this.sockets) { try { s.destroy(new Error('aborted')); } catch (_) {} }
      this.sockets.clear();
    },
    track(res) { this.sockets.add(res); res.once('close', () => this.sockets.delete(res)); return res; },
    // Tiáº¿n Ä‘á»™ â‰¤ 1 dĂ²ng / 400 ms â€” Ä‘á»§ má»‹n cho hedge theo stall (1,5 s) mĂ  khĂ´ng
    // spam stdout.
    progress(force) {
      const now = Date.now();
      if (!force && now - this.lastProgressAt < 400) return;
      this.lastProgressAt = now;
      if (reqId === undefined || reqId === null) return;
      writeResponse({ id: reqId, cmd: 'downloadVideo', progress: { bytes: this.bytes, total: this.total, videoId } });
    },
  };
  activeDownloads.set(String(reqId), ctx);
  if (videoId) activeDownloads.set('v:' + videoId, ctx);
  return ctx;
}
function dropDownloadCtx(ctx) {
  if (!ctx) return;
  if (activeDownloads.get(String(ctx.reqId)) === ctx) activeDownloads.delete(String(ctx.reqId));
  if (ctx.videoId && activeDownloads.get('v:' + ctx.videoId) === ctx) activeDownloads.delete('v:' + ctx.videoId);
}
function abortDownloadBy(targetId, videoId) {
  let n = 0;
  const seen = new Set();
  const keys = [];
  if (targetId !== undefined && targetId !== null) keys.push(String(targetId));
  if (videoId) keys.push('v:' + videoId);
  for (const k of keys) {
    const ctx = activeDownloads.get(k);
    if (ctx && !seen.has(ctx)) { seen.add(ctx); ctx.abort(); n++; }
  }
  return n;
}
class AbortedError extends Error { constructor() { super('aborted'); this.aborted = true; } }

// Thá»‘ng kĂª nhanh cho dĂ²ng telemetry: p50/p95 cá»§a má»™t máº£ng sá»‘.
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
function hostOf(url) { try { return new URL(url).host; } catch (_) { return '?'; } }

// Pass 101: host Dá»° PHĂ’NG cá»§a googlevideo suy tá»« chĂ­nh URL â€” tham sá»‘ `mn` chá»©a
// HAI tĂªn mirror (ngÄƒn báº±ng pháº©y), `fvip` lĂ  sá»‘ Ä‘áº§u subdomain dáº¡ng
// r{fvip}---{mn}. ÄĂ¢y lĂ  cÆ¡ cháº¿ failover chuáº©n cá»§a web player/yt-dlp. KhĂ´ng
// suy Ä‘Æ°á»£c â†’ null (khĂ´ng Ä‘ua). DĂ¹ng cho cuá»™c Ä‘ua byte-Ä‘áº§u: má»—i chunk báº¯n song
// song lĂªn cáº£ hai host, header nĂ o vá» trÆ°á»›c tháº¯ng â€” TTFB hiá»‡u dá»¥ng =
// min(hai host), bĂªn thua bá»‹ huá»· ngay sau khi phĂ¢n tháº¯ng báº¡i (phĂ­ vĂ i KB).
function deriveFallbackUrl(u) {
  try {
    const p = new URL(u);
    if (!/\.googlevideo\.com$/.test(p.hostname)) return null;
    const mn = p.searchParams.get('mn');
    if (!mn || !mn.includes(',')) return null;
    const alt = mn.split(',')[1].trim();
    if (!alt) return null;
    const fvip = p.searchParams.get('fvip') || '1';
    const altHost = `r${fvip}---${alt}.googlevideo.com`;
    if (altHost === p.hostname) return null;
    p.hostname = altHost;
    return p.toString();
  } catch (_) { return null; }
}

// Parallel ranged fetch: googlevideo caps throughput PER CONNECTION on
// progressive itags (~3MB/s observed 2026-07-15 19-13-54: 12.3MB in 4.7s),
// so a single socket can never hit the <3s e2e budget â€” same reason yt-dlp
// runs 16 concurrent fragments. Slice 0 doubles as size discovery: its
// Content-Range total clamps the caller's bitrate-ESTIMATED cap, so tail
// slices can't overshoot the real file into 416s. All slices write through
// one shared fd at their own offsets.
// Pass 49: 6 â†’ 16. Log khĂ¡ch 25/07 11:51 cho tháº¥y CĂ™NG mĂ¡y, cĂ¹ng code, cĂ¹ng
// itag: láº§n táº£i trÆ°á»›c 13.7MB/1.5s (14.0 MB/s), láº§n sau 9.9MB/9.0s (1.2 MB/s)
// vá»›i 6 káº¿t ná»‘i â†’ ~200 KB/s Má»–I káº¿t ná»‘i. ÄĂ³ lĂ  dáº¥u hiá»‡u googlevideo throttle
// THEO Tá»ªNG Káº¾T Ná»I (khĂ´ng pháº£i ngháº½n uplink khĂ¡ch: hÆ°á»›ng táº£i xuá»‘ng, vĂ  láº§n
// nhanh chá»©ng minh Ä‘Æ°á»ng truyá»n khá»e). CĂ¡ch Ä‘á»‘i khĂ¡ng duy nháº¥t lĂ  chia nhiá»u
// káº¿t ná»‘i hÆ¡n â€” Ä‘Ăºng lĂ½ do yt-dlp cháº¡y 16 concurrent fragments (dá»± Ă¡n nĂ y vá»‘n
// Ä‘Ă£ dĂ¹ng 16-32 cho Ä‘Æ°á»ng yt-dlp). Rust cĂ³ thá»ƒ override qua `conns`.
const PARALLEL_CONNECTIONS_DEFAULT = 16;
const PARALLEL_CONNECTIONS_MAX = 24;
let PARALLEL_CONNECTIONS = PARALLEL_CONNECTIONS_DEFAULT;

// IP khĂ´ng bind Ä‘Æ°á»£c (settings `sourceAddress`/auto-detect trá» vĂ o NIC Ä‘Ă£ Ä‘á»•i
// DHCP hoáº·c khĂ´ng tá»“n táº¡i): log Má»˜T láº§n rá»“i thĂ´i bind cho cáº£ tiáº¿n trĂ¬nh. TrÆ°á»›c
// Ä‘Ă¢y Má»–I káº¿t ná»‘i Ä‘á»u thá»­-fail-retry â†’ 16 láº§n round-trip vĂ´ Ă­ch + 16 dĂ²ng log
// má»—i download (log khĂ¡ch 25/07 cĂ³ Ä‘Ăºng 6 dĂ²ng/láº§n táº£i vá»›i 6 káº¿t ná»‘i).
const bindFailed = new Set();
function noteBindFailure(ip, e) {
  if (!bindFailed.has(ip)) {
    bindFailed.add(ip);
    dlog(`[native-dl] bind ${ip} failed (${(e && e.message) || e}) â€” dĂ¹ng default route cho Má»ŒI káº¿t ná»‘i sau (kiá»ƒm tra settings bypassVpn/sourceAddress)`);
  }
}
function bindAllowed(ip) {
  return !!ip && !bindFailed.has(ip);
}
const MIN_SLICE_BYTES = 512 * 1024;

// DĂ²ng telemetry theo slice (Pass 90) â€” chung cho v1 vĂ  v2. `slices` lĂ  máº£ng
// {hdrMs, bytes, xferMs, reused}. Äá»c log: `tail` = ms slice cháº­m nháº¥t /
// median â€” ~1 lĂ  ngháº½n chung (má»i káº¿t ná»‘i cĂ¹ng cháº­m), >3 lĂ  má»™t slice kĂ©o
// cáº£ lÆ°á»£t (straggler); `hdr` p50 â‰ˆ RTTĂ—3 (TCP+TLS+TTFB) cho biáº¿t edge xa/gáº§n.
function logSliceTelemetry(tag, url, slices, extra) {
  if (!slices.length) return;
  const hdr = slices.map(s => s.hdrMs).filter(x => x >= 0);
  const kbps = slices.filter(s => s.xferMs > 0 && s.bytes > 0).map(s => s.bytes / 1024 / (s.xferMs / 1000));
  const xfer = slices.map(s => s.xferMs).filter(x => x > 0);
  const med = pct(xfer, 0.5) || 1;
  const slowest = xfer.length ? Math.max(...xfer) : 0;
  const reused = slices.filter(s => s.reused).length;
  dlog(`[native-dl] slices ${tag} n=${slices.length} host=${hostOf(url)} hdr_ms p50=${pct(hdr, 0.5)} p95=${pct(hdr, 0.95)} ` +
       `xfer KB/s p50=${pct(kbps, 0.5).toFixed(0)} min=${(kbps.length ? Math.min(...kbps) : 0).toFixed(0)} ` +
       `slowest_ms=${slowest} median_ms=${med} tail=${(slowest / med).toFixed(1)} reused=${reused}${extra ? ' ' + extra : ''}`);
}

// ctx (Pass 90): newDownloadCtx() â€” tiáº¿n Ä‘á»™/há»§y/telemetry. CĂ³ thá»ƒ null (test).
// agent (A1): PreconnAgent cĂ³ socket má»Ÿ sáºµn; null = agent máº·c Ä‘á»‹nh.
async function fetchUrlToFileParallel(url, range, outputPath, localAddress, ua, ctx, agent) {
  const fs = require('fs');
  const estEnd = range ? range.end : null;
  const sliceGuess = estEnd !== null
    ? Math.max(MIN_SLICE_BYTES, Math.ceil((estEnd + 1) / PARALLEL_CONNECTIONS))
    : MIN_SLICE_BYTES * 2;
  const tReq0 = Date.now();
  const first = await httpGetRange(url, 0, sliceGuess - 1, ua, localAddress, agent || undefined);
  const slices = [{ hdrMs: Date.now() - tReq0, bytes: 0, xferMs: 0, reused: !!first.hcReusedSocket, t1: Date.now() }];
  if (ctx) { ctx.track(first); if (ctx.aborted) { first.destroy(); throw new AbortedError(); } }
  const fd = await fs.promises.open(outputPath, 'w');
  const active = [first];
  const t0 = Date.now();
  const onChunk = (n) => { if (ctx) { ctx.bytes += n; ctx.progress(false); } };
  try {
    // Server ignored the Range header â€” it's streaming the whole file, so
    // just take it (equivalent to the old rangeless full fetch).
    if (first.statusCode === 200) {
      return await streamToFd(first, fd, 0, onChunk);
    }
    const totalMatch = /\/(\d+)\s*$/.exec(first.headers['content-range'] || '');
    const total = totalMatch ? Number(totalMatch[1]) : 0;
    if (!total && estEnd === null) {
      // No size from either side â€” can't plan slices. Rare enough to just
      // hand over to the dumb single-connection full download.
      first.destroy();
      return await fetchUrlToFile(url, null, outputPath, localAddress, ua);
    }
    const endWanted = total > 0
      ? Math.min(total - 1, estEnd !== null ? estEnd : total - 1)
      : estEnd;
    if (ctx) ctx.total = endWanted !== null ? endWanted + 1 : total;
    const firstWritten = streamToFd(first, fd, 0, onChunk).then((n) => {
      slices[0].bytes = n; slices[0].xferMs = Date.now() - slices[0].t1; return n;
    }); // overlaps with tail slices

    // Táº£i [s..e] chia Ä‘á»u cho tá»‘i Ä‘a n káº¿t ná»‘i, ghi qua fd chung táº¡i offset.
    const fetchSpan = (s, e, n) => {
      const out = [];
      if (e === null || s > e) return out;
      const remaining = e - s + 1;
      const nSlices = Math.min(n, Math.max(1, Math.floor(remaining / MIN_SLICE_BYTES)));
      const per = Math.ceil(remaining / nSlices);
      for (let i = 0; i < nSlices; i++) {
        const ss = s + i * per;
        const ee = Math.min(e, ss + per - 1);
        if (ss > ee) break;
        const tr = Date.now();
        out.push(httpGetRange(url, ss, ee, ua, localAddress, agent || undefined).then((res) => {
          const rec = { hdrMs: Date.now() - tr, bytes: 0, xferMs: 0, reused: !!res.hcReusedSocket, t1: Date.now() };
          slices.push(rec);
          active.push(res);
          if (ctx) { ctx.track(res); if (ctx.aborted) { res.destroy(); throw new AbortedError(); } }
          if (res.statusCode === 200) {
            res.destroy();
            throw new Error('range ignored on tail slice');
          }
          return streamToFd(res, fd, ss, onChunk).then((n) => { rec.bytes = n; rec.xferMs = Date.now() - rec.t1; return n; });
        }));
      }
      return out;
    };

    const tail = fetchSpan(sliceGuess, endWanted, PARALLEL_CONNECTIONS - 1);
    const counts = await Promise.all([firstWritten, ...tail]);
    if (ctx && ctx.aborted) throw new AbortedError();
    const written = counts.reduce((a, b) => a + b, 0);
    const secs = (Date.now() - t0) / 1000;
    const mbps = written / 1048576 / Math.max(secs, 0.001);
    const conns = counts.length;
    dlog(`[native-dl] parallel fetch ${conns} conns, ${written} bytes, ${mbps.toFixed(1)} MB/s`);
    logSliceTelemetry('v1', url, slices, `total_ms=${Date.now() - tReq0}`);
    // NgÆ°á»¡ng greppable: dÆ°á»›i 2 MB/s vá»›i nhiá»u káº¿t ná»‘i. Pass 90: KHĂ”NG káº¿t
    // luáº­n "throttle" ná»¯a â€” log khĂ¡ch 15/08 cho tháº¥y cĂ¹ng 1,2 MB/s vá»›i 6 láº«n
    // 16 káº¿t ná»‘i, tá»©c tráº§n Tá»”NG (ngháº½n cá»¥c bá»™/shaping IP), Ä‘á»c `tail=` á»Ÿ dĂ²ng
    // slices vĂ  dĂ²ng [NetGov] cá»§a Rust Ä‘á»ƒ phĂ¢n xá»­.
    if (mbps < 2 && secs > 2) {
      dlog(`[native-dl] CHáº¬M: ${mbps.toFixed(1)} MB/s trĂªn ${conns} káº¿t ná»‘i (~${(mbps * 1024 / conns).toFixed(0)} KB/s má»—i káº¿t ná»‘i) â€” xem dĂ²ng slices tail= vĂ  [NetGov] Ä‘á»ƒ phĂ¢n xá»­ ngháº½n chung/straggler`);
    }
    return written;
  } catch (e) {
    for (const r of active) { try { r.destroy(); } catch (_) {} }
    if (ctx && ctx.aborted) throw new AbortedError();
    throw e;
  } finally {
    await fd.close().catch(() => {});
  }
}

// â”€â”€â”€ Pass 90: FETCH v2 â€” hĂ ng chunk + worker keep-alive + tail-hedge + stall â”€â”€
//
// VĂ¬ sao (docs/DOWNLOAD_BANDWIDTH_ANALYSIS.md má»¥c 3): v1 (a) chá» slice 0 cĂ³
// header rá»“i má»›i báº¯n 15 slice cĂ²n láº¡i (+2â€“3 RTT), (b) Promise.all chá» slice
// cháº­m nháº¥t, khĂ´ng chia láº¡i, (c) má»™t slice káº¹t = cáº£ lÆ°á»£t há»ng, (d) má»—i slice
// má»™t TCP+TLS má»›i ~750 KB â†’ cáº£ Ä‘á»i káº¿t ná»‘i náº±m trong slow-start (12 MB/s á»Ÿ RTT
// ~90 ms lĂ  giá»›i háº¡n RTT, khĂ´ng pháº£i bÄƒng thĂ´ng).
//
// v2: chia file thĂ nh N chunk (1 chunk/worker), N worker báº¯n CĂ™NG LĂC â€” khĂ´ng
// Ä‘á»£i slice 0; DNS giáº£i Má»˜T láº§n cho cáº£ lÆ°á»£t. KĂ­ch thÆ°á»›c biáº¿t Ä‘Æ°á»£c tá»«
// Content-Range cá»§a chunk vá» Äáº¦U TIĂN. Háº¿t hĂ ng: worker ráº£nh "hedge" pháº§n
// cĂ²n láº¡i cá»§a chunk Ä‘ang cháº­m nháº¥t; ai cháº¡m Ä‘Ă­ch trÆ°á»›c tháº¯ng, káº» kia dá»«ng
// (STOP flag) â€” hai bĂªn ghi cĂ¹ng byte cĂ¹ng offset nĂªn chá»“ng lĂªn nhau vĂ´ háº¡i.
// KhĂ´ng byte trong STALL_MS â†’ destroy socket Ä‘Ă³, xáº¿p láº¡i pháº§n cĂ²n láº¡i (tá»‘i
// Ä‘a 3 láº§n/chunk). Socket timeout 8 s thay 30 s.
// KHĂ”NG cĂ³ lá»£i Ă­ch keep-alive: googlevideo tráº£ `Connection: close` cho má»i
// request Range HTTP/1.1 (Ä‘o 18/08, xem chĂº thĂ­ch chunkBytes) â€” agent giá»¯ láº¡i
// chá»‰ Ä‘á»ƒ tráº§n maxSockets = N.
// Báº­t báº±ng setting `nativeFetchV2` (Rust truyá»n `fetchV2`), máº·c Ä‘á»‹nh Táº®T Ä‘á»ƒ
// A/B trĂªn mĂ¡y khĂ¡ch.
const V2_CHUNK_BYTES = 768 * 1024;
const V2_STALL_MS = 2500;
const V2_MAX_RETRY_PER_CHUNK = 3;

async function fetchUrlToFileParallelV2(url, range, outputPath, localAddress, ua, ctx, opts) {
  const fs = require('fs');
  const https = require('https');
  const N = PARALLEL_CONNECTIONS;
  // maxSockets = N ÄĂNG Báº°NG sá»‘ worker: Node nháº£ socket vá» pool á»Ÿ nextTick
  // sau khi response káº¿t thĂºc, cĂ²n worker xin chunk káº¿ ngay trong microtask
  // â†’ náº¿u cho phĂ©p má»Ÿ thĂªm, agent sáº½ Má» SOCKET Má»I thay vĂ¬ Ä‘á»£i (Ä‘o 18/08:
  // reused=0/31). Vá»›i tráº§n = N, request káº¿ bá»‹ xáº¿p hĂ ng vĂ i Âµs rá»“i lĂªn Ä‘Ăºng
  // socket vá»«a ráº£nh.
  // A1: agent cĂ³ socket má»Ÿ sáºµn (PreconnAgent) náº¿u caller Ä‘Æ°a vĂ o.
  const agent = (opts && opts.agent) || new https.Agent({ keepAlive: true, maxSockets: N, maxFreeSockets: N, timeout: 20000, scheduling: 'lifo' });
  const tStart = Date.now();
  // Giáº£i DNS Má»˜T láº§n rá»“i phĂ¡t cho má»i socket (xem chĂº thĂ­ch á»Ÿ httpGetRange).
  let lookup = null;
  try {
    const host = hostOf(url);
    const dns = require('dns');
    const r = await dns.promises.lookup(host);
    if (r && r.address) {
      const addr = r.address, fam = r.family || 4;
      // Node â‰¥20 (autoSelectFamily) gá»i lookup vá»›i {all:true} vĂ  chá» Máº¢NG;
      // báº£n cÅ© chá» (addr, family). Tráº£ Ä‘Ăºng theo cá».
      lookup = (h, o, cb) => (o && o.all) ? cb(null, [{ address: addr, family: fam }]) : cb(null, addr, fam);
    }
  } catch (_) { lookup = null; }
  const dnsMs = Date.now() - tStart;
  const fd = await fs.promises.open(outputPath, 'w');
  const slices = [];
  let total = 0;                       // kĂ­ch thÆ°á»›c tháº­t (tá»« Content-Range)
  let endWanted = range ? range.end : null; // byte cuá»‘i cáº§n láº¥y (inclusive), null = háº¿t file
  // Cá»¡ chunk: Má»˜T chunk / worker (nhÆ° v1). Äo 18/08 trĂªn mĂ¡y dev: googlevideo
  // tráº£ `Connection: close` cho Má»ŒI request Range HTTP/1.1 â†’ keep-alive khĂ´ng
  // bao giá» tĂ¡i dĂ¹ng Ä‘Æ°á»£c socket (reused=0/31), nĂªn chia nhá» hÆ¡n N chá»‰ lĂ  thĂªm
  // má»™t Ä‘á»£t báº¯t tay TCP+TLS ná»¯a (31 chunk: 620 ms vs 16 chunk: ~400 ms).
  // SĂ n 512 KB. Rust override qua `chunkKb` (setting nativeFetchChunkKb) Ä‘á»ƒ A/B.
  const chunkBytes = (opts && opts.chunkKb > 0)
    ? Math.max(128 * 1024, opts.chunkKb * 1024)
    : (endWanted !== null
        ? Math.max(MIN_SLICE_BYTES, Math.ceil((endWanted + 1) / N))
        : V2_CHUNK_BYTES);
  // Pass 101: Ä‘ua byte-Ä‘áº§u 2 host (kill switch `nativeFetchHostRace` phĂ­a
  // Rust). Chá»‰ khi suy Ä‘Æ°á»£c host dá»± phĂ²ng vĂ  file â‰¤32MB (Shorts/360p â€” vĂ¹ng
  // mĂ  vĂ i KB lĂ£ng phĂ­ cá»§a bĂªn thua khĂ´ng Ä‘Ă¡ng ká»ƒ). Alt Ä‘i láº¡i Ä‘Ăºng Ä‘Æ°á»ng
  // hedge 'won/lost' sáºµn cĂ³; alt Lá»–I khĂ´ng Ä‘Æ°á»£c tĂ­nh vĂ o sá»• retry cá»§a chunk
  // (host phá»¥ 403 thĂ¬ Ä‘Æ°á»ng chĂ­nh cháº¡y y nhÆ° khĂ´ng cĂ³ cuá»™c Ä‘ua).
  const fallbackUrl = (opts && opts.hostRace) ? deriveFallbackUrl(url) : null;
  const raceOn = !!fallbackUrl && (endWanted === null || endWanted < 32 * 1024 * 1024);
  let altStarts = 0, altWins = 0;
  // HĂ ng chunk: {start,end,retries,done,inflight:Set<worker>,received}
  const chunks = [];
  const planUpTo = (e) => {
    // Láº­p lá»‹ch chunk cho [lastEnd+1 .. e]
    let s = chunks.length ? chunks[chunks.length - 1].end + 1 : 0;
    while (s <= e) {
      const ee = Math.min(e, s + chunkBytes - 1);
      chunks.push({ start: s, end: ee, retries: 0, done: false, inflight: new Set(), received: 0, hedged: false, altTaken: false });
      s = ee + 1;
    }
  };
  // ChÆ°a biáº¿t cá»¡ (range=null): chá»‰ báº¯n 4 chunk mĂ¹ â€” Content-Range cá»§a chunk
  // vá» Ä‘áº§u tiĂªn (â‰ˆ1 RTT) cho total rá»“i láº­p ná»‘t; báº¯n cáº£ N chunk mĂ¹ lĂ  12+
  // request 416 vĂ´ Ă­ch cho video ngáº¯n (Ä‘o 18/08: 15/17 chunk 416).
  if (endWanted !== null) planUpTo(endWanted);
  else planUpTo(chunkBytes * Math.min(N, 4) - 1);
  let planned = chunks.length ? chunks[chunks.length - 1].end : -1;
  let nextIdx = 0;
  let written = 0;                    // byte duy nháº¥t Ä‘Ă£ ghi (theo chunk xong)
  let stalls = 0, hedges = 0, retriesTotal = 0;
  let connHdr = ''; // header Connection + phiĂªn báº£n HTTP cá»§a response Ä‘áº§u â€” biáº¿t server cĂ³ cho keep-alive khĂ´ng
  let fatal = null;
  const active = new Set();
  const workers = [];
  const onBytes = (n) => { if (ctx) { ctx.bytes += n; ctx.progress(false); } };

  const clampToTotal = () => {
    if (!total) return;
    const lastByte = endWanted !== null ? Math.min(endWanted, total - 1) : total - 1;
    endWanted = lastByte;
    if (ctx) ctx.total = lastByte + 1;
    // Cáº¯t cĂ¡c chunk vÆ°á»£t EOF; chunk Ä‘ang bay vÆ°á»£t EOF sáº½ nháº­n 416 â†’ coi lĂ  xong.
    for (const c of chunks) {
      if (c.start > lastByte) { c.done = true; c.received = 0; }
      else if (c.end > lastByte) c.end = lastByte;
    }
    if (planned < lastByte) { planUpTo(lastByte); planned = lastByte; }
  };

  const takeChunk = () => {
    while (nextIdx < chunks.length) {
      const c = chunks[nextIdx++];
      if (!c.done) return { c, alt: false };
    }
    // Pass 101: háº¿t chunk má»›i â†’ phĂ¡t báº£n ALT (host dá»± phĂ²ng) cho chunk cĂ²n
    // Ä‘ang chá» byte Ä‘áº§u trĂªn host chĂ­nh â€” má»—i chunk Ä‘Ăºng má»™t láº§n, chá»‰ khi
    // host chĂ­nh CHÆ¯A nháº£ byte nĂ o (Ä‘Ă£ cĂ³ byte = TTFB xong, Ä‘ua vĂ´ nghÄ©a) VĂ€
    // Ä‘Ă£ chá» â‰¥100ms (host áº¥m tráº£ header ~100ms â€” khá»i tá»‘n request Ä‘ua; host
    // láº¡nh 500-700ms thĂ¬ 100ms chá» khĂ´ng sá»©t máº» pháº§n tháº¯ng).
    if (raceOn) {
      const now = Date.now();
      for (const c of chunks) {
        if (!c.done && !c.altTaken && c.inflight.size === 1 && c.received === 0
            && now - [...c.inflight][0].t0 >= 100) {
          c.altTaken = true;
          return { c, alt: true };
        }
      }
    }
    return null;
  };
  // Tail-hedge: chunk chÆ°a xong, Ä‘ang bay ÄĂNG Má»˜T káº¿t ná»‘i, cĂ²n â‰¥64 KB, vĂ  Ä‘Ă£
  // cháº¡y lĂ¢u hÆ¡n 1,5Ă— median chunk hoáº·c tá»‘c Ä‘á»™ < Â¼ median.
  const chunkStats = [];
  const pickHedge = () => {
    if (!chunkStats.length) return null;
    const medMs = pct(chunkStats, 0.5);
    let best = null, bestScore = 0;
    const now = Date.now();
    for (const c of chunks) {
      if (c.done || c.inflight.size !== 1 || c.hedged) continue;
      const remaining = c.end - c.start + 1 - c.received;
      if (remaining < 64 * 1024) continue;
      const w = [...c.inflight][0];
      const age = now - w.t0;
      const score = age / Math.max(medMs, 50);
      if (score >= 1.5 && score > bestScore) { best = c; bestScore = score; }
    }
    return best;
  };

  const fetchChunkOn = (worker, c, isHedge, isAlt) => new Promise((resolve) => {
    // Vá»‹ trĂ­ báº¯t Ä‘áº§u: hedge/alt láº¥y tá»« chá»— káº¿t ná»‘i chĂ­nh ÄĂƒ nháº­n (snapshot),
    // ghi cĂ¹ng offset nĂªn khĂ´ng cáº§n Ä‘á»“ng bá»™ (hai nguá»“n cĂ¹ng ná»™i dung â€” ghi
    // trĂ¹ng vá»‹ trĂ­ lĂ  vĂ´ háº¡i).
    const from = (isHedge || isAlt) ? c.start + c.received : c.start;
    // Pass 101: alt Ä‘i host dá»± phĂ²ng vĂ  KHĂ”NG dĂ¹ng DNS cache cá»§a host chĂ­nh
    // (lookup tráº£ IP cá»§a host chĂ­nh cho Má»ŒI hostname â€” Ä‘Æ°a cho alt lĂ  trá»
    // nháº§m mirror vá» IP cÅ©, cuá»™c Ä‘ua thĂ nh giáº£).
    const reqUrl = isAlt ? fallbackUrl : url;
    const reqLookup = isAlt ? null : lookup;
    const tr = Date.now();
    worker.t0 = tr;
    c.inflight.add(worker);
    const stop = { aborted: false };
    worker.stop = stop;
    // Socket timeout 8 s (thay 30 s): chunk 768 KB khĂ´ng cĂ³ lĂ½ do im 8 s;
    // pha truyá»n Ä‘Ă£ cĂ³ stall detector 2,5 s, Ä‘Ă¢y lĂ  lÆ°á»›i cho pha connect/TTFB.
    httpGetRange(reqUrl, from, c.end, ua, localAddress, agent, 8000, reqLookup).then(async (res) => {
      const rec = { hdrMs: Date.now() - tr, bytes: 0, xferMs: 0, reused: !!res.hcReusedSocket, t1: Date.now() };
      slices.push(rec);
      if (!connHdr) connHdr = String(res.headers['connection'] || res.headers['Connection'] || '-') + '/' + res.httpVersion;
      active.add(res);
      res.once('close', () => active.delete(res));
      if (ctx) { ctx.track(res); if (ctx.aborted) { res.destroy(); return resolve('aborted'); } }
      if (res.statusCode === 200) {
        // Server bá» qua Range â†’ khĂ´ng chia chunk Ä‘Æ°á»£c; nháº£ vá» caller Ä‘á»ƒ Ä‘i
        // Ä‘Æ°á»ng 1 káº¿t ná»‘i (downloadVideoNative Ä‘Ă£ cĂ³ retry single-conn full).
        res.destroy();
        return resolve('range-ignored');
      }
      if (!total) {
        const m = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
        if (m) { total = Number(m[1]); clampToTotal(); }
      }
      // Stall detector: khĂ´ng byte trong V2_STALL_MS â†’ há»§y socket nĂ y.
      let lastData = Date.now();
      let localRecv = 0;
      const timer = setInterval(() => {
        if (Date.now() - lastData > V2_STALL_MS && !stop.aborted) {
          stop.aborted = true;
          try { res.destroy(new Error('stall')); } catch (_) {}
        }
      }, 250);
      try {
        for await (const chunk of res) {
          if (stop.aborted || (ctx && ctx.aborted)) break;
          lastData = Date.now();
          await fd.write(chunk, 0, chunk.length, from + localRecv);
          localRecv += chunk.length;
          if (!isHedge) c.received = Math.max(c.received, localRecv);
          else c.received = Math.max(c.received, (from - c.start) + localRecv);
          onBytes(chunk.length);
        }
      } catch (e) {
        clearInterval(timer);
        rec.bytes = localRecv; rec.xferMs = Date.now() - rec.t1;
        if (ctx && ctx.aborted) return resolve('aborted');
        if (stop.aborted && stop.reason === 'won') return resolve('lost');
        return resolve(stop.aborted ? 'stall' : 'error:' + ((e && e.message) || e));
      }
      clearInterval(timer);
      rec.bytes = localRecv; rec.xferMs = Date.now() - rec.t1;
      if (ctx && ctx.aborted) return resolve('aborted');
      if (stop.aborted) return resolve(stop.reason === 'won' ? 'lost' : 'stall');
      const covered = from + localRecv - 1;
      if (covered >= c.end) return resolve('done');
      // Ngáº¯n hÆ¡n yĂªu cáº§u mĂ  khĂ´ng lá»—i: server cáº¯t sá»›m (EOF tháº­t) â€” náº¿u total
      // Ä‘Ă£ biáº¿t vĂ  covered >= total-1 thĂ¬ lĂ  xong.
      if (total && covered >= total - 1) return resolve('done');
      return resolve('short');
    }).catch((e) => {
      if (ctx && ctx.aborted) return resolve('aborted');
      if (e && e.httpStatus === 416) {
        // Æ¯á»›c lÆ°á»£ng vÆ°á»£t EOF (chÆ°a biáº¿t total) hoáº·c chunk hoĂ n toĂ n ngoĂ i file.
        // Hedge/alt xuáº¥t phĂ¡t tá»« chá»— káº¿t ná»‘i chĂ­nh Ä‘Ă£ nháº­n: 416 á»Ÿ Ä‘Ă¢y nghÄ©a lĂ 
        // káº¿t ná»‘i chĂ­nh Ä‘Ă£ cháº¡m EOF â†’ coi nhÆ° thua, khĂ´ng Ä‘á»¥ng `total`.
        return resolve((isHedge || isAlt) ? 'lost' : 'eof');
      }
      resolve('error:' + ((e && e.message) || e));
    });
  });

  const workerLoop = async (w) => {
    let idleSpins = 0;
    for (;;) {
      if (fatal || (ctx && ctx.aborted)) return;
      const entry = takeChunk();
      let c = entry ? entry.c : null;
      let isAlt = entry ? entry.alt : false;
      let isHedge = false;
      if (!c) {
        c = pickHedge();
        if (!c) {
          // Háº¿t hĂ ng nhÆ°ng cĂ²n chunk Ä‘ang bay á»Ÿ worker khĂ¡c: Ä‘á»©ng chá» 50 ms
          // rá»“i xĂ©t láº¡i (chunk Ä‘Ă³ cĂ³ thá»ƒ thĂ nh á»©ng viĂªn hedge, hoáº·c lá»—i vĂ 
          // Ä‘Æ°á»£c xáº¿p láº¡i). Tráº§n 30 s Ä‘á»ƒ khĂ´ng treo vĂ´ háº¡n.
          if (chunks.every(x => x.done)) return;
          if (++idleSpins > 1500) return; // ~30 s
          await new Promise(r => setTimeout(r, 20));
          continue;
        }
        isHedge = true; c.hedged = true; hedges++;
      }
      idleSpins = 0;
      if (isAlt) altStarts++;
      const r = await fetchChunkOn(w, c, isHedge, isAlt);
      c.inflight.delete(w);
      if (r === 'done') {
        if (!c.done) {
          c.done = true; written += c.end - c.start + 1;
          if (isAlt) altWins++;
          // Káº» cĂ²n láº¡i trĂªn chunk nĂ y dá»«ng ngay.
          for (const other of c.inflight) { if (other.stop) { other.stop.reason = 'won'; other.stop.aborted = true; } }
          chunkStats.push(Date.now() - w.t0);
        }
        continue;
      }
      if (isAlt) {
        // Pass 101: alt thua/lá»—i/stall â€” KHĂ”NG Ä‘á»¥ng sá»• retry cá»§a chunk.
        if (r === 'aborted') return;
        // NHÆ¯NG náº¿u host chĂ­nh Ä‘Ă£ rá»›t TRONG LĂC alt bay (nhĂ¡nh retry cá»§a nĂ³
        // tháº¥y inflightâ‰ 0 nĂªn bá» qua requeue) vĂ  giá» alt cÅ©ng rá»›t â†’ chunk
        // má»“ cĂ´i, khĂ´ng ai xáº¿p láº¡i â†’ treo tá»›i tráº§n idle rá»“i 'chunks left
        // undone' (báº¯t Ä‘Æ°á»£c á»Ÿ A/B tháº­t 24/08, video jNQXAC9IVRw káº¹t 43s).
        // Xáº¿p láº¡i pháº§n cĂ²n thiáº¿u táº¡i Ä‘Ă¢y, váº«n khĂ´ng tĂ­nh vĂ o sá»• retry.
        if (!c.done && c.inflight.size === 0) {
          const from = c.start + c.received;
          if (from <= c.end) {
            const nc = { start: from, end: c.end, retries: c.retries, done: false, inflight: new Set(), received: 0, hedged: false, altTaken: true };
            c.done = true; written += c.received;
            chunks.splice(nextIdx, 0, nc);
          } else { c.done = true; written += c.received; }
        }
        continue;
      }
      if (r === 'lost' || r === 'aborted') { if (r === 'aborted') return; continue; }
      if (r === 'eof') {
        // 416: chunk náº±m ngoĂ i file â†’ xong vá»›i 0 byte; EOF tháº­t â‰¤ c.start.
        total = total ? Math.min(total, c.start) : c.start;
        clampToTotal();
        c.done = true;
        continue;
      }
      if (r === 'range-ignored') { fatal = new Error('range ignored on chunk'); return; }
      // stall / short / error â†’ xáº¿p láº¡i pháº§n cĂ²n láº¡i
      c.retries++;
      retriesTotal++;
      if (r === 'stall') stalls++;
      if (c.retries > V2_MAX_RETRY_PER_CHUNK) { fatal = new Error(`chunk ${c.start}-${c.end} failed ${c.retries}x (${r})`); return; }
      if (c.inflight.size === 0) {
        // Äáº©y láº¡i chĂ­nh chunk nĂ y lĂªn Ä‘áº§u hĂ ng: táº¡o chunk má»›i cho pháº§n cĂ²n láº¡i.
        const from = c.start + c.received;
        if (from <= c.end) {
          const nc = { start: from, end: c.end, retries: c.retries, done: false, inflight: new Set(), received: 0, hedged: false, altTaken: false };
          // Chunk cÅ© coi nhÆ° xong pháº§n Ä‘Ă£ nháº­n.
          if (!c.done) { c.done = true; written += c.received; }
          chunks.splice(nextIdx, 0, nc);
        } else if (!c.done) { c.done = true; written += c.received; }
      }
    }
  };

  try {
    if (ctx && ctx.aborted) throw new AbortedError();
    for (let i = 0; i < N; i++) { const w = { id: i, t0: 0, stop: null, finished: false }; workers.push(w); }
    // ChÆ°a biáº¿t total (range=null vĂ  server chÆ°a tráº£ Content-Range) mĂ  hĂ ng
    // sáº¯p cáº¡n, chÆ°a gáº·p 416 â†’ láº­p thĂªm N chunk. Dá»«ng khi worker vá» háº¿t.
    let workersDone = false;
    const supervisor = (async () => {
      while (!workersDone && !fatal && !(ctx && ctx.aborted)) {
        await new Promise(r => setTimeout(r, 100));
        // Sau 400 ms mĂ  server váº«n chÆ°a nĂ³i total (edge cháº­m) thĂ¬ báº¯n thĂªm
        // Ä‘á»ƒ khĂ´ng Ä‘á»©ng chá»; edge thÆ°á»ng tráº£ Content-Range trong 1 RTT.
        if (!total && endWanted === null && nextIdx >= chunks.length - 1 && Date.now() - tStart > 400) {
          planUpTo(planned + chunkBytes * N); planned = chunks[chunks.length - 1].end;
        }
      }
    })();
    await Promise.all(workers.map(async (w) => { await workerLoop(w); w.finished = true; }));
    workersDone = true; // supervisor tá»± thoĂ¡t á»Ÿ nhá»‹p káº¿ â€” KHĂ”NG await (100 ms vĂ´ Ă­ch á»Ÿ Ä‘uĂ´i)
    void supervisor;
    if (ctx && ctx.aborted) throw new AbortedError();
    if (fatal) throw fatal;
    if (chunks.some(c => !c.done)) throw new Error('v2: chunks left undone');
    const secs = (Date.now() - tStart) / 1000;
    const mbps = written / 1048576 / Math.max(secs, 0.001);
    dlog(`[native-dl] parallel fetch ${N} conns, ${written} bytes, ${mbps.toFixed(1)} MB/s (v2)`);
    logSliceTelemetry('v2', url, slices, `total_ms=${Date.now() - tStart} dns_ms=${dnsMs} chunks=${chunks.length} hedges=${hedges} stalls=${stalls} retries=${retriesTotal} conn=${connHdr}${raceOn ? ` hrace=${altStarts}/${altWins}` : ''}`);
    if (mbps < 2 && secs > 2) {
      dlog(`[native-dl] CHáº¬M: ${mbps.toFixed(1)} MB/s trĂªn ${N} káº¿t ná»‘i (v2) â€” xem dĂ²ng slices tail= vĂ  [NetGov] Ä‘á»ƒ phĂ¢n xá»­ ngháº½n chung/straggler`);
    }
    return written;
  } catch (e) {
    for (const r of active) { try { r.destroy(); } catch (_) {} }
    if (ctx && ctx.aborted) throw new AbortedError();
    throw e;
  } finally {
    try { agent.destroy(); } catch (_) {}
    await fd.close().catch(() => {});
  }
}

// Stream one progressive format to a file, optionally byte-ranged. Recreating
// the write stream on each call truncates leftovers from a failed attempt.
// Kept as fallback for when URL deciphering fails.
async function fetchToFile(info, itag, range, outputPath) {
  const stream = await info.download(range ? { itag, range } : { itag });
  const fs = require('fs');
  const out = fs.createWriteStream(outputPath);
  let written = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      written += value.length;
      if (!out.write(Buffer.from(value))) {
        await new Promise(res => out.once('drain', res));
      }
    }
  } catch (e) {
    out.destroy();
    throw e;
  }
  await new Promise((res, rej) => out.end((err) => err ? rej(err) : res()));
  return written;
}

// â”€â”€â”€ Pass 90 (A1): RESOLVE Sá»M + Má» Sáº´N Káº¾T Ná»I â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// PhĂ­ trÆ°á»›c byte Ä‘áº§u (~0,4 s = /player + decipher + báº¯t tay slice 0) chiáº¿m â…“
// cáº£ lÆ°á»£t táº£i nhanh (docs/DOWNLOAD_BANDWIDTH_ANALYSIS.md má»¥c 1.2). Rust gá»i
// `resolveMedia` NGAY lĂºc phĂ¡t hiá»‡n (trÆ°á»›c khi láº¥y permit táº£i): daemon cháº¡y
// Ä‘Ăºng chain ANDROIDâ†’IOSâ†’WEB tá»›i bÆ°á»›c decipher, cache URL+range 5 phĂºt, vĂ  má»Ÿ
// sáºµn N káº¿t ná»‘i TLS tá»›i host media. LĂºc `downloadVideo` tá»›i, chá»‰ cĂ²n báº¯n
// Range trĂªn socket Ä‘Ă£ báº¯t tay. googlevideo Ä‘Ă³ng káº¿t ná»‘i sau má»—i request
// (`Connection: close`) nhÆ°ng KHĂ”NG cáº¥m má»Ÿ trÆ°á»›c â€” pool sá»‘ng 25 s, Ä‘á»§ cho
// khoáº£ng detectâ†’permit cá»§a video nĂ³ng.
const RESOLVE_TTL_MS = 5 * 60 * 1000;
const PRECONN_TTL_MS = 25 * 1000;
const resolvedMedia = new Map(); // videoId -> {at, maxHeight, limitSec, directUrl, range, ua, format:{itag,width,height}, durationSec, title, clientName, host}
const preconnPools = new Map();  // videoId -> {host, at, sockets:[]}
const resolveInflight = new Map(); // videoId -> Promise â€” downloadVideo tá»›i sá»›m hÆ¡n resolve xong thĂ¬ Ä‘á»£i nĂ³ thay vĂ¬ gá»i /player láº§n hai

function dropPreconn(videoId) {
  const p = preconnPools.get(videoId);
  if (!p) return;
  preconnPools.delete(videoId);
  for (const s of p.sockets) { try { s.destroy(); } catch (_) {} }
}
function preconnect(videoId, host, n, localAddress) {
  const tls = require('tls');
  dropPreconn(videoId);
  const pool = { host, at: Date.now(), sockets: [] };
  for (let i = 0; i < n; i++) {
    const opts = { host, port: 443, servername: host, ALPNProtocols: ['http/1.1'] };
    if (bindAllowed(localAddress)) opts.localAddress = localAddress;
    let s;
    try { s = tls.connect(opts); } catch (_) { continue; }
    try { s.setNoDelay(true); } catch (_) {}
    const remove = () => { const i2 = pool.sockets.indexOf(s); if (i2 >= 0) pool.sockets.splice(i2, 1); };
    s.once('error', (e) => {
      if (opts.localAddress && /EADDRNOTAVAIL|EINVAL|bind|address not available/i.test(String((e && e.message) || e))) noteBindFailure(opts.localAddress, e);
      remove();
    });
    s.once('close', remove);
    pool.sockets.push(s);
  }
  preconnPools.set(videoId, pool);
  // Dá»n pool quĂ¡ háº¡n dĂ¹ khĂ´ng ai láº¥y (video bá»‹ lá»c/khĂ´ng táº£i).
  setTimeout(() => { const p = preconnPools.get(videoId); if (p === pool) dropPreconn(videoId); }, PRECONN_TTL_MS + 5000).unref();
  return pool;
}
// Agent láº¥y socket Ä‘Ă£ má»Ÿ sáºµn trÆ°á»›c, háº¿t thĂ¬ má»Ÿ má»›i nhÆ° thÆ°á»ng. Chá»‰ nháº£ socket
// Ä‘Ăºng host (URL cache cĂ³ thá»ƒ khĂ¡c host vá»›i URL má»›i náº¿u chain resolve láº¡i).
function makePreconnAgent(videoId, host, n) {
  const https = require('https');
  const pool = preconnPools.get(videoId);
  const usable = pool && pool.host === host && Date.now() - pool.at < PRECONN_TTL_MS ? pool : null;
  if (usable) preconnPools.delete(videoId); // agent sá»Ÿ há»¯u tá»« Ä‘Ă¢y
  class PreconnAgent extends https.Agent {
    constructor(o) { super(o); this.hcHits = 0; this.hcMiss = 0; }
    createConnection(options, cb) {
      // Pass 90b (sá»­a lá»—i log khĂ¡ch 20-21/08): CHá»ˆ phĂ¡t socket má»Ÿ sáºµn cho
      // request tá»›i ÄĂNG host cá»§a pool. googlevideo thá»‰nh thoáº£ng 302 sang
      // host mirror khĂ¡c â€” báº£n Ä‘áº§u phĂ¡t socket host CÅ¨ cho request host Má»I
      // (Host header lá»‡ch server tháº­t) â†’ googlevideo tráº£ HTTP 400, cáº£ lÆ°á»£t
      // rÆ¡i láº¡i chain Ä‘áº§y Ä‘á»§, máº¥t sáº¡ch lá»£i Ă­ch resolve sá»›m ("URL resolve sá»›m
      // lá»—i (media fetch HTTP 400)" xen káº½ vá»›i cĂ¡c lÆ°á»£t preconn_hit=16/16).
      const want = options.servername || options.hostname || options.host || '';
      if (usable && want === usable.host) {
        while (usable.sockets.length) {
          const s = usable.sockets.shift();
          if (s && !s.destroyed) { this.hcHits++; return s; }
        }
      }
      this.hcMiss++;
      return super.createConnection(options, cb);
    }
  }
  const agent = new PreconnAgent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: Math.max(n, 24) });
  agent.hcPreconn = usable ? usable.sockets.length : 0;
  agent.hcDestroyPool = () => { if (usable) for (const s of usable.sockets) { try { s.destroy(); } catch (_) {} } };
  return agent;
}
function takeResolved(videoId, maxHeight) {
  const r = resolvedMedia.get(videoId);
  if (!r) return null;
  resolvedMedia.delete(videoId);
  if (Date.now() - r.at > RESOLVE_TTL_MS) return null;
  if (r.maxHeight !== maxHeight) return null;
  return r;
}

// Chain /player â†’ format â†’ range â†’ decipher (Ä‘Ăºng luáº­t cá»§a downloadVideoNative,
// KHĂ”NG fetch). Tráº£ báº£n ghi cache hoáº·c throw. DĂ¹ng cho resolveMedia.

function readSmartSplitSettingsSnapshot() {
  try {
    const fs = require('fs');
    const path = require('path');
    const possiblePaths = [
      process.env.HYPERCLIP_DATA_DIR ? path.join(process.env.HYPERCLIP_DATA_DIR, '.hyperclip', 'settings.json') : null,
      process.env.HYPERCLIPB_DATA_DIR ? path.join(process.env.HYPERCLIPB_DATA_DIR, '.hyperclip', 'settings.json') : null,
      path.resolve(__dirname, '..', '..', '..', 'HyperClip-Data', '.hyperclip', 'settings.json'),
      path.resolve(__dirname, '..', '..', 'HyperClip-Data', '.hyperclip', 'settings.json'),
      'D:\\HyperClip\\HyperClip-TestCustomer-20260616-224538\\HyperClip-Data\\.hyperclip\\settings.json',
    ].filter(Boolean);

    for (const settingsPath of possiblePaths) {
      if (!fs.existsSync(settingsPath)) continue;
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const raw = parsed.settings || parsed;
      return {
        autoSplitEnabled: raw.autoSplitEnabled !== false && raw.autoSplitMode !== 'none',
        autoSplitMode: String(raw.autoSplitMode || ''),
        autoSplitSubMode: String(raw.autoSplitSubMode || ''),
        autoSplitParts: Number(raw.autoSplitParts) || 3,
        autoSplitCustomP1: Number(raw.autoSplitCustomP1) || Number(raw.autoSplitPart1Minutes) || Number(raw.autoSplitMinutes) || 3,
        defaultTrimLimit: Number(raw.defaultTrimLimit) || 10,
      };
    }
  } catch (_) {}
  return null;
}

function getSmartSplitPlan(actualDurationSec, settingsSnapshot) {
  const settings = settingsSnapshot || readSmartSplitSettingsSnapshot();
  if (!settings) return null;

  const trimLimitMin = Number(settings.defaultTrimLimit) || 10;
  const sourceSec = Math.max(0, Math.floor(Number(actualDurationSec) || 0));
  const isFullVideo = trimLimitMin >= 900;
  const configuredTotalSec = isFullVideo ? sourceSec : Math.max(60, Math.round(trimLimitMin * 60));
  const totalTrimSec = sourceSec > 0
    ? (configuredTotalSec > 0 ? Math.min(sourceSec, configuredTotalSec) : sourceSec)
    : configuredTotalSec;
  const mode = settings.autoSplitMode || '';
  const subMode = settings.autoSplitSubMode || '';
  const customP1 = Number(settings.autoSplitCustomP1) || 3;
  const isCustomP1 = mode === 'minutes' || subMode === 'custom_p1' || !mode;
  const normalizedSettings = {
    autoSplitEnabled: settings.autoSplitEnabled !== false && settings.autoSplitMode !== 'none',
    autoSplitMode: mode || (isCustomP1 ? 'minutes' : 'parts'),
    autoSplitSubMode: subMode || (isCustomP1 ? 'custom_p1' : ''),
    autoSplitParts: Number(settings.autoSplitParts) || 3,
    autoSplitCustomP1: customP1,
    defaultTrimLimit: trimLimitMin,
  };
  const base = {
    enabled: normalizedSettings.autoSplitEnabled,
    trimLimitMin,
    sourceDurationSec: sourceSec || null,
    totalTrimSec,
    settingsSnapshot: normalizedSettings,
    settingsVersion: [trimLimitMin, normalizedSettings.autoSplitMode, normalizedSettings.autoSplitParts, customP1, normalizedSettings.autoSplitEnabled ? 1 : 0].join(':'),
    isAdaptiveShort: sourceSec > 0 && configuredTotalSec > 0 && sourceSec < configuredTotalSec,
  };

  if (!base.enabled) return { ...base, parts: 1, p1Sec: totalTrimSec, p2Sec: 0, p3Sec: 0 };

  let p1Sec = 0;
  let p2Sec = 0;
  let p3Sec = 0;
  let parts = 1;
  if (totalTrimSec > 0 && isCustomP1) {
    const targetP1Sec = Math.max(1, Math.round(customP1 * 60));
    p1Sec = Math.min(targetP1Sec, totalTrimSec);
    const remainingSec = Math.max(0, totalTrimSec - p1Sec);
    if (remainingSec < 30) {
      p1Sec = totalTrimSec;
    } else if (remainingSec < 60) {
      p2Sec = remainingSec;
      parts = 2;
    } else {
      p2Sec = Math.ceil(remainingSec / 2);
      p3Sec = remainingSec - p2Sec;
      parts = 3;
    }
  } else if (totalTrimSec > 0 && (settings.autoSplitParts === 2 || subMode === 'parts_2')) {
    p1Sec = Math.ceil(totalTrimSec / 2);
    p2Sec = totalTrimSec - p1Sec;
    parts = 2;
  } else if (totalTrimSec > 0) {
    p1Sec = Math.ceil(totalTrimSec / 3);
    p2Sec = Math.ceil((totalTrimSec - p1Sec) / 2);
    p3Sec = totalTrimSec - p1Sec - p2Sec;
    parts = 3;
  }

  return { ...base, p1Sec, p2Sec, p3Sec, parts };
}

function saveSplitPlanMetadata(masterPath, videoId, splitPlan, sourceDurationSec) {
  if (!masterPath || !splitPlan) return;
  try {
    const sourceDuration = Number(sourceDurationSec) || Number(splitPlan.sourceDurationSec) || 0;
    const actualDuration = Number(splitPlan.totalTrimSec) || sourceDuration;
    require('fs').writeFileSync(masterPath + '.meta.json', JSON.stringify({
      videoId,
      sourceDurationSec: sourceDuration,
      actualDurationSec: actualDuration,
      splitPlan: { ...splitPlan, sourceDurationSec: sourceDuration || null }
    }, null, 2), 'utf8');
  } catch (e) {
    dlog(`[smart-split] Could not save job plan for ${videoId}: ${(e && e.message) || e}`);
  }
}

function reconcileWorkspacesWithSmartSplit() {
  try {
    const fs = require('fs');
    const path = require('path');
    const possibleDirs = [
      process.env.HYPERCLIP_DATA_DIR,
      process.env.HYPERCLIPB_DATA_DIR,
      path.resolve(__dirname, '..', '..', '..', 'HyperClip-Data'),
      path.resolve(__dirname, '..', '..', 'HyperClip-Data'),
      path.resolve(__dirname, '..', 'data'),
      'D:\\HyperClip\\HyperClip-TestCustomer-20260616-224538\\HyperClip-Data',
      'D:\\HyperClip\\HyperClip-Data'
    ].filter(Boolean);

    const settingsSnapshot = readSmartSplitSettingsSnapshot();
    if (!settingsSnapshot || !settingsSnapshot.autoSplitEnabled) return;

    for (const dir of possibleDirs) {
      if (!fs.existsSync(dir)) continue;
      const wsCandidates = [
        path.join(dir, '.hyperclip', 'workspaces.json'),
        path.join(dir, 'workspaces.json')
      ];
      for (const wsFile of wsCandidates) {
        if (!fs.existsSync(wsFile)) continue;
        try {
          const raw = fs.readFileSync(wsFile, 'utf8');
          const wsJson = JSON.parse(raw);
          if (!wsJson || !Array.isArray(wsJson.workspaces)) continue;

          let changed = false;
          const groups = new Map();
          for (const ws of wsJson.workspaces) {
            const grp = ws.partGroup || (ws.id ? ws.id.replace(/-part\d+$/, '') : null);
            if (!grp || !ws.partIndex || !ws.partTotal || ws.partTotal < 2) continue;
            if (!groups.has(grp)) groups.set(grp, []);
            groups.get(grp).push(ws);
          }

          for (const [grpId, parts] of groups.entries()) {
            if (parts.length < 2) continue;
            let totalDur = 0;
            let videoId = null;
            for (const p of parts) {
              if (p.originalDurationSec && p.originalDurationSec > totalDur) totalDur = p.originalDurationSec;
              if (p.video_id) videoId = p.video_id;
            }
            if (totalDur <= 0) {
              const trimLimitMin = Number(settingsSnapshot.defaultTrimLimit) || 10;
              totalDur = trimLimitMin < 900 ? trimLimitMin * 60 : 600;
            }

            const plan = getSmartSplitPlan(totalDur, settingsSnapshot);
            if (!plan || !plan.enabled) continue;

            const p1Target = plan.p1Sec;
            const p2Target = plan.p2Sec;
            const p3Target = plan.p3Sec;

            for (const ws of parts) {
              let tStart = 0;
              let tEnd = 0;
              let tDur = 0;
              if (ws.partIndex === 1) {
                tStart = 0;
                tEnd = p1Target;
                tDur = p1Target;
              } else if (ws.partIndex === 2) {
                tStart = p1Target;
                tEnd = p1Target + p2Target;
                tDur = p2Target;
              } else if (ws.partIndex === 3) {
                tStart = p1Target + p2Target;
                tEnd = plan.totalTrimSec || (p1Target + p2Target + p3Target);
                tDur = p3Target;
              }

              if (tDur > 0) {
                if (Math.abs((ws.durationSec || 0) - tDur) > 0.5 ||
                    Math.abs((ws.trimEnd || 0) - tEnd) > 0.5 ||
                    Math.abs((ws.trimStart || 0) - tStart) > 0.5 ||
                    Math.abs((ws.sourceEndSec || 0) - tEnd) > 0.5 ||
                    Math.abs((ws.sourceStartSec || 0) - tStart) > 0.5) {
                  ws.trimStart = tStart;
                  ws.trimEnd = tEnd;
                  ws.durationSec = tDur;
                  ws.sourceStartSec = tStart;
                  ws.sourceEndSec = tEnd;
                  changed = true;
                }
              }
            }
          }

          if (changed) {
            fs.writeFileSync(wsFile, JSON.stringify(wsJson, null, 2), 'utf8');
            dlog(`[smart-split-reconciler] Successfully synced ${wsFile} to Smart Split Plan`);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
}

setInterval(reconcileWorkspacesWithSmartSplit, 2500);
setTimeout(reconcileWorkspacesWithSmartSplit, 500);

async function resolveMediaNative(req) {
  const videoId = req.videoId;
  const maxHeight = req.maxHeight || 360;
  const settingsSnapshot = readSmartSplitSettingsSnapshot();
  const configuredPlan = getSmartSplitPlan(0, settingsSnapshot);
  const anonClient = await ensureGateClient();
  const chain = ['ANDROID', 'IOS', null];
  const failures = [];
  for (const ytClient of chain) {
    const clientName = ytClient || 'WEB';
    let sessClient = anonClient;
    let info;
    try {
      if (ytClient) info = await anonClient.getBasicInfo(videoId, { client: ytClient });
      else { sessClient = await ensureClient(req.cookie || currentCookie); info = await sessClient.getInfo(videoId); }
    } catch (e) { failures.push(`${clientName}: getInfo threw ${(e && e.message) || e}`); continue; }
    const status = info.playability_status?.status || '';
    if (status !== 'OK') { failures.push(`${clientName}: not playable ${status}`); continue; }
    if (info.basic_info?.is_live || info.basic_info?.is_upcoming) throw new Error('live/upcoming â€” native path only handles finished VODs');
    const durationSec = info.basic_info?.duration || 0;
    const format = pickProgressiveFormat(info, maxHeight);
    if (!format) { failures.push(`${clientName}: no progressive format`); continue; }
    const gotHeight = format.height || 0;
    if (gotHeight < maxHeight) {
      const adaptiveMax = ((info.streaming_data && info.streaming_data.adaptive_formats) || [])
        .filter(f => f.has_video).reduce((m, f) => Math.max(m, f.height || 0), 0);
      if (adaptiveMax >= maxHeight) throw new Error(`progressive only ${gotHeight}p, need ${maxHeight}p â€” yt-dlp can merge adaptive`);
    }
    let directUrl = null;
    try {
      directUrl = await format.decipher(sessClient.session.player);
      if (typeof directUrl !== 'string' || !directUrl.startsWith('http')) directUrl = null;
    } catch (_) { directUrl = null; }
    if (!directUrl) { failures.push(`${clientName}: decipher failed`); continue; }
    const planToUse = getSmartSplitPlan(durationSec, settingsSnapshot) || configuredPlan;
    const isFullVideo = Number(settingsSnapshot && settingsSnapshot.defaultTrimLimit) >= 900;
    const limitSec = isFullVideo ? 0 : ((planToUse && planToUse.totalTrimSec) || req.limitSec || 0);
    const range = computeByteRange(format, durationSec, limitSec);
    return {
      at: Date.now(), maxHeight, limitSec, directUrl, range,
      ua: CLIENT_UA[clientName] || CLIENT_UA.WEB,
      format: { itag: format.itag, width: format.width || 0, height: format.height || 0 },
      durationSec, title: info.basic_info?.title || '', clientName, host: hostOf(directUrl),
      splitPlan: planToUse,
    };
  }
  throw new Error(failures.join(' | ') || 'resolve failed');
}

async function downloadVideoNative(req, ctx) {
  const videoId = req.videoId;
  const outputPath = req.outputPath;
  const settingsSnapshot = readSmartSplitSettingsSnapshot();
  let splitPlan = getSmartSplitPlan(0, settingsSnapshot);
  let planToUse = splitPlan || { p1Sec: (req.limitSec || 60), p2Sec: 0, p3Sec: 0 };
  const maxHeight = req.maxHeight || 360;
  const isPartRequest = !!(outputPath && /_part\d+\.mp4$/i.test(path.basename(outputPath)));
  let cached = null;
  if (!isPartRequest && req.useResolved !== false) {
    const inflight = resolveInflight.get(videoId);
    if (inflight) {
      await Promise.race([inflight.catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
      if (ctx && ctx.aborted) throw new AbortedError();
    }
    cached = takeResolved(videoId, maxHeight);
    if (cached && cached.splitPlan) {
      planToUse = cached.splitPlan;
      splitPlan = cached.splitPlan;
    }
  }
  if (outputPath) {
    const dir = path.dirname(outputPath);
    const fileName = path.basename(outputPath);
    const mPart = fileName.match(/^(.*)_part(\d+)\.mp4$/i);
    let masterPath = null;
    if (mPart) {
      const candidates = [
        path.join(dir, mPart[1] + '_master.mp4'),
        path.join(dir, `${videoId}_master.mp4`)
      ];
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f.includes(videoId) && f.endsWith('_master.mp4')) {
            candidates.push(path.join(dir, f));
          }
        }
      } catch (_) {}
      for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).size > 65536) {
          masterPath = c;
          break;
        }
      }
    }

    if (mPart && !masterPath) {
      throw new Error(`Part request ${fileName} has no downloaded master; use the section-download fallback`);
    }

    if (mPart && masterPath) {
      const partNum = parseInt(mPart[2], 10);
      let startSec = 0;
      let durSec = 180;
      let masterDur = 0;
      let masterMeta = null;
      const metaFile = masterPath + '.meta.json';
      if (fs.existsSync(metaFile)) {
        try {
          masterMeta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          if (masterMeta.actualDurationSec) masterDur = masterMeta.actualDurationSec;
        } catch (_) {}
      }
      if (!masterDur) {
        try {
          const wsFile = path.join(dir, '..', '.hyperclip', 'workspaces.json');
          if (fs.existsSync(wsFile)) {
            const wsJson = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
            const w = (wsJson.workspaces || []).find(x => x.video_id === videoId);
            if (w && (w.originalDurationSec || w.durationSec)) {
              masterDur = w.originalDurationSec || w.durationSec;
            }
          }
        } catch (_) {}
      }

      let effectivePlan = (masterMeta && masterMeta.splitPlan && masterMeta.splitPlan.enabled)
        ? masterMeta.splitPlan
        : null;
      if (!effectivePlan || !effectivePlan.enabled) {
        effectivePlan = getSmartSplitPlan(masterDur, settingsSnapshot) || splitPlan;
        if (effectivePlan && effectivePlan.enabled) {
          saveSplitPlanMetadata(masterPath, videoId, effectivePlan, masterDur);
          dlog(`[smart-split] Dynamically recovered split plan for ${videoId}: P1=${effectivePlan.p1Sec}s, P2=${effectivePlan.p2Sec}s, P3=${effectivePlan.p3Sec}s (parts: ${effectivePlan.parts})`);
        }
      }
      if (!effectivePlan || !effectivePlan.enabled) {
        throw new Error(`Auto split is not enabled for ${videoId}`);
      }
      const p1Sec = Math.max(0, Number(effectivePlan.p1Sec) || 0);
      const p2Sec = Math.max(0, Number(effectivePlan.p2Sec) || 0);
      const p3Sec = Math.max(0, Number(effectivePlan.p3Sec) || 0);
      const totalSec = Math.max(0, Number(effectivePlan.totalTrimSec) || masterDur || 0);
      if (partNum > (Number(effectivePlan.parts) || 1)) {
        throw new Error(`Part ${partNum} is outside saved plan (${effectivePlan.parts} parts)`);
      }

      if (partNum === 1) {
        startSec = 0;
        durSec = p1Sec;
      } else if (partNum === 2) {
        startSec = p1Sec;
        durSec = p2Sec;
      } else if (partNum === 3) {
        startSec = p1Sec + p2Sec;
        durSec = p3Sec;
      } else {
        startSec = p1Sec + p2Sec + (partNum - 3) * p3Sec;
        durSec = p3Sec;
      }

      durSec = Math.max(0, Math.min(durSec, totalSec - startSec));
      if (durSec <= 0) throw new Error(`Part ${partNum} has no source duration in saved plan`);
      dlog(`[smart-split] Local slice for Part ${partNum} [${startSec}s..${startSec + durSec}s] (${durSec}s) from master to ${outputPath}`);
      let ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg_real.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');
      if (!fs.existsSync(ffmpegExe)) ffmpegExe = 'D:\\HyperClip\\HyperClip-TestCustomer-20260616-224538\\app\\_internal\\resources\\ffmpeg\\bin\\ffmpeg_real.exe';
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
      await runFileAsync(ffmpegExe, [
        '-y', '-ss', String(startSec), '-i', masterPath, '-t', String(durSec), '-c', 'copy', outputPath
      ]);

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        dlog(`[smart-split] Part ${partNum} local slice complete: ${fs.statSync(outputPath).size} bytes`);
        return {
          ok: true,
          outputPath: outputPath,
          durationSec: durSec,
          videoWidth: 640,
          videoHeight: 360,
          truncated: true,
          sourceIp: '127.0.0.1'
        };
      }
      throw new Error(`Local slice for Part ${partNum} produced no valid output`);
    }
  }

  const isSmartSplit = !!(planToUse && planToUse.enabled && outputPath && outputPath.endsWith(".mp4") && !outputPath.includes("_part"));
  const jobSettingsSnapshot = (planToUse && planToUse.settingsSnapshot) || settingsSnapshot;
  const isFullVideo = Number(jobSettingsSnapshot && jobSettingsSnapshot.defaultTrimLimit) >= 900;
  const limitSec = isFullVideo ? 0 : ((planToUse && planToUse.totalTrimSec) || req.limitSec || 0);
  const masterPath = isSmartSplit ? outputPath.replace(/\.mp4$/i, "_master.mp4") : null;
  const fetchTarget = isSmartSplit ? masterPath : outputPath;
  const t0 = Date.now();
  // Pass 90: fetch v2 (hĂ ng chunk + keep-alive + tail-hedge) theo cá» Rust
  // truyá»n (setting `nativeFetchV2`), máº·c Ä‘á»‹nh v1 Ä‘á»ƒ A/B.
  const useV2 = !!req.fetchV2;
  const abortedCheck = () => { if (ctx && ctx.aborted) throw new AbortedError(); };

  // ANDROID first: it is the only client still exposing progressive itag 18
  // (verified 2026-07-15: IOS answered "no progressive mp4 format" for every
  // probe while burning 2.9-7.5s of getInfo). IOS stays as cheap insurance â€”
  // it costs nothing while ANDROID succeeds. WEB goes last: without po_token
  // it is usually UNPLAYABLE, but an authenticated session can still serve
  // it. A second pass after 1.5s covers provisioning delay on ultra-fresh
  // uploads; anything left falls back to yt-dlp Rust-side.
  //
  // Mobile clients must go through the ANONYMOUS gate client via
  // getBasicInfo (ONE /player call â€” getInfo adds a wasted /next): since
  // ~2026-07-15 12:00Z YouTube hard-rejects (HTTP 400) /player calls that
  // carry cookies/SAPISIDHASH with an IOS/ANDROID context (log 21-07-43:
  // cookie+IOS/ANDROID 400'd while the anonymous probe-gate ANDROID kept
  // answering a minute later) â€” the same reason yt-dlp marks ios/android
  // "SUPPORTS_COOKIES: False" and strips auth for them. The cookie session
  // is only created if the chain actually reaches WEB. Anonymous means
  // operator-private videos die here, but the probe-gate already keeps
  // those out of the pipeline.
  const chain = ['ANDROID', 'IOS', null]; // null = cookie session (WEB)
  const anonClient = await ensureGateClient();
  const sourceIp = req.sourceIp || null; // bypass VPN: bind the physical NIC
  // Sá»‘ káº¿t ná»‘i song song: Rust truyá»n theo cáº¥u hĂ¬nh pháº§n cá»©ng (dĂ¹ng chung vá»›i
  // concurrent_fragments cá»§a yt-dlp) â€” nhiá»u káº¿t ná»‘i lĂ  cĂ¡ch Ä‘á»‘i khĂ¡ng
  // googlevideo throttle per-connection (xem chĂº thĂ­ch PARALLEL_CONNECTIONS).
  if (req.conns) {
    PARALLEL_CONNECTIONS = Math.max(1, Math.min(PARALLEL_CONNECTIONS_MAX, Number(req.conns) || PARALLEL_CONNECTIONS_DEFAULT));
  }
  if (req.limitSec && req.limitSec > 0 && req.limitSec <= 65) {
    PARALLEL_CONNECTIONS = Math.min(PARALLEL_CONNECTIONS, 8);
  }
  // Pass 90 (A1): URL Ä‘Ă£ resolve sá»›m + socket má»Ÿ sáºµn â†’ bá» qua /player+decipher.
  // Lá»—i báº¥t ká»³ (403 vĂ¬ URL/IP lá»‡ch, 416, socket cháº¿tâ€¦) â†’ cháº¡y láº¡i chain Ä‘áº§y Ä‘á»§
  // nhÆ° chÆ°a cĂ³ gĂ¬ â€” khĂ´ng tá»‡ hÆ¡n Ä‘Æ°á»ng cÅ©.
  // The resolver snapshot is captured before the download starts and reused here.
  if (cached) {
    if (isSmartSplit && masterPath) {
      saveSplitPlanMetadata(masterPath, videoId, cached.splitPlan || planToUse, cached.durationSec);
    }
    const agent = makePreconnAgent(videoId, cached.host, PARALLEL_CONNECTIONS);
    const ageMs = Date.now() - cached.at;
    dlog(`[native-dl] ${videoId} dĂ¹ng URL resolve sá»›m (${(ageMs / 1000).toFixed(1)}s trÆ°á»›c, ${cached.clientName}, ${agent.hcPreconn} socket má»Ÿ sáºµn)`);
    try {
      let written;
      try {
        written = useV2
          ? await fetchUrlToFileParallelV2(cached.directUrl, cached.range, fetchTarget, sourceIp, cached.ua, ctx, { chunkKb: Number(req.chunkKb) || 0, agent, hostRace: req.hostRace !== false })
          : await fetchUrlToFileParallel(cached.directUrl, cached.range, fetchTarget, sourceIp, cached.ua, ctx, agent);
      } finally {
        try { agent.hcDestroyPool(); agent.destroy(); } catch (_) {}
      }
      abortedCheck();
      if (written < 65536) throw new Error(`suspiciously small download (${written} bytes)`);
        if (isSmartSplit && masterPath && require('fs').existsSync(masterPath)) {
          try {
            const fs = require('fs');
            const path = require('path');
            let ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg_real.exe');
            if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe');
            if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');
            if (!fs.existsSync(ffmpegExe)) ffmpegExe = 'D:\\HyperClip\\HyperClip-TestCustomer-20260616-224538\\app\\_internal\\resources\\ffmpeg\\bin\\ffmpeg_real.exe';
            const sourceDurationSec = Number(cached.durationSec) || 0;
            const savedPlan = cached.splitPlan || getSmartSplitPlan(sourceDurationSec, planToUse.settingsSnapshot) || planToUse;
            saveSplitPlanMetadata(masterPath, videoId, savedPlan, sourceDurationSec);
            dlog(`[smart-split] Slicing Part 1 (0 -> ${savedPlan.p1Sec}s) from master to ${outputPath}`);
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
            await runFileAsync(ffmpegExe, [
              '-y', '-ss', '0', '-i', masterPath, '-t', String(savedPlan.p1Sec), '-c', 'copy', outputPath
            ]);
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 1000) {
              const splitError = new Error('Part 1 slice produced no valid output');
              splitError.splitFailure = true;
              throw splitError;
            }
            written = fs.statSync(outputPath).size;
          } catch (e) {
            dlog(`[smart-split] Slicing Part 1 failed: ${(e && e.message) || e}`);
            e.splitFailure = true;
            throw e;
          }
        }

      dlog(`[native-dl] ${videoId} itag=${cached.format.itag} client=${cached.clientName}/direct/resolved${sourceIp ? '/bind:' + sourceIp : ''}${useV2 ? '/v2' : ''} ${written} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s${cached.range ? ' (ranged)' : ''} preconn_hit=${agent.hcHits}/${agent.hcHits + agent.hcMiss}`);
      return {
        bytes: written,
        durationSec: cached.durationSec || (isSmartSplit ? planToUse.p1Sec : 0),
        videoWidth: cached.format.width,
        videoHeight: cached.format.height,
        truncated: !!cached.range || isSmartSplit,
        videoTitle: cached.title,
      };
    } catch (e) {
      if (e && e.aborted) throw e;
      if (e && e.splitFailure) throw e;
      abortedCheck();
      // Ghi kĂ¨m sá»‘ redirect + host cuá»‘i: phĂ¢n xá»­ Ä‘Æ°á»£c "400 do socket lá»‡ch
      // host sau redirect" (Ä‘Ă£ sá»­a á»Ÿ PreconnAgent) hay 400 tá»« chĂ­nh URL.
      const extra = (e && e.httpStatus)
        ? ` (redirects=${e.hcRedirects ?? '?'}, host_cuá»‘i=${e.hcHost || '?'}, host_pool=${cached.host})`
        : '';
      dlog(`[native-dl] ${videoId} URL resolve sá»›m lá»—i (${(e && e.message) || e})${extra} â€” cháº¡y láº¡i chain Ä‘áº§y Ä‘á»§`);
      dropPreconn(videoId);
    }
  } else {
    dropPreconn(videoId);
  }
  let lastErr = null;
  const failures = []; // per-client reasons â€” surfaced in the final error
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      const msg = String((lastErr && lastErr.message) || lastErr);
      // "not playable" is a property of the video (private/removed) and a
      // definite HTTP rejection repeats identically seconds later (observed
      // 20-40-35: pass 2 burned 5s failing the same way) â€” a second pass only
      // helps thrown/network getInfo errors (provisioning hiccups).
      if (msg.startsWith('not playable') || (lastErr && lastErr.httpStatus)) break;
      abortedCheck();
      dlog(`[native-dl] ${videoId} chain pass 2 after 1.5s (${msg})`);
      await new Promise(res => setTimeout(res, 1500));
    }
    for (const ytClient of chain) {
      abortedCheck();
      const clientName = ytClient || 'WEB';
      let sessClient = anonClient;
      let info;
      try {
        if (ytClient) {
          info = await anonClient.getBasicInfo(videoId, { client: ytClient });
        } else {
          sessClient = await ensureClient(req.cookie || currentCookie);
          info = await sessClient.getInfo(videoId);
        }
      } catch (e) {
        dlog(`[native-dl] ${videoId} getInfo(${clientName}) threw: ${(e && e.message) || e}`);
        failures.push(`${clientName}: getInfo threw ${(e && e.message) || e}`);
        lastErr = e;
        continue;
      }
      const status = info.playability_status?.status || '';
      if (status !== 'OK') {
        dlog(`[native-dl] ${videoId} getInfo(${clientName}) not playable: ${status} ${info.playability_status?.reason || ''}`);
        failures.push(`${clientName}: not playable ${status}`);
        lastErr = new Error(`not playable (${clientName}): ${status} ${info.playability_status?.reason || ''}`.trim());
        continue;
      }
      // Live/upcoming is a property of the video, not the client â€” stop here.
      if (info.basic_info?.is_live || info.basic_info?.is_upcoming) {
        throw new Error('live/upcoming â€” native path only handles finished VODs');
      }
      const durationSec = info.basic_info?.duration || 0;
      if (isSmartSplit) {
        planToUse = getSmartSplitPlan(durationSec, planToUse.settingsSnapshot) || planToUse;
        saveSplitPlanMetadata(masterPath, videoId, planToUse, durationSec);
      }
      const format = pickProgressiveFormat(info, maxHeight);
      if (!format) {
        dlog(`[native-dl] ${videoId} no progressive mp4 format on ${clientName}`);
        failures.push(`${clientName}: no progressive format`);
        lastErr = new Error(`no progressive mp4 format on ${clientName}`);
        continue;
      }
      // ÄÆ°á»ng native chá»‰ cĂ³ Ä‘á»‹nh dáº¡ng PROGRESSIVE (má»™t file, moov Ä‘áº§u file).
      // YouTube chá»‰ phĂ¡t hĂ nh progressive á»Ÿ 360p (itag 18) vĂ  720p (itag 22),
      // vĂ  itag 22 KHĂ”NG pháº£i video nĂ o cÅ©ng cĂ³. Náº¿u báº£n progressive tá»‘t nháº¥t
      // tháº¥p hÆ¡n má»©c khĂ¡ch Ä‘áº·t TRONG KHI luá»“ng adaptive cĂ³ má»©c Ä‘Ă³, thĂ¬ im láº·ng
      // giao hĂ ng tháº¥p hÆ¡n lĂ  nĂ³i dá»‘i vá» cháº¥t lÆ°á»£ng â€” render sáº½ phĂ³ng ngÆ°á»£c lĂªn
      // vĂ  ra hĂ¬nh nhĂ²e (Ä‘Ăºng lá»—i log khĂ¡ch 11/08: 8/8 lÆ°á»£t táº£i Ä‘á»u itag 18).
      // Tráº£ lá»—i Ä‘á»ƒ rÆ¡i vá» yt-dlp: cháº­m hÆ¡n ~2,5s nhÆ°ng ghĂ©p Ä‘Æ°á»£c adaptive vĂ 
      // giao ÄĂNG chiá»u cao Ä‘Ă£ há»©a. CĂ²n khi adaptive cÅ©ng khĂ´ng cĂ³ má»©c Ä‘Ă³ thĂ¬
      // khĂ´ng ai lĂ m tá»‘t hÆ¡n Ä‘Æ°á»£c â€” nháº­n progressive, Ä‘á»«ng tráº£ giĂ¡ vĂ´ Ă­ch.
      const gotHeight = format.height || 0;
      if (gotHeight < maxHeight) {
        const adaptiveMax = ((info.streaming_data && info.streaming_data.adaptive_formats) || [])
          .filter(f => f.has_video)
          .reduce((m, f) => Math.max(m, f.height || 0), 0);
        if (adaptiveMax >= maxHeight) {
          dlog(`[native-dl] ${videoId} progressive tá»‘t nháº¥t ${gotHeight}p < yĂªu cáº§u ${maxHeight}p (adaptive cĂ³ ${adaptiveMax}p) â€” nháº£ vá» yt-dlp Ä‘á»ƒ giá»¯ Ä‘Ăºng cháº¥t lÆ°á»£ng`);
          throw new Error(`progressive only ${gotHeight}p, need ${maxHeight}p â€” yt-dlp can merge adaptive`);
        }
        dlog(`[native-dl] ${videoId} chá»‰ cĂ³ tá»‘i Ä‘a ${gotHeight}p (adaptive cÅ©ng váº­y) â€” nháº­n báº£n nĂ y`);
      }
      let range = computeByteRange(format, durationSec, limitSec);
      // Prefer the deciphered direct URL over youtubei.js's downloader: a
      // plain https GET with a client-matched UA is what yt-dlp does, and it
      // supports localAddress (VPN bypass). Decipher failure falls back to
      // info.download().
      let directUrl = null;
      try {
        // NOTE: decipher() is async in youtubei.js 17 â€” a missing await hands
        // a Promise to https.get and dies with "listener argument must be of
        // type function" (debugged 2026-07-15).
        directUrl = await format.decipher(sessClient.session.player);
        if (typeof directUrl !== 'string' || !directUrl.startsWith('http')) {
          dlog(`[native-dl] ${videoId} decipher on ${clientName} returned ${typeof directUrl} â€” using lib downloader`);
          directUrl = null;
        }
      } catch (e) {
        dlog(`[native-dl] ${videoId} decipher failed on ${clientName}: ${(e && e.message) || e}`);
      }
      const ua = CLIENT_UA[clientName] || CLIENT_UA.WEB;
      // First attempt always goes parallel â€” even rangeless (a 5:00 video at
      // limit 5:00 gets range=null but still wants the whole ~10MB fast); the
      // retry drops to one plain 200 full download, the most forgiving
      // request possible.
      const doFetch = (r) => directUrl
        ? (useV2
            ? fetchUrlToFileParallelV2(directUrl, r, fetchTarget, sourceIp, ua, ctx, { chunkKb: Number(req.chunkKb) || 0, hostRace: req.hostRace !== false })
            : fetchUrlToFileParallel(directUrl, r, fetchTarget, sourceIp, ua, ctx))
        : fetchToFile(info, format.itag, r, fetchTarget);
      const doFetchFull = () => directUrl
        ? fetchUrlToFile(directUrl, null, fetchTarget, sourceIp, ua)
        : fetchToFile(info, format.itag, null, fetchTarget);
      try {
        let written;
        try {
          try {
            written = await doFetch(range);
          } catch (e) {
            // v2 lá»—i vĂ¬ lĂ½ do KHĂ”NG pháº£i HTTP (bug/edge láº¡) â†’ thá»­ v1 cĂ¹ng
            // range trÆ°á»›c khi rÆ¡i xuá»‘ng 1 káº¿t ná»‘i full (cháº­m nháº¥t).
            if (!(useV2 && directUrl && !(e && e.aborted) && !(e && e.httpStatus))) throw e;
            abortedCheck();
            dlog(`[native-dl] ${videoId} fetch v2 lá»—i (${(e && e.message) || e}) â€” thá»­ v1 cĂ¹ng range`);
            written = await fetchUrlToFileParallel(directUrl, range, fetchTarget, sourceIp, ua, ctx);
          }
        } catch (e) {
          // Bá»‹ Rust há»§y (thua hedge / video nguá»™i nhÆ°á»ng): dá»«ng ngay, khĂ´ng
          // retry, khĂ´ng sang client khĂ¡c â€” má»i byte thĂªm Ä‘á»u lĂ  bÄƒng thĂ´ng
          // giáº­t cá»§a video Ä‘ang tháº¯ng.
          if (e && e.aborted) throw e;
          abortedCheck();
          // A definite HTTP rejection on an already-rangeless parallel fetch
          // repeats identically on the single-conn retry â€” skip straight to
          // the next client.
          if (!range && e && e.httpStatus) throw e;
          // A bitrate-estimated range end can overshoot the real file size
          // (fresh uploads report no content_length) and some googlevideo
          // edges answer 416 instead of clamping â€” one rangeless retry on the
          // SAME client before hopping to the next one.
          dlog(`[native-dl] ${videoId} ${range ? 'ranged' : 'rangeless'} fetch failed on ${clientName} (${(e && e.message) || e}) â€” retrying single-conn full`);
          range = null;
          written = await doFetchFull();
        }
        abortedCheck();
        if (written < 65536) throw new Error(`suspiciously small download (${written} bytes)`);
        if (isSmartSplit && masterPath && require('fs').existsSync(masterPath)) {
          try {
            const fs = require('fs');
            const path = require('path');
            let ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg_real.exe');
            if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe');
            if (!fs.existsSync(ffmpegExe)) ffmpegExe = path.resolve(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe');
            if (!fs.existsSync(ffmpegExe)) ffmpegExe = 'D:\\HyperClip\\HyperClip-TestCustomer-20260616-224538\\app\\_internal\\resources\\ffmpeg\\bin\\ffmpeg_real.exe';
            saveSplitPlanMetadata(masterPath, videoId, planToUse, durationSec);
            dlog(`[smart-split] Slicing Part 1 (0 -> ${planToUse.p1Sec}s) from master to ${outputPath}`);
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
            await runFileAsync(ffmpegExe, [
              '-y', '-ss', '0', '-i', masterPath, '-t', String(planToUse.p1Sec), '-c', 'copy', outputPath
            ]);
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 1000) {
              const splitError = new Error('Part 1 slice produced no valid output');
              splitError.splitFailure = true;
              throw splitError;
            }
            written = fs.statSync(outputPath).size;
          } catch (e) {
            dlog(`[smart-split] Slicing Part 1 failed: ${(e && e.message) || e}`);
            e.splitFailure = true;
            throw e;
          }
        }

        dlog(`[native-dl] ${videoId} itag=${format.itag} client=${clientName}${directUrl ? '/direct' : '/lib'}${sourceIp ? '/bind:' + sourceIp : ''}${useV2 ? '/v2' : ''} ${written} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s${range ? ' (ranged)' : ''}`);
        return {
          bytes: written,
          durationSec: durationSec || (isSmartSplit ? planToUse.p1Sec : 0),
          videoWidth: format.width || 0,
          videoHeight: format.height || 0,
          truncated: !!range || isSmartSplit,
          // ORIGINAL-language title from /player videoDetails â€” the browse/
          // playlist surfaces auto-translate titles to the session hl (en),
          // which showed Korean titles as English in the UI (verified
          // 2026-07-16 on Iqg4dBv8gs4: /player returns the Korean original
          // under hl=en/ko/ja alike). Rust overwrites the workspace title
          // with this after the download.
          videoTitle: info.basic_info?.title || '',
        };
      } catch (e) {
        if (e && e.aborted) {
          dlog(`[native-dl] ${videoId} bá»‹ há»§y theo lá»‡nh Rust (abortDownload) â€” dá»«ng, khĂ´ng sang client khĂ¡c`);
          throw e;
        }
        if (e && e.splitFailure) throw e;
        dlog(`[native-dl] ${videoId} fetch failed on ${clientName}: ${(e && e.message) || e}`);
        failures.push(`${clientName}: fetch ${(e && e.message) || e}`);
        lastErr = e;
      }
    }
  }
  const summary = failures.length
    ? failures.join(' | ')
    : String((lastErr && lastErr.message) || lastErr || 'native download failed');
  const finalErr = new Error(summary);
  if (lastErr && lastErr.httpStatus) finalErr.httpStatus = lastErr.httpStatus;
  throw finalErr;
}

// Pass 148: QuĂ©t trá»±c tiáº¿p tab Videos cá»§a kĂªnh qua InnerTube /browse (params: Egh2aWRlb3PyBgQKAjoA).
// Bá» qua hoĂ n toĂ n cache 15s cá»§a playlist UU, pháº£n á»©ng tá»©c thĂ¬ 250-400ms ngay khi video cĂ´ng khai.
async function strategyChannelVideos(client, channelId) {
  try {
    const res = await client.actions.execute('/browse', { browseId: channelId, params: 'Egh2aWRlb3PyBgQKAjoA' });
    const data = res && (res.data || res);
    const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const selectedTab = tabs.find(t => t.tabRenderer?.selected) || tabs[1] || tabs[0];
    const richGrid = selectedTab?.tabRenderer?.content?.richGridRenderer;
    const items = richGrid?.contents || [];
    const out = [];
    for (const item of items) {
      const richItem = item?.richItemRenderer?.content;
      const lv = richItem?.lockupViewModel || item?.lockupViewModel;
      if (lv) {
        const v = extractFromLockupView(lv);
        if (v && v.videoId) {
          if (!v.upcoming && (!v.publishedAt || v.publishedAt <= 1)) {
            v.publishedAt = Date.now();
          }
          out.push(v);
        }
        continue;
      }
      const vr = richItem?.videoRenderer || item?.videoRenderer || item?.gridVideoRenderer;
      if (vr) {
        const vid = vr.videoId;
        if (vid) {
          const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || '';
          const publishedText = vr.publishedTimeText?.simpleText || vr.publishedTimeText?.runs?.[0]?.text || '';
          const publishedAt = parseRelativeTime(publishedText) || Date.now();
          out.push({
            videoId: vid,
            title,
            publishedAt,
            thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            durationSec: 0,
            upcoming: false,
            scheduleText: ''
          });
        }
      }
    }
    return out;
  } catch (e) {
    dlog(`[strategyChannelVideos] ${channelId} lá»—i: ${e && e.message ? e.message : e}`);
    return [];
  }
}

async function getLatestVideo(channelId, cookieStr, fastProbe, probeCookie) {
  try {
    const client = await ensureClient(cookieStr);
    const resolvedId = await resolveChannelId(client, channelId);
    if (!resolvedId || !resolvedId.startsWith('UC')) {
      return { ok: false, error: 'Could not resolve channel ID: ' + channelId };
    }

    // Pass 148: Æ¯u tiĂªn sá»‘ 1 â€” Tab Videos cá»§a kĂªnh pháº£n xáº¡ ngay tá»©c thĂ¬ 250-400ms
    const browseVideos = await strategyChannelVideos(client, resolvedId);
    if (browseVideos.length > 0) {
      return { ok: true, videos: browseVideos };
    }

    const playlistId = resolvedId.replace(/^UC/, 'UU');
    // The HTML probe fetch prefers the dedicated probe cookie (CDP-fresh
    // profile-1 owner cookie): stale session cookies get served the anonymous
    // public-index view, which lags the owner view by minutes for fresh
    // uploads/flips. The playability gate below keeps owner-only (private)
    // items out of the pipeline.
    const htmlPromise = fastProbe ? strategyPlaylistHTML(resolvedId, probeCookie || cookieStr) : Promise.resolve([]);
    const videos = await strategyPlaylistInnertube(client, playlistId);
    const htmlVideos = await htmlPromise;

    // Instant Playlist HTML Resolver: a video present on the playlist PAGE but
    // absent from the API list is a brand-new upload the index hasn't caught up
    // with â€” stamp it "published now" so the Rust age filter accepts it (the
    // seen-ids dedup discards everything already processed). Only trust this
    // when the API list is non-empty, so a total API failure can't turn 15 old
    // videos into "new" ones. Each candidate must pass the player playability
    // gate above â€” private/members-only/upcoming videos are dropped.
    if (htmlVideos.length > 0 && videos.length > 0) {
      const known = new Set(videos.map(v => v.videoId));
      // Verify SONG SONG: vĂ²ng await tuáº§n tá»± tá»«ng candidate biáº¿n 7 video
      // private "cháº¿t" thĂ nh hĂ ng chá»¥c giĂ¢y cho Má»˜T call getLatestVideo vĂ 
      // kĂ©o sáº­p cadence poll toĂ n cá»¥c (2s â†’ 98s, log khĂ¡ch 2026-07-17 16-19).
      const candidates = htmlVideos.filter(hv => !known.has(hv.videoId));
      const verdicts = await Promise.all(candidates.map(hv => verifyHtmlFreshPlayable(hv.videoId)));
      const fresh = [];
      candidates.forEach((hv, i) => {
        const verdict = verdicts[i];
        if (!verdict.playable) return;
        // Giá» Ä‘Äƒng THáº¬T náº¿u /player Ä‘Æ°a Ä‘Æ°á»£c; chá»‰ khi khĂ´ng cĂ³ má»›i Ä‘Ă³ng dáº¥u
        // "bĂ¢y giá»" Ä‘á»ƒ qua bá»™ lá»c tuá»•i â€” vĂ  nĂ³i rĂµ trong log lĂ  Ä‘Ă£ pháº£i Æ°á»›c
        // lÆ°á»£ng, vĂ¬ badge Ä‘á»™ trá»… cá»§a video Ä‘Ă³ sáº½ Ä‘áº¹p hÆ¡n sá»± tháº­t.
        const realPub = verdict.publishedAtMs || 0;
        hv.publishedAt = realPub || Date.now();
        hv.publishedAtEstimated = !realPub;
        if (!realPub) {
          dlog(`[probe] ${hv.videoId} /player khĂ´ng tráº£ giá» Ä‘Äƒng â€” badge Ä‘á»™ trá»… sáº½ tĂ­nh tá»« "bĂ¢y giá»"`);
        }
        hv.durationSec = verdict.durationSec || 0;
        hv.htmlFresh = true; // nguá»“n phĂ¡t hiá»‡n: trang playlist, khĂ´ng pháº£i API list
        // Prefer the /player original-language title over the HTML page's
        // (the page is served in the session language â†’ auto-translated).
        if (verdict.title) hv.title = verdict.title;
        dlog(`[probe] ${hv.videoId} HTML-fresh on ${resolvedId} â€” stamped published=now (dur=${hv.durationSec}s)`);
        fresh.push(hv);
      });
      if (fresh.length > 0) {
        return { ok: true, videos: [...fresh, ...videos] };
      }
    }
    return { ok: true, videos: videos };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// (Khá»‘i Chrome-tab CDP: evaluateInTab/reloadTab/httpGetJson/extractVideosFromFeedJson/
//  checkChromeChannelTabs Ä‘Ă£ xoĂ¡ 2026-08-17 â€” Ä‘Æ°á»ng quĂ©t qua Chrome bá» tá»« Pass 58.)

// â”€â”€â”€ Response writer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _forceStdout = false;
function writeResponse(obj) {
  const msg = JSON.stringify(obj) + '\n';
  if (!_forceStdout) {
    const respFile = process.env.HYPERCLIP_RESPONSE_FILE;
    if (respFile) {
      require('fs').writeFileSync(respFile, msg, 'utf-8');
      return;
    }
  }
  require('fs').writeSync(1, msg);
}

// â”€â”€â”€ DAEMON MODE (--daemon) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Long-lived process: reads JSON-RPC from stdin, writes to stdout.
// Keeps Innertube client warm for instant responses.
function runDaemon(initialCookie) {
  // In daemon mode, always write to stdout (ignore HYPERCLIP_RESPONSE_FILE)
  _forceStdout = true;

  // Don't create client eagerly â€” it will be created lazily on first request
  // with the actual cookie. Creating with empty cookie hangs/takes too long.
  // Signal ready immediately so Rust doesn't timeout waiting.
  writeResponse({ daemon: true, status: 'ready' });

  // Pre-warm the anonymous gate client in the background: native downloads
  // (mobile-client getBasicInfo) and probe-gates both run through it, and a
  // download daemon is often spawned right when a fresh video needs fetching
  // â€” this shaves the ~1s Innertube.create off the first download.
  ensureGateClient().catch(() => {});

  process.stdin.setEncoding('utf8');
  let buffer = '';

  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const req = JSON.parse(line);

        // Handle setCookie command â€” update cookies without restart
        if (req.cmd === 'setCookie') {
          const newCookie = req.cookie || '';
          currentCookie = ''; // force re-creation
          ensureClient(newCookie).then(() => {
            writeResponse({ id: req.id || 0, ok: true, cmd: 'setCookie' });
          }).catch(e => {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'setCookie', error: e.message });
          });
          continue;
        }

        // â”€â”€ Pass 83: FLIP PROBE â€” canh khoáº£nh kháº¯c nhĂ£n "X giĂ¢y trÆ°á»›c" Láº¬T â”€â”€
        //
        // NhĂ£n tÆ°Æ¡ng Ä‘á»‘i lĂ m trĂ²n XUá»NG: "3 giĂ¢y trÆ°á»›c" = tuá»•i âˆˆ [3s, 4s).
        // Má»™t láº§n Ä‘á»c chá»‰ cho sai sá»‘ Â±0,5-1s. NhÆ°ng náº¿u láº·p /next Ä‘á»§ dĂ y vĂ 
        // Báº®T ÄÆ¯á»¢C cĂº láº­t 3â†’4, thĂ¬ táº¡i khoáº£nh kháº¯c láº­t tuá»•i video ÄĂNG Báº°NG 4s
        // â†’ má»‘c cĂ´ng khai = giá»¯a_hai_máº«u âˆ’ 4s, sai sá»‘ Â±ná»­a khoáº£ng láº¥y máº«u.
        // /next lĂ  payload trang watch (~vĂ i trÄƒm KB JSON, 200-400ms) â€” khĂ´ng
        // tá»‘n quota Data API, khĂ´ng cáº§n Chrome.
        if (req.cmd === 'flipProbe') {
          const videoId = req.videoId;
          const intervalMs = Math.max(250, req.intervalMs || 400);
          const maxMs = Math.min(30000, req.maxMs || 20000);
          const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
          // TĂ¬m key lá»“ng sĂ¢u trong JSON thĂ´ cá»§a /next (cáº¥u trĂºc YouTube hay
          // xĂª dá»‹ch â€” Ä‘á»«ng bĂ¡m Ä‘Æ°á»ng dáº«n cá»©ng).
          const findKey = (obj, key, depth) => {
            if (!obj || typeof obj !== 'object' || depth > 14) return null;
            if (obj[key] !== undefined) return obj[key];
            for (const k of Object.keys(obj)) {
              const r = findKey(obj[k], key, depth + 1);
              if (r !== null && r !== undefined) return r;
            }
            return null;
          };
          const textOf = (t) =>
            t ? (t.simpleText || (t.runs || []).map((r) => r.text).join('')) : '';
          // NhĂ£n giĂ¢y â†’ sá»‘; Ä‘Æ¡n vá»‹ thĂ´ hÆ¡n (phĂºt/giá») â†’ null (khĂ´ng láº­t Ä‘Æ°á»£c
          // trong cá»­a sá»• 20s, vĂ  Ä‘á»™ phĂ¢n giáº£i 60s+ vĂ´ dá»¥ng cho phĂ©p Ä‘o).
          const relSecs = (text) => {
            if (!text) return null;
            const t = String(text).toLowerCase();
            if (t.includes('vá»«a xong') || t.includes('just now')) return 0;
            // YouTube dĂ¹ng Cáº¢ dáº¡ng Ä‘áº§y Ä‘á»§ ("5 seconds ago") láº«n dáº¡ng táº¯t ("5s ago").
            // Log 17-40-33: nhĂ£n "5s ago" bá»‹ loáº¡i vĂ¬ chá»‰ check "second".
            const isSeconds = t.includes('giĂ¢y') || t.includes('second')
              || /^\d+s\s/.test(t.trim()); // "5s ago", "5s trÆ°á»›c"
            if (!isSeconds) return null;
            const m = t.match(/(\d+)/);
            if (!m) return null;
            const v = parseInt(m[1], 10);
            return v >= 0 && v <= 90 ? v : null;
          };
          ensureClient(req.cookie || currentCookie).then(async (client) => {
            const samples = [];
            let flipPublicMs = 0, flipErrMs = 0, reason = 'no_flip';
            const tEnd = Date.now() + maxMs;
            let prev = null;
            // maxMs nhá» (â‰¤1) = cháº¿ Ä‘á»™ Má»˜T MáºªU: lá»›p lĂ³t tá»©c thĂ¬, Rust tá»± suy
            // Æ°á»›c lÆ°á»£ng Â±0,5s tá»« máº«u Ä‘áº§u rá»“i má»›i gá»i láº¡i cháº¿ Ä‘á»™ canh láº­t.
            let first = true;
            while (first || Date.now() < tEnd) {
              first = false;
              let label = '', tMid = 0, rtt = 0;
              try {
                const t0 = Date.now();
                const resp = await client.actions.execute('/next', { videoId, parse: false });
                const t1 = Date.now();
                const data = (resp && resp.data) || resp || {};
                const prim = findKey(data, 'videoPrimaryInfoRenderer', 0);
                label = textOf(prim && prim.relativeDateText) ||
                        textOf(prim && prim.dateText) || '';
                tMid = Math.round((t0 + t1) / 2);
                rtt = t1 - t0;
              } catch (e) {
                samples.push({ err: String((e && e.message) || e) });
                await sleepMs(intervalMs);
                continue;
              }
              const L = relSecs(label);
              samples.push({ t: tMid, rtt, label, L });
              if (L === null && samples.length === 1) {
                // NhĂ£n Ä‘áº§u Ä‘Ă£ khĂ´ng pháº£i Ä‘Æ¡n vá»‹ giĂ¢y â€” video quĂ¡ cÅ© cho flip.
                reason = 'label_not_seconds';
                break;
              }
              if (prev && L !== null) {
                if (L === prev.L + 1) {
                  // BiĂªn tuá»•i = L giĂ¢y bá»‹ cáº¯t trong (prev.t, tMid].
                  const mid = Math.round((prev.t + tMid) / 2);
                  flipPublicMs = mid - L * 1000;
                  flipErrMs = Math.max(250, Math.round((tMid - prev.t) / 2));
                  reason = 'flip';
                  break;
                }
                if (L < prev.L) {
                  // Shard khĂ¡c Ä‘á»“ng há»“ lá»‡ch â€” ghi váº¿t, cháº¡y tiáº¿p.
                  reason = 'label_jitter';
                }
                if (L > prev.L + 1) {
                  // Nháº£y â‰¥2 náº¥c: máº«u thÆ°a hÆ¡n nhĂ£n (cache/RTT dĂ i) â€” má»‘c láº­t
                  // khĂ´ng chá»‘t Ä‘Æ°á»£c chĂ­nh xĂ¡c, Ä‘á»«ng bá»‹a.
                  reason = 'label_skipped';
                }
              }
              if (L !== null) prev = { t: tMid, L };
              if (Date.now() < tEnd) await sleepMs(intervalMs);
            }
            writeResponse({
              id: req.id || 0, ok: true, cmd: 'flipProbe',
              result: { flipPublicMs, flipErrMs, reason, samples: samples.slice(-30) },
            });
          }).catch((e) => {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'flipProbe', error: String((e && e.message) || e) });
          });
          continue;
        }

        // Handle getVideoInfo command - resolve channel ID, name and real publish
        // time for a video. publishedAtMs comes from the player microformat's
        // publishDate, which carries a full ISO timestamp â€” the only per-second
        // publish time available (LockupView/tab text is minute-granular at best).
        if (req.cmd === 'getVideoInfo') {
          const videoId = req.videoId;
          ensureClient(req.cookie || currentCookie).then(async (client) => {
            try {
              const info = await client.getInfo(videoId);
              const toMs = (v) => {
                if (!v) return 0;
                if (v instanceof Date) { const t = v.getTime(); return isNaN(t) ? 0 : t; }
                const t = Date.parse(String(v));
                return isNaN(t) ? 0 : t;
              };
              const mf = info.microformat || {};
              const publishedAtMs = toMs(mf.publish_date) || toMs(mf.publishDate) || 0;
              writeResponse({
                id: req.id || 0,
                ok: true,
                cmd: 'getVideoInfo',
                channelId: info.basic_info.channel_id || '',
                channelName: info.basic_info.author || '',
                publishedAtMs: publishedAtMs,
                // Premiere watcher: lets Rust poll a scheduled premiere by video id
                // and fire the download the moment it stops being "upcoming".
                isUpcoming: !!info.basic_info.is_upcoming,
                isLive: !!info.basic_info.is_live,
                durationSec: info.basic_info.duration || 0,
                videoTitle: info.basic_info.title || '',
              });
            } catch (e) {
              writeResponse({ id: req.id || 0, ok: false, cmd: 'getVideoInfo', error: e.message });
            }
          }).catch(e => {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'getVideoInfo', error: e.message });
          });
          continue;
        }

        // Handle downloadVideo â€” native progressive download through the warm
        // session (downloadVideoNative above). The Rust caller treats any
        // error response as "fall back to yt-dlp", so failures are cheap.
        // Pass 90 (A1): resolve sá»›m â€” Rust báº¯n lĂºc phĂ¡t hiá»‡n, KHĂ”NG chá» tráº£ lá»i
        // (fire-and-forget qua kĂªnh Ä‘iá»u khiá»ƒn). Káº¿t quáº£ náº±m trong cache 5 phĂºt
        // + N socket TLS má»Ÿ sáºµn 25 s; `downloadVideo` tá»›i sau sáº½ dĂ¹ng.
        if (req.cmd === 'resolveMedia') {
          const splitPlan = getSmartSplitPlan();
          if (splitPlan && splitPlan.totalTrimSec) { req.limitSec = splitPlan.totalTrimSec; }
          const tR = Date.now();
          let n = Math.max(1, Math.min(PARALLEL_CONNECTIONS_MAX, Number(req.conns) || PARALLEL_CONNECTIONS_DEFAULT));
          if (req.limitSec && req.limitSec > 0 && req.limitSec <= 65) {
            n = Math.min(n, 8);
          }
          const p = resolveMediaNative(req).then((r) => {
            resolvedMedia.set(req.videoId, r);
            const pool = preconnect(req.videoId, r.host, n, req.sourceIp || null);
            dlog(`[native-dl] ${req.videoId} resolve sá»›m xong ${((Date.now() - tR) / 1000).toFixed(1)}s (${r.clientName}, itag=${r.format.itag}, host=${r.host}) â€” má»Ÿ sáºµn ${pool.sockets.length} káº¿t ná»‘i`);
            writeResponse({ id: req.id || 0, ok: true, cmd: 'resolveMedia', host: r.host, preconn: pool.sockets.length });
          }).catch((e) => {
            dlog(`[native-dl] ${req.videoId} resolve sá»›m lá»—i: ${(e && e.message) || e} â€” downloadVideo sáº½ cháº¡y chain thÆ°á»ng`);
            writeResponse({ id: req.id || 0, ok: false, cmd: 'resolveMedia', error: (e && e.message) || String(e) });
          }).finally(() => { if (resolveInflight.get(req.videoId) === p) resolveInflight.delete(req.videoId); });
          resolveInflight.set(req.videoId, p);
          continue;
        }

        if (req.cmd === 'downloadVideo') {
          const splitPlan = getSmartSplitPlan();
          if (splitPlan && splitPlan.totalTrimSec) { req.limitSec = splitPlan.totalTrimSec; }
          // Pass 90: ctx = tiáº¿n Ä‘á»™ (`progress` lines cĂ¹ng id) + há»§y Ä‘Æ°á»£c
          // (abortDownload) + telemetry theo slice.
          const dctx = newDownloadCtx(req.id || 0, req.videoId);
          downloadVideoNative(req, dctx).then(result => {
            dropDownloadCtx(dctx);
            writeResponse({ id: req.id || 0, ok: true, cmd: 'downloadVideo', ...result });
          }).catch(e => {
            dropDownloadCtx(dctx);
            // Bá»‹ há»§y: xoĂ¡ file dá»Ÿ Ä‘á»ƒ Rust khĂ´ng nháº·t nháº§m; Rust Ä‘Ă£ Ä‘i tiáº¿p,
            // dĂ²ng tráº£ lá»i nĂ y chá»‰ Ä‘á»ƒ Ä‘Ă³ng vĂ²ng Ä‘á»i id.
            if (e && e.aborted) { try { require('fs').unlinkSync(req.outputPath); } catch (_) {} }
            writeResponse({ id: req.id || 0, ok: false, cmd: 'downloadVideo', aborted: !!(e && e.aborted), error: (e && e.message) || String(e) });
          });
          continue;
        }

        // Pass 90: há»§y má»™t lÆ°á»£t táº£i native Ä‘ang cháº¡y (thua hedge / video nguá»™i
        // nhÆ°á»ng video nĂ³ng). Nháº¯m theo id request hoáº·c videoId; destroy socket
        // ngay nĂªn bÄƒng thĂ´ng Ä‘Æ°á»£c nháº£ trong vĂ i chá»¥c ms.
        if (req.cmd === 'abortDownload') {
          const n = abortDownloadBy(req.targetId, req.videoId);
          dlog(`[native-dl] abortDownload target=${req.targetId ?? '-'} video=${req.videoId || '-'} â†’ há»§y ${n} lÆ°á»£t`);
          writeResponse({ id: req.id || 0, ok: true, cmd: 'abortDownload', abortedCount: n });
          continue;
        }

        // Handle ping/heartbeat
        if (req.cmd === 'ping') {
          writeResponse({ id: req.id || 0, ok: true, cmd: 'pong' });
          continue;
        }

        // â”€â”€ Pass 146: SUBSCRIPTIONS FEED â€” bá» máº·t fan-out theo NGÆ¯á»œI XEM â”€â”€
        //
        // Má»i bá» máº·t Ä‘ang Ä‘ua (playlistItems/activities/Atom/trang kĂªnh/browse
        // kĂªnh) Ä‘á»u lĂ  index CĂ”NG KHAI cá»§a kĂªnh â€” log 05/09: cáº£ nÄƒm cĂ¹ng cĂ¢m
        // 54s cho má»™t video dĂ i. Feed Ä‘Äƒng kĂ½ (`FEsubscriptions`) lĂ  fan-out
        // vĂ o há»™p thÆ° cá»§a NGÆ¯á»œI XEM ngay lĂºc publish, Ä‘Æ°á»ng dá»¯ liá»‡u khĂ¡c háº³n
        // (Pass 46 tá»«ng dĂ¹ng vĂ  bá»‹ gá»¡ chung vá»›i Chrome watcher á»Ÿ Pass 58). Má»˜T
        // request phá»§ má»i kĂªnh Profile-1 Ä‘Ă£ subscribe, 0 quota Data API.
        // Äiá»u kiá»‡n váº­n hĂ nh: Profile-1 PHáº¢I subscribe cĂ¡c kĂªnh theo dĂµi.
        if (req.cmd === 'getSubscriptionsFeed') {
          const cookie = req.cookie || currentCookie;
          if (!cookie || !/SAPISID=/.test(cookie)) {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'getSubscriptionsFeed', error: 'no logged-in cookie (SAPISID) â€” feed Ä‘Äƒng kĂ½ cáº§n phiĂªn Profile-1' });
            continue;
          }
          const limit = Math.max(5, Math.min(60, Number(req.limit) || 40));
          ensureClient(cookie).then(async (client) => {
            const t0 = Date.now();
            try {
              const feed = await client.getSubscriptionsFeed();
              const out = [];
              const seen = new Set();
              const push = (v) => {
                if (v && v.videoId && !seen.has(v.videoId)) { seen.add(v.videoId); out.push(v); }
              };
              // 1) LockupView (UI má»›i cá»§a YouTube) â€” parser Ä‘Ă£ tráº­n máº¡c tá»« playlist.
              try {
                const memo = feed.page?.contents_memo;
                const lockups = (memo && memo.get && memo.get('LockupView')) || [];
                for (const lv of lockups) {
                  const v = extractFromLockupView(lv);
                  if (!v) continue;
                  v.channelId = extractChannelIdLoose(lv.metadata) || extractChannelIdLoose(lv) || '';
                  push(v);
                }
              } catch (e) { dlog(`[subs] lockup parse: ${e && e.message ? e.message : e}`); }
              // 2) Video/GridVideo (UI cÅ©) â€” youtubei.js gom sáºµn trong feed.videos.
              try {
                for (const v of (feed.videos || [])) {
                  const n = normalizeVideo(v);
                  n.channelId = (v.author && v.author.id) || extractChannelIdLoose(v.author) || '';
                  n.upcoming = !!(v.is_upcoming || v.upcoming);
                  n.scheduleText = '';
                  push(n);
                }
              } catch (e) { dlog(`[subs] videos parse: ${e && e.message ? e.message : e}`); }
              if (out.length === 0) {
                dlog(`[subs] feed rá»—ng sau ${Date.now() - t0}ms â€” Profile-1 chÆ°a subscribe kĂªnh nĂ o, hoáº·c YouTube throttle/Ä‘á»•i cáº¥u trĂºc`);
              }
              writeResponse({
                id: req.id || 0, ok: true, cmd: 'getSubscriptionsFeed',
                videos: out.slice(0, limit), elapsedMs: Date.now() - t0,
              });
            } catch (e) {
              writeResponse({ id: req.id || 0, ok: false, cmd: 'getSubscriptionsFeed', error: (e && e.message) || String(e) });
            }
          }).catch(e => {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'getSubscriptionsFeed', error: (e && e.message) || String(e) });
          });
          continue;
        }

        // â”€â”€ Pass 146: SUBSCRIPTIONS FEED â€” bá» máº·t fan-out theo NGÆ¯á»œI XEM â”€â”€
        //
        // Má»i bá» máº·t Ä‘ang Ä‘ua (playlistItems/activities/Atom/trang kĂªnh/browse
        // kĂªnh) Ä‘á»u lĂ  index CĂ”NG KHAI cá»§a kĂªnh â€” log 05/09: cáº£ nÄƒm cĂ¹ng cĂ¢m
        // 54s cho má»™t video dĂ i. Feed Ä‘Äƒng kĂ½ (`FEsubscriptions`) lĂ  fan-out
        // vĂ o há»™p thÆ° cá»§a NGÆ¯á»œI XEM ngay lĂºc publish, Ä‘Æ°á»ng dá»¯ liá»‡u khĂ¡c háº³n
        // (Pass 46 tá»«ng dĂ¹ng vĂ  bá»‹ gá»¡ chung vá»›i Chrome watcher á»Ÿ Pass 58). Má»˜T
        // request phá»§ má»i kĂªnh Profile-1 Ä‘Ă£ subscribe, 0 quota Data API.
        // Äiá»u kiá»‡n váº­n hĂ nh: Profile-1 PHáº¢I subscribe cĂ¡c kĂªnh theo dĂµi.
        if (req.cmd === 'getSubscriptionsFeed') {
          const cookie = req.cookie || currentCookie;
          if (!cookie || !/SAPISID=/.test(cookie)) {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'getSubscriptionsFeed', error: 'no logged-in cookie (SAPISID) â€” feed Ä‘Äƒng kĂ½ cáº§n phiĂªn Profile-1' });
            continue;
          }
          const limit = Math.max(5, Math.min(60, Number(req.limit) || 40));
          ensureClient(cookie).then(async (client) => {
            const t0 = Date.now();
            try {
              const feed = await client.getSubscriptionsFeed();
              const out = [];
              const seen = new Set();
              const push = (v) => {
                if (v && v.videoId && !seen.has(v.videoId)) { seen.add(v.videoId); out.push(v); }
              };
              // 1) LockupView (UI má»›i cá»§a YouTube) â€” parser Ä‘Ă£ tráº­n máº¡c tá»« playlist.
              try {
                const memo = feed.page?.contents_memo;
                const lockups = (memo && memo.get && memo.get('LockupView')) || [];
                for (const lv of lockups) {
                  const v = extractFromLockupView(lv);
                  if (!v) continue;
                  v.channelId = extractChannelIdLoose(lv.metadata) || extractChannelIdLoose(lv) || '';
                  push(v);
                }
              } catch (e) { dlog(`[subs] lockup parse: ${e && e.message ? e.message : e}`); }
              // 2) Video/GridVideo (UI cÅ©) â€” youtubei.js gom sáºµn trong feed.videos.
              try {
                for (const v of (feed.videos || [])) {
                  const n = normalizeVideo(v);
                  n.channelId = (v.author && v.author.id) || extractChannelIdLoose(v.author) || '';
                  n.upcoming = !!(v.is_upcoming || v.upcoming);
                  n.scheduleText = '';
                  push(n);
                }
              } catch (e) { dlog(`[subs] videos parse: ${e && e.message ? e.message : e}`); }
              if (out.length === 0) {
                dlog(`[subs] feed rá»—ng sau ${Date.now() - t0}ms â€” Profile-1 chÆ°a subscribe kĂªnh nĂ o, hoáº·c YouTube throttle/Ä‘á»•i cáº¥u trĂºc`);
              }
              writeResponse({
                id: req.id || 0, ok: true, cmd: 'getSubscriptionsFeed',
                videos: out.slice(0, limit), elapsedMs: Date.now() - t0,
              });
            } catch (e) {
              writeResponse({ id: req.id || 0, ok: false, cmd: 'getSubscriptionsFeed', error: (e && e.message) || String(e) });
            }
          }).catch(e => {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'getSubscriptionsFeed', error: (e && e.message) || String(e) });
          });
          continue;
        }

        // Normal channel poll request
        const reqId = req.id;
        getLatestVideo(req.channelId, req.cookie, !!req.fastProbe, req.probeCookie || '').then(result => {
          writeResponse({ id: reqId, ...result });
        }).catch(e => {
          writeResponse({ id: reqId, ok: false, error: e.message });
        });
      } catch (e) {
        writeResponse({ id: null, ok: false, error: 'JSON parse error: ' + e.message });
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  // Keep process alive
  process.on('uncaughtException', (e) => {
    writeResponse({ daemon: true, status: 'error', error: 'uncaught: ' + e.message });
  });
}

// â”€â”€â”€ Entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const args = process.argv.slice(2);

if (args[0] === '--daemon') {
  // Persistent daemon mode: node innertube_helper.js --daemon [initialCookie]
  runDaemon(args[1] || '');
} else if (args[0] && args[0] !== '--daemon') {
  // File-based mode: node innertube_helper.js <requestFile>
  const reqPath = args[0];
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
  // stdin-based mode (fallback, legacy)
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
}

