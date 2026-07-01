// crates/hyperclip_ipc/src/ffmpeg.rs
// FFmpeg filter chain + NVENC params — ported from electron/services/ffmpeg.ts

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// ─── Filter Chain constants — EXACT from ffmpeg.ts ───────────────────────────────

/// SHORT mode: header(20%) | video(70%) | bottom bar(10%)
/// Filter: fps=30 → setpts(speed) → trim → setpts(reset) → scale → crop
/// NO select='not(mod(n,2))' — causes 2x frame halving
/// NO -r 30 output flag — conflicts with filter chain
pub fn build_short_filter_chain(
    trim_start: f64,
    trim_end: f64,
    _canvas_w: u32,
    _canvas_h: u32,
    _header_h: u32,
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

pub fn build_audio_chain(trim_start: f64, trim_duration: f64, speed: f64) -> String {
    let mut parts = Vec::new();
    
    // 1. Trim first on the original timeline
    if trim_start > 0.0 || trim_duration > 0.0 {
        let dur_str = if trim_duration > 0.0 { format!(":duration={}", trim_duration) } else { "".to_string() };
        parts.push(format!("atrim=start={}{}", trim_start, dur_str));
        parts.push("asetpts=PTS-STARTPTS".to_string());
    }
    
    // 2. Speed second
    if speed > 0.0 && (speed - 1.0).abs() >= f64::EPSILON {
        let mut temp_speed = speed;
        let mut factors = Vec::new();
        while temp_speed > 2.0 {
            factors.push("2.0".to_string());
            temp_speed /= 2.0;
        }
        if temp_speed < 0.5 {
            temp_speed = 0.5;
        }
        factors.push(format!("{:.4}", temp_speed));
        parts.push(format!("atempo={}", factors.join(",atempo=")));
    }
    
    if parts.is_empty() {
        "".to_string()
    } else {
        format!("[0:a]{}[a]", parts.join(","))
    }
}

/// Build filter complex for SHORT (9:16) layout
/// Z-order: bg(bottom) → video(middle) → bottom_bar → header(top)
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
    wi: u32,
    hi: u32,
) -> String {
    let scale = if use_cuda { "scale_cuda" } else { "scale" };
    let overlay = if use_cuda { "overlay_cuda" } else { "overlay" };
    let scale_flags = if use_cuda { "" } else { ":flags=bicubic" };

    let video_h = canvas_h - header_h - bottom_bar_h;
    let video_top = header_h;
    
    let (scaled_w, scaled_h) = compute_contain_dimensions(wi, hi, canvas_w, video_h);
    let x_offset = (canvas_w as i32 - scaled_w as i32) / 2;
    let y_offset = video_top as i32 + (video_h as i32 - scaled_h as i32) / 2;

    let mut video_ops = Vec::new();
    video_ops.push(format!("fps={}", fps));
    if trim_start > 0.0 || trim_duration > 0.0 {
        let dur = if trim_duration > 0.0 { trim_duration } else { 9999.0 };
        video_ops.push(format!("trim=start={}:duration={}", trim_start, dur));
        video_ops.push("setpts=PTS-STARTPTS".to_string());
    }
    if speed > 0.0 && (speed - 1.0).abs() >= f64::EPSILON {
        video_ops.push(format!("setpts={}*PTS", 1.0 / speed));
    }
    video_ops.push(format!("{}={}:{}{}", scale, scaled_w, scaled_h, scale_flags));
    video_ops.push("format=yuv420p".to_string());

    let video_chain = format!("[0:v]{}[vid]", video_ops.join(","));

    // Background chain: load composite background
    let bg_chain = format!(
        "[1:v]format=yuv420p,loop=loop=-1:size=1:start=0,fps={}[bg]",
        fps
    );

    // Video over background at x_offset, y_offset
    let vz_chain = format!(
        "[bg][vid]{}={}:{} [vf]",
        overlay,
        x_offset,
        y_offset
    );

    let final_chain = "[vf]null[final]".to_string();

    format!(
        "{}; {}; {}; {}",
        video_chain, bg_chain, vz_chain, final_chain
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
    wi: u32,
    hi: u32,
    decoder_cropped: bool,
    decode_on_cpu: bool,
) -> String {
    let video_h = canvas_h - header_h - bottom_bar_h;
    let video_top = header_h;

    let mut video_ops = Vec::new();
    video_ops.push(format!("fps={}", fps));
    if trim_start > 0.0 || trim_duration > 0.0 {
        let dur = if trim_duration > 0.0 { trim_duration } else { 9999.0 };
        video_ops.push(format!("trim=start={}:duration={}", trim_start, dur));
        video_ops.push("setpts=PTS-STARTPTS".to_string());
    }
    if speed > 0.0 && (speed - 1.0).abs() >= f64::EPSILON {
        video_ops.push(format!("setpts={}*PTS", 1.0 / speed));
    }

    let (scaled_w, scaled_h) = compute_contain_dimensions(wi, hi, canvas_w, video_h);
    let x_offset = (canvas_w as i32 - scaled_w as i32) / 2;
    let y_offset = video_top as i32 + (video_h as i32 - scaled_h as i32) / 2;

    if decoder_cropped {
        video_ops.push(format!("scale_cuda={}:{}", scaled_w, scaled_h));
    } else if decode_on_cpu {
        video_ops.push(format!("scale={}:{}:flags=fast_bilinear", scaled_w, scaled_h));
        video_ops.push("format=nv12".to_string());
        video_ops.push("hwupload_cuda".to_string());
    } else {
        video_ops.push(format!("scale_cuda={}:{}", scaled_w, scaled_h));
    }

    let video_chain = format!("[0:v]{}[vid]", video_ops.join(","));

    let bg_chain = "[1:v]format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bg]".to_string();

    let vz_chain = format!(
        "[bg][vid]overlay_cuda=x={}:y={}:eof_action=repeat,setsar=1 [final]",
        x_offset,
        y_offset
    );

    format!(
        "{}; {}; {}",
        video_chain, bg_chain, vz_chain
    )
}

/// CUDA-accelerated filter for LANDSCAPE layout
pub fn build_landscape_filter_cuda(
    trim_start: f64,
    trim_duration: f64,
    speed: f64,
    _canvas_w: u32,
    _canvas_h: u32,
    header_h: u32,
    fps: u32,
) -> String {
    let video_top = header_h;

    let mut video_ops = Vec::new();
    video_ops.push(format!("fps={}", fps));
    if trim_start > 0.0 || trim_duration > 0.0 {
        let dur = if trim_duration > 0.0 { trim_duration } else { 9999.0 };
        video_ops.push(format!("trim=start={}:duration={}", trim_start, dur));
        video_ops.push("setpts=PTS-STARTPTS".to_string());
    }
    if speed > 0.0 && (speed - 1.0).abs() >= f64::EPSILON {
        video_ops.push(format!("setpts={}*PTS", 1.0 / speed));
    }
    video_ops.push("format=nv12".to_string());
    video_ops.push("hwupload_cuda".to_string());

    let video_chain = format!("[0:v]{}[vid]", video_ops.join(","));

    let bg_chain = "[1:v]format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bg]".to_string();

    let vz_chain = format!("[bg][vid]overlay_cuda=x=0:y={}:eof_action=repeat,setsar=1 [vf]", video_top);
    let final_chain = "[vf]null[final]".to_string();

    format!(
        "{}; {}; {}; {}",
        video_chain, bg_chain, vz_chain, final_chain
    )
}

/// Build filter complex for LANDSCAPE layout
pub fn build_landscape_filter(
    trim_start: f64,
    trim_duration: f64,
    speed: f64,
    canvas_w: u32,
    _canvas_h: u32,
    video_h: u32,
    video_top: u32,
    use_cuda: bool,
    fps: u32,
) -> String {
    let scale = if use_cuda { "scale_cuda" } else { "scale" };
    let overlay = if use_cuda { "overlay_cuda" } else { "overlay" };
    let scale_flags = if use_cuda { "" } else { ":flags=bicubic" };

    let crop_x_num = ((video_h as f64 * 16.0 / 9.0) - (canvas_w as f64)).round() as i32 / 2;

    let mut video_ops = Vec::new();
    video_ops.push(format!("fps={}", fps));
    if trim_start > 0.0 || trim_duration > 0.0 {
        let dur = if trim_duration > 0.0 { trim_duration } else { 9999.0 };
        video_ops.push(format!("trim=start={}:duration={}", trim_start, dur));
        video_ops.push("setpts=PTS-STARTPTS".to_string());
    }
    if speed > 0.0 && (speed - 1.0).abs() >= f64::EPSILON {
        video_ops.push(format!("setpts={}*PTS", 1.0 / speed));
    }

    if crop_x_num >= 0 {
        video_ops.push(format!("{}={}:{}{}", scale, "-2", video_h, scale_flags));
        video_ops.push(format!("crop={}:{}:{}:0", canvas_w, video_h, crop_x_num));
    } else {
        let crop_y = ((canvas_w as f64 * 9.0 / 16.0) - (video_h as f64)).round() as i32 / 2 + video_top as i32;
        video_ops.push(format!("{}={}:{}{}", scale, canvas_w, "-2", scale_flags));
        video_ops.push(format!("crop={}:{}:0:{}", canvas_w, video_h, crop_y.max(0)));
    }

    let video_chain = format!("[0:v]{}[vid]", video_ops.join(","));

    // Background: load composite background
    let bg_chain = format!(
        "[1:v]format=yuv420p,loop=loop=-1:size=1:start=0,fps={}[bg]",
        fps
    );

    // Video over bg
    let vz_chain = format!(
        "[bg][vid]{}=0:{} [vf]",
        overlay,
        video_top
    );
    let final_chain = "[vf]null[final]".to_string();

    format!(
        "{}; {}; {}; {}",
        video_chain, bg_chain, vz_chain, final_chain
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
            ("high", 480) => 25,
            ("high", 720) => 24,
            ("high", _) => 20,  // 1080
            ("mid", 360) => 26,
            ("mid", 480) => 25,
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
        let path_str = bundled.to_string_lossy().to_string();
        let cleaned = crate::store::clean_unc_path(&path_str);
        return cleaned.replace('\\', "/");
    }

    // 2. Fallback candidates
    let mut candidates = Vec::new();
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let cleaned_userprofile = crate::store::clean_unc_path(&userprofile);
        candidates.push(format!("{}/scoop/shims/ffmpeg.exe", cleaned_userprofile.replace('\\', "/")));
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        let cleaned_localappdata = crate::store::clean_unc_path(&localappdata);
        candidates.push(format!("{}/Programs/scoop/shims/ffmpeg.exe", cleaned_localappdata.replace('\\', "/")));
    }
    candidates.push("ffmpeg".to_string());

    for p in &candidates {
        if std::path::Path::new(p).exists() {
            let cleaned = crate::store::clean_unc_path(p);
            return cleaned.replace('\\', "/");
        }
    }
    "ffmpeg".to_string()
}


