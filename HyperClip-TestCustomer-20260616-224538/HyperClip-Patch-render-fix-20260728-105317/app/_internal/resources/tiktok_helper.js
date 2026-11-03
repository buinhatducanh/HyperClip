#!/usr/bin/env node
// crates/hyperclip_ipc/src/tiktok_helper.js
//
// TikTok upload daemon (Pass 38) — điều khiển Chrome ĐANG CHẠY qua CDP bằng
// playwright-core (connectOverCDP, KHÔNG bundle browser). Chrome do Rust
// launch sẵn với user-data-dir TikTok-Profiles/<account>/ + port 9223 và
// start-URL tiktokstudio/upload — helper chỉ connect và thao tác trên tab đó.
//
// Protocol JSON-RPC qua stdin/stdout (stdout CHỈ chứa JSON; log ra stderr):
//   {id, cmd:"upload", port, filePath, caption} → {id, ok, videoUrl?}
//   {id, cmd:"checkLogin", port}                → {id, ok, loggedIn}
//   {id, cmd:"ping"}                            → {id, ok:true, cmd:"pong"}
// Lỗi chuẩn hóa trong `error`:
//   NOT_LOGGED_IN  — profile chưa đăng nhập TikTok (Rust: KHÔNG retry)
//   UPLOAD_TIMEOUT — quá 5 phút chưa xong (Rust: retry theo backoff)
//
// ⚠ Sau khi sửa file này: cp sang source/resources/tiktok_helper.js
//   (giống trap innertube_helper.js — production load bản resources).

'use strict';

// ============================================================================
// TOÀN BỘ SELECTOR TIKTOK GOM Ở ĐÂY — TikTok đổi DOM thì chỉ vá khối này.
// Mỗi mục là MẢNG selector thử theo thứ tự; cái nào khớp trước dùng cái đó.
// ============================================================================
const TIKTOK = {
  uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload',
  // URL đích sau khi đăng thành công (TikTok chuyển về trang quản lý bài)
  contentUrlPart: '/tiktokstudio/content',
  // Chưa đăng nhập → studio redirect về /login
  loginUrlPart: '/login',
  fileInput: [
    'input[type="file"][accept*="video"]',
    'input[type="file"]',
  ],
  captionEditor: [
    'div.public-DraftEditor-content[contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"]',
  ],
  postButton: [
    // data-e2e = selector gốc của TikTok Studio — luôn ưu tiên
    'button[data-e2e="post_video_button"]',
    '[data-e2e="post_video_button"]',
    // Exact-text match: KHÔNG dùng :has-text() vì nó substring → nhầm
    // "Đăng xuất" / "Đăng nhập". :text-is() chỉ match nội dung text thô.
    'button:text-is("Đăng")',
    'button:text-is("Post")',
    'button:text-is("Đăng ngay")',
    'button:text-is("Post now")',
    // Fallback data-e2e khác (TikTok variant)
    'button[data-e2e="upload_post"]',
    // Generic submit button —last resort
    'button[type="submit"]',
  ],
  // Hint thành công ngoài việc đổi URL (modal "quản lý bài đăng")
  successHint: [
    'button[data-e2e="upload_another_button"]',
    'div:has-text("Video của bạn đã được đăng")',
    'div:has-text("Your video has been uploaded")',
  ],
  // Popup/modal đè trang upload chặn pointer (first-post experience, thông báo
  // tính năng mới…) — 18/07 máy 4070: modal "Turn on automatic content checks?"
  // + tooltip "New editing features added" chặn nút Đăng đủ 30s timeout.
  // Thứ tự = ưu tiên. CHỈ bấm nút trung tính (Cancel/Got it/X đóng) — KHÔNG
  // bấm nút đổi setting tài khoản kiểu "Turn on".
  dismissButtons: [
    'div[class*="TUXModal"] button:has-text("Cancel")',
    'div[class*="TUXModal"] button:has-text("Hủy")',
    'button:has-text("Got it")',
    'button:has-text("Đã hiểu")',
    'div[class*="TUXModal"] [aria-label="Close"]',
    'div[class*="TUXModal"] button[class*="close"]',
  ],
  // SAU khi đã click Đăng: modal hiện ra có thể là hộp XÁC NHẬN ĐĂNG —
  // bấm Cancel lúc này là HỦY ĐĂNG (log khách 20/07: "đã đóng popup chặn
  // (Cancel)" 1 giây sau click Đăng → title đã nhập, bấm Đăng xong không
  // thấy gì, video không bao giờ lên). Nên pha này:
  //   - Modal có nút Đăng/Post (exact) → bấm ĐÚNG nút đó để hoàn tất.
  //   - Chỉ đóng bằng nút trung tính. TUYỆT ĐỐI không Cancel/Hủy/Escape.
  postPhaseConfirmButtons: [
    'div[class*="TUXModal"] button:text-is("Đăng")',
    'div[class*="TUXModal"] button:text-is("Post")',
    'div[class*="TUXModal"] button:text-is("Post now")',
    'div[class*="TUXModal"] button:text-is("Đăng ngay")',
    // Dialog "Continue to post?" (copyright check chưa xong) dùng container
    // KHÔNG phải TUXModal → 4 selector scoped ở trên trượt, khách KẸT tại hộp
    // này (21/07). "Post now"/"Đăng ngay" CHỈ xuất hiện trên hộp xác nhận
    // (nút đăng chính là "Post"/"Đăng") nên bấm ở bất kỳ container nào cũng an
    // toàn = tiếp tục đăng. text-is + has-text để chịu cả khác-container lẫn
    // lệch khoảng trắng nhãn.
    'button:text-is("Post now")',
    'button:text-is("Đăng ngay")',
    'button:has-text("Post now")',
    'button:has-text("Đăng ngay")',
  ],
  postPhaseDismissButtons: [
    'button:has-text("Got it")',
    'button:has-text("Đã hiểu")',
    'div[class*="TUXModal"] [aria-label="Close"]',
    'div[class*="TUXModal"] button[class*="close"]',
  ],
};

