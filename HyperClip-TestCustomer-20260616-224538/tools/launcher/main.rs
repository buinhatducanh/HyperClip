#![windows_subsystem = "windows"]

use std::env;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn main() {
    let current_exe = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let root_dir = current_exe.parent().unwrap_or(&current_exe);

    let app_dir = root_dir.join("app");
    let app_exe = app_dir.join("HyperClip.exe");
    let data_dir = root_dir.join("HyperClip-Data");
    let watch_script = root_dir.join("watch-shutdown.ps1");
    let start_script = root_dir.join("tools").join("start_assigned_adspower.js");
    let node_exe = app_dir.join("_internal").join("resources").join("node").join("node.exe");

    let mut cmd = Command::new(&app_exe);
    cmd.current_dir(&app_dir);
    cmd.env("HYPERCLIP_DATA_DIR", &data_dir);
    cmd.env("HYPERCLIPB_DATA_DIR", &data_dir);
    cmd.env("HYPERCLIP_EDITION", "long");
    for arg in env::args().skip(1) {
        cmd.arg(arg);
    }

    if let Ok(mut app) = cmd.spawn() {
        // Watch for the last HyperClip window to exit, then clean up owned profiles.
        if watch_script.exists() {
            let _ = Command::new("powershell.exe")
                .args(&[
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-WindowStyle",
                    "Hidden",
                    "-File",
                    watch_script.to_str().unwrap_or(""),
                ])
                .env("HYPERCLIP_DATA_DIR", &data_dir)
                .env("HYPERCLIPB_DATA_DIR", &data_dir)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        }

        // Open every configured AdsPower profile in the background while the UI stays responsive.
        let mut adspower_start: Option<Child> = None;
        if start_script.exists() {
            let mut start = if node_exe.exists() {
                Command::new(&node_exe)
            } else {
                Command::new("node.exe")
            };
            adspower_start = start
                .arg(&start_script)
                .env("HYPERCLIP_DATA_DIR", &data_dir)
                .env("HYPERCLIPB_DATA_DIR", &data_dir)
                .env("HYPERCLIP_EDITION", "long")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .ok();
        }

        let _ = app.wait();
        if let Some(mut start) = adspower_start {
            let _ = start.wait();
        }
    }
}
