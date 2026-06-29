const { Innertube } = require('youtubei.js');
const fs = require('fs');
const path = require('path');

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Status: ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', (err) => reject(err));
  });
}

function getChromeCookies(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    let resolved = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Storage.getCookies'
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === 1) {
          resolved = true;
          ws.close();
          resolve(msg.result?.cookies || []);
        }
      } catch (e) {
        reject(e);
      }
    };

    ws.onerror = (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    };

    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        resolve([]);
      }
    };

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws.close(); } catch(_) {}
        resolve([]);
      }
    }, 5000);
  });
}

async function main() {
  try {
    console.log("Fetching browser version info from port 9222...");
    const versionInfo = await httpGetJson('http://127.0.0.1:9222/json/version');
    const wsUrl = versionInfo.webSocketDebuggerUrl;
    if (!wsUrl) {
      throw new Error("No webSocketDebuggerUrl found");
    }
    console.log("Connecting to Browser CDP WebSocket:", wsUrl);
    const cookies = await getChromeCookies(wsUrl);
    console.log(`Retrieved ${cookies.length} cookies from Chrome.`);

    // Filter and build cookie string
    const ytCookies = cookies.filter(c => c.domain.includes('youtube.com') || c.domain.includes('.google.com'));
    const cookieStr = ytCookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log(`Built cookie string with ${ytCookies.length} YouTube/Google cookies.`);

    console.log("Initializing Innertube client with Chrome cookies...");
    const yt = await Innertube.create({ cookie: cookieStr, retrieve_player: false });
    
    console.log("Fetching Subscriptions Feed...");
    const response = await yt.actions.execute('/browse', { browseId: 'FEsubscriptions' });
    
    console.log("Subscriptions Feed fetched! Saving response to sub_feed_cdp.json...");
    fs.writeFileSync(path.join(__dirname, 'sub_feed_cdp.json'), JSON.stringify(response, null, 2));

    // Let's parse the response and print the latest 10 videos
    const contents = response.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
    if (!contents) {
      console.log("No contents found in subscriptions feed.");
      return;
    }

    const videos = [];
    // The subscriptions feed is grouped by sections (e.g. Today, Yesterday, etc.)
    for (const section of contents) {
      const items = section.itemSectionRenderer?.contents?.[0]?.gridRenderer?.items 
                 || section.itemSectionRenderer?.contents?.[0]?.shelfRenderer?.content?.gridRenderer?.items
                 || [];
      for (const item of items) {
        const gridVideo = item.gridVideoRenderer;
        if (gridVideo) {
          const videoId = gridVideo.videoId;
          const title = gridVideo.title?.runs?.[0]?.text || gridVideo.title?.simpleText || '';
          const channelName = gridVideo.shortBylineText?.runs?.[0]?.text || '';
          const publishedText = gridVideo.publishedTimeText?.simpleText || '';
          videos.push({ videoId, title, channelName, publishedText });
        }
      }
    }

    console.log(`Found ${videos.length} videos in subscriptions feed:`);
    videos.slice(0, 10).forEach((v, i) => {
      console.log(`${i+1}. [${v.channelName}] ${v.videoId} - "${v.title}" (${v.publishedText})`);
    });

  } catch (err) {
    console.error("Error in main:", err);
  }
}

main();
