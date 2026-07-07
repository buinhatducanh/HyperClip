// crates/hyperclip_ipc/src/youtube.rs
// yt-dlp spawn — ported from electron/services/youtube.ts
// Async streaming with progress emission + ffprobe metadata

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::download_progress::{parse_ytdlp_stderr, DownloadProgress};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YtdlpVideoInfo {
    pub id: String,
    pub title: String,
    pub thumbnail: String,
    pub duration: f64,
    pub channel_name: String,
    pub channel_id: String,
    pub upload_date: String,
    pub file_size: u64,
    pub resolution: String,
}

pub fn get_youtube_client_priority() -> String {
    let s_path = crate::store::get_settings_path();
    let s_store = crate::store::SettingsStore::load(&s_path);

    if let Some(arr) = s_store.settings.get("ytDlpClientPriority").and_then(|v| v.as_array()) {
        let clients: Vec<String> = arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !clients.is_empty() {
            return clients.join(",");
        }
    }

    if let Some(arr) = s_store.settings.get("yt_dlp_client_priority").and_then(|v| v.as_array()) {
        let clients: Vec<String> = arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !clients.is_empty() {
            return clients.join(",");
        }
    }

    "ios,android,tv_embedded,web".to_string()
}

#[derive(Debug, Clone)]
pub struct DownloadOptions {
    pub url: String,
    pub output_path: PathBuf,
    pub trim_start: String,
    pub trim_end: String,
    pub quality: u32,
    pub client_priority: Vec<String>,
    pub concurrent_fragments: u32,
    pub cookies_file: Option<PathBuf>,
    /// Number of parallel instances for multi-instance download (RAM-aware)
    pub multi_instance: u32,
    /// Enable simulated progress for better UX while yt-dlp is initializing
    pub simulated_progress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DownloadFailureType {
    Permanent,    // Private, deleted, region-locked - mark seen and don't retry
    Retryable,    // Network error, rate limit, timeout - retry with backoff
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResult {
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub codec: String,
    pub fps: f64,
    /// Type of failure if download failed
    pub failure_type: Option<DownloadFailureType>,
    /// Seconds until retry is recommended (for retryable failures)
    pub retry_after_sec: Option<u64>,
}

pub fn build_ytdlp_args(opts: &DownloadOptions) -> Vec<String> {
    let mut args = vec![
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "--newline".to_string(),
        "-f".to_string(),
        format!("bestvideo[height<=?{}]+bestaudio/best[height<=?{}]/best", opts.quality, opts.quality),
        "-o".to_string(),
        opts.output_path.to_string_lossy().to_string(),
        "--concurrent-fragments".to_string(),
        opts.concurrent_fragments.to_string(),
        "--remux-video".to_string(),
        "mp4".to_string(),
        "--force-ipv4".to_string(),
        "--no-check-certificate".to_string(),
    ];
    let clients = opts.client_priority.join(",");
    if !clients.is_empty() {
        args.push("--extractor-args".to_string());
        args.push(format!("youtube:player_client={}", clients));
    }

    // Use bundled Node JS runtime if available to prevent deprecation warning
    args.push("--js-runtimes".to_string());
    args.push(find_node_runtime_arg());

    // Specify bundled ffmpeg location if available
    if let Some(ffmpeg_dir) = find_ffmpeg_bin_dir() {
        args.push("--ffmpeg-location".to_string());
        args.push(ffmpeg_dir);
    }

    if !opts.trim_start.is_empty() || !opts.trim_end.is_empty() {
        let end = if opts.trim_end.is_empty() { "99:00:00" } else { &opts.trim_end };
        args.push("--download-sections".to_string());
        if is_zero_timestamp(&opts.trim_start) {
            args.push(format!("*00:00:00-{}", end));
        } else {
            args.push(format!("*{}-{}", opts.trim_start, end));
        }
    }
    if let Some(cookies) = &opts.cookies_file {
        args.push("--cookies".to_string());
        args.push(cookies.to_string_lossy().to_string());
    }
    args.push(opts.url.clone());
    args
}

/// Emit download progress event via central emit_raw.
/// Called by the progress callback during streaming download.
pub fn emit_download_progress(workspace_id: &str, progress: &DownloadProgress) {
    let event = json!({
        "method": "download:progress-event",
        "params": {
            "workspace_id": workspace_id,
            "percent": progress.percent,
            "speed_mbps": progress.speed_mbps,
            "eta_sec": progress.eta_sec,
        }
    });
    crate::emit_raw(&serde_json::to_string(&event).unwrap_or_default());
}

pub fn get_ytdlp_cache_dir() -> std::path::PathBuf {
    let cache_dir = crate::store::get_data_dir().join(".cache").join("yt-dlp");
    let _ = std::fs::create_dir_all(&cache_dir);
    cache_dir
}

/// Async download with streaming progress via callback.

/// Spawns yt-dlp, reads stderr line-by-line, calls on_progress for each line.
pub fn download_video_streaming<F>(
    url: &str,
    output_path: &str,
    cookies_path: &str,
    trim_minutes: u32,
    actual_duration_sec: Option<u64>,
    quality: u32,
    concurrent_fragments: u32,
    mut on_progress: F,
) -> Result<DownloadResult, String>
where
    F: FnMut(DownloadProgress),
{
    let fmt = if quality <= 360 {
        "18/best[height<=?360]/bestvideo[height<=?360]+bestaudio/best[height<=?360]/worst".to_string()
    } else {
        format!("bestvideo[height<=?{height}]+bestaudio/best[height<=?{height}]/worst", height = quality)
    };
    let clean_out = crate::store::clean_unc_path(output_path);
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());
    let ytdlp = find_ytdlp_path();
    let clients = get_youtube_client_priority();
    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--js-runtimes", &find_node_runtime_arg(),
        "--no-check-certificates",
        "--force-ipv4",
    ]);
    if !clients.is_empty() {
        cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
    }
    cmd.args([
        "--cookies", &clean_cookies,
        "-f", &fmt,
        "--concurrent-fragments", &concurrent_fragments.to_string(),
        "--no-playlist",
        "--no-color",
        "--newline",
        "--remux-video", "mp4",
        "--socket-timeout", "30",
        "--retries", "3",
        "--cache-dir", &clean_cache,
        "-o", &clean_out,
    ]);

    let mut use_download_sections = if let Some(dur) = actual_duration_sec {
        trim_minutes > 0 && (dur == 0 || dur > ((trim_minutes * 60) as u64 + 30))
    } else {
        trim_minutes > 0
    };

    // Optimization: bypass download sections if the entire video is to be downloaded
    if use_download_sections {
        let is_entire_video = actual_duration_sec.map(|dur| dur > 0 && dur <= (trim_minutes * 60) as u64).unwrap_or(false);
        if is_entire_video {
            tracing::info!("[Youtube] Bypassing --download-sections because the entire video is to be downloaded (duration: {:?}s, trim: {}m).", actual_duration_sec, trim_minutes);
            use_download_sections = false;
        }
    }

    if use_download_sections {
        let hours = trim_minutes / 60;
        let mins = trim_minutes % 60;
        let range_str = format!("*00:00:00-{:02}:{:02}:00", hours, mins);
        cmd.args(["--download-sections", &range_str]);
    }

    if let Some(ffmpeg_dir) = find_ffmpeg_bin_dir() {
        cmd.args(["--ffmpeg-location", &ffmpeg_dir]);
    }

    cmd.arg(url)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }

    tracing::info!("[Youtube] Spawning yt-dlp: {:?}", cmd);

    let mut child = cmd.spawn().map_err(|e| format!("yt-dlp spawn failed: {}", e))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let reader = BufReader::new(stdout);

    // Spawn a thread to read stderr to avoid blocking and capture any error messages
    let stderr_handle = std::thread::spawn(move || {
        let mut err_str = String::new();
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while let Ok(n) = reader.read_line(&mut line) {
            if n == 0 {
                break;
            }
            err_str.push_str(&line);
            line.clear();
        }
        err_str
    });

    // Read stdout line by line, parse progress
    for line in reader.lines() {
        let line = line.map_err(|e| format!("stdout read error: {}", e))?;
        if let Some(progress) = parse_ytdlp_stderr(&line) {
            on_progress(progress);
        }
    }

    let status = child.wait().map_err(|e| format!("wait failed: {}", e))?;
    let stderr_output = stderr_handle.join().unwrap_or_else(|_| "Failed to join stderr thread".to_string());

    if !status.success() {
        tracing::error!("yt-dlp failed (exit={:?}). Stderr: {}", status.code(), stderr_output);
        return Err(format!("yt-dlp failed (exit={:?}): {}", status.code(), stderr_output));
    }

    let duration = match maybe_trim_file(output_path, trim_minutes) {
        Ok(dur) => dur,
        Err(e) => {
            tracing::warn!("Local trimming failed: {}", e);
            probe_media_file(output_path).0
        }
    };

    let file_size = std::fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Run ffprobe to get real metadata
    let (_, width, height, codec, fps) = probe_media_file(output_path);

    Ok(DownloadResult {
        path: output_path.to_string(),
        duration,
        width,
        height,
        file_size,
        codec,
        fps,
        failure_type: None,
        retry_after_sec: None,
    })
}

