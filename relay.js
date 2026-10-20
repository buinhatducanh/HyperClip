#!/usr/bin/env node
// source/relay/relay.js — HyperClip WebSub Relay (dựng lại 28/08)
//
// Vai trò: desktop app không nhận được callback công khai của hub PubSubHubbub
// (NAT), nên relay này giữ callback công khai và đẩy chuông về app qua SSE.
//
//   YouTube hub (pubsubhubbub.appspot.com)
//        │  POST Atom XML (video mới)            GET hub.challenge (verify)
//        ▼                                       ▲
//   [relay:/callback] ──────────────────────────┘
//        │ broadcast JSON
//        ▼
//   [relay:/events]  ◄── SSE ── hyperclip-tauri.exe (websub_client)
//   [relay:/subscribe] ◄─ POST {"channels":["UC…"]} ── app đồng bộ kênh
//
// WIRE FORMAT — khớp binary khách 0e743c3 (đối chiếu strings + log sống 28/08):
//   POST /subscribe  body {"channels":["UC…",…]}  → {"ok":true,"added":N,"total":M}
//   GET  /events     SSE, mỗi chuông một dòng data: JSON
//        {"kind":"new-video","channelId":"UC…","videoId":"…","title":"…",
//         "publishedAtMs":<ms>,"receivedAtMs":<ms>}
//   Authorization: Bearer <token>  (chỉ kiểm khi đặt biến môi trường TOKEN)
//
// Chạy: PUBLIC_URL=https://relay.hyperclip.id.vn node relay.js
// Biến môi trường:
//   PORT        cổng nghe (mặc định 8787)
//   PUBLIC_URL  URL công khai của relay (BẮT BUỘC — hub gọi về <PUBLIC_URL>/callback)
//   TOKEN       nếu đặt: /subscribe + /events yêu cầu Bearer token này
//   HUB_SECRET  nếu đặt: dùng làm hub.secret, verify X-Hub-Signature từng notify
//   HUB_URL     override hub (mặc định https://pubsubhubbub.appspot.com/subscribe)
//   STATE_FILE  đường dẫn file state (mặc định ./relay-state.json)
// Node >= 18 (fetch có sẵn), không dependency ngoài.

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN || '';
const HUB_SECRET = process.env.HUB_SECRET || '';
const HUB_URL = process.env.HUB_URL || 'https://pubsubhubbub.appspot.com/subscribe';
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'relay-state.json');

// YouTube hub: lease tối đa ~10 ngày. Xin trần; gia hạn khi còn < 24h.
const LEASE_SECONDS = 828000;
const RENEW_MARGIN_MS = 24 * 3600 * 1000;
const RENEW_SWEEP_MS = 60 * 60 * 1000;
const SSE_PING_MS = 25 * 1000;

if (!PUBLIC_URL) {
  console.error('[relay] THIẾU PUBLIC_URL — hub cần URL công khai để gọi về /callback. Ví dụ: PUBLIC_URL=https://relay.hyperclip.id.vn');
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// Lưới an toàn tầng process: một request/promise hỏng KHÔNG được kéo sập cả
// relay — sập là mọi client SSE mất chuông cho tới khi ai đó dựng lại.
process.on('unhandledRejection', (e) => log('[relay] unhandledRejection:', e && (e.stack || e.message || e)));
process.on('uncaughtException', (e) => log('[relay] uncaughtException:', e && (e.stack || e.message || e)));

// Đổi PUBLIC_URL/HUB_SECRET là các subscription cũ ở hub thành vô dụng (hub
// ký/gọi theo giá trị lúc đăng ký) — fingerprint đổi thì coi mọi lease là
// hết hạn để boot đăng ký lại toàn bộ, thay vì im lặng mất chuông tới 10 ngày.
const CONFIG_SIG = crypto.createHash('sha256').update(`${PUBLIC_URL}|${HUB_SECRET}`).digest('hex');

// ── State: UC id → { leaseUntil (ms), lastNotifyAt } ─────────────────────────
let channels = new Map();
try {
  const text = fs.readFileSync(STATE_FILE, 'utf8');
  try {
    const raw = JSON.parse(text);
    for (const [k, v] of Object.entries(raw.channels || {})) channels.set(k, v);
    if (raw.configSig !== CONFIG_SIG) {
      for (const v of channels.values()) delete v.leaseUntil;
      log('[relay] PUBLIC_URL/HUB_SECRET đã đổi — coi mọi lease hết hạn, boot sẽ đăng ký lại');
    }
    log(`[relay] Nạp ${channels.size} kênh từ ${STATE_FILE}`);
  } catch (e) {
    // File có nội dung nhưng hỏng (chết giữa lần ghi cũ) — giữ lại làm bằng
    // chứng thay vì lặng lẽ xoá trắng danh sách kênh.
    fs.renameSync(STATE_FILE, STATE_FILE + '.corrupt');
    log(`[relay] State hỏng (${e.message}) — đã đổi tên thành .corrupt, bắt đầu rỗng; app sẽ re-sync kênh`);
  }
} catch (_) { /* chưa có state — bắt đầu rỗng */ }

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Ghi NGUYÊN TỬ (tmp + rename): chết giữa lần ghi không để lại file cụt.
    const obj = { configSig: CONFIG_SIG, channels: Object.fromEntries(channels) };
    const tmp = STATE_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(obj, null, 2), (e) => {
      if (e) { log('[relay] Ghi state lỗi:', e.message); return; }
      fs.rename(tmp, STATE_FILE, (e2) => { if (e2) log('[relay] Rename state lỗi:', e2.message); });
    });
  }, 500);
  saveTimer.unref?.();
}

