# DETECTION_LATENCY.md — Spec "đường thẳng" cho detection & e2e

> **Mục tiêu bất biến: detect < 3s (kể từ khi video xuất hiện trên Innertube), e2e detect→rendered < 10s.**
> Mọi thay đổi vào poller / download / render PHẢI giữ nguyên các invariant trong file này.
> Nếu một thay đổi làm tăng latency ở bất kỳ giai đoạn nào — đó là "đi đường vòng", cần thiết kế lại.

---

## 1. Bằng chứng lịch sử: bản cũ RTX 5080 nhanh hơn bản mới ở đâu?

So sánh log thực tế (2026-07-13):

| Chỉ số | RTX 5080 (bản cũ — TỐT) | RTX 3060 (bản mới trước pass 6 — CHẬM) |
|---|---|---|
| Dispatch kênh | **33 kênh song song trong ~1ms** (không cap) | Cap 8 → 27 kênh chia 4 đợt tuần tự |
| Sweep (poll→kênh cuối trả về) | ~0.3–0.5s | ~1.2–1.4s |
| Chu kỳ poll hiệu dụng | **~3.5s** | ~4.7s |
| Worst-case detect | ~4s | ~6s |

**Root cause của regression:** pass 2 (2026-07-11) thêm semaphore `min(8)` vào poll concurrency
để chống GPU contention — đúng cho lúc render, nhưng cap này áp **mọi lúc**, biến dispatch
song song thành 4 đợt tuần tự. Đồng thời `daemonLimit` default bị couple nhầm vào
`max_workers` (số worker **render**, =4 trên RTX 3060) thay vì tài nguyên thật của Innertube daemon
(network-bound Node process).

---

## 2. Kiến trúc detection sau pass 6 (hiện hành)

```
Poller loop:  sleep(pollIntervalMs ± 10%) → poll_once() → lặp
                      │
poll_once():  dispatch TẤT CẢ kênh song song
              concurrency = min(daemonLimit, ready_sessions)   ← KHÔNG có cap cứng
              khi render active: min thêm render_poll_cap (tier-aware)
                      │
              mỗi kênh: lease client (Node daemon warm) → get_latest_videos ~0.3-0.5s
                      │
              filter: seen → duration → age(≤10min) → aspect → process_fn (spawn ngay, ~10ms)
```

### Ngân sách latency (27–33 kênh)

| Giai đoạn | Ngân sách | Thực đo |
|---|---|---|
| Sleep giữa 2 poll | 1.8–2.2s (base 2000 ±10%) | — |
| Sweep (full parallel, daemon=14) | ≤ 0.7s | 0.3–0.7s |
| Filter + process_fn → yt-dlp spawn | ≤ 0.1s | ~0.05s (IP đã cache) |
| **Worst-case detect** | **≤ 3.0s** | ~2.9s |
| **Average detect** | **≤ 1.6s** | ~1.4s |

### Config knobs (settings.json)

| Key | Default (code) | Ghi chú |
|---|---|---|
| `pollIntervalMs` | **2000** (floor 1000 trong Poller) | Bản cũ 5000 → detect worst 6s+. KHÔNG đặt lại 4000-5000. |
| `daemonLimit` | **`gpu_config.max_sessions`** (14 desktop, 6 laptop yếu) | Node daemon ~80MB RAM/cái. Setting cũ =8 trên máy khách nên XÓA để dùng default mới. |
| render_poll_cap (không phải setting) | tier High=8, Mid/Low=2 | Chỉ áp khi `active_renders > 0`. |

**⚠️ Máy khách đang có `daemonLimit: 8` trong settings.json — cần xóa key này (hoặc đặt 14)
khi deploy patch, nếu không sweep vẫn bị chia 2 đợt.**

---

## 3. INVARIANTS — những "đường vòng" đã trả giá, KHÔNG lặp lại

1. **KHÔNG cap poll concurrency dưới số kênh** (trừ lúc render trên GPU yếu).
   Pass 2 cap=8 → +1s sweep mỗi chu kỳ. Đã bỏ ở pass 6.
2. **KHÔNG defer/block poll khi render.** Deferral 3s (pass 2) làm video kế tiếp bị detect trễ
   tới 3s. Thay bằng throttle concurrency (pass 5) + tier-aware cap (pass 6).
3. **KHÔNG spawn process đắt trên critical path detect→download.**
   `get_physical_ip` từng chạy PowerShell 1.2s MỖI download → đã cache TTL 5 phút (pass 5).
   Tương tự: không load settings/workspaces.json lặp lại, không ffprobe thừa.
