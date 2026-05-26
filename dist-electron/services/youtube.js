"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLatestVideosFromRss = getLatestVideosFromRss;
exports.getChannelMetadataFromHttp = getChannelMetadataFromHttp;
exports.getChannelId = getChannelId;
exports.getChannelInfo = getChannelInfo;
exports.getVideoInfo = getVideoInfo;
exports.probeVideoAvailability = probeVideoAvailability;
exports.probeActualDuration = probeActualDuration;
exports.probeAvailableFormats = probeAvailableFormats;
exports.downloadVideoStrategy = downloadVideoStrategy;
exports.preScaleVideo = preScaleVideo;
exports.downloadVideo = downloadVideo;
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const electron_1 = require("electron");
const ffmpeg_paths_js_1 = require("./ffmpeg-paths.js");
const ffmpeg_js_1 = require("./ffmpeg.js");
const unified_log_js_1 = require("./unified_log.js");
const system_js_1 = require("./system.js");
// ─── HTTP helpers ───────────────────────────────────────────────────────────────
function httpGet(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const req = https_1.default.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString()));
        });
        req.on('error', reject);
        req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
    });
}
// Fetch latest videos from a channel's RSS feed
async function getLatestVideosFromRss(channelId, limit = 3) {
    // Only use if it looks like a valid UC ID. If it's a handle, this will (and should) fail.
    if (!channelId || !channelId.startsWith('UC'))
        return [];
    const resolvedId = channelId;
    try {
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${resolvedId}`;
        const body = await httpGet(rssUrl);
        const videos = [];
        // Parse each <entry> block
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        while ((match = entryRegex.exec(body)) !== null && videos.length < limit) {
            const entry = match[1];
            const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
            const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
            const pubMatch = entry.match(/<published>([^<]+)<\/published>/);
            if (videoIdMatch) {
                videos.push({
                    videoId: videoIdMatch[1],
                    title: titleMatch ? titleMatch[1] : 'Unknown',
                    published: pubMatch ? pubMatch[1] : '',
                });
            }
        }
        return videos;
    }
    catch {
        return [];
    }
}
async function getChannelMetadataFromHttp(url) {
    // Extract channel ID from URL: /channel/UCxxx or /@handle or raw corrupted UC ID
    let channelId = '';
    let channelUrl = url;
    const channelMatch = url.match(/\/channel\/(UC[^/?]+)/);
    if (channelMatch) {
        channelId = channelMatch[1];
        channelUrl = `https://www.youtube.com/channel/${channelId}`;
    }
    else {
        const handleMatch = url.match(/\/@([^/?]+)/);
        if (handleMatch) {
            channelId = handleMatch[1];
            channelUrl = `https://www.youtube.com/@${channelId}`;
        }
        else if (url.startsWith('UC') && url.length > 20) {
            // Raw UC ID passed as URL — build proper channel URL
            channelId = url;
            channelUrl = `https://www.youtube.com/channel/${channelId}`;
        }
    }
    if (!channelId)
        return null;
    let resolvedId = channelId;
    let channelName = 'Unknown';
    let avatarUrl = '';
    // Check if the channelId looks like a real UC ID (exactly 24 chars: UC + 22 base64 chars)
    const isRealId = /^(UC[a-zA-Z0-9_-]{22})$/.test(resolvedId);
    if (!isRealId) {
        try {
            const body = await httpGet(channelUrl);
            // Search for channelId in the page source
            const idMatch = body.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/) ||
                body.match(/"browseId":"(UC[a-zA-Z0-9_-]{22})"/) ||
                body.match(/channel_id=(UC[a-zA-Z0-9_-]{22})/);
            if (idMatch) {
                resolvedId = idMatch[1];
            }
            else {
                // If we can't find the ID, return early to trigger yt-dlp fallback
                return { channelName: 'Unknown', channelId: '', avatarUrl: '', handle: url };
            }
        }
        catch {
            return { channelName: 'Unknown', channelId: '', avatarUrl: '', handle: url };
        }
    }
    // 2. Use YouTube RSS feed to get canonical channel name
    try {
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${resolvedId}`;
        const rssBody = await httpGet(rssUrl);
        const nameMatch = rssBody.match(/<title>([^<]+)<\/title>/);
        if (nameMatch)
            channelName = nameMatch[1];
    }
    catch (e) {
        console.warn(`[getChannelMetadataFromHttp] RSS failed for ${resolvedId}:`, e.message);
    }
    // 3. Scrape channel page HTML to get the correct avatar URL and channel name
    try {
        const resolvedUrl = `https://www.youtube.com/channel/${resolvedId}`;
        const pageBody = await httpGet(resolvedUrl);
        // Extract channel name if RSS failed
        if (channelName === 'Unknown') {
            const titleMatch = pageBody.match(/<title>([^<]+)\s+-\s+YouTube<\/title>/);
            if (titleMatch) {
                channelName = titleMatch[1];
            }
            else {
                // Try JSON metadata
                const jsonNameMatch = pageBody.match(/"title":"([^"]+)"/);
                if (jsonNameMatch)
                    channelName = jsonNameMatch[1];
            }
        }
        // Extract avatar from JSON data embedded in the page
        const avatarJsonMatch = pageBody.match(/"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/);
        if (avatarJsonMatch) {
            avatarUrl = avatarJsonMatch[1].replace(/=s\d+-c-k-c0x00ffffff-no-rj/, '=s100-c-k-c0x00ffffff-no-rj');
        }
        else {
            const ogMatch = pageBody.match(/og:image"[^>]*content="([^"]+)"/);
            if (ogMatch) {
                avatarUrl = ogMatch[1].replace(/=s\d+/, '=s100');
            }
        }
    }
    catch (e) {
        console.warn(`[getChannelMetadataFromHttp] Page scrape failed for ${resolvedId}:`, e.message);
    }
    // Final fallback for avatar
    if (!avatarUrl && resolvedId.startsWith('UC')) {
        avatarUrl = `https://yt3.googleusercontent.com/ytc/${resolvedId}=s100-c-k-c0x00ffffff-no-rj`;
    }
    const safeName = (channelName && channelName !== 'Unknown' && channelName !== 'N/A') ? channelName : '';
    return {
        channelName: safeName,
        channelId: resolvedId,
        avatarUrl,
        handle: url.includes('@') ? url : `https://www.youtube.com/channel/${resolvedId}`,
    };
}
// yt-dlp JS runtime args — modern yt-dlp requires a JS runtime for YouTube extraction.
// Without this, videos are incorrectly reported as "not available".
// Supported runtimes: deno, node, bun, quickjs
function getJsRuntimeArgs() {
    return ['--js-runtimes', 'node'];
}
// Find yt-dlp executable
function getYtdlpPath() {
    // 1. Bundled in resources/ (shipped with app)
    //    In dev mode: app.getAppPath() = project root (D:\...\HyperClip) → resources/yt-dlp/yt-dlp.exe ✓
    //    In prod:    process.resourcesPath = app.asar/resources              → yt-dlp/yt-dlp.exe ✓
    const appPath = electron_1.app?.getAppPath?.();
    if (appPath) {
        const devBundled = path_1.default.join(appPath, 'resources', 'yt-dlp', 'yt-dlp.exe');
        if (fs_1.default.existsSync(devBundled))
            return devBundled;
    }
    if (process.resourcesPath) {
        const prodBundled = path_1.default.join(process.resourcesPath, 'yt-dlp', 'yt-dlp.exe');
        if (fs_1.default.existsSync(prodBundled))
            return prodBundled;
    }
    // 2. node_modules/.bin (npm package — no Python needed if using bundled binary)
    const npmBin = path_1.default.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp');
    if (fs_1.default.existsSync(npmBin))
        return npmBin;
    const npmBinExe = path_1.default.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp.exe');
    if (fs_1.default.existsSync(npmBinExe))
        return npmBinExe;
    // 3. Common pip install locations (Roaming Python + Local Python Scripts)
    // Use os.homedir() for robust cross-user path resolution (env vars may be missing)
    const appDataRoaming = path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming');
    const appDataLocal = path_1.default.join(os_1.default.homedir(), 'AppData', 'Local');
    for (const ver of ['Python314', 'Python311', 'Python312', 'Python313']) {
        const roamingScripts = path_1.default.join(appDataRoaming, 'Python', ver, 'Scripts');
        const ytdlpExe = path_1.default.join(roamingScripts, 'yt-dlp.exe');
        if (fs_1.default.existsSync(ytdlpExe))
            return ytdlpExe;
        const ytdlpSh = path_1.default.join(roamingScripts, 'yt-dlp');
        if (fs_1.default.existsSync(ytdlpSh))
            return ytdlpSh;
        // Local Python install (AppData\Local\Programs)
        const localScripts = path_1.default.join(appDataLocal, 'Programs', 'Python', ver, 'Scripts');
        const localExe = path_1.default.join(localScripts, 'yt-dlp.exe');
        if (fs_1.default.existsSync(localExe))
            return localExe;
        const localSh = path_1.default.join(localScripts, 'yt-dlp');
        if (fs_1.default.existsSync(localSh))
            return localSh;
    }
    // 4. User-local AppData Roaming Python fallback
    const roamingPythonScripts = path_1.default.join(appDataRoaming, 'Python', 'Scripts');
    if (fs_1.default.existsSync(path_1.default.join(roamingPythonScripts, 'yt-dlp.exe'))) {
        return path_1.default.join(roamingPythonScripts, 'yt-dlp.exe');
    }
    // 4. PATH
    const pathEnv = process.env.PATH || '';
    for (const dir of pathEnv.split(path_1.default.delimiter)) {
        const ytdlp = path_1.default.join(dir, 'yt-dlp');
        if (fs_1.default.existsSync(ytdlp))
            return ytdlp;
    }
    // Fallback: assume in PATH
    return 'yt-dlp';
}
// ─── Simulated progress ticker ─────────────────────────────────────────────────
// Simulates download progress when yt-dlp is slow to emit real %. Prevents 0% stuck bar.
const _simTicker = new Map();
function stopSimulation(workspaceId) {
    const id = _simTicker.get(workspaceId);
    if (id !== undefined) {
        clearInterval(id);
        _simTicker.delete(workspaceId);
    }
}
function _simulateDownloadProgress(workspaceId, onProgress, durationSec, quality, trimLimitSec) {
    stopSimulation(workspaceId);
    // Estimate file size (MB) based on quality + duration
    const kbps = { '360': 800, '480': 1500, '720': 3000, '1080': 6000 };
    const speedKbps = kbps[quality] ?? 2000;
    const actualSec = trimLimitSec > 0 && trimLimitSec < durationSec ? trimLimitSec : durationSec;
    const estimatedSec = Math.max(10, (actualSec * speedKbps) / 4000); // generous estimate (kbps/4000 ≈ seconds for typical connection)
    const totalTicks = Math.floor(estimatedSec * 4); // update every ~250ms
    const tickMs = Math.max(150, Math.min(400, (estimatedSec * 1000) / totalTicks));
    let currentPct = 0;
    let stuckAt = 0; // if > 0, simulation is "stuck" waiting for real download
    const ticker = setInterval(() => {
        // Stop automatically when real progress has taken over (progressEmitted tracked by caller)
        if (!_simTicker.has(workspaceId)) {
            clearInterval(ticker);
            return;
        }
        if (stuckAt > 0) {
            // Stuck phase: advance very slowly (0.1-0.5%)
            const inc = 0.1 + Math.random() * 0.4;
            currentPct = Math.min(stuckAt + inc, stuckAt + 2);
            if (currentPct >= stuckAt + 2)
                stuckAt = 0; // unstick after 2%
        }
        else if (currentPct < 90) {
            // Normal phase: 0.1-2% per tick
            const inc = 0.1 + Math.random() * 1.9;
            currentPct = Math.min(currentPct + inc, 90);
            if (currentPct >= 88 && currentPct < 90)
                stuckAt = currentPct; // start stuck phase near 90%
        }
        else {
            // Finishing phase: 0.1-0.5%
            const inc = 0.1 + Math.random() * 0.4;
            currentPct = Math.min(currentPct + inc, 99.9);
        }
        const pct = Math.min(99.9, Math.max(0, currentPct));
        const speedMap = { '360': '2.5MiB/s', '480': '4.5MiB/s', '720': '9MiB/s', '1080': '18MiB/s' };
        const speed = speedMap[quality] ?? '5MiB/s';
        const remainingSec = Math.max(1, Math.round((estimatedSec * (100 - pct)) / 100));
        onProgress?.({ workspaceId, percent: pct, speed, eta: remainingSec, downloaded: '', total: '' });
    }, tickMs);
    _simTicker.set(workspaceId, ticker);
    return stopSimulation.bind(null, workspaceId);
}
async function getChannelId(videoUrl) {
    const ytdlp = getYtdlpPath();
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)(ytdlp, [
            ...getJsRuntimeArgs(),
            '--flat-playlist',
            '--print', '%(channel_id)s',
            '--no-download',
            '--no-playlist',
            videoUrl,
        ], {
            env: { ...process.env },
        });
        let stdout = '';
        proc.stdout?.on('data', (d) => { stdout += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0 && stdout.trim()) {
                const channelId = stdout.trim();
                // Valid YouTube channel ID starts with "UC"
                if (channelId.startsWith('UC')) {
                    resolve(channelId);
                    return;
                }
            }
            // Fallback: try to get from dump-json
            resolve(null);
        });
        proc.on('error', () => resolve(null));
        setTimeout(() => { proc.kill(); resolve(null); }, 15000);
    });
}
async function getChannelInfo(url) {
    // Try HTTP oEmbed first (fast, no external tool needed)
    const httpResult = await getChannelMetadataFromHttp(url);
    if (httpResult && httpResult.channelName !== 'Unknown') {
        return httpResult;
    }
    // Fall back to yt-dlp
    const ytdlp = getYtdlpPath();
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        const proc = (0, child_process_1.spawn)(ytdlp, [
            ...getJsRuntimeArgs(),
            '--dump-json',
            '--no-download',
            '--no-playlist',
            '--flat-playlist',
            url,
        ], {
            env: { ...process.env },
        });
        proc.stdout?.on('data', (d) => { stdout += d.toString(); });
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (code !== 0 || !stdout.trim()) {
                console.error('[yt-dlp] getChannelInfo failed:', stderr);
                resolve(null);
                return;
            }
            try {
                const firstLine = stdout.trim().split('\n')[0];
                const info = JSON.parse(firstLine);
                const avatarUrl = info.thumbnail || info.avatar || info.uploader_thumbnail || '';
                resolve({
                    channelName: (info.channel && info.channel !== 'N/A') ? info.channel : (info.uploader && info.uploader !== 'N/A') ? info.uploader : 'Unknown',
                    channelId: info.channel_id || '',
                    avatarUrl,
                    handle: info.channel_handle || info.uploader_url || '',
                });
            }
            catch {
                resolve(null);
            }
        });
        proc.on('error', () => resolve(null));
        setTimeout(() => { proc.kill(); resolve(null); }, 20000);
    });
}
async function getVideoInfo(videoUrl) {
    const ytdlp = getYtdlpPath();
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        const proc = (0, child_process_1.spawn)(ytdlp, [
            ...getJsRuntimeArgs(),
            '--dump-json',
            '--no-download',
            '--no-playlist',
            videoUrl,
        ], {
            env: { ...process.env },
        });
        proc.stdout?.on('data', (d) => { stdout += d.toString(); });
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (code !== 0 || !stdout.trim()) {
                console.error('[yt-dlp] getInfo failed:', stderr);
                resolve(null);
                return;
            }
            try {
                const info = JSON.parse(stdout.trim());
                resolve({
                    id: info.id || '',
                    title: info.title || 'Unknown',
                    thumbnail: info.thumbnail || '',
                    duration: info.duration || 0,
                    channelName: (info.channel && info.channel !== 'N/A') ? info.channel : (info.uploader && info.uploader !== 'N/A') ? info.uploader : 'Unknown',
                    channelId: info.channel_id || '',
                    uploadDate: info.upload_date || '',
                    fileSize: info.filesize || info.filesize_approx || 0,
                    resolution: info.resolution || 'unknown',
                    url: videoUrl,
                });
            }
            catch {
                resolve(null);
            }
        });
    });
}
/** Exponential backoff with jitter — avoids hammering YouTube during rate-limit windows. */
async function withExponentialBackoff(fn, maxAttempts = 4, baseDelayMs = 2000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const result = await fn();
            return result;
        }
        catch (err) {
            const is429 = String(err).includes('429') || String(err).includes('Too Many Requests');
            if (is429 && attempt < maxAttempts - 1) {
                // Exponential backoff: 2s, 4s, 8s + random jitter (0-2s)
                const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 2000;
                console.log(`[yt-dlp] Rate-limited (429) — retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 2}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw err;
        }
    }
    // Should not reach here but satisfy TypeScript
    return fn();
}
function buildYtDlpArgs(ytdlp, videoUrl, formatSelector, outputTemplate, sectionArg, instanceIdx, poToken, ytCookiesFile) {
    const args = [
        videoUrl,
        ...getJsRuntimeArgs(),
    ];
    // Quality strategy:
    // - With PO Token → android DASH bestvideo+bestaudio (1080p H.264)
    // - Without PO Token → web client with Chrome cookies (1080p VP9/H.264).
    //   web client works for most public videos. On "Private video" error, caller retries
    //   with tv_embedded client (more lenient, H.264 720p).
    let resolvedFormat;
    if (poToken) {
        args.push('--extractor-args', `youtube:player_client=android,po_token=${poToken}`);
        resolvedFormat = formatSelector; // DASH: bestvideo+bestaudio
        console.log(`[yt-dlp] Using android DASH with PO Token (${poToken.slice(0, 8)}...)`);
    }
    else {
        // web client: works with session cookies for most public videos.
        args.push('--extractor-args', 'youtube:player_client=web');
        resolvedFormat = formatSelector;
        console.log(`[yt-dlp] Using web client with cookies (best quality)`);
    }
    // Authenticate yt-dlp with Chrome cookies to bypass EJS anti-bot challenge
    if (ytCookiesFile) {
        args.push('--cookies', ytCookiesFile);
        console.log(`[yt-dlp] Using Chrome cookies: ${ytCookiesFile.split(/[/\\]/).pop()}`);
    }
    args.push('-f', resolvedFormat, '--output', outputTemplate, '--no-playlist', '--no-update', '--newline', '--concurrent-fragments', String((0, system_js_1.getDownloadParams)().fragments), '--retries', '3', '--fragment-retries', '3', '--socket-timeout', '10', '--http-chunk-size', '10485760', '--download-sections', sectionArg);
    return args;
}
function makeSectionArg(startSec, endSec) {
    const fmt = (s) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };
    return `*${fmt(startSec)}-${fmt(endSec)}`;
}
async function _multiInstanceDownload(opts) {
    const { workspaceId, videoUrl, outputDir, formatSelector, trimLimit, instanceCount, onProgress, ytdlp, preFetchedDuration, retryStrategy = 'immediate', poToken, ytCookiesFile } = opts;
    // OPTIMIZATION #1: Skip sequential duration probe if caller already has it.
    // autoDownloadFromWebSub fetches videoInfo in parallel with download, so it's already available.
    // Saves ~1-3s network round-trip per download.
    let videoDurationSec = trimLimit * 60;
    if (preFetchedDuration && preFetchedDuration > 0) {
        videoDurationSec = Math.min(preFetchedDuration, trimLimit * 60);
        console.log(`[yt-dlp] Multi-instance: using pre-fetched duration ${videoDurationSec}s (skip probe)`);
    }
    else {
        // Fallback: probe only if no pre-fetched duration (manual downloads, etc.)
        try {
            const info = await getVideoInfo(videoUrl);
            if (info?.duration && info.duration > 0) {
                videoDurationSec = Math.min(info.duration, trimLimit * 60);
                console.log(`[yt-dlp] Multi-instance: probed duration ${videoDurationSec}s`);
            }
        }
        catch {
            // Probing failed — use trimLimit as estimated duration
        }
    }
    if (videoDurationSec < 30) {
        // Video too short for multi-instance splitting — fall back to single
        return null;
    }
    // Split into N equal sections
    const sectionDuration = videoDurationSec / instanceCount;
    const sections = [];
    for (let i = 0; i < instanceCount; i++) {
        const start = i * sectionDuration;
        const end = i === instanceCount - 1 ? videoDurationSec : (i + 1) * sectionDuration;
        sections.push({ start, end, label: String(i).padStart(2, '0') });
    }
    console.log(`[yt-dlp] Multi-instance: splitting ${videoDurationSec}s into ${instanceCount} sections`);
    sections.forEach(s => {
        console.log(`  Instance ${s.label}: ${makeSectionArg(s.start, s.end)}`);
    });
    const ffmpegPath = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    const ffmpegDir = path_1.default.dirname(ffmpegPath);
    const ytDlpDir = path_1.default.dirname(ytdlp);
    const enrichedPath = ffmpegDir + path_1.default.delimiter + ytDlpDir + path_1.default.delimiter + (process.env.PATH || '');
    // OPTIMIZATION #3: Try RAM disk for fragment cache on Linux (tmpfs).
    // On Windows, yt-dlp uses temp dir — already fine. On Linux, this can save disk I/O.
    // Add --cache-dir if running on Linux tmpfs mount
    let cacheDirArgs = [];
    if (process.platform === 'linux') {
        // /dev/shm is Linux RAM disk (typically 50% of RAM)
        cacheDirArgs = ['--cache-dir', '/dev/shm/yt-dlp-cache'];
    }
    // Spawn N yt-dlp instances in parallel
    const chunkFiles = [];
    const completedInstances = { count: 0 };
    const progressPerInstance = 100 / instanceCount;
    const downloadPromises = sections.map((section, idx) => {
        return new Promise((resolve) => {
            const outputTemplate = path_1.default.join(outputDir, `${workspaceId}_part${String(idx).padStart(2, '0')}_%(id)s.%(ext)s`);
            const args = [
                ...buildYtDlpArgs(ytdlp, videoUrl, formatSelector, outputTemplate, makeSectionArg(section.start, section.end), idx, poToken, ytCookiesFile),
                ...cacheDirArgs,
            ];
            const proc = (0, child_process_1.spawn)(ytdlp, args, {
                env: { ...process.env, PATH: enrichedPath },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stderr = '';
            let downloadedFile = '';
            let instanceProgress = 0;
            proc.stdout?.on('data', (data) => {
                const text = data.toString();
                const pctMatch = text.match(/(\d+\.?\d*)%/);
                if (pctMatch) {
                    const pct = parseFloat(pctMatch[1]);
                    if (pct >= 0 && pct <= 100) {
                        instanceProgress = pct;
                        // Aggregate: completed instances' 100% + this instance's current %
                        const total = completedInstances.count * progressPerInstance + (instanceProgress / 100) * progressPerInstance;
                        onProgress?.({ workspaceId, percent: total, speed: '', eta: '', downloaded: '', total: '' });
                    }
                }
                const destMatch = text.match(/Dest(?:ination)?:\s*(.+)/);
                if (destMatch)
                    downloadedFile = destMatch[1].trim();
                const mergeMatch = text.match(/Merging formats into "(.+)"/);
                if (mergeMatch)
                    downloadedFile = mergeMatch[1];
            });
            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
                const pctMatch = data.toString().match(/(\d+\.?\d*)%/);
                if (pctMatch) {
                    const pct = parseFloat(pctMatch[1]);
                    if (pct >= 0 && pct <= 100) {
                        instanceProgress = pct;
                        const total = completedInstances.count * progressPerInstance + (instanceProgress / 100) * progressPerInstance;
                        onProgress?.({ workspaceId, percent: total, speed: '', eta: '', downloaded: '', total: '' });
                    }
                }
                const destMatch = data.toString().match(/Dest(?:ination)?:\s*(.+)/);
                if (destMatch && !downloadedFile)
                    downloadedFile = destMatch[1].trim();
                const mergeMatch = data.toString().match(/Merging formats into "(.+)"/);
                if (mergeMatch)
                    downloadedFile = mergeMatch[1];
                // Detect FFmpeg post-processing start → freeze progress bar
                const str = data.toString();
                if (str.includes('Deleting original') || str.includes('Merging formats')) {
                    onProgress?.({ workspaceId, percent: 99, speed: 'processing', eta: 0, downloaded: '', total: '' });
                }
            });
            proc.on('close', (code) => {
                if (!downloadedFile) {
                    try {
                        const files = fs_1.default.readdirSync(outputDir);
                        const match = files.find(f => f.startsWith(`${workspaceId}_part${String(idx).padStart(2, '0')}_`) && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f));
                        if (match)
                            downloadedFile = path_1.default.join(outputDir, match);
                    }
                    catch { }
                }
                completedInstances.count++;
                if (code === 0 && downloadedFile) {
                    chunkFiles[idx] = downloadedFile;
                    resolve({ success: true, filePath: downloadedFile, idx });
                }
                else {
                    const err = stderr.includes('ERROR') ? stderr.split('\n').find(l => l.includes('ERROR')) : `code ${code}`;
                    resolve({ success: false, error: err || `instance ${idx} failed`, idx });
                }
            });
            setTimeout(() => {
                if (!proc.killed)
                    proc.kill();
                resolve({ success: false, error: `instance ${idx} timeout`, idx });
            }, 15 * 60 * 1000); // 15 min per instance
        });
    });
    const results = await Promise.all(downloadPromises);
    const failedInstances = results.filter(r => !r.success);
    if (failedInstances.length > 0) {
        // OPTIMIZATION #6: Exponential backoff retry — if any instances failed, retry once with backoff
        if (retryStrategy === 'exponential' && failedInstances.length > 0) {
            console.log(`[yt-dlp] Retrying ${failedInstances.length} failed instances with exponential backoff...`);
            try {
                const retryResults = await withExponentialBackoff(async () => {
                    const retryPromises = failedInstances.map(async (failedResult) => {
                        const sectionIdx = failedResult.idx;
                        const section = sections[sectionIdx];
                        const outputTemplate = path_1.default.join(outputDir, `${workspaceId}_part${String(sectionIdx).padStart(2, '0')}_%(id)s.%(ext)s`);
                        const args = [
                            ...buildYtDlpArgs(ytdlp, videoUrl, formatSelector, outputTemplate, makeSectionArg(section.start, section.end), sectionIdx, poToken, ytCookiesFile),
                            ...cacheDirArgs,
                        ];
                        return new Promise((resolve) => {
                            const proc = (0, child_process_1.spawn)(ytdlp, args, { env: { ...process.env, PATH: enrichedPath }, stdio: ['ignore', 'pipe', 'pipe'] });
                            let stderr = '';
                            let downloadedFile = '';
                            proc.stdout?.on('data', (data) => {
                                const text = data.toString();
                                const destMatch = text.match(/Dest(?:ination)?:\s*(.+)/);
                                if (destMatch)
                                    downloadedFile = destMatch[1].trim();
                                const mergeMatch = text.match(/Merging formats into "(.+)"/);
                                if (mergeMatch)
                                    downloadedFile = mergeMatch[1];
                            });
                            proc.stderr?.on('data', (data) => { stderr += data.toString(); });
                            proc.on('close', (code) => {
                                if (!downloadedFile) {
                                    try {
                                        const files = fs_1.default.readdirSync(outputDir);
                                        const match = files.find(f => f.startsWith(`${workspaceId}_part${String(sectionIdx).padStart(2, '0')}_`) && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f));
                                        if (match)
                                            downloadedFile = path_1.default.join(outputDir, match);
                                    }
                                    catch { }
                                }
                                if (code === 0 && downloadedFile) {
                                    chunkFiles[sectionIdx] = downloadedFile;
                                    resolve({ success: true, filePath: downloadedFile, idx: sectionIdx });
                                }
                                else {
                                    const err = stderr.includes('ERROR') ? stderr.split('\n').find(l => l.includes('ERROR')) : `code ${code}`;
                                    resolve({ success: false, error: err || `instance ${sectionIdx} retry failed`, idx: sectionIdx });
                                }
                            });
                            setTimeout(() => { if (!proc.killed)
                                proc.kill(); resolve({ success: false, error: `timeout`, idx: sectionIdx }); }, 15 * 60 * 1000);
                        });
                    });
                    return Promise.all(retryPromises);
                });
                const retryFailed = retryResults.filter(r => !r.success);
                if (retryFailed.length > 0) {
                    console.warn(`[yt-dlp] ${retryFailed.length} instances still failed after retry — falling back to single-instance`);
                    for (const file of chunkFiles) {
                        if (file)
                            try {
                                fs_1.default.unlinkSync(file);
                            }
                            catch { }
                    }
                    return null;
                }
                console.log(`[yt-dlp] All instances succeeded after retry`);
            }
            catch {
                console.warn(`[yt-dlp] Exponential backoff retry failed — falling back to single-instance`);
                for (const file of chunkFiles) {
                    if (file)
                        try {
                            fs_1.default.unlinkSync(file);
                        }
                        catch { }
                }
                return null;
            }
        }
        else {
            console.warn(`[yt-dlp] ${failedInstances.length}/${instanceCount} instances failed — falling back to single-instance download`);
            for (const file of chunkFiles) {
                if (file)
                    try {
                        fs_1.default.unlinkSync(file);
                    }
                    catch { }
            }
            return null;
        }
    }
    console.log(`[yt-dlp] All ${instanceCount} instances complete — merging with FFmpeg concat`);
    // Merge all sections with FFmpeg concat demuxer (stream copy — no re-encode, very fast)
    const concatListFile = path_1.default.join(outputDir, `${workspaceId}_concat.txt`);
    const concatList = chunkFiles.filter((f) => !!f).map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
    fs_1.default.writeFileSync(concatListFile, concatList, 'utf-8');
    const outputFile = path_1.default.join(outputDir, `${workspaceId}.mp4`);
    const mergeArgs = [
        '-f', 'concat', '-safe', '0',
        '-i', `"${concatListFile.replace(/\\/g, '/')}"`,
        '-c', 'copy',
        '-y', `"${outputFile.replace(/\\/g, '/')}"`,
    ];
    const mergeResult = (0, ffmpeg_js_1.runSimpleFfmpeg)(ffmpegPath, mergeArgs);
    try {
        fs_1.default.unlinkSync(concatListFile);
    }
    catch { }
    // Clean up intermediate section files
    for (const file of chunkFiles) {
        if (file)
            try {
                fs_1.default.unlinkSync(file);
            }
            catch { }
    }
    if (mergeResult.code !== 0 || !fs_1.default.existsSync(outputFile)) {
        console.error(`[yt-dlp] FFmpeg concat failed: ${mergeResult.stderr}`);
        return null;
    }
    const fileSize = fs_1.default.statSync(outputFile).size;
    console.log(`[yt-dlp] Merge complete: ${outputFile} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
    return {
        success: true,
        workspaceId,
        filePath: outputFile,
        duration: Math.floor(videoDurationSec),
        fileSize,
    };
}
/**
 * Probe video availability without downloading.
 * Uses web client + Chrome cookies for best detection accuracy.
 * Falls back to tv_embedded on "Private video" error.
 */
async function probeVideoAvailability(videoUrl, ytCookiesFile) {
    const ytdlp = getYtdlpPath();
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    const ffmpegDir = path_1.default.dirname(ffmpeg);
    const ytDlpDir = path_1.default.dirname(ytdlp);
    const enrichedPath = ffmpegDir + path_1.default.delimiter + ytDlpDir + path_1.default.delimiter + (process.env.PATH || '');
    const tryClient = async (client) => {
        return new Promise((resolve) => {
            const args = [
                videoUrl,
                ...getJsRuntimeArgs(),
                '--extractor-args', `youtube:player_client=${client}`,
                '--dump-json',
                '--no-download',
                '--no-playlist',
                '--socket-timeout', '15',
            ];
            if (ytCookiesFile) {
                args.push('--cookies', ytCookiesFile);
            }
            const proc = (0, child_process_1.spawn)(ytdlp, args, {
                env: { ...process.env, PATH: enrichedPath },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (d) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d) => { stderr += d.toString(); });
            const killTimer = setTimeout(() => {
                if (!proc.killed)
                    proc.kill();
                resolve(null);
            }, 20000);
            proc.on('close', (code) => {
                clearTimeout(killTimer);
                const err = stderr.toLowerCase();
                if (code === 0 && stdout.trim()) {
                    try {
                        const info = JSON.parse(stdout.trim());
                        return resolve({
                            available: true,
                            isPrivate: false,
                            isNotFound: false,
                            isRateLimited: false,
                            isProcessing: false,
                            title: info.title || '',
                            duration: info.duration || 0,
                        });
                    }
                    catch {
                        return resolve(null);
                    }
                }
                const isPrivate = err.includes('private video');
                const isNotFound = err.includes('not available') || err.includes('video unavailable') || err.includes('video not found');
                const isRateLimited = err.includes('429') || err.includes('too many requests');
                const isProcessing = err.includes('processing') || err.includes('is being processed');
                if (isPrivate || isNotFound || isRateLimited || isProcessing) {
                    return resolve({
                        available: false,
                        isPrivate,
                        isNotFound,
                        isRateLimited,
                        isProcessing,
                        title: '',
                        duration: 0,
                        error: stderr.trim().slice(0, 300),
                    });
                }
                // Unknown error — return null to signal "couldn't determine"
                resolve(null);
            });
            proc.on('error', () => {
                clearTimeout(killTimer);
                resolve(null);
            });
        });
    };
    // Try web client first
    const webResult = await tryClient('web');
    if (webResult) {
        // If web says private, try tv_embedded as fallback probe
        if (webResult.isPrivate) {
            const tvResult = await tryClient('tv_embedded');
            if (tvResult)
                return tvResult;
            // tv_embedded also failed — return web's result
            return webResult;
        }
        return webResult;
    }
    // Probe failed entirely — return null (caller should attempt download with caution)
    return null;
}
/** Use ffprobe to get real video duration from a downloaded file. */
async function probeActualDuration(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return 0;
    try {
        const ffprobePath = (0, ffmpeg_paths_js_1.getFfprobePath)();
        const out = (0, child_process_1.execSync)(`"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -- "${filePath}"`, { encoding: 'utf-8', timeout: 10000 });
        return Math.max(0, Math.floor(parseFloat(out.trim())));
    }
    catch {
        return 0;
    }
}
async function probeAvailableFormats(videoUrl, ytCookiesFile) {
    const ytdlp = getYtdlpPath();
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    const ffmpegDir = path_1.default.dirname(ffmpeg);
    const ytDlpDir = path_1.default.dirname(ytdlp);
    const enrichedPath = ffmpegDir + path_1.default.delimiter + ytDlpDir + path_1.default.delimiter + (process.env.PATH || '');
    // Try tv_embedded first — returns full format list even when web is EJS-blocked
    for (const client of ['tv_embedded', 'web']) {
        const result = await new Promise((resolve) => {
            const args = [
                videoUrl,
                ...getJsRuntimeArgs(),
                '--extractor-args', `youtube:player_client=${client}`,
                '--dump-json',
                '--no-download',
                '--no-playlist',
                '--socket-timeout', '15',
            ];
            if (ytCookiesFile)
                args.push('--cookies', ytCookiesFile);
            const proc = (0, child_process_1.spawn)(ytdlp, args, {
                env: { ...process.env, PATH: enrichedPath },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            proc.stdout?.on('data', (d) => { stdout += d.toString(); });
            const killTimer = setTimeout(() => { if (!proc.killed)
                proc.kill(); resolve(null); }, 5000);
            proc.on('close', (code) => {
                clearTimeout(killTimer);
                if (code === 0 && stdout.trim()) {
                    try {
                        const info = JSON.parse(stdout.trim());
                        const formats = info.formats || [];
                        const heights = [...new Set(formats
                                .filter(f => f.height != null && f.height > 0 && f.vcodec !== 'none' && !f.vcodec?.startsWith('jpg'))
                                .map(f => f.height))];
                        heights.sort((a, b) => a - b);
                        // Extract videoId from URL
                        const idMatch = videoUrl.match(/[?&]v=([^&]+)/);
                        const videoId = idMatch ? idMatch[1] : '';
                        resolve({ videoId, heights });
                    }
                    catch {
                        resolve(null);
                    }
                }
                resolve(null);
            });
            proc.on('error', () => { clearTimeout(killTimer); resolve(null); });
        });
        if (result && result.heights.length > 0)
            return result;
    }
    return null;
}
/**
 * High-level download function with client fallback chain.
 * Replaces the old downloadVideo() — callers should use this.
 *
 * Flow:
 * 1. (Optional) Fast pre-check probe — detect private/short/unavailable BEFORE downloading
 * 2. Client chain: web → tv_embedded → ios, each with section→full fallback
 * 3. Multi-instance only if video is actually > 30s
 * 4. Rate-limit detection with exponential backoff
 */
async function downloadVideoStrategy(opts) {
    const { workspaceId } = opts;
    // tv_embedded first: returns H.264 720p/1080p (avc1.64001f/avc1.64002a)
    // even when 'web' client is limited to 360p by EJS challenge with Chrome session cookies.
    // web second: fallback for edge cases (private videos, geo-restrictions).
    const clients = ['tv_embedded', 'web', 'ios'];
    for (let i = 0; i < clients.length; i++) {
        const client = clients[i];
        (0, unified_log_js_1.devLog)(`[Download] Trying client: ${client} (${i + 1}/${clients.length})`);
        const result = await downloadWithClient({
            ...opts,
            client,
        });
        if (result.success) {
            (0, unified_log_js_1.devLog)(`[Download] ${client} succeeded: ${result.filePath}`);
            return result;
        }
        const err = result.error || '';
        // Fatal errors — stop trying other clients
        if (result.isNotFound) {
            (0, unified_log_js_1.devLog)(`[Download] ${client} → video not available/deleted — giving up`);
            return result;
        }
        if (result.isRateLimited) {
            (0, unified_log_js_1.devLog)(`[Download] ${client} → rate-limited (429) — exponential backoff`);
            // Exponential backoff: 2s, 4s, 8s
            const delay = 2000 * Math.pow(2, i);
            await new Promise(r => setTimeout(r, delay));
            // Continue to next client
            continue;
        }
        if (result.isProcessing) {
            (0, unified_log_js_1.devLog)(`[Download] ${client} → video still processing — exponential backoff`);
            const delay = 15000 + Math.random() * 10000;
            await new Promise(r => setTimeout(r, delay));
            // Retry same client after backoff
            const retry = await downloadWithClient({ ...opts, client });
            if (retry.success)
                return retry;
        }
        // Private video — try next client
        if (result.isPrivate) {
            (0, unified_log_js_1.devLog)(`[Download] ${client} → private/unauthorized — trying next client`);
            continue;
        }
        // Unknown error — try next client
        (0, unified_log_js_1.devLog)(`[Download] ${client} → unknown error: ${err.slice(0, 100)} — trying next client`);
        continue;
    }
    // All clients failed
    return {
        success: false,
        workspaceId,
        error: 'All download clients failed',
    };
}
async function downloadWithClient(opts) {
    const { workspaceId, videoUrl, outputDir, trimLimit, quality = '720', maxInstances = 'auto', onProgress, ytCookiesFile, client } = opts;
    const ytdlp = getYtdlpPath();
    if (!fs_1.default.existsSync(ytdlp)) {
        return { success: false, workspaceId, error: `yt-dlp not found at ${ytdlp}` };
    }
    if (!fs_1.default.existsSync(outputDir)) {
        fs_1.default.mkdirSync(outputDir, { recursive: true });
    }
    // Check for existing file
    const existingFiles = (() => {
        try {
            return fs_1.default.readdirSync(outputDir).filter(f => f.startsWith(workspaceId + '_') && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f));
        }
        catch {
            return [];
        }
    })();
    if (existingFiles.length > 0) {
        const existingFile = path_1.default.join(outputDir, existingFiles[0]);
        let fileSize = 0;
        try {
            fileSize = fs_1.default.statSync(existingFile).size;
        }
        catch { }
        const duration = await probeActualDuration(existingFile);
        (0, unified_log_js_1.devLog)(`[Download] File already exists: ${existingFile} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
        return { success: true, workspaceId, filePath: existingFile, duration, fileSize, reason: 'existing_file' };
    }
    const q = parseInt(quality);
    const maxHeight = isNaN(q) ? 720 : q;
    // All fallbacks enforce height<=maxHeight — no unconstrained fallback.
    // Priority: bestvideo@maxHeight+best_audio @ AAC → same w/ any audio codec
    // → same w/ any video codec → bestvideo@maxHeight+best_audio (strict cap).
    const formatSelector = [
        `bestvideo[height<=${maxHeight}][vcodec!="none"]+bestaudio[acodec=aac]`,
        `bestvideo[height<=${maxHeight}][vcodec!="none"]+bestaudio`,
        `bestvideo[height<=${maxHeight}]+bestaudio[acodec=aac]`,
        `bestvideo[height<=${maxHeight}]+bestaudio`,
    ].join('/');
    console.log(`[Download] quality=${quality} maxHeight=${maxHeight}p selector=${formatSelector}`);
    // Multi-instance: parallel yt-dlp instances for 720p+ with enough free RAM
    // Capped by machine tier via getDownloadParams().maxInstances
    const freeMemGB = os_1.default.freemem() / (1024 ** 3);
    const tierMax = (0, system_js_1.getDownloadParams)().maxInstances;
    let instanceCount = 1;
    if (typeof maxInstances === 'number' && maxInstances > 1) {
        instanceCount = Math.min(maxInstances, tierMax);
    }
    else if (maxInstances === 'auto' && freeMemGB >= 8) {
        if (maxHeight >= 1080) {
            instanceCount = Math.min(4, tierMax);
        }
        else if (maxHeight >= 720) {
            instanceCount = Math.min(2, tierMax);
        }
    }
    // ── Try section download first (fast) ──────────────────────────────────────
    const sectionArg = (() => {
        if (typeof trimLimit !== 'number' || trimLimit <= 0)
            return null;
        const totalSeconds = trimLimit * 60;
        const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const ss = String(totalSeconds % 60).padStart(2, '0');
        return `*00:00:00-${hh}:${mm}:${ss}`;
    })();
    if (sectionArg && instanceCount > 1) {
        // For multi-instance: use trimLimit duration, but verify video is long enough AFTER download
        // by checking the file size. If file is suspiciously small (< 100KB per 10s), skip multi.
        const result = await spawnDownload({
            workspaceId, videoUrl, outputDir, formatSelector, client, ytCookiesFile,
            extraArgs: ['--download-sections', sectionArg],
            instanceCount, sectionArg, maxInstances, quality, onProgress,
        });
        if (result.success) {
            // Verify actual duration with ffprobe
            const actualDuration = await probeActualDuration(result.filePath);
            if (actualDuration > 0 && actualDuration < 30) {
                (0, unified_log_js_1.devLog)(`[Download] Section succeeded but video is only ${actualDuration}s — multi-instance wasted, continuing`);
            }
            return result;
        }
        // Section failed — classify error
        const classified = classifyError(result.error || '', result.stderr || '');
        if (classified.isNotFound)
            return { ...result, ...classified };
        if (classified.isRateLimited)
            return { ...result, ...classified };
        if (classified.isProcessing)
            return { ...result, ...classified };
        // For private/error: try full download below
        (0, unified_log_js_1.devLog)(`[Download] Section failed: ${result.error?.slice(0, 80)} — falling back to full`);
    }
    // ── Full download (with section if trimLimit was set) ─────────────────────
    // ALWAYS pass sectionArg to yt-dlp if trimLimit was configured — this makes yt-dlp
    // skip HLS segments beyond the trim window (significant bandwidth savings).
    const result = await spawnDownload({
        workspaceId, videoUrl, outputDir, formatSelector, client, ytCookiesFile,
        extraArgs: sectionArg ? ['--download-sections', sectionArg] : [],
        instanceCount: 1, sectionArg: null, maxInstances: 1, quality, onProgress,
    });
    if (result.success) {
        const actualDuration = await probeActualDuration(result.filePath);
        return { ...result, duration: actualDuration > 0 ? actualDuration : result.duration };
    }
    const classified = classifyError(result.error || '', result.stderr || '');
    return { ...result, ...classified };
}
function classifyError(error, stderr) {
    const combined = (error + ' ' + stderr).toLowerCase();
    return {
        isPrivate: combined.includes('private video') || combined.includes('sign in if you\'ve been granted access'),
        isNotFound: combined.includes('not available') || combined.includes('video unavailable') || combined.includes('video not found') || combined.includes('removed by'),
        isRateLimited: combined.includes('429') || combined.includes('too many requests') || combined.includes('rate limit'),
        isProcessing: combined.includes('processing') && combined.includes('video'),
    };
}
async function spawnDownload(opts) {
    const { workspaceId, videoUrl, outputDir, formatSelector, client, ytCookiesFile, extraArgs, onProgress } = opts;
    const ytdlp = getYtdlpPath();
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    const ffmpegDir = path_1.default.dirname(ffmpeg);
    const ytDlpDir = path_1.default.dirname(ytdlp);
    const enrichedPath = ffmpegDir + path_1.default.delimiter + ytDlpDir + path_1.default.delimiter + (process.env.PATH || '');
    const outputTemplate = path_1.default.join(outputDir, `${workspaceId}_%(id)s.%(ext)s`);
    const args = [
        videoUrl,
        ...getJsRuntimeArgs(),
        '--extractor-args', `youtube:player_client=${client}`,
        ...(ytCookiesFile ? ['--cookies', ytCookiesFile] : []),
        '-f', formatSelector,
        '--merge-output-format', 'mp4',
        '--remux-video', 'mp4',
        '--output', outputTemplate,
        '--no-playlist',
        '--newline',
        '--concurrent-fragments', String((0, system_js_1.getDownloadParams)().fragments),
        '--retries', '3',
        '--fragment-retries', '3',
        '--socket-timeout', '15',
        '--http-chunk-size', '10485760',
        ...extraArgs,
    ];
    (0, unified_log_js_1.devLog)(`[Download] Spawning yt-dlp (${client}): ${ytdlp}`);
    (0, unified_log_js_1.devLog)(`[Download] Args:`, args.map(a => a.length > 60 ? a.slice(0, 60) + '...' : a));
    return new Promise((resolve) => {
        let proc;
        try {
            proc = (0, child_process_1.spawn)(ytdlp, args, {
                env: { ...process.env, PATH: enrichedPath },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch (err) {
            resolve({ success: false, workspaceId, error: `spawn failed: ${err.message}` });
            return;
        }
        let stderr = '';
        let downloadedFile = '';
        let progressEmitted = false;
        onProgress?.({ workspaceId, percent: 0, speed: '...', eta: 0, downloaded: '', total: '' });
        proc.stdout?.on('data', (data) => {
            const text = data.toString();
            const pctMatch = text.match(/(\d+\.?\d*)%/);
            const destMatch = text.match(/(?:Dest(?:ination)?):\s*(.+)/);
            const mergeMatch = text.match(/Merging formats into "(.+)"/);
            const errorMatch = text.match(/ERROR.*?:?\s*(.+)/);
            if (pctMatch) {
                const pct = parseFloat(pctMatch[1]);
                if (pct >= 0 && pct <= 100) {
                    if (!progressEmitted) {
                        (0, unified_log_js_1.devLog)(`[Download] Progress: ${pct}%`);
                        progressEmitted = true;
                    }
                    onProgress?.({ workspaceId, percent: pct, speed: '', eta: '', downloaded: '', total: '' });
                }
            }
            else if (destMatch) {
                downloadedFile = path_1.default.normalize(destMatch[1].trim());
                (0, unified_log_js_1.devLog)(`[Download] Dest: ${downloadedFile}`);
            }
            else if (mergeMatch) {
                downloadedFile = path_1.default.normalize(mergeMatch[1]);
                (0, unified_log_js_1.devLog)(`[Download] Merged: ${downloadedFile}`);
                onProgress?.({ workspaceId, percent: 99, speed: 'processing', eta: 0, downloaded: '', total: '' });
            }
            else if (errorMatch) {
                stderr += errorMatch[1] + '\n';
            }
            else if (text.includes('[download]') && !text.includes('%') && !text.includes('ERROR')) {
                const trimmed = text.trim().slice(0, 100);
                if (trimmed)
                    (0, unified_log_js_1.devLog)(`[Download] ${trimmed}`);
            }
        });
        proc.stderr?.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            const pctMatch = text.match(/(\d+\.?\d*)%/);
            const destMatch = text.match(/(?:\[download\]\s*Dest(?:ination)?:)\s*(.+)/);
            const mergeMatch = text.match(/\[download\] Merging formats into "(.+)"/);
            if (pctMatch) {
                const pct = parseFloat(pctMatch[1]);
                if (pct >= 0 && pct <= 100) {
                    if (!progressEmitted) {
                        progressEmitted = true;
                    }
                    onProgress?.({ workspaceId, percent: pct, speed: '', eta: '', downloaded: '', total: '' });
                }
            }
            else if (destMatch && !downloadedFile) {
                downloadedFile = destMatch[1].trim();
            }
            else if (mergeMatch) {
                downloadedFile = mergeMatch[1];
                onProgress?.({ workspaceId, percent: 99, speed: 'processing', eta: 0, downloaded: '', total: '' });
            }
        });
        proc.on('error', (err) => {
            resolve({ success: false, workspaceId, error: `spawn error: ${err.message}`, stderr });
        });
        const timeout = extraArgs.length > 0 ? 15 * 60 * 1000 : 30 * 60 * 1000;
        const timer = setTimeout(() => {
            if (!proc.killed)
                proc.kill();
            resolve({ success: false, workspaceId, error: 'Download timeout', stderr });
        }, timeout);
        proc.on('close', (code) => {
            clearTimeout(timer);
            (0, unified_log_js_1.devLog)(`[Download] Closed code=${code}, file="${downloadedFile}"`);
            if (!downloadedFile) {
                try {
                    const files = fs_1.default.readdirSync(outputDir);
                    const match = files.find(f => f.startsWith(workspaceId + '_') && /\.(mp4|webm|mkv|avi|mov|flv)$/i.test(f));
                    if (match)
                        downloadedFile = path_1.default.join(outputDir, match);
                }
                catch { }
            }
            const isFatal = code !== 0 && code !== 2;
            if (isFatal || !downloadedFile) {
                const errorLines = stderr.trim().split('\n').filter(l => l.includes('ERROR'));
                const fullError = errorLines.join(' | ') || `yt-dlp code ${code}`;
                resolve({ success: false, workspaceId, error: fullError, stderr });
                return;
            }
            let fileSize = 0;
            try {
                fileSize = fs_1.default.statSync(downloadedFile).size;
            }
            catch { }
            // Verify file is not corrupt (must be > 50KB)
            if (fileSize < 50_000) {
                (0, unified_log_js_1.devLog)(`[Download] File too small (${fileSize} bytes) — likely corrupt`);
                try {
                    fs_1.default.unlinkSync(downloadedFile);
                }
                catch { }
                resolve({ success: false, workspaceId, error: `File too small (${fileSize} bytes)`, stderr });
                return;
            }
            const actualDuration = fs_1.default.existsSync(downloadedFile) ? 0 : 0; // will be probed by caller
            resolve({ success: true, workspaceId, filePath: downloadedFile, duration: actualDuration, fileSize, stderr });
        });
    });
}
// ─── Pre-scale source video to output resolution ─────────────────────────────────
// OPTIMIZATION #3+#6: Downscale the source video to the target export resolution
// AFTER download/trim but BEFORE render. This eliminates the scale filter from the render
// pipeline entirely, saving ~5-10s per render.
//
// How it works:
//   Download: 1080p source (e.g. 1920x1080)
//   Pre-scale: 1920x1080 → 480x480 (ultrafast, ~1-2s)
//   Render: reads pre-scaled 480p → NO scale filter needed → encode only
//
// Tradeoff: extra ~1-2s pre-processing, but render is ~5-10s faster.
// For auto-render pipeline: net savings = ~3-8s per video.
async function preScaleVideo(sourcePath, outputPath, canvasW, canvasH) {
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    // Scale portrait source to EXACTLY canvas dimensions so the render pipeline's scale
    // filter becomes a no-op (or trivial center-crop). This saves ~5-10s per render.
    // For portrait source entering portrait canvas: scale to canvasW, then pad/crop to canvasH.
    // The key insight: for 9:16 source → 9:16 canvas, scale by HEIGHT matches better
    // (avoids excess pillarboxing in the crop step).
    const args = [
        '-i', (0, ffmpeg_js_1.quotePath)(sourcePath),
        '-vf', `scale=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '18', // Lossless for practical purposes (CRF 18 ≈ high quality)
        '-c:a', 'copy', // Copy audio without re-encoding
        '-threads', '4',
        '-y', (0, ffmpeg_js_1.quotePath)(outputPath),
    ];
    const cmd = (0, ffmpeg_js_1.buildArgs)(ffmpeg, args);
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)(cmd, [], {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0 && fs_1.default.existsSync(outputPath)) {
                resolve({ success: true });
            }
            else {
                resolve({ success: false, error: stderr.slice(0, 200) || `ffmpeg exit ${code}` });
            }
        });
        setTimeout(() => {
            if (!proc.killed)
                proc.kill();
            resolve({ success: false, error: 'pre-scale timeout' });
        }, 60_000);
    });
}
/**
 * Download wrapper — delegates to downloadVideoStrategy with full client fallback chain.
 * Maintains backward compatibility with callers that pass playerClient/po_token.
 *
 * New callers: prefer downloadVideoStrategy() directly for cleaner API.
 */
