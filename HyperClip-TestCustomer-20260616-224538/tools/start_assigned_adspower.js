/**
 * start_assigned_adspower.js
 * Mở các cửa sổ AdsPower của các tài khoản đã được gán kênh YouTube trong mappings
 * Đảm bảo: Rate-limit retry, kiểm tra active trước khi gọi start, và vào sẵn tab TikTok Studio Upload.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || 'http://127.0.0.1:50325';
const DATA_DIR = process.env.HYPERCLIP_DATA_DIR || process.env.HYPERCLIPB_DATA_DIR || path.resolve(__dirname, '../HyperClip-Data');
const HYPERCLIP_DIR = path.join(DATA_DIR, '.hyperclip');
const SESSION_FILE = path.join(HYPERCLIP_DIR, 'adspower_session.json');
const START_LOCK_FILE = path.join(HYPERCLIP_DIR, 'adspower_start.lock');

function request(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ code: -1, msg: data }); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
    req.on('error', (err) => resolve({ code: -1, msg: err.message }));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const TIKTOK_UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload';

function readSessionProfiles() {
  try {
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    return Array.isArray(session.profiles) ? session.profiles : [];
  } catch (_) {
    return [];
  }
}

function recordSessionProfile(acc) {
  const profiles = readSessionProfiles();
  const exists = profiles.some(p =>
    (acc.profileId && p.profileId === acc.profileId) ||
    (!acc.profileId && acc.adsPowerSerial && String(p.adsPowerSerial) === acc.adsPowerSerial)
  );
  if (exists) return;
  profiles.push({
    profileId: acc.profileId || null,
    adsPowerSerial: acc.adsPowerSerial || null,
    label: acc.label || acc.profileId || `Profile_${acc.adsPowerSerial || ''}`
  });
  try {
    fs.mkdirSync(HYPERCLIP_DIR, { recursive: true });
    const tmpFile = `${SESSION_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ updatedAt: Date.now(), profiles }, null, 2), 'utf8');
    fs.renameSync(tmpFile, SESSION_FILE);
  } catch (e) {
    console.error('[AdsPower] Không lưu được danh sách profile cần đóng:', e.message);
  }
}

async function ensureAdsPowerApi() {
  const check = async () => {
    const status = await request(`${ADSPOWER_API_URL}/status`, 2500);
    return status && status.code === 0;
  };
  if (await check()) return true;

  const exeCandidates = [
    process.env.ADSPOWER_EXE,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'AdsPower Global', 'AdsPower Global.exe') : null,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'AdsPower Global', 'AdsPower Global.exe') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'AdsPower Global', 'AdsPower Global.exe') : null
  ].filter(Boolean);
  const adsPowerExe = exeCandidates.find(p => fs.existsSync(p));
  if (adsPowerExe) {
    try {
      cp.spawn(adsPowerExe, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      console.log('[AdsPower] Đang mở AdsPower và chờ Local API sẵn sàng...');
    } catch (e) {
      console.error('[AdsPower] Không khởi động được AdsPower:', e.message);
    }
  }

  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    if (await check()) return true;
  }
  return false;
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

  // Local API giới hạn tần suất tổng; chừa nhịp giữa lệnh kiểm tra và lệnh mở.
  await sleep(1100);

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

async function runStartup() {
  console.log('=== KÍCH HOẠT TOÀN BỘ ADSPOWER ACCOUNT ĐÃ CẤU HÌNH ===\n');

  // Chỉ pre-warm profile khi người dùng bật tự động đăng TikTok.
  const settingsCandidates = [
    path.join(DATA_DIR, '.hyperclip', 'settings.json'),
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/settings.json'),
    path.resolve(__dirname, '../../HyperClip-Data/.hyperclip/settings.json'),
    path.resolve(__dirname, '../app/data/.hyperclip/settings.json'),
    path.resolve(__dirname, '../../app/data/.hyperclip/settings.json')
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
    return;
  }

  const candidatePaths = [
    path.join(DATA_DIR, '.hyperclip', 'tiktok.json'),
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../../HyperClip-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../app/data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../../app/data/.hyperclip/tiktok.json')
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

  let accounts = Array.isArray(tiktokData?.accounts) ? tiktokData.accounts : [];
  if (accounts.length === 0) {
    console.log('[AdsPower] Không có danh sách account cấu hình; đang lấy profile từ AdsPower Local API...');
    if (!(await ensureAdsPowerApi())) {
      console.error('[AdsPower] Local API chưa sẵn sàng; không thể tải danh sách profile.');
      return;
    }
    const apiAccounts = [];
    const pageSize = 100;
    for (let page = 1; page <= 20; page++) {
      const result = await request(`${ADSPOWER_API_URL}/api/v1/user/list?page=${page}&page_size=${pageSize}`);
      const list = result?.code === 0 && Array.isArray(result.data?.list) ? result.data.list : [];
      apiAccounts.push(...list.map(p => ({
        profileId: p.user_id,
        adsPowerSerial: p.serial_number,
        label: p.name || `Profile_${p.serial_number || p.user_id}`
      })));
      if (list.length < pageSize) break;
    }
    accounts = apiAccounts;
  }

  const seen = new Set();
  const targetList = accounts
    .filter(acc => acc && acc.enabled !== false)
    .map(acc => ({
      profileId: String(acc.profileId || '').replace(/^adspower_/, ''),
      adsPowerSerial: String(acc.adsPowerSerial || acc.serial_number || ''),
      label: acc.label || acc.name || acc.profileId || `Profile_${acc.adsPowerSerial || acc.serial_number || ''}`
    }))
    .filter(acc => {
      if (!acc.profileId && !acc.adsPowerSerial) return false;
      const key = acc.profileId ? `id:${acc.profileId}` : `serial:${acc.adsPowerSerial}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (targetList.length === 0) {
    console.log('[AdsPower] Không có account AdsPower hợp lệ trong cấu hình.');
    return;
  }

  if (!(await ensureAdsPowerApi())) {
    console.error('[AdsPower] Không thể kết nối AdsPower Local API; bỏ qua mở profile.');
    return;
  }
  await sleep(1100);

  console.log(`Tìm thấy ${targetList.length} tài khoản AdsPower đã cấu hình cần mở...`);

  let successCount = 0;
  for (let i = 0; i < targetList.length; i++) {
    const acc = targetList[i];
    const targetParam = acc.profileId
      ? `user_id=${encodeURIComponent(acc.profileId)}`
      : `serial_number=${encodeURIComponent(acc.adsPowerSerial)}`;

    const label = acc.label || acc.profileId || `Profile #${i + 1}`;
    process.stdout.write(` [${i + 1}/${targetList.length}] Mở AdsPower: ${label.padEnd(25)} ... `);

    const res = await startProfileWithRetry(targetParam, label);
    if (res.ok) {
      successCount++;
      if (!res.already) recordSessionProfile(acc);
      const tag = res.already ? '[ĐÃ BẬT SẴN]' : '[OK]';
      console.log(`${tag} Sẵn sàng trang Upload TikTok (Port: ${res.port || 'CDP'})`);
    } else {
      console.log(`[LỖI] ${res.error}`);
    }

    try {
      const now = new Date();
      fs.utimesSync(START_LOCK_FILE, now, now);
    } catch (_) {}

    // Nghỉ 1.3 giây giữa các tài khoản để đảm bảo AdsPower Local API không bao giờ bị nghẽn (giới hạn 1 req/s)
    await sleep(1300);
  }

  console.log(`\nHoàn tất: Đã kích hoạt sẵn sàng ${successCount}/${targetList.length} tài khoản AdsPower vào trang Upload TikTok!`);

  // Kích hoạt cầu nối CDP adspower_bridge.js chạy nền để các cổng 9223-9235 luôn sẵn sàng (<1ms)
  try {
    const bridgeScript = path.resolve(__dirname, 'adspower_bridge.js');
    if (fs.existsSync(bridgeScript)) {
      const nodeExe = process.execPath;
      const { spawn } = require('child_process');
      const bridgeProc = spawn(nodeExe, [bridgeScript], {
        detached: true,
        stdio: 'ignore'
      });
      bridgeProc.unref();
      console.log('✅ Đã kích hoạt cầu nối CDP (adspower_bridge.js) chạy nền!');
    }
  } catch (e) {}
}

async function main() {
  fs.mkdirSync(HYPERCLIP_DIR, { recursive: true });
  let lockFd;
  try {
    lockFd = fs.openSync(START_LOCK_FILE, 'wx');
  } catch (e) {
    try {
      const age = Date.now() - fs.statSync(START_LOCK_FILE).mtimeMs;
      if (age < 10 * 60 * 1000) {
        console.log('[AdsPower] Startup AdsPower đang chạy; bỏ qua lần gọi trùng.');
        return;
      }
      fs.unlinkSync(START_LOCK_FILE);
      lockFd = fs.openSync(START_LOCK_FILE, 'wx');
    } catch (_) {
      console.log('[AdsPower] Không lấy được khóa startup AdsPower; bỏ qua lần gọi trùng.');
      return;
    }
  }

  try {
    await runStartup();
  } catch (e) {
    console.error('[AdsPower] Lỗi startup:', e.message);
  } finally {
    try { if (lockFd !== undefined) fs.closeSync(lockFd); } catch (_) {}
    try { fs.unlinkSync(START_LOCK_FILE); } catch (_) {}
  }
}

main();
