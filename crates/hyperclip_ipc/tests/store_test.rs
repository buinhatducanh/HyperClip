use std::env;
use std::fs;
use hyperclip_ipc::store::{build_render_path, get_store_dir, Workspace, WorkspaceStore};

#[test]
fn test_build_render_path_split() {
    // Create a temporary directory unique to this test run
    let test_dir = env::temp_dir().join(format!("hyperclip_test_{}", rand::random::<u64>()));
    fs::create_dir_all(&test_dir).unwrap();
    
    // Point HYPERCLIP_DATA_DIR to our test temp directory
    env::set_var("HYPERCLIP_DATA_DIR", &test_dir);
    
    let store_dir = get_store_dir();
    fs::create_dir_all(&store_dir).unwrap();
    
    // Write a mock workspaces.json
    let workspaces_path = store_dir.join("workspaces.json");
    let workspaces = vec![
        Workspace {
            id: "ws-parent-123".to_string(),
            status: "done".to_string(),
            video_id: "vid-123".to_string(),
            channel_id: "ch-123".to_string(),
            title: "Parent Video Title".to_string(),
            channel_name: Some("Channel Name".to_string()),
            ..Default::default()
        },
        Workspace {
            id: "ws-parent-123-part1".to_string(),
            status: "ready".to_string(),
            video_id: "vid-123".to_string(),
            channel_id: "ch-123".to_string(),
            title: "Parent Video Title (Part 1)".to_string(),
            channel_name: Some("Channel Name".to_string()),
            ..Default::default()
        },
        Workspace {
            id: "ws-parent-123-part2".to_string(),
            status: "ready".to_string(),
            video_id: "vid-123".to_string(),
            channel_id: "ch-123".to_string(),
            title: "Parent Video Title (Part 2)".to_string(),
            channel_name: Some("Channel Name".to_string()),
            ..Default::default()
        },
    ];
    let store_data = WorkspaceStore { workspaces };
    let json_content = serde_json::to_string(&store_data).unwrap();
    fs::write(&workspaces_path, json_content).unwrap();

    // 1. Test template default: {title}
    let settings_path = store_dir.join("settings.json");
    let settings_json = r#"{"settings": {}}"#; // no autoRenderTitleTemplate set, defaults to {title}
    fs::write(&settings_path, settings_json).unwrap();
    
    let path_part1 = build_render_path("ch-123", "Channel Name", "ws-parent-123-part1");
    // Under default settings template, since there are split parts, it resolves to part 1.mp4
    let file_name_part1 = path_part1.file_name().unwrap().to_str().unwrap();
    assert_eq!(file_name_part1, "Parent Video Title_part1.mp4");

    // 2. Test template: PART {part}
    let settings_json = r#"{"settings": {"autoRenderTitleTemplate": "PART {part}"}}"#;
    fs::write(&settings_path, settings_json).unwrap();
    let path_part2 = build_render_path("ch-123", "Channel Name", "ws-parent-123-part2");
    let file_name_part2 = path_part2.file_name().unwrap().to_str().unwrap();
    assert_eq!(file_name_part2, "PART 2_vid-123.mp4");

    // 3. Test template with {title} and {part}
    let settings_json = r#"{"settings": {"autoRenderTitleTemplate": "{title} - P{part}"}}"#;
    fs::write(&settings_path, settings_json).unwrap();
    let path_part2_cust = build_render_path("ch-123", "Channel Name", "ws-parent-123-part2");
    let file_name_part2_cust = path_part2_cust.file_name().unwrap().to_str().unwrap();
    assert_eq!(file_name_part2_cust, "Parent Video Title - P2.mp4");

    // Cleanup
    fs::remove_dir_all(&test_dir).ok();
}
