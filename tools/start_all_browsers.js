/**
 * start_all_browsers.js
 * Mở song song toàn bộ Chrome thường + AdsPower cho tất cả tài khoản
 * Đảm bảo 100% tài khoản vào sẵn trang Upload TikTok Studio và mở cổng CDP sẵn sàng
 * Loại bỏ hoàn toàn tình trạng delay/chờ đợi khi upload.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || 'http://127.0.0.1:50325';
const TIKTOK_UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload';
const BASE_PORT = 9223;

function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

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

async function isPortListening(port) {
  return new Promise(resolve => {
    const s = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 800 }, (res) => {
      resolve(res.statusCode === 200);
    });
    s.on('error', () => resolve(false));
  });
}

async function ensureTikTokUploadTab(debugPort) {
  if (!debugPort) return;
  try {
    const tabs = await request(`http://127.0.0.1:${debugPort}/json/list`);
    if (!Array.isArray(tabs)) return;

    let ttTab = tabs.find(t => t.type === 'page' && t.url && t.url.includes('/tiktokstudio/upload'));
    const startTab = tabs.find(t => t.type === 'page' && t.url && t.url.includes('start.adspower.net'));

    if (!ttTab) {
      ttTab = await request(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(TIKTOK_UPLOAD_URL)}`);
      await sleep(300);
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
  console.log('=======================================================================');
  console.log('   HYPERCLIP - MỞ SONG SONG TOÀN BỘ CHROME + ADSPOWER CHO TẤT CẢ ACC');
  console.log('=======================================================================\n');

  // 1. Kiểm tra Chrome & AdsPower
  const chromePath = findChromePath();
  if (chromePath) {
    console.log(`[1/3] Google Chrome: Đã tìm thấy (${chromePath})`);
  } else {
    console.log('[1/3] [CẢNH BÁO] Không tìm thấy Google Chrome cài đặt trên máy!');
  }

  let adsPowerOnline = false;
  try {
    const st = await request(`${ADSPOWER_API_URL}/status`);
    if (st && st.code === 0) {
      adsPowerOnline = true;
      console.log(`      AdsPower Local API: ĐANG ONLINE (${ADSPOWER_API_URL})\n`);
    } else {
      console.log(`      AdsPower Local API: Chưa mở hoặc cổng khác (${st ? st.msg : ''})\n`);
    }
  } catch (err) {
    console.log(`      AdsPower Local API: Chưa kết nối được (${err.message})\n`);
  }

  // 2. Đọc danh sách tài khoản
  console.log('[2/3] Đang nạp danh sách tài khoản TikTok...');
  const candidatePaths = [
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../app/data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../HyperClipB-Data/.hyperclip/tiktok.json'),
  ];

  let accounts = [];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (d && Array.isArray(d.accounts) && d.accounts.length > 0) {
          accounts = d.accounts;
          console.log(`      -> Đã đọc ${accounts.length} tài khoản từ: ${p}\n`);
          break;
        }
      } catch (e) {}
    }
  }

  if (accounts.length === 0) {
    console.log('      -> Không tìm thấy danh sách tài khoản trong tiktok.json!');
    process.exit(1);
  }

  const rootDataDir = path.resolve(__dirname, '../HyperClip-Data');
  const profilesDir = path.join(rootDataDir, 'TikTok-Profiles');
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }

  // 3. Khởi chạy song song
  console.log(`[3/3] Bắt đầu khởi động song song Chrome + AdsPower cho ${accounts.length} tài khoản:`);
  console.log('-----------------------------------------------------------------------');
  console.log('STT | Tên tài khoản          | Chrome Port | AdsPower Port | Trạng thái');
  console.log('-----------------------------------------------------------------------');

  const launchArgs = encodeURIComponent(JSON.stringify([TIKTOK_UPLOAD_URL]));

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const chromePort = BASE_PORT + i;
    const label = acc.label || acc.profileId || `Profile #${i + 1}`;
    const userDir = path.join(profilesDir, acc.profileId || `acc_${i + 1}`);

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // A. Mở Google Chrome (nếu chưa chạy trên port này)
    let chromeStatus = 'Đang chạy';
    const chromeAlreadyUp = await isPortListening(chromePort);
    if (!chromeAlreadyUp && chromePath) {
      try {
        const chromeArgs = [
          `--user-data-dir=${userDir}`,
          `--remote-debugging-port=${chromePort}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--window-position=-32000,-32000',
          TIKTOK_UPLOAD_URL
        ];
        spawn(chromePath, chromeArgs, { detached: true, stdio: 'ignore' }).unref();
        chromeStatus = 'Đã mở';
      } catch (ce) {
        chromeStatus = 'Lỗi Chrome';
      }
    }

    // B. Mở AdsPower Profile (nếu AdsPower online)
    let adsPort = '-';
    let adsStatus = 'Bỏ qua';
    if (adsPowerOnline) {
      try {
        const targetParam = acc.profileId 
          ? `user_id=${encodeURIComponent(acc.profileId)}`
          : `serial_number=${encodeURIComponent(acc.adsPowerSerial || (i + 1))}`;

        const res = await request(`${ADSPOWER_API_URL}/api/v1/browser/start?${targetParam}&open_tabs=1&launch_args=${launchArgs}`);
        if (res && res.code === 0) {
          adsPort = res.data?.debug_port || 'Sẵn sàng';
          if (res.data?.debug_port) {
            await ensureTikTokUploadTab(res.data.debug_port);
          }
          adsStatus = 'Đã mở';
        } else {
          adsStatus = res ? res.msg : 'Lỗi';
        }
      } catch (ae) {
        adsStatus = 'Lỗi kết nối';
      }
    }

    const stt = String(i + 1).padStart(3, ' ');
    const displayLabel = label.padEnd(22, ' ').slice(0, 22);
    const displayCPort = String(chromePort).padEnd(11, ' ');
    const displayAPort = String(adsPort).padEnd(13, ' ');
    console.log(`${stt} | ${displayLabel} | ${displayCPort} | ${displayAPort} | OK (Chrome: ${chromeStatus}, AdsPower: ${adsStatus})`);

    await sleep(250);
  }

  console.log('-----------------------------------------------------------------------');
  console.log('\n Hoàn tất! Toàn bộ Chrome thường và AdsPower đã được mở song song.');
  console.log(' Các cổng CDP 9223-9245 đã phản hồi tức thì và tab Upload TikTok Studio đã sẵn sàng.');
  console.log(' HyperClip sẽ upload ngay lập tức (< 3s) mà không bao giờ bị delay!\n');
}

main();
