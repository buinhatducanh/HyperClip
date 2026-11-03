/**
 * start_all_adspower.js
 * Mở toàn bộ hồ sơ AdsPower đã liên kết để sẵn sàng Hot Upload (tối đa tốc độ, không chờ đợi)
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
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ code: -1, msg: data });
        }
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
  } catch (err) {
    // Không làm gián đoạn tiến trình nếu port chưa sẵn sàng phản hồi CDP
  }
}

async function main() {
  console.log('=======================================================================');
  console.log('   HYPERCLIP - MỞ TOÀN BỘ CỬA SỔ ADSPOWER (VÀO SẴN TRANG UPLOAD TIKTOK)');
  console.log('=======================================================================\n');

  console.log(`[1/2] Đang kiểm tra AdsPower Local API (${ADSPOWER_API_URL})...`);
  try {
    const st = await request(`${ADSPOWER_API_URL}/status`);
    if (st.code !== 0) throw new Error(st.msg || 'Chưa sẵn sàng');
    console.log('      -> AdsPower Local API: ĐANG ONLINE!\n');
  } catch (err) {
    console.error('      -> [LỖI] Không kết nối được AdsPower Local API! Hãy bật AdsPower trước.');
    process.exit(1);
  }

  // Đọc danh sách tài khoản từ tiktok.json
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
          console.log(`      -> Đã đọc ${accounts.length} tài khoản từ: ${p}`);
          break;
        }
      } catch (e) {}
    }
  }

  // Fallback nếu tiktok.json rỗng: đọc trực tiếp từ API AdsPower
  if (accounts.length === 0) {
    console.log('      -> Đang tải danh sách hồ sơ trực tiếp từ AdsPower API...');
    const userRes = await request(`${ADSPOWER_API_URL}/api/v1/user/list?page=1&page_size=100`);
    const list = userRes.data?.list || [];
    accounts = list.map(p => ({
      profileId: p.user_id,
      adsPowerSerial: p.serial_number,
      label: p.name || `Profile_${p.serial_number}`
    }));
  }

  console.log(`\n[2/2] Bắt đầu kích hoạt mở đồng loạt ${accounts.length} cửa sổ AdsPower (Vào sẵn Upload)...`);
  console.log('-----------------------------------------------------------------------');

  let successCount = 0;
  const launchArgs = encodeURIComponent(JSON.stringify([TIKTOK_UPLOAD_URL]));

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const targetParam = acc.profileId 
      ? `user_id=${encodeURIComponent(acc.profileId)}`
      : `serial_number=${encodeURIComponent(acc.adsPowerSerial || (i + 1))}`;

    const label = acc.label || acc.profileId || `Profile #${i + 1}`;
    process.stdout.write(` [${i + 1}/${accounts.length}] Đang mở: ${label.padEnd(25)} ... `);

    try {
      const res = await request(`${ADSPOWER_API_URL}/api/v1/browser/start?${targetParam}&open_tabs=1&launch_args=${launchArgs}`);
      if (res && res.code === 0) {
        const port = res.data?.debug_port;
        if (port) {
          await ensureTikTokUploadTab(port);
          console.log(`[THÀNH CÔNG] -> Vào sẵn trang Upload TikTok (CDP Port: ${port})`);
        } else {
          console.log(`[THÀNH CÔNG]`);
        }
        successCount++;
      } else {
        console.log(`[CẢNH BÁO] ${res ? res.msg : 'Không phản hồi'}`);
      }
    } catch (e) {
      console.log(`[LỖI] ${e.message}`);
    }

    // Nghỉ nhẹ 300ms giữa các lần gọi để AdsPower điều phối mượt mà
    await sleep(300);
  }

  console.log('-----------------------------------------------------------------------');
  console.log(`\n Hoàn tất! Đã mở thành công ${successCount}/${accounts.length} hồ sơ AdsPower.`);
  console.log(' Tất cả các hồ sơ đã vào sẵn phần Upload TikTok Studio.');
  console.log(' Bất kỳ video nào render xong sẽ được đẩy lên TikTok ngay lập tức không cần chờ nạp!');
}

main();
