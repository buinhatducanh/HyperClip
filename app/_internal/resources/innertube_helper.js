// innertube_helper.js — Spawned by Rust InnertubeClient for youtubei.js v17
// JSON-RPC: stdin requests -> stdout OR temp file responses
// v4 — Persistent daemon mode for fast polling + LockupView extraction + handle→UC ID resolution

const { Innertube, Log } = require('youtubei.js');
// Daemon stderr is drained into the Rust log since pass 15 — youtubei.js
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
  // recently used — a daemon only ever serves a handful of sessions at a time.
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
  // 1. EXACT — Innertube resolveURL on the @handle page itself: a handle URL
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
  // 2. EXACT — fetch the @handle page HTML, take the canonical /channel/UC id.
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
  // 3. LAST RESORT — search can return a DIFFERENT channel; prefer the result
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
        dlog(`[resolveChannelId] search fallback for "${id}" -> ${pick.id} (handle NOT verified — check the channel!)`);
      }
      resolvedChannelCache.set(cacheKey, pick.id);
      return pick.id;
    }
  } catch (_) {}
  return decodedId;
}

// ─── LockupView extraction ──────────────────────────────────

function isRelativeTimeText(text) {
  if (!text) return false;
  const clean = text.toLowerCase();
  const indicators = [
    'ago', 'trước', '前', '전', 'hour', 'min', 'day', 'week', 'month', 'year',
    'giây', 'phút', 'giờ', 'ngày', 'tuần', 'tháng', 'năm',
    '秒', '分', '時', '日', '週', '月', '年',
    '초', '분', '시', '일', '주', '달', '해',
    'seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years',
    'new', 'mới', 'vừa xong', 'just now', '新着', '新し', 'ライブ', '生放送', '配信中', '公開中',
    'プレミア', '視聴中', '새로운', '새 동영상', '방금', '최신', '실시간', '라이브', '최초 공개',
    'live', 'trực tiếp', 'đang phát', 'premiering', 'công chiếu', 'watching', 'đang xem'
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
  const parts = cleanText.split(/[\u2022\u00b7\u2023\u2043|•·-]/);
  let timePart = cleanText;
  
  // Look for the part that contains relative time indicators
  const indicators = ['ago', 'trước', '前', '전', 'hour', 'min', 'day', 'week', 'month', 'year', 'giây', 'phút', 'giờ', 'ngày', 'tuần', 'tháng', 'năm', '秒', '分', '時', '日', '週', '月', '年', '초', '분', '시', '일', '주', '달', '해'];
  for (const part of parts) {
    const trimmedPart = part.trim();
    if (indicators.some(ind => trimmedPart.includes(ind))) {
      timePart = trimmedPart;
      break;
    }
  }
  
  // Handle "New", "Mới", "Live", "Trực tiếp", "Đang phát trực tiếp", etc., if no numeric digit is present
  if (!/\d/.test(timePart)) {
    if (
      timePart.includes('new') || 
      timePart.includes('mới') || 
      timePart.includes('vừa xong') ||
      timePart.includes('just now') ||
      // Japanese
      timePart.includes('新着') ||
      timePart.includes('新し') ||
      timePart.includes('ライブ') ||
      timePart.includes('生放送') ||
      timePart.includes('配信中') ||
      timePart.includes('公開中') ||
      timePart.includes('プレミア') ||
      timePart.includes('視聴中') ||
      // Korean
      timePart.includes('새로운') ||
      timePart.includes('새 동영상') ||
      timePart.includes('방금') ||
      timePart.includes('최신') ||
      timePart.includes('실시간') ||
      timePart.includes('라이브') ||
      timePart.includes('최초 공개') ||
      timePart.includes('시청 중') ||
      // Existing defaults
      timePart === 'live' || 
      timePart.includes('trực tiếp') || 
      timePart.includes('đang phát') || 
      timePart.includes('premiering') || 
      timePart.includes('công chiếu') ||
      timePart.includes('watching') ||
      timePart.includes('đang xem')
    ) {
      return Date.now();
    }
  }
  
  const m = timePart.match(/(\d+)\s*(.+)/);
  if (m) {
    const val = parseInt(m[1], 10);
    const unit = m[2].trim();
    const now = Date.now();
    
    // Seconds — includes abbreviated "5s ago" format (YouTube sometimes uses it)
    if (
      unit.startsWith('second') || unit.startsWith('sec') || unit === 's ago' ||
      unit.startsWith('s ') || unit.includes('giây') || 
      unit.includes('秒') || unit.includes('초') || unit.includes('sekunde') || 
      unit.includes('segundo') || unit.includes('секунд')
    ) {
      return now - val * 1000;
    }
    // Minutes
    if (
      unit.startsWith('minute') || unit.startsWith('min') || unit.includes('phút') || 
      unit.includes('分') || unit.includes('분') || unit.includes('minute') || 
      unit.includes('minuto') || unit.includes('минут')
    ) {
      return now - val * 60 * 1000;
    }
    // Hours
    if (
      unit.startsWith('hour') || unit.startsWith('hr') || unit.includes('giờ') || 
      unit.includes('時間') || unit.includes('시간') || unit.includes('stunde') || 
      unit.includes('heure') || unit.includes('hora') || unit.includes('час')
    ) {
      return now - val * 3600 * 1000;
    }
    // Days
    if (
      unit.startsWith('day') || unit.includes('ngày') || unit.includes('日') || 
      unit.includes('일') || unit.includes('tag') || unit.includes('jour') || 
      unit.includes('día') || unit.includes('дне') || unit.includes('суток')
    ) {
      return now - val * 86400 * 1000;
    }
    // Weeks
    if (
      unit.startsWith('week') || unit.startsWith('wk') || unit.includes('tuần') || 
      unit.includes('週') || unit.includes('주') || unit.includes('woche') || 
      unit.includes('semaine') || unit.includes('semana') || unit.includes('недел')
    ) {
      return now - val * 604800 * 1000;
    }
    // Months
    if (
      unit.startsWith('month') || unit.startsWith('mo') || unit.includes('tháng') || 
      unit.includes('月') || unit.includes('개월') || unit.includes('달') || 
      unit.includes('monat') || unit.includes('mois') || unit.includes('mes') || 
      unit.includes('месяц')
    ) {
      return now - val * 2592000 * 1000;
    }
    // Years
    if (
      unit.startsWith('year') || unit.startsWith('yr') || unit.includes('năm') || 
      unit.includes('年') || unit.includes('년') || unit.includes('jahr') || 
      unit.includes('an') || unit.includes('año') || unit.includes('лет') || 
      unit.includes('год')
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
/// language — text-marker parsing missed Korean premiere forms and let them
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

/// Collect the raw metadata text of an upcoming lockup ("Công chiếu 18:35",
/// "Premieres 7/13, 6:35 PM") — shown as-is in the UI, no parsing needed.
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
    return parts.join(' · ').slice(0, 120);
  } catch (_) { return ''; }
}

// Pass 146 — rút UC id từ một khối metadata bất kỳ (LockupView của feed đăng
// ký). Cấu trúc lockup đổi theo mùa, còn browseId của kênh thì luôn nằm đâu đó
// trong onTap/endpoint — quét chuỗi là cách bền nhất, và ta chỉ cần đúng 1 id.
function extractChannelIdLoose(obj) {
  try {
    const s = JSON.stringify(obj || {});
    const m = s.match(/"browseId":"(UC[\w-]{22})"/) || s.match(/\/channel\/(UC[\w-]{22})/);
    return m ? m[1] : '';
  } catch (_) { return ''; }
}

// Pass 146 — rút UC id từ một khối metadata bất kỳ (LockupView của feed đăng
// ký). Cấu trúc lockup đổi theo mùa, còn browseId của kênh thì luôn nằm đâu đó
// trong onTap/endpoint — quét chuỗi là cách bền nhất, và ta chỉ cần đúng 1 id.
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
  // Fallback to parsing published text (e.g. "3 hours ago", "3 giờ trước")
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
      // youtubei.js ≥17.2 trả LockupView (renderer mới của YouTube) trong
      // playlist.items thay cho PlaylistVideo: v.id/v.title là undefined nên
      // map cũ lọc sạch 68 item xuống 0 và hỏng IM LẶNG — poller đọc thành
      // "throttled/empty" suốt, auto-detect chết hẳn (máy mới 2026-07-20,
      // package-lock bị gitignore nên npm kéo bản mới hơn máy cũ).
      // extractFromLockupView đã đọc đúng content_id/metadata.title.
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
      dlog(`[strategyPlaylistInnertube] ${playlistId}: ${playlist.items.length} item nhưng 0 cái rút được videoId — kiểu item lạ (${playlist.items[0]?.type || playlist.items[0]?.constructor?.name})`);
    }
    const memo = playlist.page?.contents_memo;
    if (memo) {
      const lockups = memo.get('LockupView') || [];
      return lockups.map(extractFromLockupView).filter(v => v !== null);
    }
    return [];
  } catch (e) {
    // Nuốt lỗi trắng ở đây từng che mất đúng bug trên: lỗi phải để lại vết.
    dlog(`[strategyPlaylistInnertube] ${playlistId} lỗi: ${e && e.message ? e.message : e}`);
    return [];
  }
}

