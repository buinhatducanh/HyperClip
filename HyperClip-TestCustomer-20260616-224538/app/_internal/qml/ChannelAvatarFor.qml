// src/ui/qml/ChannelAvatarFor.qml
// Avatar kênh tra theo KHOÁ — dùng ở mọi trang trong app (TikTok, Quản lí, Vận hành, Dashboard, Hàng đợi).
//
// Hỗ trợ tra theo: id store (`ch-…`), UC id (`UC…`), `@handle`, hoặc TÊN kênh.
import QtQuick
import "ChannelDir.js" as ChannelDir

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

        var cm = (typeof channelListModel !== "undefined") ? channelListModel : null
        var tm = (typeof tiktokModel !== "undefined") ? tiktokModel : null
        var be = (typeof backend !== "undefined") ? backend : null

        var e = root.channelKey ? ChannelDir.lookup(root.channelKey, cm, tm, be) : null
        if ((!e || !e.name) && root.fallbackName) {
            e = ChannelDir.lookup(root.fallbackName, cm, tm, be)
        }

        if (e && (e.avatarUrl || e.name)) {
            entry = e
            return
        }

        // Fallback tra trực tiếp từ tiktokModel.channels nếu có
        try {
            if (tm && tm.channels) {
                var chs = tm.channels
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
        target: (typeof channelListModel !== "undefined") ? channelListModel : null
        ignoreUnknownSignals: true
        function onCountChanged() { root.reload() }
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