/// ffprobe wrapper — extract duration, resolution, codec, fps from a media file.
pub fn probe_media_file(path: &str) -> (f64, u32, u32, String, f64) {
    let ffprobe = find_ffprobe_path();
    let mut cmd = Command::new(&ffprobe);
    let clean_path = crate::store::clean_unc_path(path);
    cmd.args([
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        &clean_path,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output();

    match output {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&s) {
                let duration = data["format"]["duration"].as_str()
                    .and_then(|d| d.parse::<f64>().ok())
                    .unwrap_or(0.0);

                // Find the first video stream
                let mut width = 0u32;
                let mut height = 0u32;
                let mut codec = "h264".to_string();
                let mut fps = 30.0;

                if let Some(streams) = data["streams"].as_array() {
                    for stream in streams {
                        if stream["codec_type"].as_str() == Some("video") {
                            width = stream["width"].as_u64().unwrap_or(0) as u32;
                            height = stream["height"].as_u64().unwrap_or(0) as u32;
                            codec = stream["codec_name"].as_str().unwrap_or("h264").to_string();

                            // Parse frame rate like "30/1" or "30000/1001"
                            let r_frame_rate = stream["r_frame_rate"].as_str().unwrap_or("30/1");
                            if let Some(slash) = r_frame_rate.find('/') {
                                let num: f64 = r_frame_rate[..slash].parse().unwrap_or(30.0);
                                let den: f64 = r_frame_rate[slash + 1..].parse().unwrap_or(1.0);
                                if den > 0.0 {
                                    fps = num / den;
                                }
                            }
                            break;
                        }
                    }
                }

                return (duration, width, height, codec, fps);
            }
            (0.0, 0, 0, "unknown".into(), 0.0)
        }
        _ => (0.0, 0, 0, "unknown".into(), 0.0),
    }
}