// Fast surface probe — the uploads-playlist WEB PAGE lists brand-new videos
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
      // Upcoming premieres must not enter the instant resolver — they would be
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
// account the owner-view page also lists PRIVATE videos — which never appear
// in the API playlist, so the resolver mistook them for brand-new uploads and
// fired downloads that all died in yt-dlp with "Private video" (customer log
// 2026-07-13 18-57-03: 4 private videos → 4 failed workspaces at startup,
// each also holding the sequential download queue). Same risk applies to
// members-only content. Verify via the player endpoint before ingesting;
// rejected ids are cached and re-checked at most once per minute so a private
// video that later goes public is still picked up quickly.
const htmlFreshRejected = new Map(); // videoId -> { ts, count } lần bị từ chối
// 20s: a rejected candidate (private / still processing) is re-verified at most
// every 20s, so a video flipped public — or an upload that finishes processing —
// is picked up within one recheck window. Player call cost only applies to the
// handful of HTML-fresh candidates, so this stays negligible.
const HTML_FRESH_RECHECK_MS = 20000;
// Backoff lũy tiến cho video bị từ chối NHIỀU LẦN (private nằm lì trong
// owner-view): 20s → 40 → 80 → cap 120s. 7 video private "chết" bị verify
// mỗi cycle + retry 403 từng kéo getLatestVideo của kênh lên hàng chục giây
// và sập cadence poll toàn cục 2s → 98s (log khách 2026-07-17 16-19). Video
// flip public điển hình (private vài phút) vẫn dính recheck 20-80s; đường
// API/playlist bắt flip song song nên không mất video.
const HTML_FRESH_RECHECK_CAP_MS = 120000;
// Playable verdicts are cached too: owner-view pages keep listing videos the
// app already ingested (seen-dedup drops them Rust-side), which re-verified
// the SAME playable ids every probe cycle — one wasted /player call each
// (observed 2026-07-15 19-13-54: eSoEO12_tbA re-verified every ~30s forever).
// 10-minute TTL bounds the staleness if a video is flipped back to private.
const htmlFreshPlayable = new Map(); // videoId -> { ts, durationSec }
const HTML_FRESH_PLAYABLE_TTL_MS = 600000;

// stderr is drained into the Rust log (tracing "[InnertubeDaemon]") — stdout
// carries the JSON protocol, NEVER log there.
function dlog(msg) { try { process.stderr.write(msg + '\n'); } catch (_) {} }

// The gate must verify with an ANONYMOUS client, not the session client:
// yt-dlp's first download attempt runs without cookies, and the operator
// account often OWNS the probed channel — an authenticated check would call
// the owner's own private videos playable. Client context must be ANDROID:
// the default WEB /player response without visitor-data/po_token is
// "UNPLAYABLE Video unavailable" for EVERY video (verified 2026-07-13 with
// the bundled youtubei.js 17.0.1 — even a public control video), while
// ANDROID cleanly returns OK for public and LOGIN_REQUIRED for private.
let gateClientPromise = null;
function ensureGateClient() {
  if (!gateClientPromise) {
    gateClientPromise = Innertube.create({ retrieve_player: false });
    gateClientPromise.catch(() => { gateClientPromise = null; });
  }
  return gateClientPromise;
}

