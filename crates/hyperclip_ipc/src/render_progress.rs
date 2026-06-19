use regex::Regex;
use std::sync::OnceLock;

fn time_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"time=(\d+):(\d+):(\d+)\.(\d+)").unwrap())
}

pub fn parse_ffmpeg_stderr(line: &str, total_duration_sec: f64) -> Option<f64> {
    // If the line contains carriage returns, process the last segment containing "time="
    let target_line = if line.contains('\r') {
        line.split('\r')
            .filter(|s| s.contains("time="))
            .last()
            .unwrap_or(line)
    } else {
        line
    };

    let caps = time_regex().captures(target_line)?;
    let h: u64 = caps.get(1)?.as_str().parse().ok()?;
    let m: u64 = caps.get(2)?.as_str().parse().ok()?;
    let s: u64 = caps.get(3)?.as_str().parse().ok()?;
    let ms: u64 = caps.get(4)?.as_str().parse().ok()?;
    let current_sec = h * 3600 + m * 60 + s + ms / 100;
    if total_duration_sec <= 0.0 { return None; }
    Some((current_sec as f64 / total_duration_sec).min(1.0))
}

fn fps_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"fps=\s*([\d\.]+)").unwrap())
}

pub fn parse_ffmpeg_fps(line: &str) -> Option<f64> {
    let target_line = if line.contains('\r') {
        line.split('\r')
            .filter(|s| s.contains("fps="))
            .last()
            .unwrap_or(line)
    } else {
        line
    };
    let caps = fps_regex().captures(target_line)?;
    caps.get(1)?.as_str().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frame_line() {
        let line = "frame=  120 fps= 45 q=28.0 time=00:00:04.00 bitrate=2097.2kbits/s";
        let p = parse_ffmpeg_stderr(line, 30.0).unwrap();
        assert!((p - 0.133).abs() < 0.01);
        let fps = parse_ffmpeg_fps(line).unwrap();
        assert!((fps - 45.0).abs() < 0.01);
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

    #[test]
    fn test_parse_carriage_return_line() {
        let line = "frame=   10 fps= 10 q=29.0 size=    100KiB time=00:00:01.00\rframe=   20 fps= 20 q=29.0 size=    200KiB time=00:00:02.00\r";
        let p = parse_ffmpeg_stderr(line, 10.0).unwrap();
        assert!((p - 0.2).abs() < 0.01); // matches last time: 2.0s / 10.0s = 0.2
        
        let fps = parse_ffmpeg_fps(line).unwrap();
        assert!((fps - 20.0).abs() < 0.01); // matches last fps: 20
    }
}