/// Sync download (blocking, no progress streaming) — kept for backward compat.
pub fn download_video(
    url: &str,
    output_path: &str,
    cookies_path: &str,
    trim_minutes: u32,
    actual_duration_sec: Option<u64>,
    quality: u32,
    concurrent_fragments: u32,
) -> Result<DownloadResult, String> {
    let fmt = if quality <= 360 {
        "18/best[height<=?360]/bestvideo[height<=?360]+bestaudio/best[height<=?360]/worst".to_string()
    } else {
        format!("bestvideo[height<=?{height}]+bestaudio/best[height<=?{height}]/worst", height = quality)
    };
    let clean_out = crate::store::clean_unc_path(output_path);
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());
    let ytdlp = find_ytdlp_path();
    let clients = get_youtube_client_priority();
    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--js-runtimes", &find_node_runtime_arg(),
        "--no-check-certificates",
        "--force-ipv4",
    ]);
    if !clients.is_empty() {
        cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
    }
    cmd.args([
        "--cookies", &clean_cookies,
        "-f", &fmt,
        "--concurrent-fragments", &concurrent_fragments.to_string(),
        "--no-playlist",
        "--no-color",
        "--remux-video", "mp4",
        "--socket-timeout", "30",
        "--retries", "3",
        "--cache-dir", &clean_cache,
        "-o", &clean_out,
    ]);

    let mut use_download_sections = if let Some(dur) = actual_duration_sec {
        trim_minutes > 0 && (dur == 0 || dur > ((trim_minutes * 60) as u64 + 30))
    } else {
        trim_minutes > 0
    };

    // Optimization: bypass download sections if the entire video is to be downloaded
    if use_download_sections {
        let is_entire_video = actual_duration_sec.map(|dur| dur <= (trim_minutes * 60) as u64).unwrap_or(false);
        if is_entire_video {
            tracing::info!("[Youtube] Bypassing --download-sections because the entire video is to be downloaded (duration: {:?}s, trim: {}m).", actual_duration_sec, trim_minutes);
            use_download_sections = false;
        }
    }

    if use_download_sections {
        let hours = trim_minutes / 60;
        let mins = trim_minutes % 60;
        let range_str = format!("*00:00:00-{:02}:{:02}:00", hours, mins);
        cmd.args(["--download-sections", &range_str]);
    }

    if let Some(ffmpeg_dir) = find_ffmpeg_bin_dir() {
        cmd.args(["--ffmpeg-location", &ffmpeg_dir]);
    }

    cmd.arg(url)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output().map_err(|e| format!("yt-dlp spawn failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", stderr));
    }

    let duration = match maybe_trim_file(output_path, trim_minutes) {
        Ok(dur) => dur,
        Err(e) => {
            tracing::warn!("Local trimming failed: {}", e);
            parse_duration_from_stderr(&String::from_utf8_lossy(&output.stderr))
        }
    };

    let file_size = std::fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Run ffprobe for real metadata
    let (_, width, height, codec, fps) = probe_media_file(output_path);

    Ok(DownloadResult {
        path: output_path.to_string(),
        duration,
        width,
        height,
        file_size,
        codec,
        fps,
        failure_type: None,
        retry_after_sec: None,
    })
}

