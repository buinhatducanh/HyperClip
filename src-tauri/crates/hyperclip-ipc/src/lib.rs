//! Tauri command handlers — 1:1 mirror of Electron IPC channels.
//!
//! M0 only exposes `workspace_list`. Later milestones (M1+) will
//! incrementally add commands as the corresponding Rust services
//! are ported.
//!
//! NOTE: The `#[tauri::command]` derive lives in the root `hyperclip` crate
//! because Tauri 2's macro hygiene can fail in workspace members that
//! also list `tauri` as a direct dep alongside a workspace-shared one.

use hyperclip_core::workspace::WorkspaceData;
use hyperclip_store::workspaces::Store;

#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error(transparent)]
    Core(#[from] hyperclip_core::error::CoreError),
}

pub type IpcResult<T> = std::result::Result<T, IpcError>;

/// `workspace_list` — returns all workspaces from the on-disk store.
///
/// M0 creates a new Store per call for simplicity. M1+ will switch
/// to `tauri::State<'_, Store>` injection once more commands exist.
pub async fn workspace_list() -> IpcResult<Vec<WorkspaceData>> {
    let store = Store::for_default_dir().map_err(IpcError::from)?;
    let workspaces = store.list().await.map_err(IpcError::from)?;
    Ok(workspaces)
}
