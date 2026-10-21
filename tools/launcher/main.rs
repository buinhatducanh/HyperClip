#![windows_subsystem = "windows"]

use std::env;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn main() {
    let current_exe = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let root_dir = current_exe.parent().unwrap_or(&current_exe);

    let app_dir = root_dir.join("app");
    let app_exe = app_dir.join("HyperClip.exe");
    let data_dir = root_dir.join("HyperClip-Data");
    let watch_script = root_dir.join("watch-shutdown.ps1");

    // 1. Launch watch-shutdown.ps1 in background (hidden)
    if watch_script.exists() {
        let _ = Command::new("powershell.exe")
            .args(&[
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                watch_script.to_str().unwrap_or(""),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    // 2. Launch actual app\HyperClip.exe with app as working directory
    let mut cmd = Command::new(&app_exe);
    cmd.current_dir(&app_dir);
    cmd.env("HYPERCLIP_DATA_DIR", &data_dir);
    cmd.env("HYPERCLIPB_DATA_DIR", &data_dir);
    cmd.env("HYPERCLIP_EDITION", "long");

    for arg in env::args().skip(1) {
        cmd.arg(arg);
    }

    if let Ok(mut child) = cmd.spawn() {
        let _ = child.wait();
    }
}