/// Probe available formats without downloading
pub fn probe_formats(url: &str, cookies_path: &str) -> Result<Vec<u32>, String> {
    let ytdlp = find_ytdlp_path();
    let node_runtime = find_node_runtime_arg();
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());

    let clients = get_youtube_client_priority();
    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--js-runtimes", &node_runtime,
    ]);
    if !clients.is_empty() {
        cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
    }
    cmd.args([
        "--cookies", &clean_cookies,
        "--dump-json",
        "--no-download",
        "--socket-timeout", "30",
        "--cache-dir", &clean_cache,
        url,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| e.to_string())?;

    let heights: Vec<u32> = data
        .get("formats")
        .and_then(|f| f.as_array())
        .map(|arr| {
            let mut set = std::collections::HashSet::new();
            for f in arr {
                if let Some(h) = f.get("height").and_then(|h| h.as_u64()) {
                    set.insert(h as u32);
                }
            }
            let mut heights: Vec<u32> = set.into_iter().collect();
            heights.sort();
            heights
        })
        .unwrap_or_default();

    Ok(heights)
}

/// Get video info without downloading
pub fn get_video_info(url: &str, cookies_path: &str) -> Result<YtdlpVideoInfo, String> {
    let ytdlp = find_ytdlp_path();
    let node_runtime = find_node_runtime_arg();
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());

    let clients = get_youtube_client_priority();
    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--js-runtimes", &node_runtime,
    ]);
    if !clients.is_empty() {
        cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
    }
    cmd.args([
        "--cookies", &clean_cookies,
        "--dump-json",
        "--no-download",
        "--socket-timeout", "30",
        "--cache-dir", &clean_cache,
        url,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| e.to_string())?;

    Ok(YtdlpVideoInfo {
        id: data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        title: data.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        thumbnail: data.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        duration: data.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
        channel_name: data.get("channel").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        channel_id: data.get("channel_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        upload_date: data.get("upload_date").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        file_size: data.get("filesize").and_then(|v| v.as_u64()).unwrap_or(0),
        resolution: "".to_string(),
    })
}

/// Pre-check video availability before downloading (ported from electron/services/youtube.ts)
/// Returns (available: bool, error_reason: Option<String>, video_info: Option<YtdlpVideoInfo>)
pub fn probe_video_availability(url: &str, cookies_path: &str) -> Result<(bool, Option<String>, Option<YtdlpVideoInfo>), String> {
    let ytdlp = find_ytdlp_path();
    let node_runtime = find_node_runtime_arg();
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());

    let clients = get_youtube_client_priority();
    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--js-runtimes", &node_runtime,
    ]);
    if !clients.is_empty() {
        cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
    }
    cmd.args([
        "--cookies", &clean_cookies,
        "--dump-json",
        "--no-download",
        "--socket-timeout", "30",
        "--cache-dir", &clean_cache,
        url,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output();

    match output {
        Ok(out) if out.status.success() => {
            let json_str = String::from_utf8_lossy(&out.stdout);
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&json_str) {
                // Check for private/deleted/unavailable
                let availability = data.get("availability").and_then(|v| v.as_str()).unwrap_or("public");
                let is_private = data.get("is_private").and_then(|v| v.as_bool()).unwrap_or(false);
                let age_limit = data.get("age_limit").and_then(|v| v.as_u64()).unwrap_or(0);
                let live_status = data.get("live_status").and_then(|v| v.as_str()).unwrap_or("not_live");

                let error_reason = if availability != "public" || is_private {
                    Some(format!("Video unavailable: {}", availability))
                } else if live_status == "is_live" {
                    Some("Live stream not supported".to_string())
                } else if age_limit > 0 {
                    Some("Age-restricted video".to_string())
                } else {
                    None
                };

                let info = YtdlpVideoInfo {
                    id: data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    title: data.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    thumbnail: data.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    duration: data.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    channel_name: data.get("channel").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    channel_id: data.get("channel_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    upload_date: data.get("upload_date").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    file_size: data.get("filesize").and_then(|v| v.as_u64()).unwrap_or(0),
                    resolution: "".to_string(),
                };

                Ok((error_reason.is_none(), error_reason, Some(info)))
            } else {
                Ok((false, Some("Parse failed".to_string()), None))
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            tracing::warn!("[Probe] video unavailable or query failed: {}", stderr);
            Ok((false, Some(format!("Probe failed: {}", stderr)), None))
        }
        Err(e) => {
            tracing::warn!("[Probe] spawn failed: {}", e);
            Ok((false, Some(format!("Spawn failed: {}", e)), None))
        }
    }
}

/// Find ffprobe executable
fn find_ffprobe_path() -> String {
    // 1. Try bundled ffprobe in resources first
    let bundled = crate::store::get_resources_dir().join("ffmpeg/bin/ffprobe.exe");
    if bundled.exists() {
        let path_str = bundled.to_string_lossy().to_string();
        let cleaned = crate::store::clean_unc_path(&path_str);
        return cleaned.replace('\\', "/");
    }

    // 2. Fallback candidates
    let mut candidates = Vec::new();
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        candidates.push(format!("{}/scoop/shims/ffprobe.exe", userprofile.replace('\\', "/")));
    }
    candidates.push("ffprobe".to_string());

    for p in &candidates {
        if std::path::Path::new(p).exists() {
            let cleaned = crate::store::clean_unc_path(p);
            return cleaned.replace('\\', "/");
        }
    }
    "ffprobe".to_string()
}

/// Find yt-dlp executable
pub fn find_ytdlp_path() -> String {
    // 1. Try bundled yt-dlp in resources first
    let bundled = crate::store::get_resources_dir().join("yt-dlp/yt-dlp.exe");
    if bundled.exists() {
        let path_str = bundled.to_string_lossy().to_string();
        return crate::store::clean_unc_path(&path_str);
    }

    // 2. Fallback candidates
    let mut candidates = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        let clean_appdata = appdata.replace('\\', "/");
        candidates.push(format!("{}/Python/Python312/Scripts/yt-dlp.exe", clean_appdata));
        candidates.push(format!("{}/Python/Python313/Scripts/yt-dlp.exe", clean_appdata));
        candidates.push(format!("{}/Python/Python314/Scripts/yt-dlp.exe", clean_appdata));
    }
    candidates.push("yt-dlp".to_string());

    for p in &candidates {
        if std::path::Path::new(p).exists() {
            let cleaned = crate::store::clean_unc_path(p);
            return cleaned;
        }
    }
    "yt-dlp".to_string()
}

