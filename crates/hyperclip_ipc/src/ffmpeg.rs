// crates/hyperclip_ipc/src/ffmpeg.rs
// FFmpeg filter chain + NVENC params — ported from electron/services/ffmpeg.ts

use serde::{Deserialize, Serialize};

// ─── Filter Chain constants — EXACT from ffmpeg.ts ───────────────────────────────

/// SHORT mode: header(20%) | video(70%) | bottom bar(10%)
/// Filter: fps=30 → setpts=PTS-STARTPTS → trim → scale → crop
/// NO select='not(mod(n,2))' — causes 2x frame halving
/// NO -r 30 output flag — conflicts with filter chain
pub fn build_short_filter_chain(
    trim_start: f64,
    trim_end: f64,
    canvas_w: u32,
    canvas_h: u32,
    header_h: u32,
    bottom_bar_h: u32,
    video_h: u32,
    video_top: u32,
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

/// Build filter complex for SHORT (9:16) layout
/// Z-order: bg(bottom) → video(middle) → bottom_bar → header(top)
pub fn build_short_filter(
    trim_start: f64,
    trim_duration: f64,
    canvas_w: u32,
    canvas_h: u32,
    header_h: u32,
    bottom_bar_h: u32,
    use_cuda: bool,
) -> String {
    let scale = if use_cuda { "scale_cuda" } else { "scale" };
    let overlay = if use_cuda { "overlay_cuda" } else { "overlay" };
    let scale_flags = if use_cuda { "" } else { ":flags=lanczos" };

    let video_h = canvas_h - header_h - bottom_bar_h;
    let video_top = header_h;
    let scaled_w = ((video_h as f64) * 16.0 / 9.0).round() as u32;
    let crop_x = ((scaled_w - canvas_w) / 2).max(0);

    // Video chain: fps → setpts → trim → setpts → scale → crop
    let trim_tag = if trim_start > 0.0 || trim_duration > 0.0 {
        let end = if trim_duration > 0.0 { trim_start + trim_duration } else { 999.0 };
        format!(
            "trim=start={}:end={},setpts=PTS-STARTPTS,",
            trim_start, end
        )
    } else {
        String::new()
    };
    let video_chain = format!(
        "[0:v]fps=30,{},setpts=PTS-STARTPTS,{}scale=-2:{},{}crop={}:{}:{}:0[vid]",
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
        "[1:v]{}={}:{}:force_original_aspect_ratio=increase,crop={}:{}:(ow-iw)/2:(oh-ih)/2,setsar=1[bg]",
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

    // Bottom bar at bottom
    let bb_y = canvas_h - bottom_bar_h;
    let bb_chain = format!(
        "[2:v]{}={}:{}:force_original_aspect_ratio=increase,crop={}:{}:(ow-iw)/2:(oh-ih)/2[bb]",
        scale,
        canvas_w,
        bottom_bar_h,
        canvas_w,
        bottom_bar_h
    );
    let vb_chain = format!(
        "[vz][bb]{}=0:{} [vb]",
        overlay,
        bb_y
    );

    // Header at top
    let hd_chain = format!(
        "[3:v]{}={}:{}:force_original_aspect_ratio=increase,crop={}:{}:(ow-iw)/2:(oh-ih)/2[hd]",
        scale,
        canvas_w,
        header_h,
        canvas_w,
        header_h
    );
    let final_chain = format!(
        "[vb][hd]{}=0:0 [final]",
        overlay
    );

    format!(
        "{}; {}; {}; {}; {}; {}; {}",
        video_chain, bg_chain, vz_chain, bb_chain, vb_chain, hd_chain, final_chain
    )
}

/// Build filter complex for LANDSCAPE layout
pub fn build_landscape_filter(
    trim_start: f64,
    trim_duration: f64,
    canvas_w: u32,
    canvas_h: u32,
    video_h: u32,
    video_top: u32,
    use_cuda: bool,
) -> String {
    let scale = if use_cuda { "scale_cuda" } else { "scale" };
    let overlay = if use_cuda { "overlay_cuda" } else { "overlay" };
    let scale_flags = if use_cuda { "" } else { ":flags=lanczos" };

    let crop_x_num = ((video_h as f64 * 16.0 / 9.0) - (canvas_w as f64)).round() as i32 / 2;

    let trim_tag = if trim_start > 0.0 || trim_duration > 0.0 {
        let end = if trim_duration > 0.0 { trim_start + trim_duration } else { 999.0 };
        format!(
            "trim=start={}:end={},setpts=PTS-STARTPTS,",
            trim_start, end
        )
    } else {
        String::new()
    };

    let video_chain = if crop_x_num >= 0 {
        format!(
            "[0:v]fps=30,{},setpts=PTS-STARTPTS,{}scale=-2:{},{}crop={}:{}:{}:0[vid]",
            trim_tag,
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
            "[0:v]fps=30,{},setpts=PTS-STARTPTS,{}scale={}:-2{} ,crop={}:{}:0:{} [vid]",
            trim_tag,
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
    format!(
        "{}; {}; [bg][vid]{}=0:{} [vz]",
        video_chain, bg_chain, overlay, video_top
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

/// Get ffmpeg binary path (Windows: resolve backslash → forward slash for shell)
pub fn get_ffmpeg_path() -> String {
    let candidates = [
        "C:/Users/MSI/scoop/shims/ffmpeg.exe",
        "C:/Users/MSI/AppData/Local/Programs/scoop/shims/ffmpeg.exe",
        "ffmpeg",
    ];
    for p in &candidates {
        if std::path::Path::new(p).exists() {
            return p.replace('\\', "/");
        }
    }
    candidates.last().unwrap().replace('\\', "/")
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
    maxrate: &str,
    bufsize: &str,
    progress_callback: impl Fn(f64) + Send + 'static,
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
