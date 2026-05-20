import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import os from 'os';
import { app } from 'electron';
import { devLog } from './unified_log.js';
// Shared FFmpeg/FFprobe path resolution.
// On Windows with Bash/Git environments, process.cwd() returns Unix-style paths
// (/d/...). Node's fs.existsSync accepts both forward-slash and backslash paths,
// but mixed/backslash paths may fail. We always normalize to forward slashes.
function resolveBinary(name) {
    const exists = (fp) => { try {
        return fs.existsSync(fp);
    }
    catch {
        return false;
    } };
    // Helper: probe a binary and score it for CUDA/NVENC capability.
    // Higher score = more suitable for GPU-accelerated rendering.
    function probeAndScore(fp) {
        try {
            const out = execSync(`"${fp}" -version 2>&1`, { encoding: 'utf-8', timeout: 5000 });
            if (!out.includes(name))
                return { ok: false, score: 0, version: '' };
            // Check if this binary claims NVENC support
            let hasNvEncoders = false;
            let hasTestedNvEnc = false;
            let nvencWorks = false;
            if (name === 'ffmpeg') {
                try {
                    const encOut = execSync(`"${fp}" -hide_banner -encoders 2>&1`, { encoding: 'utf-8', timeout: 5000 });
                    hasNvEncoders = encOut.includes('h264_nvenc') || encOut.includes('hevc_nvenc');
                    // Quick hardware test: try encoding 1 frame. Some builds list NVENC but driver doesn't support it.
                    // gyan.dev FFmpeg 8.1 on RTX 4050 Laptop (driver 566.14): NVENC listed but fails at runtime.
                    if (hasNvEncoders) {
                        hasTestedNvEnc = true;
                        const testFile = path.join(os.tmpdir(), `hc_nvenc_probe_${Date.now()}.mp4`);
                        // Try hevc_nvenc first (more reliable on RTX 4050 laptop), fall back to h264_nvenc
                        const testCodec = encOut.includes('hevc_nvenc') ? 'hevc_nvenc' : 'h264_nvenc';
                        try {
                            // Pipe stderr to detect actual error message
                            const result = execSync(`"${fp}" -f lavfi -i color=c=blue:s=1920x1080:d=0.1 -c:v ${testCodec} -frames:v 1 -y "${testFile}"`, { timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
                            const sz = fs.statSync(testFile).size;
                            nvencWorks = sz > 100;
                            if (!nvencWorks)
                                devLog(`[FFmpeg probe] ${path.basename(fp)} NVENC test: 0 bytes — driver incompatible`);
                        }
                        catch (e) {
                            // NVENC not usable at runtime — either driver issue or build mismatch
                            devLog(`[FFmpeg probe] ${path.basename(fp)} NVENC test: FAILED (${e.status ?? 'signal'})`);
                        }
                        finally {
                            try {
                                fs.unlinkSync(testFile);
                            }
                            catch { }
                        }
                    }
                }
                catch { }
            }
            // Quick CUDA score: prefer builds known to have CUDA support
            // - full/build: high score
            // - essentials/gpl/shared: medium score
            // - generic: low score
            let score = 10; // base score for being a valid binary
            const lower = fp.toLowerCase();
            if (lower.includes('cuda') || lower.includes('nvenc') || lower.includes('nvidia'))
                score += 50;
            if (lower.includes('full'))
                score += 30;
            if (lower.includes('share'))
                score += 20;
            if (lower.includes('essentials'))
                score += 15;
            if (lower.includes('gpl'))
                score += 10;
            if (lower.includes('git'))
                score += 25;
            // Version: prefer 7.x+
            const verMatch = out.match(/(\d+)\.(\d+)/);
            if (verMatch) {
                const major = parseInt(verMatch[1]);
                if (major >= 7)
                    score += 20;
                else if (major >= 5)
                    score += 10;
            }
            // NVENC hardware test result: working NVENC builds get a big bonus
            // Broken NVENC builds (listed but driver incompatible) get penalized so CPU fallback is chosen
            if (hasTestedNvEnc && nvencWorks)
                score += 100;
            if (hasTestedNvEnc && !nvencWorks)
                score -= 200; // penalize broken NVENC builds below CapCut
            const version = out.split('\n')[0].trim();
            return { ok: true, score, version };
        }
        catch {
            return { ok: false, score: 0, version: '' };
        }
    }
    const candidates = [];
    // 0. Bundled FFmpeg (shipped in resources/ffmpeg/bin/) — highest priority
    // In packaged app: process.resourcesPath = "path/to/HyperClip/resources"
    // FFmpeg is at resources/ffmpeg/bin/, NOT resources/app/resources/ffmpeg/bin/
    if (app.isPackaged && process.resourcesPath) {
        const bundledPath = path.join(process.resourcesPath, 'ffmpeg', 'bin', `${name}.exe`);
        if (exists(bundledPath))
            candidates.push(bundledPath);
    }
    // 1. Check PATH environment variable first — most reliable for installed ffmpeg
    const pathEnv = process.env.PATH || process.env.Path || '';
    for (const dir of pathEnv.split(path.delimiter)) {
        if (!dir)
            continue;
        const fp = path.join(dir.trim(), `${name}.exe`);
        if (exists(fp))
            candidates.push(fp);
    }
    const MSI_USER = process.env.USERNAME || process.env.USER || '';
    const MSI_LOCALAPPDATA = process.env.LOCALAPPDATA || '';
    const APPDATA = process.env.APPDATA || '';
    const PROGDATA = process.env.PROGRAMDATA || 'C:\\ProgramData';
    // 2. CapCut bundled FFmpeg — per-user AppData paths (MSI-specific installs for dev compatibility)
    if (MSI_LOCALAPPDATA) {
        const capcutVersions = ['8.1.1.3417', '8.0.1.3366', '8.0.0.3346', '7.9.0.3200'];
        for (const ver of capcutVersions) {
            candidates.push(path.join(MSI_LOCALAPPDATA, 'CapCut', 'Apps', ver, name + '.exe'));
        }
    }
    // 3. Standalone FFmpeg builds — use env-based paths instead of hardcoded C:\
    candidates.push(path.join(APPDATA, 'ffmpeg', 'bin', name + '.exe'), path.join(PROGDATA, 'ffmpeg', 'bin', name + '.exe'), 'C:/ffmpeg/ffmpeg-full/bin/' + name + '.exe', 'C:/ffmpeg/ffmpeg-git-full/bin/' + name + '.exe', 'C:/Program Files/ffmpeg/bin/' + name + '.exe', 'C:/Program Files (x86)/ffmpeg/bin/' + name + '.exe', 'C:/msys64/mingw64/bin/' + name + '.exe');
    // 4. Local node_modules .bin (for development)
    candidates.push(path.join(process.cwd(), 'node_modules', '.bin', name));
    // 5. User-local AppData Roaming ffmpeg
    if (APPDATA) {
        candidates.push(path.join(APPDATA, 'ffmpeg', 'bin', name + '.exe'));
        candidates.push(path.join(APPDATA, name, 'bin', name + '.exe'));
    }
    // 6. Package managers — use env-based paths
    candidates.push(path.join(PROGDATA, 'chocolatey', 'bin', name + '.exe'));
    const scoopShims = process.env.SCOOP || (MSI_USER ? path.join('C:/Users', MSI_USER, 'scoop', 'shims') : '');
    if (scoopShims)
        candidates.push(path.join(scoopShims, name + '.exe'));
    // Find best candidate by CUDA capability score
    let bestFp = '';
    let bestScore = -1;
    let bestVersion = '';
    for (const fp of candidates) {
        const { ok, score, version } = probeAndScore(fp);
        if (ok && score > bestScore) {
            bestScore = score;
            bestFp = fp;
            bestVersion = version;
        }
    }
    if (bestFp) {
        devLog(`[FFmpeg] Resolved ${name}: ${bestFp}`);
        devLog(`[FFmpeg] Binary: ${bestVersion} (CUDA score: ${bestScore})`);
        return bestFp;
    }
    console.warn(`[FFmpeg] Could not find ${name}.exe in any candidate path`);
    return name; // fallback to PATH lookup
}
export function getFfprobePath() {
    return resolveBinary('ffprobe');
}
export function getFfmpegPath() {
    return resolveBinary('ffmpeg');
}
let _cachedVersion = null;
function parseVersion(versionStr) {
    const match = versionStr.match(/(\d+)\.(\d+)/);
    if (match)
        return parseInt(match[1]);
    return 0;
}
export function getFfmpegVersion(ffmpegPath) {
    if (_cachedVersion)
        return _cachedVersion;
    const result = {
        version: 'unknown',
        majorVersion: 0,
        hasNvenc: false,
        hasNvdec: false,
        hasCuvid: false,
        hasQsv: false,
        hasVaapi: false,
        hasCudaFilters: false,
        hasNvencLookahead: false,
        hasHevcNvenc: false,
        hasH264Nvenc: false,
    };
    try {
        const versionOut = execSync(`"${ffmpegPath}" -version 2>&1`, {
            encoding: 'utf-8', timeout: 5000,
        });
        result.version = versionOut.split('\n')[0];
        result.majorVersion = parseVersion(result.version);
        devLog(`[FFmpeg] ${result.version} (major=${result.majorVersion})`);
    }
    catch (e) {
        console.warn('[FFmpeg] Could not get version:', e);
        _cachedVersion = result;
        return result;
    }
    try {
        const encodersOut = execSync(`"${ffmpegPath}" -hide_banner -encoders 2>&1`, {
            encoding: 'utf-8', timeout: 8000,
        }).toString();
        result.hasH264Nvenc = encodersOut.includes('h264_nvenc');
        result.hasHevcNvenc = encodersOut.includes('hevc_nvenc');
        result.hasNvenc = result.hasH264Nvenc || result.hasHevcNvenc;
        result.hasQsv = encodersOut.includes('hevc_qsv') || encodersOut.includes('h264_qsv');
        result.hasVaapi = encodersOut.includes('hevc_vaapi') || encodersOut.includes('h264_vaapi');
        result.hasNvencLookahead = encodersOut.includes('nvenc_lookahead');
        devLog(`[FFmpeg] NVENC: ${result.hasNvenc ? '✓' : '✗'} | NVDEC: ${result.hasNvdec ? '✓' : '✗'} | CUVID: ${result.hasCuvid ? '✓' : '✗'} | QSV: ${result.hasQsv ? '✓' : '✗'} | VAAPI: ${result.hasVaapi ? '✓' : '✗'}`);
        devLog(`[FFmpeg] CUDA filters: ${result.hasCudaFilters ? '✓' : '✗'} | NVENC lookahead: ${result.hasNvencLookahead ? '✓' : '✗'}`);
    }
    catch (e) {
        console.warn('[FFmpeg] Could not enumerate encoders:', e);
    }
    // Check decoders for NVDEC/CUVID (these are decoder entries, not encoder entries)
    try {
        const decodersOut = execSync(`"${ffmpegPath}" -hide_banner -decoders 2>&1`, {
            encoding: 'utf-8', timeout: 8000,
        }).toString();
        result.hasNvdec = decodersOut.includes('hevc_nvdec') || decodersOut.includes('h264_nvdec');
        result.hasCuvid = decodersOut.includes('hevc_cuvid') || decodersOut.includes('h264_cuvid');
    }
    catch { }
    // CUDA filters (scale_cuda/overlay_cuda) REQUIRE NVDEC hardware decode.
    // The essentials build lists them but NVDEC is not available → runtime fails.
    // Only mark CUDA filters as available if NVDEC is present.
    const hasNvDec = result.hasNvdec;
    try {
        const filtersOut = execSync(`"${ffmpegPath}" -hide_banner -filters 2>&1`, {
            encoding: 'utf-8', timeout: 5000,
        }).toString();
        const hasCudaFiltersListed = filtersOut.includes('scale_cuda') || filtersOut.includes('overlay_cuda');
        // Only enable CUDA filters if NVDEC is available (meaning the GPU pipeline is complete)
        result.hasCudaFilters = hasCudaFiltersListed && result.hasNvdec;
        if (result.hasCudaFilters) {
            devLog(`[FFmpeg] CUDA-accelerated filters detected (scale_cuda, overlay_cuda) — GPU filter pipeline enabled`);
        }
        else if (hasCudaFiltersListed && !hasNvDec) {
            devLog(`[FFmpeg] CUDA filters listed but NVDEC unavailable — using CPU filter pipeline`);
        }
    }
    catch { }
    _cachedVersion = result;
    return result;
}
// Validate FFmpeg binary: verify it can be executed and has hardware encoders.
// Call once at startup or before first render.
export async function validateFfmpeg(ffmpegPath) {
    return new Promise((resolve, reject) => {
        try {
            const ver = getFfmpegVersion(ffmpegPath);
            if (!ver.hasNvenc && !ver.hasQsv && !ver.hasVaapi) {
                console.warn('[FFmpeg] Warning: No hardware encoder found — will use software encoding');
            }
            if (ver.majorVersion > 0 && ver.majorVersion < 5) {
                console.warn(`[FFmpeg] Warning: FFmpeg ${ver.majorVersion}.x detected. FFmpeg 7.x+ recommended for best RTX 5080 support`);
            }
            resolve();
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[FFmpeg] Validation FAILED: ${msg}`);
            reject(new Error(`FFmpeg validation failed: ${msg}`));
        }
    });
}
