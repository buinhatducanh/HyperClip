use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::Duration;

fn extract_json_f64(json: &str, key: &str) -> Option<f64> {
    let pattern = format!("\"{}\"", key);
    let key_pos = json.find(&pattern)?;
    let after_key = &json[key_pos + pattern.len()..];
    let colon_pos = after_key.find(':')?;
    let after_colon = after_key[colon_pos + 1..].trim_start();
    let num_end = after_colon
        .find(|c: char| !c.is_digit(10) && c != '.' && c != '-')
        .unwrap_or(after_colon.len());
    after_colon[..num_end].trim().parse::<f64>().ok()
}

fn extract_json_string(json: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\"", key);
    let key_pos = json.find(&pattern)?;
    let after_key = &json[key_pos + pattern.len()..];
    let colon_pos = after_key.find(':')?;
    let after_colon = after_key[colon_pos + 1..].trim_start();
    if after_colon.starts_with('"') {
        let val_start = 1;
        let val_end = after_colon[val_start..].find('"')?;
        return Some(after_colon[val_start..val_start + val_end].to_string());
    }
    None
}

// Đọc settings.json với cơ chế retry chống Sharing Violation / Race condition trên Windows (BUG-05)
fn read_render_settings() -> (Option<f64>, Option<f64>, Option<String>) {
    let mut candidate_paths: Vec<PathBuf> = Vec::new();

    if let Ok(dir) = env::var("HYPERCLIP_DATA_DIR") {
        candidate_paths.push(PathBuf::from(&dir).join(".hyperclip").join("settings.json"));
        candidate_paths.push(PathBuf::from(&dir).join("settings.json"));
    }
    if let Ok(dir) = env::var("HYPERCLIPB_DATA_DIR") {
        candidate_paths.push(PathBuf::from(&dir).join(".hyperclip").join("settings.json"));
        candidate_paths.push(PathBuf::from(&dir).join("settings.json"));
    }
    if let Ok(current_exe) = env::current_exe() {
        let mut curr = current_exe.parent();
        for _ in 0..6 {
            if let Some(p) = curr {
                candidate_paths.push(p.join("HyperClip-Data").join(".hyperclip").join("settings.json"));
                candidate_paths.push(p.join("HyperClipB-Data").join(".hyperclip").join("settings.json"));
                candidate_paths.push(p.join("app").join("data").join(".hyperclip").join("settings.json"));
                candidate_paths.push(p.join(".hyperclip").join("settings.json"));
                curr = p.parent();
            }
        }
    }

    for path in candidate_paths {
        if path.exists() {
            // Retry tối đa 4 lần nếu file đang bị UI khóa ghi
            for _ in 0..4 {
                if let Ok(content) = fs::read_to_string(&path) {
                    let maxrate = extract_json_f64(&content, "renderMaxrateMbps");
                    let shorts_maxrate = extract_json_f64(&content, "shortsRenderMaxrateMbps");
                    let preset = extract_json_string(&content, "videoQualityPreset");
                    return (maxrate, shorts_maxrate, preset);
                }
                sleep(Duration::from_millis(25));
            }
        }
    }
    (None, None, None)
}

struct QualityProfile {
    maxrate: String,
    bufsize: String,
    cq: String,
    audio_bitrate: String,
}

