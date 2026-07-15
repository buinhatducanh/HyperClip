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
  try {
    const results = await yt.search(id);
    if (results.channels?.[0]?.id) {
      const UC = results.channels[0].id;
      resolvedChannelCache.set(cacheKey, UC);
      return UC;
    }
  } catch (_) {}
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
    
    // Seconds
    if (
      unit.startsWith('second') || unit.startsWith('sec') || unit.includes('giây') || 
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

function extractFromLockupView(lv) {
  const videoId = lv.content_id;
  if (!videoId) return null;

  const title = lv.metadata?.lockupMetadataViewModel?.title?.content || lv.metadata?.title?.text || '';

  const isUpcoming = lockupIsUpcoming(lv);
  let publishedAt = isUpcoming ? 0 : extractPublishedAtFromLockup(lv);
  let durationSec = extractDurationFromLockup(lv);

  
  let thumbnailUrl = '';
  const sources = lv.contentImage?.lockupContentImageViewModel?.image?.sources 
               || lv.contentImage?.image 
               || lv.content_image?.image 
               || [];
  if (sources.length > 0) thumbnailUrl = sources[0].url || '';
  
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
      return playlist.items.map(v => ({
        videoId: v.id || '',
        title: v.title?.text || v.title || '',
        publishedAt: (v.is_upcoming || v.upcoming) ? 0 : extractPublishedAt(v),
        thumbnailUrl: v.thumbnails?.[0]?.url || '',
        durationSec: v.duration?.seconds || 0,
        upcoming: !!(v.is_upcoming || v.upcoming),
        scheduleText: '',
      })).filter(v => v.videoId);
    }
    const memo = playlist.page?.contents_memo;
    if (memo) {
      const lockups = memo.get('LockupView') || [];
      return lockups.map(extractFromLockupView).filter(v => v !== null);
    }
    return [];
  } catch (_) { return []; }
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
const htmlFreshRejected = new Map(); // videoId -> last rejected-check ms
// 20s: a rejected candidate (private / still processing) is re-verified at most
// every 20s, so a video flipped public — or an upload that finishes processing —
// is picked up within one recheck window. Player call cost only applies to the
// handful of HTML-fresh candidates, so this stays negligible.
const HTML_FRESH_RECHECK_MS = 20000;

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

async function verifyHtmlFreshPlayable(videoId) {
  const lastRejected = htmlFreshRejected.get(videoId) || 0;
  if (Date.now() - lastRejected < HTML_FRESH_RECHECK_MS) return { playable: false };
  if (htmlFreshRejected.size > 200) {
    for (const [id, ts] of htmlFreshRejected) {
      if (Date.now() - ts > 3600000) htmlFreshRejected.delete(id);
    }
  }
  try {
    const gateClient = await ensureGateClient();
    const info = await gateClient.getBasicInfo(videoId, { client: 'ANDROID' });
    const status = info.playability_status?.status || '';
    const playable = status === 'OK' && !info.basic_info?.is_upcoming;
    if (!playable) {
      htmlFreshRejected.set(videoId, Date.now());
      dlog(`[probe-gate] ${videoId} rejected: playability=${status || 'unknown'} reason="${info.playability_status?.reason || ''}" upcoming=${!!info.basic_info?.is_upcoming}`);
      return { playable: false };
    }
    htmlFreshRejected.delete(videoId);
    return { playable: true, durationSec: info.basic_info?.duration || 0 };
  } catch (e) {
    // Player errors (private videos often throw) count as not playable.
    htmlFreshRejected.set(videoId, Date.now());
    dlog(`[probe-gate] ${videoId} rejected: player error ${(e && e.message) || e}`);
    return { playable: false };
  }
}

