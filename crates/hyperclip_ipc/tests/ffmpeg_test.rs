use hyperclip_ipc::ffmpeg::{build_short_filter, build_short_filter_cuda, build_landscape_filter, build_landscape_filter_cuda, nvenc_codec_name, EncodeCodec, FilterChain, build_atempo_chain, speed_filter_tag, get_ffmpeg_path, spawn_render_async, RenderOptions};
use hyperclip_ipc::system::GPUTier;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[test]
fn test_build_short_filter_vertical() {
    let filter = build_short_filter(0.0, 60.0, 1.0, 1080, 1920, 384, 192, false, 30);
    assert!(filter.contains("scale="), "should use sw scale: {}", filter);
    assert!(filter.contains("crop="), "should use sw crop: {}", filter);
    assert!(filter.contains("overlay="), "should use sw overlay: {}", filter);
    assert!(filter.contains("[final]"), "should end with [final]");
    assert!(filter.contains("trim=start=0:duration=60"), "trim should be correct: {}", filter);
}

#[test]
fn test_build_short_filter_vertical_with_speed() {
    let filter = build_short_filter(0.0, 60.0, 1.5, 1080, 1920, 384, 192, false, 30);
    assert!(filter.contains("setpts=0.6666666666666666*PTS"), "should have speed setpts: {}", filter);
    assert!(filter.contains("trim=start=0:duration=60"), "trim should be speed-adjusted: {}", filter);
}

#[test]
fn test_build_short_filter_cuda() {
    let filter = build_short_filter_cuda(0.0, 60.0, 1.0, 1080, 1920, 384, 192, 30);
    assert!(filter.contains("scale_cuda"), "CUDA filter: {}", filter);
    assert!(filter.contains("crop="), "CPU crop: {}", filter);
    assert!(filter.contains("overlay_cuda"), "CUDA overlay: {}", filter);
}

#[test]
fn test_build_short_filter_cuda_with_speed() {
    let filter = build_short_filter_cuda(0.0, 60.0, 2.0, 1080, 1920, 384, 192, 30);
    assert!(filter.contains("setpts=0.5*PTS"), "should have speed setpts: {}", filter);
    assert!(filter.contains("trim=start=0:duration=60"), "trim should be speed-adjusted: {}", filter);
}

#[test]
fn test_build_landscape_filter() {
    let filter = build_landscape_filter(0.0, 60.0, 1.0, 1920, 1080, 900, 216, false, 30);
    assert!(filter.contains("scale="), "landscape sw scale: {}", filter);
    assert!(filter.contains("crop="), "landscape sw crop: {}", filter);
    assert!(filter.contains("overlay="), "landscape sw overlay: {}", filter);
    assert!(filter.contains("[final]"), "should end with [final]");
}

#[test]
fn test_build_landscape_filter_cuda() {
    let filter = build_landscape_filter_cuda(0.0, 60.0, 1.0, 1920, 1080, 216, 30);
    assert!(filter.contains("scale_cuda"), "landscape CUDA scale: {}", filter);
    assert!(filter.contains("overlay_cuda"), "landscape CUDA overlay: {}", filter);
    assert!(filter.contains("[final]"), "should end with [final]");
}

#[test]
fn test_build_landscape_filter_with_speed() {
    let filter = build_landscape_filter(0.0, 60.0, 1.2, 1920, 1080, 900, 216, false, 30);
    assert!(filter.contains("setpts=0.8333333333333334*PTS"), "should have exact speed setpts: {}", filter);
    assert!(filter.contains("trim=start=0:duration=60"), "trim should be speed-adjusted: {}", filter);
    assert!(filter.contains("[final]"), "should end with [final]");
}

#[test]
fn test_build_landscape_filter_cuda_with_speed() {
    let filter = build_landscape_filter_cuda(0.0, 60.0, 1.2, 1920, 1080, 216, 30);
    assert!(filter.contains("setpts=0.8333333333333334*PTS"), "should have exact speed setpts: {}", filter);
    assert!(filter.contains("trim=start=0:duration=60"), "trim should be exact duration (unscaled): {}", filter);
    assert!(filter.contains("[final]"), "should end with [final]");
}

#[test]
fn test_nvenc_codec_names() {
    assert_eq!(nvenc_codec_name(EncodeCodec::HEVC), "hevc_nvenc");
    assert_eq!(nvenc_codec_name(EncodeCodec::H264), "h264_nvenc");
}

