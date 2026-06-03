use hyperclip_core::workspace::{TrimLimit, WorkspaceData, WorkspaceStatus};

const SAMPLE_1: &str = "{\"id\":\"ws1\",\"channelId\":\"ch1\",\"channelName\":\"Test Channel\",\"channelColor\":\"#ff00ff\",\"videoId\":\"vid1\",\"videoTitle\":\"Hello\",\"videoUrl\":\"https://youtu.be/vid1\",\"thumbnail\":\"https://i.ytimg.com/vi/vid1/0.jpg\",\"duration\":120.5,\"trimLimit\":5.0,\"status\":\"waiting\",\"renderProgress\":0,\"downloadedAt\":\"2026-06-03T10:00:00Z\",\"downloadedPath\":\"vid1.mp4\",\"blurBackgroundPath\":\"\",\"outputPath\":\"out.mp4\",\"metadataPath\":\"meta.json\",\"fileSize\":12345678,\"renderMetadata\":null}";

const SAMPLE_ERROR: &str = "{\"id\":\"ws2\",\"channelId\":\"c\",\"channelName\":\"n\",\"channelColor\":\"#fff\",\"videoId\":\"v\",\"videoTitle\":\"t\",\"videoUrl\":\"u\",\"thumbnail\":\"th\",\"duration\":1.0,\"trimLimit\":\"full\",\"status\":\"error\",\"renderProgress\":0,\"downloadedAt\":\"x\",\"downloadedPath\":\"\",\"blurBackgroundPath\":\"\",\"outputPath\":\"\",\"metadataPath\":\"\",\"fileSize\":0,\"renderMetadata\":null}";

const SAMPLE_NO_PROGRESS: &str = "{\"id\":\"ws3\",\"channelId\":\"c\",\"channelName\":\"n\",\"channelColor\":\"#fff\",\"videoId\":\"v\",\"videoTitle\":\"t\",\"videoUrl\":\"u\",\"thumbnail\":\"th\",\"duration\":1.0,\"trimLimit\":3.0,\"status\":\"ready\",\"renderProgress\":0,\"downloadedAt\":\"x\",\"downloadedPath\":\"\",\"blurBackgroundPath\":\"\",\"outputPath\":\"\",\"metadataPath\":\"\",\"fileSize\":0,\"renderMetadata\":null}";

#[test]
fn workspace_data_roundtrips_via_json() {
    let ws: WorkspaceData = serde_json::from_str(SAMPLE_1).expect("parse");
    assert_eq!(ws.id, "ws1");
    assert_eq!(ws.status, WorkspaceStatus::Waiting);
    assert_eq!(ws.trim_limit, TrimLimit::Minutes(5.0));

    let serialized = serde_json::to_string(&ws).expect("serialize");
    let parsed_back: WorkspaceData = serde_json::from_str(&serialized).expect("roundtrip");
    assert_eq!(ws, parsed_back);
}

#[test]
fn workspace_status_error_lowercases() {
    let ws: WorkspaceData = serde_json::from_str(SAMPLE_ERROR).expect("parse");
    assert_eq!(ws.status, WorkspaceStatus::Error);
    assert_eq!(ws.trim_limit, TrimLimit::Full);
}

#[test]
fn download_progress_is_optional() {
    let ws: WorkspaceData = serde_json::from_str(SAMPLE_NO_PROGRESS).expect("parse");
    assert!(ws.download_progress.is_none());
}
