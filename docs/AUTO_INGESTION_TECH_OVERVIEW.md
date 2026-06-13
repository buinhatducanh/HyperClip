# Auto-Ingestion Pipeline: Architecture & SLA Achievement Guidelines

Tài liệu này tổng hợp toàn bộ chi tiết về giải pháp công nghệ hiện tại của đường ống phát hiện và nạp video tự động (Auto-Ingestion Pipeline) trong HyperClip sau khi đã được tinh chỉnh thực tế để đạt mục tiêu **phát hiện video mới từ ~100 kênh đăng ký trong vòng < 10 giây E2E (SLA phát hiện < 5 giây)**.

---

## 1. Bản Đồ Thành Phần & Liên Kết Tập Tin

*   **Bộ giám sát tab Chrome (CDP Watcher):** [chrome_watcher.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/chrome_watcher.rs) — Quét tab Chrome qua cổng debug.
*   **Vòng lặp Poller chạy ngầm:** [poller.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/poller.rs) — Điều phối quét song song định kỳ tất cả các kênh qua Innertube và OAuth.
*   **Node.js Daemon Wrapper:** [innertube_client.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/innertube_client.rs) — Quản lý tiến trình Daemon Node.js để trao đổi lệnh JSON-RPC.
*   **Node.js Scraper:** [innertube_helper.js](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/innertube_helper.js) — Thực thi các chiến lược cào dữ liệu YouTube (youtubei.js, RSS, Playlist HTML, CDP evaluate).
*   **Bể chứa Session Client:** [innertube_pool.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/innertube_pool.rs) — Quản lý 30 phiên đăng nhập và cơ chế quay vòng (round-robin).
*   **Bộ nhớ lưu trữ trạng thái:** [store.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/store.rs) — Định nghĩa cấu trúc lưu dữ liệu seen videos ([SeenVideos](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/store.rs#L284)), workspaces, channels, cache.

---

## 2. Nguyên Nhân Gây Trễ (~57 giây) & Giải Pháp Khắc Phục Tức Thời

### A. Nguyên nhân gốc rễ (Root Cause)
1.  **Độ trễ cập nhật RSS XML:** YouTube RSS Feed cập nhật rất chậm, thường trễ từ **20 đến 60 giây** sau khi video được xuất bản (lagging index).
2.  **Playlist HTML trả về `publishedAt = 0`:** Chiến lược cào Playlist HTML (`strategyPlaylistHTML` trong [innertube_helper.js](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/innertube_helper.js)) trả về video ngay lập tức nhưng không chứa thời gian xuất bản chính xác, dẫn đến đặt trường `publishedAt = 0`.
3.  **Lọc độ tuổi Poller bỏ qua video:** Vòng lặp kiểm tra của [Poller](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/poller.rs) sử dụng hàm kiểm tra độ tuổi [is_within_age_limit](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/poller.rs#L133). Hàm này **bỏ qua hoàn toàn** các video có `publishedAt == 0`. Vì vậy, video mới cào được từ Playlist HTML bị loại bỏ, buộc hệ thống phải đợi đến khi RSS XML cập nhật (mất 57 giây) để lấy được timestamp thực tế.

### B. Giải pháp: Instant Playlist HTML Resolver
Để bắt được video từ kênh mới trong **< 10 giây**, cơ chế trộn trong hàm `getLatestVideo` của [innertube_helper.js](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/innertube_helper.js) đã được thiết kế lại:

*   Khi cào qua Playlist HTML, các video mới xuất hiện ở đầu danh sách phát (chưa có trong RSS hay lịch sử cào của YouTube.js) được gán thời gian xuất bản bằng thời gian hiện tại của hệ thống:
    ```javascript
    v.publishedAt = Math.floor(Date.now() / 1000);
    ```
*   Khi đẩy về Rust backend, trường `publishedAt` lúc này khác `0` và tương đương với "vừa mới xuất bản", giúp vượt qua bài kiểm tra thời gian `is_within_age_limit`.
*   **Cơ chế chống lặp:** Bộ lọc trùng lặp của [Poller](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/poller.rs) thông qua `seen_videos.is_seen(&cid, &video.video_id)` sẽ loại bỏ tất cả các video cũ đã được quét từ trước. Chỉ duy nhất video mới xuất bản chưa có trong `seen.json` được lọt qua và đưa vào hàng chờ xử lý ngay lập tức.

---

## 3. Khắc Phục Lặp Download Giữa Chrome Watcher và Poller

### Vấn đề: Trùng lặp sự kiện tải xuống
*   Khi người dùng mở một video trên Chrome, [ChromeTabWatcher](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/chrome_watcher.rs) phát hiện video này qua CDP và đánh dấu là đã xem trong SeenVideos. Tuy nhiên, do URL watch không chứa thông tin ID kênh (`channel_id`), watcher đánh dấu video này dưới kênh trống `""`.
*   Khi [Poller](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/poller.rs) quét kênh thực tế (ví dụ: `ch1779678163236`), lệnh kiểm tra cục bộ `seen_videos.is_seen("ch1779678163236", "video_id")` sẽ trả về `false` (vì video chỉ được lưu dưới kênh `""`), dẫn đến việc tải xuống video một lần nữa.

### Giải pháp: Kiểm tra Seen toàn cục (Global Seen Check)
*   Trong [chrome_watcher.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/chrome_watcher.rs), hàm `check_tabs` sử dụng phương thức [is_any_seen](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/store.rs#L343) thay vì `is_seen`:
    ```rust
    let is_seen = seen_guard.is_any_seen(&video_id);
    ```
*   Phương thức này tìm kiếm sự tồn tại của `video_id` trên **toàn bộ** các khóa kênh trong cơ sở dữ liệu `seen.json`. Điều này ngăn chặn hoàn toàn việc watcher kích hoạt tải lại một video đang/đã được Poller nạp, và ngược lại.

---

## 4. Tối Ưu Hóa Hiệu Năng & Tránh Khóa Tài Nguyên

### A. Persistent Node.js Daemon (JSON-RPC)
*   Thay vì khởi chạy và kết thúc tiến trình Node.js cho mỗi lượt quét (gây lãng phí tài nguyên CPU và trễ đĩa I/O), HyperClip duy trì một tiến trình Node.js chạy ngầm bằng cách truyền cờ `--daemon` tại [innertube_client.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/innertube_client.rs).
*   Giao tiếp giữa Rust và Node.js được thực hiện qua luồng stdin/stdout bằng định dạng JSON-RPC, tối ưu hóa thời gian phản hồi cho mỗi request cào thông tin xuống dưới **< 200ms**.
*   Một luồng đọc ngầm độc lập (`node-daemon-reader`) được tạo trong Rust để giải quyết triệt để lỗi nghẽn bộ đệm đường ống (pipe buffering) trên Windows.

### B. Tiết kiệm Quota OAuth qua Bộ lọc Hoàn Thành Quét
*   Trong [poller.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/poller.rs), danh sách kênh được quét song song qua Innertube Pool.
*   Danh sách `oauth_channels` được lọc để giữ lại những kênh chưa thể quét thành công bằng Innertube:
    ```rust
    oauth_channels.retain(|c| !polled_set.contains(&c.id));
    ```
*   Nếu Innertube hoàn thành việc lấy dữ liệu của kênh thành công, OAuth fallback sẽ không được kích hoạt cho kênh đó, giúp giảm lượng tiêu thụ API Quota của Google xuống mức tối thiểu (gần như bằng 0 trong điều kiện bình thường).

### C. Hoàn trả logic Handle Caching (Reversion)
*   Để giữ sự đơn giản và loại bỏ nguy cơ lưu đè sai ID kênh hoặc gây lag trạng thái đĩa khi khởi động, logic lưu cache handle-to-UC-ID trên bộ nhớ và tệp tin trong [poller.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/poller.rs) và [innertube_client.rs](file:///d:/LOOP_COMPANY/HyperClip/crates/hyperclip_ipc/src/innertube_client.rs) đã được hoàn trả (reverted) về trạng thái cũ.
*   Hệ thống thực hiện phân giải trực tiếp và truy xuất thời gian thực để đảm bảo tính chính xác tuyệt đối.

### D. Tự động mở tab Chrome khi thêm kênh mới (CDP Trigger)
*   **Cơ chế:** Khi người dùng thêm kênh mới qua giao diện UI hoặc nhập tệp (kích hoạt lệnh `channel:add` trong [commands.rs](file:///d:/LOOP_COMPANY/HyperClip/src-tauri/src/commands.rs)), hệ thống tự động gọi [launch_chrome_profile_async](file:///d:/LOOP_COMPANY/HyperClip/src-tauri/src/commands.rs#L1077) cho profile chính (`HyperClip-Profile-1`).
*   **Hành vi:**
    *   Nếu Chrome đã mở sẵn cổng debug 9222: Backend Rust truy vấn danh sách tab `/json` qua CDP, kiểm tra nếu kênh chưa được mở thì gửi lệnh `/json/new?url=...` để mở thêm tab mới cho kênh vừa thêm.
    *   Nếu Chrome chưa chạy: Chrome được khởi chạy mới cùng cổng debug 9222 và tự động tải sẵn toàn bộ các kênh hiện tại (bao gồm cả kênh mới vừa thêm).
*   **Mục đích:** Đảm bảo CDP Watcher có thể quét và nạp tức thời các video mới xuất bản từ kênh vừa được đăng ký mà không có độ trễ.

### E. Đồng nhất các khóa cấu hình (Settings Key Case Alignment)
*   **Vấn đề:** Giao diện QML và file lưu trữ cấu hình `settings.json` sử dụng định dạng **camelCase** (ví dụ: `autoRender`, `autoDownloadEnabled`, `autoRenderFPS`, `autoRenderResolution`, `autoRenderSpeed`). Tuy nhiên, mã nguồn Rust trước đó đã sử dụng sai định dạng **snake_case** khi truy cập cấu hình (như `auto_render`, `auto_download_enabled`, v.v.), dẫn đến việc cấu hình tự động render và bật/tắt tải tự động bị bỏ qua (luôn nhận giá trị mặc định fallback).
*   **Giải pháp:** Toàn bộ các lượt đọc biến cấu hình từ `s_store.settings` trong [commands.rs](file:///d:/LOOP_COMPANY/HyperClip/src-tauri/src/commands.rs) đã được chuẩn hóa đồng nhất về định dạng **camelCase** theo đúng cấu trúc tệp dữ liệu, đảm bảo kích hoạt đúng tính năng tự động render và cấu hình độ phân giải, FPS, tốc độ render mong muốn của người dùng ngay sau khi download hoàn thành.

---

## 5. Điều Kiện Để Đạt Chỉ Tiêu Target SLA (< 10 giây E2E, < 5 giây SLA)

Để hệ thống hoạt động ổn định và đạt được tốc độ bắt video tức thời, môi trường vận hành phải đáp ứng đầy đủ các điều kiện sau:

1.  **Cấu hình Remote Debugging của Chrome:**
    *   Trình duyệt Chrome của người dùng (profile đăng nhập chính) bắt buộc phải được chạy với tham số khởi hành:
        ```bash
        chrome.exe --remote-debugging-port=9222
        ```
2.  **Sử dụng IP Tĩnh `127.0.0.1`:**
    *   Tất cả các điểm kết nối CDP nội bộ trong mã nguồn Rust và Node.js bắt buộc dùng `127.0.0.1` thay cho `localhost` để triệt tiêu độ trễ phân giải DNS (~47 giây) của Windows.
3.  **Bỏ qua Proxy nội bộ (CDP Local Bypass):**
    *   Tiến trình kiểm tra debug port cần cấu hình bypass proxy hệ thống (`no_proxy` và tắt nạp proxy từ biến môi trường) để đảm bảo khi người dùng sử dụng VPN hoặc Proxy để tải video, kết nối cục bộ giữa HyperClip và Chrome không bị ngắt quãng.
4.  **Khoảng thời gian quét (Poll Interval):**
    *   Biến `pollIntervalMs` trong cấu hình `settings.json` phải được cấu hình là `5000` (5 giây) để đảm bảo tần suất kiểm tra hợp lý mà không bị YouTube giới hạn tốc độ (rate limit).
5.  **Tránh khóa cơ sở dữ liệu Cookie Chrome:**
    *   Trước khi khởi động HyperClip, trình duyệt Chrome (nếu không mở remote debugging) cần đóng để tránh khóa file SQLite cookie cơ sở dữ liệu trên Windows, cho phép HyperClip giải mã DPAPI cookie thành công.
