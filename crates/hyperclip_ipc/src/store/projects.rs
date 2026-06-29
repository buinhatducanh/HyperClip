// crates/hyperclip_ipc/src/store/projects.rs

use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectEntry {
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub name: String,
    #[serde(rename = "clientId")]
    pub client_id: String,
    #[serde(default = "return_true")]
    pub healthy: bool,
    #[serde(rename = "quotaUsed", default)]
    pub quota_used: u32,
    #[serde(rename = "quotaLimit", default = "default_quota_limit")]
    pub quota_limit: u32,
    pub error: Option<String>,
    #[serde(rename = "lastRefresh")]
    pub last_refresh: i64,
}

fn return_true() -> bool { true }
fn default_quota_limit() -> u32 { 10000 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectStore {
    pub projects: Vec<ProjectEntry>,
}

impl ProjectStore {
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


    pub fn add(&mut self, entry: ProjectEntry) {
        self.projects.retain(|p| p.project_id != entry.project_id);
        self.projects.push(entry);
    }

    pub fn remove(&mut self, project_id: &str) {
        self.projects.retain(|p| p.project_id != project_id);
    }
}
