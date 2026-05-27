const fs = require('fs');
const sq = String.fromCharCode(39);
const bt = String.fromCharCode(96);
fs.writeFileSync('d:/LOOP_COMPANY/HyperClip/test.txt', sq+'hello'+sq, 'utf8');
console.log('ok');
