const fs = require('fs');
const path = require('path');

const dirs = [
    'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/qml',
    'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/app/_internal/qml'
];

for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    // 1. Patch TikTokPanel.qml
    const tiktokPath = path.join(dir, 'TikTokPanel.qml');
    if (fs.existsSync(tiktokPath)) {
        let content = fs.readFileSync(tiktokPath, 'utf8');

        // Remove url: modelData.avatarUrl || "" in chipRow (line ~1136)
        content = content.replace(
            /ChannelAvatarFor\s*\{[\s\S]*?channelKey:\s*modelData\.channelId\s*\|\|\s*""[\s\S]*?url:\s*modelData\.avatarUrl\s*\|\|\s*""[\s\S]*?diameter:\s*16/,
            `ChannelAvatarFor {
                                            channelKey: modelData.channelId || modelData.id || ""
                                            fallbackName: modelData.name || ""
                                            directUrl: modelData.avatarUrl || ""
                                            diameter: 18`
        );

        // Remove url: modelData.ch.avatarUrl || "" in picker list (line ~1213)
        content = content.replace(
            /ChannelAvatarFor\s*\{[\s\S]*?channelKey:\s*modelData\.ch\.channelId\s*\|\|\s*""[\s\S]*?url:\s*modelData\.ch\.avatarUrl\s*\|\|\s*""[\s\S]*?diameter:\s*20/,
            `ChannelAvatarFor {
                                        channelKey: modelData.ch.channelId || modelData.ch.id || ""
                                        fallbackName: modelData.ch.name || ""
                                        directUrl: modelData.ch.avatarUrl || ""
                                        diameter: 22`
        );

        fs.writeFileSync(tiktokPath, content, 'utf8');
        console.log('Patched TikTokPanel.qml in ' + dir);
    }

    // 2. Patch WorkspaceCardDisplay.qml
    const wsdPath = path.join(dir, 'WorkspaceCardDisplay.qml');
    if (fs.existsSync(wsdPath)) {
        let content = fs.readFileSync(wsdPath, 'utf8');

        // Add property string channel_id: "" if not present
        if (!content.includes('property string channel_id:')) {
            content = content.replace(
                'property string channel_name: ""',
                'property string channel_name: ""\n    property string channel_id: ""'
            );
        }

        // Replace Channel name row with avatar + label
        const oldLabel = `            // Channel name row\n            Label {\n                text: channel_name || "—"\n                color: Theme.accent\n                font.pixelSize: Theme.textSm\n                font.bold: true\n                elide: Text.ElideRight\n                Layout.fillWidth: true\n            }`;
        const newLabel = `            // Channel name row with avatar
            RowLayout {
                Layout.fillWidth: true
                spacing: 6
                ChannelAvatarFor {
                    channelKey: (typeof card !== "undefined" && card.channel_id) ? card.channel_id : (typeof channel_id !== "undefined" ? channel_id : "")
                    fallbackName: channel_name || ""
                    diameter: 16
                    Layout.alignment: Qt.AlignVCenter
                }
                Label {
                    text: channel_name || "—"
                    color: Theme.accent
                    font.pixelSize: Theme.textSm
                    font.bold: true
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                    Layout.alignment: Qt.AlignVCenter
                }
            }`;

        if (content.includes('// Channel name row\n            Label {')) {
            content = content.replace(
                /\/\/ Channel name row\r?\n\s*Label\s*\{[\s\S]*?text:\s*channel_name\s*\|\|\s*"—"[\s\S]*?Layout\.fillWidth:\s*true\r?\n\s*\}/,
                newLabel
            );
            fs.writeFileSync(wsdPath, content, 'utf8');
            console.log('Patched WorkspaceCardDisplay.qml in ' + dir);
        }
    }

    // 3. Patch WorkspaceCard.qml
    const wcPath = path.join(dir, 'WorkspaceCard.qml');
    if (fs.existsSync(wcPath)) {
        let content = fs.readFileSync(wcPath, 'utf8');
        if (!content.includes('property string channel_id:')) {
            content = content.replace(
                'property string channel_name: ""',
                'property string channel_name: ""\n    property string channel_id: ""'
            );
            content = content.replace(
                'channel_name: card.channel_name',
                'channel_name: card.channel_name\n        channel_id: card.channel_id'
            );
            fs.writeFileSync(wcPath, content, 'utf8');
            console.log('Patched WorkspaceCard.qml in ' + dir);
        }
    }

    // 4. Patch WorkspaceQueue.qml
    const wqPath = path.join(dir, 'WorkspaceQueue.qml');
    if (fs.existsSync(wqPath)) {
        let content = fs.readFileSync(wqPath, 'utf8');
        if (!content.includes('channel_id: model.channelId')) {
            content = content.replace(
                'channel_name: model.channel_name',
                'channel_name: model.channel_name\n                channel_id: model.channelId || model.channel_id || ""'
            );
            fs.writeFileSync(wqPath, content, 'utf8');
            console.log('Patched WorkspaceQueue.qml in ' + dir);
        }
    }

    // 5. Patch PollerPanel.qml
    const pollerPath = path.join(dir, 'PollerPanel.qml');
    if (fs.existsSync(pollerPath)) {
        let content = fs.readFileSync(pollerPath, 'utf8');
        const oldRow = `Label { text: "Kênh"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }\n                        Label { text: model.channelName || "—"; color: Theme.text; font.pixelSize: 12; elide: Text.ElideRight; Layout.fillWidth: true }`;
        const newRow = `Label { text: "Kênh"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        ChannelAvatarFor {
                            channelKey: model.channelId || ""
                            fallbackName: model.channelName || ""
                            diameter: 16
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Label { text: model.channelName || "—"; color: Theme.text; font.pixelSize: 12; elide: Text.ElideRight; Layout.fillWidth: true; Layout.alignment: Qt.AlignVCenter }`;

        if (content.includes('Label { text: "Kênh";') && !content.includes('ChannelAvatarFor {')) {
            content = content.replace(
                /Label\s*\{\s*text:\s*"Kênh";[\s\S]*?Label\s*\{\s*text:\s*model\.channelName\s*\|\|\s*"—";\s*color:\s*Theme\.text;\s*font\.pixelSize:\s*12;\s*elide:\s*Text\.ElideRight;\s*Layout\.fillWidth:\s*true\s*\}/,
                newRow
            );
            fs.writeFileSync(pollerPath, content, 'utf8');
            console.log('Patched PollerPanel.qml in ' + dir);
        }
    }

    // 6. Patch ManagementPanel.qml
    const mgmtPath = path.join(dir, 'ManagementPanel.qml');
    if (fs.existsSync(mgmtPath)) {
        let content = fs.readFileSync(mgmtPath, 'utf8');
        const oldMgmtLabel = `Label {\n                                        text: (modelData.channelName || modelData.channelId || modelData.channel_id || "—")\n                                            + " · " + root.fmtTimeAgo(modelData.createdAt, root.nowMs)`;
        if (content.includes('text: (modelData.channelName || modelData.channelId || modelData.channel_id || "—")') && !content.includes('ChannelAvatarFor {\n                                            channelKey: modelData.channelId')) {
            content = content.replace(
                /Label\s*\{\r?\n\s*text:\s*\(modelData\.channelName\s*\|\|\s*modelData\.channelId\s*\|\|\s*modelData\.channel_id\s*\|\|\s*"—"\)\r?\n\s*\+\s*" · "\s*\+\s*root\.fmtTimeAgo\(modelData\.createdAt,\s*root\.nowMs\)[\s\S]*?maximumLineCount:\s*1\r?\n\s*\}/,
                `RowLayout {
                                        Layout.fillWidth: true
                                        spacing: 6
                                        ChannelAvatarFor {
                                            channelKey: modelData.channelId || modelData.channel_id || ""
                                            fallbackName: modelData.channelName || ""
                                            diameter: 14
                                            Layout.alignment: Qt.AlignVCenter
                                        }
                                        Label {
                                            text: (modelData.channelName || modelData.channelId || modelData.channel_id || "—")
                                                + " · " + root.fmtTimeAgo(modelData.createdAt, root.nowMs)
                                                + ((modelData.partIndex && modelData.partIndex >= 1) ? "" : root.getPartsSummary(modelData.id))
                                            color: Theme.textMuted
                                            font.pixelSize: 10
                                            elide: Text.ElideRight
                                            Layout.fillWidth: true
                                            maximumLineCount: 1
                                            Layout.alignment: Qt.AlignVCenter
                                        }
                                    }`
            );
            fs.writeFileSync(mgmtPath, content, 'utf8');
            console.log('Patched ManagementPanel.qml in ' + dir);
        }
    }

    // 7. Patch DashboardGrid.qml
    const dashPath = path.join(dir, 'DashboardGrid.qml');
    if (fs.existsSync(dashPath)) {
        let content = fs.readFileSync(dashPath, 'utf8');
        if (content.includes('text: (model.channelName || "—") + " · " + (model.quality || "")') && !content.includes('ChannelAvatarFor')) {
            content = content.replace(
                /Label\s*\{\s*text:\s*\(model\.channelName\s*\|\|\s*"—"\)\s*\+\s*" · "\s*\+\s*\(model\.quality\s*\|\|\s*""\)\s*color:\s*Theme\.textMuted\s*font\.pixelSize:\s*11\s*\}/,
                `RowLayout {
                                                spacing: 6
                                                ChannelAvatarFor {
                                                    channelKey: model.channelId || ""
                                                    fallbackName: model.channelName || ""
                                                    diameter: 14
                                                    Layout.alignment: Qt.AlignVCenter
                                                }
                                                Label {
                                                    text: (model.channelName || "—") + " · " + (model.quality || "")
                                                    color: Theme.textMuted
                                                    font.pixelSize: 11
                                                    Layout.alignment: Qt.AlignVCenter
                                                }
                                            }`
            );
            fs.writeFileSync(dashPath, content, 'utf8');
            console.log('Patched DashboardGrid.qml in ' + dir);
        }
    }
}

console.log('Finished patching avatars everywhere!');

