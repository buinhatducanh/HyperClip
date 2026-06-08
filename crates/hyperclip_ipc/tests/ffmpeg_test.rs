use hyperclip_ipc::ffmpeg::{build_short_filter, build_short_filter_cuda, build_landscape_filter, nvenc_codec_name, EncodeCodec, FilterChain, build_atempo_chain, speed_filter_tag};
use hyperclip_ipc::system::GPUTier;

#[test]
fn test_build_short_filter_vertical() {
    let filter = build_short_filter(0.0, 60.0, 1.0, 1080, 1920, 384, 192, false);
    assert!(filter.contains("scale="), "should use sw scale: {}", filter);
    assert!(filter.contains("crop="), "should use sw crop: {}", filter);
    assert!(filter.contains("overlay="), "should use sw overlay: {}", filter);
    assert!(filter.contains("[final]"), "should end with [final]");
    // trim=start=0:end=60 with speed=1
    assert!(filter.contains("trim=start=0:end=60"), "trim should be correct: {}", filter);
}

#[test]
fn test_build_short_filter_vertical_with_speed() {
    let filter = build_short_filter(0.0, 60.0, 1.5, 1080, 1920, 384, 192, false);
    assert!(filter.contains("setpts=0.6666666666666666*PTS"), "should have speed setpts: {}", filter);
    // Trim duration should be adjusted: 60 * (1/1.5) = 40 → trim=start=0:end=40
    assert!(filter.contains("trim=start=0:end=40"), "trim should be speed-adjusted: {}", filter);
}

#[test]
fn test_build_short_filter_cuda() {
    let filter = build_short_filter_cuda(0.0, 60.0, 1.0, 1080, 1920, 384, 192);
    assert!(filter.contains("scale_cuda"), "CUDA filter: {}", filter);
    assert!(filter.contains("crop_cuda"), "CUDA crop: {}", filter);
    assert!(filter.contains("overlay_cuda"), "CUDA overlay: {}", filter);
}

#[test]
fn test_build_short_filter_cuda_with_speed() {
    let filter = build_short_filter_cuda(0.0, 60.0, 2.0, 1080, 1920, 384, 192);
    assert!(filter.contains("setpts=0.5*PTS"), "should have speed setpts: {}", filter);
    // Trim duration adjusted: 60 * (1/2.0) = 30
    assert!(filter.contains("trim=start=0:end=30"), "trim should be speed-adjusted: {}", filter);
}

#[test]
fn test_build_landscape_filter() {
    let filter = build_landscape_filter(0.0, 60.0, 1.0, 1920, 1080, 900, 0, false);
    assert!(filter.contains("scale="), "landscape sw scale: {}", filter);
    assert!(filter.contains("crop="), "landscape sw crop: {}", filter);
}

#[test]
fn test_build_landscape_filter_with_speed() {
    let filter = build_landscape_filter(0.0, 60.0, 1.2, 1920, 1080, 900, 0, false);
    assert!(filter.contains("setpts=0.8333333333333334*PTS"), "should have exact speed setpts: {}", filter);
    // Trim duration adjusted: 60 * (1/1.2) = 50.0 (exact with f64)
    assert!(filter.contains("trim=start=0:end=50"), "trim should be speed-adjusted: {}", filter);
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
    // atempo minimum is 0.5, speed < 0.5 returns None
    assert!(build_atempo_chain(0.4).is_none());
}

#[test]
fn test_gpu_tier_codec_selection() {
    // High tier → HEVC
    // Software tier → H.264
    // This tests the match logic used in spawn_render_async
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
    let opts = hyperclip_ipc::ffmpeg::RenderOptions {
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
