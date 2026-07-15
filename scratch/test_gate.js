// Verify Pass-14 playability gate against real videos using the app's own
// youtubei.js bundle. Run: node scratch/test_gate.js (cwd = repo root)
const { Innertube } = require('youtubei.js');

const CASES = [
  ['dQw4w9WgXcQ', 'public control'],
  ['DJLHAneRK5A', 'private (failed 09:57)'],
  ['8qbEb3X6GBc', 'private (failed 09:57)'],
  ['dywskEiISr4', 'flipped public ~10:23'],
  ['zMs659GeXZg', 'flipped public ~10:25'],
  ['UPgHSEznYXk', 'flipped public ~10:30 (풋볼픽)'],
];

(async () => {
  const client = await Innertube.create({ retrieve_player: false });
  for (const [id, label] of CASES) {
    try {
      const info = await client.getBasicInfo(id);
      const st = info.playability_status?.status || 'unknown';
      const mf = info.microformat || {};
      const pd = mf.publish_date || mf.publishDate || null;
      const bi = info.basic_info || {};
      console.log(`${id} [${label}] -> playability=${st} upcoming=${!!bi.is_upcoming} dur=${bi.duration || 0}s publish_date=${pd ? new Date(pd).toISOString() : 'n/a'} title="${(bi.title || '').slice(0, 40)}"`);
    } catch (e) {
      console.log(`${id} [${label}] -> THROWS: ${e.message}`);
    }
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
