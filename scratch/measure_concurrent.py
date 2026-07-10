import subprocess
import time
import os

ytdlp = r"D:\LOOP_COMPANY\HyperClip\resources\yt-dlp\yt-dlp.exe"
url = "https://youtube.com/watch?v=5SVRDlcPCxs"

def run_test(frags):
    out_file = f"scratch/speed_frags_{frags}.mp4"
    if os.path.exists(out_file):
        try: os.remove(out_file)
        except Exception: pass

    cmd = [
        ytdlp,
        "-f", "18/best[height<=?360]/worst",
        "--remux-video", "mp4",
        "-o", out_file,
        "--ffmpeg-location", r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin",
        "--js-runtimes", "node:D:/LOOP_COMPANY/HyperClip/resources/node/node.exe",
        "--no-check-certificate",
        "--force-ipv4",
        "--extractor-args", "youtube:player_client=android,web",
        "--concurrent-fragments", str(frags),
        "--cookies", r"D:\LOOP_COMPANY\HyperClip\data\cookies_netscape.txt",
        url
    ]

    start = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - start
    
    speed = 0.0
    if os.path.exists(out_file):
        size_mb = os.path.getsize(out_file) / (1024 * 1024)
        speed = size_mb / elapsed
        print(f"Frags {frags:2d}: {elapsed:5.2f}s | Size: {size_mb:5.2f}MB | Avg Speed: {speed:5.2f}MB/s | Exit: {res.returncode}")
        try: os.remove(out_file)
        except Exception: pass
    else:
        print(f"Frags {frags:2d}: FAILED. Exit: {res.returncode}")

print("Comparing concurrent fragments speed...")
for f in [1, 4, 8, 16, 32]:
    run_test(f)