async function downloadVideo(opts) {
    // If explicit playerClient is given (e.g. 'tv_embedded'), use it directly without the
    // fallback chain (caller is already retrying with a specific client).
    if (opts.playerClient) {
        const client = opts.playerClient;
        const result = await downloadWithClient({
            workspaceId: opts.workspaceId,
            videoUrl: opts.videoUrl,
            outputDir: opts.outputDir,
            trimLimit: opts.trimLimit,
            quality: opts.quality,
            maxInstances: opts.maxInstances,
            onProgress: opts.onProgress,
            ytCookiesFile: opts.ytCookiesFile,
            client,
        });
        return {
            success: result.success,
            workspaceId: result.workspaceId,
            filePath: result.filePath,
            duration: result.duration,
            fileSize: result.fileSize,
            error: result.error,
        };
    }
    // Default: use the full client fallback chain (web → tv_embedded → ios)
    const strategyResult = await downloadVideoStrategy({
        workspaceId: opts.workspaceId,
        videoUrl: opts.videoUrl,
        outputDir: opts.outputDir,
        trimLimit: opts.trimLimit,
        quality: opts.quality,
        maxInstances: opts.maxInstances,
        onProgress: opts.onProgress,
        ytCookiesFile: opts.ytCookiesFile,
    });
    return {
        success: strategyResult.success,
        workspaceId: strategyResult.workspaceId,
        filePath: strategyResult.filePath,
        duration: strategyResult.duration,
        fileSize: strategyResult.fileSize,
        error: strategyResult.error,
    };
}
