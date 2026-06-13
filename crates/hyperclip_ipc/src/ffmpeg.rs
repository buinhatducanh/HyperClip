// crates/hyperclip_ipc/src/ffmpeg.rs
// FFmpeg filter chain + NVENC params — ported from electron/services/ffmpeg.ts

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ─── Filter Chain constants — EXACT from ffmpeg.ts ───────────────────────────────

/// SHORT mode: header(20%) | video(70%) | bottom bar(10%)
/// Filter: fps=30 → setpts(speed) → trim → setpts(reset) → scale → crop
/// NO select='not(mod(n,2))' — causes 2x frame halving
/// NO -r 30 output flag — conflicts with filter chain
pub fn build_short_filter_chain(
    trim_start: f64,
    trim_end: f64,
    canvas_w: u32,
    canvas_h: u32,
    header_h: u32,
    _bottom_bar_h: u32,
    _video_h: u32,
    _video_top: u32,
) -> String {
    // [0:v] fps=30 → setpts → trim → scale → crop
    let fps_tag = "fps=30,";
    let trim_section = if trim_start > 0.0 || trim_end < 999.0 {
        format!("[0:v]{0}trim=start={},end={},setpts=PTS-STARTPTS", fps_tag, trim_start)
    } else {
        format!("[0:v]{0}setpts=PTS-STARTPTS", fps_tag)
    };
    format!("{},", trim_section)
}

/// Build speed filter tag: `setpts=1/speed*PTS,` or empty if speed == 1.0.
/// The speed filter compresses timestamps so the trim filter selects fewer frames,
/// resulting in shorter output duration.
pub fn speed_filter_tag(speed: f64) -> String {
    if speed <= 0.0 || (speed - 1.0).abs() < f64::EPSILON {
        String::new()
    } else {
        format!("setpts={}*PTS,", 1.0 / speed)
    }
}

/// Build atempo filter chain for audio speed adjustment.
/// Returns `[0:a]atempo=X[a]` string, or chained atempo for speed > 2.0.
/// atempo only supports 0.5–2.0 range; for speed < 0.5, audio is left at normal speed.
pub fn build_atempo_chain(speed: f64) -> Option<String> {
    if speed <= 0.0 || (speed - 1.0).abs() < f64::EPSILON { return None; }
    if speed < 0.5 { return None; } // atempo minimum is 0.5 → skip audio
    if speed <= 2.0 {
        return Some(format!("[0:a]atempo={}[a]", speed));
    }
    // speed > 2.0: chain multiple atempo filters (max 2.0 each)
    let mut factors: Vec<String> = Vec::new();
    let mut remaining = speed;
    while remaining > 2.0 {
        factors.push("2.0".to_string());
        remaining /= 2.0;
    }
    if (remaining - 1.0).abs() > 0.001 {
        factors.push(format!("{:.2}", remaining));
    }
    Some(format!("[0:a]atempo={}[a]", factors.join(",atempo=")))
}

