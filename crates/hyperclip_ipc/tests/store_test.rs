use std::env;
use std::fs;
use hyperclip_ipc::store::{build_render_path, get_store_dir, Workspace, WorkspaceStore, ChannelStore};

#[test]
fn test_channel_store_load_shapes() {
    let test_dir = env::temp_dir().join(format!("hyperclip_ch_test_{}", rand::random::<u64>()));
    fs::create_dir_all(&test_dir).unwrap();

    let file_path = test_dir.join("channels.json");

    // 1. Standard format
    let standard_json = r#"{
        "channels": [
            {
                "id": "ch1",
                "name": "Channel One",
                "handle": "@ch1",
                "enabled": true,
                "paused": false
            }
        ]
    }"#;
    fs::write(&file_path, standard_json).unwrap();
    let store = ChannelStore::load(&file_path);
    assert_eq!(store.channels.len(), 1);
    assert_eq!(store.channels[0].id, "ch1");
    assert_eq!(store.channels[0].name, "Channel One");

    // 2. Bare array format
    let bare_json = r#"[
        {
            "id": "ch2",
            "name": "Channel Two",
            "handle": "@ch2",
            "enabled": true,
            "paused": true
        }
    ]"#;
    fs::write(&file_path, bare_json).unwrap();
    let store = ChannelStore::load(&file_path);
    assert_eq!(store.channels.len(), 1);
    assert_eq!(store.channels[0].id, "ch2");
    assert_eq!(store.channels[0].name, "Channel Two");
    assert!(store.channels[0].paused);

    // 3. Envelope format
    let envelope_json = r#"{
        "id": "msg-123",
        "result": {
            "channels": [
                {
                    "id": "ch3",
                    "name": "Channel Three",
                    "handle": "@ch3",
                    "enabled": false,
                    "paused": false
                }
            ]
        }
    }"#;
    fs::write(&file_path, envelope_json).unwrap();
    let store = ChannelStore::load(&file_path);
    assert_eq!(store.channels.len(), 1);
    assert_eq!(store.channels[0].id, "ch3");
    assert_eq!(store.channels[0].name, "Channel Three");
    assert!(!store.channels[0].enabled);

    fs::remove_dir_all(&test_dir).ok();
}

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
    assert_eq!(file_name_part1, "part 1.mp4");

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
