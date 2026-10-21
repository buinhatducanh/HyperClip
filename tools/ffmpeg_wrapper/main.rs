use std::env;
use std::process::{Command, Stdio};

fn main() {
    let mut args: Vec<String> = env::args().skip(1).collect();
    for i in 0..args.len() {
        if args[i] == "-b:a" && i + 1 < args.len() && args[i + 1] == "192k" {
            args[i + 1] = "64k".to_string();
        }
        if args[i] == "-maxrate" && i + 1 < args.len() && (args[i + 1] == "1M" || args[i + 1] == "800k") {
            args[i + 1] = "600k".to_string();
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
