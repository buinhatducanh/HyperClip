// Test electron in different ways
console.log('Test 1: require electron directly');
try {
  const e = require('electron');
  console.log('require("electron"):', typeof e, typeof e === 'string' ? e.slice(0,50) : 'object');
  console.log('  has app?', !!e.app);
} catch(err) {
  console.log('Error:', err.message);
}

console.log('\nTest 2: Check process.versions');
console.log('process.versions.electron:', process.versions.electron);

console.log('\nTest 3: Check process.resourcesPath');
console.log('process.resourcesPath:', process.resourcesPath);

console.log('\nTest 4: Check globalThis');
console.log('globalThis.app:', typeof globalThis.app);
console.log('globalThis.shell:', typeof globalThis.shell);
