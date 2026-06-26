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
    assert!(args.iter().any(|a| a.starts_with("*00:00:00-")), "Should have download-sections: {:?}", args);
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

#[test]
fn test_build_ytdlp_args_default_priority_is_passed() {
    let opts = DownloadOptions {
        url: "https://youtube.com/watch?v=test".into(),
        output_path: PathBuf::from("/tmp/test.mp4"),
        trim_start: "".into(),
        trim_end: "".into(),
        quality: 720,
        client_priority: vec!["tv_embedded".into(), "web".into(), "ios".into()],
        concurrent_fragments: 8,
        cookies_file: None,
        multi_instance: 1,
        simulated_progress: false,
    };
    let args = build_ytdlp_args(&opts);
    assert!(args.iter().any(|a| a == "--extractor-args"), "Should pass --extractor-args even for default priority: {:?}", args);
    assert!(args.iter().any(|a| a.contains("tv_embedded,web,ios")), "Should contain default priority: {:?}", args);
}

#[test]
fn test_get_youtube_client_priority_default() {
    let rand_id = rand::random::<u32>();
    let temp_path = std::env::temp_dir().join(format!("hyperclip_test_{}", rand_id));
    std::env::set_var("HYPERCLIP_DATA_DIR", &temp_path);
    let priority = hyperclip_ipc::youtube::get_youtube_client_priority();
    assert_eq!(priority, "tv_embedded,web,ios");
    std::env::remove_var("HYPERCLIP_DATA_DIR");
}


