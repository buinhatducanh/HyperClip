#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub percent: f64,
    pub speed_mbps: f64,
    pub eta_sec: u64,
}

pub fn parse_ytdlp_stderr(line: &str) -> Option<DownloadProgress> {
    if !line.contains("[download]") || !line.contains('%') {
        return None;
    }
    let percent_part = line.split('%').next()?;
    let percent_str = percent_part.split_whitespace().last()?;
    let percent: f64 = percent_str.parse().ok()?;

    let speed_mbps = line.split("at ").nth(1)
        .and_then(|s| s.split_whitespace().next())
        .map(parse_speed).unwrap_or(0.0);
    let eta_sec = line.split("ETA ").nth(1)
        .map(|s| parse_eta(s.trim())).unwrap_or(0);

    Some(DownloadProgress { percent: percent / 100.0, speed_mbps, eta_sec })
}

fn parse_speed(s: &str) -> f64 {
    let num: f64 = s.trim_end_matches("MiB/s").trim_end_matches("KiB/s").parse().unwrap_or(0.0);
    if s.contains("MiB") { num * 8.0 } else if s.contains("KiB") { num * 8.0 / 1024.0 } else { 0.0 }
}

fn parse_eta(s: &str) -> u64 {
    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        2 => parts[0].parse::<u64>().unwrap_or(0) * 60 + parts[1].parse::<u64>().unwrap_or(0),
        3 => parts[0].parse::<u64>().unwrap_or(0) * 3600 + parts[1].parse::<u64>().unwrap_or(0) * 60 + parts[2].parse::<u64>().unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_download_progress() {
        let line = "[download]  45.2% of  288.70MiB at  9.5MiB/s ETA 00:30";
        let p = parse_ytdlp_stderr(line).unwrap();
        assert!((p.percent - 0.452).abs() < 0.001);
        assert!((p.speed_mbps - 76.0).abs() < 1.0);
        assert_eq!(p.eta_sec, 30);
    }

    #[test]
    fn test_parse_non_progress_line() {
        assert!(parse_ytdlp_stderr("[ffmpeg] Destination: output.mp4").is_none());
    }

    #[test]
    fn test_parse_100_percent() {
        let line = "[download] 100% of  288.70MiB at  9.5MiB/s ETA 00:00";
        let p = parse_ytdlp_stderr(line).unwrap();
        assert!((p.percent - 1.0).abs() < 0.001);
    }
}
