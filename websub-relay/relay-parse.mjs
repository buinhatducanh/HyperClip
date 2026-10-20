// tools/websub-relay/relay-parse.mjs
//
// Phần đọc payload WebSub của YouTube, tách khỏi relay.mjs để test được mà
// không phải mở server. Chỉ thư viện chuẩn.

// ─── Đọc Atom feed ─────────────────────────────────────────────────────────
// Payload của YouTube nhỏ và cấu trúc cố định, nên rút bằng regex là đủ và
// tránh kéo thêm một phụ thuộc XML chỉ để đọc bốn trường.
export function parseAtom(xml) {
  const out = [];
  const entries = xml.split('<entry>').slice(1);
  for (const chunk of entries) {
    const pick = (tag) => {
      const m = chunk.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1].trim() : '';
    };
    const videoId = pick('yt:videoId');
    if (!videoId) continue;
    out.push({
      videoId,
      channelId: pick('yt:channelId'),
      title: pick('title'),
      published: pick('published'),
      updated: pick('updated'),
    });
  }
  return out;
}

/**
 * Pass 85 — ping XOÁ video (Atom Tombstones, `<at:deleted-entry ref="yt:video:ID"
 * when="...">` kèm `<at:by><uri>…/channel/UC…</uri>`). ytnoti có listener
 * riêng cho loại này; với HyperClip giá trị nằm ở chỗ khác: kênh XOÁ 1 rồi
 * ĐĂNG 1 giữ nguyên videoCount → chuông cảm biến câm (INVARIANT #30, lỗ số 2).
 * Biết có xoá là biết số đếm sắp nói dối → app ép soi lại kênh đó.
 */
export function parseDeleted(xml) {
  const out = [];
  const re = /<at:deleted-entry\b([^>]*)>([\s\S]*?)<\/at:deleted-entry>|<at:deleted-entry\b([^>]*)\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] || m[3] || '';
    const inner = m[2] || '';
    const ref = (attrs.match(/ref="([^"]*)"/) || [])[1] || '';
    const videoId = (ref.match(/yt:video:([\w-]+)/) || [])[1] || '';
    if (!videoId) continue;
    const channelId = (inner.match(/channel\/(UC[\w-]+)/) || [])[1] || '';
    out.push({ videoId, channelId, when: (attrs.match(/when="([^"]*)"/) || [])[1] || '' });
  }
  return out;
}

/**
 * Phân xử upload/edit.
 *
 * ytnoti dùng `updated − published < 20s` làm tiêu chí upload. Với HyperClip
 * luật đó SAI cho đúng ca hay gặp nhất: video upload-rồi-đăng có `published` =
 * mốc BẮT ĐẦU upload (đo 14/08: khai 11:16:06, bấm Đăng 11:19:29 — lệch 3,4
 * phút) → ping đầu tiên của video MỚI TINH bị xếp là "edit" và bị bỏ. Nên ở
 * đây tiêu chí duy nhất là "relay đã thấy videoId này chưa" (sống qua restart);
 * hiệu `updated − published` chỉ ghi vào sổ để đối chiếu, không dùng để lọc.
 */
export function classify(first) {
  return first ? 'upload' : 'edit';
}

/**
 * Pass 135b — kênh cần ĐĂNG KÝ LẠI với hub?
 *
 * Trước đây relay chỉ gọi hub lúc khởi động và 4 ngày/lần; kênh mà hub không
 * xác minh (GET /yt-callback không tới nơi lúc đó: tunnel chưa lên, Cloudflare
 * chặn, hub lỗi tạm) nằm chết tới 4 ngày mà không ai biết. Nay mỗi phút soi:
 * chưa `lastVerifiedAt` và lần gọi hub gần nhất đã quá `cooldownMs` → gọi lại.
 * Kênh đã xác minh không đụng (subscribeAll định kỳ lo gia hạn).
 */
export function needsResubscribe(entry, nowMs, cooldownMs) {
  if (!entry) return true;
  if (entry.lastVerifiedAt) return false;
  const last = entry.lastSubscribeAt || 0;
  return nowMs - last >= cooldownMs;
}

// ─── Pass 136 — ĐA KHÁCH: mỗi máy một token, mỗi token một danh sách kênh ──

/**
 * `WEBSUB_CLIENT_TOKENS="may5070:<token>,may5080:<token>"` → Map tên → token.
 * Tên: chữ/số/-/_ ≤32 ký tự; token ≥16 ký tự. Mục sai bị bỏ (không sập relay).
 */
export function parseClientTokens(str) {
  const out = new Map();
  for (const part of String(str || '').split(',')) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf(':');
    if (i < 1) continue;
    const name = p.slice(0, i).trim();
    const token = p.slice(i + 1).trim();
    if (!/^[\w-]{1,32}$/.test(name) || token.length < 16) continue;
    out.set(name, token);
  }
  return out;
}

/** Hợp kênh của mọi khách. */
export function unionChannels(clientChannels) {
  const u = new Set();
  for (const set of clientChannels.values()) for (const id of set) u.add(id);
  return u;
}

/** Hiệu hai tập: kênh mới xuất hiện (đăng ký hub) và kênh không còn ai giữ (unsubscribe). */
export function diffSets(prev, next) {
  const added = [...next].filter((id) => !prev.has(id));
  const removed = [...prev].filter((id) => !next.has(id));
  return { added, removed };
}
