// crates/hyperclip_ipc/src/thumbnail.rs
// YouTube thumbnail download — maxresdefault.jpg → hqdefault.jpg fallback
// Output directory is caller's responsibility (per-channel media dir).

use std::path::Path;
use std::path::PathBuf;

/// Download YouTube thumbnail to a specific output path.
/// Tries maxresdefault.jpg first, falls back to hqdefault.jpg on 404.
/// Returns the same output path on success, or None if both fail.
pub fn download_youtube_thumbnail_to(video_id: &str, output_path: &Path) -> Option<String> {
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }

    let primary = format!("https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg");
    let fallback = format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg");

    if try_download(&primary, output_path) {
        return Some(output_path.to_string_lossy().to_string());
    }
    if try_download(&fallback, output_path) {
        return Some(output_path.to_string_lossy().to_string());
    }
    None
}

/// Legacy — download to flat data/thumbnails dir.
/// Kept for backward compat.
pub fn download_youtube_thumbnail(video_id: &str) -> Option<String> {
    let dir = super::store::get_legacy_thumbnails_dir();
    let output = dir.join(format!("{}.jpg", video_id));
    download_youtube_thumbnail_to(video_id, &output)
}

fn try_download(url: &str, output: &Path) -> bool {
    let resp = match ureq::get(url)
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .call()
    {
        Ok(r) if r.status() == 200 => r,
        _ => return false,
    };

    let len = resp.header("Content-Length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if len <= 1024 {
        return false;
    }

    let mut reader = resp.into_reader();
    let file = match std::fs::File::create(output) {
        Ok(f) => f,
        Err(_) => return false,
    };
    if std::io::copy(&mut reader, &mut std::io::BufWriter::new(file)).is_err() {
        return false;
    }
    std::fs::metadata(output).map(|m| m.len() > 1024).unwrap_or(false)
}
