const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'feed_test.json');
if (!fs.existsSync(filePath)) {
  console.log("No feed_test.json found.");
  process.exit(1);
}

const feed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const data = feed.data;

const videos = [];

function traverse(obj) {
  if (!obj || typeof obj !== 'object') return;

  if (obj.lockupViewModel) {
    const lv = obj.lockupViewModel;
    const videoId = lv.contentId;
    const title = lv.metadata?.lockupMetadataViewModel?.title?.content || '';
    
    // Find channel name
    let channelName = '';
    const metadata = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel;
    if (metadata?.metadataRows) {
      // Typically the first metadataRow contains the channel name
      const row = metadata.metadataRows[0];
      if (row?.metadataParts?.[0]) {
        channelName = row.metadataParts[0].text?.content || '';
      }
    }
    
    // Find relative time
    let publishedText = '';
    if (metadata?.metadataRows) {
      for (const row of metadata.metadataRows) {
        if (!row?.metadataParts) continue;
        for (const part of row.metadataParts) {
          const text = part.text?.content || '';
          if (text.includes('ago') || text.includes('trước') || text.includes('hours') || text.includes('minutes')) {
            publishedText = text;
          }
        }
      }
    }

    if (videoId && videoId.length === 11) {
      videos.push({ videoId, title, channelName, publishedText });
    }
  }

  if (obj.gridVideoRenderer) {
    const v = obj.gridVideoRenderer;
    const videoId = v.videoId;
    const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
    const channelName = v.shortBylineText?.runs?.[0]?.text || '';
    const publishedText = v.publishedTimeText?.simpleText || '';
    videos.push({ videoId, title, channelName, publishedText });
  }

  if (obj.videoRenderer) {
    const v = obj.videoRenderer;
    const videoId = v.videoId;
    const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
    const channelName = v.longBylineText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '';
    const publishedText = v.publishedTimeText?.simpleText || '';
    videos.push({ videoId, title, channelName, publishedText });
  }

  for (const key of Object.keys(obj)) {
    traverse(obj[key]);
  }
}

traverse(data);

// De-duplicate videos by videoId
const uniqueVideos = [];
const seenIds = new Set();
for (const v of videos) {
  if (!seenIds.has(v.videoId)) {
    seenIds.add(v.videoId);
    uniqueVideos.push(v);
  }
}

console.log(`Found ${uniqueVideos.length} unique videos in the feed:`);
uniqueVideos.slice(0, 30).forEach((v, i) => {
  console.log(`${i+1}. [${v.channelName}] ${v.videoId} - "${v.title}" (${v.publishedText})`);
});