const UPLOAD_TOTAL_TIMEOUT_MS = 5 * 60 * 1000; // trọn flow upload 5 phút
const CDP_CONNECT_TIMEOUT_MS = 20 * 1000;      // Chrome vừa launch cần vài giây mở CDP
const POST_CONFIRM_TIMEOUT_MS = 60 * 1000;     // Pass 47: 120→60 — hầu hết upload
                                                // TikTok xác nhận <30s, 60s đủ thoải
                                                // mái cho mạng chậm mà giảm 1 phút
                                                // chờ vô ích trước retry.
// Pass 47: thời gian quét tìm nút Đăng tối đa (trước khi coi là timeout).
// 60s = click loop budget; vẫn để escape popup + thử lại nhiều vòng.
const POST_CLICK_TIMEOUT_MS = 60 * 1000;

// ─── Nhịp gõ caption (Pass 48) ────────────────────────────────────
// Log khách 25/07 10:41: caption 87 ký tự đốt 7.4s trong tổng 12.7s upload.
// Nguyên nhân: mỗi ký tự là MỘT lệnh CDP riêng (keyboard.type 1 ký tự) rồi
// sleep 30-80ms → ~85ms/ký tự thực đo, tuyến tính theo độ dài tiêu đề.
// Nay gõ theo CỤM: playwright vẫn phát key event THẬT cho từng ký tự (delay
// trong-cụm), chỉ bỏ round-trip + sleep thừa giữa từng ký tự. Vẫn có jitter
// giữa các cụm nên không thành "paste-bot" một nhát.
const CAPTION_CHUNK_LEN = 12;          // ký tự mỗi cụm
const CAPTION_KEY_DELAY_MIN = 8;       // ms giữa 2 ký tự TRONG cụm
const CAPTION_KEY_DELAY_MAX = 22;
const CAPTION_CHUNK_PAUSE_MIN = 35;    // ms nghỉ giữa 2 cụm (nhịp người)
const CAPTION_CHUNK_PAUSE_MAX = 90;
// Pass 48b: gõ CỤM vẫn còn 37ms/ký tự thực đo (log khách 11:02 — 87 ký tự
// 3.2s) vì playwright dispatch keyDown/keyUp qua CDP CHO TỪNG ký tự. insertText
// đưa cả cụm trong MỘT lệnh CDP (Draft.js của TikTok nhận đúng input event —
// giống người dán từng đoạn). Có verify text sau khi chèn: không đủ chữ thì tự
// xoá và gõ lại bằng key event (đường cũ), nên không đánh cược tính đúng đắn.
// Đặt false để quay về gõ key-event hoàn toàn.
const CAPTION_FAST_INSERT = true;
const CAPTION_INSERT_CHUNK_LEN = 24;

// Pass 48d — fastDone (setting `tiktokFastDone`, Rust vẫn gửi cờ này): TRƯỚC
// đây sau khi bấm "Post now" chỉ chờ thêm grace này rồi BÁO XONG, không chờ
// redirect /content (~2.1s ở máy khách). Từ khi có xác nhận bằng XHR publish
// (status_code:0) thì đường tắt đó vừa thừa vừa nguy hiểm: XHR về CÒN SỚM HƠN
// redirect mà là sự thật server, còn báo-xong-lạc-quan có thể báo "đã đăng" cho
// video TikTok từ chối ngay sau đó (nội dung là clip đăng lại — báo sai không
// chấp nhận được). Nay grace này CHỈ còn là mốc ghi log chẩn đoán "lệnh đăng đã
// gửi mà chưa thấy xác nhận sau ngần này ms"; xác nhận LUÔN phải là XHR
// status_code:0, hoặc dự phòng redirect /content / hint DOM.
const FAST_DONE_GRACE_MS = 500;

const readline = require('readline');
let chromium;
try {
  chromium = require('playwright-core').chromium;
} catch (e) {
  process.stderr.write('[tiktok_helper] FATAL: playwright-core chưa cài (npm install)\n');
  process.exit(1);
}

