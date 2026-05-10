import * as fs from 'fs';

let content = fs.readFileSync('electron/main.ts', 'utf8');
let changed = 0;

// Fix 1: Add node.exe dir to PATH in spawn env
const oldSpawn = `env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PORT: String(NEXT_PORT) },`;
const newSpawn = `env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PORT: String(NEXT_PORT), PATH: process.env.PATH ? process.env.PATH + path.delimiter + path.dirname(process.execPath) : path.dirname(process.execPath) },`;
if (content.includes(oldSpawn)) {
  content = content.replace(oldSpawn, newSpawn);
  console.log('Fixed spawn PATH');
  changed++;
}

// Fix 2: Add PO Token import
const poImport = `import { getInnertubePool } from './services/innertube_client.js'`;
if (!content.includes(poImport)) {
  const tokenMgrImport = `import { getTokenManager } from './services/token_manager.js'`;
  const idx = content.indexOf(tokenMgrImport);
  if (idx !== -1) {
    const insertAt = idx + tokenMgrImport.length;
    content = content.slice(0, insertAt) + '\n' + poImport + content.slice(insertAt);
    console.log('Added PO Token import');
    changed++;
  }
}

// Fix 3: Add getDownloadPoToken function
const poFunc = `
// Fetch PO Token for android client downloads. Cached 10 min. Null = web client fallback.
let _cachedPoToken: { token: string; profileId: string; fetchedAt: number } | null = null;
const PO_TOKEN_TTL_MS = 10 * 60 * 1000;
async function getDownloadPoToken(): Promise<string | null> {
  if (_cachedPoToken && Date.now() - _cachedPoToken.fetchedAt < PO_TOKEN_TTL_MS) return _cachedPoToken.token;
  try {
    const pool = await getInnertubePool();
    const session = await pool.getDownloadSession();
    if (session?.po_token) {
      _cachedPoToken = { token: session.po_token, profileId: session.profileId, fetchedAt: Date.now() };
      console.log(\`[PoToken] Using profile \${session.profileId} (\${session.po_token.slice(0,8)}...)\`);
      return session.po_token;
    }
  } catch (e) { console.log(\`[PoToken] Failed: \${e}\`); }
  return null;
}
`;
// Insert after getMaxConcurrentDownloads
const concurrentIdx = content.lastIndexOf('function getMaxConcurrentDownloads()');
if (concurrentIdx !== -1 && !content.includes('async function getDownloadPoToken')) {
  const funcEnd = content.indexOf('\nfunction', concurrentIdx + 10);
  const insertAt = content.lastIndexOf('}', funcEnd !== -1 ? funcEnd : content.length);
  content = content.slice(0, insertAt + 1) + poFunc + content.slice(insertAt + 1);
  console.log('Added getDownloadPoToken function at', insertAt);
  changed++;
}

// Fix 4: Add po_token parameter to downloadVideo calls
// Pattern: quality: autoQuality,\n      preFetchedDuration, or quality: autoQuality,\n      onProgress:
if (!content.includes('po_token: await getDownloadPoToken()')) {
  let added4 = 0;
  // Pattern A: quality: autoQuality,\n      preFetchedDuration,
  const patA = 'quality: autoQuality,\n      preFetchedDuration,';
  const repA = 'quality: autoQuality,\n      po_token: await getDownloadPoToken(),\n      preFetchedDuration,';
  if (content.includes(patA)) { content = content.split(patA).join(repA); added4++; console.log('Added po_token (quality path)'); }

  // Pattern B: quality: autoQuality,\n      onProgress:
  const patB = 'quality: autoQuality,\n      onProgress:';
  const repB = 'quality: autoQuality,\n      po_token: await getDownloadPoToken(),\n      onProgress:';
  if (content.includes(patB) && !content.includes(repB)) { content = content.split(patB).join(repB); added4++; console.log('Added po_token (quality+onProgress path)'); }

  // Pattern C: preFetchedDuration,\n      onProgress:
  const patC = 'preFetchedDuration,\n      onProgress:';
  const repC = 'po_token: await getDownloadPoToken(),\n      preFetchedDuration,\n      onProgress:';
  if (content.includes(patC) && !content.includes(repC)) { content = content.split(patC).join(repC); added4++; console.log('Added po_token (redownload path)'); }

  if (added4 === 0) console.log('WARNING: No downloadVideo patterns found');
  changed += added4;
}

fs.writeFileSync('electron/main.ts', content);
console.log(`Done. Changed=${changed}`);