pub fn get_ffprobe_path() -> String {
    let ffmpeg = get_ffmpeg_path();
    ffmpeg.replace("ffmpeg.exe", "ffprobe.exe")
}

pub fn probe_video_dimensions(path: &std::path::Path) -> Option<(u32, u32)> {
    let ffprobe_path = get_ffprobe_path();
    let mut cmd = std::process::Command::new(ffprobe_path);
    let clean_path = crate::store::clean_unc_path(path.to_str().unwrap_or_default());
    cmd.args([
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0:s=x",
        &clean_path,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    if let Ok(output) = cmd.output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let parts: Vec<&str> = stdout.trim().split('x').collect();
        if parts.len() == 2 {
            if let (Ok(w), Ok(h)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                return Some((w, h));
            }
        }
    }
    None
}

pub fn probe_video_codec(path: &std::path::Path) -> String {
    let ffprobe_path = get_ffprobe_path();
    let mut cmd = std::process::Command::new(ffprobe_path);
    let clean_path = crate::store::clean_unc_path(path.to_str().unwrap_or_default());
    cmd.args([
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name",
        "-of", "default=noprint_wrappers=1:nokey=1",
        &clean_path,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    if let Ok(output) = cmd.output() {
        let codec = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !codec.is_empty() {
            return codec;
        }
    }
    "h264".to_string()
}

pub fn probe_video_start_time(path: &std::path::Path) -> f64 {
    let ffprobe_path = get_ffprobe_path();
    let mut cmd = std::process::Command::new(ffprobe_path);
    let clean_path = crate::store::clean_unc_path(path.to_str().unwrap_or_default());
    cmd.args([
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=start_time",
        "-of", "default=noprint_wrappers=1:nokey=1",
        &clean_path,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    if let Ok(output) = cmd.output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Ok(start) = stdout.trim().parse::<f64>() {
            return start;
        }
    }
    0.0
}


pub fn get_bg_image_path() -> PathBuf {
    // 1. Check relative to current executable parent directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let path = exe_dir.join("bg.jpg");
            if path.exists() {
                return path;
            }
            // Traverse parent directories to support dev build locations
            let mut parent = exe_dir.parent();
            while let Some(p) = parent {
                let path = p.join("bg.jpg");
                if path.exists() {
                    return path;
                }
                parent = p.parent();
            }
        }
    }
    // 2. Check relative to current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let path = cwd.join("bg.jpg");
        if path.exists() {
            return path;
        }
    }
    // 3. Fallback to "./bg.jpg" relative to CWD
    PathBuf::from("bg.jpg")
}


#[allow(dead_code)]
fn compute_contain_dimensions(wi: u32, hi: u32, box_w: u32, box_h: u32) -> (u32, u32) {
    if wi == 0 || hi == 0 || box_w == 0 || box_h == 0 {
        return (box_w, box_h);
    }
    let aspect_in = wi as f64 / hi as f64;
    let aspect_box = box_w as f64 / box_h as f64;
    let (w, h) = if aspect_in > aspect_box {
        // Limited by width
        let w = box_w;
        let h = (box_w as f64 / aspect_in).round() as u32;
        (w, h)
    } else {
        // Limited by height
        let h = box_h;
        let w = (box_h as f64 * aspect_in).round() as u32;
        (w, h)
    };
    // Ensure even dimensions for YUV compatibility
    let w_even = ((w + 1) / 2) * 2;
    let h_even = ((h + 1) / 2) * 2;
    (w_even.max(2), h_even.max(2))
}

fn compute_cover_dimensions(wi: u32, hi: u32, box_w: u32, box_h: u32) -> (u32, u32) {
    if wi == 0 || hi == 0 || box_w == 0 || box_h == 0 {
        return (box_w, box_h);
    }
    let aspect_in = wi as f64 / hi as f64;
    let aspect_box = box_w as f64 / box_h as f64;
    let (w, h) = if aspect_in > aspect_box {
        // Limited by height (aspect_in is wider than aspect_box, so to cover we scale height to box_h and width will be larger than box_w)
        let h = box_h;
        let w = (box_h as f64 * aspect_in).round() as u32;
        (w, h)
    } else {
        // Limited by width
        let w = box_w;
        let h = (box_w as f64 / aspect_in).round() as u32;
        (w, h)
    };
    // Ensure even dimensions for YUV compatibility
    let w_even = ((w + 1) / 2) * 2;
    let h_even = ((h + 1) / 2) * 2;
    (w_even.max(2), h_even.max(2))
}

fn calculate_cuvid_crop(wi: u32, hi: u32, target_w: u32, target_h: u32) -> Option<String> {
    let aspect_in = wi as f64 / hi as f64;
    let aspect_target = target_w as f64 / target_h as f64;

    let (crop_top, crop_bottom, crop_left, crop_right) = if aspect_in > aspect_target {
        // Input is wider than target. Crop left/right.
        let w_target = (hi as f64 * aspect_target).round() as u32;
        let crop_total = if wi > w_target { wi - w_target } else { 0 };
        let crop_left = crop_total / 2;
        let crop_right = crop_total - crop_left;
        (0, 0, crop_left, crop_right)
    } else {
        // Input is taller than target. Crop top/bottom.
        let h_target = (wi as f64 / aspect_target).round() as u32;
        let crop_total = if hi > h_target { hi - h_target } else { 0 };
        let crop_top = crop_total / 2;
        let crop_bottom = crop_total - crop_top;
        (crop_top, crop_bottom, 0, 0)
    };

    if crop_top > 0 || crop_bottom > 0 || crop_left > 0 || crop_right > 0 {
        // Force alignment to even values to prevent UV plane misalignment errors in FFmpeg/NVDEC
        let ct = (crop_top / 2) * 2;
        let cb = (crop_bottom / 2) * 2;
        let cl = (crop_left / 2) * 2;
        let cr = (crop_right / 2) * 2;
        Some(format!("{}x{}x{}x{}", ct, cb, cl, cr))
    } else {
        None
    }
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
        "ull".to_string(),
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

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }

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
    pub bottom_bar_color: Option<String>,
}

