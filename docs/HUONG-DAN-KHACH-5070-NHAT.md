# HyperClip — Hướng dẫn cài đặt (máy RTX 5070, Nhật Bản)

> Bản này đã được cấu hình sẵn cho **máy RTX 5070 12GB đặt tại Nhật**.
> Kênh, danh sách video đã thấy và API key đều có sẵn — cài xong là chạy được ngay.

---

## 1. Cần chuẩn bị

| Mục | Yêu cầu |
|---|---|
| Windows | 10 (build 19041+) hoặc 11, 64-bit |
| GPU | NVIDIA RTX 5070 |
| **Driver NVIDIA** | **572.16 trở lên** — bắt buộc, NVENC đời Blackwell cần bản này |
| RAM | 32 GB (tối thiểu 16 GB) |
| Ổ cứng | 50 GB trống trở lên |
| Google Chrome | Bắt buộc — dùng để đăng nhập YouTube và đăng TikTok |
| Visual C++ 2015–2022 x64 | Thường Windows đã có sẵn |

Kiểm tra driver: mở **Command Prompt**, gõ `nvidia-smi`, xem cột `Driver Version`.

---

## 2. Cài đặt

1. Tải file `HyperClip-rtx5070-jp-<ngày>.zip` từ Drive.

2. **Kiểm tra file tải về có đủ không** (Drive hay tải thiếu với file lớn). Mở Command Prompt tại thư mục chứa file:
   ```
   certutil -hashfile HyperClip-rtx5070-jp-<ngày>.zip SHA256
   ```
   So chuỗi in ra với nội dung file `.zip.sha256` gửi kèm. Khác nhau → tải lại.

   > Nếu nhận nhiều mảnh `.zip.001`, `.zip.002`… thì ghép trước:
   > `copy /b file.zip.001+file.zip.002+file.zip.003 file.zip`

3. **Giải nén** ra một thư mục bất kỳ (đừng chạy thẳng trong file zip).

4. Vào thư mục `installer`, **chuột phải** vào `CAI-DAT.bat` → **Run as administrator**.

5. Làm theo hướng dẫn trên màn hình. Trình cài sẽ:
   - kiểm tra máy và báo rõ thiếu gì
   - chép app vào `C:\HyperClip`
   - **đo card và RAM thật rồi ghi đúng cấu hình hiệu năng cho máy này**
   - chỉnh Windows (power plan, GPU scheduling, tắt Game DVR)
   - tạo shortcut ngoài Desktop

6. **Khởi động lại máy một lần** — GPU Scheduling chỉ có hiệu lực sau khi restart.

7. Bấm shortcut **HyperClip** ngoài Desktop.

### Cài vào ổ khác

```
CAI-DAT.bat -InstallDir D:\HyperClip
```

### Cho app tự chạy cùng Windows (máy chạy 24/7)

```
CAI-DAT.bat -Autostart
```

---

## 3. Việc bạn phải tự làm sau khi cài

### Đăng nhập YouTube bằng Chrome

Đây là việc **không thể làm sẵn từ xa**. Cookie Chrome được Windows mã hoá gắn với tài khoản Windows của từng máy (DPAPI), nên cookie chép từ máy khác sang sẽ không giải mã được.

1. Mở HyperClip
2. Ở bước 1 của wizard, bấm **"Open Chrome to login"**
3. Đăng nhập tài khoản Google/YouTube trong cửa sổ Chrome vừa mở
4. Quay lại HyperClip, bấm **"Refresh sessions"**

> **Đóng hẳn Chrome trước khi chạy HyperClip.** Chrome đang mở sẽ khoá file cookie, app không đọc được.

---

## 4. ⚠️ Giờ giấc — điều quan trọng nhất với máy đặt ở Nhật

Ứng dụng **không đọc đồng hồ Windows** cho phần nghiệp vụ. Mọi mốc thời gian đều tính từ UTC với độ lệch cố định trong code. Cụ thể:

| Việc | App tính theo | Quy ra giờ Nhật (JST) |
|---|---|---|
| Khung giờ quét của kênh | **Giờ Việt Nam, UTC+7** | **cộng thêm 2 tiếng** |
| Reset quota API hằng ngày | 0h giờ Pacific (UTC-8) | **17:00 JST** |
| Reset bộ đếm "kênh này đã bắt đủ hôm nay" | 0h giờ Việt Nam (UTC+7) | **02:00 JST** |

**Nghĩa là gì:** nếu bạn đặt khung giờ quét một kênh là `18:00`–`23:00`, kênh đó thực tế sẽ quét từ **20:00 đến 01:00 giờ Nhật**.

👉 **Muốn theo giờ Nhật thì nhập số nhỏ hơn 2 tiếng.** Ví dụ muốn quét 20:00–01:00 giờ Nhật → nhập `18:00`–`23:00`.

> Bộ kênh gửi kèm đang **để trống khung giờ** — tức là quét cả ngày, không bị ảnh hưởng bởi điều trên. Chỉ khi nào bạn tự đặt khung giờ mới cần lưu ý.

Nên đặt múi giờ Windows là **Tokyo (UTC+9)** để log dễ đối chiếu. Việc này không ảnh hưởng gì tới logic quét.

---

## 5. Test hiệu năng máy

Bộ kênh gửi kèm có **54 kênh, nhưng 42 kênh đang tắt** (`pollPolicy: off` — không quét, không tốn quota). Chỉ 12 kênh thực sự chạy, nên máy sẽ rất nhàn rỗi và **không phản ánh đúng khả năng của card 5070**.

Muốn tạo tải thật:

