// crates/hyperclip_ipc/src/store/rendered_videos.rs

use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use super::{get_data_dir, is_relative_path, make_path_relative};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderedVideo {
    pub id: String,
    pub title: String,
    #[serde(rename = "channelName")]
    pub channel_name: Option<String>,
    #[serde(rename = "outputPath")]
    pub output_path: String,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    pub duration: f64,
    #[serde(rename = "renderedAt")]
    pub rendered_at: i64,
    pub quality: String,
    #[serde(default)]
    pub archived: bool,
    pub thumbnail: Option<String>,
    pub resolution: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RenderedStore {
    pub videos: Vec<RenderedVideo>,
}

impl RenderedStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            let mut store: Self = serde_json::from_str(&content).unwrap_or_default();
            let data_dir = get_data_dir();
            for v in &mut store.videos {
                if is_relative_path(&v.output_path) {
                    v.output_path = data_dir.join(&v.output_path).to_string_lossy().to_string();
                }
                if let Some(ref p) = v.thumbnail {
                    if is_relative_path(p) {
                        v.thumbnail = Some(data_dir.join(p).to_string_lossy().to_string());
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
        for v in &mut store_to_save.videos {
            if let Some(rel) = make_path_relative(&data_dir, &v.output_path) {
                v.output_path = rel;
            }
            if let Some(ref p) = v.thumbnail {
                if let Some(rel) = make_path_relative(&data_dir, p) {
                    v.thumbnail = Some(rel);
                }
            }
        }
        let content = serde_json::to_string_pretty(&store_to_save).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    pub fn add(&mut self, video: RenderedVideo) {
        self.videos.retain(|v| v.id != video.id);
        self.videos.push(video);
    }

    pub fn remove(&mut self, id: &str) {
        self.videos.retain(|v| v.id != id);
    }

    pub fn update(&mut self, id: &str, patch: &serde_json::Value) {
        if let Some(v) = self.videos.iter_mut().find(|v| v.id == id) {
            if let Some(val) = patch.get("archived").and_then(|v| v.as_bool()) {
                v.archived = val;
            }
            if let Some(val) = patch.get("outputPath").and_then(|v| v.as_str()) {
                v.output_path = val.to_string();
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<&RenderedVideo> {
        self.videos.iter().find(|v| v.id == id)
    }
}
