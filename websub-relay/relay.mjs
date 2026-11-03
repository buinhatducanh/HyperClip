#!/usr/bin/env node
// tools/websub-relay/relay.mjs
//
// Relay WebSub (PubSubHubbub) của YouTube — Pass 60, giai đoạn ĐO.
//
// Vì sao cần một máy ngoài: hub của Google phải GỌI VÀO được callback, mà máy
// khách nằm sau NAT. Relay này nhận webhook rồi (a) ghi sổ mốc nhận, (b) đẩy
// tiếp cho máy khách qua SSE — máy khách mở kết nối RA nên không cần mở cổng.
//
// Ở giai đoạn đo, phần (a) là đủ để trả lời câu hỏi cần trả lời: ping tới sớm
// hay muộn hơn lúc Data API chịu nhả videoId. Hai sổ (relay + máy khách) ghép
// lại theo `videoId`, và mốc so sánh chung là `published` do CHÍNH YouTube
// đóng dấu trong Atom feed — nhờ vậy lệch đồng hồ giữa hai máy không làm hỏng
// phép so sánh (máy khách 3060 lệch +2h, máy 4070 để UTC-7).
//
// Chỉ dùng thư viện chuẩn của Node — không cài gì thêm, không có gì để hỏng.
//
// Chạy:
//   WEBSUB_PUBLIC_URL=https://relay.example.com \
//   WEBSUB_TOKEN=<chuỗi bí mật dài> \
//   node relay.mjs
//
// Đăng ký kênh (từ máy bất kỳ):
//   curl -X POST https://relay.example.com/subscribe \
//        -H "Authorization: Bearer <WEBSUB_TOKEN>" \
//        -H "Content-Type: application/json" \
//        -d '{"channelIds":["UCxxxx","UCyyyy"]}'

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAtom, parseDeleted, classify } from './relay-parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
// URL công khai của chính relay này — hub gọi ngược vào đây, nên nó PHẢI là
// địa chỉ ngoài internet chứ không phải localhost.
//
// Bỏ trống (hoặc "auto") = TỰ HỎI cloudflared. Quick tunnel đổi hostname MỖI
// lần khởi động lại, và 14/08 đã mất hai vòng vì người vận hành phải chép tay
// URL mới vào lệnh chạy relay — sai một nhịp là hub gọi vào địa chỉ chết mà
// không ai biết. cloudflared có sẵn endpoint metrics trả đúng hostname đó.
let PUBLIC_URL = (process.env.WEBSUB_PUBLIC_URL || '').replace(/\/+$/, '');
const AUTO_URL = !PUBLIC_URL || PUBLIC_URL.toLowerCase() === 'auto';
/// Cổng metrics của cloudflared. Nó tự chọn cổng rảnh khi khởi động nên phải
/// dò vài cổng quanh mặc định thay vì cắm cứng một số.
const CF_METRICS_PORTS = (process.env.CF_METRICS_PORTS || '20241,20242,20243,20244,20245')
  .split(',')
  .map((p) => Number(p.trim()))
  .filter(Boolean);

/// Hỏi cloudflared hostname của quick tunnel đang chạy. `null` nếu không thấy.
async function discoverPublicUrl() {
  for (const p of CF_METRICS_PORTS) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${p}/quicktunnel`, { signal: controller.signal })
        .finally(() => clearTimeout(t));
      if (!res.ok) continue;
      const j = await res.json();
      if (j && j.hostname) return `https://${j.hostname}`;
    } catch { /* cổng không phải cloudflared — thử cổng kế */ }
  }
  return null;
}
// Token bảo vệ các endpoint điều khiển. Không có token = relay mở toang cho
// bất kỳ ai đăng ký kênh và đọc luồng sự kiện.
const TOKEN = process.env.WEBSUB_TOKEN || '';
// Bí mật ký HMAC của hub. Có nó thì mọi POST không đúng chữ ký bị loại — nếu
// không, bất kỳ ai biết URL callback đều bơm được sự kiện giả vào pipeline.
const HUB_SECRET = process.env.WEBSUB_HUB_SECRET || crypto.randomBytes(24).toString('hex');
const HUB_URL = 'https://pubsubhubbub.appspot.com/subscribe';
// Lease tối đa của Google là 10 ngày. Gia hạn ở mốc 4 ngày vì đã có ghi nhận
// subscription chết TRƯỚC hạn (issuetracker 346498602) — chờ tới sát hạn là
// tự nhận một khoảng mù im lặng.
const LEASE_SEC = Number(process.env.WEBSUB_LEASE_SEC || 864000);
const RENEW_EVERY_MS = Number(process.env.WEBSUB_RENEW_MS || 4 * 24 * 3600 * 1000);

