// src/ui/qml/SettingsCard.qml
// Reusable card wrapper for settings panels
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    default property alias content: body.children
    property string title: ""
    property color titleColor: Theme.accent
    property int bodySpacing: 8

    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: bodySpacing

        // Header row (only shown if title is set)
        RowLayout {
            visible: title !== ""
            Layout.fillWidth: true
            spacing: 8

            Label {
                text: title
                visible: title !== ""
                color: titleColor
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
        }

        Item {
            id: body
            Layout.fillWidth: true
            Layout.fillHeight: true
        }
    }
}
