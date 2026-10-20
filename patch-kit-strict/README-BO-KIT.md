# Bộ kit đóng patch "nhịp nghe lời setting" — 29/08

## ⚠️ ĐỌC TRƯỚC: kit này chạy trên MÁY BUILD, không phải máy khách

| | Máy BUILD (máy có source Rust, nhánh `pass-60-61-detect-3s`) | Máy KHÁCH (`C:\Users\Administrator\Desktop\HyperClip`) |
|---|---|---|
| Chạy gì | `apply-source-edits.ps1` (hoặc `git apply`) → `cargo build` → `finish-patch.ps1` | **CHỈ** `apply-patch.ps1` trên zip đã đóng |
| Cần git? | Không — `apply-source-edits.ps1` sửa code không cần git | **Không bao giờ.** Máy khách không có source, không cần git |
| Nhận gì | Bộ kit này | Đúng 1 file: `HyperClip-Patch-<timestamp>.zip` |

**Lỗi bạn vừa gặp**: chạy `git apply` trong `C:\Users\...\Desktop\HyperClip`.
Đó là thư mục **cài đặt** trên máy khách — không có git, không có source, và
`pollIntervalStrict.patch` không dùng ở đó. Máy khách chỉ nhận zip cuối cùng.

**Vì sao lần này phải qua máy build**: fix nằm trong `hyperclip-tauri.exe`.
Các patch trước chỉ sửa QML/JS (file chạy thẳng, giống nhau giữa 2 nhánh) nên
tôi đóng trọn gói được. Exe thì chỉ nhánh build của bạn mới ra đúng bản có
pass 60–121; exe build từ repo GitHub sẽ **hạ cấp máy khách** (đã dính một lần).

---

## Nếu bây giờ chưa đụng được máy build — có cách kéo nhịp về sát setting NGAY

Không cần patch, không cần build: **thêm project GCP vào pool** (máy khách,
trang Lõi quét → GCP POOL). Bản exe hiện tại giãn nhịp theo công thức

```
nhịp_thực_tế_ms = max(setting_ms, giây_tới_reset × units_mỗi_nhịp × 1000 ÷ units_còn_lại)
```

Khi `units_còn_lại` đủ lớn, vế phải tụt xuống dưới setting và `max()` lấy
đúng setting của bạn.

Với 52 kênh sentinel, nhịp yên (chưa ai đăng video) tốn **2 units/nhịp**
(gộp 50 kênh/unit):

| Setting | Cần `units_còn_lại` đầu ngày | Project ĐANG SỐNG (9.500 units/project) |
|---|---|---|
| 2000 ms | ≥ 86.400 | **10** |
| 1000 ms | ≥ 172.800 | **19** |

> **"Đang sống"** là chữ quan trọng: project bị Google chặn trong ngày đóng
> góp **0 unit** (`available()` trả 0 khi `is_blocked()`). Pool thật của khách
> có ~20% key hỏng, nên muốn chắc 2000ms thì thêm dư — khoảng **12–13** thay
> vì đúng 10. Với 2/10 project chết: còn 76.000 units → nhịp 2.274ms, vẫn
> chậm hơn setting.

**Cách này KHÔNG bằng bản patch ở 2 chỗ** (đo bằng mốc 10 project = 95.000 units,
setting 2000ms):

| Loại nhịp | units/nhịp | Quota route | Bản patch |
|---|---|---|---|
| Nhịp yên | 2 | **2000ms** ✔ | 2000ms |
| Nhịp ngay sau khi bắt được video (đua/chase) | 5 | **~4.5s** ✘ | 2000ms |
| ~3 nhịp đầu sau khi mở app (soi 25 kênh/nhịp lập baseline) | 27 | **~24.6s** ✘ | 2000ms |

Muốn nhịp chase cũng đúng 2000ms thì cần ~23 project; nhịp bootstrap thì
không thực tế (cần >100). Bản patch trả thẳng `setting` nên không dính cả
hai. Bù lại quota route **hết units thì tự giãn**, còn bản patch **ép chạy
rồi chấp nhận cạn quota** — đúng ý "hết quotas tôi tự chịu".

---

## Trong kit có gì

| File | Vai trò | Chạy ở đâu |
|------|---------|------------|
| `apply-source-edits.ps1` + `fragments/` | Sửa 2 file Rust **không cần git** | Máy build |
| `pollIntervalStrict.patch` | Cách khác, cho ai quen `git apply` | Máy build |
| `finish-patch.ps1` | Nhét exe vào, tính sha256 manifest, đóng zip | Máy build |
| `apply-patch.ps1` | Applier bản 0957 (tự nằm trong zip đầu ra) | Máy khách |
| `app/_internal/resources/tiktok_helper.js` | Bản fixall 28/08 — giữ để không ghi đè ngược fix 2 cửa sổ | (đi theo zip) |
| `app/_internal/qml/PollerPanel.qml` | Bản fixall 28/08 — cột phát hiện chỉ hiện số app | (đi theo zip) |

