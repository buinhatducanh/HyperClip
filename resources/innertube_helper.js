// innertube_helper.js — Spawned by Rust InnertubeClient for youtubei.js v17
// JSON-RPC: stdin requests -> stdout OR temp file responses
// v4 — Persistent daemon mode for fast polling + LockupView extraction + handle→UC ID resolution

const { Innertube } = require('youtubei.js');

const clientPromises = new Map(); // cookieStr -> Promise<Innertube>
let currentCookie = '';
const resolvedChannelCache = new Map(); // '@handle' -> 'UC...'

async function ensureClient(cookieStr) {
  currentCookie = cookieStr;
  if (clientPromises.has(cookieStr)) {
    return clientPromises.get(cookieStr);
  }
  const promise = Innertube.create({ cookie: cookieStr, retrieve_player: false });
  clientPromises.set(cookieStr, promise);
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

function parseRelativeTime(text) {
  if (!text) return 0;
  const cleanText = text.replace(/\u00a0/g, ' ').trim().toLowerCase();
  
  // Handle "New", "Mới", "Live", "Trực tiếp", "Đang phát trực tiếp", etc., if no numeric digit is present
  if (!/\d/.test(cleanText)) {
    if (
      cleanText.includes('new') || 
      cleanText.includes('mới') || 
      cleanText.includes('vừa xong') ||
      cleanText.includes('just now') ||
      // Japanese
      cleanText.includes('新着') ||
      cleanText.includes('新し') ||
      cleanText.includes('ライブ') ||
      cleanText.includes('生放送') ||
      cleanText.includes('配信中') ||
      cleanText.includes('公開中') ||
      cleanText.includes('プレミア') ||
      cleanText.includes('視聴中') ||
      // Korean
      cleanText.includes('새로운') ||
      cleanText.includes('새 동영상') ||
      cleanText.includes('방금') ||
      cleanText.includes('최신') ||
      cleanText.includes('실시간') ||
      cleanText.includes('라이브') ||
      cleanText.includes('최초 공개') ||
      cleanText.includes('시청 중') ||
      // Existing defaults
      cleanText === 'live' || 
      cleanText.includes('trực tiếp') || 
      cleanText.includes('đang phát') || 
      cleanText.includes('premiering') || 
      cleanText.includes('công chiếu') ||
      cleanText.includes('watching') ||
      cleanText.includes('đang xem')
    ) {
      return Date.now();
    }
  }
  
  const m = cleanText.match(/(\d+)\s*(.+)/);
  if (m) {
    const val = parseInt(m[1], 10);
    const unit = m[2];
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

function extractFromLockupView(lv) {
  const videoId = lv.content_id;
  if (!videoId) return null;
  
  const title = lv.metadata?.lockupMetadataViewModel?.title?.content || lv.metadata?.title?.text || '';
  
  let publishedAt = extractPublishedAtFromLockup(lv);
  let durationSec = extractDurationFromLockup(lv);

  
  let thumbnailUrl = '';
  const sources = lv.contentImage?.lockupContentImageViewModel?.image?.sources 
               || lv.contentImage?.image 
               || lv.content_image?.image 
               || [];
  if (sources.length > 0) thumbnailUrl = sources[0].url || '';
  
  return { videoId, title, publishedAt, thumbnailUrl, durationSec };
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
    publishedAt: extractPublishedAt(v),
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
  } catch (_) { return []; }
}

async function getLatestVideo(channelId, cookieStr) {
  try {
    const client = await ensureClient(cookieStr);
    const resolvedId = await resolveChannelId(client, channelId);
    if (!resolvedId || !resolvedId.startsWith('UC')) {
      return { ok: false, error: 'Could not resolve channel ID: ' + channelId };
    }
    const playlistId = resolvedId.replace(/^UC/, 'UU');
    const videos = await strategyPlaylistInnertube(client, playlistId);
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
            if (text.includes('ago') || text.includes('trước') || text.includes('hours') || text.includes('minutes') || text.includes('seconds') || text.includes('giây') || text.includes('phút') || text.includes('giờ')) {
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
      // Reload tab periodically (every 30s) if CDP is active
      if (wsUrl) {
        const lastReload = tabReloads[wsUrl] || 0;
        if (now - lastReload >= 30000) {
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
                  const text = span.textContent.trim();
                  if (text.includes('ago') || text.includes('trước') || text.includes('前') || text.includes('day') || text.includes('hour') || text.includes('minute') || text.includes('second') || text.includes('ngày') || text.includes('giờ') || text.includes('phút') || text.includes('giây') || text.includes('秒') || text.includes('分') || text.includes('時間') || text.includes('日') || text.includes('週') || text.includes('lịch') || text.includes('năm')) {
                    relativeTimeText = text;
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

      // C. Extract from Playlist Poll (Priority 3, fallback)
      const lastPoll = lastChannelPollTime.get(channelId) || 0;
      let playlistVideos = [];
      if (now - lastPoll >= 1500) {
        lastChannelPollTime.set(channelId, now);
        const result = await getLatestVideo(channelId, currentCookie);
        if (result && result.ok && Array.isArray(result.videos)) {
          playlistVideos = result.videos;
          channelLastVideos.set(channelId, playlistVideos);
        } else {
          playlistVideos = channelLastVideos.get(channelId) || [];
        }
      } else {
        playlistVideos = channelLastVideos.get(channelId) || [];
      }

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
          checkChromeChannelTabs(pollIntervalMs).then(videos => {
            writeResponse({ id: req.id || 0, ok: true, cmd: 'checkChromeTabs', videos });
          }).catch(e => {
            writeResponse({ id: req.id || 0, ok: false, cmd: 'checkChromeTabs', error: e.message });
          });
          continue;
        }

        // Handle getVideoInfo command - resolve channel ID and name for a video
        if (req.cmd === 'getVideoInfo') {
          const videoId = req.videoId;
          ensureClient(req.cookie || currentCookie).then(async (client) => {
            try {
              const info = await client.getInfo(videoId);
              writeResponse({
                id: req.id || 0,
                ok: true,
                cmd: 'getVideoInfo',
                channelId: info.basic_info.channel_id || '',
                channelName: info.basic_info.author || '',
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
        getLatestVideo(req.channelId, req.cookie).then(result => {
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
