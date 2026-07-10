const { Innertube } = require('youtubei.js');

async function test() {
  const yt = await Innertube.create();
  console.log("YouTube client created");

  // UCcGsDTH1Bypd8gWH1US1b4g is a channel ID from the logs
  const channelId = 'UCcGsDTH1Bypd8gWH1US1b4g';
  const playlistId = 'UUcGsDTH1Bypd8gWH1US1b4g';

  console.log(`Fetching playlist: ${playlistId}`);
  try {
    const playlist = await yt.getPlaylist(playlistId);
    console.log(`Playlist items count: ${playlist.items.length}`);
    if (playlist.items.length > 0) {
      const item = playlist.items[0];
      console.log("First item properties:", Object.keys(item));
      console.log("First item JSON snippet:", JSON.stringify({
        id: item.id,
        title: item.title,
        duration: item.duration,
        published: item.published,
        video_info: item.video_info,
      }, null, 2));
    }
  } catch (e) {
    console.error("Playlist fetch failed:", e);
  }

  console.log(`Fetching channel: ${channelId}`);
  try {
    const channel = await yt.getChannel(channelId);
    const videos = await channel.getVideos();
    console.log(`Videos count from channel: ${videos.videos.length}`);
    if (videos.videos.length > 0) {
      const item = videos.videos[0];
      console.log("First video channel item properties:", Object.keys(item));
      console.log("First video channel item JSON snippet:", JSON.stringify({
        id: item.id,
        title: item.title,
        duration: item.duration,
        published: item.published,
        video_info: item.video_info,
      }, null, 2));
    }
  } catch (e) {
    console.error("Channel fetch failed:", e);
  }
}

test();
