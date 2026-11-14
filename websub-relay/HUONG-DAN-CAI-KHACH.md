# CÀI RELAY WEBSUB TRÊN MÁY KHÁCH 5080 — runbook UltraViewer (21/08/2026)

Mục tiêu: badge bắt video ~3s → ~1–1,5s (chuông WebSub kêu trước index API ~2,5s).

**MỌI THỨ CLOUDFLARE ĐÃ LÀM XONG TỪ MÁY DEV (21/08, đã test end-to-end):**
- Domain `hyperclip.id.vn` active trên Cloudflare, NS đã lan.
- Tunnel `hyperclip-websub` (UUID 3d38f067-9724-435a-9c94-c0d9aea6c915) đã tạo;
  credentials `.json` NẰM TRONG GÓI NÀY; CNAME `relay.hyperclip.id.vn` đã route.
- Đã chạy thử thật: `/health` trả `"ok": true` qua tunnel; hub YouTube xác minh
  subscription trong 5s (`verified=1`). Không cần đụng dashboard Cloudflare.

**Máy khách KHÔNG cần đăng nhập Cloudflare, KHÔNG cần cài Node** (run-relay tự
dùng node.exe bundled của app). Chỉ 3 bước:

## Bước 1 — chép gói
Chép NGUYÊN thư mục gói này sang máy khách thành:
    D:\HyperClip\websub-relay
(đường dẫn phải đúng y vậy — yml đã trỏ credentials theo đường dẫn này)

## Bước 2 — chạy + cài bền (PowerShell, cd D:\HyperClip\websub-relay)
Chạy thử trước (2 cửa sổ, nhìn cho yên tâm):
    Cửa sổ 1:  .\cloudflared.exe --config .\cloudflared-named.yml tunnel run
               -> "Registered tunnel connection" x2-4 là thông
    Cửa sổ 2:  powershell -ExecutionPolicy Bypass -File .\run-relay.ps1
               -> "Starting relay on port 8787..."
Kiểm (máy nào cũng được — token nằm trong relay.env):
    curl.exe -s https://relay.hyperclip.id.vn/health -H "Authorization: Bearer <WEBSUB_TOKEN trong relay.env>"
    -> JSON "ok": true

Cài bền (rồi TẮT 2 cửa sổ thử ở trên đi):
    .\cloudflared.exe --config D:\HyperClip\websub-relay\cloudflared-named.yml service install
Task Scheduler: task "At startup", action =
    powershell -ExecutionPolicy Bypass -File D:\HyperClip\websub-relay\run-relay.ps1
với "Run whether user is logged on or not" (run-relay tự restart node khi sập).

## Bước 3 — trỏ app vào relay
Mở D:\HyperClip\HyperClip-TestCustomer-20260616-224538\HyperClip-Data\.hyperclip\settings.json
thêm 2 dòng trong `settings-them-2-dong.txt` (token đã điền sẵn, domain đã điền
sẵn — copy nguyên văn). Khởi động lại app.

## Xác nhận (log app: HyperClip-Data\logs\hyperclip.log)
- HẾT dòng "[WebSub] Chưa cấu hình websubRelayUrl..." — thay bằng log nối SSE.
- App tự POST ~50 kênh lên /subscribe lúc nối + mỗi 6h (không curl tay).
- Video mới: dòng "[Detect] ... src=websub", badge ~1–1,5s.
- Định kỳ: curl /health — nhìn `neverPinged` (kênh subscribe mà nhiều ngày
  không ping trong khi kênh CÓ đăng = subscription chết âm thầm — chế độ hỏng
  nguy hiểm nhất của WebSub, không tự báo).

## Lằn ranh / lưu ý
- Relay + tunnel chạy DUY NHẤT trên máy khách. Máy dev đã TẮT bản chạy thử —
  đừng bật song song hai nơi (Cloudflare sẽ chia request giữa hai bên, SSE loạn).
- WebSub là CHUÔNG THỨ HAI — vòng quét API vẫn là lưới bảo đảm (INVARIANT #30).
- KHÔNG sửa relay.env: WEBSUB_HUB_SECRET đổi là mọi subscription cũ vô hiệu.
- File `3d38f067-....json` là credentials tunnel — giữ kín như mật khẩu.
