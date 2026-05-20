# Read the file
with open('electron/services/youtube.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the formatSelector section
old = '''  // Priority: H.264 @ N -> any codec @ N -> H.264 @ lower -> any codec @ lower -> best.
  const formatSelector = [
    // H.264 @ target quality + AAC
    `bestvideo[height<=${maxHeight}][vcodec=h264]+bestaudio[acodec=aac]/bestvideo[height<=${maxHeight}][vcodec!=vp9][vcodec!=av1]+bestaudio[acodec=aac]/bestvideo[height<=${maxHeight}]+bestaudio/bestvideo+bestaudio/best`
    // H.264 @ lower quality + AAC
    bestvideo[height<=${maxHeight}][vcodec=h264]+bestaudio[acodec=aac]/bestvideo[height<=${maxHeight}][vcodec!=vp9][vcodec!=av1]+bestaudio[acodec=aac]/bestvideo+bestaudio/bestvideo+bestaudio/best
    // Any codec @ lower quality
    bestvideo+bestaudio[acodec=aac]/bestvideo+bestaudio/bestvideo+bestaudio/bestvideo/best
  ].join('/')'''

new = '''  // yt-dlp picks bestvideo+bestaudio, preferring higher resolution + better quality.
  // Priority: any codec @ target quality -> any codec @ lower quality -> bestvideo+bestaudio.
  const formatSelector = [
    // Any codec @ target quality + AAC (removes codec restrictions)
    `bestvideo[height<=${maxHeight}]+bestaudio[acodec=aac]/bestvideo[height<=${maxHeight}]+bestaudio/bestvideo+bestaudio/bestvideo+bestaudio`
    // Any codec @ any quality + best audio
    `bestvideo+bestaudio/bestvideo+bestaudio/bestvideo+bestaudio/bestvideo+bestaudio/best`
  ].join('/')'''

if old in content:
    content = content.replace(old, new)
    print('REPLACED successfully')
else:
    print('NOT FOUND')
    # Debug: show lines around formatSelector
    idx = content.find('formatSelector')
    if idx >= 0:
        print('Found at index', idx)
        print(repr(content[idx:idx+500]))
    else:
        print('formatSelector NOT FOUND in file')

with open('electron/services/youtube.ts', 'w', encoding='utf-8') as f:
    f.write(content)
