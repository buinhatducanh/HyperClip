import subprocess
import time
import os

ytdlp = r"D:\LOOP_COMPANY\HyperClip\resources\yt-dlp\yt-dlp.exe"
url = "https://www.youtube.com/watch?v=EqWMOrNVnjU"

def test_download_format(name, format_str):
    out_file = f"scratch/format_speed_{name}.mp4"
    if os.path.exists(out_file):
        try:
            os.remove(out_file)
        except Exception:
            pass
            
    cmd = [
        ytdlp,
        "-f", format_str,
        "--remux-video", "mp4",
        "-o", out_file,
        "--ffmpeg-location", r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin",
        "--download-sections", "*00:00:00-00:00:15",
        "--js-runtimes", "node:D:/LOOP_COMPANY/HyperClip/resources/node/node.exe",
        "--extractor-args", "youtube:player_client=android,web",
        url
    ]
    
    print(f"\n--- Testing format: {format_str} ---")
    start = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - start
    print(f"[{name}] Elapsed time: {elapsed:.2f} seconds")
    print(f"[{name}] Output file exists:", os.path.exists(out_file))
    # Find warning/error lines
    for line in res.stderr.splitlines():
        if "WARNING" in line or "ERROR" in line:
            print("  ", line)

# 1. Separate streams (current format for >360p)
test_download_format("separate", "bestvideo[height<=?720]+bestaudio/best[height<=?720]/worst")

# 2. Multiplexed preferred
test_download_format("multiplexed", "best[height<=?720]/bestvideo[height<=?720]+bestaudio/best")
