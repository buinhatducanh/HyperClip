/**
 * Sync AdsPower Profiles into HyperClip tiktok.json
 * Tự động đọc danh sách hồ sơ từ AdsPower Local API và nạp vào HyperClip
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || 'http://127.0.0.1:50325';

function request(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Phản hồi không phải JSON: ${data.slice(0, 100)}`));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=======================================================================');
  console.log('   HYPERCLIP - ĐỒNG BỘ TỰ ĐỘNG HỒ SƠ TỪ ADSPOWER (LOCAL API)');
  console.log('=======================================================================\n');

  // 1. Kiểm tra trạng thái AdsPower Local API
  console.log(`[1/3] Đang kết nối tới AdsPower Local API (${ADSPOWER_API_URL})...`);
  try {
    const statusRes = await request(`${ADSPOWER_API_URL}/status`);
    console.log('      -> AdsPower Local API: ĐANG SẴN SÀNG (Online)\n');
  } catch (err) {
    console.error('      -> [LỖI] Không kết nối được tới AdsPower Local API!');
    console.error('         Chi tiết:', err.message);
    console.error('\n   👉 HƯỚNG DẪN KHẮC PHỤC:');
    console.error('      1. Mở ứng dụng AdsPower trên máy tính.');
    console.error('      2. Vào Cài đặt (Settings) -> Chọn Local API.');
    console.error('      3. Bật [ON] Local API và đảm bảo cổng là 50325.');
    console.error('      4. Sau đó chạy lại file này.\n');
    process.exit(1);
  }

  // 2. Lấy danh sách hồ sơ (Profiles)
  console.log('[2/3] Đang tải danh sách hồ sơ từ AdsPower...');
  let profileList = [];
  try {
    const userRes = await request(`${ADSPOWER_API_URL}/api/v1/user/list?page=1&page_size=100`);
    if (userRes.code !== 0) {
      throw new Error(userRes.msg || 'Không lấy được danh sách user');
    }
    profileList = userRes.data?.list || [];
  } catch (err) {
    console.error('      -> [LỖI] Không thể đọc danh sách hồ sơ:', err.message);
    process.exit(1);
  }

  if (profileList.length === 0) {
    console.log('      -> Không tìm thấy hồ sơ nào trên AdsPower! Hãy tạo hồ sơ trước.\n');
    return;
  }

  console.log(`      -> Đã phát hiện ${profileList.length} hồ sơ trên AdsPower!\n`);

  // 3. Tìm các file tiktok.json của HyperClip để đồng bộ
  console.log('[3/3] Đang cập nhật vào cấu hình HyperClip (tiktok.json)...');
  const targetPaths = [
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../HyperClipB-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../app/data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../HyperClipB-Package/HyperClipB-Data/.hyperclip/tiktok.json'),
  ];

  const newAccounts = profileList.map((p, idx) => {
    const label = p.name ? (p.name.startsWith('@') ? p.name : `@${p.name}`) : `@Profile_${p.serial_number || p.user_id}`;
    return {
      id: `adspower_${p.user_id || p.serial_number}`,
      label: label,
      profileId: p.user_id,
      adsPowerSerial: String(p.serial_number || (idx + 1)),
      captionMode: 'auto',
      captionTemplate: '',
      enabled: true,
      status: 'connected',
      groupName: p.group_name || '',
      createdAt: Date.now(),
      lastUploadAt: null
    };
  });

  let updatedCount = 0;
  for (const tPath of targetPaths) {
    try {
      const dir = path.dirname(tPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let existingData = { accounts: [], mappings: {}, history: [] };
      if (fs.existsSync(tPath)) {
        try {
          existingData = JSON.parse(fs.readFileSync(tPath, 'utf8'));
        } catch (e) {
          // ignore error
        }
      }

      // Chuẩn hoá mappings: chuyển các ID cũ (tt_adspower_...) khớp sang adspower_...
      if (existingData.mappings && typeof existingData.mappings === 'object') {
        for (const [cid, accId] of Object.entries(existingData.mappings)) {
          if (typeof accId === 'string' && accId.startsWith('tt_adspower_')) {
            existingData.mappings[cid] = accId.replace('tt_adspower_', 'adspower_');
          }
        }
      }

      existingData.accounts = newAccounts;
      fs.writeFileSync(tPath, JSON.stringify(existingData, null, 2), 'utf8');
      console.log(`      -> Đã cập nhật thành công: ${tPath}`);
      updatedCount++;
    } catch (err) {
      console.error(`      -> Không thể ghi vào ${tPath}:`, err.message);
    }
  }

  // 4. In bảng danh sách hồ sơ đã nhận diện
  console.log('\n=======================================================================');
  console.log('   DANH SÁCH HỒ SƠ ADSPOWER ĐÃ LIÊN KẾT THÀNH CÔNG VỚI HYPERCLIP:');
  console.log('=======================================================================');
  console.log('| STT | Số Serial | Mã Profile ID   | Tên Profile / Kênh TikTok       |');
  console.log('|-----|-----------|-----------------|---------------------------------|');
  newAccounts.forEach((acc, i) => {
    const stt = String(i + 1).padEnd(3);
    const serial = String(acc.adsPowerSerial || '').padEnd(9);
    const pid = String(acc.profileId || '').padEnd(15);
    const name = String(acc.label).slice(0, 31).padEnd(31);
    console.log(`| ${stt} | ${serial} | ${pid} | ${name} |`);
  });
  console.log('=======================================================================');
  console.log(`\n Hoàn tất! HyperClip đã nhận diện đầy đủ ${newAccounts.length} tài khoản từ AdsPower.`);
  console.log(' Bây giờ bạn chỉ cần khởi động app HyperClip là app sẽ tự dùng các hồ sơ này!\n');
}

main().catch(err => {
  console.error('[LỖI CHƯƠNG TRÌNH]', err);
});
