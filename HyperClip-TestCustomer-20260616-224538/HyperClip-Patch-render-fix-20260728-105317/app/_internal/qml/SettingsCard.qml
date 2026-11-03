// src/ui/qml/SettingsCard.qml
// Reusable card wrapper for settings panels.
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: card
    default property alias content: body.data
    property string title: ""
    property string iconName: ""          // optional leading icon (in accent chip)
    property string subtitle: ""          // optional muted one-liner under title
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
        anchors.margins: Theme.spacingMd
        spacing: Theme.spacingSm

        // ── Header: icon + eyebrow title (subtitle tuỳ chọn, gọn) ──
        RowLayout {
            visible: card.title !== ""
            Layout.fillWidth: true
            spacing: Theme.spacingSm

            Icon {
                visible: card.iconName !== ""
                name: card.iconName
                size: 14
                color: card.titleColor
                Layout.alignment: Qt.AlignVCenter
            }
            Label {
                text: card.title
                color: card.titleColor
                font.pixelSize: Theme.textSm
                font.bold: true
                font.letterSpacing: 0.8
                Layout.fillWidth: card.subtitle === ""
                Layout.alignment: Qt.AlignVCenter
            }
            Label {
                visible: card.subtitle !== ""
                text: card.subtitle
                color: Theme.textMuted
                font.pixelSize: Theme.textXs
                elide: Text.ElideRight
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignVCenter
            }
        }

        // Divider mảnh ngăn header với nội dung.
        Rectangle {
            visible: card.title !== ""
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: Theme.border
            opacity: 0.7
        }

        ColumnLayout {
            id: body
            Layout.fillWidth: true
            spacing: card.bodySpacing
        }
    }
}
