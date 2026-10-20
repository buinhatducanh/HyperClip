// src/ui/qml/LaneGateChip.qml
// Pass 91 — chip trạng thái CỔNG E2E LIÊN LÀN (INVARIANT #33): ai đang giữ
// máy (Video dài / Shorts), bao nhiêu video đang đợi tới lượt. Đọc từ
// `laneStatus` (LaneStatusModel — event lane:gate cập nhật thời gian thực).
// Dùng ở TopMenuBar, LanePanel, ManagementPanel. `compact` = chỉ chấm + số.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: chip
    property bool compact: false
    // Làn của trang đang hiện (để tô "làn KHÁC đang giữ máy" nổi hơn); "" = trung lập.
    property string viewLane: ""

    // Harness xem trước QML có thể không đăng ký `laneStatus` — tra qua typeof
    // để binding không nổ ReferenceError.
    readonly property var ls: (typeof laneStatus !== "undefined") ? laneStatus : null
    readonly property bool enabledGate: ls ? ls.gateEnabled : true
    readonly property string activeLane: ls ? ls.activeLane : ""
    readonly property int activeCount: ls ? ls.activeCount : 0
    readonly property int waitingCount: ls ? ls.waitingCount : 0
    readonly property bool otherHolding: viewLane !== "" && activeCount > 0 && activeLane !== "" && activeLane !== viewLane
    readonly property color tone: !enabledGate ? Theme.textMuted
                                : activeCount === 0 ? Theme.textMuted
                                : otherHolding ? Theme.warning
                                : Theme.success

    implicitHeight: 22
    implicitWidth: row.implicitWidth + 16
    radius: 11
    color: Qt.rgba(tone.r, tone.g, tone.b, 0.12)
    border.color: tone
    border.width: 1

    RowLayout {
        id: row
        anchors.centerIn: parent
        spacing: 5
        Icon { name: "gate"; size: 11; color: chip.tone }
        StatusDot {
            state: !chip.enabledGate ? "idle" : (chip.activeCount > 0 ? "running" : "idle")
            size: 6
            showRing: chip.activeCount > 0
        }
        Label {
            visible: !chip.compact
            text: chip.ls ? chip.ls.gateLabel : ""
            color: chip.tone
            font.pixelSize: 10
            font.bold: true
        }
        Label {
            visible: chip.compact
            text: chip.activeCount + (chip.waitingCount > 0 ? " · đợi " + chip.waitingCount : "")
            color: chip.tone
            font.pixelSize: 10
            font.bold: true
        }
    }

    MouseArea {
        id: ma
        anchors.fill: parent
        hoverEnabled: true
        ToolTip.visible: containsMouse
        ToolTip.delay: 300
        ToolTip.text: {
            const st = chip.ls
            if (!st) return ""
            if (!st.gateEnabled)
                return "Cổng e2e liên làn đang TẮT (laneGateEnabled=false) — Shorts và Video dài được chen hàng nhau."
            let s = "Cổng e2e liên làn: video làn này phải đợi làn kia xong hẳn e2e (tải → render → đăng TikTok lượt đầu), xếp theo giờ phát hiện — không chen hàng.\n"
            const act = st.active
            if (act.length === 0) s += "\nMáy trống."
            for (let i = 0; i < act.length; i++)
                s += "\n● Đang giữ: [" + (act[i].lane === "short" ? "Shorts" : "Video dài") + (act[i].hot === false ? ", catch-up" : "") + "] " + (act[i].title || act[i].id)
            const w = st.waiting
            for (let j = 0; j < w.length; j++)
                s += "\n○ Đợi #" + (j + 1) + ": [" + (w[j].lane === "short" ? "Shorts" : "Video dài") + (w[j].hot === false ? ", catch-up" : "") + "] " + (w[j].title || w[j].id)
            s += "\n(Video real-time không đợi việc catch-up của làn kia — INVARIANT #32 giữ nguyên.)"
            if (st.forced > 0) s += "\n⚠ Đã mở ép " + st.forced + " lần vì quá trần đợi 15 phút."
            return s
        }
    }
}
