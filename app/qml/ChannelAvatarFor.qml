// src/ui/qml/ChannelAvatarFor.qml
// Avatar kênh tra theo KHOÁ — dùng ở mọi trang trong app (TikTok, Quản lí, Vận hành, Dashboard, Hàng đợi).
// Hỗ trợ tra theo: id store (`ch-…`), UC id (`UC…`), `@handle`, hoặc TÊN kênh.
import QtQuick

ChannelAvatar {
    id: root

    /// Khoá chính (thường là channelId của workspace = id store `ch-…` hoặc `UC…`).
    property string channelKey: ""
    /// Khoá dự phòng khi khoá chính rỗng/không tra được — thường là tên kênh.
    property string fallbackName: ""
    /// URL ảnh trực tiếp truyền vào (ưu tiên nếu có)
    property string directUrl: ""

    /// Hồ sơ kênh tra được (rỗng = chưa/không tra được).
    property var entry: ({})

    function reload() {
        if (root.directUrl && root.directUrl !== "") {
            entry = { "avatarUrl": root.directUrl, "name": root.fallbackName || root.channelKey }
            return
        }

        // 1. Dùng channelDir native context property (nhanh, an toàn, không gọi RPC đồng bộ)
        if (typeof channelDir !== "undefined" && channelDir && typeof channelDir.lookup === "function") {
            var e = root.channelKey ? channelDir.lookup(root.channelKey) : null
            if ((!e || !e.name) && root.fallbackName) {
                e = channelDir.lookup(root.fallbackName)
            }
            if (e && (e.avatarUrl || e.name)) {
                entry = e
                return
            }
        }

        // 2. Fallback tra từ tiktokModel.channels nếu có
        try {
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
        } catch (err) {}

        entry = ({})
    }

    onChannelKeyChanged: reload()
    onFallbackNameChanged: reload()
    onDirectUrlChanged: reload()
    Component.onCompleted: reload()

    Connections {
        target: (typeof channelDir !== "undefined") ? channelDir : null
        ignoreUnknownSignals: true
        function onChanged() { root.reload() }
    }

    Connections {
        target: (typeof tiktokModel !== "undefined") ? tiktokModel : null
        ignoreUnknownSignals: true
        function onChanged() { root.reload() }
    }

    url: directUrl ? directUrl : ((entry && entry.avatarUrl) ? entry.avatarUrl : "")
    channelName: (entry && entry.name) ? entry.name : (root.fallbackName || root.channelKey)
    tint: (entry && entry.avatarColor) ? entry.avatarColor : Theme.accent
}
