// src/ui/qml/SettingsCard.qml
// Reusable card wrapper for settings panels.
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: card
    default property alias content: body.data
    property string title: ""
    property color titleColor: Theme.accent
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
            font.pixelSize: Theme.textLg
            font.bold: true
            font.letterSpacing: 0.8
            Layout.fillWidth: true
        }

        ColumnLayout {
            id: body
            Layout.fillWidth: true
            spacing: card.bodySpacing
        }
    }
}
