// crates/hyperclip_ipc/src/lib.rs

pub mod error;
pub mod types;
pub mod system;
pub mod ffmpeg;
pub mod render_progress;
pub mod youtube;
pub mod download_progress;
pub mod cookies;
pub mod cookies_dpapi;
pub mod cookies_sqlite;
pub mod store;
pub mod detection;
pub mod innertube_client;
pub mod innertube_pool;
pub mod poller;
pub mod chrome_watcher;
pub mod token_manager;

pub mod thumbnail;
pub mod worker_pool;

pub use error::HyperclipError;
pub use worker_pool::WorkerPool;
pub use types::{
    BackendCommand, Channel, IpcRequest, IpcResponse, Settings, VideoInfo, Workspace,
    WorkspaceStatus,
};
pub use system::*;
pub use ffmpeg::*;
pub use youtube::*;
pub use cookies::*;
pub use store::*;
pub use detection::*;
pub use poller::NewVideoEvent;

use std::sync::OnceLock;

pub type EmitHook = Box<dyn Fn(&str) + Send + Sync>;
static EMIT_HOOK: OnceLock<EmitHook> = OnceLock::new();

pub fn set_emit_hook(hook: impl Fn(&str) + Send + Sync + 'static) {
    let _ = EMIT_HOOK.set(Box::new(hook));
}

pub fn emit_raw(json_str: &str) {
    if let Some(hook) = EMIT_HOOK.get() {
        hook(json_str);
    } else {
        use std::io::Write;
        let _ = writeln!(std::io::stdout(), "{}", json_str);
        let _ = std::io::stdout().flush();
    }
}