const STATE_PATH = path.join(HERE, 'subscriptions.json');
const LOG_PATH = path.join(HERE, 'websub_ledger.jsonl');

// ─── Trạng thái ────────────────────────────────────────────────────────────
/** @type {Set<string>} channel id (UC...) đang đăng ký */
const channels = new Set();
/** @type {Map<string, {lastVerifiedAt:number|null, lastPingAt:number|null, pings:number}>} */
const health = new Map();
/** @type {Set<http.ServerResponse>} máy khách đang nghe SSE */
const listeners = new Set();
/**
 * Chống ping trùng: hub gửi lại khi title/description đổi.
 *
 * Pass 85: SỐNG QUA RESTART (lưu trong subscriptions.json, cắt bớt còn
 * SEEN_KEEP mục mới nhất). Bản RAM cũ mất sạch mỗi lần relay khởi động lại →
 * ping "sửa title" của video cũ thành "MỚI" giả và được broadcast, app phải
 * lọc bằng seen/tuổi — vô hại nhưng nhiễu log và làm sai `firstPing` trong sổ.
 */
const seenVideos = new Map(); // videoId -> firstSeenAt
const SEEN_KEEP = 5000;

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    for (const id of raw.channels || []) {
      channels.add(id);
      health.set(id, { lastVerifiedAt: null, lastPingAt: null, pings: 0 });
    }
    for (const [id, at] of Object.entries(raw.seen || {})) {
      if (typeof at === 'number') seenVideos.set(id, at);
    }
    log(`nạp lại ${channels.size} kênh + ${seenVideos.size} video đã thấy từ ${STATE_PATH}`);
  } catch { /* lần chạy đầu — chưa có file */ }
}

function pruneSeen() {
  if (seenVideos.size <= SEEN_KEEP) return;
  const sorted = [...seenVideos.entries()].sort((a, b) => a[1] - b[1]);
  for (const [id] of sorted.slice(0, seenVideos.size - SEEN_KEEP)) seenVideos.delete(id);
}

function saveState() {
  try {
    pruneSeen();
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({ channels: [...channels], seen: Object.fromEntries(seenVideos) }, null, 2)
    );
  } catch (e) {
    log(`LỖI ghi ${STATE_PATH}: ${e.message}`);
  }
}

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function appendLedger(row) {
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify(row) + '\n');
  } catch (e) {
    log(`LỖI ghi sổ: ${e.message}`);
  }
}

