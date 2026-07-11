// src/ui/qml/OnboardingPage.qml
// 5-step wizard: Chrome / Channels / Projects / Quality / Complete
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: page
    color: Theme.bg
    property int currentStep: 0
    property var steps: [
        {key: "chrome", label: "Chrome", desc: "Đăng nhập YouTube qua Chrome"},
        {key: "channels", label: "Channels", desc: "Thêm channels bạn muốn theo dõi"},
        {key: "projects", label: "Projects", desc: "OAuth projects (Data API v3 fallback)"},
        {key: "quality", label: "Quality", desc: "Chọn GPU profile + render quality"},
        {key: "complete", label: "Complete", desc: "Xong — bắt đầu bắt video"},
    ]

    function next() {
        if (currentStep < steps.length - 1) {
            currentStep += 1
        } else {
            settings.onboardingComplete = true
            settings.save_to_backend(backend)
            page.visible = false
        }
    }
    function prev() { if (currentStep > 0) currentStep -= 1 }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // Header
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 50
            color: Theme.rowEven
            Label {
                anchors.centerIn: parent
                text: "Thiết lập HyperClip"
                color: Theme.accent; font.pixelSize: 27; font.bold: true
            }
        }
        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

        // Step indicators
        // Step indicators (fixed width alignment)
        Row {
            id: indicatorRow
            Layout.fillWidth: true
            Layout.preferredHeight: 65
            Layout.leftMargin: 24; Layout.rightMargin: 24
            
            readonly property real itemWidth: (width - 48) / page.steps.length
            
            Repeater {
                model: page.steps
                delegate: Item {
                    width: indicatorRow.itemWidth
                    height: 55
                    
                    ColumnLayout {
                        anchors.fill: parent
                        spacing: 4
                        Rectangle {
                            Layout.alignment: Qt.AlignHCenter
                            Layout.preferredWidth: 28; Layout.preferredHeight: 28; radius: 14
                            color: index <= page.currentStep ? Theme.accent : Theme.hoverBg
                            Label {
                                anchors.centerIn: parent
                                text: index + 1
                                color: index <= page.currentStep ? "white" : Theme.textMuted
                                font.pixelSize: 16; font.bold: true
                            }
                        }
                        Label {
                            Layout.alignment: Qt.AlignHCenter
                            text: modelData.label
                            color: index === page.currentStep ? Theme.accent
                                 : index < page.currentStep ? Theme.success : Theme.textMuted
                            font.pixelSize: Theme.textSm; font.bold: index === page.currentStep
                            elide: Text.ElideRight
                        }
                    }
                }
            }
        }

        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

        // Step content
        Loader {
            Layout.fillWidth: true; Layout.fillHeight: true
            source: {
                const k = page.steps[page.currentStep].key
                if (k === "chrome") return "OnboardingStepChrome.qml"
                if (k === "channels") return "OnboardingStepChannels.qml"
                if (k === "projects") return "OnboardingStepProjects.qml"
                if (k === "quality") return "OnboardingStepQuality.qml"
                return "OnboardingStepComplete.qml"
            }
        }

        // Footer buttons
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 56
            color: Theme.rowEven
            RowLayout {
                anchors.fill: parent; anchors.margins: 16
                Button {
                    text: "← Back"
                    enabled: page.currentStep > 0
                    onClicked: page.prev()
                }
                Item { Layout.fillWidth: true }
                Button {
                    text: "Skip"
                    onClicked: {
                        settings.onboardingComplete = true
                        settings.save_to_backend(backend)
                        page.visible = false
                    }
                }
                Button {
                    text: page.currentStep === page.steps.length - 1 ? "Hoàn tất" : "Tiếp →"
                    Layout.preferredWidth: 120
                    onClicked: page.next()
                }
            }
        }
    }
}
