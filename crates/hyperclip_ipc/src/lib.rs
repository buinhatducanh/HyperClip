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
