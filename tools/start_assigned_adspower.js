/**
 * start_assigned_adspower.js
 * Mở các cửa sổ AdsPower của các tài khoản đã được gán kênh YouTube trong mappings
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || 'http://127.0.0.1:50325';

function request(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ code: -1, msg: data }); }
      });
    }).on('error', reject);
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

async function main() {
  console.log('=== KÍCH HOẠT ADSPOWER THEO KÊNH YOUTUBE ĐÃ GÁN (VÀO SẴN UPLOAD) ===\n');

  const candidatePaths = [
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../app/data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../HyperClipB-Data/.hyperclip/tiktok.json'),
  ];

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
  const launchArgs = encodeURIComponent(JSON.stringify([TIKTOK_UPLOAD_URL]));

  for (let i = 0; i < targetList.length; i++) {
    const acc = targetList[i];
    const targetParam = acc.profileId
      ? `user_id=${encodeURIComponent(acc.profileId)}`
      : `serial_number=${encodeURIComponent(acc.adsPowerSerial || (i + 1))}`;

    const label = acc.label || acc.profileId || `Profile #${i + 1}`;
    process.stdout.write(` [${i + 1}/${targetList.length}] Mở AdsPower: ${label.padEnd(25)} ... `);
    try {
      const res = await request(`${ADSPOWER_API_URL}/api/v1/browser/start?${targetParam}&open_tabs=1&launch_args=${launchArgs}`);
      if (res && res.code === 0) {
        const port = res.data?.debug_port;
        if (port) {
          await ensureTikTokUploadTab(port);
          console.log(`[OK] Sẵn sàng trang Upload TikTok (Port: ${port})`);
        } else {
          console.log(`[OK]`);
        }
      } else {
        console.log(`[WARN] ${res?.msg}`);
      }
    } catch (e) {
      console.log(`[ERR] ${e.message}`);
    }
    await sleep(250);
  }

  console.log('\nHoàn tất kích hoạt AdsPower theo kênh đã gán! Tất cả đã vào sẵn trang Upload TikTok.');
}

main();