4. **KHÔNG làm việc tuần tự nếu song song được:** thumbnail + composite background được
   pre-warm song song với download video (pass 5). Re-download thumbnail sau khi có file
   = invalidate cache (mtime đổi) — chỉ tải nếu chưa tồn tại.
5. **KHÔNG couple giới hạn Innertube daemon vào render workers.** Daemon là network-bound;
   `max_workers` là số NVENC worker. Hai tài nguyên khác nhau.
6. **Jitter phải đối xứng** (±10%): công thức cũ `base + 0..20%` chỉ CỘNG delay → cadence
   trung bình phình 10% vô ích.
7. **Age filter ≤ 10 phút và duration ≥ 60s là filter NGHIỆP VỤ** — không nới để "tăng detect".
8. **ChromeWatcher (CDP 500ms) là đường detect ~0s** cho kênh có tab Chrome mở — giữ chạy
   song song với poller, không thay thế poller.

---

## 4. Checklist verify sau mỗi patch (đọc từ log máy khách)

```
1. Cadence:   grep "Polling .* active channels" → khoảng cách 2.0-2.9s
2. Dispatch:  grep "Spawning N parallel poll tasks (cap=C)" → C ≥ số kênh hoặc = daemonLimit (14)
3. Sweep:     từ "Polling" đến "get_latest_videos returned" cuối cùng < 0.8s
4. IP cache:  KHÔNG có "[Youtube] Physical IP detected" (PowerShell) ngay trước "Spawning yt-dlp"
              (chỉ 1 lần lúc startup / mỗi 5 phút)
5. BG cache:  "Composite background cache HIT" khi auto-render (MISS = pre-warm hỏng)
6. Render:    khi render active thấy "throttling poll concurrency to 2" (Mid/Low) hoặc 8 (High)
7. E2E:       detect (workspace ts trong ws-ch-<ms>) → "Auto-render completed" < 10s
```

## 5. Lịch sử pass (chi tiết: RENDER_GPU_CONTENTION.md)

- Pass 1–4 (2026-07-11): Chrome tabs defer, download-sections threshold, channel resolution cache.
- Pass 5 (2026-07-13): IP cache, bg pre-warm, bỏ deferral 3s → throttle 2, prewarm song song. E2E 10.5→~8.3s.
- Pass 6 (2026-07-13): bỏ cap 8, daemonLimit hardware-aware (max_sessions), interval default 2000
  (floor 1000), jitter ±10%, render_poll_cap theo tier. Detect worst ~6s → **<3s**.
- Chưa làm: native download qua Innertube daemon thay yt-dlp (−2.5s e2e, biết width/height trước khi tải).

---

## 6. Download queue tuần tự + kế toán thời gian đợi (Pass 7, 2026-07-13)

### Vì sao tuần tự?

Băng thông là **một** đường uplink chia sẻ. Log 10-28-05: 3 download song song → mỗi luồng
~1.2 MB/s (solo ~2.6 MB/s) → MỌI video đều xong muộn hơn so với chạy lần lượt.
Client yêu cầu: **video detect trước phải xong trước.**

- `download_instances` = **1 mặc định** (tokio Semaphore FIFO — đúng thứ tự đến).
  Override: `maxConcurrentDownloads` trong settings (chỉ khi khách có uplink lớn).
- Workspace tạo với status **"waiting"** (= trong hàng chờ). Chỉ khi acquire được permit
  mới chuyển **"downloading"** + set `downloadStartedAt` + `queueWaitSec`.

### Kế toán e2e (INVARIANT #9)

**`downloadStartedAt` PHẢI set SAU khi acquire queue permit.** Thời gian đợi hàng chờ
KHÔNG được tính vào `downloadDurationSec`/`totalDurationSec` — nó được ghi riêng vào
`queueWaitSec` và UI Management hiển thị "⏸ Đợi hàng chờ tải tuần tự: Xs (không tính vào tổng)".
Bug cũ: `downloadStartedAt` set TRƯỚC `pool.acquire()` → video thứ 2 bị cộng oan thời gian đợi.

### Ca "detect 8s" (log 11-41-23) — phân tích chuẩn để trả lời khách

