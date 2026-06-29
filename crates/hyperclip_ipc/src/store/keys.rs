// crates/hyperclip_ipc/src/store/keys.rs

use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyEntry {
    pub key: String,
    pub name: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(default = "return_true")]
    pub valid: bool,
    #[serde(rename = "quotaUsed", default)]
    pub quota_used: u32,
    #[serde(rename = "quotaLimit", default = "default_quota_limit")]
    pub quota_limit: u32,
    #[serde(rename = "lastError")]
    pub last_error: Option<String>,
}

fn return_true() -> bool { true }
fn default_quota_limit() -> u32 { 10000 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct KeyStore {
    pub keys: Vec<KeyEntry>,
}

impl KeyStore {
    pub fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        super::paths::write_atomically(path, &content).map_err(|e| e.to_string())
    }


    pub fn add(&mut self, entry: KeyEntry) {
        self.keys.retain(|k| k.key != entry.key);
        self.keys.push(entry);
    }

    pub fn remove(&mut self, key: &str) {
        self.keys.retain(|k| k.key != key);
    }
}
