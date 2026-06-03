use hyperclip_core::workspace::{TrimLimit, WorkspaceData, WorkspaceStatus};
use hyperclip_store::workspaces::Store;
use std::path::PathBuf;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("sample_workspaces.json")
}

#[tokio::test]
async fn list_loads_workspaces_from_disk() {
    let store = Store::new(fixture_path());
    let workspaces = store.list().await.expect("list");
    assert_eq!(workspaces.len(), 2);
    assert_eq!(workspaces[0].id, "ws-fixture-1");
    assert_eq!(
        workspaces[1].status,
        WorkspaceStatus::Downloading
    );
}

#[tokio::test]
async fn cache_returns_same_value_within_ttl() {
    let store = Store::new(fixture_path());
    let first = store.list().await.expect("list");
    let second = store.list().await.expect("list 2");
    assert_eq!(first.len(), second.len());
    assert_eq!(first[0].id, second[0].id);
}

#[tokio::test]
async fn list_returns_empty_when_file_missing() {
    let store = Store::new(PathBuf::from("Z:/this/does/not/exist.json"));
    let workspaces = store.list().await.expect("list empty");
    assert!(workspaces.is_empty());
}

#[tokio::test]
async fn save_then_list_roundtrips() {
    let tmp = std::env::temp_dir().join(format!(
        "hc-test-{}-{}.json",
        std::process::id(),
        chrono_lite_ts()
    ));
    let _ = std::fs::remove_file(&tmp);

    let store = Store::new(tmp.clone());
    let original = store.list().await.expect("first list");
    assert!(original.is_empty());

    let new_ws = vec![WorkspaceData {
        id: "roundtrip-1".into(),
        channel_id: "c".into(),
        channel_name: "n".into(),
        channel_color: "#fff".into(),
        video_id: "v".into(),
        video_title: "t".into(),
        video_url: "u".into(),
        thumbnail: "th".into(),
        duration: 1.0,
        trim_limit: TrimLimit::Full,
        status: WorkspaceStatus::Waiting,
        render_progress: 0.0,
        download_progress: None,
        downloaded_at: "x".into(),
        downloaded_path: "".into(),
        blur_background_path: "".into(),
        output_path: "".into(),
        metadata_path: "".into(),
        file_size: 0,
        render_metadata: None,
    }];

    store.save(&new_ws).await.expect("save");
    store.invalidate().await;

    let store2 = Store::new(tmp.clone());
    let loaded = store2.list().await.expect("re-load");
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, "roundtrip-1");
    assert_eq!(loaded[0].trim_limit, TrimLimit::Full);

    let _ = std::fs::remove_file(&tmp);
}

fn chrono_lite_ts() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}
