with open('D:/LOOP_COMPANY/HyperClip/electron/services/cookie_manager.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = """	    this._authWindow = new BrowserWindow({
	      width: 900,
	      height: 700,
	      title: 'HyperClip — YouTube Login',
	      backgroundColor: '#0f0f0f',
	      webPreferences: {
	        partition: PARTITION,
	        contextIsolation: true,
	        nodeIntegration: false,
	    this._authWindow.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')"""

new = """	    this._authWindow = new BrowserWindow({
	      width: 900,
	      height: 700,
	      title: 'HyperClip — YouTube Login',
	      backgroundColor: '#0f0f0f',
	      webPreferences: {
	        partition: PARTITION,
	        contextIsolation: true,
	        nodeIntegration: false,
	      },
	    })
	    // Set Chrome user agent so Google doesn't block the login window
	    this._authWindow.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')"""

if old in content:
    content = content.replace(old, new, 1)
    print("Fixed!")
else:
    print("NOT FOUND")
    # Find what's actually there
    for i, line in enumerate(content.split('\n')):
        if 'BrowserWindow' in line and '_authWindow' in line:
            print(f"Line {i+1}: {repr(line)}")

with open('D:/LOOP_COMPANY/HyperClip/electron/services/cookie_manager.ts', 'w', encoding='utf-8') as f:
    f.write(content)