function dlog(msg) {
  process.stderr.write(`[tiktok_helper] ${msg}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randDelay() {
  // Gõ caption 30-80ms/ký tự — nhịp người thật, tránh paste-bot
  return 30 + Math.floor(Math.random() * 51);
}

function randBetween(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// So text trong editor với caption mong muốn — bỏ khoảng trắng vì Draft.js
// chuẩn hoá nbsp/newline khác nhau.
function normalizeCaptionText(s) {
  return String(s || '').replace(/\s+/g, '').trim();
}

async function captionMatches(editor, caption) {
  try {
    const got = await editor.el.innerText();
    return normalizeCaptionText(got) === normalizeCaptionText(caption);
  } catch (_) {
    return false; // không đọc được → coi như chưa khớp, đi đường gõ key
  }
}

async function clearCaption(page, editor) {
  // Pass 57: click() KHÔNG truyền timeout là chỗ chờ KHÔNG CÓ TRẦN duy nhất
  // trên đường nóng — Playwright mặc định 30s CỘNG chờ bounding-box ổn định,
  // nên chỉ cần Chrome kẹt luồng chính một nhịp là cả chặng caption phình ra.
  // Log khách 27/07 17:08: caption 5.6s trong khi typeCaption tự báo 0.2s;
  // trung vị 12 lượt cùng ngày là 0.5s. Riêng 5.4s dôi ra ở đây đã đẩy e2e
  // 11.9s → 17.0s — tức một lần Chrome khựng ăn đứt mọi thứ ta tối ưu được.
  // focus() đi thẳng CDP DOM.focus: không actionability wait, không đòi phần
  // tử nằm trong viewport. Vẫn thử click trước vì click đặt luôn caret; hỏng
  // thì focus + Ctrl+A bên dưới chọn toàn bộ, kết quả giống hệt.
  try {
    await editor.el.click({ timeout: 800 });
  } catch (_) {
    await editor.el.focus().catch(() => {});
  }
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  // Không sleep: Ctrl+A/Delete là lệnh CDP đồng bộ, và verify sau khi chèn
  // (captionMatches) đã là lưới an toàn nếu editor chưa kịp xử lý.
}

// Gõ caption theo cụm (xem khối CAPTION_* ở trên). Trả về số ms đã dùng để
// log — câu hỏi "sao upload lâu" từ nay trả lời được bằng một dòng log.
async function typeCaption(page, editor, caption) {
  const t = Date.now();
  // Đường NHANH: insertText từng cụm (1 lệnh CDP/cụm) + verify.
  if (CAPTION_FAST_INSERT) {
    try {
      for (let i = 0; i < caption.length; i += CAPTION_INSERT_CHUNK_LEN) {
        await page.keyboard.insertText(caption.slice(i, i + CAPTION_INSERT_CHUNK_LEN));
        if (i + CAPTION_INSERT_CHUNK_LEN < caption.length) {
          await sleep(randBetween(CAPTION_CHUNK_PAUSE_MIN, CAPTION_CHUNK_PAUSE_MAX));
        }
      }
      if (await captionMatches(editor, caption)) {
        return Date.now() - t;
      }
      dlog('insertText không vào đủ chữ — xoá, gõ lại bằng key event');
      await clearCaption(page, editor);
    } catch (e) {
      dlog(`insertText lỗi (${String(e.message).split('\n')[0]}) — fallback key event`);
      await clearCaption(page, editor).catch(() => {});
    }
  }
  // Đường CŨ (fallback): key event thật từng ký tự, theo cụm.
  for (let i = 0; i < caption.length; i += CAPTION_CHUNK_LEN) {
    const chunk = caption.slice(i, i + CAPTION_CHUNK_LEN);
    await page.keyboard.type(chunk, {
      delay: randBetween(CAPTION_KEY_DELAY_MIN, CAPTION_KEY_DELAY_MAX),
    });
    if (i + CAPTION_CHUNK_LEN < caption.length) {
      await sleep(randBetween(CAPTION_CHUNK_PAUSE_MIN, CAPTION_CHUNK_PAUSE_MAX));
    }
  }
  return Date.now() - t;
}

// Connect CDP với retry — Chrome do Rust vừa spawn có thể chưa mở port ngay.
async function connectCdp(port) {
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + CDP_CONNECT_TIMEOUT_MS;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(url, { timeout: 5000 });
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  throw new Error(`CDP_CONNECT_FAILED: ${lastErr ? lastErr.message : 'timeout'}`);
}

// Tab TikTok đã "mở sẵn" từ start-URL của Chrome; ưu tiên reuse nó.
async function getTikTokPage(browser, wantUploadPage) {
  const contexts = browser.contexts();
  let anyTikTok = null;
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      const u = p.url();
      if (wantUploadPage && u.includes('/tiktokstudio/upload')) return p;
      if (u.includes('tiktok.com') && !anyTikTok) anyTikTok = p;
    }
  }
  if (anyTikTok) return anyTikTok;
  const ctx = contexts[0] || (await browser.newContext());
  return ctx.newPage();
}

// Tìm selector đầu tiên khớp trong page + mọi frame, poll tới timeout.
async function findFirst(page, selList, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selList) {
      try {
        const el = await page.$(sel);
        if (el) return { el, sel, frame: null };
      } catch (_) { /* selector engine lỗi trên sel này — thử cái sau */ }
      for (const f of page.frames()) {
        try {
          const el = await f.$(sel);
          if (el) return { el, sel, frame: f };
        } catch (_) { /* frame đang navigate — bỏ qua */ }
      }
    }
    // Pass 48c: 500→120ms. Mỗi vòng quét đã tốn ~150ms CDP (N selector ×
    // (page + frames)) nên nhịp thật ~300ms; nhịp cũ để mất tới 0.5s MỖI
    // chặng chờ (editor, nút Đăng) — 3 chặng = 1.5s trong ngân sách 5s.
    await sleep(120);
  }
  return null;
}

// Như findFirst nhưng phát hiện redirect /login GIỮA LÚC ĐỢI — TikTok đá về
// login kiểu client-side SAU khi trang upload load xong, check 2s một lần
// trong gotoUpload không bắt được (18/07 10:15: selector đợi 30-90s rồi fail
// SELECTOR_MISS → retry vô ích, đáng lẽ NOT_LOGGED_IN tức thì).
async function findFirstOrLogin(page, selList, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.url().includes(TIKTOK.loginUrlPart)) {
      throw new Error('NOT_LOGGED_IN');
    }
    const found = await findFirst(page, selList, 150);
    if (found) return found;
  }
  return null;
}

// Bản quét-MỘT-LẦN của findFirst (không poll) — cho vòng đóng popup, gọi
// trước mỗi lần click nên phải rẻ.
async function findNow(page, sel) {
  try {
    const el = await page.$(sel);
    if (el) return el;
  } catch (_) { /* selector engine lỗi — bỏ qua */ }
  for (const f of page.frames()) {
    try {
      const el = await f.$(sel);
      if (el) return el;
    } catch (_) { /* frame đang navigate — bỏ qua */ }
  }
  return null;
}

// Quét đóng popup/modal đè trang. Mỗi vòng đóng 1 cái rồi quét lại từ đầu
// (đóng popup này có thể lộ popup khác xếp sau), tối đa 5 vòng.
//
// Pass 48d — PRE-CHECK 1 lệnh: quét đủ 6 selector × (page + frames) tốn ~12
// lệnh CDP ≈ 0.25s, mà hàm này được gọi trước caption VÀ mỗi vòng chờ nút Đăng
// (mỗi 150ms) → tự nó chiếm phần lớn "app 0.9s" và làm thưa nhịp phát hiện nút
// Đăng enable. Không có container modal nào thì thoát sau MỘT lệnh.
async function hasModalContainer(page) {
  try {
    if (await page.$('div[class*="TUXModal"]')) return true;
  } catch (_) { /* selector engine lỗi — coi như có, quét đầy đủ */ return true; }
  return false;
}

async function dismissBlockingPopups(page) {
  let dismissed = 0;
  if (!(await hasModalContainer(page))) return dismissed;
  for (let round = 0; round < 5; round++) {
    let clicked = false;
    for (const sel of TIKTOK.dismissButtons) {
      const el = await findNow(page, sel);
      if (!el) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      try {
        await el.click({ timeout: 2000 });
        dlog(`đã đóng popup chặn (sel=${sel})`);
        dismissed++;
        clicked = true;
        await sleep(400);
        break;
      } catch (_) { /* nút biến mất giữa chừng — quét vòng sau */ }
    }
    if (!clicked) break;
  }
  return dismissed;
}

// Xử lý popup TRONG pha sau-click-Đăng (xem chú thích ở postPhaseConfirmButtons):
// ưu tiên bấm nút xác nhận Đăng/Post nếu modal là hộp xác nhận; còn lại chỉ
// đóng bằng nút trung tính; modal lạ thì LOG danh sách nút (để log khách lần
// sau tự chỉ ra modal gì) chứ không bấm bừa, không Escape.
async function dismissPostPhasePopups(page) {
  let confirmClicked = false;
  for (let round = 0; round < 5; round++) {
    let clicked = false;
    for (const sel of TIKTOK.postPhaseConfirmButtons) {
      const el = await findNow(page, sel);
      if (!el) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      try {
        await el.click({ timeout: 2000 });
        dlog(`modal xác nhận sau Đăng — đã bấm nút xác nhận (sel=${sel})`);
        clicked = true;
        confirmClicked = true; // Pass 48d: mốc bắt đầu "đã gửi lệnh đăng"
        await sleep(200);
        break;
      } catch (_) { /* nút biến mất giữa chừng */ }
    }
    if (!clicked) {
      for (const sel of TIKTOK.postPhaseDismissButtons) {
        const el = await findNow(page, sel);
        if (!el) continue;
        if (!(await el.isVisible().catch(() => false))) continue;
        try {
          await el.click({ timeout: 2000 });
          dlog(`đã đóng popup trung tính sau Đăng (sel=${sel})`);
          clicked = true;
          await sleep(400);
          break;
        } catch (_) { /* nút biến mất giữa chừng */ }
      }
    }
    if (!clicked) {
      // Modal còn hiện mà không có nút an toàn nào → ghi vết rồi để yên.
      try {
        const texts = await page.$$eval(
          'div[class*="TUXModal"] button',
          (btns) => btns.filter(b => b.offsetParent !== null)
                        .map(b => (b.innerText || '').trim()).filter(Boolean)
        );
        if (texts.length > 0) {
          dlog(`modal lạ sau Đăng, KHÔNG bấm — các nút: [${texts.join(' | ')}]`);
        }
      } catch (_) {}
      break;
    }
  }
  return confirmClicked;
}

// Pass 47: ghi vết DOM khi KHÔNG tìm thấy nút Đăng — xem đang ở URL nào,
// modal nào đang chặn, các nút enable hiện có. Sau khi log, Rust có thể
// truy vết vì log chảy qua stderr → reader thread "tiktok-daemon-stderr".
// KHÔNG throw ở đây — caller quyết định timeout hay tiếp tục.
async function dumpSelectorMissDebug(page, label) {
  try {
    const url = page.url();
    dlog(`SELECTOR_MISS[${label}] url=${url}`);
    // Liệt kê các button trong TUXModal (nếu có modal chặn)
    const modalButtons = await page.$$eval(
      'div[class*="TUXModal"] button',
      (btns) => btns
        .filter(b => b.offsetParent !== null)
        .map(b => {
          const text = (b.innerText || '').trim();
          const disabled = b.disabled || b.getAttribute('aria-disabled') === 'true';
          const e2e = b.getAttribute('data-e2e') || '';
          return `${text.slice(0, 30)}${disabled ? '[X]' : ''}${e2e ? `[e2e=${e2e}]` : ''}`;
        })
    );
    if (modalButtons.length > 0) {
      dlog(`SELECTOR_MISS[${label}] modal buttons: [${modalButtons.join(' | ')}]`);
    }
    // Liệt kê TẤT CẢ button enabled trong page (để biết TikTok đã đổi label)
    const allBtns = await page.$$eval(
      'button',
      (btns) => btns
        .filter(b => b.offsetParent !== null && !b.disabled
                     && b.getAttribute('aria-disabled') !== 'true')
        .slice(0, 20)
        .map(b => (b.innerText || '').trim())
        .filter(Boolean)
    );
    if (allBtns.length > 0) {
      dlog(`SELECTOR_MISS[${label}] enabled buttons: [${allBtns.join(' | ')}]`);
    }
    // Detect spinner / overlay — page đang xử lý thì nút disabled
    const overlay = await page.$$eval(
      '[class*="loading"], [class*="Loading"], [class*="spinner"], [class*="Spinner"], [class*="progress"], [class*="Progress"]',
      (els) => els.filter(e => e.offsetParent !== null).length
    );
    if (overlay > 0) {
      dlog(`SELECTOR_MISS[${label}] đang có ${overlay} spinner/progress — có thể video chưa xử lý xong`);
    }
  } catch (e) {
    dlog(`SELECTOR_MISS[${label}] debug dump lỗi: ${e.message}`);
  }
}

async function elementEnabled(el) {
  try {
    return await el.evaluate((node) => {
      if (node.disabled) return false;
      if (node.getAttribute('aria-disabled') === 'true') return false;
      if ((node.className || '').toString().includes('disabled')) return false;
      return true;
    });
  } catch (_) {
    return false;
  }
}

// Nạp file vào <input type=file> bằng CDP DOM.setFileInputFiles — truyền
// ĐƯỜNG DẪN cho Chrome (cùng máy) thay vì bơm bytes qua protocol, nên không
// dính giới hạn 50MB của Playwright setInputFiles trên connectOverCDP
// ("Cannot transfer files larger than 50Mb...", 18/07 — video render 60-150MB).
// Tìm node bằng cây DOM.getDocument pierce:true (xuyên shadow DOM + iframe
// cùng process) → set theo backendNodeId; Chrome tự bắn event change/input.
async function setFileInputViaCdp(page, filePath) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const found = [];
    (function walk(node) {
      if (!node) return;
      if (node.nodeName === 'INPUT') {
        const attrs = node.attributes || [];
        for (let i = 0; i + 1 < attrs.length; i += 2) {
          if (attrs[i].toLowerCase() === 'type' && String(attrs[i + 1]).toLowerCase() === 'file') {
            found.push(node);
            break;
          }
        }
      }
      (node.children || []).forEach(walk);
      (node.shadowRoots || []).forEach(walk);
      if (node.contentDocument) walk(node.contentDocument);
    })(root);
    if (!found.length) throw new Error('SELECTOR_MISS: input[type=file] (CDP tree)');
    // Ưu tiên input accept video (đúng thứ tự ưu tiên như TIKTOK.fileInput)
    const target = found.find((n) => {
      const attrs = n.attributes || [];
      for (let i = 0; i + 1 < attrs.length; i += 2) {
        if (attrs[i].toLowerCase() === 'accept' && String(attrs[i + 1]).includes('video')) return true;
      }
      return false;
    }) || found[0];
    await cdp.send('DOM.setFileInputFiles', {
      files: [filePath],
      backendNodeId: target.backendNodeId,
    });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// Điều hướng tới trang upload + phát hiện chưa đăng nhập (redirect /login).
async function gotoUpload(page) {
  const cur = page.url();
  // Tab đang NẰM SẴN ở /login = chắc chắn chưa đăng nhập — trả lời ngay,
  // không goto (goto đè lên còn phá form login user đang gõ dở; 18/07 10:15
  // tab /login làm cả loạt attempt trôi qua SELECTOR_MISS 35s/lần).
  if (cur.includes(TIKTOK.loginUrlPart)) {
    throw new Error('NOT_LOGGED_IN');
  }
  const navigated = !cur.includes('/tiktokstudio/upload');
  if (navigated) {
    dlog(`goto ${TIKTOK.uploadUrl} (từ ${cur.slice(0, 80)})`);
    await page.goto(TIKTOK.uploadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  // Pass 56: KHÔNG ngủ cứng 2s sau khi điều hướng. Log khách 26/07 15:33:
  // 7/9 upload có `connect ≈ 3.0s` vì sau mỗi lần đăng thành công TikTok
  // redirect sang /content → upload KẾ TIẾP thấy trang không phải /upload nên
  // goto + ngủ 2s. Nay đợi DẤU HIỆU THẬT (input file xuất hiện) — trang sẵn
  // sàng sớm hơn 2s rất nhiều, và nếu chậm thật thì vòng chờ chính vẫn phủ.
  // Bao luôn mẹo "đã ở sẵn /upload (prewarm giữ mở) thì đừng chờ 2s cứng":
  // nhánh không-goto chỉ ngủ 250ms — redirect login client-side chỉ xảy ra SAU
  // goto, và finalUrl bên dưới vẫn check /login.
  if (navigated) {
    const ready = await findFirst(page, TIKTOK.fileInput, 8000);
    if (!ready) await sleep(400);
  } else {
    // Pass 57: trang đã sẵn ở /upload (prewarm giữ mở) → đợi DẤU HIỆU THẬT
    // thay vì ngủ mù 250ms. Trang ấm trả input file trong vài ms.
    //
    // Pass 58 — KHÔNG có input thì PHẢI nạp lại, đừng rơi xuống vòng chờ
    // chính. URL GIỐNG NHAU KHÔNG CÓ NGHĨA LÀ TRANG GIỐNG NHAU: TikTok đăng
    // bằng XHR rồi mới dựng lại form, nên ngay sau khi đăng xong URL VẪN là
    // /tiktokstudio/upload trong khi DOM là màn hình "đã đăng" hoàn toàn
    // không có input file. `navigated=false` → ta bỏ qua goto → chờ mòn mỏi
    // một phần tử sẽ không bao giờ tự xuất hiện.
    //
    // Log khách 28/07 01:32:34.339 dựng lại đúng cảnh đó: upload kế tiếp khởi
    // động 0,02s sau dòng [timing] của lượt trước, rồi SELECTOR_MISS:fileInput
    // lúc 01:33:04.690 — tròn 30,4s hết hạn findFirstOrLogin — cộng 30s
    // backoff = MẤT 66 GIÂY cho một video, gấp năm lần cả pipeline.
    //
    // Chi phí nhánh mới bằng 0 ở đường lành (findFirst trả về ngay khi thấy
    // input, thường vài ms); chỉ trang hỏng mới trả 600ms rồi nạp lại ~1,5s.
    const ready = await findFirst(page, TIKTOK.fileInput, 600);
    if (!ready) {
      dlog(`nạp lại ${TIKTOK.uploadUrl} — URL đã ở /upload nhưng KHÔNG có input file (màn hình sau khi đăng)`);
      await page.goto(TIKTOK.uploadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const back = await findFirst(page, TIKTOK.fileInput, 8000);
      if (!back) await sleep(400);
    }
  }
  const finalUrl = page.url();
  if (finalUrl.includes(TIKTOK.loginUrlPart)) {
    throw new Error('NOT_LOGGED_IN');
  }
  return finalUrl;
}

// Pass 48c — warm trang upload TRƯỚC khi có file (gọi lúc prewarm, song song
// với download+render): connect CDP + goto + đóng popup first-load. Lúc upload
// thật, trang đã sạch và ổn định → chặng "chờ editor + quét popup" (1.64s
// trong log 11:10) co lại còn thời gian TikTok nhận file.
async function doPrepare(port) {
  const t = Date.now();
  const browser = await connectCdp(port);
  try {
    // Nhả ngay ở mọi mốc nếu upload vừa tới: upload là việc nóng, prepare chỉ
    // là warm — warm dở dang vô hại (upload tự goto/đóng popup như trước).
    if (uploadPending) { dlog('prepare nhả sớm — upload vừa tới'); return {}; }
    const page = await getTikTokPage(browser, true);
    if (uploadPending) { dlog('prepare nhả sớm — upload vừa tới'); return {}; }
    await gotoUpload(page);
    if (uploadPending) { dlog('prepare nhả sớm — upload vừa tới'); return {}; }
    await dismissBlockingPopups(page);
    dlog(`prepare xong sau ${((Date.now() - t) / 1000).toFixed(1)}s (trang upload sẵn sàng)`);
    return {};
  } finally {
    await browser.close().catch(() => {});
  }
}

async function doUpload(port, filePath, caption, fastDone) {
  const t0 = Date.now();
  // Kế toán từng chặng để quy trách nhiệm APP vs TIKTOK (Pass 48c). Không có
  // bảng này thì mọi câu "vẫn chậm" chỉ còn cách đoán.
  const ph = {};
  const mark = (k, from) => { ph[k] = Date.now() - from; };
  const browser = await connectCdp(port);
  // Hoist ra ngoài try để `finally` gỡ được listener 'response' trên MỌI nhánh
  // (kể cả throw SELECTOR_MISS/UPLOAD_TIMEOUT/UPLOAD_REJECTED) — tránh rò
  // listener xác nhận đăng nếu về sau tái dùng page qua nhiều job.
  let page = null;
  let onResponse = null;
  try {
    let t = Date.now();
    page = await getTikTokPage(browser, true);
    await gotoUpload(page);
    await dismissBlockingPopups(page);
    mark('connect', t); // app: CDP + goto + popup (≈0 nếu prepare đã chạy)

    // ── Xác nhận bằng TÍN HIỆU MẠNG (Tier 1) ──────────────────────────────
    // Quan sát THỤ ĐỘNG XHR của chính TikTok. URL redirect mà bước 5 chờ (~3.6s)
    // do XHR publish trả status_code:0 kích hoạt → nghe nó = CÙNG sự thật nhưng
    // SỚM hơn, và bắt được rejection (bản quyền) tức thì thay vì đốt 60s timeout.
    // Không ký request → không lộ bot. `armed` chỉ bật SAU khi bấm Đăng để không
    // nhầm auto-save draft. Matcher trượt → bước 5 vẫn poll DOM (Promise.race).
    let armed = false;
    let publishResolve;
    const publishSignal = new Promise((res) => { publishResolve = res; });
    const CANDIDATE_RE = /(project\/|content\/|aweme\/|\/upload\/|commit|publish|post)/i;
    const PUBLISH_RE = /(project\/(post|create)|content\/(post|publish)|aweme\/post|item\/create|\/post\/publish)/i;
    onResponse = async (resp) => {
      try {
        if (resp.request().method() !== 'POST') return;
        const url = resp.url();
        if (!CANDIDATE_RE.test(url)) return;
        dlog(`[net] POST ${resp.status()} ${url.slice(0, 130)}`); // discovery: chốt matcher từ capture thật
        if (!armed || !PUBLISH_RE.test(url)) return;
        const body = await resp.json().catch(() => null);
        if (!body) return;
        const sc = body.status_code ?? body.statusCode;
        if (sc === 0) publishResolve({ ok: true, reason: 'net:status_code=0' });
        else if (typeof sc === 'number') publishResolve({ ok: false, reason: body.status_msg || body.message || ('status_code=' + sc) });
      } catch (_) { /* thụ động — bỏ qua lỗi parse */ }
    };
    page.on('response', onResponse);

    // 1. Đợi input file xuất hiện rồi nạp file qua CDP DOM.setFileInputFiles
    //    theo ĐƯỜNG DẪN (không đụng dialog hệ điều hành, không giới hạn 50MB).
    t = Date.now();
    const input = await findFirstOrLogin(page, TIKTOK.fileInput, 30000);
    if (!input) throw new Error('SELECTOR_MISS: fileInput');
    await setFileInputViaCdp(page, filePath);
    mark('fileSet', t); // app
    dlog(`đã set file ${filePath} sau ${((Date.now() - t0) / 1000).toFixed(1)}s (CDP path, sel=${input.sel})`);

    // 2. Đợi editor caption xuất hiện (nghĩa là file đã nhận, đang process)
    t = Date.now();
    const editor = await findFirstOrLogin(page, TIKTOK.captionEditor, 90000);
    if (!editor) throw new Error('SELECTOR_MISS: captionEditor');
    mark('editorWait', t); // TIKTOK: nhận file + dựng form

    // 3. Xóa caption mặc định (TikTok điền sẵn tên file) rồi gõ caption thật.
    //    Đường nhanh insertText (1 lệnh CDP/cụm) + verify + fallback key event
    //    nằm trong typeCaption — xem khối CAPTION_* ở đầu file.
    t = Date.now();
    await dismissBlockingPopups(page);
    await clearCaption(page, editor);
    const typeMs = await typeCaption(page, editor, caption);
    mark('caption', t); // app
    dlog(`đã gõ caption ${caption.length} ký tự trong ${(typeMs / 1000).toFixed(1)}s`);
    const tPostWait = Date.now();

    // 4. Đợi nút Đăng enable (= video process xong) rồi click. Trước mỗi lần
    //    thử quét đóng popup đè trang; click timeout NGẮN để bị chặn là còn
    //    vòng thử lại (trước đây 1 click 30s ăn trọn timeout rồi fail — 18/07).
    //    Pass 47: budget tính từ POST_CLICK_TIMEOUT_MS (60s) thay vì trừ dần
    //    từ tổng — pass cũ để chậm ở phase đầu (CDP/file/caption) thì phase
    //    Đăng bị ép xuống còn 30s, click fail không phải vì timeout mà vì
    //    selector/handler. 60s độc lập đủ thoải mái.
    const postDeadline = Date.now() + POST_CLICK_TIMEOUT_MS;
    let postClicked = false;
    let lastClickErr = null;
    let lastMissDump = 0; // rate-limit dump debug
    while (Date.now() < postDeadline) {
      await dismissBlockingPopups(page);
      const found = await findFirst(page, TIKTOK.postButton, 5000);
      if (!found || !(await elementEnabled(found.el))) {
        // Pass 47: dump debug mỗi 10s để truy vết mà KHÔNG spam log
        if (Date.now() - lastMissDump > 10000) {
          lastMissDump = Date.now();
          await dumpSelectorMissDebug(page, 'postButton-miss');
        }
        // Pass 48b/c: 1000→300→150ms. Nút Đăng enable ngay khi TikTok xử lý
        // xong video; nhịp quét thưa để mất trắng phần đó.
        await sleep(150);
        continue;
      }
      try {
        await found.el.click({ timeout: 5000 });
        postClicked = true;
        armed = true; // từ giờ, XHR publish trả về = xác nhận đăng THẬT
        mark('postWait', tPostWait); // TIKTOK: xử lý video xong mới enable nút
        dlog(`đã click Đăng sau ${((Date.now() - t0) / 1000).toFixed(1)}s (sel=${found.sel})`);
        break;
      } catch (e) {
        lastClickErr = e;
        dlog(`click Đăng bị chặn — đóng popup rồi thử lại (${String(e.message).split('\n')[0]})`);
        // Popup không nhận diện được nút nào → Escape là lối thoát chung
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(500);
      }
    }
    if (!postClicked) {
      // Dump debug lần cuối TRƯỚC khi throw — Rust sẽ thấy trong stderr
      await dumpSelectorMissDebug(page, 'postButton-final-fail');
      const hint = lastClickErr ? ` (${String(lastClickErr.message).split('\n')[0]})` : '';
      throw new Error(`UPLOAD_TIMEOUT: nút Đăng không enable/bị popup chặn${hint}`);
    }

    // 5. Xác nhận đăng — ĐUA hai nguồn, giữ CẢ HAI:
    //    • TIER 1 (nguồn sự thật): XHR publish của chính TikTok trả
    //      status_code:0 = server ĐÃ nhận bài. Cũng bắt rejection (bản quyền)
    //      tức thì thay vì đốt trọn 60s timeout rồi retry mù.
    //    • TIER 2 (dự phòng, chạy song song): URL đổi về /content HOẶC hint
    //      thành công trong DOM — cứu khi matcher URL của XHR trượt (TikTok đổi
    //      endpoint). TUYỆT ĐỐI không coi "đã bấm Đăng" là "đã đăng".
    //    Popup bật SAU khi click Đăng vẫn phải xử lý — nhưng bằng
    //    dismissPostPhasePopups (KHÔNG Cancel/Hủy — modal pha này có thể là
    //    hộp xác nhận đăng, Cancel là hủy đăng; bug máy khách 20/07).
    const tConfirm = Date.now();
    const finishLog = (how) => {
      mark('confirm', tConfirm); // TIKTOK: modal + finalize + redirect
      const totalMs = Date.now() - t0;
      const app = (ph.connect || 0) + (ph.fileSet || 0) + (ph.caption || 0);
      const tiktok = (ph.editorWait || 0) + (ph.postWait || 0) + (ph.confirm || 0);
      const s = (v) => ((v || 0) / 1000).toFixed(1);
      // MỘT dòng quy trách nhiệm: app chậm là bug của ta, tiktok chậm là
      // mạng/phía TikTok (đổi được bằng file nhỏ hơn, không bằng code).
      dlog(
        `[timing] total=${s(totalMs)}s | app=${s(app)}s (connect ${s(ph.connect)} + file ${s(ph.fileSet)} + caption ${s(ph.caption)})` +
        ` | tiktok=${s(tiktok)}s (nhận file ${s(ph.editorWait)} + xử lý video ${s(ph.postWait)} + đăng/redirect ${s(ph.confirm)}) [${how}]`
      );
      return {
        phases: `total=${s(totalMs)};app=${s(app)};tiktok=${s(tiktok)};connect=${s(ph.connect)};file=${s(ph.fileSet)};editor=${s(ph.editorWait)};caption=${s(ph.caption)};process=${s(ph.postWait)};confirm=${s(ph.confirm)}`,
      };
    };
    // TIER 2 chạy nền: poll DOM/URL, đồng thời gỡ popup pha sau-Đăng. Nhịp 150ms
    // (không phải 250ms) vì URL check là LOCAL (không qua CDP) — thành công được
    // ghi nhận gần như tức thì. Hint + quét popup đắt hơn nên chỉ chạy mỗi
    // ~600ms. Vòng cũ (findFirst 1000ms + sleep 1500ms) báo "done" trễ tới ~2.5s
    // sau khi TikTok đã đăng xong (log khách 25/07 10:41).
    let done = false;
    const domConfirm = (async () => {
      const deadline = Date.now() + POST_CONFIRM_TIMEOUT_MS;
      let confirmTick = 0;
      let confirmSentAt = 0;   // mốc đã bấm "Post now" (chỉ để ghi log)
      let fastDoneNoted = false;
      while (!done && Date.now() < deadline) {
        try {
          if (page.url().includes(TIKTOK.contentUrlPart)) {
            return { ok: true, reason: 'url→content', how: 'url' };
          }
          if (confirmTick % 4 === 0) {
            const hint = await findFirst(page, TIKTOK.successHint, 150);
            if (hint) return { ok: true, reason: `hint=${hint.sel}`, how: `hint=${hint.sel}` };
            if (await dismissPostPhasePopups(page)) {
              // Đã bấm xác nhận "Post now" = lệnh đăng ĐÃ GỬI — nhưng CHƯA phải
              // đã đăng. Vẫn chờ XHR (hoặc redirect/hint) nói thật.
              if (!confirmSentAt) confirmSentAt = Date.now();
            }
          }
          if (fastDone && confirmSentAt && !fastDoneNoted
              && Date.now() - confirmSentAt >= FAST_DONE_GRACE_MS) {
            fastDoneNoted = true;
            dlog(`fastDone: lệnh đăng đã gửi ${FAST_DONE_GRACE_MS}ms trước mà chưa thấy xác nhận — VẪN CHỜ (không báo xong lạc quan)`);
          }
        } catch (_) { return null; } // page đóng giữa chừng — nhường publishSignal
        confirmTick += 1;
        await sleep(150);
      }
      return null;
    })();
    const result = await Promise.race([publishSignal, domConfirm]);
    done = true; // dừng domConfirm nếu publishSignal thắng
    if (result && result.ok === true) {
      dlog(`upload OK (${result.reason}) tổng ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return finishLog(result.how || result.reason);
    }
    if (result && result.ok === false) {
      // Server TikTok TỪ CHỐI (bản quyền/nội dung) — báo lỗi RÕ, không retry mù.
      dlog(`upload BỊ TỪ CHỐI: ${result.reason} tổng ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      throw new Error(`UPLOAD_REJECTED: ${result.reason}`);
    }
    throw new Error('UPLOAD_TIMEOUT: không thấy xác nhận sau khi Đăng');
  } finally {
    // Gỡ listener xác nhận đăng trên MỌI nhánh (thành công lẫn throw) trước khi
    // ngắt kết nối — không rò onResponse, không để listener cũ (armed) bắn nhiễu.
    if (page && onResponse) {
      try { page.off('response', onResponse); } catch (_) { /* page có thể đã đóng */ }
    }
    // connectOverCDP: close() chỉ ngắt kết nối, KHÔNG kill Chrome
    // (vòng đời Chrome do Rust quản: idle 60s hoặc đổi account thì taskkill)
    await browser.close().catch(() => {});
  }
}

async function doCheckLogin(port) {
  const browser = await connectCdp(port);
  try {
    const page = await getTikTokPage(browser, true);
    try {
      await gotoUpload(page);
      return { loggedIn: true };
    } catch (e) {
      if (e.message.includes('NOT_LOGGED_IN')) return { loggedIn: false };
      throw e;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

// Prewarm TRANG: điều hướng về /upload + đợi form (fileInput) hiện, để lần
// upload sau vào THẲNG setFile (~0.3s) thay vì phải goto + chờ trang load (2s+).
// Sau upload trước TikTok redirect sang /content nên trang KHÔNG còn ở /upload
// → không prewarm thì upload sau trả giá 2s goto. Prewarm hụt = không sao
// (upload vẫn tự gotoUpload). KHÔNG đăng gì → không đụng xác nhận đăng.
// (Khác doPrepare ở chỗ CHỜ form hiện và trả `warmed` — Rust gọi lúc detect.)
async function doPrewarm(port) {
  const browser = await connectCdp(port);
  try {
    // Cùng luật nhường như doPrepare: upload là việc nóng, warm nhả ngay.
    if (uploadPending) { dlog('prewarm nhả sớm — upload vừa tới'); return { warmed: false }; }
    const page = await getTikTokPage(browser, true);
    await gotoUpload(page);
    if (uploadPending) { dlog('prewarm nhả sớm — upload vừa tới'); return { warmed: false }; }
    const input = await findFirstOrLogin(page, TIKTOK.fileInput, 15000);
    return { warmed: !!input };
  } catch (e) {
    if (e.message && e.message.includes('NOT_LOGGED_IN')) return { warmed: false, loggedIn: false };
    return { warmed: false };
  } finally {
    await browser.close().catch(() => {});
  }
}

// Pass 50 — KHÓA phiên làm việc trên trang: prepare/prewarm (warm) và upload
// dùng CHUNG một tab Chrome. Log khách 25/07 13:41 cho thấy prepare của prewarm
// còn đang chạy thì upload bắt đầu → hai bên cùng goto/đóng popup/nạp file trên
// một trang: phase `file` 0.1s → 0.9s, app 0.8s → 1.9s, tổng 7.1s.
// Quy tắc: upload luôn ĐƯỢC ƯU TIÊN — warm thấy có upload thì tự dừng sớm;
// upload chờ warm nhả (tối đa PREPARE_YIELD_MAX_MS) rồi mới chạy.
const PREPARE_YIELD_MAX_MS = 3000;
let uploadPending = false;
let preparing = false;

async function waitForPrepareToYield() {
  const deadline = Date.now() + PREPARE_YIELD_MAX_MS;
  while (preparing && Date.now() < deadline) {
    await sleep(50);
  }
  if (preparing) dlog('prepare chưa nhả sau 3s — upload chạy đè (ưu tiên upload)');
}

async function handle(req) {
  const id = req.id;
  try {
    switch (req.cmd) {
      case 'ping':
        return { id, ok: true, cmd: 'pong' };
      case 'upload': {
        if (!req.filePath) throw new Error('filePath required');
        uploadPending = true;
        try {
          await waitForPrepareToYield();
          const result = await Promise.race([
            doUpload(req.port || 9223, req.filePath, String(req.caption || ''), !!req.fastDone),
            sleep(UPLOAD_TOTAL_TIMEOUT_MS).then(() => {
              throw new Error('UPLOAD_TIMEOUT: quá 5 phút');
            }),
          ]);
          return { id, ok: true, videoUrl: result.videoUrl || null, phases: result.phases || null };
        } finally {
          uploadPending = false;
        }
      }
      // Pass 48c: warm trang upload lúc prewarm (song song download+render).
      case 'prepare': {
        if (uploadPending) {
          dlog('prepare bỏ qua — đang có upload (không giẫm chân)');
          return { id, ok: true, cmd: 'prepare', skipped: true };
        }
        preparing = true;
        try {
          await doPrepare(req.port || 9223);
        } finally {
          preparing = false;
        }
        return { id, ok: true, cmd: 'prepare' };
      }
      case 'checkLogin': {
        const r = await doCheckLogin(req.port || 9223);
        return { id, ok: true, loggedIn: r.loggedIn };
      }
      // Prewarm trang (nhánh fix): như `prepare` nhưng CHỜ form hiện + trả
      // `warmed`. Đi qua cùng khóa Pass 50 để không giẫm chân upload.
      case 'prewarm': {
        if (uploadPending) {
          dlog('prewarm bỏ qua — đang có upload (không giẫm chân)');
          return { id, ok: true, cmd: 'prewarm', warmed: false, skipped: true };
        }
        preparing = true;
        let r;
        try {
          r = await doPrewarm(req.port || 9223);
        } finally {
          preparing = false;
        }
        return { id, ok: true, warmed: r.warmed };
      }
      default:
        return { id, ok: false, error: `unknown cmd: ${req.cmd}` };
    }
  } catch (e) {
    dlog(`cmd=${req.cmd} lỗi: ${e.message}`);
    // Pass 47: flag needsRelaunch cho Rust worker biết cần kill + mở lại Chrome
    // thay vì retry trên cùng session (session có thể bị state xấu — popup
    // kẹt, trang redirect, DOM stale).
    const needsRelaunch = e.message && e.message.startsWith('UPLOAD_TIMEOUT');
    return { id, ok: false, error: e.message, needsRelaunch };
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  // Signal ready (client Rust đợi dòng {daemon:true} đầu tiên)
  process.stdout.write(JSON.stringify({ daemon: true, ready: true }) + '\n');
  dlog('daemon ready');
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, error: 'bad json' }) + '\n');
      return;
    }
    // Upload chạy tuần tự từ queue Rust nên không cần khóa concurrency ở đây
    handle(req).then((resp) => {
      process.stdout.write(JSON.stringify(resp) + '\n');
    });
  });
  rl.on('close', () => process.exit(0));
}

main();
