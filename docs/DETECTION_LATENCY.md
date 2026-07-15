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

---

## 11. Khôi phục "Instant Playlist HTML Resolver" (Pass 11, 2026-07-13)

### Nguồn lý thuyết — docs của chính dự án (đọc TRƯỚC khi bàn giải pháp mới)

- `docs/_archived/AUTO_INGESTION_TECH_OVERVIEW.md` — thiết kế Instant Playlist HTML Resolver
  (playlist HTML surface video TỨC THỜI, trước cả RSS lẫn browse API; gán publishedAt=now
  cho video mới chưa seen → SLA <10s). Đã chạy thật, đưa detect 57s → <10s.
- `docs/_archived/TECHNOLOGY_OVERVIEW.md` — 7-strategy extraction thời Electron.
- `HYPERCLIP_RULES.md` mục "Không dùng" — WebSub (cần public URL), RSS (trễ 5-30p),
  activities endpoints (Google đã xóa). KHÔNG đề xuất lại các hướng này.

### Điều đã xảy ra

Refactor `f60ae49` rút `getLatestVideo` xuống còn 1 strategy (getPlaylist API) — đánh rơi
resolver. Hệ quả chính là các ca "video trễ 11-14 phút": video ĐÃ public (playlist HTML
thấy ngay) nhưng API index trễ → poller mù suốt 11 phút (87 video × 247 poll).

### Khôi phục (có kỷ luật băng thông — INVARIANT #12)

- `strategyPlaylistHTML` (innertube_helper.js): fetch trang playlist UU… với cache-busting,
  timeout 4s, parse ytInitialData top-15. ~0.5MB/lần.
