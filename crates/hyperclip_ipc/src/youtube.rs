// crates/hyperclip_ipc/src/youtube.rs
// yt-dlp spawn — ported from electron/services/youtube.ts
// Async streaming with progress emission + ffprobe metadata

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResult {
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub codec: String,
    pub fps: f64,
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
}

pub fn build_ytdlp_args(opts: &DownloadOptions) -> Vec<String> {
    let mut args = vec![
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "--newline".to_string(),
        "-f".to_string(),
        format!("best[height<=?{}]/best", opts.quality),
        "-o".to_string(),
        opts.output_path.to_string_lossy().to_string(),
        "--concurrent-fragments".to_string(),
        opts.concurrent_fragments.to_string(),
        "--remux-video".to_string(),
        "mp4".to_string(),
    ];
    let clients = opts.client_priority.join(",");
    args.push("--extractor-args".to_string());
    args.push(format!("youtube:player_client={}", clients));
    if !opts.trim_start.is_empty() || !opts.trim_end.is_empty() {
        let end = if opts.trim_end.is_empty() { "99:00:00" } else { &opts.trim_end };
        args.push("--download-sections".to_string());
        args.push(format!("*{}-{}", opts.trim_start, end));
    }
    if let Some(cookies) = &opts.cookies_file {
        args.push("--cookies".to_string());
        args.push(cookies.to_string_lossy().to_string());
    }
    args.push(opts.url.clone());
    args
}

/// Emit download progress event to Python via stdout JSON-RPC event.
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
    println!("{}", serde_json::to_string(&event).unwrap_or_default());
    std::io::stdout().flush().ok();
}

/// Async download with streaming progress via callback.
/// Spawns yt-dlp, reads stderr line-by-line, calls on_progress for each line.
pub fn download_video_streaming<F>(
    url: &str,
    output_path: &str,
    cookies_path: &str,
    trim_minutes: u32,
    quality: u32,
    mut on_progress: F,
) -> Result<DownloadResult, String>
where
    F: FnMut(DownloadProgress),
{
    let fmt = format!("bestvideo[height<=?{height}]+bestaudio[acodec=aac]/best[height<=?{height}]/worst", height = quality);
    let ytdlp = find_ytdlp_path();

    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--js-runtimes", "node",
        "--extractor-args", "youtube:player_client=tv_embedded,web,ios",
        "--cookies", cookies_path,
        "-f", &fmt,
        "--download-sections",
        &format!("*00:00:00-00:{:02}:00", trim_minutes),
        "--concurrent-fragments", "16",
        "--no-playlist",
        "--no-color",
        "--newline",
        "-o", output_path,
        url,
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("yt-dlp spawn failed: {}", e))?;
    let stderr = child.stderr.take().unwrap();
    let reader = BufReader::new(stderr);

    // Read stderr line by line, parse progress
    for line in reader.lines() {
        let line = line.map_err(|e| format!("stderr read error: {}", e))?;
        if let Some(progress) = parse_ytdlp_stderr(&line) {
            on_progress(progress);
        }
    }

    let status = child.wait().map_err(|e| format!("wait failed: {}", e))?;
    if !status.success() {
        // Read stdout for error details
        let stdout = child.stdout.take().map(|o| {
            let mut buf = String::new();
            BufReader::new(o).read_to_string(&mut buf).ok();
            buf
        }).unwrap_or_default();
        return Err(format!("yt-dlp failed (exit={:?}): {}", status.code(), stdout));
    }

    let file_size = std::fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Run ffprobe to get real metadata
    let (duration, width, height, codec, fps) = probe_media_file(output_path);

    Ok(DownloadResult {
        path: output_path.to_string(),
        duration,
        width,
        height,
        file_size,
        codec,
        fps,
    })
}

/// ffprobe wrapper — extract duration, resolution, codec, fps from a media file.
pub fn probe_media_file(path: &str) -> (f64, u32, u32, String, f64) {
    let ffprobe = find_ffprobe_path();
    let output = Command::new(&ffprobe)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output();

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
    quality: u32,
) -> Result<DownloadResult, String> {
    let fmt = format!("bestvideo[height<=?{height}]+bestaudio[acodec=aac]/best[height<=?{height}]/worst", height = quality);
    let ytdlp = find_ytdlp_path();

    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--js-runtimes", "node",
        "--extractor-args", "youtube:player_client=tv_embedded,web,ios",
        "--cookies", cookies_path,
        "-f", &fmt,
        "--download-sections",
        &format!("*00:00:00-00:{:02}:00", trim_minutes),
        "--concurrent-fragments", "16",
        "--no-playlist",
        "--no-color",
        "-o", output_path,
        url,
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let output = cmd.output().map_err(|e| format!("yt-dlp spawn failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", stderr));
    }

    let duration = parse_duration_from_stderr(&String::from_utf8_lossy(&output.stderr));
    let file_size = std::fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Run ffprobe for real metadata
    let (_ff_dur, width, height, codec, fps) = probe_media_file(output_path);

    Ok(DownloadResult {
        path: output_path.to_string(),
        duration,
        width,
        height,
        file_size,
        codec,
        fps,
    })
}

/// Probe available formats without downloading
pub fn probe_formats(url: &str, cookies_path: &str) -> Result<Vec<u32>, String> {
    let ytdlp = find_ytdlp_path();

    let output = Command::new(&ytdlp)
        .args([
            "--js-runtimes", "node",
            "--extractor-args", "youtube:player_client=tv_embedded",
            "--cookies", cookies_path,
            "--dump-json",
            "--no-download",
            url,
        ])
        .output()
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

    let output = Command::new(&ytdlp)
        .args([
            "--js-runtimes", "node",
            "--extractor-args", "youtube:player_client=tv_embedded,web,ios",
            "--cookies", cookies_path,
            "--dump-json",
            "--no-download",
            url,
        ])
        .output()
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

/// Find ffprobe executable
fn find_ffprobe_path() -> String {
    let candidates = [
        "C:/Users/MSI/scoop/shims/ffprobe.exe",
        "ffprobe",
    ];
    for p in &candidates {
        if std::path::Path::new(p).exists() {
            return p.replace('\\', "/");
        }
    }
    "ffprobe".to_string()
}

/// Find yt-dlp executable
fn find_ytdlp_path() -> String {
    let candidates = [
        "C:/Users/MSI/AppData/Roaming/Python/Python312/Scripts/yt-dlp.exe",
        "C:/Users/MSI/AppData/Roaming/Python/Python313/Scripts/yt-dlp.exe",
        "C:/Users/MSI/AppData/Roaming/Python/Python314/Scripts/yt-dlp.exe",
        "yt-dlp",
    ];
    for p in &candidates {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    "yt-dlp".to_string()
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
        };
        let args = build_ytdlp_args(&opts);
        assert!(args.iter().any(|a| a.contains("tv_embedded")), "Should contain tv_embedded: {:?}", args);
        assert!(args.iter().any(|a| a.starts_with("*00:00:00")), "Should have download-sections: {:?}", args);
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
        };
        let args = build_ytdlp_args(&opts);
        assert!(!args.iter().any(|a| a.starts_with("*")), "No trim sections when empty: {:?}", args);
    }
}
