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
    'input[type="file"][accept*="mp4"]',
    'input[type="file"][name*="upload"]',
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
    // Tiếng Anh / English
    'button:text-is("Post")',
    'button:text-is("Post now")',
    'button:text-is("Posting")',
    // Tiếng Việt / Vietnamese
    'button:text-is("Đăng")',
    'button:text-is("Đăng ngay")',
    'button:text-is("Đang đăng")',
    // Tiếng Nhật / Japanese (日本語)
    'button:text-is("投稿")',
    'button:text-is("今すぐ投稿")',
    'button:text-is("投稿する")',
    'button:text-is("投稿中")',
    'button:has-text("投稿")',
    // Tiếng Hàn / Korean (한국어)
    'button:text-is("게시")',
    'button:text-is("지금 게시")',
    'button:text-is("게시하기")',
    'button:text-is("게시 중")',
    'button:has-text("게시")',
    // Tiếng Trung / Chinese (简体 / 繁體)
    'button:text-is("发布")',
    'button:text-is("立即发布")',
    'button:text-is("发布中")',
    'button:text-is("發佈")',
    'button:text-is("立即發佈")',
    'button:text-is("發佈中")',
    'button:has-text("发布")',
    'button:has-text("發佈")',
    // Tiếng Tây Ban Nha / Spanish
    'button:text-is("Publicar")',
    'button:text-is("Publicar ahora")',
    // Fallback data-e2e khác (TikTok variant)
    'button[data-e2e="upload_post"]',
    // Generic submit button —last resort
    'button[type="submit"]',
  ],
  // Hint thành công ngoài việc đổi URL (modal "quản lý bài đăng")
  successHint: [
    'button[data-e2e="upload_another_button"]',
    // English
    'div:has-text("Your video has been uploaded")',
    'div:has-text("Manage your posts")',
    // Vietnamese
    'div:has-text("Video của bạn đã được đăng")',
    'div:has-text("Đã tải video lên")',
    'div:has-text("Quản lý bài đăng")',
    // Japanese
    'div:has-text("動画が投稿されました")',
    'div:has-text("投稿されました")',
    'div:has-text("投稿を管理")',
    'button:has-text("別の動画をアップロード")',
    // Korean
    'div:has-text("동영상이 게시되었습니다")',
    'div:has-text("게시되었습니다")',
    'div:has-text("게시물 관리")',
    'button:has-text("다른 동영상 업로드")',
    // Chinese
    'div:has-text("视频已发布")',
    'div:has-text("已发布")',
    'div:has-text("管理你的帖子")',
    'button:has-text("上传其他视频")',
    'div:has-text("影片已發佈")',
    'div:has-text("已發佈")',
    'div:has-text("管理你的貼文")',
    'button:has-text("上傳其他影片")',
    // Spanish
    'div:has-text("Tu video se ha subido")',
    'div:has-text("Video publicado")',
  ],
  // Popup/modal đè trang upload chặn pointer (first-post experience, thông báo
  // tính năng mới…)
  dismissButtons: [
    // Cancel / Hủy / Đóng modal
    'div[class*="TUXModal"] button:has-text("Cancel")',
    'div[class*="TUXModal"] button:has-text("Hủy")',
    'div[class*="TUXModal"] button:has-text("キャンセル")',
    'div[class*="TUXModal"] button:has-text("취소")',
    'div[class*="TUXModal"] button:has-text("取消")',
    'div[class*="common-modal"] button:has-text("Cancel")',
    'div[class*="common-modal"] button:has-text("Hủy")',
    'div[class*="common-modal"] button:has-text("キャンセル")',
    'div[class*="common-modal"] button:has-text("취소")',
    'div[class*="common-modal"] button:has-text("取消")',
    'button:has-text("Cancel")',
    'button:has-text("Hủy")',
    'button:has-text("キャンセル")',
    'button:has-text("취소")',
    'button:has-text("取消")',
    // Close icons
    '.common-modal-close',
    '.common-modal-close-icon',
    'div[class*="modal-close"]',
    'div[class*="TUXModal"] [aria-label="Close"]',
    'div[class*="TUXModal"] button[class*="close"]',
    '[data-tt="components_Modal_Close"]',
    // Discard draft
    'button:has-text("Bỏ bản nháp")',
    'button:has-text("Discard")',
    'button:has-text("Discard video")',
    'button:has-text("破棄")',
    'button:has-text("下書きを破棄")',
    'button:has-text("삭제")',
    'button:has-text("임시 저장 삭제")',
    'button:has-text("放弃")',
    'button:has-text("舍弃")',
    'button:has-text("放棄")',
    // Got it / OK / Skip
    'button:has-text("Got it")',
    'button:has-text("Đã hiểu")',
    'button:has-text("了解")',
    'button:has-text("확인")',
    'button:has-text("知道了")',
    'button:text-is("OK")',
    'button:has-text("OK")',
    'button:has-text("Skip")',
    'button:has-text("Bỏ qua")',
    'button:has-text("スキップ")',
    'button:has-text("건너뛰기")',
    'button:has-text("跳过")',
  ],
  // SAU khi đã click Đăng: modal hiện ra có thể là hộp XÁC NHẬN ĐĂNG
  postPhaseConfirmButtons: [
    // English
    'div[class*="TUXModal"] button:text-is("Post")',
    'div[class*="TUXModal"] button:text-is("Post now")',
    'div[class*="TUXModal"] button:has-text("Post anyway")',
    'div[class*="TUXModal"] button:has-text("Continue to post")',
    'button:text-is("Post now")',
    'button:has-text("Post now")',
    'button:has-text("Post anyway")',
    'button:has-text("Continue to post")',
    // Vietnamese
    'div[class*="TUXModal"] button:text-is("Đăng")',
    'div[class*="TUXModal"] button:text-is("Đăng ngay")',
    'div[class*="TUXModal"] button:has-text("Tiếp tục đăng")',
    'div[class*="TUXModal"] button:has-text("Vẫn đăng")',
    'button:text-is("Đăng ngay")',
    'button:has-text("Đăng ngay")',
    'button:has-text("Tiếp tục đăng")',
    'button:has-text("Vẫn đăng")',
    // Japanese (日本語)
    'div[class*="TUXModal"] button:text-is("投稿")',
    'div[class*="TUXModal"] button:text-is("今すぐ投稿")',
    'div[class*="TUXModal"] button:has-text("投稿")',
    'button:text-is("今すぐ投稿")',
    'button:has-text("今すぐ投稿")',
    'button:text-is("投稿する")',
    'button:has-text("投稿する")',
    'button:has-text("それでも投稿する")',
    'button:has-text("投稿を続ける")',
    // Korean (한국어)
    'div[class*="TUXModal"] button:text-is("게시")',
    'div[class*="TUXModal"] button:text-is("지금 게시")',
    'div[class*="TUXModal"] button:has-text("게시")',
    'button:text-is("지금 게시")',
    'button:has-text("지금 게시")',
    'button:text-is("게시하기")',
    'button:has-text("게시하기")',
    'button:has-text("그래도 게시")',
    'button:has-text("계속 게시")',
    // Chinese (简体 / 繁體)
    'div[class*="TUXModal"] button:text-is("发布")',
    'div[class*="TUXModal"] button:text-is("立即发布")',
    'button:text-is("立即发布")',
    'button:has-text("立即发布")',
    'button:has-text("仍要发布")',
    'button:has-text("继续发布")',
    'div[class*="TUXModal"] button:text-is("發佈")',
    'div[class*="TUXModal"] button:text-is("立即發佈")',
    'button:text-is("立即發佈")',
    'button:has-text("立即發佈")',
    'button:has-text("仍要發佈")',
    'button:has-text("繼續發佈")',
  ],
  postPhaseDismissButtons: [
    'button:has-text("Got it")',
    'button:has-text("Đã hiểu")',
    'button:has-text("了解")',
    'button:has-text("확인")',
    'button:has-text("知道了")',
    'button:text-is("OK")',
    'div[class*="TUXModal"] [aria-label="Close"]',
    'div[class*="TUXModal"] button[class*="close"]',
    '.common-modal-close',
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
// Pass 95c: bỏ hẳn chunk 24 ký tự — dán NGUYÊN chuỗi 1 lệnh (xem typeCaption).
const CAPTION_FAST_INSERT = true;

// Pass 48d — fastDone: sau khi bấm "Post now" (lệnh đăng ĐÃ gửi), chỉ chờ thêm
// grace này để kịp bắt hộp lỗi rồi báo xong, thay vì chờ TikTok redirect
// /content (~2.1s ở máy khách). Bật bằng setting `tiktokFastDone: true`.
// ĐÁNH ĐỔI: nếu TikTok fail SAU thời điểm này thì app đã báo "đã đăng" —
// mặc định TẮT, chỉ bật khi khách ưu tiên con số e2e hơn độ chắc chắn.
// Pass 134 / Pass 135: Giảm grace xuống 100ms để ép thời gian chặng đăng/redirect xuống ~0.1s.
const FAST_DONE_GRACE_MS = 100;

const readline = require('readline');
const http = require('http');
const path = require('path');
const fs = require('fs');
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

// Pass 94: đọc text hiện có trong editor (đã normalize), '' nếu không đọc được.
async function readCaptionNormalized(editor) {
  try {
    return normalizeCaptionText(await editor.el.innerText());
  } catch (_) {
    return '';
  }
}

// Pass 94: verify CÓ RETRY — Draft.js commit text KHÔNG đồng bộ với lệnh CDP
// insertText, nên đọc innerText ngay sau cụm cuối hay trượt "false negative"
// → bản cũ xoá sạch gõ lại từng phím (log khách 12–15/08: 13 lần "insertText
// không vào đủ chữ", caption 2–5 s thay vì 0,3–0,6 s — 12/48 ca upload >5 s).
// Đợi 120 ms × 3 nhịp cho Draft.js flush rồi mới kết luận.
async function captionMatchesRetry(editor, caption, tries) {
  for (let i = 0; i < (tries || 3); i++) {
    if (await captionMatches(editor, caption)) return true;
    await sleep(120);
  }
  return captionMatches(editor, caption);
}

// Pass 106 — LẤY LẠI CON TRỎ VÀO Ô CAPTION, có kiểm chứng.
//
// Vì sao cần: `findFirst` trả về ElementHandle (`page.$`), KHÔNG phải Locator.
// TikTok dựng lại vùng form sau khi nhận file (hiện preview video) nên handle
// lấy trước đó trỏ vào node ĐÃ RỜI DOM: click không focus, `insertText` rơi
// ra ngoài, và `innerText` đọc node chết nên báo rỗng. Đó chính là log khách
// 24/08 `want=75 got=0` → app tưởng chèn hỏng, xoá đi gõ tay 96 ký tự mất
// 3,6s (upload 6,1s cho video 60s).
//
// Trả `{ el, sel }` MỚI khi phải phân giải lại, hoặc editor cũ nếu vẫn sống.
async function refocusCaptionEditor(page, editor) {
  // Pass 126 — LẤY CON TRỎ BẰNG focus() JS, không click. Lý do đo được
  // (5070 27/08 18:36: hai lượt liền nhau caption 0,2s vs 2,1s — chênh lệch
  // DUY NHẤT của upload 3,7s vs 5,6s): click của Playwright bắt buộc đợi
  // element "stable + không bị che", mà lúc TikTok đang dựng preview thì ô
  // caption không stable ~1-2s → mọi timeout click (P125 700ms, trước đó 3s)
  // đều là thuế chờ. `el.focus()` qua evaluate thì ăn NGAY kể cả khi node
  // đang bị che/chưa ổn định, và evaluate trên handle CHẾT ném lỗi trong
  // vài ms — hai ca hỏng đều rẽ nhanh sang phân giải lại. Verify
  // activeElement giữ nguyên; click thật chỉ còn là fallback cuối (vòng ≥2)
  // cho ca focus() bị TikTok chặn bằng handler riêng.
  for (let i = 0; i < 4; i++) {
    try {
      const focused = await editor.el.evaluate((el) => {
        el.focus();
        const a = document.activeElement;
        return !!a && (a === el || el.contains(a) || (a.contains && a.contains(el)));
      });
      if (focused) return editor;
    } catch (_) { /* handle chết — phân giải lại bên dưới */ }
    if (i >= 2) {
      // focus() JS hai vòng không ăn — thử cú click thật (chấp nhận chờ
      // actionability, đây đã là đường cùng trước khi bỏ cuộc).
      try {
        await editor.el.click({ timeout: 1500 });
        const focused = await editor.el.evaluate((el) => {
          const a = document.activeElement;
          return !!a && (a === el || el.contains(a) || (a.contains && a.contains(el)));
        });
        if (focused) return editor;
      } catch (_) { /* vẫn hỏng — phân giải lại */ }
    }
    const fresh = await findFirst(page, TIKTOK.captionEditor, 800);
    if (fresh) editor = fresh;
    await sleep(60);
  }
  return editor;
}

async function clearCaption(page, editor) {
  // Pass 123: cú click này từng KHÔNG có timeout — cú click DUY NHẤT như vậy
  // trên cả đường upload. Panel "Music copyright check" đè lên ô caption là
  // Playwright thử lại suốt 30.000ms rồi ném lỗi, ăn trọn attempt (log 5070
  // 26/08: 2 attempt × 30s, video chưa bao giờ lên). Đi qua
  // refocusCaptionEditor: click timeout 3s × 3 lượt, tự phân giải lại selector
  // khi node chết/bị che; hỏng cả 3 lượt vẫn đi tiếp — typeCaption tự verify
  // (want/got) và có đường gõ tay dự phòng, thua ~10s thay vì 30s × 4 attempt.
  editor = await refocusCaptionEditor(page, editor);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  // Không sleep: Ctrl+A/Delete là lệnh CDP đồng bộ, và verify sau khi chèn
  // (captionMatches) đã là lưới an toàn nếu editor chưa kịp xử lý.
  return editor; // có thể là handle MỚI sau khi phân giải lại — caller phải nhận
}

// Gõ caption theo cụm (xem khối CAPTION_* ở trên). Trả về số ms đã dùng để
// log — câu hỏi "sao upload lâu" từ nay trả lời được bằng một dòng log.
async function typeCaption(page, editor, caption) {
  const t = Date.now();
  // Đường NHANH (Pass 95c): DÁN MỘT NHÁT — insertText CẢ chuỗi trong 1 lệnh
  // CDP. Chunk 24 ký tự + jitter cũ là thận trọng thừa từ thời sợ "paste-bot":
  // người thật cũng Ctrl+V nguyên caption (không ai gõ tay 100 ký tự tiếng
  // Nhật), Draft.js nhận một input event như dán thường. Verify-retry + fallback
  // key-event bên dưới vẫn là lưới an toàn. Tiết kiệm ~0,2-0,3s/lượt.
  if (CAPTION_FAST_INSERT) {
    // Pass 106: hai lượt DÁN. Lượt 1 hỏng theo kiểu "không vào chữ nào"
    // (got=0 — handle chết / mất con trỏ) thì phân giải lại ô + đặt con trỏ
    // rồi dán lần nữa: ~0,3s, thay vì rơi thẳng xuống gõ tay 3,6s.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // Pass 115: LƯỢT ĐẦU dán THẲNG — `clearCaption` ngay trên đã click vào
        // ô rồi. Bản Pass 106 gọi refocus vô điều kiện ở đây và cú click THỪA
        // đó phải chờ Playwright xác nhận phần tử "đứng yên"; lúc TikTok đang
        // dựng preview video thì chờ tới ~1,3s (log khách 24/08 19:08: caption
        // 3,3s dù dán ĂN ngay, không có dòng lỗi nào). Chỉ lấy lại con trỏ ở
        // LƯỢT HAI — tức đúng lúc lượt đầu rơi vào ca "không vào chữ nào".
        if (attempt > 1) {
          editor = await refocusCaptionEditor(page, editor);
        }
        await page.keyboard.insertText(caption);
        // Pass 94: verify có retry (Draft.js flush trễ) thay vì đọc một phát.
        if (await captionMatchesRetry(editor, caption, 3)) {
          if (attempt > 1) dlog(`dán lại lượt ${attempt} ĂN — khỏi gõ tay`);
          return Date.now() - t;
        }
        // Vẫn lệch THẬT: in chẩn đoán got-vs-want (normalize) để lần sau đọc
        // log là biết Draft.js biến đổi gì, khỏi đoán.
        const want = normalizeCaptionText(caption);
        const got = await readCaptionNormalized(editor);
        let di = 0;
        while (di < Math.min(want.length, got.length) && want[di] === got[di]) di++;
        dlog(`insertText không vào đủ chữ (want=${want.length} got=${got.length} khác từ vị trí ${di}: want[..]="${want.slice(di, di + 12)}" got[..]="${got.slice(di, di + 12)}")`);
        // KHÔNG VÀO CHỮ NÀO: không phải Draft.js nuốt chữ mà là lệnh rơi ra
        // ngoài ô — dán lại sau khi lấy lại con trỏ (vòng lặp lo), đừng xoá
        // (ô đang rỗng, xoá là vô nghĩa).
        if (got.length === 0 && attempt < 2) {
          dlog('không vào chữ nào — lấy lại ô caption rồi dán lại');
          continue;
        }
        // Thiếu ĐUÔI (got là prefix thật của want): chèn bù phần còn lại —
        // 1 lệnh CDP thay vì xoá sạch gõ lại từng phím 2–5 s.
        if (got.length > 0 && got.length < want.length && want.startsWith(got)) {
          // Chèn theo caption GỐC: normalize chỉ bỏ whitespace nên map ngược
          // vị trí bằng cách đếm ký tự không-trắng.
          let raw = 0, nonWs = 0;
          while (raw < caption.length && nonWs < got.length) {
            if (!/\s/.test(caption[raw])) nonWs++;
            raw++;
          }
          // Pass 123: click có timeout — panel đè (copyright check) thì bỏ
          // qua sau 2s thay vì treo 30s; insertText dưới vẫn được verify.
          await editor.el.click({ timeout: 2000 }).catch(() => {});
          await page.keyboard.press('Control+End').catch(() => {});
          await page.keyboard.insertText(caption.slice(raw));
          if (await captionMatchesRetry(editor, caption, 3)) {
            dlog(`đã chèn bù ${caption.length - raw} ký tự đuôi — khỏi gõ lại`);
            return Date.now() - t;
          }
        }
        dlog('chèn bù không ăn — xoá, gõ lại bằng key event');
        editor = (await clearCaption(page, editor)) || editor;
        break;
      } catch (e) {
        dlog(`insertText lỗi (${String(e.message).split('\n')[0]}) — fallback key event`);
        editor = (await clearCaption(page, editor).catch(() => null)) || editor;
        break;
      }
    }
  }
  // Đường CŨ (fallback): key event thật từng ký tự, theo cụm.
  // Pass 106: lấy lại con trỏ TRƯỚC khi gõ — nếu ô caption đã bị dựng lại thì
  // gõ tay cũng rơi ra ngoài y như dán, và đường này không verify nên sẽ đăng
  // caption RỖNG mà không ai biết.
  editor = await refocusCaptionEditor(page, editor);
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

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || 'http://127.0.0.1:50325';

