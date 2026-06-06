// crates/hyperclip_ipc/src/types.rs
use serde::{Deserialize, Serialize};

/// Wire format uses colon-separated command names matching the IPC spec
/// (e.g. "system:stats", "workspace:list").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BackendCommand {
    #[serde(rename = "workspace:list")]
    WorkspaceList,
    #[serde(rename = "system:stats")]
    SystemStats,
    #[serde(rename = "workspace:add")]
    WorkspaceAdd { url: String },
    #[serde(rename = "workspace:update")]
    WorkspaceUpdate { id: String },
    #[serde(rename = "workspace:delete")]
    WorkspaceDelete { id: String },
    #[serde(rename = "workspace:retry")]
    WorkspaceRetry { id: String },
    #[serde(rename = "render:start")]
    RenderStart { id: String },
    #[serde(rename = "render:cancel")]
    RenderCancel { id: String },
    #[serde(rename = "channel:list")]
    ChannelList,
    #[serde(rename = "channel:add")]
    ChannelAdd { url: String },
    #[serde(rename = "channel:remove")]
    ChannelRemove { id: String },
}