async function getLatestVideo(channelId, cookieStr, fastProbe, probeCookie) {
  try {
    const client = await ensureClient(cookieStr);
    const resolvedId = await resolveChannelId(client, channelId);
    if (!resolvedId || !resolvedId.startsWith('UC')) {
      return { ok: false, error: 'Could not resolve channel ID: ' + channelId };
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
      const fresh = [];
      for (const hv of htmlVideos) {
        if (!known.has(hv.videoId)) {
          const verdict = await verifyHtmlFreshPlayable(hv.videoId);
          if (!verdict.playable) continue;
          hv.publishedAt = Date.now();
          hv.durationSec = verdict.durationSec || 0;
          dlog(`[probe] ${hv.videoId} HTML-fresh on ${resolvedId} — stamped published=now (dur=${hv.durationSec}s)`);
          fresh.push(hv);
        }
      }
      if (fresh.length > 0) {
        return { ok: true, videos: [...fresh, ...videos] };
      }
    }
    return { ok: true, videos: videos };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ─── Chrome Tab Debugging & Reload Tracker ────────────────────
const tabReloads = {};

function evaluateInTab(webSocketDebuggerUrl, script) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(webSocketDebuggerUrl);
    } catch (e) {
      return reject(e);
    }
    let resolved = false;
    
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: script,
          returnByValue: true
        }
      }));
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === 1) {
          resolved = true;
          ws.close();
          const result = msg.result?.result?.value;
          resolve(result);
        }
      } catch (err) {
        reject(err);
      }
    };
    
    ws.onerror = (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    };
    
    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    };
    
    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws.close(); } catch(_) {}
        resolve(null);
      }
    }, 2500);
  });
}

function reloadTab(webSocketDebuggerUrl, ignoreCache) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(webSocketDebuggerUrl);
    } catch (e) {
      return reject(e);
    }
    let resolved = false;
    
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Page.reload',
        params: {
          ignoreCache: !!ignoreCache
        }
      }));
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === 1) {
          resolved = true;
          ws.close();
          resolve(true);
        }
      } catch (err) {
        reject(err);
      }
    };
    
    ws.onerror = (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    };
    
    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        resolve(true);
      }
    };
    
    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws.close(); } catch(_) {}
        resolve(true);
      }
    }, 2500);
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Status: ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

const lastChannelPollTime = new Map();  // 'UC...' -> timestamp (ms)
const channelLastVideos = new Map();    // 'UC...' -> videos list