// ── SSE clients ──────────────────────────────────────────────────────────────
const sseClients = new Set();
function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(line); } catch (_) { sseClients.delete(res); }
  }
}
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': ping\n\n'); } catch (_) { sseClients.delete(res); }
  }
}, SSE_PING_MS).unref();

// ── Dedupe videoId gần đây (hub gửi lại notify khi video sửa metadata) ──────
const seenVideos = new Map(); // videoId → ts
function seenRecently(videoId) {
  const now = Date.now();
  if (seenVideos.size > 1000) {
    for (const [k, t] of seenVideos) if (now - t > 6 * 3600 * 1000) seenVideos.delete(k);
  }
  if (seenVideos.has(videoId)) return true;
  seenVideos.set(videoId, now);
  return false;
}

// ── Hub subscribe/renew ──────────────────────────────────────────────────────
async function hubSubscribe(uc, mode = 'subscribe') {
  const topic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${uc}`;
  const body = new URLSearchParams({
    'hub.callback': `${PUBLIC_URL}/callback`,
    'hub.mode': mode,
    'hub.topic': topic,
    'hub.verify': 'async',
    'hub.lease_seconds': String(LEASE_SECONDS),
  });
  if (HUB_SECRET) body.set('hub.secret', HUB_SECRET);
  const resp = await fetch(HUB_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  // Hub trả 202 khi nhận yêu cầu; verify đến sau qua GET /callback.
  if (resp.status !== 202 && resp.status !== 204) {
    throw new Error(`hub ${mode} ${uc}: HTTP ${resp.status} ${(await resp.text()).slice(0, 120)}`);
  }
}

async function subscribeNew(ucs) {
  for (const uc of ucs) {
    try {
      await hubSubscribe(uc);
      log(`[hub] Đăng ký ${uc} (chờ verify)`);
    } catch (e) {
      // Không xoá kênh — vòng renew sẽ thử lại; app cũng re-sync mỗi lần nối.
      log(`[hub] Đăng ký ${uc} lỗi: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 150)); // không đập hub một chùm
  }
}

setInterval(() => {
  const now = Date.now();
  const due = [...channels.entries()]
    .filter(([, v]) => !v.leaseUntil || v.leaseUntil - now < RENEW_MARGIN_MS)
    .map(([k]) => k);
  if (due.length) {
    log(`[hub] Gia hạn ${due.length} kênh (lease sắp hết / chưa verify)`);
    subscribeNew(due);
  }
}, RENEW_SWEEP_MS).unref();

// ── Helpers ──────────────────────────────────────────────────────────────────
function authorized(req, url) {
  if (!TOKEN) return true;
  const h = req.headers['authorization'] || '';
  if (h === `Bearer ${TOKEN}`) return true;
  return url.searchParams.get('token') === TOKEN;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}

