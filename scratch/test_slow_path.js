const fs = require('fs');
const { Innertube } = require('youtubei.js');

async function testSlowPath() {
  const cookieStr = fs.readFileSync('data/cookies.txt', 'utf-8').trim();
  const channelId = "UCP0XXnFnS3hgAaQl0DrJgvA";
  
  console.log("Initializing Innertube client...");
  const yt = await Innertube.create({ cookie: cookieStr, retrieve_player: false });
  
  console.log("Fetching channel...");
  const channel = await yt.getChannel(channelId);
  
  console.log("--- strategyGetVideos ---");
  try {
    const videos = await channel.getVideos();
    const memo = videos.page?.contents_memo;
    if (memo) {
      const lockups = memo.get('LockupView') || [];
      console.log("getVideos returned", lockups.length, "LockupViews:");
      lockups.slice(0, 5).forEach(lv => {
        const videoId = lv.contentId || lv.content_id;
        const title = lv.metadata?.lockupMetadataViewModel?.title?.content || lv.metadata?.title?.text || '';
        console.log(`  - ${videoId}: "${title}"`);
      });
    } else {
      console.log("No contents_memo found");
    }
  } catch (e) {
    console.error("getVideos failed:", e.message);
  }

  console.log("--- strategySearch ---");
  try {
    const searchResult = await channel.search('');
    const list = searchResult.videos || [];
    console.log("search returned", list.length, "videos:");
    list.slice(0, 5).forEach(v => {
      const title = v.title?.text || v.title || '';
      console.log(`  - ${v.id || v.videoId}: "${title}"`);
    });
  } catch (e) {
    console.error("search failed:", e.message);
  }
}

testSlowPath();
