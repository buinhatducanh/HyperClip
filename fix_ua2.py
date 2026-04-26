with open('D:/LOOP_COMPANY/HyperClip/electron/services/cookie_manager.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

result = []
i = 0
while i < len(lines):
    line = lines[i]
    # Remove userAgent from WebPreferences block
    if 'userAgent:' in line and 'Chrome/124' in line:
        # Skip this line (the userAgent line)
        i += 1
        continue
    result.append(line)
    i += 1

content = ''.join(result)
# Now add webContents.setUserAgent after the BrowserWindow closing brace
# Find the line with 'nodeIntegration: false,' and add setUserAgent after the closing brace
lines2 = content.split('\n')
result2 = []
for idx, line in enumerate(lines2):
    result2.append(line)
    # After the WebPreferences closing brace, add setUserAgent
    if line.strip() == 'nodeIntegration: false,':
        # Check next non-empty line
        next_idx = idx + 1
        while next_idx < len(lines2) and lines2[next_idx].strip() == '}':
            result2.append("    this._authWindow.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')")
            break
        else:
            # Actually check if next non-blank line has closing brace
            for j in range(idx+1, len(lines2)):
                if lines2[j].strip() == '},':
                    result2.append("    this._authWindow.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')")
                    break
            break

with open('D:/LOOP_COMPANY/HyperClip/electron/services/cookie_manager.ts', 'w', encoding='utf-8') as f:
    f.write('\n'.join(result2))

print("Done")
# Verify the change
with open('D:/LOOP_COMPANY/HyperClip/electron/services/cookie_manager.ts', 'r', encoding='utf-8') as f:
    c = f.read()
    print("Has setUserAgent:", 'webContents.setUserAgent' in c)
    print("Has userAgent in WebPreferences:", 'userAgent:' in c)
