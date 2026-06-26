// crates/hyperclip_ipc/src/store/workspace.rs

use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use super::{get_data_dir, is_relative_path, make_path_relative};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub status: String,  // pending|downloading|ready|rendering|done|error
    pub video_id: String,
    #[serde(rename = "channelId")]
    pub channel_id: String,
    pub title: String,
    #[serde(rename = "downloadedPath")]
    pub downloaded_path: Option<String>,
    #[serde(rename = "downloadedAt")]
    pub downloaded_at: Option<i64>,
    #[serde(rename = "downloadStartedAt")]
    pub download_started_at: Option<i64>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "publishedAt")]
    pub published_at: i64,
    #[serde(rename = "trimStart")]
    pub trim_start: f64,
    #[serde(rename = "trimEnd")]
    pub trim_end: f64,
    #[serde(rename = "videoSpeed")]
    pub video_speed: f64,
    #[serde(rename = "fpsTarget")]
    pub fps_target: u32,
    #[serde(rename = "exportResolution")]
    pub export_resolution: String,
    #[serde(rename = "isShort")]
    pub is_short: bool,
    #[serde(rename = "autoRender")]
    pub auto_render: bool,
    pub progress: Option<f64>,
    pub error: Option<String>,
    #[serde(rename = "availableFormats")]
    pub available_formats: Option<Vec<u32>>,
    #[serde(rename = "channelName")]
    pub channel_name: Option<String>,
    #[serde(rename = "renderedPath")]
    pub rendered_path: Option<String>,
    #[serde(rename = "thumbnailLocal")]
    pub thumbnail_local: Option<String>,
    #[serde(rename = "fileSize")]
    pub file_size: Option<u64>,
    #[serde(rename = "downloadSpeed")]
    pub download_speed: Option<String>,
    #[serde(rename = "downloadTime")]
    pub download_time: Option<String>,
    #[serde(rename = "durationSec")]
    pub duration_sec: Option<u64>,
    pub quality: Option<u32>,
    #[serde(rename = "originalDurationSec")]
    pub original_duration_sec: Option<u64>,
    #[serde(rename = "originalQuality")]
    pub original_quality: Option<u32>,
    #[serde(rename = "renderFps")]
    pub render_fps: Option<f64>,
    #[serde(rename = "renderWorkers")]
    pub render_workers: Option<u32>,
    #[serde(rename = "renderPreset")]
    pub render_preset: Option<String>,
    #[serde(rename = "renderCodec")]
    pub render_codec: Option<String>,
    #[serde(rename = "renderDurationSec")]
    pub render_duration_sec: Option<f64>,
    #[serde(rename = "bottomBarColor")]
    pub bottom_bar_color: Option<String>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            id: String::new(),
            status: "pending".to_string(),
            video_id: String::new(),
            channel_id: String::new(),
            title: String::new(),
            downloaded_path: None,
            downloaded_at: None,
            download_started_at: None,
            created_at: 0,
            published_at: 0,
            trim_start: 0.0,
            trim_end: 0.0,
            video_speed: 1.0,
            fps_target: 30,
            export_resolution: "1080x1920".to_string(),
            is_short: true,
            auto_render: true,
            progress: None,
            error: None,
            available_formats: None,
            channel_name: None,
            rendered_path: None,
            thumbnail_local: None,
            file_size: None,
            download_speed: None,
            download_time: None,
            duration_sec: None,
            quality: None,
            original_duration_sec: None,
            original_quality: None,
            render_fps: None,
            render_workers: None,
            render_preset: None,
            render_codec: None,
            render_duration_sec: None,
            bottom_bar_color: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspaceStore {
    pub workspaces: Vec<Workspace>,
}

