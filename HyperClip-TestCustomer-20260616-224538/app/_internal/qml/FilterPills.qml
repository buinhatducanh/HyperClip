// FilterPills.qml
// Hàng pill lọc theo trạng thái của hàng đợi.
//
// SỬA 18/08/2026 (lộ ra khi dựng tab làn): trước đây mỗi pill nằm trong một
// `Loader`, mà `Layout.preferredWidth/Height` là thuộc tính GẮN của Layout —
// chỉ có tác dụng khi item là con TRỰC TIẾP của Layout. Nằm trong Loader thì
// hai dòng đó vô nghĩa, Rectangle không có kích thước ẩn nào khác nên cả 5
// pill rộng 0 và chữ chồng đè lên nhau thành một cục ở mép trái (nội dung
// `anchors.centerIn` vẫn vẽ). Nay dùng `Repeater` — delegate là con trực tiếp
// của RowLayout — và bề rộng lấy từ chính nội dung thay vì đếm ký tự.
// Hàm `createPill(...)` cũ đã bỏ: không nơi nào gọi, và nó tạo object với
// parent null (không bao giờ hiện).
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

RowLayout {
    id: rootPill
    spacing: 4
    Layout.fillWidth: true

    property string current: "all"
    signal filterChanged(string value)

    Repeater {
        model: [
            { value: "all",         label: "Tất cả",    color: Theme.accent,  icon: "circle" },
            { value: "ready",       label: "Sẵn sàng",  color: Theme.success, icon: "ready" },
            { value: "rendering",   label: "Render",    color: Theme.accent,  icon: "rendering" },
            { value: "downloading", label: "Tải",       color: Theme.processing, icon: "downloading" },
            { value: "error",       label: "Lỗi",       color: Theme.error,   icon: "error" }
        ]
        delegate: Rectangle {
            id: pillRect
            required property var modelData
            readonly property bool on: rootPill.current === modelData.value
            Layout.preferredHeight: 22
            Layout.preferredWidth: pillRow.implicitWidth + 16
            radius: 11
            color: on ? modelData.color : Theme.cardBg
            border.color: on ? modelData.color : Theme.border
            border.width: 1

            Row {
                id: pillRow
                anchors.centerIn: parent
                spacing: 4
                Icon {
                    visible: pillRect.modelData.icon !== ""
                    name: pillRect.modelData.icon
                    size: 10
                    color: pillRect.on ? "white" : Theme.textMuted
                    anchors.verticalCenter: parent.verticalCenter
                }
                Label {
                    text: pillRect.modelData.label
                    color: pillRect.on ? "white" : Theme.textMuted
                    font.pixelSize: 11
                    font.bold: pillRect.on
                    anchors.verticalCenter: parent.verticalCenter
                }
            }
            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: rootPill.filterChanged(pillRect.modelData.value)
            }
        }
    }
    Item { Layout.fillWidth: true }
}
