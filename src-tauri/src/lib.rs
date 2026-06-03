use hyperclip_ipc::workspace_list;
use hyperclip_store::workspaces::Store;

pub fn run() {
    // Initialize tracing — defaults to INFO. Override with RUST_LOG env var.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,hyperclip=debug")),
        )
        .init();

    tauri::Builder::default()
        .setup(|app| {
            // Initialize the workspace store and inject it as Tauri managed state.
            let store =
                Store::for_default_dir().map_err(|e| format!("Failed to init store: {}", e))?;
            tracing::info!(
                "Store initialized at {:?} (app ready)",
                store.workspaces_path()
            );
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![workspace_list])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
