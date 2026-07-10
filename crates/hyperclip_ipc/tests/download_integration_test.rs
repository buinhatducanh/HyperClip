use hyperclip_ipc::youtube::download_video_streaming;
use std::path::Path;

#[tokio::test]
async fn test_real_download_speed_and_fallback() {
    let url = "https://youtube.com/watch?v=5SVRDlcPCxs";
    let output_path = "scratch/integration_test_dl.mp4";
    let cookies_path = "data/cookies_netscape.txt";
    
    if Path::new(output_path).exists() {
        let _ = std::fs::remove_file(output_path);
    }
    
    println!("Starting E2E download for validation...");
    let start = std::time::Instant::now();
    
    // We request 360p quality
    let result = download_video_streaming(
        url,
        output_path,
        cookies_path,
        0, // trim_minutes (0 = download full)
        Some(10), // duration limit or None
        360, // quality (360p)
        16, // concurrent_fragments
        |progress| {
            println!("Progress: {}%", progress.percent);
        }
    );
    
    let elapsed = start.elapsed();
    println!("E2E test elapsed time: {:?}", elapsed);
    
    match result {
        Ok(res) => {
            println!("Download SUCCESS! Result: {:?}", res);
            assert!(Path::new(output_path).exists());
            let size = std::fs::metadata(output_path).unwrap().len();
            println!("Downloaded file size: {} bytes", size);
            assert!(size > 0);
            let _ = std::fs::remove_file(output_path);
        }
        Err(e) => {
            panic!("Download failed: {}", e);
        }
    }
}