function extractChannelHandleOrId(url) {
  if (!url) return null;
  let decodedUrl = url;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch (_) {}

  let match = decodedUrl.match(/youtube\.com\/channel\/(UC[\w-]{20,})/);
  if (match) return match[1];
  
  match = decodedUrl.match(/youtube\.com\/@([^/?#\s]+)/);
  if (match) return '@' + match[1].toLowerCase();
  
  match = decodedUrl.match(/youtube\.com\/c\/([^/?#\s]+)/);
  if (match) return '@' + match[1].toLowerCase();
  
  return null;
}

function findChannelIdInObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.browseId === 'string' && obj.browseId.startsWith('UC')) {
    return obj.browseId;
  }
  for (const key of Object.keys(obj)) {
    const res = findChannelIdInObject(obj[key]);
    if (res) return res;
  }
  return null;
}

function extractVideosFromFeedJson(data) {
  const videos = [];
  function traverse(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.lockupViewModel) {
      const lv = obj.lockupViewModel;
      const videoId = lv.contentId;
      const title = lv.metadata?.lockupMetadataViewModel?.title?.content || '';
      const channelId = findChannelIdInObject(lv) || '';
      
      let publishedText = '';
      const metadata = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel;
      if (metadata?.metadataRows) {
        for (const row of metadata.metadataRows) {
          if (!row?.metadataParts) continue;
          for (const part of row.metadataParts) {
            const text = part.text?.content || '';
            if (isRelativeTimeText(text)) {
              publishedText = text;
            }
          }
        }
      }
      if (videoId && videoId.length === 11) {
        videos.push({
          videoId,
          title,
          channelId,
          publishedAt: parseRelativeTime(publishedText) || 0,
          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          durationSec: 0,
        });
      }
      return;
    }
    if (obj.gridVideoRenderer) {
      const v = obj.gridVideoRenderer;
      const videoId = v.videoId;
      const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
      const channelId = findChannelIdInObject(v) || '';
      const publishedText = v.publishedTimeText?.simpleText || '';
      videos.push({
        videoId,
        title,
        channelId,
        publishedAt: parseRelativeTime(publishedText) || 0,
        thumbnailUrl: v.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSec: 0,
      });
      return;
    }
    if (obj.videoRenderer) {
      const v = obj.videoRenderer;
      const videoId = v.videoId;
      const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
      const channelId = findChannelIdInObject(v) || '';
      const publishedText = v.publishedTimeText?.simpleText || '';
      videos.push({
        videoId,
        title,
        channelId,
        publishedAt: parseRelativeTime(publishedText) || 0,
        thumbnailUrl: v.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSec: 0,
      });
      return;
    }
    for (const key of Object.keys(obj)) {
      traverse(obj[key]);
    }
  }
  traverse(data);
  return videos;
}

async function checkChromeChannelTabs(pollIntervalMs) {
  try {
    const tabs = await httpGetJson('http://127.0.0.1:9222/json');
    
    const channelTabs = tabs.filter(tab => {
      if (tab.type !== 'page') return false;
      const url = tab.url || '';
      return url.includes('youtube.com/@') || url.includes('youtube.com/channel/');
    });
    
    if (channelTabs.length === 0) return [];

    const detected = [];
    const now = Date.now();

    // 1. Pre-resolve channel IDs for open tabs
    const tabInfoList = [];
    const activeChannelIds = new Set();
    
    for (const tab of channelTabs) {
      const handleOrId = extractChannelHandleOrId(tab.url);
      if (!handleOrId) continue;
      
      let channelId = null;
      if (handleOrId.startsWith('UC')) {
        channelId = handleOrId;
      } else {
        channelId = resolvedChannelCache.get(handleOrId);
        if (!channelId) {
          try {
            const client = await ensureClient(currentCookie);
            channelId = await resolveChannelId(client, handleOrId);
            if (channelId && channelId.startsWith('UC')) {
              resolvedChannelCache.set(handleOrId, channelId);
            }
          } catch (_) {}
        }
      }
      if (channelId) {
        activeChannelIds.add(channelId);
        tabInfoList.push({ tab, wsUrl: tab.webSocketDebuggerUrl, channelId });
      }
    }

    if (tabInfoList.length === 0) return [];

    // 2. Fetch and parse Subscriptions Feed using the active session client
    let subFeedVideos = [];
    try {
      const client = await ensureClient(currentCookie);
      const subFeed = await client.actions.execute('/browse', { browseId: 'FEsubscriptions' });
      if (subFeed && subFeed.data) {
        subFeedVideos = extractVideosFromFeedJson(subFeed.data);
      }
    } catch (e) {
      // Silently fall back if Subscriptions feed fetch fails
    }

    // 3. Process each open channel tab
    const promises = tabInfoList.map(async ({ tab, wsUrl, channelId }) => {
      // Reload tab periodically so the DOM source sees new uploads (an open
      // channel tab never refreshes itself). Floor at 30s — the previous
      // `pollIntervalMs * 2` formula collapsed to ~3s once the poll interval
      // dropped to 2000ms, which would reload 30+ tabs every 3s (huge CPU/
      // bandwidth + YouTube anti-bot risk). The subscriptions-feed and playlist
      // API sources below update without any reload, so 30s DOM staleness is fine.
      if (wsUrl) {
        const lastReload = tabReloads[wsUrl] || 0;
        const reloadThreshold = Math.max(30000, pollIntervalMs * 2);
        if (now - lastReload >= reloadThreshold) {
          tabReloads[wsUrl] = now;
          reloadTab(wsUrl, false).catch(() => {});
        }
      }

      // A. Extract from Subscriptions Feed (Priority 1)
      const feedVideos = subFeedVideos.filter(v => v.channelId === channelId);

      // B. Extract from CDP Tab DOM (Priority 2)
      let domVideos = [];
      if (wsUrl) {
        try {
          const domScript = `
            (() => {
              const videos = [];
              const items = document.querySelectorAll('ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer, ytd-reel-item-renderer');
              for (const item of items) {
                const titleEl = item.querySelector('#video-title-link, #video-title, #video-title-container');
                if (!titleEl) continue;
                const href = titleEl.getAttribute('href') || titleEl.querySelector('a')?.getAttribute('href');
                if (!href) continue;
                let videoId = null;
                if (href.includes('/watch?v=')) {
                  const match = href.match(/[?&]v=([^&#]+)/);
                  if (match) videoId = match[1];
                }
                if (!videoId) continue;
                const title = titleEl.textContent.trim() || titleEl.getAttribute('title') || '';
                let relativeTimeText = '';
                const metaSpans = item.querySelectorAll('#metadata-line span');
                for (const span of metaSpans) {
                  const text = span.textContent.trim().toLowerCase();
                  const indicators = [
                    'ago', 'trước', '前', '전', 'hour', 'min', 'day', 'week', 'month', 'year',
                    'giây', 'phút', 'giờ', 'ngày', 'tuần', 'tháng', 'năm',
                    '秒', '分', '時', '日', '週', '月', '年',
                    '초', '분', '시', '일', '주', '달', '해',
                    'seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years',
                    'new', 'mới', 'vừa', '방금', '최신', '실시간', '라이브',
                    'live', 'trực tiếp', 'đang phát', 'công chiếu', 'đang xem'
                  ];
                  if (indicators.some(ind => text.includes(ind))) {
                    relativeTimeText = span.textContent.trim();
                  }
                }
                videos.push({ videoId, title, relativeTimeText });
              }
              return videos;
            })()
          `;
          const extracted = await evaluateInTab(wsUrl, domScript);
          if (Array.isArray(extracted)) {
            domVideos = extracted;
          }
        } catch (_) {}
      }

      const parsedDomVideos = [];
      for (const dv of domVideos) {
        if (dv && dv.videoId) {
          parsedDomVideos.push({
            videoId: dv.videoId,
            title: dv.title || '',
            publishedAt: parseRelativeTime(dv.relativeTimeText) || 0,
            thumbnailUrl: `https://i.ytimg.com/vi/${dv.videoId}/hqdefault.jpg`,
            durationSec: 0,
          });
        }
      }

      // C. Playlist Poll (Priority 3) — REMOVED as an active fetch. The Rust
      // poller already polls every channel's playlist every ~2s with pooled
      // sessions; doing it AGAIN here per open tab every 1.5s meant 24 tabs
      // added ~16 req/s on the same IP and YouTube started serving EMPTY
      // playlists to everything (log 2026-07-14 18-10-56: 14% of all poller
      // responses "Got 0 videos", detection blind in waves). Keep only the
      // cached list from previous runs for merge/backfill purposes.
      const playlistVideos = channelLastVideos.get(channelId) || [];

      // Merge videos: Feed -> DOM -> Playlist (no duplicates)
      const mergedVideos = [...feedVideos];
      
      for (const pdv of parsedDomVideos) {
        const existing = mergedVideos.find(v => v.videoId === pdv.videoId);
        if (existing) {
          if (existing.publishedAt === 0 && pdv.publishedAt > 0) {
            existing.publishedAt = pdv.publishedAt;
          }
        } else {
          mergedVideos.push(pdv);
        }
      }

      for (const pv of playlistVideos) {
        const existing = mergedVideos.find(v => v.videoId === pv.videoId);
        if (existing) {
          if (existing.publishedAt === 0 && pv.publishedAt > 0) {
            existing.publishedAt = pv.publishedAt;
          }
        } else {
          mergedVideos.push(pv);
        }
      }

      let channelName = tab.title || '';
      if (channelName.endsWith(' - YouTube')) {
        channelName = channelName.substring(0, channelName.length - 10);
      }

      for (const v of mergedVideos) {
        if (v.videoId) {
          detected.push({
            videoId: v.videoId,
            title: v.title,
            publishedAt: v.publishedAt || 0,
            channelId: channelId,
            channelName: channelName
          });
        }
      }
    });

    await Promise.all(promises);
    return detected;
  } catch (e) {
    return [];
  }
}

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

        // Handle checkChromeTabs command — evaluate JS in open Chrome channel tabs via CDP
        if (req.cmd === 'checkChromeTabs') {
          const pollIntervalMs = req.pollIntervalMs || 3000;
          if (Array.isArray(req.channels)) {
            for (const ch of req.channels) {
              if (ch.handle && ch.channelId) {
                const handle = ch.handle.trim().toLowerCase();
                const key = handle.startsWith('@') ? handle : '@' + handle;
                resolvedChannelCache.set(key, ch.channelId);
              }
            }
          }
          checkChromeChannelTabs(pollIntervalMs).then(videos => {
            writeResponse({ id: req.id || 0, ok: true, cmd: 'checkChromeTabs', videos });
          }).catch(e => {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'checkChromeTabs', error: e.message });
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

        // Handle ping/heartbeat
        if (req.cmd === 'ping') {
          writeResponse({ id: req.id || 0, ok: true, cmd: 'pong' });
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
