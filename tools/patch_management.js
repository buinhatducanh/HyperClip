const fs = require('fs');
const file = 'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/qml/ManagementPanel.qml';
let c = fs.readFileSync(file, 'utf8');

// 1. Guard detailRefreshTimer + add backendRetryTimer
const oldTimer = `    Timer {
        id: detailRefreshTimer
        interval: 300
        repeat: false
        onTriggered: {
            if (root.currentVideoId) {
                const resp = backend.send_command("workspace:managementGet", {"id": root.currentVideoId});
                if (resp && resp.ok !== false && resp.result) {
                    root.currentVideoData = resp.result;
                }
            }
        }
    }`;

const newTimer = `    Timer {
        id: detailRefreshTimer
        interval: 300
        repeat: false
        onTriggered: {
            if (root.currentVideoId && typeof backend !== "undefined" && backend && typeof backend.send_command === "function") {
                const resp = backend.send_command("workspace:managementGet", {"id": root.currentVideoId});
                if (resp && resp.ok !== false && resp.result) {
                    root.currentVideoData = resp.result;
                }
            }
        }
    }

    Timer {
        id: backendRetryTimer
        interval: 400
        repeat: false
        onTriggered: {
            if (root.workspaces.length === 0) {
                root.refreshList();
            }
        }
    }`;

c = c.replace(oldTimer.replace(/\r?\n/g, '\r\n'), newTimer.replace(/\r?\n/g, '\r\n'));

// 2. Guard refreshList
const oldRefresh = `    function refreshList() {

        listLoading = true

        errorText = ""

        const resp = backend.send_command("workspace:managementList")`;

const newRefresh = `    function refreshList() {

        listLoading = true

        errorText = ""

        if (typeof backend === "undefined" || !backend || typeof backend.send_command !== "function") {
            listLoading = false;
            backendRetryTimer.restart();
            return;
        }

        const resp = backend.send_command("workspace:managementList")`;

c = c.replace(oldRefresh.replace(/\r?\n/g, '\r\n'), newRefresh.replace(/\r?\n/g, '\r\n'));

// 3. Guard loadVideoDetail
const oldLoad = `        Qt.callLater(function() {

            const resp = backend.send_command("workspace:managementGet", {"id": id})`;

const newLoad = `        Qt.callLater(function() {

            if (typeof backend === "undefined" || !backend || typeof backend.send_command !== "function") {
                detailLoading = false;
                return;
            }

            const resp = backend.send_command("workspace:managementGet", {"id": id})`;

c = c.replace(oldLoad.replace(/\r?\n/g, '\r\n'), newLoad.replace(/\r?\n/g, '\r\n'));

fs.writeFileSync(file, c, 'utf8');
console.log('ManagementPanel.qml patched successfully');

