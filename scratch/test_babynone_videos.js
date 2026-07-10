const { Innertube } = require('youtubei.js');
const fs = require('fs');

function parseNetscapeCookies(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const cookies = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length >= 7) {
      const name = parts[5].trim();
      const value = parts[6].trim();
      cookies.push(`${name}=${value}`);
    }
  }
  return cookies.join('; ');
}

async function test() {
  const cookiesPath = 'D:\\LOOP_COMPANY\\HyperClip\\data\\cookies_netscape.txt';
  let cookieStr = '';
  try {
    cookieStr = parseNetscapeCookies(cookiesPath);
    console.log("Parsed cookies, length:", cookieStr.length);
  } catch (e) {
    console.error("Failed to parse Netscape cookies:", e.message);
  }

  const yt = await Innertube.create({ cookie: cookieStr, retrieve_player: false });
  console.log("YouTube client created");

  const channelId = 'UCE-PEoUbxALoKIJ2AoSyeqA'; // BadyNone
  const playlistId = 'UUE-PEoUbxALoKIJ2AoSyeqA'; // Uploads playlist

  console.log(`Fetching playlist: ${playlistId}`);
  try {
    const playlist = await yt.getPlaylist(playlistId);
    console.log(`Playlist items count: ${playlist.items ? playlist.items.length : 0}`);
    
    const memo = playlist.page?.contents_memo;
    if (memo) {
      const lockups = memo.get('LockupView') || [];
      console.log(`Found ${lockups.length} lockups in memo`);
      for (let i = 0; i < Math.min(lockups.length, 5); i++) {
        const lv = lockups[i];
        const metadata = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel 
                      || lv.metadata?.metadata;
        const title = lv.title?.content || lv.title?.text || lv.title;
        const videoId = lv.content_id || lv.id || lv.videoId;
        console.log(`[Lockup ${i}] id: ${videoId}, title: ${title}, has_metadata: ${!!metadata}`);
        if (metadata) {
          const rows = metadata.metadataRows || metadata.metadata_rows || [];
          console.log(`  rows: ${rows.length}`);
          for (const row of rows) {
            const parts = row.metadataParts || row.metadata_parts || [];
            for (const part of parts) {
              const text = part.text?.content || part.text?.text || part.text;
              console.log(`    text: "${JSON.stringify(text)}"`);
            }
          }
        }
      }
    } else {
      console.log("No page contents_memo found!");
    }
  } catch (e) {
    console.error("Playlist fetch failed:", e.message);
  }
}

test();
