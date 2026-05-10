#!/usr/bin/env python3
import re

with open('electron/main.ts', 'r', encoding='utf-8') as f:
    content = f.read()

changed = 0

# Fix 1: Add PO Token import after token_manager import
po_import = "import { getInnertubePool } from './services/innertube_client.js'"
if po_import not in content:
    marker = "import { getTokenManager } from './services/token_manager.js'"
    idx = content.find(marker)
    if idx != -1:
        # Insert after token_manager import
        end = content.find('\n', idx + len(marker))
        content = content[:end] + '\n' + po_import + content[end:]
        print("Added PO Token import")
        changed += 1
    else:
        print("WARNING: token_manager import not found")
else:
    print("PO Token import already exists")

# Fix 2: Add getDownloadPoToken function after getMaxConcurrentDownloads
# Find getMaxConcurrentDownloads function and add our function after it
func_start = content.find("function getMaxConcurrentDownloads(")
if func_start == -1:
    func_start = content.find("getMaxConcurrentDownloads()")
if func_start != -1:
    # Find the end of this function (look for next function/export)
    # Search for the closing brace of this function
    # Look for the next 'export ' or 'function ' after this function
    search_start = func_start + 50
    next_func = content.find('\nfunction ', search_start)
    if next_func == -1:
        next_func = content.find('\nexport ', search_start)
    if next_func == -1:
        next_func = search_start + 2000  # fallback: far ahead

    # Find the closing } of getMaxConcurrentDownloads
    brace_count = 0
    func_body_start = content.find('{', func_start)
    i = func_body_start
    while i < next_func and i != -1:
        if content[i] == '{':
            brace_count += 1
        elif content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                # Found end of function
                insert_pos = i + 1
                break
        i += 1
    else:
        insert_pos = next_func

    po_func = """

// Fetch PO Token for android client downloads. Cached 10 min. Null = web client fallback.
let _cachedPoToken: { token: string; profileId: string; fetchedAt: number } | null = null
const PO_TOKEN_TTL_MS = 10 * 60 * 1000
async function getDownloadPoToken(): Promise<string | null> {
  if (_cachedPoToken && Date.now() - _cachedPoToken.fetchedAt < PO_TOKEN_TTL_MS) return _cachedPoToken.token
  try {
    const pool = await getInnertubePool()
    const session = await pool.getDownloadSession()
    if (session?.po_token) {
      _cachedPoToken = { token: session.po_token, profileId: session.profileId, fetchedAt: Date.now() }
      console.log(`[PoToken] Using profile ${session.profileId} (${session.po_token.slice(0, 8})...`)
      return session.po_token
    }
  } catch (e) {
    console.log(`[PoToken] Failed: ${e}`)
  }
  return null
}
"""
    content = content[:insert_pos] + po_func + content[insert_pos:]
    print(f"Added getDownloadPoToken function at pos {insert_pos}")
    changed += 1
else:
    print("WARNING: getMaxConcurrentDownloads not found")

# Fix 3: Add po_token parameter to downloadVideo calls
# Pattern: quality: autoQuality,\n      preFetchedDuration, or quality: autoQuality,\n      onProgress:
# We look for "quality: autoQuality," and add po_token parameter
# For each download call: "quality: autoQuality," -> "quality: autoQuality,\n      po_token: await getDownloadPoToken(),"
# Only add once (replace all occurrences)
old_quality = "quality: autoQuality,\n      preFetchedDuration,"
new_quality = "quality: autoQuality,\n      po_token: await getDownloadPoToken(),\n      preFetchedDuration,"
if old_quality in content and new_quality not in content:
    content = content.replace(old_quality, new_quality)
    print("Added po_token to quality+preFetchedDuration calls")
    changed += 1

old_quality2 = "quality: autoQuality,\n      onProgress:"
new_quality2 = "quality: autoQuality,\n      po_token: await getDownloadPoToken(),\n      onProgress:"
if old_quality2 in content and new_quality2 not in content:
    content = content.replace(old_quality2, new_quality2)
    print("Added po_token to quality+onProgress calls")
    changed += 1

# For redownload calls (no quality param): preFetchedDuration, orWorkspaceId, -> po_token,
old_redownload = "preFetchedDuration,\n      onProgress:"
new_redownload = "po_token: await getDownloadPoToken(),\n      preFetchedDuration,\n      onProgress:"
if old_redownload in content and new_redownload not in content:
    content = content.replace(old_redownload, new_redownload)
    print("Added po_token to redownload calls")
    changed += 1

# Also check for workspace retry pattern (no quality, no preFetchedDuration): workspaceId -> po_token
# Pattern: workspaceId,\n      trimLimit -> po_token, workspaceId
old_retry = "workspaceId,\n      trimLimit:"
new_retry = "po_token: await getDownloadPoToken(),\n      workspaceId,\n      trimLimit:"
if old_retry in content and new_retry not in content:
    content = content.replace(old_retry, new_retry)
    print("Added po_token to retry calls")
    changed += 1

with open('electron/main.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. Changed={changed}")