// ─── Đăng ký với hub ───────────────────────────────────────────────────────
function topicFor(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

function hubRequest(channelId, mode) {
  return new Promise((resolve) => {
    if (!PUBLIC_URL) return resolve({ ok: false, error: 'WEBSUB_PUBLIC_URL chưa đặt' });
    const body = new URLSearchParams({
      'hub.mode': mode,
      'hub.topic': topicFor(channelId),
      'hub.callback': `${PUBLIC_URL}/yt-callback`,
      'hub.verify': 'async',
      'hub.secret': HUB_SECRET,
      'hub.lease_seconds': String(LEASE_SEC),
    }).toString();
    const req = https.request(
      HUB_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (res) => {
        res.resume();
        // Hub trả 202 = đã nhận, việc xác minh diễn ra bằng một GET ngược lại.
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end(body);
  });
}

async function subscribeAll(reason) {
  let ok = 0, fail = 0;
  for (const id of channels) {
    const r = await hubRequest(id, 'subscribe');
    if (r.ok) ok++; else { fail++; log(`đăng ký ${id} lỗi: ${r.error || r.status}`); }
    // Không bắn cả trăm request cùng lúc vào hub.
    await new Promise((r2) => setTimeout(r2, 120));
  }
  log(`${reason}: đăng ký ${ok} OK / ${fail} lỗi (tổng ${channels.size} kênh)`);
}

// ─── Đọc Atom feed: parseAtom / parseDeleted / classify — xem relay-parse.mjs ──

function validSignature(header, rawBody) {
  if (!header) return false;
  const [algo, sent] = String(header).split('=');
  if (!algo || !sent) return false;
  let digest;
  try {
    digest = crypto.createHmac(algo, HUB_SECRET).update(rawBody).digest('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(sent, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) {
    try { res.write(payload); } catch { listeners.delete(res); }
  }
}

function authed(req) {
  if (!TOKEN) return false;
  const h = req.headers.authorization || '';
  const got = h.startsWith('Bearer ') ? h.slice(7) : '';
  const a = Buffer.from(got);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── HTTP ──────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Hub xác minh subscription: trả nguyên `hub.challenge` bằng text/plain.
  if (req.method === 'GET' && url.pathname === '/yt-callback') {
    const mode = url.searchParams.get('hub.mode');
    const challenge = url.searchParams.get('hub.challenge');
    const topic = url.searchParams.get('hub.topic') || '';
    const m = topic.match(/channel_id=([\w-]+)/);
    const channelId = m ? m[1] : '';
    if (challenge && (mode === 'subscribe' || mode === 'unsubscribe')) {
      if (mode === 'subscribe' && channelId) {
        const h = health.get(channelId) || { lastVerifiedAt: null, lastPingAt: null, pings: 0 };
        h.lastVerifiedAt = Date.now();
        health.set(channelId, h);
      }
      log(`xác minh ${mode} cho ${channelId || topic}`);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge);
    }
    res.writeHead(404);
    return res.end();
  }

  // Ping thật từ hub.
  if (req.method === 'POST' && url.pathname === '/yt-callback') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const receivedAt = Date.now();
      const raw = Buffer.concat(chunks);
      // Trả 2xx TRƯỚC khi xử lý: hub tính chậm là lỗi và sẽ backoff cả kênh.
      res.writeHead(204);
      res.end();

      if (!validSignature(req.headers['x-hub-signature'], raw)) {
        log('BỎ ping sai chữ ký HMAC');
        return;
      }
      const xml = raw.toString('utf8');
      let dirty = false;
      for (const e of parseAtom(xml)) {
        const first = !seenVideos.has(e.videoId);
        if (first) { seenVideos.set(e.videoId, receivedAt); dirty = true; }
        const publishedMs = Date.parse(e.published) || 0;
        const updatedMs = Date.parse(e.updated) || 0;
        const kind = classify(first);
        const row = {
          // Pass 85: 'upload' | 'edit' — app chỉ nạp upload; edit chỉ để log/sổ.
          kind,
          videoId: e.videoId,
          channelId: e.channelId,
          title: e.title,
          publishedAtMs: publishedMs,
          receivedAtMs: receivedAt,
          // Con số đáng giá nhất của cả relay: ping tới SAU mốc publish do
          // YouTube tự đóng dấu bao lâu. Âm nghĩa là ping tới TRƯỚC khi video
          // công khai (đã có ghi nhận với video hẹn giờ) — không phải lỗi.
          sincePublishedMs: publishedMs ? receivedAt - publishedMs : null,
          // Hiệu updated−published: ytnoti dùng làm tiêu chí upload (<20s);
          // ta chỉ ghi để đối chiếu vì với video upload-lâu nó lên tới phút.
          updatedMinusPublishedMs: publishedMs && updatedMs ? updatedMs - publishedMs : null,
          firstPing: first,
          updatedAt: e.updated,
        };
        appendLedger(row);
        const h = health.get(e.channelId) || { lastVerifiedAt: null, lastPingAt: null, pings: 0 };
        h.lastPingAt = receivedAt;
        h.pings += 1;
        health.set(e.channelId, h);
        log(
          `ping ${e.videoId} (${e.channelId}) ${kind === 'upload' ? 'MỚI' : 'lặp/sửa'} — ` +
          `sau publish ${row.sincePublishedMs === null ? '?' : (row.sincePublishedMs / 1000).toFixed(1) + 's'}`
        );
        // Broadcast CẢ edit (kèm kind) — app tự quyết; bản cũ chỉ đẩy ping đầu
        // nên app không bao giờ biết có video vừa được sửa/đăng lại.
        broadcast(row);
      }
      // Ping XOÁ — Atom tombstone. Không có videoId trong <entry>, đi nhánh riêng.
      for (const d of parseDeleted(xml)) {
        const row = {
          kind: 'delete',
          videoId: d.videoId,
          channelId: d.channelId,
          title: '',
          publishedAtMs: 0,
          receivedAtMs: receivedAt,
          deletedWhen: d.when,
        };
        appendLedger(row);
        log(`ping XOÁ ${d.videoId} (${d.channelId || '?'})`);
        broadcast(row);
      }
      if (dirty) saveState();
    });
    return;
  }

  // Máy khách mở kết nối RA để nghe sự kiện (xuyên NAT).
  if (req.method === 'GET' && url.pathname === '/events') {
    if (!authed(req)) { res.writeHead(401); return res.end('unauthorized'); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      // `no-transform` cấm proxy nén/biến đổi stream — nén là có đệm, có đệm
      // là heartbeat nhỏ không bao giờ tới nơi.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Heartbeat phải ĐỦ TO để xuyên tầng đệm của tunnel/CDN. Bản 25-byte cũ
    // bị Cloudflare gom đệm: app không nhận được gì suốt 90s → tự ngắt nối
    // lại mỗi ~93s, cloudflared in "context canceled" tràn log (14/08 14:05→
    // 14:16, đều tăm tắp). 2KB mỗi 25s ≈ 7MB/ngày/listener — không đáng kể,
    // đổi lấy kết nối sống thật.
    const PAD = ': ' + 'h'.repeat(2048) + '\n\n';
    res.write(': connected\n' + PAD);
    listeners.add(res);
    const beat = setInterval(() => {
      try { res.write(PAD); } catch { /* dọn ở close */ }
    }, 25000);
    req.on('close', () => { clearInterval(beat); listeners.delete(res); });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/subscribe') {
    if (!authed(req)) { res.writeHead(401); return res.end('unauthorized'); }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let ids = [];
      try {
        ids = JSON.parse(Buffer.concat(chunks).toString('utf8')).channelIds || [];
      } catch {
        res.writeHead(400); return res.end('json không hợp lệ');
      }
      const added = [];
      for (const id of ids) {
        if (/^UC[\w-]{20,}$/.test(id) && !channels.has(id)) {
          channels.add(id);
          health.set(id, { lastVerifiedAt: null, lastPingAt: null, pings: 0 });
          added.push(id);
        }
      }
      saveState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, added: added.length, total: channels.size }));
      for (const id of added) {
        await hubRequest(id, 'subscribe');
        await new Promise((r) => setTimeout(r, 120));
      }
      log(`thêm ${added.length} kênh (tổng ${channels.size})`);
    });
    return;
  }

  // Sức khoẻ: kênh nào đã xác minh, kênh nào chưa từng có ping. Kênh "đã xác
  // minh nhưng chưa ping bao giờ" sau vài ngày là dấu hiệu subscription chết
  // âm thầm — đúng cái bẫy đã có người báo trên issue tracker.
  if (req.method === 'GET' && url.pathname === '/health') {
    if (!authed(req)) { res.writeHead(401); return res.end('unauthorized'); }
    const rows = [...channels].map((id) => ({ channelId: id, ...(health.get(id) || {}) }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      publicUrl: PUBLIC_URL,
      channels: channels.size,
      listeners: listeners.size,
      verified: rows.filter((r) => r.lastVerifiedAt).length,
      neverPinged: rows.filter((r) => !r.lastPingAt).length,
      rows,
    }, null, 2));
  }

  res.writeHead(404);
  res.end();
});