---

## Máy BUILD — 3 lệnh

```powershell
# 0. Giải nén kit này ra một thư mục bất kỳ, cd vào đó.

# 1. Sửa code (KHÔNG cần git). Trỏ -RepoRoot vào gốc repo source của bạn:
powershell -ExecutionPolicy Bypass -File apply-source-edits.ps1 -RepoRoot C:\path\den\repo-hyperclip
#    Thử trước mà không ghi gì:  ... -RepoRoot C:\... -CheckOnly
#    Quen git hơn thì thay bằng: git apply pollIntervalStrict.patch  (trong repo; thêm -p2 nếu repo không có thư mục source/ bọc ngoài)

# 2. Build exe (trong repo)
cargo build --release --bin hyperclip-tauri

# 3. Đóng patch (quay lại thư mục kit)
powershell -ExecutionPolicy Bypass -File finish-patch.ps1 -ExePath C:\path\den\repo-hyperclip\target\release\hyperclip-tauri.exe -GitHead abc1234
```

`apply-source-edits.ps1` an toàn theo thiết kế: mỗi mốc neo phải khớp **đúng
một lần**, tính toàn bộ trong bộ nhớ trước, chỉ ghi khi cả 6 chỗ đều khớp;
backup **cả hai** file trước khi ghi file đầu tiên, và nếu file thứ hai ghi
hỏng thì tự rollback file đầu. Chạy lại lần hai tự nhận ra "đã áp rồi"; gặp
cây **nửa vời** (một file đã vá, file kia chưa) thì dừng và báo rõ — trường
hợp này nguy hiểm vì code vẫn compile nhưng app không đọc setting. Nếu nhánh
của bạn đã sửa đúng vùng neo, nó dừng và chỉ rõ cần sửa tay ở fragment nào.

Giữ nguyên kiểu xuống dòng (CRLF hay LF) và mã hoá UTF-8 không BOM của file
gốc — đã kiểm bằng cách áp lên cây source thật ở cả hai kiểu rồi `cargo check`.

`finish-patch.ps1` **tự từ chối nếu exe chưa chứa fix** (soi marker
`pollIntervalStrict` trong binary) — không sợ đóng nhầm exe cũ. Đầu ra:
`HyperClip-Patch-<timestamp>.zip` ngay trong thư mục kit.

## Máy KHÁCH — như mọi khi

1. Chép **mỗi** file `HyperClip-Patch-<timestamp>.zip` vào `C:\Users\Administrator\Desktop\HyperClip\`.
2. Thoát app hẳn (cả icon khay hệ thống).
3. `powershell -ExecutionPolicy Bypass -File apply-patch.ps1`
   (tự backup `app/` cũ, verify sha256, hỏng thì tự rollback).
   → `apply-patch.ps1` đã nằm sẵn ở thư mục cài từ các lần patch trước. Nếu
   không thấy, giải nén zip lấy file đó ra thư mục cài rồi chạy — bản trong
   zip và bản cũ giống hệt nhau.
4. Mở app, soi log:
   - Boot: `[Poller] pollIntervalStrict=true — nhịp chạy ĐÚNG pollIntervalMs trong settings (mặc định; quota cạn hẳn vẫn lùi 5 phút/nhịp)`
   - Nhịp quét cách nhau đúng setting ±10% (2000ms → 1.8–2.2s). Thỉnh thoảng
     thấy khoảng cách gấp đôi (4s) là **bình thường**: nhịp trước chưa xong
     thì nhịp này bị bỏ (`Nhịp trước chưa xong — bỏ nhịp này`), thường do một
     lượt gọi HTTP chậm. Chỉ lo khi khoảng cách *đều đặn* lớn hơn setting.
   - Khi đà tiêu vượt ngân sách, 10 phút/lần: `[Poller] pollIntervalStrict: chạy …ms theo setting (quota muốn giãn …ms) — đà này còn … units, dự kiến CẠN ~HH:MM UTC…` → đồng hồ đếm ngược để chủ động thêm project.

Không cần sửa settings.json — mặc định mới là nghe setting. Muốn quay lại chế
độ tự giãn theo quota: thêm `"pollIntervalStrict": false`.

Sàn cứng 1000ms: đặt 2000 chạy 2000, đặt 500 vẫn chạy 1000.
Quota reset theo ngày Pacific ≈ **15:00 giờ VN**.

## Muốn dứt điểm trong 1 lần build

Nhân tiện port luôn mục 1 + 2 của `FIXES-pass-60-61.md` (kẹp
`cửa_sổ_app ≤ raw`; `kill_account_chrome` đợi process chết thật) và chép 2
file trong `app/_internal/` của kit này vào NGUỒN nhánh build
(`crates/hyperclip_ipc/src/tiktok_helper.js`, `resources/tiktok_helper.js`,
QML nguồn `PollerPanel.qml`) — để các bản build sau không cần kit giữ hộ nữa.
