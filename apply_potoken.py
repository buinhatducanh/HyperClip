import re

with open('electron/main.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add import for getInnertubePool
import_line = "import { getInnertubePool } from './services/innertube_client.js'"
if import_line not in content:
    # Insert after token_manager import
    marker = "import { getTokenManager } from './services/token_manager.js'"
    if marker in content:
        content = content.replace(marker, marker + '\n' + import_line)
        print("Added import")
    else:
        print("WARNING: token_manager import not found")

# 2. Add getDownloadPoToken function after the getMaxConcurrentDownloads function
po_token_func = '''
// Fetch PO Token for android client downloads (H.264 codec).
// Returns null if unavailable — download will use web client fallback.
let _cachedPoToken: { token: string; profileId: string; fetchedAt: number } | null = null
const PO_TOKEN_TTL_MS = 10 * 60 * 1000

async function getDownloadPoToken(): Promise<string | null> {
  if (_cachedPoToken && Date.now() - _cachedPoToken.fetchedAt < PO_TOKEN_TTL_MS) {
    return _cachedPoToken.token
  }
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
'''

# Find insertion point: after getMaxConcurrentDownloads function
marker = "function getMaxConcurrentDownloads()"
idx = content.rfind(marker)
if idx == -1:
    print("WARNING: getMaxConcurrentDownloads not found")
else:
    # Find the end of this function (look for next function or export)
    end_marker = "function enqueueBgDownload"
    end_idx = content.find(end_marker, idx)
    if end_idx == -1:
        print("WARNING: enqueueBgDownload not found")
    else:
        # Find the function closing brace before enqueueBgDownload
        # Look backwards from enqueueBgDownload for the closing }
        insert_idx = content.rfind('}', idx, end_idx)
        if insert_idx != -1:
            insert_idx += 1  # After the }
            content = content[:insert_idx] + po_token_func + content[insert_idx:]
            print(f"Added getDownloadPoToken at position {insert_idx}")
        else:
            print("WARNING: Could not find function end")

# 3. Add po_token to all downloadVideo calls
# Pattern: downloadVideo({ ... onProgress: ... })
# Need to add po_token parameter

# Find each occurrence of downloadVideo call and add po_token before onProgress
# Pattern: "po_token," already exists in some calls
# Pattern to find: "preFetchedDuration, // " or similar

# Find "preFetchedDuration," followed by "onProgress:"
# and insert "po_token," before it
patterns_to_try = [
    "preFetchedDuration, //",
    "quality: autoQuality,\n      preFetchedDuration,",
]

count = 0
for pat in patterns_to_try:
    if pat in content:
        new_pat = pat + "\n      po_token,"
        if new_pat not in content:
            content = content.replace(pat, new_pat)
            c = content.count(new_pat)
            print(f"Added po_token parameter after '{pat[:30]}' ({c} occurrences)")
            count += c

if count == 0:
    print("WARNING: Could not find downloadVideo parameter location")

# 4. Add getDownloadPoToken() call before downloadVideo calls
# Pattern: "const result = await downloadVideo({" or similar
# We need to add "const po_token = await getDownloadPoToken()\n" before it

download_patterns = [
    "const result = await downloadVideo({",
]

count2 = 0
for pat in download_patterns:
    if pat in content:
        new_pat = "const po_token = await getDownloadPoToken()\n    " + pat
        if new_pat not in content:
            content = content.replace(pat, new_pat)
            c = content.count(new_pat)
            print(f"Added getDownloadPoToken() call before '{pat}' ({c} occurrences)")
            count2 += c

# Also handle "const result = await downloadMultiInstanceDownload({"
multip = "const result = await downloadMultiInstanceDownload({"
if multip in content:
    new_multip = "const po_token = await getDownloadPoToken()\n    " + multip
    if new_multip not in content:
        content = content.replace(multip, new_multip)
        print("Added getDownloadPoToken before downloadMultiInstanceDownload")

with open('electron/main.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
