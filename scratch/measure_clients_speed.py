import subprocess
import time
import os

ytdlp = r"D:\LOOP_COMPANY\HyperClip\resources\yt-dlp\yt-dlp.exe"
url = "https://youtube.com/watch?v=5SVRDlcPCxs"

def run_test(name, client_priority, use_cookies):
    out_file = f"scratch/speed_client_{name}.mp4"
    if os.path.exists(out_file):
        try: os.remove(out_file)
        except Exception: pass

    cmd = [
        ytdlp,
        "-f", "bestvideo[height<=?360]+bestaudio/18/best[height<=?360]/worst",
        "--remux-video", "mp4",
        "-o", out_file,
        "--ffmpeg-location", r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin",
        "--js-runtimes", "node:D:/LOOP_COMPANY/HyperClip/resources/node/node.exe",
        "--no-check-certificate",
        "--force-ipv4",
        "--concurrent-fragments", "8"
    ]
    if client_priority:
        cmd += ["--extractor-args", f"youtube:player_client={client_priority}"]
    if use_cookies:
        cmd += ["--cookies", r"D:\LOOP_COMPANY\HyperClip\data\cookies_netscape.txt"]
    cmd.append(url)

    start = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - start
    
    speed = 0.0
    if os.path.exists(out_file):
        size_mb = os.path.getsize(out_file) / (1024 * 1024)
        speed = size_mb / elapsed
        print(f"Client {name:15s}: {elapsed:5.2f}s | Size: {size_mb:5.2f}MB | Avg Speed: {speed:5.2f}MB/s | Exit: {res.returncode}")
        # Print any warnings
        for line in res.stderr.splitlines():
            if "WARNING" in line or "ERROR" in line:
                print("  ", line)
        try: os.remove(out_file)
        except Exception: pass
    else:
        print(f"Client {name:15s}: FAILED. Exit: {res.returncode}")
        # Print stderr
        print("Stderr:")
        print(res.stderr)

print("Comparing different player clients...")
run_test("web (with cookies)", "web", True)
run_test("mweb (with cookies)", "mweb", True)
run_test("android (no cookies)", "android", False)
run_test("ios (no cookies)", "ios", False)
run_test("default (with cookies)", "", True)
run_test("default (no cookies)", "", False)
