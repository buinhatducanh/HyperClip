const fs = require('fs');
const file = 'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/qml/TikTokPanel.qml';
let c = fs.readFileSync(file, 'utf8');

const oldConn = `    Connections {
            target: (typeof tiktokModel !== "undefined") ? tiktokModel : null
    function onChanged() {
        panel.refreshData()
        Qt.callLater(function () { panel.ensureSelection() })
    }
    }`;

const newConn = `    Connections {
    target: (typeof tiktokModel !== "undefined") ? tiktokModel : null
    ignoreUnknownSignals: true
    function onChanged() {
        panel.refreshEpoch++
        Qt.callLater(function () { panel.ensureSelection() })
    }
    }`;

c = c.replace(oldConn.replace(/\r?\n/g, '\r\n'), newConn.replace(/\r?\n/g, '\r\n'));
fs.writeFileSync(file, c, 'utf8');
console.log('TikTokPanel.qml patched successfully');
