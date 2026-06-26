try {
  const ws = require('ws');
  console.log('ws is available:', typeof ws);
} catch (e) {
  console.error('ws is NOT available:', e.message);
}