loadState();
if (!TOKEN) {
  log('CẢNH BÁO: chưa đặt WEBSUB_TOKEN — /subscribe, /events, /health sẽ từ chối mọi request.');
}
if (!PUBLIC_URL) {
  log('CẢNH BÁO: chưa đặt WEBSUB_PUBLIC_URL — không đăng ký được với hub.');
}
server.listen(PORT, async () => {
  if (AUTO_URL) {
    const found = await discoverPublicUrl();
    if (found) {
      PUBLIC_URL = found;
      log(`tự dò cloudflared → ${PUBLIC_URL}`);
    } else {
      log('KHÔNG dò được cloudflared — đặt WEBSUB_PUBLIC_URL tay, hoặc bật cloudflared trước rồi chạy lại relay.');
    }
  }
  log(`relay nghe cổng ${PORT}; callback = ${PUBLIC_URL || '(chưa đặt)'}/yt-callback`);
  if (channels.size) subscribeAll('khởi động');
  setInterval(() => subscribeAll('gia hạn định kỳ'), RENEW_EVERY_MS);

  // Quick tunnel đổi hostname mỗi lần cloudflared khởi động lại. Không canh
  // thì subscription trỏ vào địa chỉ chết và im lặng — đúng chế độ hỏng đắt
  // nhất của WebSub. Thấy đổi là đăng ký lại NGAY với callback mới.
  if (AUTO_URL) {
    setInterval(async () => {
      const cur = await discoverPublicUrl();
      if (cur && cur !== PUBLIC_URL) {
        log(`*** URL tunnel ĐỔI: ${PUBLIC_URL} → ${cur} — đăng ký lại toàn bộ`);
        PUBLIC_URL = cur;
        for (const id of channels) health.set(id, {
          ...(health.get(id) || { lastPingAt: null, pings: 0 }),
          lastVerifiedAt: null,
        });
        subscribeAll('URL tunnel đổi');
      }
    }, 30_000);
  }
});
