const https = require('https');

function fetchUrl(url) {
    return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', () => resolve(''));
    });
}

(async () => {
    const html = await fetchUrl('https://www.youtube.com/channel/UCoRafJ6bR3AGF1cAFmf2dxA');
    // search for avatar url: yt3.googleusercontent.com or yt3.ggpht.com
    const m = html.match(/https:\/\/(?:yt3\.googleusercontent\.com|yt3\.ggpht\.com)\/[a-zA-Z0-9_\-=]+/g);
    if (m) {
        console.log('Found avatars:', Array.from(new Set(m)).slice(0, 3));
    } else {
        console.log('No avatar found in HTML');
    }
})();

