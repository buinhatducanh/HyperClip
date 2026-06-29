const { Innertube } = require('youtubei.js');
const fs = require('fs');
const path = require('path');

async function testSubscriptions() {
  try {
    let cookieStr = '';
    const cookiePath = path.join(__dirname, '..', 'data', 'cookies.txt');
    if (fs.existsSync(cookiePath)) {
      cookieStr = fs.readFileSync(cookiePath, 'utf-8').trim();
    } else {
      console.log("No cookies.txt found in data/");
      return;
    }

    console.log("Creating Innertube client...");
    const yt = await Innertube.create({ cookie: cookieStr, retrieve_player: false });
    
    console.log("Fetching Subscriptions Feed...");
    let subFeed;
    try {
      subFeed = await yt.feed.getSubscriptions();
    } catch (e) {
      console.log("yt.feed.getSubscriptions failed, trying direct browse browseId: FEsubscriptions...");
      subFeed = await yt.actions.execute('/browse', { browseId: 'FEsubscriptions' });
    }

    console.log("Subscriptions Feed fetched successfully!");
    
    fs.writeFileSync(path.join(__dirname, 'sub_feed_output.json'), JSON.stringify(subFeed, null, 2));
    console.log("Saved raw output to sub_feed_output.json");

    if (subFeed.contents) {
      console.log("Has contents structure.");
    }
  } catch (err) {
    console.error("Error testing subscriptions feed:", err);
  }
}

testSubscriptions();