Video `tZoTZqGFUoI`: poll cadence quanh thời điểm đó đều đặn 2.9s, không throttle;
app detect chỉ **23ms** sau poll. Video `UxHFqYpz9UQ` cùng log: 4 poll liên tiếp (mỗi 2.9s)
KHÔNG thấy video dù kênh được quét → **YouTube surface video lên Innertube muộn 5-8s**
sau khi bấm đăng. Phần này NGOÀI tầm app — app chỉ chịu trách nhiệm ≤3s kể từ khi video
xuất hiện trên Innertube. Muốn 0-2s từ lúc đăng: dùng ChromeWatcher (mở tab kênh trong
Chrome, CDP 500ms) cho các kênh ưu tiên.

### IP cache: stale-while-revalidate

TTL 5 phút cũ → download đầu tiên sau >5 phút idle trả giá PowerShell ~1.3s (log 03:00:18).
Giờ: hết TTL vẫn trả IP cũ ngay lập tức + refresh nền (AtomicBool guard). Chỉ block khi
chưa từng có giá trị.

---

## 7. Premiere/Upcoming loop (Pass 8, 2026-07-13) — INVARIANT #10

**Sự cố máy khách (log 12-27-28):** kênh NOW đặt lịch công chiếu → UI hiện video "detect 10.0p,
Đang tải" liên tục, trang quản lý trống. Chuỗi lỗi:

1. Lockup text Hàn "N분 후 최초 공개" (công chiếu SAU N phút) khớp regex `(\d+)` + '분'
   trong `parseRelativeTime` → hiểu nhầm thành "N phút TRƯỚC" → qua age filter → detect.
2. yt-dlp fail `Premieres in 5 minutes` → handler xóa workspace + unmark seen "để retry".
3. Poll sau (~2.5s) re-detect → lặp vô hạn tới khi premiere lên sóng: workspace tạo/xóa
   liên tục (UI quản lý trống), chiếm slot download queue tuần tự, badge latency phình 10p.

**Fix 2 lớp:**
- `innertube_helper.js` (`parseRelativeTime`): text có SỐ + marker upcoming ('premiere',
  '최초 공개', '공개 예정', 'プレミア公開', 'công chiếu', 'scheduled'...) và KHÔNG có marker
  quá khứ ('ago', 'trước', '前', '전') → trả 0 → age filter skip tới khi video lên sóng
  (lúc đó text chuyển dạng quá khứ/live → detect bình thường, latency badge đúng).
- `commands.rs`: `premiere_backoff_store` (video_id → retry_at). Khi yt-dlp fail premiere:
  parse "Premieres in X minutes/hours" → backoff X + 30s (default 2 phút) — process_fn skip
  video trong thời gian backoff. Chống lặp bất kể ngôn ngữ/format text mới của YouTube.

**INVARIANT #10: mọi đường "retry bằng cách re-detect" (unmark seen) PHẢI có backoff.**
Không backoff = vòng lặp bằng đúng poll cadence (2.5s) — càng tối ưu detection càng lặp nhanh.

---

## 8. Fixed-cadence poller + phân loại nguồn trễ trên UI (Pass 9, 2026-07-13)

### Fix "1% chu kỳ bị kéo 7-21s" (log full 12-55-47)

Lác đác có request Innertube mất đúng ~10.2s (timeout+retry trong daemon, phía YouTube,
rải ngẫu nhiên kênh/session). Poll cũ: `sleep → await poll_once (join_all TẤT CẢ kênh) → sleep`
→ 1 kênh chậm 10s kéo cả chu kỳ lên 12s+, delay detection của 26 kênh còn lại.

Fix (poller.rs):
- **Cadence cố định**: ticker fire mỗi `pollIntervalMs ±10%`, `poll_once` được **spawn**
  (không await) → kênh chậm không còn ảnh hưởng nhịp quét.
- **`in_flight` registry** (channel_id → Instant): chu kỳ sau bỏ qua kênh còn đang chờ
  response (log "Skipping N channel(s) with a poll still in flight"). Entry quá 60s bị
  purge (chống leak nếu task panic).
- **Lease timeout 45s → 12s** (innertube_pool.rs): đủ cho cold-daemon first-RPC (~10s),
  chặn straggler chiếm thread; kênh timeout sẽ được quét lại ở chu kỳ sau.

**INVARIANT #11: chu kỳ poll KHÔNG được phụ thuộc kênh chậm nhất.** Mọi thao tác chờ-tất-cả
(join_all) phải nằm ngoài đường quyết định nhịp quét.

### UI phân loại nguồn trễ (ca "14.0p đỏ")

- Rust: `is_startup_catchup` mở rộng — catchup nếu trong 60s đầu **hoặc**
  `published_at < startup_time_ms` (video đăng khi app đang tắt → không thể detect real-time).