// Parse Atom notify của YouTube hub — chỉ cần 4 trường, regex đủ và không kéo
// thêm dependency. Notify "xoá video" dùng <at:deleted-entry> (không có
// <entry>) nên vòng dưới tự trả rỗng — không cần chặn theo chuỗi con, chặn
// kiểu đó từng có thể nuốt oan entry thật khi title chứa chữ "deleted-entry".
function parseAtomEntries(xml) {
  const out = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const e = m[1];
    const pick = (re) => { const r = re.exec(e); return r ? r[1].trim() : ''; };
    const videoId = pick(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const channelId = pick(/<yt:channelId>([^<]+)<\/yt:channelId>/);
    if (!videoId || !channelId) continue;
    // &amp; giải MÃ CUỐI CÙNG — giải trước là "&amp;lt;" (title chứa chữ "&lt;"
    // thật) bị decode hai tầng thành "<".
    const title = pick(/<title>([\s\S]*?)<\/title>/)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const published = pick(/<published>([^<]+)<\/published>/);
    out.push({ videoId, channelId, title, publishedAtMs: Date.parse(published) || Date.now() });
  }
  return out;
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // Parse URL trong guard: request target dị dạng (vd `GET http:// HTTP/1.1`)
  // làm `new URL` throw — không guard là unhandled rejection GIẾT CẢ PROCESS
  // (Node 15+), ai với tới origin cũng bắn sập được relay không cần auth.
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); }
  catch (_) { res.writeHead(400); res.end(); return; }
  try {
    // Hub verify: GET /callback?hub.challenge=…&hub.mode=…&hub.topic=…
    // WebSub §5.3: chỉ echo challenge cho hành động MÌNH đã yêu cầu, còn lại
    // 404. Hub công cộng cho BẤT KỲ AI nộp subscribe/unsubscribe hộ callback
    // này — echo mù thì kẻ lạ unsubscribe được kênh của ta (mất chuông im
    // lặng tới ~10 ngày) hoặc nhét kênh rác vào state.
    if (req.method === 'GET' && url.pathname === '/callback') {
      const challenge = url.searchParams.get('hub.challenge');
      if (!challenge) { res.writeHead(400); res.end(); return; }
      const topic = url.searchParams.get('hub.topic') || '';
      const mode = url.searchParams.get('hub.mode') || '';
      const lease = Number(url.searchParams.get('hub.lease_seconds') || LEASE_SECONDS);
      const uc = /channel_id=(UC[\w-]{22})$/.exec(topic)?.[1];
      if (mode !== 'subscribe' || !uc || !channels.has(uc)
          || topic !== `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${uc}`) {
        // Relay không bao giờ tự gửi unsubscribe → mọi verify unsubscribe là
        // của kẻ khác: 404 để hub GIỮ subscription.
        log(`[hub] Từ chối verify lạ (mode=${mode}, topic=${topic.slice(0, 90)})`);
        res.writeHead(404); res.end();
        return;
      }
      channels.set(uc, { ...channels.get(uc), leaseUntil: Date.now() + lease * 1000 });
      saveState();
      log(`[hub] Verify OK ${uc} — lease ${Math.round(lease / 3600)}h`);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
      return;
    }

    // Hub notify: POST /callback (Atom XML)
    if (req.method === 'POST' && url.pathname === '/callback') {
      const body = await readBody(req);
      if (HUB_SECRET) {
        const sig = (req.headers['x-hub-signature'] || '').toString();
        const want = 'sha1=' + crypto.createHmac('sha1', HUB_SECRET).update(body).digest('hex');
        const a = Buffer.from(sig), b = Buffer.from(want);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          log('[hub] Notify SAI chữ ký — bỏ');
          res.writeHead(202); res.end(); // vẫn 2xx để hub không huỷ sub
          return;
        }
      }
      const receivedAtMs = Date.now();
      for (const e of parseAtomEntries(body.toString('utf8'))) {
        // Notify lặp lại khi video sửa metadata — chỉ chuông lần đầu, và chỉ
        // chuông video MỚI (đăng trong 30 phút): notify backlog cũ không đáng
        // đánh thức app.
        if (seenRecently(e.videoId)) continue;
        if (receivedAtMs - e.publishedAtMs > 30 * 60 * 1000) continue;
        const ch = channels.get(e.channelId);
        if (ch) { ch.lastNotifyAt = receivedAtMs; saveState(); }
        const event = { kind: 'new-video', ...e, receivedAtMs };
        log(`[bell] ${e.channelId} ${e.videoId} "${e.title.slice(0, 60)}" (+${((receivedAtMs - e.publishedAtMs) / 1000).toFixed(1)}s sau publish) → ${sseClients.size} client`);
        broadcast(event);
      }
      res.writeHead(204); res.end();
      return;
    }

    // App đồng bộ kênh: POST /subscribe. Shape client KHÔNG có spec — nhận
    // rộng: {"channels":[…]} / {"channelIds":[…]} / mảng trần; phần tử là
    // chuỗi UC hoặc object có channelId/id/uc. Không nhận ra kênh nào thì LOG
    // NGUYÊN BODY để đối chiếu shape thật của binary khách (ca 28/08: app
    // "đồng bộ OK" mà relay 0 kênh — ok:true che mất lệch shape).
    if (req.method === 'POST' && url.pathname === '/subscribe') {
      if (!authorized(req, url)) { json(res, 401, { ok: false, error: 'unauthorized' }); return; }
      const raw = (await readBody(req)).toString('utf8');
      let payload;
      try { payload = JSON.parse(raw); }
      catch (_) { json(res, 400, { ok: false, error: 'bad json' }); return; }
      const list = Array.isArray(payload)
        ? payload
        : (payload.channels || payload.channelIds || payload.ids || payload.ucIds || []);
      const ucOf = (x) => {
        if (typeof x === 'string') return x.trim();
        if (x && typeof x === 'object') return String(x.channelId || x.channel_id || x.id || x.uc || x.ucId || '').trim();
        return '';
      };
      let recognized = 0;
      const fresh = [];
      for (const item of (Array.isArray(list) ? list : [])) {
        const uc = ucOf(item);
        if (!/^UC[\w-]{22}$/.test(uc)) continue;
        recognized += 1;
        if (!channels.has(uc)) { channels.set(uc, {}); fresh.push(uc); }
      }
      saveState();
      json(res, 200, { ok: true, added: fresh.length, total: channels.size });
      log(`[relay] App đồng bộ: nhận ${recognized} kênh hợp lệ, +${fresh.length} mới (tổng ${channels.size})`);
      if (recognized === 0) {
        log(`[relay] /subscribe KHÔNG nhận ra kênh nào — body (${raw.length}B): ${raw.slice(0, 400)}`);
      }
      if (fresh.length) subscribeNew(fresh); // chạy nền — response đã trả
      return;
    }

    // App nghe chuông: GET /events (SSE)
    if (req.method === 'GET' && url.pathname === '/events') {
      if (!authorized(req, url)) { json(res, 401, { ok: false, error: 'unauthorized' }); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      log(`[sse] Client nối (${sseClients.size} đang nghe)`);
      req.on('close', () => { sseClients.delete(res); log(`[sse] Client rời (${sseClients.size} còn)`); });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      const now = Date.now();
      const live = [...channels.values()].filter(v => v.leaseUntil > now).length;
      json(res, 200, {
        ok: true, channels: channels.size, leased: live,
        clients: sseClients.size, uptimeSec: Math.round(process.uptime()),
      });
      return;
    }

    res.writeHead(404); res.end();
  } catch (e) {
    log('[relay] Lỗi xử lý request:', e.message);
    try { res.writeHead(500); res.end(); } catch (_) { /* đã đóng */ }
  }
});

server.listen(PORT, () => {
  log(`[relay] Nghe :${PORT} — callback công khai: ${PUBLIC_URL}/callback` +
      (TOKEN ? ' · Bearer BẬT' : ' · Bearer TẮT') +
      (HUB_SECRET ? ' · hub.secret BẬT' : ''));
  // Boot: đăng ký lại mọi kênh chưa có lease sống (server vừa dựng lại /
  // state cũ) — hub verify sẽ điền leaseUntil.
  const now = Date.now();
  const stale = [...channels.entries()].filter(([, v]) => !v.leaseUntil || v.leaseUntil < now).map(([k]) => k);
  if (stale.length) {
    log(`[hub] Boot: đăng ký lại ${stale.length}/${channels.size} kênh hết/chưa có lease`);
    subscribeNew(stale);
  }
});