/// Build filter complex for SHORT (9:16) layout
/// Z-order: bg(bottom) → video(middle) → bottom_bar → header(top)
/// Filter order: fps → setpts(speed) → trim → setpts(reset) → scale → crop
pub fn build_short_filter(
    trim_start: f64,
    trim_duration: f64,
    speed: f64,
    canvas_w: u32,
    canvas_h: u32,
    header_h: u32,
    bottom_bar_h: u32,
    use_cuda: bool,
    fps: u32,
) -> String {
    let scale = if use_cuda { "scale_cuda" } else { "scale" };
    let overlay = if use_cuda { "overlay_cuda" } else { "overlay" };
    let scale_flags = if use_cuda { "" } else { ":flags=lanczos" };

    let video_h = canvas_h - header_h - bottom_bar_h;
    let video_top = header_h;
    let scaled_w = ((video_h as f64) * 16.0 / 9.0).round() as u32;
    let crop_x = ((scaled_w - canvas_w) / 2).max(0);

    // Speed filter BEFORE trim: compresses timestamps so trim duration refers to output seconds.
    let speed_tag = speed_filter_tag(speed);
    let speed_adj = if speed > 0.0 && (speed - 1.0).abs() >= f64::EPSILON { 1.0 / speed } else { 1.0 };
    let adjusted_dur = trim_duration * speed_adj;

    // Video chain: fps → setpts(speed) → trim → setpts(reset) → scale → crop
    let trim_tag = if trim_start > 0.0 || trim_duration > 0.0 {
        let dur = if adjusted_dur > 0.0 { adjusted_dur } else { 999.0 };
        format!(
            "trim=start={}:duration={},setpts=PTS-STARTPTS,",
            trim_start, dur
        )
    } else {
        String::new()
    };
    let video_chain = format!(
        "[0:v]fps={},{}{}setpts=PTS-STARTPTS,{}=-2:{}{},crop={}:{}:{}:0,format=yuv420p[vid]",
        fps,
        speed_tag,
        trim_tag,
        scale,
        video_h,
        scale_flags,
        canvas_w,
        video_h,
        crop_x
    );

    // Background chain: fill canvas
    let bg_chain = format!(
        "[1:v]{}={}:{}:force_original_aspect_ratio=increase,crop={}:{}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[bg]",
        scale,
        canvas_w,
        canvas_h,
        canvas_w,
        canvas_h
    );

    // Video over background at video_top
    let vz_chain = format!(
        "[bg][vid]{}=0:{} [vz]",
        overlay,
        video_top
    );

    // Header at top (y=0) - [2:v] is header
    let hd_chain = format!(
        "[2:v]{}={}:{}:force_original_aspect_ratio=increase,crop={}:{}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[hd]",
        scale,
        canvas_w,
        header_h,
        canvas_w,
        header_h
    );
    let vh_chain = format!(
        "[vz][hd]{}=0:0 [vh]",
        overlay
    );

    // Bottom bar at bottom (bb_y) - [3:v] is bottom bar (pre-rendered PNG, no scaling/cropping)
    let bb_y = canvas_h - bottom_bar_h;
    let bb_chain = "[3:v]null[bb]".to_string();
    let final_chain = format!(
        "[vh][bb]{}=0:{} [final]",
        overlay,
        bb_y
    );

    format!(
        "{}; {}; {}; {}; {}; {}; {}",
        video_chain, bg_chain, vz_chain, hd_chain, vh_chain, bb_chain, final_chain
    )
}