- Python `detection_history_model`: role mới **`latencySource`** = `catchup` (đăng trước khi
  app chạy) / `youtube` (latency > 8s khi app đang chạy = YouTube surface muộn) / `app` (bình thường).
  `slaPercent` + `averageLatencyMs` **loại catchup** khỏi mẫu — KPI "% <5s" phản ánh đúng app.
- QML PollerPanel: badge latency đổi màu theo nguồn — catchup = xám + hậu tố "bù",
  youtube = xanh dương + "YT", app = xanh/vàng/đỏ theo ngưỡng như cũ.
  Chỉ trễ do APP mới được phép hiện đỏ.

### Verify sau deploy (bổ sung checklist mục 4)

```
8. Cadence ổn định: khoảng cách "Polling ... active channels" ≈ 2.0-2.2s KỂ CẢ khi có
   kênh chậm — thấy dòng "Skipping N channel(s) with a poll still in flight" thay vì gap 12s.
9. Badge: video đăng lúc app tắt hiện "Xp bù" xám; video YouTube surface muộn hiện "Xs YT" xanh.
```

---

## 9. Giải mã "máy 5080 bản cũ bắt <5s" — ảo giác đo lường (2026-07-13)

So sánh head-to-head 2 máy CHẠY SONG SONG, cùng theo dõi kênh test (log 5080 08-59-25 vs
log 3060 10-28-05/11-03-33, cùng giờ UTC):

| Video | 3060 (bản MỚI, Innertube poller) | 5080 (bản CŨ, ChromeWatcher tab) | Ai nhanh hơn |
|---|---|---|---|
| uYibHI1fyJA | 01:30:05 | 01:33:06 | **3060, +3p01** |
| ijVxBWsolgw | 02:05:47 | 02:08:46 | **3060, +2p59** |
| 6iLxb1uiO4Y | 02:06:58 | 02:10:01 | **3060, +3p03** |
| G0ItvSHhMGY | 02:12:30 | 02:15:21 | **3060, +2p51** |

**Máy 3060 bản mới thắng cả 4 lần, mỗi lần ~3 phút.** Vậy tại sao UI máy 5080 hiện "<5s"?

→ Trên 5080, TẤT CẢ video mới đều được phát hiện qua **ChromeWatcher** (tab Chrome mở kênh),
và [chrome_watcher.rs:235] gán `published_at = now_ms` ("Use detection time as published_at")
— UI luôn hiển thị latency ~0-2s **bất kể video đã đăng bao lâu trước đó**. Badge "<5s" của
bản cũ là số ảo; badge "11p" của bản mới là số THẬT (published_at lấy từ Innertube).

Bài học: **không so sánh latency giữa 2 nguồn detect có cách đo published_at khác nhau.**
Nguồn ChromeWatcher không biết giờ đăng thật → mọi badge của nó chỉ có nghĩa "thời điểm app thấy".

### Checklist đồng bộ 2 máy về bản mới nhất (pass 5-9)

1. Deploy build mới cho CẢ 3060 lẫn 5080.
2. settings.json cả 2 máy: XÓA `daemonLimit` (→ tự = max_sessions 14), XÓA/đặt
   `pollIntervalMs: 2000`, XÓA `maxConcurrentDownloads` (→ queue tuần tự = 1).
3. Giữ tab Chrome mở kênh ưu tiên trên cả 2 máy (ChromeWatcher là nguồn phụ khi Innertube die),
   nhưng hiểu latency badge của nguồn CW không phản ánh giờ đăng thật.

### ⚠️ ĐÍNH CHÍNH section 9 (sau khi khách xác nhận đồng hồ 5080 NHANH 3 PHÚT)

Bảng head-to-head ở trên chưa hiệu chỉnh clock skew. Trừ 3 phút khỏi timestamps 5080:
cả 4 video trùng được 2 máy detect **gần như cùng thời điểm thực** (chênh <10s) — HÒA,
không máy nào thắng. Kết luận đúng:

1. Badge "<5s" trên 5080 vẫn là số ảo (CW gán published_at = lúc phát hiện).
2. Khác biệt cấu trúc thật: **5080 có Chrome tab kênh mở → ChromeWatcher hoạt động (9/9 video
   qua CW); 3060 KHÔNG có Chrome chạy → CW chết đói cả phiên** (startup skip launch Chrome
   khi Profile-1 đã có cookies — commands.rs "skipping Chrome launch (not needed)").
