const r = /^[A-Z]:[\/\\]/i
console.log('D:/foo:', r.test('D:/foo'))
console.log('D:\\foo:', r.test('D:\\foo'))
console.log('D:/HyperClip-Data/downloads/...:', r.test('D:/HyperClip-Data/downloads/...'))
console.log('local-video:///D:/HyperClip-Data/downloads/...:', 'D:/HyperClip-Data/downloads/...'.replace(/^local-video:\/\/?\/?/, ''))
