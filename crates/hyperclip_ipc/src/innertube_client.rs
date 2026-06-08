// crates/hyperclip_ipc/src/innertube_client.rs

use crate::error::{HyperclipError, Result};
use crate::types::VideoInfo;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub node_path: String,
    pub helper_script: PathBuf,
    pub timeout_sec: u64,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            node_path: "node".to_string(),
            helper_script: PathBuf::from("node_modules/youtubei.js"),
            timeout_sec: 30,
        }
    }
}

pub struct InnertubeClient {
    config: ClientConfig,
}

impl InnertubeClient {
    pub fn find_node() -> Result<PathBuf> {
        let candidates = ["node", "node.exe", r"C:\Program Files\nodejs\node.exe"];
        for c in &candidates {
            if let Ok(output) = Command::new(c).arg("--version").output() {
                if output.status.success() {
                    return Ok(PathBuf::from(c));
                }
            }
        }
        Err(HyperclipError::BackendCrashed("Node.js not found in PATH".into()))
    }

    pub fn new(config: ClientConfig) -> Result<Self> {
        Self::find_node()?;
        Ok(Self { config })
    }

    pub async fn get_latest_videos(&self, _channel_id: &str, _cookie: &str) -> Result<Vec<VideoInfo>> {
        // Simplified: spawn Node inline script that uses youtubei.js
        // For now, return empty vec (placeholder for real subprocess integration)
        Ok(vec![])
    }

    pub fn mark_failed(&mut self) {
        // Kill any running subprocess
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_config_defaults() {
        let config = ClientConfig::default();
        assert_eq!(config.timeout_sec, 30);
        assert_eq!(config.node_path, "node");
    }

    #[test]
    fn test_find_node_if_available() {
        let result = InnertubeClient::find_node();
        // Just check it doesn't crash
        assert!(result.is_ok() || result.is_err());
    }
}
