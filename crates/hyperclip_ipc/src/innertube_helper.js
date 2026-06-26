// innertube_helper.js — Spawned by Rust InnertubeClient for youtubei.js v17
// JSON-RPC: stdin requests -> stdout OR temp file responses
// v4 — Persistent daemon mode for fast polling + LockupView extraction + handle→UC ID resolution

const { Innertube } = require('youtubei.js');

let yt = null;
let currentCookie = '';
const lastSlowPathCheckTime = new Map(); // channelId -> timestamp (ms)

async function ensureClient(cookieStr) {
  // Reuse existing client if cookie hasn't changed
  if (yt && cookieStr === currentCookie) return yt;
  currentCookie = cookieStr;
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

function parseRelativeTime(text) {
  if (!text) return 0;
  const trimmed = text.trim().toLowerCase();
  if (trimmed.includes('just now') || trimmed.includes('vừa xong') || trimmed.includes('vừa mới') || trimmed.includes('mới đăng')) {
    return Math.floor(Date.now() / 1000);
  }
  const m = text.match(/(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|giây|phút|giờ|ngày|tuần|tháng|năm)(?![a-zA-Z0-9])/i);
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
  // Fallback to parsing published text (e.g. "3 hours ago", "3 giờ trước")
  let text = '';
  if (v.published && v.published.text) text = v.published.text;
  else if (typeof v.published === 'string') text = v.published;
  return parseRelativeTime(text);
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

async function strategyRSS(channelId, cookieStr) {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}&_t=${Date.now()}&_r=${Math.random()}`, {
      headers: {
        'Cookie': cookieStr || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    if (!res.ok) return [];
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
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSec: 0,
      };
    }).filter(v => v !== null);
  } catch (_) { return []; }
}

async function strategyPlaylistHTML(channelId, cookieStr) {
  try {
    const playlistId = channelId.replace(/^UC/, 'UU');
    const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}&_t=${Date.now()}&_r=${Math.random()}`, {
      headers: {
        'Cookie': cookieStr || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    if (!res.ok) return [];
    const html = await res.text();
    const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (!match) return [];
    const data = JSON.parse(match[1]);
    const items = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
    if (!items || !Array.isArray(items)) return [];
    let isFirst = true;
    return items.slice(0, 15).map(item => {
      const lv = item.lockupViewModel;
      if (!lv) return null;
      const videoId = lv.contentId;
      const title = lv.metadata?.lockupMetadataViewModel?.title?.content || '';
      let publishedAt = extractPublishedAtFromLockup(lv);
      if (publishedAt === 0 && isFirst) {
        publishedAt = Math.floor(Date.now() / 1000);
      }
      isFirst = false;
      const durationSec = extractDurationFromLockup(lv);
      return { videoId, title, publishedAt, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, durationSec };
    }).filter(v => v !== null);
  } catch (_) { return []; }
}

async function getLatestVideo(channelId, cookieStr) {
  try {
    // Resolve channel ID synchronously if already UC format (common case)
    const isUC = channelId.startsWith('UC') && channelId.length >= 22;
    const fastId = isUC ? channelId : null;

    // Check if we should run slow path (throttle to once every 30 seconds per channel)
    const now = Date.now();
    const lastSlowCheck = lastSlowPathCheckTime.get(channelId) || 0;
    // Always run slow path on first check, or if 30s elapsed, or if it is a non-UC channel (needs resolution)
    const shouldRunSlow = !isUC || (now - lastSlowCheck >= 30000);
    
    // Phase 1: Fast HTTP-only strategy (Playlist HTML) — no YouTube.js needed if UC format
    // RSS removed: slow, unreliable published_at parsing, and not needed for detection.
    const fastPromise = fastId ? strategyPlaylistHTML(fastId, cookieStr) : Promise.resolve([]);

    // Phase 2: Slow YouTube.js strategies (run in parallel with fast path)
    const slowPromise = shouldRunSlow ? (async () => {
      try {
        lastSlowPathCheckTime.set(channelId, now);
        const client = await ensureClient(cookieStr);
        const resolvedId = isUC ? channelId : await resolveChannelId(client, channelId);
        const channel = await client.getChannel(resolvedId);
        const [fromGetVids, fromSearch] = await Promise.all([
          strategyGetVideos(channel),
          strategySearch(channel),
        ]);
        if (!fastId) {
          const fromPlaylist = await strategyPlaylistHTML(resolvedId, cookieStr);
          return { fromGetVids, fromSearch, fromPlaylist, resolvedId };
        }
        return { fromGetVids, fromSearch, fromPlaylist: [], resolvedId };
      } catch (e) {
        return { fromGetVids: [], fromSearch: [], fromPlaylist: [], resolvedId: channelId };
      }
    })() : Promise.resolve(null);

    // Wait for fast strategy first (should complete in <2s)
    const fromPlaylistFast = await fastPromise;

    // If fast strategy got results AND at least one video is published within the last 4 hours,
    // return immediately — don't wait for slow path
    const recentThresholdSec = 4 * 3600;
    const nowSec = Math.floor(Date.now() / 1000);
    const hasRecentFastVideo = fromPlaylistFast.some(v => {
      return (nowSec - v.publishedAt) < recentThresholdSec;
    });

    if (hasRecentFastVideo && !shouldRunSlow) {
      const merged = new Map();
      for (const v of fromPlaylistFast) {
        if (!v.videoId) continue;
        merged.set(v.videoId, v);
      }
      const all = Array.from(merged.values())
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, 15);
      return { ok: true, videos: all };
    }

    // Otherwise, if we should check the slow path, wait for it
    if (shouldRunSlow) {
      const slow = await slowPromise;
      if (slow) {
        const merged = new Map();
        for (const v of [...slow.fromGetVids, ...slow.fromSearch]) {
          if (!v.videoId) continue;
          const existing = merged.get(v.videoId);
          if (!existing || v.publishedAt > existing.publishedAt) {
            merged.set(v.videoId, v);
          }
        }
        for (const v of slow.fromPlaylist) {
          if (!v.videoId) continue;
          if (!merged.has(v.videoId)) {
            merged.set(v.videoId, v);
          }
        }
        for (const v of fromPlaylistFast) {
          if (!v.videoId) continue;
          if (!merged.has(v.videoId)) {
            merged.set(v.videoId, v);
          }
        }
        const all = Array.from(merged.values())
          .sort((a, b) => b.publishedAt - a.publishedAt)
          .slice(0, 15);
        return { ok: true, videos: all };
      }
    }

    // If slow path was throttled, just return fast path results
    const merged = new Map();
    for (const v of fromPlaylistFast) {
      if (!v.videoId) continue;
      merged.set(v.videoId, v);
    }
    const all = Array.from(merged.values())
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, 15);
    return { ok: true, videos: all };
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

function navigateTab(webSocketDebuggerUrl, url) {
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
        method: 'Page.navigate',
        params: {
          url: url
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

const resolvedChannelCache = new Map(); // '@handle' -> 'UC...'
const lastChannelPollTime = new Map();  // 'UC...' -> timestamp (ms)
const channelLastVideos = new Map();    // 'UC...' -> videos list

function extractChannelHandleOrId(url) {
  if (!url) return null;
  let match = url.match(/youtube\.com\/channel\/(UC[\w-]{20,})/);
  if (match) return match[1];
  match = url.match(/youtube\.com\/@([\w.-]+)/);
  if (match) return '@' + match[1].toLowerCase();
  match = url.match(/youtube\.com\/c\/([\w.-]+)/);
  if (match) return '@' + match[1].toLowerCase();
  return null;
}

async function checkChromeChannelTabs(pollIntervalMs) {
  try {
    const tabs = await httpGetJson('http://127.0.0.1:9222/json');
    
    const now = Date.now();
    const channelTabs = [];
    const activeIds = new Set(tabs.map(t => t.id));
    
    // Clean up closed tabs
    for (const id in tabReloads) {
      if (!activeIds.has(id)) {
        delete tabReloads[id];
      }
    }

    for (const tab of tabs) {
      if (tab.type !== 'page') continue;
      const url = tab.url || '';
      const isYoutube = url.includes('youtube.com/@') || url.includes('youtube.com/channel/');
      
      if (isYoutube) {
        if (!tabReloads[tab.id]) {
          tabReloads[tab.id] = {
            lastReload: now,
            status: 'unknown',
            lastLoadedTime: 0,
            url: url
          };
        } else {
          tabReloads[tab.id].url = url;
        }
        channelTabs.push({ ...tab, isErrorPage: false });
      } else if (url.includes('chrome-error://') || url === 'about:blank' || url === '') {
        if (tabReloads[tab.id]) {
          const recoveredTab = { ...tab, url: tabReloads[tab.id].url, isErrorPage: true };
          channelTabs.push(recoveredTab);
        }
      }
    }
    
    if (channelTabs.length === 0) return [];

    const detected = [];
    
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
          } catch (_) {
            // Ignore resolution errors
          }
        }
      }
      
      if (!channelId) continue;

      const tabId = tab.id;
      if (!tabReloads[tabId]) {
        tabReloads[tabId] = {
          lastReload: now,
          status: 'unknown',
          lastLoadedTime: 0
        };
      }
      
      let readyState = 'loading';
      if (tab.webSocketDebuggerUrl) {
        try {
          readyState = await evaluateInTab(tab.webSocketDebuggerUrl, 'document.readyState');
        } catch (_) {
          readyState = 'loading';
        }
      }
      
      const tState = tabReloads[tabId];
      const isErrorPage = tab.isErrorPage;
      
      if (isErrorPage) {
        const timeSinceLastReload = now - tState.lastReload;
        if (timeSinceLastReload >= 10000) {
          tState.status = 'reloading';
          tState.lastReload = now;
          if (tab.webSocketDebuggerUrl) {
            try {
              await navigateTab(tab.webSocketDebuggerUrl, tState.url);
            } catch (_) {
              try {
                await evaluateInTab(tab.webSocketDebuggerUrl, `location.href = ${JSON.stringify(tState.url)}`);
              } catch (_) {}
            }
          }
        }
      } else if (readyState === 'complete') {
        if (tState.status !== 'complete') {
          tState.status = 'complete';
          tState.lastLoadedTime = now;
        }
        
        // Reload every 15 seconds
        const reloadInterval = 15000;
        const shouldReload = (now - tState.lastLoadedTime) >= reloadInterval;
        if (shouldReload) {
          tState.status = 'reloading';
          tState.lastReload = now;
          if (tab.webSocketDebuggerUrl) {
            try {
              await reloadTab(tab.webSocketDebuggerUrl, false);
            } catch (_) {
              try {
                await evaluateInTab(tab.webSocketDebuggerUrl, 'location.reload()');
              } catch (_) {}
            }
          }
        } else {
          // Scrape DOM
          if (tab.webSocketDebuggerUrl) {
            try {
              const domVideos = await evaluateInTab(tab.webSocketDebuggerUrl, `
                (() => {
                  try {
                    const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, yt-lockup-view-model, ytd-compact-video-renderer'));
                    const foundMap = {};
                    
                    const processLink = (a, relativeText) => {
                      const href = a.getAttribute('href') || '';
                      const m = href.match(/(?:\\?v=|\\/shorts\\/)([a-zA-Z0-9_-]{11})/);
                      if (m) {
                        const videoId = m[1];
                        let title = '';
                        if (a.id === 'video-title-link' || a.id === 'video-title' || a.classList.contains('yt-simple-endpoint')) {
                          title = a.textContent?.trim() || a.getAttribute('title')?.trim() || '';
                        }
                        if (!title) {
                          const titleEl = a.querySelector('#video-title') || a.querySelector('span#video-title');
                          if (titleEl) {
                            title = titleEl.textContent?.trim() || '';
                          }
                        }
                        if (!title && a.getAttribute('title')) {
                          title = a.getAttribute('title').trim();
                        }
                        if (!title && a.id !== 'thumbnail' && !a.querySelector('img') && !a.querySelector('yt-image')) {
                          title = a.textContent?.trim() || '';
                        }
                        if (title) {
                          title = title.replace(/\\s+/g, ' ');
                          if (!/^\\d{1,2}:\\d{2}(:\\d{2})?$/.test(title)) {
                            if (!foundMap[videoId] || title.length > foundMap[videoId].title.length) {
                              foundMap[videoId] = { title, relativeText: relativeText || '' };
                            }
                          }
                        }
                      }
                    };

                    for (const item of items) {
                      const a = item.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
                      if (!a) continue;
                      
                      let relativeText = '';
                      const metaSpans = Array.from(item.querySelectorAll('#metadata-line span, .inline-metadata-item, #metadata span'));
                      for (const span of metaSpans) {
                        const txt = span.textContent || '';
                        if (/ago|trước|giây|phút|giờ|ngày|tuần|tháng|năm|second|minute|hour|day|week|month|year|now|xong|mới|đăng/i.test(txt)) {
                          relativeText = txt.trim();
                          break;
                        }
                      }
                      processLink(a, relativeText);
                    }

                    const allLinks = Array.from(document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]'));
                    for (const a of allLinks) {
                      const href = a.getAttribute('href') || '';
                      const m = href.match(/(?:\\?v=|\\/shorts\\/)([a-zA-Z0-9_-]{11})/);
                      if (m && !foundMap[m[1]]) {
                        let relativeText = '';
                        let parent = a.parentElement;
                        for (let depth = 0; depth < 5 && parent; depth++) {
                          const textContent = parent.textContent || '';
                          const match = textContent.match(/(?:(\\d+)\\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|giây|phút|giờ|ngày|tuần|tháng|năm)\\b)|just now|now|vừa xong|vừa mới|mới đăng/i);
                          if (match) {
                            relativeText = match[0];
                            break;
                          }
                          parent = parent.parentElement;
                        }
                        processLink(a, relativeText);
                      }
                    }

                    return Object.entries(foundMap).map(([videoId, info]) => ({
                      videoId,
                      title: info.title,
                      relativeText: info.relativeText
                    }));
                  } catch (e) {
                    return [];
                  }
                })()
              `);
              if (Array.isArray(domVideos)) {
                for (const v of domVideos) {
                  if (v.videoId) {
                    const publishedAt = parseRelativeTime(v.relativeText);
                    detected.push({
                      videoId: v.videoId,
                      title: v.title,
                      publishedAt: publishedAt,
                      channelId: channelId
                    });
                  }
                }
              }
            } catch (_) {}
          }
        }
      } else {
        tState.status = readyState;
      }
      
      // Throttle background polls for the same channel to once every 2 seconds
      const lastPoll = lastChannelPollTime.get(channelId) || 0;
      let videos = [];
      if (now - lastPoll >= 2000) {
        lastChannelPollTime.set(channelId, now);
        const result = await getLatestVideo(channelId, currentCookie);
        if (result && result.ok && Array.isArray(result.videos)) {
          videos = result.videos;
          channelLastVideos.set(channelId, videos);
        } else {
          videos = channelLastVideos.get(channelId) || [];
        }
      } else {
        videos = channelLastVideos.get(channelId) || [];
      }
      
      for (const v of videos) {
        if (v.videoId) {
          detected.push({
            videoId: v.videoId,
            title: v.title,
            publishedAt: v.publishedAt,
            channelId: channelId
          });
        }
      }
    }
    
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