3. Với video YouTube surface muộn trên Innertube API (ca 11-14p), tab Chrome là cơ hội duy
   nhất bắt sớm → cần kích hoạt CW trên MỌI máy: startup luôn ensure Chrome + tabs kể cả
   khi đã có cookies, và CW phải fetch published_at thật (get_video_info) thay vì now_ms.
4. Nguồn source bản 5080 để đối chiếu: commit `f323d33` (branch rtx5080) — xác định bằng
   patch-version.json + vân tay số dòng log; đọc bằng `git show f323d33:<file>`.

---

## 10. Kích hoạt ChromeWatcher mọi máy + publish time thật (Pass 10, 2026-07-13)

### Fix A — Chrome + tab kênh luôn được đảm bảo lúc startup

Trước: startup chỉ launch Chrome khi Profile-1 CHƯA có cookies → máy đã đăng nhập (3060)
không bao giờ có Chrome/tab → ChromeWatcher chết đói, mất nguồn detect thứ 2 (nguồn duy nhất
thấy sớm các video Innertube surface muộn 10-15 phút).
Sau: nhánh "đã có cookies" vẫn gọi `launch_chrome_profile_async` (mở Chrome CDP 9222 + tab
`/videos` cho mọi kênh enabled; `ensure_chrome_tabs_open` sẵn guard chờ 30s startup + hết
render, tối đa 120s). Tắt bằng setting **`chromeAutoOpenTabs: false`**.
Lưu ý RAM: ~27 tab YouTube ≈ 3-5GB — máy yếu cân nhắc tắt hoặc giảm số kênh.

### Fix B — Bỏ published_at giả của ChromeWatcher

- `chrome_watcher.rs`: cả 2 path (watch tab + channel tab) giờ gửi `published_at = 0` khi
  không biết giờ đăng thật (trước: gán = giờ phát hiện → badge luôn ~0s, chính là nguồn gốc
  huyền thoại "5080 bắt <5s").
- `innertube_helper.js getVideoInfo`: trả thêm `publishedAtMs` từ **player microformat
  publishDate** (ISO timestamp đầy đủ — nguồn giờ đăng chính xác đến giây duy nhất;
  LockupView/DOM chỉ có độ phân giải phút).
- `process_fn`: resolve qua daemon khi channel trống HOẶC publish time trống (~0.3-0.5s,
  chỉ áp cho event ChromeWatcher — đường poller không đổi) → backfill `published_at` thật;
  yt-dlp fallback chỉ chạy khi channel thật sự trống.

Kết quả: badge latency của nguồn tab giờ so sánh được với nguồn poller → thí nghiệm
CW-vs-poller cùng đồng hồ (section 9) đo được thật. Bonus: tab checker dùng chung
`parseRelativeTime` nên guard premiere (INVARIANT #10) bảo vệ luôn nguồn tab.

### ⚠️ Pass 10b — Hotfix regression của Fix A (log 17-07-29)

Trên RTX 3060 (Mid tier), 28 tab tự mở làm **render tụt 54x → 24.7x** (740fps) và
**download chậm 2.4x** (video đầu còn bị YouTube chặn anonymous → retry cookies do burst
28 tab load cùng IP). E2E vọt 8s → 25-34s. Đây là contention STEADY-STATE (tab tồn tại
suốt phiên), khác với burst lúc mở tab mà ensure_chrome_tabs_open đã guard.

Fix:
- **`chromeAutoOpenTabs` default theo tier**: High = true (5080 chạy 30+ tab vô hại,
  đã kiểm chứng), Mid/Low = **false** (3060 quay về pipeline nhanh, mất nguồn tab).
- **`chromeTabLimit`** (mới): giới hạn SỐ TAB KÊNH khi bật tabs trên máy yếu — đặt
  3-5 kênh ưu tiên (xếp kênh ưu tiên lên đầu danh sách). 0 = không giới hạn.
- Khuyến nghị máy Mid muốn bắt sớm kênh test: `chromeAutoOpenTabs: true` + `chromeTabLimit: 3`.

**Deploy note:** app không tự đóng Chrome — trên máy 3060 phải ĐÓNG Chrome (28 tab) thủ công
sau khi cài patch, nếu không contention vẫn tiếp diễn dù setting đã đổi.

**INVARIANT #12: mọi nguồn detect bổ sung phải trả chi phí GPU/CPU/băng thông theo tier.**
Nguồn giúp detect sớm hơn 10 phút nhưng làm e2e chậm 3-4x trên máy yếu là lỗ ròng.
