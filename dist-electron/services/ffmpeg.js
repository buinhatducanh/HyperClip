"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FONT_FILE = exports.VIDEO_PCT = exports.BOTTOM_PCT = exports.HEADER_PCT = exports.getFfprobePath = exports.getFfmpegPath = void 0;
exports.quotePath = quotePath;
exports.buildArgs = buildArgs;
exports.runSimpleFfmpeg = runSimpleFfmpeg;
exports.probeVideoAspect = probeVideoAspect;
exports.trimVideo = trimVideo;
exports.preSpeedVideo = preSpeedVideo;
exports.generateBlurBackground = generateBlurBackground;
exports.extractVideoThumbnail = extractVideoThumbnail;
exports.renderTextOverlay = renderTextOverlay;
exports.preRenderOverlays = preRenderOverlays;
exports.renderVideo = renderVideo;
exports.cancelChunked = cancelChunked;
exports.cancelAllChunked = cancelAllChunked;
exports.renderChunked = renderChunked;
const child_process_1 = require("child_process");
const child_process_2 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const ffmpeg_paths_js_1 = require("./ffmpeg-paths.js");
Object.defineProperty(exports, "getFfmpegPath", { enumerable: true, get: function () { return ffmpeg_paths_js_1.getFfmpegPath; } });
Object.defineProperty(exports, "getFfprobePath", { enumerable: true, get: function () { return ffmpeg_paths_js_1.getFfprobePath; } });
const worker_pool_js_1 = require("./worker-pool.js");
const system_js_1 = require("./system.js");
const unified_log_js_1 = require("./unified_log.js");
const overlay_cache_js_1 = require("./overlay_cache.js");
// ─── SHORT (9:16) canvas zone constants ─────────────────────────────────────────
// All values as % of canvasH. Responsive to any canvas resolution (360, 720, 1080).
//
// Layout: HEADER (25%) | VIDEO (50%) | BOTTOM (25%)
// Video bottom touches top of bottom zone — no overlap.
var ffmpeg_shared_js_1 = require("./ffmpeg-shared.js");
Object.defineProperty(exports, "HEADER_PCT", { enumerable: true, get: function () { return ffmpeg_shared_js_1.HEADER_PCT; } });
Object.defineProperty(exports, "BOTTOM_PCT", { enumerable: true, get: function () { return ffmpeg_shared_js_1.BOTTOM_PCT; } });
Object.defineProperty(exports, "VIDEO_PCT", { enumerable: true, get: function () { return ffmpeg_shared_js_1.VIDEO_PCT; } });
Object.defineProperty(exports, "FONT_FILE", { enumerable: true, get: function () { return ffmpeg_shared_js_1.FONT_FILE; } });
const ffmpeg_shared_js_2 = require("./ffmpeg-shared.js");
// ─── Hardware decode/filter helpers ──────────────────────────────────────────────
// Get hardware capability flags (cached, single call per lifetime).
function getHwCaps() {
    return (0, ffmpeg_paths_js_1.getFfmpegVersion)((0, ffmpeg_paths_js_1.getFfmpegPath)());
}
// Build hardware acceleration flags for FFmpeg input args.
// Returns an array of flags to insert at the start of the args (before -i).
// On NVDEC/CUVID systems, this enables hardware-accelerated DECODE (frames go to system RAM).
//
// FIX 2026-06-02: Removed `-hwaccel_output_format cuda`.
// With that flag, decoded frames stay in VRAM (CUDA surface). The downstream CPU filter
// chain (setpts, trim, crop, drawtext) cannot consume CUDA frames directly → "Impossible
// to convert between the formats" → 0-byte output chunks. Letting FFmpeg decode to system
// RAM and then process with CPU filters (scale/crop/overlay) is the correct pattern for
// the mixed chain used in this app. Hardware DECODE is still active (much faster than
// software decode for h264/hevc) — the CPU filter chain has no measurable cost on RTX 5080
// since NVENC encode is the bottleneck.
function getHwAccelFlags(codec) {
    const ver = getHwCaps();
    if (ver.hasNvdec) {
        return ['-hwaccel', 'cuda', '-hwaccel_device', '0'];
    }
    if (ver.hasCuvid) {
        return ['-hwaccel', 'cuvid'];
    }
    return [];
}
// Determine the best hardware decoder for the current platform and FFmpeg build.
// Priority: NVDEC (cuda) > CUVID (legacy) > software
function getBestHwDecCodec(codec) {
    const ver = getHwCaps();
    if (ver.hasNvdec) {
        // NVDEC: modern CUDA Video Decoder API, recommended for RTX 30+/40+/50+
        return codec === 'hevc' ? 'hevc_nvdec' : 'h264_nvdec';
    }
    if (ver.hasCuvid) {
        // CUVID: legacy but still functional, works with scale_cuda for GPU filter pipeline.
        // Pipeline: h264_cuvid (GPU decode) → scale_cuda (GPU filter) → h264_nvenc (GPU encode).
        // Full GPU pipeline when combined with CUDA filters.
        const prefix = codec === 'hevc' ? 'hevc' : 'h264';
        if (ver.hasCudaFilters) {
            (0, unified_log_js_1.devLog)('[FFmpeg] Using CUDA pipeline: h264_cuvid → scale_cuda → h264_nvenc (GPU decode + filter + encode)');
        }
        else {
            (0, unified_log_js_1.devLog)('[FFmpeg] CUVID hardware decode (GPU): no CUDA filters available — decode-only GPU acceleration');
        }
        return prefix + '_cuvid';
    }
    // No hardware decode available — let FFmpeg auto-select or use software
    return codec === 'hevc' ? 'hevc' : 'h264';
}
// Determine the best scale filter. scale_cuda is GPU-accelerated and much faster
// than CPU-based scale for high-resolution video. Falls back to CPU scale if unavailable.
function getScaleFilter(useGpu) {
    if (!useGpu)
        return 'scale';
    return getHwCaps().hasCudaFilters ? 'scale_cuda' : 'scale';
}
// Determine overlay filter (GPU-accelerated if available)
function getOverlayFilter(useGpu) {
    if (!useGpu)
        return 'overlay';
    return getHwCaps().hasCudaFilters ? 'overlay_cuda' : 'overlay';
}
// ─── RTX 5080 ultra-optimized filter flags ──────────────────────────────────────
// These flags maximize CUDA pipeline throughput for the 16GB VRAM RTX 5080.
// Force NV12 CUDA output after every scale_cuda — bridges CUDA surface → system RAM.
// Without this, FFmpeg tries to auto-negotiate and may pick slower paths.
const CUDA_FORMAT_NV12 = 'format=nv12';
// Use cuda:0 device explicitly for CUDA filters — ensures all filters run on same GPU.
// Without explicit device, FFmpeg may distribute across devices causing synchronization overhead.
const CUDA_DEVICE = 'cuda:0';
// Lanczos4 is the highest-quality CUDA scaling kernel available.
// For downscaling 1080p→720p it's significantly better than bilinear.
const LANCZOS_FLAGS = 'flags=lanczos';
// ─── Shell path helper ─────────────────────────────────────────────────────────
// Path quoting utility — exported for use by youtube.ts pre-scale function
// When the caller will route through buildArgs() (which already shell-quotes every arg),
// this returns the path unchanged. Otherwise it adds a single layer of double-quotes
// so the path survives spaces / parens / ampersands on Windows + macOS shells.
function quotePath(p) {
    return p;
}
// Convert CSS hex (#RRGGBB) to FFmpeg hex (0xRRGGBB) for drawtext boxcolor.
// FFmpeg drawtext interprets 0xRRGGBB as RGB (confirmed by drawbox test).
// CSS colors can be passed directly: #00B4FF → 0x00B4FF → RGB(0,180,255) = cyan.
function toFfmpegColor(hex) {
    return '0x' + hex.replace(/^#/, '');
}
function buildArgs(program, args) {
    // Build a command string for cmd.exe (shell: true).
    // - Forward slashes only: backslashes in paths cause issues with cmd.exe parsing.
    // - Quote ALL args to prevent cmd.exe from interpreting special characters.
    //   Double-quotes protect semicolons from being treated as command separators.
    // - Escape internal double-quotes by doubling them (" → "").
    const toShellPath = (s) => s.replace(/\\/g, '/');
    const quoteArg = (s) => '"' + s.replace(/"/g, '""') + '"';
    const prog = quoteArg(toShellPath(program));
    const shellArgs = args.map(a => {
        const normalized = toShellPath(a);
        // Quote all args. This prevents cmd.exe from interpreting semicolons (;) as
        // command separators. FFmpeg receives quoted args correctly.
        return quoteArg(normalized);
    });
    return [prog, ...shellArgs].join(' ');
}
// Run FFmpeg via execSync — only use this for simple one-shot commands (no complex quoting issues).
// For anything with multiple inputs or filter_complex, use spawn() + buildArgs() instead.
function runSimpleFfmpeg(ffmpeg, ffArgs) {
    const cmd = `"${ffmpeg}" ${ffArgs.join(' ')}`;
    try {
        const out = (0, child_process_2.execSync)(cmd, { encoding: 'utf-8', timeout: 10 * 60 * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stderr: out };
    }
    catch (err) {
        return { code: err.status ?? 1, stderr: err.stderr?.toString() || err.message };
    }
}
// ─── Probe video dimensions ──────────────────────────────────────────────────────
async function probeVideoAspect(videoPath) {
    const ffprobe = (0, ffmpeg_paths_js_1.getFfprobePath)();
    const normalizedFfprobe = ffprobe.replace(/\\/g, '/');
    const normalizedVideoPath = videoPath.replace(/\\/g, '/');
    try {
        const out = (0, child_process_2.execSync)(`"${normalizedFfprobe}" -v error -select_streams v:0 -show_entries stream=width,height -of json "${normalizedVideoPath}"`, {
            encoding: 'utf-8',
            timeout: 15000,
        });
        const json = JSON.parse(out);
        const streams = json.streams;
        if (streams && streams.length > 0) {
            const width = Number(streams[0].width) || 0;
            const height = Number(streams[0].height) || 0;
            return { width, height, isShort: height >= width };
        }
    }
    catch (e) {
        console.warn('[probeVideoAspect] ffprobe failed:', e);
    }
    return null;
}
// ─── Probe video duration (for smart blur seek) ─────────────────────────────────
function probeVideoDuration(videoPath) {
    const ffprobe = (0, ffmpeg_paths_js_1.getFfprobePath)();
    const normalizedFfprobe = ffprobe.replace(/\\/g, '/');
    const normalizedVideoPath = videoPath.replace(/\\/g, '/');
    try {
        const out = (0, child_process_2.execSync)(`"${normalizedFfprobe}" -v error -show_entries format=duration -of json "${normalizedVideoPath}"`, { encoding: 'utf-8', timeout: 10000 });
        const json = JSON.parse(out);
        const dur = parseFloat(json.format?.duration || '0');
        return dur > 0 ? dur : 0;
    }
    catch (e) {
        return 0;
    }
}
// ─── Post-download: trim video with FFmpeg (fast re-mux, no re-encode) ──────────
// Uses -ss before -i for fast seek, then -t to limit duration.
// Output is stream-copied (not re-encoded) so it's very fast.
// Returns the path to the trimmed file.
async function trimVideo(sourcePath, outputPath, startSec, durationSec) {
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    return new Promise((resolve) => {
        const args = [
            '-ss', String(startSec),
            '-i', quotePath(sourcePath),
            '-t', String(durationSec),
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            '-y', quotePath(outputPath),
        ];
        const cmd = buildArgs(ffmpeg, args);
        const proc = (0, child_process_1.spawn)(cmd, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0 && fs_1.default.existsSync(outputPath)) {
                resolve({ success: true });
            }
            else {
                resolve({ success: false, error: stderr || `trim failed (code ${code})` });
            }
        });
        setTimeout(() => {
            if (!proc.killed)
                proc.kill();
            resolve({ success: false, error: 'trim timeout' });
        }, 120_000);
    });
}
// ─── Pre-speed: FFmpeg time-stretch after download ────────────────────────────
// Runs immediately after the source is downloaded so the rest of the pipeline
// (thumb, blur, render) sees a sped-up file whose duration already matches
// the final render output. This avoids paying full download bandwidth/time
// when the user has set render speed > 1.0.
//
// We re-encode video with libx264 ultrafast (setpts cannot be combined with
// -c:v copy — the filter needs decoded frames). For 360p H.264 source this
// finishes in 1-3s on CPU and produces a 5-15 MB output depending on duration.
// Audio is re-encoded to AAC with atempo chain so playback stays in sync.
// Output container is MP4 to keep player compatibility.
async function preSpeedVideo(sourcePath, outputPath, speed) {
    if (!speed || speed <= 0 || speed === 1.0) {
        return { success: false, error: 'speed must be > 0 and != 1.0' };
    }
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    // Build atempo chain: atempo supports 0.5–2.0. For higher speeds, chain multiple.
    let atempoChain = '';
    if (speed >= 0.5 && speed <= 2.0) {
        atempoChain = `atempo=${speed}`;
    }
    else if (speed > 2.0) {
        const factors = [];
        let remaining = speed;
        while (remaining > 2.0) {
            factors.push('2.0');
            remaining /= 2.0;
        }
        if (Math.abs(remaining - 1.0) > 1e-3)
            factors.push(remaining.toFixed(3));
        atempoChain = factors.map(f => `atempo=${f}`).join(',');
    }
    else {
        // < 0.5: use setpts-as-atempo by combining aspeed + audio PTS chain
        atempoChain = `atempo=0.5,atempo=${(speed / 0.5).toFixed(3)}`;
    }
    const videoFilter = `setpts=${(1 / speed).toFixed(6)}*PTS`;
    // Video time-stretch needs re-encoding (FFmpeg rejects setpts + streamcopy).
    // NVENC on RTX 5080 encodes 8 minutes of 360p H.264 in well under 1s;
    // libx264 ultrafast is the CPU fallback.
    const ffmpegVersion = (0, ffmpeg_paths_js_1.getFfmpegVersion)(ffmpeg);
    const videoCodec = ffmpegVersion.hasH264Nvenc
        ? ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'constqp', '-qp', '23']
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20'];
    const args = [
        '-i', quotePath(sourcePath),
        '-filter:v', videoFilter,
        '-filter:a', atempoChain,
        ...videoCodec,
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        '-y', quotePath(outputPath),
    ];
    return new Promise((resolve) => {
        const cmd = buildArgs(ffmpeg, args);
        const proc = (0, child_process_1.spawn)(cmd, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0 && fs_1.default.existsSync(outputPath)) {
                resolve({ success: true });
            }
            else {
                resolve({ success: false, error: stderr || `pre-speed failed (code ${code})` });
            }
        });
        setTimeout(() => {
            if (!proc.killed)
                proc.kill();
            resolve({ success: false, error: 'pre-speed timeout' });
        }, 10 * 60 * 1000);
    });
}
// ─── Pre-process: Blur background generation ───────────────────────────────────
// Smart seek: probes video duration first and seeks to a reliable position.
// For short videos (< 5min): seek to 25% of duration
// For long videos: seek to 5min (past intro, action typically starts)
// Falls back to first frame if seeking fails.
async function generateBlurBackground(videoPath, outputPath, width = 1080, height = 1920, 
/** Pass known duration to skip redundant ffprobe call (already fetched by getVideoInfo). */
duration) {
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    const run = (ffArgs) => new Promise((resolve) => {
        const cmd = buildArgs(ffmpeg, ffArgs);
        const proc = (0, child_process_1.spawn)(cmd, [], {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => resolve({ code: code ?? 1, stderr }));
        setTimeout(() => {
            if (!proc.killed)
                proc.kill();
            resolve({ code: -1, stderr: 'timeout' });
        }, 30_000);
    });
    // Use provided duration or probe if not known
    const videoDuration = duration ?? probeVideoDuration(videoPath);
    // Determine seek time:
    // - Video < 5min: seek to 25% of duration (mid-video, usually has action)
    // - Video >= 5min: seek to 5min (past intro)
    let seekTime;
    let seekLabel;
    if (videoDuration > 0 && videoDuration < 300) {
        seekTime = Math.max(1, Math.floor(videoDuration * 0.25));
        seekLabel = `${seekTime}s (25% of ${Math.floor(videoDuration)}s video)`;
    }
    else {
        seekTime = 300; // 5 minutes
        seekLabel = `5:00`;
    }
    // Primary: seek to determined position
    const primaryArgs = [
        '-ss', String(seekTime),
        '-i', quotePath(videoPath),
        '-vframes', '1',
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20`,
        '-y', quotePath(outputPath),
    ];
    let result = await run(primaryArgs);
    if (result.code === 0 && fs_1.default.existsSync(outputPath)) {
        (0, unified_log_js_1.devLog)(`[Blur] Generated blur bg (seek=${seekLabel})`);
        return { success: true };
    }
    // Fallback 1: try 10% of video (earlier position)
    if (duration != null && duration > 0) {
        const earlySeek = Math.max(1, Math.floor(duration * 0.10));
        const fallback1Args = [
            '-ss', String(earlySeek),
            '-i', quotePath(videoPath),
            '-vframes', '1',
            '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20`,
            '-y', quotePath(outputPath),
        ];
        result = await run(fallback1Args);
        if (result.code === 0 && fs_1.default.existsSync(outputPath)) {
            (0, unified_log_js_1.devLog)(`[Blur] Generated blur bg (seek=early ${earlySeek}s)`);
            return { success: true };
        }
    }
    // Fallback 2: first frame
    const fallback2Args = [
        '-i', quotePath(videoPath),
        '-vframes', '1',
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:20`,
        '-y', quotePath(outputPath),
    ];
    result = await run(fallback2Args);
    if (result.code !== 0) {
        return { success: false, error: result.stderr || `ffmpeg failed: ${result.code}` };
    }
    (0, unified_log_js_1.devLog)(`[Blur] Generated blur bg (seek=first frame)`);
    return { success: true };
}
// ─── Thumbnail extraction ──────────────────────────────────────────────────────
// Extract a single frame from a video file as JPEG thumbnail.
// Used after download to replace YouTube thumbnail URLs (which 404 for new uploads).
//
// FIX 2026-06-02: Smart seek based on video duration.
// Old behavior: always seek to 5s. Problem: many videos show YouTube chat overlay,
// logo watermarks, or intro sequences at the 5s mark — extracted thumbnail then
// looks broken. New behavior: probe duration first, then seek to a "clean" frame:
//   - Video < 30s: seek to mid-point (no time to skip intro)
//   - Video 30s–5min: seek to 30% (past intro, before any YouTube UI overlays)
//   - Video > 5min: seek to 30s (typical intro skip point)
// Falls back through [30%, 10%, 0s] if extraction fails at first position.
async function extractVideoThumbnail(videoPath, outputPath, seekTime = 5) {
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    // Compute list of fallback seek positions (most preferred first).
    const duration = probeVideoDuration(videoPath);
    const seekCandidates = [];
    if (duration > 0) {
        if (duration < 30) {
            seekCandidates.push(Math.max(1, Math.floor(duration / 2)));
        }
        else if (duration < 300) {
            seekCandidates.push(Math.max(5, Math.floor(duration * 0.30)));
            seekCandidates.push(Math.max(3, Math.floor(duration * 0.10)));
            seekCandidates.push(0);
        }
        else {
            seekCandidates.push(30);
            seekCandidates.push(15);
            seekCandidates.push(5);
        }
    }
    else {
        // Duration unknown (probe failed) — fall back to legacy 5s.
        seekCandidates.push(5);
    }
    const fmtSeek = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    let lastError = '';
    for (const seek of seekCandidates) {
        const seekStr = fmtSeek(seek);
        const result = await new Promise((resolve) => {
            const args = [
                '-ss', seekStr,
                '-i', videoPath,
                '-vframes', '1',
                '-vf', 'scale=1280:-2:force_original_aspect_ratio=decrease',
                '-q:v', '2',
                '-y', outputPath,
            ];
            const cmd = buildArgs(ffmpeg, args);
            const proc = (0, child_process_1.spawn)(cmd, [], {
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stderr = '';
            proc.stderr?.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                if (code === 0 && fs_1.default.existsSync(outputPath)) {
                    // Verify file is non-empty (filter chain errors sometimes produce 0-byte output)
                    try {
                        const size = fs_1.default.statSync(outputPath).size;
                        if (size < 1024) {
                            resolve({ success: false, error: `output too small (${size}B)` });
                            return;
                        }
                    }
                    catch (e) {
                        resolve({ success: false, error: e.message });
                        return;
                    }
                    resolve({ success: true, thumbnailPath: outputPath });
                }
                else {
                    resolve({ success: false, error: `ffmpeg exit ${code}: ${stderr.slice(0, 200)}` });
                }
            });
            setTimeout(() => {
                if (!proc.killed) {
                    proc.kill();
                    resolve({ success: false, error: 'timeout' });
                }
            }, 15_000);
        });
        if (result.success) {
            if (seek !== seekCandidates[0]) {
                (0, unified_log_js_1.devLog)(`[Thumbnail] seek=${seek}s worked (primary seek=${seekCandidates[0]}s failed: ${lastError})`);
            }
            return result;
        }
        lastError = result.error || 'unknown';
        (0, unified_log_js_1.devLog)(`[Thumbnail] seek=${seek}s failed: ${lastError.slice(0, 100)} — trying next fallback`);
        // Clean up failed output before retry
        try {
            fs_1.default.unlinkSync(outputPath);
        }
        catch { }
    }
    return { success: false, error: `all seek candidates failed: ${lastError}` };
}
// ─── Build filter complex for 3-zone layout ─────────────────────────────────────
// Canvas: [0     - headerH-1] = Header (top 20%)
//         [headerH - canvasH-titleH-1] = Video zone (middle 60%)
//         [canvasH-titleH - canvasH-1] = Title (bottom 20%)
//
// Strategy: build as one single semicolon-separated filtergraph.
// Each semicolon line can output multiple labels. Intermediate labels are
// guaranteed available to downstream lines because FFmpeg collects all
// labels before executing.
//
// GPU acceleration: uses scale_cuda/overlay_cuda when available (much faster than CPU).
function buildFilterComplex(opts) {
    const { headerOl, titleOl, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW, speedFilter, backgroundType = 'blur', titleOverlayPath, bottomBarOverlayPath, isShort = true, useCuda = true, fpsTarget = 30, trimStart = 0, trimDuration = 0, watermarkText, } = opts;
    // GPU pipeline (CPU FALLBACK 2026-06-02): scale_cuda/overlay_cuda with format=nv12 conversion.
    // scale_cuda outputs CUDA surface. overlay_cuda needs system RAM format.
    // format=nv12 after scale_cuda bridges the gap — output becomes system RAM NV12,
    // which overlay_cuda can consume directly.
    // Lanczos: best quality for CPU scale (scale=...:flags=lanczos). scale_cuda uses its own
    // built-in high-quality kernel — Lanczos flag on CUDA is silently ignored.
    //
    // FIX 2026-06-02: Force CPU scale/overlay even when useCuda=true. The mixed GPU/CPU
    // filter chain was broken — see buildChunkArgs comment for details. The single render
    // had the same "Impossible to convert between the formats" failure on landscape with
    // thumbnail bg. Re-enable CUDA once full format-conversion handling is added.
    const scale = 'scale';
    const ov = 'overlay';
    const scaleFlags = 'flags=lanczos';
    // [LEGACY — kept for reference]
    // const scale = useCuda ? 'scale_cuda' : 'scale'
    // const ov = useCuda ? 'overlay_cuda' : 'overlay'
    // const scaleFlags = useCuda ? '' : ':flags=lanczos'
    // ── LANDSCAPE layout: thumbnail bg + landscape video + part number ──
    // IMPORTANT: sections[1] = bgChain2 outputs [bg] via [1:v].
    // But bgScaleFilter replaces sections[1] with a different background filter.
    // The original sections[1] bgChain2 and sections[2] vzChain2 BOTH use [bg] label.
    // When we replace sections[1] with bgScaleFilter (which also outputs [bg]),
    // the vzChain2 that follows still references [bg] from sections[1]'s output.
    // This works because sections[2] references the [bg] label that bgScaleFilter produces.
    if (!isShort) {
        // Landscape: fit source video into canvas with center crop.
        // videoH = height of video zone in canvas (e.g., 50% of portrait canvas = 960px for 1920px canvas)
        // videoTop = vertical center of canvas for the video zone.
        //
        // CORRECT approach: scale SOURCE to videoH (not canvasH), then crop to canvasW.
        // - If canvasW <= videoH * 16/9: source is wide → crop horizontally (landscape source)
        // - If canvasW > videoH * 16/9: source is narrow → crop vertically (portrait-ish source)
        //
        // cropX: center-crop from scaled source (scaled to videoH tall) down to canvasW wide.
        // After scaling source to videoH: scaledW = videoH * 16/9 (landscape)
        // cropX = (scaledW - canvasW) / 2 = (videoH * 16/9 - canvasW) / 2
        // cropX >= 0: crop from both sides. cropX < 0: source narrower → use cropY branch.
        //
        // cropY: center-crop from scaled source (scaled to canvasW wide) down to videoH tall.
        // After scaling source to canvasW: scaledH = canvasW * 9/16 (landscape)
        // cropY = (scaledH - videoH) / 2 = (canvasW * 9/16 - videoH) / 2
        // cropY >= 0: crop from both top/bottom. cropY < 0: source taller → use cropX branch.
        // eslint-disable-next-line no-useless-assignment
        let videoChain2 = '';
        const cropXNum = Math.round((videoH * 16 / 9 - canvasW) / 2);
        // Speed-adjusted trim duration: when speed > 1, input timestamps are compressed,
        // so the same raw duration produces fewer output seconds.
        const speedAdjust = speedFilter
            ? (() => {
                const m = speedFilter.match(/setpts=([\d.]+)\/([\d.]+)\*PTS/);
                return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1;
            })()
            : 1;
        const adjustedDuration = trimDuration > 0 ? trimDuration * speedAdjust : 999999;
        if (cropXNum >= 0) {
            // Scale source to videoH tall (preserves aspect), then crop to canvasW wide.
            // e.g. canvas 1080x1920, videoH=960: scale 1920x1080 → 1707x960, crop 157 each side → 1080x960.
            const cropX = cropXNum;
            // Correct order: fps → setpts(speed) → trim → setpts(reset) → scale → crop
            // Speed BEFORE trim: compresses timestamps so trim duration refers to output seconds.
            const fpsTag = fpsTarget ? `fps=${fpsTarget},` : '';
            const speedTag = speedFilter ? `${speedFilter},` : '';
            const trimSection = (trimStart > 0 || trimDuration > 0)
                ? `[0:v]${fpsTag}${speedTag}trim=start=${trimStart}:duration=${adjustedDuration},setpts=PTS-STARTPTS,`
                : `[0:v]${fpsTag}${speedTag}setpts=PTS-STARTPTS,`;
            const cropY = videoTop;
            const sf = scaleFlags ? `:${scaleFlags}` : '';
            videoChain2 = `${trimSection}${scale}=-2:${videoH}${sf},crop=${canvasW}:${videoH}:${cropX}:${cropY}[vid]`;
        }
        else {
            const cropY = Math.round((canvasW * 9 / 16 - videoH) / 2) + videoTop;
            const fpsTag = fpsTarget ? `fps=${fpsTarget},` : '';
            const speedTag = speedFilter ? `${speedFilter},` : '';
            const trimSection = (trimStart > 0 || trimDuration > 0)
                ? `[0:v]${fpsTag}${speedTag}trim=start=${trimStart}:duration=${adjustedDuration},setpts=PTS-STARTPTS,`
                : `[0:v]${fpsTag}${speedTag}setpts=PTS-STARTPTS,`;
            const sf = scaleFlags ? `:${scaleFlags}` : '';
            videoChain2 = `${trimSection}${scale}=${canvasW}:-2${sf},crop=${canvasW}:${videoH}:0:${cropY >= 0 ? cropY : 0}[vid]`;
        }
        // [1:v] thumbnail → FILL canvas (not fit within).
        // force_original_aspect_ratio=increase: scale up until canvas is covered.
        // crop: center-cut to exact canvas dimensions — no black bars.
        const bgChain2 = `[1:v]${scale}=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2[bg]`;
        // Video OVER thumbnail bg: video at videoTop (below header), thumbnail shows in header zone.
        // [bg][vid]overlay=0:videoTop = bg bottom, vid top: bg shows in header/title zones, video covers video zone.
        // Z-order: bg (bottom), video (middle), headerOl (top) — thumbnail visible in header zone.
        const vzChain2 = `[bg][vid]${ov}=0:${videoTop}[vz]`;
        // Header overlay: scale header image to canvas width × headerH, overlay on [vz].
        // Z-order: bg (bottom) → video (middle) → headerOl (top).
        // Header on top → thumbnail shows in header zone (where video doesn't cover).
        const hdChain2 = headerOl?.src
            ? `[2:v]${scale}=${canvasW}:${headerH}:force_original_aspect_ratio=increase,crop=${canvasW}:${headerH}:(ow-iw)/2:(oh-ih)/2[hd];[vz][hd]${ov}=0:0[fh]`
            : '';
        // Title overlay (part number) at bottom
        if (titleOl?.content) {
            const sections = [videoChain2, bgChain2, vzChain2];
            if (hdChain2)
                sections.push(hdChain2);
            const titleBase = hdChain2 ? 'fh' : 'vz';
            if (titleOverlayPath) {
                // PNG overlay: scale title image and overlay
                const titleInputIdx = hdChain2 ? '3' : '2';
                sections.push(`[${titleInputIdx}:v]${scale}=${canvasW}:${titleH}:force_original_aspect_ratio=increase,crop=${canvasW}:${titleH}:(ow-iw)/2:(oh-ih)/2[titleScaled]`, `[${titleBase}][titleScaled]${ov}=0:${canvasH - titleH}[td]`);
            }
            else {
                // Drawtext fallback: add text on top of [fh] (or [vz]).
                // Z-order: bg → video → header → text (text on TOP of header).
                // CRITICAL: drawtext outputs to [tdo] (intermediate), NOT [fh].
                // Then overlay [fh][tdo]: [fh] (header) bottom, [tdo] (header+text) top.
                const fontSize = Math.max(24, Math.floor(titleH * 0.15));
                const escapedText = titleOl.content.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
                const borderColor = toFfmpegColor(titleOl.borderColor ?? '#00B4FF');
                // Landscape: title centered in header zone. headerH is TypeScript var — substitute numeric value.
                // FFmpeg drawtext can't use TS variable names; compute Y as fixed pixel value instead.
                // Center of header zone: headerH/2 (top of canvas to middle of header)
                // Then subtract text_h/2 to center text vertically in that zone.
                const titleY = Math.floor(headerH / 2); // integer — FFmpeg can subtract text_h from this
                const drawtext = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${titleY}-text_h/2:fontfile=${ffmpeg_shared_js_2.FONT_FILE}`;
                // [fh] (header) bottom, [tdo] (header+text) top → text on top of header
                sections.push(`[${titleBase}]${drawtext}[tdo]`);
                sections.push(`[${titleBase}][tdo]${ov}=0:0[td]`);
            }
            return sections.join('; ');
        }
        if (hdChain2)
            return [videoChain2, bgChain2, vzChain2, hdChain2].join('; ');
        return [videoChain2, bgChain2, vzChain2].join('; ');
    }
    // ── SHORT (vertical) layout: header + video + bottom bar ──
    // Layout: [0 .. headerH-1] = header overlay (top)
    //         [headerH .. canvasH-bottomBarH-1] = video (middle, bottom touches bar)
    //         [canvasH-bottomBarH .. canvasH-1] = bottom bar (opaque, y = canvasH-bottomBarH)
    //
    // Video shrinking: videoH = canvasH - headerH - bottomBarH.
    // BottomBarH defaults to 64px. Video bottom edge touches bar top edge — no overlap.
    //
    // Filter order (MIRRORS scripts/render-core.ps1):
    //   fps=30 → setpts=PTS-STARTPTS → trim → scale → crop
    // NO select='not(mod(n\,2))' — causes 2x frame halving when combined with fps=30.
    const needsTrim = trimStart > 0 || trimDuration > 0;
    const fpsTag = fpsTarget ? `fps=${fpsTarget},` : '';
    // fps BEFORE trim+setpts: normalizes framerate first, then setpts resets timestamps to 0.
    // Speed-adjusted trim duration: when speed > 1, input timestamps are compressed,
    // so the same raw duration produces fewer output seconds.
    const speedAdjust = speedFilter
        ? (() => {
            const m = speedFilter.match(/setpts=([\d.]+)\/([\d.]+)\*PTS/);
            return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1;
        })()
        : 1;
    const adjustedDuration = trimDuration > 0 ? trimDuration * speedAdjust : 999999;
    // Correct filter order: fps → setpts(speed) → trim → setpts(reset) → scale → crop
    // Speed BEFORE trim: compresses timestamps so trim duration refers to output seconds.
    const speedTag = speedFilter ? `${speedFilter},` : '';
    const trimSection = needsTrim
        ? `[0:v]${fpsTag}${speedTag}trim=start=${trimStart}:duration=${adjustedDuration},setpts=PTS-STARTPTS[trimmed]; `
        : `[0:v]${fpsTag}${speedTag}setpts=PTS-STARTPTS[trimmed]; `;
    // Video: fill canvas width, crop to videoH tall (bottomBarH gap left at bottom).
    // For 16:9 source → 9:16 canvas (1080x1920) with 64px bottom bar:
    //   scale=-2:videoH → source 1920x1080 → 1920x1472 (scales to target height, width auto)
    //   crop=canvasW:videoH:cropX:0 → crop center columns from scaled source
    //   cropX = (scaledW - canvasW) / 2 = (1920*videoH/1080 - canvasW) / 2
    //   Result: video covers rows headerH..(canvasH-bottomBarH-1), BG shows in header + bottom bar gap
    const scaledW = Math.round(videoH * 16 / 9);
    const cropX = Math.round((scaledW - canvasW) / 2);
    const sf = scaleFlags ? `:${scaleFlags}` : '';
    const scaleChain = `${trimSection}[trimmed]${scale}=-2:${videoH}${sf},crop=${canvasW}:${videoH}:${cropX}:0[vid]`;
    const videoChain = scaleChain;
    // Scale background to canvas — FILL canvas (not fit within).
    // BG shows through: header zone (top) + bottom bar gap (bottom).
    const bgChain = backgroundType === 'solid'
        ? `[1:v]null[bg]`
        : `[1:v]${scale}=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2,setsar=1[bg]`;
    // Header image scale (full canvas width) — FILL header zone
    // Use 'increase' so small header images (e.g. 320x160) scale UP to fill the zone
    const hdChain = headerOl?.src ? `[2:v]${scale}=${canvasW}:${headerH}:force_original_aspect_ratio=increase,crop=${canvasW}:${headerH}:(ow-iw)/2:(oh-ih)/2[hd]` : '';
    // Bottom bar: pre-rendered opaque PNG (canvasW x bottomBarH).
    // Y = canvasH - bottomBarH (top of bottom bar zone).
    // If bottomBarOverlayPath provided, use it (input index 3).
    // If not, drawtext inline on the bg at the bottom bar zone.
    // FIX 2026-06-02: PNG comes from cache as rgb24. hevc_nvenc rejects rgb24 with
    // -22 Invalid argument. Force format=yuv420p before the overlay to share the
    // same pixel format as the source video stream (also yuv420p).
    const bbOverlay = bottomBarOverlayPath ? `[3:v]format=yuv420p[bb]` : '';
    // Build sections
    // CORRECT z-order: bg(bottom) → video(middle) → bottom bar → header(top)
    // Layer chain:
    //   [bg][vid]overlay=0:headerH → [vz] (bg + video, bg shows in header + bottom bar gap)
    //   [vz][bb]overlay=0:bottomBarY → [vb] (bottom bar on top of video)
    //   [vb][hd]overlay=0:0 → [final] (header on top of bottom bar)
    const sections = [videoChain, bgChain];
    if (bbOverlay) {
        // Z-order: bg → video → [vz] → header → [vh] → bottom bar → [final]
        // Header (thumbnail) goes on TOP of video zone first (y=0, full header zone).
        // Then bottom bar goes on TOP of header+video zone (y=bottomBarY).
        // Bottom bar PNG is transparent at top (only bottom portion has the bar graphic).
        sections.push(`[bg][vid]${ov}=0:${headerH}[vz]`);
        if (hdChain) {
            // Header on TOP of [vz] → [vh]
            sections.push(hdChain, `[vz][hd]${ov}=0:0[vh]`);
        }
        else {
            sections.push(`[vz]null[vh]`);
        }
        // Bottom bar on TOP of header+video → [final]
        sections.push(bbOverlay, `[vh][bb]${ov}=0:${headerH + videoH}[final]`);
    }
    else if (hdChain) {
        // CORRECT: create [vz] first (bg + video), then overlay header on top.
        sections.push(`[bg][vid]${ov}=0:${headerH}[vz]`, hdChain, `[vz][hd]${ov}=0:0[final]`);
    }
    else if (titleOl?.content) {
        // CORRECT: create [vz] first (bg + video), then apply drawtext on top.
        sections.push(`[bg][vid]${ov}=0:${headerH}[vz]`);
        const bbY = headerH + videoH; // top of bottom bar zone
        const bbCenter = bbY + Math.floor((canvasH - bbY) / 2);
        const fontSize = Math.max(24, Math.floor((canvasH - bbY) * 0.25));
        const escapedText = titleOl.content.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
        const borderColor = toFfmpegColor(titleOl.borderColor ?? '#00B4FF');
        const baseLabel = hdChain ? 'fh' : 'vz';
        const drawtext = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${bbCenter}-text_h/2:fontfile=${ffmpeg_shared_js_2.FONT_FILE}`;
        sections.push(`[${baseLabel}]${drawtext}[final]`);
    }
    const fc = sections.join('; ');
    // ── Watermark: draw license info at bottom-right corner ────────────────────────
    // Watermark is ALWAYS the last step — applied after all other overlays.
    // Determine the correct output label (last used label in the chain).
    // Then apply watermark on top of it.
    const lastLabel = sections.length > 0
        ? (sections[sections.length - 1].match(/\[([^\]]+)\]$/m)?.[1] ?? 'final')
        : 'final';
    const wmFc = watermarkText
        ? fc + `; [${lastLabel}]drawtext=text='${watermarkText.replace(/'/g, "\\'").replace(/:/g, "\\:")}':fontsize=${Math.max(6, Math.floor(canvasH * 0.008))}:fontcolor=ffffff44:borderw=1:bordercolor=00000088:x=(w-text_w)-${Math.floor(canvasW * 0.015)}:y=(h-text_h)-${Math.floor(canvasH * 0.01)}:fontfile=${ffmpeg_shared_js_2.FONT_FILE}[wm_final]`
        : fc;
    (0, unified_log_js_1.devLog)(`[FilterComplex] ${wmFc}`);
    return wmFc;
}
// ─── Optimized NVENC parameters ─────────────────────────────────────────────────
// Per-architecture NVENC tuning for RTX 5080 and other GPUs.
// Uses GPUCapabilities to get architecture-specific session limits and surface counts.
//
// RTX 5080 specific optimizations:
// - 2 NVENC engines → dual parallel encode
// - 16GB VRAM → high surface counts
// - Ada Lovelace arch → full NVENC feature set
// - HEVC preferred: same quality at 20-30% less encode work vs H.264
function getNvencParams(codec, isChunked, gpuTier = 'software', canvasW = 0, canvasH = 0, userPreset) {
    const isHighTier = gpuTier === 'high';
    const isMidTier = gpuTier === 'mid';
    // Fall back to CPU encoding (libx264/libx265) when NVENC is unavailable
    // (e.g. RTX 5080 driver incompatible with FFmpeg build's NVENC).
    if (gpuTier === 'software' || gpuTier === 'low') {
        const cpuPreset = 'ultrafast';
        const threads = String(Math.min(os_1.default.cpus().length, 8));
        if (codec === 'hevc') {
            return ['-preset', cpuPreset, '-crf', '26', '-c:v', 'libx265', '-threads', threads];
        }
        else {
            return ['-preset', cpuPreset, '-crf', '22', '-c:v', 'libx264', '-threads', threads];
        }
    }
    // RTX 5080 (high tier): always p1 — maximum encode speed
    // Mid tier: p2 for chunked (speed), p3 for single (quality)
    // Low tier: p3 for both
    const preset = userPreset || (isChunked
        ? (isHighTier ? 'p1' : isMidTier ? 'p2' : 'p3')
        : (isHighTier ? 'p1' : 'p3'));
    // HEVC on NVENC: same visual quality at 20-30% less bitrate = faster encode
    // H.264: slightly better hardware support, use for compatibility
    // CQ levels: lower = better quality, higher = faster encode
    const cq = codec === 'hevc'
        ? (isChunked ? '26' : '23') // HEVC: higher CQ (less work) still looks great
        : (isChunked ? '22' : '19'); // H.264: lower CQ needed for same quality
    // Tune: ull = ultra-low-latency for RTX 5080 (max speed)
    //        ll  = low-latency for mid-tier
    //        hq  = high quality for single-pass
    const tune = isChunked
        ? (isHighTier ? 'ull' : isMidTier ? 'll' : 'll')
        : (isHighTier ? 'ull' : 'hq');
    // Bitrate cap based on output resolution.
    // Portrait upscaling needs more bitrate for smooth gradients.
    let maxBitrate = '';
    if (canvasH > 0) {
        if (canvasH <= 640)
            maxBitrate = '3000k';
        else if (canvasH <= 1080)
            maxBitrate = '6000k';
        else
            maxBitrate = '12000k';
    }
    const params = [
        '-preset', preset,
        '-rc', 'vbr_hq',
        '-cq', cq,
        '-tune', tune,
        '-bf', '0', // No B-frames → minimal latency
        '-refs', '1', // Single reference frame
        '-g', '30', // GOP=30 (keyframe every second at 30fps)
        '-strict_gop', '1', // RTX 5080: prevents irregular GOP stuttering
    ];
    // Bitrate cap for VBR mode — prevents oversized files
    if (maxBitrate) {
        const bufsizeK = String(parseInt(maxBitrate) * 2) + 'k';
        params.push('-maxrate', maxBitrate, '-bufsize', bufsizeK);
    }
    if (isChunked) {
        params.push('-rc-lookahead', '0', // Zero-latency encode (ull tune)
        '-spatial-aq', '1', // Adaptive quantization for quality
        '-aq-strength', '8', '-no-scenecut', '1', // Disable scene-cut detection — faster encode
        '-forced-idr', '1');
        // Surface pool: RTX 5080 16GB VRAM can handle high counts
        // High surfaces = fewer encoder stalls waiting for frame buffers
        // 64 for high tier (RTX 5080/4090), 32 mid, 16 low
        const surfaceCount = isHighTier ? 64 : (isMidTier ? 32 : 16);
        params.push('-surfaces', String(surfaceCount));
        params.push('-gpu', 'any');
    }
    else {
        params.push('-rc-lookahead', '32', // Bumped 16→32: better rate control with minimal latency hit on single-pass
        '-spatial-aq', '1', '-aq-strength', '9', '-no-scenecut', '1', '-forced-idr', '1', '-b_ref_mode', 'middle');
        params.push('-gpu', 'any');
    }
    return params;
}
// ─── Pre-render text overlay to PNG (avoids CPU drawtext per-frame) ──────────────
// Replaces drawtext CPU filter with a pre-generated overlay PNG.
// FFmpeg's drawtext runs on CPU every frame — this is the biggest bottleneck.
// Pre-rendering: generate the text box ONCE, overlay as image every frame (CUDA fast).
async function renderTextOverlay(text, canvasW, canvasH, headerH, titleH, videoTop, borderColor, bgColor, fontSize, outputPath) {
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    // Title box layout
    const boxW = Math.floor(canvasW * 0.66);
    const boxH = Math.floor(titleH * 0.55);
    const boxY = canvasH - Math.floor(titleH * 0.72);
    const boxX = Math.floor((canvasW - boxW) / 2);
    // Extract alpha from bgColor
    const alphaMatch = bgColor.match(/[\d.]+(?=\)$)/);
    const alpha = alphaMatch ? parseFloat(alphaMatch[0]) : 0.12;
    // Font: use Arial from Windows system fonts (fontfile param bypasses fontconfig).
    // FFmpeg gyan.dev build on Windows needs fontconfig, which is usually unavailable.
    // Arial is present on every Windows 10/11 install.
    const fs2 = Math.max(40, fontSize * 5);
    // Escape text for FFmpeg drawtext: escape single quotes and backslashes.
    // FFmpeg drawtext also needs colons escaped (we use :borderw etc. in the same string).
    const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    // Build a single FFmpeg filter_complex string using native comma-chaining.
    // Using comma-chains (filter1,filter2,...) instead of semicolons to avoid cmd.exe
    // shell quoting issues when the command is passed through buildArgs + spawn(shell:true).
    //
    // FFmpeg 7.x SYNTAX CHANGE: removed `c=` prefix from color values.
    // FFmpeg 7.x SYNTAX CHANGE: fontfile must use DOUBLE quotes, not single quotes.
    //   Single quotes around the Windows path cause "No option name near '/Windows/...'"
    //   because FFmpeg 7.x lavfi parser doesn't treat single quotes as string delimiters.
    const filter = 
    // Generate semi-transparent bg color source (FFmpeg 7.x syntax)
    `color=${borderColor}@${alpha}:s=${boxW}x${boxH}:d=1:r=1,` +
        `format=yuva420p[bg];` +
        // Solid border color source (FFmpeg 7.x syntax)
        `color=${borderColor}:s=${boxW}x${boxH}:d=1:r=1,` +
        `format=yuva420p[border];` +
        // Draw text centered in box (FFmpeg 7.x syntax, double-quoted fontfile for FFmpeg 7.x)
        `color=black:s=${boxW}x${boxH}:d=1:r=1,` +
        `drawtext=text='${escapedText}':fontsize=${fs2}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=${ffmpeg_shared_js_2.FONT_FILE}[texted];` +
        // Overlay border on bg
        `[bg][border]overlay=x=${boxX}:y=${boxY},format=yuva420p[bgBorder];` +
        // Overlay text on bg+border
        `[bgBorder][texted]overlay=x=${boxX}:y=${boxY},format=yuva420p[bgBorderText];` +
        // Crop final to box size, then pad to full canvas (FFmpeg 7.x syntax)
        `crop=${boxW}:${boxH}:${boxX}:${boxY},` +
        `pad=${canvasW}:${canvasH}:0:0:color=black@0.0[out]`;
    return new Promise((resolve) => {
        const args = [
            '-f', 'lavfi',
            '-i', `color=black:s=${canvasW}x${canvasH}:d=1:r=1`,
            '-filter_complex', filter,
            '-map', '[out]',
            '-frames:v', '1',
            '-y', outputPath, // buildArgs already quotes each arg — do NOT double-quote
        ];
        const cmd = buildArgs(ffmpeg, args);
        const proc = (0, child_process_1.spawn)(cmd, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0 && fs_1.default.existsSync(outputPath)) {
                resolve({ success: true, overlayPath: outputPath });
            }
            else {
                resolve({ success: false, error: stderr || `ffmpeg exited ${code}` });
            }
        });
        setTimeout(() => {
            if (!proc.killed)
                proc.kill();
            resolve({ success: false, error: 'timeout' });
        }, 30_000);
    });
}
// Pre-render overlays to PNG using PowerShell System.Drawing.
// FFmpeg gyan.dev 7.x does NOT support `color:alpha=N` → pre-render via FFmpeg impossible.
//
// SHORT mode: bottom bar PNG (opaque accent-colored bar with white text at bottom).
// LANDSCAPE mode: title overlay PNG (border+text, used in title zone).
async function preRenderOverlays(metadata, outputDir, workspaceId, gpuTier = 'software') {
    // Bottom bar is created when bottomBarEnabled=true (regardless of title text).
    // If there's title text, it's drawn on the bar. If not, the bar is still created (solid color bar).
    const titleOl = metadata.overlays?.find(o => o.type === 'title' && o.content);
    const bottomBarEnabled = metadata.bottomBarEnabled !== false; // default true
    if (!bottomBarEnabled)
        return { bottomBarOverlayPath: null, titleOverlayPath: null, error: null };
    // Text on bar (empty string if no title text)
    const barText = titleOl?.content || 'PART 1';
    // Zone math
    const [canvasW, canvasH] = (metadata.export_resolution || '1080x1920').split('x').map(Number);
    const isShort = canvasH >= canvasW;
    const bottomBarH = metadata.bottomBarH ?? Math.floor(canvasH * ffmpeg_shared_js_2.BOTTOM_PCT);
    const vidHeightPct = metadata.vidHeightPct ?? 50;
    const landscapeTitleH = Math.floor(canvasH * (100 - vidHeightPct) / 100);
    // Hex color: use editorState.bottomBarColor (for SHORT bottom bar) first,
    // fallback to titleOl.borderColor (for LANDSCAPE title) if not available.
    const hex = (metadata.bottomBarColor || titleOl?.borderColor || '#00B4FF').replace(/^#/, '');
    // ── Pure FFmpeg lavfi path (replaces PowerShell System.Drawing) ──────────
    // Benefits: ~50-100ms vs ~500-1000ms PowerShell cold-start + GDI+ + LockBits
    //   No external process spawn overhead
    //   Native Vietnamese text rendering via fontfile
    //   No temp .ps1 file write/read
    const bottomBarOverlayPath = path_1.default.join(outputDir, 'bottom_bar_overlay.png').replace(/\\/g, '/');
    const titleOverlayPath = path_1.default.join(outputDir, 'title_overlay.png').replace(/\\/g, '/');
    const blurPath = metadata.blur_background;
    // Escape drawtext text per FFmpeg 7.x rules: single quotes, colons, brackets
    const escapeDrawText = (s) => s
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
    // Helper: run a single FFmpeg lavfi command (shell:false for speed)
    const runFfmpegNative = (args, timeoutMs = 10000) => {
        const ffmpegBin = (0, ffmpeg_paths_js_1.getFfmpegPath)();
        return new Promise((resolve) => {
            const proc = (0, child_process_1.spawn)(ffmpegBin, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
            let se = '';
            proc.stderr?.on('data', (d) => { se += d.toString(); });
            proc.on('close', (code) => resolve({ code: code ?? 1, stderr: se }));
            proc.on('error', (e) => resolve({ code: -1, stderr: e.message }));
            setTimeout(() => {
                if (!proc.killed)
                    proc.kill();
                resolve({ code: -2, stderr: 'timeout' });
            }, timeoutMs);
        });
    };
    // ── SHORT mode: bottom bar PNG (canvasW × bottomBarH) ──────────────────
    // Pipeline: [blur|solid bg] → [drawbox gradient] → [drawtext white]
    // Gradient: dark overlay on top 60% — simulated with drawbox + alpha.
    const bbFontSize = Math.max(28, Math.floor(bottomBarH * 0.25));
    const gradientH = Math.floor(bottomBarH * 0.60);
    const escapedBarText = escapeDrawText(barText);
    let bbFilter;
    let bbArgs;
    if (blurPath && fs_1.default.existsSync(blurPath)) {
        // Blur bg: input is JPG, scale to bar dimensions
        const normBlur = blurPath.replace(/\\/g, '/');
        bbFilter =
            `[0:v]scale=${canvasW}:${bottomBarH}:force_original_aspect_ratio=increase,crop=${canvasW}:${bottomBarH}:(ow-iw)/2:(oh-ih)/2[scaled];` +
                // Dark gradient overlay: top 60% with 78% opacity → fades to transparent
                `[scaled]drawbox=x=0:y=0:w=${canvasW}:h=${gradientH}:color=black@0.78:t=fill[grad];` +
                // White text centered
                `[grad]drawtext=text='${escapedBarText}':fontsize=${bbFontSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=${ffmpeg_shared_js_2.FONT_FILE}[out]`;
        bbArgs = [
            '-i', normBlur,
            '-filter_complex', bbFilter,
            '-map', '[out]',
            '-frames:v', '1',
            '-y', bottomBarOverlayPath,
        ];
    }
    else {
        // No blur bg: solid accent color background (FFmpeg 7.x syntax: no `c=` prefix)
        bbFilter =
            `color=${hex}:s=${canvasW}x${bottomBarH}:d=1:r=1,format=yuva420p[bg];` +
                // Dark gradient overlay on top 60%
                `[bg]drawbox=x=0:y=0:w=${canvasW}:h=${gradientH}:color=black@0.78:t=fill[grad];` +
                // White text centered
                `[grad]drawtext=text='${escapedBarText}':fontsize=${bbFontSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=${ffmpeg_shared_js_2.FONT_FILE}[out]`;
        bbArgs = [
            '-f', 'lavfi',
            '-i', `color=${hex}:s=${canvasW}x${bottomBarH}:d=1:r=1`,
            '-filter_complex', bbFilter,
            '-map', '[out]',
            '-frames:v', '1',
            '-y', bottomBarOverlayPath,
        ];
    }
    // ── LANDSCAPE mode: title overlay PNG (canvasW × titleBarH, transparent) ──
    const titleBarH = landscapeTitleH;
    const borderPx = Math.max(5, Math.floor(titleBarH * 0.02));
    const titleFontSize = Math.max(28, Math.floor(titleBarH * 0.28));
    const escapedTitleText = escapeDrawText(titleOl?.content || '');
    const titleFilter = `color=black@0:s=${canvasW}x${titleBarH}:d=1:r=1,format=yuva420p[bg];` +
        // Border rectangle (outline only)
        `[bg]drawbox=x=${borderPx}:y=${borderPx}:w=${canvasW - borderPx * 2}:h=${titleBarH - borderPx * 2}:color=${hex}@1.0:t=${borderPx}[border];` +
        // White text centered
        `[border]drawtext=text='${escapedTitleText}':fontsize=${titleFontSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=${ffmpeg_shared_js_2.FONT_FILE}[out]`;
    const titleArgs = [
        '-f', 'lavfi',
        '-i', `color=black@0:s=${canvasW}x${titleBarH}:d=1:r=1`,
        '-filter_complex', titleFilter,
        '-map', '[out]',
        '-frames:v', '1',
        '-y', titleOverlayPath,
    ];
    // Run both pure-FFmpeg overlay generations in parallel
    const [bbResult, titleResult] = await Promise.all([
        runFfmpegNative(bbArgs),
        isShort ? Promise.resolve({ code: 0, stderr: '' }) : runFfmpegNative(titleArgs),
    ]);
    const bbOk = bbResult.code === 0 && fs_1.default.existsSync(bottomBarOverlayPath);
    const titleOk = isShort || (titleResult.code === 0 && fs_1.default.existsSync(titleOverlayPath));
    if (bbOk)
        (0, unified_log_js_1.devLog)('[TextOverlay] Bottom bar: ' + bottomBarOverlayPath);
    else
        (0, unified_log_js_1.devLog)('[TextOverlay] Bottom bar failed: ' + bbResult.stderr.slice(0, 150));
    if (!isShort) {
        if (titleOk)
            (0, unified_log_js_1.devLog)('[TextOverlay] Title overlay: ' + titleOverlayPath);
        else
            (0, unified_log_js_1.devLog)('[TextOverlay] Title overlay failed: ' + titleResult.stderr.slice(0, 150));
    }
    return {
        bottomBarOverlayPath: bbOk ? bottomBarOverlayPath : null,
        titleOverlayPath: isShort ? null : (titleOk ? titleOverlayPath : null),
        error: null,
    };
}
// ─── Smart keyframe finder ──────────────────────────────────────────────────────
// Scans only near target split points instead of reading the entire file.
// For a 30-min video with 8 chunks: ~8 seeks × 4s = ~2s vs 10+ seconds full scan.
// Parallel keyframe probe — all positions searched simultaneously.
// For a 30-min video with 8 chunks: ~8 concurrent seeks × ~200ms each = ~200ms total vs ~2s sequential.
function probeKeyframeNear(ffprobe, videoPath, targetTime, seekWindow = 2) {
    const seekFrom = Math.max(0, targetTime - seekWindow);
    const args = [
        '-v', 'quiet',
        '-select_streams', 'v:0',
        '-show_entries', 'packet=pts_time,flags',
        '-skip_frame', 'nokey',
        '-ss', String(seekFrom),
        '-to', String(targetTime + seekWindow),
        '-of', 'csv=p=0',
        quotePath(videoPath),
    ];
    const cmd = buildArgs(ffprobe, args);
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)(cmd, [], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        proc.stdout?.on('data', (d) => { stdout += d.toString(); });
        proc.on('close', () => resolve(stdout.split('\n')));
        proc.on('error', () => resolve([]));
    });
}
async function findKeyframeSmart(videoPath, totalDuration, targetCount) {
    if (targetCount <= 1 || totalDuration <= 120)
        return [];
    const ffprobe = (0, ffmpeg_paths_js_1.getFfprobePath)();
    // Probe at evenly-spaced positions and find nearest keyframe ±2s
    const probePositions = [];
    for (let i = 1; i <= targetCount; i++) {
        probePositions.push((totalDuration / (targetCount + 1)) * i);
    }
    // Fire ALL probes in parallel — critical for performance
    const allLines = await Promise.all(probePositions.map(t => probeKeyframeNear(ffprobe, videoPath, t, 2)));
    const keyframes = [];
    const seen = new Set();
    for (const lines of allLines) {
        for (const line of lines) {
            const match = line.match(/^([\d.]+)/);
            if (!match)
                continue;
            const ts = parseFloat(match[1]);
            // Deduplicate within 0.5s window
            const bucket = Math.round(ts * 2) / 2;
            if (seen.has(bucket))
                continue;
            if (ts > 0 && ts < totalDuration) {
                seen.add(bucket);
                keyframes.push(ts);
            }
        }
    }
    keyframes.sort((a, b) => a - b);
    return keyframes;
}
function shouldRetryWithSoftwareDecode(error) {
    const msg = (error || '').toLowerCase();
    return msg.includes('late sei')
        || msg.includes('error while decoding')
        || msg.includes('invalid data found')
        || msg.includes('error marking filters as finished')
        || msg.includes('could not find codec parameters')
        || msg.includes('no frame');
}
function stripHwAccelArgs(args) {
    const stripped = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-hwaccel') {
            i += 1;
            continue;
        }
        if (a === '-hwaccel_device') {
            i += 1;
            continue;
        }
        if (a === '-hwaccel_output_format') {
            i += 1;
            continue;
        }
        if (a === '-c:v' && (args[i + 1] === 'h264_nvdec' || args[i + 1] === 'hevc_nvdec' || args[i + 1] === 'h264_cuvid' || args[i + 1] === 'hevc_cuvid')) {
            i += 1;
            continue;
        }
        stripped.push(a);
    }
    return stripped;
}
async function renderVideo(metadata, outputDir, onProgress, gpuTier = 'software') {
    const { workspace_id, source_video, export_resolution, video_speed, fps_target, overlays, trim, codec = 'h264', backgroundType = 'blur', backgroundColor = '#000000', backgroundImage, blur_background, vidHeightPct = 50, audioCodec = gpuTier === 'high' ? 'libopus' : 'aac', audioBitrate = '192k', } = metadata;
    const [outW, outH] = export_resolution.split('x').map(Number);
    if (!outW || !outH) {
        return { success: false, workspaceId: workspace_id, error: 'Invalid resolution' };
    }
    // Determine SHORT vs LANDSCAPE from canvas dimensions (not source aspect ratio)
    const resolvedIsShort = outH >= outW;
    const outputFile = path_1.default.join(outputDir, `${workspace_id}_output.mp4`);
    const canvasW = outW;
    const canvasH = outH;
    // If user chose "blur" but no blur file exists, fall back to image
    const effectiveBackgroundType = (backgroundType === 'blur' && !blur_background) ? 'image' : backgroundType;
    // Zone dimensions
    const bottomBarH = metadata.bottomBarH ?? Math.floor(canvasH * ffmpeg_shared_js_2.BOTTOM_PCT);
    const headerH = resolvedIsShort
        ? Math.floor(canvasH * ffmpeg_shared_js_2.HEADER_PCT)
        : Math.floor((canvasH - Math.floor(canvasH * vidHeightPct / 100)) / 2);
    const videoH = resolvedIsShort
        ? canvasH - headerH - bottomBarH
        : Math.floor(canvasH * vidHeightPct / 100);
    const videoTop = resolvedIsShort ? headerH : Math.floor((canvasH - videoH) / 2);
    const videoW = Math.floor(videoH * 16 / 9);
    const trimStart = trim.start;
    const trimEnd = trim.end;
    const trimDuration = trimEnd - trimStart;
    // Audio speed filter: when video speed != 1.0, audio must be sped up/down too.
    // atempo: 0.5 to 2.0 range. For speed > 2.0, chain multiple atempo filters.
    // e.g. speed=2.5 → 'atempo=2.0,atempo=1.25'; speed=4.0 → 'atempo=2.0,atempo=2.0'
    const audioSpeedFilter = (() => {
        if (!video_speed || video_speed === 1.0)
            return null;
        const s = video_speed;
        if (s >= 0.5 && s <= 2.0)
            return `atempo=${s}`;
        if (s > 2.0) {
            const factors = [];
            let remaining = s;
            while (remaining > 2.0) {
                factors.push('2.0');
                remaining /= 2.0;
            }
            if (remaining !== 1.0)
                factors.push(remaining.toFixed(2));
            return 'atempo=' + factors.join(',atempo=');
        }
        if (s < 0.5) {
            // atempo minimum is 0.5. For slower speeds, use PTS stretch instead (audio desync acceptable for < 1.0)
            return null;
        }
        return null;
    })();
    // Speed-adjusted output duration: trim duration divided by speed multiplier.
    // e.g. 4:00 (240s) at 1.2x speed → 200s output.
    const duration = video_speed !== 1.0 ? trimDuration / video_speed : trimDuration;
    // Speed filter: setpts to change playback speed
    const speedFilter = video_speed !== 1.0 ? `setpts=${1 / video_speed}*PTS` : '';
    // Overlay inputs from editor
    const headerOl = overlays.find(o => o.type === 'header' && o.src);
    const titleOl = overlays.find(o => o.type === 'title' && o.content);
    // Encoder
    const isGpuAvailable = gpuTier !== 'software';
    const nvencCodec = isGpuAvailable
        ? (codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc')
        : (codec === 'hevc' ? 'libx265' : 'libx264');
    const numThreads = Math.min(os_1.default.cpus().length, 16);
    // Pre-render overlays (bottom bar PNG for SHORT, title PNG for LANDSCAPE).
    // FIX 2026-06-02: Use overlay_cache — PNGs are pre-rendered at settings-save time
    // and cached by content hash. If cache hit, skip the render entirely (50-100ms saved).
    // NOTE: bottom bar / title overlay are INDEPENDENT of background type — they should
    // always be rendered (when bottomBarEnabled=true) regardless of whether bg is
    // blur/image/solid. The previous version had a wrong condition that only triggered
    // for blur bg without source, missing SHORT mode with image bg (thumbnail).
    const titleOlForCache = metadata.overlays?.find(o => o.type === 'title' && o.content);
    const barTextForCache = titleOlForCache?.content || 'PART 1';
    const colorForCache = (metadata.bottomBarColor || titleOlForCache?.borderColor || '#00B4FF').replace(/^#/, '');
    let bottomBarOverlayPath;
    let titleOverlayPath;
    if (resolvedIsShort) {
        bottomBarOverlayPath = await (0, overlay_cache_js_1.getBottomBarPng)({
            canvasW, canvasH,
            bottomBarH: metadata.bottomBarH ?? Math.floor(canvasH * ffmpeg_shared_js_2.BOTTOM_PCT),
            barText: barTextForCache,
            colorHex: colorForCache,
        }) || undefined;
    }
    else {
        const titleBarH = Math.floor(canvasH * (100 - vidHeightPct) / 100);
        titleOverlayPath = await (0, overlay_cache_js_1.getTitleOverlayPng)({
            canvasW, titleBarH,
            titleText: barTextForCache,
            colorHex: colorForCache,
        }) || undefined;
    }
    // Build filter complex using the corrected SHORT/LANDSCAPE logic.
    // Pass raw trimDuration (not speed-adjusted) — buildFilterComplex applies speed
    // filter BEFORE trim, so it calculates the speed-adjusted duration internally.
    const filterComplex = buildFilterComplex({
        useCuda: getHwCaps().hasCudaFilters,
        headerOl,
        titleOl,
        canvasW,
        canvasH,
        headerH,
        titleH: 0,
        videoH,
        videoTop,
        videoW,
        speedFilter,
        backgroundType: effectiveBackgroundType,
        titleOverlayPath,
        bottomBarOverlayPath,
        isShort: resolvedIsShort,
        fpsTarget: fps_target || 30,
        trimStart,
        trimDuration: trimDuration,
        watermarkText: metadata.watermarkText,
    });
    // Determine which output label from the filter chain to use
    // If watermark is enabled, the final label is [wm_final]
    const hasWatermark = !!(metadata.watermarkText);
    let mapOutput = hasWatermark ? '[wm_final]' : '[vz]';
    if (!hasWatermark) {
        if (resolvedIsShort) {
            if (bottomBarOverlayPath || titleOl?.content)
                mapOutput = '[final]';
            else if (headerOl?.src)
                mapOutput = '[fh]';
        }
        else {
            if (titleOverlayPath)
                mapOutput = '[final]';
            else if (titleOl?.content)
                mapOutput = '[td]';
            else if (headerOl?.src)
                mapOutput = '[fh]';
        }
    }
    (0, unified_log_js_1.devLog)(`[RenderLayout] canvas=${canvasW}x${canvasH} isShort=${resolvedIsShort} headerH=${headerH} videoH=${videoH} videoTop=${videoTop} bottomBarH=${bottomBarH}`);
    (0, unified_log_js_1.devLog)(`[FilterComplex] ${filterComplex}`);
    // ── ENCODER CONFIG ───────────────────────────────────────────────────────
    const encParams = isGpuAvailable ? getNvencParams(codec, false, gpuTier, canvasW, canvasH, metadata.preset) : ['-preset', 'ultrafast', '-crf', '20'];
    const srcExists = fs_1.default.existsSync(source_video);
    const srcSize = srcExists ? Math.round(fs_1.default.statSync(source_video).size / 1024 / 1024) : 0;
    const crfVal = codec === 'hevc' ? (isGpuAvailable ? '20' : '26') : (isGpuAvailable ? '18' : '22');
    const maxrateVal = canvasH <= 640 ? '3M' : canvasH <= 1080 ? '6M' : '12M';
    const bufsizeVal = canvasH <= 640 ? '6M' : canvasH <= 1080 ? '12M' : '24M';
    (0, unified_log_js_1.devLog)(`[RenderConfig] SOURCE=${source_video} (${srcSize}MB) CANVAS=${canvasW}x${canvasH}(${canvasH}p) CODEC=${nvencCodec} PRESET=${metadata.preset || (isGpuAvailable ? 'p3' : 'ultrafast')} CRF=${crfVal} MAXRATE=${maxrateVal} BUFSIZE=${bufsizeVal} HEADER=${headerOl?.src || 'THUMBNAIL_FALLBACK'} BOTTOMBAR=${bottomBarOverlayPath ? 'ENABLED' : 'DISABLED'} BGTYPE=${effectiveBackgroundType} SPEED=${video_speed || 1}x TRIM=${trimStart}s-${trimStart + duration}s(${duration}s) AUDIO=${metadata.audioCodec || 'aac'}/${metadata.audioBitrate || '192k'} OUTPUT=${outputFile}`);
    (0, unified_log_js_1.devLog)(`[RenderConfig] FFMPEG=${(0, ffmpeg_paths_js_1.getFfmpegPath)()}`);
    (0, unified_log_js_1.devLog)(`[RenderConfig] ENCPARAMS=${encParams.join(' ')}`);
    // ───────────────────────────────────────────────────────────────────────
    // Normalize all paths to forward slashes for FFmpeg on Windows (avoids backslash escaping issues).
    const normPath = (p) => p.replace(/\\/g, '/');
    // Build FFmpeg args
    // Inputs: [0]=source, [1]=background, [2]=header image, [3]=overlay PNG
    const hwaccelFlags = getHwAccelFlags(codec);
    const args = [
        ...hwaccelFlags,
        '-threads', String(numThreads),
        '-filter_threads', String(Math.min(numThreads, 8)),
        '-avoid_negative_ts', 'make_zero',
        '-i', normPath(source_video),
        // Background: solid color, image, or blur thumbnail
        // FIX 2026-06-02: All image inputs use `-framerate 30` to prevent 25fps regression
        // (PNG defaults to 25fps when looped, dragging the whole filter graph down).
        ...(effectiveBackgroundType === 'solid'
            ? ['-f', 'lavfi', '-i', `color=${backgroundColor}:s=${canvasW}x${canvasH}:d=1:r=30`]
            : effectiveBackgroundType === 'image' && backgroundImage
                ? ['-framerate', '30', '-loop', '1', '-i', normPath(backgroundImage)]
                : blur_background
                    ? ['-framerate', '30', '-loop', '1', '-i', normPath(blur_background)]
                    : ['-f', 'lavfi', '-i', `color=black:s=${canvasW}x${canvasH}:d=1:r=30`]),
        // Header overlay (always present — thumbnail or custom image)
        ...(headerOl?.src
            ? ['-framerate', '30', '-loop', '1', '-i', normPath(headerOl.src)]
            : ['-f', 'lavfi', '-i', 'color=black:s=2x2:d=1:r=30']),
        // Bottom bar PNG (SHORT) or title overlay PNG (LANDSCAPE)
        ...((resolvedIsShort && bottomBarOverlayPath) || (!resolvedIsShort && titleOverlayPath)
            ? ['-framerate', '30', '-loop', '1', '-i', normPath((resolvedIsShort ? bottomBarOverlayPath : titleOverlayPath))]
            : []),
        '-filter_complex', filterComplex + (audioSpeedFilter ? `; [0:a?]${audioSpeedFilter}[audio]` : ''),
        '-map', mapOutput,
        '-map', audioSpeedFilter ? '[audio]' : '0:a?',
        '-c:v', nvencCodec,
        // NOTE: encParams already computed above — re-use instead of calling twice
        ...encParams,
        '-c:a', audioCodec,
        '-b:a', audioBitrate,
        '-t', String(duration),
        '-max_muxing_queue_size', '1024',
        '-y', normPath(outputFile),
    ];
    let result = await (0, worker_pool_js_1.runFfmpeg)({
        jobId: `single:${workspace_id}`,
        args,
        outputFile,
        onProgress: (pct, elapsedMs = 0) => {
            const eta = elapsedMs > 0 && pct > 1
                ? Math.max(1, Math.round((elapsedMs / (pct / 100) - elapsedMs) / 1000))
                : undefined;
            onProgress?.({
                workspaceId: workspace_id,
                percent: pct,
                currentTime: (pct / 100) * duration,
                totalTime: duration,
                fps: 0,
                speed: '',
                bitrate: '',
                eta,
                elapsedMs,
            });
        },
    });
    if (!result.success && shouldRetryWithSoftwareDecode(result.error)) {
        (0, unified_log_js_1.devLog)(`[Render] Decode issue detected — retrying without hwaccel: ${result.error?.slice(0, 160)}`);
        const softwareArgs = stripHwAccelArgs(args);
        result = await (0, worker_pool_js_1.runFfmpeg)({
            jobId: `single-sw:${workspace_id}`,
            args: softwareArgs,
            outputFile,
            onProgress: (pct, elapsedMs = 0) => {
                const eta = elapsedMs > 0 && pct > 1
                    ? Math.max(1, Math.round((elapsedMs / (pct / 100) - elapsedMs) / 1000))
                    : undefined;
                onProgress?.({
                    workspaceId: workspace_id,
                    percent: pct,
                    currentTime: (pct / 100) * duration,
                    totalTime: duration,
                    fps: 0,
                    speed: '',
                    bitrate: '',
                    eta,
                    elapsedMs,
                });
            },
        });
    }
    if (result.success) {
        (0, unified_log_js_1.devLog)(`[TIMER] RENDER DONE: ${workspace_id} — ${result.outputFile} (${Math.round((result.fileSize ?? 0) / 1024 / 1024)} MB)`);
    }
    else {
        (0, unified_log_js_1.devLog)(`[TIMER] RENDER FAILED: ${workspace_id} — ${result.error}`);
    }
    return {
        success: result.success,
        workspaceId: workspace_id,
        outputPath: result.outputFile,
        fileSize: result.fileSize,
        duration,
        error: result.error,
    };
}
// ─── Chunked parallel encoding ─────────────────────────────────────────────────
const chunkedProcesses = new Map();
const mergeProcess = new Map();
function cancelChunked(workspaceId) {
    const chunks = chunkedProcesses.get(workspaceId);
    if (chunks) {
        for (const { proc } of chunks) {
            try {
                proc.once('close', () => { });
                proc.kill();
            }
            catch { }
        }
        chunkedProcesses.delete(workspaceId);
    }
    const merge = mergeProcess.get(workspaceId);
    if (merge) {
        try {
            merge.once('close', () => mergeProcess.delete(workspaceId));
            merge.kill();
            setTimeout(() => mergeProcess.delete(workspaceId), 500);
        }
        catch { }
    }
}
function cancelAllChunked() {
    for (const [id] of chunkedProcesses)
        cancelChunked(id);
    for (const [id] of mergeProcess) {
        const p = mergeProcess.get(id);
        try {
            p.once('close', () => mergeProcess.delete(id));
            p.kill();
            // Safety fallback: delete after 500ms even if close event missed.
            setTimeout(() => mergeProcess.delete(id), 500);
        }
        catch { }
    }
}
// Build chunk encode args
function buildChunkArgs(sourceVideo, blurBg, trimStart, trimDuration, outputFile, codec, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW, titleOverlayPath, isShort, videoSpeed, gpuTier = 'software', backgroundType, backgroundColor, backgroundImage, numThreads, audioCodec = 'aac', audioBitrate = '192k', headerOlSrc, titleOl, fpsTarget = 30, vidHeightPct, bottomBarH, bottomBarOverlayPath) {
    const isGpuAvailable = gpuTier !== 'software';
    const nvencCodec = isGpuAvailable
        ? (codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc')
        : (codec === 'hevc' ? 'libx265' : 'libx264');
    // Use hardware decode when available (CUVID/NVDEC).
    // Hardware decode is now safe because we use trim filter instead of input seeking.
    // Input seeking caused timestamp corruption with ALL decoders on FFmpeg gyan.dev 7.1 → 1fps playback.
    // Trim filter + setpts=PTS-STARTPTS produces correct timestamps regardless of decoder.
    // CPU-aware threads: use all cores but cap at 16 to avoid oversubscription
    const chunkThreads = numThreads ?? Math.min(os_1.default.cpus().length, 16);
    // GPU-accelerated filters when available and GPU tier is good.
    // Must check hasCudaFilters — essentials build lists CUDA filters but NVDEC unavailable → runtime fail.
    //
    // FIX 2026-06-02: Force CPU scale/overlay even when CUDA filters are available.
    // The mixed GPU/CPU filter chain was broken: scale_cuda outputs CUDA frames that
    // CPU filters (setpts, trim, crop, drawtext) cannot process, and overlay_cuda
    // requires both inputs in CUDA format (but our bg/header are PNG = CPU format).
    // Result: "Impossible to convert between the formats" → 0-byte output chunks.
    // Performance: NVENC is the bottleneck on RTX 5080, so CPU scale/crop only adds
    // a small fraction. Chunks run in parallel so wall-clock time stays the same.
    const hasGpuFilters = false;
    const scale = 'scale';
    const sf = ':flags=lanczos';
    const overlay = 'overlay';
    // [LEGACY — kept for reference, do NOT re-enable until full format-conversion
    //  handling is added between every CUDA/CPU filter boundary]
    // const hasGpuFilters = isGpuAvailable && getHwCaps().hasCudaFilters
    // const scale = hasGpuFilters ? 'scale_cuda' : 'scale'
    // const sf = hasGpuFilters ? '' : ':flags=lanczos'
    // const overlay = hasGpuFilters ? 'overlay_cuda' : 'overlay'
    // Pre-scaled source detection: when the source filename contains '_preScaled',
    // it was already downscaled to the export resolution by preScaleVideo().
    // This lets us skip or simplify the GPU scale filter, saving ~5-10s per render.
    const isPreScaled = /_preScaled[.\w]*$/.test(sourceVideo);
    const speedFilter = videoSpeed && videoSpeed !== 1.0
        ? 'setpts=' + (1 / videoSpeed) + '*PTS'
        : '';
    // Audio speed filter: atempo can handle 0.5-2.0 range. For speed > 2.0, chain multiple.
    const audioSpeedFilter = (() => {
        if (!videoSpeed || videoSpeed === 1.0)
            return null;
        const s = videoSpeed;
        if (s >= 0.5 && s <= 2.0)
            return `atempo=${s}`;
        if (s > 2.0) {
            const factors = [];
            let remaining = s;
            while (remaining > 2.0) {
                factors.push('2.0');
                remaining /= 2.0;
            }
            if (remaining !== 1.0)
                factors.push(remaining.toFixed(2));
            return 'atempo=' + factors.join(',atempo=');
        }
        return null;
    })();
    // Build background input based on type: blur (blurBg image), solid (lavfi color), image (image file)
    // FIX 2026-06-02: All image inputs use `-framerate 30` to prevent 25fps regression
    // (PNG defaults to 25fps when looped, dragging the whole filter graph down to 25fps).
    // Lavfi color sources get `r=30` to match.
    let bgInput;
    if (backgroundType === 'solid') {
        bgInput = ['-f', 'lavfi', '-i', `color=${backgroundColor || '#000000'}:s=${canvasW}x${canvasH}:d=1:r=30`];
    }
    else if (backgroundType === 'image' && backgroundImage) {
        bgInput = ['-framerate', '30', '-loop', '1', '-i', quotePath(backgroundImage)];
    }
    else if (blurBg) {
        // Default: blur background image
        bgInput = ['-framerate', '30', '-loop', '1', '-i', quotePath(blurBg)];
    }
    else {
        // Fallback: solid black
        bgInput = ['-f', 'lavfi', '-i', 'color=black:s=' + canvasW + 'x' + canvasH + ':d=1:r=30'];
    }
    // Frame rate: fps=30 (no select filter — causes 2x halving when combined with fps=N)
    if (!isShort) {
        // Landscape: scale source to videoH, crop/pad to fit canvasW.
        // cropXNum = (videoH * 16/9 - canvasW) / 2
        //   >= 0: source wide enough → scale to canvasH, center-crop width
        //   <  0: source narrower → scale by width, center-crop height
        //
        // Pre-scaled optimization: when source is pre-scaled to export resolution, the scale
        // filter is redundant (or even counterproductive — scaling 480→960→crop 480 is wasteful).
        // When pre-scaled and cropXNum < 0 (source narrower than canvas): source is already at
        // canvas width, just format+fps+crop.
        const cropXNum = Math.round((videoH * 16 / 9 - canvasW) / 2);
        // Speed-adjusted trim duration: when speed > 1, input timestamps are compressed,
        // so the same raw duration produces fewer output seconds.
        const speedAdjust = speedFilter
            ? (() => {
                const m = speedFilter.match(/setpts=([\d.]+)\/([\d.]+)\*PTS/);
                return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1;
            })()
            : 1;
        const adjustedChunkDuration = trimDuration > 0 ? trimDuration * speedAdjust : 999999;
        // Correct order: fps → setpts(speed) → trim → setpts(reset) → scale → crop
        // Speed BEFORE trim: compresses timestamps so trim duration refers to output seconds.
        const speedTag = speedFilter ? speedFilter.replace(',', '') + ',' : '';
        const trimPre = (trimStart > 0 || trimDuration > 0)
            ? "[0:v]fps=" + fpsTarget + "," + speedTag + "trim=start=" + trimStart + ":duration=" + adjustedChunkDuration + ",setpts=PTS-STARTPTS,"
            : "fps=" + fpsTarget + "," + speedTag + "setpts=PTS-STARTPTS,";
        let videoSection;
        if (cropXNum >= 0) {
            // Scale source to videoH tall (preserves aspect), crop horizontally to canvasW.
            // Shift crop by videoTop so video content starts at row videoTop (below header zone).
            const cropYChunked = videoTop;
            videoSection = '[0:v]' + trimPre + scale + '=-2:' + videoH + sf + ',crop=' + canvasW + ':' + videoH + ':' + cropXNum + ':' + cropYChunked + '[vid]';
        }
        else {
            // Source narrower than canvas: scale by width, crop excess height.
            // When pre-scaled: source is already at canvasW wide — skip scale, just format+crop.
            const cropY = Math.round((canvasW * 9 / 16 - videoH) / 2) + videoTop;
            if (isPreScaled) {
                videoSection = '[0:v]' + trimPre + 'format=yuv420p,crop=' + canvasW + ':' + videoH + ':0:' + cropY + '[vid]';
            }
            else {
                videoSection = '[0:v]' + trimPre + scale + '=' + canvasW + ':-2' + sf + ',crop=' + canvasW + ':' + videoH + ':0:' + cropY + '[vid]';
            }
        }
        // Header overlay section: scale header image to canvas width × headerH, overlay on [vz] → [fh].
        // Z-order: bg (bottom) → video (middle) → header (top). Thumbnail shows in header zone.
        const hdChain2 = headerOlSrc
            ? '[2:v]' + scale + '=' + canvasW + ':' + headerH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + headerH + ':(ow-iw)/2:(oh-ih)/2[hd];[vz][hd]' + overlay + '=0:0[fh]'
            : '';
        const hasHeader = !!headerOlSrc;
        const sections = [
            videoSection,
            '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + canvasH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[bg]',
            '[bg][vid]' + overlay + '=0:' + videoTop + '[vz]',
        ];
        // Title: PNG overlay or drawtext. Handle header overlay placement correctly.
        if (titleOl?.content && titleOverlayPath) {
            // PNG title overlay: add header overlay if exists, then title PNG overlay
            // FIX 2026-06-02: scale + crop + format=yuv420p — PNG from cache is rgb24,
            // must convert to yuv420p before hevc_nvenc encodes it.
            if (hdChain2)
                sections.push(hdChain2);
            const titleInputIdx = hasHeader ? '3' : '2';
            sections.push('[' + titleInputIdx + ':v]' + scale + '=' + canvasW + ':' + titleH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + titleH + ':(ow-iw)/2:(oh-ih)/2,format=yuv420p[titleScaled]');
            sections.push('[fh][titleScaled]' + overlay + '=0:' + (canvasH - titleH) + '[final]');
        }
        else if (titleOl?.content) {
            // Drawtext fallback: z-order depends on whether header exists.
            // NO header: drawtext on [vz], overlay on [bg] → [td]
            // WITH header: header on bottom, text on top. Use [tdo] intermediate to avoid [fh]→dst conflict.
            if (hasHeader) {
                // Replace the pushed hdChain2 with correct z-order:
                // bg overlay on [vid] → [vz2]; header on [vz2] → [fh]; drawtext on [fh] → [tdo]; overlay [fh][tdo] → [td]
                // Header on BOTTOM ([fh]), text on TOP ([tdo]).
                sections.pop(); // remove the old hdChain2
                sections.push('[bg][vid]' + overlay + '=0:' + videoTop + '[vz2];' +
                    '[2:v]' + scale + '=' + canvasW + ':' + headerH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + headerH + ':(ow-iw)/2:(oh-ih)/2[hd];' +
                    '[vz2][hd]' + overlay + '=0:0[fh];' +
                    '[fh]drawtext=text=\'' + titleOl.content.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\") + '\':fontsize=' + Math.max(24, Math.floor(titleH * 0.15)) + ':fontcolor=white:x=(w-text_w)/2:y=' + Math.floor(headerH / 2) + '-text_h/2:fontfile=' + ffmpeg_shared_js_2.FONT_FILE + '[tdo];' +
                    '[fh][tdo]' + overlay + '=0:0[td]');
            }
            else {
                // No header: drawtext on [vz], overlay on [bg]
                sections.push('[vz]drawtext=text=\'' + titleOl.content.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\") + '\':fontsize=' + Math.max(24, Math.floor(titleH * 0.15)) + ':fontcolor=white:x=(w-text_w)/2:y=' + Math.floor(headerH / 2) + '-text_h/2:fontfile=' + ffmpeg_shared_js_2.FONT_FILE + '[td]');
            }
        }
        else if (hdChain2) {
            // No title — just add header overlay
            sections.push(hdChain2);
        }
        const filterChain = sections.join('; ');
        const mapOutput = titleOverlayPath ? '[final]' : (titleOl?.content ? '[td]' : (hasHeader ? '[fh]' : '[vz]'));
        // Background input index: [0]=video, [1]=bg, [2]=header image, [3]=title overlay PNG
        // For landscape, background is scaled to full canvas — FILL (not fit within)
        let bgScaleFilter = '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + canvasH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[bg]';
        if (backgroundType === 'solid') {
            // Solid bg: bgInput IS the full-canvas color, no extra scale needed
            bgScaleFilter = '[1:v]null[bg]';
        }
        else if (backgroundType === 'image' && backgroundImage) {
            // Image bg: scale to full canvas — FILL
            bgScaleFilter = '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + canvasH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[bg]';
        }
        // Replace sections[1] with bgScaleFilter
        const fixedSections = [sections[0], bgScaleFilter, ...sections.slice(2)];
        const fixedFilterChain = fixedSections.join('; ');
        return [
            ...getHwAccelFlags(codec),
            '-threads', String(chunkThreads),
            '-filter_threads', String(Math.min(chunkThreads, 8)),
            '-avoid_negative_ts', 'make_zero',
            '-i', quotePath(sourceVideo),
            ...bgInput,
            ...(headerOlSrc
                ? ['-framerate', '30', '-loop', '1', '-i', quotePath(headerOlSrc)]
                : ['-f', 'lavfi', '-i', 'color=black:s=2x2:d=1:r=30']),
            ...(titleOverlayPath
                ? ['-framerate', '30', '-loop', '1', '-i', quotePath(titleOverlayPath)]
                : []),
            '-filter_complex', fixedFilterChain + (audioSpeedFilter ? `; [0:a?]${audioSpeedFilter}[audio]` : ''),
            '-map', mapOutput, '-map', audioSpeedFilter ? '[audio]' : '0:a?',
            '-c:v', nvencCodec,
            ...getNvencParams(codec, true, gpuTier, canvasW, canvasH),
            '-max_muxing_queue_size', '512',
            '-c:a', audioCodec, '-b:a', audioBitrate,
            '-t', String(videoSpeed && videoSpeed !== 1 ? trimDuration / videoSpeed : trimDuration),
            '-y', quotePath(outputFile),
        ];
    }
    // Build section array for SHORT mode with correct ordering:
    // Layout: header (top) → video (middle, bottom touches bar) → bottom bar (bottom)
    // Frame rate: fps=N (no select filter — causes 2x halving when combined with fps=N)
    //
    // Speed-adjusted trim duration: when speed > 1, input timestamps are compressed,
    // so the same raw duration produces fewer output seconds.
    const speedAdjust = speedFilter
        ? (() => {
            const m = speedFilter.match(/setpts=([\d.]+)\/([\d.]+)\*PTS/);
            return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1;
        })()
        : 1;
    const adjustedChunkDuration = trimDuration > 0 ? trimDuration * speedAdjust : 999999;
    // Correct order: fps → setpts(speed) → trim → setpts(reset) → scale → crop
    // Speed BEFORE trim: compresses timestamps so trim duration refers to output seconds.
    const speedTag = speedFilter ? speedFilter.replace(',', '') + ',' : '';
    const trimPre = (trimStart > 0 || trimDuration > 0)
        ? '[0:v]fps=' + fpsTarget + ',' + speedTag + 'trim=start=' + trimStart + ':duration=' + adjustedChunkDuration + ',setpts=PTS-STARTPTS,'
        : '[0:v]fps=' + fpsTarget + ',' + speedTag + 'setpts=PTS-STARTPTS,';
    const sections = [];
    const hasHeader = !!headerOlSrc;
    // SHORT mode: bottom bar comes from bottomBarOverlayPath (pre-rendered PNG with text).
    // titleOverlayPath is for LANDSCAPE mode title overlays — do NOT use here.
    const hasBottomBar = !!bottomBarOverlayPath || !!titleOl?.content;
    const bbH = bottomBarH ?? 64;
    let finalLabel = '[vz]';
    // Section 1: video — trim → fps → scale → crop to videoH tall
    // videoH = canvasH - headerH - bbH (bottomBarH gap left at bottom)
    if (isPreScaled) {
        const sc = trimPre + 'format=yuv420p,crop=in_w:' + videoH + ':0:(in_h/2-' + videoH + '/2)[vid]';
        sections.push(sc);
    }
    else {
        // scale=-2:videoH → source 1920x1080 → 1920x1472; crop center canvasW columns
        // sf (`:flags=lanczos` for CPU, `''` for CUDA) is selected by `hasGpuFilters` above.
        sections.push(trimPre + scale + '=-2:' + videoH + sf + ',crop=' + canvasW + ':' + videoH + ':(iw-' + canvasW + ')/2:0[vid]');
    }
    // Section 2: background — FILL canvas.
    const bgFilter = backgroundType === 'solid'
        ? '[1:v]null[bg]'
        : '[1:v]' + scale + '=' + canvasW + ':' + canvasH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + canvasH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[bg]';
    sections.push(bgFilter);
    // Section 3: video over bg at y=headerH → [vz].
    // BG shows through header zone and bottom bar gap.
    sections.push('[bg][vid]' + overlay + '=0:' + headerH + '[vz]');
    // CORRECT z-order: bg → video → bottom bar → header (header on top)
    // Layer chain:
    //   [vz][bb]overlay=bottomBarY → [vb] (bottom bar on top of video)
    //   [vb][hd]overlay=0:0 → [final] (header on top of bottom bar)
    const bottomBarY = headerH + videoH; // = canvasH - bottomBarH
    if (hasBottomBar) {
        // Bottom bar on video FIRST (below header in z-order).
        // Pre-rendered bottom bar PNG (bottomBarOverlayPath) is used when available —
        // it already contains the title text drawn by PowerShell (crisp, anti-aliased).
        // Skip drawtext to avoid duplicating text on top of the pre-rendered bar.
        if (bottomBarOverlayPath) {
            // FIX 2026-06-02: PNG comes from lavfi as rgb24 (no native yuv). hevc_nvenc
            // rejects rgb24 (-22 Invalid argument). Force yuv420p before overlay so
            // both [vz] (yuv420p from source) and [bb] share the same pixel format.
            sections.push('[3:v]format=yuv420p[bb]');
            sections.push('[vz][bb]' + overlay + '=0:' + bottomBarY + '[vb]');
        }
        else if (titleOl?.content) {
            // Drawtext fallback: only when NO pre-rendered bottom bar.
            // Text is drawn at center of bottom bar zone.
            const fontSize = Math.max(24, Math.floor(bbH * 0.45));
            const textCenterY = bottomBarY + Math.floor(bbH / 2);
            const escapedText = (titleOl.content || '').replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
            const borderColor = toFfmpegColor(titleOl.borderColor ?? '#00B4FF');
            sections.push('[vz]drawtext=text=\'' + escapedText + '\':fontsize=' + fontSize + ':fontcolor=white:x=(w-text_w)/2:y=' + textCenterY + '-text_h/2:fontfile=' + ffmpeg_shared_js_2.FONT_FILE + '[vb]');
        }
        // Header on TOP of bottom bar
        if (hasHeader) {
            sections.push('[2:v]' + scale + '=' + canvasW + ':' + headerH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + headerH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[hd]');
            sections.push('[vb][hd]' + overlay + '=0:0[final]');
        }
        else {
            sections.push('[vb]null[final]');
        }
        finalLabel = '[final]';
    }
    else if (hasHeader) {
        // No bottom bar — header directly on video
        sections.push('[2:v]' + scale + '=' + canvasW + ':' + headerH + ':force_original_aspect_ratio=increase,crop=' + canvasW + ':' + headerH + ':(ow-iw)/2:(oh-ih)/2,setsar=1[hd]');
        sections.push('[vz][hd]' + overlay + '=0:0[final]');
        finalLabel = '[final]';
    }
    const filterChain = sections.join('; ');
    // Input mapping: [0]=video, [1]=bg, [2]=header (if SHORT), [3]=bottomBarPNG (if SHORT+bottomBar)
    // For SHORT mode: input [2] = header, input [3] = bottom bar (if exists)
    // For SHORT without header: input [2] = placeholder (not used)
    return [
        ...getHwAccelFlags(codec),
        '-threads', String(chunkThreads),
        '-filter_threads', String(Math.min(chunkThreads, 8)),
        '-avoid_negative_ts', 'make_zero',
        '-i', quotePath(sourceVideo),
        ...bgInput,
        ...(isShort
            ? (headerOlSrc
                ? ['-framerate', '30', '-loop', '1', '-i', quotePath(headerOlSrc)]
                : ['-f', 'lavfi', '-i', 'color=black:s=2x2:d=1:r=30'])
            : []),
        ...(isShort && hasBottomBar && bottomBarOverlayPath
            ? ['-framerate', '30', '-loop', '1', '-i', quotePath(bottomBarOverlayPath)]
            : []),
        '-filter_complex', filterChain + (audioSpeedFilter ? `; [0:a?]${audioSpeedFilter}[audio]` : ''),
        '-map', finalLabel, '-map', audioSpeedFilter ? '[audio]' : '0:a?',
        '-c:v', nvencCodec,
        ...getNvencParams(codec, true, gpuTier),
        '-max_muxing_queue_size', '512',
        '-c:a', audioCodec, '-b:a', audioBitrate,
        '-t', String(videoSpeed && videoSpeed !== 1 ? trimDuration / videoSpeed : trimDuration),
        '-y', quotePath(outputFile),
    ];
}
// Encode a single chunk
async function encodeChunk(workspaceId, sourceVideo, blurBg, startSec, durationSec, outputFile, codec, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW, titleOverlayPath, onProgress, isShort, videoSpeed, gpuTier, backgroundType, backgroundColor, backgroundImage, audioCodec, audioBitrate, headerOlSrc, titleOl, fpsTarget, vidHeightPct, bottomBarH, bottomBarOverlayPath) {
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    const numThreads = Math.min(os_1.default.cpus().length, 16);
    const norm = (p) => p.replace(/\\/g, '/');
    const normSource = norm(sourceVideo);
    const normBlur = norm(blurBg);
    const normHeader = headerOlSrc ? norm(headerOlSrc) : undefined;
    const normBg = backgroundImage ? norm(backgroundImage) : undefined;
    const normOutput = norm(outputFile);
    const normTitle = titleOverlayPath ? norm(titleOverlayPath) : undefined;
    const normBottomBar = bottomBarOverlayPath ? norm(bottomBarOverlayPath) : undefined;
    const baseArgs = buildChunkArgs(normSource, normBlur, startSec, durationSec, normOutput, codec, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW, normTitle, isShort, videoSpeed, gpuTier, backgroundType, backgroundColor, normBg, numThreads, audioCodec ?? 'aac', audioBitrate ?? '192k', normHeader, titleOl, fpsTarget ?? 30, vidHeightPct, bottomBarH, normBottomBar);
    const attemptEncode = (args) => {
        return new Promise((resolve) => {
            const t0 = Date.now();
            const proc = (0, child_process_1.spawn)(ffmpeg, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
            if (proc.stderr && proc.stderr.readableHighWaterMark !== undefined) {
                try {
                    proc.stderr.readableHighWaterMark = 1024 * 1024;
                }
                catch { }
            }
            if (!chunkedProcesses.has(workspaceId))
                chunkedProcesses.set(workspaceId, []);
            chunkedProcesses.get(workspaceId).push({ proc, outputFile });
            let lastPct = 0;
            let decodeFps = 0;
            let encodeFps = 0;
            const LINE_BUF_SIZE = 100;
            const lineBuf = [];
            proc.stderr?.on('data', (data) => {
                const chunk = data.toString();
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        lineBuf.push(line);
                        if (lineBuf.length > LINE_BUF_SIZE)
                            lineBuf.shift();
                    }
                }
                const recent = lineBuf.slice(-20).join('\n');
                const fpsM = recent.match(/fps=\s*([\d.]+)/);
                const speedM = recent.match(/speed=\s*([\d.]+)x/);
                if (fpsM) {
                    const v = parseFloat(fpsM[1]);
                    if (speedM) {
                        const spd = parseFloat(speedM[1]);
                        if (spd < 0.5)
                            decodeFps = v;
                        else
                            encodeFps = v;
                    }
                }
                const m = recent.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
                if (m && onProgress) {
                    const h = parseInt(m[1]), min = parseInt(m[2]), s = parseFloat(m[3]);
                    const cur = h * 3600 + min * 60 + s;
                    const pct = Math.min(99, (cur / durationSec) * 100);
                    if (Math.abs(pct - lastPct) >= 1) {
                        lastPct = pct;
                        onProgress(pct);
                    }
                }
            });
            proc.on('close', () => {
                const chunks = chunkedProcesses.get(workspaceId);
                if (chunks) {
                    const idx = chunks.findIndex(c => c.outputFile === outputFile);
                    if (idx !== -1)
                        chunks.splice(idx, 1);
                    if (chunks.length === 0)
                        chunkedProcesses.delete(workspaceId);
                }
                const ms = Date.now() - t0;
                if (!fs_1.default.existsSync(outputFile)) {
                    const errTail = lineBuf.slice(-5).join(' | ').slice(0, 200);
                    resolve({ success: false, fileSize: 0, encodeMs: ms, error: `FFmpeg ended without output: ${errTail || 'unknown'}` });
                    return;
                }
                let size = 0;
                try {
                    size = fs_1.default.statSync(outputFile).size;
                }
                catch { }
                if (size < 1024) {
                    const errTail = lineBuf.slice(-5).join(' | ').slice(0, 200);
                    try {
                        fs_1.default.unlinkSync(outputFile);
                    }
                    catch { }
                    resolve({ success: false, fileSize: 0, encodeMs: ms, error: `Chunk output too small (${size} bytes) — likely filter chain error: ${errTail || 'no stderr'}` });
                    return;
                }
                resolve({ success: true, fileSize: size, encodeMs: ms, decodeFps, encodeFps });
            });
            setTimeout(() => {
                if (!proc.killed)
                    proc.kill();
                resolve({ success: false, fileSize: 0, encodeMs: Date.now() - t0, error: 'Timeout' });
            }, 2 * 60 * 60 * 1000);
        });
    };
    let result = await attemptEncode(baseArgs);
    if (!result.success && shouldRetryWithSoftwareDecode(result.error)) {
        (0, unified_log_js_1.devLog)(`[Chunk] Decode issue detected — retrying without hwaccel: ${result.error?.slice(0, 160)}`);
        const softwareArgs = stripHwAccelArgs(baseArgs);
        result = await attemptEncode(softwareArgs);
    }
    return result;
}
// Merge chunks using ffmpeg concat demuxer
async function mergeChunks(workspaceId, chunkFiles, outputFile, totalDuration, onProgress) {
    if (chunkFiles.length === 1) {
        fs_1.default.copyFileSync(chunkFiles[0], outputFile);
        let size = 0;
        try {
            size = fs_1.default.statSync(outputFile).size;
        }
        catch { }
        return { success: true, fileSize: size };
    }
    // Use concat FILTER (re-encodes, ~200ms) instead of concat DEMUXER (-c copy).
    // Chunks encoded with `-avoid_negative_ts make_zero` all start at PTS=0, which
    // breaks concat demuxer ("Non-monotonous DTS in output stream"). The concat
    // filter uses an explicit concat node that handles overlapping zero PTS fine.
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    const normOut = outputFile.replace(/\\/g, '/');
    const inputs = chunkFiles.map(f => ['-i', f.replace(/\\/g, '/')]).flat();
    const filterParts = [];
    for (let i = 0; i < chunkFiles.length; i++)
        filterParts.push(`[${i}:v][${i}:a]`);
    filterParts.push(`concat=n=${chunkFiles.length}:v=1:a=1[v][a]`);
    const args = [
        ...inputs,
        '-filter_complex', filterParts.join(''),
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        '-y', normOut,
    ];
    return new Promise((resolve) => {
        // shell:false — bypass cmd.exe overhead for fast concat operation.
        const proc = (0, child_process_1.spawn)(ffmpeg, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        mergeProcess.set(workspaceId, proc);
        // Ring buffer for stderr (same approach as runFfmpeg)
        const LINE_BUF_SIZE = 100;
        const lineBuf = [];
        let lastPct = 0;
        proc.stderr?.on('data', (data) => {
            const chunk = data.toString();
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    lineBuf.push(line);
                    if (lineBuf.length > LINE_BUF_SIZE)
                        lineBuf.shift();
                }
            }
            // Only scan recent lines for progress (avoids stale banner matches)
            const recent = lineBuf.slice(-20).join('\n');
            const m = recent.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
            if (m && onProgress) {
                const h = parseInt(m[1]), min = parseInt(m[2]), s = parseFloat(m[3]);
                const cur = h * 3600 + min * 60 + s;
                const pct = Math.min(100, (cur / totalDuration) * 100);
                if (Math.abs(pct - lastPct) >= 1) {
                    lastPct = pct;
                    onProgress(pct);
                }
            }
        });
        proc.on('close', (code) => {
            mergeProcess.delete(workspaceId);
            if (code !== 0 || !fs_1.default.existsSync(outputFile)) {
                const recent = lineBuf.slice(-10).join(' | ');
                resolve({ success: false, fileSize: 0, error: recent || `Concat ${code}` });
            }
            else {
                let size = 0;
                try {
                    size = fs_1.default.statSync(outputFile).size;
                }
                catch { }
                resolve({ success: true, fileSize: size });
            }
        });
        // Timeout: 1s per minute of content + 30s overhead (min 60s)
        const timeout = Math.max(60_000, Math.ceil(totalDuration * 1000) + 30_000);
        setTimeout(() => {
            if (!proc.killed)
                proc.kill();
            mergeProcess.delete(workspaceId);
            resolve({ success: false, fileSize: 0, error: 'Concat timeout' });
        }, timeout);
    });
}
// ─── Chunked render ────────────────────────────────────────────────────────────
// Parallel encoding: splits video into chunks, encodes all chunks simultaneously,
// then merges. All background types (blur, solid, image) are supported.
async function renderChunked(metadata, outputDir, config = {}, onProgress) {
    const { workspace_id, source_video, blur_background, trim, export_resolution, codec = 'h264', isShort = true, overlays, video_speed, audioCodec = 'aac', audioBitrate = '192k', fps_target = 30, } = metadata;
    const vidHeightPct = metadata.vidHeightPct ?? 50;
    // Use VRAM-aware effective workers if not explicitly specified
    const effectiveWorkers = (0, system_js_1.getEffectiveWorkers)();
    const gpuTier = config.gpuTier ?? 'software';
    const workers = config.workers ?? effectiveWorkers;
    // RTX 5080/4090: shorter chunks (90s) = more parallelism, faster total encode
    // Mid-tier: standard 120s chunks
    const chunkDuration = config.chunkDuration ?? (gpuTier === 'high' ? 90 : 120);
    const minChunkDuration = config.minChunkDuration ?? 10;
    const [outW, outH] = metadata.export_resolution.split('x').map(Number);
    const canvasW = outW || 1080;
    const canvasH = outH || 1920;
    // Override isShort from CANVAS dimensions, not from source video aspect ratio.
    const resolvedIsShort2 = canvasH >= canvasW;
    // SHORT: header=25%, video=50%, bottomBarH=25% (BOTTOM_PCT)
    const bottomBarH = metadata.bottomBarH ?? Math.floor(canvasH * ffmpeg_shared_js_2.BOTTOM_PCT);
    const headerH = resolvedIsShort2
        ? Math.floor(canvasH * ffmpeg_shared_js_2.HEADER_PCT)
        : Math.floor((canvasH - Math.floor(canvasH * vidHeightPct / 100)) / 2);
    const titleH = resolvedIsShort2 ? 0 : Math.floor(canvasH * (100 - vidHeightPct) / 100);
    const videoH = resolvedIsShort2
        ? canvasH - headerH - bottomBarH
        : Math.floor(canvasH * vidHeightPct / 100);
    const videoTop = resolvedIsShort2 ? headerH : Math.floor((canvasH - videoH) / 2);
    const videoW = Math.floor(videoH * 16 / 9);
    const trimStart = trim.start;
    const trimEnd = trim.end;
    const rawTrimDuration = trimEnd - trimStart;
    // Speed-adjusted output duration: trim duration divided by speed multiplier.
    const totalDuration = video_speed !== 1.0 ? rawTrimDuration / video_speed : rawTrimDuration;
    // Short duration → single-pass (no chunking overhead needed)
    if (totalDuration <= 30) {
        const simple = await renderVideo(metadata, outputDir, onProgress, gpuTier);
        return { ...simple, chunks: [], totalEncodeMs: 0 };
    }
    const ffmpeg = (0, ffmpeg_paths_js_1.getFfmpegPath)();
    const workspaceDir = path_1.default.join(outputDir, 'chunks', workspace_id);
    if (!fs_1.default.existsSync(workspaceDir))
        fs_1.default.mkdirSync(workspaceDir, { recursive: true });
    onProgress?.({ workspaceId: workspace_id, percent: 0, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'split' });
    let splitPoints = [trimStart];
    // Chunk splitting is based on RAW duration (input video), not speed-adjusted output duration.
    // Each chunk's raw duration × speed = output duration.
    const targetChunks = Math.ceil(rawTrimDuration / chunkDuration);
    // Smart keyframe detection: only for longer videos
    const keyframes = rawTrimDuration > 120
        ? await findKeyframeSmart(source_video, rawTrimDuration, targetChunks)
        : [];
    if (keyframes.length > 2) {
        const idealInterval = rawTrimDuration / targetChunks;
        let nextSplit = trimStart + idealInterval;
        for (const kf of keyframes) {
            if (kf >= nextSplit - 0.5 && kf <= nextSplit + 2) {
                if (kf - splitPoints[splitPoints.length - 1] >= minChunkDuration) {
                    splitPoints.push(kf);
                    nextSplit += idealInterval;
                }
            }
        }
    }
    else {
        for (let i = 1; i < targetChunks; i++) {
            splitPoints.push(trimStart + i * (rawTrimDuration / targetChunks));
        }
    }
    splitPoints.push(trimEnd);
    const finalSplits = [splitPoints[0]];
    for (let i = 1; i < splitPoints.length; i++) {
        if (splitPoints[i] - finalSplits[finalSplits.length - 1] >= minChunkDuration) {
            finalSplits.push(Math.min(splitPoints[i], trimEnd));
        }
    }
    if (finalSplits[finalSplits.length - 1] !== trimEnd) {
        finalSplits.push(trimEnd);
    }
    const chunks = [];
    const numChunks = finalSplits.length - 1;
    onProgress?.({ workspaceId: workspace_id, percent: 5, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'encode', chunkIndex: 0 });
    // Pre-render overlays via cache (FIX 2026-06-02).
    // PNGs are pre-rendered at settings-save time and cached by content hash —
    // here we just look up the cached path. Single color bottom bar.
    const headerOl = overlays?.find(o => o.type === 'header' && o.src);
    const titleOl = overlays?.find(o => o.type === 'title' && o.content);
    const barTextForCache = titleOl?.content || 'PART 1';
    const colorForCache = (metadata.bottomBarColor || titleOl?.borderColor || '#00B4FF').replace(/^#/, '');
    let bottomBarOverlayPath;
    let titleOverlayPath;
    if (resolvedIsShort2) {
        bottomBarOverlayPath = await (0, overlay_cache_js_1.getBottomBarPng)({
            canvasW, canvasH,
            bottomBarH: bottomBarH,
            barText: barTextForCache,
            colorHex: colorForCache,
        }) || undefined;
    }
    else {
        titleOverlayPath = await (0, overlay_cache_js_1.getTitleOverlayPng)({
            canvasW,
            titleBarH: titleH,
            titleText: barTextForCache,
            colorHex: colorForCache,
        }) || undefined;
    }
    // Pre-scale background image/JPG to canvas resolution once (shared across all chunks).
    // For blur background, this saves ~200-500ms/chunk × 14 chunks = 3-7s on a 30-min render.
    // For solid color (lavfi), this is a no-op. For image bg, same as blur benefit.
    let preScaledBg;
    const bgType = metadata.backgroundType ?? 'blur';
    const bgSource = bgType === 'image' ? metadata.backgroundImage : (bgType === 'blur' ? blur_background : undefined);
    if (bgSource && fs_1.default.existsSync(bgSource)) {
        preScaledBg = path_1.default.join(workspaceDir, 'bg_pre_scaled.png').replace(/\\/g, '/');
        const normBg = bgSource.replace(/\\/g, '/');
        const bgScaleArgs = [
            '-i', normBg,
            '-vf', `scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
            '-frames:v', '1',
            '-y', preScaledBg,
        ];
        await new Promise((resolve) => {
            const proc = (0, child_process_1.spawn)(ffmpeg, bgScaleArgs, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
            let se = '';
            proc.stderr?.on('data', (d) => { se += d.toString(); });
            proc.on('close', (code) => {
                if (code !== 0 || !fs_1.default.existsSync(preScaledBg)) {
                    (0, unified_log_js_1.devLog)(`[ChunkedRender] bg pre-scale failed: ${se.slice(0, 100)}`);
                    preScaledBg = undefined;
                }
                else {
                    (0, unified_log_js_1.devLog)(`[ChunkedRender] bg pre-scaled to ${preScaledBg}`);
                }
                resolve();
            });
            proc.on('error', () => { preScaledBg = undefined; resolve(); });
        });
    }
    for (let batchStart = 0; batchStart < numChunks; batchStart += workers) {
        const batchEnd = Math.min(batchStart + workers, numChunks);
        const batch = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);
        const batchResults = await Promise.all(batch.map(async (idx) => {
            const startSec = finalSplits[idx];
            const endSec = finalSplits[idx + 1];
            const durationSec = endSec - startSec;
            const chunkFile = path_1.default.join(workspaceDir, `chunk_${String(idx).padStart(3, '0')}.mp4`);
            const result = await encodeChunk(workspace_id, source_video, preScaledBg || blur_background || '', startSec, durationSec, chunkFile, codec, canvasW, canvasH, headerH, titleH, videoH, videoTop, videoW, bottomBarOverlayPath ?? undefined, (pct) => {
                const chunkOverall = ((idx + pct / 100) / numChunks) * 90 + 5;
                onProgress?.({ workspaceId: workspace_id, percent: chunkOverall, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'encode', chunkIndex: idx });
            }, resolvedIsShort2, video_speed, gpuTier, metadata.backgroundType, metadata.backgroundColor, preScaledBg ? undefined : metadata.backgroundImage, // Use pre-scaled as source; if absent, fall back
            audioCodec, audioBitrate, headerOl?.src, titleOl, fps_target, vidHeightPct, bottomBarH, bottomBarOverlayPath);
            return { idx, startSec, endSec, chunkFile, result };
        }));
        for (const { idx, startSec, endSec, chunkFile, result } of batchResults) {
            if (result.success) {
                chunks.push({ index: idx, start: startSec, end: endSec, outputPath: chunkFile, fileSize: result.fileSize, encodeMs: result.encodeMs, decodeFps: result.decodeFps, encodeFps: result.encodeFps });
                // Speed: input duration / encode wall-clock (higher = faster)
                const chunkDur = endSec - startSec;
                const encodeSpeed = result.encodeMs > 0 ? (chunkDur * 1000 / result.encodeMs).toFixed(2) : 'N/A';
                (0, unified_log_js_1.devLog)(`[Profile] chunk ${idx}: ${result.encodeMs}ms, decode~${result.decodeFps} fps, encode~${result.encodeFps} fps, speed=${encodeSpeed}x realtime`);
            }
            else {
                console.warn(`[Chunk] Chunk ${idx} failed (${result.error}), falling back to standard render`);
                const fallback = await renderVideo(metadata, outputDir, onProgress);
                return { ...fallback, chunks: [], totalEncodeMs: 0 };
            }
        }
    }
    onProgress?.({ workspaceId: workspace_id, percent: 95, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'merge' });
    const outputFile = path_1.default.join(outputDir, `${workspace_id}_chunked_output.mp4`);
    chunks.sort((a, b) => a.index - b.index);
    const mergeResult = await mergeChunks(workspace_id, chunks.map(c => c.outputPath), outputFile, totalDuration, (pct) => onProgress?.({ workspaceId: workspace_id, percent: 95 + pct * 0.05, currentTime: 0, totalTime: 0, fps: 0, speed: '', bitrate: '', phase: 'merge' }));
    const totalEncodeMs = chunks.reduce((s, c) => s + c.encodeMs, 0);
    // Build profile summary from all chunks
    const decodeFpsVals = chunks.map(c => c.decodeFps).filter((v) => v !== undefined && v > 0);
    const encodeFpsVals = chunks.map(c => c.encodeFps).filter((v) => v !== undefined && v > 0);
    const avgDecodeFps = decodeFpsVals.length ? decodeFpsVals.reduce((a, b) => a + b, 0) / decodeFpsVals.length : 0;
    const avgEncodeFps = encodeFpsVals.length ? encodeFpsVals.reduce((a, b) => a + b, 0) / encodeFpsVals.length : 0;
    (0, unified_log_js_1.devLog)(`[Profile] Summary: avgDecode=${avgDecodeFps.toFixed(1)} fps, avgEncode=${avgEncodeFps.toFixed(1)} fps, total=${totalEncodeMs}ms`);
    if (!mergeResult.success) {
        return { success: false, workspaceId: workspace_id, chunks, totalEncodeMs, error: mergeResult.error };
    }
    // Cleanup chunk files and workspace directory after successful merge
    try {
        for (const chunk of chunks) {
            try {
                fs_1.default.unlinkSync(chunk.outputPath);
            }
            catch { }
        }
        const workspaceDir = path_1.default.join(outputDir, 'chunks', workspace_id);
        try {
            fs_1.default.rmSync(workspaceDir, { recursive: true, force: true });
        }
        catch { }
    }
    catch { }
    return {
        success: true,
        workspaceId: workspace_id,
        outputPath: outputFile,
        fileSize: mergeResult.fileSize,
        duration: totalDuration,
        chunks,
        totalEncodeMs,
        profileSummary: { avgDecodeFps, avgEncodeFps, totalMs: totalEncodeMs },
    };
}
