import os
import subprocess
import glob

ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
print("Probing files in scratch/...")
for f in glob.glob("scratch/*.mp4"):
    print(f"File: {f}")
    try:
        out_v = subprocess.check_output([
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=start_time",
            "-of", "default=noprint_wrappers=1:nokey=1",
            f
        ]).decode('utf-8').strip()
        print(f"  Video start_time: {out_v}")
    except Exception as e:
        print(f"  Video probe error: {e}")

    try:
        out_a = subprocess.check_output([
            ffprobe, "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=start_time",
            "-of", "default=noprint_wrappers=1:nokey=1",
            f
        ]).decode('utf-8').strip()
        print(f"  Audio start_time: {out_a}")
    except Exception as e:
        print(f"  Audio probe error: {e}")
