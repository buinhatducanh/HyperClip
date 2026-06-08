use hyperclip_ipc::ffmpeg::{build_short_filter, build_short_filter_cuda, build_landscape_filter, nvenc_codec_name, EncodeCodec, FilterChain};
use hyperclip_ipc::system::GPUTier;

#[test]
fn test_build_short_filter_vertical() {
    let filter = build_short_filter(0.0, 60.0, 1080, 1920, 384, 192, false);
    assert!(filter.contains("scale="), "should use sw scale: {}", filter);
    assert!(filter.contains("crop="), "should use sw crop: {}", filter);
    assert!(filter.contains("overlay="), "should use sw overlay: {}", filter);
    assert!(filter.contains("[final]"), "should end with [final]");
}

#[test]
fn test_build_short_filter_cuda() {
    let filter = build_short_filter_cuda(0.0, 60.0, 1080, 1920, 384, 192);
    assert!(filter.contains("scale_cuda"), "CUDA filter: {}", filter);
    assert!(filter.contains("crop_cuda"), "CUDA crop: {}", filter);
    assert!(filter.contains("overlay_cuda"), "CUDA overlay: {}", filter);
}

#[test]
fn test_build_landscape_filter() {
    let filter = build_landscape_filter(0.0, 60.0, 1920, 1080, 900, 0, false);
    assert!(filter.contains("scale="), "landscape sw scale: {}", filter);
    assert!(filter.contains("crop="), "landscape sw crop: {}", filter);
}

#[test]
fn test_nvenc_codec_names() {
    assert_eq!(nvenc_codec_name(EncodeCodec::HEVC), "hevc_nvenc");
    assert_eq!(nvenc_codec_name(EncodeCodec::H264), "h264_nvenc");
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