/// CUDA-accelerated filter for SHORT (9:16) layout
pub fn build_short_filter_cuda(
    trim_start: f64,
    trim_duration: f64,
    speed: f64,
    canvas_w: u32,
    canvas_h: u32,
    header_h: u32,
    bottom_bar_h: u32,
    fps: u32,
) -> String {
    let video_h = canvas_h - header_h - bottom_bar_h;
    let video_top = header_h;
    let scaled_w = ((video_h as f64) * 16.0 / 9.0).round() as u32;
    let crop_x = ((scaled_w - canvas_w) / 2).max(0);

    let speed_tag = speed_filter_tag(speed);
    let speed_adj = if speed > 0.0 && (speed - 1.0).abs() >= f64::EPSILON { 1.0 / speed } else { 1.0 };
    let adjusted_dur = trim_duration * speed_adj;

    let trim_tag = if trim_start > 0.0 || trim_duration > 0.0 {
        let dur = if adjusted_dur > 0.0 { adjusted_dur } else { 999.0 };
        format!("trim=start={}:duration={},setpts=PTS-STARTPTS,", trim_start, dur)
    } else {
        String::new()
    };
    let video_chain = format!(
        "[0:v]fps={},{}{}setpts=PTS-STARTPTS,scale_cuda=-2:{},crop_cuda={}:{}:{}:0[vid]",
        fps, speed_tag, trim_tag, video_h, canvas_w, video_h, crop_x
    );

    let bg_chain = format!(
        "[1:v]scale_cuda={}:{}:force_original_aspect_ratio=increase,crop_cuda={}:{}:(ow-iw)/2:(oh-ih)/2,setsar=1[bg]",
        canvas_w, canvas_h, canvas_w, canvas_h
    );

    let vz_chain = format!("[bg][vid]overlay_cuda=0:{} [vz]", video_top);
    let hd_chain = format!(
        "[2:v]scale_cuda={}:{}:force_original_aspect_ratio=increase,crop_cuda={}:{}:(ow-iw)/2:(oh-ih)/2,setsar=1[hd]",
        canvas_w, header_h, canvas_w, header_h
    );
    let vh_chain = format!("[vz][hd]overlay_cuda=0:0 [vh]");
    let bb_y = canvas_h - bottom_bar_h;
    let bb_chain = format!(
        "[3:v]scale_cuda={}:{}:force_original_aspect_ratio=increase,crop_cuda={}:{}:(ow-iw)/2:(oh-ih)/2[bb]",
        canvas_w, bottom_bar_h, canvas_w, bottom_bar_h
    );
    let final_chain = format!("[vh][bb]overlay_cuda=0:{} [final]", bb_y);

    format!("{}; {}; {}; {}; {}; {}; {}", video_chain, bg_chain, vz_chain, hd_chain, vh_chain, bb_chain, final_chain)
}

/// Build filter complex for LANDSCAPE layout
pub fn build_landscape_filter(
    trim_start: f64,
    trim_duration: f64,
    speed: f64,
    canvas_w: u32,
    canvas_h: u32,
    video_h: u32,
    video_top: u32,
    use_cuda: bool,
    fps: u32,
) -> String {
    let scale = if use_cuda { "scale_cuda" } else { "scale" };
    let overlay = if use_cuda { "overlay_cuda" } else { "overlay" };
    let scale_flags = if use_cuda { "" } else { ":flags=lanczos" };

    let crop_x_num = ((video_h as f64 * 16.0 / 9.0) - (canvas_w as f64)).round() as i32 / 2;

    let speed_tag = speed_filter_tag(speed);
    let speed_adj = if speed > 0.0 && (speed - 1.0).abs() >= f64::EPSILON { 1.0 / speed } else { 1.0 };
    let adjusted_dur = trim_duration * speed_adj;

    let trim_tag = if trim_start > 0.0 || trim_duration > 0.0 {
        let dur = if adjusted_dur > 0.0 { adjusted_dur } else { 999.0 };
        format!(
            "trim=start={}:duration={},setpts=PTS-STARTPTS,",
            trim_start, dur
        )
    } else {
        String::new()
    };

    let video_chain = if crop_x_num >= 0 {
        format!(
            "[0:v]fps={},{}{}setpts=PTS-STARTPTS,{}=-2:{}{},crop={}:{}:{}:0[vid]",
            fps,
            speed_tag, trim_tag,
            scale,
            video_h,
            scale_flags,
            canvas_w,
            video_h,
            crop_x_num
        )
    } else {
        let crop_y = ((canvas_w as f64 * 9.0 / 16.0) - (video_h as f64)).round() as i32 / 2 + video_top as i32;
        format!(
            "[0:v]fps={},{}{}setpts=PTS-STARTPTS,{}={}:-2{},crop={}:{}:0:{} [vid]",
            fps,
            speed_tag, trim_tag,
            scale,
            canvas_w,
            scale_flags,
            canvas_w,
            video_h,
            crop_y.max(0)
        )
    };

    // Background: thumbnail fills canvas
    let bg_chain = format!(
        "[1:v]{}={}:{}:force_original_aspect_ratio=increase,crop={}:{}:(ow-iw)/2:(oh-ih)/2[bg]",
        scale,
        canvas_w,
        canvas_h,
        canvas_w,
        canvas_h
    );

    // Video over bg
    let vz_chain = format!(
        "[bg][vid]{}=0:{} [vz]",
        overlay,
        video_top
    );

    // Header at top (y=0) - [2:v] is header
    let header_h = canvas_h / 5;
    let crop = if use_cuda { "crop_cuda" } else { "crop" };
    let format_tag = if use_cuda { "" } else { ",format=yuv420p" };
    let hd_chain = format!(
        "[2:v]{}={}:{}:force_original_aspect_ratio=increase,{}={}:{}:(ow-iw)/2:(oh-ih)/2,setsar=1{}[hd]",
        scale,
        canvas_w,
        header_h,
        crop,
        canvas_w,
        header_h,
        format_tag
    );

    // Header on top of vz
    let final_chain = format!(
        "[vz][hd]{}=0:0 [final]",
        overlay
    );

    format!(
        "{}; {}; {}; {}; {}",
        video_chain, bg_chain, vz_chain, hd_chain, final_chain
    )
}

