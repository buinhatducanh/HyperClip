// crates/hyperclip_ipc/src/store/settings.rs

use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use super::{get_data_dir, is_relative_path, make_path_relative};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SettingsStore {
    pub settings: serde_json::Value,
}

impl SettingsStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            let mut store: Self = serde_json::from_str(&content).unwrap_or_default();
            let data_dir = get_data_dir();
            if let Some(obj) = store.settings.as_object_mut() {
                for key in &["outputPath", "outputFolder", "videoStoragePath"] {
                    if let Some(val) = obj.get(*key).and_then(|v| v.as_str()) {
                        if is_relative_path(val) {
                            obj.insert(key.to_string(), serde_json::Value::String(data_dir.join(val).to_string_lossy().to_string()));
                        }
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
        if let Some(obj) = store_to_save.settings.as_object_mut() {
            for key in &["outputPath", "outputFolder", "videoStoragePath"] {
                if let Some(val) = obj.get(*key).and_then(|v| v.as_str()) {
                    if let Some(rel) = make_path_relative(&data_dir, val) {
                        obj.insert(key.to_string(), serde_json::Value::String(rel));
                    }
                }
            }
        }
        let content = serde_json::to_string_pretty(&store_to_save).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }
}
