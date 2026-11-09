const fs = require('fs');
const path = require('path');

const dirs = [
    'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/qml',
    'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/app/_internal/qml'
];

for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    // 1. StatusGroup.qml
    const sgPath = path.join(dir, 'StatusGroup.qml');
    if (fs.existsSync(sgPath)) {
        let content = fs.readFileSync(sgPath, 'utf8');
        if (content.includes('channel_name: modelData.channel_name') && !content.includes('channel_id: modelData.channelId')) {
            content = content.replace(
                'channel_name: modelData.channel_name',
                'channel_name: modelData.channel_name\n            channel_id: modelData.channelId || modelData.channel_id || ""'
            );
            fs.writeFileSync(sgPath, content, 'utf8');
            console.log('Patched StatusGroup.qml in ' + dir);
        }
    }

    // 2. ChannelsStrip.qml
    const csPath = path.join(dir, 'ChannelsStrip.qml');
    if (fs.existsSync(csPath)) {
        let content = fs.readFileSync(csPath, 'utf8');
        if (!content.includes('ChannelAvatarFor')) {
            content = content.replace(
                'width: delegateLabel.implicitWidth + 32',
                'width: delegateLabel.implicitWidth + 56'
            );
            content = content.replace(
                /Rectangle\s*\{\s*width:\s*8;\s*height:\s*8;\s*radius:\s*4\s*color:\s*model\.paused\s*\?\s*Theme\.textMuted\s*:\s*Theme\.success\s*\}/,
                `Rectangle {
                        width: 8; height: 8; radius: 4
                        color: model.paused ? Theme.textMuted : Theme.success
                        Layout.alignment: Qt.AlignVCenter
                    }
                    ChannelAvatarFor {
                        channelKey: model.channelId || model.id || ""
                        fallbackName: model.name || ""
                        diameter: 18
                        Layout.alignment: Qt.AlignVCenter
                    }`
            );
            fs.writeFileSync(csPath, content, 'utf8');
            console.log('Patched ChannelsStrip.qml in ' + dir);
        }
    }

    // 3. VideoCompareModal.qml
    const vcmPath = path.join(dir, 'VideoCompareModal.qml');
    if (fs.existsSync(vcmPath)) {
        let content = fs.readFileSync(vcmPath, 'utf8');
        if (!content.includes('ChannelAvatarFor') && content.includes('text: "Kênh: " + dlg.channelName')) {
            content = content.replace(
                /Label\s*\{\s*text:\s*"Kênh:\s*"\s*\+\s*dlg\.channelName\s*\+\s*"\s*\("\s*\+\s*dlg\.channelId\s*\+\s*"\)"\s*color:\s*Theme\.accent\s*font\.pixelSize:\s*11\s*\}/,
                `RowLayout {
                        spacing: 6
                        ChannelAvatarFor {
                            channelKey: dlg.channelId || ""
                            fallbackName: dlg.channelName || ""
                            diameter: 16
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Label {
                            text: "Kênh: " + dlg.channelName + " (" + dlg.channelId + ")"
                            color: Theme.accent
                            font.pixelSize: 11
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }`
            );
            fs.writeFileSync(vcmPath, content, 'utf8');
            console.log('Patched VideoCompareModal.qml in ' + dir);
        }
    }

    // 4. ChannelPolicyTable.qml
    const cptPath = path.join(dir, 'ChannelPolicyTable.qml');
    if (fs.existsSync(cptPath)) {
        let content = fs.readFileSync(cptPath, 'utf8');
        let modified = false;

        // In table row: add avatar before row.chName
        if (!content.includes('ChannelAvatarFor') && content.includes('text: row.chName')) {
            content = content.replace(
                /Label\s*\{\s*text:\s*row\.chName\s*color:\s*Theme\.text\s*font\.pixelSize:\s*12\s*elide:\s*Text\.ElideRight\s*Layout\.fillWidth:\s*true\s*Layout\.minimumWidth:\s*0\s*\}/,
                `ChannelAvatarFor {
                            channelKey: row.chId || ""
                            fallbackName: row.chName || ""
                            diameter: 18
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Label {
                            text: row.chName
                            color: Theme.text
                            font.pixelSize: 12
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                            Layout.minimumWidth: 0
                            Layout.alignment: Qt.AlignVCenter
                        }`
            );
            modified = true;
        }

        // In policyEditor header icon: replace settings icon with channel avatar
        if (content.includes('policyEditor.chName') && content.includes('name: "settings"')) {
            content = content.replace(
                /Rectangle\s*\{\s*width:\s*32;\s*height:\s*32;\s*radius:\s*8\s*color:\s*Theme\.accent\s*\+\s*"20"\s*border\.color:\s*Theme\.accent\s*\+\s*"60"\s*border\.width:\s*1\s*Icon\s*\{\s*name:\s*"settings"[\s\S]*?\}\s*\}/,
                `ChannelAvatarFor {
                    channelKey: policyEditor.chId || ""
                    fallbackName: policyEditor.chName || ""
                    diameter: 32
                    Layout.alignment: Qt.AlignVCenter
                }`
            );
            modified = true;
        }

        if (modified) {
            fs.writeFileSync(cptPath, content, 'utf8');
            console.log('Patched ChannelPolicyTable.qml in ' + dir);
        }
    }
}

console.log('Done patch_all_avatars_v2');

