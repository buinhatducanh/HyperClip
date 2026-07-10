import subprocess
import time
import os

ytdlp = r"D:\LOOP_COMPANY\HyperClip\resources\yt-dlp\yt-dlp.exe"
url = "https://youtube.com/watch?v=5SVRDlcPCxs"
out_file = r"scratch\full_download.mp4"

if os.path.exists(out_file):
    try:
        os.remove(out_file)
    except Exception:
        pass

cmd = [
    ytdlp,
    "-f", "bestvideo[height<=?360]+bestaudio/18/best[height<=?360]/worst",
    "--remux-video", "mp4",
    "-o", out_file,
    "--ffmpeg-location", r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin",
    "--js-runtimes", "node:D:/LOOP_COMPANY/HyperClip/resources/node/node.exe",
    "--no-check-certificate",
    "--force-ipv4",
    "--extractor-args", "youtube:player_client=android,web",
    "--concurrent-fragments", "16",
    "--cookies", r"D:\LOOP_COMPANY\HyperClip\data\cookies_netscape.txt",
    url
]

print("Running full yt-dlp download...")
start = time.time()
res = subprocess.run(cmd, capture_output=True, text=True)
elapsed = time.time() - start

print(f"Elapsed time: {elapsed:.2f} seconds")
print(f"Exit Code: {res.returncode}")
if os.path.exists(out_file):
    size_mb = os.path.getsize(out_file) / (1024 * 1024)
    print(f"File size: {size_mb:.2f} MB")
    print(f"Average speed: {size_mb / elapsed:.2f} MB/s")
else:
    print("Download failed, output file does not exist.")

print("\nStdout:")
print(res.stdout)
print("\nStderr:")
print(res.stderr)
