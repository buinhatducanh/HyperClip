// crates/hyperclip_ipc/src/types.rs
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// All IPC commands. We use a single catch-all variant with arbitrary params
/// instead of an explicit enum, because the command set is large (80+ channels)
/// and grows often. This avoids touching the type system every time a new
/// IPC channel is added — only `commands.rs` needs an entry in the dispatch
/// table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    pub id: u64,
    #[serde(rename = "cmd")]
    pub command: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "method")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl IpcResponse {
    pub fn ok(id: Value, result: Value) -> Self {
        Self { id, ok: Some(true), result: Some(result), error: None, method: None, params: None }
    }
    pub fn err(id: Value, error: String) -> Self {
        Self { id, ok: Some(false), result: None, error: Some(error), method: None, params: None }
    }
    pub fn event(method: &str, params: Value) -> Self {
        Self {
            id: Value::Null,
            ok: None,
            result: None,
            error: None,
            method: Some(method.to_string()),
            params: Some(params),
        }
    }
}

// Re-export BackendCommand for backwards compat
pub type BackendCommand = IpcRequest;

// ─── Domain types (added WS1 Task 1) ───────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceStatus {
    New,
    Waiting,
    Downloading,
    Ready,
    Rendering,
    Done,
    Error,
}

impl Default for WorkspaceStatus {
    fn default() -> Self { Self::New }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub channel_id: String,
    pub channel_name: String,
    pub video_id: String,
    pub video_url: String,
    pub title: String,
    pub thumbnail_url: String,
    pub thumbnail_local_path: Option<String>,
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub published_at: i64,
    pub detected_at: i64,
    pub status: WorkspaceStatus,
    pub error_message: Option<String>,
    pub speed: f32,
    pub trim_start_sec: f64,
    pub trim_end_sec: f64,
    pub quality_target: u32,
    pub trim_limit_minutes: u32,
    pub downloaded_path: Option<String>,
    pub downloaded_size_bytes: u64,
    pub downloaded_at: Option<i64>,
    pub download_started_at: Option<i64>,
    pub rendered_path: Option<String>,
    pub rendered_size_bytes: u64,
    pub rendered_at: Option<i64>,
    pub render_duration_sec: f64,
    pub auto_render_attempted: bool,
    pub auto_render_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for Workspace {
    fn default() -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            id: String::new(),
            channel_id: String::new(),
            channel_name: String::new(),
            video_id: String::new(),
            video_url: String::new(),
            title: String::new(),
            thumbnail_url: String::new(),
            thumbnail_local_path: None,
            duration_sec: 0.0,
            width: 0,
            height: 0,
            published_at: 0,
            detected_at: now,
            status: WorkspaceStatus::default(),
            error_message: None,
            speed: 1.0,
            trim_start_sec: 0.0,
            trim_end_sec: 0.0,
            quality_target: 1080,
            trim_limit_minutes: 10,
            downloaded_path: None,
            downloaded_size_bytes: 0,
            downloaded_at: None,
            download_started_at: None,
            rendered_path: None,
            rendered_size_bytes: 0,
            rendered_at: None,
            render_duration_sec: 0.0,
            auto_render_attempted: false,
            auto_render_error: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub channel_id: String,
    #[serde(default)]
    pub handle: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    pub added_at: i64,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub last_video_id: Option<String>,
    #[serde(default)]
    pub last_poll_at: Option<i64>,
    #[serde(default)]
    pub new_video_count: u32,
    #[serde(default)]
    pub total_videos_downloaded: u32,
    #[serde(default)]
    pub error_count: u32,
}

impl Default for Channel {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            channel_id: String::new(),
            handle: None,
            avatar_url: None,
            added_at: chrono::Utc::now().timestamp_millis(),
            paused: false,
            last_video_id: None,
            last_poll_at: None,
            new_video_count: 0,
            total_videos_downloaded: 0,
            error_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub polling_enabled: bool,
    pub poll_interval_ms: u64,
    pub video_min_duration_sec: u32,
    pub video_max_duration_sec: u32,
    pub max_video_age_minutes: u32,
    pub auto_download_enabled: bool,
    pub default_trim_limit_minutes: u32,
    pub default_quality: u32,
    pub max_concurrent_downloads: u32,
    pub yt_dlp_client_priority: Vec<String>,
    pub auto_render: bool,
    pub auto_render_resolution: String,
    pub auto_render_fps: u32,
    pub auto_render_speed: f32,
    pub auto_split_parts: u32,
    pub auto_split_minutes: u32,
    pub auto_render_title_template: String,
    pub max_concurrent_renders: u32,
    pub hardware_profile: Option<String>,
    pub gpu_tier_override: Option<String>,
    pub video_storage_path: Option<String>,
    pub output_path: Option<String>,
    pub downloads_cleanup_days: u32,
    pub minimize_to_tray: bool,
    pub innertube_pool_size: u32,
}

impl Settings {
    pub fn defaults() -> Self {
        Self {
            polling_enabled: true,
            poll_interval_ms: 5000,
            video_min_duration_sec: 60,
            video_max_duration_sec: 3600,
            max_video_age_minutes: 10,
            auto_download_enabled: true,
            default_trim_limit_minutes: 10,
            default_quality: 1080,
            max_concurrent_downloads: 1,
            yt_dlp_client_priority: vec![
                "tv_embedded".into(),
                "web".into(),
                "ios".into(),
            ],
            auto_render: true,  // CHANGED: default true
            auto_render_resolution: "1080p".into(),
            auto_render_fps: 30,
            auto_render_speed: 1.0,
            auto_split_parts: 1,
            auto_split_minutes: 0,
            auto_render_title_template: "{title}".into(),
            max_concurrent_renders: 2,
            hardware_profile: None,
            gpu_tier_override: None,
            video_storage_path: None,
            output_path: None,
            downloads_cleanup_days: 0,
            minimize_to_tray: true,
            innertube_pool_size: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub video_id: String,
    pub title: String,
    pub published_at: i64,
    pub thumbnail_url: String,
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
}
