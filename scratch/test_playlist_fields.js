const fs = require('fs');
const { Innertube } = require('youtubei.js');
const path = require('path');

async function testPlaylist() {
  try {
    let cookieStr = '';
    const cookiePath = path.join(__dirname, '..', 'data', 'cookies.txt');
    if (fs.existsSync(cookiePath)) {
      cookieStr = fs.readFileSync(cookiePath, 'utf-8').trim();
    } else {
      console.log("No cookies.txt found");
      return;
    }

    const channelId = "UCP0XXnFnS3hgAaQl0DrJgvA";
    const playlistId = channelId.replace(/^UC/, 'UU');

    const yt = await Innertube.create({ cookie: cookieStr, retrieve_player: false });
    const playlist = await yt.getPlaylist(playlistId);
    
    if (playlist.items && playlist.items.length > 0) {
      const item = playlist.items[0];
      console.log("Playlist item type constructor:", item.constructor.name);
      console.log("Playlist item keys:", Object.keys(item));
      // Dump keys of properties
      for (const k of Object.keys(item)) {
        if (typeof item[k] === 'object' && item[k] !== null) {
          console.log(`  - Key: ${k}, subkeys:`, Object.keys(item[k]));
        } else {
          console.log(`  - Key: ${k}, value:`, item[k]);
        }
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

testPlaylist();
