const http = require('http');
const { execSync } = require('child_process');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== 1. TẮT CÁC CỬA SỔ CHROME TIKTOK STUDIO RIÊNG ===');
  try {
    const psKill = [
      'Get-CimInstance Win32_Process',
      "Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -match 'TikTok-Profiles' }",
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force; 'Da tat Chrome PID: ' + $_.ProcessId }"
    ].join(' | ');
    const killOut = execSync(`powershell -NoProfile -Command "${psKill}"`, { encoding: 'utf8' }).trim();
    console.log(killOut || 'Không còn cửa sổ Chrome TikTok-Profiles nào chạy ngầm.');
  } catch (e) {
    console.log('Lỗi khi tắt Chrome:', e.message);
  }

  console.log('\n=== 2. TRẠNG THÁI ADSPOWER LOCAL API ===');
  try {
    const status = await get('http://127.0.0.1:50325/status');
    console.log('AdsPower API Status:', status);

    const userRes = await get('http://127.0.0.1:50325/api/v1/user/list?page=1&page_size=100');
    console.log(`Tổng số profile trên AdsPower: ${userRes.data?.list?.length || 0} hồ sơ`);
  } catch(e) {
    console.log('Lỗi kết nối AdsPower:', e.message);
  }

  console.log('\n=== 3. CÁC TIẾN TRÌNH TRÌNH DUYỆT ĐANG MỞ HIỆN TẠI ===');
  try {
    const psList = [
      'Get-CimInstance Win32_Process',
      "Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'SunBrowser.exe') -and $_.CommandLine -notmatch 'type=' }",
      "Select-Object ProcessId, Name, CommandLine | Format-List"
    ].join(' | ');
    const listOut = execSync(`powershell -NoProfile -Command "${psList}"`, { encoding: 'utf8' });
    console.log(listOut || 'Không có trình duyệt nào.');
  } catch(e) {
    console.log('Lỗi:', e.message);
  }
}

main();
