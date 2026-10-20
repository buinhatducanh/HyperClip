======================================================================
  BAN VA CHINH XAC CHO HYPERCLIP (VIDEO DAI) - BUILD 20260925-093250
  (Luu y: Day la ban va HyperClip, KHONG phai ban va HyperShort)
======================================================================

CAC NANG CAP & FIX LOI CHINH TRONG BAN VA NAY:
0. PASS 156 - TICH HOP TAI XOAY VONG NGAU NHIEN THOI LUONG CAT (CHONG SPAM BOT):
   - Bo sung tuy chon "Xoay vong ngau nhien thoi luong tai (Min - Max)" tren giao dien CAI DAT / TAI XUONG.
   - Cho phep nguoi dung dat 2 moc: Tu A phut den B phut (vi du: 4 phut den 5 phut).
   - Khi tai video, he thong tu dong sinh ngau nhien thoi luong chinh xac theo giay giua 2 moc (vi du: 4p12s, 4p45s, 4p28s...) cho tung video.
   - Ho tro dong bo ca duong tai toc do cao Native-first (limit_sec) lan duong fallback yt-dlp (--download-sections).
   - Chuyen dung de chong bot quet fingerprint, tranh trung lap do dai va chong danh dau spam video tren TikTok / YouTube.

0b. PASS 155 - FIX TRIET DE LOI GAN PROXY (HOT RELOAD & DO LATENCY):
   - Tu dong chuan hoa moi dinh dang proxy nguoi dung nhap: host:port:user:pass, URL chuan, hoac nhieu dong.
   - Bo sung nut test ket noi Google do latency (ms) & IP thoat (egress IP).
   - Hot Reload Client lap tuc khi sua Settings ma khong can khoi dong lai ung dung.

0c. PASS 153 - GO BO TRIET DE WEBSUB, CAI DAT CHROMEWATCHER CDP (PORT 9222):
   - Go bo hoan toan module WebSub (hub Google khong con phat huy hieu qua, gay cham va nhieu).
   - Cai dat ChromeWatcher CDP ket noi Chrome DevTools Protocol qua cong 9222.
   - Tu dong mo tab /videos cho cac kenh bat CDP va doc DOM truc tiep 500ms/lan, phat hien video moi ngay lap tuc (< 1.5s).
   - QUY TAC TU DONG NGAT API: Khi mot kenh duoc bat CDP, he thong TAT 100% viec goi Google Data API cho kenh do de tiet kiem quota va tranh do tre cua API YouTube.
   - Giao dien: Nut toggle CDP va nhan xanh la tren Sidebar, bang Channel Policy, va the thong tin CDP tren DetectionPanel.

1. PASS 152 - TICH HOP PROXY API RIENG BIET & CO CHE CHONG RATE LIMIT / BAN GOOGLE:
   - Tach rieng cau hinh Proxy cho API/OAuth va Proxy cho Download:
     + API Proxy: Tuy chon dinh tuyen YouTube Data API v3, Google OAuth, Feed scanning qua Proxy HTTP/HTTPS/SOCKS5.
     + Download Proxy: Dinh tuyen yt-dlp rieng biet de tai video toc do cao.
   - Tu dong giu nguyen Direct (Bypass Proxy) cho Chrome CDP Localhost (127.0.0.1:9222) de khong bao gio anh huong cookies/auth session cua nguoi dung.
   - Hot Reload Proxy: Cap nhat ngay lap tuc Client reqwest khi sua Settings ma khong can khoi dong lai ung dung.
   - Co che Auto-Cooldown Circuit Breaker 60s cho loi 429 (rateLimitExceeded):
     + Khi 1 Project GCP bi Google bao 429 Too Many Requests / rateLimitExceeded, he thong tu dong tam hoan project do 60 giay va hoan lai quota quota-tracker.
     + Tu dong chuyen tiep tuc thi (failover) sang Project tiep theo trong Pool ma khong lam dung/loi tien trinh quet kenh.
     + Sau 60 giay, project duoc tu dong mo lai ma khong lam hao phi han muc ngay (PROJECT_QUOTA_CAP).
   - Giao dien Settings Card truc quan, ho tro bat/tat rieng biet, cau hinh URL day du hoac nhap tung phan (Host, Port, User, Pass).

1. PASS 151 - THIET KE LAI BO CUC RENDER 9:16 (VIDEO VUONG 1:1 O GIUA + BANNER TREN + TITLE DUOI):
   - Keo gian video 16:9 tu YouTube cho cao len thanh vuong (1:1, canvas_w x canvas_w) nam o giua.
   - Giu tron 100% chieu rong video, khong crop mat hai ben nhu co che cover crop cu.
   - 2 khoang trong con lai cua canvas chia deu: Banner anh (thumbnail) o tren va Title (tieu de) o duoi.
   - Tinh toan chieu cao va vi tri hoan toan responsive, dam bao 3 phan khit 100% tren moi do phan giai (1080p, 720p, 480p).

1. PASS 149 - PHA CACHE GOOGLE CDN + FIX CONTENTID BUG:
   - Them cache-buster _t={timestamp_ms} vao URL /browse de pha cache Google Edge POP CDN.
   - Fix bug content_id vs contentId (camelCase): JSON InnerTube tra ve contentId nhung code cu
     doc content_id -> ket qua rong -> fallback playlist 12-25s. Nay doc dung -> lay video ngay.
   - Them header Cache-Control: no-cache, no-store, must-revalidate va Pragma: no-cache.
   - Ket qua: phat hien video moi trong 1-3s thay vi 18-20s.

