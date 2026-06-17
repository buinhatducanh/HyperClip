// src/ui/qml/OnboardingStepProjects.qml
// Step 3: OAuth projects (optional fallback)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 12

        Label {
            text: "OAuth projects (tuỳ chọn)"
            color: Theme.text; font.pixelSize: 30; font.bold: true
        }
        Label {
            text: "HyperClip ưu tiên Innertube (no quota). OAuth chỉ dùng làm fallback khi Innertube die."
            color: Theme.textMuted; font.pixelSize: 18
            wrapMode: Text.WordWrap; Layout.fillWidth: true
        }
        ProjectsPanel { Layout.fillWidth: true; Layout.fillHeight: true }
    }
}