function fetchAdsPower(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `${ADSPOWER_API_URL}${endpoint}`;
    const req = http.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`AdsPower response invalid JSON: ${data.slice(0, 100)}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`AdsPower request timeout: ${endpoint}`));
    });
    req.on('error', reject);
  });
}

function getAdsPowerProfileIdentifier(port) {
  let targetAcc = null;
  const portStr = String(port || '').trim();
  const accountIndex = (typeof port === 'number' && port >= 9223) ? (port - 9223) : -1;

  try {
    const candidatePaths = [
      process.env.HYPERCLIP_DATA_DIR ? path.join(process.env.HYPERCLIP_DATA_DIR, '.hyperclip', 'tiktok.json') : null,
      path.resolve(__dirname, '../../../HyperClip-Data/.hyperclip/tiktok.json'),
      path.resolve(__dirname, '../../HyperClip-Data/.hyperclip/tiktok.json'),
      path.resolve(__dirname, '../data/.hyperclip/tiktok.json'),
      path.resolve(__dirname, '../../data/.hyperclip/tiktok.json'),
      path.resolve(__dirname, '../../../data/.hyperclip/tiktok.json'),
      path.resolve(__dirname, '../../../HyperClipB-Data/.hyperclip/tiktok.json'),
      path.resolve(__dirname, '../../HyperClipB-Data/.hyperclip/tiktok.json'),
      'C:/HyperClipB-Package/HyperClipB-Data/.hyperclip/tiktok.json'
    ].filter(Boolean);

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (data && Array.isArray(data.accounts)) {
          targetAcc = data.accounts.find(a => 
            a.id === portStr || 
            a.profileId === portStr || 
            String(a.adsPowerSerial) === portStr ||
            `adspower_${a.profileId}` === portStr
          );
          if (!targetAcc && accountIndex >= 0 && data.accounts[accountIndex]) {
            targetAcc = data.accounts[accountIndex];
          }
          if (targetAcc) {
            if (targetAcc.profileId) return { type: 'user_id', value: targetAcc.profileId };
            if (targetAcc.adsPowerSerial) return { type: 'serial_number', value: targetAcc.adsPowerSerial };
          }
        }
      }
    }
  } catch (err) {
    dlog(`[AdsPower] Không đọc được profileId từ tiktok.json: ${err.message}`);
  }

  if (accountIndex >= 0) {
    return { type: 'serial_number', value: accountIndex + 1 };
  }
  if (portStr && portStr.startsWith('k')) {
    return { type: 'user_id', value: portStr };
  }
  return { type: 'serial_number', value: 1 };
}

async function getAdsPowerEndpoint(target) {
  const queryParam = (target.type === 'user_id')
    ? `user_id=${encodeURIComponent(target.value)}`
    : `serial_number=${encodeURIComponent(target.value)}`;

  dlog(`[AdsPower] Khởi động / Kết nối Profile (${queryParam})...`);
  const launchArgs = encodeURIComponent(JSON.stringify(['https://www.tiktok.com/tiktokstudio/upload']));
  // Gọi /api/v1/browser/start với open_tabs=1 và launch_args vào thẳng Upload
  const res = await fetchAdsPower(`/api/v1/browser/start?${queryParam}&open_tabs=1&launch_args=${launchArgs}`);
  if (!res || res.code !== 0) {
    throw new Error(`ADSPOWER_API_ERROR (${queryParam}): ${res ? res.msg : 'No response'}`);
  }
  const wsEndpoint = res.data?.ws?.puppeteer;
  const debugPort = res.data?.debug_port;
  if (!wsEndpoint && !debugPort) {
    throw new Error(`ADSPOWER_NO_PORT: Không nhận được debug port từ AdsPower (${queryParam})`);
  }
  dlog(`[AdsPower] Profile (${queryParam}) sẵn sàng: debug_port=${debugPort}`);
  return wsEndpoint || `http://127.0.0.1:${debugPort}`;
}

