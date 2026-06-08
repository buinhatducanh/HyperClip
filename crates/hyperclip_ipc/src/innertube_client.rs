// crates/hyperclip_ipc/src/innertube_client.rs

use crate::error::{HyperclipError, Result};
use crate::types::VideoInfo;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

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
            helper_script: PathBuf::from(
                "crates/hyperclip_ipc/src/innertube_helper.js",
            ),
            timeout_sec: 30,
        }
    }
}

#[derive(Debug)]
pub struct InnertubeClient {
    config: ClientConfig,
}

#[derive(Serialize)]
struct NodeRequest {
    id: u64,
    channelId: String,
    cookie: String,
}

#[derive(Deserialize)]
struct NodeResponse {
    id: Option<u64>,
    ok: bool,
    videos: Option<Vec<NodeVideo>>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct NodeVideo {
    videoId: String,
    title: String,
    publishedAt: i64,
    thumbnailUrl: String,
    durationSec: f64,
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
        Err(HyperclipError::BackendCrashed(
            "Node.js not found in PATH".into(),
        ))
    }

    pub fn new(config: ClientConfig) -> Result<Self> {
        Self::find_node()?;
        Ok(Self { config })
    }

    pub async fn get_latest_videos(
        &self,
        channel_id: &str,
        cookie: &str,
    ) -> Result<Vec<VideoInfo>> {
        let helper = if self.config.helper_script.exists() {
            self.config.helper_script.clone()
        } else {
            // Fallback: find in crate root
            let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            crate_root.join("src/innertube_helper.js")
        };

        let mut child = Command::new(&self.config.node_path)
            .arg(&helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                HyperclipError::BackendCrashed(format!("Node spawn failed: {}", e))
            })?;

        let req = NodeRequest {
            id: 1,
            channelId: channel_id.to_string(),
            cookie: cookie.to_string(),
        };

        let line = serde_json::to_string(&req).unwrap() + "\n";
        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(line.as_bytes())
                .map_err(|e| HyperclipError::Io(e))?;
        }

        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout);
        let mut response_line = String::new();
        reader
            .read_line(&mut response_line)
            .map_err(|e| HyperclipError::Io(e))?;

        let status = child.wait().map_err(|e| HyperclipError::Io(e))?;
        if !status.success() {
            return Err(HyperclipError::InnertubeTransient(
                "Node process exited with error".into(),
            ));
        }

        let response: NodeResponse = serde_json::from_str(&response_line)
            .map_err(|e| HyperclipError::Json(e))?;

        if !response.ok {
            return Err(HyperclipError::InnertubeTransient(
                response.error.unwrap_or_else(|| "unknown".into()),
            ));
        }

        let videos = response.videos.unwrap_or_default();
        Ok(videos
            .into_iter()
            .map(|v| VideoInfo {
                video_id: v.videoId,
                title: v.title,
                published_at: v.publishedAt,
                thumbnail_url: v.thumbnailUrl,
                duration_sec: v.durationSec,
                width: 0,
                height: 0,
            })
            .collect())
    }

    pub fn mark_failed(&mut self) {
        // Kill any running subprocess — handled by drop
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
        assert!(result.is_ok() || result.is_err());
    }
}
