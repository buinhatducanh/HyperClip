// src/ui/qml/OnboardingStepQuality.qml
// Step 4: GPU profile + render quality
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 12

        Label {
            text: "Chọn hardware profile"
            color: Theme.text; font.pixelSize: 20; font.bold: true
        }
        HardwareProfileCard { Layout.fillWidth: true; Layout.preferredHeight: 240 }
    }
}
