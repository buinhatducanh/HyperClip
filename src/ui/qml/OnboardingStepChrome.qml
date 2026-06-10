// src/ui/qml/OnboardingStepChrome.qml
// Step 1: Chrome OAuth login
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    ColumnLayout {
        anchors.centerIn: parent
        spacing: 16
        width: 500

        Label {
            text: "Đăng nhập YouTube qua Chrome"
            color: Theme.text; font.pixelSize: 30; font.bold: true
            Layout.alignment: Qt.AlignHCenter
        }
        Label {
            text: "HyperClip dùng Chrome cookies để bypass quota. Bấm OAuth Flow để bắt đầu."
            color: Theme.textMuted; font.pixelSize: 18
            wrapMode: Text.WordWrap
            Layout.alignment: Qt.AlignHCenter
            Layout.preferredWidth: 460
            horizontalAlignment: Text.AlignHCenter
        }
        Button {
            text: "Bắt đầu OAuth Flow"
            Layout.alignment: Qt.AlignHCenter
            Layout.preferredWidth: 200
            Layout.preferredHeight: 40
            onClicked: auth.start_oauth(backend)
        }
        Label {
            text: "Status: " + (auth.isReady ? "Authenticated" : "Not yet")
            color: auth.isReady ? Theme.success : Theme.textMuted
            font.pixelSize: 16
            Layout.alignment: Qt.AlignHCenter
        }
    }
}
