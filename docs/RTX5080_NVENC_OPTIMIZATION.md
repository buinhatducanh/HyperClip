# Hướng dẫn Tối ưu hóa NVENC & Tránh Lag/Chậm trên dòng máy RTX 5080 (Blackwell)

Tài liệu này ghi lại chi tiết kiến trúc render hiện tại của HyperClip và các quy tắc/sai lầm kỹ thuật cần tránh để đảm bảo ứng dụng chạy mượt mà, đạt tốc độ tối qua (~40x realtime) trên cấu hình máy RTX 5080 của khách hàng.

---

## 1. Logic Render & Pipeline Tăng tốc Phần cứng Hiện tại

Pipeline render của HyperClip được tối ưu hóa toàn diện bằng cách tận dụng tối đa sức mạnh của kiến trúc đồ họa NVIDIA Blackwell (RTX 5080):

### A. Nhận diện Phần cứng & Cấu hình Tự động (System Classification)
* **Nhận diện GPU:** Hệ thống kiểm tra qua `nvidia-smi` hoặc Registry/WMI. RTX 5080 được xếp vào phân khúc **`High` tier**.
* **Phân bổ Tài nguyên:**
  * Bộ mã hóa mặc định: `hevc_nvenc` (H.265 tăng tốc phần cứng).
  * Số luồng render đồng thời tối đa lý thuyết: `max_workers = 16`.
  * Số phiên làm việc đồng thời tối đa trên phần cứng: `max_sessions = 14`.

### B. Giải mã Phần cứng & Cắt ghép ở mức Decoder (Decoder-Level Cropping)
* **Sử dụng NVDEC (`cuvid`):** Video đầu vào (H.264, HEVC, VP9, AV1) được giải mã trực tiếp trên GPU thông qua các bộ giải mã tương ứng: `h264_cuvid`, `hevc_cuvid`, `vp9_cuvid`, `av1_cuvid`.
* **Cắt trực tiếp khi giải mã (Decoder Crop):**
  * Với layout Short (9:16), video gốc (16:9) cần được scale và crop.
  * HyperClip tính toán tham số `-crop` và truyền trực tiếp vào bộ giải mã NVDEC. Quá trình cắt frame diễn ra ngay trong luồng giải mã của GPU, giúp **bỏ qua hoàn toàn** việc copy vùng nhớ VRAM thừa và giảm tải cho bộ lọc filter graph.
  * Lệnh FFmpeg sinh ra có dạng: `-c:v hevc_cuvid -crop 0x0x0x0` (tùy theo tính toán kích thước).

### C. Cơ chế Tự động Dự phòng CPU (CPU-Fallback Cropping)
* **Vấn đề:** Một số video có kích thước đặc biệt hoặc tham số crop phức tạp mà NVDEC (`cuvid`) không hỗ trợ giải mã cắt trực tiếp (hoặc gây lỗi crash driver / lỗi hiển thị trên một số phiên bản driver NVIDIA).
* **Giải pháp (`decode_on_cpu`):**
  * Nếu không thể thực hiện crop trực tiếp ở mức decoder (`decoder_cropped == false`) và video yêu cầu cắt biên (`crop_x > 0` hoặc `crop_y > 0`), hệ thống sẽ tự động bật cờ `decode_on_cpu = true`.
  * Khi đó, video được giải mã phần cứng nhưng xuất ra bộ nhớ hệ thống (CPU memory), sau đó thực hiện scale/crop cực nhanh bằng thuật toán tối ưu trên CPU (`scale=...:flags=fast_bilinear`), chuyển đổi định dạng sang `nv12` và tải lại lên GPU bằng `hwupload_cuda` để thực hiện overlay.
  * Cơ chế này giúp ngăn chặn 100% các lỗi treo/crash luồng render của FFmpeg do không tương thích định dạng trên GPU.

### D. Tối ưu hóa Filter Graph qua Pre-Compositing
* **Pre-composite Background:** Trước khi khởi chạy lệnh render chính, toàn bộ các asset tĩnh gồm: ảnh nền mờ (blur background), ảnh bìa đầu (header thumbnail) và thanh thông tin dưới (bottom bar PNG) được gộp trước thành một ảnh duy nhất (`composite_bg.png`).
* **Lợi ích:** FFmpeg chỉ cần load đúng 2 input (video gốc và ảnh nền gộp) thay vì 4 input riêng biệt. Bộ lọc filter phức tạp rút gọn xuống chỉ còn một phép `overlay_cuda` duy nhất trên GPU, giảm thiểu tối đa context switch giữa CPU và GPU.

---

## 2. Các sai lầm kỹ thuật cần tránh để ngăn ngừa Lag và Chậm

Dù RTX 5080 là dòng card đồ họa Blackwell cực kỳ mạnh mẽ, các thiết lập sai lầm dưới đây sẽ khiến hiệu năng suy giảm nghiêm trọng (bị nghẽn cổ chai) hoặc gây lag máy khách:

