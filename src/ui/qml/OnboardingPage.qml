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
            // Mark complete and exit
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
            color: "#0E0E0E"
            Label {
                anchors.centerIn: parent
                text: "HyperClip Setup"
                color: Theme.accent
                font.pixelSize: 18
                font.bold: true
            }
        }
        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

        // Step indicators
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 60
            Layout.leftMargin: 24
            Layout.rightMargin: 24
            spacing: 0
            Repeater {
                model: page.steps
                delegate: ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 4
                    Rectangle {
                        Layout.alignment: Qt.AlignHCenter
                        Layout.preferredWidth: 28
                        Layout.preferredHeight: 28
                        radius: 14
                        color: index <= page.currentStep ? Theme.accent : "#2A2A2A"
                        Label {
                            anchors.centerIn: parent
                            text: index + 1
                            color: index <= page.currentStep ? "white" : Theme.textMuted
                            font.pixelSize: 11
                            font.bold: true
                        }
                    }
                    Label {
                        Layout.alignment: Qt.AlignHCenter
                        text: modelData.label
                        color: index === page.currentStep ? Theme.accent
                             : index < page.currentStep ? Theme.success : Theme.textMuted
                        font.pixelSize: 10
                        font.bold: index === page.currentStep
                    }
                }
            }
        }

        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

        // Step content
        Loader {
            Layout.fillWidth: true
            Layout.fillHeight: true
            sourceComponent: {
                const k = page.steps[page.currentStep].key
                if (k === "chrome") return chromeStep
                if (k === "channels") return channelsStep
                if (k === "projects") return projectsStep
                if (k === "quality") return qualityStep
                return completeStep
            }
        }

        // Footer buttons
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 56
            color: "#0E0E0E"
            RowLayout {
                anchors.fill: parent
                anchors.margins: 16
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

    // Step content components
    Component { id: chromeStep
        Item {
            ColumnLayout {
                anchors.centerIn: parent
                spacing: 16
                width: 500
                Label {
                    text: "Đăng nhập YouTube qua Chrome"
                    color: Theme.text
                    font.pixelSize: 20
                    font.bold: true
                    Layout.alignment: Qt.AlignHCenter
                }
                Label {
                    text: "HyperClip dùng Chrome cookies để bypass quota. Bấm OAuth Flow để bắt đầu."
                    color: Theme.textMuted
                    font.pixelSize: 12
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
                    font.pixelSize: 11
                    Layout.alignment: Qt.AlignHCenter
                }
            }
        }
    }
    Component { id: channelsStep
        Item {
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 24
                spacing: 12
                Label {
                    text: "Thêm channels bạn muốn theo dõi"
                    color: Theme.text
                    font.pixelSize: 20
                    font.bold: true
                }
                AddChannelForm {}
                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    model: channelListModel
                    delegate: ChannelItem { width: ListView.view.width }
                }
            }
        }
    }
    Component { id: projectsStep
        Item {
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 24
                spacing: 12
                Label {
                    text: "OAuth projects (tuỳ chọn)"
                    color: Theme.text
                    font.pixelSize: 20
                    font.bold: true
                }
                Label {
                    text: "HyperClip ưu tiên Innertube (no quota). OAuth chỉ dùng làm fallback khi Innertube die."
                    color: Theme.textMuted
                    font.pixelSize: 12
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
                ProjectsPanel { Layout.fillWidth: true; Layout.fillHeight: true }
            }
        }
    }
    Component { id: qualityStep
        Item {
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 24
                spacing: 12
                Label {
                    text: "Chọn hardware profile"
                    color: Theme.text
                    font.pixelSize: 20
                    font.bold: true
                }
                HardwareProfileCard { Layout.fillWidth: true; Layout.preferredHeight: 240 }
            }
        }
    }
    Component { id: completeStep
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
                    color: Theme.success
                    font.pixelSize: 24
                    font.bold: true
                    Layout.alignment: Qt.AlignHCenter
                }
                Label {
                    text: "Bấm 'Hoàn tất' để bắt đầu bắt video 24/7"
                    color: Theme.textMuted
                    font.pixelSize: 12
                    Layout.alignment: Qt.AlignHCenter
                }
            }
        }
    }
}
