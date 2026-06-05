import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 4

        Label {
            text: "HyperClip"
            color: Theme.accent
            font.pixelSize: 16
            font.bold: true
        }

        Label {
            text: "24/7 YouTube auto-capture"
            color: Theme.textMuted
            font.pixelSize: 9
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: Theme.border
            Layout.topMargin: 4
            Layout.bottomMargin: 4
        }

        Item { Layout.fillHeight: true }
    }
}