### ⚠️ Sai lầm 1: Bật chế độ mã hóa nhiều lượt (Multipass Encoding)
* **Mô tả:** Thiết lập `-multipass` thành `1pass` hoặc `2pass` thay vì `disabled`.
* **Hậu quả:** Multipass bắt buộc bộ mã hóa NVENC phải phân tích cấu trúc frame trước khi ghi, làm tăng độ trễ và **giảm 50% tốc độ render**. Khi chạy nhiều luồng đồng thời, multipass sẽ gây hiện tượng nghẽn hàng đợi (encoder queue delay) khiến hệ thống bị khựng.
* **Quy tắc:** Luôn luôn thiết lập `-multipass disabled` trong các tham số của NVENC.

### ⚠️ Sai lầm 2: Sử dụng Preset quá cao không cần thiết (Ví dụ `p7`)
* **Mô tả:** Sử dụng các preset chất lượng cao nhất của NVENC như `p6` hoặc `p7`.
* **Hậu quả:** Ở cấu hình CQ (Constant Quality) là `18` (đã đạt ngưỡng visually lossless - không thể phân biệt bằng mắt thường), sự khác biệt về chất lượng hình ảnh giữa `p1` (nhanh nhất) và `p7` (chậm nhất) là dưới 1%, nhưng `p7` tiêu tốn tài nguyên phần cứng gấp nhiều lần và làm tốc độ tụt từ **~40x xuống còn ~10x-15x**.
* **Quy tắc:** Sử dụng `-preset p1` hoặc `-preset p4` (tối ưu hóa cân bằng tốc độ/chất lượng) cho dòng máy khách.

### ⚠️ Sai lầm 3: Chạy quá nhiều luồng render đồng thời (VRAM Exhaustion)
* **Mô tả:** Tăng số lượng render worker đồng thời vượt quá giới hạn an toàn thực tế (ví dụ chạy 12-16 luồng song song).
* **Hậu quả:**
  * Card RTX 5080 tuy có 16GB VRAM, nhưng mỗi worker FFmpeg sử dụng CUDA và NVENC sẽ tiêu tốn khoảng **~1.5GB VRAM** để khởi tạo context đồ họa và các buffer giải mã/mã hóa.
  * Nếu tổng lượng VRAM tiêu thụ vượt quá 16GB, hệ điều hành sẽ kích hoạt cơ chế chuyển vùng nhớ VRAM tràn sang RAM hệ thống (System Memory Shared). Tốc độ truyền tải qua bus PCIe lúc này sẽ kéo hiệu năng render tụt giảm nghiêm trọng (từ 40x xuống < 1x realtime) và gây giật lag toàn bộ giao diện máy khách.
* **Quy tắc:** Mặc dù hệ thống phát hiện `max_workers = 16` trên RTX 5080, cấu hình thực tế trong ứng dụng nên giới hạn chạy đồng thời từ **6 đến 8 workers** để giữ an toàn cho bộ nhớ VRAM tĩnh và các tác vụ hệ thống khác.

### ⚠️ Sai lầm 4: Giải mã / Mã hóa trên CPU (Software Fallback)
* **Mô tả:** Quên truyền các cờ tăng tốc phần cứng `-hwaccel cuda` hoặc sử dụng codec CPU như `libx264`.
* **Hậu quả:** CPU (cho dù là Core Ultra 9 285K) cũng sẽ bị quá tải 100% khi xử lý video Short dung lượng lớn, làm máy khách cực kỳ nóng và giảm tốc độ xử lý xuống chỉ còn 1x-2x.
* **Quy tắc:** Luôn dùng bộ mã hóa `hevc_nvenc` trên card RTX 5080.

### ⚠️ Sai lầm 5: Thiếu cờ khống chế khung hình `-r` ở Encoder đầu ra
* **Mô tả:** Không chỉ định tham số tốc độ khung hình đầu ra ở encoder (ví dụ thiếu `-r 30`).
* **Hậu quả:** FFmpeg sẽ cố gắng xuất video ở tốc độ khung hình biến đổi (VFR), dẫn đến hiện tượng giật hình (stuttering) khi xem lại trên QML hoặc gây lệch pha nghiêm trọng giữa âm thanh và hình ảnh (Audio/Video Desync) đối với các video dài.
* **Quy tắc:** Luôn đồng bộ hóa `-r 30` (hoặc FPS được cấu hình từ settings) ở cuối lệnh FFmpeg để ép đầu ra là Constant Frame Rate (CFR).

### ⚠️ Sai lầm 6: Áp dụng sai thứ tự bộ lọc tốc độ (setpts vs trim)
* **Mô tả:** Đặt bộ lọc cắt video `trim` trước bộ lọc tốc độ `setpts`.
* **Hậu quả:** Gây lỗi hiển thị khung hình bị đứng (freeze frames) ở cuối video hoặc lệch thời lượng âm thanh so với video.
* **Quy tắc:** Luôn đặt `setpts` nén timestamp trước, sau đó mới đến bộ lọc `trim` cắt theo timeline đã nén, và tính toán chính xác thời lượng đầu ra bằng công thức: `Output Duration = Trim Duration / Speed`.
