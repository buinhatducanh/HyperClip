const fs = require('fs');

const targetFiles = [
  'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/resources/tiktok_helper.js',
  'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/app/_internal/resources/tiktok_helper.js'
];

function norm(s) {
  return s.replace(/\r\n/g, '\n');
}

for (const filePath of targetFiles) {
  if (!fs.existsSync(filePath)) continue;
  console.log('Patching ' + filePath + '...');
  let code = fs.readFileSync(filePath, 'utf8');
  const usesCrlf = code.includes('\r\n');
  code = norm(code);

  // --- PART A ---
  const needleA = norm(
'          if (targetAcc) {\n' +
'            if (targetAcc.profileId && !targetAcc.profileId.startsWith(\'tt\')) {\n' +
'              return { type: \'user_id\', value: targetAcc.profileId };\n' +
'            }\n' +
'            if (targetAcc.adsPowerSerial) return { type: \'serial_number\', value: targetAcc.adsPowerSerial };\n' +
'            if (targetAcc.id && targetAcc.id.startsWith(\'adspower_\') && !targetAcc.id.startsWith(\'adspower_tt\')) {\n' +
'              return { type: \'user_id\', value: targetAcc.id.replace(\'adspower_\', \'\') };\n' +
'            }\n' +
'          }\n' +
'        }\n' +
'      }\n' +
'    }\n' +
'  } catch (err) {\n' +
'    dlog(`[AdsPower] Kh\u00f4ng \u0111\u1ecdc \u0111\u01b0\u1ee3c profileId t\u1eeb tiktok.json: ${err.message}`);\n' +
'  }\n' +
'\n' +
'  if (accountIndex >= 0) {\n' +
'    return { type: \'serial_number\', value: accountIndex + 1 };\n' +
'  }\n' +
'  if (portStr && portStr.startsWith(\'k\')) {\n' +
'    return { type: \'user_id\', value: portStr };\n' +
'  }\n' +
'  return { type: \'serial_number\', value: 1 };\n' +
'}'
  );

  const replacementA = norm(
'          if (targetAcc) {\n' +
'            if (targetAcc.enabled === false) {\n' +
'              return { type: \'skip\', reason: `T\u00e0i kho\u1ea3n [${targetAcc.label || targetAcc.id}] \u0111\u00e3 t\u1eaft (enabled=false)` };\n' +
'            }\n' +
'            if (targetAcc.id && targetAcc.id.startsWith(\'tt\')) {\n' +
'              return { type: \'skip\', reason: `T\u00e0i kho\u1ea3n Chrome th\u01b0\u1eddng [${targetAcc.label || targetAcc.id}] kh\u00f4ng d\u00f9ng AdsPower` };\n' +
'            }\n' +
'            if (targetAcc.profileId && targetAcc.profileId.startsWith(\'tt\')) {\n' +
'              return { type: \'skip\', reason: `T\u00e0i kho\u1ea3n Chrome th\u01b0\u1eddng [${targetAcc.label || targetAcc.id}] kh\u00f4ng d\u00f9ng AdsPower` };\n' +
'            }\n' +
'            if (targetAcc.profileId) {\n' +
'              return { type: \'user_id\', value: targetAcc.profileId.replace(/^adspower_/, \'\') };\n' +
'            }\n' +
'            if (targetAcc.adsPowerSerial) return { type: \'serial_number\', value: targetAcc.adsPowerSerial };\n' +
'            if (targetAcc.id && targetAcc.id.startsWith(\'adspower_\') && !targetAcc.id.startsWith(\'adspower_tt\')) {\n' +
'              return { type: \'user_id\', value: targetAcc.id.replace(\'adspower_\', \'\') };\n' +
'            }\n' +
'          }\n' +
'        }\n' +
'      }\n' +
'    }\n' +
'  } catch (err) {\n' +
'    dlog(`[AdsPower] Kh\u00f4ng \u0111\u1ecdc \u0111\u01b0\u1ee3c profileId t\u1eeb tiktok.json: ${err.message}`);\n' +
'  }\n' +
'\n' +
'  if (portStr && portStr.startsWith(\'k\')) {\n' +
'    return { type: \'user_id\', value: portStr };\n' +
'  }\n' +
'  return { type: \'skip\', reason: `Port ${port} kh\u00f4ng kh\u1edbp v\u1edbi AdsPower profile h\u1ee3p l\u1ec7 n\u00e0o` };\n' +
'}'
  );

  if (code.includes(needleA)) {
    code = code.replace(needleA, replacementA);
    console.log('-> Applied Part A');
  } else {
    console.log('-> Part A not found');
  }

  // --- PART B: getAdsPowerEndpoint & connectCdp ---
  const needleB = norm(
'async function getAdsPowerEndpoint(target) {\n' +
'  const queryParam = (target.type === \'user_id\')\n' +
'    ? `user_id=${encodeURIComponent(target.value)}`\n' +
'    : `serial_number=${encodeURIComponent(target.value)}`;\n' +
'\n' +
'  dlog(`[AdsPower] Kh\u1edfi \u0111\u1ed9ng / K\u1ebft n\u1ed1i Profile (${queryParam})...`);\n' +
'  const launchArgs = encodeURIComponent(JSON.stringify([\'https://www.tiktok.com/tiktokstudio/upload\']));\n' +
'  \n' +
'  let res = null;\n' +
'  try {\n' +
'    res = await fetchAdsPower(`/api/v1/browser/start?${queryParam}&open_tabs=1&launch_args=${launchArgs}`);\n' +
'  } catch (fetchErr) {\n' +
'    dlog(`[AdsPower] L\u1ed7i g\u1ecdi AdsPower API: ${fetchErr.message}`);\n' +
'  }\n' +
'\n' +
'  if (res && res.code === 0) {\n' +
'    const wsEndpoint = res.data?.ws?.puppeteer;\n' +
'    const debugPort = res.data?.debug_port;\n' +
'    if (wsEndpoint || debugPort) {\n' +
'      dlog(`[AdsPower] Profile (${queryParam}) s\u1eb5n s\u00e0ng: debug_port=${debugPort}`);\n' +
'      return wsEndpoint || `http://127.0.0.1:${debugPort}`;\n' +
'    }\n' +
'  }\n' +
'\n' +
'  const errMsg = res ? (res.msg || \'\') : \'No response\';\n' +
'  dlog(`[AdsPower] \u26a0\ufe0f Profile g\u1ed1c (${queryParam}) kh\u00f4ng th\u1ec3 k\u1ebft n\u1ed1i (${errMsg}). \u0110ang t\u1ef1 \u0111\u1ed9ng t\u00ecm ki\u1ebfm profile kh\u1ea3 d\u1ee5ng \u0111\u1ec3 fallback...`);\n' +
'  const allAccs = getAllAdsPowerAccounts();\n' +
'  for (const acc of allAccs) {\n' +
'    const pid = acc.profileId || acc.id;\n' +
'    if (!pid || pid.startsWith(\'tt\') || pid === target.value || `adspower_${pid}` === target.value) continue;\n' +
'    await sleep(350); // Tr\u00e1nh rate-limit c\u1ee7a AdsPower\n' +
'    try {\n' +
'      const cleanPid = pid.replace(/^adspower_/, \'\');\n' +
'      const fbParam = `user_id=${encodeURIComponent(cleanPid)}`;\n' +
'      const fbRes = await fetchAdsPower(`/api/v1/browser/start?${fbParam}&open_tabs=1&launch_args=${launchArgs}`);\n' +
'      if (fbRes && fbRes.code === 0) {\n' +
'        const fbWs = fbRes.data?.ws?.puppeteer;\n' +
'        const fbPort = fbRes.data?.debug_port;\n' +
'        if (fbWs || fbPort) {\n' +
'          dlog(`[AdsPower] \u2705 T\u1ef0 \u0110\u1ed8NG FALLBACK TH\u00c0NH C\u00d4NG sang profile [${acc.label || cleanPid}] (${fbParam}, port ${fbPort})!`);\n' +
'          return fbWs || `http://127.0.0.1:${fbPort}`;\n' +
'        }\n' +
'      }\n' +
'    } catch (fbErr) {\n' +
'      // Th\u1eed account ti\u1ebfp theo\n' +
'    }\n' +
'  }\n' +
'\n' +
'  throw new Error(`ADSPOWER_API_ERROR (${queryParam}): ${errMsg}`);\n' +
'}\n' +
'\n' +
'// Connect CDP: K\u1ebft n\u1ed1i \u0111\u1ed9c quy\u1ec1n AdsPower Profile theo profileId ho\u1eb7c Serial\n' +
'async function connectCdp(port) {\n' +
'  const target = getAdsPowerProfileIdentifier(port);\n' +
'  const targetLabel = `${target.type}=${target.value}`;\n' +
'  \n' +
'  // K\u1ebft n\u1ed1i qua AdsPower (\u0110\u00e3 g\u1ee1 b\u1ecf v\u0129nh vi\u1ec5n c\u01a1 ch\u1ebf m\u1edf Google Chrome th\u01b0\u1eddng)\n' +
'  try {\n' +
'    const adsTarget = await getAdsPowerEndpoint(target);\n' +
'    const portMatch = String(adsTarget).match(/:(\\d+)/);\n' +
'    if (portMatch && typeof port === \'number\' && port >= 9223) {\n' +
'      ensurePortBridge(port, portMatch[1]);\n' +
'    }\n' +
'    dlog(`[AdsPower] N\u1ed1i CDP v\u00e0o AdsPower Profile (${targetLabel}) qua ${adsTarget}...`);\n' +
'    const browser = await chromium.connectOverCDP(adsTarget, { timeout: 15000 });\n' +
'    dlog(`[AdsPower] \u0110\u00e3 k\u1ebft n\u1ed1i th\u00e0nh c\u00f4ng t\u1edbi AdsPower Profile (${targetLabel})!`);\n' +
'    return browser;\n' +
'  } catch (adsErr) {\n' +
'    dlog(`[AdsPower] Kh\u00f4ng th\u1ec3 k\u1ebft n\u1ed1i AdsPower Profile (${targetLabel}): ${adsErr.message}`);\n' +
'    throw new Error(`ADSPOWER_CONNECT_FAILED (${targetLabel}): ${adsErr.message}. Vui l\u00f2ng m\u1edf ph\u1ea7n m\u1ec1m AdsPower!`);\n' +
'  }\n' +
'}'
  );

  const replacementB = norm(
'async function getAdsPowerEndpoint(target, opts = {}) {\n' +
'  const isPrepare = !!opts.isPrepare;\n' +
'  const queryParam = (target.type === \'user_id\')\n' +
'    ? `user_id=${encodeURIComponent(target.value)}`\n' +
'    : `serial_number=${encodeURIComponent(target.value)}`;\n' +
'\n' +
'  // Ki\u1ec3m tra ph\u00f2ng th\u1ee7: n\u1ebfu \u0111ang prepare v\u00e0 upload v\u1eeba t\u1edbi -> nh\u1ea3 ngay l\u1eadp t\u1ee9c\n' +
'  if (isPrepare && uploadPending) {\n' +
'    dlog(`[SmartSkip] getAdsPowerEndpoint: c\u00f3 upload pending, nh\u01b0\u1eddng \u0111\u01b0\u1eddng ngay (0ms)`);\n' +
'    return null;\n' +
'  }\n' +
'\n' +
'  // 1. Ki\u1ec3m tra nhanh xem profile \u0111\u00e3 Active s\u1eb5n ch\u01b0a tr\u01b0\u1edbc khi g\u1ecdi start\n' +
'  try {\n' +
'    const actRes = await fetchAdsPower(`/api/v1/browser/active?${queryParam}`);\n' +
'    if (actRes && actRes.code === 0 && actRes.data?.status === \'Active\') {\n' +
'      const debugPort = actRes.data?.debug_port;\n' +
'      const wsPuppeteer = actRes.data?.ws?.puppeteer;\n' +
'      if (debugPort || wsPuppeteer) {\n' +
'        dlog(`[AdsPower] Profile (${queryParam}) \u0111\u00e3 Active s\u1eb5n: debug_port=${debugPort}`);\n' +
'        return wsPuppeteer || `http://127.0.0.1:${debugPort}`;\n' +
'      }\n' +
'    }\n' +
'  } catch (e) {}\n' +
'\n' +
'  if (isPrepare && uploadPending) return null;\n' +
'\n' +
'  dlog(`[AdsPower] Kh\u1edfi \u0111\u1ed9ng / K\u1ebft n\u1ed1i Profile (${queryParam})...`);\n' +
'  const launchArgs = encodeURIComponent(JSON.stringify([\'https://www.tiktok.com/tiktokstudio/upload\']));\n' +
'  \n' +
'  let res = null;\n' +
'  try {\n' +
'    res = await fetchAdsPower(`/api/v1/browser/start?${queryParam}&open_tabs=1&launch_args=${launchArgs}`);\n' +
'  } catch (fetchErr) {\n' +
'    dlog(`[AdsPower] L\u1ed7i g\u1ecdi AdsPower API: ${fetchErr.message}`);\n' +
'  }\n' +
'\n' +
'  if (res && res.code === 0) {\n' +
'    const wsEndpoint = res.data?.ws?.puppeteer;\n' +
'    const debugPort = res.data?.debug_port;\n' +
'    if (wsEndpoint || debugPort) {\n' +
'      dlog(`[AdsPower] Profile (${queryParam}) s\u1eb5n s\u00e0ng: debug_port=${debugPort}`);\n' +
'      return wsEndpoint || `http://127.0.0.1:${debugPort}`;\n' +
'    }\n' +
'  }\n' +
'\n' +
'  // C\u01a0 CH\u1ebe PH\u00d2NG TH\u1ee6: Khi ch\u1ec9 \u0111ang l\u00e0m n\u00f3ng (prepare), TUY\u1ec6T \u0110\u1ed0I KH\u00d4NG FALLBACK m\u1edf profile kh\u00e1c!\n' +
'  if (isPrepare) {\n' +
'    dlog(`[SmartSkip] Profile (${queryParam}) ch\u01b0a s\u1eb5n s\u00e0ng l\u00fac prepare -> B\u1ecf qua l\u00e0m n\u00f3ng profile n\u00e0y (0ms blocking).`);\n' +
'    return null;\n' +
'  }\n' +
'\n' +
'  // Ch\u1ec9 khi upload th\u1eadt (doUpload) m\u1edbi c\u1ea7n fallback n\u1ebfu profile ch\u00ednh h\u1ecfng\n' +
'  const errMsg = res ? (res.msg || \'\') : \'No response\';\n' +
'  dlog(`[AdsPower] \u26a0\ufe0f Profile g\u1ed1c (${queryParam}) kh\u00f4ng th\u1ec3 k\u1ebft n\u1ed1i (${errMsg}). \u0110ang t\u1ef1 \u0111\u1ed9ng t\u00ecm ki\u1ebfm profile kh\u1ea3 d\u1ee5ng \u0111\u1ec3 fallback...`);\n' +
'  const allAccs = getAllAdsPowerAccounts();\n' +
'  for (const acc of allAccs) {\n' +
'    if (acc.enabled === false) continue;\n' +
'    const pid = acc.profileId || acc.id;\n' +
'    if (!pid || pid.startsWith(\'tt\') || pid === target.value || `adspower_${pid}` === target.value) continue;\n' +
'    await sleep(350); // Tr\u00e1nh rate-limit c\u1ee7a AdsPower\n' +
'    try {\n' +
'      const cleanPid = pid.replace(/^adspower_/, \'\');\n' +
'      const fbParam = `user_id=${encodeURIComponent(cleanPid)}`;\n' +
'      const fbRes = await fetchAdsPower(`/api/v1/browser/start?${fbParam}&open_tabs=1&launch_args=${launchArgs}`);\n' +
'      if (fbRes && fbRes.code === 0) {\n' +
'        const fbWs = fbRes.data?.ws?.puppeteer;\n' +
'        const fbPort = fbRes.data?.debug_port;\n' +
'        if (fbWs || fbPort) {\n' +
'          dlog(`[AdsPower] \u2705 T\u1ef0 \u0110\u1ed8NG FALLBACK TH\u00c0NH C\u00d4NG sang profile [${acc.label || cleanPid}] (${fbParam}, port ${fbPort})!`);\n' +
'          return fbWs || `http://127.0.0.1:${fbPort}`;\n' +
'        }\n' +
'      }\n' +
'    } catch (fbErr) {\n' +
'      // Th\u1eed account ti\u1ebfp theo\n' +
'    }\n' +
'  }\n' +
'\n' +
'  throw new Error(`ADSPOWER_API_ERROR (${queryParam}): ${errMsg}`);\n' +
'}\n' +
'\n' +
'// Connect CDP: K\u1ebft n\u1ed1i \u0111\u1ed9c quy\u1ec1n AdsPower Profile theo profileId ho\u1eb7c Serial\n' +
'async function connectCdp(port, opts = {}) {\n' +
'  const isPrepare = !!opts.isPrepare;\n' +
'  const target = getAdsPowerProfileIdentifier(port);\n' +
'  if (target.type === \'skip\') {\n' +
'    dlog(`[SmartSkip] connectCdp b\u1ecf qua (${target.reason})`);\n' +
'    if (isPrepare) return null;\n' +
'    throw new Error(`SKIP_ACCOUNT: ${target.reason}`);\n' +
'  }\n' +
'  const targetLabel = `${target.type}=${target.value}`;\n' +
'  \n' +
'  // K\u1ebft n\u1ed1i qua AdsPower\n' +
'  try {\n' +
'    const adsTarget = await getAdsPowerEndpoint(target, opts);\n' +
'    if (!adsTarget && isPrepare) return null;\n' +
'    const portMatch = String(adsTarget).match(/:(\\d+)/);\n' +
'    if (portMatch && typeof port === \'number\' && port >= 9223) {\n' +
'      ensurePortBridge(port, portMatch[1]);\n' +
'    }\n' +
'    dlog(`[AdsPower] N\u1ed1i CDP v\u00e0o AdsPower Profile (${targetLabel}) qua ${adsTarget}...`);\n' +
'    const cdpTimeout = isPrepare ? 3500 : 15000;\n' +
'    const browser = await chromium.connectOverCDP(adsTarget, { timeout: cdpTimeout });\n' +
'    dlog(`[AdsPower] \u0110\u00e3 k\u1ebft n\u1ed1i th\u00e0nh c\u00f4ng t\u1edbi AdsPower Profile (${targetLabel})!`);\n' +
'    return browser;\n' +
'  } catch (adsErr) {\n' +
'    dlog(`[AdsPower] Kh\u00f4ng th\u1ec3 k\u1ebft n\u1ed1i AdsPower Profile (${targetLabel}): ${adsErr.message}`);\n' +
'    if (isPrepare) return null;\n' +
'    throw new Error(`ADSPOWER_CONNECT_FAILED (${targetLabel}): ${adsErr.message}. Vui l\u00f2ng m\u1edf ph\u1ea7n m\u1ec1m AdsPower!`);\n' +
'  }\n' +
'}'
  );

  if (code.includes(needleB)) {
    code = code.replace(needleB, replacementB);
    console.log('-> Applied Part B');
  } else {
    console.log('-> Part B not found');
  }

  // --- PART C: doPrepare ---
  const needleC = norm(
'async function doPrepare(port) {\n' +
'  const t = Date.now();\n' +
'  const browser = await connectCdp(port);\n' +
'  try {\n' +
'    // Nh\u1ea3 ngay \u1edf m\u1ecdi m\u1ed1c n\u1ebfu upload v\u1eeba t\u1edbi: upload l\u00e0 vi\u1ec7c n\u00f3ng, prepare ch\u1ec9\n' +
'    // l\u00e0 warm \u2014 warm d\u1edf dang v\u00f4 h\u1ea1i (upload t\u1ef1 goto/\u0111\u00f3ng popup nh\u01b0 tr\u01b0\u1edbc).\n' +
'    if (uploadPending) { dlog(\'prepare nh\u1ea3 s\u1edbm \u2014 upload v\u1eeba t\u1edbi\'); return {}; }\n' +
'    const page = await getTikTokPage(browser, true);\n' +
'    if (uploadPending) { dlog(\'prepare nh\u1ea3 s\u1edbm \u2014 upload v\u1eeba t\u1edbi\'); return {}; }\n' +
'    await gotoUpload(page);\n' +
'    if (uploadPending) { dlog(\'prepare nh\u1ea3 s\u1edbm \u2014 upload v\u1eeba t\u1edbi\'); return {}; }\n' +
'    await dismissBlockingPopups(page);\n' +
'    dlog(`prepare xong sau ${((Date.now() - t) / 1000).toFixed(1)}s (trang upload s\u1eb5n s\u00e0ng)`);\n' +
'    return {};\n' +
'  } finally {\n' +
'    await browser.close().catch(() => {});\n' +
'  }\n' +
'}'
  );

  const replacementC = norm(
'async function doPrepare(port) {\n' +
'  if (uploadPending) {\n' +
'    dlog(\'[SmartSkip] prepare b\u1ecf qua ngay: upload \u0111ang ch\u1edd (0ms)\');\n' +
'    return { skipped: true };\n' +
'  }\n' +
'  const target = getAdsPowerProfileIdentifier(port);\n' +
'  if (target.type === \'skip\') {\n' +
'    dlog(`[SmartSkip] prepare b\u1ecf qua port ${port}: ${target.reason} (0ms)`);\n' +
'    return { skipped: true };\n' +
'  }\n' +
'\n' +
'  const t = Date.now();\n' +
'  const browser = await connectCdp(port, { isPrepare: true });\n' +
'  if (!browser) {\n' +
'    dlog(`[SmartSkip] prepare kh\u00f4ng l\u1ea5y \u0111\u01b0\u1ee3c CDP cho port ${port} -> b\u1ecf qua an to\u00e0n`);\n' +
'    return { skipped: true };\n' +
'  }\n' +
'  try {\n' +
'    if (uploadPending) { dlog(\'prepare nh\u1ea3 s\u1edbm \u2014 upload v\u1eeba t\u1edbi\'); return { skipped: true }; }\n' +
'    const page = await getTikTokPage(browser, true);\n' +
'    if (uploadPending) { dlog(\'prepare nh\u1ea3 s\u1edbm \u2014 upload v\u1eeba t\u1edbi\'); return { skipped: true }; }\n' +
'    await gotoUpload(page);\n' +
'    if (uploadPending) { dlog(\'prepare nh\u1ea3 s\u1edbm \u2014 upload v\u1eeba t\u1edbi\'); return { skipped: true }; }\n' +
'    await dismissBlockingPopups(page);\n' +
'    dlog(`prepare xong sau ${((Date.now() - t) / 1000).toFixed(1)}s (trang upload s\u1eb5n s\u00e0ng)`);\n' +
'    return {};\n' +
'  } finally {\n' +
'    await browser.close().catch(() => {});\n' +
'  }\n' +
'}'
  );

  if (code.includes(needleC)) {
    code = code.replace(needleC, replacementC);
    console.log('-> Applied Part C');
  } else {
    console.log('-> Part C not found');
  }

  // --- PART D: waitForPrepareToYield & handle ---
  const needleD = norm(
'const PREPARE_YIELD_MAX_MS = 3000;\n' +
'let uploadPending = false;\n' +
'let preparing = false;\n' +
'\n' +
'async function waitForPrepareToYield() {\n' +
'  const deadline = Date.now() + PREPARE_YIELD_MAX_MS;\n' +
'  while (preparing && Date.now() < deadline) {\n' +
'    await sleep(50);\n' +
'  }\n' +
'  if (preparing) dlog(\'prepare ch\u01b0a nh\u1ea3 sau 3s \u2014 upload ch\u1ea1y \u0111\u00e8 (\u01b0u ti\u00ean upload)\');\n' +
'}\n' +
'\n' +
'async function handle(req) {\n' +
'  const id = req.id;\n' +
'  try {\n' +
'    switch (req.cmd) {\n' +
'      case \'ping\':\n' +
'        return { id, ok: true, cmd: \'pong\' };\n' +
'      case \'upload\': {\n' +
'        if (!req.filePath) throw new Error(\'filePath required\');\n' +
'        uploadPending = true;\n' +
'        try {\n' +
'          await waitForPrepareToYield();\n' +
'          const result = await Promise.race([\n' +
'            doUpload(req.port || 9223, req.filePath, String(req.caption || \'\'), !!req.fastDone),\n' +
'            sleep(UPLOAD_TOTAL_TIMEOUT_MS).then(() => {\n' +
'              throw new Error(\'UPLOAD_TIMEOUT: qu\u00e1 5 ph\u00fat\');\n' +
'            }),\n' +
'          ]);\n' +
'          return { id, ok: true, videoUrl: result.videoUrl || null, phases: result.phases || null };\n' +
'        } finally {\n' +
'          uploadPending = false;\n' +
'        }\n' +
'      }\n' +
'      // Pass 48c: warm trang upload l\u00fac prewarm (song song download+render).\n' +
'      case \'prepare\': {\n' +
'        if (uploadPending) {\n' +
'          dlog(\'prepare b\u1ecf qua \u2014 \u0111ang c\u00f3 upload (kh\u00f4ng gi\u1eabm ch\u00e2n)\');\n' +
'          return { id, ok: true, cmd: \'prepare\', skipped: true };\n' +
'        }\n' +
'        preparing = true;\n' +
'        try {\n' +
'          await doPrepare(req.port || 9223);\n' +
'        } finally {\n' +
'          preparing = false;\n' +
'        }\n' +
'        return { id, ok: true, cmd: \'prepare\' };\n' +
'      }'
  );

  const replacementD = norm(
'const PREPARE_YIELD_MAX_MS = 200;\n' +
'let uploadPending = false;\n' +
'let preparing = false;\n' +
'\n' +
'async function waitForPrepareToYield() {\n' +
'  const deadline = Date.now() + PREPARE_YIELD_MAX_MS;\n' +
'  while (preparing && Date.now() < deadline) {\n' +
'    await sleep(20);\n' +
'  }\n' +
'  if (preparing) dlog(\'prepare ch\u01b0a nh\u1ea3 \u2014 upload ch\u1ea1y ngay (\u01b0u ti\u00ean tuy\u1ec7t \u0111\u1ed1i upload)\');\n' +
'}\n' +
'\n' +
'async function handle(req) {\n' +
'  const id = req.id;\n' +
'  try {\n' +
'    switch (req.cmd) {\n' +
'      case \'ping\':\n' +
'        return { id, ok: true, cmd: \'pong\' };\n' +
'      case \'upload\': {\n' +
'        if (!req.filePath) throw new Error(\'filePath required\');\n' +
'        uploadPending = true;\n' +
'        preparing = false; // Ng\u1eaft c\u1edd preparing ngay l\u1eadp t\u1ee9c \u0111\u1ec3 \u01b0u ti\u00ean upload!\n' +
'        try {\n' +
'          await waitForPrepareToYield();\n' +
'          const result = await Promise.race([\n' +
'            doUpload(req.port || 9223, req.filePath, String(req.caption || \'\'), !!req.fastDone),\n' +
'            sleep(UPLOAD_TOTAL_TIMEOUT_MS).then(() => {\n' +
'              throw new Error(\'UPLOAD_TIMEOUT: qu\u00e1 5 ph\u00fat\');\n' +
'            }),\n' +
'          ]);\n' +
'          return { id, ok: true, videoUrl: result.videoUrl || null, phases: result.phases || null };\n' +
'        } finally {\n' +
'          uploadPending = false;\n' +
'        }\n' +
'      }\n' +
'      // Pass 48c: warm trang upload l\u00fac prewarm (song song download+render).\n' +
'      case \'prepare\': {\n' +
'        if (uploadPending) {\n' +
'          dlog(\'prepare b\u1ecf qua \u2014 \u0111ang c\u00f3 upload (kh\u00f4ng gi\u1eabm ch\u00e2n)\');\n' +
'          return { id, ok: true, cmd: \'prepare\', skipped: true };\n' +
'        }\n' +
'        const target = getAdsPowerProfileIdentifier(req.port || 9223);\n' +
'        if (target.type === \'skip\') {\n' +
'          dlog(`[SmartSkip] prepare command b\u1ecf qua port ${req.port}: ${target.reason}`);\n' +
'          return { id, ok: true, cmd: \'prepare\', skipped: true };\n' +
'        }\n' +
'        preparing = true;\n' +
'        try {\n' +
'          await doPrepare(req.port || 9223);\n' +
'        } finally {\n' +
'          preparing = false;\n' +
'        }\n' +
'        return { id, ok: true, cmd: \'prepare\' };\n' +
'      }'
  );

  if (code.includes(needleD)) {
    code = code.replace(needleD, replacementD);
    console.log('-> Applied Part D');
  } else {
    console.log('-> Part D not found');
  }

  // --- PART E: Hot-Start smart abortion ---
  const needleE = norm(
'    for (let i = 0; i < accounts.length; i++) {\n' +
'      const acc = accounts[i];\n' +
'      const isAssigned = targetList.some(t => t.id === acc.id || t.profileId === acc.profileId);\n' +
'      if (!isAssigned) continue;'
  );

  const replacementE = norm(
'    for (let i = 0; i < accounts.length; i++) {\n' +
'      if (uploadPending) {\n' +
'        dlog(\'[AdsPower Hot-Start] Ph\u00e1t hi\u1ec7n upload \u0111ang ch\u1ea1y -> T\u1ea1m d\u1eebng Hot-Start ngay l\u1eadp t\u1ee9c \u0111\u1ec3 nh\u01b0\u1eddng \u0111\u01b0\u1eddng\');\n' +
'        break;\n' +
'      }\n' +
'      const acc = accounts[i];\n' +
'      if (acc.enabled === false) continue;\n' +
'      const isAssigned = targetList.some(t => t.id === acc.id || t.profileId === acc.profileId);\n' +
'      if (!isAssigned) continue;'
  );

  if (code.includes(needleE)) {
    code = code.replace(needleE, replacementE);
    console.log('-> Applied Part E');
  } else {
    console.log('-> Part E not found');
  }

  if (usesCrlf) {
    code = code.replace(/\n/g, '\r\n');
  }
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Successfully written ' + filePath);
}