// Connect CDP: Kết nối độc quyền AdsPower Profile theo profileId hoặc Serial
async function connectCdp(port) {
  const target = getAdsPowerProfileIdentifier(port);
  const targetLabel = `${target.type}=${target.value}`;
  
  // Kết nối qua AdsPower (Đã gỡ bỏ vĩnh viễn cơ chế mở Google Chrome thường)
  try {
    const adsTarget = await getAdsPowerEndpoint(target);
    dlog(`[AdsPower] Nối CDP vào AdsPower Profile (${targetLabel}) qua ${adsTarget}...`);
    const browser = await chromium.connectOverCDP(adsTarget, { timeout: 15000 });
    dlog(`[AdsPower] Đã kết nối thành công tới AdsPower Profile (${targetLabel})!`);
    return browser;
  } catch (adsErr) {
    dlog(`[AdsPower] Không thể kết nối AdsPower Profile (${targetLabel}): ${adsErr.message}`);
    throw new Error(`ADSPOWER_CONNECT_FAILED (${targetLabel}): ${adsErr.message}. Vui lòng mở phần mềm AdsPower!`);
  }
}

// Tab TikTok đã mở sẵn từ AdsPower hoặc Chrome; ưu tiên reuse ngay lập tức để đạt <3s.
async function getTikTokPage(browser, wantUploadPage) {
  const contexts = browser.contexts();
  let anyTikTok = null;
  let reusableStartPage = null;

  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      const u = p.url();
      if (wantUploadPage && u.includes('/tiktokstudio/upload')) {
        dlog(`[AdsPower] Tái sử dụng tab TikTok Studio /upload có sẵn (0ms navigation)`);
        return p;
      }
      if (u.includes('tiktok.com') && !anyTikTok) anyTikTok = p;
      if (!reusableStartPage && (u.includes('start.adspower.net') || u === 'about:blank' || u === 'chrome://newtab/')) {
        reusableStartPage = p;
      }
    }
  }
  if (anyTikTok) return anyTikTok;
  if (reusableStartPage) {
    dlog(`[AdsPower] Tái sử dụng tab khởi động AdsPower (${reusableStartPage.url().slice(0, 50)}) để nạp trang TikTok`);
    return reusableStartPage;
  }
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

