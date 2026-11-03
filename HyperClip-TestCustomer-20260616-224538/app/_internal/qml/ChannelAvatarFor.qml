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
    /// URL ảnh trực tiếp truyền vào (ưu tiên nếu có)
    property string directUrl: ""

    /// Hồ sơ kênh tra được (rỗng = chưa/không tra được).
    property var entry: ({})

    function reload() {
        if (typeof channelDir !== "undefined" && channelDir && typeof channelDir.lookup === "function") {
            var e = root.channelKey ? channelDir.lookup(root.channelKey) : null
            if ((!e || !e.name) && root.fallbackName)
                e = channelDir.lookup(root.fallbackName)
            if (e && (e.avatarUrl || e.name)) {
                entry = e
                return
            }
        }
        // Fallback tra từ tiktokModel.channels nếu có
        if (typeof tiktokModel !== "undefined" && tiktokModel && tiktokModel.channels) {
            var chs = tiktokModel.channels
            for (var i = 0; i < chs.length; i++) {
                var c = chs[i]
                if (!c) continue
                if ((root.channelKey && (c.channelId === root.channelKey || c.id === root.channelKey)) ||
                    (root.fallbackName && c.name === root.fallbackName)) {
                    entry = c
                    return
                }
            }
        }
        entry = ({})
    }

    onChannelKeyChanged: reload()
    onFallbackNameChanged: reload()
    Component.onCompleted: reload()

    Connections {
        target: (typeof channelDir !== "undefined") ? channelDir : null
        function onChanged() { root.reload() }
    }

    Connections {
        target: (typeof tiktokModel !== "undefined") ? tiktokModel : null
        function onChanged() { root.reload() }
    }

    url: directUrl ? directUrl : ((entry && entry.avatarUrl) ? entry.avatarUrl : "")
    channelName: (entry && entry.name) ? entry.name : (root.fallbackName || root.channelKey)
    tint: (entry && entry.avatarColor) ? entry.avatarColor : Theme.accent
}
