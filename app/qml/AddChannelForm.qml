// src/ui/qml/AddChannelForm.qml
// Input field for adding new channel (URL or @handle) with standardized Theme and IconButton.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    Layout.fillWidth: true
    Layout.preferredHeight: 34
    color: Theme.inputBg
    border.color: addInput.activeFocus ? Theme.accent : Theme.border
    border.width: 1
    radius: Theme.radiusMd

    property alias text: addInput.text
    signal addClicked(string url)

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 8
        anchors.rightMargin: 4
        spacing: 6

        TextField {
            id: addInput
            Layout.fillWidth: true
            placeholderText: "Dán link kênh hoặc @handle..."
            placeholderTextColor: Theme.textMuted
            color: Theme.text
            font.pixelSize: 11
            background: Rectangle { color: "transparent"; border.width: 0 }
            onAccepted: addBtn.clicked()
        }

        IconButton {
            id: addBtn
            iconName: "add"
            iconSize: 13
            variant: "accent"
            minWidth: 28
            minHeight: 28
            tooltipText: "Thêm kênh theo dõi"
            onClicked: {
                if (addInput.text.length === 0) return
                let url = addInput.text.trim()
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    // URL YouTube đầy đủ: giữ nguyên
                } else if (url.startsWith("@")) {
                    url = "https://www.youtube.com/" + url
                } else if (url.startsWith("UC") && url.length >= 22) {
                    url = "https://www.youtube.com/channel/" + url
                } else if (!url.includes(" ") && !url.includes("/") && url.length >= 3 && url.length <= 30 && /^[\w\.\-]+$/.test(url)) {
                    // Handle YouTube hợp lệ: thêm @
                    url = "https://www.youtube.com/@" + url
                } else {
                    // Tên hiển thị (như 'Nhật Đức Anh Bùi'): giữ nguyên để backend resolve chính xác
                }
                parent.parent.addClicked(url)
                addInput.text = ""
            }
        }
    }
}