// ─── NVENC encoding params — EXACT from ffmpeg.ts ──────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum EncodeCodec { H264, HEVC }

#[derive(Debug, Clone, Copy)]
pub struct EncodeParams {
    pub codec: EncodeCodec,
    pub crf: u32,
    pub maxrate: &'static str,
    pub bufsize: &'static str,
    pub preset: &'static str,
}

impl EncodeParams {
    /// CRF table from electron/services/ffmpeg.ts
    pub fn for_tier_and_quality(tier: &str, quality: u32) -> Self {
        let codec = match (tier, quality) {
            ("high", _) => EncodeCodec::HEVC,
            ("mid", _) => EncodeCodec::HEVC,
            _ => EncodeCodec::H264,
        };
        let crf = match (tier, quality) {
            ("high", 360) => 26,
            ("high", 720) => 24,
            ("high", _) => 20,  // 1080
            ("mid", 360) => 26,
            ("mid", 720) => 24,
            ("mid", _) => 20,  // 1080
            _ => 22,
        };
        let (maxrate, bufsize) = match tier {
            "high" => ("12M", "24M"),
            "mid" => ("6M", "12M"),
            _ => ("3M", "6M"),
        };
        let preset = match tier {
            "high" => "p1",
            "mid" => "p2",
            _ => "p3",
        };
        EncodeParams { codec, crf, maxrate, bufsize, preset }
    }
}

pub fn nvenc_codec_name(codec: EncodeCodec) -> &'static str {
    match codec {
        EncodeCodec::HEVC => "hevc_nvenc",
        EncodeCodec::H264 => "h264_nvenc",
    }
}

// ─── FFmpeg path resolution ────────────────────────────────────────────────────

pub fn get_ffmpeg_path() -> String {
    // 1. Try bundled ffmpeg in resources first
    let bundled = crate::store::get_resources_dir().join("ffmpeg/bin/ffmpeg.exe");
    if bundled.exists() {
        return bundled.to_string_lossy().replace('\\', "/");
    }

    // 2. Fallback candidates
    let mut candidates = Vec::new();
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        candidates.push(format!("{}/scoop/shims/ffmpeg.exe", userprofile.replace('\\', "/")));
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        candidates.push(format!("{}/Programs/scoop/shims/ffmpeg.exe", localappdata.replace('\\', "/")));
    }
    candidates.push("ffmpeg".to_string());

    for p in &candidates {
        if std::path::Path::new(p).exists() {
            return p.replace('\\', "/");
        }
    }
    "ffmpeg".to_string()
}

// ─── FFmpeg rendering ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderProgress {
    pub workspace_id: String,
    pub percent: f64,
    pub fps: f64,
    pub speed: String,
}

