// Find a getBasicInfo client config that cleanly separates public vs private.
const { Innertube } = require('youtubei.js');

const CASES = [
  ['dQw4w9WgXcQ', 'PUBLIC control'],
  ['DJLHAneRK5A', 'PRIVATE'],
  ['8qbEb3X6GBc', 'PRIVATE'],
];
const CLIENTS = [undefined, 'ANDROID', 'IOS', 'TV', 'WEB_EMBEDDED'];

(async () => {
  const client = await Innertube.create({ retrieve_player: false });
  for (const c of CLIENTS) {
    console.log(`--- client=${c || 'default(WEB)'} ---`);
    for (const [id, label] of CASES) {
      try {
        const info = await client.getBasicInfo(id, c ? { client: c } : undefined);
        const ps = info.playability_status || {};
        console.log(`  ${id} [${label}] status=${ps.status} reason="${(ps.reason || '').slice(0, 60)}"`);
      } catch (e) {
        console.log(`  ${id} [${label}] THROWS: ${e.message.slice(0, 80)}`);
      }
    }
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