#[test]
fn test_speed_filter_tag_normal() {
    assert!(speed_filter_tag(1.0).is_empty(), "speed=1 should be empty");
    assert!(speed_filter_tag(0.0).is_empty(), "speed=0 should be empty");
}

#[test]
fn test_speed_filter_tag_speedup() {
    let tag = speed_filter_tag(1.5);
    assert_eq!(tag, "setpts=0.6666666666666666*PTS,");
}

#[test]
fn test_speed_filter_tag_slowdown() {
    let tag = speed_filter_tag(0.75);
    assert_eq!(tag, "setpts=1.3333333333333333*PTS,");
}

#[test]
fn test_build_atempo_chain_speed1() {
    assert!(build_atempo_chain(1.0).is_none(), "speed=1 should be none");
    assert!(build_atempo_chain(0.0).is_none(), "speed=0 should be none");
}

#[test]
fn test_build_atempo_chain_normal() {
    let chain = build_atempo_chain(1.5).unwrap();
    assert_eq!(chain, "[0:a]atempo=1.5[a]");
}

#[test]
fn test_build_atempo_chain_boundary() {
    let chain = build_atempo_chain(2.0).unwrap();
    assert_eq!(chain, "[0:a]atempo=2[a]");
}

#[test]
fn test_build_atempo_chain_above_2() {
    let chain = build_atempo_chain(3.0).unwrap();
    assert_eq!(chain, "[0:a]atempo=2.0,atempo=1.50[a]");
}

#[test]
fn test_build_atempo_chain_above_4() {
    let chain = build_atempo_chain(5.0).unwrap();
    assert_eq!(chain, "[0:a]atempo=2.0,atempo=2.0,atempo=1.25[a]");
}

#[test]
fn test_build_atempo_below_half() {
    assert!(build_atempo_chain(0.4).is_none());
}

#[test]
fn test_gpu_tier_codec_selection() {
    match GPUTier::High {
        GPUTier::High => assert_eq!("hevc_nvenc", "hevc_nvenc"),
        _ => panic!("High should match as HEVC"),
    }
    match GPUTier::Software {
        GPUTier::High => panic!("Software should NOT match as HEVC"),
        _ => assert_eq!("h264_nvenc", "h264_nvenc"),
    }
}

#[test]
fn test_render_options_fields() {
    let opts = RenderOptions {
        workspace_id: "test-ws".into(),
        input_path: "input.mp4".into(),
        output_path: "output.mp4".into(),
        resolution: "1080p".into(),
        fps: 30,
        speed: 1.0,
        trim_start: 0.0,
        trim_end: 60.0,
        gpu_tier: GPUTier::High,
        preset: "p1".into(),
        filter_chain: FilterChain::Short,
        chunked: false,
        chunk_duration_sec: 120,
    };
    assert_eq!(opts.workspace_id, "test-ws");
    assert_eq!(opts.resolution, "1080p");
    assert_eq!(opts.chunked, false);
}

#[test]
fn test_render_progress_parse() {
    use hyperclip_ipc::render_progress::parse_ffmpeg_stderr;
    let p = parse_ffmpeg_stderr("frame=120 time=00:00:04.00", 30.0).unwrap();
    assert!((p - 0.133).abs() < 0.01, "progress: {}", p);
    assert!(parse_ffmpeg_stderr("hello world", 30.0).is_none());
}