// Giờ đăng THẬT từ microformat của /player.
//
// Vì sao phải cẩn thận: đường HTML-fresh trước đây đóng dấu `publishedAt =
// Date.now()` để qua bộ lọc tuổi, nhưng con số đó chảy thẳng vào badge độ trễ
// (latency = detectedAt − publishedAt) và làm badge báo ~0s cho MỌI video bắt
// bằng đường này — đúng kiểu "làm đẹp số" mà INVARIANT #24 cấm.
//
// Microformat có lúc chỉ trả NGÀY (không có giờ). Lấy nguyên cái đó còn tệ hơn
// now(): badge sẽ nhảy lên hàng giờ. Nên chỉ nhận khi phân tích ra một mốc đầy
// đủ và nằm trong cửa sổ hợp lý; ngoài ra trả 0 để caller tự quyết.
function publishedAtMsFromPlayer(info) {
  const mf = (info && info.microformat) || {};
  const raw = mf.publish_date || mf.publishDate || mf.upload_date || mf.uploadDate ||
    (info && info.basic_info && info.basic_info.start_timestamp) || null;
  if (!raw) return 0;
  let ms = 0;
  if (raw instanceof Date) ms = raw.getTime();
  else {
    const s = String(raw);
    // "2026-08-12" (chỉ ngày) parse ra nửa đêm UTC — không dùng được.
    if (!/\d{2}:\d{2}/.test(s)) return 0;
    ms = Date.parse(s);
  }
  if (!ms || isNaN(ms)) return 0;
  const now = Date.now();
  // Quá 7 ngày trước hoặc ở tương lai = không phải thứ ta đang tìm.
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

// ─── Native progressive download (hot-path replacement for yt-dlp) ─────────
// yt-dlp pays ~2.5-3s of process spawn + extractor + player fetch on EVERY
// download; this warm daemon already holds an authenticated session and the
// player, so bytes start flowing almost immediately (docs/DETECTION_LATENCY
// section 5: "native download qua Innertube daemon" — the remaining e2e item).
// Progressive MP4 only (itag 18 first): one file, no merge step, moov at the
// front so a byte-capped capture stays readable for the Rust-side ffmpeg trim.
// Any throw here is non-fatal: the Rust caller falls back to yt-dlp.

// Pick the progressive (video+audio single-file) MP4 at or under maxHeight.
//
// Bản trước trả itag 18 VÔ ĐIỀU KIỆN trước khi xét maxHeight. YouTube gần như
// luôn có itag 18, nên nhánh đó luôn trúng và MỌI video đều tải 360p bất kể
// `autoDownloadQuality` đặt bao nhiêu — cài đặt chất lượng thực tế không có
// tác dụng (log khách 11/08: 8/8 lượt tải đều `itag=18`, rồi bị render phóng
// ngược lên 720p nên hình nhòe).
//
// Giữ ưu tiên itag 18 khi khách THẬT SỰ muốn ≤360p (một file, không phải ghép,
// moov nằm đầu — đúng lý do đường native chọn progressive), còn lại lấy bản
// progressive cao nhất vừa trần: thường là itag 22 (720p).
function pickProgressiveFormat(info, maxHeight) {
  const formats = (info.streaming_data && info.streaming_data.formats) || [];
  const isMp4 = (f) => (f.mime_type || '').includes('mp4');
  const candidates = formats
    .filter(f => f.has_video && f.has_audio && isMp4(f) && (f.height || 0) <= maxHeight)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (candidates.length) return candidates[0];
  // Không bản nào vừa trần (kênh chỉ có định dạng cao hơn) → itag 18 làm phao
  // cuối: thà 360p còn hơn rơi xuống yt-dlp và mất vài giây spawn.
  return formats.find(f => f.itag === 18) || null;
}

// Replicate yt-dlp --download-sections cheaply: cap the byte range at
// limit/duration of the file +15% container slack; the Rust-side ffmpeg trim
// cuts the exact duration afterwards. itag 18 often omits content_length
// (verified 2026-07-15: ANDROID response clen=0), so fall back to a
// bitrate×duration estimate.
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

// UA per innertube client context: googlevideo can enforce coherence between
// the client that issued the URL and the UA that fetches it.
const CLIENT_UA = {
  IOS: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
  ANDROID: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  WEB: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// Direct media fetch: plain https GET on the deciphered googlevideo URL with
// minimal headers — exactly what yt-dlp does and what googlevideo accepts most
// reliably (info.download() kept 403-ing where yt-dlp succeeded, observed
// 2026-07-15 20-40-35). `localAddress` binds the physical NIC so the transfer
// skips a VPN tunnel — parity with yt-dlp's --source-address (docs: "Direct IP
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
        // A misconfigured/absent NIC must not kill the native path — retry
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
// `agent` (Pass 90, fetch v2): https.Agent keep-alive dùng chung cho cả lượt —
// chunk thứ hai trên cùng socket đi tiếp cwnd đã lớn thay vì slow-start lại.
function httpGetRange(url, start, end, ua, bindIp, agent, timeoutMs, lookup) {
  const https = require('https');
  const sockTimeout = timeoutMs || 30000;
  return new Promise((resolve, reject) => {
    let redirects = 0;
    const attempt = (u, ip) => {
      const opts = { headers: { 'User-Agent': ua, 'Accept': '*/*', 'Range': `bytes=${start}-${end}` } };
      if (ip) opts.localAddress = ip;
      if (agent) opts.agent = agent;
      // v2: DNS đã giải một lần cho cả lượt — 16 lookup song song trên
      // threadpool 4 luồng của libuv xếp hàng sau nhau (đo 18/08: hdr_ms
      // p50 ≈ 1 s cho CẢ 16 slice trên máy dev), và mỗi video một host mới.
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
          // Pass 90b: kèm ngữ cảnh để phân xử 400 từ log (redirect sang host
          // khác là nghi phạm chính của ca "URL resolve sớm lỗi").
          err.hcRedirects = redirects;
          err.hcHost = hostOf(u);
          return reject(err);
        }
        // Telemetry (Pass 90): socket tái dùng hay bắt tay mới — đọc ở
        // fetch v2 để biết keep-alive có ăn hay không.
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

// `onChunk(n)` (Pass 90): đếm byte về theo thời gian thật cho tiến độ +
// stall detector; `stopAt` (v2): dừng sớm khi một kết nối khác đã phủ phần
// còn lại (tail-hedge) — trả về số byte đã ghi.
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

// ─── Pass 90: tiến độ + hủy + đo theo slice ────────────────────────────
// Rust chỉ nhận MỘT dòng trả lời cuối cho `downloadVideo` (innertube_client.rs)
// nên hedge phải đoán mù theo đồng hồ và kẻ thua không hủy được — log khách
// 15/08 06:59: native thua đua vẫn tải 8 s nữa, video kế tiếp rơi yt-dlp vì
// "daemon busy". Đăng ký ở đây để (a) bắn `progress` định kỳ trên cùng stdout,
// (b) nhận `abortDownload` và destroy socket ngay.
const activeDownloads = new Map(); // key: String(reqId) và videoId -> ctx

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
    // Tiến độ ≤ 1 dòng / 400 ms — đủ mịn cho hedge theo stall (1,5 s) mà không
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

// Thống kê nhanh cho dòng telemetry: p50/p95 của một mảng số.
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
function hostOf(url) { try { return new URL(url).host; } catch (_) { return '?'; } }

// Pass 101: host DỰ PHÒNG của googlevideo suy từ chính URL — tham số `mn` chứa
// HAI tên mirror (ngăn bằng phẩy), `fvip` là số đầu subdomain dạng
// r{fvip}---{mn}. Đây là cơ chế failover chuẩn của web player/yt-dlp. Không
// suy được → null (không đua). Dùng cho cuộc đua byte-đầu: mỗi chunk bắn song
// song lên cả hai host, header nào về trước thắng — TTFB hiệu dụng =
// min(hai host), bên thua bị huỷ ngay sau khi phân thắng bại (phí vài KB).
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
// so a single socket can never hit the <3s e2e budget — same reason yt-dlp
// runs 16 concurrent fragments. Slice 0 doubles as size discovery: its
// Content-Range total clamps the caller's bitrate-ESTIMATED cap, so tail
// slices can't overshoot the real file into 416s. All slices write through
// one shared fd at their own offsets.
// Pass 49: 6 → 16. Log khách 25/07 11:51 cho thấy CÙNG máy, cùng code, cùng
// itag: lần tải trước 13.7MB/1.5s (14.0 MB/s), lần sau 9.9MB/9.0s (1.2 MB/s)
// với 6 kết nối → ~200 KB/s MỖI kết nối. Đó là dấu hiệu googlevideo throttle
// THEO TỪNG KẾT NỐI (không phải nghẽn uplink khách: hướng tải xuống, và lần
// nhanh chứng minh đường truyền khỏe). Cách đối kháng duy nhất là chia nhiều
// kết nối hơn — đúng lý do yt-dlp chạy 16 concurrent fragments (dự án này vốn
// đã dùng 16-32 cho đường yt-dlp). Rust có thể override qua `conns`.
const PARALLEL_CONNECTIONS_DEFAULT = 16;
const PARALLEL_CONNECTIONS_MAX = 24;
let PARALLEL_CONNECTIONS = PARALLEL_CONNECTIONS_DEFAULT;

// IP không bind được (settings `sourceAddress`/auto-detect trỏ vào NIC đã đổi
// DHCP hoặc không tồn tại): log MỘT lần rồi thôi bind cho cả tiến trình. Trước
// đây MỖI kết nối đều thử-fail-retry → 16 lần round-trip vô ích + 16 dòng log
// mỗi download (log khách 25/07 có đúng 6 dòng/lần tải với 6 kết nối).
const bindFailed = new Set();
function noteBindFailure(ip, e) {
  if (!bindFailed.has(ip)) {
    bindFailed.add(ip);
    dlog(`[native-dl] bind ${ip} failed (${(e && e.message) || e}) — dùng default route cho MỌI kết nối sau (kiểm tra settings bypassVpn/sourceAddress)`);
  }
}
function bindAllowed(ip) {
  return !!ip && !bindFailed.has(ip);
}
const MIN_SLICE_BYTES = 512 * 1024;

// Dòng telemetry theo slice (Pass 90) — chung cho v1 và v2. `slices` là mảng
// {hdrMs, bytes, xferMs, reused}. Đọc log: `tail` = ms slice chậm nhất /
// median — ~1 là nghẽn chung (mọi kết nối cùng chậm), >3 là một slice kéo
// cả lượt (straggler); `hdr` p50 ≈ RTT×3 (TCP+TLS+TTFB) cho biết edge xa/gần.
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

// ctx (Pass 90): newDownloadCtx() — tiến độ/hủy/telemetry. Có thể null (test).
// agent (A1): PreconnAgent có socket mở sẵn; null = agent mặc định.
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
    // Server ignored the Range header — it's streaming the whole file, so
    // just take it (equivalent to the old rangeless full fetch).
    if (first.statusCode === 200) {
      return await streamToFd(first, fd, 0, onChunk);
    }
    const totalMatch = /\/(\d+)\s*$/.exec(first.headers['content-range'] || '');
    const total = totalMatch ? Number(totalMatch[1]) : 0;
    if (!total && estEnd === null) {
      // No size from either side — can't plan slices. Rare enough to just
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

    // Tải [s..e] chia đều cho tối đa n kết nối, ghi qua fd chung tại offset.
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
    // Ngưỡng greppable: dưới 2 MB/s với nhiều kết nối. Pass 90: KHÔNG kết
    // luận "throttle" nữa — log khách 15/08 cho thấy cùng 1,2 MB/s với 6 lẫn
    // 16 kết nối, tức trần TỔNG (nghẽn cục bộ/shaping IP), đọc `tail=` ở dòng
    // slices và dòng [NetGov] của Rust để phân xử.
    if (mbps < 2 && secs > 2) {
      dlog(`[native-dl] CHẬM: ${mbps.toFixed(1)} MB/s trên ${conns} kết nối (~${(mbps * 1024 / conns).toFixed(0)} KB/s mỗi kết nối) — xem dòng slices tail= và [NetGov] để phân xử nghẽn chung/straggler`);
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

// ─── Pass 90: FETCH v2 — hàng chunk + worker keep-alive + tail-hedge + stall ──
//
// Vì sao (docs/DOWNLOAD_BANDWIDTH_ANALYSIS.md mục 3): v1 (a) chờ slice 0 có
// header rồi mới bắn 15 slice còn lại (+2–3 RTT), (b) Promise.all chờ slice
// chậm nhất, không chia lại, (c) một slice kẹt = cả lượt hỏng, (d) mỗi slice
// một TCP+TLS mới ~750 KB → cả đời kết nối nằm trong slow-start (12 MB/s ở RTT
// ~90 ms là giới hạn RTT, không phải băng thông).
//
// v2: chia file thành N chunk (1 chunk/worker), N worker bắn CÙNG LÚC — không
// đợi slice 0; DNS giải MỘT lần cho cả lượt. Kích thước biết được từ
// Content-Range của chunk về ĐẦU TIÊN. Hết hàng: worker rảnh "hedge" phần
// còn lại của chunk đang chậm nhất; ai chạm đích trước thắng, kẻ kia dừng
// (STOP flag) — hai bên ghi cùng byte cùng offset nên chồng lên nhau vô hại.
// Không byte trong STALL_MS → destroy socket đó, xếp lại phần còn lại (tối
// đa 3 lần/chunk). Socket timeout 8 s thay 30 s.
// KHÔNG có lợi ích keep-alive: googlevideo trả `Connection: close` cho mọi
// request Range HTTP/1.1 (đo 18/08, xem chú thích chunkBytes) — agent giữ lại
// chỉ để trần maxSockets = N.
// Bật bằng setting `nativeFetchV2` (Rust truyền `fetchV2`), mặc định TẮT để
// A/B trên máy khách.
const V2_CHUNK_BYTES = 768 * 1024;
const V2_STALL_MS = 2500;
const V2_MAX_RETRY_PER_CHUNK = 3;

async function fetchUrlToFileParallelV2(url, range, outputPath, localAddress, ua, ctx, opts) {
  const fs = require('fs');
  const https = require('https');
  const N = PARALLEL_CONNECTIONS;
  // maxSockets = N ĐÚNG BẰNG số worker: Node nhả socket về pool ở nextTick
  // sau khi response kết thúc, còn worker xin chunk kế ngay trong microtask
  // → nếu cho phép mở thêm, agent sẽ MỞ SOCKET MỚI thay vì đợi (đo 18/08:
  // reused=0/31). Với trần = N, request kế bị xếp hàng vài µs rồi lên đúng
  // socket vừa rảnh.
  // A1: agent có socket mở sẵn (PreconnAgent) nếu caller đưa vào.
  const agent = (opts && opts.agent) || new https.Agent({ keepAlive: true, maxSockets: N, maxFreeSockets: N, timeout: 20000, scheduling: 'lifo' });
  const tStart = Date.now();
  // Giải DNS MỘT lần rồi phát cho mọi socket (xem chú thích ở httpGetRange).
  let lookup = null;
  try {
    const host = hostOf(url);
    const dns = require('dns');
    const r = await dns.promises.lookup(host);
    if (r && r.address) {
      const addr = r.address, fam = r.family || 4;
      // Node ≥20 (autoSelectFamily) gọi lookup với {all:true} và chờ MẢNG;
      // bản cũ chờ (addr, family). Trả đúng theo cờ.
      lookup = (h, o, cb) => (o && o.all) ? cb(null, [{ address: addr, family: fam }]) : cb(null, addr, fam);
    }
  } catch (_) { lookup = null; }
  const dnsMs = Date.now() - tStart;
  const fd = await fs.promises.open(outputPath, 'w');
  const slices = [];
  let total = 0;                       // kích thước thật (từ Content-Range)
  let endWanted = range ? range.end : null; // byte cuối cần lấy (inclusive), null = hết file
  // Cỡ chunk: MỘT chunk / worker (như v1). Đo 18/08 trên máy dev: googlevideo
  // trả `Connection: close` cho MỌI request Range HTTP/1.1 → keep-alive không
  // bao giờ tái dùng được socket (reused=0/31), nên chia nhỏ hơn N chỉ là thêm
  // một đợt bắt tay TCP+TLS nữa (31 chunk: 620 ms vs 16 chunk: ~400 ms).
  // Sàn 512 KB. Rust override qua `chunkKb` (setting nativeFetchChunkKb) để A/B.
  const chunkBytes = (opts && opts.chunkKb > 0)
    ? Math.max(128 * 1024, opts.chunkKb * 1024)
    : (endWanted !== null
        ? Math.max(MIN_SLICE_BYTES, Math.ceil((endWanted + 1) / N))
        : V2_CHUNK_BYTES);
  // Pass 101: đua byte-đầu 2 host (kill switch `nativeFetchHostRace` phía
  // Rust). Chỉ khi suy được host dự phòng và file ≤32MB (Shorts/360p — vùng
  // mà vài KB lãng phí của bên thua không đáng kể). Alt đi lại đúng đường
  // hedge 'won/lost' sẵn có; alt LỖI không được tính vào sổ retry của chunk
  // (host phụ 403 thì đường chính chạy y như không có cuộc đua).
  const fallbackUrl = (opts && opts.hostRace) ? deriveFallbackUrl(url) : null;
  const raceOn = !!fallbackUrl && (endWanted === null || endWanted < 32 * 1024 * 1024);
  let altStarts = 0, altWins = 0;
  // Hàng chunk: {start,end,retries,done,inflight:Set<worker>,received}
  const chunks = [];
  const planUpTo = (e) => {
    // Lập lịch chunk cho [lastEnd+1 .. e]
    let s = chunks.length ? chunks[chunks.length - 1].end + 1 : 0;
    while (s <= e) {
      const ee = Math.min(e, s + chunkBytes - 1);
      chunks.push({ start: s, end: ee, retries: 0, done: false, inflight: new Set(), received: 0, hedged: false, altTaken: false });
      s = ee + 1;
    }
  };
  // Chưa biết cỡ (range=null): chỉ bắn 4 chunk mù — Content-Range của chunk
  // về đầu tiên (≈1 RTT) cho total rồi lập nốt; bắn cả N chunk mù là 12+
  // request 416 vô ích cho video ngắn (đo 18/08: 15/17 chunk 416).
  if (endWanted !== null) planUpTo(endWanted);
  else planUpTo(chunkBytes * Math.min(N, 4) - 1);
  let planned = chunks.length ? chunks[chunks.length - 1].end : -1;
  let nextIdx = 0;
  let written = 0;                    // byte duy nhất đã ghi (theo chunk xong)
  let stalls = 0, hedges = 0, retriesTotal = 0;
  let connHdr = ''; // header Connection + phiên bản HTTP của response đầu — biết server có cho keep-alive không
  let fatal = null;
  const active = new Set();
  const workers = [];
  const onBytes = (n) => { if (ctx) { ctx.bytes += n; ctx.progress(false); } };

  const clampToTotal = () => {
    if (!total) return;
    const lastByte = endWanted !== null ? Math.min(endWanted, total - 1) : total - 1;
    endWanted = lastByte;
    if (ctx) ctx.total = lastByte + 1;
    // Cắt các chunk vượt EOF; chunk đang bay vượt EOF sẽ nhận 416 → coi là xong.
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
    // Pass 101: hết chunk mới → phát bản ALT (host dự phòng) cho chunk còn
    // đang chờ byte đầu trên host chính — mỗi chunk đúng một lần, chỉ khi
    // host chính CHƯA nhả byte nào (đã có byte = TTFB xong, đua vô nghĩa) VÀ
    // đã chờ ≥100ms (host ấm trả header ~100ms — khỏi tốn request đua; host
    // lạnh 500-700ms thì 100ms chờ không sứt mẻ phần thắng).
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
  // Tail-hedge: chunk chưa xong, đang bay ĐÚNG MỘT kết nối, còn ≥64 KB, và đã
  // chạy lâu hơn 1,5× median chunk hoặc tốc độ < ¼ median.
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
    // Vị trí bắt đầu: hedge/alt lấy từ chỗ kết nối chính ĐÃ nhận (snapshot),
    // ghi cùng offset nên không cần đồng bộ (hai nguồn cùng nội dung — ghi
    // trùng vị trí là vô hại).
    const from = (isHedge || isAlt) ? c.start + c.received : c.start;
    // Pass 101: alt đi host dự phòng và KHÔNG dùng DNS cache của host chính
    // (lookup trả IP của host chính cho MỌI hostname — đưa cho alt là trỏ
    // nhầm mirror về IP cũ, cuộc đua thành giả).
    const reqUrl = isAlt ? fallbackUrl : url;
    const reqLookup = isAlt ? null : lookup;
    const tr = Date.now();
    worker.t0 = tr;
    c.inflight.add(worker);
    const stop = { aborted: false };
    worker.stop = stop;
    // Socket timeout 8 s (thay 30 s): chunk 768 KB không có lý do im 8 s;
    // pha truyền đã có stall detector 2,5 s, đây là lưới cho pha connect/TTFB.
    httpGetRange(reqUrl, from, c.end, ua, localAddress, agent, 8000, reqLookup).then(async (res) => {
      const rec = { hdrMs: Date.now() - tr, bytes: 0, xferMs: 0, reused: !!res.hcReusedSocket, t1: Date.now() };
      slices.push(rec);
      if (!connHdr) connHdr = String(res.headers['connection'] || res.headers['Connection'] || '-') + '/' + res.httpVersion;
      active.add(res);
      res.once('close', () => active.delete(res));
      if (ctx) { ctx.track(res); if (ctx.aborted) { res.destroy(); return resolve('aborted'); } }
      if (res.statusCode === 200) {
        // Server bỏ qua Range → không chia chunk được; nhả về caller để đi
        // đường 1 kết nối (downloadVideoNative đã có retry single-conn full).
        res.destroy();
        return resolve('range-ignored');
      }
      if (!total) {
        const m = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
        if (m) { total = Number(m[1]); clampToTotal(); }
      }
      // Stall detector: không byte trong V2_STALL_MS → hủy socket này.
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
      // Ngắn hơn yêu cầu mà không lỗi: server cắt sớm (EOF thật) — nếu total
      // đã biết và covered >= total-1 thì là xong.
      if (total && covered >= total - 1) return resolve('done');
      return resolve('short');
    }).catch((e) => {
      if (ctx && ctx.aborted) return resolve('aborted');
      if (e && e.httpStatus === 416) {
        // Ước lượng vượt EOF (chưa biết total) hoặc chunk hoàn toàn ngoài file.
        // Hedge/alt xuất phát từ chỗ kết nối chính đã nhận: 416 ở đây nghĩa là
        // kết nối chính đã chạm EOF → coi như thua, không đụng `total`.
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
          // Hết hàng nhưng còn chunk đang bay ở worker khác: đứng chờ 50 ms
          // rồi xét lại (chunk đó có thể thành ứng viên hedge, hoặc lỗi và
          // được xếp lại). Trần 30 s để không treo vô hạn.
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
          // Kẻ còn lại trên chunk này dừng ngay.
          for (const other of c.inflight) { if (other.stop) { other.stop.reason = 'won'; other.stop.aborted = true; } }
          chunkStats.push(Date.now() - w.t0);
        }
        continue;
      }
      if (isAlt) {
        // Pass 101: alt thua/lỗi/stall — KHÔNG đụng sổ retry của chunk.
        if (r === 'aborted') return;
        // NHƯNG nếu host chính đã rớt TRONG LÚC alt bay (nhánh retry của nó
        // thấy inflight≠0 nên bỏ qua requeue) và giờ alt cũng rớt → chunk
        // mồ côi, không ai xếp lại → treo tới trần idle rồi 'chunks left
        // undone' (bắt được ở A/B thật 24/08, video jNQXAC9IVRw kẹt 43s).
        // Xếp lại phần còn thiếu tại đây, vẫn không tính vào sổ retry.
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
        // 416: chunk nằm ngoài file → xong với 0 byte; EOF thật ≤ c.start.
        total = total ? Math.min(total, c.start) : c.start;
        clampToTotal();
        c.done = true;
        continue;
      }
      if (r === 'range-ignored') { fatal = new Error('range ignored on chunk'); return; }
      // stall / short / error → xếp lại phần còn lại
      c.retries++;
      retriesTotal++;
      if (r === 'stall') stalls++;
      if (c.retries > V2_MAX_RETRY_PER_CHUNK) { fatal = new Error(`chunk ${c.start}-${c.end} failed ${c.retries}x (${r})`); return; }
      if (c.inflight.size === 0) {
        // Đẩy lại chính chunk này lên đầu hàng: tạo chunk mới cho phần còn lại.
        const from = c.start + c.received;
        if (from <= c.end) {
          const nc = { start: from, end: c.end, retries: c.retries, done: false, inflight: new Set(), received: 0, hedged: false, altTaken: false };
          // Chunk cũ coi như xong phần đã nhận.
          if (!c.done) { c.done = true; written += c.received; }
          chunks.splice(nextIdx, 0, nc);
        } else if (!c.done) { c.done = true; written += c.received; }
      }
    }
  };

  try {
    if (ctx && ctx.aborted) throw new AbortedError();
    for (let i = 0; i < N; i++) { const w = { id: i, t0: 0, stop: null, finished: false }; workers.push(w); }
    // Chưa biết total (range=null và server chưa trả Content-Range) mà hàng
    // sắp cạn, chưa gặp 416 → lập thêm N chunk. Dừng khi worker về hết.
    let workersDone = false;
    const supervisor = (async () => {
      while (!workersDone && !fatal && !(ctx && ctx.aborted)) {
        await new Promise(r => setTimeout(r, 100));
        // Sau 400 ms mà server vẫn chưa nói total (edge chậm) thì bắn thêm
        // để không đứng chờ; edge thường trả Content-Range trong 1 RTT.
        if (!total && endWanted === null && nextIdx >= chunks.length - 1 && Date.now() - tStart > 400) {
          planUpTo(planned + chunkBytes * N); planned = chunks[chunks.length - 1].end;
        }
      }
    })();
    await Promise.all(workers.map(async (w) => { await workerLoop(w); w.finished = true; }));
    workersDone = true; // supervisor tự thoát ở nhịp kế — KHÔNG await (100 ms vô ích ở đuôi)
    void supervisor;
    if (ctx && ctx.aborted) throw new AbortedError();
    if (fatal) throw fatal;
    if (chunks.some(c => !c.done)) throw new Error('v2: chunks left undone');
    const secs = (Date.now() - tStart) / 1000;
    const mbps = written / 1048576 / Math.max(secs, 0.001);
    dlog(`[native-dl] parallel fetch ${N} conns, ${written} bytes, ${mbps.toFixed(1)} MB/s (v2)`);
    logSliceTelemetry('v2', url, slices, `total_ms=${Date.now() - tStart} dns_ms=${dnsMs} chunks=${chunks.length} hedges=${hedges} stalls=${stalls} retries=${retriesTotal} conn=${connHdr}${raceOn ? ` hrace=${altStarts}/${altWins}` : ''}`);
    if (mbps < 2 && secs > 2) {
      dlog(`[native-dl] CHẬM: ${mbps.toFixed(1)} MB/s trên ${N} kết nối (v2) — xem dòng slices tail= và [NetGov] để phân xử nghẽn chung/straggler`);
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

// ─── Pass 90 (A1): RESOLVE SỚM + MỞ SẴN KẾT NỐI ─────────────────────────────
//
// Phí trước byte đầu (~0,4 s = /player + decipher + bắt tay slice 0) chiếm ⅓
// cả lượt tải nhanh (docs/DOWNLOAD_BANDWIDTH_ANALYSIS.md mục 1.2). Rust gọi
// `resolveMedia` NGAY lúc phát hiện (trước khi lấy permit tải): daemon chạy
// đúng chain ANDROID→IOS→WEB tới bước decipher, cache URL+range 5 phút, và mở
// sẵn N kết nối TLS tới host media. Lúc `downloadVideo` tới, chỉ còn bắn
// Range trên socket đã bắt tay. googlevideo đóng kết nối sau mỗi request
// (`Connection: close`) nhưng KHÔNG cấm mở trước — pool sống 25 s, đủ cho
// khoảng detect→permit của video nóng.
const RESOLVE_TTL_MS = 5 * 60 * 1000;
const PRECONN_TTL_MS = 25 * 1000;
const resolvedMedia = new Map(); // videoId -> {at, maxHeight, limitSec, directUrl, range, ua, format:{itag,width,height}, durationSec, title, clientName, host}
const preconnPools = new Map();  // videoId -> {host, at, sockets:[]}
const resolveInflight = new Map(); // videoId -> Promise — downloadVideo tới sớm hơn resolve xong thì đợi nó thay vì gọi /player lần hai

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
  // Dọn pool quá hạn dù không ai lấy (video bị lọc/không tải).
  setTimeout(() => { const p = preconnPools.get(videoId); if (p === pool) dropPreconn(videoId); }, PRECONN_TTL_MS + 5000).unref();
  return pool;
}
// Agent lấy socket đã mở sẵn trước, hết thì mở mới như thường. Chỉ nhả socket
// đúng host (URL cache có thể khác host với URL mới nếu chain resolve lại).
function makePreconnAgent(videoId, host, n) {
  const https = require('https');
  const pool = preconnPools.get(videoId);
  const usable = pool && pool.host === host && Date.now() - pool.at < PRECONN_TTL_MS ? pool : null;
  if (usable) preconnPools.delete(videoId); // agent sở hữu từ đây
  class PreconnAgent extends https.Agent {
    constructor(o) { super(o); this.hcHits = 0; this.hcMiss = 0; }
    createConnection(options, cb) {
      // Pass 90b (sửa lỗi log khách 20-21/08): CHỈ phát socket mở sẵn cho
      // request tới ĐÚNG host của pool. googlevideo thỉnh thoảng 302 sang
      // host mirror khác — bản đầu phát socket host CŨ cho request host MỚI
      // (Host header lệch server thật) → googlevideo trả HTTP 400, cả lượt
      // rơi lại chain đầy đủ, mất sạch lợi ích resolve sớm ("URL resolve sớm
      // lỗi (media fetch HTTP 400)" xen kẽ với các lượt preconn_hit=16/16).
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
function takeResolved(videoId, maxHeight, limitSec) {
  const r = resolvedMedia.get(videoId);
  if (!r) return null;
  resolvedMedia.delete(videoId);
  if (Date.now() - r.at > RESOLVE_TTL_MS) return null;
  if (r.maxHeight !== maxHeight || r.limitSec !== limitSec) return null;
  return r;
}

// Chain /player → format → range → decipher (đúng luật của downloadVideoNative,
// KHÔNG fetch). Trả bản ghi cache hoặc throw. Dùng cho resolveMedia.
async function resolveMediaNative(req) {
  const videoId = req.videoId;
  const maxHeight = req.maxHeight || 360;
  const limitSec = req.limitSec || 0;
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
    if (info.basic_info?.is_live || info.basic_info?.is_upcoming) throw new Error('live/upcoming — native path only handles finished VODs');
    const durationSec = info.basic_info?.duration || 0;
    const format = pickProgressiveFormat(info, maxHeight);
    if (!format) { failures.push(`${clientName}: no progressive format`); continue; }
    const gotHeight = format.height || 0;
    if (gotHeight < maxHeight) {
      const adaptiveMax = ((info.streaming_data && info.streaming_data.adaptive_formats) || [])
        .filter(f => f.has_video).reduce((m, f) => Math.max(m, f.height || 0), 0);
      if (adaptiveMax >= maxHeight) throw new Error(`progressive only ${gotHeight}p, need ${maxHeight}p — yt-dlp can merge adaptive`);
    }
    const range = computeByteRange(format, durationSec, limitSec);
    let directUrl = null;
    try {
      directUrl = await format.decipher(sessClient.session.player);
      if (typeof directUrl !== 'string' || !directUrl.startsWith('http')) directUrl = null;
    } catch (_) { directUrl = null; }
    if (!directUrl) { failures.push(`${clientName}: decipher failed`); continue; }
    return {
      at: Date.now(), maxHeight, limitSec, directUrl, range,
      ua: CLIENT_UA[clientName] || CLIENT_UA.WEB,
      format: { itag: format.itag, width: format.width || 0, height: format.height || 0 },
      durationSec, title: info.basic_info?.title || '', clientName, host: hostOf(directUrl),
    };
  }
  throw new Error(failures.join(' | ') || 'resolve failed');
}

async function downloadVideoNative(req, ctx) {
  const videoId = req.videoId;
  const outputPath = req.outputPath;
  const maxHeight = req.maxHeight || 360;
  const limitSec = req.limitSec || 0;
  const t0 = Date.now();
  // Pass 90: fetch v2 (hàng chunk + keep-alive + tail-hedge) theo cờ Rust
  // truyền (setting `nativeFetchV2`), mặc định v1 để A/B.
  const useV2 = !!req.fetchV2;
  const abortedCheck = () => { if (ctx && ctx.aborted) throw new AbortedError(); };

  // ANDROID first: it is the only client still exposing progressive itag 18
  // (verified 2026-07-15: IOS answered "no progressive mp4 format" for every
  // probe while burning 2.9-7.5s of getInfo). IOS stays as cheap insurance —
  // it costs nothing while ANDROID succeeds. WEB goes last: without po_token
  // it is usually UNPLAYABLE, but an authenticated session can still serve
  // it. A second pass after 1.5s covers provisioning delay on ultra-fresh
  // uploads; anything left falls back to yt-dlp Rust-side.
  //
  // Mobile clients must go through the ANONYMOUS gate client via
  // getBasicInfo (ONE /player call — getInfo adds a wasted /next): since
  // ~2026-07-15 12:00Z YouTube hard-rejects (HTTP 400) /player calls that
  // carry cookies/SAPISIDHASH with an IOS/ANDROID context (log 21-07-43:
  // cookie+IOS/ANDROID 400'd while the anonymous probe-gate ANDROID kept
  // answering a minute later) — the same reason yt-dlp marks ios/android
  // "SUPPORTS_COOKIES: False" and strips auth for them. The cookie session
  // is only created if the chain actually reaches WEB. Anonymous means
  // operator-private videos die here, but the probe-gate already keeps
  // those out of the pipeline.
  const chain = ['ANDROID', 'IOS', null]; // null = cookie session (WEB)
  const anonClient = await ensureGateClient();
  const sourceIp = req.sourceIp || null; // bypass VPN: bind the physical NIC
  // Số kết nối song song: Rust truyền theo cấu hình phần cứng (dùng chung với
  // concurrent_fragments của yt-dlp) — nhiều kết nối là cách đối kháng
  // googlevideo throttle per-connection (xem chú thích PARALLEL_CONNECTIONS).
  if (req.conns) {
    PARALLEL_CONNECTIONS = Math.max(1, Math.min(PARALLEL_CONNECTIONS_MAX, Number(req.conns) || PARALLEL_CONNECTIONS_DEFAULT));
  }
  if (req.limitSec && req.limitSec > 0 && req.limitSec <= 65) {
    PARALLEL_CONNECTIONS = Math.min(PARALLEL_CONNECTIONS, 8);
  }
  // Pass 90 (A1): URL đã resolve sớm + socket mở sẵn → bỏ qua /player+decipher.
  // Lỗi bất kỳ (403 vì URL/IP lệch, 416, socket chết…) → chạy lại chain đầy đủ
  // như chưa có gì — không tệ hơn đường cũ.
  let cached = null;
  if (req.useResolved !== false) {
    // Resolve sớm đang chạy dở (download tới nhanh hơn /player) → đợi nó
    // (tối đa 3 s) thay vì gọi /player lần hai.
    const inflight = resolveInflight.get(videoId);
    if (inflight) {
      await Promise.race([inflight.catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
      abortedCheck();
    }
    cached = takeResolved(videoId, maxHeight, limitSec);
  }
  if (cached) {
    const agent = makePreconnAgent(videoId, cached.host, PARALLEL_CONNECTIONS);
    const ageMs = Date.now() - cached.at;
    dlog(`[native-dl] ${videoId} dùng URL resolve sớm (${(ageMs / 1000).toFixed(1)}s trước, ${cached.clientName}, ${agent.hcPreconn} socket mở sẵn)`);
    try {
      let written;
      try {
        written = useV2
          ? await fetchUrlToFileParallelV2(cached.directUrl, cached.range, outputPath, sourceIp, cached.ua, ctx, { chunkKb: Number(req.chunkKb) || 0, agent, hostRace: req.hostRace !== false })
          : await fetchUrlToFileParallel(cached.directUrl, cached.range, outputPath, sourceIp, cached.ua, ctx, agent);
      } finally {
        try { agent.hcDestroyPool(); agent.destroy(); } catch (_) {}
      }
      abortedCheck();
      if (written < 65536) throw new Error(`suspiciously small download (${written} bytes)`);
      dlog(`[native-dl] ${videoId} itag=${cached.format.itag} client=${cached.clientName}/direct/resolved${sourceIp ? '/bind:' + sourceIp : ''}${useV2 ? '/v2' : ''} ${written} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s${cached.range ? ' (ranged)' : ''} preconn_hit=${agent.hcHits}/${agent.hcHits + agent.hcMiss}`);
      return {
        bytes: written,
        durationSec: cached.durationSec,
        videoWidth: cached.format.width,
        videoHeight: cached.format.height,
        truncated: !!cached.range,
        videoTitle: cached.title,
      };
    } catch (e) {
      if (e && e.aborted) throw e;
      abortedCheck();
      // Ghi kèm số redirect + host cuối: phân xử được "400 do socket lệch
      // host sau redirect" (đã sửa ở PreconnAgent) hay 400 từ chính URL.
      const extra = (e && e.httpStatus)
        ? ` (redirects=${e.hcRedirects ?? '?'}, host_cuối=${e.hcHost || '?'}, host_pool=${cached.host})`
        : '';
      dlog(`[native-dl] ${videoId} URL resolve sớm lỗi (${(e && e.message) || e})${extra} — chạy lại chain đầy đủ`);
      dropPreconn(videoId);
    }
  } else {
    dropPreconn(videoId);
  }
  let lastErr = null;
  const failures = []; // per-client reasons — surfaced in the final error
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      const msg = String((lastErr && lastErr.message) || lastErr);
      // "not playable" is a property of the video (private/removed) and a
      // definite HTTP rejection repeats identically seconds later (observed
      // 20-40-35: pass 2 burned 5s failing the same way) — a second pass only
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
      // Live/upcoming is a property of the video, not the client — stop here.
      if (info.basic_info?.is_live || info.basic_info?.is_upcoming) {
        throw new Error('live/upcoming — native path only handles finished VODs');
      }
      const durationSec = info.basic_info?.duration || 0;
      const format = pickProgressiveFormat(info, maxHeight);
      if (!format) {
        dlog(`[native-dl] ${videoId} no progressive mp4 format on ${clientName}`);
        failures.push(`${clientName}: no progressive format`);
        lastErr = new Error(`no progressive mp4 format on ${clientName}`);
        continue;
      }
      // Đường native chỉ có định dạng PROGRESSIVE (một file, moov đầu file).
      // YouTube chỉ phát hành progressive ở 360p (itag 18) và 720p (itag 22),
      // và itag 22 KHÔNG phải video nào cũng có. Nếu bản progressive tốt nhất
      // thấp hơn mức khách đặt TRONG KHI luồng adaptive có mức đó, thì im lặng
      // giao hàng thấp hơn là nói dối về chất lượng — render sẽ phóng ngược lên
      // và ra hình nhòe (đúng lỗi log khách 11/08: 8/8 lượt tải đều itag 18).
      // Trả lỗi để rơi về yt-dlp: chậm hơn ~2,5s nhưng ghép được adaptive và
      // giao ĐÚNG chiều cao đã hứa. Còn khi adaptive cũng không có mức đó thì
      // không ai làm tốt hơn được — nhận progressive, đừng trả giá vô ích.
      const gotHeight = format.height || 0;
      if (gotHeight < maxHeight) {
        const adaptiveMax = ((info.streaming_data && info.streaming_data.adaptive_formats) || [])
          .filter(f => f.has_video)
          .reduce((m, f) => Math.max(m, f.height || 0), 0);
        if (adaptiveMax >= maxHeight) {
          dlog(`[native-dl] ${videoId} progressive tốt nhất ${gotHeight}p < yêu cầu ${maxHeight}p (adaptive có ${adaptiveMax}p) — nhả về yt-dlp để giữ đúng chất lượng`);
          throw new Error(`progressive only ${gotHeight}p, need ${maxHeight}p — yt-dlp can merge adaptive`);
        }
        dlog(`[native-dl] ${videoId} chỉ có tối đa ${gotHeight}p (adaptive cũng vậy) — nhận bản này`);
      }
      let range = computeByteRange(format, durationSec, limitSec);
      // Prefer the deciphered direct URL over youtubei.js's downloader: a
      // plain https GET with a client-matched UA is what yt-dlp does, and it
      // supports localAddress (VPN bypass). Decipher failure falls back to
      // info.download().
      let directUrl = null;
      try {
        // NOTE: decipher() is async in youtubei.js 17 — a missing await hands
        // a Promise to https.get and dies with "listener argument must be of
        // type function" (debugged 2026-07-15).
        directUrl = await format.decipher(sessClient.session.player);
        if (typeof directUrl !== 'string' || !directUrl.startsWith('http')) {
          dlog(`[native-dl] ${videoId} decipher on ${clientName} returned ${typeof directUrl} — using lib downloader`);
          directUrl = null;
        }
      } catch (e) {
        dlog(`[native-dl] ${videoId} decipher failed on ${clientName}: ${(e && e.message) || e}`);
      }
      const ua = CLIENT_UA[clientName] || CLIENT_UA.WEB;
      // First attempt always goes parallel — even rangeless (a 5:00 video at
      // limit 5:00 gets range=null but still wants the whole ~10MB fast); the
      // retry drops to one plain 200 full download, the most forgiving
      // request possible.
      const doFetch = (r) => directUrl
        ? (useV2
            ? fetchUrlToFileParallelV2(directUrl, r, outputPath, sourceIp, ua, ctx, { chunkKb: Number(req.chunkKb) || 0, hostRace: req.hostRace !== false })
            : fetchUrlToFileParallel(directUrl, r, outputPath, sourceIp, ua, ctx))
        : fetchToFile(info, format.itag, r, outputPath);
      const doFetchFull = () => directUrl
        ? fetchUrlToFile(directUrl, null, outputPath, sourceIp, ua)
        : fetchToFile(info, format.itag, null, outputPath);
      try {
        let written;
        try {
          try {
            written = await doFetch(range);
          } catch (e) {
            // v2 lỗi vì lý do KHÔNG phải HTTP (bug/edge lạ) → thử v1 cùng
            // range trước khi rơi xuống 1 kết nối full (chậm nhất).
            if (!(useV2 && directUrl && !(e && e.aborted) && !(e && e.httpStatus))) throw e;
            abortedCheck();
            dlog(`[native-dl] ${videoId} fetch v2 lỗi (${(e && e.message) || e}) — thử v1 cùng range`);
            written = await fetchUrlToFileParallel(directUrl, range, outputPath, sourceIp, ua, ctx);
          }
        } catch (e) {
          // Bị Rust hủy (thua hedge / video nguội nhường): dừng ngay, không
          // retry, không sang client khác — mọi byte thêm đều là băng thông
          // giật của video đang thắng.
          if (e && e.aborted) throw e;
          abortedCheck();
          // A definite HTTP rejection on an already-rangeless parallel fetch
          // repeats identically on the single-conn retry — skip straight to
          // the next client.
          if (!range && e && e.httpStatus) throw e;
          // A bitrate-estimated range end can overshoot the real file size
          // (fresh uploads report no content_length) and some googlevideo
          // edges answer 416 instead of clamping — one rangeless retry on the
          // SAME client before hopping to the next one.
          dlog(`[native-dl] ${videoId} ${range ? 'ranged' : 'rangeless'} fetch failed on ${clientName} (${(e && e.message) || e}) — retrying single-conn full`);
          range = null;
          written = await doFetchFull();
        }
        abortedCheck();
        if (written < 65536) throw new Error(`suspiciously small download (${written} bytes)`);
        dlog(`[native-dl] ${videoId} itag=${format.itag} client=${clientName}${directUrl ? '/direct' : '/lib'}${sourceIp ? '/bind:' + sourceIp : ''}${useV2 ? '/v2' : ''} ${written} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s${range ? ' (ranged)' : ''}`);
        return {
          bytes: written,
          durationSec: durationSec,
          videoWidth: format.width || 0,
          videoHeight: format.height || 0,
          truncated: !!range,
          // ORIGINAL-language title from /player videoDetails — the browse/
          // playlist surfaces auto-translate titles to the session hl (en),
          // which showed Korean titles as English in the UI (verified
          // 2026-07-16 on Iqg4dBv8gs4: /player returns the Korean original
          // under hl=en/ko/ja alike). Rust overwrites the workspace title
          // with this after the download.
          videoTitle: info.basic_info?.title || '',
        };
      } catch (e) {
        if (e && e.aborted) {
          dlog(`[native-dl] ${videoId} bị hủy theo lệnh Rust (abortDownload) — dừng, không sang client khác`);
          throw e;
        }
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

// Pass 148: Quét trực tiếp tab Videos của kênh qua InnerTube /browse (params: Egh2aWRlb3PyBgQKAjoA).
// Bỏ qua hoàn toàn cache 15s của playlist UU, phản ứng tức thì 250-400ms ngay khi video công khai.
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
    dlog(`[strategyChannelVideos] ${channelId} lỗi: ${e && e.message ? e.message : e}`);
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

    // Pass 148: Ưu tiên số 1 — Tab Videos của kênh phản xạ ngay tức thì 250-400ms
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
    // with — stamp it "published now" so the Rust age filter accepts it (the
    // seen-ids dedup discards everything already processed). Only trust this
    // when the API list is non-empty, so a total API failure can't turn 15 old
    // videos into "new" ones. Each candidate must pass the player playability
    // gate above — private/members-only/upcoming videos are dropped.
    if (htmlVideos.length > 0 && videos.length > 0) {
      const known = new Set(videos.map(v => v.videoId));
      // Verify SONG SONG: vòng await tuần tự từng candidate biến 7 video
      // private "chết" thành hàng chục giây cho MỘT call getLatestVideo và
      // kéo sập cadence poll toàn cục (2s → 98s, log khách 2026-07-17 16-19).
      const candidates = htmlVideos.filter(hv => !known.has(hv.videoId));
      const verdicts = await Promise.all(candidates.map(hv => verifyHtmlFreshPlayable(hv.videoId)));
      const fresh = [];
      candidates.forEach((hv, i) => {
        const verdict = verdicts[i];
        if (!verdict.playable) return;
        // Giờ đăng THẬT nếu /player đưa được; chỉ khi không có mới đóng dấu
        // "bây giờ" để qua bộ lọc tuổi — và nói rõ trong log là đã phải ước
        // lượng, vì badge độ trễ của video đó sẽ đẹp hơn sự thật.
        const realPub = verdict.publishedAtMs || 0;
        hv.publishedAt = realPub || Date.now();
        hv.publishedAtEstimated = !realPub;
        if (!realPub) {
          dlog(`[probe] ${hv.videoId} /player không trả giờ đăng — badge độ trễ sẽ tính từ "bây giờ"`);
        }
        hv.durationSec = verdict.durationSec || 0;
        hv.htmlFresh = true; // nguồn phát hiện: trang playlist, không phải API list
        // Prefer the /player original-language title over the HTML page's
        // (the page is served in the session language → auto-translated).
        if (verdict.title) hv.title = verdict.title;
        dlog(`[probe] ${hv.videoId} HTML-fresh on ${resolvedId} — stamped published=now (dur=${hv.durationSec}s)`);
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

// (Khối Chrome-tab CDP: evaluateInTab/reloadTab/httpGetJson/extractVideosFromFeedJson/
//  checkChromeChannelTabs đã xoá 2026-08-17 — đường quét qua Chrome bỏ từ Pass 58.)

// ─── Response writer ──────────────────────────────────────────
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

// ─── DAEMON MODE (--daemon) ─────────────────────────────────
// Long-lived process: reads JSON-RPC from stdin, writes to stdout.
// Keeps Innertube client warm for instant responses.
function runDaemon(initialCookie) {
  // In daemon mode, always write to stdout (ignore HYPERCLIP_RESPONSE_FILE)
  _forceStdout = true;

  // Don't create client eagerly — it will be created lazily on first request
  // with the actual cookie. Creating with empty cookie hangs/takes too long.
  // Signal ready immediately so Rust doesn't timeout waiting.
  writeResponse({ daemon: true, status: 'ready' });

  // Pre-warm the anonymous gate client in the background: native downloads
  // (mobile-client getBasicInfo) and probe-gates both run through it, and a
  // download daemon is often spawned right when a fresh video needs fetching
  // — this shaves the ~1s Innertube.create off the first download.
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

        // Handle setCookie command — update cookies without restart
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

        // ── Pass 83: FLIP PROBE — canh khoảnh khắc nhãn "X giây trước" LẬT ──
        //
        // Nhãn tương đối làm tròn XUỐNG: "3 giây trước" = tuổi ∈ [3s, 4s).
        // Một lần đọc chỉ cho sai số ±0,5-1s. Nhưng nếu lặp /next đủ dày và
        // BẮT ĐƯỢC cú lật 3→4, thì tại khoảnh khắc lật tuổi video ĐÚNG BẰNG 4s
        // → mốc công khai = giữa_hai_mẫu − 4s, sai số ±nửa khoảng lấy mẫu.
        // /next là payload trang watch (~vài trăm KB JSON, 200-400ms) — không
        // tốn quota Data API, không cần Chrome.
        if (req.cmd === 'flipProbe') {
          const videoId = req.videoId;
          const intervalMs = Math.max(250, req.intervalMs || 400);
          const maxMs = Math.min(30000, req.maxMs || 20000);
          const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
          // Tìm key lồng sâu trong JSON thô của /next (cấu trúc YouTube hay
          // xê dịch — đừng bám đường dẫn cứng).
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
          // Nhãn giây → số; đơn vị thô hơn (phút/giờ) → null (không lật được
          // trong cửa sổ 20s, và độ phân giải 60s+ vô dụng cho phép đo).
          const relSecs = (text) => {
            if (!text) return null;
            const t = String(text).toLowerCase();
            if (t.includes('vừa xong') || t.includes('just now')) return 0;
            // YouTube dùng CẢ dạng đầy đủ ("5 seconds ago") lẫn dạng tắt ("5s ago").
            // Log 17-40-33: nhãn "5s ago" bị loại vì chỉ check "second".
            const isSeconds = t.includes('giây') || t.includes('second')
              || /^\d+s\s/.test(t.trim()); // "5s ago", "5s trước"
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
            // maxMs nhỏ (≤1) = chế độ MỘT MẪU: lớp lót tức thì, Rust tự suy
            // ước lượng ±0,5s từ mẫu đầu rồi mới gọi lại chế độ canh lật.
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
                // Nhãn đầu đã không phải đơn vị giây — video quá cũ cho flip.
                reason = 'label_not_seconds';
                break;
              }
              if (prev && L !== null) {
                if (L === prev.L + 1) {
                  // Biên tuổi = L giây bị cắt trong (prev.t, tMid].
                  const mid = Math.round((prev.t + tMid) / 2);
                  flipPublicMs = mid - L * 1000;
                  flipErrMs = Math.max(250, Math.round((tMid - prev.t) / 2));
                  reason = 'flip';
                  break;
                }
                if (L < prev.L) {
                  // Shard khác đồng hồ lệch — ghi vết, chạy tiếp.
                  reason = 'label_jitter';
                }
                if (L > prev.L + 1) {
                  // Nhảy ≥2 nấc: mẫu thưa hơn nhãn (cache/RTT dài) — mốc lật
                  // không chốt được chính xác, đừng bịa.
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
        // publishDate, which carries a full ISO timestamp — the only per-second
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

        // Handle downloadVideo — native progressive download through the warm
        // session (downloadVideoNative above). The Rust caller treats any
        // error response as "fall back to yt-dlp", so failures are cheap.
        // Pass 90 (A1): resolve sớm — Rust bắn lúc phát hiện, KHÔNG chờ trả lời
        // (fire-and-forget qua kênh điều khiển). Kết quả nằm trong cache 5 phút
        // + N socket TLS mở sẵn 25 s; `downloadVideo` tới sau sẽ dùng.
        if (req.cmd === 'resolveMedia') {
          const tR = Date.now();
          let n = Math.max(1, Math.min(PARALLEL_CONNECTIONS_MAX, Number(req.conns) || PARALLEL_CONNECTIONS_DEFAULT));
          if (req.limitSec && req.limitSec > 0 && req.limitSec <= 65) {
            n = Math.min(n, 8);
          }
          const p = resolveMediaNative(req).then((r) => {
            resolvedMedia.set(req.videoId, r);
            const pool = preconnect(req.videoId, r.host, n, req.sourceIp || null);
            dlog(`[native-dl] ${req.videoId} resolve sớm xong ${((Date.now() - tR) / 1000).toFixed(1)}s (${r.clientName}, itag=${r.format.itag}, host=${r.host}) — mở sẵn ${pool.sockets.length} kết nối`);
            writeResponse({ id: req.id || 0, ok: true, cmd: 'resolveMedia', host: r.host, preconn: pool.sockets.length });
          }).catch((e) => {
            dlog(`[native-dl] ${req.videoId} resolve sớm lỗi: ${(e && e.message) || e} — downloadVideo sẽ chạy chain thường`);
            writeResponse({ id: req.id || 0, ok: false, cmd: 'resolveMedia', error: (e && e.message) || String(e) });
          }).finally(() => { if (resolveInflight.get(req.videoId) === p) resolveInflight.delete(req.videoId); });
          resolveInflight.set(req.videoId, p);
          continue;
        }

        if (req.cmd === 'downloadVideo') {
          // Pass 90: ctx = tiến độ (`progress` lines cùng id) + hủy được
          // (abortDownload) + telemetry theo slice.
          const dctx = newDownloadCtx(req.id || 0, req.videoId);
          downloadVideoNative(req, dctx).then(result => {
            dropDownloadCtx(dctx);
            writeResponse({ id: req.id || 0, ok: true, cmd: 'downloadVideo', ...result });
          }).catch(e => {
            dropDownloadCtx(dctx);
            // Bị hủy: xoá file dở để Rust không nhặt nhầm; Rust đã đi tiếp,
            // dòng trả lời này chỉ để đóng vòng đời id.
            if (e && e.aborted) { try { require('fs').unlinkSync(req.outputPath); } catch (_) {} }
            writeResponse({ id: req.id || 0, ok: false, cmd: 'downloadVideo', aborted: !!(e && e.aborted), error: (e && e.message) || String(e) });
          });
          continue;
        }

        // Pass 90: hủy một lượt tải native đang chạy (thua hedge / video nguội
        // nhường video nóng). Nhắm theo id request hoặc videoId; destroy socket
        // ngay nên băng thông được nhả trong vài chục ms.
        if (req.cmd === 'abortDownload') {
          const n = abortDownloadBy(req.targetId, req.videoId);
          dlog(`[native-dl] abortDownload target=${req.targetId ?? '-'} video=${req.videoId || '-'} → hủy ${n} lượt`);
          writeResponse({ id: req.id || 0, ok: true, cmd: 'abortDownload', abortedCount: n });
          continue;
        }

        // Handle ping/heartbeat
        if (req.cmd === 'ping') {
          writeResponse({ id: req.id || 0, ok: true, cmd: 'pong' });
          continue;
        }

        // ── Pass 146: SUBSCRIPTIONS FEED — bề mặt fan-out theo NGƯỜI XEM ──
        //
        // Mọi bề mặt đang đua (playlistItems/activities/Atom/trang kênh/browse
        // kênh) đều là index CÔNG KHAI của kênh — log 05/09: cả năm cùng câm
        // 54s cho một video dài. Feed đăng ký (`FEsubscriptions`) là fan-out
        // vào hộp thư của NGƯỜI XEM ngay lúc publish, đường dữ liệu khác hẳn
        // (Pass 46 từng dùng và bị gỡ chung với Chrome watcher ở Pass 58). MỘT
        // request phủ mọi kênh Profile-1 đã subscribe, 0 quota Data API.
        // Điều kiện vận hành: Profile-1 PHẢI subscribe các kênh theo dõi.
        if (req.cmd === 'getSubscriptionsFeed') {
          const cookie = req.cookie || currentCookie;
          if (!cookie || !/SAPISID=/.test(cookie)) {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'getSubscriptionsFeed', error: 'no logged-in cookie (SAPISID) — feed đăng ký cần phiên Profile-1' });
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
              // 1) LockupView (UI mới của YouTube) — parser đã trận mạc từ playlist.
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
              // 2) Video/GridVideo (UI cũ) — youtubei.js gom sẵn trong feed.videos.
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
                dlog(`[subs] feed rỗng sau ${Date.now() - t0}ms — Profile-1 chưa subscribe kênh nào, hoặc YouTube throttle/đổi cấu trúc`);
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

        // ── Pass 146: SUBSCRIPTIONS FEED — bề mặt fan-out theo NGƯỜI XEM ──
        //
        // Mọi bề mặt đang đua (playlistItems/activities/Atom/trang kênh/browse
        // kênh) đều là index CÔNG KHAI của kênh — log 05/09: cả năm cùng câm
        // 54s cho một video dài. Feed đăng ký (`FEsubscriptions`) là fan-out
        // vào hộp thư của NGƯỜI XEM ngay lúc publish, đường dữ liệu khác hẳn
        // (Pass 46 từng dùng và bị gỡ chung với Chrome watcher ở Pass 58). MỘT
        // request phủ mọi kênh Profile-1 đã subscribe, 0 quota Data API.
        // Điều kiện vận hành: Profile-1 PHẢI subscribe các kênh theo dõi.
        if (req.cmd === 'getSubscriptionsFeed') {
          const cookie = req.cookie || currentCookie;
          if (!cookie || !/SAPISID=/.test(cookie)) {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'getSubscriptionsFeed', error: 'no logged-in cookie (SAPISID) — feed đăng ký cần phiên Profile-1' });
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
              // 1) LockupView (UI mới của YouTube) — parser đã trận mạc từ playlist.
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
              // 2) Video/GridVideo (UI cũ) — youtubei.js gom sẵn trong feed.videos.
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
                dlog(`[subs] feed rỗng sau ${Date.now() - t0}ms — Profile-1 chưa subscribe kênh nào, hoặc YouTube throttle/đổi cấu trúc`);
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
    // Rust closed stdin — exit gracefully
    process.exit(0);
  });

  // Keep process alive
  process.on('uncaughtException', (e) => {
    writeResponse({ daemon: true, status: 'error', error: 'uncaught: ' + e.message });
  });
}

// ─── Entry point ──────────────────────────────────────────────

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
