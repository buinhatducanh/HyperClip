// crates/hyperclip_ipc/src/lib.rs

pub mod error;
pub mod types;
pub mod system;
pub mod ffmpeg;
pub mod youtube;
pub mod cookies;
pub mod cookies_dpapi;
pub mod store;
pub mod detection;

pub use error::HyperclipError;
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
