// src/ui/qml/ProjectActions.js — hành động trên pool project GCP, dùng chung
// cho QuotaPoolCard (Onboarding) và ProjectPoolTable (trang Lõi quét).
//
// Trước 2026-08-17 ba hàm này copy NGUYÊN VĂN ở hai file (CODE_MAP Q1).
// Dùng:  import "ProjectActions.js" as PA
//        PA.testProject(root, {backend: backend, toast: toastService, quota: quota}, projectId)
.pragma library

/// Trang Console đúng với loại lỗi — triết lý GcpWizard: mỗi lỗi một nút mở
/// đúng chỗ phải sửa, không bắt khách tự mò.
function consoleUrlFor(projectId, errText) {
    // Key lẻ chưa gán project ("key:AIza…") không deep-link được.
    const q = ("" + projectId).indexOf("key:") === 0 ? "" : "?project=" + projectId
    const e = (errText || "").toLowerCase()
    if (e.indexOf("chưa bật") >= 0 || e.indexOf("accessnotconfigured") >= 0)
        return "https://console.cloud.google.com/apis/library/youtube.googleapis.com" + q
    return "https://console.cloud.google.com/apis/credentials" + q
}

/// Kiểm chứng lại một project bằng call thật (`project:testOne`).
/// `host` phải có property `testingId` (khoá nút test trong lúc chờ).
/// `deps` = {backend, toast, quota} — truyền tường minh vì .pragma library
/// không thấy context property.
function testProject(host, deps, projectId) {
    host.testingId = projectId
    // Hoãn ra khỏi stack click: send_command đồng bộ spin nested loop, gọi
    // thẳng trong onClicked là hủy delegate giữa chừng (crash 18/07).
    Qt.callLater(function() {
        const resp = deps.backend.send_command("project:testOne", {"projectId": projectId})
        host.testingId = ""
        const r = (resp && resp.result) || {}
        if (!resp || resp.ok === false || !r.success) {
            if (deps.toast) deps.toast.show("Không kiểm tra được",
                (resp && resp.error) || r.error || "", "error")
            return
        }
        if (r.ok) {
            if (deps.toast) deps.toast.show("Project dùng được",
                projectId + " đã quay lại vòng xoay quét", "success")
        } else {
            if (deps.toast) deps.toast.show("Project vẫn hỏng", r.error || "", "warning")
        }
        if (deps.quota) deps.quota.refresh_from_backend(deps.backend)
    })
}

/// Xoá project khỏi pool (KeyStore + nạp lại pool) sau khi xác nhận.
/// `confirmDialog` là ConfirmationDialog có `openFor(id, name, cb)`.
function removeProject(confirmDialog, deps, projectId, name) {
    confirmDialog.openFor(projectId, name || projectId, function(id) {
        Qt.callLater(function() {
            deps.backend.send_command("project:remove", {"projectId": id})
            if (deps.toast) deps.toast.show("Đã xoá project",
                id + " không còn trong pool quét", "info")
            if (deps.quota) deps.quota.refresh_from_backend(deps.backend)
        })
    })
}

/// Pass 92: xoá MỘT PHÁT mọi project hỏng (key đình chỉ / API chưa bật /
/// 403). Backend tự loại "Hết quota hôm nay" — project cạn quota là project
/// tốt, không nằm trong danh sách xoá.
function removeAllBroken(confirmDialog, deps, brokenCount) {
    confirmDialog.openFor("__broken__",
        brokenCount + " project hỏng (key đình chỉ / lỗi cấu hình)", function() {
        Qt.callLater(function() {
            const resp = deps.backend.send_command("project:removeBroken", {})
            const n = (resp && resp.result) ? (resp.result.removed || 0) : 0
            if (deps.toast) deps.toast.show("Đã dọn project hỏng",
                "Xoá " + n + " project khỏi pool quét (kèm dấu quota)", "info")
            if (deps.quota) deps.quota.refresh_from_backend(deps.backend)
        })
    })
}