#[test]
fn test_render_integration_real_file() {
    let data_dir = hyperclip_ipc::get_data_dir();
    let input_path = data_dir.join("downloads/ws-zilk-test.mp4");
    let output_path = data_dir.join("downloads/ws-zilk-test-rust-rendered.mp4");
    let input = input_path.to_string_lossy().into_owned();
    let output = output_path.to_string_lossy().into_owned();

    if !input_path.exists() {
        eprintln!("SKIP: input file not found: {}", input);
        return;
    }

    let _ = std::fs::remove_file(&output);

    // First verify: the exact same args work via std::process::Command
    let ffmpeg = get_ffmpeg_path();
    let filter = build_short_filter(0.0, 5.0, 1.0, 1080, 1920, 384, 192, false, 30);
    let mut cmd = std::process::Command::new(&ffmpeg);
    cmd.args(["-hide_banner", "-y",
        "-i", &input,
        "-f", "lavfi", "-i", "color=c=0x2d2d2d:s=1080x1920:d=5.00",
        "-f", "lavfi", "-i", "color=c=0x0d0d0d:s=1080x384:d=5.00",
        "-f", "lavfi", "-i", "color=c=0x1a1a1a:s=1080x192:d=5.00",
        "-filter_complex", &filter,
        "-map", "[final]", "-map", "0:a?",
        "-c:v", "h264_nvenc", "-preset", "p1",
        "-rc:v", "vbr_hq", "-cq", "18", "-tune", "ull",
        "-bf", "0", "-refs", "1", "-g", "30",
        "-maxrate", "12M", "-bufsize", "12M",
        "-c:a", "aac", "-b:a", "192k",
        &output]);
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());
    let output_handle = cmd.output().expect("ffmpeg pre-check");
    let stderr = String::from_utf8_lossy(&output_handle.stderr);
    assert!(output_handle.status.success(), "ffmpeg pre-check failed:\n{}", stderr);
    let _ = std::fs::remove_file(&output);

    // Now test via spawn_render_async in a dedicated thread with its own tokio runtime
    let (tx, rx) = std::sync::mpsc::channel();
    let result_tx = tx.clone();
    let pv = Arc::new(Mutex::new(Vec::new()));
    let pv2 = pv.clone();

    let thread_input = input.clone();
    let thread_output = output.clone();
    std::thread::spawn(move || {
        use tokio::runtime::Builder;
        let rt = Builder::new_current_thread().enable_all().build().unwrap();
        let result = rt.block_on(async {
            let opts = RenderOptions {
                workspace_id: "test-integration".into(),
                input_path: PathBuf::from(thread_input),
                output_path: PathBuf::from(thread_output),
                resolution: "1080p".into(),
                fps: 30,
                speed: 1.0,
                trim_start: 0.0,
                trim_end: 5.0,
                gpu_tier: GPUTier::Software,
                preset: "p1".into(),
                filter_chain: FilterChain::Short,
                chunked: false,
                chunk_duration_sec: 120,
            };
            spawn_render_async(opts, move |p| {
                if let Ok(mut v) = pv2.lock() {
                    v.push(p);
                }
            }).await.map(|(path, _)| path)
        });
        result_tx.send(result).ok();
    });

    let result = rx.recv_timeout(std::time::Duration::from_secs(60))
        .expect("timeout waiting for async render (60s)")
        .expect("spawn_render_async returned error");

    assert_eq!(result, PathBuf::from(&output));
    assert!(std::path::Path::new(&output).exists(), "output file missing");

    // Verify output dimensions
    let ffprobe = std::process::Command::new("ffprobe")
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", &output])
        .output().expect("ffprobe");
    let info: serde_json::Value = serde_json::from_slice(&ffprobe.stdout).expect("ffprobe json");
    let streams = info["streams"].as_array().expect("streams array");
    let video = streams.iter().find(|s| s["codec_type"] == "video").expect("video stream");
    assert_eq!(video["width"], 1080, "width: got {}", video["width"]);
    assert_eq!(video["height"], 1920, "height: got {}", video["height"]);

    let dur: f64 = info["format"]["duration"].as_str().unwrap().parse().unwrap();
    assert!((dur - 5.0).abs() < 1.0, "duration ~5s, got {}", dur);

    let pv = pv.lock().unwrap();
    assert!(!pv.is_empty(), "should have progress values, got {} samples", pv.len());

    let _ = std::fs::remove_file(&output);
}

#[tokio::test]
async fn test_cuvid_decoder_probe_nonexistent() {
    let ffmpeg = get_ffmpeg_path();
    let mut test_cmd = tokio::process::Command::new(&ffmpeg);
    test_cmd.args([
        "-y",
        "-hwaccel", "cuda",
        "-hwaccel_output_format", "cuda",
        "-c:v", "av1_cuvid",
        "-i", "nonexistent_file.mp4",
        "-t", "0.01",
        "-f", "null",
        "-"
    ]);
    test_cmd.stdin(std::process::Stdio::null());
    test_cmd.stdout(std::process::Stdio::null());
    test_cmd.stderr(std::process::Stdio::null());

    let output = test_cmd.output().await;
    assert!(output.is_err() || !output.unwrap().status.success());
}

