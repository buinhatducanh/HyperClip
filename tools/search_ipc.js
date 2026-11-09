const fs = require('fs');
const buf = fs.readFileSync('D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/hyperclip-tauri.exe');
const s = buf.toString('latin1');
const m = s.match(/(?:tcp|ws|http):\/\/[^\x00\s\"\'\`]+/gi) || [];
console.log(Array.from(new Set(m)).slice(0, 30));

