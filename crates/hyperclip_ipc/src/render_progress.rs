use regex::Regex;
use std::sync::OnceLock;

fn time_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"time=(\d+):(\d+):(\d+)\.(\d+)").unwrap())
}

pub fn parse_ffmpeg_stderr(line: &str, total_duration_sec: f64) -> Option<f64> {
    let caps = time_regex().captures(line)?;
    let h: u64 = caps.get(1)?.as_str().parse().ok()?;
    let m: u64 = caps.get(2)?.as_str().parse().ok()?;
    let s: u64 = caps.get(3)?.as_str().parse().ok()?;
    let ms: u64 = caps.get(4)?.as_str().parse().ok()?;
    let current_sec = h * 3600 + m * 60 + s + ms / 100;
    if total_duration_sec <= 0.0 { return None; }
    Some((current_sec as f64 / total_duration_sec).min(1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frame_line() {
        let line = "frame=  120 fps= 45 q=28.0 time=00:00:04.00 bitrate=2097.2kbits/s";
        let p = parse_ffmpeg_stderr(line, 30.0).unwrap();
        assert!((p - 0.133).abs() < 0.01);
    }

    #[test]
    fn test_parse_no_match() {
        assert!(parse_ffmpeg_stderr("hello world", 30.0).is_none());
    }

    #[test]
    fn test_parse_long_duration() {
        let line = "frame=3600 time=00:01:00.00";
        let p = parse_ffmpeg_stderr(line, 120.0).unwrap();
        assert!((p - 0.5).abs() < 0.01);
    }
}