1. Vào thư mục `installer`
2. Bấm đúp **`BAT-CHE-DO-TEST.bat`** → bật cả 54 kênh
3. Chạy app, theo dõi mục **Lõi quét** và **Hàng đợi render**
4. Test xong, bấm đúp **`TAT-CHE-DO-TEST.bat`** → trả lại đúng cấu hình cũ

> Cấu hình gốc của từng kênh được lưu lại trước khi đổi, nên bật/tắt bao nhiêu lần cũng không mất cài đặt.

Muốn tải nặng hơn nữa: vào **Cài đặt** bật **Auto-render** (mặc định đang tắt).

### Cần nhìn gì để biết máy chạy tốt

| Chỗ xem | Số mong đợi trên RTX 5070 |
|---|---|
| Encoder trong log render | `hevc_nvenc` (nếu ra `h264_nvenc` là đang chạy sai tier) |
| Tốc độ render | trên 800 fps cho khung 1080×1920 |
| Số luồng render song song | 2 |
| VRAM lúc render | dưới 6 GB / 12 GB |
| Độ trễ phát hiện video mới | dưới 3 giây |

Log nằm ở `C:\HyperClip\HyperClip-Data\logs\`.

---

## 6. Cấu hình hiệu năng đã đặt sẵn

Trình cài đã ghi các giá trị sau. Muốn đổi thì sửa **Cài đặt** trong app, hoặc sửa file `installer\machine-profile.json` rồi chạy lại `Apply-MachineProfile.ps1`.

| Cấu hình | Giá trị | Lý do |
|---|---|---|
| `hardwareProfile.vramGB` | **12** (đo thật) | **Quan trọng nhất.** Bản cũ ghi `6`, làm app tụt xuống tier thấp và đổi sang H.264 — chính là nguyên nhân "giật lag". Để 12 thì app dùng HEVC. |
| `hardwareProfile.ramGB` | RAM thật | Khai thấp hơn thực tế sẽ bị chặn bớt số luồng render |
| `maxConcurrentRenders` | **2** | RTX 5070 chỉ có **một** chip NVENC. Luồng thứ 2 lấp phần lọc/âm thanh/ghép file trong lúc luồng 1 đang encode. Từ 3 trở lên chỉ chia nhỏ cùng một encoder |
| `maxConcurrentDownloads` | **1** | Tải song song thì mỗi video chỉ được 1/N tốc độ, và **mọi** video đều xong muộn hơn so với tải lần lượt |
| `parallelChunkRender` | **tắt** | Chỉ có lãi trên card 2 chip NVENC (5080 / 5070 Ti). Bật trên 5070 sẽ làm render **chậm đi** |
| `pollIntervalMs` | 2000 | Nhịp mong muốn. App tự giãn ra khi quota sắp hết |
| `autoRenderResolution` | **1080p** | Nâng từ 720p — trần bitrate 12M thay vì 6M. Card 5070 thừa sức |
| `autoDownloadQuality` | **720** | Nâng từ 360p. Tải 360p rồi phóng lên khung 1080×1920 nhìn rất vỡ |
| `autoRender` | tắt | Bật trong Cài đặt sau khi xem thử vài video ra đúng ý |

---

## 7. Tuỳ chọn: loại trừ Windows Defender

Defender quét từng file `.mp4` ngay khi render vừa ghi xong. Đây là một nút cổ chai có thật với máy render liên tục.

Đây là thay đổi **về bảo mật máy** nên trình cài **cố ý không tự làm** — bạn tự quyết định:

1. Mở **Windows Security** → **Virus & threat protection**
2. **Manage settings** → kéo xuống **Exclusions** → **Add or remove exclusions**
3. **Add an exclusion** → **Folder** → chọn `C:\HyperClip`

Bỏ loại trừ lúc nào cũng được, ở đúng màn hình đó.

---

## 8. Khi có sự cố

### Bước đầu tiên, luôn luôn

Vào thư mục `installer`, bấm đúp **`KIEM-TRA-MAY.bat`**. Nó in ra bảng PASS/WARN/FAIL cho từng hạng mục. Chụp màn hình gửi kỹ thuật.

### App không mở được

Bấm đúp `HyperClip-Debug.bat` ở thư mục gốc — app chạy trong cửa sổ đen và in lỗi trực tiếp.

### Render ra `h264_nvenc` thay vì `hevc_nvenc`

Nghĩa là `hardwareProfile.vramGB` đang bị đặt thấp. Chạy lại:
```
powershell -ExecutionPolicy Bypass -File "C:\HyperClip\installer\Apply-MachineProfile.ps1"
```

### Render chậm bất thường / máy giật

Kiểm tra theo thứ tự:
1. `parallelChunkRender` phải là `false`
2. `maxConcurrentRenders` không được quá 2
3. Game Bar đã tắt chưa (trình cài đã tắt, nhưng Windows Update có thể bật lại)
4. Driver NVIDIA ≥ 572.16

### "No sessions ready"

Chrome đang mở. Đóng hẳn Chrome (kiểm tra cả khay hệ thống), rồi bấm **Refresh all sessions**.

### Hết quota API

98 project × 10.000 = **980.000 units/ngày**. Nếu vẫn hết thì nhịp quét đang quá dày hoặc quá nhiều kênh bật `fastProbe`. Quota tự reset **17:00 giờ Nhật**.

---

## 9. Gỡ cài đặt

Vào `installer`, chuột phải **`GO-CAI-DAT.bat`** → **Run as administrator**.

Mặc định **giữ lại** toàn bộ dữ liệu (video, cookie, lịch sử) và trả các thiết lập Windows về như cũ. Muốn xoá sạch dữ liệu thì thêm `-RemoveData` — script sẽ hỏi xác nhận một lần nữa.
