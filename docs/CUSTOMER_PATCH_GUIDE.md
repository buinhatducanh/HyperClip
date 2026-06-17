# HƯỚNG DẪN CẬP NHẬT BẢN VÁ & SỬA LỖI (PATCH GUIDE)

Tài liệu này hướng dẫn cách áp dụng bản vá lỗi (patch) cho khách hàng và giải thích cơ chế sửa đổi các lỗi liên quan đến đường dẫn lưu trữ, hiển thị giao diện tách phân đoạn (SplitModal), tự động render, và tối ưu giao diện hộp thoại xác nhận ở trang chính.

---

## 1. Các Lỗi Được Khắc Phục Trong Bản Vá

### Lỗi 1: Click link mở thư mục tải/render bị dẫn về "OneDrive\Tài liệu"
*   **Nguyên nhân:** Đường dẫn được truyền từ QML có thể chứa ký tự đặc biệt, dấu tiếng Việt (ví dụ: `Tài liệu`), dấu gạch chéo ngược hoặc bắt đầu bằng định dạng URI `file:///`. Khi kiểm tra sự tồn tại của thư mục trong mã Rust bị thất bại, chương trình gọi `explorer.exe` hệ thống với tham số lỗi, dẫn đến việc Windows tự động điều hướng về thư mục mặc định `Documents` (ở máy khách là `OneDrive\Tài liệu`).
*   **Khắc phục:**
    *   Tự động giải mã ký tự đặc biệt (URL decode) và lọc bỏ tiền tố `file:///` hoặc `file://`.
    *   Đồng nhất tất cả dấu gạch chéo về dạng backslash (`\`) trên Windows.
    *   **Tự động khởi tạo thư mục:** Nếu thư mục tải về hoặc thư mục output chưa tồn tại trên ổ đĩa, hệ thống sẽ tự động tạo mới thư mục đó trước khi mở Explorer. Điều này đảm bảo thư mục luôn tồn tại và mở đúng vị trí.

### Lỗi 2: Tách video không hiển thị đủ ô nhập tiêu đề (Title)
*   **Nguyên nhân:** 
    *   Mảng tiêu đề trong QML (`titleInputs`) khi mở modal bị gán trực tiếp theo chỉ mục dạng `titleInputs[i] = ...`. Cách gán này không kích hoạt tín hiệu thay đổi thuộc tính (property notify signal) của QML, khiến danh sách ô nhập liệu không hiển thị đúng tiêu đề mặc định.
    *   Sự kiện chuyển đổi Radio Button (`onToggled`) bị kích hoạt sai thời điểm lúc khởi tạo giao diện làm giá trị mặc định của số phần tách bị đẩy ngược về `1`.
*   **Khắc phục:**
    *   Gán mới hoàn toàn đối tượng mảng (`titleInputs = arr`) để kích hoạt cập nhật giao diện reactive trong QML.
    *   Đổi sự kiện của Radio Button từ `onToggled` sang `onClicked` để chỉ phản hồi khi người dùng click chuột thực tế.

### Lỗi 3: Render video tự động/tách phần bị sai tên file & giữ nguyên tiêu đề gốc YouTube
*   **Nguyên nhân:** Khi gọi lệnh tách video (`workspace:split`), hệ thống thực hiện tác vụ render bất đồng bộ ngay lập tức trước khi lưu danh sách phân đoạn mới xuống đĩa. Hàm dựng đường dẫn output (`build_render_path`) khi đọc file `workspaces.json` không tìm thấy ID của phân đoạn mới nên đã tự động lấy tên video YouTube gốc làm tên file.
*   **Khắc phục:**
    *   Thực hiện lưu trạng thái phân đoạn mới xuống tệp tin (`store.save()`) **trước** khi kích hoạt tác vụ render.
    *   Đặt tên phân đoạn trực tiếp bằng tiêu đề tùy chỉnh (custom title) do người dùng nhập vào.
    *   Cập nhật trạng thái hiển thị của phân đoạn đang tự động render thành `"rendering"` để hiển thị tiến độ trực quan trên giao diện.

### Lỗi 4: Lỗi tính toán sai tốc độ/thời lượng video CUDA (Video 8 phút render 1.2x bị rút ngắn còn 4:55)
*   **Nguyên nhân:** Trong hàm xử lý render bằng card đồ họa NVIDIA CUDA (`build_landscape_filter_cuda`), thời lượng cắt video (`trim_duration`) bị nhân tỉ lệ nghịch với tốc độ video (`trim_duration / speed`) trước khi đưa vào bộ lọc cắt. Sau đó, bộ lọc tăng tốc độ video (`setpts`) lại tiếp tục tăng tốc một lần nữa, dẫn đến việc video bị **tăng tốc và rút ngắn 2 lần liên tiếp** (double-scaling).
*   **Khắc phục:** Loại bỏ phép nhân tỉ lệ tốc độ ở bước cắt video, sử dụng thời lượng gốc tương tự như phiên bản CPU và Short. Video sẽ được cắt đúng độ dài và chỉ tăng tốc 1 lần duy nhất bằng bộ lọc `setpts`.

---

## 2. Cách Sử Dụng Tiêu Đề Động Cho Phân Đoạn Tách Tự Động

Trong cài đặt **TỰ ĐỘNG RENDER**, khi bạn cài đặt chế độ tự động tách video (ví dụ tách làm 3 phần) sau khi tải xong, hệ thống chỉ cung cấp 1 ô nhập liệu duy nhất là **"Mẫu tiêu đề" (Title template)**. 

Để cả 3 phân đoạn tải về có tên file và tiêu đề riêng biệt không bị ghi đè lên nhau, hệ thống hỗ trợ các từ khóa động (placeholders) trong mẫu tiêu đề:
*   `{title}`: Tiêu đề video (Ví dụ: `Video Gốc (Part 1)`).
*   `{channel}`: Tên kênh đăng tải video.
*   `{video_id}`: Mã ID video trên YouTube.
*   `{part}`: **(Mới bổ sung)** Mã số phân đoạn (ví dụ: `1`, `2`, `3`).

**Gợi ý cấu hình Mẫu tiêu đề:**
1.  **Cách đơn giản nhất (Khuyên dùng):** Điền vào ô mẫu tiêu đề là `{title}`. Khi tách 3 phần, hệ thống tự động sinh tên file là:
    *   `Tên Video Gốc (Part 1).mp4`
    *   `Tên Video Gốc (Part 2).mp4`
    *   `Tên Video Gốc (Part 3).mp4`
2.  **Đặt tên riêng cố định kèm số phần:** Điền vào ô mẫu tiêu đề là `Review Phim Tập - {part}`. Tên file sinh ra sẽ là:
    *   `Review Phim Tập - 1.mp4`
    *   `Review Phim Tập - 2.mp4`
    *   `Review Phim Tập - 3.mp4`

---

## 3. Hướng Dẫn Áp Dụng Bản Vá (Cho Khách Hàng)

### Bước 1: Chuẩn bị tệp tin bản vá
*   Tải về tệp tin ZIP bản vá mới nhất: `HyperClip-Patch-20260617-055156.zip` (hoặc phiên bản tương đương).

### Bước 2: Tắt ứng dụng HyperClip đang chạy
*   Đóng giao diện ứng dụng.
*   Đảm bảo không còn tiến trình chạy ngầm bằng cách kiểm tra Task Manager (hoặc chạy lệnh tắt các tiến trình `HyperClip.exe` và `hyperclip-tauri.exe`).

### Bước 3: Giải nén đè vào thư mục gốc của ứng dụng
*   Mở thư mục cài đặt gốc của HyperClip trên máy tính của bạn (nơi có chứa file chạy chính `HyperClip.exe` và thư mục `app/`).
*   Giải nén trực tiếp tệp tin ZIP bản vá đè vào thư mục này. 
*   **Xác nhận ghi đè tất cả (Replace all files)** nếu Windows hiển thị hộp thoại cảnh báo trùng lặp tệp tin.

### Cấu trúc thư mục chuẩn sau khi giải nén đè:
```text
Thư mục gốc của khách hàng/
├── HyperClip.exe               <-- (Mới - Rust launcher, khởi động độc lập không phụ thuộc Python DLL)
└── app/
    ├── HyperClip.exe           <-- (Mới - File chạy Python thực tế)
    └── _internal/
        ├── python314.dll       <-- (Mới - File thư viện Python 3.14)
        ├── hyperclip-tauri.exe <-- (Mới - File backend Rust cập nhật)
        ├── qml/                <-- (Mới - Thư mục giao diện QML cập nhật)
        └── resources/
            └── innertube_helper.js
```

### Bước 4: Khởi động và kiểm tra
*   Kích đúp vào file `HyperClip.exe` ở thư mục gốc để khởi động ứng dụng.
*   Kiểm tra chức năng mở thư mục, tách phân đoạn và tốc độ render để xác nhận lỗi đã được khắc phục hoàn toàn.
