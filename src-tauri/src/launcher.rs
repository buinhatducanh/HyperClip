// src-tauri/src/launcher.rs
#![windows_subsystem = "windows"]

use std::env;
use std::process::Command;
use std::os::windows::process::CommandExt;

fn main() {
    // 1. Kill stale hyperclip-tauri.exe processes first to prevent lock/port issues
    // CREATE_NO_WINDOW = 0x08000000
    let _ = Command::new("taskkill")
        .args(&["/F", "/IM", "hyperclip-tauri.exe", "/T"])
        .creation_flags(0x08000000)
        .status();

    if let Ok(exe_path) = env::current_exe() {
        if let Some(root_dir) = exe_path.parent() {
            // 2. Resolve HyperClip-Data path
            let data_dir = root_dir.join("HyperClip-Data");
            
            // 3. Resolve app\HyperClip.exe path
            let app_exe = root_dir.join("app").join("HyperClip.exe");
            
            // 4. Set environment variable
            env::set_var("HYPERCLIP_DATA_DIR", &data_dir);
            
            // 5. Gather all arguments
            let args: Vec<String> = env::args().skip(1).collect();
            
            // 6. Spawn the app forwarding arguments
            let mut cmd = Command::new(app_exe);
            cmd.args(&args)
                .current_dir(root_dir.join("app")); // set working dir to app/
            #[cfg(target_os = "windows")]
            {
                cmd.creation_flags(0x08000000);
            }
            let _ = cmd.spawn();
        }
    }
}
