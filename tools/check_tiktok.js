const fs = require('fs');
const c = fs.readFileSync('D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/resources/tiktok_helper.js', 'utf8');
const lines = c.split('\n');
lines.forEach((l, i) => {
    if (l.includes('cmd === "upload"') || l.includes('async function') || l.includes('handleUpload')) {
        console.log(i + 1, l);
    }
});

