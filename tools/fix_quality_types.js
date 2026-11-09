const fs = require('fs');
const path = require('path');

const files = [
  path.resolve('HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/workspaces.json'),
  path.resolve('HyperClip-TestCustomer-20260616-224538/app/data/.hyperclip/workspaces.json'),
  path.resolve('HyperClip-Data/.hyperclip/workspaces.json'),
  path.join(process.env.APPDATA, 'HyperClip/.hyperclip/workspaces.json')
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    let fixed = 0;
    (data.workspaces || []).forEach(w => {
      if (typeof w.quality === 'string') { w.quality = null; fixed++; }
      if (typeof w.originalQuality === 'string') { w.originalQuality = null; fixed++; }
    });
    fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Fixed ${fixed} string quality fields in ${f}`);
  }
});
