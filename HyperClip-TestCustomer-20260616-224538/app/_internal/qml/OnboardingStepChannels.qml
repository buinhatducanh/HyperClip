// src/ui/qml/OnboardingStepChannels.qml
// Step 2: Add channels
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    id: stepRoot
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: Theme.spacingMd

        Label {
            text: "2. Danh sách kênh cần theo dõi"
            color: Theme.text; font.pixelSize: 26; font.bold: true
        }
        
        Label {
            text: "Nhập đường dẫn kênh (URL) hoặc @handle YouTube bạn muốn tự động bắt video. Hệ thống tự động gộp 50 kênh trong một request Data API v3 với sổ quota theo project, quản trị nhịp máy chuẩn xác và bắt video mới ngay khi xuất bản."
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            lineHeight: 1.2
        }

        AddChannelForm {
            id: addForm
            Layout.fillWidth: true
            onAddClicked: function(url) {
                if (channelListModel) {
                    channelListModel.add_channel(url)
                }
                if (activityModel) {
                    activityModel.add_entry("channel", "Đang thêm: " + url, "info")
                }
            }
        }

        // Action banner when at least 1 channel added
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 48
            color: Theme.accent + "20"
            border.color: Theme.accent
            border.width: 1
            radius: 8
            visible: chList.count > 0
            RowLayout {
                anchors.fill: parent
                anchors.margins: 8
                spacing: 12
                Label {
                    text: "✓ Đã thêm " + chList.count + " kênh vào danh sách theo dõi."
                    color: Theme.text
                    font.pixelSize: 13
                    font.bold: true
                    Layout.fillWidth: true
                }
                Button {
                    id: inlineNextBtn
                    text: "Tiếp tục sang bước 3 (Projects) →"
                    Layout.preferredHeight: 32
                    Layout.preferredWidth: 230
                    contentItem: Text {
                        text: inlineNextBtn.text
                        font.bold: true
                        font.pixelSize: 12
                        color: "white"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                    background: Rectangle {
                        color: inlineNextBtn.down ? Qt.darker(Theme.accent, 1.2) : (inlineNextBtn.hovered ? Qt.lighter(Theme.accent, 1.15) : Theme.accent)
                        radius: 6
                    }
                    onClicked: {
                        if (typeof stepLoader !== "undefined" && stepLoader.page) {
                            stepLoader.page.next()
                        } else if (typeof page !== "undefined" && page.next) {
                            page.next()
                        }
                    }
                }
            }
        }

        // Placeholder if no channels added yet
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 40
            color: Theme.hoverBg
            radius: 6
            visible: chList.count === 0
            RowLayout {
                anchors.fill: parent
                anchors.margins: 8
                Label {
                    text: "💡 Bạn có thể dán link kênh ở trên rồi bấm '+', hoặc bấm 'Tiếp →' bên dưới để cấu hình sau."
                    color: Theme.accent
                    font.pixelSize: 13
                    Layout.fillWidth: true
                }
            }
        }

        ListView {
            id: chList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: channelListModel
            clip: true
            spacing: 2
            delegate: ChannelItem {
                width: chList.width
                isPaused: model.paused
                newCount: model.newCount
                onPauseClicked: {
                    if (channelListModel) channelListModel.toggle_pause(model.id)
                }
                onDeleteClicked: {
                    if (channelListModel) channelListModel.remove_channel(model.id)
                }
                onCompareClicked: {}
            }
            
            ScrollBar.vertical: ScrollBar {
                active: true
            }
        }
    }
}
