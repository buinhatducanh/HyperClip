# HyperClip — Customer Delivery Scripts

> Hướng dẫn cho **operator** đóng gói HyperClip cho khách hàng.

---

## Workflow tổng quan

```
OPERATOR MACHINE                          CUSTOMER MACHINE
────────────────────────────────────────  ────────────────────────────────
1. Login Chrome + YouTube (1 lần)         4. Extract ZIP
2. Chạy prepare-customer-package.ps1      5. Chạy customer-first-run.ps1
3. Gửi ZIP cho khách                       6. Setup OAuth + Channels
                                          7. Chạy HyperClip ✅
```

---

## Bước 1: Chuẩn bị trên máy Operator

### Prerequisites

```bash
# Kiểm tra Node.js (cần cho sql.js cookie extraction)
node --version

# Kiểm tra Chrome đã login YouTube
# Mở Chrome → youtube.com → đảm bảo đã đăng nhập + accept consent banner

# ĐÓNG CHROME HOÀN TOÀN trước khi chạy script
```

### Chạy đóng gói

```powershell
# Từ thư mục HyperClip project:
cd D:\LOOP_COMPANY\HyperClip\scripts

# Cơ bản:
.\prepare-customer-package.ps1 -CustomerName "AcmeCorp"

# Đầy đủ:
.\prepare-customer-package.ps1 `
    -CustomerName "AcmeCorp" `
    -OAuthTokensSource "D:\HyperClip-Data\app\oauth_tokens.json" `
    -ChannelsSource "D:\HyperClip-Data\app\channels.json" `
    -OutputDir ".\customer-packages" `
    -SessionCount 30
```

### Kết quả

```
customer-packages/
  HyperClip-AcmeCorp-20260512-143022/
    HyperClip-Data/
      app/
        oauth_tokens.json   ← từ máy operator (nếu có)
        channels.json       ← từ máy operator (nếu có)
        workspaces.json     ← empty
      chrome-profiles/
        profile-1/          ← 30 profiles đã clone cookies
        ...
        profile-30/
    README-AcmeCorp.md
  HyperClip-AcmeCorp-20260512-143022.zip   ← gửi cho khách
```

### Nếu cookie extraction fail

```powershell
# Thử chạy Node.js extraction trực tiếp để xem lỗi:
node extract-cookies.js --profile "C:\Users\You\AppData\Local\Google\Chrome\User Data"
```

**Nguyên nhân thường gặp:**
1. Chrome đang mở → đóng Chrome + retry
2. Chưa đăng nhập YouTube → login Chrome + retry
3. Chưa accept consent banner → mở YouTube trong Chrome + accept

---

## Bước 2: Gửi cho khách hàng

Gửi file **`.zip`** cho khách kèm hướng dẫn trong README.

---

## Bước 3: Khách hàng setup (một lần duy nhất)

```powershell
# 1. Giải nén ZIP vào thư mục bất kỳ

# 2. Chạy first-run setup:
cd <extract-path>
.\scripts\customer-first-run.ps1

# 3. Restart terminal/VS Code để nhận environment variable

# 4. Mở HyperClip → Settings → Google Projects → Add OAuth

# 5. Settings → Channels → Add channels to track

# 6. Xong! Detection chạy tự động 24/7
```

---

## Files

| File | Mục đích | Chạy bởi |
|------|----------|-----------|
| `prepare-customer-package.ps1` | Extract cookies + clone sessions + đóng gói ZIP | Operator |
| `extract-cookies.js` | Cookie extraction engine (DPAPI + sql.js + AES-GCM) | Operator |
| `customer-first-run.ps1` | Setup environment variable + verify trên máy khách | Customer |
| `HyperClip-Launcher.bat` | Batch launcher có sẵn data directory | Customer |

---

## Cơ chế Cookie (kỹ thuật)

Chrome cookies được mã hóa DPAPI (CurrentUser) — chỉ giải mã được trên **máy operator**.

**Cái gì portable:**
- `_hyperclip_cookies.json` — plain JSON, **KHÔNG bị DPAPI**, có thể copy sang máy khách
- OAuth tokens, channels, workspaces — portable
- Chrome profile directories (SQLite + DPAPI) — **KHÔNG portable**

**Chi tiết flow:**
```
Chrome (DPAPI-encrypted)
  └─ extract-cookies.js
       ├─ DPAPI unwrap → AES-256 key
       ├─ sql.js → đọc SQLite cookie DB
       └─ AES-256-GCM decrypt → plain cookie values
            └─ SOCS=CAI auto-inject
                 └─ _hyperclip_cookies.json (portable!)
                      └─ Clone to 30 profiles trong ZIP
```

---

## Troubleshooting

### "DPAPI unwrap failed"
- Chrome đang mở → đóng hoàn toàn
- PowerShell không có quyền → chạy as Administrator

### "sql.js not found"
- Chạy script từ thư mục HyperClip project
- Kiểm tra `node_modules/sql.js/dist/sql-wasm.wasm` tồn tại

### Cookie extraction OK nhưng detection vẫn fail
- Customer chưa setup OAuth → bắt buộc phải add OAuth credentials
- SOCS cookie hết hạn → khách mở Chrome → youtube.com → login → clone lại

### OAuth tokens hết quota
- Mỗi project = 10,000 units/ngày
- Thêm nhiều Google Cloud projects để tăng quota
- Xem quota: Settings → Google Projects tab
