// crates/hyperclip_ipc/src/innertube_client.rs
//
// Persistent Node.js worker for YouTube Innertube API.
// Instead of spawning a new Node process per poll, keeps one alive
// communicating via stdin/stdout JSON-RPC.

use crate::error::{HyperclipError, Result};
use crate::types::VideoInfo;
use serde::Deserialize;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;

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
            helper_script: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/innertube_helper.js"),
            timeout_sec: 30,
        }
    }
}

/// Response from Node daemon for a poll request
#[derive(Deserialize)]
struct NodeResponse {
    id: Option<u64>,
    #[serde(default)]
    ok: bool,
    videos: Option<Vec<NodeVideo>>,
    error: Option<String>,
    // Daemon lifecycle fields
    #[serde(default)]
    daemon: bool,
    #[serde(default)]
    cmd: Option<String>,
}

#[derive(Deserialize)]
struct NodeVideo {
    #[serde(rename = "videoId")]
    video_id: String,
    title: String,
    #[serde(rename = "publishedAt", default)]
    published_at: i64,
    #[serde(rename = "thumbnailUrl", default)]
    thumbnail_url: String,
    #[serde(rename = "durationSec", default)]
    duration_sec: f64,
    #[serde(rename = "channelId", default)]
    channel_id: Option<String>,
    #[serde(rename = "channelName", default)]
    channel_name: Option<String>,
}

/// A persistent Node.js worker that communicates via stdin/stdout.
/// The child process is spawned once with `--daemon` and kept alive.
/// A background reader thread continuously reads stdout lines into a channel.
pub struct InnertubeClient {
    config: ClientConfig,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    /// Channel receiver for lines read by the background reader thread
    line_rx: Option<mpsc::Receiver<String>>,
    req_counter: AtomicU64,
    /// Active client counter to decrement on drop
    pub drop_counter: Option<std::sync::Arc<std::sync::atomic::AtomicUsize>>,
}

unsafe impl Send for InnertubeClient {}
unsafe impl Sync for InnertubeClient {}

impl std::fmt::Debug for InnertubeClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InnertubeClient")
            .field("alive", &self.child.is_some())
            .finish()
    }
}

