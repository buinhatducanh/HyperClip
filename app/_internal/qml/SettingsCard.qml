// src/ui/qml/SettingsCard.qml
// Reusable card wrapper for settings panels.
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: card
    default property alias content: body.data
    property string title: ""
    property color titleColor: Theme.text
    property int bodySpacing: Theme.spacingSm

    color: Theme.cardBg
    border.color: Theme.border
    border.width: 1
    radius: Theme.radiusLg
    implicitHeight: layout.implicitHeight + 2 * Theme.spacingLg

    ColumnLayout {
        id: layout
        anchors.fill: parent
        anchors.margins: Theme.spacingLg
        spacing: Theme.spacingSm

        Label {
            visible: card.title !== ""
            text: card.title
            color: card.titleColor
            font.pixelSize: Theme.textSm
            font.bold: true
            font.letterSpacing: 1.2
            Layout.fillWidth: true
        }

        ColumnLayout {
            id: body
            Layout.fillWidth: true
            spacing: card.bodySpacing
        }
    }
}