impl WorkspaceStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            let mut store: Self = serde_json::from_str(&content).unwrap_or_default();
            
            // Clean up legacy bug: remove workspaces with recursive split parts (containing multiple "-part")
            store.workspaces.retain(|ws| {
                let count = ws.id.matches("-part").count();
                if count > 1 {
                    tracing::warn!("[WorkspaceStore] Removing corrupt workspace with recursive parts: {}", ws.id);
                    false
                } else {
                    true
                }
            });

            let data_dir = get_data_dir();
            for ws in &mut store.workspaces {
                if let Some(ref p) = ws.downloaded_path {
                    if is_relative_path(p) {
                        ws.downloaded_path = Some(data_dir.join(p).to_string_lossy().to_string());
                    }
                }
                if let Some(ref p) = ws.rendered_path {
                    if is_relative_path(p) {
                        ws.rendered_path = Some(data_dir.join(p).to_string_lossy().to_string());
                    }
                }
                if let Some(ref p) = ws.thumbnail_local {
                    if is_relative_path(p) {
                        ws.thumbnail_local = Some(data_dir.join(p).to_string_lossy().to_string());
                    }
                }
            }
            store
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let data_dir = get_data_dir();
        let mut store_to_save = self.clone();
        for ws in &mut store_to_save.workspaces {
            if let Some(ref p) = ws.downloaded_path {
                if let Some(rel) = make_path_relative(&data_dir, p) {
                    ws.downloaded_path = Some(rel);
                }
            }
            if let Some(ref p) = ws.rendered_path {
                if let Some(rel) = make_path_relative(&data_dir, p) {
                    ws.rendered_path = Some(rel);
                }
            }
            if let Some(ref p) = ws.thumbnail_local {
                if let Some(rel) = make_path_relative(&data_dir, p) {
                    ws.thumbnail_local = Some(rel);
                }
            }
        }
        let content = serde_json::to_string_pretty(&store_to_save).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    pub fn add(&mut self, ws: Workspace) {
        self.workspaces.retain(|w| w.id != ws.id);
        self.workspaces.insert(0, ws);
    }

    pub fn patch(&mut self, id: &str, field: &str, value: serde_json::Value) -> Result<(), String> {
        if let Some(ws) = self.workspaces.iter_mut().find(|w| w.id == id) {
            match field {
                "title" => ws.title = value.as_str().unwrap_or("").to_string(),
                "speed" => ws.video_speed = value.as_f64().unwrap_or(1.0),
                "trimStart" => ws.trim_start = value.as_f64().unwrap_or(0.0),
                "trimEnd" => ws.trim_end = value.as_f64().unwrap_or(0.0),
                "thumbnail" => ws.thumbnail_local = value.as_str().map(String::from),
                "bottomBarColor" => ws.bottom_bar_color = value.as_str().map(String::from),
                _ => return Err(format!("invalid field: {}", field)),
            }
            Ok(())
        } else {
            Err(format!("workspace not found: {}", id))
        }
    }

    pub fn update(&mut self, id: &str, data: serde_json::Value) -> Result<(), String> {
        if let Some(ws) = self.workspaces.iter_mut().find(|w| w.id == id) {
            // Merge fields from JSON
            if let Some(status) = data.get("status").and_then(|v| v.as_str()) {
                ws.status = status.to_string();
                if status == "downloading" || status == "rendering" || status == "ready" || status == "done" {
                    ws.error = None;
                }
            }
            if let Some(title) = data.get("title").and_then(|v| v.as_str()) {
                ws.title = title.to_string();
            }
            if let Some(path) = data.get("downloadedPath").and_then(|v| v.as_str()) {
                ws.downloaded_path = Some(path.to_string());
            }
            if let Some(path) = data.get("renderedPath").and_then(|v| v.as_str()) {
                ws.rendered_path = Some(path.to_string());
            }
            if let Some(thumb) = data.get("thumbnailLocal").and_then(|v| v.as_str()) {
                ws.thumbnail_local = Some(thumb.to_string());
            }
            if let Some(error) = data.get("error").and_then(|v| v.as_str()) {
                ws.error = Some(error.to_string());
            }
            if let Some(prog) = data.get("progress").and_then(|v| v.as_f64()) {
                ws.progress = Some(prog);
            }
            if let Some(formats) = data.get("availableFormats").and_then(|v| v.as_array()) {
                let f_vec: Vec<u32> = formats.iter().filter_map(|v| v.as_u64().map(|x| x as u32)).collect();
                ws.available_formats = Some(f_vec);
            }
            if let Some(t_start) = data.get("trimStart").and_then(|v| v.as_f64()) {
                ws.trim_start = t_start;
            }
            if let Some(t_end) = data.get("trimEnd").and_then(|v| v.as_f64()) {
                ws.trim_end = t_end;
            }
            if let Some(speed) = data.get("videoSpeed").and_then(|v| v.as_f64()) {
                ws.video_speed = speed;
            }
            if let Some(fps) = data.get("fpsTarget").and_then(|v| v.as_u64()) {
                ws.fps_target = fps as u32;
            }
            if let Some(res) = data.get("exportResolution").and_then(|v| v.as_str()) {
                ws.export_resolution = res.to_string();
            }
            if let Some(time_ms) = data.get("downloadedAt").and_then(|v| v.as_i64()) {
                ws.downloaded_at = Some(time_ms);
            }
            if let Some(time_ms) = data.get("downloadStartedAt").and_then(|v| v.as_i64()) {
                ws.download_started_at = Some(time_ms);
            }
            if let Some(speed) = data.get("downloadSpeed").and_then(|v| v.as_str()) {
                ws.download_speed = Some(speed.to_string());
            }
            if let Some(time_str) = data.get("downloadTime").and_then(|v| v.as_str()) {
                ws.download_time = Some(time_str.to_string());
            }
            if let Some(fps) = data.get("renderFps").and_then(|v| v.as_f64()) {
                ws.render_fps = Some(fps);
            }
            if let Some(workers) = data.get("renderWorkers").and_then(|v| v.as_u64()) {
                ws.render_workers = Some(workers as u32);
            }
            if let Some(preset) = data.get("renderPreset").and_then(|v| v.as_str()) {
                ws.render_preset = Some(preset.to_string());
            }
            if let Some(codec) = data.get("renderCodec").and_then(|v| v.as_str()) {
                ws.render_codec = Some(codec.to_string());
            }
            if let Some(is_short) = data.get("isShort").and_then(|v| v.as_bool()) {
                ws.is_short = is_short;
            }
            if let Some(quality) = data.get("quality").and_then(|v| v.as_u64()) {
                ws.quality = Some(quality as u32);
            }
            if let Some(file_size) = data.get("fileSize").and_then(|v| v.as_u64()) {
                ws.file_size = Some(file_size);
            }
            if let Some(duration_sec) = data.get("durationSec").and_then(|v| v.as_u64()) {
                ws.duration_sec = Some(duration_sec);
            }
            if let Some(orig_dur) = data.get("originalDurationSec").and_then(|v| v.as_u64()) {
                ws.original_duration_sec = Some(orig_dur);
            }
            if let Some(orig_qual) = data.get("originalQuality").and_then(|v| v.as_u64()) {
                ws.original_quality = Some(orig_qual as u32);
            }
            if let Some(render_dur) = data.get("renderDurationSec").and_then(|v| v.as_f64()) {
                ws.render_duration_sec = Some(render_dur);
            }
            if let Some(color) = data.get("bottomBarColor").and_then(|v| v.as_str()) {
                ws.bottom_bar_color = Some(color.to_string());
            }
            Ok(())
        } else {
            Err(format!("workspace not found: {}", id))
        }
    }

    pub fn remove(&mut self, id: &str) {
        self.workspaces.retain(|w| w.id != id);
    }

    pub fn get(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == id)
    }
}
