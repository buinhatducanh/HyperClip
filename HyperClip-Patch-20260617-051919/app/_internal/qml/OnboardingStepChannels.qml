// src/ui/qml/OnboardingStepChannels.qml
// Step 2: Add channels
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 12

        Label {
            text: "Thêm channels bạn muốn theo dõi"
            color: Theme.text; font.pixelSize: 30; font.bold: true
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