// Sửa BUG-01: Ưu tiên giá trị số renderMaxrateMbps do người dùng chỉnh
fn determine_profile(maxrate_mbps: Option<f64>, preset: Option<String>) -> QualityProfile {
    // Nếu có preset nhưng người dùng đã chỉnh bitrate cụ thể (> 0.05), ưu tiên bitrate số thực tế
    let mbps = maxrate_mbps.unwrap_or(0.0);

    // Nếu bitrate = 0 (hoặc chưa đặt) và có preset rõ ràng:
    if mbps <= 0.05 {
        if let Some(ref p) = preset {
            match p.to_lowercase().as_str() {
                "balanced" => {
                    return QualityProfile {
                        maxrate: "2000k".to_string(),
                        bufsize: "4000k".to_string(),
                        cq: "23".to_string(),
                        audio_bitrate: "96k".to_string(),
                    }
                }
                "high" => {
                    return QualityProfile {
                        maxrate: "4000k".to_string(),
                        bufsize: "8000k".to_string(),
                        cq: "21".to_string(),
                        audio_bitrate: "128k".to_string(),
                    }
                }
                "ultra" => {
                    return QualityProfile {
                        maxrate: "8000k".to_string(),
                        bufsize: "16000k".to_string(),
                        cq: "18".to_string(),
                        audio_bitrate: "192k".to_string(),
                    }
                }
                _ => {} // "speed" rơi vào mức 0 bên dưới
            }
        }

        // Mức 0: Tốc độ tối đa (mặc định siêu nhẹ ~10MB/5p, upload TikTok ~2.5s)
        return QualityProfile {
            maxrate: "320k".to_string(),
            bufsize: "640k".to_string(),
            cq: "26".to_string(),
            audio_bitrate: "48k".to_string(),
        };
    }

    if mbps <= 0.8 {
        QualityProfile {
            maxrate: format!("{}k", (mbps * 1000.0).round() as u32),
            bufsize: format!("{}k", (mbps * 2000.0).round() as u32),
            cq: "25".to_string(),
            audio_bitrate: "64k".to_string(),
        }
    } else if mbps <= 1.5 {
        QualityProfile {
            maxrate: format!("{}k", (mbps * 1000.0).round() as u32),
            bufsize: format!("{}k", (mbps * 2000.0).round() as u32),
            cq: "24".to_string(),
            audio_bitrate: "96k".to_string(),
        }
    } else if mbps <= 2.5 {
        // Cân bằng (~2 Mbps): nét chuẩn, mượt mà, file ~25-35MB/5p, upload ~5-6s
        QualityProfile {
            maxrate: format!("{}k", (mbps * 1000.0).round() as u32),
            bufsize: format!("{}k", (mbps * 2000.0).round() as u32),
            cq: "23".to_string(),
            audio_bitrate: "96k".to_string(),
        }
    } else if mbps <= 4.5 {
        // Chất lượng cao (~3 - 4 Mbps): chi tiết sắc nét, âm thanh 128k, file ~60-80MB/5p
        QualityProfile {
            maxrate: format!("{}k", (mbps * 1000.0).round() as u32),
            bufsize: format!("{}k", (mbps * 2000.0).round() as u32),
            cq: "21".to_string(),
            audio_bitrate: "128k".to_string(),
        }
    } else if mbps <= 7.0 {
        // Rất nét (~5 - 7 Mbps)
        QualityProfile {
            maxrate: format!("{}k", (mbps * 1000.0).round() as u32),
            bufsize: format!("{}k", (mbps * 2000.0).round() as u32),
            cq: "20".to_string(),
            audio_bitrate: "160k".to_string(),
        }
    } else {
        // Cực nét / Ultra (>= 8 Mbps): tối đa độ nét gốc, âm thanh 192k
        QualityProfile {
            maxrate: format!("{}k", (mbps * 1000.0).round() as u32),
            bufsize: format!("{}k", (mbps * 2000.0).round() as u32),
            cq: "18".to_string(),
            audio_bitrate: "192k".to_string(),
        }
    }
}

// Kiểm tra xem lệnh gọi FFmpeg có phải là encode video hay không
fn is_video_encode_command(args: &[String]) -> bool {
    let mut has_c_v = false;
    for i in 0..args.len() {
        if args[i] == "-c:v" && i + 1 < args.len() {
            let codec = &args[i + 1];
            if codec != "copy" {
                has_c_v = true;
            }
        }
        if args[i].contains("nvenc") || args[i].contains("libx264") {
            has_c_v = true;
        }
    }
    has_c_v
}

// Kiểm tra xem video đang render có phải là Short hay không (BUG-03)
fn is_short_render(args: &[String]) -> bool {
    // 1. Kiểm tra biến môi trường edition
    if let Ok(edition) = env::var("HYPERCLIP_EDITION") {
        if edition.eq_ignore_ascii_case("shorts") || edition.eq_ignore_ascii_case("short") {
            return true;
        }
    }
    // 2. Kiểm tra tham số thời lượng -t <= 180s
    for i in 0..args.len() {
        if args[i] == "-t" && i + 1 < args.len() {
            if let Ok(t) = args[i + 1].parse::<f64>() {
                if t <= 180.0 {
                    return true;
                }
            }
        }
    }
    false
}

