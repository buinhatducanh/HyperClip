// crates/hyperclip_ipc/src/youtube.rs
// yt-dlp spawn — ported from electron/services/youtube.ts

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

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

/// EXACT flags from electron/services/youtube.ts:
/// Client priority: tv_embedded → web → ios
/// tv_embedded bypasses EJS challenge → H.264 1080p60
/// 16 concurrent fragments
pub fn download_video(
    url: &str,
    output_path: &str,
    cookies_path: &str,
    trim_minutes: u32,
) -> Result<DownloadResult, String> {
    let ytdlp = find_ytdlp_path();

    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--extractor-args", "youtube:player_client=tv_embedded,web,ios",
        "--cookies", cookies_path,
        "-f", "bestvideo[height<=?1080]+bestaudio[acodec=aac]/bestvideo+bestaudio",
        "--download-sections",
        &format!("*00:00:00-00:{:02}:00", trim_minutes),
        "--concurrent-fragments", "16",
        "--no-playlist",
        "--no-color",
        "-o", output_path,
        url,
    ])
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());

    let output = cmd.output().map_err(|e| format!("yt-dlp spawn failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", stderr));
    }

    let duration = parse_duration_from_stderr(&String::from_utf8_lossy(&output.stderr));
    let file_size = std::fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(DownloadResult {
        path: output_path.to_string(),
        duration,
        width: 1920,
        height: 1080,
        file_size,
    })
}

/// Probe available formats without downloading
pub fn probe_formats(url: &str, cookies_path: &str) -> Result<Vec<u32>, String> {
    let ytdlp = find_ytdlp_path();

    let output = Command::new(&ytdlp)
        .args([
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
