// Test the exact regex from compiled main.js
const r = /^[A-Z]:[\/\\]/i;
const tests = [
  'D:/foo',
  'D:\\foo',
  'D:/HyperClip-Data/downloads/',
  '/absolute/path',
  'D:/HyperClip-Data/downloads/ws-abc_cmjOycxVKgE.mp4',
];
tests.forEach(t => console.log(JSON.stringify(t), ':', r.test(t)));
