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
  console.log("YouTube client created");

  const channelId = 'UCcGsDTH1Bypd8gWH1US1b4g';
  console.log(`Fetching channel: ${channelId}`);
  try {
    const channel = await yt.getChannel(channelId);
    const videos = await channel.getVideos();
    console.log(`Videos count: ${videos.videos.length}`);
    if (videos.videos.length > 0) {
      const item = videos.videos[0];
      console.log("Keys:", Object.keys(item));
      console.log("Published field details:", item.published);
      console.log("Item JSON:", JSON.stringify(item, null, 2).substring(0, 1000));
    }
  } catch (e) {
    console.error("Channel fetch failed:", e);
  }
}

test();
