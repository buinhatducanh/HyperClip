import os
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

print("Searching D:/ for pOQJi...")
for root, dirs, files in os.walk("D:/"):
    # Skip some massive folders to make it fast
    if any(p in root.lower() for p in ["node_modules", ".git", "target", "build", "dist"]):
        continue
    for f in files:
        if "pOQJi" in f:
            full_path = os.path.join(root, f)
            print(f"\nFound file: {full_path}")
            try:
                out = subprocess.check_output([
                    ffprobe, "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=start_time",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    full_path
                ]).decode('utf-8').strip()
                print(f"Video start time: {out}")
            except Exception as e:
                print(f"Failed to probe video stream: {e}")
                
            try:
                out_a = subprocess.check_output([
                    ffprobe, "-v", "error", "-select_streams", "a:0",
                    "-show_entries", "stream=start_time",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    full_path
                ]).decode('utf-8').strip()
                print(f"Audio start time: {out_a}")
            except Exception as e:
                print(f"Failed to probe audio stream: {e}")
