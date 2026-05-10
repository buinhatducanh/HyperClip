import re

with open('electron/main.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add po_token before each downloadVideo call
# Pattern: "const downloadStartMs = Date.now()\n    const result = await downloadVideo({"
old = "const downloadStartMs = Date.now()\n    const result = await downloadVideo({"
new = "const po_token = await getDownloadPoToken()\n    const downloadStartMs = Date.now()\n    const result = await downloadVideo({"

count = content.count(old)
print(f"Found {count} occurrences of downloadVideo pattern")
if count > 0:
    content = content.replace(old, new, count)
    print(f"Replaced {count} occurrences")
else:
    print("Pattern not found, trying simpler approach")
    # Simpler: find each "const result = await downloadVideo({" and add before
    pattern = "const downloadStartMs = Date.now()"
    count2 = content.count(pattern)
    print(f"Found {count2} occurrences of 'const downloadStartMs'")
    if count2 > 0:
        content = content.replace(pattern, "const po_token = await getDownloadPoToken()\n    " + pattern, count2)
        print(f"Replaced {count2} occurrences")

# Add po_token to the call arguments
# Find each downloadVideo call and add po_token parameter
# Pattern: "preFetchedDuration, // " and add "po_token,\n    " after it
old2 = "preFetchedDuration, // ← multi-instance uses this instead of re-probing"
new2 = "preFetchedDuration, // ← multi-instance uses this instead of re-probing\n      po_token,"
count3 = content.count(old2)
if count3 > 0:
    content = content.replace(old2, new2, count3)
    print(f"Added po_token param to {count3} calls")

with open('electron/main.ts', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
