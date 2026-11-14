const fs = require('fs');
const path = require('path');

// The checked-in resources helper is the single source of truth. Copying it
// avoids applying stale regex patches that can restore global split settings
// or the old synchronous Part 1 guard.
const canonicalFile = path.resolve(
  __dirname,
  '..',
  'HyperClip-TestCustomer-20260616-224538',
  'app',
  '_internal',
  'resources',
  'innertube_helper.js'
);

if (!fs.existsSync(canonicalFile)) {
  throw new Error(`Canonical helper not found: ${canonicalFile}`);
}

const workspaceRoot = path.resolve(__dirname, '..');
const targets = [
  path.resolve(workspaceRoot, 'HyperClip-TestCustomer-20260616-224538', 'app', '_internal', 'innertube_helper.js'),
  path.resolve('D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/resources/innertube_helper.js'),
  path.resolve('D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/innertube_helper.js'),
  path.resolve('D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/app/_internal/resources/innertube_helper.js'),
];

const source = fs.readFileSync(canonicalFile);
for (const targetFile of targets) {
  if (path.resolve(targetFile) === path.resolve(canonicalFile)) continue;
  if (!fs.existsSync(path.dirname(targetFile))) continue;
  fs.writeFileSync(targetFile, source);
  console.log('Synchronized:', targetFile);
}

console.log('Canonical innertube_helper.js synchronized.');