static _CUDA_SUPPORTED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
static _CUVID_DECODERS_SUPPORTED: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, bool>>> = std::sync::OnceLock::new();

pub fn is_cuda_supported() -> bool {
    *_CUDA_SUPPORTED.get_or_init(|| {
        let mut test_cmd = std::process::Command::new(get_ffmpeg_path());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            test_cmd.creation_flags(0x08000000);
        }
        test_cmd.args([
            "-y",
            "-hwaccel", "cuda",
            "-f", "lavfi",
            "-i", "color=c=black:s=256x256:d=0.01",
            "-c:v", "h264_nvenc",
            "-f", "null",
            "-"
        ]);
        test_cmd.stdin(std::process::Stdio::null());
        test_cmd.stdout(std::process::Stdio::null());
        test_cmd.stderr(std::process::Stdio::null());
        
        match test_cmd.output() {
            Ok(output) => {
                let success = output.status.success();
                tracing::info!("[FFmpeg CUDA Check] CUDA + NVENC supported check result: {}", success);
                success
            }
            Err(e) => {
                tracing::warn!("[FFmpeg CUDA Check] Failed to run check command: {}", e);
                false
            }
        }
    })
}

pub fn is_cuvid_decoder_supported(_decoder: &str) -> bool {
    // Disable legacy CUVID decoders entirely.
    // They are prone to frame-rate/PTS jitter and stuttering issues on VFR/YouTube videos,
    // and modern `-hwaccel cuda` is 2x faster.
    false
}

