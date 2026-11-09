const fs = require('fs');
const file = 'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/qml/main.qml';
let c = fs.readFileSync(file, 'utf8');

const oldCode = `    property bool tiktokLoaded: (typeof settings !== "undefined" && settings && settings.tiktokUploadEnabled) ? true : false
    property bool settingsLoaded: false

    Component.onCompleted: {
        if (typeof settings !== "undefined" && settings && settings.tiktokUploadEnabled) {
            root.tiktokLoaded = true
        }
    }`;

const newCode = `    property bool tiktokLoaded: false
    property bool settingsLoaded: false`;

c = c.replace(oldCode.replace(/\r?\n/g, '\r\n'), newCode.replace(/\r?\n/g, '\r\n'));
fs.writeFileSync(file, c, 'utf8');
console.log('main.qml patched successfully');

