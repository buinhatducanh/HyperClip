/**
 * adspower_bridge.js
 * Cầu nối TCP DevTools Protocol (CDP): Chuyển tiếp cổng cố định 9223..9235
 * của HyperClip nội bộ sang đúng cổng debug động của từng Profile AdsPower SunBrowser.
 * Giúp HyperClip phát hiện CDP ngay lập tức (<1ms), triệt tiêu hoàn toàn độ trễ 100s - 200s.
 */

const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || 'http://127.0.0.1:50325';

function fetchJson(url) {
  return new Promise((resolve) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const activeBridges = new Map(); // virtualPort -> { server, targetPort, profileId }

function updateBridge(virtualPort, targetPort, profileId) {
  if (!virtualPort || !targetPort) return;
  virtualPort = parseInt(virtualPort, 10);
  targetPort = parseInt(targetPort, 10);
  if (isNaN(virtualPort) || isNaN(targetPort) || virtualPort <= 0 || targetPort <= 0) return;

  const existing = activeBridges.get(virtualPort);
  if (existing) {
    if (existing.targetPort === targetPort) return; // Không đổi
    try { existing.server.close(); } catch (e) {}
  }

  try {
    const server = net.createServer((clientSocket) => {
      const targetSocket = net.connect(targetPort, '127.0.0.1');
      clientSocket.pipe(targetSocket);
      targetSocket.pipe(clientSocket);
      clientSocket.on('error', () => {});
      targetSocket.on('error', () => {});
    });

    server.on('error', (err) => {
      if (err.code !== 'EADDRINUSE') {
        console.error(`[Bridge] Port ${virtualPort} error: ${err.message}`);
      }
    });

    server.listen(virtualPort, '127.0.0.1', () => {
      console.log(`[Bridge] ✅ Đã mở cầu nối: 127.0.0.1:${virtualPort} -> 127.0.0.1:${targetPort} (${profileId})`);
    });

    activeBridges.set(virtualPort, { server, targetPort, profileId });
  } catch (e) {
    console.error(`[Bridge] Không thể lắng nghe trên port ${virtualPort}: ${e.message}`);
  }
}

async function syncBridges() {
  const candidatePaths = [
    process.env.HYPERCLIP_DATA_DIR ? path.join(process.env.HYPERCLIP_DATA_DIR, '.hyperclip', 'tiktok.json') : null,
    'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/tiktok.json',
    path.resolve(__dirname, '../HyperClip-Data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../app/data/.hyperclip/tiktok.json'),
    path.resolve(__dirname, '../../HyperClip-Data/.hyperclip/tiktok.json'),
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

  if (!tiktokData || !Array.isArray(tiktokData.accounts)) return;

  for (let i = 0; i < tiktokData.accounts.length; i++) {
    const acc = tiktokData.accounts[i];
    const pid = acc.profileId ? acc.profileId.replace(/^adspower_/, '') : (acc.id ? acc.id.replace(/^adspower_/, '') : null);
    if (!pid || pid.startsWith('tt')) continue;

    const virtualPort = 9223 + i;
    try {
      const act = await fetchJson(`${ADSPOWER_API_URL}/api/v1/browser/active?user_id=${encodeURIComponent(pid)}`);
      if (act && act.code === 0 && act.data?.status === 'Active') {
        const debugPort = act.data?.debug_port;
        if (debugPort) {
          updateBridge(virtualPort, debugPort, acc.label || pid);
        }
      }
    } catch (e) {}
    await sleep(200);
  }
}

async function main() {
  console.log('=== KHỞI ĐỘNG CẦU NỐI CDP ADSPOWER (PORTS 9223-9235) ===');
  await syncBridges();

  // Đồng bộ định kỳ mỗi 15 giây
  setInterval(async () => {
    try {
      await syncBridges();
    } catch (e) {}
  }, 15000);
}

main();
