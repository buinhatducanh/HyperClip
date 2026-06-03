use hyperclip_store::workspaces::Store;

#[tauri::command]
async fn workspace_list_cmd() -> Result<Vec<hyperclip_core::workspace::WorkspaceData>, String> {
    hyperclip_ipc::workspace_list()
        .await
        .map_err(|e| e.to_string())
}

pub fn run() {
    // Initialize tracing — defaults to INFO. Override with RUST_LOG env var.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,hyperclip=debug")),
        )
        .init();

    // Pre-warm the store so we can log the path on startup. The actual
    // Tauri command opens its own Store per call in M0 (no managed
    // state yet — added in M1).
    match Store::for_default_dir() {
        Ok(store) => {
            tracing::info!(
                "Store initialized at {:?} (app ready)",
                store.workspaces_path()
            );
        }
        Err(e) => {
            tracing::warn!("Could not pre-warm store: {}", e);
        }
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![workspace_list_cmd])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