/// Resolve the ffmpeg bin directory path to pass to yt-dlp.
fn find_ffmpeg_bin_dir() -> Option<String> {
    let path = crate::ffmpeg::get_ffmpeg_path();
    if path == "ffmpeg" {
        None
    } else {
        let parent = std::path::Path::new(&path).parent()?;
        let path_str = parent.to_string_lossy().to_string();
        let cleaned = crate::store::clean_unc_path(&path_str);
        Some(cleaned.replace('\\', "/"))
    }
}

/// Resolve the bundled Node.js path to pass to yt-dlp as JS runtime.
pub fn find_node_runtime_arg() -> String {
    let bundled = crate::store::get_resources_dir().join("node/node.exe");
    if bundled.exists() {
        let path_str = bundled.to_string_lossy().to_string();
        let cleaned = crate::store::clean_unc_path(&path_str);
        format!("node:{}", cleaned.replace('\\', "/"))
    } else {
        "node".to_string()
    }
}

/// Trims the downloaded file to the limit locally using ffmpeg copy.
fn maybe_trim_file(output_path: &str, trim_minutes: u32) -> Result<f64, String> {
    let (duration, _, _, _, _) = probe_media_file(output_path);
    let limit_sec = (trim_minutes * 60) as f64;

    if trim_minutes > 0 && duration > limit_sec {
        let temp_path = format!("{}.temp", output_path);
        if let Err(e) = std::fs::rename(output_path, &temp_path) {
            return Err(format!("Failed to rename file for trimming: {}", e));
        }

        let ffmpeg = crate::ffmpeg::get_ffmpeg_path();
        let clean_temp = crate::store::clean_unc_path(&temp_path);
        let clean_output = crate::store::clean_unc_path(output_path);

        let mut cmd = Command::new(&ffmpeg);
        cmd.args([
            "-y",
            "-i", &clean_temp,
            "-t", &format!("{}", trim_minutes * 60),
            "-c", "copy",
            &clean_output,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000);
        }

        match cmd.output() {
            Ok(out) if out.status.success() => {
                let _ = std::fs::remove_file(&temp_path);
                Ok(limit_sec)
            }
            Ok(out) => {
                // Restore original file
                let _ = std::fs::rename(&temp_path, output_path);
                let err_msg = String::from_utf8_lossy(&out.stderr);
                Err(format!("FFmpeg trimming failed (exit={:?}): {}", out.status.code(), err_msg))
            }
            Err(e) => {
                // Restore original file
                let _ = std::fs::rename(&temp_path, output_path);
                Err(format!("FFmpeg trim spawn failed: {}", e))
            }
        }
    } else {
        Ok(duration)
    }
}