/// Spawn ffmpeg render and return immediately (non-blocking).
/// Progress is emitted via a callback closure.
pub fn spawn_render(
    ffmpeg_path: &str,
    input_path: &str,
    output_path: &str,
    filter_complex: &str,
    codec: EncodeCodec,
    crf: u32,
    preset: &str,
    _maxrate: &str,
    _bufsize: &str,
    _progress_callback: impl Fn(f64) + Send + 'static,
) -> std::process::Child {
    let codec_name = nvenc_codec_name(codec);
    let cmd_args = vec![
        "-hide_banner".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string(),
        "-filter_complex".to_string(),
        filter_complex.to_string(),
        "-map".to_string(),
        "[final]".to_string(),
        "-c:v".to_string(),
        codec_name.to_string(),
        "-preset".to_string(),
        preset.to_string(),
        "-rc:v".to_string(),
        "vbr_hq".to_string(),
        "-cq".to_string(),
        crf.to_string(),
        "-tune".to_string(),
        "hq".to_string(),
        "-bf".to_string(),
        "0".to_string(),
        "-refs".to_string(),
        "1".to_string(),
        "-g".to_string(),
        "30".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        output_path.to_string(),
    ];

    let mut cmd = std::process::Command::new(ffmpeg_path);
    for arg in &cmd_args {
        cmd.arg(arg);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    cmd.spawn().expect("ffmpeg spawn failed")
}

// ─── Async render (WS4) ───────────────────────────────────────────────────

use crate::error::{HyperclipError, Result};
use crate::render_progress::parse_ffmpeg_stderr;
use crate::system::GPUTier;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

#[derive(Debug, Clone, Copy)]
pub enum FilterChain { Short, Landscape }

pub struct RenderOptions {
    pub workspace_id: String,
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub resolution: String,
    pub fps: u32,
    pub speed: f64,
    pub trim_start: f64,
    pub trim_end: f64,
    pub gpu_tier: crate::system::GPUTier,
    pub preset: String,
    pub filter_chain: FilterChain,
    pub chunked: bool,
    pub chunk_duration_sec: u32,
}

pub async fn spawn_render_async<F>(
    opts: RenderOptions,
    mut on_progress: F,
) -> Result<(PathBuf, f64)>
where F: FnMut(f64) + Send + 'static {
    let speed = opts.speed;
    let (mut canvas_w, mut canvas_h) = parse_resolution(&opts.resolution);
    // Short (9:16) needs portrait — swap if landscape was returned
    if matches!(opts.filter_chain, FilterChain::Short) && canvas_w > canvas_h {
        std::mem::swap(&mut canvas_w, &mut canvas_h);
    }
    let (header_h, bottom_bar_h) = (canvas_h / 5, canvas_h / 10);

    // Disable GPU decoding and filter acceleration to avoid crop_cuda and pixel format issues
    let use_cuda_filters = false;
    let use_cuda = matches!(opts.gpu_tier, GPUTier::High | GPUTier::Mid) && use_cuda_filters;

    // 1. Build video filter chain
    let fps = if opts.fps == 0 { 30 } else { opts.fps };
    let video_filter = match opts.filter_chain {
        FilterChain::Short => {
            if use_cuda {
                build_short_filter_cuda(opts.trim_start, opts.trim_end - opts.trim_start, speed, canvas_w, canvas_h, header_h, bottom_bar_h, fps)
            } else {
                build_short_filter(opts.trim_start, opts.trim_end - opts.trim_start, speed, canvas_w, canvas_h, header_h, bottom_bar_h, false, fps)
            }
        }
        FilterChain::Landscape => {
            let video_h = canvas_h - header_h - bottom_bar_h;
            build_landscape_filter(opts.trim_start, opts.trim_end - opts.trim_start, speed, canvas_w, canvas_h, video_h, header_h, use_cuda, fps)
        }
    };

    // 2. Build audio atempo chain (if speed != 1.0)
    let atempo = build_atempo_chain(speed);

    // 3. Combine filter complex + determine mappings
    let complete_filter: String;
    let audio_map: &str;
    if let Some(audio_filter) = &atempo {
        complete_filter = format!("{}; {}", video_filter, audio_filter);
        audio_map = "[a]";
    } else {
        complete_filter = video_filter;
        audio_map = "0:a?";  // auto-map best audio stream (optional — ? = skip if no audio)
    }

    // 4. Encode params
    let codec = match opts.gpu_tier {
        GPUTier::High => "hevc_nvenc",
        GPUTier::Mid | GPUTier::Low => "h264_nvenc",
        _ => "libx264",
    };
    let crf = if opts.chunked { 20 } else { 18 };
    let maxrate = match opts.resolution.as_str() {
        "1080p" | "1440p" | "2160p" => "12M",
        "720p" => "6M",
        _ => "3M",
    };
    let bufsize = maxrate;

    let total_duration = (opts.trim_end - opts.trim_start) / speed;
    let total_duration_str = format!("{:.2}", total_duration.max(1.0));

    // Prepare real assets for Short Mode overlays if workspace database is present
    let mut use_real_assets = false;
    let mut blur_file = PathBuf::new();
    let mut thumb_file = PathBuf::new();
    let mut bar_file = PathBuf::new();

    if matches!(opts.filter_chain, FilterChain::Short) {
        let ws_path = crate::store::get_workspaces_path();
        if ws_path.exists() {
            let store = crate::store::WorkspaceStore::load(&ws_path);
            if let Some(workspace) = store.workspaces.iter().find(|w| w.id == opts.workspace_id) {
                let mut thumbnail_path = workspace
                    .thumbnail_local
                    .as_ref()
                    .map(PathBuf::from)
                    .unwrap_or_default();

                if !thumbnail_path.exists() {
                    // Extract thumbnail from the video itself
                    let extracted_path = opts.input_path.with_file_name(format!("{}_thumb_fallback.jpg", opts.workspace_id));
                    tracing::info!("[AppState] Thumbnail not found. Extracting to {:?}", extracted_path);
                    let mut extract_cmd = std::process::Command::new(get_ffmpeg_path());
                    extract_cmd.args([
                        "-hide_banner", "-y",
                        "-i", opts.input_path.to_str().unwrap(),
                        "-vframes", "1",
                        "-vf", "scale=1280:-2",
                        "-q:v", "2",
                        "-update", "1",
                        extracted_path.to_str().unwrap()
                    ]);
                    if let Ok(mut child) = extract_cmd.spawn() {
                        let _ = child.wait();
                    }
                    thumbnail_path = extracted_path;
                }

                if thumbnail_path.exists() {
                    // Generate blur background
                    let blur_path = opts.input_path.with_file_name(format!("{}_blur.jpg", opts.workspace_id));
                    tracing::info!("[AppState] Generating blur background at {:?}", blur_path);
                    let mut blur_cmd = std::process::Command::new(get_ffmpeg_path());
                    blur_cmd.args([
                        "-hide_banner", "-y",
                        "-i", thumbnail_path.to_str().unwrap(),
                        "-vf", "scale=32:18:flags=bilinear,scale=1080:1920:flags=bilinear",
                        "-vframes", "1",
                        "-update", "1",
                        blur_path.to_str().unwrap()
                    ]);
                    if let Ok(mut child) = blur_cmd.spawn() {
                        if let Ok(status) = child.wait() {
                            if status.success() {
                                // Generate bottom bar PNG via PowerShell GDI+
                                let bottom_bar_path = opts.input_path.with_file_name(format!("{}_bottom_bar.png", opts.workspace_id));
                                
                                let s_path = crate::store::get_settings_path();
                                let s_store = crate::store::SettingsStore::load(&s_path);
                                let mut template = s_store.settings.get("autoRenderTitleTemplate")
                                    .or_else(|| s_store.settings.get("auto_render_title_template"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("{title}");
                                if template.is_empty() {
                                    template = "{title}";
                                }

                                let workspace_title = if !workspace.title.is_empty() { &workspace.title } else { "PART 1" };
                                let channel_name = workspace.channel_name.as_deref().unwrap_or("");
                                let text = template
                                    .replace("{title}", workspace_title)
                                    .replace("{channel}", channel_name)
                                    .replace("{video_id}", &workspace.video_id);

                                let clean_text = text.replace('"', "`\"");
                                tracing::info!("[AppState] Generating bottom bar PNG at {:?}", bottom_bar_path);
                                
                                let mut ps_cmd = std::process::Command::new("powershell");
                                let ps_script = format!(
                                    r#"
                                    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
                                    Add-Type -AssemblyName System.Drawing
                                    $bmp = New-Object System.Drawing.Bitmap({canvas_w}, {bottom_bar_h})
                                    $g = [System.Drawing.Graphics]::FromImage($bmp)
                                    $g.SmoothingMode = 'AntiAlias'
                                    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
                                    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 180, 255))
                                    $g.FillRectangle($brush, 0, 0, {canvas_w}, {bottom_bar_h})
                                    $brush.Dispose()
                                    $fontSize = [Math]::Max(24, [int]({bottom_bar_h} * 0.25))
                                    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
                                    $sf = New-Object System.Drawing.StringFormat
                                    $sf.Alignment = [System.Drawing.StringAlignment]::Center
                                    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
                                    $rect = New-Object System.Drawing.RectangleF(0, 0, {canvas_w}, {bottom_bar_h})
                                    $g.DrawString("{text}", $font, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)), $rect, $sf)
                                    $g.Dispose()
                                    $font.Dispose()
                                    $sf.Dispose()
                                    $r = New-Object System.Drawing.Rectangle(0, 0, {canvas_w}, {bottom_bar_h})
                                    $bd = $bmp.LockBits($r, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                                    $bytes = [byte[]]::new($bd.Stride * {bottom_bar_h})
                                    [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
                                    for ($i = 3; $i -lt $bytes.Length; $i += 4) {{ $bytes[$i] = 255 }}
                                    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $bd.Scan0, $bytes.Length)
                                    $bmp.UnlockBits($bd)
                                    $bmp.Save("{output_path}", [System.Drawing.Imaging.ImageFormat]::Png)
                                    $bmp.Dispose()
                                    "#,
                                    canvas_w = canvas_w,
                                    bottom_bar_h = bottom_bar_h,
                                    text = clean_text,
                                    output_path = bottom_bar_path.to_str().unwrap().replace('\\', "/")
                                );
                                ps_cmd.arg("-Command").arg(&ps_script);
                                if let Ok(mut child) = ps_cmd.spawn() {
                                    if let Ok(status) = child.wait() {
                                        if status.success() {
                                            use_real_assets = true;
                                            blur_file = blur_path;
                                            thumb_file = thumbnail_path;
                                            bar_file = bottom_bar_path;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut cmd = TokioCommand::new(get_ffmpeg_path());
    let mut args: Vec<String> = vec![
        "-hide_banner".into(), "-y".into(),
    ];

    if use_cuda {
        args.extend_from_slice(&["-hwaccel".into(), "cuda".into(), "-hwaccel_output_format".into(), "cuda".into()]);
    }

    // Input [0]: source video
    args.extend_from_slice(&["-i".into(), opts.input_path.to_str().unwrap().to_string()]);

    if use_real_assets {
        args.extend_from_slice(&[
            "-loop".into(), "1".into(), "-i".into(), blur_file.to_str().unwrap().to_string(),
            "-loop".into(), "1".into(), "-i".into(), thumb_file.to_str().unwrap().to_string(),
            "-i".into(), bar_file.to_str().unwrap().to_string(),
        ]);
    } else {
        // Fallback to lavfi colors
        let dur_str = format!("d={}", total_duration_str);
        let bg_color = "0x2d2d2d";  // dark gray bg
        let bb_color = "0x1a1a1a";  // bottom bar
        let hd_color = "0x0d0d0d";  // header

        for (color, w, h) in [
            (bg_color, canvas_w, canvas_h),
            (hd_color, canvas_w, header_h), // mapped to [2:v] in filter graph (Header)
            (bb_color, canvas_w, bottom_bar_h), // mapped to [3:v] in filter graph (Bottom bar)
        ] {
            args.extend_from_slice(&[
                "-f".into(), "lavfi".into(),
                "-i".into(), format!("color=c={}:s={}x{}:{}:r=30", color, w, h, dur_str),
            ]);
        }
    }

    args.extend_from_slice(&[
        "-filter_complex".into(), complete_filter,
        "-t".into(), total_duration_str.clone(),
        "-map".into(), "[final]".into(),
        "-map".into(), audio_map.into(),
    ]);

    // Conditional encoder configuration based on codec type
    if codec.contains("nvenc") {
        args.extend_from_slice(&[
            "-c:v".into(), codec.to_string(),
            "-preset".into(), opts.preset.clone(),
            "-rc:v".into(), "vbr_hq".into(),
            "-cq".into(), crf.to_string(),
            "-tune".into(), "ull".into(),
            "-bf".into(), "0".into(),
            "-refs".into(), "1".into(),
            "-g".into(), "30".into(),
            "-maxrate".into(), maxrate.to_string(),
            "-bufsize".into(), bufsize.to_string(),
        ]);
    } else {
        // CPU fallback (libx264)
        args.extend_from_slice(&[
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "medium".into(),
            "-crf".into(), "23".into(),
            "-pix_fmt".into(), "yuv420p".into(),
        ]);
    }

    args.extend_from_slice(&[
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "192k".into(),
        opts.output_path.to_str().unwrap().to_string(),
    ]);

    cmd.args(&args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| HyperclipError::FFmpegNotFound(e.to_string()))?;
    let stderr = child.stderr.take().unwrap();
    let mut reader = BufReader::new(stderr);

    // Read stderr into a buffer for error reporting
    let stderr_buf: Arc<std::sync::Mutex<String>> = Arc::new(std::sync::Mutex::new(String::new()));
    let stderr_buf_clone = stderr_buf.clone();

    let last_fps = Arc::new(std::sync::Mutex::new(0.0));
    let last_fps_clone = last_fps.clone();

    tokio::spawn(async move {
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    if let Some(p) = parse_ffmpeg_stderr(line.trim(), total_duration) {
                        on_progress(p);
                    }
                    if let Some(fps) = crate::render_progress::parse_ffmpeg_fps(&line) {
                        if let Ok(mut lock) = last_fps_clone.lock() {
                            *lock = fps;
                        }
                    }
                    if let Ok(mut buf) = stderr_buf_clone.lock() {
                        buf.push_str(&line);
                    }
                }
                Err(_) => break,
            }
        }
    });

    let status = child.wait().await.map_err(HyperclipError::Io)?;
    if !status.success() {
        let err_detail = stderr_buf.lock().map(|b| b.clone()).unwrap_or_default();
        return Err(HyperclipError::BackendCrashed(
            format!("FFmpeg exit {:?}. Stderr:\n{}", status.code(), err_detail)
        ));
    }
    let final_fps = last_fps.lock().map(|l| *l).unwrap_or(0.0);
    Ok((opts.output_path, final_fps))
}

fn parse_resolution(res: &str) -> (u32, u32) {
    match res {
        "2160p" => (3840, 2160),
        "1440p" => (2560, 1440),
        "1080p" => (1920, 1080),
        "720p" => (1280, 720),
        "360p" => (640, 360),
        _ => (1920, 1080),
    }
}