// Kiểm tra xem lệnh có audio copy hoặc tắt audio không
fn is_audio_copy_or_none(args: &[String]) -> bool {
    for i in 0..args.len() {
        if args[i] == "-an" {
            return true;
        }
        if args[i] == "-c:a" && i + 1 < args.len() && args[i + 1] == "copy" {
            return true;
        }
    }
    false
}

fn main() {
    let mut args: Vec<String> = env::args().skip(1).collect();

    let (maxrate_mbps, shorts_maxrate, preset) = read_render_settings();

    // Phân biệt làn Shorts vs Video Dài (BUG-03)
    let effective_mbps = if is_short_render(&args) && shorts_maxrate.is_some() {
        shorts_maxrate
    } else {
        maxrate_mbps
    };

    let profile = determine_profile(effective_mbps, preset);
    let is_encode = is_video_encode_command(&args);
    let no_audio_encode = is_audio_copy_or_none(&args);

    let mut has_maxrate = false;
    let mut has_bufsize = false;
    let mut has_cq = false;
    let mut has_audio_b = false;
    let mut cv_insert_idx = None;

    for i in 0..args.len() {
        // Chuyển sang h264_nvenc để tương thích 100% với Windows Media Player, CapCut
        if args[i] == "-c:v" && i + 1 < args.len() {
            cv_insert_idx = Some(i + 2);
            if args[i + 1] == "hevc_nvenc" {
                args[i + 1] = "h264_nvenc".to_string();
            }
        }

        if args[i] == "-maxrate" && i + 1 < args.len() {
            args[i + 1] = profile.maxrate.clone();
            has_maxrate = true;
        }
        if args[i] == "-bufsize" && i + 1 < args.len() {
            args[i + 1] = profile.bufsize.clone();
            has_bufsize = true;
        }
        if args[i] == "-cq" && i + 1 < args.len() {
            args[i + 1] = profile.cq.clone();
            has_cq = true;
        }
        if !no_audio_encode && args[i] == "-b:a" && i + 1 < args.len() {
            args[i + 1] = profile.audio_bitrate.clone();
            has_audio_b = true;
        }
    }

    // Sửa BUG-04: Nếu là lệnh encode nhưng backend chưa truyền -maxrate / -cq, chủ động inject
    if is_encode {
        let mut injection = Vec::new();
        if !has_maxrate {
            injection.push("-maxrate".to_string());
            injection.push(profile.maxrate.clone());
        }
        if !has_bufsize {
            injection.push("-bufsize".to_string());
            injection.push(profile.bufsize.clone());
        }
        if !has_cq {
            injection.push("-cq".to_string());
            injection.push(profile.cq.clone());
        }
        if !has_audio_b && !no_audio_encode {
            injection.push("-b:a".to_string());
            injection.push(profile.audio_bitrate.clone());
        }

        if !injection.is_empty() {
            if let Some(idx) = cv_insert_idx {
                let target = idx.min(args.len());
                for (j, item) in injection.into_iter().enumerate() {
                    args.insert(target + j, item);
                }
            } else if args.len() > 1 {
                // Chèn trước file output cuối cùng
                let last = args.len() - 1;
                for (j, item) in injection.into_iter().enumerate() {
                    args.insert(last + j, item);
                }
            }
        }
    }

    let exe_dir = env::current_exe()
        .map(|p| p.parent().unwrap_or(&p).to_path_buf())
        .unwrap_or_else(|_| PathBuf::from("."));
    let real_ffmpeg = exe_dir.join("ffmpeg_real.exe");

    if !real_ffmpeg.exists() {
        eprintln!("[ffmpeg_wrapper error] Khong tim thay ffmpeg_real.exe tai: {:?}", real_ffmpeg);
        std::process::exit(1);
    }

    let status = match Command::new(&real_ffmpeg)
        .args(&args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
    {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[ffmpeg_wrapper error] Loi khoi dong real ffmpeg: {}", e);
            std::process::exit(1);
        }
    };

    std::process::exit(status.code().unwrap_or(1));
}
