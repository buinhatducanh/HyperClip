const fs = require('fs');
const https = require('https');

const chPath = 'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/channels/channels.json';
const data = JSON.parse(fs.readFileSync(chPath, 'utf8'));
const channels = data.channels || data;

console.log('Testing avatars for', channels.length, 'channels...');

async function testUrl(url) {
    return new Promise((resolve) => {
        if (!url) return resolve({ status: 'EMPTY' });
        try {
            const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
                resolve({ status: res.statusCode });
            });
            req.on('error', err => resolve({ status: 'ERR: ' + err.message }));
            req.setTimeout(4000, () => {
                req.destroy();
                resolve({ status: 'TIMEOUT' });
            });
        } catch(e) {
            resolve({ status: 'EXC: ' + e.message });
        }
    });
}

(async () => {
    let ok = 0;
    let failed = 0;
    for (const c of channels) {
        const res = await testUrl(c.avatarUrl);
        if (res.status === 200) {
            ok++;
        } else {
            failed++;
            console.log(`Failed: ${c.name} (${c.handle || c.channelId}) -> ${res.status} [${c.avatarUrl ? c.avatarUrl.slice(0, 50) : 'NO_URL'}]`);
        }
    }
    console.log(`Summary: ${ok} OK, ${failed} Failed`);
})();