- `getLatestVideo(channelId, cookie, fastProbe)`: khi `fastProbe=true`, chạy HTML probe
  song song với API; video có trong HTML mà KHÔNG có trong API list (và API list non-empty
  — guard chống API fail) → `publishedAt = Date.now()` → qua age filter → detect ngay.
  Dedup nhờ seen_ids; premiere lọt qua sẽ bị premiere backoff (INVARIANT #10) chặn loop.
- **`fastProbeLimit`** (setting, default **3**): chỉ N kênh ĐẦU danh sách được probe
  (~0.5MB × 3 kênh / 2.7s ≈ 5Mbps — chấp nhận được; 27 kênh = 48Mbps là tự sát băng thông).
  → **Xếp kênh ưu tiên/test lên đầu danh sách kênh.**

### Verify sau deploy

Upload video test → log phải thấy video detect trong <10s dù API index chưa liệt kê
(video xuất hiện với publishedAt≈now từ nguồn HTML). Đếm "returned N videos" sẽ tăng
sớm hơn ở kênh có probe.

---

## 12. Premiere v2 — tín hiệu UPCOMING structural + UI "Chờ chiếu" (Pass 12, 2026-07-13)

**Sự cố (log 17-28-35):** premiere `rckmDHThyT8` lọt qua guard TEXT của pass 8 (form text Hàn
không nằm trong danh sách marker) → detect badge ~10p → yt-dlp fail "Premieres in 5 minutes"
→ backoff 330s hoạt động ĐÚNG nhưng lộ 2 lỗ hổng: (1) entry lịch sử phát hiện đã nhận
"downloading" và không ai cập nhật sau khi workspace bị xóa → **"Đang tải" mãi mãi**;
(2) khi premiere lên sóng, text thành "N명 시청 중" (SỐ + marker live) → parser trả 0 →
**không bao giờ re-detect** (không có retry nào trong log).

Fix 3 tầng:
1. **UPCOMING structural** (độc lập ngôn ngữ — hết trò đuổi bắt text): lockup của video
   hẹn giờ luôn có overlay style `UPCOMING` trong JSON → `lockupIsUpcoming()` → publishedAt=0
   → age filter skip. Áp cả 3 đường: LockupView browse, getPlaylist API (`v.is_upcoming`),
   playlist HTML probe (skip item chứa 'UPCOMING'). Khi lên sóng, overlay đổi LIVE → hết skip.
2. **Parser viewer-count**: text có SỐ + marker live ('watching', '시청 중', 'đang xem'...)
   và không có marker quá khứ → `Date.now()` (số là lượt xem, không phải tuổi video) →
   premiere vừa lên sóng được re-detect ngay trong 1 chu kỳ poll sau khi backoff hết hạn.
3. **UI terminal state**: premiere branch emit `workspace:update {status:"scheduled",
   error:"Chờ công chiếu — tự thử lại khi lên sóng"}` TRƯỚC khi delete workspace →
   lịch sử phát hiện hiện "Chờ chiếu" (label mới trong PollerPanel) thay vì kẹt "Đang tải".

**INVARIANT #13: trạng thái UI phải có terminal state cho MỌI nhánh kết thúc pipeline**
(kể cả nhánh xóa workspace) — mọi status "đang ..." phải được ai đó chuyển tiếp.

### Pass 12b — Tab reload floor 30s

Bản cũ reload mỗi tab kênh mỗi 30s (cố định); refactor đổi thành `pollIntervalMs × 2` —
với interval 2000ms của pass 6 sẽ thành reload mỗi ~3s × 30+ tab trên máy High tier
(băng thông/CPU khổng lồ + anti-bot risk). Fix: `Math.max(30000, pollIntervalMs * 2)`.
DOM stale 30s chấp nhận được vì 2 nguồn còn lại của CW checker (subscriptions feed +
playlist API) cập nhật không cần reload.

**Trả lời "không reload Chrome có sao không":** máy KHÔNG chạy Chrome (3060 sau pass 10b)
→ không sao: poller + fast HTML probe (pass 11) phủ fast surface không cần Chrome; bằng
chứng tab ≈ API trên kênh test. Máy CÓ Chrome (5080): tab reload là bắt buộc cho nguồn
DOM — floor 30s, không nhanh hơn.

---

## 13. Premiere hiển thị "Chờ chiếu" chủ động (Pass 13, 2026-07-13)

**Yêu cầu khách (log 18-17-33, premiere jQ4DEVIJI3s):** premiere lên sóng 18 phút sau khi
đặt lịch → UI hiện badge "18p" đỏ → khách tưởng app lỗi. Pass 12 đã sửa phần badge (detect
lúc lên sóng với giờ thật → vài giây), pass 13 bổ sung phần chủ động thông báo:

Luồng mới khi poller gặp video UPCOMING trên kênh theo dõi:
1. helper trả `upcoming: true` + `scheduleText` (text lịch chiếu nguyên bản của YouTube,
   đã localize — không parse).
2. Poller phát event **`premiere:scheduled`** MỘT LẦN (dedup in-memory) — KHÔNG mark seen
   (video vẫn phải được detect khi lên sóng), KHÔNG tạo workspace, KHÔNG tải.
3. UI: hàng mới trong lịch sử phát hiện — badge cam **"hẹn giờ"**, status **"Chờ chiếu"**,
   tiêu đề kèm scheduleText ("... — Công chiếu 18:35"). Activity log ghi "Chờ công chiếu: ...".
4. Khi lên sóng: poller detect bình thường (parser live/quá-khứ) → `add_detection` tự
   **thay thế** hàng "Chờ chiếu" (wsId `sched-<videoId>`) bằng hàng thật với latency thật
   (~giây). Hàng scheduled không tính vào SLA/latency trung bình (publishedAt=0).

Khách nhìn thấy: "Chờ chiếu 18:35" ngay khi kênh đặt lịch → đúng giờ chiếu chuyển thành
"Đang tải" → "Sẵn sàng". Không còn số đỏ 18p vô căn cứ.

### Pass 13b — Premiere PHẢI tải được khi lên sóng (active watcher + active retry)

**Lỗ hổng "premiere không bao giờ tải" (khách xác nhận):** đường re-detect thụ động qua
channel poll chết ở cả 2 pha: (a) ĐANG chiếu → duration overlay = LIVE → durationSec 0 →
Short filter loại; (b) chiếu XONG mà premiere dài >10 phút → age filter loại vĩnh viễn.

Fix — 2 cơ chế chủ động, filter-free:
1. **Premiere watcher** (poller.rs `watch_premiere`): sau khi announce "Chờ chiếu", task
   riêng poll `getVideoInfo(video_id)` (player endpoint) mỗi 45s — khi `is_upcoming=false`
   → fire `process_fn` TRỰC TIẾP với duration/publish thật (không qua age/Short filter;
   process_fn tự có duration cap). Dừng khi ingested/24h. Chi phí: 1 request/45s/premiere.
2. **Active retry sau backoff** (commands.rs): khi yt-dlp fail premiere → ngoài backoff,
   spawn thread ngủ đến `delay+35s` rồi fire process_fn trực tiếp — nếu vẫn chưa chiếu,
   quay lại chính nhánh này với backoff mới (vòng bounded ≥2.5 phút/lần).
Dedup giữa 2 cơ chế: processing_video_ids + workspace-exists + seen check trong watcher.

**INVARIANT #14: đường ingest premiere không được phụ thuộc filter của channel poll**
(age/duration/Short đều cho kết quả sai trong và ngay sau buổi chiếu).

---

## 14. HTML probe nuốt video PRIVATE + ws_id trùng (Pass 14, 2026-07-13)

**Sự cố máy khách (log 18-57-03):** ngay poll đầu sau khi cài patch, 4 video từ kênh test
(kênh đầu danh sách → có fast probe) bị detect và tải → cả 4 fail yt-dlp "Private video.
Sign in if you've been granted access" (oEmbed xác nhận 403 — private thật, chưa từng public).
Video hợp lệ thứ 5 phải đợi 5.1s trong download queue sau 4 video rác.

**Root cause:** `strategyPlaylistHTML` fetch trang playlist UU… **kèm cookie đăng nhập** —
với kênh mà account operator là chủ/quản lý, trang owner-view liệt kê CẢ video private,
còn API getPlaylist thì không → resolver coi là "video mới index chưa kịp" → stamp
`publishedAt = Date.now()` → qua age filter → tải → chết. Guard pass 12 chỉ chặn UPCOMING.

**Fix (innertube_helper.js):** playability gate cho MỌI candidate HTML-fresh —
`verifyHtmlFreshPlayable`: gọi `client.getBasicInfo(videoId)` (player endpoint),
chỉ nhận `playability_status === 'OK'` và không `is_upcoming`. Bonus: lấy `durationSec`
thật từ player (trước đây HTML-fresh luôn durationSec=0). Video bị từ chối được cache
(re-check tối đa 1 lần/60s) → video private sau này chuyển public vẫn được bắt trong ≤60s
mà không spam player endpoint mỗi chu kỳ poll 2s. Chi phí: ~0.3-0.5s MỘT LẦN cho mỗi
candidate thật sự mới — trong ngân sách detect <3s (đường HTML-fresh vốn thay cho việc
đợi API index hàng phút).

**INVARIANT #15: mọi nguồn detect dùng surface ĐĂNG NHẬP (owner-view) phải verify
playability qua player endpoint trước khi ingest.** Surface đăng nhập nhìn thấy nhiều hơn
những gì yt-dlp tải được (private/members-only/processing).

**Fix phụ (commands.rs):** `ws_id = ws-ch-<detected_at ms>` — full-parallel detection cho
nhiều video cùng 1 ms → 3 workspace TRÙNG ID (log 18-57-03: 3× `ws-ch-1783936627690`) →
store update/UI event lẫn lộn giữa các video. Fix: atomic monotonic ms (`LAST_WS_ID_MS`) —
giữ nguyên format `ws-ch-<ms>` cho log analysis, chỉ bump +1ms khi va chạm.

---

## 15. Mở lại CDP mọi tier + quan sát được daemon (Pass 15, 2026-07-13)

**Sự cố (log 20-08-37):** khách test đăng video trên kênh zilkay (máy 3060) → poller quét
kênh đều đặn 2s/lần nhưng KHÔNG detect. Nguyên nhân kép:

1. **Flow test của khách là flip video private → public.** Video flip GIỮ ngày đăng gốc
   (cũ hàng giờ) → age filter ≤10p loại vĩnh viễn trên đường poller/API; đường HTML probe
   cũng bỏ qua vì video đã nằm trong API list (không còn "fresh"). Nguồn DUY NHẤT ingest
   được video flip là **CW watch-tab** (mở video trong tab Chrome → ingest tức thời,
   filter-free) — nhưng pass 10b đã default `chromeAutoOpenTabs=false` trên Mid/Low
   → Chrome CDP không được launch → CW chết đói → flow test chết.
2. Helper không có kênh log (stderr → null) → mọi quyết định probe/gate vô hình.

**Fix:**
- `chromeAutoOpenTabs` default **true MỌI tier** (commands.rs). Contention Mid/Low được
  chặn bằng `chromeTabLimit` **tier default: High=0 (không giới hạn), Mid/Low=3** —
  thảm họa 17-07-29 là do 28 tab không giới hạn, không phải do Chrome tự thân.
  Setting tường minh vẫn override cả hai.
- Daemon stderr được pipe vào tracing (`[InnertubeDaemon]` trong innertube_client.rs);
  helper có `dlog()` → stderr: log `[probe]` khi stamp HTML-fresh, `[probe-gate]` khi
  reject candidate (kèm playability status).
- Gate re-check TTL 60s → **20s**: video private flip public (còn ngoài API list) hoặc
  upload vừa xử lý xong được bắt trong ≤1 cửa sổ re-check.

**Verify sau deploy (bổ sung checklist mục 4):**
```
10. Startup: "[cookie-preload] Ensuring Chrome + channel tabs for ChromeWatcher"
    + "[Chrome] chromeTabLimit=3 — opening 3 of N channel tabs" (máy Mid/Low).
11. Test flip private→public trên kênh có tab: "[ChromeWatcher] NEW VIDEO detected".
12. Log có dòng "[InnertubeDaemon] [probe..." khi HTML probe hoạt động.
```

### Pass 15b — Gate playability PHẢI dùng client ẩn danh + ANDROID (hotfix pass 14)

**Phân tích sâu log 20-08-37 + test thật với bundle youtubei.js 17.0.1 (scratch/test_gate2.js):**

| Client getBasicInfo | Video PUBLIC (control) | Video PRIVATE |
|---|---|---|
| WEB mặc định (pass 14 dùng) | **UNPLAYABLE "Video unavailable"** ← reject NHẦM | UNPLAYABLE / LOGIN_REQUIRED |
| ANDROID / IOS (ẩn danh) | **OK** ✓ | **LOGIN_REQUIRED "This video is private"** ✓ |
| TV / WEB_EMBEDDED | UNPLAYABLE / throws | LOGIN_REQUIRED |

→ Gate pass 14 (WEB client) reject CẢ video public → HTML probe chết hoàn toàn từ patch
17-20-55. Đây là lỗi thứ nhất của phiên test 18:08; lỗi thứ hai là CDP tắt (pass 15).

**Sự thật về flow test flip private→public (xác minh bằng oEmbed + API):**
- Video flip mang **publish time = thời điểm flip** (zMs659GeXZg flip ~10:25, API text
  "1 hour ago" lúc 12:19) — KHÔNG phải ngày upload gốc. API path bắt được flip nếu index
  kịp ≤10p; HTML probe phủ cửa sổ lag index; CW tab bắt tức thời.
- DJLHAneRK5A: private lúc 09:57 (403) → public lúc kiểm tra 12:15 (200) — chính là
  video khách flip trong phiên test 18:08 (11:09 UTC).

**Fix (innertube_helper.js):** gate dùng **client Innertube ẩn danh riêng** (không cookie —
cookie chủ kênh sẽ làm video private của chính họ pass nhầm; yt-dlp tải anonymous nên
gate phải nhìn bằng con mắt anonymous) + `getBasicInfo(id, { client: 'ANDROID' })`.

**INVARIANT #16: verification phải dùng đúng context truy cập của DOWNLOADER (anonymous),
và mọi gate mới phải được test với video ĐỐI CHỨNG public trước khi ship** — gate pass 14
ship mà không có control test nên "reject tất cả" trông y hệt "hoạt động đúng" trong log.

---

## 16. Chrome Monitor xóa pool mỗi 2s — daemon churn (Pass 16, 2026-07-14)

**Log 16-22-08 (sau pass 15, Chrome giờ chạy thường trực trên máy Mid):** pipeline chạy
ĐÚNG (8 video catch-up: 8/8 download + render, ws_id hết trùng, tabLimit=3 áp dụng,
CDP connected) NHƯNG: **728 lần spawn daemon/9 phút** (chuẩn: 14 lúc startup), poll wave
xen kẽ 27→2→27 (97 lần skip in-flight), 62% log là parser noise youtubei.js.

**Chuỗi nhân quả:** thread "Chrome Monitor" (commands.rs, vốn là login-watch) extract
cookie Profile-1 **mỗi 2s suốt đời Chrome** → `set_session_cookie(0,…)` →
`clients.clear()` **vô điều kiện** → toàn bộ daemon warm bị Drop-kill (im lặng, không
log) → wave sau spawn lại 13 client (~0.7s/lần + Innertube.create). Trước pass 15 không
lộ vì máy Mid không launch Chrome; máy High (5080) nhiều khả năng churn từ lâu mà không ai
soi số spawn.

**Fix 3 lớp:**
1. `innertube_pool.rs set_session_cookie/set_cookies`: chỉ `clients.clear()` khi cookie
   **THAY ĐỔI thật** — cookie giống hệt (trường hợp 99.9% của monitor 2s) thì giữ pool.
   Lease vốn đã push cookie hiện hành vào daemon mỗi lần take nên clear là thừa với
   cookie không đổi.
2. Chrome Monitor (2 nhánh): login-watch 2s chỉ tới khi thấy SAPISID; sau đó extract
   1 lần/phút (rotation refresh) — hết hammer DPAPI+SQLite.
3. Helper: `Log.setLevel(Log.Level.NONE)` — tắt parser noise của youtubei.js trên stderr,
   giữ nguyên dlog `[probe]`/`[probe-gate]`.

**INVARIANT #17: thao tác định kỳ KHÔNG được phá tài nguyên warm khi input không đổi**
(cookie y hệt → không clear pool; tab không đổi → không reload). So sánh trước, hành động sau.

**Verify sau deploy:** đếm "Spawning persistent daemon" trong log phiên ≥10 phút — phải
≤ ~20 (startup + lẻ tẻ), KHÔNG tăng theo thời gian; không còn block
"[InnertubeDaemon] [YOUTUBEJS][Parser]"; "[Cookies] Extracted ... pool index 0" xuất hiện
~1 lần/phút khi Chrome mở (không phải 30 lần/phút).

---

## 17. Refresh cookies đúng cách cho download (Pass 17, 2026-07-14)

**Sự cố (log 17-15-13):** video test `7Ruuog3rTUE` detect được ở catch-up (9s sau boot)
nhưng yt-dlp fail "cookies are no longer valid" + "Private video". Chuỗi nguyên nhân:

1. `cookies_netscape.txt` (global, cho yt-dlp) được build lúc boot từ **JSON snapshot**
   của Profile-1 — snapshot chỉ được làm tươi qua CDP khi Chrome chạy; YouTube rotate
   cookie liên tục nên snapshot vài phút tuổi đã bị yt-dlp từ chối.
2. Download catch-up bắn ra 9s sau boot — TRƯỚC khi Chrome/CDP kịp lên (~40-60s).
3. **Lỗ hổng nhánh "Chrome đã chạy sẵn"** (launch_chrome_profile_async): không set
   `ACTIVE_CHROME_PROFILE` (còn clear nó!) → extraction đi vào fast-path JSON stale
   suốt phiên; nhánh Ok còn KHÔNG spawn monitor → không có refresh định kỳ nào.

**Fix:**
- Nhánh "Chrome đã chạy sẵn": set `ACTIVE_CHROME_PROFILE` trước khi extract (→ CDP tươi)
  và spawn Chrome Monitor cho CẢ nhánh Ok lẫn Err (refresh 60s + cleanup khi Chrome đóng).
- **Cookie-refresh retry MỘT LẦN** (commands.rs): download fail với "no longer valid" /
  "Private video" / "sign in" → xóa workspace (giữ seen — chống poller double-detect),
  đợi CDP lên (tối đa 120s, poll 5s), `extract_profile_cookies_and_feed(Profile-1)`
  (CDP tươi → rebuild global cookie files) → re-fire process_fn với published_at=0
  (backfill giờ thật). Dedup bằng `cookie_retry_store` (video_id) — INVARIANT #10 giữ vững:
  fail lần 2 → error bình thường, không loop.
- Bonus nghiệp vụ: cookie owner TƯƠI cho phép yt-dlp tải cả video private/vừa flip của
  chính kênh khách (flow test private→public) — trước đây chết vì snapshot thối.

**Verify sau deploy:** giả lập bằng cách flip video private→public rồi mở app ngay:
lần tải đầu có thể fail cookie → log "refreshing cookies via Chrome CDP and retrying once"
→ "Cookie-refresh retry firing for ..." → download complete. Không còn workspace kẹt
error "cookies no longer valid" khi Chrome đang chạy.

---

## 18. Bỏ hẳn pool-clear khi feed cookie + phân tích "17s" (Pass 18, 2026-07-14)

**Log 17-30-30 (sau pass 17):** 4/4 video download + render OK, 0 error. Cookie-fallback
giờ THÀNH CÔNG (cookie tươi từ CDP — pass 17 chạy đúng). Nhưng 2 vấn đề còn lại:

**A. Churn 60s (di chứng pass 16):** mỗi tick monitor (60s) vẫn kéo theo wave respawn
9-13 daemon sau ~2s. Nguyên nhân: guard "chỉ clear khi cookie ĐỔI" vô hiệu vì YouTube
rotate SIDCC/PSIDTS gần như mỗi phút → so sánh full-string luôn "đổi". Fix: **bỏ hẳn
`clients.clear()`** trong `set_session_cookie`/`set_cookies` — mỗi lease đã push cookie
hiện hành vào daemon (setCookie RPC) nên warm daemon không bao giờ dùng cookie cũ; clear
chỉ có tác dụng phá daemon warm. Kèm **LRU cap 8** cho `clientPromises` trong helper
(chống daemon 24/7 tích nghìn Innertube instance theo cookie rotation).

**B. Ca "17s" của khách (video 08:33:08, 2 video cùng lúc):** KHÔNG có lỗi render —
NVENC chạy 1300-1500fps, cache bg HIT. Đường thời gian video `...983`: detect 08:33:08.98
→ anonymous fail (+2.5s — video vừa flip chưa kịp anonymous-playable, cookie fallback là
ĐÚNG thiết kế) → cookie download 8.5s (2 download SONG SONG chia uplink ~50%) → render
8.7s (2 render chồng nhau) → **e2e 19.7s / "17s" tính từ lúc bắt đầu tải**. Video chạy
SOLO trong cùng log: e2e **12.9s và 13.1s** — chuẩn máy 3060.
→ Thủ phạm chính là **`maxConcurrentDownloads` còn trong settings máy khách** (checklist
mục 9 đã dặn XÓA: queue tuần tự = 1 để video trước xong ở tốc độ tối đa). Không phải bug code.

**Verify sau deploy:** phiên ≥5 phút có Chrome mở — KHÔNG còn wave "Daemon ready" theo
chu kỳ 60s; settings máy khách đã xóa `maxConcurrentDownloads` → log có "waited Xs in
download queue" khi 2 video đến cùng lúc, mỗi download chạy full tốc độ.

---

## 23. So sánh 2 máy cùng video test — cookie tươi quyết định SURFACE (Pass 23, 2026-07-15)

**Thí nghiệm tự nhiên (video EJdYcv9lJbg, YouTube commit ≈06:49:32):**

| | Máy 5060 (MVP f323d33, setup MỚI, clock +3p) | Máy 3060 (bản mới) |
|---|---|---|
| Detect | CW tab 06:52:09 (giờ máy) = **~06:49:09 thật — ±30s quanh lúc public** | Poller API **06:54:51 (+5p19s)** |
| Nguồn detect 3h11' | **6/6 qua ChromeWatcher** | 0 qua CW, tất cả qua poller API |
| Got 0 videos | 1 / 3h11' | 0 (pass 20 OK) |

**Chẩn đoán:** khác biệt KHÔNG nằm ở cấu trúc code MVP — nằm ở **độ tươi cookie quyết
định YouTube trả surface nào**. Máy 5060 setup mới = 30 cookie login THẬT còn tươi →
mọi request là owner-view (video hiện NGAY khi public). Máy 3060 = 29 clone thối +
1 CDP-fresh → đa số request nhận view public-index (trễ nhiều phút). Xem thêm
memory cookie_profile_architecture (30 profile = clone 1 phiên).

**Fix (thay vì port thêm MVP):** HTML probe của poller giờ fetch bằng **probe_cookie
riêng = cookie session-0 (profile-1, CDP-fresh)** — plumbing: poller.rs →
innertube_client.get_latest_videos(probe_cookie) → daemon req.probeCookie →
strategyPlaylistHTML(probeCookie || cookie). Kênh top-fastProbeLimit có owner-view
mỗi chu kỳ 2s, độc lập sức khỏe tab Chrome (tab discard) và cookie clone. Gate
playability (pass 15b) chặn video private của owner-view cho tới khi public (≤20s).

**KHÔNG port thêm gì từ MVP:** per-tab playlist poll của MVP (đã bỏ ở pass 20) không
phải nguồn thắng — cùng API với poller; thắng là ở cookie/máy. Khuyến nghị vận hành
còn lại: đăng nhập THẬT 30 profile trên máy 3060 (hết chết chùm clone).

### Pass 23b — Freshness sync: KHÔNG cần 30 lần đăng nhập

Kiểm chứng trên folder MVP (5080): 16/16 profile có cookie đều chung MỘT SAPISID —
**cả 2 máy đều chạy 1 tài khoản clone, chưa bao giờ có 30 login thật**. Máy nào clone
NGUỒN còn tươi thì mọi surface đều owner-view. Vậy thay vì bắt user đăng nhập 30 lần:

**Auto freshness-sync (commands.rs):** mỗi lần extract Profile-1 (CDP tick 60s + sau
preload boot) → propagate cookie tươi cho MỌI session cùng SAPISID hoặc trống
(session giữ login tài khoản KHÁC không bị đụng — tương lai có login thật vẫn an toàn).
Log: "[Cookies] Synced fresh Profile-1 cookie to N clone/empty sessions".
Kết quả: cả pool 30 session luôn tươi như profile-1 → owner-view TOÀN BỘ kênh
(không chỉ top-3 probe), bằng đúng trạng thái "máy 5060 mới setup" — vĩnh viễn.

UI profile nên hiển thị theo sự thật này: "1 tài khoản (Profile-1) × 30 phiên chia tải,
đồng bộ tươi HH:MM" + nút login thêm tài khoản thật nếu muốn tách danh tính. KHÔNG
hiển thị như 30 tài khoản riêng.

---

## 22. Premiere realtime download + hàng "Chờ chiếu" mồ côi (Pass 22, 2026-07-15)

**Log 14-01-42 (91 phút, máy 3060 bản MVP-port):** sức khỏe ĐẠT — "Got 0 videos"=0
(pass 20 verified), 15 daemon spawns, download thường 7-9s, queue tuần tự chạy. Khách hỏi
2 việc, đều là ca premiere QxqGuFhSk5I:

1. **"Download >5 phút"** = VẬT LÝ premiere, không phải bug: retry chủ động (pass 13b)
   bắn 06:20:04 khi premiere mới phát ~1 phút; premiere phát realtime nên yt-dlp muốn
   section 5 phút đầu phải ĐỢI đủ 5 phút nội dung lên sóng → xong 06:25:09, render 7s ✓.
   Muốn nhanh hơn chỉ có cách giảm defaultTrimLimit hoặc chờ premiere phát xong mới tải
   (trade-off nghiệp vụ, không phải lỗi hiệu năng).
2. **"Công chiếu nhưng không thấy đã download"** = bug UI 2 hàng: hàng ws cũ bị flip
   "scheduled" (pass 12 terminal) rồi ws bị XÓA cho backoff — retry tải dưới ws id MỚI
   → hàng cũ kẹt "Chờ chiếu" vĩnh viễn cạnh hàng mới. Fix: `_remove_scheduled_entry`
   (detection_history_model.py) xóa MỌI hàng cùng videoId có status "scheduled"
   (không chỉ sched-<id>) khi detection thật đến.

Phụ: (a) bỏ `tv_embedded` khỏi default chain — yt-dlp mới của khách in
"Skipping unsupported client" mỗi lần tải (client đã bị upstream xóa) → default
`ios,android,web`; (b) lỗi chứa "premiere" được xếp vào auth_required — không phí
~4s retry anonymous, đi thẳng premiere backoff.

---

## 21. Đối chiếu MVP f323d33 (rtx5080) — port cookies-first + client chain (Pass 21, 2026-07-14)

User copy nguyên bản MVP máy khách (D:\HyperClip-TestCustomer-20260616-224538, gitHead
f323d33 branch rtx5080, log tươi 2026-07-15) yêu cầu "hiệu suất như bản này". Đối chiếu:

| Chỉ số | MVP f323d33 (5080) | Bản hiện tại (3060, sau pass 20) |
|---|---|---|
| Poll cadence | ~3.7-4s | **2.0-2.2s** ✓ |
| Download args | sections ✓, 32 frag (HW), 360p | sections ✓, 16 frag (HW 3060), 360p |
| Auth fail khi tải | **0/10** (cookies-first + ios chain) | mỗi video flip fail anonymous +2.5s |
| Empty-response (throttle) | ~0.05% | 14% (đã fix pass 20, cần verify) |
| Daemon spawns | 13/66min | 16 ✓ (sau pass 16/18) |
| Badge latency | **ẢO** (CW published_at=now → luôn ~0s) | THẬT (player publish time) |
| Render | không dùng trên máy đó | 1300-1500fps NVENC ✓ |

**Kết luận: bản hiện tại đã VƯỢT MVP về cadence/độ sạch pipeline; MVP hơn thật ở 2 điểm
download, đã port:**
1. **cookies-first** (youtube.rs): có cookie file → tải với cookie NGAY (MVP behavior,
   0 auth-fail); retry ẩn danh CHỈ khi lỗi kiểu file-cookie-hỏng/403-context (public bị
   cookie thối đầu độc); lỗi cần-auth (private/age/login) đi thẳng đến cookie-refresh
   retry của pass 17, không phí 2.5s thử anonymous.
2. **Client chain `ios,android,tv_embedded,web`** (default, settings
   `yt_dlp_client_priority` vẫn override): ios-first phục vụ được video vừa đăng/vừa flip
   mà web client còn từ chối. Số đo "-1-2s khi bỏ ios/tv_embedded" trước đây đo với
   tv_embedded ĐỨNG ĐẦU (client fail chắn trước) — ios-first resolve 1 request.

**Cảnh báo đo lường khi khách so 2 bản:** badge "<5s" của MVP là số ảo (§9) — MỌI so sánh
"bản cũ bắt nhanh hơn" phải đối chiếu bằng WALL-CLOCK trong log, không phải badge UI.

---

## 20. Self-rate-limit khi mở 24 tab: YouTube trả playlist RỖNG (Pass 20, 2026-07-14)

**Log 18-10-56 bản FULL (15.7 phút — bản copy đầu bị cắt ở phút 2, kết luận 19b về
"app đóng sớm" là dựa trên bản cắt):** khách flip 2 video zilkay ~18:20-18:25 KST.
Kết quả thật: `F_QKixH4o8c` ĐƯỢC bắt 09:21:35 + tải (cookie fallback) + render xong
09:21:57 ✓. Video còn lại KHÔNG bao giờ xuất hiện. Nguyên nhân hệ thống:

**Từ 09:14 (3 phút sau khi mở 24 tab), 14% response getPlaylist trả RỖNG (1735/12601),
theo ĐỢT (444 lần/phút lúc cao điểm); zilkay bị mù 59 lần.** Phiên trước (3 tab): 0 lần.
Chuỗi nhân quả: CW checker có "Priority 3" tự poll playlist per-tab mỗi 1.5s →
24 tab ≈ 16 req/s CHỒNG lên poller 27 kênh/2s → YouTube rate-limit IP → trả playlist
rỗng 200-OK cho MỌI consumer → poller mù từng đợt → video flip rơi vào đợt mù + text
"X phút trước" trôi qua ngưỡng age 10p → miss vĩnh viễn.

**Fix:**
- Helper: BỎ Priority-3 playlist poll trong `checkChromeChannelTabs` — poller đã poll
  mọi kênh mỗi 2s bằng session pool; CW chỉ giữ nguồn DOM + subscriptions feed
  (giá trị độc nhất của nó). Giảm ~16 req/s.
- Poller: response 0-video = triệu chứng throttle, KHÔNG phải data — không mark_success,
  không tính polled_successfully (OAuth fallback được quyền phủ kênh đó), log rõ
  "treating as throttled/empty response".

**INVARIANT #18: tổng request/giây lên YouTube từ MỘT máy là tài nguyên chung có hạn —
nguồn detect mới phải TRỪ vào ngân sách đó, không cộng chồng.** Đo bằng đếm
"Got 0 videos" trong log: >1% là đang tự bóp cổ mình.

**Verify sau deploy:** phiên ≥15 phút với 24+ tab: grep -c "Got 0 videos" ≈ 0;
video flip được detect ≤ 1 chu kỳ sau khi YouTube index (kể cả kênh ngoài top-3 probe).

---

## 19b. CW Shorts pre-filter + phân tích "2 video zilkay không bắt" (Pass 19b, 2026-07-14)

**Log 18-10-56 (2 phút, 0 error):** khách báo "2 video zilkay mới không quét được + render fail".
Sự thật sau khi đối chiếu playlist thật:

1. Video zilkay #1 (`yeuUvS4XH7w`) = RE-FLIP của video ĐÃ tải+render lúc 08:06 → seen-dedup
   bỏ qua ĐÚNG LUẬT. **Test detection phải dùng video app chưa từng ingest.**
2. Video zilkay #2 (`BHktKMdFD7s`) lên public lúc 09:13:08 — app bị đóng lúc 09:13:05
   (3 GIÂY trước đó). Phiên test lần thứ 3 liên tiếp chỉ dài ~2 phút.
3. "Render fail" = 2 workspace Shorts Hàn (360x640, 8.7s) do CW feed/tab bắt → duration=0
   nên lọt qua filter → TẢI XONG mới bị discard 9:16 → hiện failed trên UI. Không có
   render nào chạy/fail (0 FFmpeg spawn).
4. 166 dòng log lặp "Skipping ... published date unknown" (2 video scheduled kênh khác,
   re-check mỗi 1.5s).

**Fix:** (a) process_fn backfill `duration_sec` từ player cho event CW (vốn =0) + thêm
min-duration check trước download (cạnh max-duration) → Shorts bị chặn TRƯỚC khi tải;
(b) skip-log unknown-date chỉ ghi 1 lần/video.

**Nhắc vận hành:** giữ app mở LIÊN TỤC khi test; video flip lại (đã ingest) không bao giờ
re-detect — đó là chống trùng, không phải lỗi.

---

## 19. chromeTabLimit default 0 — mở tab TOÀN BỘ kênh (Pass 19, 2026-07-14)

Quyết định của operator (2026-07-14): bỏ default 3 tab trên Mid/Low — mở tab CDP cho
**tất cả kênh** trên mọi máy để mọi kênh đều có nguồn detect DOM ~0s. Đây là trade-off
CÓ Ý THỨC với chi phí đã đo trên 3060 (17-07-29: 28 tab → NVENC 54x→24.7x, download
chậm 2.4x). Nếu máy yếu bắt đầu trượt mục tiêu e2e: đặt `chromeTabLimit: 3-5` trong
settings.json (setting vẫn override default). Tab reload floor 30s (pass 12b) giữ nguyên
để hạn chế chi phí duy trì.