pub fn estimate_font_size(text: &str, canvas_w: u32, max_size: u32) -> u32 {
    let mut total_em = 0.0;
    for c in text.chars() {
        let w = match c {
            'a' | 'c' | 'e' | 'k' | 's' | 'v' | 'x' | 'y' => 0.76367,
            'b' | 'd' | 'g' | 'h' | 'n' | 'o' | 'p' | 'q' | 'u' => 0.83919,
            'f' | 't' => 0.45703,
            'i' | 'j' | 'l' => 0.38151,
            'm' => 1.22135,
            'r' => 0.53450,
            'w' => 1.06836,
            'z' => 0.68685,
            'A' | 'B' | 'C' | 'D' | 'H' | 'K' | 'N' | 'R' | 'U' => 0.99154,
            'E' | 'P' | 'S' | 'V' | 'X' | 'Y' => 0.91602,
            'F' | 'L' | 'T' | 'Z' => 0.83919,
            'G' | 'O' | 'Q' => 1.06836,
            'I' => 0.38151,
            'J' => 0.76367,
            'M' => 1.14388,
            'W' => 1.29622,
            '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '_' => 0.76367,
            ' ' => 0.33,
            '-' | '[' | ']' | ';' | ':' => 0.45703,
            '+' | '=' | '<' | '>' => 0.80208,
            '{' | '}' => 0.53450,
            '|' => 0.38411,
            '\'' => 0.32682,
            ',' | '.' | '/' => 0.38151,
            '?' => 0.83919,
            _ => 0.75, // Default for other/Unicode chars
        };
        total_em += w;
    }
    let target_w = canvas_w as f64 * 0.95;
    let mut font_size = (target_w / (total_em + 0.44444)) as u32;
    if font_size >= max_size {
        return max_size;
    }
    font_size = (font_size / 2) * 2;
    font_size.max(8)
}

pub fn escape_ffmpeg_drawtext(text: &str) -> String {
    let mut escaped = String::new();
    for c in text.chars() {
        match c {
            ':' => escaped.push_str("\\:"),
            '\'' => escaped.push_str("'\\''"),
            '\\' => escaped.push_str("\\\\"),
            ',' => escaped.push_str("\\,"),
            '%' => escaped.push_str("\\%"),
            _ => escaped.push(c),
        }
    }
    escaped
}

