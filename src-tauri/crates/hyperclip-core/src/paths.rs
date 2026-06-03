use crate::error::{CoreError, Result};
use std::path::PathBuf;

const APP_DIR_NAME: &str = "HyperClip";

/// Resolve the app data directory: %APPDATA%/HyperClip on Windows.
pub fn app_data_dir() -> Result<PathBuf> {
    let base = std::env::var_os("APPDATA").ok_or(CoreError::UnconfiguredPath("APPDATA env var"))?;
    Ok(PathBuf::from(base).join(APP_DIR_NAME))
}

/// Resolve the store dir: <app_data_dir>/.hyperclip (mirrors Electron layout).
pub fn store_dir() -> Result<PathBuf> {
    Ok(app_data_dir()?.join(".hyperclip"))
}

/// Path to the workspaces.json file.
pub fn workspaces_file() -> Result<PathBuf> {
    Ok(store_dir()?.join("workspaces.json"))
}

/// Path to the channels.json file.
pub fn channels_file() -> Result<PathBuf> {
    Ok(store_dir()?.join("channels.json"))
}

/// Path to the subscriptions.json file (legacy / WebSub — empty in current builds).
pub fn subscriptions_file() -> Result<PathBuf> {
    Ok(store_dir()?.join("subscriptions.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspaces_file_is_under_store_dir() {
        let store = store_dir().expect("store dir");
        let ws = workspaces_file().expect("workspaces file");
        assert!(ws.starts_with(&store));
        assert!(ws.ends_with("workspaces.json"));
    }

    #[test]
    fn app_data_dir_ends_with_hyperclip() {
        let app = app_data_dir().expect("app dir");
        assert!(app.ends_with("HyperClip"));
    }
}
