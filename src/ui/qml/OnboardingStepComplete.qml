// src/ui/qml/OnboardingStepComplete.qml
// Step 5: Done!
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    ColumnLayout {
        anchors.centerIn: parent
        spacing: 16

        Label {
            text: "🎉"
            font.pixelSize: 64
            Layout.alignment: Qt.AlignHCenter
        }
        Label {
            text: "Sẵn sàng!"
            color: Theme.success; font.pixelSize: 24; font.bold: true
            Layout.alignment: Qt.AlignHCenter
        }
        Label {
            text: "Bấm 'Hoàn tất' để bắt đầu bắt video 24/7"
            color: Theme.textMuted; font.pixelSize: 12
            Layout.alignment: Qt.AlignHCenter
        }
    }
}
