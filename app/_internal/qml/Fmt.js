// src/ui/qml/Fmt.js — formatter dùng chung cho mọi QML.
//
// Dùng:  import "Fmt.js" as Fmt   →   Fmt.duration(sec), Fmt.bytes(b), Fmt.clock(sec)…
//
// Trước 2026-08-17 các hàm này chỉ sống trong ManagementPanel.qml (fmt*) và
// bị viết lại lẻ tẻ ở SplitModal (formatTime), WorkspaceCardDisplay
// (formatDuration1Dec). Thêm formatter mới → thêm ở ĐÂY, không thêm vào panel.
//
// Quy ước trả về "—" khi không có số (undefined/null/≤0) — trừ các hàm dạng
// đồng hồ trả "0:00"/"00:00:00" để layout không nhảy.
.pragma library

function pad2(n) { return (n < 10 ? "0" : "") + n }

/// 65.4 → "1:05" (phút:giây, không giờ). ≤0 → "0:00".
function clockMS(sec) {
    if (sec === undefined || sec === null || sec <= 0 || isNaN(sec)) return "0:00"
    sec = Math.floor(sec)
    return Math.floor(sec / 60) + ":" + pad2(sec % 60)
}

/// 3725 → "01:02:05". ≤0 → "00:00:00".
function clock(sec) {
    if (sec === undefined || sec === null || sec <= 0 || isNaN(sec)) return "00:00:00"
    sec = Math.floor(sec)
    return pad2(Math.floor(sec / 3600)) + ":" + pad2(Math.floor((sec % 3600) / 60)) + ":" + pad2(sec % 60)
}

/// Thời lượng đọc được, 1 số lẻ: 4.2 → "4.2s", 75.5 → "1m 15.5s", 3725 → "1h 2m 5.0s".
/// undefined/null/NaN/âm → "—". 0 → "0.0s" (giữ đúng hành vi fmtDuration cũ).
function duration(sec) {
    if (sec === undefined || sec === null || isNaN(sec) || sec < 0) return "—"
    if (sec < 60) return sec.toFixed(1) + "s"
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    if (h > 0) return h + "h " + m + "m " + s.toFixed(1) + "s"
    if (m > 0) return m + "m " + s.toFixed(1) + "s"
    return s.toFixed(1) + "s"
}

/// Như `duration` nhưng ≤0 / thiếu → `emptyText` (mặc định "—"). Dùng cho số
/// đo "chưa có" (độ trễ phát hiện, thời lượng render chưa xong…).
function durationOr(sec, emptyText) {
    if (emptyText === undefined) emptyText = "—"
    if (!sec || sec <= 0 || isNaN(sec)) return emptyText
    return duration(sec)
}

/// Byte → "1.23 GB" / "12.50 MB" / "3.4 KB" / "12 B". ≤0 → "—".
function bytes(b) {
    if (!b || b <= 0) return "—"
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB"
    if (b >= 1048576) return (b / 1048576).toFixed(2) + " MB"
    if (b >= 1024) return (b / 1024).toFixed(1) + " KB"
    return b + " B"
}

/// epoch ms → "HH:MM:SS · DD/MM" (giờ máy). ≤0 → "—".
function absTime(ms) {
    if (!ms || ms <= 0) return "—"
    const d = new Date(ms)
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds())
        + " · " + pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1)
}

/// epoch ms → "HH:MM:SS DD/MM/YYYY". ≤0 → "—".
function fullTime(ms) {
    if (!ms || ms <= 0) return "—"
    const d = new Date(ms)
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds())
        + " " + pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear()
}

/// "X giây/phút/giờ/ngày trước" so với `nowMs` (truyền `Date.now()` hoặc một
/// property đổi mỗi giây để nhãn tự đếm). Mốc bắt có thể nhanh hơn đồng hồ vẽ
/// vài chục ms — không in "-1 giây".
function timeAgo(ms, nowMs) {
    if (!ms || ms <= 0) return "—"
    const base = (nowMs && nowMs > 0) ? nowMs : Date.now()
    const diff = (base - ms) / 1000
    if (diff < 1) return "vừa xong"
    if (diff < 60) return Math.floor(diff) + " giây trước"
    if (diff < 3600) return Math.floor(diff / 60) + " phút trước"
    if (diff < 86400) return Math.floor(diff / 3600) + " giờ trước"
    return Math.floor(diff / 86400) + " ngày trước"
}

/// Trạng thái workspace → state của StatusDot ("ready" | "error" | "running" | "idle").
function statusToDotState(s) {
    if (s === "done" || s === "rendered") return "ready"
    if (s === "error" || s === "failed") return "error"
    if (s === "downloading" || s === "rendering" || s === "waiting") return "running"
    return "idle"
}

/// Nhãn trạng thái workspace IN HOA cho bảng/danh sách.
function statusLabel(s) {
    return ({
        "new": "MỚI",
        "pending": "CHỜ",
        "waiting": "CHỜ",
        "downloading": "ĐANG TẢI",
        "ready": "SẴN SÀNG",
        "editing": "ĐANG SỬA",
        "rendering": "ĐANG RENDER",
        "done": "HOÀN TẤT",
        "rendered": "HOÀN TẤT",
        "error": "LỖI",
        "failed": "LỖI",
    })[s] || (s || "—").toUpperCase()
}

/// Nguồn ảnh thumbnail: đường dẫn local → file:///, không có → hqdefault YouTube.
function thumbnailSource(thumbnailLocal, videoId) {
    if (!thumbnailLocal) {
        return videoId ? "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg" : ""
    }
    const t = ("" + thumbnailLocal).trim()
    if (t.indexOf("http://") === 0 || t.indexOf("https://") === 0 || t.indexOf("file://") === 0 || t.indexOf("qrc:") === 0) {
        return t
    }
    return "file:///" + t.replace(/\\/g, "/")
}


/// epoch ms -> "HH:MM:SS.s" (mốc thời gian chính xác 0.1s).
function timeMs(ms) {
    if (!ms || ms <= 0) return "—"
    const d = new Date(ms)
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds())
        + "." + Math.floor((ms % 1000) / 100)
}
