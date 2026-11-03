// src/ui/qml/ChannelAvatarFor.qml
// Avatar kênh tra theo KHOÁ — dùng ở trang nào chỉ cầm id/tên kênh chứ không
// có sẵn `avatarUrl` trong model (Quản lí, Vận hành, Dashboard, hàng đợi).
//
// `ChannelAvatar` là phần VẼ (nhận sẵn url/tên/màu); file này là phần TRA:
// hỏi `channelDir` — bảng dựng một lần từ payload `channel:list` — nên thêm
// avatar cho một trang mới không phát sinh lời gọi backend nào cho từng dòng.
//
// Khoá nhận được: id store (`ch-…`), UC id, `@handle`, hoặc chính TÊN kênh —
// mỗi model đang cầm một thứ khác nhau (lịch sử phát hiện chỉ có tên).
import QtQuick

ChannelAvatar {
    id: root

    /// Khoá chính (thường là channelId của workspace = id store `ch-…`).
    property string channelKey: ""
    /// Khoá dự phòng khi khoá chính rỗng/không tra được — thường là tên kênh.
    property string fallbackName: ""

    /// Hồ sơ kênh tra được (rỗng = chưa/không tra được).
    property var entry: ({})

    function reload() {
        if (typeof channelDir === "undefined" || !channelDir) {
            entry = ({})
            return
        }
        var e = root.channelKey ? channelDir.lookup(root.channelKey) : null
        if ((!e || !e.name) && root.fallbackName)
            e = channelDir.lookup(root.fallbackName)
        entry = e ? e : ({})
    }

    onChannelKeyChanged: reload()
    onFallbackNameChanged: reload()
    Component.onCompleted: reload()

    Connections {
        // Danh sách kênh nạp lại, hoặc avatar vừa về đĩa → đổi sang `file:///`.
        target: (typeof channelDir !== "undefined") ? channelDir : null
        function onChanged() { root.reload() }
    }

    url: entry.avatarUrl || ""
    channelName: entry.name || root.fallbackName || root.channelKey
    tint: entry.avatarColor ? entry.avatarColor : Theme.accent
}
