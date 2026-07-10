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
    return;
  }

  const yt = await Innertube.create({ cookie: cookieStr, retrieve_player: false });
  console.log("YouTube client created with Netscape cookies");

  const playlistId = 'UUcGsDTH1Bypd8gWH1US1b4g';
  console.log(`Fetching playlist: ${playlistId}`);
  try {
    const playlist = await yt.getPlaylist(playlistId);
    console.log(`Playlist items count: ${playlist.items.length}`);
    if (playlist.items.length > 0) {
      const item = playlist.items[0];
      console.log("First item keys:", Object.keys(item));
      console.log("First item representation:", JSON.stringify({
        id: item.id,
        title: item.title,
        duration: item.duration,
        published: item.published,
      }, null, 2));
    }
  } catch (e) {
    console.error("Playlist fetch failed:", e);
  }
}

test();
