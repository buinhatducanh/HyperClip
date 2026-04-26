with open('D:/LOOP_COMPANY/HyperClip/electron/services/cookie_manager.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and fix the extra closing paren/quote in setUserAgent
old = "ses.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')"
new = 'ses.setUserAgent(\'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36\')'

if old in content:
    content = content.replace(old, new, 1)
    print("Fixed setUserAgent extra paren")
else:
    print("Not found:", repr(old))

# Also check for the local PARTITION shadowing in setCookiesIntoSession
# Remove the local const PARTITION since it shadows the module-level one
local_partition = "    const PARTITION = 'persist:hyperclip-yt'\n    const ses = session.fromPartition(PARTITION)"
module_partition = "    const ses = session.fromPartition(PARTITION)"
if local_partition in content:
    content = content.replace(local_partition, module_partition, 1)
    print("Removed local PARTITION shadowing")
else:
    print("Local PARTITION shadowing not found")

with open('D:/LOOP_COMPANY/HyperClip/electron/services/cookie_manager.ts', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
