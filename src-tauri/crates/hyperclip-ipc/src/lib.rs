//! Tauri command handlers — 1:1 mirror of Electron IPC channels.
//!
//! M0 only exposes `workspace_list`. Later milestones (M1+) will
//! incrementally add commands as the corresponding Rust services
//! are ported.

use hyperclip_core::error::Result as CoreResult;
use hyperclip_core::workspace::WorkspaceData;
use hyperclip_store::workspaces::Store;

#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error(transparent)]
    Core(#[from] hyperclip_core::error::CoreError),
}

pub type IpcResult<T> = std::result::Result<T, IpcError>;

/// `workspace_list` — returns all workspaces from the on-disk store.
#[tauri::command]
pub async fn workspace_list(store: tauri::State<'_, Store>) -> IpcResult<Vec<WorkspaceData>> {
    let workspaces = store.list().await.map_err(IpcError::from)?;
    Ok(workspaces)
}
