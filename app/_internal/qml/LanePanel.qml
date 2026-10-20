// src/ui/qml/LanePanel.qml
// Pass 91 — BÀN LÀM VIỆC CỦA MỘT LÀN (tab "Video dài" hoặc tab "Shorts").
//
// Cùng một app nhưng hai làn tách biệt: mỗi tab có công tắc bật/tắt làn, bộ
// cài đặt RIÊNG (trái), hàng đợi RIÊNG chỉ hiện video của làn (phải), và
// trạng thái CỔNG E2E LIÊN LÀN (INVARIANT #33): làn này đang giữ máy hay đang
// đợi làn kia xong hẳn e2e — không chen hàng.
//
// Dữ liệu: `settings` (SettingsModel — bộ key của làn), `workspaceModel`
// (lọc theo role `lane`), `laneStatus` (LaneStatusModel — lệnh lane:status +
// event lane:gate). Không gọi lệnh backend trực tiếp ngoài save/reload settings.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg

    /// "long" | "short"
    property string lane: "long"
    signal openWorkspace(string ws_id)
    signal openOtherLane()

    // Harness xem trước có thể không có `laneStatus` — tra qua typeof; mọi chỗ
    // trong file dùng `root.ls`.
    readonly property var ls: (typeof laneStatus !== "undefined") ? laneStatus : null
    readonly property bool isShort: lane === "short"
    readonly property string laneTitle: isShort ? "SHORTS" : "VIDEO DÀI"
    readonly property string otherTitle: isShort ? "Video dài" : "Shorts"
    readonly property color laneColor: isShort ? "#FF66B3" : "#5AA6FF"
    readonly property bool laneOn: settings ? (isShort ? settings.shortsEnabled : settings.longEnabled) : true
    readonly property int laneCount: workspaceModel ? (isShort ? workspaceModel.shortCount : workspaceModel.longCount) : 0
    readonly property int laneBusy: workspaceModel ? (isShort ? workspaceModel.shortBusy : workspaceModel.longBusy) : 0
    // Làn KHÁC đang giữ máy → video của làn này phải đợi.
    readonly property bool otherHolding: ls && ls.activeCount > 0
                                         && ls.activeLane !== "" && ls.activeLane !== lane
    readonly property bool thisHolding: ls && ls.activeCount > 0 && ls.activeLane === lane
    // Property có notify (không phải slot) → tự vẽ lại khi lane:status/lane:gate về.
    readonly property var laneCfg: ls ? (isShort ? ls.shortLane : ls.longLane) : ({})
    readonly property int laneWaiting: ls ? (isShort ? ls.shortWaiting : ls.longWaiting) : 0
    readonly property string laneHint: ls ? (isShort ? ls.shortHint : ls.longHint) : ""

    // Nạp bảng hiệu lực + số đếm khi mở tab; sau đó event lane:gate lo phần cổng.
    onVisibleChanged: if (visible && ls) Qt.callLater(ls.refresh_from_backend, backend)
    Component.onCompleted: if (ls) Qt.callLater(ls.refresh_from_backend, backend)

    function fmtRange(cfg) {
        if (!cfg || cfg.minSec === undefined) return ""
        const lo = cfg.minSec, hi = cfg.maxSec
        const hiTxt = hi >= 120 ? Math.round(hi / 60) + " phút" : hi + "s"
        return lo + "s → " + hiTxt
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spacingLg
        spacing: Theme.spacingMd

        // ─── Header ────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Rectangle {
                Layout.preferredWidth: 34
                Layout.preferredHeight: 34
                radius: 8
                color: Qt.rgba(root.laneColor.r, root.laneColor.g, root.laneColor.b, 0.16)
                border.color: root.laneColor
                border.width: 1
                Icon { anchors.centerIn: parent; name: root.lane; size: 18; color: root.laneColor }
            }
            ColumnLayout {
                spacing: 0
                Label {
                    text: root.laneTitle
                    color: Theme.text
                    font.pixelSize: 22
                    font.bold: true
                    font.letterSpacing: 1
                }
                Label {
                    text: root.laneOn
                        ? ("Nhận " + (root.fmtRange(root.laneCfg) || (root.isShort ? "≤ 3 phút" : "≥ 60s"))
                           + " · " + root.laneCount + " video trong hàng đợi"
                           + (root.laneBusy > 0 ? " · " + root.laneBusy + " đang chạy" : ""))
                        : "Làn đang TẮT — video thuộc làn này bị bỏ ngay ở vòng quét (không tốn unit)."
                    color: root.laneOn ? Theme.textMuted : Theme.warning
                    font.pixelSize: 11
                }
            }

            Item { Layout.fillWidth: true }

            // Cổng e2e liên làn — chip nói ai đang giữ máy.
            LaneGateChip {
                viewLane: root.lane
                Layout.preferredHeight: 24
                Layout.alignment: Qt.AlignVCenter
            }

            // Công tắc BẬT/TẮT làn.
            Rectangle {
                Layout.preferredHeight: 30
                Layout.preferredWidth: laneSwitchRow.implicitWidth + 16
                radius: 15
                color: root.laneOn ? Qt.rgba(root.laneColor.r, root.laneColor.g, root.laneColor.b, 0.14) : Theme.cardBg
                border.color: root.laneOn ? root.laneColor : Theme.border
                border.width: 1
                RowLayout {
                    id: laneSwitchRow
                    anchors.centerIn: parent
                    spacing: 6
                    Label {
                        text: root.laneOn ? "LÀN ĐANG BẬT" : "LÀN ĐANG TẮT"
                        color: root.laneOn ? root.laneColor : Theme.textMuted
                        font.pixelSize: 10
                        font.bold: true
                    }
                    Switch {
                        Layout.preferredHeight: 22
                        checked: root.laneOn
                        onToggled: {
                            if (!settings) return
                            if (root.isShort) settings.shortsEnabled = checked
                            else settings.longEnabled = checked
                        }
                    }
                }
            }

            Button {
                text: "Lưu"
                highlighted: true
                enabled: settings && settings.dirty
                onClicked: {
                    if (settings.save_to_backend(backend)) {
                        toastService.show("Đã lưu", "Cài đặt làn " + (root.isShort ? "Shorts" : "Video dài") + " đã lưu — vòng quét áp dụng ngay", "success")
                        if (root.ls) Qt.callLater(root.ls.refresh_from_backend, backend)
                    } else {
                        toastService.show("Lỗi", "Không thể lưu cài đặt", "error")
                    }
                }
            }
            Button {
                text: "Tải lại"
                enabled: settings && settings.dirty
                onClicked: {
                    settings.load_from_backend(backend)
                    toastService.show("Đã tải lại", "Đã khôi phục cài đặt gần nhất", "info")
                }
            }
        }

        // ─── Banner đợi cổng (chỉ khi làn KHÁC đang giữ máy và làn này có video đợi) ──
        Rectangle {
            Layout.fillWidth: true
            visible: root.laneWaiting > 0
            implicitHeight: waitCol.implicitHeight + 16
            radius: Theme.radiusMd
            color: Qt.rgba(Theme.warning.r, Theme.warning.g, Theme.warning.b, 0.10)
            border.color: Theme.warning
            border.width: 1
            ColumnLayout {
                id: waitCol
                anchors.fill: parent
                anchors.margins: 8
                spacing: 2
                RowLayout {
                    spacing: 6
                    Icon { name: "gate"; size: 13; color: Theme.warning }
                    Label {
                        text: root.laneHint
                        color: Theme.warning
                        font.pixelSize: Theme.textMd
                        font.bold: true
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                }
                Label {
                    text: "Luật INVARIANT #33: video xếp theo giờ phát hiện; làn này chỉ vào máy khi làn kia trả hết chỗ (tải → render → lượt đăng TikTok đầu). Thời gian đợi ghi vào 'chờ hàng đợi', không tính vào e2e."
                    color: Theme.textMuted
                    font.pixelSize: 10
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }
        }

        // ─── Hai cột: cài đặt (trái) · hàng đợi của làn (phải) ────
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: Theme.spacingMd

            // LEFT — bộ cài đặt riêng của làn
            Rectangle {
                Layout.preferredWidth: 480
                Layout.minimumWidth: 400
                Layout.fillHeight: true
                color: "transparent"

                ScrollView {
                    id: cfgScroll
                    anchors.fill: parent
                    clip: true
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

                    ColumnLayout {
                        width: cfgScroll.width - 12
                        spacing: Theme.spacingMd

                        Label {
                            text: "CÀI ĐẶT RIÊNG CỦA LÀN " + root.laneTitle
                            color: root.laneColor
                            font.pixelSize: 10
                            font.bold: true
                            font.letterSpacing: 0.8
                        }

                        Loader {
                            Layout.fillWidth: true
                            sourceComponent: root.isShort ? shortCfg : longCfg
                        }
                        Component { id: shortCfg; ShortsSettingsCard {} }
                        Component { id: longCfg; LongSettingsCard {} }

                        // Bảng HIỆU LỰC do Rust tính (đúng bảng pipeline dùng) — để
                        // operator đối chiếu "tôi đặt gì" với "app đang chạy gì".
                        SettingsCard {
                            Layout.fillWidth: true
                            title: "ĐANG CHẠY (theo Rust)"
                            titleColor: Theme.textMuted
                            Label {
                                text: {
                                    const c = root.laneCfg
                                    if (!c || c.minSec === undefined) return "Chưa nạp — mở lại tab hoặc bấm Lưu."
                                    return "Làn " + (c.enabled ? "BẬT" : "TẮT")
                                        + " · nhận " + root.fmtRange(c)
                                        + " · tải " + (c.autoDownload ? c.downloadQuality + "p" : "TẮT")
                                        + " · render " + (c.autoRender ? (c.renderResolution + " x" + Number(c.renderSpeed).toFixed(2) + " " + c.renderFps + "fps") : "TẮT")
                                        + (c.trimLimitMinutes > 0 ? " · cắt " + c.trimLimitMinutes + " phút" : " · không cắt")
                                        + (c.splitAllowed ? "" : " · không tách phần")
                                        + " · TikTok " + (c.tiktokUpload ? "BẬT" : "TẮT")
                                        + (c.allowPortrait ? " · nhận nguồn dọc" : " · bỏ nguồn dọc")
                                }
                                color: Theme.text
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }
                            Label {
                                visible: settings && settings.dirty
                                text: "Có thay đổi chưa lưu — bấm Lưu để áp dụng."
                                color: Theme.warning
                                font.pixelSize: 10
                            }
                            Label {
                                text: root.ls ? ("Vòng quét đang nhận: " + root.ls.filterText) : ""
                                color: Theme.textMuted
                                font.pixelSize: 10
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }
                        }

                        Item { Layout.preferredHeight: Theme.spacingLg }
                    }
                }
            }

            // RIGHT — hàng đợi của làn
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: Theme.cardBg
                border.color: Theme.border
                border.width: 1
                radius: Theme.radiusLg
                clip: true

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 8
                    spacing: 6

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label {
                            text: "HÀNG ĐỢI " + root.laneTitle
                            color: Theme.textMuted
                            font.pixelSize: 10
                            font.bold: true
                            font.letterSpacing: 0.8
                        }
                        Item { Layout.fillWidth: true }
                        // Đếm theo trạng thái 24h từ lane:status
                        Label {
                            readonly property var c: root.laneCfg && root.laneCfg.counts ? root.laneCfg.counts : null
                            text: c ? ("24h: " + c.total + " · chờ " + c.waiting + " · tải " + c.downloading
                                       + " · render " + c.rendering + " · xong " + c.done
                                       + (c.uploaded > 0 ? " · đã đăng " + c.uploaded : "")
                                       + (c.error > 0 ? " · lỗi " + c.error : ""))
                                   : ""
                            color: Theme.textMuted
                            font.pixelSize: 10
                        }
                        // Sang tab làn kia
                        Rectangle {
                            Layout.preferredHeight: 20
                            Layout.preferredWidth: otherLbl.implicitWidth + 14
                            radius: 10
                            color: otherMa.containsMouse ? Theme.hoverBg : "transparent"
                            border.color: Theme.border
                            border.width: 1
                            Label {
                                id: otherLbl
                                anchors.centerIn: parent
                                text: "→ " + root.otherTitle
                                color: Theme.textMuted
                                font.pixelSize: 10
                            }
                            MouseArea {
                                id: otherMa
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.openOtherLane()
                            }
                        }
                    }

                    WorkspaceQueue {
                        id: laneQueue
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        laneFilter: root.lane
                        allowClearAll: false
                        color: "transparent"
                        border.width: 0
                        onOpenWorkspace: function(ws_id) { root.openWorkspace(ws_id) }
                        // Lọc kênh cục bộ trong tab (không đụng bộ lọc kênh của cột phải chung).
                        onSelectChannelFilter: function(id) { laneQueue.channelFilter = id }
                    }
                }
            }
        }
    }
}
