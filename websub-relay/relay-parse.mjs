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