fn pre_composite_background(
    ffmpeg_path: &str,
    temp_dir: &std::path::Path,
    workspace_id: &str,
    canvas_w: u32,
    canvas_h: u32,
    header_h: u32,
    bottom_bar_h: u32,
    use_real_assets: bool,
    filter_chain: FilterChain,
    thumbnail_path: &std::path::Path,
    text: &str,
    color_hex: &str,
) -> Result<PathBuf> {
    if use_real_assets {
        let composite_bg_path = temp_dir.join(format!("{}_composite_bg.png", workspace_id));
        let cache_meta_path = temp_dir.join(format!("{}_composite_bg.json", workspace_id));

        // Get background image modification time
        let bg_image_path = get_bg_image_path();
        let bg_modified = bg_image_path.metadata()
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs())
            .unwrap_or(0);

        // Get thumbnail image modification time
        let thumb_modified = thumbnail_path.metadata()
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs())
            .unwrap_or(0);

        // Check cache hit
        let mut cache_hit = false;
        if composite_bg_path.exists() && cache_meta_path.exists() {
            if let Ok(meta_str) = std::fs::read_to_string(&cache_meta_path) {
                if let Ok(meta_json) = serde_json::from_str::<serde_json::Value>(&meta_str) {
                    if meta_json["text"].as_str() == Some(text)
                        && meta_json["color"].as_str() == Some(color_hex)
                        && meta_json["canvas_w"].as_u64() == Some(canvas_w as u64)
                        && meta_json["canvas_h"].as_u64() == Some(canvas_h as u64)
                        && meta_json["header_h"].as_u64() == Some(header_h as u64)
                        && meta_json["bottom_bar_h"].as_u64() == Some(bottom_bar_h as u64)
                        && meta_json["bg_modified"].as_u64() == Some(bg_modified)
                        && meta_json["thumb_modified"].as_u64() == Some(thumb_modified)
                    {
                        cache_hit = true;
                        tracing::info!("[AppState] Composite background cache HIT for workspace {}", workspace_id);
                    }
                }
            }
        }

        if cache_hit {
            return Ok(composite_bg_path);
        }

        // Cache miss: Generate composite background
        tracing::info!("[AppState] Composite background cache MISS. Generating via single FFmpeg run...");
        std::fs::remove_file(&composite_bg_path).ok();
        std::fs::remove_file(&cache_meta_path).ok();

        // Calculate font size
        let max_font_size = std::cmp::max(36, (bottom_bar_h as f64 * 0.35).round() as u32);
        let font_size = estimate_font_size(text, canvas_w, max_font_size);

        // Escape text for drawtext
        let escaped_text = escape_ffmpeg_drawtext(text);

        // Font file path escaping (FFmpeg expects colons to be escaped like C\:/Windows/Fonts/arialbd.ttf)
        let font_path = "C\\:/Windows/Fonts/arialbd.ttf";

        let mut cmd = std::process::Command::new(ffmpeg_path);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        cmd.args(["-hide_banner", "-y"]);
        
        let clean_thumb = crate::store::clean_unc_path(thumbnail_path.to_str().unwrap_or_default());
        cmd.args(["-i", &clean_thumb]);

        let has_bg_image = bg_image_path.exists();
        if has_bg_image {
            let clean_bg = crate::store::clean_unc_path(bg_image_path.to_str().unwrap_or_default());
            cmd.args(["-i", &clean_bg]);
        }

        let bottom_bar_y = canvas_h - bottom_bar_h;

        // Build filter complex
        let filter_complex = if has_bg_image {
            format!(
                "[1:v]scale={w}:{bb_h}[bar_bg]; \
                 [bar_bg]drawtext=fontfile='{font}':text='{txt}':fontcolor=white:fontsize={size}:x=(w-text_w)/2:y=(h-text_h)/2[bar]; \
                 [0:v]scale=32:18:flags=bilinear,scale={w}:{h}:flags=bilinear[blur]; \
                 [0:v]scale={w}:{hd_h}:force_original_aspect_ratio=increase,crop={w}:{hd_h}:(ow-iw)/2:(oh-ih)/2,setsar=1[hd]; \
                 [blur][hd]overlay=x=0:y=0[v1]; \
                 [v1][bar]overlay=x=0:y={bb_y},format=nv12[final]",
                w = canvas_w,
                h = canvas_h,
                bb_h = bottom_bar_h,
                font = font_path,
                txt = escaped_text,
                size = font_size,
                hd_h = header_h,
                bb_y = bottom_bar_y
            )
        } else {
            format!(
                "color=c={color}:s={w}x{bb_h}:d=1[bar_bg]; \
                 [bar_bg]drawtext=fontfile='{font}':text='{txt}':fontcolor=white:fontsize={size}:x=(w-text_w)/2:y=(h-text_h)/2[bar]; \
                 [0:v]scale=32:18:flags=bilinear,scale={w}:{h}:flags=bilinear[blur]; \
                 [0:v]scale={w}:{hd_h}:force_original_aspect_ratio=increase,crop={w}:{hd_h}:(ow-iw)/2:(oh-ih)/2,setsar=1[hd]; \
                 [blur][hd]overlay=x=0:y=0[v1]; \
                 [v1][bar]overlay=x=0:y={bb_y},format=nv12[final]",
                color = color_hex.replace("#", "0x"),
                w = canvas_w,
                h = canvas_h,
                bb_h = bottom_bar_h,
                font = font_path,
                txt = escaped_text,
                size = font_size,
                hd_h = header_h,
                bb_y = bottom_bar_y
            )
        };

        cmd.args(["-filter_complex", &filter_complex]);
        cmd.args(["-map", "[final]"]);
        cmd.args(["-vframes", "1"]);

        let clean_out = crate::store::clean_unc_path(composite_bg_path.to_str().unwrap_or_default());
        cmd.arg(&clean_out);

        let mut child = cmd.spawn().map_err(|e| HyperclipError::FFmpegNotFound(e.to_string()))?;
        let status = child.wait().map_err(HyperclipError::Io)?;
        if !status.success() {
            return Err(HyperclipError::BackendCrashed("Pre-compositing background failed".to_string()));
        }

        // Save cache metadata sidecar
        let meta_json = serde_json::json!({
            "text": text,
            "color": color_hex,
            "canvas_w": canvas_w,
            "canvas_h": canvas_h,
            "header_h": header_h,
            "bottom_bar_h": bottom_bar_h,
            "bg_modified": bg_modified,
            "thumb_modified": thumb_modified,
        });
        if let Ok(meta_str) = serde_json::to_string(&meta_json) {
            std::fs::write(&cache_meta_path, meta_str).ok();
        }

        return Ok(composite_bg_path);
    }

    let composite_bg_path = temp_dir.join(format!("{}_composite_bg.png", workspace_id));
    std::fs::remove_file(&composite_bg_path).ok();
    
    let mut cmd = std::process::Command::new(ffmpeg_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    
    cmd.args(["-hide_banner", "-y"]);
    
    let bg_color = "0x2d2d2d";
    let bb_color = "0x1a1a1a";
    let hd_color = "0x0d0d0d";

    match filter_chain {
        FilterChain::Short => {
            cmd.args([
                "-f", "lavfi", "-i", &format!("color=c={}:s={}x{}:d=0.04", bg_color, canvas_w, canvas_h),
                "-f", "lavfi", "-i", &format!("color=c={}:s={}x{}:d=0.04", hd_color, canvas_w, header_h),
                "-f", "lavfi", "-i", &format!("color=c={}:s={}x{}:d=0.04", bb_color, canvas_w, bottom_bar_h),
                "-filter_complex",
                &format!(
                    "[0:v][1:v]overlay=x=0:y=0[v1]; \
                     [v1][2:v]overlay=x=0:y={bb_y},format=nv12[final]",
                    bb_y = canvas_h - bottom_bar_h
                ),
                "-map", "[final]",
                "-vframes", "1",
            ]);
        }
        FilterChain::Landscape => {
            cmd.args([
                "-f", "lavfi", "-i", &format!("color=c={}:s={}x{}:d=0.04", bg_color, canvas_w, canvas_h),
                "-f", "lavfi", "-i", &format!("color=c={}:s={}x{}:d=0.04", hd_color, canvas_w, header_h),
                "-filter_complex",
                "[0:v][1:v]overlay=x=0:y=0,format=nv12[final]",
                "-map", "[final]",
                "-vframes", "1",
            ]);
        }
    }
    
    let clean_out = crate::store::clean_unc_path(composite_bg_path.to_str().unwrap_or_default());
    cmd.arg(&clean_out);
    
    let mut child = cmd.spawn().map_err(|e| HyperclipError::FFmpegNotFound(e.to_string()))?;
    let status = child.wait().map_err(HyperclipError::Io)?;
    if !status.success() {
        return Err(HyperclipError::BackendCrashed("Pre-compositing background failed".to_string()));
    }
    
    Ok(composite_bg_path)
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
    // Round to next multiple of 8 to avoid NVENC green bar/alignment issues
    canvas_w = ((canvas_w + 7) / 8) * 8;
    canvas_h = ((canvas_h + 7) / 8) * 8;

    let (header_h, bottom_bar_h) = match opts.filter_chain {
        FilterChain::Short => (canvas_h * 3 / 10, canvas_h * 3 / 10),
        FilterChain::Landscape => (canvas_h / 5, 0),
    };
    let _video_h = canvas_h - header_h - bottom_bar_h;

    // Prepare real assets for Short Mode overlays if workspace database is present
    let mut use_real_assets = false;
    let mut temp_dir = std::env::temp_dir();
    let mut thumbnail_path = PathBuf::new();
    let mut text_title = String::new();
    let mut color_hex = String::new();
    let mut fallback_thumb_file: Option<PathBuf> = None;

    if matches!(opts.filter_chain, FilterChain::Short) {
        let ws_path = crate::store::get_workspaces_path();
        if ws_path.exists() {
            let store = crate::store::WorkspaceStore::load(&ws_path);
            if let Some(workspace) = store.workspaces.iter().find(|w| w.id == opts.workspace_id) {
                let channel_id = &workspace.channel_id;
                let channel_name = workspace.channel_name.as_deref().unwrap_or("");
                temp_dir = crate::store::render_temp_dir(channel_id, channel_name);

                let mut resolved_thumb = workspace
                    .thumbnail_local
                    .as_ref()
                    .map(PathBuf::from)
                    .unwrap_or_default();

                if !resolved_thumb.exists() {
                    // Extract thumbnail from the video itself
                    let extracted_path = temp_dir.join(format!("{}_thumb_fallback.jpg", opts.workspace_id));
                    std::fs::remove_file(&extracted_path).ok();
                    tracing::info!("[AppState] Thumbnail not found. Extracting to {:?}", extracted_path);
                    let mut extract_cmd = std::process::Command::new(get_ffmpeg_path());
                    let clean_in_path = crate::store::clean_unc_path(opts.input_path.to_str().unwrap());
                    let clean_ext_path = crate::store::clean_unc_path(extracted_path.to_str().unwrap());
                    extract_cmd.args([
                        "-hide_banner", "-y",
                        "-i", &clean_in_path,
                        "-vframes", "1",
                        "-vf", "scale=1280:-2",
                        "-q:v", "2",
                        "-update", "1",
                        &clean_ext_path
                    ]);
                    extract_cmd.stdin(std::process::Stdio::null());
                    extract_cmd.stdout(std::process::Stdio::null());
                    extract_cmd.stderr(std::process::Stdio::null());
                    #[cfg(target_os = "windows")]
                    {
                        extract_cmd.creation_flags(0x08000000);
                    }
                    if let Ok(mut child) = extract_cmd.spawn() {
                        let _ = child.wait();
                    }
                    resolved_thumb = extracted_path.clone();
                    fallback_thumb_file = Some(extracted_path);
                }

                if resolved_thumb.exists() {
                    thumbnail_path = resolved_thumb;
                    
                    let col_hex = opts.bottom_bar_color.as_deref()
                        .filter(|s| !s.is_empty())
                        .unwrap_or("#00B4FF");
                    color_hex = col_hex.to_string();

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
                    text_title = template
                        .replace("{title}", workspace_title)
                        .replace("{channel}", channel_name)
                        .replace("{video_id}", &workspace.video_id);

                    use_real_assets = true;
                }
            }
        }
    }

    let mut use_cuda = matches!(opts.gpu_tier, GPUTier::High | GPUTier::Mid | GPUTier::Low);
    if use_cuda && !is_cuda_supported() {
        tracing::warn!("[FFmpeg Render] CUDA/NVENC hardware acceleration is not supported or accessible on this system. Falling back to CPU/Software encoding.");
        use_cuda = false;
    }

    let mut cuvid_decoder: Option<String> = None;
    let crop_val: Option<String> = None;
    let decoder_cropped = false;

    let video_start_time = if use_cuda { 0.0 } else { probe_video_start_time(&opts.input_path) };
    let adjusted_trim_start = f64::max(video_start_time, opts.trim_start);
    let adjusted_trim_duration = if opts.trim_end > adjusted_trim_start {
        opts.trim_end - adjusted_trim_start
    } else {
        0.0
    };

    // 1. Build video filter chain
    let fps = if opts.fps == 0 { 30 } else { opts.fps };
    let (wi, hi) = probe_video_dimensions(&opts.input_path).unwrap_or((canvas_w, canvas_h));

    if use_cuda {
        let input_codec = probe_video_codec(&opts.input_path);
        let dec = match input_codec.as_str() {
            "h264" => Some("h264_cuvid"),
            "hevc" | "h265" => Some("hevc_cuvid"),
            "vp9" => Some("vp9_cuvid"),
            "av1" => Some("av1_cuvid"),
            _ => None,
        };
        if let Some(d) = dec {
            if is_cuvid_decoder_supported(d) {
                cuvid_decoder = Some(d.to_string());
                // Short mode now uses Aspect Fit (contain), so we do not crop at the decoder level.
            }
        }
    }

    let decode_on_cpu = use_cuda;

    let video_filter = if use_cuda {
        match opts.filter_chain {
            FilterChain::Short => {
                build_short_filter_cuda(adjusted_trim_start, adjusted_trim_duration, speed, canvas_w, canvas_h, header_h, bottom_bar_h, fps, wi, hi, decoder_cropped, decode_on_cpu)
            }
            FilterChain::Landscape => {
                build_landscape_filter_cuda(adjusted_trim_start, adjusted_trim_duration, speed, canvas_w, canvas_h, header_h, fps)
            }
        }
    } else {
        match opts.filter_chain {
            FilterChain::Short => {
                build_short_filter(adjusted_trim_start, adjusted_trim_duration, speed, canvas_w, canvas_h, header_h, bottom_bar_h, false, fps, wi, hi)
            }
            FilterChain::Landscape => {
                let video_h = canvas_h - header_h;
                build_landscape_filter(adjusted_trim_start, adjusted_trim_duration, speed, canvas_w, canvas_h, video_h, header_h, false, fps)
            }
        }
    };

    // 2. Build audio filter chain (trim + speed)
    let audio_filter = build_audio_chain(adjusted_trim_start, adjusted_trim_duration, speed);

    // 3. Combine filter complex + determine mappings
    let complete_filter: String;
    let audio_map: &str;
    if !audio_filter.is_empty() {
        complete_filter = format!("{}; {}", video_filter, audio_filter);
        audio_map = "[a]";
    } else {
        complete_filter = video_filter.to_string();
        audio_map = "0:a?";  // auto-map best audio stream (optional — ? = skip if no audio)
    }

    // 4. Encode params
    let codec = if use_cuda {
        match opts.gpu_tier {
            GPUTier::High => "hevc_nvenc",
            GPUTier::Mid | GPUTier::Low => "h264_nvenc",
            _ => "libx264",
        }
    } else {
        "libx264"
    };
    let crf = if opts.chunked { 20 } else { 18 };
    let maxrate = match opts.resolution.as_str() {
        "1080p" | "1440p" | "2160p" => "12M",
        "720p" => "6M",
        _ => "3M",
    };
    let bufsize = maxrate;

    let total_duration = adjusted_trim_duration / speed;
    let total_duration_str = format!("{:.2}", total_duration.max(1.0));

    let mut cmd = TokioCommand::new(get_ffmpeg_path());
    cmd.kill_on_drop(true);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let mut args: Vec<String> = vec![
        "-hide_banner".into(), "-y".into(),
    ];

    if use_cuda {
        args.extend_from_slice(&[
            "-init_hw_device".into(), "cuda=cuda".into(),
            "-filter_hw_device".into(), "cuda".into(),
            "-hwaccel".into(), "cuda".into(),
        ]);
        
        if !decode_on_cpu {
            args.extend_from_slice(&[
                "-hwaccel_output_format".into(), "cuda".into(),
            ]);
            
            if let Some(dec) = &cuvid_decoder {
                args.extend_from_slice(&["-c:v".into(), dec.clone()]);
                if let Some(crop_str) = &crop_val {
                    args.extend_from_slice(&["-crop".into(), crop_str.clone()]);
                }
            }
        }
    }

    // Input [0]: source video
    let clean_in_path = crate::store::clean_unc_path(opts.input_path.to_str().unwrap());
    args.extend_from_slice(&["-i".into(), clean_in_path]);

    let fps_str = fps.to_string();

    let composite_bg_file = match pre_composite_background(
        &get_ffmpeg_path(),
        &temp_dir,
        &opts.workspace_id,
        canvas_w,
        canvas_h,
        header_h,
        bottom_bar_h,
        use_real_assets,
        opts.filter_chain,
        &thumbnail_path,
        &text_title,
        &color_hex,
    ) {
        Ok(path) => path,
        Err(e) => {
            if let Some(ref fallback_thumb) = fallback_thumb_file {
                if fallback_thumb.exists() { let _ = std::fs::remove_file(fallback_thumb); }
            }
            return Err(e);
        }
    };

    let clean_composite = crate::store::clean_unc_path(composite_bg_file.to_str().unwrap_or_default());
    args.extend_from_slice(&[
        "-framerate".into(), fps_str.clone(), "-i".into(), clean_composite,
    ]);
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
            "-rc:v".into(), "vbr".into(),
            "-cq".into(), crf.to_string(),
            "-tune".into(), "ull".into(),
            "-g".into(), "30".into(),
            "-maxrate".into(), maxrate.to_string(),
            "-bufsize".into(), bufsize.to_string(),
            "-multipass".into(), "disabled".into(),
        ]);
    } else {
        // CPU fallback (libx264)
        let available_threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let ffmpeg_threads = std::cmp::max(2, available_threads / 2).to_string();

        args.extend_from_slice(&[
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "veryfast".into(),
            "-crf".into(), "23".into(),
            "-pix_fmt".into(), "yuv420p".into(),
            "-threads".into(), ffmpeg_threads,
        ]);
    }

    if !audio_filter.is_empty() {
        args.extend_from_slice(&[
            "-c:a".into(), "aac".into(),
            "-b:a".into(), "192k".into(),
        ]);
    } else {
        args.extend_from_slice(&[
            "-c:a".into(), "copy".into(),
        ]);
    }

    // Force CFR (Constant Frame Rate) output at the encoder level
    args.extend_from_slice(&[
        "-r".into(), fps_str.clone(),
    ]);

    let clean_out_path = crate::store::clean_unc_path(opts.output_path.to_str().unwrap());
    args.push(clean_out_path);

    cmd.args(&args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());

    tracing::info!("Spawning FFmpeg: {} {}", get_ffmpeg_path(), args.join(" "));

    let mut child = cmd.spawn().map_err(|e| {
        // Cleanup intermediate overlay files on spawn failure
        if let Some(ref fallback_thumb) = fallback_thumb_file {
            if fallback_thumb.exists() { let _ = std::fs::remove_file(fallback_thumb); }
        }
        if composite_bg_file.exists() { let _ = std::fs::remove_file(&composite_bg_file); }
        HyperclipError::FFmpegNotFound(e.to_string())
    })?;
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
                    let trimmed = line.trim();
                    if trimmed.contains("speed=") || trimmed.contains("frame=") {
                        tracing::info!("[FFmpeg progress] {}", trimmed);
                    }
                    if let Some(p) = parse_ffmpeg_stderr(trimmed, total_duration) {
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

    let status = child.wait().await.map_err(|e| {
        // Cleanup intermediate overlay files on wait failure
        if let Some(ref fallback_thumb) = fallback_thumb_file {
            if fallback_thumb.exists() { let _ = std::fs::remove_file(fallback_thumb); }
        }
        if composite_bg_file.exists() { let _ = std::fs::remove_file(&composite_bg_file); }
        HyperclipError::Io(e)
    })?;

    // Cleanup intermediate overlay files after child wait completes
    if composite_bg_file.exists() { let _ = std::fs::remove_file(&composite_bg_file); }

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
    if let Some((w_str, h_str)) = res.split_once('x') {
        if let (Ok(w), Ok(h)) = (w_str.parse::<u32>(), h_str.parse::<u32>()) {
            return (w, h);
        }
    }
    match res {
        "2160p" => (3840, 2160),
        "1440p" => (2560, 1440),
        "1080p" => (1920, 1080),
        "720p" => (1280, 720),
        "480p" => (854, 480),
        "360p" => (640, 360),
        _ => (1920, 1080),
    }
}
