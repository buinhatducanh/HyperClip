const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'feed_test.json');
if (!fs.existsSync(filePath)) {
  console.log("No feed_test.json found.");
  process.exit(1);
}

const feed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const data = feed.data;

function findChannelIdInObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.browseId === 'string' && obj.browseId.startsWith('UC')) {
    return obj.browseId;
  }
  for (const key of Object.keys(obj)) {
    const res = findChannelIdInObject(obj[key]);
    if (res) return res;
  }
  return null;
}

const videos = [];

function traverse(obj) {
  if (!obj || typeof obj !== 'object') return;

  if (obj.lockupViewModel) {
    const lv = obj.lockupViewModel;
    const videoId = lv.contentId;
    const title = lv.metadata?.lockupMetadataViewModel?.title?.content || '';
    const channelId = findChannelIdInObject(lv) || '';
    
    let publishedText = '';
    const metadata = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel;
    if (metadata?.metadataRows) {
      for (const row of metadata.metadataRows) {
        if (!row?.metadataParts) continue;
        for (const part of row.metadataParts) {
          const text = part.text?.content || '';
          if (text.includes('ago') || text.includes('trước') || text.includes('hours') || text.includes('minutes') || text.includes('seconds') || text.includes('giây') || text.includes('phút') || text.includes('giờ')) {
            publishedText = text;
          }
        }
      }
    }

    if (videoId && videoId.length === 11) {
      videos.push({ videoId, title, channelId, publishedText });
    }
    return; // Don't traverse deeper inside lockupViewModel
  }

  if (obj.gridVideoRenderer) {
    const v = obj.gridVideoRenderer;
    const videoId = v.videoId;
    const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
    const channelId = findChannelIdInObject(v) || '';
    const publishedText = v.publishedTimeText?.simpleText || '';
    videos.push({ videoId, title, channelId, publishedText });
    return;
  }

  if (obj.videoRenderer) {
    const v = obj.videoRenderer;
    const videoId = v.videoId;
    const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
    const channelId = findChannelIdInObject(v) || '';
    const publishedText = v.publishedTimeText?.simpleText || '';
    videos.push({ videoId, title, channelId, publishedText });
    return;
  }

  for (const key of Object.keys(obj)) {
    traverse(obj[key]);
  }
}

traverse(data);

console.log(`Found ${videos.length} videos:`);
videos.slice(0, 10).forEach((v, i) => {
  console.log(`${i+1}. CID: ${v.channelId} | ${v.videoId} - "${v.title}" (${v.publishedText})`);
});
