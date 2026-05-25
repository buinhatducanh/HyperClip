# BẢNG GIÁ DỊCH VỤ

> **Ngày:** 2026-05-25
> **Cam kết:** Hoàn tiền 100% trong 30 ngày nếu không hài lòng

---

## BẢNG GIÁ — 19,893,000 VND / tháng

---

## Tổng Quan

| Hạng mục | Chi phí / tháng | Tỷ lệ |
|-----------|----------------|:------:|
| Nhân sự vận hành | 18,311,333 VND | 92.0% |
| Phần mềm HyperClip (VAT) | 1,581,667 VND | 8.0% |
| **TỔNG** | **19,893,000 VND** | **100%** |

---

## Chi Tiết Các Module

| # | Module | Giờ / tháng | Tỷ lệ | Chi phí |
|---|--------|:---:|:---:|---:|
| **1** | **Detection Engine** (youtubei.js + OAuth fallback, polling 5s) | **110 giờ** | **30%** | **5,967,900 VND** |
| **2** | **Render Pipeline** (FFmpeg + NVENC, 8 workers, chunked) | **110 giờ** | **30%** | **5,967,900 VND** |
| 3 | Chrome Session Management (30 profiles, DPAPI, SOCS) | 37 giờ | 10% | 1,831,133 VND |
| 4 | Auto-Download (yt-dlp, tv_embedded, multi-instance) | 37 giờ | 10% | 1,831,133 VND |
| 5 | Auto-Render (post-download trigger, pre-scale) | 18 giờ | 5% | 915,567 VND |
| 6 | Editor (React-Konva, trim/speed/overlay, quality probe) | 18 giờ | 5% | 915,567 VND |
| 7 | System Monitoring & Health Alerts | 18 giờ | 5% | 915,567 VND |
| 8 | Channel & Workspace Management | 18 giờ | 5% | 915,567 VND |
| | **TỔNG NHÂN SỰ** | **366 giờ** | **100%** | **18,311,333 VND** |

> **Giá bán:** 19,893,000 VND = 18,311,333 VND (nhân sự) + 1,581,667 VND (phần mềm)

---

## Chi Tiết Từng Module

### Module 1: Detection Engine — 5,967,900 VND (30%) | 110 giờ

| Thành phần | Chi tiết kỹ thuật |
|-----------|---------------------|
| Innertube (youtubei.js) | Polling 5 giây, 30 Chrome sessions, NO quota — phát hiện < 5s |
| OAuth Fallback | TokenManager — smart rotation 200 GCP projects, chỉ trigger khi Innertube die |
| Round-robin session | 10s cooldown trên session lỗi, pre-warmed 30 clients |
| Age filter | Skip video > 10 phút, `publishedAt=0` → OAuth verify |
| Dedup | Check top-1→top-5, `continue` khi top-1 đã seen |
| Early termination | Stop sau 5 videos found |

---

### Module 2: Render Pipeline — 5,967,900 VND (30%) | 110 giờ

| Thành phần | Chi tiết kỹ thuật |
|-----------|---------------------|
| FFmpeg + NVENC | Hardware encode — `hevc_nvenc`/`h264_nvenc`, KHÔNG x264 |
| NVDEC GPU decode | `-c:v hevc_cuvid/h264_cuvid` — decode nhanh gấp 2x |
| CUDA filter pipeline | `-filter_hw_device cuda` — scale/pad/overlay trên GPU |
| Chunked render | 120s chunks, 8 workers parallel |
| Pre-render text overlay | PNG 1 lần → overlay GPU mỗi frame |
| Async NVENC | `-rc-lookahead 0 -tune ull` — max throughput |
| Bottom bar layout | HEADER(20%) \| VIDEO(70%) \| BOTTOM(10%) |
| Auto-render | Post-download trigger, pre-scale, cleanup |

---

### Module 3: Chrome Session Management — 1,831,133 VND (10%) | 37 giờ

| Thành phần | Chi tiết kỹ thuật |
|-----------|---------------------|
| 30 Chrome profiles | DPAPI decrypt + sql.js extract cookies tự động |
| SOCS injection | Force `CAI` — không cần user accept consent banner |
| Cookie lock prevention | Cảnh báo đóng Chrome trước khi khởi động |
| Session health monitoring | Ready / No consent / Dead status real-time |

---

### Module 4: Auto-Download — 1,831,133 VND (10%) | 37 giờ

| Thành phần | Chi tiết kỹ thuật |
|-----------|---------------------|
| yt-dlp wrapper | `tv_embedded` → H.264 1080p60, bypass EJS challenge |
| `--download-sections` | Chỉ tải N phút đầu (trim limit, default 10 phút) |
| Multi-instance | 4 instances × 32 fragments khi RAM ≥ 16GB + 1080p |
| Direct IP binding | Bypass VPN cho max bandwidth |
| Auto retry | Retry khi 403 / rate limit / timeout |
| Quality probe | Kiểm tra format available trước khi tải |