/// Parse duration from yt-dlp stderr output
fn parse_duration_from_stderr(stderr: &str) -> f64 {
    // Try "Duration: 00:05:30.50" format
    if let Some(pos) = stderr.find("Duration:") {
        let s = &stderr[pos..];
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() >= 3 {
            let h: f64 = parts[0]
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(0.0);
            let m: f64 = parts[1].parse().unwrap_or(0.0);
            let sec_str = parts[2].split_whitespace().next().unwrap_or("0");
            let secs: f64 = sec_str.parse().unwrap_or(0.0);
            return h * 3600.0 + m * 60.0 + secs;
        }
    }
    // Try "[download]   0.5s of ..." format
    if let Some(pos) = stderr.find("[download]") {
        let s = &stderr[pos..];
        if let Some(s2) = s.split_whitespace().find(|w| w.ends_with("s") && w.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)) {
            if let Ok(d) = s2.trim_end_matches('s').parse() {
                return d;
            }
        }
    }
    0.0
}

pub fn is_zero_timestamp(ts: &str) -> bool {
    let clean = ts.trim();
    if clean.is_empty() {
        return true;
    }
    if let Ok(val) = clean.parse::<f64>() {
        return val == 0.0;
    }
    let clean = clean.replace(':', "").replace('.', "").replace(',', "");
    if !clean.is_empty() && clean.chars().all(|c| c == '0') {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_ytdlp_args_tv_embedded() {
        let opts = DownloadOptions {
            url: "https://youtube.com/watch?v=test".into(),
            output_path: PathBuf::from("/tmp/test.mp4"),
            trim_start: "00:00:00".into(),
            trim_end: "00:10:00".into(),
            quality: 1080,
            client_priority: vec!["tv_embedded".into(), "web".into()],
            concurrent_fragments: 16,
            cookies_file: None,
            multi_instance: 1,
            simulated_progress: false,
        };
        let args = build_ytdlp_args(&opts);
        assert!(args.iter().any(|a| a.contains("tv_embedded")), "Should contain tv_embedded: {:?}", args);
        assert!(args.iter().any(|a| a.starts_with("*00:00:00-")), "Should have download-sections starting from 0: {:?}", args);
        assert!(args.iter().any(|a| a == "16"), "Should have 16 fragments: {:?}", args);
    }

    #[test]
    fn test_build_ytdlp_args_no_trim_when_empty() {
        let opts = DownloadOptions {
            url: "https://youtube.com/watch?v=test".into(),
            output_path: PathBuf::from("/tmp/test.mp4"),
            trim_start: "".into(),
            trim_end: "".into(),
            quality: 720,
            client_priority: vec!["tv_embedded".into()],
            concurrent_fragments: 8,
            cookies_file: None,
            multi_instance: 1,
            simulated_progress: false,
        };
        let args = build_ytdlp_args(&opts);
        assert!(!args.iter().any(|a| a.starts_with("*")), "No trim sections when empty: {:?}", args);
    }
}