impl Drop for InnertubeClient {
    fn drop(&mut self) {
        self.kill_child();
        if let Some(ref counter) = self.drop_counter {
            counter.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

impl InnertubeClient {
    pub fn find_node() -> Result<PathBuf> {
        // 1. Try bundled Node.js in resources first
        let bundled = crate::store::get_resources_dir().join("node").join("node.exe");
        if bundled.exists() {
            return Ok(bundled);
        }

        for c in &["node", "node.exe", r"C:\Program Files\nodejs\node.exe"] {
            let mut cmd = Command::new(c);
            cmd.arg("--version");
            #[cfg(target_os = "windows")]
            {
                cmd.creation_flags(0x08000000);
            }
            if let Ok(o) = cmd.output() {
                if o.status.success() {
                    return Ok(PathBuf::from(*c));
                }
            }
        }
        Err(HyperclipError::BackendCrashed("Node.js not found".into()))
    }

    pub fn new(mut config: ClientConfig) -> Result<Self> {
        let node_bin = Self::find_node()?;
        config.node_path = node_bin.to_string_lossy().to_string();
        Ok(Self {
            config,
            child: None,
            stdin: None,
            line_rx: None,
            req_counter: AtomicU64::new(1),
            drop_counter: None,
        })
    }

    /// Spawn the Node.js daemon if not already running.
    fn ensure_daemon(&mut self) -> Result<()> {
        if self.child.is_some() {
            if let Some(ref mut child) = self.child {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        tracing::warn!("[InnertubeClient] Daemon exited, respawning...");
                        self.kill_child();
                    }
                    Ok(None) => return Ok(()),
                    Err(_) => {
                        self.kill_child();
                    }
                }
            }
        }

        let helper = {
            let res_helper = crate::store::get_resources_dir().join("innertube_helper.js");
            if res_helper.exists() {
                res_helper
            } else if self.config.helper_script.exists() && !self.config.helper_script.to_string_lossy().contains("CARGO_MANIFEST_DIR") {
                self.config.helper_script.clone()
            } else {
                // Dynamically search for helper script
                let mut resolved = PathBuf::new();
                let mut found = false;

                // Check relative to current exe dir walking up
                if let Ok(exe_path) = std::env::current_exe() {
                    if let Some(exe_dir) = exe_path.parent() {
                        let p = exe_dir.join("innertube_helper.js");
                        if p.exists() {
                            resolved = p;
                            found = true;
                        } else {
                            let mut parent = exe_dir.parent();
                            while let Some(p_dir) = parent {
                                let h = p_dir.join("crates/hyperclip_ipc/src/innertube_helper.js");
                                if h.exists() {
                                    resolved = h;
                                    found = true;
                                    break;
                                }
                                parent = p_dir.parent();
                            }
                        }
                    }
                }

                // Check CWD fallbacks
                if !found {
                    for p in &["crates/hyperclip_ipc/src/innertube_helper.js", "resources/innertube_helper.js", "innertube_helper.js"] {
                        let pb = PathBuf::from(p);
                        if pb.exists() {
                            resolved = pb;
                            found = true;
                            break;
                        }
                    }
                }

                if found {
                    resolved
                } else {
                    // Compile-time dev fallback
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/innertube_helper.js")
                }
            }
        };

        let project_root = {
            let mut resolved = None;
            // 1. Check relative to current exe dir
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    if exe_dir.join("node_modules").exists() {
                        resolved = Some(exe_dir.to_path_buf());
                    } else {
                        let mut parent = exe_dir.parent();
                        while let Some(p) = parent {
                            if p.join("node_modules").exists() {
                                resolved = Some(p.to_path_buf());
                                break;
                            }
                            parent = p.parent();
                        }
                    }
                }
            }
            // 2. Check relative to CWD
            if resolved.is_none() {
                if let Ok(cwd) = std::env::current_dir() {
                    if cwd.join("node_modules").exists() {
                        resolved = Some(cwd);
                    } else {
                        let mut parent = cwd.parent();
                        while let Some(p) = parent {
                            if p.join("node_modules").exists() {
                                resolved = Some(p.to_path_buf());
                                break;
                            }
                            parent = p.parent();
                        }
                    }
                }
            }
            // Fallback to dev manifest root parent
            resolved.unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap()
                    .parent()
                    .unwrap()
                    .to_path_buf()
            })
        };

        tracing::info!(
            "[InnertubeClient] Spawning persistent daemon: {} {} --daemon (cwd={:?})",
            self.config.node_path,
            helper.display(),
            project_root
        );

        let mut cmd = Command::new(&self.config.node_path);
        cmd.arg(&helper)
            .arg("--daemon")
            .current_dir(&project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000);
        }
        let mut child = cmd.spawn()
            .map_err(|e| HyperclipError::BackendCrashed(format!("Node daemon spawn failed: {e}")))?;

        let stdin = child.stdin.take().ok_or_else(|| {
            HyperclipError::BackendCrashed("Failed to capture daemon stdin".into())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            HyperclipError::BackendCrashed("Failed to capture daemon stdout".into())
        })?;

        // Spawn a background reader thread that reads lines from stdout
        // and sends them through a channel. This avoids Windows pipe buffering issues
        // with BufReader::read_line blocking in the main thread.
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::Builder::new()
            .name("node-daemon-reader".into())
            .spawn(move || {
                use std::io::Read;
                let mut stdout = stdout;
                let mut buf = Vec::with_capacity(4096);
                let mut tmp = [0u8; 4096];
                loop {
                    match stdout.read(&mut tmp) {
                        Ok(0) => break, // EOF
                        Ok(n) => {
                            buf.extend_from_slice(&tmp[..n]);
                            // Extract complete lines
                            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                                let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                                let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                                if !line.is_empty() {
                                    if tx.send(line).is_err() {
                                        return; // receiver dropped
                                    }
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|e| HyperclipError::BackendCrashed(format!("Failed to spawn reader thread: {e}")))?;

        self.child = Some(child);
        self.stdin = Some(stdin);
        self.line_rx = Some(rx);

        // Wait for the "ready" signal from the daemon (with timeout)
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(15);

        match self.recv_line(timeout) {
            Ok(line) => {
                if let Ok(resp) = serde_json::from_str::<NodeResponse>(&line) {
                    if resp.daemon {
                        tracing::info!(
                            "[InnertubeClient] Daemon ready in {:.1}s",
                            start.elapsed().as_secs_f64()
                        );
                        return Ok(());
                    }
                }
                tracing::error!(
                    "[InnertubeClient] Unexpected first message from daemon: {}",
                    &line[..line.len().min(200)]
                );
                self.kill_child();
                Err(HyperclipError::BackendCrashed(
                    "Daemon sent unexpected first message".into(),
                ))
            }
            Err(e) => {
                tracing::error!("[InnertubeClient] Error reading daemon startup: {}", e);
                self.kill_child();
                Err(e)
            }
        }
    }

    /// Receive one line from the reader channel with a timeout.
    fn recv_line(&self, timeout: std::time::Duration) -> Result<String> {
        if let Some(ref rx) = self.line_rx {
            rx.recv_timeout(timeout).map_err(|e| match e {
                mpsc::RecvTimeoutError::Timeout => {
                    HyperclipError::InnertubeTransient("Daemon response timeout".into())
                }
                mpsc::RecvTimeoutError::Disconnected => {
                    HyperclipError::BackendCrashed("Daemon reader thread disconnected".into())
                }
            })
        } else {
            Err(HyperclipError::BackendCrashed(
                "Daemon reader not available".into(),
            ))
        }
    }

    /// Send a JSON request to the daemon's stdin.
    fn send_request(&mut self, json: &str) -> Result<()> {
        if let Some(ref mut stdin) = self.stdin {
            writeln!(stdin, "{}", json).map_err(|e| {
                HyperclipError::BackendCrashed(format!("Failed to write to daemon stdin: {e}"))
            })?;
            stdin.flush().map_err(|e| {
                HyperclipError::BackendCrashed(format!("Failed to flush daemon stdin: {e}"))
            })?;
            Ok(())
        } else {
            Err(HyperclipError::BackendCrashed(
                "Daemon stdin not available".into(),
            ))
        }
    }

    /// Kill the child process and clean up handles.
    fn kill_child(&mut self) {
        self.stdin = None;
        self.line_rx = None;
        if let Some(ref mut child) = self.child {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.child = None;
    }

    /// Send a setCookie command to the running daemon.
    pub fn update_cookie(&mut self, cookie: &str) -> Result<()> {
        self.ensure_daemon()?;
        let id = self.req_counter.fetch_add(1, Ordering::SeqCst);
        let req = serde_json::json!({
            "id": id,
            "cmd": "setCookie",
            "cookie": cookie,
        });
        self.send_request(&req.to_string())?;
        let timeout = std::time::Duration::from_secs(30);
        let line = self.recv_line(timeout)?;
        match serde_json::from_str::<NodeResponse>(&line) {
            Ok(r) if r.ok => {
                tracing::info!("[InnertubeClient] Cookie updated successfully");
                Ok(())
            }
            Ok(r) => Err(HyperclipError::BackendCrashed(format!(
                "setCookie failed: {}",
                r.error.unwrap_or_default()
            ))),
            Err(e) => Err(HyperclipError::Json(e)),
        }
    }

    /// Fetch latest videos for a channel. Uses the persistent daemon.
    pub async fn get_latest_videos(
        &mut self,
        channel_id: &str,
        cookie: &str,
    ) -> Result<Vec<VideoInfo>> {
        self.ensure_daemon()?;

        let id = self.req_counter.fetch_add(1, Ordering::SeqCst);
        let req = serde_json::json!({
            "id": id,
            "channelId": channel_id,
            "cookie": cookie,
        });

        let start = std::time::Instant::now();
        self.send_request(&req.to_string())?;

        let timeout = std::time::Duration::from_secs(self.config.timeout_sec);
        loop {
            let remaining = timeout.saturating_sub(start.elapsed());
            if remaining.is_zero() {
                tracing::error!(
                    "[InnertubeClient] Timeout waiting for response (id={}, channel={})",
                    id,
                    channel_id
                );
                return Err(HyperclipError::InnertubeTransient(format!(
                    "Daemon response timeout for {channel_id}"
                )));
            }

            let line = match self.recv_line(remaining) {
                Ok(l) => l,
                Err(e) => {
                    // If timeout or disconnect, don't kill daemon (might recover)
                    return Err(e);
                }
            };

            match serde_json::from_str::<NodeResponse>(&line) {
                Ok(r) => {
                    if r.daemon {
                        continue;
                    }
                    if r.cmd.as_deref() == Some("setCookie") || r.cmd.as_deref() == Some("pong") {
                        continue;
                    }
                    if r.id == Some(id) {
                        let elapsed = start.elapsed().as_secs_f64();
                        if r.ok {
                            let videos: Vec<VideoInfo> = r
                                .videos
                                .unwrap_or_default()
                                .into_iter()
                                .map(|v| VideoInfo {
                                    video_id: v.video_id,
                                    title: v.title,
                                    published_at: v.published_at,
                                    thumbnail_url: v.thumbnail_url,
                                    duration_sec: v.duration_sec,
                                    width: 0,
                                    height: 0,
                                    channel_id: v.channel_id,
                                    channel_name: v.channel_name,
                                })
                                .collect();
                            tracing::info!(
                                "[InnertubeClient] Got {} videos for {} in {:.1}s (daemon)",
                                videos.len(),
                                channel_id,
                                elapsed
                            );
                            return Ok(videos);
                        } else {
                            return Err(HyperclipError::InnertubeTransient(
                                r.error.unwrap_or_default(),
                            ));
                        }
                    }
                    tracing::debug!(
                        "[InnertubeClient] Skipping response for id={:?} (waiting for {})",
                        r.id,
                        id
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        "[InnertubeClient] Failed to parse daemon response: {} (line: {})",
                        e,
                        &line[..line.len().min(200)]
                    );
                }
            }
        }
    }

    /// Check and evaluate open Chrome channel tabs. Uses the persistent daemon.
    pub async fn check_chrome_tabs(&mut self, poll_interval_ms: u64) -> Result<Vec<VideoInfo>> {
        self.ensure_daemon()?;

        let id = self.req_counter.fetch_add(1, Ordering::SeqCst);
        let req = serde_json::json!({
            "id": id,
            "cmd": "checkChromeTabs",
            "pollIntervalMs": poll_interval_ms,
        });

        let start = std::time::Instant::now();
        self.send_request(&req.to_string())?;

        let timeout = std::time::Duration::from_secs(10);
        loop {
            let remaining = timeout.saturating_sub(start.elapsed());
            if remaining.is_zero() {
                return Err(HyperclipError::InnertubeTransient(
                    "Timeout waiting for checkChromeTabs response".into()
                ));
            }

            let line = match self.recv_line(remaining) {
                Ok(l) => l,
                Err(e) => return Err(e),
            };

            match serde_json::from_str::<NodeResponse>(&line) {
                Ok(r) => {
                    if r.daemon {
                        continue;
                    }
                    if r.cmd.as_deref() == Some("setCookie") || r.cmd.as_deref() == Some("pong") {
                        continue;
                    }
                    if r.id == Some(id) {
                        if r.ok {
                            let videos: Vec<VideoInfo> = r
                                .videos
                                .unwrap_or_default()
                                .into_iter()
                                .map(|v| VideoInfo {
                                    video_id: v.video_id,
                                    title: v.title,
                                    published_at: v.published_at,
                                    thumbnail_url: v.thumbnail_url,
                                    duration_sec: v.duration_sec,
                                    width: 0,
                                    height: 0,
                                    channel_id: v.channel_id,
                                    channel_name: v.channel_name,
                                })
                                .collect();
                            return Ok(videos);
                        } else {
                            return Err(HyperclipError::InnertubeTransient(
                                r.error.unwrap_or_default(),
                            ));
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "[InnertubeClient] Failed to parse daemon response: {} (line: {})",
                        e,
                        &line[..line.len().min(200)]
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_config() {
        let c = ClientConfig::default();
        assert_eq!(c.timeout_sec, 30);
    }
    #[test]
    fn test_node() {
        let r = InnertubeClient::find_node();
        assert!(r.is_ok() || r.is_err());
    }
}