---

### Module 5: Auto-Render — 915,567 VND (5%) | 18 giờ

| Thành phần | Chi tiết kỹ thuật |
|-----------|---------------------|
| Post-download trigger | Download xong → check `autoRender=true` |
| Pre-scale | `preScaleVideo()` — downscale source về output resolution |
| Preset optimization | `p1+ull` cho auto-render |
| `autoRenderAttempted` flag | Ngăn infinite retry loop |

---

### Module 6: Editor — 915,567 VND (5%) | 18 giờ

| Thành phần | Chi tiết kỹ thuật |
|-----------|---------------------|
| React-Konva Canvas 2D | 60fps GPU compositing |
| Trim controls | Start / end time, seek preview, keyboard shortcut |
| Speed control | 1.0x / 1.1x / 1.2x / 1.5x |
| Background options | Blur, solid color, gradient, image |
| Text overlay | Header title, bottom bar, auto-layout 9:16 |
| Quality buttons | 360/720/1080 — disabled khi YouTube không có format |
| Auto-downgrade quality | User chọn 1080 nhưng source 720 → tự động giảm |

---

### Module 7: System Monitoring & Health Alerts — 915,567 VND (5%) | 18 giờ

| Thành phần | Chi tiết kỹ thuật |
|-----------|---------------------|
| GPU monitoring | Temperature, memory, worker count — 5s interval |
| RAM monitoring | Usage per process |
| Innertube health | Sessions ready / total — 0/30 → Critical alert |
| OAuth quota | Used today per project — all < 10% → Warning |
| Download failures | 3+ consecutive → Warning |
| No new videos 24h | → Warning |
| Health alert cooldown | 5 phút per alert type |

---

### Module 8: Channel & Workspace Management — 915,567 VND (5%) | 18 giờ

| Thành phần | Chi tiết kỹ thuật |
|-----------|---------------------|
| Add channel | URL validation + duplicate check + preview |
| Channel sync | OAuth sync từ YouTube subscriptions |
| seenVideoIds dedup | Persist to disk, cap 10,000 IDs |
| Workspace CRUD | Create / update / delete / list theo status |
| Status tracking | downloading → ready → rendering → done → archived |
| Retry logic | Retry download/render cho `waiting` / `error` |

---

## Nhân Sự Team — 18,311,333 VND | 366 giờ

| Thành viên | Vai trò | Giờ / ngày | Ngày / tháng | Tổng giờ | Đơn giá | Chi phí |
|-----------|---------|-----------|------------|---------|---------|---------|
| NV 1 | Detection + Render | 4h | 22 | 88h | 50,000đ | 4,400,000đ |
| NV 2 | Detection + Render | 4h | 22 | 88h | 50,000đ | 4,400,000đ |
| NV 3 | Auto-Download + Chrome + Support | 4h | 22 | 88h | 50,000đ | 4,400,000đ |
| NV 4 | Editor + Monitoring + Workspace | 4h | 22 | 88h | 50,000đ | 4,400,000đ |
| Buffer phân bổ | | | | 14h | 50,000đ | 711,333đ |
| | | | | **366 giờ** | | **18,311,333đ** |

---

## Phân Bổ % Cho Khách Hàng

```
Detection Engine   ████████████████████████████████  30%
Render Pipeline    ████████████████████████████████  30%
Chrome Management ████████████                      10%
Auto-Download      ████████████                      10%
Auto-Render       ██████                             5%
Editor            ██████                             5%
System Monitoring ██████                             5%
Channel & WS       ██████                             5%
                                                ─────────
                                        Tổng     100%
```

---

## Gói Thanh Toán

| Hình thức | Giá | Ghi chú |
|-----------|-----|---------|
| Trả hàng tháng | **19,893,000 VND** | Thanh toán trước đầu tháng |
| Trả 6 tháng | **113,000,000 VND** | Tiết kiệm ~6,358,000đ |
| Trả 12 tháng | **220,000,000 VND** | Tiết kiệm ~18,716,000đ |

---

## Cam Kết

| Cam kết | Chi tiết |
|---------|---------|
| Phát hiện video | < 20 giây sau khi upload — polling 5 giây liên tục |
| Download | Tự động — yt-dlp tv_embedded → H.264 1080p60 |
| Render | Tự động — FFmpeg + NVENC GPU — 1 video 10 phút ~ 2 phút |
| Hỗ trợ | Phản hồi trong 4 giờ (9:00–18:00, T2–T6) |
| Hoàn tiền | 100% trong 30 ngày đầu tiên |

---

## Liên Hệ

| | |
|---|---|
| **Hotline / Zalo** | [SĐT] |
| **Email** | [Email] |
| **Giờ làm việc** | 9:00 – 18:00 (Thứ 2 – Thứ 6) |