1. PASS 148 - MOC 1-3S BAT VIDEO TOAN DIEN (REALTIME INNERTUBE BROWSE 0-QUOTA):
   - Dua them be mat uu tien #1: InnerTube /browse (params Egh2aWRlb3PyBgQKAjoA - Videos tab Latest).
     Thoi gian phan hoi chi 250ms - 400ms, tra ve videoId ngay tai vi tri dau tien khi vua publish.
   - Dong bo ca 3 lop: Tail Race (probe_channel_browse), FastScan Poller, va InnerTube Helper.
   - Thong nhat moc phat hien video chi tu 1.0s den 3.0s, ngang va vuot troi cac tool doi thu!

1. PASS 147 - TOI UU CAP TOC LOG KHACH 06/09 (RTX 5070):
   - Fix mat Thumbnail / Background tron: Tu dong tai su dung composite background
     da pre-warm, quet thumbnail tren o dia, va trich xuat frame 1s truc tiep tu video goc.
   - Pipelined Execution: Tach biet luong Download va GPU Render, cho phep video ke tiep
     tai ngay tren mang ma khong bi cho 5.0s hot pipeline idle.
   - WebSub Auto-Recovery: Tu dong phuc hoi va re-subscribe 55 kenh unverified.
   - YouTube POP Edge Cache-Busting: Xoay vong ID kenh trong channels.list de pha cache CDN.
   - NativeDL Keep-Alive: Bat HTTP keep-alive trong PreconnAgent de duy tri bang thong >20MB/s.

1. PASS 146 - CHUONG PHAI KHOP, DUOI PHAI TOI CUNG, CHUONG CAM PHAI KEU:
   - So chuong (bell_ledger) + Ve chuong (BellTicket): Luot dua doi soat Delta videoCount
     truoc moi vong; video da co chu qua duong khac (nap xong/qua tuoi/sai thoi luong/premiere)
     thi dung ngay 0 vong dua (0 units).
   - Duoi duoi (Tail chasing): Sau 15s dua day, chuyen sang nhap 1s voi be mat re
     (hot: TailFree 0 unit; sentinel: TailLite 2 units/vong) toi 180s, khong bo cuoc khi Delta > 0.
   - WebSub Health Auto-Recovery: Tu dong hoi relay /health moi 10 phut, force-resubscribe
     dung cac kenh chua xac minh, hien canh bao banner vang trong UI neu bi cam.
   - Be mat moi: Subscriptions feed (subs) 0 quota trong FastSurface (Profile-1).

2. PASS 145 - KHAC PHUC TRIET DE LOI BAT VIDEO DAI 13.9S & 3 PHUT:
   - Tich hop cong nghe dua song song RSS Atom XML Feed ngay o vong dau tien cua tail_race.
   - Poller stream bo sung atom_fut chay song song voi sentinel_scan (0ms overhead).
   - Khi channel vua co video moi duoc publish cong khai, Atom feed phan ung tuc thi o giay 1 - 2
     thay vi phai cho cache 5.7s - 13.9s cua Google videoCount!
   - Loai bo hoan toan truong hop bi doi 14 vong (8.3s) hoac tre 3 phut.

3. PASS 135 - TOI UU TIMELINE TOAN TRINH CHO HYPERCLIP:
   - Chuan hoa 4 chang: Cong khai -> Phat hien (1-2s) -> Download -> Render -> Upload.
   - Toi uu fastDone cho TikTok upload on dinh.
   - Toi uu NVENC Hardware Acceleration cho card RTX 5070 / 3060.

3. CAU TRUC FILE CHUAN HYPERCLIP:
   - Root Launcher: HyperClip.exe (set HYPERCLIP_EDITION=long, data: HyperClip-Data).
   - App Binary: app\HyperClip.exe.
   - Rust Core: app\_internal\hyperclip-tauri.exe & app\hyperclip-tauri.exe.
   - QML UI layouts moi nhat.
   - KHONG chua HyperShort.exe, tranh ghi de nham sang edition Short.

----------------------------------------------------------------------
HUONG DAN AP DUNG PATCH CHO HYPERCLIP:
----------------------------------------------------------------------
Cach 1 (Tu dong qua script apply-patch):
  1. Dong hoan toan HyperClip dang chay (kiem tra Task Manager xem con process
     HyperClip.exe hay hyperclip-tauri.exe khong).
  2. Copy file zip nay vao thu muc goc cua HyperClip (vi du: D:\HyperClip-TestCustomer-20260616-224538\).
  3. Mo PowerShell tai thu muc goc va chay:
     powershell -ExecutionPolicy Bypass -File .\apply-patch.ps1
  4. Script se tu dong nhan dien HyperClip, backup app/ cu va ghi de cac file moi.

Cach 2 (Giai nen thu cong):
  1. Dong HyperClip.
  2. Giai nen toan bo file trong file zip truc tiep de len thu muc HyperClip.
  3. Chon "Replace the files in the destination" khi Windows hoi ghi de.
  4. Chay HyperClip.exe hoac HyperClip-Debug.bat de khoi dong ung dung.
======================================================================
