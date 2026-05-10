with open('electron/main.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Add node.exe to PATH in the spawn env
old_spawn_block = """nextServer = spawn('node', [nextBin, '-p', String(NEXT_PORT)], {
      cwd: nextDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PORT: String(NEXT_PORT) },
    })"""

new_spawn_block = """nextServer = spawn('node', [nextBin, '-p', String(NEXT_PORT)], {
      cwd: nextDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PORT: String(NEXT_PORT), PATH: process.env.PATH + path.delimiter + path.dirname(process.execPath) },
    })"""

if old_spawn_block in content:
    content = content.replace(old_spawn_block, new_spawn_block)
    print("Fixed spawn PATH")
else:
    print("Spawn block not found")

# Fix 2: Add PO Token import after token_manager import
import_line = "import { getInnertubePool } from './services/innertube_client.js'"
if import_line not in content:
    marker = "import { getTokenManager } from './services/token_manager.js'"
    if marker in content:
        content = content.replace(marker, marker + "\n" + import_line)
        print("Added PO Token import")
    else:
        print("WARNING: token_manager import not found")

# Fix 3: Add getDownloadPoToken function after getMaxConcurrentDownloads
po_token_func = """
// PO Token for android client downloads (H.264 codec).
// Cached 10 min to avoid hammering CDP. Null = web client fallback.
let _cachedPoToken: { token: string; profileId: string; fetchedAt: number } | null = null
const PO_TOKEN_TTL_MS = 10 * 60 * 1000
async function getDownloadPoToken(): Promise<string | null> {
  if (_cachedPoToken && Date.now() - _cachedPoToken.fetchedAt < PO_TOKEN_TTL_MS) return _cachedPoToken.token
  try {
    const pool = await getInnertubePool()
    const session = await pool.getDownloadSession()
    if (session?.po_token) {
      _cachedPoToken = { token: session.po_token, profileId: session.profileId, fetchedAt: Date.now() }
      console.log(`[PoToken] Using PO Token from profile ${session.profileId} (${session.po_token.slice(0, 8)}...)`)
      return session.po_token
    }
  } catch (e) {
    console.log(`[PoToken] Failed to get PO Token: ${e}`)
  }
  return null
}
"""

marker = "function getMaxConcurrentDownloads()"
idx = content.rfind(marker)
if idx == -1:
    print("WARNING: getMaxConcurrentDownloads not found")
else:
    # Find the end of this function (next export/function)
    # Look for next "function " after this one
    next_func = content.find("\nfunction ", idx + 20)
    if next_func != -1:
        insert_idx = content.rfind("}", idx, next_func)
        if insert_idx != -1:
            insert_idx += 1
            content = content[:insert_idx] + po_token_func + content[insert_idx:]
            print(f"Added getDownloadPoToken function")
        else:
            print("WARNING: Could not find function end")
    else:
        print("WARNING: Next function not found after getMaxConcurrentDownloads")

# Fix 4: Add po_token parameter to downloadVideo calls
# Find "quality: autoQuality," and add "po_token: await getDownloadPoToken()," after it
# This pattern appears before "preFetchedDuration," in downloadVideo calls
patterns = [
    "quality: autoQuality,\n      preFetchedDuration,",
    "quality: autoQuality,\n      onProgress:",
]
for pat in patterns:
    if pat in content:
        new_pat = pat.replace("quality: autoQuality,", "quality: autoQuality,\n      po_token: await getDownloadPoToken(),")
        content = content.replace(pat, new_pat)
        print(f"Added po_token after quality pattern: {repr(pat[:40])}")
        break
else:
    print("WARNING: quality pattern not found")

# Fix 5: Add po_token: po_token, before onProgress in the download call
# This is for the download calls that don't have quality parameter (retry/redownload)
# Look for "onProgress:" preceded by "preFetchedDuration,"
alt_pattern = "preFetchedDuration,\n      onProgress:"
if alt_pattern in content:
    new_alt = "preFetchedDuration,\n      po_token: await getDownloadPoToken(),\n      onProgress:"
    content = content.replace(alt_pattern, new_alt)
    print("Added po_token before onProgress")

with open('electron/main.ts', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
