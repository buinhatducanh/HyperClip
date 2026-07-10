import subprocess
import time
import os

ytdlp = r"D:\LOOP_COMPANY\HyperClip\resources\yt-dlp\yt-dlp.exe"
url = "https://www.youtube.com/watch?v=rUfBjjiIHnc"

def test_speed(name, client_priority):
    out_file = f"scratch/speed_{name}.mp4"
    if os.path.exists(out_file):
        try:
            os.remove(out_file)
        except Exception:
            pass
            
    cmd = [
        ytdlp,
        "-f", "bestvideo[height<=?360]+bestaudio/best",
        "--remux-video", "mp4",
        "-o", out_file,
        "--ffmpeg-location", r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin",
        "--download-sections", "*00:00:00-00:00:10",
        "--js-runtimes", "node:D:/LOOP_COMPANY/HyperClip/resources/node/node.exe",
        "--no-check-formats",
        "--no-check-certificate",
        "--force-ipv4",
    ]
    if client_priority:
        cmd += ["--extractor-args", f"youtube:player_client={client_priority}"]
    cmd += [url]
    
    print(f"\n--- Testing client: {client_priority or 'default'} ---")
    start = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - start
    print(f"[{name}] Elapsed time: {elapsed:.2f} seconds")
    print(f"[{name}] Exit Code: {res.returncode}")
    # Print warning/error lines
    for line in res.stderr.splitlines():
        if "WARNING" in line or "ERROR" in line or "Skipping" in line:
            print("  ", line)

test_speed("tv_web_ios", "tv_embedded,web,ios")
test_speed("web_ios_tv", "web,ios,tv_embedded")
test_speed("web_ios", "web,ios")
test_speed("android_web", "android,web")
test_speed("default", "")
