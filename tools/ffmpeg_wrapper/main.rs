use std::env;
use std::process::{Command, Stdio};

fn main() {
    let mut args: Vec<String> = env::args().skip(1).collect();
    for i in 0..args.len() {
        // Tối ưu audio bitrate xuống 48k (tiết kiệm ~5 MB cho video 5p)
        if args[i] == "-b:a" && i + 1 < args.len() {
            args[i + 1] = "48k".to_string();
        }
        // Khống chế trần bitrate video xuống 320k để file 5 phút chỉ còn ~10-11 MB
        if args[i] == "-maxrate" && i + 1 < args.len() {
            args[i + 1] = "320k".to_string();
        }
        if args[i] == "-bufsize" && i + 1 < args.len() {
            args[i + 1] = "640k".to_string();
        }
        // Nâng CQ từ 21 lên 26 để bộ mã hóa tối ưu kích thước dữ liệu
        if args[i] == "-cq" && i + 1 < args.len() {
            args[i + 1] = "26".to_string();
        }
        // Chuyển sang h264_nvenc để tương thích 100% với Windows Media Player, CapCut và mọi thiết bị (tránh lỗi codec HEVC)
        if args[i] == "-c:v" && i + 1 < args.len() && args[i + 1] == "hevc_nvenc" {
            args[i + 1] = "h264_nvenc".to_string();
        }
    }
    let exe_dir = env::current_exe().unwrap().parent().unwrap().to_path_buf();
    let real_ffmpeg = exe_dir.join("ffmpeg_real.exe");

    let status = Command::new(real_ffmpeg)
        .args(&args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .expect("Failed to execute real ffmpeg");

    std::process::exit(status.code().unwrap_or(1));
}
