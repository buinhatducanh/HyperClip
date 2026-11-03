// crates/hyperclip_ipc/src/watch_probe_helper.js
//
// Pass 80 — NHÂN CHỨNG ĐỘC LẬP cho mốc giờ đăng (operator chốt 15/08).
//
// Mở ĐÚNG MỘT cửa sổ Chrome lúc app khởi động, giữ sống suốt phiên. Mỗi khi
// đường API bắt được video, mở đúng trang watch của video đó, đọc mốc giờ mà
// CHÍNH TRANG WEB hiển thị, rồi trả về cho Rust đối khớp với con số app đang
// dùng. Chỉ ĐO — không nạp video, không phát sự kiện (tinh thần INVARIANT #31).
//
// Vì sao là nhân chứng: app suy giờ đăng từ 4 nguồn khác nhau (playlistItems,
// activities, nhãn tương đối của Innertube, WebSub). Trang watch là thứ KHÁCH
// nhìn, nên nó là trọng tài cho câu "app nói 2,1s mà web nói 3,6 phút".
//
// Giao thức: JSON-RPC theo dòng qua stdin/stdout, y hệt tiktok_helper.js.
//   ← {"id":1,"cmd":"open"}                  mở cửa sổ (idempotent)
//   ← {"id":2,"cmd":"probe","videoId":"..."}  soi 1 video
//   → {"id":2,"ok":true,"result":{...}}
'use strict';

const path = require('path');

let chromium = null;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  process.stderr.write(`[watch-probe] playwright-core không nạp được: ${e.message}\n`);
}

const USER_DATA_DIR =
  process.env.WATCH_PROBE_PROFILE ||
  path.join(process.cwd(), '.hyperclip', 'watch-probe-profile');

let ctx = null;
let page = null;
let opening = null;

function log(msg) {
  process.stderr.write(`[watch-probe] ${msg}\n`);
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// Một cửa sổ DUY NHẤT, user-data-dir RIÊNG.
//
// Vì sao không dùng chung profile với Chrome đăng nhập (port 9222): Chrome
// single-instance sẽ bàn giao sang tiến trình cũ rồi tự thoát, ta mất quyền
// điều khiển cửa sổ. Bẫy này đã ghi ở commands.rs:4070. Trang watch là dữ liệu
// công khai nên profile trắng đọc vẫn đủ.
async function ensureWindow() {
  if (ctx && page && !page.isClosed()) return;
  if (opening) return opening;
  if (!chromium) throw new Error('PLAYWRIGHT_MISSING');

  opening = (async () => {
    ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
      channel: 'chrome',
      headless: true,
      viewport: null,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--mute-audio',
      ],
    });
    const pages = ctx.pages();
    page = pages.length ? pages[0] : await ctx.newPage();
    // Chặn ảnh/media/font: chỉ cần HTML + JSON khởi tạo, và trang watch tải
    // video thật thì tốn băng thông đúng lúc app đang tải bản gốc.
    await page.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 });
    log(`cửa sổ sẵn sàng (profile ${USER_DATA_DIR}, headless)`);
  })();

  try {
    await opening;
  } finally {
    opening = null;
  }
}

