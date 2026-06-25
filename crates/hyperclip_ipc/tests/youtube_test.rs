use hyperclip_ipc::youtube::build_ytdlp_args;
use hyperclip_ipc::youtube::DownloadOptions;
use std::path::PathBuf;

#[test]
fn test_build_ytdlp_args_tv_embedded() {
    let opts = DownloadOptions {
        url: "https://youtube.com/watch?v=test".into(),
        output_path: PathBuf::from("/tmp/test.mp4"),
        trim_start: "00:00:00".into(),
        trim_end: "00:10:00".into(),
        quality: 1080,
        client_priority: vec!["tv_embedded".into(), "web".into()],
        concurrent_fragments: 16,
        cookies_file: None,
        multi_instance: 1,
        simulated_progress: false,
    };
    let args = build_ytdlp_args(&opts);
    assert!(args.iter().any(|a| a.contains("tv_embedded")), "Should contain tv_embedded: {:?}", args);
    assert!(args.iter().any(|a| a.starts_with("*00:00:00")), "Should have download-sections: {:?}", args);
    assert!(args.iter().any(|a| a == "16"), "Should have 16 fragments: {:?}", args);
}

#[test]
fn test_build_ytdlp_args_no_trim_when_empty() {
    let opts = DownloadOptions {
        url: "https://youtube.com/watch?v=test".into(),
        output_path: PathBuf::from("/tmp/test.mp4"),
        trim_start: "".into(),
        trim_end: "".into(),
        quality: 720,
        client_priority: vec!["tv_embedded".into()],
        concurrent_fragments: 8,
        cookies_file: None,
        multi_instance: 1,
        simulated_progress: false,
    };
    let args = build_ytdlp_args(&opts);
    assert!(!args.iter().any(|a| a.starts_with("*")), "No trim sections when empty: {:?}", args);
}
