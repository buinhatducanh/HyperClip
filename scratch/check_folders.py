import os
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

def probe_file(path):
    print(f"\nProbing: {path}")
    if not os.path.exists(path):
        print("File does not exist!")
        return
    try:
        out_v = subprocess.check_output([
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=start_time",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path
        ]).decode('utf-8').strip()
        print(f"Video start time: {out_v}")
    except Exception as e:
        print(f"Failed video probe: {e}")

    try:
        out_a = subprocess.check_output([
            ffprobe, "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=start_time",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path
        ]).decode('utf-8').strip()
        print(f"Audio start time: {out_a}")
    except Exception as e:
        print(f"Failed audio probe: {e}")

# Check files in D:/tải về
tại_về_dir = "D:/tải về"
if os.path.exists(tại_về_dir):
    print(f"Listing {tại_về_dir}:")
    for f in os.listdir(tại_về_dir):
        print(f" - {f}")
        if "pOQJi" in f:
            probe_file(os.path.join(tại_về_dir, f))
else:
    print(f"{tại_về_dir} does not exist!")

# Check files in D:/đã render
đã_render_dir = "D:/đã render"
if os.path.exists(đã_render_dir):
    print(f"Listing {đã_render_dir}:")
    for f in os.listdir(đã_render_dir):
        print(f" - {f}")
        if "pOQJi" in f:
            probe_file(os.path.join(đã_render_dir, f))
else:
    print(f"{đã_render_dir} does not exist!")
