import os
import sys
import subprocess
import glob

sys.stdout.reconfigure(encoding='utf-8')

ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

def probe_file(filepath):
    print(f"\nProbing: {filepath}")
    if not os.path.exists(filepath):
        print("  File does not exist.")
        return
    
    # 1. Probe format duration and start time
    try:
        out = subprocess.check_output([
            ffprobe, "-v", "error", "-show_entries", "format=duration,start_time",
            "-of", "default=noprint_wrappers=1", filepath
        ]).decode('utf-8').strip()
        print("  Format info:")
        for line in out.splitlines():
            print(f"    {line}")
    except Exception as e:
        print(f"  Format probe error: {e}")

    # 2. Probe video stream details
    try:
        out = subprocess.check_output([
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name,start_time,duration,nb_frames",
            "-of", "default=noprint_wrappers=1", filepath
        ]).decode('utf-8').strip()
        print("  Video stream info:")
        for line in out.splitlines():
            print(f"    {line}")
    except Exception as e:
        print(f"  Video stream probe error: {e}")

    # 3. Probe audio stream details
    try:
        out = subprocess.check_output([
            ffprobe, "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_name,start_time,duration,nb_frames",
            "-of", "default=noprint_wrappers=1", filepath
        ]).decode('utf-8').strip()
        print("  Audio stream info:")
        for line in out.splitlines():
            print(f"    {line}")
    except Exception as e:
        print(f"  Audio stream probe error: {e}")

# Let's probe some interesting files
probe_file(r"d:\LOOP_COMPANY\HyperClip\data\media\Nhật Đức Anh Bùi\downloads\EqWMOrNVnjU_20260625_070440.mp4")
probe_file(r"d:\LOOP_COMPANY\HyperClip\data\renders\part 1.mp4")
probe_file(r"d:\LOOP_COMPANY\HyperClip\data\renders\part 2.mp4")
probe_file(r"d:\LOOP_COMPANY\HyperClip\data\renders\Test Split 60s Video.mp4")
