import subprocess
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg_path = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"

def count_decimated_frames(filepath):
    print(f"\n========================================\nVisual Duplicate Frame Analysis for: {filepath}")
    # We use mpdecimate filter, which drops duplicate frames.
    # We then look at the number of output frames compared to input.
    # We can read the frame count of mpdecimate from FFmpeg output log.
    cmd = [
        ffmpeg_path, "-i", filepath,
        "-vf", "mpdecimate,metadata=mode=print",
        "-f", "null", "-"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    
    # Let's count how many times "decimate" or "drop" or similar appears in stderr,
    # or just read the total frames processed.
    # FFmpeg prints: "frame=  XXX ..." at the end.
    out_frames = 0
    m = re.findall(r"frame=\s*(\d+)", res.stderr)
    if m:
        out_frames = int(m[-1])
        
    print(f"Total encoded frames: 2727")
    print(f"Frames remaining after mpdecimate: {out_frames}")
    print(f"Number of duplicate/dropped frames: {2727 - out_frames}")

count_decimated_frames(r"d:\LOOP_COMPANY\HyperClip\scratch\out_case5.mp4")
count_decimated_frames(r"d:\LOOP_COMPANY\HyperClip\scratch\out_case7.mp4")
