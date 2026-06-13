// innertube_helper.js — Spawned by Rust InnertubeClient for youtubei.js v17
// JSON-RPC: stdin requests -> stdout OR temp file responses
// v4 — Persistent daemon mode for fast polling + LockupView extraction + handle→UC ID resolution

const { Innertube } = require('youtubei.js');

let yt = null;
let currentCookie = '';

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
    return items.slice(0, 15).map(item => {
      const lv = item.lockupViewModel;
      if (!lv) return null;
      const videoId = lv.contentId;
      const title = lv.metadata?.lockupMetadataViewModel?.title?.content || '';
      const publishedAt = extractPublishedAtFromLockup(lv);
      const durationSec = extractDurationFromLockup(lv);
      return { videoId, title, publishedAt, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, durationSec };
    }).filter(v => v !== null);
  } catch (_) { return []; }
}

async function getLatestVideo(channelId, cookieStr) {
  try {
    // Resolve channel ID synchronously if already UC format (common case)
    const isUC = channelId.startsWith('UC') && channelId.length >= 22;
    
    // Phase 1: Fast HTTP-only strategies (no YouTube.js needed if UC format)
    // These are simple fetch() calls that complete in <2s
    const fastId = isUC ? channelId : null;
    
    const fastPromise = fastId ? Promise.all([
      strategyRSS(fastId, cookieStr),
      strategyPlaylistHTML(fastId, cookieStr),
    ]) : Promise.resolve([[], []]);
    
    // Phase 2: Slow YouTube.js strategies (run in parallel with fast path)
    const slowPromise = (async () => {
      try {
        const client = await ensureClient(cookieStr);
        const resolvedId = isUC ? channelId : await resolveChannelId(client, channelId);
        const channel = await client.getChannel(resolvedId);
        const [fromGetVids, fromSearch] = await Promise.all([
          strategyGetVideos(channel),
          strategySearch(channel),
        ]);
        // If we didn't run fast strategies (non-UC), also run them now
        if (!fastId) {
          const [fromRSS, fromPlaylist] = await Promise.all([
            strategyRSS(resolvedId, cookieStr),
            strategyPlaylistHTML(resolvedId, cookieStr),
          ]);
          return { fromGetVids, fromSearch, fromRSS, fromPlaylist, resolvedId };
        }
        return { fromGetVids, fromSearch, fromRSS: [], fromPlaylist: [], resolvedId };
      } catch (e) {
        return { fromGetVids: [], fromSearch: [], fromRSS: [], fromPlaylist: [], resolvedId: channelId };
      }
    })();

    // Wait for fast strategies first (they should complete in <2s)
    const [fromRSSFast, fromPlaylistFast] = await fastPromise;
    
    // If fast strategies got results, return immediately — don't wait for slow path
    if (fromRSSFast.length > 0 || fromPlaylistFast.length > 0) {
      const merged = new Map();
      for (const v of fromRSSFast) {
        if (!v.videoId) continue;
        merged.set(v.videoId, v);
      }
      // Safely merge playlist results
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
    
    // Fast strategies returned nothing — wait for slow YouTube.js path
    const slow = await slowPromise;
    const merged = new Map();
    for (const v of [...slow.fromGetVids, ...slow.fromSearch, ...slow.fromRSS]) {
      if (!v.videoId) continue;
      const existing = merged.get(v.videoId);
      if (!existing || v.publishedAt > existing.publishedAt) {
        merged.set(v.videoId, v);
      }
    }
    // Merge playlist results from slow path
    for (const v of slow.fromPlaylist) {
      if (!v.videoId) continue;
      if (!merged.has(v.videoId)) {
        merged.set(v.videoId, v);
      }
    }
    // Also merge fast playlist results if they exist
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

async function checkChromeChannelTabs() {
  try {
    const res = await fetch('http://127.0.0.1:9222/json');
    if (!res.ok) return [];
    const tabs = await res.json();
    
    const channelTabs = tabs.filter(tab => {
      if (tab.type !== 'page') return false;
      const url = tab.url || '';
      return url.includes('youtube.com/@') || url.includes('youtube.com/channel/');
    });
    
    if (channelTabs.length === 0) return [];
    
    const detected = [];
    const now = Date.now();
    
    await Promise.all(channelTabs.map(async (tab) => {
      if (!tab.webSocketDebuggerUrl) return;
      
      const tabId = tab.id;
      if (!tabReloads[tabId]) {
        tabReloads[tabId] = {
          lastReload: 0,
          status: 'unknown',
          lastLoadedTime: 0
        };
      }
      
      let readyState = 'loading';
      try {
        readyState = await evaluateInTab(tab.webSocketDebuggerUrl, 'document.readyState');
      } catch (_) {
        readyState = 'loading';
      }
      
      const tState = tabReloads[tabId];
      
      if (readyState === 'complete') {
        if (tState.status !== 'complete') {
          tState.status = 'complete';
          tState.lastLoadedTime = now;
        }
        
        // Reload every 12 seconds after the page has been fully loaded/complete
        const shouldReload = (now - tState.lastLoadedTime) > 12000;
        
        if (shouldReload) {
          try {
            await reloadTab(tab.webSocketDebuggerUrl, true);
            tState.status = 'reloading';
            tState.lastReload = now;
          } catch (_) {
            try {
              await evaluateInTab(tab.webSocketDebuggerUrl, 'location.reload()');
              tState.status = 'reloading';
              tState.lastReload = now;
            } catch (_) {}
          }
        } else {
          try {
            const videos = await evaluateInTab(tab.webSocketDebuggerUrl, `
              (() => {
                try {
                  const links = Array.from(document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]'));
                  const foundMap = {};
                  for (const a of links) {
                    const href = a.getAttribute('href') || '';
                    const m = href.match(/(?:\\?v=|\\/shorts\\/)([a-zA-Z0-9_-]{11})/);
                    if (m) {
                      const videoId = m[1];
                      let title = '';
                      
                      // 1. Check if the anchor itself is the title link
                      if (a.id === 'video-title-link' || a.id === 'video-title' || a.classList.contains('yt-simple-endpoint')) {
                        title = a.textContent?.trim() || a.getAttribute('title')?.trim() || '';
                      }
                      
                      // 2. Check inside the anchor if it has a title element
                      if (!title) {
                        const titleEl = a.querySelector('#video-title') || a.querySelector('span#video-title');
                        if (titleEl) {
                          title = titleEl.textContent?.trim() || '';
                        }
                      }
                      
                      // 3. Fallback to title attribute
                      if (!title && a.getAttribute('title')) {
                        title = a.getAttribute('title').trim();
                      }
                      
                      // 4. General fallback if not a known thumbnail element
                      if (!title && a.id !== 'thumbnail' && !a.querySelector('img') && !a.querySelector('yt-image')) {
                        title = a.textContent?.trim() || '';
                      }
                      
                      if (title) {
                        title = title.replace(/\\s+/g, ' ');
                        // Filter out duration overlay text (e.g. 10:47, 1:23)
                        if (!/^\\d{1,2}:\\d{2}(:\\d{2})?$/.test(title)) {
                          // Keep the longest/best title if we find duplicates
                          if (!foundMap[videoId] || title.length > foundMap[videoId].length) {
                            foundMap[videoId] = title;
                          }
                        }
                      }
                    }
                  }
                  return Object.entries(foundMap).map(([videoId, title]) => ({ videoId, title }));
                } catch (e) {
                  return [];
                }
              })()
            `);
            if (Array.isArray(videos)) {
              for (const v of videos) {
                if (v.videoId) {
                  detected.push(v);
                }
              }
            }
          } catch (_) {}
        }
      } else {
        tState.status = readyState;
      }
    }));
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
          checkChromeChannelTabs().then(videos => {
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
