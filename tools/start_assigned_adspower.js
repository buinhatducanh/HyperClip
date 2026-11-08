/**
 * start_assigned_adspower.js
 * Mở các cửa sổ AdsPower của các tài khoản đã được gán kênh YouTube trong mappings
 * Đảm bảo: Rate-limit retry, kiểm tra active trước khi gọi start, và vào sẵn tab TikTok Studio Upload.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || 'http://127.0.0.1:50325';

function request(url) {
  return new Promise((resolve) => {
    http.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ code: -1, msg: data }); }
      });
    }).on('error', (err) => resolve({ code: -1, msg: err.message }));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const TIKTOK_UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload';

async function ensureTikTokUploadTab(debugPort) {
  if (!debugPort) return;
  try {
    const tabs = await request(`http://127.0.0.1:${debugPort}/json/list`);
    if (!Array.isArray(tabs)) return;

    let ttTab = tabs.find(t => t.type === 'page' && t.url && t.url.includes('/tiktokstudio/upload'));
    const startTab = tabs.find(t => t.type === 'page' && t.url && t.url.includes('start.adspower.net'));

    if (!ttTab) {
      ttTab = await request(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(TIKTOK_UPLOAD_URL)}`);
      await sleep(500);
    }

    if (ttTab && ttTab.id) {
      await request(`http://127.0.0.1:${debugPort}/json/activate/${ttTab.id}`).catch(() => {});
    }

    if (startTab && startTab.id && (!ttTab || ttTab.id !== startTab.id)) {
      await request(`http://127.0.0.1:${debugPort}/json/close/${startTab.id}`).catch(() => {});
    }
  } catch (err) {}
}

async function startProfileWithRetry(targetParam, label) {
  // 1. Kiểm tra nếu profile đã đang Active thì không cần gọi start lại
  try {
    const act = await request(`${ADSPOWER_API_URL}/api/v1/browser/active?${targetParam}`);
    if (act && act.code === 0 && act.data?.status === 'Active') {
      const port = act.data.debug_port;
      if (port) {
        await ensureTikTokUploadTab(port);
      }
      return { ok: true, port, already: true };
    }
  } catch (e) {}

  // 2. Nếu chưa bật, gọi browser/start kèm retry chống Rate Limit
  const launchArgs = encodeURIComponent(JSON.stringify([TIKTOK_UPLOAD_URL]));
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await request(`${ADSPOWER_API_URL}/api/v1/browser/start?${targetParam}&open_tabs=1&launch_args=${launchArgs}`);
      if (res && res.code === 0) {
        const port = res.data?.debug_port;
        if (port) {
          await ensureTikTokUploadTab(port);
        }
        return { ok: true, port, already: false };
      }

      const msg = res?.msg || '';
      if (msg.includes('Too many request') || res?.code === -1) {
        // AdsPower giới hạn 1 request/giây -> Đợi 1.5s rồi thử lại
        await sleep(1500);
        continue;
      }
      return { ok: false, error: msg };
    } catch (err) {
      if (attempt === maxAttempts) return { ok: false, error: err.message };
      await sleep(1500);
    }
  }
  return { ok: false, error: 'Vượt quá số lần thử lại (Rate Limit)' };
}

async function main() {
  console.log('=== KÍCH HOẠT ADSPOWER THEO KÊNH YOUTUBE ĐÃ GÁN (VÀO SẴN UPLOAD) ===\n');

  // Kiểm tra cài đặt: CHỈ TỰ ĐỘNG MỞ KHI AUTO UPLOAD TIKTOK ĐANG BẬT
  const settingsCandidates = [
    process.env.HYPERCLIP_DATA_DIR ? path.join(process.env.HYPERCLIP_DATA_DIR, '.hyperclip', 'settings.json') : null,
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/settings.json'),
    path.resolve(__dirname, '../../HyperClip-Data/.hyperclip/settings.json'),
    path.resolve(__dirname, '../app/data/.hyperclip/settings.json'),
    'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/settings.json',
    'D:/HyperClip/HyperClip-Data/.hyperclip/settings.json'
  ].filter(Boolean);

  let tiktokUploadEnabled = false;
  for (const sp of settingsCandidates) {
    if (fs.existsSync(sp)) {
      try {
        const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
        const val = s?.settings?.tiktokUploadEnabled ?? s?.tiktokUploadEnabled;
        if (typeof val === 'boolean') {
          tiktokUploadEnabled = val;
          break;
        }
      } catch (e) {}
    }
  }

  if (!tiktokUploadEnabled) {
    console.log('[AdsPower] Tự động upload TikTok đang TẮT trong cài đặt (tiktokUploadEnabled = false). Bỏ qua việc tự mở trình duyệt.');
    process.exit(0);
  }

  const candidatePaths = [
    process.env.HYPERCLIP_DATA_DIR ? path.join(process.env.HYPERCLIP_DATA_DIR, '.hyperclip', 'tiktok.json') : null,
    'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/tiktok.json',
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../app/data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../HyperClipB-Data/.hyperclip/tiktok.json'),
  ].filter(Boolean);

  let tiktokData = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (d && Array.isArray(d.accounts)) {
          tiktokData = d;
          break;
        }
      } catch (e) {}
    }
  }

  if (!tiktokData) {
    console.error('Không tìm thấy dữ liệu tiktok.json!');
    process.exit(1);
  }

  const mappings = tiktokData.mappings || {};
  const accounts = tiktokData.accounts || [];

  const assignedMap = {};
  for (const cid in mappings) {
    if (mappings[cid]) {
      const val = String(mappings[cid]);
      assignedMap[val] = true;
      assignedMap[val.replace(/^tt_/, '')] = true;
    }
  }

  const assignedAccounts = accounts.filter(acc => {
    const cleanId = String(acc.id).replace(/^tt_/, '');
    if (assignedMap[acc.id] || assignedMap[cleanId]) return true;
    if (acc.profileId) {
      for (const k in assignedMap) {
        if (k.includes(acc.profileId)) return true;
      }
    }
    return false;
  });

  const targetList = (assignedAccounts.length > 0) ? assignedAccounts : accounts;
  console.log(`Tìm thấy ${targetList.length} tài khoản cần bật Hot Upload...`);

  let successCount = 0;
  for (let i = 0; i < targetList.length; i++) {
    const acc = targetList[i];
    const targetParam = acc.profileId
      ? `user_id=${encodeURIComponent(acc.profileId)}`
      : `serial_number=${encodeURIComponent(acc.adsPowerSerial || (i + 1))}`;

    const label = acc.label || acc.profileId || `Profile #${i + 1}`;
    process.stdout.write(` [${i + 1}/${targetList.length}] Mở AdsPower: ${label.padEnd(25)} ... `);

    const res = await startProfileWithRetry(targetParam, label);
    if (res.ok) {
      successCount++;
      const tag = res.already ? '[ĐÃ BẬT SẴN]' : '[OK]';
      console.log(`${tag} Sẵn sàng trang Upload TikTok (Port: ${res.port || 'CDP'})`);
    } else {
      console.log(`[LỖI] ${res.error}`);
    }

    // Nghỉ 1.3 giây giữa các tài khoản để đảm bảo AdsPower Local API không bao giờ bị nghẽn (giới hạn 1 req/s)
    await sleep(1300);
  }

  console.log(`\nHoàn tất: Đã kích hoạt sẵn sàng ${successCount}/${targetList.length} tài khoản AdsPower vào trang Upload TikTok!`);
}

main();
