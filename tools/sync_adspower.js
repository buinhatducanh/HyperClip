/**
 * Sync AdsPower Profiles into HyperClip tiktok.json
 * Tự động đọc danh sách hồ sơ từ AdsPower Local API và nạp vào HyperClip
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function readIniFallback(filePath) {
  let apiUrl = '';
  let apiKey = '';
  let profileMap = {};
  try {
    if (!fs.existsSync(filePath)) return { apiUrl, apiKey, profileMap };
    const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    let inSection = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;
      if (line.startsWith('[')) {
        inSection = /^\[AdsPower\]$/i.test(line);
        continue;
      }
      if (!inSection) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        v = v.slice(1, -1).replace(/\\"/g, '"');
      }
      if (k === 'apiUrl' && v) apiUrl = v;
      if (k === 'apiKey') apiKey = v;
      if (k === 'profileMap' && v) {
        try {
          const parsed = JSON.parse(decodeURIComponent(v));
          if (parsed && typeof parsed === 'object') profileMap = parsed;
        } catch (eMap) {}
      }
    }
  } catch (e) {}
  return { apiUrl, apiKey, profileMap };
}

function resolveAdsPowerConfig() {
  let apiUrl = process.env.ADSPOWER_API_URL || '';
  let apiKey = process.env.ADSPOWER_API_KEY || '';
  let dryRun = String(process.env.HYPERCLIP_DRY_RUN || '').trim() === '1';
  let startup = String(process.env.HYPERCLIP_STARTUP_SYNC || '').trim() === '1';
  let quiet = false;
  let forceAll = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--url=')) apiUrl = arg.slice(6);
    if (arg.startsWith('--key=')) apiKey = arg.slice(6);
    if (arg === '--dry-run') dryRun = true;
    if (arg === '--startup') startup = true;
    if (arg === '--quiet') quiet = true;
    if (arg === '--all') forceAll = true;
  }
  const dataDirEnv = String(process.env.HYPERCLIP_DATA_DIR || '').trim();
  const cfgPath = dataDirEnv
    ? path.join(dataDirEnv, '.hyperclip', 'adspower.json')
    : path.resolve(__dirname, '../HyperClip-Data/.hyperclip/adspower.json');
  const candidateCfgs = [
    cfgPath,
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/adspower.json'),
  ];
  for (const cp of candidateCfgs) {
    if ((!apiUrl || !apiKey) && fs.existsSync(cp)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cp, 'utf8').replace(/^\uFEFF/, ''));
        if (!apiUrl && cfg.apiUrl) apiUrl = String(cfg.apiUrl);
        if (!apiKey && cfg.apiKey) apiKey = String(cfg.apiKey);
      } catch (e) {}
    }
  }
  let profileMap = {};
  if (process.env.APPDATA) {
    const ini = readIniFallback(path.join(process.env.APPDATA, 'HyperClip', 'adspower_ui.ini'));
    if (!apiUrl && ini.apiUrl) apiUrl = ini.apiUrl;
    if (!apiKey && ini.apiKey) apiKey = ini.apiKey;
    if (ini.profileMap) profileMap = ini.profileMap;
  }
  apiUrl = (apiUrl || 'http://127.0.0.1:50325').trim().replace(/\/+$/, '');
  apiKey = String(apiKey || '').trim();
  return { apiUrl, apiKey, profileMap, cfgPath, dryRun, startup, quiet, forceAll };
}

const ADS_CFG = resolveAdsPowerConfig();
const ADSPOWER_API_URL = ADS_CFG.apiUrl;
const ADSPOWER_API_KEY = ADS_CFG.apiKey;
const log = (...args) => { if (!ADS_CFG.quiet) console.log(...args); };

function isHyperClipBackendRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq hyperclip-tauri.exe', '/NH'], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
    });
    return /hyperclip-tauri\.exe/i.test(out || '');
  } catch (e) {
    return false;
  }
}

function request(endpointOrUrl, retries = 3, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let url = endpointOrUrl.startsWith('http') ? endpointOrUrl : `${ADSPOWER_API_URL}${endpointOrUrl}`;
    if (ADSPOWER_API_KEY && !url.includes('api_key=')) {
      url += (url.includes('?') ? '&' : '?') + `api_key=${encodeURIComponent(ADSPOWER_API_KEY)}`;
    }
    const client = url.startsWith('https://') ? https : http;
    const headers = ADSPOWER_API_KEY ? { Authorization: `Bearer ${ADSPOWER_API_KEY}` } : {};
    const req = client.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.code !== 0 && /too many request/i.test(String(parsed.msg || '')) && retries > 0) {
            setTimeout(() => {
              request(endpointOrUrl, retries - 1, timeoutMs).then(resolve, reject);
            }, 1200);
            return;
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Phản hồi không phải JSON: ${data.slice(0, 100)}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

async function main() {
  if (ADS_CFG.startup && String(process.env.HYPERCLIP_NO_SYNC || '').trim() === '1') {
    return;
  }
  if (ADS_CFG.startup && isHyperClipBackendRunning()) {
    log('[startup] hyperclip-tauri đang chạy — bỏ qua ghi tiktok.json.');
    return;
  }

  log('=======================================================================');
  log('   HYPERCLIP - ĐỒNG BỘ TỰ ĐỘNG HỒ SƠ TỪ ADSPOWER (LOCAL API)');
  log('=======================================================================\n');

  if (!ADS_CFG.startup) {
    // 1. Kiểm tra trạng thái AdsPower Local API
    log(`[1/3] Đang kết nối tới AdsPower Local API (${ADSPOWER_API_URL}${ADSPOWER_API_KEY ? ', có API Key' : ''})...`);
    try {
      await request('/status', 2, 3000);
      log('      -> AdsPower Local API: ĐANG SẴN SÀNG (Online)\n');
    } catch (err) {
      console.error('      -> [LỖI] Không kết nối được tới AdsPower Local API!');
      console.error('         Chi tiết:', err.message);
      console.error('\n   👉 HƯỚNG DẪN KHẮC PHỤC:');
      console.error('      1. Mở ứng dụng AdsPower trên máy tính.');
      console.error('      2. Vào Cài đặt (Settings) -> Chọn Local API.');
      console.error('      3. Bật [ON] Local API và đảm bảo cổng là 50325.');
      console.error('      4. Nếu có bật API Key, truyền --key=... hoặc đặt ADSPOWER_API_KEY.\n');
      process.exit(1);
    }
  }

  // 2. Lấy danh sách hồ sơ (Profiles)
  log('[2/3] Đang tải danh sách hồ sơ từ AdsPower...');
  let profileList = [];
  try {
    const userRes = await request('/api/v1/user/list?page=1&page_size=200', ADS_CFG.startup ? 0 : 3, ADS_CFG.startup ? 1500 : 8000);
    if (userRes.code !== 0) {
      if (ADS_CFG.startup) return;
      throw new Error(userRes.msg || 'Không lấy được danh sách user');
    }
    profileList = userRes.data?.list || [];
  } catch (err) {
    if (ADS_CFG.startup) {
      log('[startup] AdsPower chưa sẵn sàng — bỏ qua đồng bộ:', err.message);
      return;
    }
    console.error('      -> [LỖI] Không thể đọc danh sách hồ sơ:', err.message);
    process.exit(1);
  }

  if (!ADS_CFG.dryRun && (ADSPOWER_API_KEY || ADSPOWER_API_URL !== 'http://127.0.0.1:50325')) {
    try {
      fs.mkdirSync(path.dirname(ADS_CFG.cfgPath), { recursive: true });
      fs.writeFileSync(ADS_CFG.cfgPath, JSON.stringify({ apiUrl: ADSPOWER_API_URL, apiKey: ADSPOWER_API_KEY }, null, 2), 'utf8');
    } catch (e) {}
  }

  if (profileList.length === 0) {
    log('      -> Không tìm thấy hồ sơ nào trên AdsPower! Hãy tạo hồ sơ trước.\n');
    return;
  }

  log(`      -> Đã phát hiện ${profileList.length} hồ sơ trên AdsPower!\n`);

  if (ADS_CFG.dryRun) {
    log('[3/3] [DRY-RUN] Bỏ qua bước ghi tiktok.json.\n');
    return;
  }

  // 3. Tìm các file tiktok.json của HyperClip để đồng bộ
  log('[3/3] Đang cập nhật vào cấu hình HyperClip (tiktok.json)...');
  const candidateTargets = [
    process.env.HYPERCLIP_DATA_DIR ? path.join(String(process.env.HYPERCLIP_DATA_DIR).trim(), '.hyperclip/tiktok.json') : null,
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../HyperClipB-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../app/data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../HyperClipB-Package/HyperClipB-Data/.hyperclip/tiktok.json'),
  ].filter(Boolean);
  const targetPaths = Array.from(new Set(candidateTargets.map(p => path.resolve(p))));

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
  const currentPids = newAccounts.map(a => a.profileId).filter(Boolean);

  let updatedCount = 0;
  for (const tPath of targetPaths) {
    try {
      const dir = path.dirname(tPath);
      if (ADS_CFG.startup && !fs.existsSync(dir)) {
        continue;
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let rawPrev = '';
      let existingData = { accounts: [], mappings: {}, history: [] };
      if (fs.existsSync(tPath)) {
        try {
          rawPrev = fs.readFileSync(tPath, 'utf8').replace(/^\uFEFF/, '');
          existingData = JSON.parse(rawPrev);
        } catch (e) {
          // ignore error
        }
      }

      const statePath = path.join(dir, 'adspower_sync_state.json');
      const seenSet = new Set();
      if (fs.existsSync(statePath)) {
        try {
          const st = JSON.parse(fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, ''));
          if (Array.isArray(st.seenProfileIds)) {
            st.seenProfileIds.forEach(id => { if (id) seenSet.add(String(id)); });
          }
        } catch (e) {}
      }

      const oldAccounts = Array.isArray(existingData.accounts) ? existingData.accounts : [];
      const oldByProfileId = new Map();
      const oldByLabel = new Map();
      const idRemap = new Map();
      const ovMap = ADS_CFG.profileMap || {};
      for (const old of oldAccounts) {
        const effPid = (old.id && ovMap[old.id]) || (old.label && ovMap[old.label]) || '';
        const cleanEff = effPid ? String(effPid).replace(/^adspower_/i, '').trim() : '';
        if (cleanEff && !cleanEff.startsWith('tt')) oldByProfileId.set(cleanEff, old);
        if (old.profileId && !String(old.profileId).startsWith('tt')) oldByProfileId.set(old.profileId, old);
        if (old.label) oldByLabel.set(old.label, old);
      }

      const smartFilter = ADS_CFG.startup && !ADS_CFG.forceAll && oldAccounts.length > 0 && seenSet.size > 0;
      const mergedAccounts = [];
      for (const fresh of newAccounts) {
        const prev = oldByProfileId.get(fresh.profileId) || oldByLabel.get(fresh.label);
        if (smartFilter && !prev && (!fresh.profileId || seenSet.has(fresh.profileId))) {
          continue;
        }
        if (!prev) {
          mergedAccounts.push(fresh);
          continue;
        }
        if (prev.id && prev.id !== fresh.id) {
          idRemap.set(prev.id, fresh.id);
        }
        mergedAccounts.push({
          ...fresh,
          captionMode: prev.captionMode || fresh.captionMode,
          captionTemplate: prev.captionTemplate !== undefined ? prev.captionTemplate : fresh.captionTemplate,
          enabled: prev.enabled !== undefined ? prev.enabled : fresh.enabled,
          createdAt: prev.createdAt || fresh.createdAt,
          lastUploadAt: prev.lastUploadAt !== undefined ? prev.lastUploadAt : fresh.lastUploadAt,
        });
      }

      // Chuẩn hoá mappings: chuyển các ID cũ (tt_adspower_... hoặc tt...) khớp sang adspower_...
      const mappedIds = new Set();
      if (existingData.mappings && typeof existingData.mappings === 'object') {
        for (const [cid, accId] of Object.entries(existingData.mappings)) {
          if (typeof accId !== 'string') continue;
          let finalId = accId;
          if (idRemap.has(accId)) {
            finalId = idRemap.get(accId);
            existingData.mappings[cid] = finalId;
          } else if (accId.startsWith('tt_adspower_')) {
            finalId = accId.replace('tt_adspower_', 'adspower_');
            existingData.mappings[cid] = finalId;
          }
          mappedIds.add(finalId);
        }
      }

      // Ưu tiên đặt các tài khoản đã gán kênh (và tài khoản hoạt động) trong 15 vị trí đầu (index 0..14)
      // vì hyperclip-tauri.exe cap port ở 9223 + min(index, 15) = 9238.
      const prevOrder = new Map();
      oldAccounts.forEach((a, idx) => {
        if (a.profileId) prevOrder.set(a.profileId, idx);
      });
      mergedAccounts.sort((a, b) => {
        const aMapped = mappedIds.has(a.id) ? 0 : 1;
        const bMapped = mappedIds.has(b.id) ? 0 : 1;
        if (aMapped !== bMapped) return aMapped - bMapped;

        const aPrev = prevOrder.has(a.profileId) ? 0 : 1;
        const bPrev = prevOrder.has(b.profileId) ? 0 : 1;
        if (aPrev !== bPrev) return aPrev - bPrev;

        const aUs = /us\s*nhuan/i.test(a.label || '') ? 1 : 0;
        const bUs = /us\s*nhuan/i.test(b.label || '') ? 1 : 0;
        if (aUs !== bUs) return aUs - bUs;

        if (prevOrder.has(a.profileId) && prevOrder.has(b.profileId)) {
          return prevOrder.get(a.profileId) - prevOrder.get(b.profileId);
        }
        return Number(a.adsPowerSerial || 0) - Number(b.adsPowerSerial || 0);
      });

      existingData.accounts = mergedAccounts;
      const nextJson = JSON.stringify(existingData, null, 2);
      if (nextJson !== rawPrev) {
        fs.writeFileSync(tPath, nextJson, 'utf8');
        log(`      -> Đã cập nhật (${mergedAccounts.length} nick): ${tPath}`);
      } else {
        log(`      -> Đã khớp sẵn (${mergedAccounts.length} nick): ${tPath}`);
      }

      const nextSeen = Array.from(new Set([...seenSet, ...currentPids]));
      fs.writeFileSync(statePath, JSON.stringify({ seenProfileIds: nextSeen, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
      updatedCount++;
    } catch (err) {
      if (!ADS_CFG.quiet) console.error(`      -> Không thể ghi vào ${tPath}:`, err.message);
    }
  }

  // 4. In bảng danh sách hồ sơ đã nhận diện
  log('\n=======================================================================');
  log('   DANH SÁCH HỒ SƠ ADSPOWER ĐÃ LIÊN KẾT THÀNH CÔNG VỚI HYPERCLIP:');
  log('=======================================================================');
  log('| STT | Số Serial | Mã Profile ID   | Tên Profile / Kênh TikTok       |');
  log('|-----|-----------|-----------------|---------------------------------|');
  newAccounts.forEach((acc, i) => {
    const stt = String(i + 1).padEnd(3);
    const serial = String(acc.adsPowerSerial || '').padEnd(9);
    const pid = String(acc.profileId || '').padEnd(15);
    const name = String(acc.label).slice(0, 31).padEnd(31);
    log(`| ${stt} | ${serial} | ${pid} | ${name} |`);
  });
  log('=======================================================================');
  log(`\n Hoàn tất! HyperClip đã xử lý ${updatedCount} cấu hình từ ${newAccounts.length} hồ sơ AdsPower.`);
  log(' Bây giờ bạn chỉ cần khởi động app HyperClip là app sẽ tự dùng các hồ sơ này!\n');
}

main().catch(err => {
  console.error('[LỖI CHƯƠNG TRÌNH]', err);
});