// Pass 131: CHỈ quét trong iframe, bỏ document chính.
//
// Vòng chờ nút Đăng dùng `findFirst` làm "lưới frame" cho ca nút nằm trong
// iframe (predicate `POST_BTN_READY` chạy bằng waitForFunction nên không thấy
// iframe). Nhưng `findFirst` soi `page.$()` TRƯỚC, nên nó gần như luôn bắt lại
// ĐÚNG node ở document chính mà predicate vừa từ chối vài ms trước — hai bộ
// luật cùng phán về một node, bộ lỏng hơn thắng, và đó là đường dẫn tới cú
// click hỏng 5 s trên máy khách 5070. Tách hàm để "lưới frame" đúng nghĩa là
// lưới frame.
async function findFirstInFrames(page, selList, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selList) {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        try {
          const el = await f.$(sel);
          if (el) return { el, sel, frame: f };
        } catch (_) { /* frame đang navigate — bỏ qua */ }
      }
    }
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
    if (await page.$('div[class*="common-modal"]')) return true;
    if (await page.$('#react-joyride-portal, .react-joyride__overlay')) return true;
  } catch (_) { /* selector engine lỗi — coi như có, quét đầy đủ */ return true; }
  return false;
}

async function dismissBlockingPopups(page) {
  let dismissed = 0;
  // Xóa sạch lớp phủ tutorial joyride nếu có
  try {
    await page.evaluate(() => {
      const portal = document.getElementById('react-joyride-portal');
      if (portal) portal.remove();
      const overlays = document.querySelectorAll('.react-joyride__overlay');
      overlays.forEach(el => el.remove());
    });
  } catch (_) {}

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

async function elementEnabled(el, strict = true) {
  try {
    return await el.evaluate((node, strict) => {
      // Pass 131: PHẢI kiểm HIỂN THỊ, không chỉ thuộc tính disabled.
      // elementEnabled là cổng DUY NHẤT cho phép vòng chờ nút Đăng rẽ xuống
      // nhánh click, nhưng nó lại là bộ lọc DUY NHẤT trong file thiếu phép
      // kiểm này (POST_BTN_READY và 4 bộ lọc khác đều có offsetParent). Hậu
      // quả đo được trên máy khách 5070 (29/08): 11:00:22.368 bản dump liệt kê
      // các nút "vừa hiện vừa enable" KHÔNG có nút Đăng, 3 ms sau code vẫn lao
      // vào click và ăn trọn 5,008 s timeout trên một node đang ẩn — 5,5 s đó
      // bị dòng [timing] dán nhãn thành "TikTok xử lý video".
      // getClientRects() phủ nốt ca position:fixed (offsetParent = null dù
      // đang hiện).
      if (node.offsetParent === null && node.getClientRects().length === 0) return false;
      if (node.disabled) return false;
      if (node.getAttribute('aria-disabled') === 'true') return false;
      if ((node.className || '').toString().includes('disabled')) return false;
      // Pass 132: cùng phép kiểm "nhận được chuột" với POST_BTN_READY — hai
      // cổng phải nói CÙNG MỘT LUẬT, nếu không lại tái diễn cảnh bộ lỏng hơn
      // thả node cho Playwright click rồi hết hạn (bài học Pass 131).
      if (strict) {
        const r = node.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) {
          const top = document.elementFromPoint(cx, cy);
          if (!top || !(top === node || node.contains(top) || top.contains(node))) return false;
        }
      }
      return true;
    }, strict);
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
  if (navigated) {
    const ready = await findFirst(page, TIKTOK.fileInput, 8000);
    if (!ready) await sleep(200);
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
  // Pass 129 — TELEMETRY TUYẾN UPLOAD. Hai phiên liền (28/08 11:28 + 11:48)
  // cho "xử lý video" XEN KẼ chậm-nhanh (5,1/1,3/3,4/2,1 rồi 5,0/1,7/5,1/2,1)
  // trên cùng cỡ file 65-71MB — không giống nhiễu server ngẫu nhiên, giống
  // HAI tuyến/POP luân phiên (đúng hoa văn googlevideo 2 host, Pass 101).
  // Log hiện MÙ về chuyện trang đẩy byte đi ĐÂU. Ghi host + IP đích + MB +
  // thời-gian-đẩy của mọi request thân lớn để lần sau PHÂN XỬ bằng log:
  // nếu IP↔chậm khớp nhau thì bệnh là tuyến, không phải "server chập chờn".
  let pageForRoutes = null;
  const uploadRoutes = [];
  // Pass 131: ngưỡng 512KB làm telemetry CÂM HOÀN TOÀN. Log máy khách 5070
  // (29/08) in "không bắt được request thân lớn nào" ở CẢ HAI lượt dù file
  // 30MB đã lên tới TikTok — nghĩa là byte không đi qua một request POST/PUT
  // thân lớn duy nhất: TikTok Studio băm thành nhiều chunk nhỏ (và
  // `req.sizes()` của Playwright trả 0 cho phần thân gửi kiểu stream). Bỏ
  // ngưỡng, GỘP THEO HOST thay vì in từng request — vẫn một dòng ngắn, nhưng
  // lần này có số để phân xử "tuyến chậm hay server họ chậm".
  const routeAgg = new Map(); // host → {ip, n, bytes, ms}
  const onReqFinished = async (req) => {
    try {
      const m = req.method();
      if (m !== 'POST' && m !== 'PUT') return;
      let host = '?';
      try { host = new URL(req.url()).host; } catch (_) {}
      // Chỉ tuyến đẩy dữ liệu của TikTok/ByteDance — bỏ analytics, log, ads.
      if (!/tiktok|byteoss|bytedance|tiktokcdn|upload/i.test(host)) return;
      const sz = await req.sizes().catch(() => null);
      const body = sz && sz.requestBodySize > 0 ? sz.requestBodySize : 0;
      const resp = await req.response();
      const addr = resp ? await resp.serverAddr().catch(() => null) : null;
      const tm = req.timing();
      // responseStart = từ lúc bắt đầu request tới byte đầu server trả —
      // với body lớn ≈ thời gian ĐẨY + server nhận xong. Số đo, không suy.
      const ms = tm && tm.responseStart > 0 ? Math.round(tm.responseStart) : 0;
      const cur = routeAgg.get(host) || { ip: null, n: 0, bytes: 0, ms: 0 };
      cur.n += 1;
      cur.bytes += body;
      cur.ms += ms;
      if (!cur.ip && addr && addr.ipAddress) cur.ip = addr.ipAddress;
      routeAgg.set(host, cur);
    } catch (_) { /* telemetry tuyệt đối không được làm hỏng upload */ }
  };
  // Dựng các dòng tuyến lúc kết thúc: host[ip] Nreq TổngMB/TổngMs.
  const buildRoutes = () => {
    for (const [host, v] of routeAgg) {
      uploadRoutes.push(
        `${host}${v.ip ? `[${v.ip}]` : ''} ${v.n}req ${(v.bytes / 1048576).toFixed(1)}MB/${v.ms}ms`
      );
    }
  };
  try {
    let t = Date.now();
    const page = await getTikTokPage(browser, true);
    pageForRoutes = page;
    page.on('requestfinished', onReqFinished);
    await gotoUpload(page);
    await dismissBlockingPopups(page);
    mark('connect', t); // app: CDP + goto + popup (≈0 nếu prepare đã chạy)

    // 1. Đợi input file xuất hiện rồi nạp file qua CDP DOM.setFileInputFiles
    //    theo ĐƯỜNG DẪN (không đụng dialog hệ điều hành, không giới hạn 50MB).
    //    Pass 157: retry-with-reload khi fileInput miss — log 4 lần SELECTOR_MISS
    //    liên tiếp trên 1 account (25-27/09), tất cả cùng account tt1788318672954.
    //    Nguyên nhân: trang TikTok load bị kẹt (spinner/JS chưa chạy xong) nhưng
    //    KHÔNG redirect /login nên findFirstOrLogin cứ quét 30s rồi trả null.
    //    Reload trang rồi thử lại 1 lần trước khi bỏ cuộc.
    t = Date.now();
    let input = await findFirstOrLogin(page, TIKTOK.fileInput, 30000);
    if (!input) {
      dlog('fileInput MISS lần 1 — reload trang rồi thử lại');
      await dumpSelectorMissDebug(page, 'fileInput-pre-reload');
      try {
        await page.goto(TIKTOK.uploadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await dismissBlockingPopups(page);
      } catch (navErr) {
        dlog(`reload lỗi: ${navErr.message}`);
      }
      input = await findFirstOrLogin(page, TIKTOK.fileInput, 30000);
    }
    if (!input) {
      await dumpSelectorMissDebug(page, 'fileInput');
      throw new Error('SELECTOR_MISS: fileInput');
    }
    await setFileInputViaCdp(page, filePath);
    mark('fileSet', t); // app
    dlog(`đã set file ${filePath} sau ${((Date.now() - t0) / 1000).toFixed(1)}s (CDP path, sel=${input.sel})`);

    // 2. Đợi editor caption xuất hiện (nghĩa là file đã nhận, đang process)
    t = Date.now();
    let editor = await findFirstOrLogin(page, TIKTOK.captionEditor, 90000);
    if (!editor) {
      await dumpSelectorMissDebug(page, 'captionEditor');
      throw new Error('SELECTOR_MISS: captionEditor');
    }
    mark('editorWait', t); // TIKTOK: nhận file + dựng form

    // 3. Xóa caption mặc định (TikTok điền sẵn tên file) rồi gõ caption thật
    t = Date.now();
    await dismissBlockingPopups(page);
    // Pass 123: nhận editor MỚI từ clearCaption — refocus có thể đã phân giải
    // lại node (dùng handle cũ là gõ vào node chết, đúng bug want=0 Pass 106).
    editor = await clearCaption(page, editor) || editor;
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
    let postClickedAtMs = 0; // Pass 95: mốc click Đăng — fastDone tính grace từ đây
    let lastClickErr = null;
    let lastMissDump = 0; // rate-limit dump debug
    // Pass 131: đồng hồ riêng cho phần THỬ-CLICK-LẠI. Trước đây mọi thứ từ
    // lúc gõ xong caption tới lúc click được đều đổ vào một số `postWait` in
    // ra dưới nhãn "xử lý video", nên thuế của chính app (click hỏng, sleep)
    // hiện lên như thời gian của TikTok — đúng thứ khiến 7,2 s của máy khách
    // 5070 bị đọc nhầm là transcode chậm. Tách ra thì log tự phân xử được.
    let postRetryMs = 0;
    // Pass 123: chờ nút Đăng enable bằng waitForFunction — poll 50ms NGAY
    // TRONG trình duyệt, một phiên CDP duy nhất — thay cho vòng cũ
    // dismissBlockingPopups + findFirst(page+frames) mỗi 150ms (~12 lệnh
    // CDP/vòng). Pass 48d từng đo chính vòng quét đó cộng ~0,2-0,5s độ trễ
    // PHÁT HIỆN của ta vào pha "xử lý video". Popup giờ quét ~1 lần/giây khi
    // còn chờ; nhánh findFirst 300ms giữ lại để phủ ca nút nằm trong frame
    // (predicate trong page chỉ thấy document chính).
    // Selector :text-is() là của Playwright, không chạy trong page → predicate
    // tự quét button theo data-e2e + text CHÍNH XÁC (không substring — nhầm
    // "Đăng xuất"/"Đăng nhập" là bug đã né từ đầu).
    // Pass 132 — LƯỚI AN TOÀN cho phép kiểm "nhận được chuột" bên dưới.
    // Nếu TikTok có lớp phủ trong suốt thường trực thì luật chặt sẽ KHÔNG BAO
    // GIỜ ready và lượt upload treo tới hết ngân sách 60s — tệ hơn hẳn bản cũ.
    // Nên luật chặt chỉ áp trong 8s đầu (đủ phủ pha "TikTok đang xử lý"); sau
    // đó rơi về đúng luật cũ: cứ thử click, chấp nhận có thể hết hạn. Tệ nhất
    // = hành vi trước khi vá, không bao giờ tệ hơn.
    const STRICT_CLICKABLE_UNTIL = Date.now() + 8000;
    const POST_BTN_READY = (strict) => {
      // Pass 132: nút phải NHẬN ĐƯỢC CHUỘT, không chỉ "hiện + enable".
      // Log máy khách 5070 (30/08 sau Pass 131): nút hiện+enable nhưng lớp phủ
      // lúc TikTok còn xử lý (log đếm 12 spinner/progress) chặn con trỏ, nên
      // Playwright click hết hạn 3 LẦN liên tiếp = 3,6s thuế. Phép kiểm này
      // chạy TRONG trang mỗi 50ms (gần như miễn phí) và phát hiện đúng thứ
      // Playwright phải mất 1,2s mới biết ⇒ tới lúc ta click là click ăn ngay.
      const clickable = (b) => {
        if (!strict) return true;
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        // Ngoài viewport thì KHÔNG phán — Playwright tự cuộn vào rồi mới click.
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return true;
        const top = document.elementFromPoint(cx, cy);
        return !!top && (top === b || b.contains(top) || top.contains(b));
      };
      const on = (b) => !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true'
        && !(b.className || '').toString().includes('disabled')
        && b.offsetParent !== null
        && clickable(b);
      if (on(document.querySelector(
        'button[data-e2e="post_video_button"], [data-e2e="post_video_button"], button[data-e2e="upload_post"]'
      ))) return true;
      const texts = [
        // English
        'Post', 'Post now', 'Posting',
        // Vietnamese
        'Đăng', 'Đăng ngay', 'Đang đăng',
        // Japanese
        '投稿', '今すぐ投稿', '投稿する', '投稿中',
        // Korean
        '게시', '지금 게시', '게시하기', '게시 중',
        // Chinese
        '发布', '立即发布', '发布中', '發佈', '立即發佈', '發佈中',
        // Spanish
        'Publicar', 'Publicar ahora'
      ];
      for (const b of document.querySelectorAll('button')) {
        const txt = (b.textContent || '').trim();
        if (texts.includes(txt) && on(b)) return true;
        // Bắt thêm trường hợp nút primary của TikTok chứa text đăng
        if ((b.className || '').includes('Button__root--type-primary')) {
          if (texts.some(t => txt.includes(t)) && on(b)) return true;
        }
      }
      return false;
    };
    while (Date.now() < postDeadline) {
      let ready = false;
      let found = null;
      // Pass 136: Khi fastDone=true, click dùng {force: true} nên không cần chờ lớp phủ/toast biến mất.
      // Cho phép bấm Đăng ngay tích tắc nút vừa enable (tiết kiệm 1-2s cho video dài 5p).
      const strict = fastDone ? false : (Date.now() < STRICT_CLICKABLE_UNTIL);
      try {
        await page.waitForFunction(POST_BTN_READY, strict, { timeout: 1000, polling: 10 });
        ready = true;
      } catch (_) { /* chưa enable trong 1s — quét popup rồi chờ tiếp */ }
      if (!ready) {
        await dismissBlockingPopups(page);
        // Pass 47: dump debug mỗi 10s để truy vết mà KHÔNG spam log
        if (Date.now() - lastMissDump > 10000) {
          lastMissDump = Date.now();
          await dumpSelectorMissDebug(page, 'postButton-miss');
        }
        // Lưới frame: predicate không thấy iframe — soi nhanh đường cũ.
        // Pass 131: findFirstInFrames (bỏ document chính) — dùng findFirst ở
        // đây là bắt lại chính node predicate vừa loại, xem chú thích tại hàm.
        const inFrame = await findFirstInFrames(page, TIKTOK.postButton, 300);
        if (!inFrame || !(await elementEnabled(inFrame.el, strict))) continue;
        // Đi tiếp bằng CHÍNH node trong frame vừa tìm được. Gọi findFirst lần
        // nữa ở đây là quay lại document chính — tức click đúng node mà
        // predicate vừa từ chối (Pass 131).
        found = inFrame;
      } else {
        // Predicate đã xác nhận nút hiện+enable ở document chính → node phải
        // có ngay. 5000 → 1500 ms: quá ngần ấy nghĩa là selector Playwright và
        // predicate đang bất đồng, quay vòng còn rẻ hơn nằm đợi.
        found = await findFirst(page, TIKTOK.postButton, 1500);
      }
      if (!found || !(await elementEnabled(found.el, strict))) {
        await sleep(25);
        continue;
      }
      const tClick = Date.now();
      try {
        // Pass 135: Với fastDone (hoặc sau khi predicate đã thấy nút ready),
        // nút Đăng trên TikTok Studio thường có lớp tooltip/hướng dẫn trong suốt che phủ
        // khiến click thường luôn dính Timeout 100ms lãng phí.
        // Do đó thử thẳng force click trước để bắn lệnh ngay trong 10ms!
        if (fastDone) {
          await found.el.click({ force: true, timeout: 300 });
        } else {
          await found.el.click({ timeout: 100 });
        }
        postClicked = true;
        postClickedAtMs = Date.now();
        mark('postWait', tPostWait); // TIKTOK: xử lý video xong mới enable nút
        ph.postRetry = postRetryMs;  // APP: phần thử-click-lại, tách khỏi số trên
        dlog(`đã click Đăng sau ${((Date.now() - t0) / 1000).toFixed(1)}s (sel=${found.sel})`);
        break;
      } catch (e) {
        lastClickErr = e;
        postRetryMs += Date.now() - tClick;
        dlog(`click Đăng thường bị chặn — thử đóng popup và force/DOM click (${String(e.message).split('\n')[0]})`);
        // Pass 132: THỬ ĐÓNG POPUP ĐÚNG CÁCH trước đã.
        await dismissBlockingPopups(page).catch(() => 0);
        await page.keyboard.press('Escape').catch(() => {});
        // Pass 134/135: Force click ngay với timeout 300ms, nếu vẫn vướng thì DOM click.
        try {
          await found.el.click({ force: true, timeout: 300 });
          postClicked = true;
          postClickedAtMs = Date.now();
          mark('postWait', tPostWait);
          ph.postRetry = postRetryMs;
          dlog(`đã click Đăng (force) sau ${((Date.now() - t0) / 1000).toFixed(1)}s (sel=${found.sel})`);
          break;
        } catch (_) {
          try {
            await found.el.evaluate((b) => {
              b.scrollIntoView({ block: 'center', inline: 'center' });
              b.removeAttribute('disabled');
              b.click();
            });
            postClicked = true;
            postClickedAtMs = Date.now();
            mark('postWait', tPostWait);
            ph.postRetry = postRetryMs;
            dlog(`đã click Đăng (DOM click) sau ${((Date.now() - t0) / 1000).toFixed(1)}s (sel=${found.sel})`);
            break;
          } catch (_) {}
        }
        await sleep(25);
      }
    }
    if (!postClicked) {
      // Dump debug lần cuối TRƯỚC khi throw — Rust sẽ thấy trong stderr
      await dumpSelectorMissDebug(page, 'postButton-final-fail');
      const hint = lastClickErr ? ` (${String(lastClickErr.message).split('\n')[0]})` : '';
      throw new Error(`UPLOAD_TIMEOUT: nút Đăng không enable/bị popup chặn${hint}`);
    }

    // 5. Đợi xác nhận: URL chuyển về trang content HOẶC hint thành công.
    //    Popup bật SAU khi click Đăng cũng phải xử lý — nhưng bằng
    //    dismissPostPhasePopups (KHÔNG Cancel/Hủy — modal pha này có thể là
    //    hộp xác nhận đăng, Cancel là hủy đăng; bug máy khách 20/07).
    const tConfirm = Date.now();
    const finishLog = (how) => {
      mark('confirm', tConfirm); // TIKTOK: modal + finalize + redirect
      // Pass 129: một dòng tuyến — đọc cạnh [timing] là biết lượt này đẩy
      // byte tới host/IP nào và mất bao lâu. Rỗng = trang upload kiểu khác
      // (không request thân lớn nào qua fetch/XHR) — cũng là thông tin.
      buildRoutes();
      dlog(`[route] ${uploadRoutes.length ? uploadRoutes.join(' + ') : 'không thấy request POST/PUT nào tới host TikTok (byte đi đường khác: worker/websocket?)'}`);
      const totalMs = Date.now() - t0;
      // Pass 131: `postRetry` (thử-click-lại vì nút bị che/handle chết) là
      // THUẾ CỦA APP, phải nằm vế app. Trước đây nó chìm trong `postWait` và
      // hiện ra dưới nhãn "xử lý video" — máy khách 5070 (29/08) có lượt
      // postWait 7,2 s mà 5,5 s trong đó là chu kỳ click hỏng của chính ta,
      // dẫn tới kết luận sai "TikTok transcode chậm". `postWait` in ra bây giờ
      // là phần CHỜ NÚT ENABLE thuần (đã trừ phần thử lại).
      const retry = ph.postRetry || 0;
      const postWaitPure = Math.max(0, (ph.postWait || 0) - retry);
      const app = (ph.connect || 0) + (ph.fileSet || 0) + (ph.caption || 0) + retry;
      const tiktok = (ph.editorWait || 0) + postWaitPure + (ph.confirm || 0);
      const s = (v) => ((v || 0) / 1000).toFixed(1);
      // MỘT dòng quy trách nhiệm: app chậm là bug của ta, tiktok chậm là
      // mạng/phía TikTok (đổi được bằng file nhỏ hơn, không bằng code).
      dlog(
        `[timing] total=${s(totalMs)}s | app=${s(app)}s (connect ${s(ph.connect)} + file ${s(ph.fileSet)} + caption ${s(ph.caption)}` +
        (retry > 0 ? ` + THỬ CLICK LẠI ${s(retry)}` : '') + ')' +
        ` | tiktok=${s(tiktok)}s (nhận file ${s(ph.editorWait)} + chờ nút Đăng ${s(postWaitPure)} + đăng/redirect ${s(ph.confirm)}) [${how}]`
      );
      return {
        phases: `total=${s(totalMs)};app=${s(app)};tiktok=${s(tiktok)};connect=${s(ph.connect)};file=${s(ph.fileSet)};editor=${s(ph.editorWait)};caption=${s(ph.caption)};process=${s(postWaitPure)};retry=${s(retry)};confirm=${s(ph.confirm)}`,
      };
    };
    const confirmDeadline = Date.now() + POST_CONFIRM_TIMEOUT_MS;
    let confirmTick = 0;
    // Pass 95: fastDone tính từ CÚ CLICK ĐĂNG, không chỉ từ modal "Post now".
    // Log khách 21/08 (3 lượt confirm=1,5-1,6s dù tiktokFastDone=true): flow
    // hiện tại của TikTok đăng THẲNG không modal → confirmSentAt không bao giờ
    // được đặt → nhánh fastDone thành mã chết, vẫn chờ redirect ~1,5s. Cú click
    // Đăng chính là "lệnh đã gửi"; giữ nguyên grace 500ms + vòng quét hộp lỗi
    // (tick đầu quét ngay) trước khi báo xong. Modal (nếu TikTok bật lại) vẫn
    // được dismissPostPhasePopups đặt lại mốc như cũ.
    let confirmSentAt = fastDone && postClickedAtMs ? postClickedAtMs : 0;
    while (Date.now() < confirmDeadline) {
      // URL check là LOCAL (không qua CDP) nên quét dày 150ms — thành công
      // được ghi nhận gần như tức thì. Hint + quét popup đắt hơn nên chỉ chạy
      // mỗi ~600ms. Vòng cũ (findFirst 1000ms + sleep 1500ms) báo "done" trễ
      // tới ~2.5s sau khi TikTok đã đăng xong (log khách 25/07 10:41).
      if (page.url().includes(TIKTOK.contentUrlPart)) {
        dlog(`upload OK (URL → content) tổng ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        // Điều hướng ngầm về /upload để sẵn sàng ngay lập tức cho video tiếp theo
        page.evaluate(() => {
          setTimeout(() => {
            if (!location.href.includes('/tiktokstudio/upload')) {
              location.href = 'https://www.tiktok.com/tiktokstudio/upload';
            }
          }, 800);
        }).catch(() => {});
        return finishLog('url');
      }
      if (confirmTick % 2 === 0) {
        const hint = await findFirst(page, TIKTOK.successHint, 150);
        if (hint) {
          dlog(`upload OK (hint=${hint.sel}) tổng ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          page.evaluate(() => {
            setTimeout(() => {
              if (!location.href.includes('/tiktokstudio/upload')) {
                location.href = 'https://www.tiktok.com/tiktokstudio/upload';
              }
            }, 800);
          }).catch(() => {});
          return finishLog(`hint=${hint.sel}`);
        }
        if (await dismissPostPhasePopups(page)) {
          // Đã bấm xác nhận "Post now" = lệnh đăng ĐÃ gửi. Chờ redirect
          // /content thêm ~2s là chờ TikTok finalize (log khách: confirm 2.1s).
          // fastDone: chỉ chờ thêm grace ngắn để bắt hộp lỗi, rồi báo xong.
          if (fastDone && !confirmSentAt) confirmSentAt = Date.now();
        }
      }
      if (fastDone && confirmSentAt && Date.now() - confirmSentAt >= FAST_DONE_GRACE_MS) {
        dlog(`upload OK (fastDone: đã gửi lệnh đăng, không chờ redirect) tổng ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        // Điều hướng ngầm về /upload để sẵn sàng ngay lập tức cho video tiếp theo
        page.evaluate(() => {
          setTimeout(() => {
            if (!location.href.includes('/tiktokstudio/upload')) {
              location.href = 'https://www.tiktok.com/tiktokstudio/upload';
            }
          }, 800);
        }).catch(() => {});
        return finishLog('fastDone');
      }
      confirmTick += 1;
      await sleep(fastDone ? 30 : 100);
    }
    throw new Error('UPLOAD_TIMEOUT: không thấy xác nhận sau khi Đăng');
  } finally {
    // Pass 129: gỡ listener telemetry — page được TÁI DÙNG giữa các lượt,
    // không gỡ là listener chồng và một request bị đếm n lần.
    if (pageForRoutes) pageForRoutes.off('requestfinished', onReqFinished);
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

// Pass 50 — KHÓA phiên làm việc trên trang: prepare (warm) và upload dùng CHUNG
// một tab Chrome. Log khách 25/07 13:41 cho thấy prepare của prewarm còn đang
// chạy thì upload bắt đầu → hai bên cùng goto/đóng popup/nạp file trên một
// trang: phase `file` 0.1s → 0.9s, app 0.8s → 1.9s, tổng 7.1s.
// Quy tắc: upload luôn ĐƯỢC ƯU TIÊN — prepare thấy có upload thì tự dừng sớm;
// upload chờ prepare nhả (tối đa PREPARE_YIELD_MAX_MS) rồi mới chạy.
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
