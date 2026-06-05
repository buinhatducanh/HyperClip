pub mod types {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum BackendCommand {
        WorkspaceList,
        SystemStats,
        WorkspaceAdd { url: String },
        WorkspaceUpdate { id: String },
        WorkspaceDelete { id: String },
        WorkspaceRetry { id: String },
        RenderStart { id: String },
        RenderCancel { id: String },
        ChannelList,
        ChannelAdd { url: String },
        ChannelRemove { id: String },
    }
}

pub use types::*;