// Trích MỌI mốc giờ trang watch mang theo, kèm mốc giờ máy lúc đọc.
//
// `readAtMs` là mấu chốt: nhãn tương đối ("2 giây trước") chỉ có nghĩa khi biết
// nó được đọc lúc nào. Rust dựng lại giờ đăng = readAtMs − giá_trị_nhãn.
const EXTRACT = () => {
  const out = { readAtMs: Date.now() };
  // Mốc NHÃN được tính: server nướng "X giây trước" vào HTML lúc trả response,
  // KHÔNG phải lúc ta đọc DOM. Dùng readAtMs làm mốc là cộng oan cả khoảng
  // parse/render (~0,5-1s) vào tuổi video. responseStart của chính điều hướng
  // này (page.goto là full navigation) mới là mốc đúng.
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && nav.responseStart > 0) {
      const anchor = Math.round(performance.timeOrigin + nav.responseStart);
      // Phòng SPA/entry cũ: mốc lệch quá 30s so với hiện tại thì bỏ.
      if (Math.abs(Date.now() - anchor) < 30000) out.labelAnchorMs = anchor;
    }
  } catch (e) {
    out.errNav = String(e && e.message ? e.message : e);
  }
  try {
    const pr = window.ytInitialPlayerResponse;
    const mf = pr && pr.microformat && pr.microformat.playerMicroformatRenderer;
    if (mf) {
      out.publishDate = mf.publishDate || null;
      out.uploadDate = mf.uploadDate || null;
      out.liveStart =
        (mf.liveBroadcastDetails && mf.liveBroadcastDetails.startTimestamp) || null;
    }
    const vd = pr && pr.videoDetails;
    if (vd) {
      out.title = vd.title || null;
      out.isLiveContent = !!vd.isLiveContent;
    }
  } catch (e) {
    out.errPlayer = String(e && e.message ? e.message : e);
  }
  try {
    const d = window.ytInitialData;
    const contents =
      (d && d.contents && d.contents.twoColumnWatchNextResults &&
        d.contents.twoColumnWatchNextResults.results &&
        d.contents.twoColumnWatchNextResults.results.results &&
        d.contents.twoColumnWatchNextResults.results.results.contents) || [];
    for (const c of contents) {
      const p = c && c.videoPrimaryInfoRenderer;
      if (p) {
        out.dateText = (p.dateText && p.dateText.simpleText) || null;
        out.relativeDateText =
          (p.relativeDateText && p.relativeDateText.simpleText) || null;
        break;
      }
    }
  } catch (e) {
    out.errData = String(e && e.message ? e.message : e);
  }
  // Chuỗi MẮT NGƯỜI ĐỌC — đây mới là thứ khách so sánh với app.
  try {
    const sels = [
      'ytd-video-primary-info-renderer #info-strings yt-formatted-string',
      '#info-strings yt-formatted-string',
      '#description-inner #info-container yt-formatted-string',
      'ytd-watch-info-text #info',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.textContent && el.textContent.trim()) {
        out.domText = el.textContent.trim().slice(0, 200);
        break;
      }
    }
  } catch (e) {
    out.errDom = String(e && e.message ? e.message : e);
  }
  return out;
};

async function probe(videoId) {
  await ensureWindow();
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const navStart = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  // ytInitialData được gắn trong HTML nên domcontentloaded là đủ; chỉ đợi thêm
  // khi phần DOM hiển thị chưa kịp dựng.
  let data = await page.evaluate(EXTRACT);
  if (!data.domText && !data.dateText) {
    await page.waitForTimeout(400);
    data = await page.evaluate(EXTRACT);
  }
  data.navMs = Date.now() - navStart;
  data.videoId = videoId;
  return data;
}

let rl = null;
async function handle(line) {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const id = req.id;
  try {
    switch (req.cmd) {
      case 'open':
        await ensureWindow();
        return send({ id, ok: true, result: { opened: true } });
      case 'probe':
        return send({ id, ok: true, result: await probe(String(req.videoId || '')) });
      case 'ping':
        return send({ id, ok: true, cmd: 'pong' });
      case 'close':
        if (ctx) {
          await ctx.close().catch(() => {});
          ctx = null;
          page = null;
        }
        return send({ id, ok: true, result: { closed: true } });
      default:
        return send({ id, ok: false, error: `unknown cmd: ${req.cmd}` });
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    log(`lỗi cmd=${req.cmd}: ${msg}`);
    // Cửa sổ hỏng (khách tự đóng, Chrome crash) → bỏ handle để lần sau mở lại.
    if (/close|crash|Target|browser has been/i.test(msg)) {
      ctx = null;
      page = null;
    }
    send({ id, ok: false, error: msg });
  }
}

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handle(line);
  }
});
process.stdin.on('end', async () => {
  if (ctx) await ctx.close().catch(() => {});
  process.exit(0);
});

send({ daemon: true, ok: true });
log('daemon ready');
