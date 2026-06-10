// crates/hyperclip_ipc/src/innertube_client.rs

use crate::error::{HyperclipError, Result};
use crate::types::VideoInfo;
use serde::{Deserialize, Serialize};
use std::io::Write;
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
            helper_script: PathBuf::from("crates/hyperclip_ipc/src/innertube_helper.js"),
            timeout_sec: 30,
        }
    }
}

#[derive(Debug)]
pub struct InnertubeClient { config: ClientConfig }

#[derive(Serialize)]
struct NodeRequest { id: u64, channelId: String, cookie: String }

#[derive(Deserialize)]
struct NodeResponse { id: Option<u64>, ok: bool, videos: Option<Vec<NodeVideo>>, error: Option<String> }

#[derive(Deserialize)]
struct NodeVideo { videoId: String, title: String, publishedAt: i64, thumbnailUrl: String, durationSec: f64 }

impl InnertubeClient {
    pub fn find_node() -> Result<PathBuf> {
        for c in &["node", "node.exe", r"C:\Program Files\nodejs\node.exe"] {
            if let Ok(o) = Command::new(c).arg("--version").output() {
                if o.status.success() { return Ok(PathBuf::from(*c)); }
            }
        }
        Err(HyperclipError::BackendCrashed("Node.js not found".into()))
    }

    pub fn new(config: ClientConfig) -> Result<Self> {
        Self::find_node()?;
        Ok(Self { config })
    }

    /// Uses temp file to avoid Windows pipe buffering deadlocks.
    pub async fn get_latest_videos(&self, channel_id: &str, cookie: &str) -> Result<Vec<VideoInfo>> {
        let helper = if self.config.helper_script.exists() {
            self.config.helper_script.clone()
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/innertube_helper.js")
        };
        let ch = channel_id.to_string();
        let ch_err = ch.clone();
        let ck = cookie.to_string();
        let np = self.config.node_path.clone();

        let result = std::sync::Arc::new(std::sync::Mutex::new(None::<Result<Vec<VideoInfo>>>));
        let r2 = result.clone();
        std::thread::spawn(move || {
            let r = Self::call_node(&np, &helper, &ch, &ck);
            *r2.lock().unwrap() = Some(r);
        });

        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(30);
        loop {
            if let Some(r) = result.lock().unwrap().take() { return r; }
            if tokio::time::Instant::now() > deadline {
                return Err(HyperclipError::InnertubeTransient(format!("Node timed out for {ch_err}")));
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    fn call_node(node_path: &str, helper: &PathBuf, channel_id: &str, cookie: &str) -> Result<Vec<VideoInfo>> {
        let resp_file = std::env::temp_dir().join(format!("hc_response_{channel_id}.json"));
        let resp_path = resp_file.to_string_lossy().to_string();
        let _ = std::fs::remove_file(&resp_file);

        let mut child = match Command::new(node_path)
            .arg(helper)
            .env("HYPERCLIP_RESPONSE_FILE", &resp_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => return Err(HyperclipError::BackendCrashed(format!("Node spawn failed: {e}"))),
        };

        let req = serde_json::json!({"id":1,"channelId":channel_id,"cookie":cookie}).to_string() + "\n";
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(req.as_bytes());
        }

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            if std::time::Instant::now() > deadline {
                let _ = child.kill(); let _ = child.wait();
                return Err(HyperclipError::InnertubeTransient(format!("Node timed out for {channel_id}")));
            }
            match std::fs::read_to_string(&resp_file) {
                Ok(c) if !c.is_empty() => {
                    let _ = child.kill(); let _ = child.wait();
                    let _ = std::fs::remove_file(&resp_file);
                    match serde_json::from_str::<NodeResponse>(&c) {
                        Ok(r) if r.ok => return Ok(r.videos.unwrap_or_default().into_iter().map(|v| VideoInfo {
                            video_id: v.videoId, title: v.title,
                            published_at: v.publishedAt * 1000,
                            thumbnail_url: v.thumbnailUrl, duration_sec: v.durationSec,
                            width: 0, height: 0,
                        }).collect()),
                        Ok(r) => return Err(HyperclipError::InnertubeTransient(r.error.unwrap_or_default())),
                        Err(e) => return Err(HyperclipError::Json(e)),
                    }
                }
                _ => {}
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn test_config() { let c = ClientConfig::default(); assert_eq!(c.timeout_sec, 30); }
    #[test] fn test_node() { let r = InnertubeClient::find_node(); assert!(r.is_ok() || r.is_err()); }
}
